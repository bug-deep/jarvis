@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "node\node.exe" (
  echo Не найден node\node.exe. Распакуй архив целиком, не по одному файлу.
  pause
  exit /b 1
)

start "Jarvis" /min "%~dp0node\node.exe" "%~dp0app\src\main.js" app
timeout /t 3 /nobreak >nul

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" --app=http://127.0.0.1:8095 --user-data-dir="%LOCALAPPDATA%\Jarvis\chrome-profile" --window-size=1180,800 --no-first-run --no-default-browser-check
) else (
  start "" http://127.0.0.1:8095
)
exit /b 0
