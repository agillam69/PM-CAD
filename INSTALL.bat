@echo off
echo ============================================================
echo PagerMon CAD Add-on - Installation Script
echo ============================================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed or not in PATH!
    echo.
    echo Please install Node.js from: https://nodejs.org/
    echo Download the LTS version and run the installer.
    echo Make sure to check "Add to PATH" during installation.
    echo.
    echo After installing Node.js, run this script again.
    pause
    exit /b 1
)

echo Node.js found: 
node --version
echo.

echo Installing dependencies...
call npm install

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: npm install failed!
    pause
    exit /b 1
)

echo.
echo ============================================================
echo Installation complete!
echo ============================================================
echo.
echo To start the CAD add-on, run: START.bat
echo Or run: npm start
echo.
pause
