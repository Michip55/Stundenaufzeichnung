#!/bin/bash
# BauTag – Testversion per Doppelklick starten (macOS)
cd "$(dirname "$0")/app" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js ist noch nicht installiert. Bitte von https://nodejs.org die Version \"LTS\" installieren und diese Datei erneut doppelklicken."
  open https://nodejs.org; read -r -p "Enter zum Schliessen"; exit 1
fi
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo "Node.js ist zu alt – bitte die aktuelle LTS von https://nodejs.org installieren."; open https://nodejs.org; read -r -p "Enter"; exit 1
fi
[ -d node_modules ] || { echo "Erster Start: Programmteile werden geladen …"; npm install --no-audit --no-fund || { read -r -p "Fehler – Enter"; exit 1; }; }
export BAUTAG_DEMO=1
[ -f data/bautag.db ] || npm run seed
echo; echo "BauTag läuft: http://localhost:3000  –  Anmelden mit Namen und PIN 1234 (Testdaten). Fenster offen lassen."; echo
(sleep 4; open http://localhost:3000) &
node server/index.js
