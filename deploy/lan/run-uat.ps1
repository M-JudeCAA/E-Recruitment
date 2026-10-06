# Runs the test (UAT) deployment on this server and keeps it running:
# the API, the scheduler worker, and the three sites over HTTPS
#   external candidates :5173   HR staff :4174   Internal Careers :4175
# Each site is `vite preview` serving the same build and forwarding /api and
# /ws to the API, which only listens on this machine (see README.md here).
#
# Normally started at boot by the scheduled task install-uat.ps1 registers.
# By hand, from the deployment folder (Ctrl+C stops everything):
#   powershell -ExecutionPolicy Bypass -File deploy\lan\run-uat.ps1
#
# Controlled through files in deploy\lan\logs\, so no administrator rights
# are needed once it is installed:
#   hold     while it exists, everything is stopped (update-uat.ps1 uses it)
#   restart  stop and start everything once (the file is then removed)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$logs = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$holdFile = Join-Path $logs 'hold'
$restartFile = Join-Path $logs 'restart'
$pidFile = Join-Path $logs 'pids.txt'

$node = (Get-Command node.exe).Source
$vite = Join-Path $frontend 'node_modules\vite\bin\vite.js'

$specs = @(
  @{ Name = 'api';      Dir = $backend;  Args = @('src/server.js') },
  @{ Name = 'jobs';     Dir = $backend;  Args = @('scripts/scheduler.js') },
  @{ Name = 'external'; Dir = $frontend; Args = @($vite, 'preview', '--host', '0.0.0.0', '--port', '5173', '--strictPort') },
  @{ Name = 'staff';    Dir = $frontend; Args = @($vite, 'preview', '--host', '0.0.0.0', '--port', '4174', '--strictPort') },
  @{ Name = 'internal'; Dir = $frontend; Args = @($vite, 'preview', '--host', '0.0.0.0', '--port', '4175', '--strictPort') }
)

function Write-Log($message) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $message"
  Write-Host $line
  Add-Content -Path (Join-Path $logs 'supervisor.log') -Value $line
}

function Save-Pids {
  ($specs | Where-Object { $_.Process -and -not $_.Process.HasExited } | ForEach-Object { $_.Process.Id }) -join "`n" |
    Set-Content -Path $pidFile -Encoding ascii
}

# Processes left by a supervisor that was killed outright (ending the
# scheduled task doesn't end the processes it started) would hold the ports.
function Stop-Leftovers {
  if (-not (Test-Path $pidFile)) { return }
  foreach ($id in (Get-Content $pidFile | Where-Object { $_ -match '^\d+$' })) {
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -eq 'node') {
      Write-Log "stopping leftover node process $id"
      & taskkill.exe /T /F /PID $id 2>&1 | Out-Null
    }
  }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
}

function Test-Ready {
  foreach ($f in @("$backend\.env", "$frontend\.env", "$frontend\dist\index.html", $vite)) {
    if (-not (Test-Path $f)) { Write-Log "$f is missing - run deploy\lan\update-uat.ps1 (README.md)"; return $false }
  }
  return $true
}

function Start-One($spec) {
  # One log file per process per day, appended across restarts.
  $day = Get-Date -Format 'yyyy-MM-dd'
  $argLine = ($spec.Args | ForEach-Object { if ($_ -match '\s') { "`"$_`"" } else { $_ } }) -join ' '
  $spec.Process = Start-Process -FilePath $node -ArgumentList $argLine -WorkingDirectory $spec.Dir -NoNewWindow -PassThru `
    -RedirectStandardOutput (Join-Path $logs "$($spec.Name)-$day.out.log") `
    -RedirectStandardError (Join-Path $logs "$($spec.Name)-$day.err.log")
  $spec.StartedAt = Get-Date
  Write-Log "started $($spec.Name) (pid $($spec.Process.Id))"
}

function Start-All {
  if (-not (Test-Ready)) { return $false }
  foreach ($s in $specs) { Start-One $s }
  Save-Pids
  return $true
}

function Stop-All {
  foreach ($s in $specs) {
    if ($s.Process -and -not $s.Process.HasExited) { & taskkill.exe /T /F /PID $s.Process.Id 2>&1 | Out-Null }
    $s.Process = $null
  }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
}

try {
  Write-Log "supervisor started for $root"
  Stop-Leftovers
  Remove-Item $restartFile -ErrorAction SilentlyContinue
  $running = $false
  while ($true) {
    if (Test-Path $holdFile) {
      if ($running) { Write-Log 'hold file found - stopping everything'; Stop-All; $running = $false }
    } elseif (-not $running) {
      $running = Start-All
      if (-not $running) { Start-Sleep -Seconds 55 }
    } elseif (Test-Path $restartFile) {
      Remove-Item $restartFile -ErrorAction SilentlyContinue
      Write-Log 'restart requested'
      Stop-All
      $running = Start-All
    } else {
      foreach ($s in $specs) {
        if ($s.Process.HasExited) {
          Write-Log "$($s.Name) stopped (exit $($s.Process.ExitCode)) - see logs\$($s.Name)-*.err.log"
          # Don't spin if it dies straight away (a port in use, the database
          # down): wait a minute before trying again.
          if (((Get-Date) - $s.StartedAt).TotalSeconds -lt 60) { Start-Sleep -Seconds 60 }
          Start-One $s
          Save-Pids
        }
      }
    }
    Start-Sleep -Seconds 5
  }
} finally {
  Write-Log 'supervisor stopping'
  Stop-All
}
