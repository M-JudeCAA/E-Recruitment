# Shared by the deploy\lan scripts (dot-sourced).

# Git, also for the SYSTEM account the scheduled tasks run as, whose PATH may
# not include a per-user Git install.
function Get-GitExe {
  $cmd = Get-Command git.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @("$env:ProgramFiles\Git\cmd\git.exe") +
    @(Get-ChildItem 'C:\Users\*\AppData\Local\Programs\Git\cmd\git.exe', 'C:\Users\*\AppData\Local\Programs\MinGit\cmd\git.exe' -ErrorAction SilentlyContinue |
      ForEach-Object FullName)
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  throw 'Git not found. Install it for all users: winget install --id Git.Git --scope machine'
}

# Runs git in the deployment folder. safe.directory: the folder belongs to
# whoever set it up, and git otherwise refuses to work in it as SYSTEM.
function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments)] $GitArgs)
  # Judge git by its exit code: with output redirected, Windows PowerShell
  # would turn anything git writes to stderr into a terminating error.
  $ErrorActionPreference = 'Continue'
  & (Get-GitExe) -c safe.directory=* -C $script:root @GitArgs
}
