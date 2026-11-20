@echo off
rem CheCheng LINE Helper - backup tool for PCs WITHOUT the helper installed
rem Needs administrator rights (UAC prompt will appear).
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
echo ==================================================
echo   CheCheng LINE Helper (admin backup tool)
echo ==================================================
echo   1. Fix   - switch to TANet backup DNS + monitor 30 min
echo   2. Restore - restore original DNS
echo   3. Monitor only - do not change DNS
echo.
choice /c 123 /n /m "Select 1 / 2 / 3: "
if errorlevel 3 set MODE=monitor& goto run
if errorlevel 2 set MODE=restore& goto run
set MODE=fix
:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0LineHelper.ps1" -Mode %MODE%
echo.
echo Done. Log: C:\ProgramData\CheChengLineHelper\logs\helper.log
pause
