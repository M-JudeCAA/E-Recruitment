# One-time setup that needs an ADMINISTRATOR PowerShell on the server:
#   - opens the three site ports (5173, 4174, 4175) in Windows Firewall, for
#     the domain and private networks only
#   - registers the scheduled task "UCAA e-Recruitment UAT", which runs
#     run-uat.ps1 as SYSTEM at boot and restarts it if it stops
#   - lets -Operator start and end that task without being an administrator
#   - starts it
#
#   powershell -ExecutionPolicy Bypass -File E:\eRecruitment-UAT\deploy\lan\install-uat.ps1 -Operator CAA\jkaganda
#
# Run it from the deployment folder's copy of this script. Safe to re-run;
# -Uninstall removes the task and the firewall rules.
param(
  [string]$Operator,
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$taskName = 'UCAA e-Recruitment UAT'
$ruleName = 'UCAA e-Recruitment UAT (HTTPS 5173, 4174, 4175)'
$runScript = Join-Path $PSScriptRoot 'run-uat.ps1'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this from an administrator PowerShell (right-click PowerShell, Run as administrator).'
}

$scheduler = New-Object -ComObject Schedule.Service
$scheduler.Connect()
$rootFolder = $scheduler.GetFolder('\')
$existing = $null
try { $existing = $rootFolder.GetTask($taskName) } catch { }
if ($existing) {
  if ($existing.State -eq 4) { $existing.Stop(0) }
  $rootFolder.DeleteTask($taskName, 0)
  Write-Host "Removed the existing task '$taskName'."
}
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
if ($Uninstall) {
  Write-Host 'Uninstalled. Stop any node processes it left with deploy\lan\logs\pids.txt if needed.'
  return
}

New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort 5173, 4174, 4175 `
  -Action Allow -Profile Domain, Private | Out-Null
Write-Host "Firewall: opened 5173, 4174, 4175 (domain and private networks)."

# Built through the COM API rather than Register-ScheduledTask so the task
# can carry a security descriptor letting the operator run and end it.
$def = $scheduler.NewTask(0)
$def.RegistrationInfo.Description = 'Runs the UCAA e-Recruitment test deployment (deploy\lan\README.md).'
$def.Settings.ExecutionTimeLimit = 'PT0S'          # no time limit
$def.Settings.DisallowStartIfOnBatteries = $false
$def.Settings.StopIfGoingOnBatteries = $false
$def.Settings.MultipleInstances = 2                # ignore a second start while running
$def.Settings.RestartInterval = 'PT1M'
$def.Settings.RestartCount = 999
$def.Principal.UserId = 'SYSTEM'
$def.Principal.LogonType = 5                       # service account
$def.Principal.RunLevel = 1                        # highest
$trigger = $def.Triggers.Create(8)                 # at boot
$trigger.Delay = 'PT1M'                            # let MySQL start first
$action = $def.Actions.Create(0)
$action.Path = 'powershell.exe'
$action.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$runScript`""
$action.WorkingDirectory = $PSScriptRoot

$sddl = 'D:(A;;FA;;;SY)(A;;FA;;;BA)'
if ($Operator) {
  $sid = (New-Object Security.Principal.NTAccount($Operator)).Translate([Security.Principal.SecurityIdentifier]).Value
  $sddl += "(A;;GRGX;;;$sid)"
}
$rootFolder.RegisterTaskDefinition($taskName, $def, 6, 'SYSTEM', $null, 5, $sddl) | Out-Null
Write-Host "Scheduled task '$taskName' registered (runs at boot as SYSTEM)."
if ($Operator) { Write-Host "$Operator can start and end it: Start-ScheduledTask / Stop-ScheduledTask -TaskName '$taskName'." }

$rootFolder.GetTask($taskName).Run($null) | Out-Null
Write-Host 'Started. Logs: deploy\lan\logs\ (supervisor.log, and one file per process per day).'
