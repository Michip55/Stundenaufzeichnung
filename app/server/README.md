# BauTag – Server (Backend)

Zeiterfassung, Bautagesbericht und Nachkalkulation für einen Erdbau-/Pflasterbetrieb. Node.js 22 (CommonJS), Express 5, SQLite über das eingebaute `node:sqlite`, PDF mit `pdfkit`. Der API-Vertrag steht in `../API.md`.

## Starten

```bash
cd app
npm install
npm run seed     # erzeugt data/bautag.db neu (fiktive Testdaten, ca. 3 Wochen Historie)
npm start        # http://localhost:3000 – liefert auch die Oberfläche aus app/public aus
npm test         # Unit- und API-Tests (node:test, :memory:-Datenbank)
```

> **Demo-PIN `1234` für alle Benutzer – nur für Testdaten. Vor Echtbetrieb ändern!**
> Die Testdaten (`npm run seed`) sind frei erfunden und dürfen nicht in den Echtbetrieb übernommen werden.
> Echte PINs setzt die Geschäftsführung unter „Benutzer“ (`PUT /api/benutzer/:id {pin}`).

Die Meldung `ExperimentalWarning: SQLite is an experimental feature` von Node 22 ist harmlos.

## Umgebungsvariablen

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | HTTP-Port |
| `BAUTAG_DB` | `app/data/bautag.db` | Pfad der SQLite-Datei (`:memory:` für flüchtige Tests) |
| `BAUTAG_UHR` | – | Startzeit als ISO-Zeitstempel (z. B. `2026-11-12T06:52:00+01:00`) für Demo/Tests. Die Uhr läuft ab dem Programmstart weiter. Wirkt auch auf `npm run seed`. |
| `TRUST_PROXY` | – | `1` hinter einem Reverse-Proxy (HTTPS-Erkennung für das `Secure`-Cookie) |
| `NODE_ENV` | – | ohne Sonderbedeutung |

## Aufbau

| Datei | Aufgabe |
|---|---|
| `index.js` | App-Fabrik `createApp({dbPath, uhr, seed})` (für Tests), Middleware, statische Oberfläche + SPA-Fallback, Fehlerformat |
| `db.js`, `schema.js` | Datenbankzugriff (nur parametrisierte Abfragen), Migrationen beim Start, Fremdschlüssel EIN, WAL |
| `auth.js` | PIN-Hash (scrypt + Salt, `timingSafeEqual`), Sitzungen (nur SHA-256 des Tokens gespeichert), Cookie `bt_session` (HttpOnly, SameSite=Strict, Secure bei HTTPS), 12 h Inaktivität, Sperre nach 5 Fehlversuchen für 5 min (429) |
| `rechte.js` | Rollen, Rechte-Matrix, **gesperrte Rechte** (Polier/Mitarbeiter nie Preise/Kalkulation/Lohn), Ausnahmen, Bereich „eigene Baustellen“, Entfernen von €-Feldern |
| `stempel.js` | Stempel-Zustandsautomat (kommen/pause/wechsel/gehen), Schichten, Personalzeilen für den Bericht |
| `azg.js` | AZG-Warnungen (> 10 Std., > 6 Std. ohne Pause, offen > 12 Std., < 11 Std. Ruhezeit) |
| `kalkulation.js` | Nachkalkulation und Budget-Kennzahlen (reine Funktionen) |
| `budget.js` | Budget-Alarm (je Baustelle und Schwelle einmalig, Empfänger nie Polier/Mitarbeiter) und Benachrichtigungen |
| `auswertung.js`, `export.js` | Woche, Monatsauswertung, CSV (Semikolon, UTF-8 mit BOM) für Lohnverrechnung und BUAK |
| `pdf.js` | Bautagesbericht-PDF im Aufbau der Papiervorlage, ohne €-Werte; Fassung Auftraggeber ohne K/U |
| `daten.js` | gemeinsame Lade-Funktionen |
| `routes/*.js` | HTTP-Routen je Bereich |
| `seed.js`, `png.js` | Testdaten, Demo-Unterschriften |

### Sicherheitsgrundsätze

- Rechte werden **bei jeder Anfrage am Server** geprüft; die Oberfläche blendet nur zusätzlich aus.
- Ohne `preise_sehen` werden €-Felder gar nicht erst aufgebaut; zusätzlich entfernt ein Sicherheitsnetz vor dem Senden alle bekannten €-Schlüssel (`rechte.entferneEuroFelder`). Die API-Tests prüfen alle Listen und Details für Polier und Mitarbeiter **ohne** dieses Netz.
- Schreibende Anfragen nur mit `Content-Type: application/json` (sonst 415) – zusammen mit `SameSite=Strict` Schutz gegen CSRF.
- Das Änderungsprotokoll (`protokoll`) ist per Datenbank-Trigger unveränderbar (kein UPDATE/DELETE).
- Rechte-, Rollen-, Preis-, Auftrags-, Nachtrags-, Freigabe-, Abwesenheits- und Export-Vorgänge werden protokolliert.

### Zeit

Alle Zeitstempel werden als ISO 8601 (UTC) gespeichert; Tagesgrenzen, Wochen und Monate gelten in `Europe/Vienna`. Feiertage Österreich werden berechnet (inkl. Ostern).

### Grenzen (ehrlich)

Push, E-Mail, SMS, Wetter, Diktat und Scan sind **nicht angebunden** (`/api/integrationen` → 501). Preise haben noch kein „gültig ab“; Korrektur-Workflow für Zeiten, Monatsabschluss, Fotos und Hochrechnung bis Bauende fehlen noch.
