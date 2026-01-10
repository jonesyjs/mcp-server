#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Installs MCP Server and ngrok as Windows services using NSSM.

.DESCRIPTION
    This script installs:
    - mcp-server: The MCP server running on port 8223
    - mcp-ngrok: ngrok tunnel exposing the MCP server

.NOTES
    Requires NSSM (Non-Sucking Service Manager) to be installed.
    Download from: https://nssm.cc/download
#>

param(
    [string]$NssmPath = "nssm",
    [string]$McpServerPath = (Resolve-Path "$PSScriptRoot\..\..\"),
    [string]$NgrokAuthToken = $env:NGROK_AUTHTOKEN
)

$ErrorActionPreference = "Stop"

# Verify NSSM is available
try {
    & $NssmPath version | Out-Null
} catch {
    Write-Error @"
NSSM not found. Please install it:
  1. Download from https://nssm.cc/download
  2. Extract and add to PATH, or specify -NssmPath parameter
"@
    exit 1
}

# Get paths
$NodePath = (Get-Command node).Source
$NpxPath = (Get-Command npx).Source
$NgrokPath = try { (Get-Command ngrok).Source } catch { $null }

Write-Host "Configuration:" -ForegroundColor Cyan
Write-Host "  MCP Server Path: $McpServerPath"
Write-Host "  Node Path: $NodePath"
Write-Host "  Npx Path: $NpxPath"
Write-Host "  Ngrok Path: $NgrokPath"
Write-Host ""

# --- MCP Server Service ---
Write-Host "Installing mcp-server service..." -ForegroundColor Yellow

# Remove existing service if present
& $NssmPath stop mcp-server 2>$null
& $NssmPath remove mcp-server confirm 2>$null

# Install service
& $NssmPath install mcp-server $NpxPath "tsx src/index.ts"
& $NssmPath set mcp-server AppDirectory $McpServerPath
& $NssmPath set mcp-server DisplayName "MCP Server"
& $NssmPath set mcp-server Description "Model Context Protocol server with wake plugin"
& $NssmPath set mcp-server Start SERVICE_AUTO_START
& $NssmPath set mcp-server AppStdout "$McpServerPath\logs\mcp-server.log"
& $NssmPath set mcp-server AppStderr "$McpServerPath\logs\mcp-server.error.log"
& $NssmPath set mcp-server AppRotateFiles 1
& $NssmPath set mcp-server AppRotateBytes 1048576

# Create logs directory
New-Item -ItemType Directory -Path "$McpServerPath\logs" -Force | Out-Null

Write-Host "  mcp-server service installed" -ForegroundColor Green

# --- Ngrok Service ---
Write-Host "Installing mcp-ngrok service..." -ForegroundColor Yellow

if (-not $NgrokPath) {
    Write-Warning "ngrok not found in PATH. Skipping ngrok service installation."
    Write-Warning "Install ngrok and run this script again, or install manually."
} else {
    # Remove existing service if present
    & $NssmPath stop mcp-ngrok 2>$null
    & $NssmPath remove mcp-ngrok confirm 2>$null

    # Install service
    & $NssmPath install mcp-ngrok $NgrokPath "http 8223 --log stdout"
    & $NssmPath set mcp-ngrok DisplayName "MCP Ngrok Tunnel"
    & $NssmPath set mcp-ngrok Description "Ngrok tunnel for MCP server remote access"
    & $NssmPath set mcp-ngrok Start SERVICE_AUTO_START
    & $NssmPath set mcp-ngrok AppStdout "$McpServerPath\logs\ngrok.log"
    & $NssmPath set mcp-ngrok AppStderr "$McpServerPath\logs\ngrok.error.log"
    & $NssmPath set mcp-ngrok AppRotateFiles 1
    & $NssmPath set mcp-ngrok AppRotateBytes 1048576

    # Set ngrok auth token if provided
    if ($NgrokAuthToken) {
        & $NssmPath set mcp-ngrok AppEnvironmentExtra "NGROK_AUTHTOKEN=$NgrokAuthToken"
    }

    Write-Host "  mcp-ngrok service installed" -ForegroundColor Green
}

Write-Host ""
Write-Host "Installation complete!" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Start services:"
Write-Host "       nssm start mcp-server"
Write-Host "       nssm start mcp-ngrok"
Write-Host ""
Write-Host "  2. Set up auto-deploy (optional):"
Write-Host "       .\setup-scheduled-task.ps1"
Write-Host ""
Write-Host "  3. Check status:"
Write-Host "       nssm status mcp-server"
Write-Host "       nssm status mcp-ngrok"
