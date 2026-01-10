#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Removes MCP Server Windows services and scheduled task.

.DESCRIPTION
    Stops and removes:
    - mcp-server service
    - mcp-ngrok service
    - MCP Server Auto-Deploy scheduled task
#>

param(
    [string]$NssmPath = "nssm"
)

$ErrorActionPreference = "Continue"

Write-Host "Removing MCP Server Windows deployment..." -ForegroundColor Cyan
Write-Host ""

# Remove scheduled task
Write-Host "Removing scheduled task..." -ForegroundColor Yellow
Unregister-ScheduledTask -TaskName "MCP Server Auto-Deploy" -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "  Scheduled task removed" -ForegroundColor Green

# Remove mcp-server service
Write-Host "Removing mcp-server service..." -ForegroundColor Yellow
& $NssmPath stop mcp-server 2>$null
& $NssmPath remove mcp-server confirm 2>$null
Write-Host "  mcp-server service removed" -ForegroundColor Green

# Remove mcp-ngrok service
Write-Host "Removing mcp-ngrok service..." -ForegroundColor Yellow
& $NssmPath stop mcp-ngrok 2>$null
& $NssmPath remove mcp-ngrok confirm 2>$null
Write-Host "  mcp-ngrok service removed" -ForegroundColor Green

Write-Host ""
Write-Host "Uninstall complete!" -ForegroundColor Cyan
Write-Host ""
Write-Host "Note: Log files in the 'logs' folder were not removed." -ForegroundColor Yellow
