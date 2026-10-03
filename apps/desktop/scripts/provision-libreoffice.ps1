$ErrorActionPreference = 'Stop'
$version = '26.2.6'
# Published by The Document Foundation at the same official URL with .sha256 appended.
$expectedHash = 'f9877032fd908beb9c0ddf06df4af5c2e85f419c42e14876c4cce5aae5fb2660'
$installer = Join-Path $env:RUNNER_TEMP "LibreOffice_$($version)_Win_x86-64.msi"
$extract = Join-Path $env:RUNNER_TEMP "koma-libreoffice-$version"
$log = Join-Path $env:RUNNER_TEMP 'koma-libreoffice-extract.log'
$url = "https://download.documentfoundation.org/libreoffice/stable/$version/win/x86_64/LibreOffice_$($version)_Win_x86-64.msi"
Invoke-WebRequest -Uri $url -OutFile $installer
if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) {
  throw 'The pinned LibreOffice MSI checksum does not match.'
}
# Administrative extraction creates a private portable test tree, not a machine-wide installation.
$result = Start-Process -FilePath 'msiexec.exe' -WindowStyle Hidden -Wait -PassThru -ArgumentList @(
  '/a', "`"$installer`"", '/qn', "TARGETDIR=`"$extract`"", '/L*v', "`"$log`""
)
if ($result.ExitCode -ne 0) { throw "LibreOffice extraction failed: $($result.ExitCode). See $log" }
$executables = @(Get-ChildItem -LiteralPath $extract -Filter 'soffice.exe' -File -Recurse)
if ($executables.Count -ne 1) { throw 'Expected exactly one extracted LibreOffice executable.' }
$executable = $executables[0].FullName
"KOMA_LIBREOFFICE_EXECUTABLE=$executable" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
"KOMA_REQUIRE_LIBREOFFICE=1" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
"KOMA_EXPECT_LIBREOFFICE_VERSION=$version" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
Write-Output "Verified LibreOffice $version MSI SHA256 $expectedHash; extracted executable $executable"
