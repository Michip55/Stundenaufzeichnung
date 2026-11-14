# Datensicherheit und Datensicherung bei BauTag

Für den Inhaber, ohne Fachbegriffe. Ziel: **Keine Arbeitszeit, kein Bericht und keine Unterschrift geht verloren**, auch wenn ein Server ausfällt, ein Anbieter Probleme hat oder jemand versehentlich etwas löscht.

---

## 1. Die 3-2-1-Regel – drei Kopien an verschiedenen Orten

| Kopie | Wo | Wann | Verschlüsselt? | Aufbewahrung |
|---|---|---|---|---|
| **1. Lokaler Stand** | auf dem Server (eigener Ordner) | täglich 02:30 | Server-Festplatte (Anbieter) | Datenbank: 14 Tage, 8 Wochen, 12 Monate; Fotos/Dokumente: aktueller Stand (ein Spiegel) |
| **2. Externe Kopie** | **zweiter Anbieter** in der EU (z. B. Storage Box, S3) | täglich direkt danach | **ja – auf dem Server verschlüsselt**, bevor die Daten das Haus verlassen | 14 Tage, 8 Wochen, 12 Monate |
| **3. Büro-Kopie** (optional, empfohlen) | NAS oder PC im Büro | täglich morgens | ja (dieselbe Verschlüsselung) | 14 Tage, 8 Wochen, 24 Monate |

Gesichert werden die **Datenbank** (alle Zeiten, Berichte, Unterschriften, Preise, Protokoll) und alle **Fotos und Dokumente** (Schäden, Berichtsfotos, Lieferscheine, Papierberichte, Projektdokumente).
Die Fotos liegen lokal **einmal** als Spiegel (`uploads-spiegel/`, jede Nacht nur Neues kopiert); ältere Stände der Fotos hält die externe Sicherung – restic speichert jedes Foto nur einmal, auch über viele Tage. So wächst der Platzbedarf nicht mit jedem Sicherungstag (Platzbedarf: ANLEITUNG.md, „Speicherplatz“).
Die Sicherung ist **„konsistent“**: Sie wird bei laufender App erstellt, ohne dass halbe Einträge entstehen können.

### Kopie 2: externe, verschlüsselte Sicherung (restic)
- Das Programm **restic** verschlüsselt alle Daten auf dem Server mit einem **Sicherungs-Passwort**. Der Speicher-Anbieter sieht nur unlesbaren Datensalat.
- Das Passwort erzeugt die Installation automatisch und zeigt es **einmal** an. **Ohne dieses Passwort ist keine Wiederherstellung möglich** – auch nicht durch uns oder den Anbieter. Darum gehört es auf das Notfallblatt (Abschnitt 4).
- Einrichtung nachträglich: Datei `/etc/bautag/restic.env` nach Vorlage `deploy/restic.env.beispiel` anlegen (Rechte 600), dann einmalig `sudo bash -c 'set -a; . /etc/bautag/restic.env; restic init'`.
- **Storage Box (SFTP):** Bei Hetzner im Storage-Box-Menü „SSH-Support“ einschalten und den öffentlichen Schlüssel des Servers (zeigt die Installation an) hinterlegen. Adresse: `sftp:uXXXXXX@uXXXXXX.your-storagebox.de:/bautag` (Port 23: in `/root/.ssh/config` „Host uXXXXXX.your-storagebox.de / Port 23“ eintragen).
- **S3-kompatibel:** Bucket in einem EU-Rechenzentrum anlegen, Zugangsschlüssel mit Rechten nur für diesen Bucket erzeugen.

### Kopie 3: Büro-Kopie (NAS/PC)
- Das Skript `deploy/nas-kopie.sh` läuft **im Büro** (Linux-PC, Mac oder NAS mit restic, z. B. Synology mit „Container Manager“) und holt die **verschlüsselte** externe Sicherung ab – es braucht keinen Zugang zum Server.
- Einrichtung: `nas-kopie.env` neben das Skript legen (Adresse der externen Sicherung, Pfad zu einer Datei mit dem Sicherungs-Passwort, Zielordner), einmalig `nas-kopie.sh --einrichten`, danach täglich `nas-kopie.sh` (Aufgabenplanung/cron, z. B. 06:00 Uhr).
- Alternativ: externe USB-Festplatte am Büro-PC mit demselben Skript; die Platte wöchentlich tauschen und eine außer Haus lagern.

## 2. Automatische Kontrolle und Alarm

- Jeden **Sonntag** holt der Server die Datenbank-Stände aus der **externen** Sicherung in einen Probeordner (ohne die Fotos – das spart Platz), prüft die neueste Datenbank auf Fehler und zählt die Einträge („Wiederherstellungstest“). So ist sicher, dass die Sicherung im Ernstfall auch wirklich funktioniert.
- **Alarm an die Geschäftsführung** (Meldung in der App, Push aufs Handy und E-Mail), wenn
  - eine Sicherung oder der Wiederherstellungstest fehlschlägt, oder
  - die letzte erfolgreiche Sicherung (lokal oder extern) **älter als 26 Stunden** ist, oder
  - der letzte erfolgreiche Wiederherstellungstest älter als 8 Tage ist, oder
  - die Server-Festplatte zu **85 %** belegt ist bzw. weniger als 3 GB frei sind (Meldung „Speicherplatz knapp“).
- Ist die App selbst nicht erreichbar, schickt der Server die Warnung direkt an die bei der Installation angegebene E-Mail-Adresse (`ALARM_EMAIL`). Das geht nur mit einem Mailprogramm auf dem Server – die Installation richtet keines ein: ANLEITUNG.md, „Notfall-E-Mail“.
- Den Stand sieht die Geschäftsführung in der App unter *Einstellungen → Datensicherung*.

### Wenn ein Alarm kommt
1. In der App *Einstellungen → Datensicherung* öffnen: Welcher Schritt ist rot, welcher Text steht dabei?
2. Häufige Ursachen: Speicher beim Sicherungs-Anbieter voll oder Rechnung offen; Server-Festplatte voll (`df -h`); Zugangsdaten geändert.
3. Sicherung von Hand starten: `sudo bash /opt/bautag/deploy/backup.sh` – Ergebnis in `/var/log/bautag-sicherung.log`.
4. Kommt der Alarm am nächsten Tag wieder: Ihren IT-Betreuer mit dieser Datei und dem Protokoll beauftragen.

## 3. Notfall: Wiederherstellung

### a) Einzelne Daten versehentlich gelöscht oder Fehler eingespielt (Server läuft)
```
sudo bash /opt/bautag/deploy/wiederherstellen.sh --liste
sudo bash /opt/bautag/deploy/wiederherstellen.sh --datei /var/lib/bautag/sicherung/bautag-2026-11-12.db
```
Das Skript prüft den Stand, hält die App kurz an, legt die aktuelle Datenbank **beiseite** (nichts wird gelöscht) und startet die App mit dem gewählten Stand. Der Foto-Ordner bleibt dabei, wie er ist (er enthält alle Fotos bis heute); fehlt er, wird der lokale Spiegel eingespielt. Eingaben seit diesem Stand fehlen danach – vorher mit dem Büro klären.

### b) Server komplett verloren (Anbieter-Ausfall, Hackerangriff, Konto gekündigt)
1. **Notfallblatt** aus dem Tresor holen.
2. Neuen Server mieten (ANLEITUNG.md Schritt 1), am besten bei einem **anderen** Anbieter, wenn der alte betroffen ist.
3. DNS-Eintrag auf die **neue IP** ändern (ANLEITUNG.md Schritt 2).
4. Am neuen Server:
   ```
   git clone https://github.com/Michip55/Stundenaufzeichnung.git /opt/bautag && sudo bash /opt/bautag/deploy/installieren.sh --wiederherstellen
   ```
   Eingeben: Adresse, E-Mail, **Adresse der externen Sicherung**, **Sicherungs-Passwort** und **BAUTAG_SCHLUESSEL** vom Notfallblatt.
5. Das Skript holt den neuesten externen Stand, prüft ihn und startet BauTag. Ist der externe Speicher nicht erreichbar: die **Büro-Kopie** (Kopie 3) verwenden – `RESTIC_REPOSITORY` in `/etc/bautag/restic.env` auf den Büro-Ordner stellen (z. B. per SFTP vom NAS) und `wiederherstellen.sh --extern` ausführen.
6. Danach: alle Benutzer ab- und neu anmelden lassen; Push-Benachrichtigungen am Handy neu erlauben.
7. **Schlüssel verloren** (BAUTAG_SCHLUESSEL leer gelassen → neuer Schlüssel): Zwei-Faktor-Anmeldung, SMTP-Passwort und KI-Schlüssel sind dann nicht mehr lesbar. Das Skript sagt das und bietet an, die 2FA aller Personen zurückzusetzen (`docker compose run --rm app node server/entsperren.js --2fa-alle`; einzeln: `… entsperren.js <Personalnummer> --2fa`). Wiederherstellungscodes funktionieren auch mit neuem Schlüssel. Danach SMTP-Passwort und KI-Schlüssel in den Einstellungen neu eingeben und 2FA neu einrichten.
Zeitbedarf: etwa 1–2 Stunden.

## 4. Notfallblatt (ausdrucken, ausfüllen, in den Tresor)

```
BauTag – NOTFALLBLATT                                   Stand: ____________

Adresse der App:            https://______________________________

Server-Anbieter / Kundennr.: ______________________________________
Externe Sicherung (Anbieter, Adresse):
                            ______________________________________
Sicherungs-Passwort (restic):
                            ______________________________________
BAUTAG_SCHLUESSEL:          ______________________________________
Büro-Kopie (Ort/Gerät):     ______________________________________

Zugang Domain/DNS (Anbieter): _____________________________________
Ansprechpartner IT:         ______________________________________
```
Zwei Ausfertigungen: eine im Firmentresor, eine bei der Geschäftsführung privat (oder Bankschließfach). **Nicht** als Datei auf dem Server oder in E-Mails ablegen.

## 5. Schutz des Servers (macht die Installation automatisch)

- **Firewall:** nur Anmeldung (SSH, Port 22) und Webseite (80/443) sind von außen erreichbar; die App selbst und die Datenbank nicht.
- **SSH nur mit Schlüssel**, Passwort-Anmeldung aus; **fail2ban** sperrt Adressen nach wiederholten Fehlversuchen.
- **Automatische Sicherheitsupdates** jede Nacht (Neustart bei Bedarf um 03:30 Uhr, nach der Sicherung).
- **Nur HTTPS** mit automatisch erneuertem Zertifikat; der Browser merkt sich, dass nur HTTPS erlaubt ist (HSTS).
- Die App läuft **nicht als Administrator** (eigener Benutzer im Container, schreibgeschützt bis auf den Datenordner), startet nach Absturz oder Neustart automatisch.
- **Geheimnisse** (Schlüssel, Passwörter) stehen in Dateien, die nur der Administrator lesen kann (`deploy/.env`, `/etc/bautag/…`, Rechte 600). Das E-Mail-Passwort, die Zwei-Faktor-Geheimnisse und ein KI-Schlüssel werden in der Datenbank zusätzlich verschlüsselt.
- **Protokoll-Rotation:** Protokolle werden begrenzt, damit die Festplatte nicht voll läuft.
- In der App: PIN-Sperre nach Fehlversuchen, Zwei-Faktor-Anmeldung für Büro/GF, unveränderbares Änderungsprotokoll (wer hat wann was geändert).

## 6. Datenschutz (DSGVO) – Checkliste

- [ ] **Hosting in der EU** (Server und externe Sicherung je in einem EU-Rechenzentrum).
- [ ] **Auftragsverarbeitungsverträge (AVV)** mit dem Server-Anbieter und dem Sicherungs-Anbieter abgeschlossen (bei Nutzung der optionalen KI zusätzlich mit Anthropic; bei E-Mail mit dem Mail-Anbieter).
- [ ] **Verschlüsselung auf dem Weg:** HTTPS für die App, verschlüsselte Übertragung (SFTP/HTTPS) zur Sicherung.
- [ ] **Verschlüsselung im Ruhezustand:** externe Sicherung und Büro-Kopie sind verschlüsselt (restic); für den Server-Datenträger bietet der Anbieter Verschlüsselung bzw. physischen Schutz im Rechenzentrum (im AVV/TOM des Anbieters nachlesen).
- [ ] **Zugriffsprotokoll:** Die App protokolliert alle Änderungen (Benutzer, Zeit, alt/neu) unveränderbar; der Webserver protokolliert Zugriffe (10 Dateien à 10 MB, danach überschrieben).
- [ ] **Wer kommt an die Sicherungen?** Nur wer das **Sicherungs-Passwort** (Notfallblatt) **und** Zugang zum Sicherungs-Speicher hat. Server-Zugang (SSH-Schlüssel) nur Geschäftsführung und beauftragter IT-Betreuer. Liste führen und bei Personalwechsel Schlüssel/Passwörter ändern.
- [ ] **Verzeichnis der Verarbeitungstätigkeiten** um „Zeiterfassung/Bautagesbericht (BauTag)“ ergänzen; Mitarbeiter über die Zeiterfassung informieren (ggf. Betriebsvereinbarung).
- [ ] **Löschfristen:** Arbeitszeitaufzeichnungen sind nach Arbeitszeitgesetz/Lohnrecht aufzubewahren (Fristen mit der Lohnverrechnung abstimmen); Sicherungen laufen nach spätestens 12 Monaten (Büro-Kopie 24 Monate) automatisch aus.
- [ ] Bei einer Datenpanne (z. B. verlorener Laptop mit Zugang): Meldung an die Datenschutzbehörde binnen 72 Stunden prüfen.

**Prüfen** (mit Datenschutzbeauftragtem/Steuerberatung): Aufbewahrungsfristen, Informationspflicht gegenüber Mitarbeitern, Betriebsratsmitbestimmung bei der Zeiterfassung.
