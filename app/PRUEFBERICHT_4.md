# BauTag – Vierte unabhängige Freigabeprüfung (Befunde 4)

Stand: 13.11.2026. Geprüft wurde `app/` (Code-Stand `97014e8`; während der Prüfung kam `093df3a` dazu, der nur `FORTSCHRITT.md` ändert) gegen `app/API.md` (Abschnitte 6–10e, spätere haben Vorrang) und `docs/Konzept.md` Kap. 2.2. `/home/user/bautag-servicebuch` wurde nicht angesehen.

## Urteil

**Freigabefähig: ja.** Ich habe keinen kritischen und keinen hohen Befund gefunden. Das gilt unter einer Bedingung (siehe E-03): Es gibt noch keine produktive Datenbank aus einer älteren Version, die auf diesen Stand aktualisiert wird.

- **Prüfbericht 3:** Alle 12 Befunde D-01 bis D-12 sind behoben. Ich habe jeden mit seiner ursprünglichen Reproduktion nachgestellt.
- **Kernregel hält:** Polier und Mitarbeiter bekommen nie EP oder €-Werte, auch nicht auf den neuen Positions-Endpunkten:
  - Alle 15 Positions- und Kalkulations-Endpunkte antworten mit 403.
  - Preis- und Kalkulationsrechte lassen sich weder per Matrix noch per Ausnahme vergeben (400).
  - Die Oberfläche zeigt bei diesen Rollen kein „€“.
- **Bauleiter:**
  - Eigene Baustellen: lesen ja.
  - Positionen, EP, Katalog und Import ändern: 403.
  - Fremde Baustellen: 403.
  - Mengen erfassen darf er nur auf eigenen Baustellen, wie es API 10 vorsieht.
- **Rechnung der Positions-Nachkalkulation:** stimmt für alle 8 Demo-Baustellen, unabhängig nachgerechnet. Geprüft wurden:
  - Summen, Gruppensummen, Anteile in %, Ergebnis und Budget-%;
  - die Landschaftsabgabe;
  - der Faktor bei PA- und VE-Positionen.
- **Budget-Alarm:** arbeitet auf der neuen Basis (Nachkalkulationssumme ÷ Auftragssumme gesamt).
- **Vor dem Echtbetrieb beheben (mittel):** vier Befunde.
  - **E-01:** Die Oberfläche löscht beim „Zuordnung prüfen“ die automatische Landschaftsabgabe.
  - **E-02:** Ein Excel-Import kann den Server zum Absturz bringen.
  - **E-03:** Beim Aktualisieren einer bestehenden Datenbank fehlt eine Übernahme der Positionen – Budget-Alarm ist dann aus.
  - **E-04:** Ein erneuter Import der Firmen-Vorlage macht die 10d-Anpassungen rückgängig.

**Tests**

| Lauf | Ergebnis |
|---|---|
| `npm test` | 277/277 bestanden (`mine/npmtest.log`) |
| `npm run test:e2e` | absprachegemäß nicht selbst ausgeführt |
| Eigene API-Skripte | `v1.js`–`v4.js` (Nachprüfung), `q1.js`–`q9.js` (Positionen) |
| Eigene Oberflächen-Skripte | `ui1.js`–`ui3.js` (Playwright, Port 3400, eigene Datenbank) |

**Ordnung**
- Der Server auf Port 3400 ist gestoppt.
- `git status` ist leer.
- Ein versehentlich von Playwright angelegtes, nicht versioniertes `app/shots/` habe ich sofort wieder entfernt.
- Alle Hilfsdateien liegen unter `/tmp/claude-0/-home-user-Stundenaufzeichnung/1c043855-ef33-5685-9374-56f053b5f049/scratchpad/review4/mine/`.

---

## 1. Nachprüfung PRUEFBERICHT_3

| ID | Ergebnis | Nachweis (Original-Reproduktion) |
|---|---|---|
| **D-01** (hoch) | **behoben** | Die GF wird von einer einzigen Adresse (66.6.6.6) gesperrt, nach 83 Min.: `401…429…423`. Richtige PIN → 423 mit `Retry-After` 86400 (24 Std.); `gesperrtBis` wird gesetzt. Büro entsperrt die GF → 200, GF meldet sich an → 200. Büro setzt die PIN der GF zurück → 403; Büro entsperrt sich selbst → 403. Gesperrtes Büro meldet sich nach 24 Std. wieder an → 200. Zweite Sperre: 48 Std. `node server/entsperren.js` ist vorhanden. Startwarnung bei nur einem Verwaltungs-Konto: gesehen. **Rest:** Ein Angreifer kann die Verwaltung ohne Anmeldung weiter befristet aussperren (24 Std. bis 7 Tage, wiederholbar). Ein zweiter Faktor für Büro/GF fehlt weiter (Konzept 7.4). |
| D-02 | **behoben** | Büro macht Polier 13 zum Bauleiter → 403. Büro legt einen Bauleiter an → 403. Büro wechselt Mitarbeiter ↔ Polier → 200, die GF bekommt eine Benachrichtigung `sicherheit`. Wechselt die GF jemanden zum Bauleiter, wird `mussPinAendern:true` gesetzt. |
| D-03 | **behoben** | Nachtschicht 08.11. 22–06 auf Baustelle 1 und Bericht 09.11. auf derselben Baustelle mit 00–06 → 400. Gast auf Baustelle 2 am 09.11. 05–13 → 400. MA 9 im Bericht vom 08.11. 22–06 bei einem Bericht vom 09.11. 04–12 → 400. Nachträglich eingetragene Büro-Schicht über eine Berichtszeile → im Monat nur einmal gezählt, `ueberschneidung:true` mit Warnung. |
| D-04 | **behoben** | Bauleiter 08–12 und GF 09–11 stempeln auf Baustelle 1. Sie stehen nicht im Vorschlag, auch nicht nach `personal-aktualisieren`. Der Vorschlag lässt sich speichern. Monat: Bauleiter 4 Std., GF 2 Std., `quelle:"stempel"`. |
| D-05 | **behoben** | Zweite Bauherr-Unterschrift → 409. Nach Rücknahme werden abgelehnt (400): Bild A plus Null-Byte, Bild A unverändert, dieselben Pixel mit anderer Kompression, dieselben Pixel mit zusätzlichem `tEXt`-Block. |
| D-06 | **behoben** | `seed.js` ohne `BAUTAG_DEMO` bricht ab, es entsteht keine Datenbank. `einrichten.js` lehnt 4-stellige PIN und „123456“ ab und bricht bei bestehenden Benutzern ab. Der Katalog wird mit 119 Positionen angelegt, Gerätepreise mit 0. |
| D-07 | **behoben** | Unterschrift ohne `version` → 400, mit veralteter `version` → 409. |
| D-08 | **behoben** | Genehmigter U und 7 Std. am selben Tag → Warnung `abwesenheit_mit_stunden` und Hinweiszeile in `monat/export.csv`. |
| D-09 | **behoben** | Polier meldet SW für sich selbst → 201 `beantragt`. Der Bauleiter der Stamm-Baustelle bestätigt den SW-Antrag von MA 5 → 200. |
| D-10 | **behoben** | Bauleiter erfasst `an` und gibt frei → 403. GF-Selbstfreigabe → 200 mit `selbstfreigabe:true` und Warnung `selbstfreigabe` im Monat. |
| D-11 | **behoben** | GF macht 13 wieder zum Polier → `zuordnungenEntfernt:[{baustelleId:3, feld:"bauleiterId"}]`, Baustelle 3 hat danach `bauleiterId:null`. |
| D-12 | **behoben** | Mit `BAUTAG_LOGIN_LISTE=0`: Liste → 404, Anmeldung per `benutzerId` → 400, Anmeldung per `pnr` funktioniert. |

---

## 2. Neue Befunde

### E-01 · mittel · „Zuordnung prüfen“ in der Oberfläche löscht die automatische Landschaftsabgabe (Regel 10a)

**Dateien**
- `public/js/views/positionen.js:142-148`: Die Zuordnungsbox ist für „Landschaftsabgabe“ geöffnet, weil `zuordnungPruefen:true` gilt. Die Auswahl kennt aber nur Personal, Gerät und Material, nicht `naturmaterial`.
- `public/js/views/positionen.js:172`: Ist keine Art gewählt, wird `quelle:null` gesendet.
- `server/routes/positionen.js:48-51`: Der Server nimmt `quelle:null` an.

**Reproduktion** (`ui2.js`, Büro, 1440×900, Baustelle 1)
1. Vorher liefert die API: Landschaftsabgabe `quelle:{art:"naturmaterial"}`, `mengeAuto:157`, Summe 39,25 €.
2. Mengen-Dialog der Landschaftsabgabe öffnen. Die Box „Zuordnung zum Bautagesbericht – bitte prüfen“ ist offen, „Menge kommt aus“ steht auf „– keine automatische Menge –“.
3. Auf „Zuordnung speichern und als geprüft bestätigen“ klicken. Die Oberfläche meldet „Zuordnung gespeichert“.

**Beobachtet**
- API danach: `quelle:null`, `mengeAuto:0`, Summe 0 €. Die Nachkalkulationssumme sinkt um 39,25 €.
- Die Zeile zeigt weiter „0 t · auto: je t Naturmaterial“, weil die Oberfläche die Position am Namen erkennt (`positionen.js:13`).
- In der Oberfläche gibt es keinen Weg zurück. Wiederherstellen geht nur per API (`PUT … {quelle:{art:"naturmaterial"}}`).
- Jede neue Baustelle bekommt die Landschaftsabgabe mit „bitte prüfen“. Wer die Prüfung gewissenhaft bestätigt, verliert also die Abgabe.

**Erwartet:** Die Landschaftsabgabe rechnet automatisch 0,25 € je t Naturmaterial (10a). Das Bestätigen der Prüfung ändert die Rechnung nicht.

**Vorschlag**
- Für `quelle.art === "naturmaterial"` statt der Auswahl einen festen Text „Automatisch: Tonnen Naturmaterial“ zeigen.
- Beim Bestätigen nur `{zuordnungPruefen:false}` senden.
- In der Auswahl die Option „Tonnen Naturmaterial (Landschaftsabgabe)“ ergänzen.
- Optional am Server: Wird `quelle` einer Position mit `naturmaterial`-Quelle auf `null` gesetzt, einen Hinweis zurückgeben.

**Verwandt, niedrig**
- Der Schalter „Naturmaterial“ erscheint bei jeder Position, auch bei `Std.`. Ursache: `p.naturmaterial != null` (`positionen.js:147`) ist immer wahr. Er wirkt dort aber nicht.

### E-02 · mittel · Excel-Import: Eine Datei von 1 MB belegt 1,2 GB Speicher; drei gleichzeitige Uploads bringen den Server zum Absturz

**Dateien**
- `server/routes/positionen.js:150-157`
- `server/katalog-excel.js:48-50`: `ExcelJS.load` ohne Begrenzung der entpackten Größe, Zeilen oder Zelllänge.
- `server/index.js:85`: JSON-Grenze 2 MB.

**Reproduktion** (`mkbomb2.py`, `q7.js`, `q7b.js`, Büro)
1. Eine xlsx-Datei von 0,97 MB, deren Tabelle eine Zelle mit 1 GB Text enthält.
2. Einzeln: 400 „Invalid string length“, nach 4,7 s, mit einem Spitzenspeicher von 1,23 GB. In dieser Zeit ist der Server blockiert.
3. Drei gleichzeitige Uploads mit dem Standard-Heap von 2,2 GB: `FATAL ERROR … heap out of memory`, der Prozess endet mit Code 134.

**Beobachtet**
- Der ganze Server ist weg. Stempeln, Berichte und alles andere sind für alle Benutzer bis zum Neustart nicht erreichbar.
- Auslösen können das nur Konten mit `preise_bearbeiten` (Büro/GF): ein übernommenes Konto oder eine versehentlich falsche Datei.
- Fehlerhafte Dateien werden sonst sauber abgewiesen: kein Base64, Zufallsdaten, kaputtes ZIP → 400.
- **Nebenbei:** Die Oberfläche erlaubt Dateien bis 5 MB (`public/js/views/katalog.js:47`). Durch die JSON-Grenze von 2 MB scheitern aber schon Dateien ab etwa 1,5 MB, mit der Meldung „Anfrage zu groß.“

**Erwartet:** Ein Upload kann den Server nicht zum Absturz bringen.

**Vorschlag**
- Vor dem Parsen die entpackten Größen im ZIP-Verzeichnis prüfen, z. B. höchstens 10 MB je Eintrag und 20 MB gesamt. Zeilenzahl begrenzen (z. B. 2000) und Zelltext begrenzen.
- Nur einen Import gleichzeitig zulassen.
- Den Upload-Hinweis in der Oberfläche an die Server-Grenze anpassen.

### E-03 · mittel (hoch, falls eine Datenbank aus einer älteren Version weiterläuft) · Nach dem Aktualisieren einer bestehenden Datenbank zeigen alle Baustellen 0 % Budget, Status „ok“; alte Alarme blockieren neue

**Dateien**
- `server/index.js:43-44`: Beim Start werden nur Katalog und Anpassungen angelegt, keine Projektpositionen für bestehende Baustellen.
- `server/daten.js:66-70`: Der Budget-Verbrauch kommt ab jetzt aus den Positionen.
- `server/budget.js:52-66`: Ein Alarm hängt nur an der Schwelle. Er wird nur wieder scharf, wenn sich `auftragGesamt` ändert, nicht wenn sich die Art der Basis ändert.

**Reproduktion** (`q5.js`)
1. Stand des Prüfberichts 3 (`git archive 4afe0c1`) in den Scratch-Ordner entpacken und dort mit `BAUTAG_DEMO=1` eine Datenbank anlegen.
2. Diese Datenbank mit dem aktuellen Code öffnen.

**Beobachtet**
- Katalog: 119 Positionen. Projektpositionen: 0 – für alle Baustellen.
- `budgetVerbrauchProzent` ist überall 0, Status „ok“. Die interne Rechnung zeigt dagegen z. B. 103 % (Baustelle 6) und 91,9 % (Baustelle 3).
- Kein Hinweis und keine Startwarnung.
- Die alten Alarm-Zeilen bleiben, z. B. Baustelle 6: 80/90/100. Erreicht die Positions-Summe später nach „Aus Vorlage übernehmen“ diese Schwellen, kommt kein Alarm mehr.

**Erwartet:** Der Budget-Alarm bleibt nach einem Update wirksam.

Laut README laufen Migrationen beim Start; ein Update-Pfad ist also vorgesehen. **unbestätigt:** ob schon eine Pilot- oder Echt-Datenbank existiert. Wenn ja, blockiert dieser Befund die Freigabe.

**Vorschlag**
- In der Migration den Katalog in alle bestehenden Baustellen kopieren, mit `zuordnungPruefen`.
- Die Alarm-Zeilen löschen bzw. mit einer Basis-Kennung (`basis_art`) versehen.
- Bei einer Baustelle ohne Positionen, aber mit Auftragssumme, den Status „keine Positionen“ und einen Hinweis zeigen statt 0 % „ok“.

### E-04 · mittel · Erneuter Import der Firmen-Excel-Vorlage macht die freigegebenen 10d-Anpassungen rückgängig und legt Geräte doppelt an

**Dateien**
- `server/routes/positionen.js:160-168`: Der Abgleich läuft nur über Gruppe, Bezeichnung und Einheit.
- `server/daten/katalog_anpassungen.js`: Die Umbenennungen sind dem Import nicht bekannt.

**Reproduktion** (`q6.js`): Büro: `POST /positionen/katalog/import` mit `docs/vorlage/Nachkalkulation_Positionen_Vorlage_2026-04-01.xlsx`.

**Beobachtet** (Vorschau)
- `neu`: 7 Positionen – „Bagger 1,8 to.“, „Komatsu PC27 3 to“, „Mobilbagger 9-11 to“, „Kettenbagger 23 to“, „Minilader Bobcat  3,3 to“, „Radlader Case 2,5 m3“, „Radlader Cat 3,5 m3“. Das sind die alten Namen der 10d-Umbenennungen.
- `geaendert`: „Rollschotter RK 16/63“ 12,50 → **14,50**.
- Mit „Übernehmen“ hat der Katalog jedes dieser Geräte zweimal, die Doppel ohne Zuordnung zum Bautagesbericht, und der vom Kunden freigegebene Preis ist zurückgesetzt.
- Die Excel-Vorlage ist laut API 10 der Weg, den Katalog zu pflegen. Bei der nächsten Vorlagen-Version mit den alten Gerätenamen passiert genau das. Bestehende Baustellen bleiben unberührt; die Vorschau zeigt den Vorgang, erklärt ihn aber nicht.

**Erwartet:** Die freigegebenen Anpassungen aus 10d bleiben erhalten.

**Vorschlag**
- Beim Import die Umbenennungen (alt → neu) beim Abgleich berücksichtigen.
- Preisänderungen gegenüber einer freigegebenen Anpassung in der Vorschau eigens kennzeichnen („Datei ist älter als Katalog-Anpassung 10d“).
- Oder die Vorlagen-Datei selbst auf den 10d-Stand bringen.

### E-05 · niedrig · Excel-Import umgeht die Prüfungen von POST und PUT

**Dateien:** `server/katalog-excel.js:65-68`, `server/routes/positionen.js:163-175`

**Reproduktion** (`q8.js`, `q8b.js`): Datei mit EP −50, EP 1e15, einer Bezeichnung mit 5000 Zeichen und einer doppelten Zeile „Dup“.

**Beobachtet**
- Die Vorschau zeigt alles an.
- Mit negativem EP endet „Übernehmen“ mit **500** „Interner Fehler“: Die Datenbank-Bedingung `ep >= 0` greift, die Transaktion wird zurückgerollt.
- Ohne die negative Zeile wird übernommen:
  - EP 1e15 (sonst gilt eine Obergrenze von 1e6);
  - die Bezeichnung mit 5000 Zeichen (sonst gilt eine Obergrenze von 200);
  - „Dup“ zweimal;
  - EP ohne Rundung auf Cent.
- Eine neue Baustelle hat danach eine Nachkalkulation von 1.000.000.000.000.500 €.
- Positionen hinter der letzten Summenzeile (`offen`) fallen ohne Meldung weg.

**Vorschlag:** Jede Zeile mit denselben Regeln prüfen wie `POST /positionen/katalog`: `v.betrag` mit 0 bis 1e6, Text höchstens 200 Zeichen, Einheit höchstens 20 Zeichen. Doppelte Zeilen in der Vorschau melden, `offen` mit ausgeben, ungültige Zeilen mit 400 und Zeilennummer abweisen.

### E-06 · niedrig · Excel-Export und App rechnen bei Mengen mit mehr als 3 Nachkommastellen um 1 Cent verschieden; Summe der Anteile 100,1 %

**Dateien**
- `server/positionen.js:32-35`: Die App rundet die Menge auf 3 Stellen, dann rechnet sie × EP.
- `server/katalog-excel.js:103-112`: Excel bekommt die ungerundeten Einträge.
- `server/routes/positionen.js:272`: Die Menge wird beim Erfassen nicht gerundet.

**Reproduktion** (`q2.js`, `q6.js`, `xl/ev.py`, LibreOffice headless): Position mit EP 25 €/t, Menge 2,0004 t.

**Beobachtet**
- App: 50,00 €. Excel (nachgerechnet und in LibreOffice): 50,01 €.
- Gesamtsumme App 71.677,85 €, Excel 71.677,86 €.
- Die Zusammenstellung rechnet „Gesamtsumme %“ als `SUM` der gerundeten Anteile = 100,1. Der gespeicherte Wert ist 100, die App zeigt fest „100 %“.

**Erwartet:** App und Export rechnen auf den Cent gleich.

**Vorschlag:** Mengen beim Erfassen auf 3 Stellen runden (oder gerundet exportieren). Die Prozent-Summe nicht aus gerundeten Anteilen bilden.

### E-07 · niedrig · Bauleiter kann fremde Mengeneinträge stornieren, z. B. Lieferantenrechnungen des Büros

**Datei:** `server/routes/positionen.js:63-68`, `:283-296`

**Reproduktion** (`q3.js`)
1. Das Büro erfasst bei „Lagerhaus“ (PA) auf Baustelle 2 die Rechnung 20.000 € („Rechnung Lagerhaus 4711“).
2. Bauleiter 103: `DELETE …/mengen/<id>` → 200.

**Beobachtet**
- Die Nachkalkulationssumme der eigenen Baustelle sinkt und damit auch der Budget-Verbrauch. Das Ergebnis des Bauleiters sieht besser aus.
- Der Vorgang steht nur im Protokoll, und das sieht nur die GF.

**Erwartet** (Konzept 2.2: „darf Preise sehen, aber nicht bearbeiten“; Mengen ja): Der Bauleiter storniert nur eigene Einträge.

**Vorschlag:** Der Bauleiter storniert nur Einträge mit `erstellt_von = ich`; fremde Einträge storniert nur das Büro. Optional eine Benachrichtigung an das Büro.

### E-08 · niedrig · Mit `kalk_sehen` ohne `preise_sehen` werden Rechnungsbeträge der PA-/VE-Positionen trotzdem ausgeliefert

**Datei:** `server/routes/positionen.js:77-92`. Entfernt werden nur `ep` und `summe`.

**Reproduktion** (`q3.js`): GF nimmt der Rolle Bauleiter per Matrix `preise_sehen` (erlaubt). Bauleiter: `GET /baustellen/2/positionen`.

**Beobachtet:** Bei „Lagerhaus“ kommen `menge:5367` und `eintraege:[[367,"Lagerhaus-Rechnung Kleinmaterial"],[5000,…]]`. Nach 10a sind das Netto-Rechnungsbeträge in €. Polier und Mitarbeiter sind nicht betroffen, sie bekommen nie `kalk_sehen`.

**Erwartet** (10b): Ohne `preise_sehen` keine €-Werte.

**Vorschlag:** Für PA/VE-Positionen `menge`, `mengeManuell` und `eintraege[].menge` ohne `preise_sehen` weglassen. Die Notizen ebenso, sie enthalten oft Rechnungsdaten.

### E-09 · niedrig · Hinweise zu Mehrfachzuordnungen sind unzuverlässig

**Datei:** `server/positionen.js:131`, `:141-155`, `:165-169`

**Reproduktion** (`q2.js`, `q9.js`)
- Eine zweite eigene Position mit `quelle:{art:"naturmaterial"}` rechnet die Landschaftsabgabe doppelt, ohne Hinweis.
- Umgekehrt: „Kleingeräte“ ausgeblenden und eine neue Position mit denselben Geräten anlegen. Dann erscheint dreimal „… mehreren Positionen zugeordnet – Mengen werden doppelt gezählt“, obwohl die ausgeblendete Position nicht in der Summe zählt.

**Vorschlag:** Bei der Prüfung auf Mehrfachzuordnung ausgeblendete Positionen auslassen. Bei mehr als einer `naturmaterial`-Quelle warnen.

---

## 3. Geprüft und in Ordnung (Positions-Nachkalkulation)

**Rechnung** (`q1.js`, `q2.js`)
- Für alle 8 Demo-Baustellen unabhängig nachgerechnet:
  - Menge = automatische Menge + Summe der manuellen Einträge;
  - Summe = Menge × EP, auf den Cent gerundet;
  - Gruppensummen nur aus aktiven Positionen;
  - Gesamtsumme, Ergebnis und Ergebnis-%;
  - `budgetVerbrauchProzent` stimmt mit `/kalkulation/:id` überein.
- Keine Abweichung. Die Summe der Anteile liegt rundungsbedingt bei 99,9–100,1 %.

**Landschaftsabgabe**
- Baustelle 1: 228 t (Splitt 32 + Wandschotter FSM 166 + Grädermaterial 30) × 0,25 = 57,00 €. Bodenaushub zählt richtig nicht mit.
- Kies +100 t → +25 €. Recycling RB → keine Änderung.
- Einheit `m3` → zählt nicht. ` T ` und `to` → zählen.
- Ausgeblendete Position → zählt nicht, mit Hinweis.
- Manuelle Zusatzmenge wird addiert.

**PA/VE:** Asphalt 1.000 € → 1.150 €; Maut-Faktor 1,05; „Summe Abgaben“ = Landschaftsabgabe + Maut + neue Gebühren (10c).

**Unabhängigkeit je Projekt**
- EP auf Baustelle 7 ändern → Baustelle 6 bleibt unverändert.
- Katalog-EP ändern → keine bestehende Baustelle ändert sich.
- „Preise aus Vorlage“ zeigt eine Vorschau und ändert dabei nichts.
- Eine neue Baustelle bekommt 119 Positionen mit dem aktuellen Katalogpreis.

**Prüfungen der Eingaben**
- Menge 0,0004 / −5 / als Text, Datum in der Zukunft, EP −1 / 1e7 / als Text, leere Einheit, Bezeichnung über 200 Zeichen, unbekannte Gruppe, unbekannte Quelle, Faktor 0, negative Sortierung → alle 400.
- Löschen mit Mengen → 409.
- Zugriff über die ID einer fremden Baustelle → 404.

**Versionssperre:** ohne `version` → 400; veraltete `version` → 409 mit aktueller `version` (Projektposition und Katalog).

**Rechte** (`q3.js`)
- Polier 1 und 8, Mitarbeiter 2 und 27: 15/15 Endpunkte → 403.
- €-Scan von Baustellen, Berichten, Benachrichtigungen, `/auth/ich`, Material und Geräten: sauber.
- Bauleiter: sieht EP nur für eigene Baustellen; Excel-Export eigener Baustellen 200, fremder 403; PUT, POST, aus-vorlage, Katalog-PUT und Import → 403.
- Das Büro liest das Protokoll nicht (403). Die Arten `katalog` und `nachkalkulation` sind nur mit `preise_sehen` sichtbar.

**Budget-Alarm** (`q4.js`)
- Ein Rechnungsbetrag hebt Baustelle 1 von 60 % auf 81,1 %. Meldung „Budget-Warnung … 80 %“ an Bauleiter, Büro und GF; Polier und Mitarbeiter bekommen keine.
- Nach Storno und erneutem Überschreiten kommt kein zweiter 80-%-Alarm (so gewollt: neu scharf erst bei geänderter Auftragssumme).
- Ein Mengeneintrag des Bauleiters über 100 % löst den 100-%-Alarm aus.

**Excel-Export**
- Gültige xlsx (öffnet in openpyxl und LibreOffice).
- Spalten: M `SUM(C:L)`, O `ROUND(M*N,2)`, Gruppensummen `SUM`, Zusammenstellung mit `IF(…=0,0,…)`. Mehr als 9 Einträge werden in L zusammengefasst.
- Alle Formeln nachgerechnet: Bis auf E-06 gleich den App-Werten.
- **Formel-Injektion:** `=HYPERLINK(…)`, `+SUM(1,2)`, `@x` und `=cmd|…` stehen als Text-Zellen (`t="s"`). Das Arbeitsblatt enthält nur die eigenen Formeln der Vorlage.

**Oberfläche** (`ui1.js`)
- 5 Rollen × 3 Größen (390×844, 1180×820, 1440×900) × 24 Ansichten = 360 Aufrufe, einschließlich `#/kalkulation/{1,2,3}/positionen` und `#/preise?tab=katalog`.
- Ergebnis: kein horizontales Überlaufen, keine Skriptfehler, kein „undefined/NaN“, kein „€“ bei Polier/Mitarbeiter.
- Einzige Konsolenmeldung: das erwartete 403 beim Bauleiter auf der fremden Baustelle 3.
- Mengen-Dialog bei PA-Positionen mit „Rechnungsbetrag (€)“ und Excel-Download funktionieren (`ui2.js`, `ui3.js`).

## 4. Hinweise (kein Befund, Entscheidung der GF)

- **Bauleiter „nur lesen“:** Laut API 10 darf der Bauleiter auf eigenen Baustellen **Mengen erfassen** – umgesetzt (siehe auch E-07).
- **Firmenkatalog für Bauleiter:** `GET /positionen/katalog` liefert dem Bauleiter alle Firmen-EP, nicht nur die seiner Baustellen. Das passt zu „Bauleiter darf Preise sehen“ und zum bisherigen `/preise`, ist aber nicht baustellenbezogen.
- **Automatische Personalstunden** werden über die **aktuelle** Lohngruppe der Person zugeordnet (`server/positionen.js:133`). Ein späterer Lohngruppenwechsel (z. B. zu LKW-Fahrer) verschiebt alte Stunden. Nicht nachgestellt.

## 5. Nicht geprüft

- Der vollständige E2E-Lauf (führt der Auftraggeber aus).
- Echte Mobilgeräte, Tastatur- und Screenreader-Bedienung, Betrieb hinter HTTPS-Reverse-Proxy, Last.
- **unbestätigt:** ob produktive oder Pilot-Datenbanken aus älteren Versionen existieren (entscheidet die Schwere von E-03).

## 6. Freigabe

| ID | Schwere | Kurz |
|---|---|---|
| E-01 | mittel | „Zuordnung prüfen“ löscht die automatische Landschaftsabgabe |
| E-02 | mittel | Excel-Import: Speicherexplosion, Server-Absturz |
| E-03 | mittel (hoch bei Bestands-Datenbank) | Update: keine Projektpositionen, Budget 0 %, alte Alarme blockieren |
| E-04 | mittel | Re-Import der Vorlage macht die 10d-Anpassungen rückgängig |
| E-05 | niedrig | Import ohne Eingabeprüfung |
| E-06 | niedrig | 1-Cent-Abweichung App/Excel, 100,1 % |
| E-07 | niedrig | Bauleiter storniert fremde Rechnungsbeträge |
| E-08 | niedrig | PA-Beträge ohne `preise_sehen` sichtbar (nur bei angepasster Matrix) |
| E-09 | niedrig | Hinweise zur Mehrfachzuordnung unzuverlässig |

**Urteil: freigabefähig (ja).** Kein kritischer und kein hoher Befund, vorausgesetzt, es wird keine Bestands-Datenbank aktualisiert (sonst E-03 = hoch und blockierend). E-01 bis E-04 vor dem Echtbetrieb beheben oder von der GF entscheiden lassen.
