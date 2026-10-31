@echo off
rem DSH plugin installer: dsh-deepseek-usage-qwen
rem Double-click this file, or run it from cmd. It just calls install.ps1 beside it.
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo Installing dsh-deepseek-usage-qwen for DeepSeek Harness...
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