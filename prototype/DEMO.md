# BauTag – Prototyp-Drehbuch (DEMO.md)

Klickbarer Design-Prototyp (kein Backend, alle Daten fiktiv / Beispielwerte) für **Michael Pichler Ges.m.b.H., 2624 Breitenau**.
Arbeitstitel des Produkts: **BauTag**. **Es wird bewusst kein Firmenlogo verwendet** – stattdessen eine neutrale Wortmarke (Schutzhelm-Icon + „BauTag“); in der PDF-/Druckansicht steht der Firmenname als reiner Text an der Stelle des Logos.

## Start

```
cd prototype && python3 -m http.server 8765
http://localhost:8765/index.html?rolle=polier#/stempeluhr
```

Reines HTML/CSS/JS, keine externen Requests. Eine responsive App: Handy (< 720 px: Tab-Leiste unten), Tablet (720–1279 px: Seitenleiste schmal), PC (≥ 1280 px: volle Sidebar). Getestet in 390×844, 1180×820, 1440×900.

## URL-Parameter (vor dem `#`)

| Parameter | Werte | Wirkung |
|---|---|---|
| `rolle` | `mitarbeiter` · `polier` · `bauleiter` · `buero` · `gf` | Meldet direkt an (ohne: Login-Bildschirm). Mitarbeiter = Lukas Brandstätter, Polier = Josef Haidbauer (KST 26-041), Bauleiter = Stefan Aigner (4 Baustellen), Büro = Martina Koller, GF = Michael Pichler |
| `szenario` | `morgen` (Standard für mitarbeiter/polier) · `tag` (Standard für bauleiter/buero/gf) · `abend` · `signiert` | `morgen`: 06:52, Partie WHA Pitten noch nicht eingestempelt, heutiger Bericht leer. `tag`: 10:24, alle arbeiten (24 von 30), heutiger Bericht als Entwurf vorbefüllt. `abend`: 16:05, Partie 07:00–12:00 / 12:30–16:00 gestempelt, Bericht vorbefüllt (Bagger 9 to. 8, LKW 3-Achser 4, Rüttelplatte 6, Frostschutz 42, Splitt 6 …), noch nicht unterschrieben. `signiert`: 16:40, wie abend, aber unterschrieben + gesendet |
| `bericht=leer` | | heutiger Bericht startet leer (Personal kommt trotzdem aus den Stempelungen) – für die Diktat-/Stepper-Szene mit `szenario=abend` |
| `uhr` | `HH:MM` | Startzeit der Demo-Uhr (läuft danach in Echtzeit weiter). Datum ist fix Donnerstag, 12. November 2026 |
| `hinweis` | `ankunft` · `pause` · `ausstempeln` | zeigt 1,2 s nach dem Laden den jeweiligen Hinweis-Banner |
| `wetter=regen` | | Wetterkarte im Bericht startet mit Starkregen (SW-Vorschlag) |
| `sprache` | `de` · `bks` · `hu` · `ro` · `tr` | Startsprache (Stempeluhr + Navigation) |
| `budget=80` | | löst 1,5 s nach dem Laden den Budget-Alarm für WHA Pitten aus (für die Handy-Szene des Bauleiters) |
| `modus=baustelle` | | Baustellen-Modus (extra groß, maximaler Kontrast) aktiv |

## `window.demo`

| Aufruf | Wirkung |
|---|---|
| `demo.reset()` | alles auf Ausgangszustand (Rolle laut URL), Uhr neu |
| `demo.go('/route')` | Navigation (Hash-Route) |
| `demo.login('polier')` | Rolle wechseln (`mitarbeiter`, `polier`, `bauleiter`, `buero`, `gf`) |
| `demo.setClock('13:05')` | Demo-Uhr stellen |
| `demo.ankunft()` | Banner „Du bist bei … angekommen – jetzt einstempeln?“ |
| `demo.hinweis('pause' \| 'ausstempeln' \| 'ankunft')` | AZG-Wächter-/Erinnerungs-Banner |
| `demo.diktat()` | öffnet das Sprach-Diktat |
| `demo.sprache('hu')` | Sprache setzen |
| `demo.vorschau('polier')` | „Ansicht testen als …“ |
| `demo.budgetAlarm('26-041')` | löst den 80-%-Budget-Alarm aus (wie `budget-demo-80`) |
| `demo.papier()` | öffnet den Papierbericht-Scan |
| `demo.state` | interner Zustand (nur zum Debuggen) |

Alle Selektoren unten sind `[data-demo="…"]`. Toasts haben `[data-demo="toast"]` (verschwinden nach ~3 s).

## Routen

| Route | Inhalt | Zugriff |
|---|---|---|
| `#/login` | Namensliste + PIN-Feld | alle |
| `#/stempeluhr` | Stempeluhr (Einstempeln, Timer, Pause, Baustelle wechseln, Gerät scannen, Ausstempeln), Sprache, Baustellen-Modus | Mitarbeiter, Polier |
| `#/kolonne` | Kolonne mit einem Tipp einstempeln | Polier |
| `#/woche` | Meine Woche (KW 41–46, Codes K/U/SW, Überstunden) | Mitarbeiter, Polier |
| `#/profil` | Profil, Sprache, Baustellen-Modus, Abmelden | alle |
| `#/bericht/1` … `#/bericht/8` | Bautagesbericht-Assistent: 1 Kopf (+Wetter) · 2 Personal · 3 Geräte · 4 Material · 5 Arbeitsleistung · 6 Beistellung/Paletten/Regie · 7 Vorkommnisse · 8 Zusammenfassung | Polier (Recht „Bautagesbericht erstellen“) |
| `#/bericht/uebersicht` | Formular-Übersicht wie Papiervorlage + Unterschriftsfelder + Senden (Tablet-Szene) | Polier |
| `#/dashboard` | Heute live, Baustellen, Warnungen, Freigaben | Bauleiter, Büro, GF |
| `#/baustellen`, `#/baustellen/26-041` | Liste + Detail | Bauleiter (nur eigene), Büro, GF |
| `#/berichte` | Berichtsliste mit Status/Filter | Bauleiter, Büro, GF |
| `#/berichte/<KST>_<Datum>` z. B. `#/berichte/26-041_2026-11-11` | A4-PDF-/Druckansicht 1:1 nach Vorlage | Polier, Bauleiter, Büro, GF (Kostenkarte nur mit Recht „Preise sehen“) |
| `#/preise/lohn\|geraete\|material\|leistungen` | Preise & Stammdaten, inline editierbar | Büro, GF (bearbeiten) · Bauleiter (nur lesen) |
| `#/nachkalkulation/26-041` | Nachkalkulation je Baustelle inkl. Prognose + Hinweise | Büro, GF, Bauleiter (eigene Baustellen) |
| `#/monat` | Monatsauswertung / Lohnexport / BUAK | Büro, GF |
| `#/benutzer` | Benutzer & Berechtigungen (Matrix, Ausnahmen, Protokoll, Ansicht testen) | GF |

KST der Baustellen: `26-041` WHA Pitten (Hauptbaustelle der Demo, DB grün), `26-038` Zufahrt Kogler (gelb), `26-044` EFH Reisinger, `26-029` Gehsteig Breitenau (gelb), `26-047` Kanal Ternitz, `26-035` Parkplatz Gloggnitz (rot), `26-050` Halle Wr. Neustadt, `90-001` Kieswerk (intern).
Geräte-IDs: `kran3 kran4 lkw2 lkw3 lkw4 sattel tieflader verlege schneid kompressor dumper bobcat b15 b27 b9 b23 radlader graeder bomag hamm handwalze ruettel grabenwalze`.
Material-IDs (Vorlage): `aushub betonbruch asphaltbruch frostschutz graeder splitt`; Zusatz: `pflaster8 randstein beton asphalt rohr150`.

Verbotene Route direkt geöffnet → ruhiger Zustand `kein-zugriff` („Kein Zugriff – diese Ansicht ist nur für Büro, Geschäftsführung und Bauleitung freigegeben“), Button `kein-zugriff-zurueck`.

---

## Storyboard – exakte Abläufe

### 1a) Handy 390×844 – Mitarbeiter: Login → Einstempeln → Timer → Pause
URL: `index.html` (ohne Parameter; 06:52)
1. `login-user-2` (Lukas Brandstätter) → PIN: `pin-2`, `pin-6`, `pin-2`, `pin-4` (beliebige 4 Ziffern; Punkte: `pin-dots`) → landet auf `#/stempeluhr`
2. `baustelle-aendern` → Sheet → `baustelle-26-041` (oder andere KST wählen)
3. `einstempeln` → Toast, Timer `timer` läuft in Echtzeit, Badge `standort-badge` („Standort beim Stempeln erfasst … kein laufendes Tracking“)
4. `pause` (Pause läuft, Timer zählt Pause) → nochmals `pause` = Pause beenden
5. optional: `baustelle-wechseln` → `baustelle-26-044`; `ausstempeln` → `ausstempeln-bestaetigen`
6. Offline zeigen: `sync-chip` antippen (Offline, Buchungen werden gezählt) → nochmals = synchronisiert

### 1b) Smart Arrival + AZG-Wächter (D)
URL: `index.html?rolle=mitarbeiter&hinweis=ankunft#/stempeluhr` (Banner erscheint nach 1,2 s) oder jederzeit `demo.ankunft()`
1. Banner `hinweis-banner` → `ankunft-einstempeln` (ein Tipp, eingestempelt) · Alternative `hinweis-spaeter`
2. `demo.hinweis('pause')` → Banner „6 Std. ohne Pause“ → `hinweis-pause-starten`
3. `demo.hinweis('ausstempeln')` → Banner „Ausstempeln vergessen?“ → `hinweis-ausstempeln`

### 1c) Gerät per NFC/QR (E)
Voraussetzung: eingestempelt. `geraet-scannen` → Overlay `geraet-scan-overlay` (nach ~1,7 s `[data-state="fertig"]`: „Bagger 9 to. – Gerätestunden laufen auf KST …“) → `geraet-scan-fertig` → Karte `geraet-laeuft` mit laufender Zeit → `geraet-stopp` (Stunden wandern in den Bautagesbericht)

### 1d) Mehrsprachig + Baustellen-Modus (F)
Auf `#/stempeluhr`: `sprache` → Sheet → `sprache-hu` (auch `sprache-bks`, `sprache-ro`, `sprache-tr`, `sprache-de`) – Stempeluhr + Tab-Leiste sofort übersetzt. `baustellen-modus` schaltet extra große Tasten / maximalen Kontrast (nochmals = aus). Beides auch unter `#/profil` (`profil-sprache`, `profil-baustellen-modus`).

### 1e) Polier stempelt die Kolonne mit einem Tipp
URL: `index.html?rolle=polier#/kolonne` (oder per Login `login-user-1` + PIN, dann `nav-kolonne`)
1. Liste zeigt die Partie (Daniel Schwarz = Urlaub, nicht wählbar); einzelne Zeilen `kolonne-ma-<id>` (2, 4, 5, 6, 7, 1) an-/abwählbar
2. `kolonne-einstempeln` („6 Mitarbeiter einstempeln“) → alle grün mit Uhrzeit
3. optional `kolonne-pause`, `kolonne-ausstempeln`, `kolonne-hinzufuegen` → `kolonne-add-<id>`

### 2a) Handy – Sprach-Bautagesbericht (A, Hero-Moment) + Wetter (C)
URL: `index.html?rolle=polier&szenario=abend&bericht=leer#/bericht/1` (16:05, Partie hat gestempelt, Bericht leer)
1. Schritt 1 Kopf: Felder `kopf-datum`, `kopf-kst`, `kopf-ag`, `kopf-bv` automatisch; Wetterkarte `wetter-karte` (Temperatur, Regen, Wind automatisch)
2. Wetter-Vorschlag: `wetter-demo-regen` → Karte `sw-vorschlag` („Schlechtwetter (SW) für die Partie eintragen?“) → `sw-eintragen` → Banner `sw-eingetragen`, Toast mit `rueckgaengig` (für das weitere Drehbuch: `rueckgaengig` klicken und `wetter-demo-regen` nochmals = Normalwetter)
3. `bericht-diktieren` → Overlay `diktat-overlay`: Wellenform, Transkript `diktat-transkript` läuft Wort für Wort ein (~4,5 s), danach fliegen 7 Felder ein (`diktat-feld-0` … `diktat-feld-6`); warten auf `[data-demo="diktat-overlay"][data-state="fertig"]` (~8 s gesamt)
4. `diktat-uebernehmen` → springt auf Schritt 3 Geräte; Chip `ki-chip` „7 Felder automatisch ausgefüllt – bitte prüfen“, ausgefüllte Zeilen violett markiert („KI“): `geraet-b9` 8, `geraet-lkw3` 4, `geraet-ruettel` 6. Buttons `ki-rueckgaengig` / `ki-bestaetigen`
5. `wizard-weiter` → Schritt 4 Material: `material-frostschutz` 42 to., `material-splitt` 6 to. markiert → `wizard-weiter` → Schritt 5: Text steht in `arbeit-text`

### 2b) Handy – Lieferschein scannen (B)
In Schritt 4 (`#/bericht/4`): `lieferschein-scannen` → Overlay `lieferschein-overlay` (Kamera → nach 1,1 s Scan-Linie → nach 3,1 s `[data-state="fertig"]`) → Zeilen `lieferschein-zeile-0` … `-3` → `lieferschein-uebernehmen` → zurück in Schritt 4, Banner `lieferschein-angehaengt`, Toast mit `rueckgaengig`. (Übernimmt Splitt 6 to. ins Material, Pflaster 38 m² + Randleiste 24 lfm in die Materialbeistellung → sichtbar in Schritt 6.)

### 2c) Handy – klassischer Weg mit Steppern (manuelle Alternative)
URL: `index.html?rolle=polier&szenario=abend&bericht=leer#/bericht/2`
1. Schritt 2 Personal: automatisch aus Stempelungen (`personal-gesamt` = 51,00 Std.; Schwarz = U). Zeile `personal-ma-2` → Sheet (±15 min: `personal-b2-plus` usw., Codes `personal-code-SW`) → `personal-speichern`. SEG: `seg-add-0`
2. `wizard-weiter` → Schritt 3 Geräte: 8× `geraet-b9-plus`, 4× `geraet-lkw3-plus`, 6× `geraet-ruettel-plus` (Summe `geraete-summe` = „3 Geräte · 18 Std.“); Suche: `geraete-suche` tippen (z. B. „bagg“); Minus: `geraet-b9-minus`; Wert: `geraet-b9-wert`
3. `wizard-weiter` → Schritt 4 Material: 3× `material-frostschutz-fuhre` (= 42 to., je Fuhre 14 to.) oder `material-frostschutz-input` füllen („42“); Splitt: `material-splitt-input` „6“ oder 6× `material-splitt-plus`; Einheit umschalten `material-aushub-einheit-m3`
4. `wizard-weiter` → Schritt 5: `arbeit-text` tippen oder Textbausteine `baustein-0` … `baustein-7`; `foto-aufnehmen` (Thumbnail `foto-0`, …)
5. `wizard-weiter` → Schritt 6: `zusatz-pflaster8-plus`, `palette-euro-plus`, `palette-weiss-plus`, `regie-chip-0`, `fremdmaterial-input` + `fremdmaterial-add`
6. `wizard-weiter` → Schritt 7: `vorkommnis-1` (Anweisung AG), `vorkommnisse-text` tippen
7. `wizard-weiter` → Schritt 8 Zusammenfassung (`zusammenfassung-2` … `-7`) → `zur-unterschrift`
Navigation allgemein: `wizard-weiter`, `wizard-zurueck`, Titel `wizard-titel`; direkte Schritte nur per URL (`#/bericht/5`) bzw. am Tablet/PC `wizard-step-5`.

### 3) Tablet 1180×820 – Übersicht, Bauherr unterschreibt, PDF senden (+ H Fernunterschrift)
URL: `index.html?rolle=polier&szenario=abend#/bericht/uebersicht`
1. Formular `bericht-formular` im Zwei-Spalten-Layout der Papiervorlage (scrollen im Container `#view`)
2. `signatur-auftragnehmer-hinterlegt` (setzt die hinterlegte Unterschrift des Poliers) – oder im Feld `signatur-auftragnehmer` zeichnen
3. Bauherr: im Feld `signatur-bauherr` mit Maus/Pointer zeichnen (mouse.move → down → mehrere moves → up; Pointer-Events). Löschen: `signatur-bauherr-loeschen`
4. `bericht-senden` („Abschließen & PDF an Auftraggeber senden“) → Dialog `senden-dialog` (nach 1,5 s Erfolg) → `senden-fertig` (oder `senden-pdf-ansehen`) → Bericht gesperrt, Fußleiste `pdf-ansehen`
Fernunterschrift (statt Schritt 3): `fernunterschrift` → Sheet mit `sms-vorschau` → `sms-senden` → Status `fernunterschrift-status` („Link gesendet …“), nach 5 s erscheint die Unterschrift automatisch („Per Link unterschrieben“).

### 4) Desktop 1440×900 – Dashboard
URL: `index.html?rolle=buero#/dashboard` (10:24)
- `kpi-eingestempelt` (24 von 30), `kpi-berichte`, Baustellenzeilen `dash-baustelle-26-041`, Warnungen (`warnung-offen`, AZG § 9 / § 11), Berichte zur Freigabe `dash-bericht-26-041_2026-11-11`
- Frage-Box (nice-to-have): `frage-input` füllen „Wie viel Frostschutz auf KST 26-041?“ + Enter → `frage-antwort` → `frage-schliessen`

### 5) Desktop – Bericht als PDF/Druckansicht
- von der Liste: `nav-berichte` → `bericht-zeile-26-041_2026-11-11` → Seite `pdf-seite` (A4, alle Abschnitte der Vorlage, Unterschriften) → `bericht-freigeben` (Status wechselt) · `pdf-drucken`, `pdf-download` (nur Toast)
- der heute unterschriebene Bericht: `index.html?rolle=buero&szenario=signiert#/berichte/26-041_2026-11-12`
- Filter in der Liste: `berichte-filter-unterschrieben` etc., `berichte-baustelle` (select), `berichte-alle-freigeben`

### 6) Desktop – Preise: Gerätepreis ändern
`nav-preise` → `preise-tab-geraete` → Feld `preis-geraete-b9-kosten` füllen („42,00“) + Enter → Zelle gelb („vorher € 34,00“), Karte `preise-auswirkung` zeigt DB-Verschiebung je Baustelle (`auswirkung-26-041` …). Weitere Felder: `preis-<tab>-<id>-<feld>` (Felder `kosten`/`vk`, Material `ek`/`vk`, Leistungen `ep`), z. B. `preis-leistungen-pflaster-ep`, `preis-lohn-fa-kosten`. Zurücksetzen: `preise-zuruecksetzen`.

### 7) Desktop – Nachkalkulation (aktualisiert) + Prognose/Insights (G)
`auswirkung-26-041` (oder `preise-zur-nachkalkulation` / `nav-nachkalkulation`) → `#/nachkalkulation/26-041`
- Banner `kalk-preis-banner`, KPIs `kpi-erloes`, `kpi-kosten`, `kpi-db`, `kpi-db-prozent` mit Delta `kalk-delta` (▼ € 1.540)
- Prognose `kalk-prognose` („Bei aktuellem Verlauf: DB … statt kalkuliert …“), Hinweis-Karten `insight-0` (Frostschutz-Verbrauch über Kalkulation), `insight-1` (Regiestunden noch nicht verrechnet), `insight-2` (Leerpaletten retour / Pfand-Gutschrift)
- Kostenverteilung (`kosten-lohn`, `kosten-geraete`, `kosten-material`, `kosten-fremd`), Soll/Ist, Verlauf (Hover = Fadenkreuz + Tooltip), Tabelle: `kalk-tab-geraete|lohn|material|fremd|leistung` (geänderte Zeile `kalk-zeile-b9`), Summe `kalk-summe-geraete`
- Baustelle wechseln `kalk-baustelle-26-035` (rot), Export `kalk-export-excel`, `kalk-export-pdf`

### 8) Desktop – Monatsauswertung + Export
`nav-monat` → Matrix `monat-matrix` (Oktober 2026), `monat-warnungen`, Umschalten `monat-2026-11` / `monat-2026-10` → `export-lohn` → Dialog `export-lohn-dialog` (CSV-Vorschau) → `export-fertig` → `export-buak` → `export-buak-dialog` → `export-fertig`

### 9) Desktop – Benutzer & Berechtigungen (Rollen)
URL: `index.html?rolle=gf#/benutzer`
1. Matrix `rechte-matrix`: Zeilen `recht-zeile-<recht>`, Schalter `recht-<recht>-<rolle>` (Rechte: `zeit kolonne bericht freigabe preise preise_edit lohnsaetze kalk lohn benutzer`; Rollen: `mitarbeiter polier bauleiter buero gf`). Preise/Nachkalkulation sind für Mitarbeiter und Polier **fix gesperrt** (grau + Schloss, Tooltip „Für Baustellen-Rollen gesperrt“); GF-Spalte immer an
2. Ein Recht umschalten, z. B. `recht-freigabe-polier` → Toast, Eintrag im `protokoll`
3. Ausnahme je Benutzer: `benutzer-13-rechte` bzw. `benutzer-1-rechte` → Sheet mit `ausnahme-<recht>` (gesperrte bleiben gesperrt) → `ausnahme-fertig`. Beispiel-Ausnahme vorbelegt: Vorarbeiter Thomas Riegler darf Bautagesberichte freigeben (`ausnahme-13-freigabe`)
4. `vorschau-polier` („Ansicht testen“) → App als Polier, blaue Leiste `vorschau-leiste`: Navigation ohne Preise/Nachkalkulation, keine €-Werte. Beweis: `demo.go('/nachkalkulation/26-041')` → `kein-zugriff`. Zurück: `vorschau-beenden`
5. Bauleiter-Sicht: `index.html?rolle=bauleiter#/dashboard` – nur seine 4 Baustellen, Nachkalkulation und Preise sichtbar (Preise nur lesbar), `#/monat` → `kein-zugriff`

### 10) Auftragssumme + Budget-Alarm + Benachrichtigungen
URL Desktop: `index.html?rolle=buero#/nachkalkulation/26-041` (Karte auch in `#/baustellen/26-041`; Kurzform `budget-mini-<kst>` in `#/baustellen`). Sichtbar nur für Büro, GF, Bauleiter (eigene Baustellen).
1. Karte `budget-karte`: Feld `auftragssumme-input` (netto, editierbar; Bauleiter nur lesen), Summe `auftragssumme-gesamt`, Verbrauch `budget-verbrauch` (Kosten Ist ÷ Auftragssumme, Start 60,1 % bei Leistungsstand 72 %), Balken mit Schwellen-Marken 80/90/100 %, darunter Leistungsstand, Statuszeile `budget-status`
2. Schwellen einstellen: `budget-alarm-einstellen` → Sheet `budget-alarm-sheet`: je Schwelle `schwelle-0-minus` / `schwelle-0-plus` (±5 %, Wert `schwelle-0-wert`) und `schwelle-0-toggle` (Index 0–2 = 80/90/100 %), intelligente Regel `budget-smart`, Empfänger `empfaenger-bauleiter|buero|gf`, Kanäle `kanal-app|push|mail` → `budget-alarm-fertig`
3. Demo-Moment: `budget-demo-80` (bucht eine Demo-Eingangsrechnung, Verbrauch springt auf 80,4 %) → Karte wird rot („Kritisch: 80 % … Leistungsstand aber erst 72 %“), Desktop-Meldung `budget-meldung` („Budget-Warnung: WHA Pitten – 80 % der Auftragssumme verbraucht (Leistungsstand 72 %)“), Glocke `benachrichtigungen` mit Zähler `benachrichtigungen-badge`
4. `budget-meldung-ansehen` (oder Glocke `benachrichtigungen`) → Panel `benachrichtigungen-panel` mit Gruppen Budget-Warnungen / AZG-Warnungen / Berichte zur Freigabe: `benachrichtigung-budget-0`, `benachrichtigung-azg-0`, `benachrichtigung-bericht-0` (Klick öffnet die Stelle), `benachrichtigungen-alle-gelesen`. Direkt aus der Meldung: `budget-meldung-oeffnen`
5. Live-Neuberechnung: `nachtrag-text` füllen („Nachtrag 01 – zusätzliche Stellplätze“), `nachtrag-betrag` füllen („18.000“), `nachtrag-add` → Zeile `nachtrag-0`, Gesamt € 220.498, Verbrauch sinkt 80,4 % → 73,8 %. Ebenso `auftragssumme-input` ändern + Enter
6. Zurück: `budget-demo-reset`
Handy Bauleiter (390×844): `index.html?rolle=bauleiter&budget=80#/dashboard` → nach 1,5 s Push `push-banner` → `push-ansehen` (öffnet Nachkalkulation) oder `push-spaeter`; Glocke `benachrichtigungen` öffnet dieselbe Liste als Handy-Panel. Alternativ `demo.budgetAlarm()` auf jeder Seite. Polier/Mitarbeiter haben keine Glocke und bekommen nie einen Push (auch nicht per `demo.budgetAlarm()`).

### 11) Papier-Bautagesbericht scannen (KI/OCR)
URL Desktop: `index.html?rolle=buero#/berichte` · Handy/Tablet Polier: `index.html?rolle=polier#/bericht/1` (Leiste „Papierbericht fotografieren“, gleicher Selektor)
1. `papier-scannen` → Overlay `papier-overlay` (`data-state="upload"`)
2. `papier-datei` (oder `papier-beispiel`) → `data-state="scan"`: ausgefüllte Papiervorlage mit Handschrift + Scan-Linie (2,6 s) → warten auf `[data-demo="papier-overlay"][data-state="fertig"]`
3. Ergebnis nebeneinander: links der Scan mit markierten Feldern (grün erkannt, orange unsicher), rechts die Felder mit Sicherheit in %: `papier-feld-datum`, `-kst` (Baustelle automatisch zugeordnet), `-ag`, `-bv`, `papier-feld-personal-13|14|15` („Riegler Th.“ → Thomas Riegler aus den Stammdaten), `papier-feld-geraet-b27|lkw2|ruettel|schneid`, `papier-feld-material-frostschutz|splitt`, `-zusatz`, `-arbeit`, `-paletten`, `-regie`, `-vorkommnisse`, `-sig-an`, `-sig-bh`; Kopfzeile `papier-zusammenfassung` („34 Felder erkannt · 2 bitte prüfen“). Unsicheres Feld korrigierbar: `papier-eingabe-b27`
4. `papier-uebernehmen` („Alle übernehmen“) → Bericht `26-044_2026-11-11` mit Status „Aus Papier übernommen“ öffnet sich in der PDF-Ansicht, Karte `original-scan` zeigt den angehängten Scan; Stunden/Geräte/Material zählen sofort in der Nachkalkulation `#/nachkalkulation/26-044`. Danach `bericht-freigeben` möglich; in der Liste als `bericht-zeile-26-044_2026-11-11`. Abbrechen: `papier-verwerfen`
Auch per `demo.papier()` zu öffnen.

## Bekannte Grenzen des Prototyps
- Zustand lebt nur im Speicher der jeweiligen Seite: Handy-, Tablet- und Desktop-Szene sind getrennte Seiten und teilen keinen Zustand – dafür gibt es die Szenarien (`szenario=abend|signiert`). Nach einem Reload ist alles wieder im Ausgangszustand.
- Der Papier-Scan erkennt immer denselben Beispielzettel (EFH Reisinger, 11.11.2026); die Handschrift ist per Kursivschrift + Verzerrung nachgeahmt, es gibt keinen echten Datei-Upload.
- Der Budget-Alarm wird über eine Demo-Buchung (fiktive Eingangsrechnung) ausgelöst; E-Mail/Push sind nur als Kanal-Schalter und Banner dargestellt.
- Diktat, Lieferschein-Scan, NFC-Scan, Wetter, SMS, Exporte und Druck sind simuliert (feste Demo-Inhalte).
- Übersetzt sind Stempeluhr und Navigation; Berichte bleiben deutsch.
- Plantafel/Einsatzplanung (Drag & Drop) ist nicht umgesetzt.
