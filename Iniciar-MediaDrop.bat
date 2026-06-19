@echo off
cd /d "%~dp0MediaDrop"
echo Iniciando MediaDrop...
echo.
echo O navegador vai abrir em alguns segundos.
echo Mantenha esta janela aberta enquanto estiver usando o sistema.
echo.
start "" cmd /c "timeout /t 3 >nul && start "" http://localhost:3000"
npm.cmd start
pause
