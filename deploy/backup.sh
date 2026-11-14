#!/usr/bin/env bash
# BauTag – Datensicherung nach der 3-2-1-Regel (siehe SICHERHEIT.md)
#
#   backup.sh            tägliche Sicherung: (a) lokaler Stand + (b) verschlüsselte externe Kopie (restic);
#                        sonntags zusätzlich der Wiederherstellungstest
#   backup.sh --test     nur Wiederherstellungstest (neueste Datenbank → Probeordner → Integritätsprüfung)
#   backup.sh --lokal    nur lokaler Stand
#
# Ergebnis jedes Schritts wird in die App gemeldet (Status „Sicherung“); die App alarmiert die
# Geschäftsführung (In-App + E-Mail), wenn ein Schritt scheitert oder die letzte Sicherung älter als 26 Std. ist.
# Ist die App selbst nicht erreichbar, geht der Alarm per sendmail an ALARM_EMAIL (Mailprogramm nötig, ANLEITUNG.md).
#
# Fotos/Dokumente liegen lokal als EIN Spiegel (uploads-spiegel/, inkrementell); die Versionen hält restic
# dedupliziert (N-011). Der Wiederherstellungstest holt nur die Datenbanken – nicht alle Fotos.
set -Eeuo pipefail
umask 077
# N-067: cron setzt nur PATH=/usr/bin:/bin – sendmail liegt in /usr/sbin
PATH="${PATH:-/usr/bin:/bin}:/usr/local/sbin:/usr/sbin:/sbin"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="${BAUTAG_LOG:-/var/log/bautag-sicherung.log}"
SICHERUNG_HOST="${BAUTAG_SICHERUNG:-/var/lib/bautag/sicherung}"   # Ordner auf dem Server
SICHERUNG_APP="${BAUTAG_SICHERUNG_APP:-/sicherung}"                 # derselbe Ordner im Container
UPLOADS_APP="${BAUTAG_UPLOADS_APP:-/daten/uploads}"
RESTIC_ENV="${BAUTAG_RESTIC_ENV:-/etc/bautag/restic.env}"
RESTIC="${RESTIC:-restic}"
IMAGE="${BAUTAG_IMAGE:-bautag:aktuell}"
# Befehl für server/sicherung.js (Standard: im laufenden Container); für Tests überschreibbar
read -r -a SICHERUNG_CMD <<< "${BAUTAG_SICHERUNG_CMD:-docker compose -f $DIR/docker-compose.yml exec -T app node server/sicherung.js}"

PROBE_ORDNER=""
aufraeumen() { [[ -n "$PROBE_ORDNER" ]] && rm -rf "$PROBE_ORDNER"; return 0; }
trap aufraeumen EXIT

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG" >&2; }

# .env lesen (nur ALARM_EMAIL, BAUTAG_DOMAIN) – ohne die Datei auszuführen
env_wert() {
  local datei="$DIR/.env"
  [[ -f "$datei" ]] || return 0
  sed -n "s/^$1=//p" "$datei" | tail -n 1
}
ALARM_EMAIL="${ALARM_EMAIL:-$(env_wert ALARM_EMAIL)}"

melden() { # art ok|fehler text
  if ! "${SICHERUNG_CMD[@]}" status "$1" "$2" "$3" >/dev/null 2>&1; then
    log "WARNUNG: Status konnte nicht an die App gemeldet werden ($1 $2)."
    [[ "$2" == ok ]] || notmail "BauTag: Sicherung ($1) fehlgeschlagen" "$3 (App nicht erreichbar)"
    return 0
  fi
}

notmail() { # Betreff Text – Notfall-Alarm ohne App
  if [[ -n "$ALARM_EMAIL" ]] && command -v sendmail >/dev/null 2>&1; then
    printf 'To: %s\nSubject: %s\nContent-Type: text/plain; charset=UTF-8\n\n%s\n\nServer: %s\nZeit: %s\n' \
      "$ALARM_EMAIL" "$1" "$2" "$(hostname)" "$(date)" | sendmail -t || log "sendmail fehlgeschlagen"
  else
    log "Kein Notfall-Versand möglich (ALARM_EMAIL leer oder sendmail fehlt): $1"
  fi
}

restic_bereit() {
  [[ -f "$RESTIC_ENV" ]] || return 1
  set -a; # shellcheck disable=SC1090
  source "$RESTIC_ENV"; set +a
  [[ -n "${RESTIC_REPOSITORY:-}" ]] && command -v "$RESTIC" >/dev/null 2>&1
}

lokal() {
  log "Lokale Sicherung nach $SICHERUNG_HOST …"
  local aus
  if aus="$("${SICHERUNG_CMD[@]}" sichern "$SICHERUNG_APP" --uploads "$UPLOADS_APP" 2>&1)"; then
    log "Lokal ok: $aus"
  else
    log "FEHLER lokal: $aus"
    melden lokal fehler "Lokale Sicherung fehlgeschlagen: ${aus:0:300}"
    return 1
  fi
}

offsite() {
  if ! restic_bereit; then
    log "Externe Sicherung nicht eingerichtet ($RESTIC_ENV fehlt oder restic nicht installiert) – übersprungen."
    melden offsite fehler "Externe Sicherung nicht eingerichtet (siehe SICHERHEIT.md)"
    return 0
  fi
  log "Externe Sicherung nach $RESTIC_REPOSITORY …"
  local aus aus2=""
  if aus="$("$RESTIC" backup "$SICHERUNG_HOST" --tag bautag --host bautag 2>&1)" \
     && aus2="$("$RESTIC" forget --tag bautag --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune 2>&1)"; then
    log "Extern ok."
    melden offsite ok "restic: $(printf '%s' "$aus" | grep -m1 -o 'snapshot [0-9a-f]* saved' || echo gesichert)"
  else
    log "FEHLER extern: $aus ${aus2:-}"
    melden offsite fehler "Externe Sicherung fehlgeschlagen: ${aus:0:300}"
    return 1
  fi
}

pruefe_datei() { # Probeordner Datei → JSON
  # G-10: mktemp legt den Ordner als root mit 0700 an – der Container läuft als „node“ (uid 1000) und braucht Leserechte
  chmod -R a+rX "$1"
  if [[ -n "${BAUTAG_PRUEF_CMD:-}" ]]; then
    read -r -a cmd <<< "$BAUTAG_PRUEF_CMD"
    "${cmd[@]}" "$2"
  else
    docker run --rm --network none -v "$1":/pruefung:ro "$IMAGE" node server/sicherung.js pruefen "/pruefung${2#"$1"}"
  fi
}

wiederherstellungstest() {
  local tmp quelle datei aus
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/bautag-probe.XXXXXX")"
  PROBE_ORDNER="$tmp"
  if restic_bereit; then
    quelle="extern (restic)"
    # N-011: nur die Datenbank-Stände zurückholen, nicht den ganzen Snapshot samt Fotos
    if ! aus="$("$RESTIC" restore latest --tag bautag --target "$tmp" --include "$SICHERUNG_HOST/bautag-*.db" 2>&1)"; then
      log "FEHLER Wiederherstellungstest: $aus"
      melden test fehler "Wiederherstellung aus der externen Sicherung fehlgeschlagen: ${aus:0:300}"
      return 1
    fi
  else
    quelle="lokal"
    # N-011: nur die neueste Datenbank kopieren (nicht den ganzen Sicherungsordner)
    datei="$(find "$SICHERUNG_HOST" -maxdepth 1 -name 'bautag-*.db' -type f 2>/dev/null | sort | tail -n 1 || true)"
    if [[ -n "$datei" ]]; then cp -a "$datei" "$tmp"/; fi
  fi
  datei="$(find "$tmp" -name 'bautag-*.db' -type f | sort | tail -n 1)"
  if [[ -z "$datei" ]]; then
    log "FEHLER Wiederherstellungstest: keine Sicherungsdatei gefunden ($quelle)."
    melden test fehler "Wiederherstellungstest ($quelle): keine Sicherungsdatei gefunden"
    return 1
  fi
  if aus="$(pruefe_datei "$tmp" "$datei" 2>&1)" && printf '%s' "$aus" | grep -q '"ok":true'; then
    log "Wiederherstellungstest ok ($quelle, $(basename "$datei")): $aus"
    melden test ok "$quelle, $(basename "$datei"): $(printf '%s' "$aus" | grep -o '"tabellen":{[^}]*}' || true)"
  else
    log "FEHLER Wiederherstellungstest ($quelle): $aus"
    melden test fehler "Wiederherstellungstest ($quelle, $(basename "$datei")) fehlgeschlagen: ${aus:0:300}"
    return 1
  fi
}

main() {
  local fehler=0
  case "${1:-}" in
    --test) wiederherstellungstest || fehler=1 ;;
    --lokal) lokal || fehler=1 ;;
    "")
      lokal || fehler=1
      offsite || fehler=1
      if [[ "$(date +%u)" == 7 || -n "${BAUTAG_TEST_IMMER:-}" ]]; then wiederherstellungstest || fehler=1; fi
      ;;
    *) echo "Aufruf: $0 [--test|--lokal]" >&2; return 2 ;;
  esac
  return "$fehler"
}

main "$@"
