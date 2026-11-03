# Continuous deployment for the test (UAT) server: deploys the newest commit
# on main whose CI run (.github/workflows/ci.yml) passed - unit tests,
# end-to-end tests and the frontend build. Run every few minutes by the
# scheduled task "UCAA e-Recruitment UAT deploy" (install-uat.ps1); by hand:
#   powershell -ExecutionPolicy Bypass -File deploy\lan\auto-deploy.ps1
#
# Pull-based on purpose: the server asks GitHub's public API what passed and
# fetches it itself. Nothing on GitHub can run anything here - no inbound
# connection, no self-hosted runner (which a public repository would expose
# to anyone opening a pull request).
#
# Writes logs\deploy.log (one line per decision) and logs\deploy-<date>.log
# (the full output of each deployment), and logs\deployed.json.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot 'common.ps1')
$logs = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$lockFile = Join-Path $logs 'deploy.lock'
$stateFile = Join-Path $logs 'deployed.json'
$pauseFile = Join-Path $logs 'no-auto-deploy'

function Write-DeployLog($message) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $message"
  Write-Host $line
  Add-Content -Path (Join-Path $logs 'deploy.log') -Value $line
}

if (Test-Path $pauseFile) { Write-Host "Automatic deployment is paused ($pauseFile exists)."; return }

# One deployment at a time (the task can fire again while one is running).
if (Test-Path $lockFile) {
  $holder = Get-Process -Id ([int](Get-Content $lockFile -Raw)) -ErrorAction SilentlyContinue
  if ($holder) { return }
}
Set-Content -Path $lockFile -Value $PID -Encoding ascii

try {
  $remote = Invoke-Git remote get-url origin
  if ($remote -notmatch 'github\.com[:/](.+?)(\.git)?$') { throw "origin isn't a GitHub repository: $remote" }
  $repo = $matches[1]

  # The newest successful CI run for a push to main.
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $url = "https://api.github.com/repos/$repo/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=1"
  try {
    $runs = Invoke-RestMethod -Uri $url -Headers @{ 'User-Agent' = 'ucaa-erecruitment-uat'; Accept = 'application/vnd.github+json' } -TimeoutSec 30
  } catch {
    Write-DeployLog "could not ask GitHub what passed CI: $($_.Exception.Message)"
    return
  }
  if (-not $runs.workflow_runs) { return }
  $run = $runs.workflow_runs[0]
  $target = $run.head_sha

  $current = Invoke-Git rev-parse HEAD
  if ($current -eq $target) { return }

  # A commit that failed to deploy isn't retried every few minutes (each try
  # is an outage): it waits for the next commit, or for someone to delete
  # logs\deployed.json.
  if (Test-Path $stateFile) {
    $last = Get-Content $stateFile -Raw | ConvertFrom-Json
    if ($last.commit -eq $target -and $last.result -ne 'deployed') { return }
  }

  # Never go backwards: if what's deployed already contains that commit
  # (deployed by hand, say), leave it.
  Invoke-Git fetch --quiet origin
  Invoke-Git merge-base --is-ancestor $target $current
  if ($LASTEXITCODE -eq 0) { return }

  $short = $target.Substring(0, 7)
  # A commit from before this deployment setup existed (or after it was
  # removed) would take the HTTPS sites and their API proxy down with it.
  if (-not (Invoke-Git ls-tree --name-only $target deploy/lan/run-uat.ps1)) {
    # Logged once, not every five minutes.
    if ("$(Get-Content (Join-Path $logs 'deploy.log') -Tail 1 -ErrorAction SilentlyContinue)" -notmatch $short) {
      Write-DeployLog "not deploying $short - it has no deploy\lan setup (merge it into main first)"
    }
    return
  }

  Write-DeployLog "deploying $short ($($run.display_title)) - CI run $($run.html_url)"
  $log = Join-Path $logs "deploy-$(Get-Date -Format 'yyyy-MM-dd').log"
  Add-Content -Path $log -Value "`n===== $(Get-Date -Format 's') deploying $target"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'update-uat.ps1') -Commit $target *>> $log
  $ok = ($LASTEXITCODE -eq 0)
  $result = 'deployed'
  if (-not $ok) {
    # The API runs straight from the checked-out code, so put the previous
    # commit back rather than leave a half-updated mix running.
    Write-DeployLog "FAILED to deploy $short - see $log. Going back to $($current.Substring(0, 7))."
    Add-Content -Path $log -Value "`n===== $(Get-Date -Format 's') rolling back to $current"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'update-uat.ps1') -Commit $current *>> $log
    $result = $(if ($LASTEXITCODE -eq 0) { 'failed, rolled back' } else { 'failed, rollback failed too' })
  }
  [ordered]@{
    commit = $target; title = $run.display_title; ciRun = $run.html_url
    at = (Get-Date -Format 's'); result = $result; previous = $current
  } | ConvertTo-Json | Set-Content -Path $stateFile -Encoding utf8
  Write-DeployLog "$result $short"
} finally {
  Remove-Item $lockFile -ErrorAction SilentlyContinue
}
