# BauTag in Betrieb nehmen – Schritt für Schritt

Diese Anleitung ist für den Inhaber ohne IT-Kenntnisse geschrieben. Zeitaufwand: etwa 1 Stunde.
Laufende Kosten: Server ca. 5–10 € im Monat, externe Sicherung ca. 3–5 € im Monat, Internet-Adresse ca. 1 € im Monat.

> **Sicherheit der Daten:** Bitte zusätzlich **SICHERHEIT.md** lesen (Sicherungen, Notfallblatt, Datenschutz).

---

## Schritt 1: Kleinen Server mieten (EU-Anbieter)

1. Bei einem Anbieter mit Rechenzentrum in der EU ein Konto anlegen, z. B. **Hetzner** (Deutschland/Finnland), **netcup** (Deutschland) oder **IONOS** (Deutschland). Wählen Sie ein Rechenzentrum in Deutschland oder Österreich.
2. Einen „Cloud-Server“ / „VPS“ bestellen:
   - Betriebssystem: **Ubuntu 24.04**
   - Größe: 2 CPU, 4 GB RAM und **80 GB** Festplatte für einen Betrieb mit 50 Mitarbeitern (40 GB reichen für den Start, siehe „Speicherplatz“ unten; die Festplatte lässt sich beim Anbieter später vergrößern).
   - **SSH-Schlüssel hinterlegen** (der Anbieter erklärt das im Bestellvorgang; auf Windows mit „PuTTYgen“, auf dem Mac im Terminal mit `ssh-keygen`). Ohne Schlüssel bleibt die Passwort-Anmeldung offen – das ist weniger sicher.
   - Falls angeboten: „Backups“ des Anbieters dazubuchen (zusätzliche Sicherheit, ca. 20 % Aufpreis).
3. **Auftragsverarbeitungsvertrag (AVV)** im Kundenbereich des Anbieters abschließen (meist ein Klick unter „Datenschutz“ / „AV-Vertrag“). Das ist nach DSGVO Pflicht, weil Arbeitszeiten personenbezogene Daten sind.
4. Notieren Sie die **IP-Adresse** des Servers (z. B. `203.0.113.10`).

## Schritt 2: Internet-Adresse auf den Server zeigen lassen

1. Beim Anbieter Ihrer Firmen-Domain (z. B. `ihre-firma.at`) im Bereich „DNS“ einen neuen Eintrag anlegen:
   - Typ: **A**
   - Name: **bautag** (ergibt `bautag.ihre-firma.at`)
   - Wert: die **IP-Adresse** aus Schritt 1
2. Es kann bis zu einer Stunde dauern, bis der Eintrag wirkt. Prüfen: im Browser `bautag.ihre-firma.at` aufrufen – eine Fehlermeldung ist jetzt noch normal, wichtig ist nur, dass „Server nicht gefunden“ **nicht** mehr erscheint.

## Schritt 3: Speicher für die externe Sicherung mieten (empfohlen)

Ein **zweiter Anbieter** an einem anderen Ort, damit die Daten auch bei einem Totalausfall des Servers erhalten bleiben – z. B. eine **Hetzner Storage Box** (BX11, ca. 4 €/Monat) oder S3-Speicher in der EU. Auch hier den **AVV** abschließen. Notieren Sie die Zugangsadresse, z. B. `sftp:u123456@u123456.your-storagebox.de:/bautag`. Details: SICHERHEIT.md.

## Schritt 4: Ein Befehl installiert alles

1. Mit dem Server verbinden: Windows „PowerShell“ bzw. Mac „Terminal“ öffnen und eingeben (IP anpassen):
   ```
   ssh root@203.0.113.10
   ```
2. Diesen einen Befehl einfügen und Enter drücken:
   ```
   git clone https://github.com/Michip55/Stundenaufzeichnung.git /opt/bautag && sudo bash /opt/bautag/deploy/installieren.sh
   ```
   Ist das Programm-Verzeichnis (Repository) nicht öffentlich, fragt `git` nach Benutzername und einem Zugangs-Token (GitHub → Settings → Developer settings → Personal access tokens, Recht „Contents: Read“). Alternativ den Ordner per USB/SFTP nach `/opt/bautag` kopieren und nur `sudo bash /opt/bautag/deploy/installieren.sh` ausführen.
3. Das Skript fragt:
   - die Adresse (`bautag.ihre-firma.at`),
   - eine E-Mail-Adresse (für das HTTPS-Zertifikat und Alarme),
   - Name, Personalnummer und PIN der Geschäftsführung (erstes Konto),
   - die Adresse der externen Sicherung (Schritt 3; leer lassen = später).
4. Nach ca. 5–10 Minuten erscheint **„BauTag ist installiert“** und darunter das **Notfallblatt**: Passwort der externen Sicherung und Schlüssel. **Bitte sofort auf Papier abschreiben und in den Tresor legen** (siehe SICHERHEIT.md). Ohne dieses Passwort kann niemand die externe Sicherung wiederherstellen.

Das Skript richtet automatisch ein: HTTPS-Zertifikat, Firewall, Schutz gegen Passwort-Raten, automatische Sicherheitsupdates, tägliche Sicherung um 02:30 Uhr und jeden Sonntag einen Wiederherstellungstest.

## Schritt 5: Erste Schritte in der App

1. Im Browser `https://bautag.ihre-firma.at` öffnen und mit Personalnummer und PIN anmelden.
2. **Zweites Verwaltungs-Konto** anlegen (Büro oder zweite Geschäftsführung) – wichtig, damit gesperrte Konten entsperrt werden können.
3. Unter *Einstellungen → Sicherheit* die **Zwei-Faktor-Anmeldung** für Büro und Geschäftsführung einrichten.
4. Unter *Einstellungen → E-Mail* den Mailserver eintragen (Daten vom E-Mail-Anbieter, z. B. „SMTP-Server“), Test-Mail schicken.
5. Preise, Baustellen (mit Koordinaten für das Wetter) und Mitarbeiter erfassen.

## Schritt 6: Handys der Mitarbeiter einrichten

1. Auf dem Handy die Adresse `https://bautag.ihre-firma.at` im Browser öffnen (iPhone: **Safari**, Android: **Chrome**).
2. **iPhone:** unten auf das Teilen-Symbol (Quadrat mit Pfeil) → **„Zum Home-Bildschirm“** → „Hinzufügen“.
   **Android:** oben rechts ⋮ → **„Zum Startbildschirm hinzufügen“** bzw. „App installieren“.
3. Das BauTag-Symbol erscheint am Startbildschirm. Ab jetzt nur noch dieses Symbol verwenden.
4. Beim ersten Öffnen anmelden; für Benachrichtigungen in der App unter *Einstellungen → Benachrichtigungen* „Erlauben“ tippen (iPhone: erst nach Schritt 2 möglich).

## Aktualisieren

Neue Versionen einspielen (vorher wird automatisch gesichert; startet die neue Version nicht, wird zurückgeschaltet):
```
ssh root@203.0.113.10
sudo bash /opt/bautag/deploy/update.sh
```

Nach einer Änderung an der `Caddyfile` erstellt `update.sh` den Webserver (Caddy) automatisch neu. Ist ein Bau fehlgeschlagen, setzt `update.sh` den Programmstand zurück; einfach später erneut aufrufen – es baut dann wieder.

## Speicherplatz

Was die Festplatte braucht (Richtwerte):
- System, Docker und Programm: ca. 10 GB
- **Fotos und Dokumente doppelt** (App-Ordner + ein Sicherungs-Spiegel): bei ca. 10 Berichten am Tag mit 3 Fotos rund 3–4 GB im Jahr, also 6–8 GB Platz im Jahr
- Datenbank-Stände (14 + 8 + 12): je Stand meist unter 100 MB, zusammen wenige GB

Mit 40 GB reicht der Platz also für etwa 2–3 Jahre, mit 80 GB deutlich länger. Ältere Foto-Stände liegen nur in der externen Sicherung (dort speichert restic jedes Foto nur einmal).
**Warnung:** Ist die Festplatte zu 85 % belegt oder sind weniger als 3 GB frei, meldet die nächtliche Sicherung „Speicherplatz knapp“ an die Geschäftsführung (in der App und per E-Mail). Dann beim Anbieter die Festplatte vergrößern. Belegung ansehen: `df -h /var/lib/bautag`.

## Notfall-E-Mail (wenn die App selbst ausfällt)

Normalerweise meldet die App Probleme der Sicherung selbst (Meldung, Push und E-Mail über *Einstellungen → E-Mail*). Ist die App aber nicht erreichbar, schickt `backup.sh` die Warnung mit dem Programm `sendmail` an `ALARM_EMAIL` (in `deploy/.env`). **Die Installation richtet dafür kein Mailprogramm ein** – ohne steht im Protokoll nur „Kein Notfall-Versand möglich“. Einrichten (Daten vom E-Mail-Anbieter, wie in der App):
```
sudo apt-get install -y msmtp-mta
sudo nano /etc/msmtprc
```
Inhalt (Werte anpassen), danach `sudo chmod 600 /etc/msmtprc`:
```
defaults
auth on
tls on
account standard
host smtp.ihr-anbieter.at
port 587
from bautag@ihre-firma.at
user bautag@ihre-firma.at
password IHR-PASSWORT
account default : standard
```
Testen (eigene Adresse einsetzen):
```
printf 'Subject: BauTag Test\n\nTest\n' | sudo sendmail ihre@adresse.at
```
Die tägliche Sicherung (`/etc/cron.d/bautag`) findet `sendmail` in `/usr/sbin`.

## Notfall: Server weg oder Daten kaputt

Siehe **SICHERHEIT.md, Abschnitt „Notfall: Wiederherstellung“**. Kurzfassung:
- **Daten eines Tages zurückholen** (Server läuft): `sudo bash /opt/bautag/deploy/wiederherstellen.sh --liste`, dann `… --datei /var/lib/bautag/sicherung/bautag-JJJJ-MM-TT.db`.
- **Server komplett verloren:** neuen Server mieten (Schritt 1), DNS auf die neue IP ändern (Schritt 2), dann
  `git clone https://github.com/Michip55/Stundenaufzeichnung.git /opt/bautag && sudo bash /opt/bautag/deploy/installieren.sh --wiederherstellen`
  und Passwort sowie Schlüssel vom **Notfallblatt** eingeben.

## Hilfe bei Problemen

- Läuft die App? `sudo docker compose -f /opt/bautag/deploy/docker-compose.yml ps` (Spalte STATUS: „healthy“).
- Protokoll der App: `sudo docker compose -f /opt/bautag/deploy/docker-compose.yml logs --tail 100 app`
- Protokoll der Sicherung: `sudo tail -50 /var/log/bautag-sicherung.log`
- Neu starten: `sudo docker compose -f /opt/bautag/deploy/docker-compose.yml restart`

## Größengrenzen beim Hochladen

Alle Dateien gehen als Base64 im JSON an den Server (ca. 4/3 der Dateigröße). Der Webserver (Caddy, `deploy/Caddyfile` → `request_body`) erlaubt die großen Anfragen **nur** für `POST` auf die Upload- und Import-Pfade (dieselben Pfade wie `dokumentPfad` in `app/server/index.js`); alle anderen Anfragen begrenzt er schon vor der App auf 13 MB. Beide Grenzen müssen über der jeweiligen App-Grenze liegen – sonst bricht der Upload mit „413“ ab. Werte bei Änderungen hier **und** in `app/server/index.js` anpassen (Prüftest `tests/unit/deploy.test.js`).

| Wofür | Datei höchstens | Anfrage (JSON) höchstens | Ort in der App |
|---|---|---|---|
| Projektdokumente | 25 MB | 35 MB | `jsonDokumente` |
| LV-, BMD- und Stammdaten-Import | 5 MB | 35 MB (gemeinsame Grenze mit den Dokumenten) | `jsonDokumente` |
| Fotos (Bericht, Lieferschein, Papierbericht, Schaden, Fuhre, Fernunterschrift) | 8 MB je Foto | 12 MB | `jsonFotos` |
| Excel-Import Positionskatalog | 5 MB | 7 MB | `jsonImport` |
| alle anderen Anfragen | – | 2 MB | `jsonKlein` |
| **Webserver Caddy: Upload/Import** (`POST` auf `/api/baustellen/<id>/dokumente`, `…/dokumente/<id>/versionen`, `…/lv-import`, `/api/import/bmd-op`, `/api/stammdaten/<art>/import`) | – | **40 MB** (35 MB + Reserve) | `Caddyfile` `@gross` |
| **Webserver Caddy: alle anderen Anfragen** | – | **13 MB** (12 MB + Reserve) | `Caddyfile` `@klein` |

Der App-Container darf höchstens **1536 MB** Arbeitsspeicher belegen (`mem_limit` in `deploy/docker-compose.yml`); wird es mehr, startet Docker die App neu, der Server selbst bleibt bedienbar.

Das Zugriffsprotokoll von Caddy (`/data/zugriff.log` im Volume `caddy_daten`) und das Fehlerprotokoll (`docker compose logs caddy`, z. B. bei „502“ während eines Updates) enthalten keine Fernunterschrift-Token: der Pfad `/api/fern/<Token>` bzw. `/unterschrift/<Token>` wird als `…/***` gespeichert (auch in Schreibweisen wie `//api/fern/…` oder `/API/fern/…`), `Referer` und `Cookie` werden nicht protokolliert.
