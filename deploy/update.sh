#!/usr/bin/env bash
# BauTag – Aktualisieren auf den neuesten Stand
#   sudo bash deploy/update.sh
# Ablauf: Sicherung vorher → neuen Programmstand holen → Container bauen → starten → Gesundheitsprüfung.
# Startet die neue Version nicht, wird automatisch auf die vorige Version (Container) zurückgeschaltet.
#
# N-030: Ob gebaut werden muss, entscheidet die Revision, aus der das laufende Image gebaut wurde (Label
#        org.opencontainers.image.revision), nicht nur „git pull hat etwas gebracht“. Scheitert der Bau,
#        wird der Programmstand auf den vorigen zurückgesetzt; der nächste Aufruf versucht es erneut.
# N-031: Die Caddyfile ist als Einzeldatei eingebunden – nach jeder Änderung wird Caddy neu erstellt.
set -Eeuo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$DIR/.." && pwd)"
COMPOSE=(docker compose -f "$DIR/docker-compose.yml")
REV_LABEL=org.opencontainers.image.revision
[[ $EUID -eq 0 ]] || { echo "Bitte mit sudo ausführen." >&2; exit 1; }

gesund() {
  for _ in $(seq 1 "${BAUTAG_GESUND_VERSUCHE:-45}"); do
    if "${COMPOSE[@]}" exec -T app node -e "fetch('http://127.0.0.1:3000/api/gesundheit').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}

# Revision, aus der das Image bautag:aktuell gebaut wurde (leer, wenn unbekannt)
gebaute_revision() {
  local r
  r="$(docker image inspect bautag:aktuell --format "{{ index .Config.Labels \"$REV_LABEL\" }}" 2>/dev/null || true)"
  if [[ "$r" =~ ^[0-9a-f]{40}$ ]]; then printf '%s' "$r"; fi
  return 0
}

# Läuft Caddy mit der aktuellen Caddyfile? Sonst neu erstellen (ein Neuladen liest die alte Datei weiter).
caddy_abgleichen() {
  if "${COMPOSE[@]}" exec -T caddy cat /etc/caddy/Caddyfile 2>/dev/null | cmp -s - "$DIR/Caddyfile"; then return 0; fi
  echo "Caddyfile geändert – Webserver (Caddy) wird neu erstellt."
  "${COMPOSE[@]}" up -d --no-deps --force-recreate caddy || echo "WARNUNG: Caddy konnte nicht neu erstellt werden – bitte: ${COMPOSE[*]} up -d --force-recreate caddy" >&2
}

echo "==> 1/5 Sicherung vor dem Update"
bash "$DIR/backup.sh" --lokal
VORHER_DB="$(find /var/lib/bautag/sicherung -maxdepth 1 -name 'bautag-*.db' 2>/dev/null | sort | tail -n 1 || true)"

echo "==> 2/5 Neuen Programmstand holen"
cd "$REPO"
ALT="$(git rev-parse HEAD)"
GEBAUT="$(gebaute_revision)"
git pull --ff-only
NEU="$(git rev-parse HEAD)"
if [[ "$GEBAUT" == "$NEU" ]]; then
  echo "Bereits aktuell ($NEU)."
  caddy_abgleichen
  exit 0
fi
if [[ "$ALT" == "$NEU" ]]; then
  echo "Programmstand $NEU ist noch nicht gebaut (laufender Container: ${GEBAUT:-unbekannt}) – wird jetzt gebaut."
else
  git log --oneline "$ALT..$NEU" | head -n 20
fi

echo "==> 3/5 Container bauen (vorige Version bleibt als bautag:vorher)"
if docker image inspect bautag:aktuell >/dev/null 2>&1; then docker tag bautag:aktuell bautag:vorher; fi
export BAUTAG_REVISION="$NEU"
if ! "${COMPOSE[@]}" build app; then
  echo "FEHLER: Die neue Version ließ sich nicht bauen – die bisherige Version läuft unverändert weiter." >&2
  if [[ "$ALT" != "$NEU" ]]; then git reset --hard "$ALT" >/dev/null; fi
  echo "Programmstand zurückgesetzt auf $ALT. Der nächste Aufruf von update.sh versucht es erneut." >&2
  echo "Bitte den Fehler melden (Ausgabe oben)." >&2
  exit 1
fi

echo "==> 4/5 Starten"
if "${COMPOSE[@]}" up -d; then
  echo "==> 5/5 Prüfen"
  if gesund; then
    caddy_abgleichen
    echo "Update erfolgreich: $ALT → $NEU"
    exit 0
  fi
fi

echo "FEHLER: Die neue Version startet nicht – schalte zurück auf die vorige Version." >&2
git reset --hard "$ALT"
if docker image inspect bautag:vorher >/dev/null 2>&1; then docker tag bautag:vorher bautag:aktuell; fi
"${COMPOSE[@]}" up -d --no-build || true
caddy_abgleichen
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
