# BauTag – Server (Backend)

Zeiterfassung, Bautagesbericht und Nachkalkulation für einen Erdbau-/Pflasterbetrieb. Node.js 22 (CommonJS), Express 5, SQLite über das eingebaute `node:sqlite`, PDF mit `pdfkit`. Der API-Vertrag steht in `../API.md`.

## Starten

```bash
cd app
npm install
npm run seed                   # erzeugt data/bautag.db neu (fiktive Testdaten, ca. 3 Wochen Historie)
BAUTAG_DEMO=1 npm run seed     # dasselbe für Vorführungen: PIN 1234 ohne Pflicht zur Änderung
npm start                      # http://localhost:3000 – liefert auch die Oberfläche aus app/public aus
npm test                       # Unit- und API-Tests (node:test, :memory:-Datenbank)
```

> **Start-PIN `1234` für alle Testdaten-Benutzer – vor Echtbetrieb ändern!**
> Ohne `BAUTAG_DEMO=1` muss jeder Benutzer die PIN beim ersten Anmelden ändern (`POST /api/auth/pin`);
> bis dahin antworten alle anderen Routen mit 403 `PIN_AENDERN`. Mit `BAUTAG_DEMO=1` bleibt 1234 ohne
> Änderungspflicht – **nur für Vorführungen**. Die Testdaten sind frei erfunden und gehören nicht in den Echtbetrieb.
> PIN-Länge: Mitarbeiter/Polier mind. 4, Bauleiter/Büro/GF mind. 6 Ziffern, keine Folgen wie 1234/1111.
> Setzt die GF eine PIN zurück, muss der Benutzer sie beim nächsten Anmelden ändern.

Die Meldung `ExperimentalWarning: SQLite is an experimental feature` von Node 22 ist harmlos.

## Umgebungsvariablen

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | HTTP-Port |
| `BAUTAG_DB` | `app/data/bautag.db` | Pfad der SQLite-Datei (`:memory:` für flüchtige Tests) |
| `BAUTAG_UHR` | – | Startzeit als ISO-Zeitstempel (z. B. `2026-11-12T06:52:00+01:00`) für Demo/Tests. Die Uhr läuft ab dem Programmstart weiter. Wirkt auch auf `npm run seed`. |
| `TRUST_PROXY` | – | **`1` hinter einem Reverse-Proxy setzen** (für HTTPS/PWA üblich). Nur dann gelten `X-Forwarded-For` (echte Client-IP für die Login-Sperre) und `X-Forwarded-Proto` (`Secure`-Cookie, HSTS). Ohne Proxy weglassen – sonst könnte jeder die Header fälschen. Fehlt es hinter einem Proxy, ist die Client-IP die Proxy-Adresse und die IP-Grenze der Anmeldung träfe alle gemeinsam. |
| `BAUTAG_DEMO` | – | `1`: Testdaten ohne Pflicht zur PIN-Änderung (nur Vorführung) |
| `BAUTAG_LOGIN_LISTE` | `1` | `0`: öffentliche Namensliste für die Anmeldung abschalten; Anmeldung dann mit Personalnummer + PIN |
| `BAUTAG_SITZUNG_FELD_MIN` | `720` | Sitzungsablauf nach Inaktivität (Minuten) für Mitarbeiter/Polier – Konzept-Vorschlag für das Polier-Tablet: `10` |
| `BAUTAG_SITZUNG_BUERO_MIN` | `60` | Sitzungsablauf nach Inaktivität (Minuten) für Bauleiter/Büro/GF – Konzept-Vorschlag: `30` |
| `BAUTAG_SITZUNG_MAX_H` | `24` | absolute Höchstdauer einer Sitzung (Stunden) |
| `NODE_ENV` | – | ohne Sonderbedeutung |

## Aufbau

| Datei | Aufgabe |
|---|---|
| `index.js` | App-Fabrik `createApp({dbPath, uhr, seed})` (für Tests), Middleware, statische Oberfläche + SPA-Fallback, Fehlerformat |
| `db.js`, `schema.js` | Datenbankzugriff (nur parametrisierte Abfragen), Migrationen beim Start, Fremdschlüssel EIN, WAL |
| `auth.js` | PIN-Hash (scrypt + Salt, `timingSafeEqual`), PIN-Regeln je Rolle, Sitzungen (nur SHA-256 des Tokens gespeichert), Cookie `bt_session` (HttpOnly, SameSite=Strict, Secure bei HTTPS), Ablauf je Rolle, Sperre je (Benutzer, Client-IP) nach 5 Fehlversuchen mit steigender Dauer 5/15/60 min, IP-Grenze 30 Fehlversuche/5 min (429) |
| `rechte.js` | Rollen, Rechte-Matrix, **gesperrte Rechte** (Polier/Mitarbeiter nie Preise/Kalkulation/Lohn), Ausnahmen, Bereich „eigene Baustellen“, Entfernen von €-Feldern |
| `stempel.js` | Stempel-Zustandsautomat (kommen/pause/wechsel/gehen), Schichten, Personalzeilen für den Bericht |
| `azg.js` | AZG-Warnungen (> 10 Std., > 6 Std. ohne Pause, offen > 12 Std., < 11 Std. Ruhezeit) |
| `kalkulation.js` | Nachkalkulation und Budget-Kennzahlen (reine Funktionen) |
| `budget.js` | Budget-Alarm (je Baustelle und Schwelle einmalig, Empfänger nie Polier/Mitarbeiter) und Benachrichtigungen |
| `auswertung.js`, `export.js` | Woche, Monatsauswertung, CSV (Semikolon, UTF-8 mit BOM) für Lohnverrechnung und BUAK |
| `pdf.js` | Bautagesbericht-PDF im Aufbau der Papiervorlage, ohne €-Werte; Fassung Auftraggeber ohne K/U |
| `daten.js` | gemeinsame Lade-Funktionen |
| `routes/*.js` | HTTP-Routen je Bereich (u. a. `abwesenheiten.js` Antrag/Genehmigung, `zeit.js` mit Zeitkorrektur durch das Büro) |
| `seed.js`, `png.js` | Testdaten, Demo-Unterschriften |

### Sicherheitsgrundsätze

- Rechte werden **bei jeder Anfrage am Server** geprüft; die Oberfläche blendet nur zusätzlich aus.
- Ohne `preise_sehen` werden €-Felder gar nicht erst aufgebaut; zusätzlich entfernt ein Sicherheitsnetz vor dem Senden alle bekannten €-Schlüssel (`rechte.entferneEuroFelder`). Die API-Tests prüfen alle Listen und Details für Polier und Mitarbeiter **ohne** dieses Netz.
- Schreibende Anfragen nur mit `Content-Type: application/json` (sonst 415) – zusammen mit `SameSite=Strict` Schutz gegen CSRF.
- Das Änderungsprotokoll (`protokoll`) ist per Datenbank-Trigger unveränderbar (kein UPDATE/DELETE). Einträge mit €-Bezug sieht nur, wer `preise_sehen` hat.
- `benutzer` (Rechte/Rollen vergeben) hat nur die GF; niemand ändert die eigene Rolle.
- Header: Content-Security-Policy (keine Inline-Skripte), `nosniff`, `Referrer-Policy`, `frame-ancestors 'none'`, HSTS nur bei HTTPS.
- Rechte-, Rollen-, Preis-, Auftrags-, Nachtrags-, Freigabe-, Abwesenheits- und Export-Vorgänge werden protokolliert.

### Zeit

Alle Zeitstempel werden als ISO 8601 (UTC) gespeichert; Tagesgrenzen, Wochen und Monate gelten in `Europe/Vienna`. Feiertage Österreich werden berechnet (inkl. Ostern).

### Grenzen (ehrlich)

Push, E-Mail, SMS, Wetter, Diktat und Scan sind **nicht angebunden** (`/api/integrationen` → 501). Preise haben noch kein „gültig ab“ (eine Preisänderung wirkt rückwirkend auf alle Berichte, siehe `API.md` 7, M-08); Monatsabschluss, Fotos und Hochrechnung bis Bauende fehlen noch. Zeitkorrekturen macht das Büro (`/api/zeit/buchungen`), Korrekturanträge der Mitarbeiter gibt es noch nicht.

### Produktentscheidungen (von der GF zu bestätigen)
- **Sitzungsdauer:** Standard 12 h für Mitarbeiter/Polier (persönliche Geräte; ständiges Neu-Anmelden mit Handschuhen auf der Baustelle ist unpraktisch) und 60 min für Bauleiter/Büro/GF (dort liegen €-Daten), absolute Grenze 24 h. Das Konzept schlägt 10 bzw. 30 min vor – per Umgebungsvariable einstellbar.
- **Kontosperre:** 20 falsche PINs in 24 h (über alle Geräte/IPs) sperren das Konto, bis Büro/GF entsperren (`POST /api/benutzer/:id/entsperren`), Büro/GF werden benachrichtigt. Abwägung: Ein Angreifer kann ein Konto so absichtlich sperren (Ärgernis), dafür ist verteiltes Durchprobieren einer 4-stelligen PIN nicht mehr möglich.
- **Vier-Augen-Prinzip:** Eigene Urlaubs-/ZA-Anträge und eigene Stempelkorrekturen entscheidet bzw. macht immer eine andere Person (auch bei Büro/GF).
- **Stammdaten/Zuordnung:** Bauleiter- und Polier-Zuordnung der Baustellen pflegt nur das Büro bzw. die GF; Bauleiter können `stammdaten` nicht erhalten.
- **Benutzerverwaltung:** Büro legt Mitarbeiter/Poliere/Bauleiter an, setzt PINs zurück und entsperrt; Büro- und GF-Konten sowie Rechte/Rollen-Matrix nur die GF.

### Zeitregeln
- Schichten zählen zum Tag des Beginns; über Mitternacht ist „bis“ < „von“.
- Schichten über 16 Std. (vergessenes Ausstempeln) zählen mit 0 Std., bis das Büro korrigiert.
- In Monat/Lohn-Export gilt je Person, Tag und Baustelle: Gibt es einen **freigegebenen** Bautagesbericht, zählen nur dessen Stunden (auch 0, Person fehlt → 0 mit Warnung); sonst die Stempelzeiten. Überschneidungen werden nur einmal gezählt und gemeldet. SEG-Stunden nur aus freigegebenen Berichten; nur **genehmigte** Abwesenheiten zählen.
- Berichtsstunden rechnet immer der Server aus den Zeiten und der Pause (echte Zeitpunkte, also auch über Mitternacht und Zeitumstellung richtig). Personen im Bericht: Partie, auf der Baustelle gestempelt oder ausdrücklich als Gast; nie Bauleiter/Büro/GF; keine zeitliche Überschneidung mit anderen Baustellen.
- Ganze Schichten trägt das Büro mit `POST /api/zeit/schichten` nach bzw. löscht sie mit `DELETE /api/zeit/schichten/:id` (immer mit Grund).
