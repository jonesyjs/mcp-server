import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PluginConfig } from "../config.js";
import { z } from "zod";
import { SessionManager, WakeConfig, getNormalizedEvents } from "./wake/sessions.js";

// Singleton session manager - shared with server for WebSocket handling
let sessionManager: SessionManager | null = null;

export function getSessionManager(): SessionManager | null {
  return sessionManager;
}

// ============================================================================
// Plugin Registration
// ============================================================================

export function registerWake(mcp: McpServer, config: PluginConfig): void {
  // Parse config
  const projects: WakeConfig["projects"] = [];

  // Config can be either Record<string, string> (old format) or Array (new format)
  const projectsConfig = config.projects;
  if (projectsConfig) {
    if (Array.isArray(projectsConfig)) {
      for (const p of projectsConfig) {
        if (typeof p === "object" && p.name && p.path) {
          projects.push({
            name: p.name as string,
            path: p.path as string,
            description: p.description as string | undefined,
          });
        }
      }
    } else if (typeof projectsConfig === "object") {
      // Old format: { alias: path }
      for (const [name, path] of Object.entries(projectsConfig)) {
        if (typeof path === "string") {
          projects.push({ name, path });
        }
      }
    }
  }

  const wakeConfig: WakeConfig = {
    maxConcurrentSessions: (config.maxConcurrentSessions as number) || 3,
    projects,
  };

  sessionManager = new SessionManager(wakeConfig);

  // -------------------------------------------------------------------------
  // Tool: list_projects
  // -------------------------------------------------------------------------
  mcp.tool(
    "list_projects",
    "List configured projects that can be used with wake_session. Returns project names and descriptions (paths are hidden for security).",
    {},
    async () => {
      const projects = sessionManager!.getProjects();

      if (projects.length === 0) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              projects: [],
              message: "No projects configured. Add projects to the wake plugin config.",
            }, null, 2),
          }],
        };
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ projects }, null, 2),
        }],
      };
    }
  );

  // -------------------------------------------------------------------------
  // Tool: wake_session
  // -------------------------------------------------------------------------
  mcp.tool(
    "wake_session",
    "Start a Claude Code session for a project. Returns a viewer URL that can be embedded in an iframe to watch the session in real-time.",
    {
      project: z.string().describe("Project name from list_projects"),
      task: z.string().describe("Natural language description of the task to perform"),
      timeout: z.number().optional().describe("Optional max execution time in seconds"),
    },
    async ({ project, task, timeout }) => {
      const result = await sessionManager!.spawnSession(project, task, timeout);

      if (!result.success) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ error: result.error }, null, 2),
          }],
        };
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "started",
            sessionId: result.session.sessionId,
            viewerUrl: result.viewerUrl,
            project: result.session.project,
            message: "Session started. Embed the viewerUrl in an iframe to watch progress.",
          }, null, 2),
        }],
      };
    }
  );

  // -------------------------------------------------------------------------
  // Tool: get_session
  // -------------------------------------------------------------------------
  mcp.tool(
    "get_session",
    "Get the status, events, and result of a Claude Code session. Use fromIndex to get only new events since last poll.",
    {
      sessionId: z.string().describe("Session ID from wake_session"),
      fromIndex: z.number().optional().describe("Start from this event index (0-based). Omit to get all events."),
    },
    async ({ sessionId, fromIndex }) => {
      const session = sessionManager!.getSession(sessionId);

      if (!session) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ error: `Session '${sessionId}' not found` }, null, 2),
          }],
        };
      }

      const startIdx = fromIndex ?? 0;
      const normalizedEvents = getNormalizedEvents(session, startIdx);

      const response: Record<string, unknown> = {
        sessionId: session.sessionId,
        status: session.status,
        project: session.project,
        startTime: session.startTime.toISOString(),
        totalEvents: session.events.length,
        fromIndex: startIdx,
        events: normalizedEvents,
      };

      if (session.status === "complete" && session.result) {
        response.result = session.result;
      }

      if (session.status === "error" && session.error) {
        response.error = session.error;
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify(response, null, 2),
        }],
      };
    }
  );

  // -------------------------------------------------------------------------
  // Tool: kill_session
  // -------------------------------------------------------------------------
  mcp.tool(
    "kill_session",
    "Terminate a running Claude Code session.",
    {
      sessionId: z.string().describe("Session ID to terminate"),
    },
    async ({ sessionId }) => {
      const result = sessionManager!.killSession(sessionId);

      if (!result.success) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ error: result.error }, null, 2),
          }],
        };
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            sessionId,
            message: "Session terminated.",
          }, null, 2),
        }],
      };
    }
  );

  console.log(`[wake] Plugin loaded. ${projects.length} projects configured.`);
}
