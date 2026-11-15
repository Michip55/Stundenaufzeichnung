#!/usr/bin/env bash
# BauTag – dritte Kopie im Büro (NAS oder PC mit Linux/macOS), siehe SICHERHEIT.md „Kopie 3“
#
# Holt die verschlüsselte externe Sicherung auf einen Datenträger im Büro – OHNE Zugang zum Server.
# Die Daten bleiben verschlüsselt (gleiches Passwort wie die externe Sicherung).
#
#   Einmalig:  nas-kopie.sh --einrichten     (legt das Büro-Archiv an)
#   Täglich:   nas-kopie.sh                  (z. B. per Aufgabenplanung um 06:00)
#
# Einstellungen in nas-kopie.env neben diesem Skript (chmod 600):
#   QUELLE=sftp:u123456@u123456.your-storagebox.de:/bautag   (= RESTIC_REPOSITORY des Servers)
#   QUELLE_PASSWORT_DATEI=/pfad/restic-passwort              (Passwort vom Notfallblatt)
#   ZIEL=/volume1/sicherung/bautag                           (Ordner auf dem NAS/PC)
#   AWS_ACCESS_KEY_ID=… / AWS_SECRET_ACCESS_KEY=…           (nur bei S3)
set -Eeuo pipefail
umask 077
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENVDATEI="${NAS_ENV:-$DIR/nas-kopie.env}"
RESTIC="${RESTIC:-restic}"
[[ -f "$ENVDATEI" ]] || { echo "Einstellungen fehlen: $ENVDATEI" >&2; exit 1; }
set -a; # shellcheck disable=SC1090
source "$ENVDATEI"; set +a
: "${QUELLE:?QUELLE fehlt}" "${QUELLE_PASSWORT_DATEI:?QUELLE_PASSWORT_DATEI fehlt}" "${ZIEL:?ZIEL fehlt}"
command -v "$RESTIC" >/dev/null || { echo "restic fehlt (https://restic.net – auch für Synology/QNAP als Paket bzw. Container)." >&2; exit 1; }

if [[ "${1:-}" == --einrichten ]]; then
  # gleiches Passwort und gleiche Verschlüsselungsparameter wie das Server-Archiv
  "$RESTIC" init --repo "$ZIEL" --password-file "$QUELLE_PASSWORT_DATEI" \
    --from-repo "$QUELLE" --from-password-file "$QUELLE_PASSWORT_DATEI" --copy-chunker-params
  echo "Büro-Archiv angelegt: $ZIEL"
  exit 0
fi

"$RESTIC" copy --repo "$ZIEL" --password-file "$QUELLE_PASSWORT_DATEI" \
  --from-repo "$QUELLE" --from-password-file "$QUELLE_PASSWORT_DATEI" --tag bautag
"$RESTIC" forget --repo "$ZIEL" --password-file "$QUELLE_PASSWORT_DATEI" --tag bautag \
  --keep-daily 14 --keep-weekly 8 --keep-monthly 24 --prune
"$RESTIC" check --repo "$ZIEL" --password-file "$QUELLE_PASSWORT_DATEI"
echo "$(date '+%Y-%m-%d %H:%M') Büro-Kopie aktuell."
