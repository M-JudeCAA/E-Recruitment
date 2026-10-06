# Makes UCAA's domain computers trust the test (UAT) sites' self-signed
# certificate, so testers get no "not secure" warning. Creates (or updates)
# a Group Policy Object that adds the certificate to Trusted Root
# Certification Authorities, and links it. Run as a Domain Admin:
#
#   powershell -ExecutionPolicy Bypass -File E:\eRecruitment-UAT\deploy\lan\trust-certificate-gpo.ps1
#   ... -Target "OU=Workstations,DC=caa,DC=co,DC=ug"   link to that OU instead of the whole domain
#   ... -Remove                                         unlink and delete the GPO
#   ... -DomainController UCAASDC.caa.co.ug             which DC to work on (default: the PDC emulator)
#
# The Group Policy work runs on a domain controller over PowerShell remoting,
# because the Group Policy tools are usually not installed (or not usable
# until a restart) on the server this runs on. The certificate is read here.
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
  [string]$DomainController,
  [switch]$Remove
)
$ErrorActionPreference = 'Stop'

if (-not $DomainController) {
  $DomainController = [DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain().PdcRoleOwner.Name
}
if (-not $Target) { $Target = ([ADSI]'LDAP://RootDSE').defaultNamingContext.ToString() }

$thumb = $null
$blob = $null
if (-not $Remove) {
  $cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2 $CertificatePath
  $thumb = $cert.Thumbprint
  $names = ($cert.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.17' }).Format($false)
  Write-Host "Certificate: $names"
  Write-Host "  thumbprint $thumb, valid until $($cert.NotAfter.ToString('yyyy-MM-dd'))"
  if ($names -match 'DNS Name=[^,]*,[^ ]') { throw 'This certificate has a host name with a comma in it - make a new one with the current new-certificate.ps1 first.' }

  # Group Policy keeps each trusted certificate as a "Blob" value in Windows'
  # own serialized format (not the bare .cer). Get exactly that by adding the
  # certificate to a scratch store in the current user's registry and
  # reading it back.
  $scratch = 'UcaaGpoCertExport'
  $store = New-Object Security.Cryptography.X509Certificates.X509Store($scratch, 'CurrentUser')
  $store.Open('ReadWrite')
  try {
    $store.Add($cert)
    $blob = [byte[]](Get-ItemProperty "HKCU:\Software\Microsoft\SystemCertificates\$scratch\Certificates\$thumb").Blob
    $store.Remove($cert)
  } finally { $store.Close() }
}

# Runs on the domain controller.
$apply = {
  param($GpoName, $Target, $Thumb, [byte[]]$Blob, $Remove)
  $ErrorActionPreference = 'Stop'
  Import-Module GroupPolicy
  $rootKey = 'HKLM\SOFTWARE\Policies\Microsoft\SystemCertificates\Root\Certificates'

  if ($Remove) {
    if (Get-GPO -Name $GpoName -ErrorAction SilentlyContinue) {
      Remove-GPO -Name $GpoName
      "Deleted the GPO '$GpoName' (and its links). Computers drop the certificate at their next policy refresh."
    } else { "There is no GPO '$GpoName'." }
    return
  }

  $gpo = Get-GPO -Name $GpoName -ErrorAction SilentlyContinue
  if (-not $gpo) {
    $gpo = New-GPO -Name $GpoName -Comment 'Trusts the self-signed certificate of the UCAA e-Recruitment test sites (https://erecruitment-uat.caa.co.ug). Made by deploy\lan\trust-certificate-gpo.ps1.'
    "Created the GPO '$GpoName'."
  }
  $gpo.GpoStatus = 'UserSettingsDisabled'   # computer settings only

  # Take out certificates an earlier run put in (a replaced certificate).
  $existing = @()
  try { $existing = Get-GPRegistryValue -Name $GpoName -Key $rootKey -ErrorAction Stop } catch { }   # none yet
  foreach ($entry in @($existing)) {
    if ($entry -and $entry.KeyPath -and $entry.KeyPath -notmatch $Thumb -and $entry.KeyPath -ne $rootKey.Substring(5)) {
      Remove-GPRegistryValue -Name $GpoName -Key "HKLM\$($entry.KeyPath)" | Out-Null
      "Removed an older certificate from the GPO: $($entry.KeyPath.Split('\')[-1])"
    }
  }

  Set-GPRegistryValue -Name $GpoName -Key "$rootKey\$Thumb" -ValueName 'Blob' -Type Binary -Value $Blob | Out-Null
  'The GPO adds the certificate to Trusted Root Certification Authorities.'

  $linked = (Get-GPInheritance -Target $Target).GpoLinks | Where-Object { $_.DisplayName -eq $GpoName }
  if (-not $linked) {
    New-GPLink -Name $GpoName -Target $Target -LinkEnabled Yes | Out-Null
    "Linked to $Target."
  } else { "Already linked to $Target." }
}

Write-Host "Working on $DomainController..."
Invoke-Command -ComputerName $DomainController -ScriptBlock $apply -ArgumentList $GpoName, $Target, $thumb, $blob, [bool]$Remove |
  ForEach-Object { Write-Host $_ }
if ($Remove) { return }

Write-Host ''
Write-Host 'Done. On a tester''s PC, to apply it now and check:' -ForegroundColor Green
Write-Host '  gpupdate /force'
Write-Host "  Get-ChildItem Cert:\LocalMachine\Root | Where-Object Thumbprint -eq '$thumb'"
Write-Host 'then open https://erecruitment-uat.caa.co.ug:5173 - no warning (restart the browser if it was open).'
