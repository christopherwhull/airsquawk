@echo off
REM Aircraft Dashboard Server Restart Script
REM This script restarts the Node.js server for the aircraft dashboard

echo ==================================================
echo Aircraft Dashboard - Server Restart Script
echo ==================================================

REM Change to the script directory
cd /d "%~dp0"

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo Error: Python is not installed or not in PATH
    pause
    exit /b 1
)

REM Check if start_server.py exists
if not exist "start_server.py" (
    echo Error: start_server.py not found in current directory
    pause
    exit /b 1
)

echo Restarting server...
python start_server.py

if errorlevel 1 (
    echo Error restarting server
    pause
    exit /b 1
)

echo Server restart completed successfully!
pause