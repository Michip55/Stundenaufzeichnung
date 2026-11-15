# BauTag – Dritte unabhängige Freigabeprüfung (Befunde 3)

Stand: 13.11.2026 · geprüft: `app/` (HEAD `4afe0c1`) gegen `app/API.md` (Abschnitte 6–8 vorrangig) und `docs/Konzept.md` Kap. 2.2.

## Urteil

**Nicht freigabefähig – ein blockierender Befund (D-01, hoch).**

- **D-01:** Die neue Kontosperre (Behebung von C-07) lässt sich ohne Anmeldung gegen das einzige GF-Konto und gegen das Büro-Konto richten. Die Sperre läuft nie ab, das Büro darf GF/Büro nicht entsperren – danach kommt niemand mehr in die Verwaltung. Von einer einzigen Adresse dauert das rund 83 Minuten.
- **Alle drei Blocker aus Prüfbericht 2 (C-01, C-04, C-05) sind behoben**, mit den Original-Reproduktionen nachgestellt.
- **Kernregel hält:** Polier und Mitarbeiter bekommen auf keinem Weg Preise, €-Werte oder Nachkalkulation, auch nicht mit allen vergebbaren Rechten. Der Bauleiter sieht nur eigene Baustellen. Niemand kann sich selbst Rechte geben.
- Fünf Befunde der Stufe „mittel“ sollten vor dem Echtbetrieb behoben oder von der GF entschieden werden (D-02 bis D-06).

**Tests**

| Lauf | Ergebnis |
|---|---|
| `npm test` | 225/225 bestanden |
| `npm run test:e2e` | parse 74/74; handy, tablet, pc je 377/377 bestanden |

Die Suiten decken D-01 bis D-06 nicht ab.

**So wurde geprüft**
- Code gelesen: alle Dateien in `server/` und `server/routes/`, dazu `public/js/views/korrektur.js`, `benutzer.js` und Teile von `berichte.js`.
- API: In-Prozess-Server mit steuerbarer Uhr (`tests/api/hilfe.js`, nur eingebunden), Skripte `p1.js`–`p9.js`.
- Oberfläche: echter Server auf Port 3300 mit eigener DB, Playwright-Skripte `ui1.js` und `ui2.js`.
- Ordnung: Server gestoppt, `git status` leer, am Repository nichts geändert.
- Alles liegt in `/tmp/claude-0/-home-user-Stundenaufzeichnung/1c043855-ef33-5685-9374-56f053b5f049/scratchpad/review3/` (auch `npmtest.log`, `e2e.log`, `shots/`).

---

## 1. Nachprüfung PRUEFBERICHT_2

| ID | Ergebnis | Nachweis / Rest |
|---|---|---|
| **C-01** (hoch) | **behoben** | Original: MA 9 stempelt 07–15 auf Baustelle 2, Polier 1 trägt ihn 07–15 ein → 400 (ohne `gast`: „nicht Partie“, mit `gast`: „überschneidet sich“). GF, Büro, Bauleiter als Zeile → 400. Gast 15–17 erlaubt → Monat 10 Std. (8 Stempel + 2 Bericht). Nachträgliche Büro-Schicht über die Berichtszeit → nur einmal gezählt, `ueberschneidung:true`, Warnung und CSV-Hinweis. Rest: D-03 (Tagesgrenze), D-04 (Bauleiter im Vorschlag). |
| C-02 | **behoben** | `stunden:24` bei 07–08 → gespeichert 1 Std.; Zeile ohne Zeiten → 0. |
| C-03 | **behoben** | MA 3 stempelt 8 Std., Bericht-Zeile ohne Zeiten, Freigabe → Monat und „Meine Woche“ 0 Std., `quelle:"bericht"`. Person fehlt im Bericht → 0 Std. plus Warnung `nicht_im_bericht` und CSV-Hinweis. |
| **C-04** (hoch) | **behoben** | `POST /zeit/schichten` für den 07.11. zwischen bestehenden Schichten → 201, Monat 7,5 Std.; `DELETE /zeit/schichten/:id` → 200, Tag wieder leer. Nachtschicht 22–06 → 201; Überschneidung → 409; für sich selbst, Polier, Bauleiter → 403. Dialog „Ganze Schicht nachtragen“ funktioniert in der Oberfläche. |
| **C-05** (hoch) | **behoben** | `stammdaten` für Bauleiter per Ausnahme und Matrix → 400. `PUT /baustellen/3 {bauleiterId:103}` → 403, `/kalkulation/3` → 403, `/mitarbeiter` ohne Lohngruppe/PNR, `POST /zeit/buchungen` → 403. |
| C-06 | **teilweise** | Original-Weg zu: Polier und Bauleiter `DELETE …/unterschrift/bh` → 403; Inhalt bleibt gesperrt (409). Vermerk steht in beiden PDF-Fassungen und in der Liste. **Rest:** siehe D-05. |
| C-07 | **behoben, aber fehlerhaft** | 20 Fehlversuche über 5 Adressen → 423, richtige PIN → 423, Büro benachrichtigt, Büro entsperrt → Anmeldung 200. **Neuer Fehler D-01.** Weiter offen: kein zweiter Faktor für Büro/GF (Konzept 7.4), Namensliste standardmäßig öffentlich. |
| C-08 | **behoben** | Veraltete `version` → 409 mit aktueller Version; ohne `version` → 400; Büro-Korrektur bleibt erhalten. Oberfläche zeigt „Inzwischen von jemand anderem geändert … Neu laden“. Baustelle und Auftrag ebenso. Rest: D-07. |
| C-09 | **behoben** | Büro eigener U → `beantragt`; selbst genehmigen → 403; eigene Buchung/Schicht → 403. Toast unterscheidet jetzt nach Status (aus dem Code, nicht nachgestellt). |
| C-10 | **behoben** | 27.03.2027 22–06: Vorschlag 7, nach `PUT` 7, Monat 7 Std. 30.10.2027 22–06: 9 Std. Zwei Blöcke über die Umstellung richtig. |
| C-11 | **behoben** | Genehmigter K für Nr. 27, Kolonne `gast:true` → `ok:false` „Krankenstand eingetragen“. Eigenes Einstempeln bei genehmigtem U → 409. Rest: Gast-Stempelung weiter nur im Protokoll, keine Meldung an den Stamm-Polier. |
| C-12 | **behoben** | `__id` im Body → 409 statt 500; ohne `pnr` vergibt der Server die nächste Nummer. |
| C-13 | **behoben** | Polier-SW → `beantragt`, zählt erst nach Bestätigung. Rest: D-09. |
| C-14 | **behoben** | Büro: Liste 200, Mitarbeiter anlegen 201, PIN-Reset 200, Entsperren 200. Büro/GF anlegen, GF bearbeiten/deaktivieren/PIN-Reset/entsperren, sich selbst bearbeiten, Rollen zu Büro/GF → alle 403. Rest: Protokoll für das Büro nicht einsehbar (Konzept: ja; API 8: nur GF). Siehe D-02. |
| C-15 | **behoben** | Mit Geräte-Zeitzone America/New_York zeigt die Korrektur dieselben Wiener Zeiten wie der Server; nachgetragene Schicht 06:15–14:45 wird als 04:15Z–12:45Z gespeichert. |

**Offene Punkte aus Bericht 1**

| ID | Ergebnis | Nachweis / Rest |
|---|---|---|
| M-01 | behoben | SEG-Feld je Person ist in der Oberfläche vorhanden und wird gesendet (`berichte.js:261`, `:197`); E2E-Prüfung grün. Nicht eigens nachgestellt. |
| M-05 | unverändert | Sitzungsdauer 12 Std./60 Min. als GF-Entscheidung dokumentiert, per Umgebungsvariable einstellbar. |
| M-08 | nicht behoben | Preise ohne „gültig ab“, weiter als bekannte Grenze dokumentiert. |
| B-03 | teilweise | Zweiter Faktor für Büro/GF fehlt weiter; siehe auch D-01, D-12. |

---

## 2. Neue Befunde

### D-01 · hoch · Kontosperre sperrt GF und Büro dauerhaft aus – ohne Anmeldung auslösbar, kein Weg zurück

**Dateien**
- `server/auth.js:226-233` (`pruefeKonto`: Sperre ohne Ablauf), `:235-247`
- `server/routes/auth.js:15-27`, `:44-46`, `:55-56`
- `server/routes/benutzer.js:181-185` und `server/rechte.js:178-181` (Büro darf Büro/GF nicht entsperren)
- `server/seed.js:74-76` (eine GF, ein Büro)

**Reproduktion** (`p4.js`, `TRUST_PROXY=1`, eine einzige Adresse 66.6.6.6, kein Login nötig):
1. `GET /api/auth/benutzerliste` liefert die ID der GF (102).
2. Wiederholt `POST /api/auth/login {"benutzerId":102,"pin":"999999"}`; bei 429 die `Retry-After`-Zeit abwarten.
3. Antworten: `401,401,401,401,429` – dreimal – dann `401,401,401,401,423`. Dauer ca. 83 Minuten.
4. GF mit richtiger PIN von anderer Adresse → **423**.
5. Büro: `POST /api/benutzer/102/entsperren` → **403**; `PUT /api/benutzer/102 {"pin":…}` → **403**.
6. Dasselbe gegen Büro (101) → 423. Uhr 30 Tage vor → GF weiter **423**.

**Beobachtet**
- Mit den Testdaten gibt es danach kein Konto mehr, das entsperren kann. Laufende Sitzungen enden spätestens nach 24 Std.; dann ist die Verwaltung nur noch per Eingriff in die Datenbank erreichbar.
- Mit 20 Anfragen je Konto lässt sich so auch jeder Mitarbeiter täglich aussperren (kein Stempeln).
- `BAUTAG_LOGIN_LISTE=0` hilft nicht: Anmeldung über die fortlaufende `benutzerId` bleibt möglich (`p9.js`: Büro gesperrt trotz abgeschalteter Liste), siehe D-12.

**Erwartet:** Schutz vor PIN-Raten ohne dauerhafte Aussperrung der Verwaltung. Konzept 2.2: „mindestens zwei Admins, damit sich niemand aussperrt“. API 8 nennt die Sperr-Möglichkeit als gewollt, setzt aber voraus, dass „das Büro entsperrt“ – für GF/Büro gibt es diesen Weg nicht.

**Vorschlag**
- Sperre befristen (z. B. 24 Std., danach steigende Wartezeit) statt unbegrenzt.
- Für Büro/GF einen Entsperrweg schaffen: Büro darf GF entsperren (nur entsperren, kein PIN-Reset) oder ein Server-Befehl `node server/entsperren.js <pnr>`.
- Zweiter Faktor für Büro/GF (Konzept 7.4); beim Start warnen, wenn es nur eine aktive GF gibt.

### D-02 · mittel · Büro kann einen Polier/Mitarbeiter zum Bauleiter machen und ihm Baustellen zuordnen – €-Einsicht ohne GF

**Dateien:** `server/routes/benutzer.js:139-147`, `server/rechte.js:178-181`, `server/routes/stammdaten.js:60-64`

**Reproduktion** (`p4.js`):
1. Polier 13: `GET /api/kalkulation/3` → 403.
2. Büro: `PUT /api/benutzer/13 {"rolle":"bauleiter"}` → 200.
3. Büro: `PUT /api/baustellen/3 {"bauleiterId":13,"version":…}` → 200.
4. Nr. 13 meldet sich mit der unveränderten **4-stelligen** PIN an: `GET /api/kalkulation/3` → 200 (`auftragssumme 25300`, `db 1306.67`), `GET /api/preise` → 200.

**Beobachtet:** Nur ein Protokolleintrag (Art `rolle`), den nur die GF sieht; keine Benachrichtigung an die GF. Die PIN-Mindestlänge 6 für Bauleiter wird beim Rollenwechsel nicht durchgesetzt.

**Erwartet:** Konzept 2.2: „Rollen und Ausnahmen vergeben“ nur GF; „Soll ein Polier solche Daten sehen, muss er bewusst die Rolle Bauleiter bekommen“. API 8 erlaubt dem Büro den Wechsel innerhalb Mitarbeiter/Polier/Bauleiter – die beiden Vorgaben widersprechen sich. Es ist keine Selbst-Ausweitung (das Büro sieht die Werte ohnehin), aber die GF verliert die Kontrolle darüber, wer €-Werte sieht.

**Vorschlag:** Wechsel **zu** `bauleiter` nur durch die GF (Büro weiter Mitarbeiter ↔ Polier und Bauleiter anlegen nach GF-Entscheid), oder mindestens Benachrichtigung an die GF plus erzwungener PIN-Wechsel auf 6 Stellen.

### D-03 · mittel · Doppelzählung im Lohn über die Tagesgrenze (Nachtschicht)

**Dateien:** `server/routes/berichte.js:160-175` (`:162` überspringt die eigene Baustelle, `:169-170` vergleicht nur Berichte desselben Datums), `server/auswertung.js:125-150` (Sicherheitsnetz nur innerhalb eines Tages)

**Reproduktion** (`p3.js`):
1. MA 3: Schicht 08.11.2027 22:00 – 09.11. 06:00 auf Baustelle 1.
2. Polier 1 legt den Bericht für den **09.11.** an (Vorschlag leer) und trägt MA 3 mit 00:00–06:00 ein → 200.
3. Unterschriften, Freigabe, `GET /api/monat?monat=2027-11`.

**Beobachtet:** 08.11. = 8 Std. (`stempel`), 09.11. = 6 Std. (`bericht`), also **14 statt 8 Std.**, keine Warnung. Ebenso angenommen: MA 9 im Bericht Baustelle 2 am 09.11. 04:00–12:00 und im Bericht Baustelle 1 am 08.11. 22:00–06:00 (Gast) → beide 200.

**Erwartet:** Gleiche Person und gleiche Zeit nie doppelt (C-01), auch über Mitternacht.

**Vorschlag:** Überschneidungen mit echten Zeitpunkten prüfen – Berichte von Vortag und Folgetag sowie Stempelzeiten der **eigenen** Baustelle, die zu einem anderen Berichtstag gehören; dasselbe im Sicherheitsnetz der Monatsauswertung.

### D-04 · mittel · Bauleiter/Büro/GF stempeln auf einer Baustelle: Vorschlag des Servers wird beim Speichern abgelehnt, ihre Stunden zählen danach 0

**Dateien:** `server/daten.js:130-137` (`personalVorschlag` nimmt jede gestempelte Person), `server/routes/berichte.js:131`, `:352`, `:386`, `server/auswertung.js:132-136`

**Reproduktion** (`p6.js`, `p8.js`, `ui2.js`):
1. Bauleiter 103 stempelt 08–12, GF 102 09–11, MA 3 07–15 auf Baustelle 1.
2. Polier 1: `POST /api/berichte` → Vorschlag enthält MA 3, GF und Bauleiter.
3. Polier sendet den unveränderten Vorschlag per `PUT` → **400** „… kann nicht als Personal eingetragen werden“. In der Oberfläche (390 und 1440): jede Änderung am Personal endet mit „Nicht gespeichert“.
4. Polier löscht die beiden Zeilen, unterschreibt, Büro gibt frei.

**Beobachtet:** Monat und „Meine Woche“ für Bauleiter und GF: **0 Std.**, `quelle:"bericht"`, Warnung `nicht_im_bericht`. Löscht der Polier nichts und ändert nur Texte, bleiben die Zeilen und zählen. Abhilfe heute nur über Umbuchen der „kommen“-Buchung auf eine andere Kostenstelle durch das Büro.

**Erwartet:** Der eigene Vorschlag des Servers ist speicherbar, und gestempelte Stunden dieser Rollen gehen nicht verloren.

**Vorschlag:** Bauleiter/Büro/GF nicht in den Vorschlag aufnehmen und ihre Stempelzeiten von der Regel „Bericht ersetzt Stempel“ ausnehmen (sie stehen laut Vertrag nie im Bericht).

### D-05 · mittel · Bauherr-Unterschrift lässt sich spurlos überschreiben; Bild-Sperre mit einem Byte umgehbar (Rest C-06)

**Dateien:** `server/routes/berichte.js:399-409` (Upsert ohne Prüfung auf vorhandene Unterschrift), `:411-415` (Protokoll erst bei zwei Unterschriften), `server/db.js:120-123`

**Reproduktion** (`p1.js`, `p8.js`):
1. Polier 8: `POST …/unterschrift {rolle:"bh", name:"DI Echt", bildPng:A}` → 200.
2. Polier 8: `POST …/unterschrift {rolle:"bh", name:"Jemand anders", bildPng:B}` → **200**, Name und Bild ersetzt.
3. Nach Rücknahme durch das Büro: Bild A plus ein angehängtes Null-Byte → **200**. Auch das unveränderte Bild A wird wieder angenommen, weil es nie als zurückgezogen vermerkt wurde.

**Beobachtet:** Zu Schritt 2 gibt es keinen Protokolleintrag, `geaendertNachUnterschrift` bleibt `null`, kein Vermerk im PDF. Der Inhalt bleibt dabei gesperrt.

**Erwartet:** Eine vorhandene Unterschrift wird nur über die Rücknahme ersetzt (Bauherr: nur Büro/GF, mit Vermerk); API 8: wiederverwendete Bilder werden abgelehnt.

**Vorschlag:** `POST …/unterschrift` für eine schon vorhandene Rolle → 409. Hash über die dekodierten Bildpunkte statt über die Datei bilden, oder den Hash-Schutz ehrlich als Komfortprüfung dokumentieren.

### D-06 · mittel · Start-PIN 1234: Wer sich zuerst anmeldet, übernimmt das Konto – auch die GF; kein anderer Weg zum ersten Admin

**Dateien:** `server/seed.js:20`, `:197`; `server/README.md` (Starten)

**Reproduktion** (`p9.js`, ohne `BAUTAG_DEMO`):
1. Fremder: `POST /api/auth/login {"benutzerId":102,"pin":"1234"}` → 200 `mussPinAendern:true`.
2. `POST /api/auth/pin {"alt":"1234","neu":"739152"}` → 200; `GET /api/rechte` → 200.
3. Echte GF mit 1234 → 401.

**Beobachtet:** Bis zur ersten Anmeldung hat jedes Konto die öffentlich dokumentierte PIN. Die README warnt davor, einen anderen Weg, ohne Testdaten eine erste GF anzulegen, gibt es aber nicht.

**Vorschlag:** Einrichtungsbefehl für die erste GF mit selbst gewählter PIN (`node server/einrichten.js`) und leerer Datenbank; Testdaten nur noch mit `BAUTAG_DEMO=1`.

### D-07 · niedrig · Unterschrift prüft die Version nicht

**Datei:** `server/routes/berichte.js:391-398`

**Reproduktion** (`p3.js`): Büro ändert den Bericht (Version 3); Polier sendet `POST …/unterschrift` mit `version:1` → 200.

**Beobachtet:** Der Bauherr kann am Tablet einen veralteten Stand sehen und unterschreibt den geänderten Inhalt. `personal-aktualisieren` prüft die Version nur, wenn sie mitkommt.

**Vorschlag:** `version` bei Unterschrift verlangen; die Oberfläche sendet sie mit.

### D-08 · niedrig · Genehmigte Abwesenheit und Arbeitsstunden am selben Tag ohne Warnung

**Dateien:** `server/routes/abwesenheiten.js:63-64`, `server/routes/zeit.js:351-408`, `server/auswertung.js:226-246`

**Reproduktion** (`p6.js`, `p7.js`): MA 3 hat 8 Std. gestempelt; Büro trägt für denselben Tag „K“ ein → 201 `genehmigt`. Umgekehrt: genehmigter U, Büro trägt eine Schicht 10–12 nach → 201.

**Beobachtet:** Monat `{"stunden":8,"code":"K"}` bzw. `{"stunden":2,"code":"U"}`, K-/U-Tag **und** Stunden im Lohn- und BUAK-Export, keine Warnung. Nur das eigene Einstempeln ist gesperrt.

**Vorschlag:** Warnung `typ:"abwesenheit_mit_stunden"` in Monat und CSV; beim Eintragen Rückfrage.

### D-09 · niedrig · Schlechtwetter: Polier kann sich selbst nicht melden, Bauleiter kann nicht bestätigen

**Datei:** `server/routes/abwesenheiten.js:59-62`, `:97-98`

**Reproduktion** (`p6.js`): Polier 1 `POST /api/abwesenheiten {benutzerId:1, code:"SW"}` → 403 „Selbst nur U/ZA“. Bauleiter 103 `PUT /api/abwesenheiten/<SW-Antrag>` → 403.

**Erwartet:** Konzept 2.2: Polier meldet SW (er gehört zur Partie), Bauleiter und Büro bestätigen. API 8 nennt nur „Büro/Lohn bestätigt“.

**Vorschlag:** Polier-SW auch für sich selbst (`beantragt`); Bestätigung von SW durch den Bauleiter der Baustelle zulassen oder das Konzept anpassen.

### D-10 · niedrig · Bautagesbericht ohne Vier-Augen-Prinzip

**Datei:** `server/routes/berichte.js:391`, `:450-457`

**Reproduktion** (`p6.js`): Bauleiter 103 legt einen Bericht an, leistet beide Unterschriften (`an` und `bh`) und gibt ihn frei → 200 `freigegeben`.

**Beobachtet:** Eine Person allein erzeugt lohnwirksame Stunden und Kosten. Das neue Vier-Augen-Prinzip gilt nur für Abwesenheiten und Stempelkorrekturen.

**Vorschlag:** Freigabe nicht durch die Person, die beide Unterschriften erfasst hat; mindestens Kennzeichen in Monat und Protokoll. GF-Entscheidung.

### D-11 · niedrig · Zuordnung bleibt nach Rollenwechsel bestehen

**Datei:** `server/routes/benutzer.js:160-165`

**Reproduktion** (`p4.js`): Bauleiter 13 wird wieder Polier → `GET /api/baustellen/3` zeigt weiter `bauleiterId:13`.

**Beobachtet:** €-Zugriff ist weg (403, keine Budget-Felder, keine Meldungen), aber die Baustelle hat keinen wirksamen Bauleiter mehr: keine Freigabe durch einen Bauleiter, kein Budget-Alarm an diese Rolle, kein Hinweis.

**Vorschlag:** Beim Rollenwechsel unpassende `bauleiter_id`/`polier_id` leeren oder die Änderung mit Hinweis ablehnen.

### D-12 · niedrig · `BAUTAG_LOGIN_LISTE=0` verbirgt die Konten nicht

**Datei:** `server/routes/auth.js:44-46`

**Reproduktion** (`p9.js`): Liste abgeschaltet (404), `POST /api/auth/login {"benutzerId":101,…}` wird weiter angenommen; 20 Versuche → Konto gesperrt.

**Vorschlag:** Bei abgeschalteter Liste nur `pnr` annehmen.

---

## 3. Geprüft und in Ordnung

- **€-Geheimhaltung** (`p5.js`, mit und ohne Sicherheitsnetz): Polier 1 und 8, Mitarbeiter 2 und 27 mit allen vergebbaren Matrix- und Ausnahmerechten gegen 314 GET-Adressen je Benutzer – alle Listen, jede Baustelle, jeder Bericht, PDFs in beiden Fassungen, CSV, Protokoll, Benachrichtigungen. Keine €-Felder, keine €-Zeichen, keine Auftragssummen. Einziger Treffer: die eigene Lohngruppen-ID in `/auth/ich`.
- **Bauleiter:** keine €-Felder zu fremden Baustellen, weder in Listen noch im Detail; `/monat`, `/rechte`, `/benutzer` → 403.
- **Sperren der Rechte:** Preis-, Kalkulations-, Lohn-, Stammdaten- und Benutzerrechte für Polier/Mitarbeiter sowie `preise_bearbeiten`, `lohn`, `stammdaten`, `benutzer` für Bauleiter per Matrix und Ausnahme → 400. `benutzer` für Büro → 400.
- **Büro-Benutzerverwaltung:** kein Weg zu Büro-/GF-Rechten (alle Versuche 403); entzieht die GF dem Büro `stammdaten`, ist die Verwaltung sofort zu.
- **GF-Schutz:** eigene Rolle ändern oder sich deaktivieren → 403; zweite GF deaktiviert die erste → deren Sitzung endet (401), Anmeldung 401.
- **Zeitkorrektur:** Zukunft, `von = bis`, über 16 Std., Pause außerhalb, zu kurzer Grund, ohne Zeitzone → 400; „gehen“ vor „kommen“ → 409; offene Schicht löschbar; Schicht vor einer laufenden Schicht nachtragbar. Alles protokolliert.
- **Abwesenheiten:** Zustände beantragt → abgelehnt → neu beantragt → genehmigt; Löschen nur eigener beantragter; `status:"beantragt"` per PUT → 400; fremde Anträge und Entscheiden durch Mitarbeiter/Polier/Bauleiter → 403.
- **Lohn-Export:** Summe je Person = Summe der Tage; Normal + Überstunden = Summe (30 Personen, Dezember und Jänner); CSV-Tageszeilen = CSV-Summenzeile.
- **Oberfläche** (`ui1.js`): 5 Rollen × 3 Größen × 20 Ansichten = 300 Aufrufe. Kein horizontales Überlaufen, keine Skriptfehler, kein „undefined/NaN“, kein €-Zeichen bei Polier/Mitarbeiter. Einzige Konsolenmeldung: erwartetes 403 beim Bauleiter auf der fremden `#/kalkulation/3`.
- **Service Worker:** fängt `/api` nicht ab; im Gerätespeicher liegen nur Name, Rolle, Rechte und Baustellennamen.

## 4. Nicht geprüft

- Betrieb hinter HTTPS-Reverse-Proxy, echte Mobilgeräte, Tastatur- und Screenreader-Bedienung, Last.
- C-09-Toast und M-01-SEG-Feld nur aus dem Code bzw. über die E2E-Suite, nicht eigens nachgestellt.
- **unbestätigt:** Nachkalkulation für Bauleiter fasst Lohngruppen mit nur einer Person nicht zusammen (Konzept 2.2, Datenschutz) – nicht geprüft.
- **unbestätigt:** gleichzeitiges `POST /benutzer` mit derselben Personalnummer (Prüfung vor dem `await`) – aus dem Code sollte der UNIQUE-Index mit 409 greifen.

## 5. Freigabe-Blocker

| ID | Schwere | Kurz |
|---|---|---|
| **D-01** | hoch | Kontosperre sperrt GF/Büro ohne Anmeldung dauerhaft aus, kein Entsperrweg |

**Vor dem Echtbetrieb beheben oder entscheiden (mittel):** D-02, D-03, D-04, D-05, D-06.

**Hinweis:** Der letzte Commit heißt „Zwischenstand Prüfbericht-2-Behebung (in Arbeit)“, `FORTSCHRITT.md` meldet die Behebung als erledigt.
