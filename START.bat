@echo off
echo ============================================================
echo PagerMon CAD Add-on
echo ============================================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed or not in PATH!
    echo Please run INSTALL.bat first.
    pause
    exit /b 1
)

REM Check if node_modules exists
if not exist "node_modules" (
    echo Dependencies not installed. Running npm install...
    call npm install
)

echo Starting CAD Add-on...
echo.
echo Dispatch Board: http://localhost:3001/cad
echo Live Map:       http://localhost:3001/map
echo.
echo Press Ctrl+C to stop the server.
echo ============================================================
echo.

node app.js
