$scriptPath = "C:\Users\simon\OneDrive\Desktop\Projects\mcp-server\scripts\windows\mcp-deploy.ps1"
$workDir = "C:\Users\simon\OneDrive\Desktop\Projects\mcp-server\scripts\windows"

Unregister-ScheduledTask -TaskName 'MCP-AutoDeploy' -Confirm:$false -ErrorAction SilentlyContinue

$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`"" -WorkingDirectory $workDir
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RunOnlyIfNetworkAvailable -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName 'MCP-AutoDeploy' -Action $action -Trigger $trigger -Settings $settings -Force

Write-Host "Task created. Testing..."
Start-ScheduledTask -TaskName 'MCP-AutoDeploy'
