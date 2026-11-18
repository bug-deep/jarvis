@echo off
setlocal
set "REPO=bug-deep/jarvis"
set "TARGET=%LOCALAPPDATA%\Jarvis"
set "ZIP=%TEMP%\jarvis-portable.zip"
set "CLOUD=%~1"

if "%CLOUD%"=="" set "CLOUD=https://31-42-195-91.sslip.io"

echo Downloading Jarvis...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=3072; Invoke-WebRequest -Uri 'https://github.com/%REPO%/releases/latest/download/Jarvis-portable-win64.zip' -OutFile '%ZIP%' -UseBasicParsing"
if not exist "%ZIP%" goto fail

if exist "%TARGET%" rmdir /s /q "%TARGET%"
echo Unpacking...
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Expand-Archive -Path '%ZIP%' -DestinationPath '%LOCALAPPDATA%' -Force"

if not "%CLOUD%"=="" powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; @{cloudUrl='%CLOUD%';port=8095} | ConvertTo-Json | Set-Content -Encoding ASCII '%TARGET%\app\jarvis.json'"

powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; $s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Jarvis.lnk'); $s.TargetPath='%TARGET%\Jarvis.bat'; $s.WorkingDirectory='%TARGET%'; $s.IconLocation='%TARGET%\icon.ico'; $s.Save()"

start "" "%TARGET%\Jarvis.bat"
exit /b 0

:fail
echo Download failed. Check the internet and try again.
pause
exit /b 1
