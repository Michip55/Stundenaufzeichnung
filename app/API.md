# BauTag – Architektur & API-Vertrag (verbindlich für Server und Oberfläche)

Stand: 12.11.2026 · Diese Datei ist der Vertrag zwischen `app/server` (Backend) und `app/public` (Oberfläche).
Änderungen nur additiv; Abweichungen in `app/FORTSCHRITT.md` vermerken.

## 1. Technik

| Teil | Entscheidung |
|---|---|
| Laufzeit | Node.js 22 (CommonJS), **Express 5** |
| Datenbank | **SQLite** über eingebautes `node:sqlite` (`DatabaseSync`), Datei `app/data/bautag.db` (Pfad per `BAUTAG_DB`, `:memory:` für Tests). Später austauschbar gegen PostgreSQL. |
| Passwörter/PIN | `crypto.scrypt` mit Salt, Vergleich mit `timingSafeEqual` |
| Sitzung | Zufalls-Token (32 Byte) in Tabelle `sitzung`, Cookie `bt_session` (HttpOnly, SameSite=Strict, Secure wenn HTTPS), Ablauf 12 h Inaktivität |
| CSRF | SameSite=Strict + alle schreibenden Requests verlangen `Content-Type: application/json` (Formular-POSTs werden abgelehnt) |
| PDF | `pdfkit` (Bautagesbericht im Aufbau der Papiervorlage) |
| Oberfläche | Vanilla-JS-SPA (kein Build), Design aus `prototype/`, PWA (Manifest + Service Worker), responsive Handy/Tablet/PC |
| Tests | `node --test` (Unit + API gegen echten Server auf Zufallsport mit `:memory:`-DB), Playwright E2E (`require('playwright')`, kein Install) |
| Start | `cd app && npm install && npm run seed && npm start` → http://localhost:3000 |

Ordner: `app/server/` (Backend, Opus), `app/public/` (Oberfläche, Fable), `app/tests/unit|api` (Opus), `app/tests/e2e` (Fable), `app/package.json` (gemeinsam: Scripts `start`, `seed`, `test`, `test:e2e`).

Konfiguration per Umgebungsvariablen: `PORT` (3000), `BAUTAG_DB`, `BAUTAG_UHR` (optional fixe Uhrzeit ISO für Tests/Demo), `NODE_ENV`.

## 2. Rollen & Rechte (serverseitig erzwungen)

Rollen: `mitarbeiter`, `polier`, `bauleiter`, `buero`, `gf`.

| Recht (Schlüssel) | mitarbeiter | polier | bauleiter | buero | gf |
|---|---|---|---|---|---|
| `zeit_eigen` eigene Zeiten stempeln/sehen | ✔ | ✔ | ✔ | ✔ | ✔ |
| `kolonne` Kolonne stempeln | – | ✔ | ✔ | – | ✔ |
| `bericht_erstellen` | – | ✔ | ✔ | ✔ | ✔ |
| `bericht_freigeben` | – | – (Ausnahme möglich) | ✔ eigene Baustellen | ✔ | ✔ |
| `preise_sehen` (€-Werte) | **gesperrt** | **gesperrt** | ✔ (nur lesen) | ✔ | ✔ |
| `preise_bearbeiten` | **gesperrt** | **gesperrt** | – | ✔ | ✔ |
| `kalk_sehen` Nachkalkulation/Budget | **gesperrt** | **gesperrt** | ✔ nur eigene Baustellen | ✔ | ✔ |
| `lohn` Monatsauswertung/Export | **gesperrt** | **gesperrt** | – | ✔ | ✔ |
| `stammdaten` Baustellen/Mitarbeiter/Geräte pflegen | – | – | – | ✔ | ✔ |
| `benutzer` Rechte & Benutzer verwalten | – | – | – | – | ✔ (immer) |

- **Gesperrt** = für diese Rolle nicht vergebbar, auch nicht als Ausnahme je Benutzer (Server lehnt mit 400 ab).
- Matrix in DB (`rolle_recht`), Ausnahmen je Benutzer (`benutzer_recht`, nur Erweiterungen, nie für gesperrte Rechte). Jede Änderung → `protokoll`.
- **Ohne `preise_sehen` liefert der Server keine €-Felder** (Felder fehlen im JSON komplett, nicht `null`). Ohne `kalk_sehen` → 403 auf Kalkulations-Routen.
- Bauleiter: Baustellen-bezogene Rechte nur für Baustellen mit `bauleiter_id = ich`.
- Polier: Berichte nur für Baustellen, auf denen er Polier ist (`polier_id`) oder eingeteilt ist.

## 3. Fehlerformat

`{ "fehler": "Text für Menschen (deutsch)", "code": "KEIN_ZUGRIFF" | "NICHT_ANGEMELDET" | "UNGUELTIG" | "NICHT_GEFUNDEN" | "KONFLIKT" | "NICHT_ANGEBUNDEN" }` mit Status 400/401/403/404/409/501.

Geldbeträge: Zahlen in Euro mit 2 Nachkommastellen (z. B. `1234.5`); Stunden als Dezimalzahl (`8.5`); Datum `YYYY-MM-DD`; Zeit `HH:MM`; Zeitstempel ISO 8601.

## 4. Endpunkte (Präfix `/api`)

### Auth
- `GET /auth/benutzerliste` → `[{id, name, rolle}]` aktive Benutzer (für Login-Auswahl, ohne sensible Daten)
- `POST /auth/login` `{benutzerId, pin}` → `{benutzer}` + Cookie. Nach 5 Fehlversuchen 5 min Sperre (429).
- `POST /auth/logout`
- `GET /auth/ich` → `{benutzer:{id,name,rolle,lohngruppe?}, rechte:[...Schlüssel], baustellenIds:[...]}` (401 wenn nicht angemeldet)

### Stammdaten (lesen: alle angemeldeten, gefiltert; schreiben: `stammdaten`)
- `GET /baustellen` → `[{id, kst, name, auftraggeber, adresse, status, polierId, bauleiterId, auftragssumme?, budgetVerbrauchProzent?, leistungsstandProzent?}]` (€/Budget-Felder nur mit `kalk_sehen`/`preise_sehen`; Mitarbeiter/Polier sehen nur ihre/aktive Baustellen)
- `GET /baustellen/:id`, `POST /baustellen`, `PUT /baustellen/:id`
- `PUT /baustellen/:id/auftrag` `{auftragssumme, schwellen:[80,90,100], empfaenger:{bauleiter:true,buero:true,gf:true}}` (Recht `preise_bearbeiten`)
- `POST /baustellen/:id/nachtraege` `{text, betrag}`, `DELETE /baustellen/:id/nachtraege/:nid`
- `POST /baustellen/:id/leistungen` `{leistungId, menge, datum}` (Leistungsmeldung für den Erlös; Recht `preise_bearbeiten` oder Bauleiter eigene)
- `POST /baustellen/:id/fremdleistungen` `{text, betrag, datum}`
- `GET /mitarbeiter` → `[{id, name, rolle, lohngruppe, aktiv}]` (Kostensätze nie hier)
- `GET /geraete` → `[{id, code, name, gruppe, kostensatz?, verrechnungssatz?}]` (Liste = Geräte der Papiervorlage)
- `GET /materialien` → `[{id, code, name, einheit, ek?, vk?}]`

### Preise (`preise_sehen` lesen, `preise_bearbeiten` schreiben)
- `GET /preise` → `{lohngruppen:[{id,name,kostensatz,regiesatz}], geraete:[...], materialien:[...], leistungen:[{id,code,text,einheit,ep}]}`
- `PUT /preise/:art/:id` (`art` ∈ lohngruppen|geraete|materialien|leistungen) `{feld, wert}` → aktualisierter Eintrag; löst Budget-Prüfung für alle Baustellen aus; Protokoll.

### Zeiterfassung
- `GET /zeit/status` → `{status:"aus"|"arbeit"|"pause", seit, baustelleId, heute:{stunden, pauseMin, buchungen:[{typ,zeit,baustelleId,quelle}]}, warnungen:[...]}`
- `POST /zeit/stempeln` `{typ:"kommen"|"gehen"|"pause_start"|"pause_ende"|"wechsel", baustelleId?, zeit?, standort?:{lat,lng,genauigkeit}}` → neuer Status. `zeit` nur für Offline-Nachbuchung (max. 24 h zurück, Feld `quelle:"offline"`). Ungültige Folgen (z. B. zweimal kommen) → 409.
- `POST /zeit/kolonne` `{baustelleId, benutzerIds:[...], typ}` (Recht `kolonne`) → `{ergebnisse:[{benutzerId, ok, fehler?}]}`
- `GET /zeit/woche?datum=YYYY-MM-DD` → eigene Woche `{tage:[{datum, stunden, code?, baustellen:[...]}], summe, ueberstunden}`
- `POST /abwesenheiten` `{benutzerId, datum, code:"K"|"U"|"SW"|"ZA"}` (eigene: nur U/ZA-Antrag; andere: `stammdaten` oder Polier für seine Partie SW)
- AZG-Warnungen (Server berechnet): `>10 h am Tag`, `>6 h ohne 30 min Pause`, `Ausstempeln vergessen (offen > 12 h)`, `<11 h Ruhezeit`.

### Bautagesberichte
- `GET /berichte?baustelleId&von&bis&status` → Liste (Polier: eigene Baustellen)
- `POST /berichte` `{baustelleId, datum}` → neuer Entwurf, **Personal automatisch aus Stempelungen** des Tages für diese Baustelle (von/bis zwei Blöcke, Pause, Stunden), Abwesenheiten als Code. 409 wenn schon vorhanden (liefert id).
- `GET /berichte/:id` → `{id, baustelle:{...}, datum, status, personal:[{benutzerId,name,von1,bis1,von2,bis2,pauseMin,stunden,code}], seg:{taetigkeit,stunden}, geraete:[{geraetId,code,name,stunden}], material:[{materialId,code,name,menge,einheit}], arbeitsleistung, materialbeistellung:{eigen,fremd}, paletten:{euro,weissenboeck}, regie:[{text,stunden}], vorkommnisse, wetter?, unterschriften:{an?:{name,zeit}, bh?:{name,zeit}}, kostenTag?}` (`kostenTag` nur mit `preise_sehen`)
- `PUT /berichte/:id` (nur Status `entwurf`) – Teil-Update der obigen Felder
- `POST /berichte/:id/unterschrift` `{rolle:"an"|"bh", name, bildPng (data-URL)}`; wenn beide vorhanden → Status `unterschrieben`
- `POST /berichte/:id/freigeben` (Recht `bericht_freigeben`) → Status `freigegeben`, löst Budget-Prüfung aus
- `GET /berichte/:id/pdf` → `application/pdf` im Aufbau der Papiervorlage (Firmenname als Text, kein Logo). **Enthält nie €-Werte.**
- Status: `entwurf` → `unterschrieben` → `freigegeben`. Nach `unterschrieben` nicht mehr editierbar (nur Freigabe).

### Nachkalkulation & Budget (`kalk_sehen`)
- `GET /kalkulation/:baustelleId` → `{baustelle, auftragssumme, nachtraege:[{id,text,betrag}], auftragGesamt, erloes, kosten:{lohn, geraete, material, fremd, gesamt}, db, dbProzent, budgetVerbrauchProzent, leistungsstandProzent, status:"ok"|"warnung"|"kritisch", schwellen, positionen:{lohn:[...],geraete:[...],material:[...]}, verlauf:[{datum,kosten,erloes}], hinweise:[{typ,text}]}`
  - Kosten = Σ Personalstunden × Kostensatz der Lohngruppe + Σ Gerätestunden × Gerätekostensatz + Σ Materialmenge × EK + Σ Fremdleistungen (aus Berichten mit Status ≠ entwurf, plus Fremdleistungen)
  - Erlös = Σ Leistungsmeldungen × EP + Σ Regiestunden × Regiesatz Facharbeiter
  - Leistungsstand = Erlös aus Leistungsmeldungen ÷ Auftragssumme gesamt
  - Budget-Verbrauch = Kosten gesamt ÷ Auftragssumme gesamt
  - Status `kritisch`, wenn Verbrauch − Leistungsstand > 10 Prozentpunkte (ab 15 % Leistungsstand) oder Verbrauch ≥ 100 %; `warnung` ab erster erreichter Schwelle.
- `GET /kalkulation` → Übersicht aller (für Bauleiter: eigene) Baustellen mit Kennzahlen

### Benachrichtigungen
- `GET /benachrichtigungen` → `[{id, typ:"budget"|"azg"|"bericht", titel, text, zeit, gelesen, baustelleId?}]` (nur eigene)
- `POST /benachrichtigungen/:id/gelesen`, `POST /benachrichtigungen/alle-gelesen`
- Budget-Alarm: je Baustelle und Schwelle **einmalig** an Bauleiter (der Baustelle), Büro, GF (laut `empfaenger`); **nie** an Polier/Mitarbeiter. Kanal In-App aktiv; Push/E-Mail → Integration „nicht angebunden“ (wird im Protokoll vermerkt).

### Monatsauswertung (`lohn`)
- `GET /monat?monat=YYYY-MM` → `{monat, tage:[...], mitarbeiter:[{id,name,tage:{"YYYY-MM-DD":{stunden,code}}, summe, normal, ueberstunden, sw, k, u, seg}], warnungen:[...]}`
- `GET /monat/export.csv?monat=YYYY-MM` → CSV (Semikolon, UTF-8 mit BOM) für die Lohnverrechnung
- `GET /monat/buak.csv?monat=YYYY-MM` → CSV-Grundlage für die BUAK-Meldung (kennzeichnen: „Grundlage, Format mit BUAK/Lohnverrechnung abstimmen“)
- Annahme Überstunden: über 8 Std/Tag (Mo–Do) bzw. über Wochenarbeitszeit 39 Std – konfigurierbar, im Konzept als „Prüfen“ markiert.

### Benutzer & Rechte (`benutzer`)
- `GET /rechte` → `{rollen:[...], rechte:[{schluessel, text}], matrix:{[rolle]:{[recht]:bool}}, gesperrt:{[rolle]:[recht...]}, ausnahmen:[{benutzerId,recht}], protokoll:[...]}`
- `PUT /rechte/matrix` `{rolle, recht, wert}` (gesperrt → 400; `gf.benutzer` immer true)
- `PUT /rechte/ausnahme` `{benutzerId, recht, wert}`
- `POST /benutzer`, `PUT /benutzer/:id` (Name, Rolle, Lohngruppe, aktiv, PIN zurücksetzen)

### Integrationen (ehrlich „nicht angebunden“)
- `GET /integrationen` → `[{schluessel:"diktat"|"scan_lieferschein"|"scan_papier"|"sms"|"push"|"email"|"wetter", name, angebunden:false, hinweis}]`
- `POST /integrationen/:schluessel/*` → **501** `{code:"NICHT_ANGEBUNDEN", fehler:"… ist noch nicht angebunden (Anbieter/Vertrag fehlt)."}`
- Die Oberfläche zeigt diese Funktionen als deaktivierte Schaltflächen mit Hinweis „noch nicht angebunden“ – keine vorgetäuschten Ergebnisse.

### System
- `GET /api/gesundheit` → `{ok:true, version, db:"ok"}`

## 5. Testdaten (`npm run seed`)
Fiktive Daten wie im Prototyp (`prototype/data/data.js`): ~30 Mitarbeiter, 6–8 Baustellen (KST 26-041 WHA Pitten usw.), Geräte & Material der Papiervorlage, Beispielpreise. Demo-PIN für alle: `1234` (nur Testdaten; im README deutlich als „vor Echtbetrieb ändern“ markiert). Benutzer: GF „Michael Pichler“, Büro „Martina Koller“, Bauleiter „Stefan Aigner“, Polier „Josef Haidbauer“, Mitarbeiter „Lukas Brandstätter“ (wie im Prototyp).

## 6. Abweichungen Backend (Stand Umsetzung)

Alle Punkte sind **additiv** oder Präzisierungen; bestehende Felder/Routen sind wie oben umgesetzt.

**Ergänzte Routen**
- `GET /zeit/anwesend` → `[{benutzerId, name, rolle, status:"arbeit"|"pause", seit, baustelleId, schichtBeginn}]` alle gerade Eingestempelten. Erlaubt mit `bericht_freigeben` ODER `stammdaten` ODER `lohn` ODER `kalk_sehen`, sonst 403. Bauleiter (und Polier mit Ausnahme `bericht_freigeben`) sehen nur Personen auf ihren eigenen Baustellen. Keine €-Felder.
- `GET /zeit/kolonne?baustelleId=` (Recht `kolonne`, nur eigene Baustellen) → `[{benutzerId, name, rolle, partie, status, seit, baustelleId, code}]` – Partie mit aktuellem Stempelstatus („bereits gestempelt um …“).
- `POST /berichte/:id/personal-aktualisieren` – Personal erneut aus den Stempelungen übernehmen (nur Entwurf; SEG-Stunden bleiben).
- `GET /leistungen` → `[{id, code, text, einheit, ep?}]` (EP nur mit `preise_sehen`).
- `GET /benutzer` (Recht `benutzer`) → `[{id, name, rolle, lohngruppe, baustelleId, pnr, aktiv}]`.

**Ergänzte Felder**
- `/auth/ich`: `benutzer.baustelleId` (Stamm-Baustelle/Partie).
- Baustelle: `kurz, agAdresse, bauvorhaben, bauherrVertreter, art, intern, beginn, ende`; mit `kalk_sehen` zusätzlich `budgetStatus`, im Detail `schwellen, empfaenger`; mit Preisen im Detail `nachtraege, auftragGesamt`. `budgetVerbrauchProzent/leistungsstandProzent` nur mit `kalk_sehen` **für diese Baustelle** (Bauleiter: eigene).
- Bericht: `baustelleId, gesamtstunden, bearbeitbar, freigabe:{benutzerId,zeit}, erstellt, geaendert`; `personal[].segStunden` (SEG-Stunden je Person, fließen in `/monat … seg`); `unterschriften.*.bildPng` im Detail. `wetter` ist Text **oder** ein flaches Objekt (z. B. `{text, temperatur}`). `materialbeistellung.eigen/fremd` sind Texte (mehrzeilig; Listen werden zu Zeilen zusammengefügt). Liste: `[{id, baustelleId, kst, baustelle, datum, status, personalAnzahl, stunden, unterschriften:{an:bool,bh:bool}}]`.
- `/zeit/status`: `schichtBeginn`, `heute.datum`, `buchungen[].uhrzeit` (HH:MM Wien). Warnungen: `[{typ:"tag_10h"|"tag_12h"|"pause"|"offen"|"ruhezeit", datum, stufe, text}]`.
- `/zeit/woche`: `von, bis, sollStunden`, je Tag `wochentag, pauseMin, von, bis, feiertag?, codeStatus?`; `baustellen:[{id,kst,name,stunden}]`.
- `/kalkulation/:id`: zusätzlich `erloesLeistung, erloesRegie, stunden:{lohn,regie}, alarme`, `positionen.fremd/leistungen/regie`. `verlauf` ist **kumuliert** je Datum. Positionen: `lohn:[{lohngruppeId,name,stunden,satz,betrag}]`, `geraete:[{geraetId,code,name,stunden,satz,betrag}]`, `material:[{materialId,code,name,einheit,menge,satz,betrag}]`. Ohne Auftragssumme sind die Prozentwerte `null` (Status `ok`, Hinweis).
- `/kalkulation` (Übersicht): `[{baustelleId, baustelle:{...}, budgetVerbrauchProzent, leistungsstandProzent, status, schwellen, stunden, auftragssumme, auftragGesamt, erloes, kosten, db, dbProzent}]`.
- `/monat`: je Mitarbeiter zusätzlich `pnr, lohngruppe, za, swStunden`, Tage mit `von, bis, pauseMin, baustellen` (KST); `tage:[{datum, wochentag, feiertag, arbeitstag}]`; `warnungen:[{benutzerId, name, typ, datum, text}]`; `annahmen` (Überstunden-Regel).
- `/rechte`: zusätzlich `rollenNamen`, `immer` (nicht entziehbar), `ausnahmen[].name/erteilt/erteiltVon`.
- `/mitarbeiter`: `baustelleId`; `lohngruppe` und `pnr` nur mit `stammdaten`/`lohn`/`benutzer` (Konzept 2.2: Lohngruppen sind vertraulich). Mitarbeiter ohne Kolonnen-/Berichtsrecht sehen nur sich selbst.
- `/geraete`, `/materialien`: zusätzlich `vorlage` (Zeile der Papiervorlage); Material `hinweis`.

**Präzisierungen / Abweichungen**
- **Gesperrt für Bauleiter:** `preise_bearbeiten` und `lohn` sind für die Rolle Bauleiter gesperrt (Konzept 2.2: „Dem Bauleiter können Preis-Bearbeitung, Lohnauswertung … nicht per Ausnahme gegeben werden“). `GET /rechte` liefert das in `gesperrt.bauleiter`.
- **429-Code:** Login-Sperre antwortet mit `{code:"ZU_VIELE_VERSUCHE"}` und `Retry-After`. Der 5. Fehlversuch liefert bereits 429.
- **415:** Schreibende Anfragen mit Body, die nicht `application/json` sind, → 415 `{code:"UNGUELTIG"}`. Anfragen ohne Body (z. B. `POST /auth/logout`) sind ohne Content-Type erlaubt.
- **Unbekannte `/api`-Adressen** ohne Anmeldung → 401 (verrät keine Routen), angemeldet → 404.
- **Freigabe** nur aus Status `unterschrieben` (sonst 409). Unterschrift nur im Entwurf (409 danach). Für `POST /berichte` gilt: Datum nicht in der Zukunft, max. 1 Jahr zurück.
- **PDF:** `GET /berichte/:id/pdf?fassung=ag|intern` – Standard `ag` (Auftraggeber: Kürzel K/U und reine K/U-Zeilen werden nicht gedruckt); `intern` nur mit `bericht_freigeben` oder `stammdaten`.
- **Budget-Alarm:** Stufen `80/90/100` (laut Schwellen) und zusätzlich `kritisch` (Verbrauch − Leistungsstand > 10 Pp. ab 15 % Leistungsstand) – je Baustelle einmalig. Werden mehrere Schwellen auf einmal erreicht, kommt **eine** Meldung (höchste Stufe). Eine Schwelle wird wieder scharf, wenn sie nach einer Änderung der Auftragssumme/Nachträge unterschritten ist; `kritisch` wieder, sobald die Lage nicht mehr kritisch ist. Geprüft nach Freigabe, Unterschrift (Kosten zählen ab `unterschrieben`), Preisänderung, Auftrag-/Nachtragsänderung, Fremdleistung und Leistungsmeldung. Empfänger zusätzlich gefiltert auf `kalk_sehen` für die Baustelle; Budget-Meldungen verschwinden aus der Liste, wenn das Recht für die Baustelle entfällt.
- **Fremdleistungen** erfassen: Recht `preise_bearbeiten`. Nachträge: alle zählen zur Basis (kein Status angeboten/beauftragt).
- **Abwesenheiten:** eigener Antrag U/ZA → Status `beantragt`; Büro (`stammdaten`) → `genehmigt` (überschreibt bestehende); Polier nur SW für Personen seiner Partie. Antwort `{id, benutzerId, datum, code, status}`. Bestehender Eintrag ohne `stammdaten` → 409.
- **Überstunden (Annahme, Einstellung `arbeitszeit`):** Normalarbeitszeit Mo–Do 8 Std., Fr 7 Std. (= 39 Std.); Überstunden je Kalenderwoche = max(Σ Tagesüberschreitungen, Wochensumme − Soll). SW-Stunden = Soll des Tages − gearbeitete Stunden.
- **Uhr:** `BAUTAG_UHR` setzt die Startzeit; die Uhr läuft danach in Echtzeit weiter (für Tests: `createApp({uhr: () => Date})`).
- **Testdaten** sind relativ zu „heute“ (Prototyp-Datum 12.11.2026 wird verschoben). Baustellen ohne Prototyp-Bauleiter haben GF Michael Pichler als Bauleiter; 26-029 hat Thomas Riegler als Polier.
- **`npm test`:** `node --test <Ordner>` funktioniert unter Node 22 nicht; das Script nutzt daher Glob-Muster `"tests/unit/**/*.test.js" "tests/api/**/*.test.js"` (gleicher Umfang).
