# MCP Server

MCP server that serves personas/skills to ChatGPT, Claude, or any MCP-compatible client.

## Quick Start

```bash
npm install
npm run dev
```

Create `config.local.yaml` to set your skills path:

```yaml
plugins:
  personas:
    enabled: true
    skillsPath: ~/path/to/your/skills
```

## Expose via ngrok

```bash
ngrok http 8223
```

Your MCP endpoint: `https://YOUR_NGROK_URL/mcp`

## Connect to ChatGPT

1. Settings → Apps → Advanced settings → Create app
2. Name: MCP Server
3. MCP Server URL: `https://YOUR_NGROK_URL/mcp`
4. Authentication: No Auth
5. Create

## Available Tools

| Tool | Description |
|------|-------------|
| `list_personas()` | List all available personas |
| `activate_persona(name)` | Load a persona's instructions |
| `get_component(name)` | Load shared components |
