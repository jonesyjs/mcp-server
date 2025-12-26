import { readFileSync, existsSync } from "fs";
import yaml from "js-yaml";
import { resolve } from "path";
import { homedir } from "os";

export interface PluginConfig {
  enabled: boolean;
  [key: string]: unknown;
}

export interface Config {
  server: {
    name: string;
    port: number;
  };
  plugins: Record<string, PluginConfig>;
}

function expandPath(path: string): string {
  if (path.startsWith("~")) {
    return path.replace("~", homedir());
  }
  return resolve(path);
}

function expandPaths(obj: unknown): unknown {
  if (typeof obj === "string") {
    return expandPath(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(expandPaths);
  }
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandPaths(value);
    }
    return result;
  }
  return obj;
}

function resolveConfigPath(): string {
  // Priority: CONFIG_PATH env > config.local.yaml > config.yaml
  if (process.env.CONFIG_PATH) {
    return process.env.CONFIG_PATH;
  }
  if (existsSync("config.local.yaml")) {
    return "config.local.yaml";
  }
  return "config.yaml";
}

export function loadConfig(configPath?: string): Config {
  const path = configPath ?? resolveConfigPath();
  console.log(`Loading config from: ${path}`);
  const raw = readFileSync(path, "utf-8");
  const parsed = yaml.load(raw) as Config;
  return expandPaths(parsed) as Config;
}

