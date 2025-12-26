import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Config } from "./config.js";

export function createMcpServer(config: Config): McpServer {
  return new McpServer({
    name: config.server.name,
    version: "1.0.0",
  });
}

