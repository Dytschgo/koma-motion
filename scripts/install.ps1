# Installs the latest stable release of Koma Motion on Windows, for the
# current user, without a window and without administrator rights.
#
#   irm https://raw.githubusercontent.com/Dytschgo/koma-motion/main/scripts/install.ps1 | iex
#
# The installer is checked against the published checksums before it runs.
$ErrorActionPreference = 'Stop'

$base = 'https://github.com/Dytschgo/koma-motion/releases/latest/download'
$work = Join-Path $env:TEMP "koma-motion-install-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $work | Out-Null

try {
  $installer = Join-Path $work 'Koma-Motion-Setup.exe'
  $sums = Join-Path $work 'SHA256SUMS.txt'
  Write-Host 'Downloading the latest stable release of Koma Motion...'
  $curl = Get-Command 'curl.exe' -ErrorAction SilentlyContinue
  if (-not $curl) { throw 'curl.exe is required to download Koma Motion with visible progress. Install a current Windows version that includes curl.exe.' }

  & $curl.Source --fail --location --retry 3 --progress-bar --output $installer "$base/Koma-Motion-Setup.exe"
  if ($LASTEXITCODE -ne 0) { throw 'The download failed. Nothing was installed.' }
  & $curl.Source --fail --location --retry 3 --silent --show-error --output $sums "$base/SHA256SUMS.txt"
  if ($LASTEXITCODE -ne 0) { throw 'Downloading the published checksums failed. Nothing was installed.' }

  $line = Get-Content $sums | Where-Object { $_ -match '^([0-9a-f]{64})  Koma-Motion-Setup\.exe$' }
  if (-not $line) { throw 'The published checksums do not list Koma-Motion-Setup.exe.' }
  $expected = $Matches[1]
  $actual = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw 'The checksum of the download is wrong. Nothing was installed.' }

  $run = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
  if ($run.ExitCode -ne 0) { throw "The installer ended with exit code $($run.ExitCode)." }

  $entry = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' |
    Where-Object { $_.DisplayName -like 'Koma Motion*' } | Select-Object -First 1
  Write-Host "Installed $($entry.DisplayName). Koma Motion is in the Start menu and on the desktop."
  if ($entry -and $entry.DisplayIcon) {
    $exe = ($entry.DisplayIcon -split ',')[0]
    if (Test-Path -LiteralPath $exe) { Start-Process -FilePath $exe }
  }
}
finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
