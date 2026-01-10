#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Creates a scheduled task to run mcp-deploy.ps1 every 5 minutes.

.DESCRIPTION
    Sets up automatic deployment checking:
    - Runs every 5 minutes
    - Starts at system boot
    - Runs whether user is logged in or not
    - Catches up on missed runs
#>

param(
    [string]$TaskName = "MCP Server Auto-Deploy",
    [int]$IntervalMinutes = 5
)

$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "mcp-deploy.ps1"

if (-not (Test-Path $scriptPath)) {
    Write-Error "Deploy script not found at: $scriptPath"
    exit 1
}

Write-Host "Setting up scheduled task: $TaskName" -ForegroundColor Cyan
Write-Host "  Script: $scriptPath"
Write-Host "  Interval: Every $IntervalMinutes minutes"
Write-Host ""

# Remove existing task if present
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# Create trigger - every 5 minutes, indefinitely
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)

# Create action - run PowerShell with the deploy script
$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$scriptPath`"" `
    -WorkingDirectory $PSScriptRoot

# Settings
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable `
    -MultipleInstances IgnoreNew

# Register the task with SYSTEM account
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -User "SYSTEM" `
    -RunLevel Highest `
    -Description "Checks for MCP server updates and deploys if changes detected" `
    -Force | Out-Null

Write-Host "Scheduled task created successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Manage with:" -ForegroundColor Yellow
Write-Host "  View:    Get-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Run now: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Disable: Disable-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Remove:  Unregister-ScheduledTask -TaskName '$TaskName'"
