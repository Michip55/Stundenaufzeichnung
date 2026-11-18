@echo off
chcp 65001 >nul
title BauTag - Testversion
cd /d "%~dp0app"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js ist noch nicht installiert.
  echo  Bitte auf der Seite, die sich gleich oeffnet, die Version "LTS" herunterladen,
  echo  installieren ^(immer "Weiter"^) und danach diese Datei erneut doppelklicken.
  echo.
  start "" https://nodejs.org
  pause
  exit /b 1
)

for /f "tokens=1 delims=v." %%v in ('node -v') do set NODEVERSION=%%v
if %NODEVERSION% LSS 22 (
  echo  Ihre Node.js-Version ist zu alt. Bitte von https://nodejs.org die aktuelle "LTS" installieren.
  start "" https://nodejs.org
  pause
  exit /b 1
)

rem N-046: auch nach einem Update ^(neue oder geaenderte Programmteile^) npm install ausfuehren, nicht nur beim ersten Start
node server\abhaengigkeiten.js >nul 2>nul
if errorlevel 1 (
  echo  Programmteile werden geladen bzw. aktualisiert ^(1-2 Minuten, Internet noetig^) ...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto fehler
)

set BAUTAG_DEMO=1
if not exist data\bautag.db (
  echo  Testdaten werden angelegt ...
  call npm run seed
  if errorlevel 1 goto fehler
)

echo.
echo  ==============================================================
echo   BauTag laeuft:  http://localhost:3000
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo   Handy im selben WLAN:%%a:3000  ^(vorne http:// eintippen^)
echo   Anmelden mit einem Namen und der PIN 1234 ^(nur Testdaten^)
echo   Dieses Fenster offen lassen. Beenden: Fenster schliessen.
echo  ==============================================================
echo.
start "" /b cmd /c "timeout /t 4 >nul & start "" http://localhost:3000"
node server\index.js
goto ende

:fehler
echo.
echo  Es ist ein Fehler aufgetreten. Bitte ein Foto dieses Fensters an Claude schicken.
:ende
pause
