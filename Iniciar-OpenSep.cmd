@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules" (
  echo OpenSep no esta instalado. Ejecutando el instalador...
  call "%~dp0Instalar-OpenSep.cmd"
  if errorlevel 1 exit /b 1
)
start "OpenSep navegador" cmd /c "timeout /t 5 /nobreak >nul && start http://127.0.0.1:5173"
npm run dev

