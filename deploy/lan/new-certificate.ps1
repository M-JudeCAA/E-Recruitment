# Makes the self-signed HTTPS certificate for the test (UAT) sites. No
# administrator rights needed. Writes, to -OutDir:
#   uat-tls.pfx  the certificate with its key, for frontend\.env PREVIEW_TLS_PFX
#   uat-tls.cer  the certificate alone, for IT to make testers' PCs trust it
# and prints the passphrase for PREVIEW_TLS_PASSPHRASE.
#
#   powershell -ExecutionPolicy Bypass -File deploy\lan\new-certificate.ps1 -HostNames ark-atams.caa.co.ug -IpAddresses 192.168.20.115
#
# HTTPS is required, not cosmetic: Microsoft sign-in only redirects to https
# addresses (other than localhost) and won't run on an insecure page.
# Replace it with a certificate from UCAA's own certificate authority when
# there is one - same file names, no code change.
param(
  [Parameter(Mandatory)][string[]]$HostNames,
  [string[]]$IpAddresses = @(),
  [string]$OutDir = 'C:\ProgramData\UCAA-eRecruitment-UAT\tls',
  [int]$Years = 2
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $OutDir | Out-Null

$san = (@($HostNames | ForEach-Object { "DNS=$_" }) + @($IpAddresses | ForEach-Object { "IPAddress=$_" })) -join '&'
$cert = New-SelfSignedCertificate -Subject "CN=$($HostNames[0])" -FriendlyName 'UCAA e-Recruitment UAT' `
  -TextExtension @("2.5.29.17={text}$san") -KeyAlgorithm RSA -KeyLength 2048 -KeyExportPolicy Exportable `
  -NotAfter (Get-Date).AddYears($Years) -CertStoreLocation 'Cert:\CurrentUser\My'
try {
  $passphrase = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
  $secure = ConvertTo-SecureString $passphrase -AsPlainText -Force
  Export-PfxCertificate -Cert $cert -FilePath (Join-Path $OutDir 'uat-tls.pfx') -Password $secure | Out-Null
  Export-Certificate -Cert $cert -FilePath (Join-Path $OutDir 'uat-tls.cer') | Out-Null
} finally {
  Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)"
}

Write-Host "Certificate for $($HostNames + $IpAddresses -join ', '), valid until $($cert.NotAfter.ToString('yyyy-MM-dd'))"
Write-Host "  $OutDir\uat-tls.pfx"
Write-Host "  $OutDir\uat-tls.cer"
Write-Host ''
Write-Host "In frontend\.env of the deployment folder:"
Write-Host "  PREVIEW_TLS_PFX=$OutDir\uat-tls.pfx"
Write-Host "  PREVIEW_TLS_PASSPHRASE=$passphrase"
