# Which deployment this server is - the test (UAT) copy or production - read
# by every deploy\lan script (dot-sourced through common.ps1). Each server
# keeps its own settings in deploy\lan\environment.json (gitignored, never
# deployed over); without one it is the UAT deployment, as before.
#
# Production's environment.json (see environment.production.example.json):
#   {
#     "Name": "Production",
#     "Branch": "release",
#     "DataDir": "D:\\UCAA-eRecruitment",
#     "CareersAddress": "::",
#     "BackupBeforeDeploy": true,
#     "DailyBackup": true
#   }
#
#   Name                Shown in task names, the firewall rule and logs
#   Branch              The branch whose CI-passing commits are deployed
#   LocalBranch         The local branch the deployed commit is checked out on
#   DataDir             Uploads, certificate and backups live under it
#   CareersAddress      Address the careers site takes 443 on: "" finds the
#                       office address (UAT: Tailscale holds 443 on its own
#                       addresses), "::" every address
#   BackupBeforeDeploy  Dump the database before each deployment changes its
#                       schema; a failed dump stops the deployment
#   DailyBackup         install-uat.ps1 also registers a nightly backup task
#   BackupDir           Where backup.ps1 writes (default <DataDir>\backups)
#   BackupKeepDays      Older dumps are deleted (default 30)
#   MysqlDump           mysqldump.exe, if not on PATH or under Program Files\MySQL
$script:DeployEnvFile = Join-Path $PSScriptRoot 'environment.json'

function Get-DeployEnvironment {
  $settings = [ordered]@{
    Name = 'UAT'
    Branch = 'main'
    LocalBranch = ''
    DataDir = 'C:\ProgramData\UCAA-eRecruitment-UAT'
    CareersAddress = ''
    BackupBeforeDeploy = $false
    DailyBackup = $false
    BackupDir = ''
    BackupKeepDays = 30
    MysqlDump = ''
  }
  if (Test-Path $script:DeployEnvFile) {
    $file = Get-Content $script:DeployEnvFile -Raw | ConvertFrom-Json
    foreach ($p in $file.PSObject.Properties) {
      if (-not $settings.Contains($p.Name)) { throw "Unknown setting '$($p.Name)' in $($script:DeployEnvFile)." }
      $settings[$p.Name] = $p.Value
    }
  }
  if (-not $settings.LocalBranch) { $settings.LocalBranch = $(if ($settings.Name -eq 'UAT') { 'uat' } else { 'deployed' }) }
  if (-not $settings.BackupDir) { $settings.BackupDir = Join-Path $settings.DataDir 'backups' }
  # Task and rule names: UAT keeps the names it was installed with.
  $settings.Title = "UCAA e-Recruitment $($settings.Name)"
  [pscustomobject]$settings
}
