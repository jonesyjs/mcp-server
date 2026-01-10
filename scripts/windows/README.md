# Windows Native Deployment

Run MCP Server as Windows services with auto-deploy from GitHub.

## Prerequisites

1. **NSSM** (Non-Sucking Service Manager)
   - Download: https://nssm.cc/download
   - Extract and add to PATH (or place in `C:\Windows\System32`)

2. **ngrok** (for remote access)
   - Download: https://ngrok.com/download
   - Add to PATH
   - Configure auth: `ngrok config add-authtoken YOUR_TOKEN`

3. **Node.js** (already installed)

## Quick Start

```powershell
# Run as Administrator
cd C:\Users\simon\OneDrive\Desktop\Projects\mcp-server\scripts\windows

# 1. Install services
.\install-services.ps1

# 2. Start services
nssm start mcp-server
nssm start mcp-ngrok

# 3. (Optional) Set up auto-deploy
.\setup-scheduled-task.ps1
```

## What Gets Installed

| Component | Type | Description |
|-----------|------|-------------|
| `mcp-server` | Windows Service | MCP server on port 8223 |
| `mcp-ngrok` | Windows Service | ngrok tunnel for remote access |
| `MCP Server Auto-Deploy` | Scheduled Task | Checks for updates every 5 min |

## Services

### mcp-server

The MCP server with wake plugin, personas, etc.

```powershell
nssm start mcp-server    # Start
nssm stop mcp-server     # Stop
nssm restart mcp-server  # Restart
nssm status mcp-server   # Check status
nssm edit mcp-server     # Edit configuration (GUI)
```

### mcp-ngrok

ngrok tunnel exposing port 8223 to the internet.

```powershell
nssm start mcp-ngrok
nssm stop mcp-ngrok
nssm status mcp-ngrok
```

**Note:** ngrok is NOT restarted during deploys to preserve the tunnel URL.

## Auto-Deploy

The scheduled task runs `mcp-deploy.ps1` every 5 minutes:

1. Fetches from GitHub
2. Compares local vs remote HEAD
3. If different: pulls, runs `npm install`, restarts `mcp-server`
4. If same: does nothing

### Manual Deploy

```powershell
# Check and deploy now
.\mcp-deploy.ps1

# Force deploy (even if no changes)
.\mcp-deploy.ps1 -Force
```

### View Deploy Logs

```powershell
Get-Content ..\logs\deploy.log -Tail 50
```

## Logs

All logs are in the `logs` folder:

| File | Description |
|------|-------------|
| `mcp-server.log` | MCP server stdout |
| `mcp-server.error.log` | MCP server stderr |
| `ngrok.log` | ngrok stdout |
| `ngrok.error.log` | ngrok stderr |
| `deploy.log` | Auto-deploy activity |

## Uninstall

```powershell
# Run as Administrator
.\uninstall-services.ps1
```

## Troubleshooting

### Service won't start

Check logs:
```powershell
Get-Content ..\logs\mcp-server.error.log -Tail 20
```

### Port 8223 in use

Find and kill the process:
```powershell
netstat -ano | findstr :8223
taskkill /F /PID <pid>
```

### ngrok tunnel URL changed

The URL changes when ngrok restarts. To get the current URL:
```powershell
Invoke-RestMethod http://localhost:4040/api/tunnels | Select -Expand tunnels | Select public_url
```

Or visit: http://localhost:4040

### NSSM not found

Add NSSM to PATH or specify full path:
```powershell
.\install-services.ps1 -NssmPath "C:\path\to\nssm.exe"
```
