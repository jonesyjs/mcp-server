import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig } from "./config.js";
import { createMcpServer } from "./mcp.js";
import { loadPlugins } from "./plugins/index.js";
import authRouter, { requireAuth } from "./auth.js";

async function main() {
  // Load configuration
  const config = loadConfig();
  console.log(`Starting ${config.server.name} on port ${config.server.port}`);

  // Create MCP server
  const mcp = createMcpServer(config);

  // Load plugins
  loadPlugins(mcp, config);

  // Create Express app
  const app = express();
  app.set("trust proxy", true); // Trust Cloudflare proxy headers
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Health check (no auth)
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", name: config.server.name });
  });

  // OAuth endpoints
  app.use(authRouter);

  // MCP endpoint (with auth)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  app.post("/mcp", requireAuth, async (req, res) => {
    try {
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP request error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Handle SSE for streaming (with auth)
  app.get("/mcp", requireAuth, async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    await transport.handleRequest(req, res);
  });

  // Connect transport to MCP server
  await mcp.connect(transport);

  // Start server
  app.listen(config.server.port, () => {
    console.log(`MCP server running at http://localhost:${config.server.port}`);
    console.log(`MCP endpoint: http://localhost:${config.server.port}/mcp`);
    console.log(`OAuth enabled - set AUTH_PASSWORD and CLIENT_SECRET env vars`);
  });
}

main().catch(console.error);
