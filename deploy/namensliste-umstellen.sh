#!/usr/bin/env bash
# BauTag – einmalige Umstellung der Einstellungen (API.md 15.33, Inhaber 19.11.2026): öffentliche Namensliste beim Anmelden aus.
#   bash deploy/namensliste-umstellen.sh deploy/.env      (ruft update.sh selbst auf)
#
# Bis 15.32 stand in .env.beispiel BAUTAG_LOGIN_LISTE=1 (Namensliste an). Seit 15.33 meldet man sich mit Personalnummer + PIN an;
# am eigenen Handy merkt sich die App die Person (Name und Personalnummer). Diese Umstellung läuft GENAU EINMAL:
#   - Zeile BAUTAG_LOGIN_LISTE=1 → wird zu BAUTAG_LOGIN_LISTE=0 (Sicherung der .env vorher, Rechte bleiben nur für root);
#   - Zeile =0 oder keine Zeile → nichts umzustellen (Standard ist jetzt aus);
#   - in jedem Fall wird die Merkzeile „# 15.33 Namensliste aus (einmalig …)“ eingetragen, darunter BAUTAG_LOGIN_LISTE_GEPRUEFT=15.33
#     (erst damit zählt im Docker-Betrieb eine 1 – siehe docker-compose.yml und server/index.js loginListeAusUmgebung). Steht die
#     Merkzeile schon in der Datei, wird nichts mehr geändert – eine später bewusst gesetzte Zeile BAUTAG_LOGIN_LISTE=1 bleibt stehen.
# Exit-Code: 3 = Namensliste ausgeschaltet (update.sh startet die App dann neu, damit die Einstellung gilt),
#            0 = sonst (nichts oder nur die Merkzeile eingetragen), 1 = Fehler.
set -Eeuo pipefail

DATEI="${1:?Aufruf: namensliste-umstellen.sh <Pfad zur .env>}"
MARKE='# 15.33 Namensliste aus'
GEPRUEFT='BAUTAG_LOGIN_LISTE_GEPRUEFT=15.33'
HEUTE="$(date +%d.%m.%Y)"

if [[ ! -f "$DATEI" ]]; then
  echo "15.33: $DATEI fehlt – nichts umzustellen (ohne Einstellung ist die Namensliste aus)."
  exit 0
fi
if grep -q "^${MARKE}" "$DATEI"; then
  exit 0 # schon einmal umgestellt bzw. geprüft – eine bewusste Einstellung bleibt, wie sie ist
fi

# BAUTAG_LOGIN_LISTE=1 (auch mit Leerzeichen, Anführungszeichen, export oder Windows-Zeilenende)
AN_MUSTER='^[[:space:]]*(export[[:space:]]+)?BAUTAG_LOGIN_LISTE[[:space:]]*=[[:space:]]*["'"'"']?1["'"'"']?[[:space:]]*$'
if grep -Eq "$AN_MUSTER" "$DATEI"; then
  ART=an
  TEXT="${MARKE} (einmalig umgestellt am ${HEUTE}: vorher BAUTAG_LOGIN_LISTE=1; wieder einschalten: Zeile unten auf 1 setzen)"
elif grep -Eq '^[[:space:]]*(export[[:space:]]+)?BAUTAG_LOGIN_LISTE[[:space:]]*=' "$DATEI"; then
  ART=gesetzt
  TEXT="${MARKE} (einmalig geprüft am ${HEUTE}: BAUTAG_LOGIN_LISTE war nicht 1 – unverändert)"
else
  ART=fehlt
  TEXT="${MARKE} (einmalig geprüft am ${HEUTE}: keine Zeile BAUTAG_LOGIN_LISTE – Standard ist aus; einschalten mit BAUTAG_LOGIN_LISTE=1)"
fi

# Sicherung der bisherigen Datei (nur für root lesbar), dann neue Fassung im selben Ordner schreiben und austauschen
SICHERUNG="${DATEI}.vor-15.33-$(date +%Y%m%d-%H%M%S)"
( umask 077; cp -p "$DATEI" "$SICHERUNG" )
chmod 600 "$SICHERUNG"
NEU="$(mktemp "$(dirname "$DATEI")/.env-15.33.XXXXXX")"
trap 'rm -f "$NEU"' EXIT
chmod 600 "$NEU"
if [[ "$ART" == an ]]; then
  awk -v muster="$AN_MUSTER" -v marke="$TEXT" -v gepr="$GEPRUEFT" '
    $0 ~ muster { cr = ($0 ~ /\r$/) ? "\r" : ""; if (!gesetzt) { print marke cr; print gepr cr; gesetzt = 1 } print "BAUTAG_LOGIN_LISTE=0" cr; next }
    { print }' "$DATEI" > "$NEU"
else
  cat "$DATEI" > "$NEU"
  # letzte Zeile ohne Zeilenende? dann erst eines anhängen
  if [[ -s "$NEU" && "$(tail -c 1 "$NEU" | od -An -c | tr -d ' ')" != '\n' ]]; then printf '\n' >> "$NEU"; fi
  printf '%s\n%s\n' "$TEXT" "$GEPRUEFT" >> "$NEU"
fi
chown --reference="$DATEI" "$NEU" 2>/dev/null || true
chmod 600 "$NEU"
mv -f "$NEU" "$DATEI"
trap - EXIT

if [[ "$ART" == an ]]; then
  echo "15.33: EINMALIGE UMSTELLUNG – öffentliche Namensliste beim Anmelden ausgeschaltet (BAUTAG_LOGIN_LISTE=1 → 0)."
  echo "       Anmeldung jetzt mit Personalnummer + PIN; am eigenen Handy merkt sich die App die Person (dann nur noch die PIN)."
  echo "       Bitte in der App unter „Benutzer & Rechte“ prüfen, ob alle aktiven Personen eine Personalnummer haben."
  echo "       Sicherung der bisherigen Einstellungen: $SICHERUNG"
  echo "       Wer die Namensliste trotzdem will: in $DATEI BAUTAG_LOGIN_LISTE=1 setzen – das wird nicht mehr umgestellt."
else
  echo "15.33: Namensliste war nicht eingeschaltet – nichts umgestellt, Merkzeile eingetragen (Sicherung: $SICHERUNG)."
  exit 0
fi
exit 3
