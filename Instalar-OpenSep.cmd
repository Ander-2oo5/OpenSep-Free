@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows.ps1"
if errorlevel 1 (
  echo.
  echo La instalacion no termino correctamente.
  pause
  exit /b 1
)
echo.
echo OpenSep esta listo. Ejecuta Iniciar-OpenSep.cmd
pause

