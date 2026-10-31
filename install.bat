@echo off
rem DSH plugin installer: dsh-usage-wallet
rem Double-click this file, or run it from cmd. It just calls install.ps1 beside it.
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo Installing dsh-usage-wallet for DeepSeek Harness...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set RC=%ERRORLEVEL%

echo.
if "%RC%"=="0" (
  echo Done. Please FULLY quit and reopen DeepSeek Harness.
) else (
  echo Installation failed with code %RC%. See the messages above.
)
pause
exit /b %RC%