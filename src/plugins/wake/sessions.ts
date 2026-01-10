import { spawn, ChildProcess } from "child_process";
import { createInterface } from "readline";

// ============================================================================
// Types
// ============================================================================

export type SessionStatus = "running" | "complete" | "error";

export interface Session {
  sessionId: string;
  project: string;
  projectPath: string;
  task: string;
  pid: number;
  process: ChildProcess;
  startTime: Date;
  status: SessionStatus;
  events: StreamEvent[];
  result?: string;
  error?: string;
}

// Normalized event types for API responses
export type NormalizedEvent =
  | { type: "assistant"; text: string }
  | { type: "tool_use"; tool: string; input: string }
  | { type: "tool_result"; output: string }
  | { type: "complete"; result: string; duration_ms?: number; cost?: number };

export interface StreamEvent {
  type: string;
  subtype?: string;
  [key: string]: unknown;
}

export interface WakeConfig {
  maxConcurrentSessions: number;
  projects: Array<{ name: string; path: string; description?: string }>;
}

// ============================================================================
// Event Normalization
// ============================================================================

function truncate(str: string, maxLen: number = 2000): string {
  if (!str) return "";
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + `\n... (truncated, ${str.length - maxLen} more chars)`;
}

export function normalizeEvent(raw: StreamEvent): NormalizedEvent[] {
  const results: NormalizedEvent[] = [];

  if (raw.type === "system") {
    // Skip init events
    return results;
  }

  if (raw.type === "assistant") {
    const message = raw.message as { content?: Array<{ type: string; text?: string; name?: string; input?: unknown }> } | undefined;
    if (message?.content) {
      for (const item of message.content) {
        if (item.type === "text" && item.text) {
          results.push({ type: "assistant", text: item.text });
        }
        if (item.type === "tool_use" && item.name) {
          results.push({
            type: "tool_use",
            tool: item.name,
            input:
              typeof item.input === "string"
                ? truncate(item.input)
                : truncate(JSON.stringify(item.input, null, 2)),
          });
        }
      }
    }
  }

  if (raw.type === "user") {
    const message = raw.message as { content?: Array<{ type: string; content?: string }> } | undefined;
    if (message?.content) {
      for (const item of message.content) {
        if (item.type === "tool_result") {
          results.push({
            type: "tool_result",
            output: truncate(item.content || ""),
          });
        }
      }
    }
  }

  if (raw.type === "result") {
    results.push({
      type: "complete",
      result: truncate((raw.result as string) || "", 4000),
      duration_ms: raw.duration_ms as number | undefined,
      cost: raw.total_cost_usd as number | undefined,
    });
  }

  return results;
}

export function getNormalizedEvents(session: Session, fromIndex: number = 0): NormalizedEvent[] {
  const eventsToProcess = session.events.slice(fromIndex);
  return eventsToProcess.flatMap(normalizeEvent);
}

// ============================================================================
// Ngrok URL Discovery
// ============================================================================

let cachedNgrokUrl: string | null = null;

export async function getNgrokUrl(): Promise<string | null> {
  if (cachedNgrokUrl) return cachedNgrokUrl;

  try {
    const response = await fetch("http://localhost:4040/api/tunnels");
    const data = await response.json();
    const tunnel = data.tunnels?.find((t: { proto: string }) => t.proto === "https");
    cachedNgrokUrl = tunnel?.public_url || null;
    return cachedNgrokUrl;
  } catch {
    return null;
  }
}

export function clearNgrokCache(): void {
  cachedNgrokUrl = null;
}

// ============================================================================
// Session Manager
// ============================================================================

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private config: WakeConfig;
  private projectMap: Map<string, { path: string; description?: string }>;

  constructor(config: WakeConfig) {
    this.config = config;
    this.projectMap = new Map(
      config.projects.map((p) => [p.name, { path: p.path, description: p.description }])
    );

    // Graceful shutdown handlers
    process.on("SIGTERM", () => this.shutdown());
    process.on("SIGINT", () => this.shutdown());
  }

  private generateSessionId(): string {
    const timestamp = Math.floor(Date.now() / 1000);
    const random = Math.random().toString(36).substring(2, 8);
    return `wake-${timestamp}-${random}`;
  }

  // ---------------------------------------------------------------------------
  // Project Management
  // ---------------------------------------------------------------------------

  getProjects(): Array<{ name: string; description?: string }> {
    return this.config.projects.map((p) => ({
      name: p.name,
      description: p.description,
    }));
  }

  resolveProjectPath(projectName: string): string | null {
    const project = this.projectMap.get(projectName);
    return project?.path || null;
  }

  // ---------------------------------------------------------------------------
  // Session Queries
  // ---------------------------------------------------------------------------

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  getActiveSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  getRunningSessionCount(): number {
    return Array.from(this.sessions.values()).filter((s) => s.status === "running").length;
  }

  canSpawnSession(): boolean {
    return this.getRunningSessionCount() < this.config.maxConcurrentSessions;
  }

  // ---------------------------------------------------------------------------
  // Session Lifecycle
  // ---------------------------------------------------------------------------

  async spawnSession(
    projectName: string,
    task: string,
    timeout?: number
  ): Promise<{ success: true; session: Session; viewerUrl: string } | { success: false; error: string }> {
    // Check concurrent limit
    if (!this.canSpawnSession()) {
      return {
        success: false,
        error: `Max concurrent sessions (${this.config.maxConcurrentSessions}) reached`,
      };
    }

    // Resolve project
    const projectPath = this.resolveProjectPath(projectName);
    if (!projectPath) {
      const available = this.config.projects.map((p) => p.name).join(", ");
      return {
        success: false,
        error: `Project '${projectName}' not found. Available: ${available || "none"}`,
      };
    }

    // Get ngrok URL for viewer
    const ngrokUrl = await getNgrokUrl();
    if (!ngrokUrl) {
      return {
        success: false,
        error: "Ngrok tunnel not available. Check ngrok is running.",
      };
    }

    const sessionId = this.generateSessionId();

    // Build command: claude -p "task" --output-format stream-json --verbose --dangerously-skip-permissions
    const args = [
      "-p",
      task,
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
    ];

    console.log(`[wake] Spawning session ${sessionId}: claude ${args.join(" ")}`);
    console.log(`[wake] Working directory: ${projectPath}`);

    try {
      // On Windows, use cmd.exe to run claude to handle .cmd scripts properly
      const childProcess = process.platform === "win32"
        ? spawn("cmd.exe", ["/c", "claude", ...args], {
            cwd: projectPath,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
          })
        : spawn("claude", args, {
            cwd: projectPath,
            stdio: ["ignore", "pipe", "pipe"],
          });

      if (!childProcess.pid) {
        return { success: false, error: "Failed to spawn Claude Code process (no PID)" };
      }

      const session: Session = {
        sessionId,
        project: projectName,
        projectPath,
        task,
        pid: childProcess.pid,
        process: childProcess,
        startTime: new Date(),
        status: "running",
        events: [],
      };

      this.sessions.set(sessionId, session);

      // Set up stdout line reader for stream-json
      if (childProcess.stdout) {
        const rl = createInterface({ input: childProcess.stdout });
        rl.on("line", (line) => {
          try {
            const event = JSON.parse(line) as StreamEvent;
            this.handleEvent(sessionId, event);
          } catch {
            // Non-JSON line, ignore
          }
        });
      }

      // Capture stderr for debugging
      if (childProcess.stderr) {
        childProcess.stderr.on("data", (data) => {
          console.error(`[wake] Session ${sessionId} stderr:`, data.toString());
        });
      }

      // Handle process exit
      childProcess.on("exit", (code) => {
        console.log(`[wake] Session ${sessionId} exited with code ${code}`);
        const s = this.sessions.get(sessionId);
        if (s && s.status === "running") {
          s.status = code === 0 ? "complete" : "error";
          if (code !== 0) {
            s.error = `Process exited with code ${code}`;
          }
        }
      });

      childProcess.on("error", (err) => {
        console.error(`[wake] Session ${sessionId} error:`, err);
        const s = this.sessions.get(sessionId);
        if (s) {
          s.status = "error";
          s.error = err.message;
        }
      });

      // Optional timeout
      if (timeout && timeout > 0) {
        setTimeout(() => {
          const s = this.sessions.get(sessionId);
          if (s && s.status === "running") {
            console.log(`[wake] Session ${sessionId} timed out after ${timeout}s`);
            this.killSession(sessionId);
          }
        }, timeout * 1000);
      }

      const viewerUrl = `${ngrokUrl}/viewer?session=${sessionId}`;
      return { success: true, session, viewerUrl };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to spawn Claude Code: ${message}` };
    }
  }

  killSession(sessionId: string): { success: boolean; error?: string } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, error: `Session '${sessionId}' not found` };
    }

    try {
      // Kill the process
      if (session.status === "running") {
        process.kill(session.pid, "SIGTERM");

        // Force kill after 5 seconds if still running
        setTimeout(() => {
          try {
            process.kill(session.pid, 0); // Check if alive
            process.kill(session.pid, "SIGKILL");
          } catch {
            // Already dead
          }
        }, 5000);
      }

      session.status = "complete";
      return { success: true };
    } catch (err) {
      // Process may already be dead
      return { success: true };
    }
  }

  // ---------------------------------------------------------------------------
  // Event Handling
  // ---------------------------------------------------------------------------

  private handleEvent(sessionId: string, event: StreamEvent): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Store event
    session.events.push(event);

    // Extract result if this is a final event
    if (event.type === "result") {
      session.status = event.subtype === "success" ? "complete" : "error";
      session.result = event.result as string | undefined;
      if (event.subtype !== "success") {
        session.error = (event.error as string) || "Unknown error";
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  shutdown(): void {
    console.log("[wake] Shutting down, terminating all sessions...");
    for (const [, session] of this.sessions) {
      if (session.status === "running") {
        try {
          process.kill(session.pid, "SIGTERM");
        } catch {
          // Ignore
        }
      }
    }
    this.sessions.clear();
  }
}
