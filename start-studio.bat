@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo   Personal Pixel Studio
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo Install LTS from https://nodejs.org/ then run this file again.
  echo.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm not found. Reinstall Node.js LTS.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo First run: installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
  echo.
)

echo Freeing port 5173 if busy...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING"') do (
  echo Killing PID %%P
  taskkill /F /PID %%P >nul 2>&1
)

echo Starting server at http://127.0.0.1:5173/
echo Keep this window open while using Studio.
echo Stop with Ctrl+C
echo.

start "pps-open-browser" /min cmd /c "ping -n 4 127.0.0.1 >nul & start http://127.0.0.1:5173/"

call npm.cmd run dev -- --host 127.0.0.1 --port 5173

echo.
echo Server stopped.
pause
endlocal
