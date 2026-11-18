@echo off
chcp 65001 >nul
setlocal
set "REPO=bug-deep/jarvis"
set "TARGET=%LOCALAPPDATA%\Jarvis"
set "ZIP=%TEMP%\jarvis-portable.zip"
set "CLOUD=%~1"

if "%CLOUD%"=="" set /p "CLOUD=Адрес сервера (Enter — пропустить): "

echo Скачиваю Джарвиса...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://github.com/%REPO%/releases/latest/download/Jarvis-portable-win64.zip' -OutFile '%ZIP%' -UseBasicParsing"
if not exist "%ZIP%" goto fail

if exist "%TARGET%" rmdir /s /q "%TARGET%"
echo Распаковываю...
powershell -NoProfile -Command "Expand-Archive -Path '%ZIP%' -DestinationPath '%LOCALAPPDATA%' -Force"

if not "%CLOUD%"=="" powershell -NoProfile -Command "@{cloudUrl='%CLOUD%';port=8095} | ConvertTo-Json | Set-Content -Encoding ASCII '%TARGET%\app\jarvis.json'"

powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Jarvis.lnk'); $s.TargetPath='%TARGET%\Jarvis.bat'; $s.WorkingDirectory='%TARGET%'; $s.IconLocation='%TARGET%\icon.ico'; $s.Save()"

start "" "%TARGET%\Jarvis.bat"
exit /b 0

:fail
echo Не получилось скачать. Проверь интернет и попробуй ещё раз.
pause
exit /b 1
