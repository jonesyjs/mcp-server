<#
.SYNOPSIS
    Checks for MCP server updates and deploys if changes detected.

.DESCRIPTION
    This script:
    1. Fetches latest changes from git remote
    2. Compares local HEAD with remote
    3. If different: pulls changes, runs npm install, restarts mcp-server service
    4. If same: does nothing

    Only restarts mcp-server, never ngrok (to preserve tunnel URL).

.NOTES
    Run via scheduled task every 5 minutes for auto-deploy.
#>

param(
    [string]$RepoPath = (Resolve-Path "$PSScriptRoot\..\..\"),
    [string]$LogFile = "$RepoPath\logs\deploy.log",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"

    # Ensure log directory exists
    $logDir = Split-Path $LogFile -Parent
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }

    Add-Content -Path $LogFile -Value $logMessage

    switch ($Level) {
        "ERROR" { Write-Host $logMessage -ForegroundColor Red }
        "WARN"  { Write-Host $logMessage -ForegroundColor Yellow }
        "SUCCESS" { Write-Host $logMessage -ForegroundColor Green }
        default { Write-Host $logMessage }
    }
}

try {
    Set-Location $RepoPath
    Write-Log "Starting deploy check in $RepoPath"

    # Fetch latest from remote
    Write-Log "Fetching from origin..."
    $fetchOutput = git fetch origin main 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Git fetch failed: $fetchOutput"
    }

    # Get local and remote HEADs
    $localHead = git rev-parse HEAD
    $remoteHead = git rev-parse origin/main

    Write-Log "Local HEAD:  $localHead"
    Write-Log "Remote HEAD: $remoteHead"

    if ($localHead -eq $remoteHead -and -not $Force) {
        Write-Log "No changes detected. Skipping deploy."
        exit 0
    }

    if ($Force) {
        Write-Log "Force flag set. Deploying regardless of changes." -Level "WARN"
    } else {
        Write-Log "Changes detected! Starting deploy..." -Level "WARN"
    }

    # Pull changes
    Write-Log "Pulling changes..."
    $pullOutput = git pull origin main 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Git pull failed: $pullOutput"
    }
    Write-Log "Pull complete: $pullOutput"

    # Install dependencies (in case package.json changed)
    Write-Log "Running npm install..."
    $npmOutput = npm install 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "npm install failed: $npmOutput"
    }
    Write-Log "npm install complete"

    # Restart mcp-server service (not ngrok!)
    Write-Log "Restarting mcp-server service..."

    # Try nssm first, fall back to net stop/start
    try {
        nssm restart mcp-server
    } catch {
        Write-Log "NSSM not available, trying net stop/start..." -Level "WARN"
        net stop mcp-server 2>$null
        Start-Sleep -Seconds 2
        net start mcp-server
    }

    Write-Log "Deploy complete!" -Level "SUCCESS"

} catch {
    Write-Log "Deploy failed: $_" -Level "ERROR"
    exit 1
}
