@echo off
setlocal enabledelayedexpansion
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

REM Un "timeout /t 2" fixe ne garantissait pas que Windows ait vraiment
REM libere le port avant de relancer un nouveau node.exe (incident reel
REM 12/08 : un node.exe pas encore libere restait sur le port pendant
REM qu'un second etait lance en parallele, echouait a se lier, et plantait
REM silencieusement, laissant l'utilisateur sans le savoir sur l'ancienne
REM instance perimee). On attend maintenant explicitement que le port soit
REM libere, avec un plafond de 10s pour ne jamais bloquer indefiniment si
REM un processus refuse de mourir (droits, verrou...) - le serveur lui-meme
REM retente aussi plusieurs fois au demarrage en filet de securite (cf
REM server.js, EADDRINUSE).
REM
REM IMPORTANT : on ne tue QUE le(s) processus qui occupent le port
REM d'Allure+ (jamais "taskkill /IM node.exe", qui tuait TOUT node.exe de
REM la machine et cassait au passage n'importe quelle autre appli Node en
REM cours - incident du 27/08 avec un autre projet, Pilotage TST).
set "ALLURE_PORT=3001"
for /f "tokens=2 delims==" %%v in ('findstr /B /C:"PORT=" ".env" 2^>nul') do set "ALLURE_PORT=%%v"

for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%ALLURE_PORT% .*LISTENING"') do (
    taskkill /F /PID %%p >nul 2>&1
)
set "KILLWAIT=0"
:waitkill
netstat -ano | findstr /R /C:":%ALLURE_PORT% .*LISTENING" >nul
if not errorlevel 1 (
    set /a KILLWAIT+=1
    if !KILLWAIT! GEQ 10 goto :killdone
    timeout /t 1 /nobreak >nul
    goto :waitkill
)
:killdone
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