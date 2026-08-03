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

REM Chrome en priorite (navigateur habituel), Edge en secours (toujours
REM present sur Windows 10/11), sinon le navigateur par defaut dans un
REM onglet classique. Les deux supportent le "mode app" (--app=URL) qui
REM ouvre une fenetre sans barre d'adresse ni onglets.
set "APP_BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%APP_BROWSER%" set "APP_BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%APP_BROWSER%" set "APP_BROWSER=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not exist "%APP_BROWSER%" set "APP_BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%APP_BROWSER%" set "APP_BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

start "" powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0open_browser.ps1" -BrowserPath "%APP_BROWSER%"

echo.
echo  Allure+ demarre... (cette fenetre peut etre fermee)
echo.
timeout /t 3 /nobreak >nul
exit