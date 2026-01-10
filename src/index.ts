import express from "express";
import { createServer } from "http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig } from "./config.js";
import { createMcpServer } from "./mcp.js";
import { loadPlugins } from "./plugins/index.js";
import { getSessionManager } from "./plugins/wake.js";

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
  // Start server
  // ---------------------------------------------------------------------------
  const server = createServer(app);

  server.listen(config.server.port, () => {
    console.log(`MCP server running at http://localhost:${config.server.port}`);
    console.log(`  MCP endpoint: http://localhost:${config.server.port}/mcp`);
    console.log(`  Health:       http://localhost:${config.server.port}/health`);
  });
}

main().catch(console.error);
