# Backs up this deployment: the database (mysqldump over the network from
# this app server to the database server, gzipped) and the uploaded files.
#
#   powershell -ExecutionPolicy Bypass -File deploy\lan\backup.ps1 [-Label <word>]
#
# Run nightly by the task "UCAA e-Recruitment <Name> backup" (DailyBackup in
# environment.json) and by update-uat.ps1 before each deployment changes the
# schema (BackupBeforeDeploy, label before-<commit>). It reads DATABASE_URL
# and UPLOAD_DIR from backend\.env and writes, under BackupDir
# (environment.ps1, default <DataDir>\backups):
#   db\erecruitment-<yyyyMMdd-HHmmss>-<label>.sql.gz   one per run, deleted after BackupKeepDays
#   uploads\                                          a mirror of UPLOAD_DIR
# The uploads copy is a mirror on purpose: a file deleted from UPLOAD_DIR -
# a candidate's data erased on request, say - goes from the copy too, so a
# backup never keeps what the system was asked to forget.
#
# Needs mysqldump.exe (MySQL 8 client tools) on this server: on PATH, under
# Program Files\MySQL, or set MysqlDump in environment.json. The password is
# handed to mysqldump in a temporary option file, never on its command line.
# Exits non-zero on any failure (update-uat.ps1 then stops the deployment).
param([string]$Label = 'daily')
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot 'common.ps1')
$deployEnv = Get-DeployEnvironment
$backend = Join-Path $root 'backend'
$logs = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null

function Write-BackupLog($message) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [$Label] $message"
  Write-Host $line
  Add-Content -Path (Join-Path $logs 'backup.log') -Value $line
}

# KEY=value lines of backend\.env (quotes removed, comments skipped).
function Read-DotEnv($path) {
  $values = @{}
  foreach ($line in Get-Content $path) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
      $key = $matches[1]
      $v = $matches[2]
      if ($v -match '^"(.*)"$' -or $v -match "^'(.*)'$") { $v = $matches[1] }
      $values[$key] = $v
    }
  }
  $values
}

function Find-MysqlDump {
  if ($deployEnv.MysqlDump) {
    if (Test-Path $deployEnv.MysqlDump) { return $deployEnv.MysqlDump }
    throw "MysqlDump in environment.json ($($deployEnv.MysqlDump)) doesn't exist."
  }
  $cmd = Get-Command mysqldump.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $found = Get-ChildItem "$env:ProgramFiles\MySQL\*\bin\mysqldump.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
  if ($found) { return $found.FullName }
  throw 'mysqldump.exe not found - install the MySQL 8 client tools on this server, or set MysqlDump in deploy\lan\environment.json.'
}

# A value for a MySQL option file: quoted, with \ and " escaped.
function Format-OptionValue($value) { '"' + ($value -replace '\\', '\\' -replace '"', '\"') + '"' }

$optionFile = $null
try {
  $envFile = Join-Path $backend '.env'
  if (-not (Test-Path $envFile)) { throw "$envFile is missing." }
  $dotEnv = Read-DotEnv $envFile

  $url = $dotEnv['DATABASE_URL']
  if ($url -notmatch '^mysql://(?<user>[^:@/]+)(:(?<pass>[^@]*))?@(?<host>[^:/?]+)(:(?<port>\d+))?/(?<db>[^?]+)(\?(?<query>.*))?$') {
    throw 'DATABASE_URL in backend\.env is not a mysql://user:password@host:port/database address.'
  }
  $m = $matches
  $db = [Uri]::UnescapeDataString($m.db)
  $options = @(
    '[client]',
    "user=$(Format-OptionValue ([Uri]::UnescapeDataString($m.user)))",
    "password=$(Format-OptionValue ([Uri]::UnescapeDataString("$($m.pass)")))",
    "host=$($m.host)",
    "port=$(if ($m.port) { $m.port } else { 3306 })"
  )
  # The same TLS as the API's connection (Prisma's sslcert/sslaccept). A
  # relative sslcert is relative to backend\prisma, as Prisma reads it.
  $query = @{}
  foreach ($pair in "$($m.query)" -split '&' | Where-Object { $_ }) {
    $k, $v = $pair -split '=', 2
    $query[$k] = [Uri]::UnescapeDataString("$v")
  }
  if ($query['sslcert']) {
    $ca = $query['sslcert']
    if (-not [IO.Path]::IsPathRooted($ca)) { $ca = Join-Path (Join-Path $backend 'prisma') $ca }
    $options += "ssl-ca=$(Format-OptionValue $ca)", 'ssl-mode=VERIFY_CA'
  } elseif ($query['sslaccept']) {
    $options += 'ssl-mode=REQUIRED'
  }
  $optionFile = Join-Path $env:TEMP "erec-backup-$PID.cnf"
  Set-Content -Path $optionFile -Value $options -Encoding ascii

  $dbDir = Join-Path $deployEnv.BackupDir 'db'
  New-Item -ItemType Directory -Force $dbDir | Out-Null
  $safeLabel = $Label -replace '[^A-Za-z0-9._-]', '-'
  $sqlFile = Join-Path $dbDir "erecruitment-$(Get-Date -Format 'yyyyMMdd-HHmmss')-$safeLabel.sql"

  Write-BackupLog "dumping $db on $($m.host)"
  $mysqldump = Find-MysqlDump
  # --single-transaction: a consistent copy without locking the live tables.
  # --no-tablespaces: needs no PROCESS privilege for the app's database user.
  $ErrorActionPreference = 'Continue'
  & $mysqldump "--defaults-extra-file=$optionFile" --single-transaction --quick --routines --triggers `
    --no-tablespaces --set-gtid-purged=OFF --default-character-set=utf8mb4 "--result-file=$sqlFile" $db 2>&1 |
    ForEach-Object { "$_" }
  $dumpExit = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($dumpExit) {
    Remove-Item $sqlFile -ErrorAction SilentlyContinue
    throw "mysqldump failed (exit $dumpExit)."
  }

  $gzFile = "$sqlFile.gz"
  $in = [IO.File]::OpenRead($sqlFile)
  try {
    $out = [IO.File]::Create($gzFile)
    try {
      $gzip = New-Object IO.Compression.GZipStream($out, [IO.Compression.CompressionMode]::Compress)
      try { $in.CopyTo($gzip) } finally { $gzip.Dispose() }
    } finally { $out.Dispose() }
  } finally { $in.Dispose() }
  Remove-Item $sqlFile
  Write-BackupLog "database: $gzFile ($([math]::Round((Get-Item $gzFile).Length / 1MB, 1)) MB)"

  $uploads = $dotEnv['UPLOAD_DIR']
  if ($uploads -and (Test-Path $uploads)) {
    $copy = Join-Path $deployEnv.BackupDir 'uploads'
    & robocopy.exe $uploads $copy /MIR /R:2 /W:5 /NP /NFL /NDL /NJH /NJS | Out-Null
    # robocopy: 0-7 is success (files copied, extras removed, ...), 8+ failure.
    if ($LASTEXITCODE -ge 8) { throw "Copying the uploads failed (robocopy exit $LASTEXITCODE)." }
    Write-BackupLog "uploads: mirrored to $copy"
  } else {
    Write-BackupLog "uploads: UPLOAD_DIR ($uploads) not found - skipped"
  }

  $cutoff = (Get-Date).AddDays(-[int]$deployEnv.BackupKeepDays)
  Get-ChildItem $dbDir -Filter 'erecruitment-*.sql.gz' | Where-Object { $_.LastWriteTime -lt $cutoff } | ForEach-Object {
    Remove-Item $_.FullName
    Write-BackupLog "removed $($_.Name) (older than $($deployEnv.BackupKeepDays) days)"
  }
} catch {
  Write-BackupLog "FAILED: $($_.Exception.Message)"
  exit 1
} finally {
  if ($optionFile) { Remove-Item $optionFile -ErrorAction SilentlyContinue }
}
