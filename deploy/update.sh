#!/usr/bin/env bash
# BauTag – Aktualisieren auf den neuesten Stand
#   sudo bash deploy/update.sh
# Ablauf: Sicherung vorher → neuen Programmstand holen → Container bauen → starten → Gesundheitsprüfung.
# Startet die neue Version nicht, wird automatisch auf die vorige Version (Container) zurückgeschaltet.
set -Eeuo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$DIR/.." && pwd)"
COMPOSE=(docker compose -f "$DIR/docker-compose.yml")
[[ $EUID -eq 0 ]] || { echo "Bitte mit sudo ausführen." >&2; exit 1; }

gesund() {
  for _ in $(seq 1 45); do
    if "${COMPOSE[@]}" exec -T app node -e "fetch('http://127.0.0.1:3000/api/gesundheit').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}

echo "==> 1/5 Sicherung vor dem Update"
bash "$DIR/backup.sh" --lokal
VORHER_DB="$(find /var/lib/bautag/sicherung -maxdepth 1 -name 'bautag-*.db' 2>/dev/null | sort | tail -n 1 || true)"

echo "==> 2/5 Neuen Programmstand holen"
cd "$REPO"
ALT="$(git rev-parse HEAD)"
git pull --ff-only
NEU="$(git rev-parse HEAD)"
if [[ "$ALT" == "$NEU" ]]; then echo "Bereits aktuell ($NEU)."; exit 0; fi
git log --oneline "$ALT..$NEU" | head -n 20

echo "==> 3/5 Container bauen (vorige Version bleibt als bautag:vorher)"
docker image inspect bautag:aktuell >/dev/null 2>&1 && docker tag bautag:aktuell bautag:vorher
"${COMPOSE[@]}" build app

echo "==> 4/5 Starten"
"${COMPOSE[@]}" up -d

echo "==> 5/5 Prüfen"
if gesund; then
  echo "Update erfolgreich: $ALT → $NEU"
  exit 0
fi

echo "FEHLER: Die neue Version startet nicht – schalte zurück auf die vorige Version." >&2
git reset --hard "$ALT"
docker tag bautag:vorher bautag:aktuell
"${COMPOSE[@]}" up -d --no-build
if gesund; then
  echo "Vorige Version läuft wieder ($ALT)."
else
  echo "Auch die vorige Version startet nicht." >&2
fi
cat >&2 <<EOF

Hinweis: Hat die neue Version die Datenbank bereits umgestellt (Migration), kann die vorige Version
damit Probleme haben. Dann den Stand von vor dem Update einspielen:
  sudo bash $DIR/wiederherstellen.sh --datei ${VORHER_DB:-/var/lib/bautag/sicherung/bautag-<Datum>.db}
Bitte den Fehler melden (Ausgabe von: docker compose -f $DIR/docker-compose.yml logs --tail 200 app).
EOF
exit 1
