# BauTag – Zweite unabhängige Freigabeprüfung (Befunde 2)

Stand: 13.11.2026 · geprüft: `app/` (Server, Oberfläche, Tests) gegen `app/API.md` (Abschnitte 6/7 vorrangig) und `docs/Konzept.md` Kap. 2.2.

**So wurde geprüft:**
- Code gelesen: alle Dateien in `server/`, `server/routes/` sowie die geänderten Ansichten in `public/js/`.
- Server laut Vorgabe gestartet: `BAUTAG_DEMO=1`, Port 3200, eigene DB im Scratchpad.
- Zusätzlich In-Prozess-Server mit steuerbarer Uhr und `trustProxy` für die Anmelde-Bremse.
- Jede Rolle gegen jede Route geprüft, auch mit allen vergebbaren Ausnahmen.
- Oberfläche mit Playwright auf 390×844, 1180×820 und 1440×900.

**Ordnung:** Server gestoppt, am Repository nichts geändert (`git status` leer).

**Prüfskripte und Logs:** `/tmp/claude-0/-home-user-Stundenaufzeichnung/1c043855-ef33-5685-9374-56f053b5f049/scratchpad/review2/`
- `p1.js`–`p10.js`: API
- `ui1.js`–`ui4.js`: Oberfläche
- `npmtest.log`, `e2e.log`: Testläufe

## Urteil

**Nicht freigabefähig.**

Drei Befunde der Stufe „hoch“ blockieren die Freigabe: **C-01, C-04, C-05**.

**Kernregel (€ nur für Büro, GF und Bauleiter eigener Baustellen):**
- Für Polier und Mitarbeiter hält sie auf allen Wegen: API, PDF, Oberfläche, Exporte, Benachrichtigungen, Protokoll und Fehlertexte. Das gilt auch mit allen vergebbaren Ausnahmen und Matrixrechten.
- Ein Bauleiter, dem die GF `stammdaten` gibt (das Recht ist für Bauleiter nicht gesperrt), macht sich aber selbst zum Bauleiter fremder Baustellen. Er sieht dann deren Preise und Nachkalkulation, auch nach Entzug des Rechts (C-05).

**Fehler durch die Befundbehebung:** Die neue Regel „freigegebene Berichtsstunden gehen in den Lohn“ (M-07) zählt Stunden doppelt (C-01). Die neue Zeitkorrektur kann vergessene oder falsche ganze Schichten weder nachtragen noch löschen (C-04).

**Tests:**
- `npm test`: **203/203 bestanden**.
- `npm run test:e2e`: **parse 63/63** und **324/324 je Größe** (handy, tablet, pc), alle bestanden.

Die Testsuiten decken C-01 bis C-08 nicht ab.

---

## 1. Nachprüfung PRUEFBERICHT_1 (mit Original-Reproduktion)

| ID | Ergebnis | Nachweis / Rest |
|---|---|---|
| B-01 | **behoben** | `benutzer` per Matrix oder Ausnahme für polier, mitarbeiter, bauleiter und buero → 400; ebenso `stammdaten` für Polier/Mitarbeiter und alle Preis-, Kalkulations- und Lohnrechte. Polier `GET /rechte` → 403, `PUT /benutzer/1 {"rolle":"gf"}` → 403. Eigene Rolle ändern oder sich selbst deaktivieren → 403 (auch GF). |
| B-02 | **behoben** | `kolonne gehen [27]` → `ok:false` („nicht auf einer Ihrer Baustellen eingestempelt“); GF/Büro → `ok:false` (auch mit `gast:true`); fremde Baustelle → 403; `pause_start`/`wechsel` für Fremde → `ok:false`. Rest siehe C-11. |
| B-03 | **teilweise** | Sperre jetzt je (Benutzer, IP): 8 Fehlversuche → `401×4, 429×4`, richtige PIN von **anderer** IP → 200. 40 Fehlversuche von einer IP → ab Nr. 31 429, GF von anderer IP → 200. Namensliste ohne Rolle; PIN ändern, Pflichtwechsel (alle Routen 403 `PIN_AENDERN`) und Mindestlängen 4/6 funktionieren. **Rest:** keine kontoweite Grenze – verteiltes Raten unbegrenzt (C-07); Namensliste standardmäßig öffentlich; zweiter Faktor für Büro/GF (Konzept 7.4) fehlt. |
| B-04 | **behoben** | UI `#/baustelle/2`: „250.000“ zeigt „wird gespeichert als € 250.000,00“, Server speichert `250000` (390 und 1440 px). Rückfrage bei Faktor > 10 vorhanden. |
| B-05 | **teilweise** | 52-Std.-Fall: Bericht `stunden:0` + Hinweis „Ausstempeln fehlt“, PUT zurück 200, Monat `summe 0`, `offeneSchichten`, CSV-Hinweiszeile. Korrektur `PUT /zeit/buchungen/:id` mit Grund → Monat 9 Std. **Rest:** Eine vergessene oder irrtümliche **ganze** Schicht lässt sich weder nachtragen noch löschen (C-04). |
| B-06 | **behoben** | API: Nachtschicht 22:00–02:00 / 02:30–06:00 = 7,5 Std., PUT zurück 200, Spanne > 24 Std. → 400, Monat/Woche 7,5 Std. am Starttag. UI: Zeile mit „+1 Tag“, Status „Gespeichert“, PUT wird gesendet (390 und 1440). Rest: Zeitumstellung (C-10). |
| B-07 | **behoben** | 3 Anträge → `u` unverändert; Lohn-CSV nur Hinweiszeilen „Beantragt, nicht genehmigt“; BUAK unverändert. Genehmigen/Ablehnen nur Büro (MA/Polier 403); eigener beantragter Antrag löschbar, genehmigter nicht (403); 30 Tage zurück → 400; Benachrichtigungen an Büro und Person. Rest: C-09. |
| M-01 | **teilweise** | Server: SEG nur aus freigegebenen Berichten (Entwurf 2 → unterschrieben 2 → freigegeben 5); `segStunden > stunden` → 400. **Rest:** Die Oberfläche hat weiterhin **kein SEG-Feld je Person** (`public/js/views/berichte.js:177` sendet nur den geladenen Wert), App-Berichte liefern also SEG 0. Der Polier kann weiterhin **jede** Person eintragen, auch GF/Büro (C-01). |
| M-02 | **teilweise** | Nach erster Unterschrift: `PUT` und `personal-aktualisieren` → 409. Unterschrift zurückziehen → wieder bearbeitbar. **Rest:** Umgehung per Zurückziehen und erneutem Einreichen desselben Unterschriftsbilds (C-06). |
| M-03 | **behoben** | Datum 2099 → 400, Menge 1e6 → 400; `GET`/`DELETE` Leistungen und Fremdleistungen 200 (mit Protokoll); Polier 403. |
| M-04 | **behoben** | UI-Test `ui4.js`: Buchung offline gemerkt; Server lehnt beim Nachsenden mit 409 ab → Abschnitt „Nicht übernommene Buchungen“ mit Grund und „Text fürs Büro kopieren“. 5xx/429/401/403 bleiben in der Warteschlange (Code). |
| M-05 | **teilweise** | GF nach 61 Min. Leerlauf 401; Polier 12 Std.; absolute Grenze 24 Std. greift (25 Std. aktiv → 401). Abweichung vom Konzept (Polier-Tablet ca. 10 Min., Büro/GF ca. 30 Min.) bleibt als Standard; nur per Umgebungsvariable einstellbar. |
| M-06 | **behoben** | CSP, `nosniff`, `X-Frame-Options`, `Referrer-Policy`; HSTS nur mit `req.secure`; gefälschtes `X-Forwarded-Proto` ohne `TRUST_PROXY` wirkungslos. Keine CSP-Verletzungen in der Oberfläche (alle Rollen, Größen, Ansichten). |
| M-07 | **behoben, aber fehlerhaft** | Freigegebene Berichtsstunden gehen in den Monat (`quelle:"bericht"`). Neue Fehler daraus: C-01 (Doppelzählung), C-03 (Korrektur auf 0 wirkt nicht). |
| M-08 | **nicht behoben** | Als bekannte Grenze in `API.md` 7 dokumentiert; rückwirkende Neuberechnung bleibt. GF-Entscheidung. |
| N-01 | behoben | 61 Buchungen in einer Schicht: Person in `/zeit/anwesend`, `gehen` → 200. |
| N-02 | behoben | `monat=9999-12` und `2101-01` → 400. |
| N-03 | behoben | `/gesundheit` liefert `db` auch für den Polier. |
| N-04 | behoben | Preis `1.005` → `1.01`, `2.675` → `2.68`. |
| N-05 | behoben | Doppelte PNR per PUT und POST → 409 (Lücke siehe C-12). |
| N-06 | behoben | `zeit` ohne Zeitzone → 400. |
| N-07 | behoben | Bauleiter `#/baustelle/3` (fremd): kein Auftrag-Formular, kein „noch nicht erfasst“. |
| N-08 | behoben | `/js/nichtda.js`, `/.git/config`, `/..%2fserver%2findex.js`, `/server/index.js` → 404. |
| N-09 | behoben | Leeres Feld → Rückfrage „Auftragssumme löschen?“ → Server `null`. |

---

## 2. Neue Befunde

### C-01 · hoch · Lohn-Export zählt Stunden doppelt (Berichtsstunden + Stempelzeiten), beliebige Personen im Bericht

**Dateien:**
- `server/auswertung.js:110-131` (`mitBericht`)
- `server/routes/berichte.js:96-105` (`pruefePersonal`: es wird nur geprüft, ob die Person existiert)
- `public/js/views/berichte.js:232` („Person hinzufügen“ bietet alle aktiven Benutzer an, auch GF und Büro)

**Was ist falsch:**
- Für einen Tag mit freigegebenem Bericht nimmt `mitBericht` die Berichtsstunden.
- Dazu addiert es die Stempelstunden aller *anderen* Baustellen ohne Bericht, ohne Prüfung auf zeitliche Überschneidung.
- Ein Polier kann jede Person der Firma in seinen Bericht schreiben.

**Reproduktion** (`p4.js`, Uhr 14.12.2026):
1. MA 9 (Partie 26-038) stempelt 07:00–15:00 auf Baustelle 2.
2. Polier 1 trägt MA 9 in seinen Bericht für Baustelle 1 am selben Tag ein (07:00–15:00).
3. Polier 1 unterschreibt (an + bh), Bauleiter 103 gibt frei.
4. GF ruft `GET /api/monat?monat=2026-12` auf.

**Beobachtet:**
- MA 9 hat am 14.12. `{"stunden":16,"baustellen":["26-041","26-038"],"quelle":"gemischt"}`, ebenso in „Meine Woche“.
- Auch nachdem Polier 8 seinen eigenen Bericht freigegeben hat, bleiben es 16 Std. (`quelle:"bericht"`).
- GF 102 lässt sich mit 5 Std. eintragen und steht damit im Lohnmonat.

**Erwartet:** 8 Std.; gleiche Person und gleiche Zeit nie doppelt; Personen nur aus Partie bzw. Stempelungen oder als markierte Abweichung (Konzept: „Partie“, Prüfbericht 1 M-01-Vorschlag).

**Vorschlag:**
- Berichtszeiten gegen Stempelintervalle anderer Baustellen auf Überschneidung prüfen. Überschneidungen nicht addieren, sondern als Warnung in Monat/Export ausgeben.
- Im Bericht nur Personen der Partie oder mit Stempelung auf der Baustelle zulassen, sonst Kennzeichnung „nicht gestempelt“.
- Büro/GF/Bauleiter nicht auswählbar.

### C-02 · mittel · „Arbeitsstd.“ im Bericht frei und unabhängig von den Zeiten – geht ungeprüft in den Lohn

**Dateien:**
- `server/routes/berichte.js:119-120`: `stunden` 0–24 wird übernommen und nicht gegen die Blöcke geprüft.
- `public/js/views/berichte.js:225`, `:447`: freies Eingabefeld.
- `public/js/zahl.js:68`: Prüfung nur auf mehr als 24.

**Reproduktion:**
- API (`p2.js`): Polier `PUT /api/berichte/<id>` `{"personal":[{"benutzerId":4,"von1":"07:00","bis1":"08:00","stunden":24}]}` → 200.
- UI (`ui2.js`, 390 und 1440): Zeile 07:00–15:00, Feld „Arbeitsstd.“ = 23 → Status „Gespeichert“, Server `{"von1":"07:00","bis1":"15:00","stunden":23}`.

**Beobachtet:** keine Warnung. Nach Freigabe sind das wegen M-07 die Lohnstunden.

**Erwartet:** Stunden folgen aus Zeiten und Pause; Abweichung nur mit Begründung und sichtbarer Kennzeichnung.

**Vorschlag:**
- Server berechnet `stunden` immer aus den Blöcken.
- Abweichende händische Stunden nur mit Grundfeld, Kennzeichen in Bericht, Monat und CSV.

### C-03 · mittel · Polier-Korrektur „0 Std.“ (Person war nicht da) kommt nicht im Lohn an

**Datei:** `server/auswertung.js:111` (`nurMitZeit` verwirft Zeilen mit `stunden 0` und ohne Zeit)

**Reproduktion** (`p4.js`):
1. MA 3 stempelt 07:00–15:00 auf Baustelle 1.
2. Polier setzt im Bericht `{"benutzerId":3,"stunden":0}`, unterschreibt, Bauleiter gibt frei.
3. GF ruft `/api/monat` auf.

**Beobachtet:** MA 3 hat am Tag 8 Std., `quelle:"stempel"`. Die Nachkalkulation rechnet 0 Std. – Lohn und Kosten widersprechen sich. Gleiches passiert, wenn der Polier die Zeile löscht.

**Erwartet:** Der freigegebene Bericht gilt für die Baustelle (`API.md` 7: „Korrekturen des Poliers kommen so in den Lohn“), also 0 Std.

**Vorschlag:** Für eine durch freigegebenen Bericht gedeckte Baustelle die Stempelstunden dieser Baustelle immer ersetzen, auch durch 0. Gestempelte, aber im Bericht fehlende Personen als Warnung ausgeben.

### C-04 · hoch · Zeitkorrektur kann keine ganze Schicht nachtragen oder löschen (B-05 nur teilweise behoben)

**Datei:** `server/routes/zeit.js:234-238` (`pruefeFolge` prüft nach **jeder einzelnen** Buchung die gesamte Folge), `:253-271`, `:298-312`; Oberfläche `public/js/views/korrektur.js` bietet nur Einzelbuchungen.

**Reproduktion** (`p7.js`): MA 3 hat Schichten am 06.11. und 09.11., am 07.11. fehlt alles. Büro:
- `POST /api/zeit/buchungen {"benutzerId":3,"typ":"kommen","zeit":"2026-11-07T07:00:00+01:00","baustelleId":1,"grund":"vergessen"}`
- dann (bzw. zuerst) dasselbe mit `"typ":"gehen"` für 15:00
- `DELETE /api/zeit/buchungen/<kommen 06.11.> {"grund":"test"}`

**Beobachtet:** jeweils **409** „Die Korrektur ergibt eine ungültige Stempelfolge“, in beiden Reihenfolgen. Auch in der Oberfläche schlagen alle sechs Nachträge für eine Nachtschicht fehl, solange spätere Buchungen existieren.

**Erwartet:** Der häufigste Korrekturfall – ganzer Tag vergessen (Konzept 2.3, Mitarbeiter ohne Smartphone, Polier vergaß die Kolonne) oder irrtümliche Doppelschicht – muss für Büro/GF mit Grund möglich sein (Konzept 2.2, Prüfbericht 1 B-05). Es gibt nur den Umweg über Berichtsstunden; für interne Kostenstellen und Büro-Personal gibt es nicht einmal den.

**Vorschlag:**
- Korrektur als Paket erlauben, z. B. `POST /zeit/buchungen` mit `buchungen:[…]` bzw. `DELETE` einer ganzen Schicht (kommen bis gehen), in einer Transaktion geprüft.
- Oberfläche „Schicht nachtragen (von–bis, Pause, Baustelle)“ und „Schicht löschen“ anbieten.

### C-05 · hoch · Rechteausweitung: Bauleiter mit `stammdaten` macht sich zum Bauleiter fremder Baustellen

**Dateien:**
- `server/rechte.js:42` (`GESPERRT.bauleiter` ohne `stammdaten`)
- `server/routes/stammdaten.js:67`, `:102-113` (`PUT /baustellen/:id` erlaubt `bauleiterId` = ich)
- Zusätzlich öffnet `stammdaten` für den Bauleiter `routes/zeit.js:219-312` (alle Zeitkorrekturen), `routes/abwesenheiten.js:20` (Urlaub genehmigen) und `routes/stammdaten.js:258` (Lohngruppe und PNR aller Personen).

**Reproduktion** (`p6.js`):
1. GF: `PUT /api/rechte/ausnahme {"benutzerId":103,"recht":"stammdaten","wert":true}` → 200. Das Konzept sieht für Bauleiter „Baustellen und Positionen anlegen“ vor.
2. Bauleiter 103: `GET /api/kalkulation/3` → 403.
3. Bauleiter 103: `PUT /api/baustellen/3 {"bauleiterId":103}` → 200.
4. Bauleiter 103: `GET /api/kalkulation/3` → 200 `{"auftragssumme":23800,"kosten":{"lohn":12821.5,…}}`.
5. GF entzieht das Recht wieder.

**Beobachtet:**
- Nach Schritt 5 bleibt `GET /api/kalkulation/3` → 200; die Zuordnung bleibt bestehen.
- Außerdem zeigt `GET /api/mitarbeiter` Lohngruppe und PNR aller Personen, und `POST /api/zeit/buchungen` für beliebige Personen → 201.

**Erwartet:** Konzept 2.2: Bauleiter sieht € nur für **eigene** Baustellen, „diese Zuordnung pflegt das Büro“; Lohngruppen nur Büro/GF; niemand erweitert die eigenen Rechte.

**Vorschlag:**
- Eigene Zuordnung (`bauleiterId`/`polierId` = ich) nur für Büro/GF.
- `stammdaten` für Bauleiter sperren oder in „Baustellen anlegen“ (ohne Zuordnung, ohne Zeit-/Abwesenheits-/Lohngruppenzugriff) aufteilen.
- Test „Bauleiter mit jeder vergebbaren Ausnahme × jede Route“ ergänzen.

### C-06 · mittel · Umgehung der Inhaltssperre (M-02): Bauherr-Unterschrift zurückziehen, Inhalt ändern, gleiches Bild wieder einreichen

**Dateien:**
- `server/routes/berichte.js:39`: `bildPng` wird an alle Leser ausgeliefert.
- `:361-369`: Zurückziehen durch jeden mit `bericht_erstellen` im Bereich.
- `:327-339`: Unterschrift übernimmt beliebiges PNG.

**Reproduktion** (`p8.js`):
1. Bauherr unterschreibt zuerst (`bh`).
2. Polier: `GET /api/berichte/<id>` liefert `unterschriften.bh.bildPng`.
3. Polier: `DELETE …/unterschrift/bh` → 200.
4. Polier: `PUT {"vorkommnisse":"GEÄNDERT: Bauherr ordnet Mehrleistung an","regie":[{"text":"Regie 10 Std. angeordnet","stunden":10}]}` → 200.
5. Polier: `POST …/unterschrift {"rolle":"bh","name":"DI Bauherr","bildPng":<dasselbe Bild>}` → 200, dann `an` → 200.
6. Bauleiter gibt frei → 200.

**Beobachtet:** Der Bericht ist „unterschrieben/freigegeben“ und trägt das echte Bauherr-Bild unter geändertem Inhalt (+10 Regiestunden = Erlös). Spuren gibt es nur im Protokoll, das nur die GF sieht; im PDF ist nichts zu sehen.

**Erwartet:** Nach der Unterschrift des Bauherrn keine unbemerkte Inhaltsänderung (Konzept 5.9).

**Vorschlag:**
- Bauherr-Unterschrift nur durch Bauleitung/Büro zurückziehen lassen.
- Inhalts-Hash beim Unterschreiben speichern und im PDF drucken.
- Erneute Unterschrift im PDF kennzeichnen („Unterschrift erneuert am …“).
- Wiederverwendung eines schon gespeicherten Bildes ablehnen.

Hinweis: Grundsätzlich kann ein Polier am eigenen Tablet auch frei als „Bauherr“ unterschreiben – das liegt im Unterschriftsmodell.

### C-07 · mittel · PIN-Raten ohne kontoweite Grenze (Rest aus B-03)

**Datei:** `server/auth.js:166-225` (`LoginBremse`: Sperre nur je (Benutzer, IP), IP-Grenze 30/5 Min.)

**Reproduktion** (`p10.js`, `TRUST_PROXY=1`, 40 verschiedene `X-Forwarded-For`): 160 falsche PINs für Benutzer 2 (4 je Adresse).

**Beobachtet:** 0× 429; danach richtige PIN von neuer Adresse → 200. Keine Meldung an Person oder Büro. Von einer einzigen Adresse lassen sich gegen alle ca. 30 Feld-Konten parallel ca. 3.600 Versuche/Tag stellen (4-stellige PIN, ca. 1:10.000 je Versuch).

**Erwartet:** Konzept 2.2: „Nach 5 Fehlversuchen wird gesperrt. Das Büro entsperrt.“; Konzept 7.4: Büro/GF mit zweitem Faktor.

**Vorschlag:**
- Zusätzlich kontoweite Grenze mit steigender Verzögerung (z. B. 20 Fehlversuche/24 Std. → Konto gesperrt bis Entsperrung durch Büro) plus Benachrichtigung an Büro und Person.
- Namensliste standardmäßig aus (`BAUTAG_LOGIN_LISTE=0`).
- Zweiter Faktor für Büro/GF.

### C-08 · mittel · Gleichzeitige Bearbeitung eines Berichts: letzte Speicherung gewinnt ohne Warnung (bestätigt)

**Datei:** `server/routes/berichte.js:305-315` (kein Versionsvergleich); `public/js/views/berichte.js:181-202` (Auto-Speichern mit veraltetem Stand)

**Reproduktion** (`p9.js`):
1. Polier lädt den Bericht.
2. Büro: `PUT {"vorkommnisse":"Büro-Korrektur: Schaden an Gehsteig gemeldet"}` → 200.
3. Polier speichert seinen alten Stand → 200.

**Beobachtet:** Ergebnis „Polier Version 1“ – die Büro-Korrektur ist still verloren. Das Polier-Tablet hält den Bericht oft den ganzen Tag offen.

**Vorschlag:** `geaendert` als Versionsmarke mitsenden (`If-Match`); bei Abweichung 409 und Neu-Laden-Hinweis.

### C-09 · niedrig · Büro/GF genehmigen eigene Urlaubsanträge automatisch; Oberfläche meldet „wartet auf Genehmigung“

**Datei:** `server/routes/abwesenheiten.js:60-61`; `public/js/views/abwesenheiten.js:74`

**Reproduktion:** Büro `POST /api/abwesenheiten {"benutzerId":101,"datum":"2026-12-03","code":"U"}` → 201 `"status":"genehmigt"`. In der Oberfläche (390 und 1440) erscheint der Toast „Antrag gestellt – wartet auf Genehmigung.“, die Liste zeigt „Genehmigt“. Ebenso korrigiert das Büro eigene Stempelzeiten (`POST /zeit/buchungen` für sich → 201).

**Erwartet:** Eigene Lohn-relevante Einträge nicht selbst genehmigen (Vier-Augen-Prinzip) oder wenigstens korrekt anzeigen.

**Vorschlag:** Eigener Antrag auch für Büro → `beantragt`; Entscheidung durch eine andere Person.

### C-10 · niedrig · Nachtschicht über die Zeitumstellung: Bericht rechnet nach Wanduhr

**Dateien:** `server/stempel.js:194-226` (`dauerMin`/`stundenAusBloecken`), `public/js/zahl.js:33-58`, `public/js/views/berichte.js:450`

**Reproduktion** (`p3.js`):
1. 27.03.2027 22:00 kommen, 28.03. 06:00 (Sommerzeit) gehen.
2. Bericht-Vorschlag: 7 Std. (richtig); Monat: 7 Std.
3. `PUT` derselben Zeile ohne `stunden`, ebenso jede Änderung an der Zeile in der Oberfläche → **8 Std.**

Im Oktober umgekehrt (9 statt 8 Std. bzw. umgekehrt).

**Vorschlag:** Dauer mit Datum und Zeitzone rechnen (`wienZuDate(datum, von)` usw.).

### C-11 · niedrig · Kolonne „Gast“: jede Person der Firma, auch mit genehmigtem Krankenstand

**Datei:** `server/routes/zeit.js:192-201`

**Reproduktion** (`p7.js`):
1. Büro trägt für Nr. 27 heute „K“ (genehmigt) ein.
2. Polier 1: `POST /api/zeit/kolonne {"baustelleId":1,"benutzerIds":[27],"typ":"kommen","gast":true}`.

**Beobachtet:** `ok:true`, nur ein Protokolleintrag (nur GF sichtbar). Keine Meldung an die Person oder ihren Polier.

**Vorschlag:** Bei genehmigter Abwesenheit ablehnen oder Rückfrage; Benachrichtigung an den Stamm-Polier/Bauleiter.

### C-12 · niedrig · `POST /benutzer`: Personalnummernprüfung per Body-Feld `__id` aushebelbar → 500; PNR optional

**Datei:** `server/routes/benutzer.js:101` (vergleicht mit `body.__id`), `:117-127`

**Reproduktion:** GF `POST /api/benutzer {"name":"Dup","rolle":"mitarbeiter","pin":"4829","pnr":1002,"__id":2}` → **500** „Interner Fehler“ (UNIQUE-Index greift). Benutzer ohne `pnr` sind anlegbar; im Lohn-CSV steht dann eine leere Personalnummer, und bei `BAUTAG_LOGIN_LISTE=0` ist keine Anmeldung möglich.

**Vorschlag:** `__id` intern als eigenen Parameter übergeben, nicht über den Body. PNR bei Mitarbeitern/Polieren verpflichtend.

### C-13 · niedrig · Polier-Schlechtwetter ist sofort „genehmigt“

**Datei:** `server/routes/abwesenheiten.js:65-68`

**Beobachtet:** SW vom Polier zählt sofort in Monat, Lohn- und BUAK-Export (SW-Stunden sind Lohn-relevant, BSchEG).

**Erwartet:** Konzept 2.2: „Schlechtwetter melden (Polier) bzw. bestätigen (Bauleiter/Büro)“.

**Vorschlag:** Status `beantragt`, Bestätigung durch Bauleiter der Baustelle oder Büro.

### C-14 · niedrig · Büro kann laut Konzept Benutzer anlegen, PIN zurücksetzen und entsperren – technisch nicht möglich

**Datei:** `server/rechte.js:44` (`buero: ['benutzer']`), `server/routes/benutzer.js:29,117,129`

**Beobachtet:** Büro: `POST /api/benutzer` → 403, `PUT /api/benutzer/2 {"pin":…}` → 403, Protokoll nicht einsehbar (`GET /rechte` → 403). Bei gesperrter PIN kann nur die GF helfen.

**Erwartet:** Konzept 2.2: Büro „Benutzer anlegen, PIN zurücksetzen“ und „Das Büro entsperrt“; Protokoll für Büro einsehbar.

**Vorschlag:** Eigenes Recht `benutzer_anlegen` bzw. `pin_reset` für Büro (ohne Rollen- und Rechtevergabe).

### C-15 · niedrig · unbestätigt · Korrekturdialog nutzt die Zeitzone des Geräts

**Datei:** `public/js/views/korrektur.js:8`, `:70`

**Beobachtet (aus dem Code):** `datetime-local` wird mit der Geräte-Zeitzone vorbelegt und umgerechnet; die Liste zeigt die Wiener Zeit vom Server. Auf einem PC mit falscher Zeitzone (z. B. UTC) verschieben sich korrigierte Buchungen um 1–2 Std. Nicht mit abweichender Zeitzone getestet.

**Vorschlag:** Zeit als Wiener Ortszeit plus Datum an den Server senden; der Server rechnet um.

---

## 3. Geprüft und in Ordnung

- **€-Geheimhaltung Polier/Mitarbeiter:**
  - Sweep über alle GET-Routen inkl. `/baustellen/:id/leistungen|fremdleistungen`, `/zeit/*`, `/abwesenheiten`, alle 14 bzw. 8 Berichte, PDFs (`ag` und `intern`), CSV, Benachrichtigungen und Protokoll – geprüft für Polier 1, Polier 8, MA 2 und MA 27.
  - Polier 1 und MA 2 zusätzlich mit allen vergebbaren Ausnahmen; Polier- und Mitarbeiter-Matrix auf alles Vergebbare gesetzt.
  - Ergebnis: keine €-Felder, keine €-Werte im PDF-Text. Treffer waren nur „€“ im Text einer 403-Meldung ohne Wert, „db“ in `/gesundheit` und „Euro“-Paletten.
  - Budget-Meldungen nie an Polier; nach Herabstufung Bauleiter → Polier verschwinden sie (0), `/kalkulation` → 403, keine Budgetfelder.
- **Bauleiter:** fremde Baustelle ohne €-/Budgetfelder; `/kalkulation/3`, fremde Leistungen/Fremdleistungen → 403; Übersicht nur eigene (2, 1, 5, 7).
- **XSS/HTML-Injektion:** Nutzlast `"'><img id=xss-…><b id=xssb-…>` in Benutzername, allen Baustellenfeldern, Nachtrag, Fremdleistung, Berichtstexten, Regie, Materialbeistellung, Wetter, SEG-Tätigkeit, Unterschriftsnamen und Korrekturgrund. 16 Ansichten plus Glocke für GF, Büro, Bauleiter und Polier bei 390 und 1440: kein eingeschleustes Element, keine Skriptfehler. CSV maskiert und quotiert.
- **Sitzungen:** PIN-Änderung beendet andere Sitzungen; PIN-Reset durch GF beendet Sitzungen und erzwingt Wechsel; Deaktivieren → Anmeldung 401.
- **Oberfläche (5 Rollen × 3 Größen × 19 Ansichten):**
  - kein horizontales Überlaufen, keine Skriptfehler, keine CSP-Meldungen
  - einzige Konsolenmeldung: erwartete 403 beim Aufruf einer fremden `#/kalkulation/3` durch den Bauleiter (zeigt „Kein Zugriff“)
  - Abläufe funktionieren auf 390 und 1440: PIN-Pflicht (schwache PIN abgewiesen, danach App-Rahmen), Abwesenheit beantragen/genehmigen, Kolonne mit Gast-Liste, Korrektur (Pflichtgrund, Fehlermeldung ohne Baustelle)
- **Statische Dateien und Service Worker:** 404 für fehlende Dateien; Service Worker fängt `/api` nicht ab.

## 4. Nicht geprüft

- Echter Betrieb hinter HTTPS-Reverse-Proxy (`TRUST_PROXY`, `Secure`-Cookie, HSTS).
- Echte Mobilgeräte, Tastatur- und Screenreader-Bedienung.
- Lasttests und Anmelde-Bremse über mehrere Server-Prozesse: die IP-Grenze liegt nur im Speicher und gilt je Prozess (aus dem Code, **unbestätigt**).
- C-15 mit abweichender Geräte-Zeitzone.

## 5. Freigabe-Blocker

| ID | Schwere | Kurz |
|---|---|---|
| **C-01** | hoch | Doppelzählung im Lohn-Export (Bericht + Stempel), beliebige Personen im Bericht |
| **C-04** | hoch | Ganze Schicht weder nachtragbar noch löschbar (B-05 nur teilweise) |
| **C-05** | hoch | Bauleiter mit `stammdaten` übernimmt fremde Baustellen → fremde Preise/Nachkalkulation |

**Vor dem Echtbetrieb dringend beheben (mittel):** C-02, C-03, C-06, C-07, C-08.

**Noch offene Teile aus Bericht 1:** M-01 (SEG-Feld in der Oberfläche fehlt) und M-05 (Sitzungsdauer) als GF-Entscheidung, M-08 dokumentiert offen.
