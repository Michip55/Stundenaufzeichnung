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
| Start | Vorführung: `cd app && npm install && BAUTAG_DEMO=1 npm run seed && BAUTAG_DEMO=1 npm start` → http://localhost:3000; Echtbetrieb: `node server/einrichten.js` (siehe Abschnitt 9) |

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

> Wo Abschnitt 7 (nach Prüfbericht 1) etwas anderes sagt, gilt **Abschnitt 7** (z. B. Sitzungsdauer, Namensliste ohne Rolle, Sperre je IP, Abwesenheitsstatus).

Alle Punkte sind **additiv** oder Präzisierungen; bestehende Felder/Routen sind wie oben umgesetzt.

**Ergänzte Routen**
- `GET /zeit/anwesend` → `[{benutzerId, name, rolle, status:"arbeit"|"pause", seit, baustelleId, schichtBeginn}]` alle gerade Eingestempelten. Erlaubt mit `bericht_freigeben` ODER `stammdaten` ODER `lohn` ODER `kalk_sehen`, sonst 403. Bauleiter (und Polier mit Ausnahme `bericht_freigeben`) sehen nur Personen auf ihren eigenen Baustellen. Keine €-Felder.
- `GET /zeit/kolonne?baustelleId=` (Recht `kolonne`, nur eigene Baustellen) → `[{benutzerId, name, rolle, partie, status, seit, baustelleId, code}]` – Partie (nur Rollen mitarbeiter/polier) mit aktuellem Stempelstatus („bereits gestempelt um …“); `code` nur genehmigte Abwesenheit.
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

## 7. Änderungen nach Prüfbericht 1 (Backend, verbindlich)

Bezug: `app/PRUEFBERICHT_1.md`. Neue/geänderte Routen und Regeln; alles andere bleibt wie oben.

### Anmeldung (B-03, M-05)
- `GET /auth/benutzerliste` → nur noch `[{id, name}]` (keine Rolle). `POST /auth/login` antwortet zusätzlich mit `mussPinAendern`. Mit `BAUTAG_LOGIN_LISTE=0` abgeschaltet → **404** `{code:"NICHT_GEFUNDEN"}`; dann Anmeldung über die Personalnummer.
- `POST /auth/login` akzeptiert `{benutzerId, pin}` **oder** `{pnr, pin}`. PIN: 4–12 Ziffern.
- **Sperre je (Benutzer, Client-IP)** mit steigender Dauer: 5 Fehlversuche → 5 min, nächste Sperre 15 min, danach jeweils 60 min (Zähler zurück nach erfolgreicher Anmeldung oder PIN-Reset durch die GF). Ein Fremder sperrt damit nur sich selbst aus. Zusätzlich je Client-IP höchstens 30 Fehlversuche in 5 min (429). Antwort 429 `{code:"ZU_VIELE_VERSUCHE"}` + `Retry-After`. Die Client-IP ist `req.ip`; hinter einem Reverse-Proxy **muss** `TRUST_PROXY=1` gesetzt sein (sonst wäre es die Proxy-Adresse), dann gelten `X-Forwarded-For`/`X-Forwarded-Proto` des Proxys.
- **PIN-Länge:** Mitarbeiter/Polier mind. 4, Bauleiter/Büro/GF mind. 6 Ziffern (max. 12). Keine Folgen wie `1111`, `1234`, `654321` (400).
- **`POST /auth/pin`** `{alt, neu}` (angemeldet) → `{ok:true}`. Falsche alte PIN → 401 (zählt als Fehlversuch). Beendet alle anderen Sitzungen des Benutzers. Protokoll.
- **Pflicht zur PIN-Änderung:** Benutzer mit gesetztem Kennzeichen (nach Anlage, nach PIN-Reset durch die GF, alle Testdaten-Benutzer ohne `BAUTAG_DEMO=1`) erhalten auf **alle** Routen außer `/auth/*` und `/gesundheit` **403** `{code:"PIN_AENDERN", fehler:"Bitte zuerst die PIN ändern."}`. `GET /auth/ich` liefert `mussPinAendern: true|false`.
- `GET /auth/ich` → zusätzlich `mussPinAendern`, `sitzungMinuten` (Inaktivitäts-Ablauf).
- **Sitzungsablauf nach Inaktivität je Rolle:** Mitarbeiter/Polier `BAUTAG_SITZUNG_FELD_MIN` (Standard 720 = 12 h), Bauleiter/Büro/GF `BAUTAG_SITZUNG_BUERO_MIN` (Standard 60). Absolute Obergrenze `BAUTAG_SITZUNG_MAX_H` (Standard 24 h).

### Rechte (B-01)
- `benutzer` ist für **alle Rollen außer GF gesperrt** (weder Matrix noch Ausnahme → 400). `stammdaten` ist zusätzlich für Polier/Mitarbeiter gesperrt.
- Niemand ändert die **eigene** Rolle oder deaktiviert sich selbst (`PUT /benutzer/:id` → 403).
- `GET /rechte` → `protokoll`: Einträge mit €-Bezug (`preis`, `auftrag`, `nachtrag`, `fremdleistung`, `leistung`, `budget_alarm`) nur mit `preise_sehen`; sonst fehlen sie, und €-Schlüssel in `alt`/`neu` werden entfernt.

### Kolonne (B-02)
- Über `POST /zeit/kolonne` sind nur Personen mit Rolle **mitarbeiter/polier** stempelbar (sonst `ok:false`).
- `kommen`: nur Personen der eigenen Partie (Stamm-Baustelle im Bereich des Stempelnden). Fremde Personen nur mit `gast:true` im Body (wird protokolliert).
- `gehen`, `pause_start`, `pause_ende`, `wechsel`: nur Personen, die gerade auf einer Baustelle im Bereich des Stempelnden eingestempelt sind (`wechsel` zusätzlich nur auf eine Baustelle im Bereich).

### Zeitkorrektur, Nachtschicht, vergessenes Ausstempeln (B-05, B-06, N-01, N-06)
- **Über Mitternacht:** In Berichtszeilen gilt `bis < von` als **nächster Tag** (z. B. `von1:"22:00", bis1:"02:00"`). `von == bis` ist ungültig; die Zeitspanne von `von1` bis zum Ende des letzten Blocks darf 24 h nicht überschreiten. Stunden = Blockdauern (mit +24 h über Mitternacht) minus Pause, soweit nicht in der Lücke. Gleiche Regel in Auto-Befüllung, Prüfung, PDF und Monat (Schicht zählt zum Tag des Beginns).
- **Unplausible Schichten:** Eine Schicht, die länger als 16 h offen ist oder (ausgestempelt) länger als 16 h dauerte, zählt in Bericht, Woche, Monat und Export mit **0 Std.** und wird gekennzeichnet: Woche/Monat-Tag `unplausibel:true`, Monat `offeneSchichten:[{benutzerId,name,datum,beginn,text}]`, CSV-Hinweiszeile, AZG-Warnung `typ:"unplausibel"`. Im Bericht erscheint die Person mit leeren Zeiten, `stunden:0`, `hinweis:"Ausstempeln fehlt – Zeiten bitte eintragen"`.
- **Korrektur durch Büro/GF** (Recht `stammdaten`, immer mit Grund, protokolliert mit alt/neu):
  - `GET /zeit/buchungen?benutzerId&von&bis` (`von`/`bis` = Datum, Standard letzte 14 Tage) → `[{id, benutzerId, typ, zeit, uhrzeit, datum, baustelleId, quelle, erfasstVon}]`. Ohne `stammdaten` nur eigene (`benutzerId` = ich).
  - `POST /zeit/buchungen` `{benutzerId, typ, zeit, baustelleId?, grund}` → 201 neue Buchung (Quelle `buero`, beliebig weit zurück, nicht in der Zukunft).
  - `PUT /zeit/buchungen/:id` `{zeit?, baustelleId?, grund}` → 200.
  - `DELETE /zeit/buchungen/:id` `{grund}` → 200.
  - Ergibt die Korrektur eine ungültige Stempelfolge → 409.
- `zeit` (Offline-Nachbuchung und Korrektur) muss eine **Zeitzone** enthalten (`Z` oder `+01:00`), sonst 400.
- Status (`/zeit/status`, Kolonne, Anwesenheit, Stempeln) wird aus der **ganzen** laufenden Schicht ab dem letzten `kommen` berechnet.

### Abwesenheiten (B-07)
- Status: `beantragt` | `genehmigt` | `abgelehnt`. **Nur `genehmigt` zählt** in Monat (`u,k,sw,za`), Lohn-CSV, BUAK-CSV und in der Bericht-Auto-Befüllung. Beantragte stehen in `/monat` je Tag mit `codeStatus:"beantragt"`, im Lohn-CSV nicht als Kürzel, sondern in Hinweiszeilen am Ende.
- `GET /abwesenheiten?benutzerId&von&bis&status` → `[{id, benutzerId, name, datum, code, status, erfasst, erfasstVon, entschieden?, entschiedenVon?}]`. Bereich: `stammdaten`/`lohn` alle; Bauleiter: Personen seiner Baustellen + sich; Polier: seine Partie + sich; sonst nur eigene.
- `PUT /abwesenheiten/:id` `{status:"genehmigt"|"abgelehnt"}` (Recht `stammdaten` oder `lohn`) → aktualisierter Eintrag; Benachrichtigung an die Person (`typ:"abwesenheit"`), Protokoll.
- `DELETE /abwesenheiten/:id` → eigene **beantragte** (oder mit `stammdaten`/`lohn` jede) → `{ok:true}`.
- `POST /abwesenheiten`: eigener Antrag (U/ZA) frühestens 7 Tage zurück; Polier-SW höchstens 3 Tage zurück; Büro bis 62 Tage zurück; alle bis 366 Tage voraus. Ein `abgelehnt`er Eintrag darf durch einen neuen Antrag ersetzt werden. Neuer Antrag → Benachrichtigung an Büro/GF (`typ:"abwesenheit"`).
- Benachrichtigungen: `typ` zusätzlich `"abwesenheit"`.

### Bautagesbericht (M-01, M-02, B-06)
- **Ab der ersten Unterschrift ist der Inhalt gesperrt:** `PUT /berichte/:id` und `POST …/personal-aktualisieren` → **409** „Der Bericht ist bereits unterschrieben (Auftragnehmer/Bauherr) – Inhalt gesperrt. Unterschrift zurückziehen, um zu ändern.“
- **`DELETE /berichte/:id/unterschrift/:rolle`** (`an`|`bh`, Recht `bericht_erstellen` im Bereich, nur solange Status `entwurf`) → Bericht-JSON; protokolliert.
- `personal[].segStunden` darf `stunden` nicht übersteigen (400). Personalzeile kann `hinweis` enthalten (nur lesend).
- SEG-Stunden in `/monat` nur aus **freigegebenen** Berichten.
- `wetter` als Objekt nur mit den Schlüsseln `text, temperatur, niederschlag, wind, quelle`.

### Monat / Lohn (M-07, N-02)
- Stunden je Person und Tag: Für Baustellen, für die an diesem Tag ein **freigegebener Bericht** mit einer Zeile dieser Person existiert, gelten die **Berichtsstunden** (Korrekturen des Poliers kommen so in den Lohn); sonst die Stempelzeiten. Je Tag `quelle:"bericht"|"stempel"|"gemischt"`. AZG-Warnungen bleiben aus den Stempelungen.
- `monat` (und alle Datumsangaben) nur Jahre 2000–2100 (sonst 400).
- Lohn-CSV: nach der Summentabelle Hinweiszeilen `Hinweis;…` für beantragte Abwesenheiten, unplausible/offene Schichten und AZG-Warnungen.

### Leistungsmeldungen / Fremdleistungen (M-03)
- `GET /baustellen/:id/leistungen` (Nachkalkulation für die Baustelle) → `[{id, leistungId, code, text, einheit, menge, datum, erstellt, erstelltVon, ep?, betrag?}]`.
- `DELETE /baustellen/:id/leistungen/:lid` (Recht wie Erfassen) → `{ok:true}`, Protokoll, Budget-Prüfung.
- `GET /baustellen/:id/fremdleistungen` (Preise für die Baustelle) → `[{id, text, betrag, datum, erstellt, erstelltVon}]`.
- `DELETE /baustellen/:id/fremdleistungen/:fid` (`preise_bearbeiten`) → `{ok:true}`, Protokoll, Budget-Prüfung.
- Datum nicht in der Zukunft und höchstens 2 Jahre zurück; Menge 0,001–100.000; Fremdleistung |Betrag| ≤ 5.000.000 €; Nachtrag |Betrag| ≤ 100.000.000 €. Leistungsmeldungen werden protokolliert.

### Sonstiges (M-06, N-03, N-04, N-05, N-08)
- Header: `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Strict-Transport-Security` nur bei HTTPS. `X-Forwarded-Proto` wird nur mit `TRUST_PROXY=1` beachtet.
- `GET /gesundheit` liefert `db` für alle Rollen.
- `/monat` je Tag zusätzlich `quelle`, `unplausibel`, `codeStatus`; oben `beantragt:[{benutzerId,name,datum,code}]` und `offeneSchichten`. `/zeit/woche` je Tag ebenso `quelle`, `unplausibel`.
- Testdaten: Büro/GF/Bauleiter haben Personalnummern 1101/1102/1103 (Mitarbeiter 1001–1030).
- Geldbeträge werden kaufmännisch gerundet (`1.005` → `1.01`).
- Personalnummer (`pnr`) ist eindeutig: doppelte → 409.
- Statische Pfade mit Dateiendung oder Punkt-Segment (z. B. `/js/fehlt.js`, `/.git/config`), die es nicht gibt → **404** statt `index.html`.
- **Bekannte Grenze (M-08):** Preise haben noch keinen „gültig ab“-Stand; die Nachkalkulation rechnet alle Berichte mit den aktuellen Sätzen und der aktuellen Lohngruppe der Person. Eine Preisänderung wirkt daher rückwirkend (und kann Budget-Alarme auslösen).

## 8. Änderungen nach Prüfbericht 2 (Backend, verbindlich)

Bezug: `app/PRUEFBERICHT_2.md`. Gilt vor den Abschnitten 6 und 7.

### Rechte / Benutzerverwaltung (C-05, C-14, C-12, C-09)
- `stammdaten` ist jetzt auch für **Bauleiter gesperrt** (nur Büro/GF; weder Matrix noch Ausnahme → 400). Bauleiter- und Polier-Zuordnung von Baustellen (`bauleiterId`, `polierId`) ändern nur Benutzer mit Rolle **buero** oder **gf** (sonst 403). Die „eigenen Baustellen“ eines Bauleiters ergeben sich nur aus dieser Zuordnung. Rechte werden bei jeder Anfrage neu geladen – ein Entzug wirkt sofort.
- **Büro verwaltet Benutzer** der Rollen `mitarbeiter`, `polier`, `bauleiter`: `GET /benutzer`, `POST /benutzer`, `PUT /benutzer/:id` (Name, Lohngruppe, Stamm-Baustelle, Personalnummer, aktiv, PIN zurücksetzen, Rolle **nur innerhalb** dieser drei Rollen), `POST /benutzer/:id/entsperren`. Benutzer der Rollen `buero`/`gf` sowie Rollenwechsel zu/von `buero`/`gf` nur durch die GF (`benutzer`-Recht). Alles protokolliert. `GET /rechte` (Matrix, Protokoll) bleibt GF.
- `POST /benutzer`: `pnr` optional – fehlt sie, vergibt der Server die nächste freie Nummer (ab 1001). Doppelte `pnr` → 409. Unbekannte Felder im Body werden ignoriert.
- **Vier-Augen-Prinzip:** Niemand entscheidet eigene Anträge (`PUT /abwesenheiten/:id` für sich selbst → 403) und niemand korrigiert die eigenen Stempelzeiten (`/zeit/buchungen`, `/zeit/schichten` für sich selbst → 403). Eigene Abwesenheiten sind auch für Büro/GF immer `beantragt`.
- **`POST /benutzer/:id/entsperren`** → `{ok:true}`: hebt Konto- und IP-Sperren der Anmeldung auf.
- `GET /benutzer` liefert je Benutzer zusätzlich `gesperrt: true|false` (Kontosperre nach C-07) und bei Sperre `gesperrtSeit` (ISO).

### Anmeldung (C-07, M-05)
- Zusätzlich zur Sperre je (Benutzer, IP): **20 Fehlversuche innerhalb von 24 h (über alle IPs)** sperren das Konto, bis Büro/GF es entsperren (`POST /benutzer/:id/entsperren` oder PIN-Reset). Antwort bei gesperrtem Konto (auch mit richtiger PIN): **423** `{code:"KONTO_GESPERRT", fehler:"…"}`. Büro und GF erhalten eine Benachrichtigung (`typ:"sicherheit"`). Abwägung: Ein Angreifer kann damit ein Konto absichtlich sperren (DoS); das ist gewollt, weil sonst verteiltes PIN-Raten unbegrenzt wäre – das Büro entsperrt (Konzept 2.2: „Das Büro entsperrt“).
- Sitzungsdauer bleibt **Produktentscheidung der GF**: Standard 12 h Inaktivität für Mitarbeiter/Polier (eigene Geräte, ständiges Ab-/Anmelden auf der Baustelle unpraktisch) und 60 min für Bauleiter/Büro/GF (€-Daten), absolute Grenze 24 h. Konzept-Vorschlag (Polier-Tablet 10 min, Büro 30 min) per `BAUTAG_SITZUNG_FELD_MIN=10`, `BAUTAG_SITZUNG_BUERO_MIN=30` einstellbar.
- Benachrichtigungen: `typ` zusätzlich `"sicherheit"`.

### Bautagesbericht (C-01, C-02, C-06, C-08, C-10)
- **Version (C-08):** `GET /berichte/:id` liefert `version` (Ganzzahl). `PUT /berichte/:id` **verlangt** `version` (fehlt → 400); passt sie nicht → **409** `{code:"KONFLIKT", fehler:"Der Bericht wurde inzwischen geändert …", version:<aktuell>}`. Jede Änderung (Inhalt, Personal übernehmen, Unterschrift, Zurückziehen, Freigabe) erhöht `version`. `POST …/personal-aktualisieren` nimmt optional `{version}`.
- **Stunden (C-02, C-10):** `personal[].stunden` wird **immer vom Server** aus `von1/bis1/von2/bis2/pauseMin` berechnet (mit echten Zeitpunkten in Europe/Vienna, also auch über Mitternacht und über die Zeitumstellung richtig). Ein mitgesendetes `stunden` wird ignoriert. Zeilen ohne Zeiten haben 0 Std.
- **Personen im Bericht (C-01):** Erlaubt sind nur Personen der Rollen `mitarbeiter`/`polier` (nie Bauleiter/Büro/GF → 400), und zwar aus der **Partie** der Baustelle (Stamm-Baustelle = diese Baustelle oder ihr Polier) oder Personen, die an diesem Tag **auf dieser Baustelle gestempelt** haben. Andere nur mit `gast:true` in der Zeile (wird protokolliert, Zeile liefert `gast:true`).
- **Überschneidungen (C-01):** Eine Zeile mit Zeiten darf sich **nicht** mit einer gestempelten Arbeitszeit derselben Person auf einer **anderen** Baustelle am selben Tag und nicht mit einer Zeile derselben Person in einem **anderen Bericht** desselben Tages überschneiden → 400 mit Text (Person, Baustelle, Zeiten).
- **Unterschrift zurückziehen (C-06):** `DELETE /berichte/:id/unterschrift/bh` (Bauherr) nur für Rolle **buero/gf**; `…/an` weiter für Berichtersteller im Bereich. Jede Rücknahme wird protokolliert und am Bericht vermerkt: `geaendertNachUnterschrift: {zeit, rolle, von}` (sichtbar in `GET /berichte/:id`, Liste: `geaendertNachUnterschrift:true`, und als Vermerk in **beiden** PDF-Fassungen). Ein Unterschriftsbild, das für diesen Bericht schon einmal zurückgezogen wurde oder in einem **anderen** Bericht verwendet wird (gleicher SHA-256), wird abgelehnt (400 „Bitte neu unterschreiben“).

### Lohn / Monat (C-01, C-03)
- **Regel je Person, Tag und Baustelle:** Gibt es für die Baustelle an dem Tag einen **freigegebenen** Bericht, gilt **nur** dieser – auch mit 0 Std. oder wenn die Person darin fehlt (dann 0 Std. für diese Baustelle und Warnung `typ:"nicht_im_bericht"`). Baustellen ohne freigegebenen Bericht: Stempelzeiten.
- **Sicherheitsnetz:** Überschneiden sich am selben Tag Berichtszeiten mit Stempelzeiten einer anderen Baustelle oder zwei Berichtszeilen, wird die Überschneidung **nur einmal** gezählt; Tag `ueberschneidung:true`, Monat `warnungen` mit `typ:"ueberschneidung"`, Hinweiszeile im Lohn-CSV.

### Zeitkorrektur ganzer Schichten (C-04)
- `GET /zeit/schichten?benutzerId&von&bis` (eigene; andere nur Büro/GF) → `[{id, benutzerId, datum, beginn, ende, baustellen:[id…], arbeitMin, pauseMin, offen, unplausibel, buchungIds:[…]}]` (`id` = ID der „kommen“-Buchung).
- `POST /zeit/schichten` `{benutzerId, baustelleId, datum, von:"HH:MM", bis:"HH:MM", pauseMin, pauseVon?:"HH:MM", grund}` (Büro/GF, nicht für sich selbst) → 201 Schicht. Erzeugt `kommen`, ggf. `pause_start`/`pause_ende` (Pause ab `pauseVon`, sonst in der Mitte) und `gehen` (bis < von = nächster Tag). Max. 16 Std.; darf sich mit keiner anderen Schicht der Person überschneiden (409); Quelle `buero`; protokolliert.
- `DELETE /zeit/schichten/:id` `{grund}` → löscht die ganze Schicht (alle Buchungen von „kommen“ bis „gehen“), protokolliert mit allen alten Buchungen.
- Einzelbuchungen (`/zeit/buchungen`) bleiben.

### Abwesenheiten / Stempeln (C-11, C-13)
- Schlechtwetter-Meldung des Poliers ist `beantragt`; Büro/Lohn bestätigt (`PUT /abwesenheiten/:id`).
- Stempeln (`kommen`, auch über Kolonne/Gast) ist für eine Person mit **genehmigtem K oder U** an diesem Tag gesperrt → 409 (Kolonne: `ok:false` mit Text).

### Baustelle (C-08)
- `GET /baustellen/:id` liefert `version`. `PUT /baustellen/:id` und `PUT /baustellen/:id/auftrag` **verlangen** `version` (fehlt → 400, veraltet → 409 mit aktueller `version`).

## 9. Änderungen nach Prüfbericht 3 (Backend, verbindlich)

Bezug: `app/PRUEFBERICHT_3.md`. Gilt vor den Abschnitten 6–8.

### Anmeldung / Kontosperre (D-01, D-12)
- Die Kontosperre (20 Fehlversuche in 24 h) ist **befristet**: 1. Sperre 24 h, 2. Sperre 48 h, ab der 3. jeweils 7 Tage (Zähler zurück nach erfolgreicher Anmeldung oder Entsperrung). Antwort 423 `{code:"KONTO_GESPERRT"}` mit `Retry-After`. `GET /benutzer` → `gesperrt`, `gesperrtSeit`, zusätzlich `gesperrtBis`.
- `POST /benutzer/:id/entsperren`: GF für alle; **Büro auch für GF- und Büro-Konten** (nur entsperren – kein PIN-Reset, keine sonstige Änderung). Nicht für sich selbst.
- Notfall ohne Anmeldung (lokal am Server): `node server/entsperren.js <pnr>` hebt alle Sperren auf (protokolliert, Art `sicherheit`).
- Beim Start warnt der Server (Konsole), wenn weniger als **zwei** aktive Konten GF/Büro entsperren können (GF bzw. Büro mit `stammdaten`). Empfehlung: mindestens zwei Verwaltungs-Konten anlegen.
- Mit `BAUTAG_LOGIN_LISTE=0` ist die Anmeldung **nur** mit `{pnr, pin}` möglich; `{benutzerId}` → 400.

### Benutzer / Rollen (D-02, D-11)
- Büro: anlegen nur Rollen `mitarbeiter`/`polier`; Rollenwechsel nur `mitarbeiter` ↔ `polier`. Bauleiter anlegen oder jemanden zum/vom Bauleiter machen: nur GF. Büro darf bestehende Bauleiter weiter bearbeiten (Name, PIN-Reset, Entsperren, aktiv). Jeder Rollenwechsel durch das Büro → Benachrichtigung an die GF (`typ:"sicherheit"`).
- Erhält jemand eine Rolle mit PIN-Mindestlänge 6 (Bauleiter/Büro/GF) und ist seine PIN kürzer (oder unbekannt), wird `mussPinAendern` gesetzt. Zusätzlich wird bei jeder Anmeldung mit zu kurzer PIN für die Rolle `mussPinAendern` gesetzt (nicht im Demo-Modus `BAUTAG_DEMO=1`, damit die Vorführ-PIN 1234 bleibt).
- Rollenwechsel räumt unpassende Zuordnungen: wer nicht mehr Bauleiter/GF ist, wird als `bauleiterId`, wer nicht mehr Polier ist, als `polierId` aus allen Baustellen entfernt. `PUT /benutzer/:id` liefert dann `zuordnungenEntfernt:[{baustelleId, kst, feld:"bauleiterId"|"polierId"}]`.

### Bautagesbericht (D-03, D-04, D-05, D-07, D-10)
- Überschneidungsprüfung mit echten Zeitpunkten **über die Tagesgrenze**: gegen Stempelzeiten der Person auf **allen** Baustellen (auch der eigenen, wenn die Schicht zu einem anderen Berichtstag gehört) sowie gegen Zeilen der Person in Berichten vom **Vortag, selben Tag und Folgetag** → 400.
- Personal-Vorschlag (Anlegen, `personal-aktualisieren`) enthält **nie** Bauleiter/Büro/GF. Deren Stempelstunden zählen im Lohn immer (die Regel „freigegebener Bericht ersetzt Stempel“ gilt für sie nicht).
- `POST /berichte/:id/unterschrift` für eine Rolle, die schon unterschrieben hat → **409** (ersetzen nur über Zurückziehen). Der Bild-Abgleich (wiederverwendete/zurückgezogene Unterschrift) vergleicht die **dekodierten Bildpunkte** (PNG), nicht die Datei-Bytes.
- `version` ist **Pflicht** bei `POST …/unterschrift` und `POST …/personal-aktualisieren` (fehlt → 400, veraltet → 409 mit aktueller `version`).
- **Freigabe (Vier-Augen):** Wer die Unterschrift des Auftragnehmers (`an`) erfasst hat, darf denselben Bericht nicht freigeben (403) – außer der GF; eine solche GF-Selbstfreigabe wird im Protokoll und am Bericht markiert (`selbstfreigabe:true`) und im Monat als Warnung `typ:"selbstfreigabe"` gemeldet.

### Monat / Lohn (D-03, D-08)
- Sicherheitsnetz zusätzlich **über die Tagesgrenze**: Überschneidet sich eine freigegebene Berichtszeile mit gezählten Stempelzeiten oder Berichtszeilen eines anderen Tages, wird die Überschneidung am Berichtstag abgezogen (`ueberschneidung:true`, Warnung `ueberschneidung`, CSV-Hinweis).
- Warnung `typ:"abwesenheit_mit_stunden"`, wenn an einem Tag mit genehmigtem **K, U oder ZA** Arbeitsstunden gezählt werden; Hinweiszeile im Lohn-CSV.

### Abwesenheiten (D-09)
- Polier darf Schlechtwetter (SW) auch **für sich selbst** melden (`beantragt`).
- SW-Anträge bestätigen/ablehnen dürfen zusätzlich der **Bauleiter der Stamm-Baustelle** der Person (nicht für sich selbst). Andere Codes weiter nur Büro/Lohn.

### Inbetriebnahme (D-06)
- `npm run seed` (Testdaten) läuft **nur mit `BAUTAG_DEMO=1`**, sonst Abbruch mit Hinweis.
- **`node server/einrichten.js`** legt eine leere Echt-Datenbank an (Rechte-Matrix, Lohngruppen, Geräte und Material der Papiervorlage **ohne Preise**) und die erste GF: `--name "…" --pnr 1 --pin 123456` oder Umgebung `BAUTAG_GF_NAME`, `BAUTAG_GF_PNR`, `BAUTAG_GF_PIN`, sonst interaktive Abfrage. PIN-Regeln gelten (mind. 6 Ziffern). Bricht ab, wenn die Datenbank schon Benutzer enthält.

## 10. Nachkalkulation nach Positionen (Kundenvorgabe, verbindlich)

Grundlage: Excel-Vorlage des Betriebs `docs/vorlage/Nachkalkulation_Positionen_Vorlage_2026-04-01.xlsx` (Stand 01.04.2026, ~110 Positionen). **Positionen und Preise müssen je Bauvorhaben individuell anpassbar sein.**

### Begriffe
- **Positionskatalog (Firmenvorlage):** Gruppen in fester Reihenfolge `arbeit` (Arbeit), `transport` (Transport), `geraete` (Geräte), `eigenmaterial` (Eigenmaterial), `fremdmaterial` (Fremdmaterial), `abgaben` (Abgaben). Position = `{id, gruppe, bezeichnung, einheit, ep, sortierung, quelle?, aktiv}`. Einheiten wie in der Vorlage (`Std.`, `t`, `m³`, `m2`, `Stk`, `lfm`, `PA`, `VE` …). `PA`/`VE` = Betrag × Faktor (z. B. Lieferantenrechnung × 1,15, Maut × 1,05) – fachlich identisch zu Menge × EP, Oberfläche zeigt Hinweis „Rechnungsbetrag eingeben“.
- **Projektpositionen:** Beim Anlegen einer Baustelle (und per `POST /baustellen/:id/positionen/aus-vorlage` für bestehende) wird der Katalog **kopiert**. Danach je Baustelle frei änderbar: EP, Bezeichnung, Einheit, aktiv/ausgeblendet, Reihenfolge, eigene zusätzliche Positionen, Löschen (nur wenn keine Mengen gebucht, sonst ausblenden). Änderungen am Katalog wirken **nicht** rückwirkend auf bestehende Baustellen (optional „Preise aus Vorlage übernehmen“ je Baustelle mit Vorschau).
- **Quelle (Verknüpfung zum Bautagesbericht):** optional je Position `quelle = {art:"personal"|"geraet"|"material", ref:<lohngruppeId|geraeteCode|materialCode|"alle">, einheit?}`. Mengen fließen dann automatisch aus Berichten mit Status ≠ entwurf (Personalstunden, Gerätestunden, Materialmengen in passender Einheit). Startzuordnung beim Seed nach bestem Wissen, in der Oberfläche als „Zuordnung prüfen“ markiert.
- **Manuelle Mengen:** je Projektposition beliebig viele Einträge `{id, datum, menge, notiz}` (entspricht den Spalten C–L der Excel-Vorlage), z. B. Rechnungsbeträge für PA-Positionen, Maut, Landschaftsabgabe. Storno mit Protokoll.

### Rechnung
- Menge je Position = automatische Menge (Quelle) + Σ manuelle Mengen. Summe je Position = Menge × EP (kaufmännisch gerundet auf Cent).
- Gruppensummen und **Zusammenstellung** wie in der Vorlage: Summe Arbeit, Summe Transport, Summe Geräte, Eigenmaterial, Fremdmaterial, Summe Abgaben, je mit Anteil in % an der **Gesamtsumme**.
- **Nachkalkulationssumme** = Gesamtsumme der Positionen. **Ergebnis** = Auftragssumme gesamt − Nachkalkulationssumme (in €, und in % der Auftragssumme).
- **Budget-Verbrauch und Budget-Alarm (80/90/100 %) beziehen sich ab jetzt auf die Nachkalkulationssumme ÷ Auftragssumme gesamt** (Kundenwunsch: „wenn man mit der Nachkalkulation bei z. B. 80 % ist“). Die bisherige interne Kostenrechnung (Kostensätze/EK) bleibt als zusätzliche Ansicht „Interne Kosten“ erhalten.

### Rechte
- Lesen: `kalk_sehen` (Bauleiter nur eigene Baustellen). Polier/Mitarbeiter: nie (gesperrt wie bisher, keine €-Felder, keine Positions-EP).
- Projektpositionen ändern (EP, Bezeichnung, hinzufügen, ausblenden, Quelle): `preise_bearbeiten` (Büro/GF). Manuelle Mengen erfassen: `preise_bearbeiten` oder Bauleiter für eigene Baustellen.
- Katalog (Firmenvorlage) ändern: `preise_bearbeiten`. Alle Änderungen → Protokoll (nur mit `preise_sehen` lesbar).
- Optimistische Sperre wie Abschnitt 8: `version` je Projektposition.

### Endpunkte
- `GET /positionen/katalog` → `{stand, gruppen:[{schluessel, name, positionen:[...]}]}`
- `POST /positionen/katalog`, `PUT /positionen/katalog/:id`, `DELETE /positionen/katalog/:id` (deaktivieren)
- `POST /positionen/katalog/import` – Import einer Excel-Datei im Aufbau der Vorlage (Body: `{dateiBase64}`; Spalten A=Bezeichnung, B=EH, N=EP; Gruppen anhand der Summenzeilen „Summe Arbeit/Transport/Geräte“, „Eigenmaterial“, „Fremdmaterial“, „Summe Abgaben“). Antwort mit Vorschau `{neu, geaendert, unveraendert}`; `?uebernehmen=1` speichert.
- `GET /baustellen/:id/positionen` → `{baustelleId, auftragGesamt, gruppen:[{schluessel, name, summe, anteilProzent, positionen:[{id, bezeichnung, einheit, ep, mengeAuto, mengeManuell, menge, summe, quelle?, aktiv, version, eintraege:[...]}]}], gesamtsumme, ergebnis, ergebnisProzent, budgetVerbrauchProzent}`
- `POST /baustellen/:id/positionen` (eigene Position), `PUT /baustellen/:id/positionen/:pid` (`{version, ep?, bezeichnung?, einheit?, aktiv?, sortierung?, quelle?}`), `DELETE /baustellen/:id/positionen/:pid`
- `POST /baustellen/:id/positionen/aus-vorlage` (`{modus:"fehlende"|"preise", vorschau?:true}`)
- `POST /baustellen/:id/positionen/:pid/mengen` `{datum, menge, notiz?}`, `DELETE /baustellen/:id/positionen/:pid/mengen/:mid`
- `GET /baustellen/:id/positionen/export.xlsx` → Excel im Aufbau der Firmenvorlage (Spalten Bezeichnung, EH, Mengen je Eintrag/Bericht, ZS, EP, SUMME, Zusammenstellung mit %), Formeln wie in der Vorlage.
- `GET /kalkulation/:baustelleId` liefert zusätzlich `positionen:{gesamtsumme, ergebnis, ergebnisProzent, gruppen:[{schluessel,name,summe,anteilProzent}]}`.

### Seed
Der Katalog wird aus der Excel-Vorlage befüllt (alle Positionen, EP und Einheiten exakt wie in der Datei). `npm run seed` (Demo) kopiert ihn in alle Demo-Baustellen; `einrichten.js` legt den Katalog ebenfalls an.

### 10a. Vom Kunden bestätigt (13.11.2026)
- EP der Vorlage sind **Verrechnungspreise**. Nachkalkulation = Wert der Baustelle zu Firmensätzen, verglichen mit der Auftragssumme (Ergebnis = Auftragssumme − Nachkalkulationssumme).
- **PA-Positionen** (Lieferanten, Asphalt; EP 1,15) und **Maut (VE; EP 1,05)**: Menge = **Rechnungsbetrag netto in €**, EP = Aufschlagsfaktor. Oberfläche: Eingabefeld „Rechnungsbetrag (€)“, Anzeige „+15 %“ bzw. „+5 %“.
- **Landschaftsabgabe**: **0,25 € je Tonne Naturmaterial**. Menge wird **automatisch** berechnet = Σ Tonnen aller Positionen mit Kennzeichen `naturmaterial:true` (Einheit `t`), zusätzlich manuelle Einträge möglich. Kennzeichen je Katalog- und Projektposition änderbar. Startwert `naturmaterial:true` für: Sande (RK/Bruchsand), Kies, Rollschotter, Splitt, Wandschotter FSM, Grädermaterial; `false` für Recycling (RB, RA, RG, RMH), Erde, Bodenaushub, Bruch/Schutt, Holz/Wurzelstöcke. In der Oberfläche als „bitte prüfen“ markiert.

### 10b. Umsetzung Backend (Ergänzungen zu 10/10a)
- **Katalogquelle:** `server/daten/katalog_vorlage.json` wird mit `node server/katalog-excel.js` aus der Excel-Vorlage erzeugt (103 Positionen; EP und Einheiten exakt wie in der Datei, auch EP-Formeln wie „=14.5“). Ein Unit-Test vergleicht JSON und Excel. Bezeichnungen ohne führende/abschließende Leerzeichen.
- **Vorlagen-Besonderheit:** In der Vorlage rechnet „Summe Abgaben“ nur `SUM(O113:O113)` (ohne Maut). BauTag zählt **beide** Abgaben-Positionen (Landschaftsabgabe und Maut) in die Gruppe Abgaben – bitte mit dem Kunden bestätigen.
- **Quelle:** `ref` darf eine Liste sein (`{art:"geraet", ref:["verlege","schneid",…]}`); optional `faktor` (Umrechnung Bericht-Einheit → Positions-Einheit, z. B. lfm → Stk). Ohne `faktor` werden nur Mengen in passender Einheit übernommen (t = to, m3 = m³, m2 = m²), sonst Hinweis. `{art:"naturmaterial"}` = Landschaftsabgabe (10a). Mehrfach zugeordnete Bericht-Einträge erzeugen einen Hinweis.
- **Ausgeblendete Positionen** (`aktiv:false`) zählen nicht in Gruppen-/Gesamtsumme; haben sie Mengen, erscheint ein Hinweis.
- **Positionen je Projekt** zusätzlich: `katalogId`, `gruppe`, `sortierung`, `zuordnungPruefen`, `naturmaterial`, `naturmaterialPruefen`, `eintraege[].erstelltVonName`; Antwort zusätzlich `stand` (Katalogstand) und `hinweise`. Ohne `preise_sehen` (aber mit `kalk_sehen`): keine `ep`, `summe`, Gruppensummen, `gesamtsumme`, `ergebnis`, `auftragGesamt`.
- **`GET /kalkulation/:id`:** `positionen` enthält weiter die internen Listen (`lohn`, `geraete`, `material`, `fremd`, `leistungen`, `regie`) **und** neu `gesamtsumme`, `ergebnis`, `ergebnisProzent`, `gruppen`. `budgetVerbrauchProzent`/`status` beziehen sich auf die Nachkalkulationssumme; die interne Rechnung steht unter `interneKosten:{kosten, budgetVerbrauchProzent, db, dbProzent, status}`. Fremdleistungen zählen nur noch intern.
- **Katalog-PUT** nimmt optional `version` (409 bei veralteter). **Import** vergleicht über Gruppe + Bezeichnung + Einheit; fehlende Positionen werden nicht gelöscht; Übernahme setzt den Katalogstand auf das heutige Datum.
- **Export:** Spalte C = Menge aus Berichten, D–L = manuelle Einträge (ab dem 10. Eintrag in L zusammengefasst), M `=SUM(C:L)`, N EP, O `=ROUND(M*N;2)`, Summenzeilen `=SUM(…)`, Zusammenstellung mit `=WENN(Gesamt=0;0;…)` statt #DIV/0!. Zeile 1 Spalte A: „Nachkalkulation KST Name“. Die Datei rechnet beim Öffnen neu (in LibreOffice geprüft).
- **Protokoll-Arten** `katalog` und `nachkalkulation` (nur mit `preise_sehen` lesbar).

**Startzuordnung Bautagesbericht → Vorlage (alle „Zuordnung prüfen“):**

| Bautagesbericht | Position der Vorlage |
|---|---|
| Personal Polier, Vorarbeiter, Facharbeiter, Hilfsarbeiter, Lehrling (Std.) | Facharbeiter (Std.) |
| Personal LKW-Fahrer, Maschinist | – (in den Transport-/Gerätesätzen enthalten) |
| LKW 2-Achser / 3-Achser / 4-Achser | LKW 2A / LKW 3A / LKW 4A |
| LKW mit Kran 3-A | 3A-Kran |
| LKW mit Kran 4-A | LKW 4A Mulde und Kran |
| LKW Zug oder Sattel | LKW Sattel |
| LKW mit Tieflader | LKW Tieflader |
| Bagger 1,5 to. | Bagger 1,8 to. |
| Bagger 2,7 to. | Komatsu PC27 3 to |
| Bagger 9 to. | Mobilbagger 9-11 to |
| Bagger 23 to. | Kettenbagger 23 to |
| Bobcat | Minilader Bobcat 3,3 to |
| Radlader | Radlader Case 2,5 m3 |
| Hamm Walz 2 to. | Walze Hamm 3,0 to |
| Bomag BW 177 | Walze Bomag 7,0 to |
| Grabenwalze | Grabenwalze |
| Dumper | Dumper |
| Verlegemaschine, Schneidgerät, Kompressor, Handwalze, Rüttelplatte | Kleingeräte |
| Gräder | – (keine Position in der Vorlage) |
| Frostschutz (to) | Wandschotter FSM 0/63 (t) |
| Grädermaterial (to) | Grädermaterial KK 0/32 (t) |
| Splitt (to) | Splitt KK 2/4 oder KK 4/8 (t) |
| Aushub (to) | Bodenaushub, Kleinmenge bis 2000 to (t) |
| Betonbruch (to) | Betonbruch bis 80cm (t) |
| Asphaltbruch (to) | Asphaltbruch rein (t) |
| Beton C20/25 erdfeucht (m³) | Beton C 16/20 (m3) |
| Betonsteinpflaster 8 cm grau (m²) | Pflaster (m2) |
| Kanalrohr PVC DN 150 (lfm) | PVC DN150 (lfm) |
| Randleiste 8/25/100 (lfm) | Leistenstein 100/10/20 (Stk, Faktor 1) |
| Asphalt AC 11 deck (to) | – (Vorlage: Lieferantenrechnung „Asphalt“ PA, Betrag manuell) |
| Σ Tonnen Naturmaterial (10a) | Landschaftsabgabe (PA × 0,25) |

### 10c. Vom Kunden bestätigt (13.11.2026, zweite Runde)
- Maut **und** Landschaftsabgabe zählen beide zur „Summe Abgaben“ (die Excel-Formel `SUM(O113:O113)` war unvollständig).
- Für den Gräder wird **keine** Position angelegt (bleibt ohne Zuordnung).
- Stunden von LKW-Fahrern und Maschinisten sind in den Fahrzeug-/Gerätesätzen enthalten (keine eigene Arbeitsposition) – Zuordnung wie umgesetzt korrekt.
- Aktuelle Preislisten 2026 liegen unter `docs/preislisten/` (Geräte, Grube Breitenau, Pichler Kies). Abgleich mit dem Katalog: siehe Antwort an den Kunden; Änderungen am Katalog erst nach Kundenentscheid.

### 10d. Katalog-Anpassungen nach Abgleich mit den Preislisten 2026 (vom Kunden freigegeben, 13.11.2026)
- **Preis:** Rollschotter RK 16/63 → **12,50 €/t** (statt 14,50). Sand RK 0/8 und 0/16 gewaschen **bleiben 17,70 €/t** (keine zweite Werksposition).
- **Gerätenamen an Gerätepreisliste angleichen (Preise unverändert):** „Komatsu PC27 3 to“ → „Minibagger Takeuchi 3,0 t“; „Mobilbagger 9-11 to“ → „Mobilbagger 7-11 t“; „Minilader Bobcat 3,3 to“ → „Minilader CASE 3,5 t“; außerdem „Bagger 1,8 to.“ → „Minibagger Cat 1,8 t“, „Kettenbagger 23 to“ → „Kettenbagger CAT 320 23,0 t“, „Radlader Case 2,5 m3“ → „Radlader CASE 721 2,5 m3“, „Radlader Cat 3,5 m3“ → „Radlader CAT 950 M 3,5 m3“. Zuordnungen aus dem Bautagesbericht bleiben erhalten.
- **Neue Positionen** (Kennzeichen `herkunft:"preisliste_2026"`, in der Oberfläche „neu aus Preisliste 2026“):
  - Geräte: „Aufzahlung Meißel/Abbruchzange (50 % vom Regiepreis)“ – Einheit `Std.`, EP = 50 % des Stundensatzes; je eine Position für Minibagger Takeuchi (39,20), Mobilbagger (47,20), Kettenbagger CAT 320 (51,70).
  - Eigenmaterial (Deponie/Entsorgung, Pichler Kies, je t): Aushubmaterial Inertabfallqualität < 30 % b.f. Bestandteile 38,60; > 30 % 49,50; Aushubmaterial techn. Schüttmaterial < 5 Vol% 38,60; > 5 Vol% 49,50; verunreinigtes Aushubmaterial BRM-Deponiequalität < 30 % 38,60; > 30 % 49,50; Gleisschottermaterial o. ALSAG 38,60; Sortierkostenpauschale 20,00.
  - Eigenmaterial (Material, je t): Wandschotter KK ungewaschen 8,30 (`naturmaterial:true`); RMH III 0/32, U-A 1,70 (`naturmaterial:false`).
  - Abgaben/Gebühren (je Stk): Gefälligkeitswiegung 15,00; Abfallinformation 35,00; Fehlende grundlegende Charakterisierung 2.500,00.
- Betrifft den Firmenkatalog und – über „Aus Vorlage übernehmen“ – neue Baustellen; bestehende Baustellen werden nicht automatisch geändert. Demo-Seed verwendet den angepassten Katalog.

### 10e. Umsetzung 10c/10d (Backend)
- Katalogdaten = Excel-Vorlage (Basis, unverändert gelesen) **+ versionierte Anpassungsschicht** `server/daten/katalog_anpassungen.js` (Version `10d-2026-11-13`: Rollschotter RK 16/63 → 12,50; 7 Geräte umbenannt, Preise unverändert; 16 neue Positionen aus den Preislisten 2026). `node server/katalog-excel.js` erzeugt daraus `katalog_vorlage.json` (119 Positionen); der Unit-Test prüft „JSON = Excel + Anpassungen“ und jeden 10d-Wert.
- Neues Feld **`herkunft`** an Katalog- und Projektpositionen: `"vorlage_excel"` (aus der Excel-Vorlage bzw. Excel-Import), `"preisliste_2026"` (neu aus Preisliste 2026), `"eigen"` (selbst angelegt).
- Bestehende Firmenkataloge erhalten die Anpassung **einmalig** beim Serverstart (Einstellung `katalog_anpassungen`, Protokolleintrag). Bestehende Baustellen bleiben unverändert („Aus Vorlage übernehmen“ je Baustelle). Zuordnungen aus dem Bautagesbericht gelten unter den neuen Gerätenamen weiter.
- Abgaben = Landschaftsabgabe + Maut (+ neue Gebühren); kein Gräder (bestätigt, bleibt ohne Zuordnung).
- Neue Positionen „Aufzahlung Meißel/Abbruchzange … (50 % vom Regiepreis)“ heißen je Gerät „Aufzahlung Meißel/Abbruchzange Minibagger Takeuchi 3,0 t (50 % vom Regiepreis)“ usw. und stehen direkt hinter dem Gerät.

### 10f. Änderungen nach Prüfbericht 4 (Backend)
- **E-01 Landschaftsabgabe-Quelle:** `quelle.art:"naturmaterial"` wird nie stillschweigend entfernt. `PUT …{zuordnungPruefen:false}` (ohne `quelle`) ändert nur das Kennzeichen. `quelle:null` bei einer Position mit Naturmaterial-Quelle → **400**, außer zusätzlich `naturmaterialQuelleEntfernen:true`. `naturmaterial:true` ist nur bei Einheit `t` erlaubt (sonst 400); wechselt die Einheit weg von `t`, wird das Kennzeichen gelöscht. Positionen liefern `naturmaterialMoeglich` (Einheit ist `t`). Gilt für Katalog- und Projektpositionen.
- **E-02 Excel-Import:** Datei höchstens **5 MB** (Base64 im JSON höchstens ca. 6,8 MB; die JSON-Grenze dieser Route ist 7 MB, alle anderen Routen 2 MB). Vor dem Lesen wird das ZIP geprüft: höchstens 300 Einträge, je Eintrag höchstens 10 MB und insgesamt höchstens 25 MB entpackt (tatsächlich entpackt gemessen, nicht nur laut Verzeichnis), keine ZIP64-/verschlüsselten Einträge; Tabelle höchstens 5.000 Zeilen. Verstöße → 400. Es läuft immer nur **ein** Import gleichzeitig, sonst **409** `{code:"KONFLIKT"}`.
- **E-03 Bestands-Datenbanken:** Beim ersten Start mit diesem Stand werden einmalig (Einstellung `positionen_bestand`) alle Baustellen **ohne** Projektpositionen mit dem aktuellen Katalog befüllt (Zuordnungen „bitte prüfen“), alle alten Budget-Alarm-Zeilen gelöscht (Basis jetzt Nachkalkulationssumme, Einstellung `budget_basis:"positionen"`) und die Alarme neu bewertet; protokolliert. Hat eine Baustelle trotzdem keine Positionen, liefern `/kalkulation*` und `/baustellen/:id/positionen` `budgetVerbrauchProzent:null`, `positionenFehlen:true` und einen Hinweis statt 0 %.
- **E-04 Import und 10d:** Alte Excel-Namen der 10d-Umbenennungen werden der umbenannten Position zugeordnet (Vorschau `umbenannt:[{alt, neu}]`, keine doppelten Geräte). Weicht der EP einer Datei von einem in 10d freigegebenen Preis ab, steht die Position in `geaendert` mit `hinweis:"weicht von Preisliste-2026-Anpassung ab"` und `geschuetzt:true` und wird **nicht** übernommen, außer mit `?anpassungenUeberschreiben=1`.
- **E-05 Import-Prüfung:** Jede Zeile wie `POST /positionen/katalog`: EP 0 … 1.000.000 (auf Cent gerundet), Bezeichnung höchstens 200, Einheit 1–20 Zeichen. Vorschau zusätzlich `fehler:[{zeile, text}]`, `doppelt:[{zeile, bezeichnung, einheit}]`, `ohneSummenzeile:[{zeile, bezeichnung}]`. `?uebernehmen=1` mit Fehlern → 400 (nichts wird übernommen).
- **E-06 Rundung:** Mengen werden auf **3 Nachkommastellen** gerundet (beim Erfassen und je Eintrag); Summe je Position = RUNDEN(Menge × EP; 2), Gruppensumme = Summe der gerundeten Positionen – App und Excel-Export rechnen identisch. `anteilSummeProzent` = Summe der gerundeten Anteile (kann 99,9 oder 100,1 sein); im Export steht in der Zusammenstellung derselbe Wert.
- **E-07:** Der Bauleiter storniert nur **selbst erfasste** Mengeneinträge (sonst 403); fremde nur Büro/GF.
- **E-08:** Ohne `preise_sehen` werden bei PA-/VE-Positionen (Rechnungsbeträge) `menge`, `mengeAuto`, `mengeManuell` und die Einträge weggelassen; statt `eintraege` kommt `eintraegeAnzahl`.
- **E-09:** Hinweise auf Mehrfachzuordnung berücksichtigen nur aktive Positionen; mehrere aktive Positionen mit Naturmaterial-Quelle (doppelte Landschaftsabgabe) → Hinweis.
- **Entscheidungen der GF (13.11.2026):** (1) Der Bauleiter darf in der Nachkalkulation nach Positionen seiner **eigenen** Baustellen manuelle Mengen erfassen (wie umgesetzt); stornieren darf er nur selbst erfasste Einträge (E-07). (2) Der Bauleiter darf den **gesamten Firmen-Positionskatalog mit allen Preisen** sehen (`GET /positionen/katalog`, wie umgesetzt).

### 10g. Nachprüfung 4 (N-01)
- `POST /positionen/katalog/import?uebernehmen=1` mit fehlerhaften Zeilen → 400 im Standard-Fehlerformat (`fehler` = Text); die Zeilenliste steht unter `zeilenFehler: [{zeile, text}]`.

## 11. Servicebuch (Backend, verbindlich)

Grundlage: `app/SERVICEBUCH_ENTWURF.md` (Abschnitte 1–13) – gilt vollständig, soweit hier nichts anderes steht. Dieser Abschnitt hält die **Entscheidungen des Backends** zu offenen Punkten fest und ergänzt den Kundenwunsch **„Schäden mit Fotos“** (11.9). Präfix aller Routen: `/api/fuhrpark`. Alle Antworten ohne `preise_sehen` **ohne** €-Felder (Felder fehlen, nicht `null`); `EURO_FELDER` enthält zusätzlich `kostenJahr`, `kostenGesamt`, `kostenJeStunde`.

### 11.1 Rechte (Ergänzung zu Entwurf 2)
- Neues Recht `fuhrpark` („Fuhrpark und Servicebuch pflegen“): Standard Büro/GF, für alle Rollen als Ausnahme vergebbar (keine Sperrliste). Bestehende Datenbanken erhalten `buero.fuhrpark = gf.fuhrpark = 1` per Migration.
- **Leserecht Servicebuch** = `fuhrpark` **oder** `bericht_erstellen`.
- **€ sichtbar** = `preise_sehen` (unabhängig von der Baustelle; Fuhrpark ist nicht baustellenbezogen). Polier/Mitarbeiter: `preise_sehen` bleibt gesperrt → auch mit `fuhrpark` nie €.
- Kosten senden (`kosten` in `POST/PUT /eintraege`) ohne `preise_sehen` → **400** (`kosten: null` bzw. Feld weglassen ist erlaubt).

| Route | mitarbeiter | polier | bauleiter | buero | gf | mit `fuhrpark`-Ausnahme (MA/Polier) |
|---|---|---|---|---|---|---|
| `GET /anlagen`, `GET /anlagen/:id` (Kurzinfo) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `POST /zaehlerstaende`, `GET /zaehlerabfrage`, `POST /maengel`, `GET /maengel` (eigene) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `POST /schaeden`, `GET /schaeden` (Bereich, 11.9) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Leserecht: `GET /anlagen/:id/plan`, `/zaehler/:zid/verlauf`, `/eintraege`, `/vorlagen`, `/maengel` (alle), `GET /anlagen/:id/servicebuch.pdf` | 403 | ✔ | ✔ | ✔ | ✔ | ✔ |
| `fuhrpark`: Anlagen/Zähler/Plan/Vorlagen schreiben, Einträge, Storno, Mängel bearbeiten, Sperre, Ausscheiden, Korrektur/Tausch, `/fristen`, `/uebersicht`, `/export.csv` | 403 | 403 | 403 | ✔ | ✔ | ✔ |
| `?kosten=1` (PDF/CSV) | 403 | 403 | ✔ mit `fuhrpark`/Leserecht | ✔ | ✔ | **403** |

### 11.2 Entscheidungen zur Fälligkeit (Ergänzung zu Entwurf 5)
- Standardwerte, wenn in der Regel nicht angegeben: `vorlaufTage 90`, `toleranzNachTage 14` (nur wenn `toleranzNachMonate` fehlt), `toleranzVorMonate 0`, `toleranzNachMonate 0` (bei `folgeMonate`), `vorlaufStunden 50`, `vorlaufKm 2000`, `zaehlerArtStunden "bh"`.
- `einmaligAm`: `vorlaufEff = vorlaufTage` (nicht gedrittelt). Nach Erledigung (`letzteDatum` ≥ Anlage der Frist bzw. ein Eintrag hat sie erledigt) → `status:"erledigt"`.
- Vorlagen-Platzhalter: `{"datumAus":"vertragsende"}` (Vorlage `vertrag_leasing`: `einmaligAm` wird beim Anlegen aus `anlage.vertragsende` übernommen, fehlt es → 400; ändert sich `vertragsende` per `PUT /anlagen/:id`, wird die Position mitgeführt) und `{"stichtagJeAnlage":true}` (Vorlage `vertrag_versicherung`: `regel.jaehrlichAm` muss beim Anlegen in `POST /anlagen/:id/plan` als `regel` mitgegeben werden, sonst 400).
- `POST /anlagen/:id/plan {vorlageSchluessel, regel?}`: `regel` wird über die Vorlagen-Regel gelegt (Felder ersetzen).
- Status-Rangfolge: `ueberfaellig` > `faellig` > `bald` > `unvollstaendig` > `ok` > `erledigt`. `unvollstaendig` (z. B. Erstzulassung fehlt, Zähler der Art fehlt) hat `hinweis`, Ampel `gelb`, zählt im Anlagenstatus **nicht** (bleibt `einsatzbereit`).
- Ampel Position: `ueberfaellig`/`faellig` → `rot`, `bald`/`unvollstaendig` → `gelb`, sonst `gruen`. Ampel Anlage: `gesperrt` → immer `rot` (+ `gesperrt:true`), `faellig` → `rot`, `bald` → `gelb`, `einsatzbereit` → `gruen`, `ausgeschieden` → `grau`.
- `letzteZaehler` / `faelligBei` / `rest` sind **Gesamtstände** (`wert` = Anzeige + Versatz aus Zählertausch). Ohne Zählertausch ist das die Anzeige am Gerät.
- „Stand am `letzte_datum`“ = jüngster gültiger Stand mit `datum ≤ letzte_datum`.
- Zählerstart wird als Zählerstand mit Quelle `start` gespeichert (gilt als echter Stand).
- Storno eines Eintrags: Je betroffener Position gilt danach der jüngste **nicht stornierte** Eintrag, der sie erledigt hat, sonst der **Startwert** (Werte beim Anlegen bzw. letztes händisches Setzen mit `grund`). Mit dem Eintrag als `behoben` markierte Mängel/Schäden gehen auf `offen`/`gemeldet` zurück; eine Sperre wegen `schwere_maengel` bleibt bis zur Entsperrung.
- `zyklus` der Erinnerung: Datumskriterium `faelligAm` (`YYYY-MM` bei `monatsgenau`, sonst `YYYY-MM-DD`), Zählerkriterium `<art><faelligBei>` (z. B. `bh4500`) – maßgeblich ist das Kriterium aus `grund`. Erreichte Stufen je (Position, Zyklus) werden gespeichert (Tabelle `fuhrpark_erinnerung`); springt eine Position direkt auf eine höhere Stufe, gelten die niedrigeren als erledigt (nur die höchste wird gemeldet).

### 11.3 Antwortformate
- **Anlage (Liste)** `GET /anlagen?klasse&status&standort&suche&inaktiv=1&verantwortlich=ich`:
  `{id, nummer, bezeichnung, klasse, fahrzeugklasse, kennzeichen, geraetId, geraet?:{id,code,name}, standort:{baustelleId?, kst?, name?, text, quelle:"bericht"|"manuell"|null, datum?}, verantwortlich?:{id,name}, status:"einsatzbereit"|"bald"|"faellig"|"gesperrt"|"ausgeschieden", ampel, gesperrt, sperrGruende:[{typ:"manuell"|"mangel"|"schaden"|"frist"|"pruefung", text, seit?}], naechsterTermin?:{planpositionId, titel, datum, status, grund}, zaehler:[{id, art, einheit, aktuell, geschaetzt}], offeneMaengel, offeneSchaeden, kostenJahr?}`.
  `standort` = Baustellen-ID oder `ohne` (Bauhof/unbekannt); `suche` durchsucht Nummer, Bezeichnung, Kennzeichen, FIN, Hersteller, Typ; `verantwortlich=ich` = eigene Fahrzeuge. `einheit`: `km` | `Std.` | `Hübe` (hub).
- **Anlage (Detail)** `GET /anlagen/:id` = Liste + `{hersteller, typ, fin, baujahr, erstzulassung, hzgKg, eigentum, vertragsende, versicherung, notiz, ausgeschieden, verantwortlichId, standortBaustelleId, standortText, sperre?:{grund, seit, von:{id,name}}, erstellt, version, leserecht, zaehler:[Zähler], naechsteTermine:[max. 3 {planpositionId,titel,status,naechstesDatum,grund}], maengel:[offene], schaeden:[offene, im Sichtbereich]}`; **nur mit Leserecht** zusätzlich `plan:[Planposition]`, `letzteEintraege:[5]`; mit `preise_sehen` zusätzlich `kostenJahr, kostenGesamt, kostenJeStunde, verrechnungssatz`. Ohne Leserecht enthält `maengel` nur eigene Meldungen.
- **Zähler**: `{id, art, einheit, aktiv, ausBericht, startstand, startdatum, versatz, aktuell, geschaetzt, letzterStand:{id, wert, anzeige, datum, quelle}, wochenschnitt, schnittQuelle:"ablesung"|"bericht"|null, unplausibel:<Anzahl offener unplausibler Stände>}`.
- **Planposition**: `{id, anlageId, titel, art, vorlage?:{id, schluessel, pruefen}, regel, letzteDatum, letzteZaehler, letzteEintragId, status, ampel, grund:"Datum"|"Betriebsstunden"|"Brecherstunden"|"Kranstunden"|"Hubzahl"|"Kilometer"|null, hinweis?, faelligAm?, fruehestens?, spaetestens?, faelligBei?:{art, wert}, rest?:{art, wert}, prognoseAm?, naechstesDatum?, sperrt, kriterien:[{typ:"datum", status, faelligAm, fruehestens?, spaetestens, vorlaufTage} | {typ:"zaehler", art, status, faelligBei, aktuell, rest, prognoseAm, vorlaufTage}], aktiv, version}`.
- **Eintrag**: `{id, anlageId, anlage:{id,nummer,bezeichnung,kennzeichen}, art, datum, werkstatt, titel, arbeiten, teile, arbeitsstundenIntern, kosten?, rechnungNr, pruefErgebnis, pruefer, zaehler:[{zaehlerstandId, art, anzeige, wert, status}], erledigt:[{planpositionId, titel}], maengel:[ids], storniert?:{zeit, grund, von:{id,name}}, erfasst, erfasstVon:{id,name}, version}`. `GET /eintraege/:id` (Leserecht) liefert einen Eintrag. `POST` → 201 Eintrag + `warnungen:[text]` (unplausible Stände).
- **Mangel**: `{id, anlageId, anlage:{id,nummer,bezeichnung,kennzeichen}, text, dringlichkeit, status, baustelleId, gemeldet, gemeldetVon:{id,name}, bearbeitet, bearbeitetVon?:{id,name}, notiz, eintragId}`. `PUT /maengel/:id` nimmt optional `version` (Mangel hat `version`).
- **Zählerstand** (`stand` in `POST /zaehlerstaende`, `punkte` im Verlauf): `{id, zaehlerId, anlageId, art, datum, anzeige, wert, quelle, status, hinweis, notiz, eintragId, erfasst, erfasstVon:{id,name}, grund}`. `POST /zaehlerstaende` → 201 `{stand, warnung?, hinweis?}`, idempotente Wiederholung → 200 mit demselben `stand`. Datum fehlt = heute. Zähler muss aktiv, Anlage nicht ausgeschieden sein. `fuhrpark` darf beliebig weit zurück eintragen (sonst 62 Tage).
- `PUT /zaehlerstaende/:id {status?, anzeige?, grund}`: Stände mit Quelle `tausch_alt`/`tausch_neu` sind nicht änderbar (400). `POST /zaehler/:zid/tausch`: nur, wenn nach dem Tauschdatum keine gültigen Stände liegen (sonst 400).
- **Vorlage**: `{id, schluessel, titel, art, klassen, regel, rechtsgrundlage, quelleUrl, pruefen, gueltigAb, aktiv, version}`; `klassen`-Einträge: `"lkw"`, `"lkw:N3"`, `"lkw+kran"` (LKW mit Kranzähler), `"alle"`.
- `POST /anlagen` ohne `vorlagen` → Antwort enthält `vorlagenVorschlag:[{schluessel, titel, art, pruefen, empfohlen}]` (`empfohlen:false` z. B. für `hebezeug_amvo`; inaktive Vorlagen werden nicht vorgeschlagen). `vorlagen` darf Schlüssel oder Objekte `{schluessel, letzteDatum?, letzteZaehler?, regel?}` enthalten.
- `PUT /anlagen/:id`: alle Stammdatenfelder (camelCase wie im Detail), `standortBaustelleId`/`standortText` setzen den Standort händisch (Datum = heute, gilt bis zu einem jüngeren Bericht), `ausgeschieden:null` reaktiviert. Kennzeichen/FIN unter aktiven Anlagen eindeutig, Nummer immer eindeutig → 409.
- `POST /anlagen/:id/sperre {gesperrt, grund}`: `grund` Pflicht (3–500 Zeichen) in beide Richtungen. Entsperren hebt nur die **manuelle** Sperre auf (Mangel „sofort“, Schaden „nicht einsatzfähig“, überfällige sperrende Frist sperren weiter).
- `POST /vorlagen/:id/anwenden {anlageIds?, vorschau?, ersetztVorlage?}` → `{geaendert:[{anlageId, anlage, planpositionId, titel, alt:{status,naechstesDatum}, neu:{status,naechstesDatum}}], angewendet:bool}`. Mit `ersetztVorlage:"57a_m1"` werden die Positionen der genannten Vorlage auf diese Vorlage umgestellt (Titel, Regel, Herkunft) – für den Umstieg auf `57a_m1_2027`.
- **Übersicht** `GET /uebersicht` → `{anzahl:{einsatzbereit, bald, faellig, gesperrt, ausgeschieden, offeneMaengel, offeneSchaeden}, ueberfaellig:[Frist], naechsteTermine:[Frist, nächste 90 Tage], offeneMaengel:[Mangel], offeneSchaeden:[Schaden], unplausibleStaende:[Zählerstand + anlage], nichtZugeordnet:[{geraetId, code, name, stunden, berichte}], kostenJahr?}`.
- **Frist** (`GET /fristen?bis&klasse&art`): `{anlageId, anlage:{bezeichnung,kennzeichen,klasse,nummer}, planpositionId, titel, art, status, ampel, naechstesDatum, faelligAm?, spaetestens?, prognoseAm?, faelligBei?, rest?, grund, pruefen}`; enthalten sind alle Positionen mit `naechstesDatum ≤ bis` **oder** Status `bald`/`faellig`/`ueberfaellig`/`unvollstaendig` (unvollständige am Ende).
- **CSV** `GET /export.csv?art=fristen|eintraege|anlagen&von&bis&kosten=1`: Semikolon, UTF-8 mit BOM, Dezimalkomma. Spalte „Kosten netto“ **nur mit `kosten=1` und `preise_sehen`** (ohne Recht → 403) – Standard ohne €. Protokoll `export`.
- **PDF** `GET /anlagen/:id/servicebuch.pdf?kosten=1` (Leserecht): Standard ohne €; `kosten=1` nur mit `preise_sehen` (sonst 403).
- **Benachrichtigungen**: `typ:"fuhrpark"`, zusätzlich Feld `anlageId` (nur bei Fuhrpark-Meldungen). Texte enthalten nie €.
- **Prüflauf** `pruefeFuhrpark`: beim Start, stündlich und nach jeder relevanten Änderung (Entwurf 6). Wochen-Zusammenfassung und Zählerabfrage nur montags ab 06:00 Wien (Kalenderwoche nach ISO 8601).

### 11.4 Bautagesbericht, Geräte, Stempeln (additiv, Entwurf 7)
- `GET /api/geraete` → je Gerät zusätzlich `anlagen:[{id, nummer, bezeichnung, kennzeichen, status, gesperrt}]` (nur aktive).
- `GET /api/berichte/:id` → `geraete[]` zusätzlich `anlageId` (nur wenn gesetzt) und `anlage:{id, bezeichnung, kennzeichen, status, gesperrt, zuordnung:"manuell"|"auto"}` (auch bei automatischer Zurechnung); oben zusätzlich `anlagenVorschlag:{[geraetId]: anlageId}` = zuletzt auf dieser Baustelle gewählte Anlage je Gerät.
- `PUT /api/berichte/:id` → `geraete[].anlageId` (optional, `null` = keine Auswahl); Antwort zusätzlich `hinweise:[{typ:"anlage_gesperrt", anlageId, text}]` (auch bei automatischer Zurechnung).
- `POST /api/zeit/stempeln` mit `typ:"gehen"` → zusätzlich `zaehlerAbfrage:[…]` (immer vorhanden, ggf. leer); bei anderen Typen fehlt das Feld.

### 11.5 Datenmodell-Ergänzungen (Migration 9)
Additiv zum Entwurf: `anlage.standort_datum` (Datum der händischen Standort-Setzung), `zaehlerstand.notiz`, `planposition.start_datum/start_zaehler` (Startwert für Storno), `mangel.version`, Tabellen `fuhrpark_erinnerung` (Stufen je Position/Zyklus) und `schaden_foto`; `mangel.anlage_id` darf leer sein (nur Schäden an fremden/unbekannten Geräten).

### 11.9 Schäden mit Fotos (Kundenwunsch 13.11.2026)
Schadensmeldung = erweiterter Mangel (gleiche Tabelle `mangel`, `typ:'schaden'`), damit Sperre und Verknüpfung mit Einträgen gleich funktionieren. Schäden erscheinen **nicht** in `/maengel`, sondern nur unter `/schaeden`.
- **Schaden**: `{id, clientId, anlageId|null, anlage|null, fremdGeraet|null, baustelleId|null, baustelle?:{id,kst,name}, zeitpunkt, art:"defekt"|"verschleiss"|"unfall"|"beschaedigung_dritte"|"sonstiges", ursache, beschreibung, einsatzfaehig:"ja"|"eingeschraenkt"|"nein", status:"gemeldet"|"in_bearbeitung"|"behoben"|"abgelehnt", kommentar, eintragId, eintrag?:{id, art, datum, titel, kosten?}, gemeldet, gemeldetVon:{id,name}, bearbeitet, bearbeitetVon?:{id,name}, fotos:[{id, dateiname, mime, groesse, erstellt, erstelltVon:{id,name}, url}], version, darfFotos, darfBearbeiten}`.
- `GET /schaeden?anlageId&status&baustelleId` · `GET /schaeden/:id` (außerhalb des Sichtbereichs → 403).
- `POST /schaeden` (alle) `{clientId?, anlageId? | fremdGeraet?, baustelleId?, zeitpunkt?, art, ursache (10–2000), beschreibung? (≤ 4000), einsatzfaehig, fotos?:[{bildBase64, dateiname}]}` → 201; gleiche `clientId` desselben Melders → 200 mit der bestehenden Meldung (kein Duplikat, Fotos werden nicht doppelt gespeichert). Genau eines von `anlageId`/`fremdGeraet` (3–200 Zeichen). `zeitpunkt` ISO mit Zeitzone, höchstens 1 Jahr zurück; ein Zeitpunkt in der Zukunft (vorgehende Geräteuhr) wird auf „jetzt“ gekappt (F-05); Standard jetzt. Höchstens **30 Meldungen je Melder in 24 Stunden** (Fuhrpark/Büro/GF ausgenommen) → sonst 429 `ZU_VIELE_VERSUCHE` (F-14).
- `einsatzfaehig:"nein"` sperrt die Anlage sofort (wie Mangel `sofort`, `sperrGruende[].typ:"schaden"`), solange der Schaden `gemeldet`/`in_bearbeitung` ist; Benachrichtigung sofort an `fuhrpark`, Büro und GF („Gerät stillgelegt (Schaden): …“) und Polier/Bauleiter des Standorts. Sonst Benachrichtigung „Schaden gemeldet: …“ an `fuhrpark`, Büro, GF. Abbildung auf die Dringlichkeit: `ja` → `hinweis`, `eingeschraenkt` → `bald`, `nein` → `sofort`.
- `PUT /schaeden/:id` (`fuhrpark` oder Rolle Büro/GF) `{version, status?, kommentar?, eintragId?, einsatzfaehig?, art?}`; Übergänge `gemeldet → in_bearbeitung | behoben | abgelehnt`, `in_bearbeitung → behoben | abgelehnt`, `behoben | abgelehnt → in_bearbeitung` (wieder öffnen). `abgelehnt` verlangt `kommentar`. `eintragId` muss zur selben Anlage gehören. Ein Eintrag mit `maengelIds:[schadenId]` setzt den Schaden auf `behoben`. Protokoll `fuhrpark_schaden`.
- **Sichtbereich:** eigene Meldungen immer; `fuhrpark`, Büro und GF alle; Polier: Meldungen zu Baustellen seines Bereichs oder von Personen seiner Partie; Bauleiter: Meldungen zu seinen Baustellen oder von Personen mit Stamm-Baustelle auf seinen Baustellen (F-12); sonst 403.
- **Fotos:** `POST /schaeden/:id/fotos {bildBase64, dateiname}` (Base64 oder data-URL) → 201 Foto (gleiches Bild erneut → 200). Erlaubt dem Melder für die eigene **offene** Meldung (`gemeldet`/`in_bearbeitung`) sowie `fuhrpark`/Büro/GF. Max. **5** Fotos je Meldung, max. **8 MB** dekodiert je Foto (Anfrage max. 12 MB – mehrere große Fotos einzeln nachreichen). Nur **JPEG, PNG, WebP**, erkannt an den Magic Bytes und strukturell geprüft (Name/MIME werden ignoriert); unbekannt/kaputt → 400. **Metadaten werden entfernt:** JPEG ohne APP1–APP15 (EXIF/XMP/GPS) und COM, nur JFIF-APP0 bleibt; PNG nur `IHDR, PLTE, tRNS, gAMA, cHRM, sRGB, pHYs, IDAT, IEND` (CRC geprüft, ohne `iCCP`); WebP nur `VP8 `/`VP8L`/`VP8X`/`ALPH` (ohne `EXIF`, `XMP `, `ICCP`; VP8X-Flags angepasst), animierte WebP → 400; JPEG nur DQT/DHT/DAC/SOFn/SOS/DRI/DNL + JFIF-APP0 (reservierte Segmente entfallen), DQT und DHT (bzw. arithmetische Kodierung) und Bilddaten Pflicht; Kantenlänge höchstens 12.000 px (F-07); Daten nach dem Bildende (Polyglot-Anhänge) werden abgeschnitten. Gespeichert unter `BAUTAG_UPLOADS` (Standard: Ordner `uploads` **neben der Datenbankdatei**, bei `:memory:`-DB ein temporärer Ordner) mit Zufallsnamen; nie statisch ausgeliefert. Scheitert das Speichern der Meldung, werden schon geschriebene Dateien gelöscht (F-14). Dateinamen ohne Steuer-/Formatzeichen (Unicode Cc/Cf).
- `GET /schaeden/:id/fotos/:fid` → Bild (Sichtbereich) mit passendem `Content-Type`, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline; filename="schaden-<id>-<fid>.<ext>"`, `Cache-Control: no-store` (geteilte Geräte), eigene CSP mit `sandbox`. `DELETE /schaeden/:id/fotos/:fid` (`fuhrpark` oder Büro/GF) → `{ok:true}`, Protokoll.
- Reparaturkosten nur über den verknüpften Eintrag und nur mit `preise_sehen` (`eintrag.kosten`).

### 11.10 Umsetzung (Backend, Stand 13.11.2026) – Ergänzungen und Präzisierungen
- **Zusätzliche Routen/Parameter:** `GET /fuhrpark/anlagen/:id/vorlagen-vorschlag` (`fuhrpark`) → `vorlagenVorschlag` für eine bestehende Anlage; `GET /fuhrpark/maengel?status=offen_alle` (offen + in Arbeit); `GET /fuhrpark/schaeden?status=offen` (gemeldet + in Bearbeitung); `GET /fuhrpark/uebersicht` zusätzlich `unvollstaendig:[Frist]`.
- **Texte der Erinnerungen:** Titel `"<Prüfung|Service|Kontrolle|Frist> <bald|fällig|überfällig>: <Bezeichnung>"` (Art der Position: gesetzlich/hersteller/intern/vertrag). Datumskriterium §57a: `"§57a-Begutachtung jährlich LKW … NK-303 BP: Begutachtungsmonat Oktober 2026 – überfällig seit 01.11.2026, Fahrzeug gesperrt"`; Zählerkriterium: `"Service 500 Std. bei 4.500 Std. – Stand ≈ 4.460 (geschätzt), voraussichtlich 26.11.2026"`. Weitere Schlüssel: `fp:unplausibel:<standId>`, `fp:mangel:<id>`, `fp:sperre:<anlageId>:<zeit>`, `fp:gesperrt-genutzt:<anlageId>:<berichtId>`, `fp:woche:<JJJJ-KW>`, `fp:zaehler:<anlageId>:<JJJJ-KW>`.
- **Storno bei Altbestand:** Hat der jüngste verbleibende Eintrag keine Zählerstand-Zeilen (aus Papieren übernommen), ergänzen die Startwerte desselben Tages die Zählerwerte.
- **Demo-Daten (`BAUTAG_DEMO=1`):** 32 fiktive Anlagen laut Entwurf 10 (IDs 1–32 = A01–A32), Polier **Gerhard Wallner (25)** hat die Ausnahme `fuhrpark`. Radlader-Stunden sind zu je einem Drittel A20, A21 und „nicht zugeordnet“, Gräder ohne Anlage. Seed-Einträge des Altbestands haben keine Zählerstand-Zeilen.
- **Bestehende Tests angepasst (additive Felder):** `GET /geraete` hat zusätzlich `anlagen`, Benachrichtigungen ggf. `anlageId`, Standard-Matrix Büro mit `fuhrpark`, Schema-Version nicht mehr fest 8.
- **Uploads:** Umgebungsvariable `BAUTAG_UPLOADS` (Standard `uploads` neben der Datenbank, also `app/data/uploads` für `app/data/bautag.db`, in `.gitignore`); bei `:memory:`-Datenbank ein temporärer Ordner, der beim Schließen gelöscht wird.

### 11.11 Änderungen nach Prüfbericht 5 (Backend, verbindlich)
Bezug: `app/PRUEFBERICHT_5_SERVICEBUCH.md`. Regressionstests: `tests/api/pruefbericht5-servicebuch.test.js`, `tests/unit/fuhrpark-faelligkeit.test.js` und `tests/unit/fuhrpark-bild.test.js` (Tests mit Befund-ID im Namen).
- **F-01:** Schaden an fremdem/unbekanntem Gerät (`fremdGeraet`) mit `einsatzfaehig:"nein"` → 201, Benachrichtigung „Schaden gemeldet: …“ an Fuhrpark/Büro/GF, **keine** Sperre (keine eigene Anlage).
- **F-02:** Neue Spalte `planposition.bezug_datum` (Migration 10): Anlagedatum der Position (Bestand: Erstzulassung bei `folgeMonate`, sonst Anlagedatum der Anlage). Ohne `letzteDatum` wird der Termin ab diesem Bezugspunkt bestimmt und wandert nicht mehr mit „heute“: eine nicht erfasste Begutachtung wird nach der Toleranz **überfällig**, sperrende Positionen sperren. Bei `folgeMonate` gilt der jüngste Termin, dessen Fenster zum Bezugspunkt schon offen war (sonst der erste), bei `jaehrlichAm` der jüngste Stichtag, dessen Vorlauf schon begonnen hatte. Beim Anlegen deshalb die letzte Durchführung aus den Papieren mitgeben (`letzteDatum`). Entwurf 5.2 angepasst.
- **F-03:** Ein Eintrag mit `planpositionIds` setzt `letzteDatum` nur, wenn er die jüngste nicht stornierte Durchführung ist (gleiche Rechnung wie beim Storno; ein jüngerer händischer Startwert geht vor).
- **F-04:** Storno setzt nur Zählerstände mit Quelle `eintrag` des Eintrags auf `ungueltig`; übernommene Stände (manuell, Start) bleiben gültig und werden nur vom Eintrag gelöst.
- **F-05:** siehe 11.9 (Zeitpunkt gekappt statt 400).
- **F-07:** siehe 11.9 (Bildprüfung).
- **F-08:** `maengelIds` nur für offene Meldungen (`offen`/`in_arbeit`), sonst 400.
- **F-09:** Prüfung mit `schwere_maengel` erledigt keine Planposition; `planpositionIds` werden ignoriert, die Antwort enthält eine `warnungen`-Zeile.
- **F-10:** `sperrGruende[].seit` und Datumsangaben im PDF nach Wiener Datum.
- **F-11:** Kommt eine zweite aktive Anlage zum selben Gerät dazu (Anlegen, Gerät ändern, Reaktivieren), werden die bisher automatisch zugerechneten Berichtszeilen der ersten Anlage fest zugeschrieben (`anlage_id`, Protokoll) – ihre Schätzung ändert sich nicht rückwirkend. Im Bautagesbericht darf dasselbe Gerät **mehrfach** vorkommen, wenn jede Zeile eine **andere, gewählte** Anlage hat (z. B. zwei Radlader); sonst 400. PDF und Nachkalkulation summieren die Stunden je Gerät.
- **F-12:** siehe 11.9 (Sichtbereich Bauleiter).
- **F-13:** Im Sperrgrund steht bei Schäden der neutrale Text „Schaden gemeldet – nicht einsatzfähig“ (mit `schadenId`); Ursache und Melder nur im Schadensdetail (Sichtbereich). Das Servicebuch-PDF listet Schäden nur im Sichtbereich des Abrufenden. Polier/Bauleiter des Standorts ohne Fuhrpark-Recht erhalten bei Sperren durch Schäden eine Benachrichtigung ohne Ursache.
- **F-14:** Upload-Standardordner neben der Datenbank; Dateien gescheiterter Meldungen werden gelöscht; Mengengrenze 30 Meldungen/24 h; Sicherung: siehe `server/README.md`.
- **F-15:** Dokumentation an den Code angeglichen (`Cache-Control: no-store`; `einmaligAm` erledigt nur mit `letzteDatum ≥ bezug_datum`).
- **F-06, F-16:** Oberfläche (Warteschlange); der Server antwortet bei abgelehnten Fotos mit 400/403 und Text.

## 12. Ausbaustufe 2 (verbindlich)

Stand 13.11.2026. Gilt zusätzlich zu 1–11; bei Widerspruch gilt 12. Alle neuen Antworten ohne `preise_sehen` **ohne** €-Felder (Felder fehlen). Neue €-Feldnamen im Sicherheitsnetz: `epVerlauf`, `epGeplant`, `perioden` (Preis-Verlauf-Routen sind nur mit `preise_sehen` erreichbar). Fehlerformat wie Abschnitt 3.

### 12.1 Betrieb (Deployment)
- Ordner `deploy/` im Repository: `Dockerfile` (node:22-slim, Benutzer `node`, `HEALTHCHECK` auf `/api/gesundheit`), `docker-compose.yml` (Dienste `app` und `caddy`; Caddy holt HTTPS-Zertifikate automatisch), `Caddyfile`, `.env.beispiel`, `installieren.sh` (ein Befehl auf frischem Ubuntu 24.04), `backup.sh`, `update.sh`, `ANLEITUNG.md` (für den Inhaber, deutsch).
- Umgebungsvariablen (zusätzlich zu 1/7): `BAUTAG_DOMAIN`, `BAUTAG_EMAIL` (für Let's Encrypt, nur Caddy), `BAUTAG_SCHLUESSEL` (≥ 32 Zeichen, verschlüsselt Geheimnisse in der DB: SMTP-Passwort, TOTP-Geheimnisse, privater VAPID-Schlüssel), `BAUTAG_URL` (öffentliche Adresse, z. B. `https://bautag.firma.at`; für Links in Push/E-Mail und VAPID-Subject), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` (`1` = TLS ab Verbindungsbeginn), `BAUTAG_WETTER` (`0` schaltet den Wetterabruf ab), `BAUTAG_ZEITZONE` bleibt Europe/Vienna.
- Sicherung: `node server/sicherung.js <Zielordner> [--uploads <Ordner>]` erstellt eine **konsistente** Kopie der Datenbank (SQLite-Backup-API, auch bei laufendem Server) `bautag-JJJJ-MM-TT.db` plus `uploads-JJJJ-MM-TT.tar.gz` und rotiert: 14 tägliche, 8 wöchentliche (Sonntag) Stände. Ausgabe JSON `{datei, uploads, geloescht:[…]}`. `deploy/backup.sh` ruft das im Container auf.
- `GET /api/gesundheit` unverändert (`{ok, version, db}`), wird vom Container-Healthcheck genutzt.
- **Sicherung „sehr sicher“ (3-2-1):** (a) täglich 02:30 lokaler, konsistenter Stand auf dem Server; (b) **verschlüsselte** externe Kopie mit `restic` bei einem zweiten Anbieter in der EU (SFTP/Storage Box oder S3), Aufbewahrung 14 täglich / 8 wöchentlich / 12 monatlich; (c) optional dritte Kopie im Büro (`deploy/nas-kopie.sh`, `restic copy`, bleibt verschlüsselt). Sonntags automatischer **Wiederherstellungstest** (neuester externer Stand → Probeordner → `integrity_check` + Zeilenzahlen). Details: `deploy/SICHERHEIT.md`, Wiederherstellung: `deploy/wiederherstellen.sh`.
- `node server/sicherung.js status <lokal|offsite|test> <ok|fehler> [Text]` meldet das Ergebnis in die Einstellung `sicherung`; `node server/sicherung.js pruefen <Datei>` → `{ok, integritaet, schemaVersion, tabellen:{…}}`.
- `GET /system/sicherung` (Recht `benutzer`) → `{aktiv, lokal, offsite, test, grenzenStunden:{lokal:26, offsite:26, test:192}, warnungen:[{art, text}]}`; je Art `{zeit, ok, text, letzteOk}` oder `null`. `aktiv` = Server-Betrieb (`BAUTAG_SICHERUNG_PRUEFEN=1`, im Container gesetzt) oder schon ein Status gemeldet.
- **Alarm:** Stündlich: schlägt ein Schritt fehl oder ist die letzte erfolgreiche lokale/externe Sicherung älter als 26 Std. (Test: 8 Tage), erhält jede aktive GF eine Benachrichtigung `typ:"sicherheit"`, Titel „Datensicherung: bitte prüfen“ (je Tag und Befund einmal, auch per Push) und – wenn E-Mail eingerichtet – eine E-Mail an `alarmAn` (12.5). Ist die App nicht erreichbar, schickt `backup.sh` die Warnung per `sendmail` an `ALARM_EMAIL`.

### 12.2 Preise mit „gültig ab“ (löst M-08)
Jede Preisänderung ist ein **Stand** mit `gueltigAb` (Datum, Wiener Zeit). Alle Rechnungen verwenden den Preis, der **am Tag des Berichts bzw. Eintrags** gilt. Bestehende Preise gelten per Migration seit `2000-01-01`. Betroffen: Lohngruppe `kostensatz`/`regiesatz`, Gerät `kostensatz`/`verrechnungssatz`, Material `ek`/`vk`, Leistung `ep`, Katalog-`ep`, Projektpositions-`ep`.
- **Regeln:** `gueltigAb` fehlt = heute. Zukunft erlaubt (höchstens 2 Jahre voraus). **Rückwirkend** (`gueltigAb` < heute) nur mit `rueckwirkend:true` (sonst 400 „… rückwirkend … bestätigen“); wird mit `rueckwirkend:true` protokolliert und löst die Budget-Prüfung aus. Gleiches Datum wie ein bestehender Stand ersetzt diesen. Frühestes Datum 2000-01-01.
- `GET /preise` → je Eintrag zusätzlich `gueltigAb:{[feld]: "YYYY-MM-DD"}` (Stand des heutigen Werts) und `geplant:[{id, feld, wert, gueltigAb}]` (künftige Stände). Die Felder `kostensatz` usw. zeigen den **heute** gültigen Wert.
- `PUT /preise/:art/:id` `{feld, wert, gueltigAb?, rueckwirkend?}` → Eintrag wie in `GET /preise`.
- `GET /preise/:art/:id/verlauf` (`preise_sehen`) → `[{id, feld, wert, gueltigAb, erstellt, erstelltVon:{id,name}|null}]` (aufsteigend nach `feld`, `gueltigAb`).
- `DELETE /preise/:art/:id/verlauf/:vid` (`preise_bearbeiten`) → `{ok:true}`; nur **künftige** Stände (`gueltigAb` > heute), sonst 409.
- **Katalog:** `PUT /positionen/katalog/:id` nimmt bei `ep` zusätzlich `gueltigAb`, `rueckwirkend`. Katalogposition zusätzlich `epAb` und `epGeplant:[{id, ep, gueltigAb}]`. `GET /positionen/katalog/:id/verlauf` → `[{id, ep, gueltigAb, erstellt, erstelltVon}]`, `DELETE /positionen/katalog/:id/verlauf/:vid` (nur künftige). Beim Kopieren in eine Baustelle werden **alle** Stände ab dem heute gültigen mitkopiert (eine angekündigte Preisliste gilt dann auch in neuen Baustellen). `POST /positionen/katalog/import?uebernehmen=1&gueltigAb=YYYY-MM-DD[&rueckwirkend=1]` – geänderte Preise werden Stände mit diesem Datum.
- **Projektposition:** `PUT /baustellen/:id/positionen/:pid` nimmt bei `ep` zusätzlich `gueltigAb`, `rueckwirkend`; `POST …/aus-vorlage {modus:"preise", gueltigAb?, rueckwirkend?}`. Position (mit Preisrecht) zusätzlich `epAb` und, **nur wenn sich der EP im Projekt geändert hat**, `perioden:[{gueltigAb, bis|null, ep, menge, summe}]` sowie `epGeplant`. Bei mehreren Perioden gilt: `summe` = Σ der auf Cent gerundeten Periodensummen, `ep` = heute gültiger EP, `menge` = Gesamtmenge. `GET /baustellen/:id/positionen/:pid/verlauf`, `DELETE …/positionen/:pid/verlauf/:vid` (nur künftige).
- **Mengen je Datum:** Automatische Mengen aus Berichten zählen zum Berichtsdatum, manuelle Einträge zu ihrem `datum`, die Landschaftsabgabe zum Datum der Naturmaterial-Tonnen.
- **Excel-Export** der Nachkalkulation: Eine Position mit mehreren Perioden erscheint als **eine Zeile je Periode**: `Bezeichnung (bis TT.MM.JJJJ)`, `Bezeichnung (ab TT.MM.JJJJ)` – jede Zeile mit eigener Menge, eigenem EP und `ROUND(M*N;2)`. Positionen ohne Preisänderung bleiben eine Zeile.
- **Interne Kosten** (`/kalkulation`): Personal-/Geräte-/Materialkosten mit dem Satz am Berichtsdatum, Regie mit dem Regiesatz am Berichtsdatum, Leistungsmeldungen mit dem EP am Meldedatum. Positionen `lohn/geraete/material/leistungen` werden **je Satz** getrennt aufgeführt (gleiche ID kann mehrfach vorkommen, Feld `satz` bzw. `ep` unterscheidet). `kostenTag` im Bericht mit den Sätzen am Berichtsdatum.
- Die Lohngruppe der Person ist weiterhin die **aktuelle** (keine Historie der Einstufung – offener Punkt).
- Tritt ein künftiger Stand in Kraft, prüft der stündliche Lauf am ersten Lauf des Tages die Budgets aller Baustellen.

### 12.3 Push-Benachrichtigungen (Web Push, VAPID)
- VAPID-Schlüssel werden beim ersten Start erzeugt und in der DB gespeichert (privater Schlüssel verschlüsselt, wenn `BAUTAG_SCHLUESSEL` gesetzt). Integration `push` ist dann `angebunden:true`.
- `GET /push/schluessel` (angemeldet) → `{publicKey}` (Base64url, für `pushManager.subscribe({applicationServerKey})`).
- `POST /push/abo` `{endpoint (https-URL, ≤ 1000), keys:{p256dh, auth}, geraet? (≤ 100, z. B. „iPhone Josef“)}` → 201 `{id, geraet, erstellt}` (gleicher `endpoint` → 200, wird dem angemeldeten Benutzer zugeordnet). Höchstens 10 Abos je Benutzer (älteste fallen weg).
- `DELETE /push/abo` `{endpoint}` → `{ok:true}` (nur eigene). `GET /push/abos` → eigene `[{id, geraet, erstellt, zuletzt, fehler}]` (ohne Schlüssel). `DELETE /push/abos/:id` → eigenes Abo löschen.
- `GET /push/einstellungen` → `{typen:{budget, fuhrpark, schaden, abwesenheit, bericht, plan, azg, sicherheit, baustelle, rechnung, email}: bool}` (Standard alle `true`; nur Typen, die die Rolle erhalten kann, sind enthalten). `PUT /push/einstellungen` `{typen:{…}}` → gleiche Antwort.
- `POST /push/test` → schickt „Test-Benachrichtigung von BauTag“ an alle eigenen Abos → `{gesendet, fehler}`.
- **Versand:** Jede neue In-App-Benachrichtigung (Tabelle `benachrichtigung`) wird an die Abos des Empfängers geschickt, wenn der Typ in seinen Einstellungen aktiv ist. Push-Text: `{title, body, url, tag}` – `title` = Titel der Benachrichtigung, `body` = **neutraler Text ohne Beträge** (Budget: „Budget-Schwelle erreicht – Details in BauTag“; sonst der Text, aus dem jede Zahl mit €/EUR entfernt wird). Abos mit Antwort 404/410 werden gelöscht. Typ `schaden` = Fuhrpark-Benachrichtigungen zu Schäden (`schluessel` beginnt mit `fp:schaden`), sonst `fuhrpark`.
- Benachrichtigungstypen neu: `plan`, `email` (Versandfehler an GF/Büro).

### 12.4 Wetter (GeoSphere Austria, ohne Schlüssel)
- Baustelle: neue Felder `lat`, `lng` (Dezimalgrad, Österreich und Umgebung: lat 45–50, lng 8–18; `null` = unbekannt), schreiben mit `stammdaten`.
- `GET /baustellen/:id/wetter?datum=YYYY-MM-DD` (wer die Baustelle sehen darf; Standard heute) →
  `{verfuegbar:true, datum, quelle:"GeoSphere Austria – Data Hub (CC BY 4.0)", datensatz, abgerufen, stunden:[{zeit:"HH:MM", temperatur, niederschlag, wind, boeen?}], zusammenfassung:{text, temperatur, temperaturMin, temperaturMax, niederschlag, wind}, schlechtwetter:{vorschlag:bool, ab:"HH:MM"|null, gruende:[text], pruefen:true, regeln:[text]}}`
  oder `{verfuegbar:false, hinweis:"Wetter nicht verfügbar", grund}` (keine Koordinaten, Abruf gescheitert, Datum > morgen oder älter als 1 Jahr, `BAUTAG_WETTER=0`). Einheiten: °C, mm (Summe der Stunde), km/h.
- Daten: Tag ≥ heute → Vorhersage `nwp-v1-1h-2500m`; vergangene Tage → Analyse `inca-v1-1h-1km` (stündlich). Zwischenspeicher je Baustelle, Datum und Stunde des Abrufs (DB-Tabelle), Fehler werden 10 min gemerkt.
- **Schlechtwetter-Vorschlag (Prüfen – Grenzwerte bei der BUAK bestätigen):** Stunden 06:00–18:00 mit Temperatur > 32,5 °C, Niederschlag ≥ 1 mm in der Stunde, Wind ≥ 60 km/h oder Temperatur ≤ −10 °C. `ab` = erste solche Stunde. Die App entscheidet nie selbst (§ 5 BSchEG); der Vorschlag ist nur ein Hinweis.
- **Bericht:** `POST /berichte` füllt `wetter` automatisch (höchstens 4 s Wartezeit; sonst bleibt `wetter` leer), wenn die Baustelle Koordinaten hat. `POST /berichte/:id/wetter` (Bearbeitungsrecht, nur Entwurf ohne Unterschrift) → übernimmt die Werte erneut → Bericht-JSON + `wetterVorschlag` (= `schlechtwetter`). `wetter` = `{text, temperatur, niederschlag, wind, quelle}` (Text z. B. „bewölkt, 8–14 °C, 2,4 mm, Wind bis 25 km/h“). Bericht-JSON enthält zusätzlich `wetterVorschlag` (falls Wetterdaten im Zwischenspeicher).
- Integration `wetter` ist `angebunden:true`, solange `BAUTAG_WETTER` ≠ `0`.

### 12.5 E-Mail (SMTP)
- `GET /einstellungen/email` (Recht `benutzer`) → `{host, port, sicher, benutzer, absender, alarmAn, passwortGesetzt:bool, aktiv, quelle:"einstellung"|"umgebung"|null, schluesselVorhanden:bool}` (Passwort nie). `alarmAn` = Empfänger für Sicherungs- und Versandalarme (Standard `ALARM_EMAIL`).
- `PUT /einstellungen/email` (Recht `benutzer`) `{host, port, sicher, benutzer?, passwort?, absender, alarmAn?, aktiv}` → wie GET. `passwort` wird mit `BAUTAG_SCHLUESSEL` verschlüsselt gespeichert (AES-256-GCM); fehlt der Schlüssel → 400. `passwort:""` löscht es. Protokoll (ohne Passwort).
- `POST /einstellungen/email/test` `{an}` (Recht `benutzer`) → `{ok:true}` oder 502 `{code:"EMAIL_FEHLER", fehler}`. Protokoll.
- Umgebungsvariablen `SMTP_*` gelten, solange keine Einstellung gespeichert ist.
- **Bericht an den Auftraggeber:** Baustelle neues Feld `agEmail` (eine oder mehrere Adressen, durch `,` getrennt, ≤ 300) und `berichtMail:bool` (Standard `true`). Wird ein Bericht `unterschrieben` und ist E-Mail eingerichtet, `agEmail` gesetzt und `berichtMail` an, wird das **AG-PDF** (`fassung=ag`, ohne €) im Hintergrund verschickt. Manuell: `POST /berichte/:id/email` `{an?}` (Recht `bericht_freigeben` im Bereich oder `stammdaten`; Bericht mindestens `unterschrieben`) → 202 `{id, status:"wartet"}`.
- Bericht-JSON zusätzlich `emailVersand:[{id, zeit, an, status:"wartet"|"gesendet"|"fehler", fehler?}]` (nur für `bericht_freigeben`/`stammdaten`). Versandfehler → Benachrichtigung `typ:"email"` an Büro/GF und Protokoll.
- Integration `email` ist `angebunden:true`, wenn ein SMTP-Host (Einstellung oder Umgebung) gesetzt und aktiv ist.

### 12.6 Fotos im Bautagesbericht
- Gleiche Prüfung wie Schadensfotos (11.9: Magic Bytes, Struktur, Metadaten/GPS entfernt, 8 MB je Foto, JPEG/PNG/WebP, Anfrage ≤ 12 MB), Ablage unter `BAUTAG_UPLOADS/berichte`.
- `POST /berichte/:id/fotos` `{bildBase64, dateiname, beschreibung? (≤ 300)}` → 201 Foto (gleiches Bild im selben Bericht → 200). Recht: Bearbeitungsrecht des Berichts (`bericht_erstellen` im Bereich), nur Entwurf **ohne** Unterschrift (sonst 409). Höchstens **10** Fotos je Bericht (sonst 400).
- `PUT /berichte/:id/fotos/:fid` `{beschreibung}` (gleiche Regeln). `DELETE /berichte/:id/fotos/:fid` → `{ok:true}` (gleiche Regeln), Protokoll.
- `GET /berichte/:id/fotos/:fid` → Bild für alle, die den Bericht sehen dürfen (Header wie 11.9, Dateiname `bericht-<id>-<fid>.<ext>`).
- Bericht-JSON zusätzlich `fotos:[{id, dateiname, beschreibung, mime, groesse, erstellt, erstelltVon:{id,name}, url}]`.
- `GET /berichte/:id/pdf?fotos=1` hängt eine Fotoseite an (Vorschaubilder 2 × 3 je Seite mit Beschreibung; WebP als Hinweis „Bild im Format WebP – in der App ansehen“). Standard ohne Fotos. Fotos enthalten keine GPS-/EXIF-Daten.

### 12.7 Zwei-Faktor-Anmeldung (TOTP, RFC 6238)
- Für Rollen **bauleiter, buero, gf** (andere Rollen → 400). SHA-1, 6 Ziffern, 30 s, Toleranz ±1 Zeitschritt; ein Code gilt nur einmal.
- `GET /auth/2fa` → `{aktiv, pflicht, moeglich, restcodes}`.
- `POST /auth/2fa/einrichten` `{pin}` → `{geheimnis (Base32), otpauthUri, qrSvg (data:image/svg+xml;base64,…)}` (noch nicht aktiv; erneuter Aufruf ersetzt das Geheimnis).
- `POST /auth/2fa/bestaetigen` `{code}` → `{aktiv:true, wiederherstellungscodes:[10 × "xxxx-xxxx"]}` (nur dieses eine Mal im Klartext; gespeichert als Hash). Falscher Code → 400.
- `POST /auth/2fa/codes` `{code}` → neue 10 Wiederherstellungscodes (alte ungültig).
- `POST /auth/2fa/aus` `{pin, code}` → `{aktiv:false}`; ist 2FA für die Rolle Pflicht → 409.
- `DELETE /benutzer/:id/2fa` (Recht `benutzer`, nicht sich selbst) → setzt 2FA zurück (Gerät verloren), beendet Sitzungen, Protokoll, Benachrichtigung `sicherheit`.
- **Anmeldung:** Ist 2FA aktiv, antwortet `POST /auth/login` nach richtiger PIN mit `200 {zweiterFaktor:true, vorgang}` (ohne Sitzung). `POST /auth/login/2fa` `{vorgang, code}` (`code` = 6 Ziffern oder Wiederherstellungscode) → wie `/auth/login`. Ein Vorgang gilt 5 min und erlaubt 5 Versuche; Fehlversuche zählen in die Login-Sperre (429/423 wie Abschnitt 7/9).
- **Pflicht je Rolle:** `GET/PUT /einstellungen/sicherheit` (Recht `benutzer`) `{zweiFaktorPflicht:{bauleiter:bool, buero:bool, gf:bool}}`. Wer Pflicht hat und noch nicht eingerichtet ist, erhält nach dem Login auf alle Routen außer `/auth/*`, `/gesundheit` → 403 `{code:"2FA_EINRICHTEN"}`; `GET /auth/ich` zusätzlich `zweiFaktor:{aktiv, pflicht}`.
- Wiederherstellungscode verbraucht → Benachrichtigung `sicherheit` an den Benutzer.

### 12.8 Baustellenplaner (Einsatzplanung) – freigegeben 13.11.2026
Entwurf „Baustellenplaner“ (Wochenplan, Projektzeitplan, Handy „Mein Einsatz“, Polier „Meine Partie morgen“). **Keine €-Felder.**
- **Rechte:** Bearbeiten: Büro/GF (Rolle oder `stammdaten`) alle Baustellen; Bauleiter Einsätze auf **eigenen** Baustellen (er darf jede aktive Person/Anlage einteilen). Lesen Wochenplan: Büro/GF alle, Bauleiter alle Zeilen seiner Baustellen (Konflikte mit anderen Baustellen als „andere Baustelle“); Polier: `/plan/partie`, `/plan/ich`, Anfragen; Mitarbeiter: `/plan/ich`. Sonst 403.
- **Einsatz** (= Zelle Datum × Baustelle, eindeutig): `{id, datum, baustelleId, baustelle:{id,kst,name,kurz,adresse}, beginn:"HH:MM"|null, treffpunkt, fahrzeug:{anlageId?, bezeichnung?, text?}|null, arbeit (≤ 200), notiz (≤ 500), personen:[{benutzerId, name, rolle, kolonnePolierId?, gelesen?, bestaetigt?}], anlagen:[{anlageId, nummer, bezeichnung, kennzeichen, status, gesperrt}], kolonnen:[{polierId, name, anzahl}], veroeffentlicht:bool, geaendertNachVeroeffentlichung:bool, konflikte:[Konflikt], version}`. `gelesen/bestaetigt` nur für Planer und Polier.
- **Konflikt:** `{datum, typ:"person_doppelt"|"abwesenheit"|"anlage_doppelt"|"anlage_gesperrt"|"anlage_faellig"|"wetter", text, einsatzIds:[…], benutzerId?, anlageId?}`; Abwesenheit: genehmigt **und** beantragt (Text „Urlaub“/„Krank“ … nur mit `stammdaten`/`lohn`, sonst „abwesend“); Wetter: Schlechtwetter-Vorschlag (12.4) für Baustellen mit Koordinaten, nur heute bis +9 Tage (Vorhersage).
- `GET /plan/woche?von=YYYY-MM-DD&tage=5|7` (`von` wird auf Montag gesetzt) → `{von, bis, tage:[{datum, wochentag, feiertag?}], baustellen:[{id, kst, name, kurz, polier:{id,name}|null, phase}], einsaetze:[Einsatz], frei:{[datum]:{personen:[{benutzerId, name, rolle, status:"frei"|"abwesend", text?}], anlagen:[{anlageId, bezeichnung, kennzeichen, status, gesperrt, standort}]}}, konflikte:[Konflikt], kennzahlen:{[datum]:{eingeteilt, gesamt}}, unveroeffentlicht:Anzahl geänderter Einsätze}`. Baustellen = nicht archiviert, Phase `geplant`…`abgenommen` (ohne `angebot`/`storniert`) bzw. mit Einsatz in der Woche.
- `POST /plan/einsaetze` `{datum, baustelleId, beginn?, treffpunkt?, fahrzeugAnlageId?, fahrzeugText?, arbeit?, notiz?, benutzerIds?:[…], kolonnePolierIds?:[…], anlageIds?:[…]}` → 201 Einsatz (gibt es den Einsatz schon → 409 mit `id`). `kolonnePolierIds` = Polier + aktive Mitarbeiter/Poliere seiner Partie (Stamm-Baustelle des Poliers). Personen: Rollen mitarbeiter/polier/bauleiter, aktiv. Datum höchstens 7 Tage zurück, 366 voraus.
- `PUT /plan/einsaetze/:id` `{version, beginn?, treffpunkt?, fahrzeugAnlageId?, fahrzeugText?, arbeit?, notiz?}` · `DELETE /plan/einsaetze/:id`.
- `POST /plan/einsaetze/:id/personen` `{benutzerIds?, kolonnePolierId?, verschiebenVon?:einsatzId}` (Ziehen von einer anderen Zelle desselben Tages entfernt dort) · `DELETE /plan/einsaetze/:id/personen/:benutzerId`.
- `POST /plan/einsaetze/:id/anlagen` `{anlageIds, verschiebenVon?}` · `DELETE /plan/einsaetze/:id/anlagen/:anlageId`.
- Alle Schreib-Antworten enthalten den aktualisierten Einsatz und `konflikte` des Tages. Doppelte Einteilung wird **angelegt und als Konflikt** gemeldet (nicht abgelehnt).
- `POST /plan/vorwoche-uebernehmen` `{von (Montag der Zielwoche), baustelleIds?}` → `{angelegt, uebersprungen:[{datum, typ, text}]}`: kopiert Einsätze der Vorwoche (gleicher Wochentag); Personen mit Abwesenheit, schon eingeteilte Personen/Anlagen und gesperrte Anlagen werden übersprungen und gemeldet; bestehende Zielzellen bleiben.
- `POST /plan/veroeffentlichen` `{von, bis?}` (ein Tag oder Zeitraum ≤ 14 Tage; Bauleiter: nur seine Baustellen) → `{benachrichtigt, einsaetze}`: Jede eingeteilte Person erhält eine Benachrichtigung `typ:"plan"` (In-App + Push): Titel „Einsatz <heute|morgen|am Mi 18.11.>: <Baustelle>“, Text „Morgen 06:30 Baustelle 26-041 WHA Pitten, Treffpunkt Bauhof“. Poliere erhalten zusätzlich je Einsatz ihrer Partie/ Baustelle „Ihre Partie morgen: 6 Personen, 2 Geräte – WHA Pitten“. Nach Änderungen benachrichtigt eine erneute Veröffentlichung **nur betroffene** Personen („Geändert: …“; entfernte Personen „Einsatz entfällt am …“). Unveränderte Einsätze werden nicht erneut gemeldet.
- **Mein Einsatz** `GET /plan/ich?von&bis` (alle; Standard heute–+6) → `{morgen:Tag|null, tage:[{datum, wochentag, einsatz:{baustelle:{id,kst,name,adresse}, beginn, treffpunkt, polier:{id,name}|null, fahrzeug, arbeit, notiz, anlagen:[{bezeichnung,kennzeichen}], wetterHinweis?}|null, gelesen, bestaetigt, geaendert}]}` – nur **veröffentlichte** Einsätze; der Abruf setzt `gelesen`. `POST /plan/ich/bestaetigen` `{datum}` → `{ok:true}`.
- **Meine Partie** `GET /plan/partie?datum` (Polier; Standard morgen) → `{datum, einsaetze:[Einsatz mit personen[].gelesen/bestaetigt und anlagen[].hinweis (Servicebuch, z. B. „Service in 3 Wochen“)]}` – Einsätze, in denen er eingeteilt ist oder die auf Baustellen seines Bereichs liegen (nur veröffentlichte).
- **Änderung anfragen** `POST /plan/anfragen` `{datum, einsatzId?, text (3–500)}` (Polier, Bauleiter) → 201; Benachrichtigung `typ:"plan"` an Büro und Bauleiter der Baustelle. `GET /plan/anfragen?status=offen` (Planer) → `[{id, datum, einsatzId, text, von:{id,name}, zeit, status:"offen"|"erledigt", antwort?}]`; `PUT /plan/anfragen/:id` `{status:"erledigt", antwort?}` → Benachrichtigung an den Anfragenden.
- **Stempeluhr:** `GET /zeit/status` zusätzlich `geplant:{baustelleId, kst, name, beginn, treffpunkt}|null` (heutiger veröffentlichter Einsatz). `GET /zeit/kolonne?baustelleId&plan=1` liefert zusätzlich die **heute eingeplanten** Personen dieser Baustelle (Feld `geplant:true`, auch aus anderen Partien); `POST /zeit/kolonne` erlaubt eingeplante Personen ohne `gast:true`.
- **Projektzeitplan:** Abschnitte je Bauvorhaben `{id, baustelleId, art:"erdbau"|"kanal"|"unterbau"|"pflaster"|"asphalt"|"eigen", name, von, bis, sortierung, version}`. `GET /plan/zeitplan?von&bis&phase&archiv=1` → `{bauvorhaben:[{baustelle:{id,kst,name,phase,leistungsstandProzent?}, abschnitte:[…], meilensteine:[{art:"fertiggestellt"|"abgenommen"|"schlussrechnung"|"bezahlt"|"gewaehrleistung", datum, erreicht:bool}]}], filter:{[phase]:anzahl}, archivAnzahl}` (Büro/GF alle, Bauleiter eigene, Polier Baustellen seines Bereichs lesend; `leistungsstandProzent` nur mit `kalk_sehen`). `POST /baustellen/:id/abschnitte` `{art, name?, von, bis}` → 201 · `PUT /baustellen/:id/abschnitte/:aid` `{version, …}` · `DELETE …/:aid` (Bearbeiten wie Einsätze).

### 12.9 Fernunterschrift per Link (ohne SMS-Anbieter)
- `POST /berichte/:id/unterschrift-link` `{rolle:"bh", name?, email?}` (Bearbeitungsrecht des Berichts: Polier/Bauleiter im Bereich, Büro/GF; Bericht im Status `entwurf`, Rolle noch nicht unterschrieben) → 201 `{id, url, ablauf, rolle}`. `url` = `<BAUTAG_URL bzw. Anfrage-Host>/unterschrift/<token>` (Token 32 Byte Zufall, Base64url; in der DB nur SHA-256). Gültig **72 Std.**, **einmal** verwendbar; ein neuer Link für dieselbe Rolle macht den alten ungültig. Mit `email` wird der Link über SMTP verschickt (sonst teilt die Oberfläche ihn per Web Share/WhatsApp). Protokoll.
- `GET /berichte/:id/unterschrift-links` (gleiches Recht) → `[{id, rolle, name, erstellt, erstelltVon:{id,name}, ablauf, status:"offen"|"verwendet"|"abgelaufen"|"ungueltig", verwendet?}]`. `DELETE /berichte/:id/unterschrift-links/:lid` → widerrufen.
- **Öffentliche Seite** (ohne Anmeldung, Präfix `/api/fern`): `GET /fern/:token` → `{bericht:<AG-Fassung wie PDF fassung=ag, ohne €, ohne K/U-Kürzel, ohne interne Felder>, rolle, nameVorschlag, ablauf, firma}`; `GET /fern/:token/pdf` → AG-PDF; `POST /fern/:token` `{name (3–100), bildPng (data-URL wie 4/8), bestaetigt:true}` → `{ok:true, status}` (Unterschrift wie `POST /berichte/:id/unterschrift`, `erfasst_von` = Ersteller des Links, Protokoll mit Client-IP). Ungültig/abgelaufen/verwendet → **410** `{code:"LINK_UNGUELTIG"}`; unbekannt → 404. Höchstens 20 Abrufe je Token und 60 Fern-Anfragen je IP in 10 min (429).
- **Ungültig bei Änderung:** Jede Änderung am Berichtsinhalt (`PUT /berichte/:id`, Personal aktualisieren, Fotos, Wetter) sowie das Zurückziehen einer Unterschrift setzt offene Links auf `ungueltig`.
- Integration `fernunterschrift` = `aktiv`; `sms` = `optional` („Anbieter nötig“).

### 12.10 Diktat-Assistent (ohne Anbieter)
- Die Spracheingabe macht die Handy-Tastatur (Mikrofon) → Text. `POST /bericht-assistent/text` `{berichtId, text (≤ 5000)}` (Bearbeitungsrecht des Berichts) → **nur Vorschlag**, schreibt nie: `{vorschlag:{geraete:[{geraetId, code, name, stunden, anlageId?}], material:[{materialId, code, name, menge, einheit}], personal:[{benutzerId, name, stunden?, von?, bis?}], arbeitsleistung, vorkommnisse?, regie:[{text, stunden}]}, erkannt:[{text, art, zuordnung}], unklar:[text], quelle:"regeln"|"ki"}`.
- Deterministischer deutscher Parser: Zahlwörter („zweiundvierzig“, „dreieinhalb“, „halb“), Dezimalkomma („4,5 m³“), Einheiten (t, Tonnen, m³, Kubik, m², lfm, Stk, Std., Stunden, h, kg, l), Geräte/Material/Mitarbeiter über Namen, Codes und Synonyme (Firmenstamm + eingebaute Liste, z. B. „Bagger“ → Gerät mit Gruppe Bagger, „Frostschutz“ → Material `frostschutz`). Ohne `preise_sehen` keine €-Felder (es gibt keine).
- Mit aktiver KI (12.13) wird der Text zusätzlich von der KI strukturiert (`quelle:"ki"`), Ergebnis gegen die Stammdaten geprüft; bei KI-Fehler fällt der Server auf die Regeln zurück (`hinweis`).

### 12.11 Lieferschein (OCR ohne Anbieter)
- `POST /berichte/:id/lieferschein` `{bildBase64, dateiname}` (Bearbeitungsrecht, Entwurf ohne Unterschrift) → 201 `{foto:<Berichtsfoto mit art:"lieferschein">, text, vorschlag:{lieferant?, lieferscheinNr?, datum?, material:[{materialId, code, name, menge, einheit}]}, unklar:[…], quelle:"ocr"|"ki"}`. Foto wie 12.6 (zählt zu den 10 Fotos), OCR mit `tesseract.js` (Deutsch, offline). Vorschlag nur – Übernahme durch `PUT /berichte/:id`.
- Fehlen die Sprachdaten (`BAUTAG_OCR_DATEN`, Standard `data/ocr/deu.traineddata`), ist OCR aus: Integration `lieferschein` = `optional` mit Hinweis; die Route speichert dann nur das Foto und liefert `text:null, vorschlag:null, hinweis`. Einmaliger Download: `deploy/ocr-daten.sh`.
- `berichtsfoto.art` ∈ `foto` (Standard) | `lieferschein` | `papier`; Bericht-JSON `fotos[].art`.

### 12.12 Papier-Bautagesbericht (Archiv)
- `POST /berichte/:id/papier` `{bildBase64, dateiname}` (Bearbeitungsrecht; **auch nach Unterschrift/Freigabe** erlaubt, weil es nur ein Archivanhang ist; höchstens 5 Seiten je Bericht, zählen nicht zu den 10 Fotos) → 201 `{foto:{…, art:"papier"}, text, vorschlag:{datum?, kst?, baustelleId?, passt:bool}, hinweis}`. OCR der gedruckten Teile (Datum, KST); Handschrift nur mit KI (12.13). Löschen: Büro/GF.
- `POST /berichte/papier` `{bildBase64, dateiname}` (Recht `bericht_erstellen`) → nur Erkennung ohne Speichern: `{text, vorschlag:{datum?, kst?, baustelleId?}}` – z. B. um einen Bericht für einen alten Papierbericht anzulegen.

### 12.13 KI (optional, Anthropic Claude) – standardmäßig AUS
- Einstellung `GET/PUT /einstellungen/ki` (Recht `benutzer`): `{aktiv, schluesselGesetzt, datenschutzBestaetigt, bestaetigtVon?, bestaetigtAm?, tagesLimit (Aufrufe/Tag, Standard 200), heute:{aufrufe, eingabeTokens, ausgabeTokens}, modell:"claude-opus-5-5", hinweis}`. `PUT {apiKey?, aktiv?, datenschutzBestaetigt?, tagesLimit?}`: API-Schlüssel wird mit `BAUTAG_SCHLUESSEL` verschlüsselt gespeichert (fehlt der Schlüssel → 400), nie zurückgegeben; `apiKey:""` löscht. `aktiv:true` nur mit gesetztem Schlüssel **und** `datenschutzBestaetigt:true` (Hinweis: Text/Bilder gehen zur Verarbeitung an Anthropic; keine €-Daten werden gesendet). Protokoll.
- Verwendung: Diktat (12.10), Lieferschein (12.11, Bild), Papierbericht inkl. Handschrift (12.12, Bild). Antwort immer nur **Vorschlag**; Stammdaten-Zuordnung prüft der Server. Tageslimit erreicht → Regeln/OCR mit `hinweis:"KI-Tageslimit erreicht"`.
- Integration `ki`: `optional` (aus) bzw. `aktiv`.
- `POST /einstellungen/ki/test` (Recht `benutzer`) → `{ok:true, text, modell, eingabeTokens, ausgabeTokens}` (kurze Testanfrage mit dem gespeicherten Schlüssel; zählt zum Tageslimit) oder Fehler: kein Schlüssel → 400 `UNGUELTIG`; Schlüssel ungültig → 502 `{code:"KI_FEHLER", fehler:"API-Schlüssel ungültig"}`; Limit/Überlastung/Netz → 502 `KI_FEHLER` mit Text. Funktioniert auch bei `aktiv:false` (zum Prüfen vor dem Einschalten), aber nur mit `datenschutzBestaetigt:true` (sonst 400).

### 12.14 Integrationen (echter Zustand)
`GET /integrationen` → `[{schluessel, name, angebunden:bool, zustand:"aktiv"|"aktiv_mit_ki"|"aktiv_ohne_ki"|"optional"|"aus"|"fehlt", hinweis}]` für `push, wetter, email, fernunterschrift, diktat, lieferschein, papier, ki, sms`. `angebunden` = `zustand` beginnt mit `aktiv`. Diktat/Lieferschein/Papier: `aktiv_mit_ki` bei aktiver KI, sonst `aktiv_ohne_ki` (Lieferschein/Papier ohne OCR-Daten: `optional`). `sms`: `optional`. `POST /integrationen/sms/*` bleibt 501; die übrigen Funktionen haben eigene Routen (oben).

### 12.15 Bauvorhaben: Lebenslauf und Archiv
- **Phase** je Baustelle (neues Feld `phase`, Migration: `geplant`→`geplant`, `aktiv`→`in_arbeit`, `abgeschlossen`→`fertiggestellt`):
  `angebot` → `geplant` → `in_arbeit` → `fertiggestellt` (Bauende) → `abgenommen` (Übernahme durch AG) → `schlussrechnung` (gelegt) → `bezahlt` → `archiviert`; zusätzlich `pausiert` und `storniert`.
- Erlaubte Übergänge: `angebot→geplant|storniert`, `geplant→in_arbeit|pausiert|storniert|angebot`, `in_arbeit→pausiert|fertiggestellt|storniert`, `pausiert→in_arbeit|storniert`, `fertiggestellt→abgenommen|in_arbeit`, `abgenommen→schlussrechnung|fertiggestellt`, `schlussrechnung→bezahlt|abgenommen`, `bezahlt→archiviert|schlussrechnung`, `storniert→archiviert|geplant`. Sonst 409.
- **Rechte:** Büro/GF (Rolle oder `stammdaten`) alle Übergänge der Liste (Ziel `archiviert` inklusive); **Archiv aufheben** nur GF. Bauleiter auf eigenen Baustellen nur Ziele `geplant, in_arbeit, pausiert, fertiggestellt, abgenommen`. Polier: nur Fertigmeldung (unten). Mitarbeiter: nichts.
- Abgeleitetes `status` (bisheriges Feld, weiter gültig): `angebot|geplant` → `geplant`; `in_arbeit|pausiert` → `aktiv`; ab `fertiggestellt` sowie `storniert` → `abgeschlossen` (kein Stempeln, keine neuen Berichte; für Mängelbehebung zurück auf `in_arbeit`). `PUT /baustellen/:id` mit `status` setzt weiterhin (nur `stammdaten`) die passende Phase (`geplant`/`in_arbeit`/`fertiggestellt`).
- `POST /baustellen/:id/phase` `{phase, version, notiz? (≤ 500), datum? (Standard heute), abnahmeDatum? (Pflicht bei abgenommen), gewaehrleistungBis?, schlussrechnung?:{nr, datum, betrag?}}` → Baustelle (Detail). `betrag` nur mit `preise_bearbeiten`. Protokoll `baustelle_phase`.
- `POST /baustellen/:id/fertigmeldung` `{notiz?}` (Polier/Bauleiter der Baustelle, Phase `in_arbeit`) → 201 `{fertigmeldung}`; Benachrichtigung `typ:"baustelle"` an Büro und Bauleiter „Fertigstellung gemeldet: …“. Bestätigt wird durch den Übergang auf `fertiggestellt`.
- `POST /baustellen/:id/archiv-aufheben` `{grund}` (nur GF) → Phase vor der Archivierung.
- `GET /baustellen/:id/phasen` → `[{phase, von:{id,name}, zeit, datum, notiz}]` (wer die Baustelle sieht).
- Baustelle-JSON zusätzlich: `phase, phaseSeit (Datum), archiviert:bool, fertigmeldung?:{von:{id,name}, zeit, notiz}, abnahmeDatum, gewaehrleistungBis, phaseVorschlag?:{phase, grund}` (aus Rechnungen, 12.17); mit `preise_sehen` zusätzlich `schlussrechnung:{nr, datum, betrag}`, `haftruecklass:{betrag, prozent, bankgarantieBis, freigabeAm, freigegeben}`.
- `PUT /baustellen/:id/abschluss` `{version, gewaehrleistungBis?, haftruecklass?:{betrag?, prozent?, bankgarantieBis?, freigabeAm?, freigegeben?}}` (Büro/GF; `haftruecklass` nur mit `preise_bearbeiten`). Standard `gewaehrleistungBis` = Abnahme + 3 Jahre (**Prüfen**: Vertrag/ÖNORM B 2110). 
- **Archiv:** `GET /baustellen` liefert standardmäßig **keine** archivierten/stornierten-und-archivierten Baustellen; `?archiv=1` nur archivierte, `?alle=1` alle. Filter: `jahr` (Jahr der Archivierung bzw. `ende`), `auftraggeber` (Teiltext), `suche` (KST/Name/Auftraggeber). Archivierte Baustellen bleiben vollständig lesbar (Detail, Berichte, Nachkalkulation, Dokumente), erscheinen aber nicht in Stempel-/Berichtsauswahl (`status:"abgeschlossen"` → Stempeln/neuer Bericht 400).
- `GET /baustellen-kennzahlen` (Büro/GF; Bauleiter: eigene) → `{phasen:{[phase]: anzahl}, fertigmeldungenOffen, abnahmeOhneSchlussrechnung, offeneSchlussrechnungen:{anzahl, summe?}}` (`summe` nur mit `preise_sehen`).
- **Erinnerungen** (stündlicher Lauf, je Ereignis einmal, Texte ohne €): Abnahme ohne Schlussrechnung > 14 Tage → Büro; Gewährleistungsende in 3 Monaten → Büro/GF; Bankgarantie (Haftrücklass) läuft in 30 Tagen ab → Büro/GF; Freigabe des Haftrücklasses möglich (`freigabeAm` erreicht, nicht freigegeben) → Büro/GF. Benachrichtigungstyp `baustelle` (Push-Typ `baustelle`).

### 12.16 Projektdokumente je Baustelle
- **Kategorien** `GET /dokument-kategorien` → `[{schluessel, name, finanziell, polier, eigen}]`. Standard: `angebot`, `auftrag` (Auftrag/Schlussbrief), `lv` (Leistungsverzeichnis), `plaene`, `bodengutachten`, `bescheide` (Bescheide/Bewilligungen), `leitungsauskuenfte`, `abnahmeprotokoll`, `ausgangsrechnungen`, `eingangsrechnungen`, `lieferscheine`, `schriftverkehr`, `fotos`, `sonstiges`. **Finanziell** (nur mit `preise_sehen` für die Baustelle): angebot, auftrag, lv, ausgangsrechnungen, eingangsrechnungen. **Polier lesbar**: plaene, bodengutachten, bescheide, leitungsauskuenfte, lieferscheine, fotos. `POST /dokument-kategorien` `{name, finanziell, polier}` (nur GF, Recht `benutzer`) → 201.
- **Sichtbarkeit:** Büro/GF alle; Bauleiter eigene Baustellen (finanzielle nur mit `preise_sehen`); Polier eigene Baustellen (Bereich), nur Polier-Kategorien, nur lesen; Mitarbeiter keine (403). Unsichtbare Kategorien fehlen in Listen; Einzelabruf → 403.
- **Schreiben:** Büro/GF; Bauleiter auf eigenen Baustellen (finanzielle Kategorien nur mit `preise_bearbeiten`).
- **Dokument:** `{id, baustelleId, kategorie, titel, datum, notiz, tags:[…], version (Nummer der aktuellen Datei), versionen:[{nr, dateiname, mime, groesse, erstellt, erstelltVon:{id,name}, notiz, url}], dateiname, mime, groesse, url, erstellt, erstelltVon, geaendert, geloescht?:{zeit, von:{id,name}, grund}, rechnungId?}`.
- `GET /baustellen/:id/dokumente?kategorie&suche&tag&geloescht=1` (`geloescht=1` nur Büro/GF) · `GET /dokumente/suche?q&kategorie` (über alle sichtbaren Baustellen, max. 100) · `GET /baustellen/:id/dokumente/:did`.
- `POST /baustellen/:id/dokumente` `{kategorie, titel (1–200), datum?, notiz? (≤ 2000), tags? (≤ 10 × ≤ 40), dateiBase64, dateiname}` → 201. `POST /baustellen/:id/dokumente/:did/versionen` `{dateiBase64, dateiname, notiz?}` → 201 (neue Version, alte bleiben abrufbar). `PUT /baustellen/:id/dokumente/:did` `{titel?, kategorie?, datum?, notiz?, tags?}`. `DELETE /baustellen/:id/dokumente/:did` `{grund?}` → **weich gelöscht** (Protokoll), `POST …/:did/wiederherstellen` (Büro/GF).
- `GET /baustellen/:id/dokumente/:did/datei?version=N` → Datei (`Content-Disposition: attachment` außer Bilder/PDF `inline`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, CSP `sandbox`).
- **Prüfung der Datei** (Magic Bytes, Name/MIME egal): PDF (`%PDF-`; abgelehnt: verschlüsselt `/Encrypt`, aktive Inhalte `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`), JPEG/PNG/WebP (wie 11.9, Metadaten entfernt), DOCX/XLSX (ZIP mit `[Content_Types].xml` und `word/` bzw. `xl/`; Makros `vbaProject.bin` abgelehnt; ZIP-Prüfung wie E-02). Höchstens **25 MB** je Datei (Anfrage bis 35 MB). Ablage unter `BAUTAG_UPLOADS/dokumente` mit Zufallsnamen (in der Sicherung der Fotos enthalten).

### 12.17 Ausgangsrechnungen und Zahlungen
> **Anpassung 13.11.2026 (Inhaber):** Rechnungen werden in **BMD** bzw. **Auer Success** geschrieben. BauTag **erstellt keine Rechnungen**, sondern erfasst sie (PDF + Kopfdaten) und hält Zahlungsstand/Offene Posten über den **BMD-Import** (12.20) aktuell. Händische Erfassung bleibt als Ausweichweg. Mahnungen werden in BMD geschrieben; BauTag merkt sich nur Mahnstufe und Datum.
€ nur mit `preise_sehen` für die Baustelle; ohne Recht → 403 auf alle Routen. Schreiben: `preise_bearbeiten` (Büro/GF). Bauleiter: eigene Baustellen lesen.
- **Rechnung:** `{id, baustelleId, baustelle:{id,kst,name,auftraggeber}, nr, typ:"abschlag"|"teil"|"schluss"|"regie"|"gutschrift", datum, leistungVon, leistungBis, netto, ustModus:"normal"|"reverse_charge", ustSatz (20 bzw. 0), ust, brutto, zahlungszielTage, faellig, skontoProzent, skontoTage, skontoBis, ruecklassArt:"haft"|"deckung"|null, ruecklassProzent, ruecklassBetrag, ruecklass, zahlbetrag, dokumentId, notiz, zahlungen:[{id, datum, betrag, skonto, ruecklass:bool, notiz, erfasst, erfasstVon}], bezahlt, skontoGenommen, offen, ueberfaelligTage, status:"offen"|"teilbezahlt"|"bezahlt"|"ueberfaellig"|"storniert", mahnungen:[{stufe, name, datum, erfasstVon}], mahnstufe, ruecklassOffen, ruecklassFaellig, storniert?:{zeit, grund, von}, version}`.
- **Rechnung (kaufmännisch gerundet, je Schritt auf Cent):** `ust = netto × ustSatz/100` (Reverse Charge Bauleistungen § 19 Abs. 1a UStG: 0 – **Prüfen**), `brutto = netto + ust`, `ruecklass` = `ruecklassBetrag` oder `brutto × ruecklassProzent/100`, `zahlbetrag = brutto − ruecklass`, `faellig = datum + zahlungszielTage`, `skontoBis = datum + skontoTage`. Gutschrift: Beträge positiv eingeben, zählen in Summen **negativ**. `nr` eindeutig (409).
- **Zahlungen:** `bezahlt = Σ betrag` (ohne Rücklass-Zahlungen), `skontoGenommen = Σ skonto` (nur bei Zahlung bis `skontoBis`, sonst 400), `offen = max(0, zahlbetrag − bezahlt − skontoGenommen)`. Rücklass als eigene Forderung: `ruecklassOffen = ruecklass − Σ Zahlungen mit ruecklass:true`, `ruecklassFaellig` = Freigabedatum des Haftrücklasses der Baustelle (12.15) bzw. `null`.
- **Status:** `storniert`; sonst `offen ≤ 0` → `bezahlt`; `heute > faellig` → `ueberfaellig` (`ueberfaelligTage`); Zahlung vorhanden → `teilbezahlt`; sonst `offen`.
- Routen: `GET /rechnungen?baustelleId&status&auftraggeber&von&bis` · `GET /rechnungen/:id` · `POST /baustellen/:id/rechnungen` (201) · `PUT /rechnungen/:id` `{version, …}` (nicht storniert; nach Zahlungen sind `netto/ust*/ruecklass*` gesperrt → 409) · `POST /rechnungen/:id/storno` `{grund}` · `POST /rechnungen/:id/zahlungen` `{datum, betrag, skonto?, ruecklass?, notiz?}` (201) · `DELETE /rechnungen/:id/zahlungen/:zid` · `POST /rechnungen/:id/mahnungen` `{stufe:1|2|3, datum?}` (1 Zahlungserinnerung, 2 1. Mahnung, 3 2. Mahnung; nur steigend, nur bei offenem Betrag) · `dokumentId` = Projektdokument der Kategorie `ausgangsrechnungen` derselben Baustelle.
- **Offene Posten** `GET /offene-posten` → `{summeOffen, summeUeberfaellig, anzahlOffen, anzahlUeberfaellig, ruecklaesseOffen, zahlungsdauerTage (Ø Rechnungsdatum → vollständige Zahlung, letzte 365 Tage), jeAuftraggeber:[{auftraggeber, offen, ueberfaellig, anzahl}], posten:[Rechnung (kurz)], ruecklaesse:[{rechnungId, nr, baustelle, ruecklassOffen, ruecklassFaellig}]}` (Bauleiter: eigene Baustellen). CSV: `GET /offene-posten.csv`, `GET /zahlungseingaenge.csv?von&bis` (Semikolon, UTF-8 BOM, Dezimalkomma; Protokoll `export`).
- **Erinnerungen** (stündlich, je Rechnung und Stufe einmal, an Büro/GF, Texte ohne €): fällig geworden → „Rechnung <nr> fällig“; 14 Tage nach Fälligkeit bzw. nach der letzten Mahnung → „Mahnstufe <n> vorschlagen: Rechnung <nr>“. Typ `rechnung` (Push-Typ `rechnung`).
- **Verknüpfung Bauvorhaben:** Gibt es eine nicht stornierte Schlussrechnung und ist die Phase vor `schlussrechnung` → `phaseVorschlag:{phase:"schlussrechnung"}`; sind alle Rechnungen bezahlt (offener Rücklass ausgenommen) → `phaseVorschlag:{phase:"bezahlt"}`; Phase `bezahlt` und kein offener Rücklass → `phaseVorschlag:{phase:"archiviert"}`.
- **Nachkalkulation** `/kalkulation/:id` (mit Preisen) zusätzlich `rechnungen:{verrechnetNetto, bezahlt, offen, ruecklassOffen}`; `/baustellen/:id/positionen` ebenso.
- Später (nur dokumentiert, nicht umgesetzt): Bank-Import (CSV/camt.053) zur Zuordnung von Zahlungseingängen, e-Rechnung im Format ebInterface.

### 12.18 Test-Schnittstellen (nur mit `BAUTAG_TEST=1`)
Mit `BAUTAG_TEST=1` (bzw. `createApp({test:true})`) ersetzt der Server **alle externen Dienste durch Attrappen**; ohne die Variable gibt es `/api/test/*` nicht (404) und keine Attrappen. Die Routen brauchen keine Anmeldung (nur für E2E auf einem Testserver).
- **Push:** Nachrichten gehen nicht an Web-Push, sondern in einen Speicher; VAPID-Schlüssel werden trotzdem erzeugt (Abos funktionieren mit beliebigem `endpoint`). Ein `endpoint`, der `gone` enthält, simuliert 410 (Abo wird gelöscht).
- **Wetter:** feste, aus Koordinaten und Datum berechnete Werte (Regen ≥ 1 mm um 13:00 bei `lat` mit Nachkommastelle `.5`, sonst trocken); `POST /test/wetter {verfuegbar:false}` simuliert einen Ausfall, `{verfuegbar:true}` hebt ihn auf.
- **E-Mail:** Mails landen im Speicher (SMTP gilt als eingerichtet, `quelle:"test"`); `POST /test/email {fehler:"…"}` lässt den nächsten Versand scheitern.
- **OCR:** `POST /test/ocr {text}` legt den Text fest, den die nächste(n) Erkennung(en) liefern (sonst ein fester Beispiel-Lieferschein); OCR gilt als verfügbar.
- **KI:** Anthropic wird nicht aufgerufen; `POST /test/ki {antwort?:object, fehler?:"ungueltig"|"limit"|"verbindung"|"ablehnung"}` legt die nächste Antwort fest (Standard: leerer Vorschlag). Schlüssel `sk-test` gilt als gültig.
- `GET /test/ausgang` → `{push:[{benutzerId, endpoint, title, body, url, tag, zeit}], mails:[{an, betreff, text, anhaenge:[{dateiname, groesse}], zeit}], ki:[{zweck, zeit}]}` · `POST /test/zuruecksetzen` (leert Speicher und Vorgaben) · `POST /test/stuendlich` (führt den stündlichen Lauf aus: Erinnerungen, Preise, Sicherung, Rechnungen, Bauvorhaben) · `POST /test/uhr {iso}` (nur wenn mit fester Uhr gestartet: setzt die Uhr).

### 12.19 Urlaubsübersicht und Urlaubskonto
Keine €-Felder. Codes: `U` Urlaub, `ZA` Zeitausgleich, `K` Krank, `SW` Schlechtwetter, `BU` Betriebsurlaub (neu; zählt wie Urlaub), dazu Feiertage (eingebaut, Österreich inkl. Ostern-abhängiger Tage).
- **Sichtbereich** (wie 7/B-07): Büro/GF (`stammdaten`/`lohn`) alle; Bauleiter Personen seiner Baustellen + sich; Polier seine Partie + sich; Mitarbeiter nur sich. Code `K` sehen nur `stammdaten`/`lohn` und die Person selbst (sonst `code:"abwesend"`).
- `GET /urlaub/kalender?von&bis&baustelleId?` (≤ 62 Tage) → `{tage:[{datum, wochentag, feiertag?, arbeitstag}], personen:[{benutzerId, name, rolle, baustelleId, tage:{[datum]:{code, status:"beantragt"|"genehmigt"|"abgelehnt", id}}}], warnungen:[Warnung]}`.
- `GET /urlaub/feiertage?jahr` → `[{datum, name}]` (alle angemeldet).
- **Urlaubskonto** je Person und Urlaubsjahr (Standard: Kalenderjahr; `urlaubsjahrBeginn` je Person `MM-TT`, Standard `01-01`): `GET /urlaub/konto?jahr&benutzerId?` → `[{benutzerId, name, rolle, art:"buak"|"urlg", jahr, anspruch, einheit:"Arbeitstage"|"Werktage", uebertrag, buak?:{stand, datum}, genommen, geplant, beantragt, rest, hinweis}]` (Sichtbereich; Mitarbeiter nur sich). `rest = anspruch + uebertrag − genommen − geplant` (beantragt separat). Gezählt werden Arbeitstage (Mo–Fr ohne Feiertage) mit `U`/`BU` genehmigt; `genommen` bis heute, `geplant` danach.
- `PUT /urlaub/konto/:benutzerId/:jahr` (Recht `stammdaten` oder `lohn`) `{art?, anspruch?, einheit?, uebertrag?, buakStand?, buakDatum?, notiz?}` → Konto. **Bauarbeiter** (`art:"buak"`): Urlaub wird über die **BUAK** nach Anwartschaftswochen verwaltet – eingetragen wird der **Anspruch laut BUAK-Kontoauszug** mit Datum (`buakStand`, `buakDatum`); `anspruch` = `buakStand`, `genommen`/`geplant` zählen erst ab `buakDatum`. **Angestellte** (`art:"urlg"`): Anspruch nach UrlG (30 Werktage bzw. 25 Arbeitstage, ab 25. Dienstjahr 36/30) – **Prüfen** mit der Lohnverrechnung; Standard 25 Arbeitstage. Protokoll.
- **Betriebsurlaub / Winterpause:** `POST /urlaub/betriebsurlaub` `{von, bis, benutzerIds? | baustelleIds? | alle:true, code:"BU"|"U", vorschau:true|false, notiz?}` (Recht `stammdaten`) → `{tage:[Arbeitstage], personen:[{benutzerId, name, neu, konflikte:[{datum, text}]}], angelegt?}`; Vorschau zuerst, dann `vorschau:false` legt **genehmigte** Einträge an (bestehende genehmigte Abwesenheiten bleiben, beantragte werden ersetzt; Feiertage/Wochenenden übersprungen). Konflikte: bestehende Abwesenheit, Einsatz im Baustellenplaner.
- **Warnungen** `GET /urlaub/warnungen?von&bis` (Planer, Bauleiter eigene) → `[{typ:"partie_viele"|"plan_konflikt"|"rest_negativ"|"antrag_offen", datum?, benutzerId?, baustelleId?, text}]`: zu viele Abwesende in einer Partie am selben Tag (Einstellung `urlaub.partieGrenze`, Standard 2 bzw. 30 %), Abwesenheit trotz Einteilung im Baustellenplaner, Resturlaub negativ, Antrag länger als 3 Tage unbearbeitet (auch als Benachrichtigung an Büro, einmal je Antrag).
- `GET/PUT /einstellungen/urlaub` (`stammdaten`) `{partieGrenze, partieGrenzeProzent, urlaubsjahrBeginn}`.
- `GET /urlaub/export.csv?jahr` (`stammdaten`/`lohn`) → je Person: Personalnummer, Name, Art, Anspruch, Übertrag, genommen, geplant, beantragt, Rest, BUAK-Stand/Datum (Semikolon, UTF-8 BOM). Protokoll `export`.

### 12.20 Anbindung BMD und Auer Success (Import/Export)
Alle Zuordnungen/Vorlagen änderbar durch Büro/GF (`stammdaten` bzw. für Beträge `preise_bearbeiten`). Dateien als Base64 (≤ 5 MB), Vorschau vor Übernahme, Protokoll, wiederholbarer Import (idempotent).
- **BMD Offene Posten (Zahlungsstand):** `GET/PUT /import/bmd-op/zuordnung` → `{trennzeichen:";"|","|"\t", kodierung:"utf-8"|"windows-1252", kopfzeile:bool, dezimal:","|".", datumFormat:"TT.MM.JJJJ"|"JJJJ-MM-TT", spalten:{belegnr, datum, kunde?, netto?, brutto?, offen, faellig?, bezahlt?, zahlungsdatum?}}` (Spaltenname oder Nummer ab 1; Vorlage „BMD NTCS OP-Liste (Vorschlag – mit echter Datei prüfen)“). `POST /import/bmd-op` `{dateiBase64, dateiname, vorschau:true|false}` (`preise_bearbeiten`; CSV oder XLSX) → `{zeilen, zugeordnet:[{rechnungId, nr, alt:{offen,status}, neu:{offen,status}, aenderung}], unbekannt:[{zeile, belegnr, kunde, offen}], fehler:[{zeile, text}], uebernommen}`. Zuordnung über **Rechnungs-Nr.** (= Belegnr., ohne Leer-/Sonderzeichen verglichen). Übernahme setzt den offenen Betrag: Differenz zum bisherigen Stand wird als Zahlung `quelle:"bmd"` (Datum = Zahlungsdatum oder Importtag) gebucht; ein erneuter Import derselben Datei ändert nichts. Optional `art:"zahlungen"` für eine Zahlungseingangs-Liste (je Zeile eine Zahlung; Duplikate über Belegnr.+Datum+Betrag erkannt).
- **Auer Success – Leistungsverzeichnis (ÖNORM A 2063):** `POST /baustellen/:id/lv-import` `{dateiBase64, dateiname, vorschau}` (`preise_bearbeiten`) für `.onlv`/XML (ÖNORM A 2063, toleranter Parser für die Teilmenge: Positionen mit OZ/Nummer, Kurztext, Einheit, Menge, EP bzw. Gesamtbetrag; Namensräume/Groß-/Kleinschreibung egal) oder Excel/CSV-Export (Spalten OZ, Kurztext, Einheit, Menge, EP, GP – Zuordnung wie oben unter `GET/PUT /import/lv/zuordnung`) → `{positionen:[{oz, kurztext, einheit, menge, ep, gp}], summe, warnungen, uebernommen}`. **Mit echter Exportdatei prüfen** (kein Muster vorhanden). Übernahme speichert die LV-Positionen als **Soll** der Baustelle (`GET /baustellen/:id/lv` → `{positionen:[{id, oz, kurztext, einheit, menge, ep, gp, projektpositionId?}], summe, importiert, datei}`), setzt auf Wunsch (`auftragssummeUebernehmen:true`) die Auftragssumme = LV-Summe; `PUT /baustellen/:id/lv/:lid` `{projektpositionId}` ordnet eine LV-Position einer Nachkalkulations-Position zu → in `/baustellen/:id/positionen` je Position `soll:{menge, ep, gp}` und Ist (Menge/Summe) zum Vergleich. €: nur mit Preisrecht.
- **BMD Lohn (Export):** Lohn-Export `GET /monat/export.csv?monat&vorlage=<id>` mit einstellbarer Vorlage: `GET /lohn-vorlagen`, `POST/PUT/DELETE /lohn-vorlagen/:id` (`lohn`) `{name, trennzeichen, kodierung, dezimal, kopfzeile, spalten:[{feld:"pnr"|"name"|"monat"|"lohnart"|"stunden"|"tage"|"betrag"|"kst"|"datum"|"fest", wert?}], lohnarten:{normal, ueberstunden, sw, u, k, za, seg, taggeld}, zeileJe:"person_lohnart"|"person_tag_lohnart"}`. Vorlage **„BMD NTCS (Vorschlag – mit Lohnverrechnung abstimmen)“** vorinstalliert (Lohnart-Nummern als Platzhalter). Standard-Export (ohne `vorlage`) bleibt wie bisher.
- **BMD Buchhaltung (Export):** nur dokumentiert – bei Bedarf später (Buchungsstapel für Eingangsrechnungen/Kostenstellen).
