$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = 'bug-deep/jarvis'
$target = Join-Path $env:LOCALAPPDATA 'Jarvis'
$zip = Join-Path $env:TEMP 'jarvis-portable.zip'
$cloud = $env:JARVIS_CLOUD
if (-not $cloud) { $cloud = 'https://31-42-195-91.sslip.io' }

Write-Host 'Downloading Jarvis...'
Invoke-WebRequest -Uri "https://github.com/$repo/releases/latest/download/Jarvis-portable-win64.zip" -OutFile $zip -UseBasicParsing

if (Test-Path $target) { Remove-Item $target -Recurse -Force }
Write-Host 'Unpacking...'
Expand-Archive -Path $zip -DestinationPath $env:LOCALAPPDATA -Force

if ($cloud) {
  $json = @{ cloudUrl = $cloud; port = 8095 } | ConvertTo-Json
  [System.IO.File]::WriteAllText((Join-Path $target 'app\jarvis.json'), $json, [System.Text.Encoding]::ASCII)
}

$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Jarvis.lnk'))
$lnk.TargetPath = Join-Path $target 'Jarvis.bat'
$lnk.WorkingDirectory = $target
$lnk.IconLocation = Join-Path $target 'icon.ico'
$lnk.Save()

Write-Host 'Done. Starting Jarvis.'
Start-Process (Join-Path $target 'Jarvis.bat')
