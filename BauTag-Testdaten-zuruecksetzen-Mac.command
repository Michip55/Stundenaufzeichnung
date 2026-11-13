#!/bin/bash
cd "$(dirname "$0")/app" || exit 1
echo
echo " Damit werden ALLE Daten der Testversion auf diesem Mac geloescht."
echo " Beim naechsten Start werden frische Beispieldaten angelegt."
echo " Vorher das BauTag-Fenster schliessen! Echte Firmendaten auf dem Server sind nicht betroffen."
echo
read -r -p " Wirklich zuruecksetzen? Bitte JA eingeben: " ANTWORT
if [ "$(printf '%s' "$ANTWORT" | tr '[:lower:]' '[:upper:]')" != "JA" ]; then
  echo " Abgebrochen - nichts geloescht."; exit 0
fi
rm -f data/bautag.db data/bautag.db-wal data/bautag.db-shm
rm -rf data/uploads
echo " Erledigt. Jetzt BauTag-starten-Mac.command doppelklicken."
