# Agent-Specs MCP Server

MCP server that serves your agent-specs (behavioral skills/personas) to ChatGPT, Claude, or any MCP-compatible client.

## Setup

```bash
npm install
```

## Configure

Edit `config.yaml` to point to your skills directory:

```yaml
plugins:
  personas:
    enabled: true
    skillsPath: ~/path/to/your/agent-specs/skills
```

## Run

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

## Connect to ChatGPT

1. Expose locally via ngrok:
   ```bash
   ngrok http 8223
   ```

2. In ChatGPT:
   - Settings → Apps → Advanced Settings → Enable Developer Mode
   - Add new connector with your ngrok URL + `/mcp`

## Available Tools

| Tool | Description |
|------|-------------|
| `list_personas()` | List all available thinking modes |
| `activate_persona(name)` | Load a persona's instructions |
| `get_component(name)` | Load shared components (tones, formats) |

## Adding Plugins

Create a new file in `src/plugins/` and register it in `src/plugins/index.ts`.

