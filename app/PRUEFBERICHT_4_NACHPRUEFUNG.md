# BauTag – Nachprüfung Befunde 4 (E-01 … E-09)

Stand: 13.11.2026. Geprüft wurde `app/` auf dem Stand `9a71c67` (Branch `claude/jolly-newton-swaya9`) gegen `app/API.md` 10f. Verwendet wurden die Original-Reproduktionen aus `review4/mine/` sowie die angepassten Skripte `n1.js`–`n3.js` und `ui4.js`/`ui5.js`.

## Urteil

**Freigabefähig: ja.**

- Alle neun Befunde E-01 bis E-09 sind behoben.
- Die €-Kernregel hält weiter.
- Es gibt keinen neuen Befund der Stufe kritisch oder hoch. Neu ist nur ein niedriger Befund (N-01).

**Tests und Ordnung**
- `npm test`: 290/290 bestanden (`mine/npmtest2.log`).
- Den E2E-Lauf habe ich absprachegemäß nicht ausgeführt.
- Der Server auf Port 3400 (eigene Datenbank) ist gestoppt, `git status` ist leer.

## Nachprüfung

| ID | Ergebnis | Nachweis |
|---|---|---|
| E-01 | **behoben** | Oberfläche (`ui4.js`, `ui5.js`): Die Box zeigt „Tonnen Naturmaterial (automatisch)“ mit dem Knopf „Zuordnung bestätigen“. Danach bleibt `quelle:{art:"naturmaterial"}` erhalten, `mengeAuto` 157, Summe 39,25 €, `zuordnungPruefen:false`. API: `PUT {quelle:null}` → 400; `{zuordnungPruefen:false}` ändert nur das Kennzeichen. Der Schalter „Naturmaterial“ fehlt jetzt bei `Std.`-Positionen; `naturmaterial:true` bei `Std.` → 400. |
| E-02 | **behoben** | Datei mit 1 GB Text in einer Zelle → 400 in 44 ms, Speicher bleibt bei etwa 180 MB. Dieselbe Datei mit gefälschten Größenangaben im ZIP (lokal und im Verzeichnis 5000 Byte) → 400. Drei gleichzeitige Uploads → 400/400/400, Server läuft weiter (vorher Absturz mit Code 134). 120.000 Zeilen → 400. |
| E-03 | **behoben** | Eine Datenbank vom Stand `4afe0c1` mit neuem Code geöffnet: Alle Baustellen haben 119 Positionen. Die alten Alarme sind gelöscht und auf der neuen Basis neu bewertet, z. B. Baustelle 6: 141,2 % → 80/90/100/kritisch; Baustelle 2: 60,2 % → keine. Zweiter Start: unverändert, die Übernahme läuft also nur einmal. Baustelle ganz ohne Positionen: `budgetVerbrauchProzent:null`, `positionenFehlen:true` und ein Hinweis. |
| E-04 | **behoben** | Import der Original-Vorlage: `umbenannt` 7, keine neuen Positionen. Rollschotter 16/63 steht als `geschuetzt:true` mit Hinweis in der Vorschau. Nach „Übernehmen“ bleibt der Preis 12,50, der Katalog behält 119 Positionen, alte Namen: 0. |
| E-05 | **behoben** | In der Vorschau stehen unter `fehler` die Zeilen mit EP −50 und 1e15 sowie die Bezeichnung mit 5000 Zeichen, unter `doppelt` die Zeile „Dup“ und unter `ohneSummenzeile` die Zeile 12. `?uebernehmen=1` → 400, nichts übernommen (vorher 500 bzw. Übernahme). |
| E-06 | **behoben** | 2,0004 t wird als 2 gespeichert: App 50,00 €, Excel bzw. LibreOffice 50,00 €. Gesamtsumme App = Excel = 71.677,85 €. Excel hat keine Abweichung zwischen gespeichertem Wert und Formel mehr. Die Summe der Anteile ist in App (`anteilSummeProzent`) und Export gleich 100,1. |
| E-07 | **behoben** | Der Bauleiter storniert seinen eigenen Eintrag → 200, einen Eintrag des Büros (20.000 €) → 403. |
| E-08 | **behoben** | Bauleiter ohne `preise_sehen` (per Matrix): Bei Lagerhaus und Maut fehlen `menge`, `mengeAuto`, `mengeManuell` und `eintraege`; es kommt nur `eintraegeAnzahl`. Die Rechnungsnotiz wird nicht ausgeliefert. Einziges Feld aus der €-/Kalkulationsliste in der Antwort ist `budgetVerbrauchProzent` (Kalkulationsrecht vorhanden). |
| E-09 | **behoben** | Eine ausgeblendete „Kleingeräte“-Position plus eine neue Position mit denselben Geräten → keine Warnung „doppelt“ mehr. Eine zweite Landschaftsabgabe-Position → Hinweis „… wird mehrfach gezählt“. |

## Regressionsprüfung der €-Kernregel

- Polier 1 und 8, Mitarbeiter 2 und 27: 15/15 Positions- und Kalkulations-Endpunkte → 403.
- Preis- und Kalkulationsrechte für den Polier per Matrix oder Ausnahme → 400.
- €-Scan von Baustellen, Berichten, Benachrichtigungen, `/auth/ich`, Geräten und Material: sauber (`q3.js`).
- Bauleiter: eigene Baustellen lesen und exportieren → 200. Fremde Baustellen → 403. Positionen, Katalog und Import ändern → 403. Mengen auf eigenen Baustellen → 201. Katalog lesen → 200 (Entscheidung der GF in 10f).
- Oberfläche (`ui1.js`): 5 Rollen × 3 Größen × 24 Ansichten = 360 Aufrufe. Kein Überlaufen, keine Skriptfehler, kein „€“ bei Polier und Mitarbeiter. Einzige Konsolenmeldung: das erwartete 403 beim Bauleiter auf der fremden Baustelle 3.

## Neuer Befund

### N-01 · niedrig · Import-Übernahme mit fehlerhaften Zeilen überschreibt das Fehlerformat

**Datei:** `server/routes/positionen.js:231` (`ungueltig(text, { fehler })`) zusammen mit `server/index.js` (dort wird `err.extra` nach `fehler` eingefügt).

**Reproduktion** (`n1.js`): `POST /positionen/katalog/import?uebernehmen=1` mit einer Datei, die ungültige Zeilen enthält.

**Beobachtet**
- Antwort: 400 mit `{"fehler":[{zeile,text},…]}`. Der Meldungstext geht verloren, `fehler` ist keine Zeichenkette mehr (API §3).
- In der Oberfläche würde `ApiFehler.message` dann „[object Object]“. Der Knopf ist bei Zeilenfehlern aber gesperrt (`katalog.js:72`). Erreichbar ist das nur, wenn sich die Datei zwischen Vorschau und Übernahme ändert, oder über die API direkt.

**Vorschlag:** Die Liste unter einem eigenen Schlüssel zurückgeben, z. B. `zeilenFehler`.
