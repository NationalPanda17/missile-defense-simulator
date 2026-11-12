@echo off
rem Double-click this file to start the Missile Defense Simulator with its local save server.
rem First run: installs what the game needs (a few minutes). Leave this window open while you play;
rem close it (or press Ctrl+C) to stop.
cd /d "%~dp0"
title Missile Defense Simulator - local server
echo ==================================================
echo   Missile Defense Simulator - local server
echo ==================================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed yet.
  echo Install it from https://nodejs.org ^(the 'LTS' version^), then double-click this file again.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)
for /f "usebackq delims=" %%v in (`node -p "process.versions.node.split('.')[0]"`) do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 22 (
  echo Your Node.js is too old. Version 22 or newer is needed.
  echo Install the 'LTS' version from https://nodejs.org, then double-click this file again.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)
if not exist node_modules (
  echo First-time setup: installing what the game needs. This can take a few minutes...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo Setup did not finish. Check your internet connection and try again.
    pause
    exit /b 1
  )
)
echo Starting the game and its save server...
echo Your browser will open at http://localhost:5173 in a few seconds.
echo Keep this window open while you play. Close it to stop.
echo.
rem MDS_NO_BROWSER=1 skips opening the browser and MDS_NO_PAUSE=1 skips the final pause (used by automated checks).
if not "%MDS_NO_BROWSER%"=="1" start "" /min cmd /c "timeout /t 8 >nul & start http://localhost:5173"
call npm run dev:full
if not "%MDS_NO_PAUSE%"=="1" pause
