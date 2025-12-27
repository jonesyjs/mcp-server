# Agent-Specs MCP Server

MCP server that serves your agent-specs (behavioral skills/personas) to ChatGPT, Claude, or any MCP-compatible client.

## Quick Start (Local)

```bash
npm install
npm run dev
```

Create `config.local.yaml` to override the default config:

```yaml
plugins:
  personas:
    enabled: true
    skillsPath: ~/path/to/your/skills
```

## Docker + Cloudflare Tunnel (Recommended)

### 1. Set up Cloudflare Tunnel

1. Go to [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/)
2. Navigate to: **Networks → Tunnels → Create a tunnel**
3. Name it `mcp-server`
4. Copy the tunnel token

### 2. Configure

Create `.env` file:

```bash
CLOUDFLARE_TUNNEL_TOKEN=your_token_here
AUTH_PASSWORD=your_secret_password
CLIENT_SECRET=your_client_secret
```

In Cloudflare dashboard, add a public hostname:
- Subdomain: `mcp` (or whatever you want)
- Domain: your domain
- Service: `http://mcp-server:8223`

### 3. Run

```bash
docker compose up -d
```

Your MCP endpoint: `https://mcp.yourdomain.com/mcp`

## Development

```bash
# Auto-reload on file changes
npm run dev

# Expose via ngrok (alternative to Cloudflare)
ngrok http 8223
```

Config priority:
1. `CONFIG_PATH` env var
2. `config.local.yaml` (if exists)
3. `config.yaml`

## Available Tools

| Tool | Description |
|------|-------------|
| `list_personas()` | List all available thinking modes |
| `activate_persona(name)` | Load a persona's instructions |
| `get_component(name)` | Load shared components (tones, formats) |

## Connect to ChatGPT

1. Settings → Apps → Advanced Settings → Enable Developer Mode
2. Add new MCP connector:
   - **Name:** Agent Specs
   - **MCP Server URL:** `https://mcp.yourdomain.com/mcp`
   - **Authentication:** OAuth
   - **Authorization URL:** `https://mcp.yourdomain.com/authorize`
   - **Token URL:** `https://mcp.yourdomain.com/token`
   - **Client ID:** `chatgpt` (or anything)
   - **Client Secret:** (same as `CLIENT_SECRET` in your `.env`)
3. Click Connect, enter your password when prompted

## Adding Plugins

Create a new file in `src/plugins/` and register it in `src/plugins/index.ts`.
