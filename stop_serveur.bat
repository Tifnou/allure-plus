@echo off
title Allure+ - Arret du serveur
cd /d "%~dp0"

echo.
tasklist /FI "IMAGENAME eq node.exe" 2>nul | find /I "node.exe" >nul
if errorlevel 1 (
    echo  Aucun serveur Allure+ (node.exe) n'est en cours d'execution.
    echo.
    pause
    exit /b 0
)

echo  Arret du serveur en cours...
taskkill /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul

tasklist /FI "IMAGENAME eq node.exe" 2>nul | find /I "node.exe" >nul
if not errorlevel 1 (
    echo  Le serveur ne repond pas, arret forcé...
    taskkill /F /IM node.exe >nul 2>&1
)

echo.
echo  Serveur Allure+ arrete.
echo.
pause
