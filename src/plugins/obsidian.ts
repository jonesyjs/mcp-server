import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PluginConfig } from "../config.js";
import { z } from "zod";

interface ObsidianClient {
  baseUrl: string;
  apiKey: string;
}

function createClient(config: PluginConfig): ObsidianClient {
  const baseUrl = (config.baseUrl as string) || "http://127.0.0.1:27123";
  const apiKey = config.apiKey as string;

  if (!apiKey) {
    throw new Error("Obsidian API key not configured. Set 'apiKey' in obsidian plugin config.");
  }

  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey };
}

async function request(
  client: ObsidianClient,
  method: string,
  path: string,
  body?: string,
  headers?: Record<string, string>
): Promise<Response> {
  const url = `${client.baseUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${client.apiKey}`,
      "Content-Type": "text/markdown",
      ...headers,
    },
    body,
  });
  return res;
}

interface ReadResult {
  path: string;
  content: string;
  frontmatter: Record<string, unknown>;
  exists: boolean;
  error?: string;
}

interface ListEntry {
  name: string;
  type: "file" | "folder";
}

interface ListResult {
  path: string;
  entries: ListEntry[];
  error?: string;
}

interface SearchMatch {
  path: string;
  matches: string[];
}

interface SearchResult {
  query: string;
  results: SearchMatch[];
  error?: string;
}

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  try {
    const yaml = match[1];
    const body = match[2];
    const frontmatter: Record<string, unknown> = {};

    for (const line of yaml.split("\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        frontmatter[key] = value;
      }
    }

    return { frontmatter, body };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

export function registerObsidian(mcp: McpServer, config: PluginConfig): void {
  const client = createClient(config);

  // Read a note
  mcp.tool(
    "obsidian_read",
    "Read a note from the Obsidian vault. Returns content and frontmatter.",
    {
      path: z.string().describe("Path to note relative to vault root, e.g. 'mcp/obsidian-plugin/spec.md'"),
    },
    async ({ path }): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const res = await request(client, "GET", `/vault/${encodeURIComponent(path)}`);

      if (res.status === 404) {
        const result: ReadResult = {
          path,
          content: "",
          frontmatter: {},
          exists: false,
          error: "Note not found",
        };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      if (!res.ok) {
        const error = await res.text();
        return {
          content: [{ type: "text", text: JSON.stringify({ path, error: `API error: ${error}` }, null, 2) }],
        };
      }

      const text = await res.text();
      const { frontmatter, body } = parseFrontmatter(text);

      const result: ReadResult = {
        path,
        frontmatter,
        content: body,
        exists: true,
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // Write a note
  mcp.tool(
    "obsidian_write",
    "Create or overwrite a note in the Obsidian vault. Creates parent directories if needed.",
    {
      path: z.string().describe("Path to note relative to vault root"),
      content: z.string().describe("Full content including frontmatter"),
    },
    async ({ path, content }): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      // Check if note exists first to determine if we're creating or updating
      const checkRes = await request(client, "GET", `/vault/${encodeURIComponent(path)}`);
      const isCreating = checkRes.status === 404;

      const res = await request(client, "PUT", `/vault/${encodeURIComponent(path)}`, content);

      if (!res.ok) {
        const error = await res.text();
        return {
          content: [{ type: "text", text: JSON.stringify({ path, error: `API error: ${error}` }, null, 2) }],
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ path, created: isCreating }, null, 2) }],
      };
    }
  );

  // Append to a note
  mcp.tool(
    "obsidian_append",
    "Append content to an existing note. Fails if note doesn't exist.",
    {
      path: z.string().describe("Path to note relative to vault root"),
      content: z.string().describe("Content to append"),
    },
    async ({ path, content }): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      // Check if note exists
      const checkRes = await request(client, "GET", `/vault/${encodeURIComponent(path)}`);
      if (checkRes.status === 404) {
        return {
          content: [{ type: "text", text: JSON.stringify({ path, error: "Note not found" }, null, 2) }],
        };
      }

      const res = await request(
        client,
        "POST",
        `/vault/${encodeURIComponent(path)}`,
        content,
        { "Content-Insertion-Position": "end" }
      );

      if (!res.ok) {
        const error = await res.text();
        return {
          content: [{ type: "text", text: JSON.stringify({ path, error: `API error: ${error}` }, null, 2) }],
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ path, appended: true }, null, 2) }],
      };
    }
  );

  // List notes in a directory
  mcp.tool(
    "obsidian_list",
    "List notes and folders in a directory.",
    {
      path: z.string().describe("Directory path relative to vault root. Empty string for root."),
      recursive: z.boolean().optional().describe("Include subdirectories"),
    },
    async ({ path, recursive = false }): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      // The Obsidian REST API lists directory contents when path ends with /
      const dirPath = path === "" ? "/" : `/${path}/`;
      const res = await request(client, "GET", `/vault${dirPath}`);

      if (res.status === 404) {
        return {
          content: [{ type: "text", text: JSON.stringify({ path, error: "Directory not found" }, null, 2) }],
        };
      }

      if (!res.ok) {
        const error = await res.text();
        return {
          content: [{ type: "text", text: JSON.stringify({ path, error: `API error: ${error}` }, null, 2) }],
        };
      }

      const data = await res.json();
      const files: string[] = data.files || [];

      // Process the file list
      const entries: ListEntry[] = [];
      const seenFolders = new Set<string>();

      for (const filePath of files) {
        // Get relative path from the requested directory
        const relativePath = path === "" ? filePath : filePath.replace(`${path}/`, "");

        if (!recursive) {
          // For non-recursive, we need to extract just the immediate children
          const parts = relativePath.split("/");
          if (parts.length === 1) {
            // Direct file
            entries.push({ name: parts[0], type: "file" });
          } else {
            // Folder - add only if not already seen
            const folderName = parts[0];
            if (!seenFolders.has(folderName)) {
              seenFolders.add(folderName);
              entries.push({ name: folderName, type: "folder" });
            }
          }
        } else {
          // For recursive, just list all files
          entries.push({ name: relativePath, type: "file" });
        }
      }

      const result: ListResult = { path, entries };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // Search vault
  mcp.tool(
    "obsidian_search",
    "Search for text across the vault.",
    {
      query: z.string().describe("Search text"),
      path: z.string().optional().describe("Limit search to this directory"),
    },
    async ({ query, path }): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const searchPath = path ? `/search/simple/?query=${encodeURIComponent(query)}&contextLength=100` : `/search/simple/?query=${encodeURIComponent(query)}&contextLength=100`;

      const res = await request(client, "POST", searchPath, query);

      if (!res.ok) {
        const error = await res.text();
        return {
          content: [{ type: "text", text: JSON.stringify({ query, error: `API error: ${error}` }, null, 2) }],
        };
      }

      const data = await res.json();
      const results: SearchMatch[] = [];

      // The API returns an array of matches
      for (const item of data) {
        const filePath = item.filename || item.path || "";

        // If path filter is specified, skip files outside that path
        if (path && !filePath.startsWith(path)) {
          continue;
        }

        const matches: string[] = [];
        if (item.matches) {
          for (const match of item.matches) {
            if (match.match) {
              // Extract context around the match
              const context = match.match.slice(0, 200);
              matches.push(context);
            }
          }
        }

        if (matches.length > 0 || !item.matches) {
          results.push({ path: filePath, matches });
        }
      }

      const result: SearchResult = { query, results };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // Delete a note
  mcp.tool(
    "obsidian_delete",
    "Delete a note from the Obsidian vault.",
    {
      path: z.string().describe("Path to note relative to vault root"),
    },
    async ({ path }): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const res = await request(client, "DELETE", `/vault/${encodeURIComponent(path)}`);

      if (res.status === 404) {
        return {
          content: [{ type: "text", text: JSON.stringify({ path, error: "Note not found" }, null, 2) }],
        };
      }

      if (!res.ok) {
        const error = await res.text();
        return {
          content: [{ type: "text", text: JSON.stringify({ path, error: `API error: ${error}` }, null, 2) }],
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ path, deleted: true }, null, 2) }],
      };
    }
  );

  // Move/rename a note
  mcp.tool(
    "obsidian_move",
    "Move or rename a note in the Obsidian vault.",
    {
      from: z.string().describe("Current path to note relative to vault root"),
      to: z.string().describe("New path for the note relative to vault root"),
    },
    async ({ from, to }): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      // Read the source note
      const readRes = await request(client, "GET", `/vault/${encodeURIComponent(from)}`);

      if (readRes.status === 404) {
        return {
          content: [{ type: "text", text: JSON.stringify({ from, to, error: "Source note not found" }, null, 2) }],
        };
      }

      if (!readRes.ok) {
        const error = await readRes.text();
        return {
          content: [{ type: "text", text: JSON.stringify({ from, to, error: `API error: ${error}` }, null, 2) }],
        };
      }

      const content = await readRes.text();

      // Write to new location
      const writeRes = await request(client, "PUT", `/vault/${encodeURIComponent(to)}`, content);

      if (!writeRes.ok) {
        const error = await writeRes.text();
        return {
          content: [{ type: "text", text: JSON.stringify({ from, to, error: `Failed to write: ${error}` }, null, 2) }],
        };
      }

      // Delete the original
      const deleteRes = await request(client, "DELETE", `/vault/${encodeURIComponent(from)}`);

      if (!deleteRes.ok) {
        const error = await deleteRes.text();
        return {
          content: [{ type: "text", text: JSON.stringify({ from, to, error: `Moved but failed to delete original: ${error}` }, null, 2) }],
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ from, to, moved: true }, null, 2) }],
      };
    }
  );

  // Get backlinks
  mcp.tool(
    "obsidian_backlinks",
    "Get notes that link to a specific note.",
    {
      path: z.string().describe("Path to note relative to vault root"),
    },
    async ({ path }): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      // Extract the note name without extension for link matching
      const noteName = path.replace(/\.md$/, "").split("/").pop() || "";

      // Search for [[noteName]] or [[path]] patterns
      const searchRes = await request(
        client,
        "POST",
        `/search/simple/?query=${encodeURIComponent(`[[${noteName}]]`)}&contextLength=100`
      );

      if (!searchRes.ok) {
        const error = await searchRes.text();
        return {
          content: [{ type: "text", text: JSON.stringify({ path, error: `API error: ${error}` }, null, 2) }],
        };
      }

      const data = await searchRes.json();
      const backlinks: string[] = [];

      for (const item of data) {
        const filePath = item.filename || item.path || "";
        // Don't include the note itself
        if (filePath !== path && !backlinks.includes(filePath)) {
          backlinks.push(filePath);
        }
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ path, backlinks }, null, 2) }],
      };
    }
  );

  // Get/set frontmatter
  mcp.tool(
    "obsidian_frontmatter",
    "Get or set frontmatter fields on a note.",
    {
      path: z.string().describe("Path to note relative to vault root"),
      operation: z.enum(["get", "set", "delete"]).describe("Operation to perform"),
      key: z.string().describe("Frontmatter key to get/set/delete"),
      value: z.string().optional().describe("Value to set (required for 'set' operation)"),
    },
    async ({ path, operation, key, value }): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      // Read the note
      const readRes = await request(client, "GET", `/vault/${encodeURIComponent(path)}`);

      if (readRes.status === 404) {
        return {
          content: [{ type: "text", text: JSON.stringify({ path, error: "Note not found" }, null, 2) }],
        };
      }

      if (!readRes.ok) {
        const error = await readRes.text();
        return {
          content: [{ type: "text", text: JSON.stringify({ path, error: `API error: ${error}` }, null, 2) }],
        };
      }

      const text = await readRes.text();
      const { frontmatter, body } = parseFrontmatter(text);

      if (operation === "get") {
        return {
          content: [{ type: "text", text: JSON.stringify({ path, key, value: frontmatter[key] ?? null }, null, 2) }],
        };
      }

      if (operation === "set") {
        if (value === undefined) {
          return {
            content: [{ type: "text", text: JSON.stringify({ path, error: "Value required for 'set' operation" }, null, 2) }],
          };
        }
        frontmatter[key] = value;
      } else if (operation === "delete") {
        delete frontmatter[key];
      }

      // Rebuild the content with updated frontmatter
      const yamlLines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`);
      const newContent = yamlLines.length > 0
        ? `---\n${yamlLines.join("\n")}\n---\n${body}`
        : body;

      const writeRes = await request(client, "PUT", `/vault/${encodeURIComponent(path)}`, newContent);

      if (!writeRes.ok) {
        const error = await writeRes.text();
        return {
          content: [{ type: "text", text: JSON.stringify({ path, error: `Failed to update: ${error}` }, null, 2) }],
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ path, operation, key, success: true }, null, 2) }],
      };
    }
  );

  console.log("Obsidian plugin loaded");
}
