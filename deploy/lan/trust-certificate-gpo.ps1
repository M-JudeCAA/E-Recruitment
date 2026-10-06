# Makes UCAA's domain computers trust the test (UAT) sites' self-signed
# certificate, so testers get no "not secure" warning. Creates (or updates)
# a Group Policy Object that adds the certificate to Trusted Root
# Certification Authorities, and links it. Run as a Domain Admin, in an
# ADMINISTRATOR PowerShell (it installs the Group Policy tools if missing):
#
#   powershell -ExecutionPolicy Bypass -File E:\eRecruitment-UAT\deploy\lan\trust-certificate-gpo.ps1
#   ... -Target "OU=Workstations,DC=caa,DC=co,DC=ug"   link to that OU instead of the whole domain
#   ... -Remove                                         unlink and delete the GPO
#
# Re-run it after making a new certificate (new-certificate.ps1): the GPO
# then carries only the new one. Computers pick it up at their next policy
# refresh (up to ~2 hours, or at restart); `gpupdate /force` does it at once.
#
# The certificate can't be used to vouch for any other site: it isn't a CA
# (no certificate-signing key usage), so trusting it only trusts the names in
# it. Its private key (uat-tls.pfx) must still stay on the server.
param(
  [string]$CertificatePath = 'C:\ProgramData\UCAA-eRecruitment-UAT\tls\uat-tls.cer',
  [string]$GpoName = 'UCAA e-Recruitment UAT - trust test certificate',
  [string]$Target,
  [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$rootKey = 'HKLM\SOFTWARE\Policies\Microsoft\SystemCertificates\Root\Certificates'

if (-not (Get-Module -ListAvailable GroupPolicy)) {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'The Group Policy tools are not installed. Run this from an administrator PowerShell so it can install them.'
  }
  Write-Host 'Installing the Group Policy Management tools...'
  Install-WindowsFeature GPMC | Out-Null
}
Import-Module GroupPolicy

if (-not $Target) { $Target = ([ADSI]'LDAP://RootDSE').defaultNamingContext.ToString() }

if ($Remove) {
  if (Get-GPO -Name $GpoName -ErrorAction SilentlyContinue) {
    Remove-GPO -Name $GpoName
    Write-Host "Deleted the GPO '$GpoName' (and its links). Computers drop the certificate at their next policy refresh."
  } else {
    Write-Host "There is no GPO '$GpoName'."
  }
  return
}

$cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2 $CertificatePath
$thumb = $cert.Thumbprint
$names = ($cert.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.17' }).Format($false)
Write-Host "Certificate: $names"
Write-Host "  thumbprint $thumb, valid until $($cert.NotAfter.ToString('yyyy-MM-dd'))"
if ($names -match 'DNS Name=[^,]*,[^ ]') { throw 'This certificate has a host name with a comma in it - make a new one with the current new-certificate.ps1 first.' }

# Group Policy keeps each trusted certificate as a "Blob" value in Windows'
# own serialized format (not the bare .cer). Get exactly that by adding the
# certificate to a scratch store in the current user's registry and reading
# it back.
$scratch = 'UcaaGpoCertExport'
$store = New-Object Security.Cryptography.X509Certificates.X509Store($scratch, 'CurrentUser')
$store.Open('ReadWrite')
try {
  $store.Add($cert)
  $blob = [byte[]](Get-ItemProperty "HKCU:\Software\Microsoft\SystemCertificates\$scratch\Certificates\$thumb").Blob
  $store.Remove($cert)
} finally { $store.Close() }

$gpo = Get-GPO -Name $GpoName -ErrorAction SilentlyContinue
if (-not $gpo) {
  $gpo = New-GPO -Name $GpoName -Comment "Trusts the self-signed certificate of the UCAA e-Recruitment test sites (https://erecruitment-uat.caa.co.ug). Made by deploy\lan\trust-certificate-gpo.ps1."
  Write-Host "Created the GPO '$GpoName'."
}
$gpo.GpoStatus = 'UserSettingsDisabled'   # computer settings only

# Take out certificates an earlier run put in (a replaced certificate).
$existing = @()
try { $existing = Get-GPRegistryValue -Name $GpoName -Key $rootKey -ErrorAction Stop } catch { }   # none yet
foreach ($entry in @($existing)) {
  if ($entry -and $entry.KeyPath -and $entry.KeyPath -notmatch [regex]::Escape($thumb) -and $entry.KeyPath -ne $rootKey.Substring(5)) {
    Remove-GPRegistryValue -Name $GpoName -Key "HKLM\$($entry.KeyPath)" | Out-Null
    Write-Host "Removed an older certificate from the GPO: $($entry.KeyPath.Split('\')[-1])"
  }
}

Set-GPRegistryValue -Name $GpoName -Key "$rootKey\$thumb" -ValueName 'Blob' -Type Binary -Value $blob | Out-Null
Write-Host 'The GPO adds the certificate to Trusted Root Certification Authorities.'

$linked = (Get-GPInheritance -Target $Target).GpoLinks | Where-Object { $_.DisplayName -eq $GpoName }
if (-not $linked) {
  New-GPLink -Name $GpoName -Target $Target -LinkEnabled Yes | Out-Null
  Write-Host "Linked to $Target."
} else {
  Write-Host "Already linked to $Target."
}

Write-Host ''
Write-Host 'Done. On a tester''s PC, to apply it now and check:' -ForegroundColor Green
Write-Host '  gpupdate /force'
Write-Host "  Get-ChildItem Cert:\LocalMachine\Root | Where-Object Thumbprint -eq '$thumb'"
Write-Host 'then open https://erecruitment-uat.caa.co.ug:5173 - no warning (restart the browser if it was open).'
