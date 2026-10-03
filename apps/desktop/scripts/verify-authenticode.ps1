param([Parameter(Mandatory=$true)][string]$ApplicationPath, [Parameter(Mandatory=$true)][string]$InstallerPath)
$ErrorActionPreference = 'Stop'
foreach ($artifactPath in @($ApplicationPath, $InstallerPath)) {
  $signature = Get-AuthenticodeSignature -LiteralPath $artifactPath
  if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or $null -eq $signature.TimeStamperCertificate) {
    throw 'A trusted Authenticode signature and timestamp are required on every signed artifact.'
  }
  $publisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  if ($publisher -cne $env:KOMA_SIGNING_PUBLISHER) {
    throw 'The artifact signer does not match the configured publisher.'
  }
}
