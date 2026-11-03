# What run-uat.ps1 runs. Read again every time it (re)starts the processes -
# after each deployment too - so a change here goes live with the deployment
# that brings it, without restarting the supervisor itself.
#
#   careers (external candidates)  https://<host>        443, on the office address only
#   HR staff                       https://<host>:4174
#   Internal Careers               https://<host>:4175
#   plain http://<host>            port 80, redirects to https (http-redirect.js)
param([string]$Root)
$backend = Join-Path $Root 'backend'
$frontend = Join-Path $Root 'frontend'
$vite = Join-Path $frontend 'node_modules\vite\bin\vite.js'

# The careers site takes 443 on the office network address only: Tailscale
# serves another app on this server's 443, on its own (100.x) addresses.
# UAT_CAREERS_ADDRESS overrides the address found.
$careersAddress = $env:UAT_CAREERS_ADDRESS
if (-not $careersAddress) {
  $careersAddress = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.InterfaceAlias -notmatch 'Loopback|Tailscale' -and $_.IPAddress -notlike '169.254.*' -and $_.AddressState -eq 'Preferred' } |
    Sort-Object InterfaceMetric | Select-Object -First 1).IPAddress
}
if (-not $careersAddress) { throw 'No office network address found for the careers site - set UAT_CAREERS_ADDRESS.' }

@(
  @{ Name = 'api';      Dir = $backend;  Args = @('src/server.js') },
  @{ Name = 'jobs';     Dir = $backend;  Args = @('scripts/scheduler.js') },
  @{ Name = 'external'; Dir = $frontend; Args = @($vite, 'preview', '--host', $careersAddress, '--port', '443', '--strictPort') },
  @{ Name = 'staff';    Dir = $frontend; Args = @($vite, 'preview', '--host', '::', '--port', '4174', '--strictPort') },
  @{ Name = 'internal'; Dir = $frontend; Args = @($vite, 'preview', '--host', '::', '--port', '4175', '--strictPort') },
  @{ Name = 'redirect'; Dir = $PSScriptRoot; Args = @('http-redirect.js') }
)
