@echo off
chcp 65001 >nul
title BauTag - Testdaten zuruecksetzen
cd /d "%~dp0app"
echo.
echo  Damit werden ALLE Daten der Testversion auf diesem PC geloescht
echo  ^(Stempelungen, Berichte, Aenderungen^). Beim naechsten Start mit
echo  "BauTag-starten-Windows.bat" werden frische Beispieldaten angelegt.
echo.
echo  Vorher das BauTag-Fenster schliessen!
echo  Die echten Firmendaten auf dem Server sind davon NICHT betroffen.
echo.
set /p ANTWORT=  Wirklich zuruecksetzen? Bitte JA eingeben: 
if /i not "%ANTWORT%"=="JA" (
  echo  Abgebrochen - nichts geloescht.
  pause
  exit /b 0
)
if exist data\bautag.db del /q data\bautag.db
if exist data\bautag.db-wal del /q data\bautag.db-wal
if exist data\bautag.db-shm del /q data\bautag.db-shm
if exist data\uploads rmdir /s /q data\uploads
if exist data\bautag.db (
  echo  Die Datei ist noch in Verwendung. Bitte das BauTag-Fenster schliessen und erneut versuchen.
  pause
  exit /b 1
)
echo  Erledigt. Jetzt "BauTag-starten-Windows.bat" doppelklicken.
pause
