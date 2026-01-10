#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Installs MCP Server and ngrok as scheduled tasks (runs on startup).

.DESCRIPTION
    Creates two scheduled tasks:
    - MCP Server: Runs on startup, keeps running
    - MCP Ngrok: Runs on startup, keeps running
#>

$ErrorActionPreference = "Stop"

$McpServerPath = Resolve-Path "$PSScriptRoot\..\.."
$LogPath = "$McpServerPath\logs"
$NgrokPath = "C:\Users\simon\bin\ngrok.exe"
$NodePath = (Get-Command node -ErrorAction Stop).Source

Write-Host "Setting up MCP Server via Task Scheduler" -ForegroundColor Cyan
Write-Host "  Server Path: $McpServerPath"
Write-Host "  Log Path: $LogPath"
Write-Host "  Node Path: $NodePath"
Write-Host ""

# Create logs directory
New-Item -ItemType Directory -Path $LogPath -Force | Out-Null

# --- Remove existing tasks ---
Write-Host "Removing existing tasks..." -ForegroundColor Yellow
Unregister-ScheduledTask -TaskName "MCP Server" -Confirm:$false -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "MCP Ngrok" -Confirm:$false -ErrorAction SilentlyContinue

# --- MCP Server Task ---
Write-Host "Creating MCP Server task..." -ForegroundColor Yellow

# Use cmd.exe to run in the right directory
$mcpAction = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c cd /d `"$McpServerPath`" && npx tsx src/index.ts"

$mcpTrigger = New-ScheduledTaskTrigger -AtStartup

$mcpSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Days 9999)

Register-ScheduledTask `
    -TaskName "MCP Server" `
    -Action $mcpAction `
    -Trigger $mcpTrigger `
    -Settings $mcpSettings `
    -User "SYSTEM" `
    -RunLevel Highest `
    -Description "MCP Server on port 8223" `
    -Force | Out-Null

Write-Host "  MCP Server task created" -ForegroundColor Green

# --- Ngrok Task ---
Write-Host "Creating MCP Ngrok task..." -ForegroundColor Yellow

$ngrokAction = New-ScheduledTaskAction `
    -Execute $NgrokPath `
    -Argument "http 8223"

$ngrokTrigger = New-ScheduledTaskTrigger -AtStartup

$ngrokSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Days 9999)

Register-ScheduledTask `
    -TaskName "MCP Ngrok" `
    -Action $ngrokAction `
    -Trigger $ngrokTrigger `
    -Settings $ngrokSettings `
    -User "SYSTEM" `
    -RunLevel Highest `
    -Description "Ngrok tunnel for MCP server" `
    -Force | Out-Null

Write-Host "  MCP Ngrok task created" -ForegroundColor Green

Write-Host ""
Write-Host "Installation complete!" -ForegroundColor Cyan
Write-Host ""
Write-Host "Starting tasks now..." -ForegroundColor Yellow
Start-ScheduledTask -TaskName "MCP Server"
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName "MCP Ngrok"
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "Status:" -ForegroundColor Cyan
Get-ScheduledTask -TaskName "MCP Server" | Select-Object TaskName, State
Get-ScheduledTask -TaskName "MCP Ngrok" | Select-Object TaskName, State

Write-Host ""
Write-Host "Commands:" -ForegroundColor Yellow
Write-Host "  Start:   Start-ScheduledTask -TaskName 'MCP Server'"
Write-Host "  Stop:    Stop-ScheduledTask -TaskName 'MCP Server'"
Write-Host "  Status:  Get-ScheduledTask -TaskName 'MCP Server'"
Write-Host ""
Write-Host "Get ngrok URL:" -ForegroundColor Yellow
Write-Host "  Invoke-RestMethod http://localhost:4040/api/tunnels | Select -Expand tunnels | Select public_url"
