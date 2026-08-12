@echo off
setlocal enabledelayedexpansion
title Allure+ - Installation

:: ═══════════════════════════════════════════════════════════
::  Auto-elevation admin (necesaire pour installer Node.js)
:: ═══════════════════════════════════════════════════════════
net session >nul 2>&1
if errorlevel 1 (
    echo  Elevation des privileges administrateur requise...
    set "VBSTMP=%TEMP%\uac_allure.vbs"
    echo Set UAC = CreateObject^("Shell.Application"^) > "%TEMP%\uac_allure.vbs"
    echo UAC.ShellExecute "%~f0", "", "%~dp0", "runas", 1 >> "%TEMP%\uac_allure.vbs"
    cscript //nologo "%TEMP%\uac_allure.vbs"
    del /f /q "%TEMP%\uac_allure.vbs" >nul 2>&1
    exit /b
)

cd /d "%~dp0"

echo.
echo  ===================================================
echo    Allure+ - Installation automatique
echo  ===================================================
echo.

:: ═══════════════════════════════════════════════════════════
::  ETAPE 1 : Node.js deja installe ?
:: ═══════════════════════════════════════════════════════════
set "PATH=C:\Program Files\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\Programs\nodejs;%PATH%"
where node >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=*" %%v in ('node --version 2^>nul') do set NODE_VER=%%v
    echo  [OK] Node.js est deja installe : !NODE_VER!
    goto :check_java
)

echo  [INFO] Node.js non detecte. Installation automatique...
echo.

:: ═══════════════════════════════════════════════════════════
::  ETAPE 2 : Essai via winget (Win 10/11 moderne - le plus simple)
:: ═══════════════════════════════════════════════════════════
where winget >nul 2>&1
if not errorlevel 1 (
    echo  [INFO] Installation via Windows Package Manager...
    winget install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    if not errorlevel 1 (
        :: Recharger PATH depuis le registre
        for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%b"
        set "PATH=!SYS_PATH!;%PATH%"
        where node >nul 2>&1
        if not errorlevel 1 (
            for /f "tokens=*" %%v in ('node --version 2^>nul') do set NODE_VER=%%v
            echo  [OK] Node.js installe via winget : !NODE_VER!
            goto :check_java
        )
    )
    echo  [WARN] winget indisponible ou a echoue, tentative par telechargement...
)

:: ═══════════════════════════════════════════════════════════
::  ETAPE 3 : Telechargement MSI depuis nodejs.org
::  (on ecrit un .ps1 temporaire pour eviter le probleme
::   d'expansion des variables $ par CMD)
:: ═══════════════════════════════════════════════════════════
echo  [INFO] Preparation du script de telechargement...

set "PS1=%TEMP%\allureplus_dl_node.ps1"
set "MSI=%TEMP%\node_setup.msi"

(
    echo $ErrorActionPreference = 'Stop'
    echo Write-Host '  Recherche de la derniere version LTS de Node.js...'
    echo $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
    echo $lts = $index ^| Where-Object { $_.lts -ne $false } ^| Select-Object -First 1
    echo $ver = $lts.version
    echo $url = 'https://nodejs.org/dist/' + $ver + '/node-' + $ver + '-x64.msi'
    echo Write-Host "  Version : $ver"
    echo Write-Host "  URL     : $url"
    echo Write-Host '  Telechargement en cours (quelques minutes)...'
    echo $wc = New-Object System.Net.WebClient
    echo $wc.DownloadFile^($url, '%MSI%'^)
    echo Write-Host '  Telechargement termine.'
) > "%PS1%"

echo  [INFO] Telechargement de Node.js LTS...
powershell -ExecutionPolicy Bypass -NoProfile -File "%PS1%"
set DL_ERR=%ERRORLEVEL%
del /f /q "%PS1%" >nul 2>&1

if %DL_ERR% neq 0 (
    echo.
    echo  [ERREUR] Le telechargement a echoue (code %DL_ERR%).
    echo  Verifiez votre connexion Internet.
    echo.
    echo  Installation manuelle : https://nodejs.org/fr/download
    start https://nodejs.org/fr/download
    pause
    exit /b 1
)

:: ═══════════════════════════════════════════════════════════
::  ETAPE 4 : Installation silencieuse du MSI
:: ═══════════════════════════════════════════════════════════
echo  [INFO] Installation de Node.js (mode silencieux)...
msiexec /i "%MSI%" /quiet /norestart ADDLOCAL=ALL
set MSI_ERR=%ERRORLEVEL%
del /f /q "%MSI%" >nul 2>&1

if %MSI_ERR% neq 0 (
    echo  [WARN] Installation silencieuse echouee (code %MSI_ERR%). Ouverture du mode normal...
    msiexec /i "%MSI%"
)

:: Recharger PATH depuis le registre systeme
for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%b"
set "PATH=C:\Program Files\nodejs;!SYS_PATH!;%APPDATA%\npm;%PATH%"

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [ERREUR] Node.js n'est pas detecte apres installation.
    echo  Fermez cette fenetre, REDEMARREZ votre PC, puis relancez install.bat
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version 2^>nul') do set NODE_VER=%%v
echo  [OK] Node.js installe avec succes : !NODE_VER!

:: ═══════════════════════════════════════════════════════════
::  ETAPE 5 : Java deja installe ? (necessaire pour BRouter,
::  la generation d'itineraires - voir brouter_manager.js)
:: ═══════════════════════════════════════════════════════════
:check_java
where java >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=*" %%v in ('java -version 2^>^&1 ^| findstr /i "version"') do set JAVA_VER=%%v
    echo  [OK] Java est deja installe : !JAVA_VER!
    goto :install_deps
)

echo  [INFO] Java non detecte (necessaire pour la generation d'itineraires BRouter). Installation automatique...
echo.

:: ═══════════════════════════════════════════════════════════
::  ETAPE 6 : Essai via winget (Eclipse Temurin JRE 21)
:: ═══════════════════════════════════════════════════════════
where winget >nul 2>&1
if not errorlevel 1 (
    echo  [INFO] Installation via Windows Package Manager...
    winget install -e --id EclipseAdoptium.Temurin.21.JRE --silent --accept-source-agreements --accept-package-agreements
    if not errorlevel 1 (
        for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%b"
        set "PATH=!SYS_PATH!;%PATH%"
        where java >nul 2>&1
        if not errorlevel 1 (
            echo  [OK] Java installe via winget.
            goto :install_deps
        )
    )
    echo  [WARN] winget indisponible ou a echoue, tentative par telechargement...
)

:: ═══════════════════════════════════════════════════════════
::  ETAPE 7 : Telechargement du MSI depuis l'API Adoptium (JRE
::  Temurin 21 - meme version que celle utilisee en developpement)
:: ═══════════════════════════════════════════════════════════
echo  [INFO] Preparation du script de telechargement...

set "PS1_JAVA=%TEMP%\allureplus_dl_java.ps1"
set "JRE_MSI=%TEMP%\jre_setup.msi"

(
    echo $ErrorActionPreference = 'Stop'
    echo Write-Host '  Telechargement du JRE Eclipse Temurin 21 ^(Adoptium^)...'
    echo $url = 'https://api.adoptium.net/v3/installer/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse?project=jdk'
    echo $wc = New-Object System.Net.WebClient
    echo $wc.DownloadFile^($url, '%JRE_MSI%'^)
    echo Write-Host '  Telechargement termine.'
) > "%PS1_JAVA%"

powershell -ExecutionPolicy Bypass -NoProfile -File "%PS1_JAVA%"
set DL_ERR_JAVA=%ERRORLEVEL%
del /f /q "%PS1_JAVA%" >nul 2>&1

if %DL_ERR_JAVA% neq 0 (
    echo.
    echo  [ERREUR] Le telechargement du JRE a echoue ^(code %DL_ERR_JAVA%^).
    echo  Verifiez votre connexion Internet.
    echo.
    echo  Installation manuelle : https://adoptium.net/temurin/releases/?package=jre
    start https://adoptium.net/temurin/releases/?package=jre
    pause
    exit /b 1
)

:: ═══════════════════════════════════════════════════════════
::  ETAPE 8 : Installation silencieuse du MSI
:: ═══════════════════════════════════════════════════════════
echo  [INFO] Installation du JRE ^(mode silencieux^)...
msiexec /i "%JRE_MSI%" /quiet /norestart
set JRE_MSI_ERR=%ERRORLEVEL%

if %JRE_MSI_ERR% neq 0 (
    echo  [WARN] Installation silencieuse echouee ^(code %JRE_MSI_ERR%^). Ouverture du mode normal...
    msiexec /i "%JRE_MSI%"
)
del /f /q "%JRE_MSI%" >nul 2>&1

:: Recharger PATH depuis le registre systeme
for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%b"
set "PATH=!SYS_PATH!;%PATH%"

where java >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [ERREUR] Java n'est pas detecte apres installation.
    echo  Fermez cette fenetre, REDEMARREZ votre PC, puis relancez install.bat
    echo  ^(la generation d'itineraires BRouter restera indisponible tant que Java n'est pas installe^)
    echo.
    pause
    goto :install_deps
)

echo  [OK] Java installe avec succes.

:: ═══════════════════════════════════════════════════════════
::  ETAPE 9 : Installer les dependances npm du projet
:: ═══════════════════════════════════════════════════════════
:install_deps
echo.
echo  [INFO] Verification des dependances npm...

if exist "package.json" (
    echo  [OK] package.json trouve.
) else (
    echo  [ERREUR] package.json introuvable dans %CD%
    pause
    exit /b 1
)

echo  [INFO] Installation/mise a jour des modules npm...
echo  (rapide si tout est deja a jour, plus long sinon)
echo.
:: Essai 1 : npm via PATH
call npm install 2>nul
if errorlevel 1 (
    :: Essai 2 : npm via chemin absolu (Node.js vient d'etre installe)
    if exist "C:\Program Files\nodejs\npm.cmd" (
        "C:\Program Files\nodejs\npm.cmd" install
    ) else if exist "%LOCALAPPDATA%\Programs\nodejs\npm.cmd" (
        "%LOCALAPPDATA%\Programs\nodejs\npm.cmd" install
    )
)
if exist "node_modules\" (
    echo  [OK] Modules npm a jour.
) else (
    echo  [ERREUR] npm install a echoue.
    echo  Verifiez votre connexion Internet et relancez install.bat
    pause
    exit /b 1
)
echo.


:: ═══════════════════════════════════════════════════════════
::  FIN
:: ═══════════════════════════════════════════════════════════
echo.
echo  ===================================================
:: Raccourci Bureau
echo  [INFO] Creation du raccourci bureau Allure+...
if exist "%~dp0creer_raccourci.ps1" (
    powershell -ExecutionPolicy Bypass -File "%~dp0creer_raccourci.ps1"
    if not errorlevel 1 echo  [OK] Raccourci Allure+ cree sur le Bureau.
)

echo    Installation terminee avec succes !
echo  ===================================================
echo.
echo  Double-cliquez sur start.bat pour demarrer Allure+
echo.

set /p LAUNCH="  Lancer Allure+ maintenant ? (O/N) : "
if /i "!LAUNCH!"=="O" (
    start "" /D "%~dp0" "%~dp0start.bat"
    exit /b 0
)

echo.
pause
exit /b 0
