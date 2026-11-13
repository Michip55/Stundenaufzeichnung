#!/usr/bin/env bash
# BauTag – Installation auf einem frischen Ubuntu-24.04-Server (ein Befehl, siehe ANLEITUNG.md)
#
#   sudo bash installieren.sh                 Neuinstallation (fragt Domain, E-Mail, erste Geschäftsführung)
#   sudo bash installieren.sh --wiederherstellen   Server neu aufsetzen und Daten aus der externen Sicherung holen
#
# Richtet ein: Docker, Firewall (nur 22/80/443), SSH nur mit Schlüssel + fail2ban, automatische
# Sicherheitsupdates, Docker-Protokollrotation, BauTag (App läuft nicht als root) hinter Caddy (HTTPS, HSTS),
# tägliche Sicherung (lokal + verschlüsselt extern) mit wöchentlichem Wiederherstellungstest.
set -Eeuo pipefail
umask 022

REPO_URL="${BAUTAG_REPO:-https://github.com/Michip55/Stundenaufzeichnung.git}"
ZIEL="${BAUTAG_ZIEL:-/opt/bautag}"
DATEN=/var/lib/bautag/daten
SICHERUNG=/var/lib/bautag/sicherung
ETC=/etc/bautag
APP_UID=1000
MODUS="${1:-}"

rot() { printf '\033[1;31m%s\033[0m\n' "$*"; }
gruen() { printf '\033[1;32m%s\033[0m\n' "$*"; }
schritt() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fehler() { rot "FEHLER: $*" >&2; exit 1; }
frage() { local a; read -r -p "$1 " a </dev/tty; printf '%s' "$a"; }
frage_geheim() { local a; read -r -s -p "$1 " a </dev/tty; echo >&2; printf '%s' "$a"; }

[[ $EUID -eq 0 ]] || fehler "Bitte mit sudo ausführen: sudo bash installieren.sh"
. /etc/os-release
[[ "${ID:-}" == ubuntu ]] || fehler "Dieses Skript ist für Ubuntu 24.04 gedacht (gefunden: ${PRETTY_NAME:-unbekannt})."
[[ "${VERSION_ID:-}" == 24.04 ]] || rot "Hinweis: getestet für Ubuntu 24.04, gefunden ${VERSION_ID:-?} – es geht trotzdem weiter."

schritt "Angaben"
DOMAIN="$(frage 'Adresse der App (z. B. bautag.ihre-firma.at):')"
[[ "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || fehler "Ungültige Adresse: $DOMAIN"
EMAIL="$(frage 'E-Mail-Adresse für das HTTPS-Zertifikat und Alarme:')"
[[ "$EMAIL" == *@*.* ]] || fehler "Ungültige E-Mail-Adresse."
if [[ "$MODUS" != --wiederherstellen ]]; then
  GF_NAME="$(frage 'Name der Geschäftsführung (erstes Konto):')"
  GF_PNR="$(frage 'Personalnummer der Geschäftsführung (z. B. 1):')"
  GF_PIN="$(frage_geheim 'PIN der Geschäftsführung (6–12 Ziffern, keine Folge wie 123456):')"
  GF_PIN2="$(frage_geheim 'PIN wiederholen:')"
  [[ "$GF_PIN" == "$GF_PIN2" ]] || fehler "Die PINs stimmen nicht überein."
fi
OFFSITE="$(frage 'Externe Sicherung (restic) jetzt einrichten? Adresse z. B. sftp:u123456@u123456.your-storagebox.de:/bautag  (leer = später):')"

schritt "1/9 System aktualisieren und Pakete installieren"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl git ufw fail2ban unattended-upgrades restic openssl cron
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

schritt "2/9 Automatische Sicherheitsupdates"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
cat > /etc/apt/apt.conf.d/52bautag-upgrades <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "03:30";
EOF
systemctl enable --now unattended-upgrades >/dev/null

schritt "3/9 Firewall (nur SSH, HTTP, HTTPS)"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null
# Docker umgeht ufw für veröffentlichte Ports – veröffentlicht werden nur 80/443 (Caddy), die App nicht.

schritt "4/9 SSH absichern (nur Schlüssel) und fail2ban"
SCHLUESSEL_DA=""
for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
  [[ -s "$f" ]] && SCHLUESSEL_DA=1
done
if [[ -n "$SCHLUESSEL_DA" ]]; then
  cat > /etc/ssh/sshd_config.d/90-bautag.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
MaxAuthTries 3
EOF
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  gruen "SSH: Anmeldung nur noch mit Schlüssel."
else
  rot "SSH: Kein SSH-Schlüssel hinterlegt – Passwort-Anmeldung bleibt AN (sonst würden Sie sich aussperren)."
  rot "      Bitte SSH-Schlüssel beim Anbieter hinterlegen und dieses Skript erneut ausführen (siehe SICHERHEIT.md)."
fi
cat > /etc/fail2ban/jail.d/bautag.conf <<'EOF'
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h
EOF
systemctl enable --now fail2ban >/dev/null
systemctl restart fail2ban

schritt "5/9 Docker: Protokolle begrenzen"
mkdir -p /etc/docker
if [[ ! -f /etc/docker/daemon.json ]]; then
  cat > /etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" }, "live-restore": true }
EOF
  systemctl restart docker
fi
systemctl enable --now docker >/dev/null

schritt "6/9 BauTag holen"
if [[ -f "$(dirname "$0")/../app/package.json" && "$(cd "$(dirname "$0")/.." && pwd)" != "$ZIEL" ]]; then
  mkdir -p "$ZIEL"
  cp -a "$(cd "$(dirname "$0")/.." && pwd)/." "$ZIEL/"
elif [[ ! -d "$ZIEL/.git" ]]; then
  git clone "$REPO_URL" "$ZIEL"
fi
cd "$ZIEL/deploy"
mkdir -p "$DATEN" "$SICHERUNG" "$ETC"
chown -R "$APP_UID:$APP_UID" "$DATEN" "$SICHERUNG"
chmod 700 "$DATEN" "$SICHERUNG" "$ETC"

schritt "7/9 Einstellungen (.env, nur für root lesbar)"
if [[ ! -f .env ]]; then
  SCHLUESSEL="$(openssl rand -hex 32)"
  cp .env.beispiel .env
  sed -i "s|^BAUTAG_DOMAIN=.*|BAUTAG_DOMAIN=$DOMAIN|; s|^BAUTAG_EMAIL=.*|BAUTAG_EMAIL=$EMAIL|; s|^BAUTAG_URL=.*|BAUTAG_URL=https://$DOMAIN|; s|^BAUTAG_SCHLUESSEL=.*|BAUTAG_SCHLUESSEL=$SCHLUESSEL|; s|^ALARM_EMAIL=.*|ALARM_EMAIL=$EMAIL|" .env
  if [[ "$MODUS" == --wiederherstellen ]]; then
    S="$(frage_geheim 'BAUTAG_SCHLUESSEL vom Notfallblatt (leer = neuer Schlüssel; dann 2FA, SMTP und KI neu einrichten):')"
    if [[ -n "$S" ]]; then
      [[ ${#S} -ge 32 ]] || fehler "Der Schlüssel vom Notfallblatt ist kürzer als 32 Zeichen – bitte prüfen."
      sed -i "s|^BAUTAG_SCHLUESSEL=.*|BAUTAG_SCHLUESSEL=$S|" .env
    else
      NEUER_SCHLUESSEL=1 # G-03: gespeicherte Geheimnisse der Sicherung sind mit dem neuen Schlüssel nicht lesbar
    fi
  fi
fi
chmod 600 .env

schritt "8/9 Externe verschlüsselte Sicherung"
if [[ ! -f "$ETC/restic-passwort" ]]; then
  if [[ "$MODUS" == --wiederherstellen ]]; then
    frage_geheim 'Passwort der externen Sicherung (vom Notfallblatt):' > "$ETC/restic-passwort"
  else
    openssl rand -base64 30 | tr -d '\n' > "$ETC/restic-passwort"
  fi
fi
chmod 600 "$ETC/restic-passwort"
if [[ -n "$OFFSITE" && ! -f "$ETC/restic.env" ]]; then
  { echo "RESTIC_REPOSITORY=$OFFSITE"; echo "RESTIC_PASSWORD_FILE=$ETC/restic-passwort"; } > "$ETC/restic.env"
  if [[ "$OFFSITE" == s3:* ]]; then
    echo "AWS_ACCESS_KEY_ID=$(frage 'S3-Zugangsschlüssel (Access Key):')" >> "$ETC/restic.env"
    echo "AWS_SECRET_ACCESS_KEY=$(frage_geheim 'S3-Geheimschlüssel (Secret Key):')" >> "$ETC/restic.env"
  elif [[ "$OFFSITE" == sftp:* ]]; then
    [[ -f /root/.ssh/id_ed25519 ]] || ssh-keygen -t ed25519 -N '' -C "bautag-sicherung@$DOMAIN" -f /root/.ssh/id_ed25519 >/dev/null
    echo "Öffentlicher Schlüssel des Servers (beim Speicher-Anbieter hinterlegen):"
    cat /root/.ssh/id_ed25519.pub
    frage 'Schlüssel hinterlegt? Weiter mit Enter.' >/dev/null
  fi
  chmod 600 "$ETC/restic.env"
fi
if [[ -f "$ETC/restic.env" && "$MODUS" != --wiederherstellen ]]; then
  set -a; # shellcheck disable=SC1091
  . "$ETC/restic.env"; set +a
  restic snapshots >/dev/null 2>&1 || restic init || rot "Externe Sicherung konnte nicht angelegt werden – später erneut versuchen (SICHERHEIT.md)."
fi
cat > /etc/cron.d/bautag <<EOF
# BauTag: tägliche Sicherung 02:30 (lokal + extern), sonntags mit Wiederherstellungstest
SHELL=/bin/bash
30 2 * * * root $ZIEL/deploy/backup.sh >/dev/null 2>&1
EOF
chmod 644 /etc/cron.d/bautag
cat > /etc/logrotate.d/bautag <<'EOF'
/var/log/bautag-sicherung.log {
  weekly
  rotate 12
  compress
  missingok
  notifempty
}
EOF

schritt "9/9 Container bauen und starten"
docker compose build app
if [[ "$MODUS" == --wiederherstellen ]]; then
  bash "$ZIEL/deploy/wiederherstellen.sh" --extern
  if [[ -n "${NEUER_SCHLUESSEL:-}" ]]; then
    rot "ACHTUNG – neuer BAUTAG_SCHLUESSEL: Die mit dem alten Schlüssel gespeicherten Geheimnisse sind nicht mehr lesbar."
    rot "  Neu einrichten müssen Sie: die Zwei-Faktor-Anmeldung (2FA) aller Personen, das SMTP-Passwort (Einstellungen → E-Mail)"
    rot "  und den KI-API-Schlüssel (Einstellungen → KI). Push wird neu eingerichtet (Geräte schalten Push neu ein)."
    rot "  Mit 2FA kann sich bis dahin nur anmelden, wer einen Wiederherstellungscode hat."
    A="$(frage '2FA jetzt für ALLE Personen zurücksetzen (Anmeldung dann nur mit PIN, danach neu einrichten)? [J/n]')"
    if [[ ! "$A" =~ ^[nN] ]]; then
      docker compose run --rm app node server/entsperren.js --2fa-alle || rot "Zurücksetzen fehlgeschlagen – später: docker compose run --rm app node server/entsperren.js --2fa-alle"
    else
      echo "Später zurücksetzen: cd $ZIEL/deploy && docker compose run --rm app node server/entsperren.js <Personalnummer> --2fa  (bzw. --2fa-alle)"
    fi
  fi
elif [[ ! -f "$DATEN/bautag.db" ]]; then
  docker compose run --rm -e BAUTAG_GF_NAME="$GF_NAME" -e BAUTAG_GF_PNR="$GF_PNR" -e BAUTAG_GF_PIN="$GF_PIN" app node server/einrichten.js
fi
unset GF_PIN GF_PIN2
docker compose up -d
bash "$ZIEL/deploy/backup.sh" || rot "Erste Sicherung mit Warnungen – siehe /var/log/bautag-sicherung.log"

gruen "
BauTag ist installiert: https://$DOMAIN
"
cat <<EOF
WICHTIG – bitte jetzt auf das NOTFALLBLATT (SICHERHEIT.md) schreiben und im Tresor aufbewahren:
  1. Passwort der externen Sicherung:  $(cat "$ETC/restic-passwort")
  2. BAUTAG_SCHLUESSEL:                $(sed -n 's/^BAUTAG_SCHLUESSEL=//p' .env)
  3. Adresse der externen Sicherung:   ${OFFSITE:-(noch nicht eingerichtet)}
Ohne das Passwort (1) kann NIEMAND die externe Sicherung wiederherstellen – auch wir nicht.

Nächste Schritte: in der App anmelden, zweites Verwaltungs-Konto anlegen, Zwei-Faktor-Anmeldung einrichten.
EOF
