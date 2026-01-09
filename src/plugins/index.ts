import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Config, PluginConfig } from "../config.js";
import { registerPersonas } from "./personas.js";
import { registerGtasks } from "./gtasks.js";
import { registerWake } from "./wake.js";

type PluginRegistrar = (mcp: McpServer, config: PluginConfig) => void;

const plugins: Record<string, PluginRegistrar> = {
  personas: registerPersonas,
  gtasks: registerGtasks,
  wake: registerWake,
};

export function loadPlugins(mcp: McpServer, config: Config): void {
  for (const [name, pluginConfig] of Object.entries(config.plugins)) {
    if (!pluginConfig.enabled) {
      console.log(`Plugin '${name}' is disabled, skipping`);
      continue;
    }

    const registrar = plugins[name];
    if (!registrar) {
      console.warn(`Unknown plugin '${name}', skipping`);
      continue;
    }

    console.log(`Loading plugin '${name}'...`);
    registrar(mcp, pluginConfig);
  }
}
