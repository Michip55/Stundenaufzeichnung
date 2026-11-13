# BauTag in Betrieb nehmen – Schritt für Schritt

Diese Anleitung ist für den Inhaber ohne IT-Kenntnisse geschrieben. Zeitaufwand: etwa 1 Stunde.
Laufende Kosten: Server ca. 5–10 € im Monat, externe Sicherung ca. 3–5 € im Monat, Internet-Adresse ca. 1 € im Monat.

> **Sicherheit der Daten:** Bitte zusätzlich **SICHERHEIT.md** lesen (Sicherungen, Notfallblatt, Datenschutz).

---

## Schritt 1: Kleinen Server mieten (EU-Anbieter)

1. Bei einem Anbieter mit Rechenzentrum in der EU ein Konto anlegen, z. B. **Hetzner** (Deutschland/Finnland), **netcup** (Deutschland) oder **IONOS** (Deutschland). Wählen Sie ein Rechenzentrum in Deutschland oder Österreich.
2. Einen „Cloud-Server“ / „VPS“ bestellen:
   - Betriebssystem: **Ubuntu 24.04**
   - Größe: 2 CPU, 4 GB RAM, 40 GB Festplatte reichen für einen Betrieb mit 50 Mitarbeitern.
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
