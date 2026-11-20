#!/usr/bin/env bash
# BauTag – Aktualisieren auf den neuesten Stand
#   sudo bash deploy/update.sh
# Ablauf: Sicherung vorher → neuen Programmstand holen → Container bauen → starten → Gesundheitsprüfung.
# Startet die neue Version nicht, wird automatisch auf die vorige Version (Container) zurückgeschaltet.
#
# N-030: Ob gebaut werden muss, entscheidet die Revision, aus der das laufende Image gebaut wurde (Label
#        org.opencontainers.image.revision), nicht nur „git pull hat etwas gebracht“. Scheitert der Bau,
#        wird der Programmstand auf den vorigen zurückgesetzt; der nächste Aufruf versucht es erneut.
#        „Bereits aktuell“ nur, wenn zusätzlich der LAUFENDE Container genau dieses Image verwendet (Image-ID per
#        docker inspect) – wurde ein Lauf nach dem Bau und vor „up -d“ abgebrochen, startet der nächste das Image.
# N-031: Die Caddyfile ist als Einzeldatei eingebunden – nach jeder Änderung wird Caddy neu erstellt.
# 15.33: einmalige Umstellung BAUTAG_LOGIN_LISTE=1 → 0 in deploy/.env (namensliste-umstellen.sh), siehe Schritt 2/5.
#        Nachprüfung: Hat git pull update.sh selbst geändert, läuft das Update mit der neuen Fassung weiter (exec, Schutzvariable
#        BAUTAG_UPDATE_NEUSTART = Programmstand vor dem Pull) – bash läse sonst die alte, schon geöffnete Fassung zu Ende.
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

# Image-ID, mit der der Container „app“ gerade läuft (leer, wenn er nicht läuft)
laufendes_image() {
  local c
  c="$("${COMPOSE[@]}" ps -q app 2>/dev/null | head -n 1 || true)"
  [[ -n "$c" ]] || return 0
  docker inspect --format '{{.Image}}' "$c" 2>/dev/null || true
  return 0
}

# Image-ID von bautag:aktuell (leer, wenn es fehlt)
aktuelles_image() {
  docker image inspect bautag:aktuell --format '{{.Id}}' 2>/dev/null || true
  return 0
}

# Läuft Caddy mit der aktuellen Caddyfile? Sonst neu erstellen (ein Neuladen liest die alte Datei weiter).
caddy_abgleichen() {
  if "${COMPOSE[@]}" exec -T caddy cat /etc/caddy/Caddyfile 2>/dev/null | cmp -s - "$DIR/Caddyfile"; then return 0; fi
  echo "Caddyfile geändert – Webserver (Caddy) wird neu erstellt."
  "${COMPOSE[@]}" up -d --no-deps --force-recreate caddy || echo "WARNUNG: Caddy konnte nicht neu erstellt werden – bitte: ${COMPOSE[*]} up -d --force-recreate caddy" >&2
}

NEUSTART="${BAUTAG_UPDATE_NEUSTART:-}"
unset BAUTAG_UPDATE_NEUSTART
if [[ -n "$NEUSTART" && ! "$NEUSTART" =~ ^[0-9a-f]{40}$ ]]; then echo "BAUTAG_UPDATE_NEUSTART ungültig – bitte ohne diese Variable aufrufen." >&2; exit 1; fi

if [[ -z "$NEUSTART" ]]; then
  echo "==> 1/5 Sicherung vor dem Update"
  bash "$DIR/backup.sh" --lokal
fi
VORHER_DB="$(find /var/lib/bautag/sicherung -maxdepth 1 -name 'bautag-*.db' 2>/dev/null | sort | tail -n 1 || true)"

if [[ -z "$NEUSTART" ]]; then echo "==> 2/5 Neuen Programmstand holen"; fi
cd "$REPO"
ALT="${NEUSTART:-$(git rev-parse HEAD)}"
GEBAUT="$(gebaute_revision)"
if [[ -z "$NEUSTART" ]]; then
  git pull --ff-only
  # Nachprüfung 15.33: update.sh selbst geändert → mit der neuen Fassung weitermachen (Sicherung ist schon gemacht)
  if [[ "$ALT" != "$(git rev-parse HEAD)" ]] && ! git diff --quiet "$ALT" HEAD -- deploy/update.sh; then
    echo "update.sh wurde mit dem Programmstand erneuert – das Update läuft mit der neuen Fassung weiter."
    BAUTAG_UPDATE_NEUSTART="$ALT" exec bash "$DIR/update.sh" "$@"
  fi
fi
NEU="$(git rev-parse HEAD)"
# 15.33: EINMALIG – eine aus der alten Vorlage stammende Zeile BAUTAG_LOGIN_LISTE=1 auf 0 (Namensliste aus); Sicherung der .env
# vorher, Rechte nur für root, Merkzeile „# 15.33 Namensliste aus …“ – danach bleibt eine bewusst gesetzte 1 unangetastet
ENV_NEU=0
if [[ -f "$DIR/namensliste-umstellen.sh" ]]; then
  bash "$DIR/namensliste-umstellen.sh" "$DIR/.env" || { rc=$?; if [[ $rc == 3 ]]; then ENV_NEU=1; else echo "WARNUNG: Umstellung der Namensliste (15.33) fehlgeschlagen (Code $rc) – .env unverändert." >&2; fi; }
fi
LAEUFT="$(laufendes_image)"
BAUEN=1
if [[ "$GEBAUT" == "$NEU" ]]; then
  if [[ -n "$LAEUFT" && "$LAEUFT" == "$(aktuelles_image)" ]]; then
    echo "Bereits aktuell ($NEU)."
    if [[ "$ENV_NEU" == 1 ]]; then
      # 15.33: geänderte Einstellungen gelten erst nach dem Neuerstellen des Containers
      echo "Einstellungen geändert – App wird mit der neuen .env neu gestartet."
      "${COMPOSE[@]}" up -d --no-build app
      gesund || echo "WARNUNG: App antwortet nach dem Neustart nicht – bitte prüfen: ${COMPOSE[*]} logs --tail 200 app" >&2
    fi
    caddy_abgleichen
    exit 0
  fi
  # N-030: gebaut, aber nicht gestartet (z. B. Abbruch nach dem Bau) bzw. Container läuft nicht → starten, nicht bauen
  echo "Programmstand $NEU ist gebaut, läuft aber noch nicht (laufendes Image: ${LAEUFT:-keines}) – wird jetzt gestartet."
  BAUEN=0
elif [[ "$ALT" == "$NEU" ]]; then
  echo "Programmstand $NEU ist noch nicht gebaut (Image: ${GEBAUT:-unbekannt}) – wird jetzt gebaut."
else
  git log --oneline "$ALT..$NEU" | head -n 20
fi

echo "==> 3/5 Container bauen (laufende Version bleibt als bautag:vorher)"
# Zurückschalten auf das Image, mit dem der Container läuft – nicht auf ein gebautes, aber nie gestartetes
if [[ -n "$LAEUFT" ]]; then docker tag "$LAEUFT" bautag:vorher
elif docker image inspect bautag:aktuell >/dev/null 2>&1; then docker tag bautag:aktuell bautag:vorher; fi
export BAUTAG_REVISION="$NEU"
if [[ "$BAUEN" == 0 ]]; then
  echo "Bereits gebaut – kein neuer Bau nötig."
elif ! "${COMPOSE[@]}" build app; then
  echo "FEHLER: Die neue Version ließ sich nicht bauen – die bisherige Version läuft unverändert weiter." >&2
  if [[ "$ALT" != "$NEU" ]]; then git reset --hard "$ALT" >/dev/null; fi
  echo "Programmstand zurückgesetzt auf $ALT. Der nächste Aufruf von update.sh versucht es erneut." >&2
  echo "Bitte den Fehler melden (Ausgabe oben)." >&2
  exit 1
fi

echo "==> 4/5 Starten"
# Läuft der Container schon mit dem neuen Image, ist „up -d“ ohne Wirkung; sonst wird er neu erstellt
if [[ "$(laufendes_image)" != "$(aktuelles_image)" ]]; then echo "Container wird mit dem neuen Image gestartet."; fi
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
