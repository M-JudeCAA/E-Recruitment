# Runs the whole app on this computer and shares it over the internet with
# Tailscale Funnel (free). See README.md here.
#
#   powershell -ExecutionPolicy Bypass -File deploy\tunnel\start-demo.ps1
#   ... -SkipBuild     reuse the last frontend build (no code changes since)
#
#   Candidate site: https://<machine>.<tailnet>.ts.net
#   Staff site:     https://<machine>.<tailnet>.ts.net:8443/staff/login
#
# Ctrl+C stops everything and takes the site off the internet.
param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$logs = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null

# Funnel only allows public ports 443, 8443 and 10000.
$staffPort = '8443'
$localPort = 4173

if (-not (Get-Command tailscale -ErrorAction SilentlyContinue)) {
  throw 'Tailscale is not installed. Run "winget install --id Tailscale.Tailscale", sign in, then open a new terminal.'
}
if (-not (Test-Path (Join-Path $backend '.env'))) {
  throw 'backend\.env is missing - see SETUP.md.'
}
$status = & tailscale status --json | ConvertFrom-Json
if ($status.BackendState -ne 'Running') {
  throw 'Tailscale is not connected. Open Tailscale from the system tray and sign in.'
}
$hostName = $status.Self.DNSName.TrimEnd('.')
$webUrl = "https://$hostName"
$staffUrl = "https://${hostName}:$staffPort"

$script:procs = @()
$script:funnelOn = $false
function Start-Logged($name, $file, $arguments, $dir) {
  $p = Start-Process -FilePath $file -ArgumentList $arguments -WorkingDirectory $dir -NoNewWindow -PassThru `
    -RedirectStandardOutput (Join-Path $logs "$name.out.log") -RedirectStandardError (Join-Path $logs "$name.err.log")
  $script:procs += [pscustomobject]@{ Name = $name; Process = $p }
}

try {
  # 1. Frontend: ONE build for both sites. Staff routes only render on port
  # 8443 (VITE_STAFF_PORT, see src/staffPort.js), and the browser reaches the
  # API through the preview server's /api proxy (VITE_API_URL=same-origin).
  if (-not $SkipBuild) {
    Push-Location $frontend
    try {
      $env:VITE_API_URL = 'same-origin'
      $env:VITE_STAFF_PORT = $staffPort
      Write-Host 'Building the frontend...'
      & npm.cmd run build
      if ($LASTEXITCODE) { throw 'Frontend build failed.' }
    } finally {
      Remove-Item Env:VITE_API_URL, Env:VITE_STAFF_PORT -ErrorAction SilentlyContinue
      Pop-Location
    }
  }

  # 2. API and scheduler. FRONTEND_URL overrides backend\.env (dotenv never
  # replaces a variable that is already set) so emailed links use these URLs.
  $env:FRONTEND_URL = "$webUrl,$staffUrl"
  Start-Logged 'api' 'npm.cmd' 'start' $backend
  Start-Logged 'scheduler' 'npm.cmd' 'run jobs' $backend
  Remove-Item Env:FRONTEND_URL

  Write-Host 'Waiting for the API...'
  $up = $false
  for ($i = 0; $i -lt 60 -and -not $up; $i++) {
    Start-Sleep -Seconds 2
    try { $up = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://localhost:4000/health').StatusCode -eq 200 } catch { }
  }
  if (-not $up) { throw "The API did not start - see $logs\api.err.log and api.out.log" }

  # 3. The site, served once locally; both public ports point at it.
  Start-Logged 'web' 'npx.cmd' "vite preview --port $localPort --strictPort" $frontend

  # 4. Public. The first time, Tailscale may print a link to approve Funnel
  # for this tailnet - open it, approve, and the command carries on.
  Write-Host 'Turning on Tailscale Funnel...'
  $script:funnelOn = $true
  & tailscale funnel --bg --https=443 $localPort
  if ($LASTEXITCODE) { throw 'tailscale funnel failed for port 443 - see the message above.' }
  & tailscale funnel --bg --https=$staffPort $localPort
  if ($LASTEXITCODE) { throw "tailscale funnel failed for port $staffPort - see the message above." }

  Write-Host ''
  Write-Host "Candidate site: $webUrl" -ForegroundColor Green
  Write-Host "Staff site:     $staffUrl/staff/login" -ForegroundColor Green
  Write-Host ''
  Write-Host 'A brand-new name can take a minute or two to work (DNS and certificate).'
  Write-Host "Logs: $logs"
  Write-Host 'Keep this window open. Ctrl+C stops everything.'

  while ($true) {
    Start-Sleep -Seconds 5
    foreach ($p in $script:procs) {
      if ($p.Process.HasExited) { throw "$($p.Name) stopped - see $logs\$($p.Name).err.log" }
    }
  }
} finally {
  Write-Host 'Stopping...'
  if ($script:funnelOn) {
    & tailscale funnel --https=443 off 2>&1 | Out-Null
    & tailscale funnel --https=$staffPort off 2>&1 | Out-Null
  }
  foreach ($p in $script:procs) {
    if (-not $p.Process.HasExited) { & taskkill.exe /T /F /PID $p.Process.Id 2>&1 | Out-Null }
  }
}
