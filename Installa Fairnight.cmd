@echo off
rem Doppio clic qui per installare o aggiornare Fairnight su Windows.
title Installa Fairnight
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installa\windows.ps1" %*
