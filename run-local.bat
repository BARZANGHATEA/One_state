@echo off
rem Optional: run the daily job on this PC instead of GitHub (uses your installed Chrome).
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules\playwright-core (call npm install --no-audit --no-fund)
if "%CHROME_PATH%"=="" set CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
node automation\run.js
