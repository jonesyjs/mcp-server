import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig } from "./config.js";
import { createMcpServer } from "./mcp.js";
import { loadPlugins } from "./plugins/index.js";
import { getSessionManager } from "./plugins/wake.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  const config = loadConfig();
  const startTime = Date.now();

  console.log(`Starting ${config.server.name} on port ${config.server.port}`);

  const mcp = createMcpServer(config);
  loadPlugins(mcp, config);

  const app = express();
  app.use(express.json());

  // ---------------------------------------------------------------------------
  // Health check (enhanced)
  // ---------------------------------------------------------------------------
  app.get("/health", (_req, res) => {
    const sessionManager = getSessionManager();
    const activeSessions = sessionManager?.getRunningSessionCount() || 0;
    const maxSessions = 3; // Default, could be from config

    res.json({
      status: "ok",
      name: config.server.name,
      activeSessions,
      maxSessions,
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  });

  // ---------------------------------------------------------------------------
  // Viewer page
  // ---------------------------------------------------------------------------
  app.get("/viewer", (_req, res) => {
    try {
      const viewerPath = join(__dirname, "plugins", "wake", "viewer.html");
      const html = readFileSync(viewerPath, "utf-8");
      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch (err) {
      res.status(500).send("Viewer page not found");
    }
  });

  // ---------------------------------------------------------------------------
  // Kill session API
  // ---------------------------------------------------------------------------
  app.post("/api/kill", (req, res) => {
    const sessionId = req.query.session as string;
    if (!sessionId) {
      res.status(400).json({ error: "Missing session parameter" });
      return;
    }

    const sessionManager = getSessionManager();
    if (!sessionManager) {
      res.status(503).json({ error: "Wake plugin not loaded" });
      return;
    }

    const result = sessionManager.killSession(sessionId);
    if (result.success) {
      res.json({ success: true, sessionId });
    } else {
      res.status(404).json({ error: result.error });
    }
  });

  // ---------------------------------------------------------------------------
  // MCP endpoint
  // ---------------------------------------------------------------------------
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  app.post("/mcp", async (req, res) => {
    try {
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP request error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/mcp", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    await transport.handleRequest(req, res);
  });

  await mcp.connect(transport);

  // ---------------------------------------------------------------------------
  // Create HTTP server and WebSocket server
  // ---------------------------------------------------------------------------
  const server = createServer(app);

  const wss = new WebSocketServer({ noServer: true });

  // Handle WebSocket upgrade
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);

    if (url.pathname === "/ws") {
      const sessionId = url.searchParams.get("session");

      if (!sessionId) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request, sessionId);
      });
    } else {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
    }
  });

  // Handle WebSocket connections
  wss.on("connection", (ws: WebSocket, _request: unknown, sessionId: string) => {
    console.log(`[ws] Client connected to session ${sessionId}`);

    const sessionManager = getSessionManager();
    if (!sessionManager) {
      ws.send(JSON.stringify({ type: "server", event: "error", message: "Wake plugin not loaded" }));
      ws.close();
      return;
    }

    sessionManager.addClient(sessionId, ws);

    ws.on("close", () => {
      console.log(`[ws] Client disconnected from session ${sessionId}`);
    });
  });

  // ---------------------------------------------------------------------------
  // Start server
  // ---------------------------------------------------------------------------
  server.listen(config.server.port, () => {
    console.log(`MCP server running at http://localhost:${config.server.port}`);
    console.log(`  MCP endpoint: http://localhost:${config.server.port}/mcp`);
    console.log(`  Viewer page:  http://localhost:${config.server.port}/viewer`);
    console.log(`  WebSocket:    ws://localhost:${config.server.port}/ws`);
    console.log(`  Health:       http://localhost:${config.server.port}/health`);
  });
}

main().catch(console.error);
