@echo off
echo.
echo  =====================================
echo    CarouselMed - Iniciando servidor...
echo  =====================================
echo.
echo  Abrindo em http://localhost:3001
echo.
start "" "http://localhost:3001"
node "%~dp0server.js"
pause
