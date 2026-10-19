@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js nasb nist. Az https://nodejs.org nasb konid. & pause & exit /b 1)
if not exist .env (echo File .env peyda nashod. .env.example ra copy va por konid. & pause & exit /b 1)
if not exist node_modules\playwright-core (echo Installing... & call npm install --no-audit --no-fund)
set /p ACC=Account name (e.g. acc1):
node scripts\login.js %ACC%
pause
