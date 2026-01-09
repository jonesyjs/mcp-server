import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PluginConfig } from "../config.js";
import { spawn, ChildProcess } from "child_process";
import { existsSync } from "fs";
import { basename } from "path";
import { z } from "zod";

// Helper to extract command name from potentially path-expanded config value
// (config.ts expands all strings as paths, so "happy" becomes "C:\...\happy")
function extractCommand(value: unknown, defaultCmd: string): string {
  if (typeof value !== "string") return defaultCmd;
  // If it looks like an absolute path, extract just the basename
  if (value.includes("/") || value.includes("\\")) {
    return basename(value);
  }
  return value;
}

// Helper to extract resume mode from potentially path-expanded config value
function extractResumeMode(value: unknown): "new" | "continue" | "resume" {
  if (typeof value !== "string") return "continue";
  const val = basename(value); // Extract just the last part if it's a path
  if (val === "new" || val === "continue" || val === "resume") {
    return val;
  }
  return "continue";
}

// ============================================================================
// Types
// ============================================================================

interface WakeConfig {
  enabled: boolean;
  maxConcurrentSessions: number;
  defaultIdleTimeout: number;
  defaultResumeMode: "new" | "continue" | "resume";
  happyCommand: string;
  projects: Record<string, string>;
}

type SessionStatus = "running" | "terminating";

interface Session {
  sessionId: string;
  project: string;
  projectPath: string;
  pid: number;
  process: ChildProcess;
  startTime: Date;
  resumeMode: string;
  status: SessionStatus;
}

// Check if a process is still alive
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Session Manager
// ============================================================================

class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private config: WakeConfig;
  private idleCheckInterval: NodeJS.Timeout | null = null;

  constructor(config: WakeConfig) {
    this.config = config;
    this.startIdleChecker();
  }

  private generateSessionId(): string {
    const timestamp = Math.floor(Date.now() / 1000);
    const random = Math.random().toString(36).substring(2, 8);
    return `wake-${timestamp}-${random}`;
  }

  private startIdleChecker(): void {
    // Check every 5 minutes for idle sessions
    this.idleCheckInterval = setInterval(() => {
      const now = Date.now();
      for (const [sessionId, session] of this.sessions) {
        const ageMs = now - session.startTime.getTime();
        if (ageMs > this.config.defaultIdleTimeout * 1000) {
          console.log(`Session ${sessionId} exceeded idle timeout, terminating...`);
          this.killSession(sessionId);
        }
      }
    }, 5 * 60 * 1000);
  }

  resolveProjectPath(project: string): string | null {
    // Check if it's an alias
    if (this.config.projects[project]) {
      return this.config.projects[project];
    }
    // Check if it's a direct path that exists
    if (existsSync(project)) {
      return project;
    }
    return null;
  }

  getProjects(): Record<string, string> {
    return this.config.projects;
  }

  getActiveSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  canSpawnSession(): boolean {
    return this.sessions.size < this.config.maxConcurrentSessions;
  }

  spawnSession(
    project: string,
    projectPath: string,
    resumeMode: "new" | "continue" | "resume",
    sessionId?: string
  ): { success: true; session: Session } | { success: false; error: string } {
    if (!this.canSpawnSession()) {
      return {
        success: false,
        error: `Max concurrent sessions (${this.config.maxConcurrentSessions}) reached`,
      };
    }

    // Build command arguments
    const args: string[] = ["--project", projectPath];

    // Add resume flags based on mode
    if (resumeMode === "continue") {
      args.push("--", "--continue");
    } else if (resumeMode === "resume" && sessionId) {
      args.push("--", "--resume", sessionId);
    }
    // "new" mode = no extra flags

    console.log(`Spawning: ${this.config.happyCommand} ${args.join(" ")}`);

    try {
      const childProcess = spawn(this.config.happyCommand, args, {
        detached: true,
        stdio: "ignore",
        shell: true,
        cwd: projectPath,
      });

      // Unref so the parent can exit independently
      childProcess.unref();

      if (!childProcess.pid) {
        return { success: false, error: "Failed to spawn Happy process (no PID)" };
      }

      const newSessionId = this.generateSessionId();
      const session: Session = {
        sessionId: newSessionId,
        project,
        projectPath,
        pid: childProcess.pid,
        process: childProcess,
        startTime: new Date(),
        resumeMode,
        status: "running",
      };

      this.sessions.set(newSessionId, session);

      // Handle process exit
      childProcess.on("exit", (code) => {
        console.log(`Session ${newSessionId} exited with code ${code}`);
        this.sessions.delete(newSessionId);
      });

      childProcess.on("error", (err) => {
        console.error(`Session ${newSessionId} error:`, err);
        this.sessions.delete(newSessionId);
      });

      return { success: true, session };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to spawn Happy: ${message}` };
    }
  }

  killSession(sessionId: string): { success: true } | { success: false; error: string } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, error: `Session '${sessionId}' not found` };
    }

    if (session.status === "terminating") {
      return { success: false, error: `Session '${sessionId}' is already terminating` };
    }

    // Mark as terminating before attempting kill
    session.status = "terminating";
    const pid = session.pid;

    try {
      // Try graceful kill first
      process.kill(pid, "SIGTERM");

      // Force kill after 30 seconds if still running, then clean up
      setTimeout(() => {
        if (isProcessAlive(pid)) {
          console.log(`Session ${sessionId} didn't exit gracefully, force killing...`);
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            // Ignore - process may have exited between check and kill
          }
        }
        // Clean up session from map after grace period
        this.sessions.delete(sessionId);
      }, 30000);

      return { success: true };
    } catch (err) {
      // Process might already be dead - clean up immediately
      this.sessions.delete(sessionId);
      return { success: true };
    }
  }

  shutdown(): void {
    console.log("Shutting down wake plugin, terminating all sessions...");
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
    }
    for (const sessionId of this.sessions.keys()) {
      this.killSession(sessionId);
    }
  }
}

// ============================================================================
// Plugin Registration
// ============================================================================

export function registerWake(mcp: McpServer, config: PluginConfig): void {
  const wakeConfig: WakeConfig = {
    enabled: config.enabled,
    maxConcurrentSessions: (config.maxConcurrentSessions as number) || 5,
    defaultIdleTimeout: (config.defaultIdleTimeout as number) || 86400,
    defaultResumeMode: extractResumeMode(config.defaultResumeMode),
    happyCommand: extractCommand(config.happyCommand, "happy"),
    projects: (config.projects as Record<string, string>) || {},
  };

  const sessionManager = new SessionManager(wakeConfig);

  // Clean up on process exit
  process.on("SIGINT", () => sessionManager.shutdown());
  process.on("SIGTERM", () => sessionManager.shutdown());

  // -------------------------------------------------------------------------
  // Tool: list_projects
  // -------------------------------------------------------------------------
  mcp.tool(
    "list_projects",
    "List configured project aliases that can be used with wake_session",
    {},
    async () => {
      const projects = sessionManager.getProjects();
      const entries = Object.entries(projects);

      if (entries.length === 0) {
        return {
          content: [{
            type: "text",
            text: "No projects configured. Add projects to the wake plugin config.",
          }],
        };
      }

      let result = "Configured Projects:\n\n";
      for (const [alias, path] of entries) {
        const exists = existsSync(path) ? "[OK]" : "[NOT FOUND]";
        result += `- **${alias}**: ${path} ${exists}\n`;
      }
      result += "\nUse wake_session(project: \"alias\") to start a session.";

      return { content: [{ type: "text", text: result }] };
    }
  );

  // -------------------------------------------------------------------------
  // Tool: wake_session
  // -------------------------------------------------------------------------
  mcp.tool(
    "wake_session",
    "Start a Happy CLI session for a project, spawning Claude Code. The session will appear in your Happy mobile app.",
    {
      project: z.string().describe("Project alias (from config) or full path to project directory"),
      resumeMode: z
        .enum(["new", "continue", "resume"])
        .optional()
        .describe("new=fresh session, continue=most recent conversation, resume=specific session"),
      resumeSessionId: z
        .string()
        .optional()
        .describe("Required if resumeMode is 'resume' - the Claude Code session ID to resume"),
    },
    async ({ project, resumeMode, resumeSessionId }) => {
      // Resolve project path
      const projectPath = sessionManager.resolveProjectPath(project);
      if (!projectPath) {
        const available = Object.keys(sessionManager.getProjects());
        return {
          content: [{
            type: "text",
            text: `Project '${project}' not found. ${
              available.length > 0
                ? `Available aliases: ${available.join(", ")}`
                : "No projects configured."
            }`,
          }],
        };
      }

      // Validate resumeMode + resumeSessionId combination
      const mode = resumeMode || wakeConfig.defaultResumeMode;
      if (mode === "resume" && !resumeSessionId) {
        return {
          content: [{
            type: "text",
            text: "resumeMode 'resume' requires a resumeSessionId parameter.",
          }],
        };
      }

      // Spawn the session
      const result = sessionManager.spawnSession(project, projectPath, mode, resumeSessionId);

      if (!result.success) {
        return {
          content: [{
            type: "text",
            text: `Failed to start session: ${result.error}`,
          }],
        };
      }

      const session = result.session;
      return {
        content: [{
          type: "text",
          text: JSON.stringify(
            {
              status: "success",
              sessionId: session.sessionId,
              project: session.project,
              projectPath: session.projectPath,
              resumeMode: session.resumeMode,
              pid: session.pid,
              message: "Session started. Open Happy mobile app to connect.",
            },
            null,
            2
          ),
        }],
      };
    }
  );

  // -------------------------------------------------------------------------
  // Tool: list_sessions
  // -------------------------------------------------------------------------
  mcp.tool(
    "list_sessions",
    "List all active Happy CLI sessions spawned by the wake plugin",
    {},
    async () => {
      const sessions = sessionManager.getActiveSessions();

      if (sessions.length === 0) {
        return {
          content: [{
            type: "text",
            text: "No active sessions.",
          }],
        };
      }

      const sessionData = sessions.map((s) => {
        // Check actual process liveness
        const alive = isProcessAlive(s.pid);
        let status: string;
        if (s.status === "terminating") {
          status = "terminating";
        } else if (alive) {
          status = "running";
        } else {
          status = "dead";
        }

        return {
          sessionId: s.sessionId,
          project: s.project,
          projectPath: s.projectPath,
          pid: s.pid,
          startTime: s.startTime.toISOString(),
          status,
        };
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ sessions: sessionData }, null, 2),
        }],
      };
    }
  );

  // -------------------------------------------------------------------------
  // Tool: kill_session
  // -------------------------------------------------------------------------
  mcp.tool(
    "kill_session",
    "Terminate a Happy CLI session. Chat history is preserved and can be resumed later.",
    {
      sessionId: z.string().describe("Session ID to terminate (from list_sessions)"),
    },
    async ({ sessionId }) => {
      const result = sessionManager.killSession(sessionId);

      if (!result.success) {
        return {
          content: [{
            type: "text",
            text: `Failed to kill session: ${result.error}`,
          }],
        };
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify(
            {
              status: "success",
              sessionId,
              message: "Session terminated. Chat history preserved in ~/.claude/projects/",
            },
            null,
            2
          ),
        }],
      };
    }
  );

  console.log(`Wake plugin loaded. ${Object.keys(wakeConfig.projects).length} projects configured.`);
}
