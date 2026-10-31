@echo off
rem ============================================================
rem  DSH plugin: dsh-deepseek-usage-qwen - OFFLINE installer
rem
rem  Usage:
rem    1. Put this file, install.ps1 and the .tgz in ONE folder
rem    2. Double-click this file
rem    3. Fully quit DeepSeek Harness (tray too) and open it again
rem
rem  It works without any network access to GitHub.
rem ============================================================
setlocal
chcp 65001 >nul
cd /d "%~dp0"

set "PS1=%~dp0install.ps1"
if not exist "%PS1%" (
  echo [x] install.ps1 not found next to this file: %PS1%
  pause
  exit /b 1
)

echo Installing dsh-deepseek-usage-qwen (offline mode)...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Offline %*
set RC=%ERRORLEVEL%

echo.
if "%RC%"=="0" (
  echo Done. Now FULLY quit DeepSeek Harness ^(including the tray icon^) and open it again.
) else (
  echo Installation failed with code %RC%. See the messages above.
)
pause
exit /b %RC%