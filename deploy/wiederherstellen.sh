#!/usr/bin/env bash
# BauTag – Wiederherstellung aus einer Sicherung (Schritt für Schritt: siehe ANLEITUNG.md, Abschnitt „Notfall“)
#
#   wiederherstellen.sh --liste                    verfügbare Stände anzeigen (lokal und extern)
#   wiederherstellen.sh --extern [SNAPSHOT]         aus der externen Sicherung (Standard: neuester Stand)
#   wiederherstellen.sh --datei <bautag-….db>        aus einer lokalen Sicherungsdatei
#   Zusatz: --ja  (ohne Rückfrage)
#
# Ablauf: Stand holen → prüfen (Integrität, Zeilenzahlen) → App anhalten → aktuelle Datenbank beiseitelegen
#         → Stand einspielen (Datenbank + Fotos) → App starten → Gesundheitsprüfung.
set -Eeuo pipefail
umask 077

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATEN="${BAUTAG_DATEN:-/var/lib/bautag/daten}"
SICHERUNG_HOST="${BAUTAG_SICHERUNG:-/var/lib/bautag/sicherung}"
RESTIC_ENV="${BAUTAG_RESTIC_ENV:-/etc/bautag/restic.env}"
IMAGE="${BAUTAG_IMAGE:-bautag:aktuell}"
COMPOSE=(docker compose -f "$DIR/docker-compose.yml")
APP_UID=1000

fehler() { echo "FEHLER: $*" >&2; exit 1; }
schritt() { printf '\n==> %s\n' "$*"; }

restic_laden() {
  [[ -f "$RESTIC_ENV" ]] || fehler "$RESTIC_ENV fehlt – externe Sicherung nicht eingerichtet (siehe SICHERHEIT.md)."
  set -a; # shellcheck disable=SC1090
  source "$RESTIC_ENV"; set +a
  command -v restic >/dev/null || fehler "restic ist nicht installiert (apt-get install restic)."
}

MODUS=""; WERT=""; JA=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --liste) MODUS=liste ;;
    --extern) MODUS=extern; if [[ "${2:-}" != "" && "${2:0:2}" != "--" ]]; then WERT="$2"; shift; fi ;;
    --datei) MODUS=datei; WERT="${2:-}"; shift ;;
    --ja) JA=1 ;;
    *) fehler "Unbekannte Angabe: $1" ;;
  esac
  shift
done
[[ -n "$MODUS" ]] || { sed -n '2,12p' "$0"; exit 2; }
[[ $EUID -eq 0 ]] || fehler "Bitte mit sudo ausführen."

if [[ "$MODUS" == liste ]]; then
  schritt "Lokale Stände ($SICHERUNG_HOST)"
  find "$SICHERUNG_HOST" -maxdepth 1 -name 'bautag-*.db' -printf '%f\n' 2>/dev/null | sort | grep . || echo "(keine)"
  if [[ -f "$RESTIC_ENV" ]]; then
    restic_laden
    schritt "Externe Stände ($RESTIC_REPOSITORY)"
    restic snapshots --tag bautag
  fi
  exit 0
fi

TMP="$(mktemp -d /tmp/bautag-wiederherstellung.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

schritt "1/6 Stand holen"
if [[ "$MODUS" == extern ]]; then
  restic_laden
  restic restore "${WERT:-latest}" --tag bautag --target "$TMP"
  DB="$(find "$TMP" -name 'bautag-*.db' -type f | sort | tail -n 1)"
else
  [[ -f "$WERT" ]] || fehler "Datei $WERT nicht gefunden."
  cp "$WERT" "$TMP/"
  DB="$TMP/$(basename "$WERT")"
  UP="$(dirname "$WERT")/uploads-$(basename "$WERT" .db | sed 's/^bautag-//').tar.gz"
  [[ -f "$UP" ]] && cp "$UP" "$TMP/"
fi
[[ -n "$DB" && -f "$DB" ]] || fehler "Keine Sicherungsdatei gefunden."
TAG="$(basename "$DB" .db | sed 's/^bautag-//')"
UPLOADS="$(find "$TMP" -name "uploads-$TAG.tar.gz" -type f | head -n 1)"
echo "Datenbank: $(basename "$DB")   Fotos: ${UPLOADS:+$(basename "$UPLOADS")}${UPLOADS:-keine}"

schritt "2/6 Stand prüfen (Integrität, Zeilenzahlen)"
chmod -R a+rX "$TMP"
PRUEF="$(docker run --rm --network none -v "$TMP":/pruefung:ro "$IMAGE" node server/sicherung.js pruefen "/pruefung${DB#"$TMP"}")" || true
echo "$PRUEF"
grep -q '"ok":true' <<< "$PRUEF" || fehler "Die Sicherung ist nicht in Ordnung – Wiederherstellung abgebrochen. Anderen Stand wählen (--liste)."

if [[ -z "$JA" ]]; then
  echo
  echo "ACHTUNG: Der aktuelle Datenstand wird durch den Stand vom $TAG ersetzt."
  echo "(Der bisherige Stand wird nicht gelöscht, sondern nach $DATEN/vorher-… verschoben.)"
  read -r -p "Zum Fortfahren JA eingeben: " antwort
  [[ "$antwort" == "JA" ]] || fehler "Abgebrochen."
fi

schritt "3/6 App anhalten"
"${COMPOSE[@]}" stop app || true

schritt "4/6 Bisherigen Stand beiseitelegen"
VORHER="$DATEN/vorher-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$VORHER"
for f in bautag.db bautag.db-wal bautag.db-shm uploads; do
  [[ -e "$DATEN/$f" ]] && mv "$DATEN/$f" "$VORHER/"
done
echo "Bisheriger Stand: $VORHER"

schritt "5/6 Stand einspielen"
mkdir -p "$DATEN"
cp "$DB" "$DATEN/bautag.db"
if [[ -n "$UPLOADS" ]]; then tar -xzf "$UPLOADS" -C "$DATEN"; fi
chown -R "$APP_UID:$APP_UID" "$DATEN"
chmod 700 "$DATEN"

schritt "6/6 App starten und prüfen"
"${COMPOSE[@]}" up -d
for _ in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T app node -e "fetch('http://127.0.0.1:3000/api/gesundheit').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "BauTag läuft wieder mit dem Stand vom $TAG."
    "${COMPOSE[@]}" exec -T app node server/sicherung.js status test ok "Wiederherstellung vom $TAG eingespielt" >/dev/null || true
    exit 0
  fi
  sleep 2
done
fehler "Die App startet nicht. Bisheriger Stand liegt in $VORHER (zurück: Dateien wieder nach $DATEN verschieben)."
