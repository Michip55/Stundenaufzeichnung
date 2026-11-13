# BauTag – Servicebuch für Fahrzeuge und Geräte (Entwurf des API-Vertrags)

Stand: 13.11.2026 · **Entwurf** – wird nach Freigabe als Abschnitt 11 in `API.md` übernommen. Fachliche Grundlage: `docs/Konzept.md` Kapitel 5.
Gilt **additiv** zu `API.md` (Rechte, Fehlerformat, Datums-/Geldformate, Protokoll, Benachrichtigungen, optimistische Sperre mit `version`).
Umfang so geschnitten, dass ihn **zwei Entwickler (Backend + Oberfläche) in einem Durchgang** umsetzen können (Schätzung 150–240 Std.).

Alle Werte, die auf Recherche beruhen (Prüfintervalle), sind **Vorlagen** – vom Büro änderbar und in der Oberfläche mit „Prüfen“ gekennzeichnet (`pruefen:true`).

---

## 1. Begriffe

| Begriff | Bedeutung |
|---|---|
| **Anlage** | ein konkretes Fahrzeug, eine Maschine, ein Anhänger oder Kleingerät (z. B. „Radlader CAT 950 M“, Kennzeichen …). Nicht zu verwechseln mit **Gerät** (`geraet`) = Gerätetyp/Zeile der Papiervorlage („Radlader“). |
| **Klasse** | `pkw`, `bus`, `lkw`, `anhaenger`, `baumaschine`, `walze`, `brecher`, `kleingeraet`, `sonstiges` |
| **Zähler** | je Anlage 0..n: `km` (Kilometer), `bh` (Betriebsstunden), `brecher` (Brecherstunden), `kran` (Kranstunden), `hub` (Hubzahl, z. B. Ladekran laut Kransteuerung – optional). |
| **Zählerstand** | Ablesewert mit Datum, Quelle und Status. Geschätzte Stände aus Bautagesberichten werden **berechnet**, nicht gespeichert. |
| **Planposition** | ein wiederkehrender Termin einer Anlage (gesetzliche Prüfung, Herstellerservice, interne Kontrolle, Vertragsfrist) mit Intervall nach Datum und/oder Zähler – „was zuerst eintritt“. |
| **Vorlage** | Muster für Planpositionen je Klasse (z. B. „§57a LKW jährlich“). |
| **Eintrag** | Servicebuch-Eintrag (Service, Reparatur, Prüfung, Reifen, Sonstiges); kann Planpositionen als erledigt markieren. |
| **Mangel** | Mängelmeldung zu einer Anlage, von jedem angemeldeten Benutzer. |

## 2. Rechte

Neues Recht **`fuhrpark`** – Text: „Fuhrpark und Servicebuch pflegen“.

| Recht | mitarbeiter | polier | bauleiter | buero | gf |
|---|---|---|---|---|---|
| `fuhrpark` | – (Ausnahme möglich) | – (Ausnahme möglich) | – (Ausnahme möglich) | ✔ | ✔ |

- `fuhrpark` steht in **keiner** `GESPERRT`-Liste (Werkstattleiter kann Mitarbeiter/Polier sein). `STANDARD_MATRIX.buero.fuhrpark = gf.fuhrpark = true`; beim Start per Migration in `rolle_recht` ergänzen.
- **€-Felder** im Servicebuch nur mit `preise_sehen` (für Mitarbeiter/Polier weiterhin gesperrt). Ohne Recht fehlen die Felder komplett. `EURO_FELDER` ergänzen um: `kostenJahr`, `kostenGesamt`, `kostenJeStunde` (`kosten`, `verrechnungssatz` sind schon enthalten).

| Aktion | Wer |
|---|---|
| Anlagenliste, Anlagen-Kurzinfo, Status, nächste Termine (ohne €) | alle angemeldeten |
| Zählerstand eintragen | alle angemeldeten (für aktive Anlagen; protokolliert) |
| Mangel melden, eigene Meldungen sehen | alle angemeldeten |
| Servicebuch-Einträge, Plan, Zählerverlauf, alle Mängel lesen (ohne €) | `fuhrpark` **oder** `bericht_erstellen` |
| Fristenliste, Übersicht, Exporte | `fuhrpark` |
| Anlage/Zähler/Plan/Vorlagen anlegen und ändern, Einträge erfassen/stornieren, Mängel bearbeiten, sperren/entsperren, Zählerstände korrigieren | `fuhrpark` |
| Kosten sehen (Eintrag `kosten`, Summen, Kosten je Std.), PDF/CSV „mit Kosten“ | zusätzlich `preise_sehen` |
| Kosten erfassen/ändern | `fuhrpark` **und** `preise_sehen` (ohne `preise_sehen` wird ein mitgesendetes `kosten` mit 400 abgelehnt) |

Protokoll-Arten (neu): `fuhrpark_anlage`, `fuhrpark_zaehler`, `fuhrpark_plan`, `fuhrpark_eintrag`, `fuhrpark_mangel`, `fuhrpark_sperre`. Beträge werden unter dem Schlüssel `kosten` protokolliert, damit das bestehende Säubern (€-Schlüssel entfernen) greift.

## 3. Datenmodell (Migration: nächste freie Version)

```sql
CREATE TABLE anlage (
  id INTEGER PRIMARY KEY,
  nummer TEXT UNIQUE,                       -- interne Nr., z. B. "A17"
  bezeichnung TEXT NOT NULL,                -- "Kettenbagger CAT 320"
  klasse TEXT NOT NULL CHECK (klasse IN ('pkw','bus','lkw','anhaenger','baumaschine','walze','brecher','kleingeraet','sonstiges')),
  fahrzeugklasse TEXT,                      -- EG-Klasse: M1, M2, M3, N1, N2, N3, O1..O4 (für §57a-Vorlagen)
  hersteller TEXT, typ TEXT,
  kennzeichen TEXT, fin TEXT,               -- FIN bzw. Seriennummer
  baujahr INTEGER, erstzulassung TEXT,      -- YYYY-MM-DD (für §57a nur Monat relevant)
  hzg_kg INTEGER,                           -- höchstzulässiges Gesamtgewicht
  eigentum TEXT NOT NULL DEFAULT 'eigen' CHECK (eigentum IN ('eigen','leasing','miete')),
  vertragsende TEXT,                        -- Leasing-/Mietende
  versicherung TEXT,                        -- Polizze/Versicherer (Text)
  geraet_id INTEGER REFERENCES geraet(id),  -- Gerätetyp der Papiervorlage (Stunden aus Bautagesbericht)
  verantwortlich_id INTEGER REFERENCES benutzer(id),  -- Fahrer/Maschinist (Zählerabfrage)
  standort_baustelle_id INTEGER REFERENCES baustelle(id), -- NULL = Bauhof/unbekannt
  standort_text TEXT,                       -- "Bauhof Breitenau"
  gesperrt INTEGER NOT NULL DEFAULT 0,      -- manuelle Sperre
  sperr_grund TEXT, gesperrt_seit TEXT, gesperrt_von INTEGER REFERENCES benutzer(id),
  ausgeschieden TEXT,                       -- Datum Verkauf/Verschrottung (dann inaktiv)
  notiz TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  erstellt TEXT NOT NULL
);
CREATE INDEX anlage_geraet ON anlage(geraet_id);

CREATE TABLE zaehler (
  id INTEGER PRIMARY KEY,
  anlage_id INTEGER NOT NULL REFERENCES anlage(id),
  art TEXT NOT NULL CHECK (art IN ('km','bh','brecher','kran','hub')),
  startstand REAL NOT NULL DEFAULT 0,       -- Stand bei Erfassung
  startdatum TEXT NOT NULL,
  versatz REAL NOT NULL DEFAULT 0,          -- Summe aus Zählertausch (Anzeige + versatz = Gesamtstand)
  aus_bericht INTEGER NOT NULL DEFAULT 0,   -- 1 = Gerätestunden aus Bautagesbericht schätzen (nur art bh/brecher)
  aktiv INTEGER NOT NULL DEFAULT 1,
  UNIQUE (anlage_id, art)
);

CREATE TABLE zaehlerstand (
  id INTEGER PRIMARY KEY,
  zaehler_id INTEGER NOT NULL REFERENCES zaehler(id),
  datum TEXT NOT NULL,                      -- YYYY-MM-DD (gilt als Stand am Tagesende)
  anzeige REAL NOT NULL,                    -- abgelesener Wert
  wert REAL NOT NULL,                       -- Gesamtstand = anzeige + versatz zum Zeitpunkt
  quelle TEXT NOT NULL CHECK (quelle IN ('manuell','eintrag','korrektur','tausch_alt','tausch_neu','start')),
  status TEXT NOT NULL DEFAULT 'gueltig' CHECK (status IN ('gueltig','unplausibel','ungueltig')),
  hinweis TEXT,                             -- Plausibilitätshinweis
  eintrag_id INTEGER REFERENCES servicebuch_eintrag(id),
  erfasst TEXT NOT NULL, erfasst_von INTEGER REFERENCES benutzer(id),
  grund TEXT                                -- Pflicht bei korrektur/ungueltig/tausch
);
CREATE INDEX zaehlerstand_z ON zaehlerstand(zaehler_id, datum);

CREATE TABLE plan_vorlage (
  id INTEGER PRIMARY KEY,
  schluessel TEXT NOT NULL UNIQUE,          -- "57a_lkw"
  titel TEXT NOT NULL,
  art TEXT NOT NULL CHECK (art IN ('gesetzlich','hersteller','intern','vertrag')),
  klassen TEXT NOT NULL,                    -- JSON-Liste Klassen/Fahrzeugklassen, z. B. ["lkw:N2","lkw:N3","bus:M2"]
  regel TEXT NOT NULL,                      -- JSON, siehe 5.1
  rechtsgrundlage TEXT, quelle_url TEXT,
  pruefen INTEGER NOT NULL DEFAULT 1,       -- "Prüfen"-Kennzeichen
  gueltig_ab TEXT, aktiv INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE planposition (
  id INTEGER PRIMARY KEY,
  anlage_id INTEGER NOT NULL REFERENCES anlage(id),
  vorlage_id INTEGER REFERENCES plan_vorlage(id),
  titel TEXT NOT NULL,
  art TEXT NOT NULL CHECK (art IN ('gesetzlich','hersteller','intern','vertrag')),
  regel TEXT NOT NULL,                      -- JSON, siehe 5.1 (Kopie der Vorlage, danach je Anlage änderbar)
  letzte_datum TEXT,                        -- letzte Durchführung (Startwert bei Erfassung oder aus Eintrag)
  letzte_zaehler TEXT,                      -- JSON {"bh":4000,"km":null}
  letzte_eintrag_id INTEGER REFERENCES servicebuch_eintrag(id),
  aktiv INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE servicebuch_eintrag (
  id INTEGER PRIMARY KEY,
  anlage_id INTEGER NOT NULL REFERENCES anlage(id),
  art TEXT NOT NULL CHECK (art IN ('service','reparatur','pruefung','reifen','sonstiges')),
  datum TEXT NOT NULL,
  werkstatt TEXT NOT NULL,                  -- "intern" oder Firmenname
  titel TEXT NOT NULL,                      -- Kurztext
  arbeiten TEXT, teile TEXT,
  arbeitsstunden_intern REAL,
  kosten REAL,                              -- netto €, nur mit preise_sehen
  rechnung_nr TEXT,
  pruef_ergebnis TEXT CHECK (pruef_ergebnis IN ('ohne_maengel','leichte_maengel','schwere_maengel')),
  pruefer TEXT,                             -- Prüfer/Prüfstelle
  storniert TEXT, storno_grund TEXT, storno_von INTEGER REFERENCES benutzer(id),
  erfasst TEXT NOT NULL, erfasst_von INTEGER REFERENCES benutzer(id),
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE eintrag_planposition (eintrag_id INTEGER NOT NULL REFERENCES servicebuch_eintrag(id), planposition_id INTEGER NOT NULL REFERENCES planposition(id), PRIMARY KEY (eintrag_id, planposition_id));

CREATE TABLE mangel (
  id INTEGER PRIMARY KEY,
  anlage_id INTEGER NOT NULL REFERENCES anlage(id),
  text TEXT NOT NULL,
  dringlichkeit TEXT NOT NULL CHECK (dringlichkeit IN ('hinweis','bald','sofort')),  -- sofort = sofort stilllegen
  status TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','in_arbeit','behoben','verworfen')),
  baustelle_id INTEGER REFERENCES baustelle(id),
  gemeldet TEXT NOT NULL, gemeldet_von INTEGER NOT NULL REFERENCES benutzer(id),
  bearbeitet TEXT, bearbeitet_von INTEGER REFERENCES benutzer(id), notiz TEXT,
  eintrag_id INTEGER REFERENCES servicebuch_eintrag(id)
);

ALTER TABLE bericht_geraet ADD COLUMN anlage_id INTEGER REFERENCES anlage(id);   -- optional, s. 7
```

`benachrichtigung.typ` um `'fuhrpark'` erweitern (Tabelle wie in den bisherigen Migrationen neu aufbauen, da SQLite den CHECK nicht ändern kann). Protokoll-Trigger (unveränderbar) gelten unverändert.

## 4. Zählerstände

### 4.1 Aktueller Stand
- **Letzter echter Stand** `R` = jüngster `zaehlerstand` mit `status='gueltig'` (bei gleichem Datum: höchste id). Fehlt er: `startstand` am `startdatum`.
- **Schätzung** (nur `aus_bericht=1`, Arten `bh`/`brecher`): `aktuell = R.wert + Σ bericht_geraet.stunden` aller Berichte mit Status `unterschrieben` oder `freigegeben`, `datum > R.datum`, die **dieser Anlage zugerechnet** sind (Regel 7.1). Ein Ablesewert gilt als Stand am **Tagesende** (Berichte desselben Tages zählen nicht dazu).
- Antwortfelder je Zähler: `{id, art, einheit:"km"|"Std.", aktuell, geschaetzt:bool, letzterStand:{wert, anzeige, datum, quelle}, wochenschnitt, schnittQuelle:"ablesung"|"bericht"|null}`.

### 4.2 Plausibilität beim Eintragen (`POST /fuhrpark/zaehlerstaende`)
1. `datum` nicht in der Zukunft, höchstens 62 Tage zurück (Korrektur durch `fuhrpark`: beliebig).
2. `wert = anzeige + versatz`. Vorgänger `P` = letzter gültiger Stand mit `datum ≤ neu.datum`, Nachfolger `N` = erster gültiger mit `datum > neu.datum`.
3. `wert < P.wert` oder `N && wert > N.wert` → **400** `„Zählerstand kleiner als am 03.11.2026 (4.150 Std.) – bei Zählertausch bitte das Büro verständigen.“` (Büro: Korrektur bzw. Zählertausch, 4.4).
4. `tage = max(1, neu.datum − P.datum)`, `zuwachsJeTag = (wert − P.wert)/tage`. Unplausibel, wenn `bh`/`brecher`/`kran` > **24** je Tag, `hub` > **2.000** je Tag, `km` > **1.500** (Klasse `lkw`) bzw. > **1.200** (sonst). Dann gespeichert mit `status:'unplausibel'`, `hinweis`, Antwort **201** mit `warnung`, Benachrichtigung an `fuhrpark`. Unplausible Stände zählen nicht für Schätzung/Prognose/Fälligkeit, bis `fuhrpark` sie bestätigt (`PUT …` `status:'gueltig'`) oder verwirft (`'ungueltig'`).
5. Abgleich Bericht (nur `aus_bericht=1`): `S = Σ Berichtsstunden` zwischen `P.datum` (exkl.) und `neu.datum` (inkl.). Wenn `S ≥ 30` und `(wert−P.wert)/S < 0.5` oder `> 2` → `hinweis` „Abgelesen +12 Std., laut Bautagesberichten +41 Std. – Gerätestunden prüfen“ (Status bleibt `gueltig`).
6. Gleicher Zähler, gleiches Datum, gleiche Anzeige → 200 (idempotent, kein Duplikat).

### 4.3 Wochenschnitt und Prognose
- Fenster: gültige echte Stände der letzten **56 Tage** plus der letzte Stand davor. `A` = ältester, `B` = jüngster im Fenster; wenn `B.datum − A.datum ≥ 14` Tage: `wochenschnitt = (B.wert − A.wert) / Tage × 7` (1 Nachkommastelle), `schnittQuelle:"ablesung"`.
- Sonst (nur `aus_bericht=1`): Σ Berichtsstunden der letzten 56 Tage ÷ 8 → `schnittQuelle:"bericht"`. Sonst `null`.
- `prognose(rest)`: `rest ≤ 0` → heute; `wochenschnitt > 0` → `heute + ceil(rest / (wochenschnitt/7))` Tage; sonst `null`.

### 4.4 Korrektur und Zählertausch (`fuhrpark`)
- `PUT /fuhrpark/zaehlerstaende/:id` `{status?:"gueltig"|"ungueltig", anzeige?, grund}` → Korrektur (Quelle bleibt, `grund` Pflicht, Protokoll). Ein geänderter Wert muss Regel 4.2/3 erfüllen.
- `POST /fuhrpark/zaehler/:zid/tausch` `{datum, endstandAlt, startstandNeu, grund}` → legt `tausch_alt` (anzeige `endstandAlt`) und `tausch_neu` (anzeige `startstandNeu`) an; `versatz += endstandAlt − startstandNeu`. Der Gesamtstand `wert` läuft stetig weiter; die Oberfläche zeigt `anzeige` (Ablesewert am Gerät).

## 5. Planpositionen und Fälligkeit

### 5.1 Regel (JSON in `plan_vorlage.regel` / `planposition.regel`)
Die Kommentare (`//`) dienen nur der Erklärung; gespeichert wird reines JSON ohne leere Felder.
```json
{
  "intervallMonate": 12,          // ODER
  "intervallTage": 90,            // ODER
  "folgeMonate": [36, 24, 12],    // §57a: Abstände ab Erstzulassung, letzter Wert wiederholt sich
  "jaehrlichAm": "10-31",         // fixer Stichtag MM-DD (z. B. Winterausrüstung)
  "einmaligAm": "2028-06-30",     // einmalige Frist (Leasingende, Garantieende)
  "monatsgenau": true,            // Fälligkeit = ganzer Begutachtungsmonat (§57a)
  "toleranzVorMonate": 1,         // nur monatsgenau: frühestens so viele Monate vorher
  "toleranzNachMonate": 4,        // Spielraum nach Fälligkeit bis "überfällig"
  "toleranzNachTage": 14,         // Standard, wenn toleranzNachMonate fehlt
  "intervallStunden": 500, "zaehlerArtStunden": "bh",  // bh | brecher | kran | hub
  "intervallKm": 30000,
  "vorlaufTage": 90,              // Standard 90 (= 3 Monate)
  "vorlaufStunden": 50, "vorlaufKm": 2000,
  "sperrtBeiUeberfaellig": false,
  "schliesstEin": ["cat_250"]     // beim Erledigen werden diese Vorlagen-Positionen der Anlage mit erledigt
}
```
Gültig sind Kombinationen aus **einem** Datumskriterium (`intervallMonate` | `intervallTage` | `folgeMonate` | `jaehrlichAm` | `einmaligAm`, optional) und Zählerkriterien (`intervallStunden`, `intervallKm`, optional). Mindestens ein Kriterium ist Pflicht (400).

### 5.2 Exakte Fälligkeitsrechnung (heute = `H`, Europe/Vienna)
Hilfsfunktionen: `plusMonate(d, n)` = Kalendermonat addieren, Tag auf Monatsende begrenzen (31.01. + 1 = 28./29.02.); `monat(d)` = `YYYY-MM`; `ersterTag(m)`, `letzterTag(m)`.

**A) Datumskriterium → `faelligAm`, `spaetestens`, `fruehestens`**
1. `folgeMonate` (immer `monatsgenau`): `EZ = monat(anlage.erstzulassung)` (Pflicht, sonst Position `status:"unvollstaendig"`). Termine `S1 = EZ + f1`, `Sk = S(k−1) + f(k)` (für k > Länge: letzter Wert). `L = monat(letzte_datum)` (oder leer).
   - `S` = erstes `Sk` mit `Sk − toleranzVorMonate > L` (ohne `L`: erstes `Sk` mit `Sk + toleranzNachMonate ≥ monat(H)`).
   - `faelligAm = ersterTag(S)`, `fruehestens = ersterTag(S − toleranzVorMonate)`, `spaetestens = letzterTag(S + toleranzNachMonate)`.
   - Eine Durchführung innerhalb des Fensters verschiebt den Rhythmus **nicht** (der nächste Termin ist wieder ein `Sk`).
2. `intervallMonate`/`intervallTage`: `basis = letzte_datum ?? erstzulassung ?? zaehler.startdatum ?? anlage.erstellt`; `faelligAm = basis + Intervall` (bei `monatsgenau`: `ersterTag(monat(...))`); `spaetestens = plusMonate(faelligAm, toleranzNachMonate)` bzw. `faelligAm + toleranzNachTage` (bei `monatsgenau`: `letzterTag(...)`).
3. `jaehrlichAm`: `faelligAm` = erstes Datum `D` mit Monat-Tag = Stichtag und `D − vorlaufEff > letzte_datum` (eine Durchführung im Vorlauf-Fenster gilt für diesen Stichtag; ohne `letzte_datum`: erstes `D ≥ H − toleranzNachTage`); `spaetestens = faelligAm + toleranzNachTage`.
4. `einmaligAm`: `faelligAm = einmaligAm`; nach Erledigung `status:"erledigt"`.
5. **Vorlauf (effektiv):** `vorlaufEff = min(vorlaufTage, floor(intervallDauerTage / 3))`. `intervallDauerTage` = aktueller Abstand (`f(k)`, `intervallMonate` bzw. `intervallTage`) × 30,44 bzw. Tage; bei `jaehrlichAm` 365; bei `einmaligAm` = `vorlaufTage`.
6. **Status Datum:** `H > spaetestens` → `ueberfaellig`; `H ≥ faelligAm` → `faellig`; `H ≥ faelligAm − vorlaufEff` → `bald`; sonst `ok`.

**B) Zählerkriterium (je `intervallStunden` / `intervallKm`) → `faelligBei`, `rest`, `prognoseAm`**
1. `basisStand = letzte_zaehler[art] ?? (Stand am letzte_datum) ?? zaehler.startstand`.
2. `faelligBei = basisStand + intervall`; `rest = faelligBei − aktuell` (4.1, inkl. Schätzung).
3. `prognoseAm = prognose(rest)` (4.3); `vorlaufEffTage = min(vorlaufTage, floor((intervall / (wochenschnitt/7)) / 3))` (ohne Schnitt: nur Stunden-/km-Vorlauf).
4. **Status Zähler:** `rest < −0,1 × intervall` → `ueberfaellig`; `rest ≤ 0` → `faellig`; `rest ≤ vorlaufStunden|vorlaufKm` **oder** (`prognoseAm` und `prognoseAm ≤ H + vorlaufEffTage`) → `bald`; sonst `ok`.
5. Ohne Zähler der Art an der Anlage → Position `status:"unvollstaendig"` mit Hinweis.

**C) Zusammenführen („was zuerst eintritt“)**
- `status` = schlechtester Teilstatus (`ueberfaellig` > `faellig` > `bald` > `ok`); `naechstesDatum = min(faelligAm, prognoseAm)` (vorhandene); `grund` = Kriterium mit dem schlechtesten Status bzw. frühesten Datum („Datum“, „Betriebsstunden“, „Kilometer“).
- **Erledigen:** Ein Eintrag mit `planpositionIds` setzt je Position `letzte_datum = eintrag.datum`, `letzte_zaehler` = im Eintrag erfasste Stände (fehlt ein benötigter Stand → 400 „Betriebsstundenstand fehlt“), `letzte_eintrag_id`. Positionen aus `schliesstEin` derselben Anlage werden mit erledigt. Storno eines Eintrags stellt den vorherigen Stand wieder her (Rechnung aus dem jüngsten nicht stornierten Eintrag bzw. Startwert).

**D) Anlagenstatus** (`status` in Listen):
1. `ausgeschieden` gesetzt → `ausgeschieden`.
2. `gesperrt=1` **oder** offener Mangel mit `dringlichkeit:'sofort'` (Status `offen`/`in_arbeit`) **oder** eine Position mit `sperrtBeiUeberfaellig` und Status `ueberfaellig` → `gesperrt` (mit `sperrGruende:[…]`).
3. sonst schlechtester Positionsstatus: `ueberfaellig`/`faellig` → `faellig`, `bald` → `bald`, sonst `einsatzbereit`. `ampel`: `gruen` | `gelb` | `rot` (gesperrt und fällig = rot, gesperrt zusätzlich `gesperrt:true`).

### 5.3 Rechenbeispiele (verbindlich als Unit-Tests, `H = 2026-11-13`)
| # | Fall | Ergebnis |
|---|---|---|
| 1 | M1, EZ 2023-12-05, `folgeMonate [36,24,12]`, vor 1/nach 4, keine Durchführung | S = 2026-12 → `faelligAm 2026-12-01`, `fruehestens 2026-11-01`, `spaetestens 2027-04-30`; vorlaufEff 90 → **bald** |
| 2 | M1, EZ 2020-09-10, letzte Begutachtung 2025-09-15 | Termine 2023-09, 2025-09, 2026-09 …; S = 2026-09 (2026-08 > 2025-09) → `spaetestens 2027-01-31` → **faellig** (in Toleranz) |
| 3 | N3, EZ 2021-10-01, `folgeMonate [12]`, vor 3/nach 0, letzte 2025-10-08, sperrt | S = 2026-10, `spaetestens 2026-10-31` → **ueberfaellig** → Anlage **gesperrt** |
| 4 | Massenspeicher `intervallTage 90`, letzte 2026-08-25 | `faelligAm 2026-11-23`; vorlaufEff = min(90, 30) = 30 → **bald** |
| 5 | Ladekran `intervallMonate 12`, `toleranzNachMonate 3`, letzte 2025-10-02 | `faelligAm 2026-10-02`, `spaetestens 2027-01-02` → **faellig** |
| 6 | CAT 320: `intervallStunden 500`, letzte bei 4.000 Std.; echter Stand 4.150 am 2026-11-06, danach 30 Berichtsstunden; Schnitt 22,0 Std./Woche | aktuell 4.180, rest 320, `prognoseAm 2027-02-23`, vorlaufEffTage min(90, 53) = 53 → **ok** |
| 7 | wie 6, aktuell 4.460 | rest 40 ≤ 50 → **bald** |
| 8 | PKW Service `intervallMonate 12` + `intervallKm 30000`; letzte 2026-03-01 bei 84.000 km; aktuell 112.500 km | km: rest 1.500 ≤ 2.000 → bald; Datum: 2027-03-01 → ok ⇒ **bald**, grund „Kilometer“ |
| 9 | Winterausrüstung `jaehrlichAm "10-31"`, vorlauf 30, letzte 2025-10-20 | 2025-10-31 entfällt (01.10.2025 liegt nicht nach 20.10.2025) → `faelligAm 2026-10-31`, `spaetestens 2026-11-14` → **faellig** |
| 10 | Zählerstand 4.100 nach 4.150 | 400 |
| 11 | +60 Std. in 2 Tagen (bh) | 201, `status:'unplausibel'` |

## 6. Erinnerungen

- **Prüflauf** `pruefeFuhrpark(db, H)`: beim Serverstart, stündlich (`setInterval`, `unref()`), nach jedem Zählerstand, Eintrag, Plan-/Anlagenänderung, Mangel und nach Unterschrift/Freigabe eines Berichts mit Gerätestunden.
- Je Position und Fälligkeits-**Zyklus** (`zyklus` = `faelligAm` bzw. `faelligBei`, z. B. `"2027-03"` oder `"bh4500"`) und Stufe (`bald`, `faellig`, `ueberfaellig`) **genau eine** Benachrichtigung je Empfänger: `typ:'fuhrpark'`, `schluessel = "fp:<planpositionId>:<zyklus>:<stufe>"` (UNIQUE verhindert Doppelte). Mehrere Stufen auf einmal → nur die höchste.
- **Empfänger** (nie €-Werte im Text):
  - alle aktiven Benutzer mit `fuhrpark`: alle Stufen;
  - `verantwortlich_id` der Anlage: alle Stufen;
  - Stufe `ueberfaellig` bei sperrender Position bzw. Anlage wird `gesperrt`: zusätzlich Polier und Bauleiter der `standort_baustelle_id`.
- **Texte:** Titel „Service bald: Kettenbagger CAT 320“, Text „500-Std.-Service bei 4.500 Std. – Stand ≈ 4.460 (geschätzt), voraussichtlich 27.11.2026“. Pickerl: „§57a-Begutachtung LKW NK-303 BP: Begutachtungsmonat Oktober 2026 – überfällig seit 01.11.2026, Fahrzeug gesperrt“.
- **Wochen-Zusammenfassung:** montags beim ersten Prüflauf ab 06:00 Wien an `fuhrpark`-Benutzer: „Fuhrpark KW 47: 2 überfällig, 1 gesperrt, 6 in den nächsten 3 Monaten“, `schluessel "fp:woche:<JJJJ-KW>"`.
- **Zählerabfrage:** Für `verantwortlich_id` mit Zählern `km`/`bh`, deren letzter echter Stand älter als **7 Tage** ist: montags Benachrichtigung „Bitte Kilometerstand eintragen: LKW NK-301 BP“ (`schluessel "fp:zaehler:<anlageId>:<KW>"`) und Feld `zaehlerAbfrage` in der Antwort von `POST /zeit/stempeln` mit `typ:"gehen"` (7.3).
- **Mangel:** neue Meldung → Benachrichtigung an `fuhrpark` (bei `sofort` Titel „Gerät stillgelegt: …“) und, wenn die Anlage dadurch gesperrt wird, an Polier/Bauleiter des Standorts.
- E-Mail/Push: wie `API.md` – Integration „nicht angebunden“; nur In-App.

## 7. Verknüpfung mit Bautagesbericht und Stempeln (additiv)

### 7.1 Zurechnung der Gerätestunden
- `bericht_geraet.anlage_id` gesetzt → Stunden gehören dieser Anlage.
- `anlage_id` leer und **genau eine** aktive Anlage mit diesem `geraet_id` → automatisch dieser.
- sonst **nicht zugeordnet** → erscheint in `GET /fuhrpark/uebersicht` als `nichtZugeordnet:[{geraetId, name, stunden, berichte}]` (letzte 90 Tage).
- Standort: `standort_baustelle_id` = Baustelle des jüngsten Berichts (Status ≠ entwurf), dem die Anlage zugerechnet ist, außer das Büro hat danach händisch einen Standort gesetzt (jüngeres Datum gewinnt).

### 7.2 Bericht
- `GET /geraete` je Gerät zusätzlich `anlagen:[{id, nummer, bezeichnung, kennzeichen, status, gesperrt}]` (nur aktive; ohne €).
- `GET /berichte/:id` → `geraete[]` zusätzlich `anlageId?`, `anlage?:{id, bezeichnung, kennzeichen, status}`.
- `PUT /berichte/:id` → `geraete[]` darf `anlageId` enthalten; muss zum `geraetId` gehören und aktiv sein (sonst 400). Die Antwort enthält zusätzlich `hinweise:[{typ:"anlage_gesperrt", anlageId, text:"Radlader CASE 721 ist gesperrt seit 10.11.2026: Hydraulikschlauch undicht"}]`. Speichern wird **nicht** verhindert; einmalige Benachrichtigung an `fuhrpark` (`schluessel "fp:gesperrt-genutzt:<anlageId>:<berichtId>"`).
- Oberfläche: Bei mehreren Anlagen je Gerät Auswahl-Chips (vorbelegt: zuletzt auf dieser Baustelle verwendet); gesperrte Anlage mit Schloss-Symbol und Warnhinweis.

### 7.3 Stempeln
`POST /zeit/stempeln` mit `typ:"gehen"` → zusätzlich `zaehlerAbfrage:[{anlageId, bezeichnung, kennzeichen, zaehler:[{id, art, einheit, letzterStand, letzterDatum}]}]` (leer, wenn nichts fällig). Die Oberfläche zeigt danach einen Dialog „Kilometerstand eintragen?“ (überspringbar).

## 8. Endpunkte (Präfix `/api/fuhrpark`)

### Anlagen
- `GET /anlagen?klasse&status&standort&suche&inaktiv=1` → `[{id, nummer, bezeichnung, klasse, fahrzeugklasse, kennzeichen, geraetId, geraet?:{code,name}, standort:{baustelleId?, kst?, text}, verantwortlich?:{id,name}, status, ampel, gesperrt, sperrGruende:[…], naechsterTermin?:{titel, datum, status, grund}, zaehler:[{art, einheit, aktuell, geschaetzt}], offeneMaengel, kostenJahr?}]` (`kostenJahr` = Σ Kosten laufendes Jahr, nur `preise_sehen`). Sortierung: gesperrt, fällig, bald, dann Bezeichnung.
- `GET /anlagen/:id` → Liste-Felder + `{hersteller, typ, fin, baujahr, erstzulassung, hzgKg, eigentum, vertragsende, versicherung, notiz, ausgeschieden, version, plan:[Planposition], zaehler:[Zähler 4.1], maengel:[offene], letzteEintraege:[5], kostenGesamt?, kostenJeStunde?, verrechnungssatz?}`
  - `kostenJeStunde` = Σ Kosten der letzten 365 Tage ÷ Zuwachs `bh` im selben Zeitraum (nur wenn ≥ 50 Std.); `verrechnungssatz` = Satz des verknüpften Geräts; beides nur `preise_sehen`.
- `POST /anlagen` (`fuhrpark`) `{bezeichnung, klasse, …, zaehler:[{art, startstand, startdatum, ausBericht}], vorlagen?:[schluessel]}` → 201 Anlage; ohne `vorlagen` werden die zur Klasse/Fahrzeugklasse passenden Vorlagen vorgeschlagen (nicht angelegt; Antwort `vorlagenVorschlag`).
- `PUT /anlagen/:id` (`fuhrpark`) `{version, …Felder}`; Kennzeichen/FIN/Nummer eindeutig unter aktiven Anlagen (409).
- `POST /anlagen/:id/sperre` (`fuhrpark`) `{gesperrt:true|false, grund}` → Anlage; Protokoll `fuhrpark_sperre`.
- `POST /anlagen/:id/ausscheiden` (`fuhrpark`) `{datum, grund}`; Servicebuch bleibt lesbar.

### Zähler
- `POST /anlagen/:id/zaehler` (`fuhrpark`) `{art, startstand, startdatum, ausBericht}`; `PUT /zaehler/:zid` `{aktiv?, ausBericht?}`.
- `GET /zaehler/:zid/verlauf?von&bis` (Leserecht Servicebuch) → `{zaehler, punkte:[{datum, wert, anzeige, quelle, status, erfasstVon}], schaetzung:[{datum, wert}] (Tagesreihe aus Berichten ab letztem echten Stand), wochenschnitt, schnittQuelle}`.
- `POST /zaehlerstaende` (alle) `{anlageId, art, anzeige, datum?, notiz?}` → 201 `{stand, warnung?, hinweis?}` (Regeln 4.2).
- `PUT /zaehlerstaende/:id` (`fuhrpark`), `POST /zaehler/:zid/tausch` (`fuhrpark`) – 4.4.
- `GET /zaehlerabfrage` (eigene) → wie 7.3.

### Plan und Vorlagen
- `GET /vorlagen` (Leserecht Servicebuch) → `[{id, schluessel, titel, art, klassen, regel, rechtsgrundlage, quelleUrl, pruefen, gueltigAb, aktiv, version}]`.
- `POST /vorlagen`, `PUT /vorlagen/:id` (`fuhrpark`, `version`). Änderungen wirken **nicht** rückwirkend; `POST /vorlagen/:id/anwenden` `{anlageIds?:[…], vorschau?:true}` überschreibt die `regel` der aus dieser Vorlage stammenden Positionen (Vorschau listet Änderungen der Fälligkeit).
- `GET /anlagen/:id/plan` → `[Planposition]`, Planposition = `{id, titel, art, vorlage?:{schluessel,pruefen}, regel, letzteDatum, letzteZaehler, status, ampel, grund, faelligAm?, fruehestens?, spaetestens?, faelligBei?:{art, wert}, rest?:{art, wert}, prognoseAm?, naechstesDatum?, aktiv, version}`
- `POST /anlagen/:id/plan` (`fuhrpark`) `{vorlageSchluessel}` **oder** `{titel, art, regel}`, optional `{letzteDatum, letzteZaehler}` (Startwerte aus den Papieren).
- `PUT /anlagen/:id/plan/:pid` (`fuhrpark`) `{version, titel?, regel?, letzteDatum?, letzteZaehler?, aktiv?}` – händisches Setzen von `letzteDatum` nur mit `grund` (Protokoll).
- `DELETE /anlagen/:id/plan/:pid` (`fuhrpark`) → deaktivieren (`aktiv:0`).

### Servicebuch-Einträge
- `GET /eintraege?anlageId&von&bis&art` (Leserecht Servicebuch) → `[{id, anlageId, anlage:{bezeichnung,kennzeichen}, art, datum, werkstatt, titel, arbeiten, teile, arbeitsstundenIntern, kosten?, rechnungNr, pruefErgebnis, pruefer, zaehler:[{art, anzeige, wert}], erledigt:[{planpositionId, titel}], maengel:[ids], storniert?, erfasst, erfasstVon, version}]`
- `POST /eintraege` (`fuhrpark`) `{anlageId, art, datum, werkstatt, titel, arbeiten?, teile?, arbeitsstundenIntern?, kosten?, rechnungNr?, pruefErgebnis?, pruefer?, zaehler:[{art, anzeige}], planpositionIds?:[…], maengelIds?:[…]}` → 201.
  - `zaehler` **Pflicht** für jede aktive Zählerart der Anlage (400 „Kilometerstand fehlt“); jeder Stand wird als `zaehlerstand` mit Quelle `eintrag` gespeichert (Regeln 4.2; ein kleinerer Stand als zuletzt → 400).
  - `datum` nicht in der Zukunft. `pruefErgebnis` nur bei Art `pruefung`. `schwere_maengel` → Anlage wird **gesperrt** (Grund „Prüfung mit schweren Mängeln“) bis zur Entsperrung.
  - verknüpfte `maengelIds` → Status `behoben`.
- `PUT /eintraege/:id` (`fuhrpark`, `version`) – Texte, Kosten (mit `preise_sehen`), Rechnungsnr.; Datum/Zähler/erledigt nur per Storno + Neuerfassung.
- `POST /eintraege/:id/storno` (`fuhrpark`) `{grund}` → Planpositionen neu berechnet (5.2 C), Zählerstände des Eintrags `ungueltig`.

### Mängel
- `GET /maengel?anlageId&status` → mit Leserecht Servicebuch: alle; sonst nur eigene Meldungen. `[{id, anlageId, anlage:{bezeichnung,kennzeichen}, text, dringlichkeit, status, baustelleId?, gemeldet, gemeldetVon:{id,name}, bearbeitet?, notiz?, eintragId?}]`
- `POST /maengel` (alle) `{anlageId, text (3–1000 Zeichen), dringlichkeit, baustelleId?}` → 201; bei `sofort` ist die Anlage sofort `gesperrt` (5.2 D).
- `PUT /maengel/:id` (`fuhrpark`) `{status, notiz?, eintragId?}`; `verworfen` verlangt `notiz`.

### Übersicht und Exporte (`fuhrpark`)
- `GET /uebersicht` → `{anzahl:{einsatzbereit, bald, faellig, gesperrt, ausgeschieden}, ueberfaellig:[…Positionen mit Anlage], naechsteTermine:[…90 Tage], offeneMaengel, unplausibleStaende, nichtZugeordnet:[…], kostenJahr?}`
- `GET /fristen?bis=YYYY-MM-DD&klasse&art` (Standard: heute + 6 Monate) → `[{anlageId, anlage:{bezeichnung,kennzeichen,klasse}, planpositionId, titel, art, status, naechstesDatum, faelligAm?, spaetestens?, prognoseAm?, faelligBei?, rest?, grund, pruefen}]` sortiert nach `naechstesDatum` (überfällige zuerst).
- `GET /export.csv?art=fristen|eintraege|anlagen&von&bis` → CSV (Semikolon, UTF-8 mit BOM); Spalte „Kosten netto“ nur mit `preise_sehen`.
- `GET /anlagen/:id/servicebuch.pdf?kosten=1` → PDF (pdfkit): Kopf (Firma, Anlage, Kennzeichen, FIN, Erstzulassung, Stand), Fristenübersicht, Zählerstände, alle Einträge chronologisch, offene Mängel; **ohne €**, Kosten nur mit `kosten=1` **und** `preise_sehen` (sonst 403).

## 9. Vorlagen (Seed in `einrichten.js` und Demo; alle `pruefen:true`)

| schluessel | Titel | Klassen | Regel | sperrt | Grundlage / Hinweis |
|---|---|---|---|---|---|
| `57a_m1` | §57a-Begutachtung (Pickerl) | pkw:M1, bus:M1, anhaenger:O1/O2, lkw:N1 (Prüfen) | `folgeMonate [36,24,12]`, monatsgenau, vor 1, nach 4 | ja | § 57a KFG, derzeitige Regel |
| `57a_m1_2027` | §57a-Begutachtung ab 19.05.2027 | pkw:M1, bus:M1 | `folgeMonate [48,24,24,24,12]`, monatsgenau, vor 4, nach 0 | ja | 42. KFG-Novelle, BGBl. I 79/2026 – **inaktiv**, `gueltigAb 2027-05-19`; nach Prüfung mit „Vorlage anwenden“ aktivieren |
| `57a_jaehrlich` | §57a-Begutachtung jährlich | lkw:N2/N3, bus:M2/M3, anhaenger:O3/O4 | `folgeMonate [12]`, monatsgenau, vor 3, nach 0 | ja | § 57a KFG; Toleranz laut Quellen nur vorher |
| `tacho_nachpruefung` | Fahrtenschreiber-Nachprüfung | lkw:N2/N3, bus:M2/M3 | `intervallMonate 24`, nach 0 Tage | nein | Art. 23 VO (EU) 165/2014 |
| `tacho_massenspeicher` | Massenspeicher auslesen | lkw:N2/N3, bus:M2/M3 | `intervallTage 90`, nach 0 | nein | 90 Tage bzw. 3 Monate (WKO) |
| `kran_amvo` | Kranprüfung (Ladekran) | lkw mit Kran | `intervallMonate 12`, `toleranzNachMonate 3` | ja | § 8 AM-VO: jährlich, längstens 15 Monate; Prüfbefund § 11 |
| `hebezeug_amvo` | Prüfung Hebezeugbetrieb (Bagger/Radlader) | baumaschine | `intervallMonate 12`, `toleranzNachMonate 3` | ja | § 8 AM-VO; nur anlegen, wenn Einzellasten gehoben werden; extern mind. alle 4 Jahre bei interner Prüfung (WKO) |
| `winter_lkw` | Winterausrüstung (Reifen, Ketten) | lkw:N2/N3 | `jaehrlichAm "10-31"`, vorlauf 30 | nein | § 102 KFG: 1.11.–15.4. |
| `verbandkasten` | Verbandkasten prüfen | pkw, bus, lkw | `intervallMonate 12` (intern) | nein | § 102 KFG; kein Ablaufdatum |
| `feuerloescher` | Feuerlöscher überprüfen | lkw, baumaschine, brecher | `intervallMonate 24` | nein | ÖNORM F 1053 (Praxis) |
| `cat_250` / `cat_500` / `cat_1000` / `cat_2000` | Service 250/500/1.000/2.000 Std. | baumaschine, walze | `intervallStunden` 250/500/1000/2000, zusätzlich `intervallMonate 12` bei 500; `schliesstEin` jeweils die kleineren | nein | Herstellerplan (Cat PM1–PM4); an Serviceheft anpassen |
| `service_lkw` | Service laut Serviceheft | lkw | `intervallMonate 12`, `intervallKm 60000` | nein | an Serviceheft anpassen |
| `service_pkw` | Service laut Serviceheft | pkw, bus | `intervallMonate 12`, `intervallKm 30000` | nein | an Serviceheft anpassen |
| `service_brecher` | Service Brecher | brecher | `intervallStunden 250`, `zaehlerArtStunden "brecher"` | nein | Herstellerangabe prüfen |
| `service_klein` | Jahresservice Kleingerät | kleingeraet | `intervallMonate 12` | nein | – |
| `vertrag_leasing` | Leasing-/Mietende | alle | `einmaligAm` = `vertragsende`, vorlauf 90 | nein | – |
| `vertrag_versicherung` | Versicherung Hauptfälligkeit | pkw, bus, lkw, anhaenger | `jaehrlichAm` (je Anlage), vorlauf 90 | nein | – |

## 10. Demo-Fuhrpark (Seed, nur `BAUTAG_DEMO=1`)

Alle Kennzeichen, FIN und Seriennummern **fiktiv** (Bezirk NK = Neunkirchen nur als Muster). Datumsangaben relativ zu „heute“ `H` (Monate `M±n` = Monat von H ± n), damit die Vorführung immer alle Zustände zeigt. Zählerstände: Startstand am `H − 120 Tage`, dazu 3–6 Ablesungen im Abstand von 1–3 Wochen (Wochenschnitt wie angegeben ± 15 %), letzte Ablesung `H − 3…10 Tage`.

| Nr | Anlage | Klasse/FzKl | Gerät (Vorlage) | Kennzeichen | EZ / Bj. | Zähler | Pläne & Demo-Zustand |
|---|---|---|---|---|---|---|---|
| A01 | LKW 3-Achser MAN TGS 26.400 Kipper | lkw/N3 | lkw3 | NK-301 BP | 2018, Monat M+5 | km 412.300 (Schnitt 900/Wo.) | 57a_jaehrlich (ok), service_lkw, tacho_nachpruefung letzte H−22 M (**bald**), tacho_massenspeicher letzte H−80 T (**bald**), winter_lkw (fällig, wenn H im Nov.) |
| A02 | LKW 3-Achser mit Kran MAN TGS 26.440 + Ladekran | lkw/N3 | kran3 | NK-302 BP | 2020, M+1 | km 268.900, kran 3.410 | 57a_jaehrlich (**bald**), kran_amvo letzte H−13 M (**fällig**, in Toleranz) |
| A03 | LKW 4-Achser Scania R 450 Kipper | lkw/N3 | lkw4 | NK-303 BP | 2021, M−1 | km 301.200 | 57a_jaehrlich letzte vor 13 Monaten → **überfällig → gesperrt** |
| A04 | LKW 4-Achser Mulde und Kran Volvo FMX 460 | lkw/N3 | kran4 | NK-304 BP | 2017, M+7 | km 521.700 | kran_amvo letzte H−4 M (ok) |
| A05 | Sattelzugmaschine Mercedes Actros 1848 | lkw/N3 | sattel | NK-305 BP | 2022, M+3 | km 389.000 | 57a_jaehrlich (**bald**, 3 Monate) |
| A06 | Kippsattel Schwarzmüller 3-Achs | anhaenger/O4 | – | NK-306 BP | 2022, M+3 | – | 57a_jaehrlich (**bald**) |
| A07 | Zugmaschine MAN TGX 26.510 (Tieflader) | lkw/N3 | tieflader | NK-307 BP | 2016, M+9 | km 604.300 | ok |
| A08 | Tieflader-Anhänger Goldhofer 3-Achs | anhaenger/O4 | – | NK-308 BP | 2016, M+9 | – | ok |
| A09 | LKW 2-Achser MAN TGL 12.250 Pritsche (falls nicht vorhanden: löschen) | lkw/N2 | lkw2 | NK-309 BP | 2019, M+4 | km 187.400 | ok |
| A10 | Mannschaftsbus VW Crafter 9-Sitzer | bus/M1 | – | NK-311 BP | EZ 3 Jahre vor M+1 | km 98.600 | 57a_m1 erste Begutachtung (**bald**) |
| A11 | Pritschenbus Ford Transit Doppelkabine | bus/N1 | – | NK-312 BP | 2021, M+6 | km 143.900 | 57a_m1 (Prüfen N1), service_pkw (km **bald**) |
| A12 | PKW Škoda Octavia Combi | pkw/M1 | – | NK-321 BP | 2024, M+4 | km 61.200 | 57a_m1 (ok), vertrag_leasing `vertragsende` H+5 M |
| A13 | PKW Dacia Duster | pkw/M1 | – | NK-322 BP | 2020, M−2 | km 118.000 | 57a_m1 Fall „in Toleranz“ (**fällig**) |
| A14 | PKW-Anhänger Humbaur Kipper 2,7 t | anhaenger/O2 | – | NK-331 BP | 2019, M+10 | – | 57a_m1 (ok) |
| A15 | Minibagger Cat 301.8 (1,8 t) | baumaschine | b15 | – | Bj. 2020 | bh 3.120 (10/Wo.) | cat_250/500/1000 (ok) |
| A16 | Minibagger Takeuchi TB230 (3,0 t) | baumaschine | b27 | – | Bj. 2021 | bh 2.870 (14/Wo.) | cat_250 **bald** (rest 30) |
| A17 | Mobilbagger 7–11 t (Liebherr A 910 Compact) | baumaschine | b9 | NK-341 BP | Bj. 2019 | bh 6.410 (24/Wo.) | cat_500/1000, hebezeug_amvo letzte H−10 M (**bald**) |
| A18 | Kettenbagger CAT 320 (23,0 t) | baumaschine | b23 | – | Bj. 2022 | bh 4.180 (22/Wo.) | cat_500 letzte bei 4.000 (Beispiel 5.3/6: ok, Prognose ~3 Monate) |
| A19 | Minilader CASE SR160 (3,5 t) | baumaschine | bobcat | – | Bj. 2020 | bh 2.240 | ok |
| A20 | Radlader CASE 721G (2,5 m³) | baumaschine | radlader | NK-342 BP | Bj. 2018 | bh 8.950 | cat_1000 **fällig** (rest −20) |
| A21 | Radlader CAT 950M (3,5 m³) | baumaschine | radlader | NK-343 BP | Bj. 2021 | bh 5.300 | ok – **zweiter Radlader** (Zuordnung im Bericht wählen; Demo-Berichte teils ohne Zuordnung → „nicht zugeordnet“) |
| A22 | Walze HAMM HD 12 VV (3,0 t) | walze | hamm | – | Bj. 2019 | bh 1.880 | ok |
| A23 | Walze BOMAG BW 177 D-5 (7,0 t) | walze | bomag | – | Bj. 2017 | bh 4.420 | cat_500 bald |
| A24 | Mobilbrecher Rubble Master RM 100GO! | brecher | – | – | Bj. 2020 | brecher 3.650 (manuell) | service_brecher ok; **Mangel offen** „Gurt Magnetabscheider eingerissen“ (bald) |
| A25 | Rüttelplatte Wacker DPU 6555 | kleingeraet | ruettel | – | Bj. 2019 | bh 1.210 | service_klein ok |
| A26 | Rüttelplatte Bomag BPR 35/60 | kleingeraet | ruettel | – | Bj. 2022 | bh 640 | zweite Rüttelplatte |
| A27 | Grabenwalze Bomag BMP 8500 | kleingeraet | grabenwalze | – | Bj. 2018 | bh 980 | **Mangel „sofort“** (Polier Haidbauer, „Lenkung blockiert“) → **gesperrt** |
| A28 | Schneidgerät Stihl TS 800 | kleingeraet | schneid | – | Bj. 2023 | – | service_klein **fällig** |
| A29 | Kompressor Kaeser M 31 | kleingeraet | kompressor | – | Bj. 2016 | bh 2.050 | ok |
| A30 | Dumper Wacker DW 30 | kleingeraet | dumper | – | Bj. 2019 | bh 1.640 | ok |
| A31 | Verlegemaschine Optimas S10 | kleingeraet | verlege | – | Bj. 2017 | bh 2.980 | cat_500 (an Serviceheft anpassen) ok |
| A32 | Handwalze Bomag BW 55 E | kleingeraet | handwalze | – | Bj. 2020 | – | service_klein ok |

- Gräder: **keine** Anlage (die Demo-Berichtsstunden „Gräder“ erscheinen als „nicht zugeordnet“ – bewusst als Hinweis für das Büro).
- Servicebuch-Einträge: je Anlage 1–4 plausible Einträge der letzten 18 Monate (Service, Reparatur, Pickerl ohne Mängel bzw. mit leichten Mängeln, Kranprüfung durch fiktive Prüfstelle „Prüftechnik Muster GmbH“), Kosten 80–6.500 € netto, Rechnungsnr. `RE-26-0xxx`.
- `verantwortlich_id`: LKW → Mitarbeiter mit Lohngruppe LKW-Fahrer, Baumaschinen → Maschinisten der Partien (Demo-Daten).
- Recht `fuhrpark` per Ausnahme für einen Demo-Polier („Werkstatt“), um die €-Sperre zu zeigen.

## 10a. Oberfläche (je Gerätegröße)

Neue Ansicht `public/js/views/fuhrpark.js` (+ Unteransichten), Einstieg „Geräte“ im Menü (Handy: unter „Mehr“, Tablet/PC: eigener Menüpunkt). Ampel immer mit Symbol + Wort (Barrierefreiheit), Baustellen-Modus wie übrige App.

| Bildschirm | Handy (alle) | Tablet (Polier, Werkstatt) | PC (Büro/GF) |
|---|---|---|---|
| **Geräteliste** | Suche, oben „Meine Fahrzeuge“ (verantwortlich) und „Auf meiner Baustelle“; Karten mit Status-Badge, Kennzeichen, nächster Termin | wie Handy, zweispaltig | Tabelle mit Filtern (Klasse, Status, Standort), Spalten Status, Nr., Bezeichnung, Kennzeichen, Standort, nächster Termin, Zähler, offene Mängel, Kosten Jahr (nur Preisrecht) |
| **Anlage** | großer Status, nächste 3 Termine, Knöpfe „Mangel melden“, „Zählerstand eintragen“ | + Servicebuch-Zeitleiste (ohne €), Plan | Reiter Übersicht · Zähler (Verlaufskurve als SVG, Punkte = Ablesung, gestrichelt = Schätzung) · Plan · Servicebuch · Mängel · Stammdaten |
| **Mangel melden** | 3 Schritte: Gerät (vorgewählt) → Text (Tastatur-Diktat) → Dringlichkeit (3 große Knöpfe, „Sofort stilllegen“ rot mit Bestätigung) | gleich | gleich |
| **Zählerstand** | große Zahleneingabe, letzter Stand und Datum darunter, Warnung bei Unplausibilität vor dem Senden | gleich | + Korrektur, Zählertausch |
| **Zählerabfrage nach Ausstempeln** | Dialog je Fahrzeug, überspringbar | – | – |
| **Eintrag erfassen** (`fuhrpark`) | – | Formular: Art, Datum, Werkstatt, Zählerstände (Pflicht, vorbelegt), erledigte Planpositionen (Checkboxen, fällige vorausgewählt), Arbeiten/Teile, Mängel verknüpfen; Kosten/Rechnungsnr. nur mit Preisrecht | gleich, breiter |
| **Fristen** (`fuhrpark`) | – | Liste | Liste gruppiert nach Monat (3/6/12 Monate), überfällige oben, Stunden-/km-Termine mit „voraussichtlich“ |
| **Übersicht** (`fuhrpark`) | – | Kacheln | Kacheln (einsatzbereit/bald/fällig/gesperrt), überfällig, Mängel, unplausible Stände, nicht zugeordnete Gerätestunden; CSV/PDF-Knöpfe |
| **Vorlagen** (`fuhrpark`) | – | – | Liste mit „Prüfen“-Kennzeichen, Bearbeiten, „Vorlage anwenden“ mit Vorschau |
| **Bautagesbericht – Geräte** | Auswahl der Anlage bei mehreren je Gerät, Schloss-Hinweis bei gesperrt | gleich | gleich |

## 11. Tests (Pflicht)
- **Unit** `tests/unit/fuhrpark-faelligkeit.test.js`: alle Beispiele 5.3, Monatsende-Regel (`plusMonate`), Rhythmus bei vorzeitiger/verspäteter Begutachtung, `schliesstEin`, Storno stellt Fälligkeit wieder her, Prognose ohne Schnitt, Zählertausch (Gesamtstand stetig).
- **API** `tests/api/fuhrpark.test.js`: Rechte (Mitarbeiter/Polier: keine €-Felder in **allen** Fuhrpark-Antworten inkl. Liste, Detail, Einträge, Übersicht, CSV; Polier mit `fuhrpark`-Ausnahme pflegt, sieht aber keine Kosten und darf keine Kosten senden → 400); Mangel `sofort` sperrt sofort; Erinnerungen genau einmal je Stufe/Zyklus; Bericht mit gesperrter Anlage → 200 + `hinweise`; Zurechnung bei einer/mehreren Anlagen je Gerät; `zaehlerAbfrage` beim Ausstempeln; PDF ohne € für Polier.
- **E2E**: Polier meldet Mangel am Handy (3 Tipps), Büro erfasst Eintrag und erledigt Planposition, Status wechselt auf grün.

## 12. Aufwand (Richtwert)
| Teil | Std. |
|---|---|
| Backend: Migration, Fälligkeit/Prognose, Zähler, Routen, Erinnerungen, Bericht-/Stempel-Erweiterung, PDF/CSV, Seed | 70–110 |
| Oberfläche: Liste, Anlage (Reiter, Verlaufskurve), Mangel, Zählerstand, Eintrag, Fristen, Übersicht, Vorlagen, Bericht-Auswahl | 60–100 |
| Tests (Unit, API, E2E) | 20–30 |
| **Summe** | **150–240** |

## 13. Offen / Prüfen (vor Echtbetrieb)
- §57a-Intervalle und Toleranzen (insb. **42. KFG-Novelle ab 19.05.2027**, Einstufung **N1**), Tacho-Download-Fristen und Aufbewahrung, AM-VO-Intervall für Bagger/Radlader im Hebezeugbetrieb, Pflicht für Feuerlöscher in Fahrzeugen – mit Prüfstelle/WKO/AUVA klären; Vorlagen danach `pruefen:false` setzen.
- Herstellerintervalle je Maschine aus den Servicehefte übernehmen (Vorlagen `cat_*`, `service_*` sind Startwerte).
- Belege/Fotos (Rechnung, Prüfbefund) – nach Einführung eines Datei-Uploads (eigener Abschnitt).
- E-Mail-/Push-Erinnerungen – sobald Integration angebunden.
- Optional später: Reparatur einer Baustelle als Fremdleistung zuordnen (Schaden durch Dritte), Hersteller-Telematik (Betriebsstunden automatisch), QR-/NFC-Aufkleber öffnen Anlage/Mangel direkt.
