@echo off
rem Doppio clic qui per installare o aggiornare Fairnight su Windows.
title Installa Fairnight
rem Le lettere accentate dei messaggi qui sotto.
chcp 65001 >nul

rem Aperto dentro lo zip senza estrarlo, Windows copia solo questo file: lo script accanto manca.
if not exist "%~dp0installa\windows.ps1" goto nonestratto

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installa\windows.ps1" %*
rem 0 = fatto; 2 = lo script ha già spiegato cosa non va; altro = PowerShell non è partito o si è fermato da solo.
if errorlevel 3 goto inatteso
if errorlevel 2 exit /b 2
if errorlevel 1 goto inatteso
exit /b 0

:nonestratto
echo.
echo Prima va estratta la cartella dallo zip: da dentro lo zip Fairnight non si installa.
echo   1. Chiudi questa finestra.
echo   2. Tasto destro sul file .zip scaricato, poi «Estrai tutto...» e «Estrai».
echo   3. Nella cartella estratta fai doppio clic su «Installa Fairnight (Windows)».
echo.
pause
exit /b 1

:inatteso
echo.
echo L'installazione si è fermata per un problema imprevisto. I tuoi dati non sono stati toccati.
echo Scrivici a hello@khlumen.com con una foto di questa finestra e, se c'è, il file
echo installazione.log della cartella Fairnight del tuo utente: lo guardiamo noi.
echo.
rem Nelle prove automatiche nessuno può premere un tasto.
echo %* | find /i "-SenzaDomande" >nul || pause
exit /b 1
