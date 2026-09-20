@echo off
setlocal
title Video Downloader
cd /d "%~dp0"

rem Do not inherit incompatible PowerShell 7 modules from a parent process.
set "PSModulePath=%SystemRoot%\System32\WindowsPowerShell\v1.0\Modules;%ProgramFiles%\WindowsPowerShell\Modules"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows.ps1"
if errorlevel 1 goto fail

goto end

:fail
echo.
echo Startup preparation failed. See the error above for details.
pause
exit /b 1

:end
