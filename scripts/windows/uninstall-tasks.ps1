#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Removes MCP Server scheduled tasks.
#>

Write-Host "Removing MCP Server scheduled tasks..." -ForegroundColor Cyan

# Stop tasks first
Stop-ScheduledTask -TaskName "MCP Server" -ErrorAction SilentlyContinue
Stop-ScheduledTask -TaskName "MCP Ngrok" -ErrorAction SilentlyContinue

# Kill any running processes
Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    $_.MainWindowTitle -eq ""
} | Stop-Process -Force -ErrorAction SilentlyContinue

Get-Process -Name "ngrok" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Remove tasks
Unregister-ScheduledTask -TaskName "MCP Server" -Confirm:$false -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "MCP Ngrok" -Confirm:$false -ErrorAction SilentlyContinue

Write-Host "Done!" -ForegroundColor Green
