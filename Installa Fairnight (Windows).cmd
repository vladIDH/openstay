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
rem Qui PowerShell non è ancora partito e non sa la lingua di Windows: lo stesso in spagnolo.
echo Primero hay que extraer la carpeta del zip: desde dentro del zip Fairnight no se instala.
echo   1. Cierra esta ventana.
echo   2. Clic derecho en el archivo .zip descargado, luego «Extraer todo...» y «Extraer».
echo   3. En la carpeta extraída haz doble clic en «Installa Fairnight (Windows)».
echo.
pause
exit /b 1

:inatteso
echo.
echo L'installazione si è fermata per un problema imprevisto. I tuoi dati non sono stati toccati.
echo Scrivici a hello@khlumen.com con una foto di questa finestra e, se c'è, il file
echo installazione.log della cartella Fairnight del tuo utente: lo guardiamo noi.
echo.
echo La instalación se ha parado por un problema inesperado. Tus datos no se han tocado.
echo Escríbenos a hello@khlumen.com con una foto de esta ventana y, si existe, el archivo
echo installazione.log de la carpeta Fairnight de tu usuario: lo miramos nosotros.
echo.
rem Nelle prove automatiche nessuno può premere un tasto.
echo %* | find /i "-SenzaDomande" >nul || pause
exit /b 1
