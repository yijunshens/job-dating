param([string]$PythonExe)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $PythonExe) { $PythonExe = (Get-Command python -ErrorAction Stop).Source }
$taskName = 'JobDating-DailyRefresh'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$syncPath = Join-Path $PSScriptRoot 'sync.py'
if ($existing -and (($existing.Actions | Select-Object -First 1).Arguments -notlike "*$syncPath*")) { throw 'Existing task name belongs to another path; no changes made.' }
$action = New-ScheduledTaskAction -Execute $PythonExe -Argument ('-X utf8 "' + $syncPath + '" --if-due') -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Daily -At '09:17'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Update public Job Dating catalog daily; private application records are untouched.' -Force | Select-Object TaskName,State
Get-ScheduledTaskInfo -TaskName $taskName | Select-Object NextRunTime,LastRunTime,LastTaskResult
