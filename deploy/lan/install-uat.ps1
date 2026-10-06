# One-time setup that needs an ADMINISTRATOR PowerShell on the server:
#   - opens the three site ports (5173, 4174, 4175) in Windows Firewall, for
#     the domain and private networks only
#   - registers two scheduled tasks, both running as SYSTEM:
#       "UCAA e-Recruitment UAT"         run-uat.ps1 from boot - keeps the app running
#       "UCAA e-Recruitment UAT deploy"  auto-deploy.ps1 every 5 minutes - deploys
#                                        what passed CI on main
#   - lets -Operator start and end those tasks, and change the deployment
#     and data folders the tasks also write to, without being an administrator
#   - starts them
#
#   powershell -ExecutionPolicy Bypass -File E:\eRecruitment-UAT\deploy\lan\install-uat.ps1 -Operator CAA\jkaganda
#
# Run it from the deployment folder's copy of this script. Safe to re-run;
# -Uninstall removes the tasks and the firewall rule.
param(
  [string]$Operator,
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$appTask = 'UCAA e-Recruitment UAT'
$deployTask = 'UCAA e-Recruitment UAT deploy'
$ruleName = 'UCAA e-Recruitment UAT (HTTPS 5173, 4174, 4175)'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$dataDir = 'C:\ProgramData\UCAA-eRecruitment-UAT'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this from an administrator PowerShell (right-click PowerShell, Run as administrator).'
}

$scheduler = New-Object -ComObject Schedule.Service
$scheduler.Connect()
$rootFolder = $scheduler.GetFolder('\')
foreach ($name in @($appTask, $deployTask)) {
  $existing = $null
  try { $existing = $rootFolder.GetTask($name) } catch { }
  if ($existing) {
    if ($existing.State -eq 4) { $existing.Stop(0) }
    $rootFolder.DeleteTask($name, 0)
    Write-Host "Removed the existing task '$name'."
  }
}
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
if ($Uninstall) {
  Write-Host 'Uninstalled. Stop any node processes it left with deploy\lan\logs\pids.txt if needed.'
  return
}

New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort 5173, 4174, 4175 `
  -Action Allow -Profile Domain, Private | Out-Null
Write-Host "Firewall: opened 5173, 4174, 4175 (domain and private networks)."

# Security descriptor letting the operator run and end the tasks.
$sddl = 'D:(A;;FA;;;SY)(A;;FA;;;BA)'
if ($Operator) {
  $sid = (New-Object Security.Principal.NTAccount($Operator)).Translate([Security.Principal.SecurityIdentifier]).Value
  $sddl += "(A;;GRGX;;;$sid)"
  # The tasks create files (packages, builds, logs, uploads) the operator
  # must still be able to change when updating by hand.
  foreach ($dir in @($root, $dataDir)) {
    New-Item -ItemType Directory -Force $dir | Out-Null
    & icacls.exe $dir /grant "${Operator}:(OI)(CI)M" /T /C /Q | Out-Null
  }
  Write-Host "$Operator can change $root and $dataDir."
}

# Built through the COM API rather than Register-ScheduledTask so the tasks
# can carry that security descriptor.
function Register-SystemTask($name, $description, $script, $timeLimit, [scriptblock]$addTrigger) {
  $def = $scheduler.NewTask(0)
  $def.RegistrationInfo.Description = $description
  $def.Settings.ExecutionTimeLimit = $timeLimit
  $def.Settings.DisallowStartIfOnBatteries = $false
  $def.Settings.StopIfGoingOnBatteries = $false
  $def.Settings.MultipleInstances = 2              # ignore a second start while running
  $def.Principal.UserId = 'SYSTEM'
  $def.Principal.LogonType = 5                     # service account
  $def.Principal.RunLevel = 1                      # highest
  & $addTrigger $def
  $action = $def.Actions.Create(0)
  $action.Path = 'powershell.exe'
  $action.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot $script)`""
  $action.WorkingDirectory = $PSScriptRoot
  $rootFolder.RegisterTaskDefinition($name, $def, 6, 'SYSTEM', $null, 5, $sddl) | Out-Null
  Write-Host "Scheduled task '$name' registered."
}

Register-SystemTask $appTask 'Runs the UCAA e-Recruitment test deployment (deploy\lan\README.md).' 'run-uat.ps1' 'PT0S' {
  param($def)
  $def.Settings.RestartInterval = 'PT1M'
  $def.Settings.RestartCount = 999
  $trigger = $def.Triggers.Create(8)               # at boot
  $trigger.Delay = 'PT1M'                          # let MySQL start first
}

Register-SystemTask $deployTask 'Deploys the newest commit on main that passed CI to the UCAA e-Recruitment test deployment (deploy\lan\README.md).' 'auto-deploy.ps1' 'PT1H' {
  param($def)
  $trigger = $def.Triggers.Create(1)               # once, repeating
  $trigger.StartBoundary = (Get-Date).AddMinutes(1).ToString('s')
  $trigger.Repetition.Interval = 'PT5M'
  $trigger.Repetition.Duration = ''                # indefinitely
}

if ($Operator) { Write-Host "$Operator can start and end them: Start-ScheduledTask / Stop-ScheduledTask -TaskName '<name>'." }
$rootFolder.GetTask($appTask).Run($null) | Out-Null
Write-Host 'Started. Logs: deploy\lan\logs\ (supervisor.log, deploy.log, and one file per process per day).'
