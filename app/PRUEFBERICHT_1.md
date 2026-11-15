# BauTag – Befunde der unabhängigen Prüfung

Stand: 13.11.2026 · geprüft: `app/` (Server, Oberfläche, Tests) gegen `app/API.md` und `docs/Konzept.md` Kap. 2.2
Methode: Code gelesen, Server gestartet (eigene Test-DB im Scratchpad, Port 3100, sowie In-Prozess-Server mit steuerbarer Uhr), jede Rolle gegen jede Route geprüft, Oberfläche mit Playwright auf 390×844 / 1180×820 / 1440×900 durchgeklickt. Am Repository wurde nichts geändert (`git status` leer), Server ist gestoppt.
Prüfskripte: `/tmp/claude-0/-home-user-Stundenaufzeichnung/1c043855-ef33-5685-9374-56f053b5f049/scratchpad/review/` (`p1.js`–`p11.js` API, `ui1.js`–`ui4.js` Oberfläche).

## Urteil

**Nicht freigabefähig.** Sieben Befunde blockieren die Freigabe: **B-01 bis B-07**.
Die Kernregel (keine €-Werte an Polier/Mitarbeiter) hält im Normalbetrieb – sie lässt sich aber über ein vergebbares Recht aushebeln (B-01). Dazu kommen ein Rechte-Loch beim Kolonnen-Stempeln, eine schwache Anmeldung und vier Fehler, die Lohn- bzw. Budgetdaten verfälschen.

| ID | Schwere | Kurz |
|---|---|---|
| B-01 | kritisch | Recht „benutzer“ ist an Polier/Mitarbeiter vergebbar → Preise/Auftragssummen im Protokoll lesbar, Selbstbeförderung zur GF |
| B-02 | hoch | Polier kann beliebige Personen (auch fremde Baustellen, GF, Büro) aus-/einstempeln |
| B-03 | hoch | Anmeldung: 4-stellige PIN in Tagen durchprobierbar, jeder kann jeden aussperren, öffentliche Namensliste |
| B-04 | hoch | Eingabe „250.000“ wird als 250 € gespeichert (Auftragssumme, Nachtrag, Preise, Fremdleistung) |
| B-05 | hoch | Vergessenes Ausstempeln: 52 Std. an einem Tag im Lohn-Export, keine Korrekturmöglichkeit |
| B-06 | hoch | Schicht über Mitternacht: Bericht nicht mehr speicherbar, Oberfläche zeigt trotzdem „Gespeichert“ |
| B-07 | hoch | Nicht genehmigter Urlaubsantrag zählt im Lohn-/BUAK-Export als Urlaubstag; kein Genehmigen/Ablehnen/Löschen |
| M-01 … M-08 | mittel | siehe unten |
| N-01 … N-09 | niedrig | siehe unten |

---

## Blockierende Befunde

### B-01 · kritisch · Rechte / €-Geheimhaltung
**Datei:** `server/rechte.js:37-44` (GESPERRT), `server/routes/benutzer.js:17-32` (GET /rechte), `:34-47`, `:49-63`, `:111-144`
**Was ist falsch:** Gesperrt sind für Polier/Mitarbeiter nur `preise_sehen`, `preise_bearbeiten`, `kalk_sehen`, `lohn`. Das Recht `benutzer` (und `stammdaten`) ist per Matrix und per Ausnahme vergebbar. Mit `benutzer` liefert `GET /api/rechte` das Protokoll samt alten/neuen Preisen, Auftragssummen und Nachtragsbeträgen. Das €-Sicherheitsnetz greift nicht, weil `alt`/`neu` JSON-Texte sind. Außerdem kann sich der Inhaber von `benutzer` selbst zur Geschäftsführung machen.
**Reproduktion:**
1. GF: `PUT /api/preise/lohngruppen/fa {"feld":"kostensatz","wert":44.44}`, `PUT /api/baustellen/1/auftrag {"auftragssumme":123456.78}`, `POST /api/baustellen/1/nachtraege {"text":"NT","betrag":9999.99}`
2. GF: `PUT /api/rechte/ausnahme {"benutzerId":1,"recht":"benutzer","wert":true}` → 200 (ebenso `PUT /api/rechte/matrix {"rolle":"polier","recht":"benutzer","wert":true}` → 200, auch für `mitarbeiter`)
3. Polier (Haidbauer): `GET /api/rechte` → 200
4. Polier: `PUT /api/benutzer/1 {"rolle":"gf"}` → 200
**Beobachtet:** Schritt 3 enthält `preis {"kostensatz":46} {"kostensatz":44.44}`, `auftrag {"auftragssumme":86900} {"auftragssumme":123456.78}`, `nachtrag … "betrag":9999.99`. Schritt 4 liefert `"rolle":"gf"`.
**Erwartet:** Konzept 2.2: „Rollen und Ausnahmen vergeben“ nur GF; Polier/Mitarbeiter sehen €-Werte nie, auch nicht per Ausnahme.
**Vorschlag:** `benutzer` für alle Rollen außer `gf` sperren (bzw. `stammdaten` für Polier/Mitarbeiter). Protokoll-Ausgabe zusätzlich nach Recht filtern: Einträge der Arten `preis`, `auftrag`, `nachtrag`, `fremdleistung`, `budget_alarm` nur mit `preise_sehen`. Eigene Rolle nicht selbst ändern lassen. Test ergänzen.

### B-02 · hoch · Kolonne stempeln (IDOR)
**Datei:** `server/routes/zeit.js:158-182`, `:85` (bei `gehen`/Pause wird die Baustelle ignoriert)
**Was ist falsch:** Geprüft wird nur, ob die *angegebene Baustelle* zum Bereich des Poliers gehört – nicht, ob die Personen zu seiner Partie gehören oder dort eingestempelt sind. Bei `gehen`, `pause_start`, `pause_ende` spielt die Baustelle keine Rolle.
**Reproduktion (als Polier Haidbauer, Baustelle 1):**
- `POST /api/zeit/kolonne {"baustelleId":1,"benutzerIds":[27],"typ":"gehen"}` – Nr. 27 (Ivan Horvat) arbeitet auf Baustelle 7
- `POST /api/zeit/kolonne {"baustelleId":1,"benutzerIds":[102,101],"typ":"kommen"}` – GF und Büro
**Beobachtet:** beide 200, `{"benutzerId":27,"ok":true,"status":"aus"}` bzw. GF/Büro `"status":"arbeit"`.
**Erwartet:** 403 bzw. `ok:false` für Personen außerhalb der eigenen Partie/Baustelle (Konzept: „Partie stempeln – eigene Partie“).
**Vorschlag:** `kommen`: nur Personen der Partie oder ausdrücklich „Gast“ mit Protokoll; `gehen`/Pause/`wechsel`: nur wenn die Person aktuell auf einer Baustelle im Bereich des Stempelnden eingestempelt ist. Büro/GF/Bauleiter nicht über die Kolonne stempelbar.

### B-03 · hoch · Anmeldung
**Datei:** `server/auth.js:16-18`, `:133-175`; `server/routes/auth.js:16-18`, `:20-38`; `server/index.js:38`
**Was ist falsch (vier Punkte, gemeinsam geprüft):**
1. **Durchprobieren:** Sperre = 5 Versuche je 5 Minuten, danach Zähler wieder 0. Das sind 1.440 Versuche pro Tag und Benutzer; eine 4-stellige PIN ist in höchstens 7 Tagen gefunden. Kein zweiter Faktor, kein Geräte-Bezug.
2. **Aussperren durch Fremde:** 5 Fehlversuche ohne Anmeldung sperren jeden Benutzer 5 Minuten – auch mit richtiger PIN (`429`). Beliebig wiederholbar.
3. **IP-Bremse:** 30 Fehlversuche von einer Adresse sperren *alle* Anmeldungen von dieser Adresse. `trust proxy` ist aus; hinter einem Reverse-Proxy (für HTTPS/PWA nötig) ist das die Proxy-Adresse → ganze Firma ausgesperrt. Das README nennt `TRUST_PROXY` nur für das Cookie.
4. **Namensliste öffentlich:** `GET /api/auth/benutzerliste` liefert ohne Anmeldung alle 33 Namen mit Rolle – das Ziel „Geschäftsführung“ ist damit bekannt.
Dazu: Demo-PIN `1234` für alle, keine Pflicht zur Änderung, Benutzer können ihre PIN nicht selbst ändern (nur `PUT /api/benutzer/:id` durch die GF – die GF kennt alle PINs).
**Reproduktion:** 8× `POST /api/auth/login {"benutzerId":5,"pin":"1000"…}` → `401,401,401,401,429,429,429,429`; danach richtige PIN → `429`. 40 Fehlversuche über verschiedene Benutzer → ab dem 24. alle `429`, danach GF mit richtiger PIN → `429`.
**Erwartet:** Konzept: „Nach 5 Fehlversuchen wird gesperrt. Das Büro entsperrt.“ – und ein Angreifer darf die Firma nicht aussperren können.
**Vorschlag:** Für Büro/GF/Bauleiter Passwort oder längere PIN (≥ 6) plus Geräte-Freischaltung; ansteigende Sperrzeiten; Sperre je Gerät/Token statt je Konto; `TRUST_PROXY` dokumentieren und beim Start prüfen; Namensliste nur für freigeschaltete Geräte; PIN-Änderung durch den Benutzer und erzwungener Wechsel der Start-PIN.

### B-04 · hoch · Zahleneingabe in der Oberfläche
**Datei:** `public/js/ui.js:91-97` (`parseZahl`); benutzt in `views/baustellen.js:99,114`, `views/kalkulation.js:164,179`, `views/preise.js:42`
**Was ist falsch:** Punkte werden nur dann als Tausendertrennung behandelt, wenn auch ein Komma vorkommt. „250.000“ wird zu `250`.
**Reproduktion:** Als GF `#/baustelle/2` → Feld „Auftragssumme“ `250.000` → „Auftrag speichern“.
**Beobachtet:** `GET /api/baustellen/2` → `"auftragssumme":250` (ohne Rückfrage, Meldung „Auftrag gespeichert“). `250.000,50` → 250000.5 (richtig).
**Folge:** Budget-Basis um Faktor 1000 falsch, sofort falscher Budget-Alarm an Bauleiter/Büro/GF; gleiches bei Nachtrag, Fremdleistung, Preisen.
**Vorschlag:** Muster `^\d{1,3}(\.\d{3})+$` als Tausender lesen; nach dem Speichern den formatierten Wert zurückzeigen; bei Änderung um mehr als Faktor 10 nachfragen.

### B-05 · hoch · Vergessenes Ausstempeln / keine Korrektur
**Datei:** `server/stempel.js:109-112`, `server/daten.js:111-118`, `server/auswertung.js:59-76`; es gibt keine Route zum Korrigieren von Buchungen (`quelle 'buero'` existiert nur im Schema)
**Was ist falsch:** Eine offene Schicht wird bis „jetzt“ gerechnet und komplett dem Starttag zugeschlagen. Stempelt jemand Tage später aus, bleibt das dauerhaft so. Niemand kann eine Buchung ändern oder löschen (`PUT /api/zeit/buchungen/1`, `POST /api/zeit/korrektur` → 404).
**Reproduktion (Uhr gesteuert):** GF `kommen` am 03.12. 07:00, nächste Aktion am 05.12. 11:00.
**Beobachtet:**
- `POST /api/berichte/…/personal-aktualisieren` → `{"von1":"07:00","bis1":"11:00","stunden":52}`; danach lehnt `PUT` denselben Bericht ab: `400 personal[0].stunden muss zwischen 0 und 24 liegen.`
- `GET /api/monat?monat=2026-12` → `summe 52, ueberstunden 44`
- Lohn-CSV: `;Michael Pichler;;03.12.2026;Do;07:00;;0;52;;26-041` und Summenzeile `52;8;44`
**Erwartet:** Warnung ja (die kommt), aber keine 52 Stunden in Bericht und Export; das Büro muss korrigieren können (Konzept: „Zeiten anderer korrigieren, immer mit Grund“).
**Vorschlag:** Offene Schichten in Bericht/Monat/Export nicht bis „jetzt“ rechnen (kennzeichnen, Stunden 0 oder Deckel bei Tagesende); Korrektur-Route für Büro/GF mit Grund und Protokoll; Export sperren oder deutlich markieren, solange offene Schichten im Monat liegen.

### B-06 · hoch · Schicht über Mitternacht im Bautagesbericht
**Datei:** `server/stempel.js:129-157` (Vorschlag liefert `22:00`–`02:00`), `server/routes/berichte.js:108-113` (verlangt bis > von), `public/js/views/berichte.js:138-145`, `:426`
**Was ist falsch:** Der Server trägt Nachtschichten selbst so ein, dass seine eigene Prüfung sie ablehnt. Die Oberfläche speichert das Personal nicht, solange *irgendeine* Zeile ungültig ist – ohne Hinweis.
**Reproduktion:**
- API: Büro stempelt 22:00, Pause 02:00–02:30, geht 06:00. `POST /api/berichte` → `{"von1":"22:00","bis1":"02:00","von2":"02:30","bis2":"06:00","stunden":7.5}`. Dieselben Daten per `PUT` zurück → `400 personal[1]: Zeitblock 1 – „bis“ muss nach „von“ liegen.`
- Oberfläche (`ui3.js`): Bericht 56 mit Zeile „Michael Pichler 22:00–00:36“. Bei Markus Zöchling Pause auf 45 ändern.
**Beobachtet:** Anzeige „Gespeichert“, kein PUT gesendet, kein Fehlerhinweis, Server unverändert (`p30`). Beim Unterschreiben gilt der alte Stand.
**Erwartet:** Nachtarbeit (im Straßenbau üblich) muss im Bericht abbildbar sein; nicht Gespeichertes darf nie als gespeichert erscheinen.
**Vorschlag:** `bis < von` als „über Mitternacht“ zulassen (Server und Oberfläche, Stundenrechnung +24 h); beim Laden alle Zeilen prüfen und Fehler sichtbar machen; Status „Nicht gespeichert“ zeigen, solange eine Zeile ungültig ist; Unterschrift dann sperren.

### B-07 · hoch · Abwesenheiten im Lohn-Export
**Datei:** `server/routes/zeit.js:190-226`, `server/auswertung.js:127-139`, `server/export.js:26-55`
**Was ist falsch:** Ein eigener Antrag (Status `beantragt`) zählt sofort als Urlaubstag in Monatsauswertung, Lohn-CSV und BUAK-Grundlage. Die CSV hat keine Statusspalte. Es gibt keine Route zum Genehmigen, Ablehnen oder Löschen (`GET/PUT/DELETE /api/abwesenheiten…` → 404); das Büro kann nur mit einem anderen Kürzel überschreiben. Anträge sind 62 Tage rückwirkend möglich.
**Reproduktion:** Mitarbeiter: 3× `POST /api/abwesenheiten {"benutzerId":2,"datum":"2026-11-16|17|18","code":"U"}` → 201 `"status":"beantragt"`. GF: `GET /api/monat?monat=2026-11`.
**Beobachtet:** `u` steigt von 1 auf 4; CSV: `1002;Lukas Brandstätter;fa;17.11.2026;Di;;;;0;U;`, BUAK: Urlaubstage 4.
**Erwartet:** Nur genehmigte Abwesenheiten in Summen und Export; Büro kann genehmigen/ablehnen/löschen.
**Vorschlag:** In Summen/Export nur `genehmigt` zählen, Beantragtes getrennt ausweisen; Routen und Oberfläche fürs Genehmigen/Ablehnen/Löschen; Meldung ans Büro bei neuem Antrag.

---

## Mittlere Befunde

### M-01 · mittel · SEG-Stunden
**Datei:** `server/auswertung.js:118-119`, `public/js/views/berichte.js:178`
SEG-Stunden je Person fließen aus **allen** Berichten in den Monat, auch aus Entwürfen. Verifiziert: Polier setzt im Entwurf `{"benutzerId":4,"stunden":0,"segStunden":20}` → `/api/monat` zeigt für Nr. 4 `seg` 0 → 20. Der Polier kann jede Person eintragen (auch GF, 24 Std.). Umgekehrt hat die Oberfläche kein Eingabefeld für SEG je Person – über die App erfasste Berichte liefern im Lohn-Export immer SEG 0.
**Vorschlag:** Nur freigegebene Berichte zählen; Eingabefeld je Person ergänzen; Personen auf Partie/gestempelte beschränken oder Abweichungen markieren.

### M-02 · mittel · Bericht nach der ersten Unterschrift änderbar
**Datei:** `server/routes/berichte.js:295-305`, `:317-348`
Nach einer Unterschrift (z. B. Bauherr) bleibt der Bericht im Entwurf und voll bearbeitbar; die Unterschrift bleibt bestehen. Verifiziert: Unterschrift `an` → `PUT {"vorkommnisse":"… GEÄNDERT"}` → 200, Unterschrift noch vorhanden, PDF zeigt den neuen Text über der alten Unterschrift.
**Vorschlag:** Bei inhaltlicher Änderung vorhandene Unterschriften verwerfen (mit Hinweis) oder Inhalt ab der ersten Unterschrift sperren.

### M-03 · mittel · Leistungsmeldungen und Fremdleistungen nicht korrigierbar
**Datei:** `server/routes/stammdaten.js:167-192`
Keine Routen zum Ändern/Löschen (`DELETE …/leistungen/1`, `…/fremdleistungen/1` → 404). Leistungsmeldung akzeptiert Datum `2099-01-01` und Menge `1e6` (201). Ein Tippfehler verfälscht Erlös, Leistungsstand und Alarm dauerhaft; Fremdleistungen lassen sich nur über negative Gegenbuchung ausgleichen.
**Vorschlag:** Storno mit Protokoll; Datum nicht in der Zukunft; Plausibilitätsgrenze.

### M-04 · mittel · Offline-Warteschlange verwirft Buchungen
**Datei:** `public/js/offline.js:44-50`, `public/js/views/stempeln.js:55`
Lehnt der Server eine nachgesendete Buchung ab (400/409/5xx), wird sie gelöscht; es bleibt nur eine Einblendung für 5 Sekunden. Betrifft u. a. Buchungen älter als 24 h (langes Funkloch, Wochenende), Geräteuhr mehr als 2 Minuten vor, Serverfehler. Nach Mitternacht ohne Netz zeigt die App eine laufende Schicht als „nicht eingestempelt“ (zwischengespeicherter Status gilt nur am selben Tag) – ein weiteres „Kommen“ wird später verworfen. *(Verhalten aus dem Code; der Normalfall „offline gehen → nachsenden“ wurde getestet und funktioniert.)*
**Vorschlag:** Abgelehnte Buchungen in einer sichtbaren Liste „Nicht übernommen – ans Büro melden“ behalten; bei 5xx/429 nicht löschen, sondern später erneut senden.

### M-05 · mittel · Sitzungsdauer weicht vom Konzept ab
**Datei:** `server/auth.js:15`
12 Stunden Inaktivität für alle Rollen, keine absolute Obergrenze, keine Sperre am gemeinsamen Tablet. Konzept 2.2: Polier-Tablet ca. 10 Min., Büro/GF ca. 30 Min., gemeinsames Tablet sofort abmelden. `API.md` nennt 12 h – also bewusst, aber mit der GF abzustimmen, weil ein liegen gelassenes Büro-Gerät alle €-Werte zeigt.

### M-06 · mittel · Sicherheits-Header fehlen
**Datei:** `server/index.js:41-46`
Keine `Content-Security-Policy`, kein HSTS. Die Ausgabe ist derzeit durchgehend maskiert (siehe „Geprüft und in Ordnung“), aber die App baut alles über `innerHTML`; eine CSP (`default-src 'self'`, `img-src 'self' data:`) wäre der zweite Riegel. Cookie ist nur `Secure`, wenn HTTPS erkannt wird; `x-forwarded-proto` wird ungeprüft geglaubt (`server/auth.js:77-79`).

### M-07 · mittel · Lohn-Export bildet Korrekturen im Bericht nicht ab
**Datei:** `server/auswertung.js:108-150`
Die Monatsauswertung rechnet nur aus Stempelungen. Vom Polier im Bericht korrigierte Zeiten (unterschrieben und freigegeben) kommen im Lohn-Export nicht an; zusammen mit B-05 gibt es keinen Weg, falsche Stempelzeiten für den Lohn zu berichtigen. Ob das gewollt ist, sollte die GF entscheiden.

### M-08 · mittel · Kalkulation rechnet rückwirkend mit heutigen Sätzen
**Datei:** `server/daten.js:19-27,34-37`, `server/kalkulation.js:89-100`
Kosten alter Berichte werden mit dem aktuellen Kostensatz und der aktuellen Lohngruppe der Person gerechnet. Eine Preisänderung oder Umgruppierung verändert alle abgeschlossenen Baustellen rückwirkend und kann Alarme auslösen. Entspricht der Formel in `API.md`, ist aber fachlich fraglich (Preisstand je Datum fehlt).

---

## Niedrige Befunde

- **N-01 · Stempeln** · `server/daten.js:78-81`, `server/routes/zeit.js:74,134,150`: Status wird aus den letzten 30 bzw. 50 Buchungen berechnet. Verifiziert: nach 37 Buchungen in einer Schicht fehlt die Person in `/zeit/anwesend` und `/zeit/kolonne`; nach 57 antwortet `gehen` mit `409 Nicht eingestempelt`, ein neues `kommen` wird angenommen. Im Alltag unwahrscheinlich. Fix: ab dem letzten `kommen` laden.
- **N-02 · Monat** · `server/datum.js:45-52`, `server/routes/monat.js:10`: `GET /api/monat?monat=9999-12` → 500 (`RangeError: Invalid time value`). Jahr begrenzen.
- **N-03 · Sicherheitsnetz** · `server/rechte.js:105-109`, `server/index.js:74-90`: Der Feldname `db` gilt als €-Feld; `GET /api/gesundheit` liefert Polier/Mitarbeiter deshalb `{"ok":true,"version":"0.1.0"}` ohne `db`. Ebenso verschwindet ein Wetter-Schlüssel `kosten`. Harmlos, aber Vertragsabweichung.
- **N-04 · Rundung** · `server/validierung.js:90-93`: `1.005` wird zu `1` statt `1,01` (`2.675` → `2,68`). `Number.EPSILON` wie in `kalkulation.js` verwenden.
- **N-05 · Personalnummer** · `server/schema.js:50`, `server/routes/benutzer.js:86`: nicht eindeutig; `PUT /api/benutzer/3 {"pnr":1002}` → 200, obwohl vergeben. Im Lohn-Export dann zwei Personen mit derselben Nummer.
- **N-06 · Zeitstempel ohne Zeitzone** · `server/routes/zeit.js:49-50`: `"zeit":"2026-10-26T10:20"` wird angenommen und in der Zeitzone des Servers gedeutet. Zeitzone verlangen.
- **N-07 · Baustelle fremder Bauleiter** · `public/js/views/baustellen.js:65`: Bauleiter sieht bei fremder Baustelle das Formular „Auftrag & Budget-Alarm“ mit „noch nicht erfasst“ und Schwellen 80/90/100, obwohl die Daten nur verborgen sind (Server liefert korrekt nichts). Abschnitt ausblenden.
- **N-08 · Fehlende Dateien** · `server/index.js:109-114`: Jede unbekannte Adresse (auch `/js/nichtda.js`, `/.git/config`) liefert 200 mit `index.html`; der Service Worker legt das im Zwischenspeicher ab. Für Pfade mit Dateiendung 404 liefern. Kein Datenleck (Pfad-Tricks wie `/..%2fserver%2findex.js` liefern nur `index.html`).
- **N-09 · Auftragssumme nicht löschbar** · `public/js/views/baustellen.js:114-116`: leeres Feld → „Bitte eine gültige Auftragssumme eingeben“; der Server könnte `null`.

---

## Geprüft und in Ordnung

- **€-Werte:** Polier und Mitarbeiter erhalten in keiner der 30 geprüften GET-Routen ein €-Feld; `/preise`, `/kalkulation*`, `/monat*`, `/rechte`, `/benutzer` → 403. Bauleiter: fremde Baustelle ohne `auftragssumme`/Budgetfelder, `/kalkulation/4` → 403, fremde Berichte/PDF → 403, Budget-Meldungen nur eigene (verschwinden nach Bauleiterwechsel). Gesperrte Rechte werden per Matrix und Ausnahme mit 400 abgelehnt. Im Browser (alle drei Größen) kein „€“ für Polier/Mitarbeiter, keine €-Felder in deren Netzwerkantworten.
- **PDF:** kein €-Wert (Text extrahiert); K/U nur in der internen Fassung; interne Fassung für Polier 403; defektes Unterschriftsbild führt nicht zum Absturz.
- **Nachkalkulation:** Lohn/Geräte/Material/Regie für Baustelle 1 unabhängig nachgerechnet – stimmt auf den Cent; Verbrauch, Leistungsstand, DB, Status passen zu `API.md`.
- **Budget-Alarm:** je Schwelle einmal, bei Sprung eine Meldung (höchste Stufe), wieder scharf nach Nachtrag, Empfänger laut Einstellung, nie an Polier, `empfaenger.polier` → 400, Stufe „kritisch“ korrekt.
- **Stempeln:** Zustandsautomat, Pausen, Wechsel, Zeitumstellung 25.10.2026 (00:00–06:00 = 7 Std.), Nachbuchung > 24 h und Zukunft abgelehnt, AZG-Meldungen an Person und Büro.
- **Angriffe:** kein XSS (Schadtext in 20 Feldern, alle Ansichten, Reiter, Dialoge, Glocke, drei Größen), keine SQL-Injektion, Formular-POST → 415, kaputtes JSON → 400, 3 MB → 413, Abmelden/Deaktivieren/PIN-Reset beenden Sitzungen, letzte GF nicht entfernbar. CSV: BOM `EF BB BF`, Semikolon, CRLF, Dezimalkomma, Formel-Schutz.
- **Oberfläche:** kein horizontales Überlaufen, keine Skriptfehler; Anmeldung, Stempeln, Doppelklick-Schutz, Offline-Stempeln mit Nachsenden funktionieren. Service Worker speichert keine `/api`-Antworten (24 Einträge, 0 aus `/api`); `Cache-Control: no-store` auf der API.
- **Tests:** `npm test` 117/117 grün. E2E-Suite wurde nicht ausgeführt.

## Nicht geprüft

- E2E-Suite (`npm run test:e2e`), Verhalten hinter echtem HTTPS-Proxy, mehrere gleichzeitige Bearbeiter desselben Berichts (laut Code gewinnt die letzte Speicherung ohne Warnung – **unbestätigt**), Tastatur-/Screenreader-Bedienung im Detail, echte Mobilgeräte.

## Verbesserungen (keine Fehler)

1. Automatischen Test „jede Rolle × jede Route × jedes vergebbare Recht“ ergänzen – hätte B-01 gefunden.
2. Lohngruppe mit nur einer Person in der Nachkalkulation zusammenfassen (Konzept 2.2, Datenschutz) – derzeit nicht umgesetzt.
3. Protokoll-Einträge für Stempel-Korrekturen und Leistungsmeldungen (Leistungsmeldung wird derzeit nicht protokolliert).
4. Export-Datei mit Hinweiszeile zu offenen Schichten, beantragten Abwesenheiten und AZG-Warnungen des Monats.
5. `GET /berichte` filtert erst nach `LIMIT 1000` auf den Bereich – bei wachsendem Bestand vorher filtern.
