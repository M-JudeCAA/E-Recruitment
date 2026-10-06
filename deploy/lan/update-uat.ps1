# Brings the test (UAT) deployment up to date and restarts it. Run from the
# deployment folder - not your development copy:
#   powershell -ExecutionPolicy Bypass -File deploy\lan\update-uat.ps1
#   ... -Commit <sha>   deploy exactly this commit (what auto-deploy.ps1 does)
#   ... -NoPull         rebuild what is checked out without fetching new code
#
# It pauses the running app (the `hold` file run-uat.ps1 watches), fetches
# the code, installs packages, updates the database schema, rebuilds the
# sites, and lets the app start again. Testers are cut off for a few minutes.
# Without -Commit it moves the deployment branch `uat` to origin/main.
param([string]$Commit, [switch]$NoPull)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot 'common.ps1')
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$logs = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$holdFile = Join-Path $logs 'hold'
$pidFile = Join-Path $logs 'pids.txt'

function Invoke-Step($what, [scriptblock]$block) {
  Write-Host "== $what" -ForegroundColor Cyan
  # npm and git write warnings to stderr. When this script's output is
  # redirected (the deploy task), Windows PowerShell turns each such line
  # into an error, so judge by the exit code instead.
  $ErrorActionPreference = 'Continue'
  & $block 2>&1 | ForEach-Object { "$_" }
  if ($LASTEXITCODE) { throw "$what failed (exit $LASTEXITCODE)." }
}

foreach ($f in @("$backend\.env", "$frontend\.env")) {
  if (-not (Test-Path $f)) { throw "$f is missing - see deploy\lan\README.md." }
}

# Fetch and check before stopping anything, so a bad commit id or local
# edits don't cost testers an outage.
if (-not $NoPull) {
  Invoke-Step 'Fetching the code' { Invoke-Git fetch --quiet origin }
  if (-not $Commit) { $Commit = 'origin/main' }
  $target = (Invoke-Git rev-parse --verify --quiet "$Commit^{commit}")
  if (-not $target) { throw "Unknown commit $Commit." }
  Invoke-Git diff --quiet HEAD
  if ($LASTEXITCODE) { throw 'The deployment folder has local changes to tracked files. Undo them (git status) - the deployment only runs committed code.' }
}

# Pause the app so nothing holds the Prisma engine or the packages.
New-Item -ItemType File -Force $holdFile | Out-Null
Write-Host 'Waiting for the running app to stop...'
for ($i = 0; $i -lt 30 -and (Test-Path $pidFile); $i++) { Start-Sleep -Seconds 2 }
if (Test-Path $pidFile) {
  Remove-Item $holdFile
  throw 'The app did not stop within a minute. Is the supervisor (run-uat.ps1) stuck? See logs\supervisor.log.'
}

try {
  if (-not $NoPull) {
    Invoke-Step "Checking out $($target.Substring(0, 7))" { Invoke-Git checkout --quiet -B uat $target }
  }

  Push-Location $backend
  try {
    Invoke-Step 'Installing API packages' { npm.cmd ci --no-audit --no-fund }
    Invoke-Step 'Generating the database client' { npx.cmd prisma generate }
    Invoke-Step 'Updating the database schema' { node scripts/prepareDatabase.js }
  } finally { Pop-Location }

  Push-Location $frontend
  try {
    Invoke-Step 'Installing site packages' { npm.cmd ci --no-audit --no-fund }
    # Built beside the live one and swapped in, so a failed build leaves the
    # previous sites in place.
    Invoke-Step 'Building the sites' { npx.cmd vite build --outDir dist-next --emptyOutDir }
    Remove-Item dist-previous -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path dist) { Rename-Item dist dist-previous }
    Rename-Item dist-next dist
  } finally { Pop-Location }
} finally {
  # Let the app start again whatever happened.
  Remove-Item $holdFile -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "Done: $(Invoke-Git log -1 --format='%h %s')" -ForegroundColor Green
Write-Host 'The app starts again within a few seconds if the scheduled task is running;' -ForegroundColor Green
Write-Host 'otherwise start it with deploy\lan\run-uat.ps1 (see README.md).' -ForegroundColor Green
