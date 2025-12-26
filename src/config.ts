import { readFileSync } from "fs";
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

export function loadConfig(configPath = "config.yaml"): Config {
  const raw = readFileSync(configPath, "utf-8");
  const parsed = yaml.load(raw) as Config;
  return expandPaths(parsed) as Config;
}

