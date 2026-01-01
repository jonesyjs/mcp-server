import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PluginConfig } from "../config.js";
import { google, tasks_v1 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { readFileSync, existsSync } from "fs";
import { z } from "zod";

function getAuthClient(config: PluginConfig): OAuth2Client {
  const credsPath = config.credentialsPath as string;
  const tokenPath = config.tokenPath as string;

  if (!existsSync(credsPath)) {
    throw new Error(`OAuth credentials not found: ${credsPath}`);
  }
  if (!existsSync(tokenPath)) {
    throw new Error(`Token not found: ${tokenPath}. Run 'npm run gtasks-auth' first.`);
  }

  const credentials = JSON.parse(readFileSync(credsPath, "utf-8"));
  const token = JSON.parse(readFileSync(tokenPath, "utf-8"));

  const { client_id, client_secret } = credentials.installed || credentials.web;
  const oauth2Client = new google.auth.OAuth2(client_id, client_secret);
  oauth2Client.setCredentials(token);

  return oauth2Client;
}

export function registerGtasks(mcp: McpServer, config: PluginConfig): void {
  const auth = getAuthClient(config);
  const tasks = google.tasks({ version: "v1", auth });

  // List task lists
  mcp.tool(
    "gtasks_list_tasklists",
    "List all Google Tasks task lists",
    {},
    async () => {
      const res = await tasks.tasklists.list({ maxResults: 100 });
      const lists = res.data.items || [];

      if (lists.length === 0) {
        return { content: [{ type: "text", text: "No task lists found." }] };
      }

      let result = "Task Lists:\n\n";
      for (const list of lists) {
        result += `• **${list.title}** (id: ${list.id})\n`;
      }
      return { content: [{ type: "text", text: result }] };
    }
  );

  // List tasks in a list
  mcp.tool(
    "gtasks_list_tasks",
    "List tasks in a Google Tasks list",
    {
      taskListId: z.string().optional().describe("Task list ID (default: @default)"),
      showCompleted: z.boolean().optional().describe("Include completed tasks"),
    },
    async ({ taskListId = "@default", showCompleted = false }) => {
      const res = await tasks.tasks.list({
        tasklist: taskListId,
        showCompleted,
        showHidden: showCompleted,
        maxResults: 100,
      });

      const items = res.data.items || [];
      if (items.length === 0) {
        return { content: [{ type: "text", text: "No tasks found." }] };
      }

      let result = "Tasks:\n\n";
      for (const task of items) {
        const status = task.status === "completed" ? "✓" : "○";
        const due = task.due ? ` (due: ${task.due.split("T")[0]})` : "";
        result += `${status} **${task.title}**${due}\n`;
        result += `  id: ${task.id}\n`;
        if (task.notes) result += `  notes: ${task.notes}\n`;
      }
      return { content: [{ type: "text", text: result }] };
    }
  );

  // Create task
  mcp.tool(
    "gtasks_create_task",
    "Create a new task in Google Tasks",
    {
      title: z.string().describe("Task title"),
      notes: z.string().optional().describe("Task notes/description"),
      due: z.string().optional().describe("Due date (YYYY-MM-DD)"),
      taskListId: z.string().optional().describe("Task list ID (default: @default)"),
    },
    async ({ title, notes, due, taskListId = "@default" }) => {
      const requestBody: tasks_v1.Schema$Task = { title };
      if (notes) requestBody.notes = notes;
      if (due) requestBody.due = new Date(due).toISOString();

      const res = await tasks.tasks.insert({
        tasklist: taskListId,
        requestBody,
      });

      return {
        content: [{
          type: "text",
          text: `Created task: "${res.data.title}" (id: ${res.data.id})`,
        }],
      };
    }
  );

  // Update task
  mcp.tool(
    "gtasks_update_task",
    "Update an existing task",
    {
      taskId: z.string().describe("Task ID"),
      title: z.string().optional().describe("New title"),
      notes: z.string().optional().describe("New notes"),
      status: z.enum(["needsAction", "completed"]).optional().describe("Task status"),
      due: z.string().optional().describe("Due date (YYYY-MM-DD)"),
      taskListId: z.string().optional().describe("Task list ID (default: @default)"),
    },
    async ({ taskId, title, notes, status, due, taskListId = "@default" }) => {
      const current = await tasks.tasks.get({ tasklist: taskListId, task: taskId });

      const requestBody: tasks_v1.Schema$Task = { ...current.data };
      if (title !== undefined) requestBody.title = title;
      if (notes !== undefined) requestBody.notes = notes;
      if (status !== undefined) requestBody.status = status;
      if (due !== undefined) requestBody.due = new Date(due).toISOString();

      const res = await tasks.tasks.update({
        tasklist: taskListId,
        task: taskId,
        requestBody,
      });

      return {
        content: [{
          type: "text",
          text: `Updated task: "${res.data.title}"`,
        }],
      };
    }
  );

  // Delete task
  mcp.tool(
    "gtasks_delete_task",
    "Delete a task",
    {
      taskId: z.string().describe("Task ID"),
      taskListId: z.string().optional().describe("Task list ID (default: @default)"),
    },
    async ({ taskId, taskListId = "@default" }) => {
      await tasks.tasks.delete({ tasklist: taskListId, task: taskId });
      return { content: [{ type: "text", text: `Deleted task: ${taskId}` }] };
    }
  );

  // Clear completed tasks
  mcp.tool(
    "gtasks_clear_completed",
    "Clear all completed tasks from a list",
    {
      taskListId: z.string().optional().describe("Task list ID (default: @default)"),
    },
    async ({ taskListId = "@default" }) => {
      await tasks.tasks.clear({ tasklist: taskListId });
      return { content: [{ type: "text", text: "Cleared completed tasks." }] };
    }
  );

  console.log("Google Tasks plugin loaded");
}
