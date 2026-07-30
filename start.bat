@echo off
title Allure+ - Demarrage
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\Programs\nodejs;%PATH%"

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo  Node.js est requis pour lancer Allure+.
    echo  Installez-le depuis : https://nodejs.org/fr/download
    echo.
    start https://nodejs.org/fr/download
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo  Installation des modules npm...
    call npm install
    if errorlevel 1 (pause & exit /b 1)
)

taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul
if exist "server.log" del /f /q "server.log" >nul 2>&1

powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0start_server.ps1"

start "" cmd /c "timeout /t 8 /nobreak >nul & start http://localhost:3001"

echo.
echo  Allure+ demarre... (cette fenetre peut etre fermee)
echo.
timeout /t 5 /nobreak >nul
exit