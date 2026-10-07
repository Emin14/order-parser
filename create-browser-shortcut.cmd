@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is not installed or not available in PATH.
    pause
    exit /b 1
)
node "%~dp0scripts\browser-launcher.cjs" shortcut
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%
