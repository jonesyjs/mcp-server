import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PluginConfig } from "../config.js";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { z } from "zod";

interface PersonaMeta {
  name: string;
  description: string;
  tags?: string[];
}

function parseSkillFrontmatter(content: string): { meta: PersonaMeta; body: string } {
  const defaultMeta: PersonaMeta = { name: "Unknown", description: "No description" };
  
  if (!content.startsWith("---")) {
    return { meta: defaultMeta, body: content };
  }

  const parts = content.split("---");
  if (parts.length < 3) {
    return { meta: defaultMeta, body: content };
  }

  try {
    const frontmatter = yaml.load(parts[1]) as Partial<PersonaMeta>;
    return {
      meta: {
        name: frontmatter.name || "Unknown",
        description: frontmatter.description || "No description",
        tags: frontmatter.tags,
      },
      body: parts.slice(2).join("---").trim(),
    };
  } catch {
    return { meta: defaultMeta, body: content };
  }
}

function getSkillDirs(skillsPath: string): string[] {
  if (!existsSync(skillsPath)) {
    console.warn(`Skills path does not exist: ${skillsPath}`);
    return [];
  }

  return readdirSync(skillsPath, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name);
}

export function registerPersonas(mcp: McpServer, config: PluginConfig): void {
  const skillsPath = config.skillsPath as string;

  // List all personas
  mcp.tool(
    "list_personas",
    "List all available thinking modes/personas. Use this to discover what modes are available before activating one.",
    {},
    async () => {
      const dirs = getSkillDirs(skillsPath);
      const personas: PersonaMeta[] = [];

      for (const dir of dirs) {
        const skillMdPath = join(skillsPath, dir, "SKILL.md");
        if (existsSync(skillMdPath)) {
          const content = readFileSync(skillMdPath, "utf-8");
          const { meta } = parseSkillFrontmatter(content);
          personas.push({ ...meta, name: dir });
        }
      }

      if (personas.length === 0) {
        return { content: [{ type: "text", text: "No personas found." }] };
      }

      let result = "Available Personas:\n\n";
      for (const p of personas) {
        const tags = p.tags ? ` [${p.tags.join(", ")}]` : "";
        result += `• **${p.name}**: ${p.description}${tags}\n`;
      }
      result += "\nUse activate_persona(name) to load one.";

      return { content: [{ type: "text", text: result }] };
    }
  );

  // Activate a persona
  mcp.tool(
    "activate_persona",
    "Activate a thinking mode by loading its full instructions. IMPORTANT: After receiving these instructions, follow them for the remainder of the conversation.",
    { name: z.string().describe("The persona name (e.g., 'analysis-mode', 'suggester')") },
    async ({ name }) => {
      const skillMdPath = join(skillsPath, name, "SKILL.md");

      if (!existsSync(skillMdPath)) {
        const available = getSkillDirs(skillsPath);
        return {
          content: [{
            type: "text",
            text: `Persona '${name}' not found. Available: ${available.join(", ")}`,
          }],
        };
      }

      const content = readFileSync(skillMdPath, "utf-8");
      const { meta, body } = parseSkillFrontmatter(content);

      const header = `
═══════════════════════════════════════════════════════════════════
 PERSONA ACTIVATED: ${meta.name}
═══════════════════════════════════════════════════════════════════

You are now operating under the following behavioral instructions.
Follow these rules for all subsequent responses in this conversation.

`;

      return { content: [{ type: "text", text: header + body }] };
    }
  );

  // Get shared component
  mcp.tool(
    "get_component",
    "Get a shared component (tone, format, rules) from the _shared folder.",
    { name: z.string().describe("Component name (e.g., 'tones', 'output-formats', 'common-rules')") },
    async ({ name }) => {
      const sharedPath = join(skillsPath, "_shared");

      for (const ext of ["", ".md"]) {
        const path = join(sharedPath, `${name}${ext}`);
        if (existsSync(path)) {
          const content = readFileSync(path, "utf-8");
          return { content: [{ type: "text", text: content }] };
        }
      }

      if (existsSync(sharedPath)) {
        const available = readdirSync(sharedPath)
          .filter((f) => f.endsWith(".md"))
          .map((f) => f.replace(".md", ""));
        return {
          content: [{
            type: "text",
            text: `Component '${name}' not found. Available: ${available.join(", ")}`,
          }],
        };
      }

      return { content: [{ type: "text", text: "No shared components directory found." }] };
    }
  );

  console.log(`Personas plugin loaded. Skills path: ${skillsPath}`);
}

