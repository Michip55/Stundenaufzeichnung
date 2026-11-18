# Prüfbericht 7 – Benutzerrechte (vollständige, mechanische Prüfung)

**Geprüfter Stand:** Commit `6f86efee07eb66828d0b59dccd39563b57ad3898` (Arbeitskopie `/home/user/bautag-rechte`, unverändert; nur neue Testdateien)
**Datum:** 13.11.2026 · **Prüfer:** unabhängiger Sicherheitsprüfer (Claude)
**Anforderung des Inhabers:** „Die Benutzerrechte müssen zu 100 % funktionieren, es gibt Sachen die dürfen auf keinen Fall Mitarbeiter sehen.“ – ergänzt: „Hier darf es auch kein Bug oder eine Umgehung geben.“

## 1. Ergebnis in Kürze

- Der Server hat **280 registrierte API-Routen** (272 im Betrieb + 8 Test-Schnittstellen, die es nur mit `BAUTAG_TEST=1` gibt). **Alle 280** stehen mit einer Rechte-Entscheidung je Rolle in `tests/api/rechte-matrix.json` (Abdeckung 100 %). Ein neuer Test schlägt fehl, sobald eine Route ohne Eintrag dazukommt.
- **Geld (€) ist dicht:** In keiner der rund 5.800 Anfragen je Lauf (JSON, CSV, PDF, XLSX, Fehlermeldungen, Push, E-Mail, Benachrichtigungen, Oberfläche mit 2.226 mitgeschnittenen Netzwerkantworten) hat ein Mitarbeiter oder Polier einen €-Betrag, Preis, EP, Kostensatz, eine Rechnung oder eine Auftragssumme erhalten – auch nicht mit **allen** vergebbaren Ausnahmen. Der Bauleiter erhält keine Beträge fremder Baustellen. Gesperrte Rechte lassen sich weder per Matrix noch per Ausnahme vergeben. Alle 653 verweigerten Schreibproben wurden abgewiesen, **die Datenbank blieb jedes Mal unverändert**.
- **Nicht dicht sind Gesundheitsdaten:** Der **Krankenstand (Code K) und die Notiz dazu** gehen an **Polier und Bauleiter** (R-01, R-02) – direkt, über Fehlermeldungen und über eine Vorschau (R-03). Das widerspricht API.md 12.19/12.24 („Code K sehen nur stammdaten/lohn und die Person selbst“).
- Dazu kommen: Zahlungsstand der Ausgangsrechnungen über `phaseVorschlag` (R-04), Personalnummern anderer im Urlaubskonto (R-05), zwei Lücken in der Reihenfolge der Prüfungen (R-06, R-07) und Planungsdaten des Vorbenutzers im Browser-Speicher nach dem Abmelden (R-08).
- **Umgehungsversuche** (Pfad-Varianten, Groß/Klein, Kodierung, HEAD/OPTIONS, Method-Override, Parameter-Pollution, IDOR, Mass Assignment, Prototype Pollution, Content-Type, Sitzung, Session Fixation, PIN-Raten mit X-Forwarded-For, 2FA, Fernunterschrift, Test-Schnittstellen) sind bis auf R-06/R-07 **ohne Erfolg** geblieben.

**Antwort auf die Anforderung:** Für **€-Daten, Preise, Kalkulation, Lohn, Rechnungen, Benutzer/Rechte und Einstellungen** funktionieren die Rechte nachweislich lückenlos. Die Anforderung „zu 100 %“ ist **derzeit nicht erfüllt**, weil Krankenstände anderer Personen beim Polier und Bauleiter landen (KRITISCH, R-01 bis R-03). Alle Befunde sind als dauerhafte Tests hinterlegt; diese Tests sind **jetzt rot** und werden grün, sobald die Befunde behoben sind.

| ID | Schwere | Kurzbeschreibung | Route / Rolle | Ursache (Datei:Zeile) |
|---|---|---|---|---|
| R-01 | KRITISCH | Krankenstand (Code `K`) anderer Personen unmaskiert | `GET /api/abwesenheiten` · Polier (Partie), Bauleiter (Personen seiner Baustellen) | `server/routes/abwesenheiten.js:21-23` (`json()` gibt `code` ungefiltert aus), Route `:48-59` |
| R-02 | KRITISCH | Notiz zur Abwesenheit (z. B. Diagnose bei Krankenstand) an Polier/Bauleiter, auch wo der Code schon als „abwesend“ maskiert ist; in der Oberfläche des Poliers unter „Urlaub“ sichtbar | `GET /api/abwesenheiten`, `GET /api/abwesenheiten/antraege` · Polier, Bauleiter | `server/routes/abwesenheiten.js:23`, `:250` |
| R-03 | KRITISCH | Krankenstand über 409-Fehlertext und über die (beliebig wiederholbare) Vorschau abfragbar – auch wenn R-01 behoben ist | `POST /api/abwesenheiten`, `POST /api/abwesenheiten/zeitraum` (`vorschau:true`) · Polier (Schlechtwetter für seine Partie) | `server/routes/abwesenheiten.js:98`, `:190` |
| R-04 | HOCH | `phaseVorschlag` verrät Rechnungs- und Zahlungsstand („Schlussrechnung ist erfasst.“, „Alle Rechnungen bezahlt (Haftrücklass noch offen).“) | `GET /api/baustellen`, `GET /api/baustellen/:id` · Mitarbeiter, Polier, fremder Bauleiter | `server/bauvorhaben.js:53-54` (ohne Rechteprüfung), `:65-80`; Aufruf `server/routes/stammdaten.js:22` |
| R-05 | HOCH | Personalnummern anderer Personen (auch Anmeldekennung bei `BAUTAG_LOGIN_LISTE=0`) | `GET /api/urlaub/konto` · Polier (Partie), Bauleiter | `server/routes/urlaub.js:91` |
| R-06 | NIEDRIG | Sperren „PIN ändern“ und „2FA einrichten“ greifen nicht für drei Zwei-Faktor-Routen | `GET/PUT /api/einstellungen/sicherheit`, `DELETE /api/benutzer/:id/2fa` · GF | Registrierung vor der Sperre: `server/routes/auth.js:83` → `server/routes/zweifaktor.js:183-220`; Sperre erst `server/index.js:224-231` |
| R-07 | NIEDRIG | Versionsprüfung vor der Rechteprüfung: Unberechtigte erhalten 409 mit aktueller `version` | `POST /api/baustellen/:id/phase` · Mitarbeiter, Polier, fremder Bauleiter | `server/routes/bauvorhaben.js:23` (vor der Rechteprüfung in `server/bauvorhaben.js:93-96`) |
| R-08 | MITTEL | Nach dem Abmelden bleibt der Einsatzplan des Vorbenutzers (`bt_einsatz`: Baustelle, Treffpunkt, Fahrzeug, eigene Notizen, Telefon des Poliers, Fuhren) im `localStorage` lesbar – geteiltes Tablet | Oberfläche · Polier → Mitarbeiter | `public/js/views/plan.js:547` schreibt; `public/js/app.js:376-381` (`lokalAbmelden`) löscht nur `bt_ich`, `bt_status` |

Zur Schwere: Die Vorgabe stuft „personenbezogene Daten an Mitarbeiter/Polier“ als KRITISCH ein. R-04 (Zahlungsstand ohne Beträge) und R-05 (Personalnummer, keine Inhaltsdaten) sind fachlich deutlich schwächer als Gesundheitsdaten und daher mit HOCH bewertet; wer die Skala wörtlich anwendet, setzt beide auf KRITISCH.

## 2. Befunde im Einzelnen (mit Nachstellung)

Alle Nachstellungen mit den Demo-Daten (`BAUTAG_DEMO=1 npm run seed`, PIN 1234). Polier = Josef Haidbauer (ID 1, Polier der Baustelle 1 „WHA Pitten“), Mitarbeiter = Lukas Brandstätter (ID 2), Bauleiter = Stefan Aigner (ID 103, Bauleiter der Baustellen 1, 2, 5, 7), anderer Mitarbeiter = Daniel Schwarz (ID 3, Partie Baustelle 1), Büro = Martina Koller (ID 101).

### R-01 KRITISCH – Krankenstand anderer Personen über `GET /api/abwesenheiten`
1. Büro trägt einen Krankenstand ein: `POST /api/abwesenheiten/zeitraum {benutzerId:3, von:"2026-11-16", bis:"2026-11-17", code:"K", notiz:"…"}`.
2. Polier: `GET /api/abwesenheiten` → u. a. `{"id":63,"benutzerId":3,"name":"Daniel Schwarz","datum":"2026-11-16","code":"K","status":"genehmigt",…}`. Auch die in den Demo-Daten schon vorhandenen K-Tage (z. B. Person 2) kommen mit `code:"K"`.
3. Bauleiter: dieselbe Route liefert `code:"K"` für alle Personen mit Stamm-Baustelle auf seinen Baustellen (in den Testdaten u. a. Personen 2, 3, 20).

Ursache: `json()` (`server/routes/abwesenheiten.js:21`) maskiert nicht; die Maskierung `code:"abwesend"` gibt es nur in `GET /abwesenheiten/antraege` (`:248`) und im Urlaubskalender (`server/routes/urlaub.js:30-33`). Die Oberfläche des Poliers zeigt es **sichtbar** an: unter „Abwesenheiten“ steht „Daniel Schwarz · K Krank · Dienstag, 17. November“ (Handy und PC, im UI-Rundgang festgestellt).
Test: `rechte-matrix.test.js` → „Lesen …“ (Meldung „Krankenstand (Code K) einer anderen Person“), `rechte-ui.js`.

### R-02 KRITISCH – Notiz zur Abwesenheit (Diagnose) an Polier und Bauleiter
Wie R-01, die Notiz des Büros („KRANK-KANARIE-DIAGNOSE“) steht unverändert in `GET /api/abwesenheiten` (`notiz`, `abwesenheiten.js:23`) und in `GET /api/abwesenheiten/antraege` (`notiz`, `:250`) – dort sogar neben dem maskierten `code:"abwesend"`, womit die Maskierung wirkungslos ist. Der Polier sieht den Text in der Oberfläche unter **Urlaub** (Handy und PC, im DOM und sichtbar).
Test: „Lesen …“ (Kanarienvogel `Text krank`), `rechte-ui.js`.

### R-03 KRITISCH – Krankenstand über Fehlermeldung und Vorschau
1. Polier: `POST /api/abwesenheiten {benutzerId:3, datum:"2026-11-16", code:"SW"}` → **409** `„Für 16.11.2026 ist bereits „K“ eingetragen.“` (`abwesenheiten.js:98`).
2. Polier: `POST /api/abwesenheiten/zeitraum {benutzerId:3, von:"2026-11-16", bis:"2026-11-17", code:"SW", vorschau:true}` → **200** `uebersprungen:[{datum:"2026-11-16", grund:"schon K genehmigt"}, …]` (`:190`). Die Vorschau speichert nichts und kann für jede Person der Partie und jeden Zeitraum (bis 62 Tage, 366 Tage voraus) wiederholt werden.
Hinweis: Auch nach Behebung von R-01/R-02 bleibt dieser Kanal offen. Der Code im Text darf für Polier/Bauleiter nur „abwesend“ lauten.
Test: `rechte-umgehung.test.js` → „Indirekte Lecks: Krankenstand über 409-Fehlertexte und Vorschau-Antworten“.

### R-04 HOCH – Rechnungs-/Zahlungsstand über `phaseVorschlag`
1. GF: Baustelle 1 → `fertiggestellt` → `abgenommen`; Schlussrechnung erfassen (`POST /api/baustellen/1/rechnungen {typ:"schluss",…}`).
2. Mitarbeiter (Stamm-Baustelle 1) und Polier: `GET /api/baustellen/1` bzw. `GET /api/baustellen?alle=1` → `phaseVorschlag:{phase:"schlussrechnung", grund:"Schlussrechnung ist erfasst."}`.
3. Phase `schlussrechnung`, alle Rechnungen bezahlen → `phaseVorschlag:{phase:"bezahlt", grund:"Alle Rechnungen bezahlt."}` bzw. „(Haftrücklass noch offen)“.
Ursache: `phaseFelder()` hängt den Vorschlag ohne Rechteprüfung an (`server/bauvorhaben.js:53-54`), die €-Felder daneben sind korrekt an `mitPreisen` gebunden (`:55-60`). Der Vorschlag ist nur für Büro/GF (Phasenwechsel ab „Schlussrechnung“) sinnvoll.
Test: `rechte-umgehung.test.js` → „Indirekte Lecks: Zahlungsstand … phaseVorschlag“.

### R-05 HOCH – Personalnummern anderer im Urlaubskonto
Polier: `GET /api/urlaub/konto` → `[{benutzerId:3, name:"Daniel Schwarz", rolle:"mitarbeiter", pnr:1003, …}, …]` für die ganze Partie; Bauleiter für 20 Personen. Laut API.md 6 ist `pnr` nur mit `stammdaten`/`lohn`/`benutzer` sichtbar (wie in `/mitarbeiter`). Mit `BAUTAG_LOGIN_LISTE=0` ist die Personalnummer die Anmeldekennung.
Ursache: `server/routes/urlaub.js:91` (`konto()` gibt `pnr` immer aus; Aufruf `:105-111`).
Test: „Lesen …“ (Meldung „Personalnummer einer anderen Person“), `rechte-ui.js`.

### R-06 NIEDRIG – Sperren „PIN ändern“ / „2FA einrichten“ umgehbar für drei Routen
GF mit `muss_pin_aendern=1` bzw. mit 2FA-Pflicht ohne eingerichtete 2FA: `GET /api/preise` → 403 `PIN_AENDERN`/`2FA_EINRICHTEN` (richtig), aber `PUT /api/einstellungen/sicherheit {zweiFaktorPflicht:{gf:false}}` → **200** und `DELETE /api/benutzer/103/2fa` → **200**. API.md 7/12.7: die Sperre gilt für alle Routen außer `/auth/*` und `/gesundheit`.
Ursache: Die Routen werden in `routes/zweifaktor.js` registriert, das aus `routes/auth.js:83` **vor** `api.use(angemeldet)` und der Sperre (`server/index.js:224-231`) eingebunden wird. Auswirkung gering (es braucht die PIN einer GF), aber die Pflicht-2FA kann so vor ihrer Einrichtung für alle Rollen abgeschaltet werden.
Test: `rechte-umgehung.test.js` → „Sperren „PIN ändern“ und „2FA einrichten“ …“.

### R-07 NIEDRIG – Zustand vor Recht: `POST /api/baustellen/:id/phase`
Mitarbeiter: `POST /api/baustellen/1/phase {phase:"pausiert", version:999999}` → **409** `{"fehler":"Die Baustelle wurde inzwischen geändert…","version":4}` statt 403. Erst mit richtiger Version kommt 403. Kein Datenleck außer der Versionsnummer, aber die Reihenfolge ist falsch (alle übrigen Schreib-Routen prüfen das Recht vor der Version – mechanisch für jede Route und Rolle geprüft).
Ursache: `server/routes/bauvorhaben.js:23` (`version(body, bs)`) vor `wechslePhase()` mit der Rechteprüfung (`server/bauvorhaben.js:93-96`).
Test: `rechte-matrix.test.js` → „Rechteprüfung vor Zustandsprüfung …“.

### R-08 MITTEL – Daten des Vorbenutzers im Browser nach dem Abmelden (geteiltes Tablet)
1. Polier meldet sich am Tablet an, öffnet „Mein Einsatz“ → `public/js/views/plan.js:547` speichert die Antwort von `/api/plan/ich` als `localStorage.bt_einsatz` (`{uid:1, d:{morgen:{einsatz:{baustelle, beginn, treffpunkt, fahrzeug, arbeit, benoetigt, meineNotiz, polier:{telefon}}, fuhren:[…]}}}`, ca. 2 KB).
2. Abmelden über „Mehr → Abmelden“: `lokalAbmelden()` (`public/js/app.js:376-381`) entfernt nur `bt_ich` und `bt_status`.
3. Danach meldet sich ein Mitarbeiter am selben Gerät an: `bt_einsatz` des Poliers ist weiter lesbar (Browser-Entwicklerwerkzeuge, jede Seite der gleichen Herkunft). Die App selbst zeigt es wegen der `uid`-Prüfung nicht an.
Geprüft ohne Befund: Die Offline-Warteschlange des Poliers (`bt_stempel_queue`, bewusst erhalten, M-04) wird **nicht** mit der Sitzung des Mitarbeiters gesendet; der Service Worker speichert **nie** `/api` zwischen; kein lesbares Cookie (HttpOnly). `bt_baustellen`/`bt_anlagen` bleiben, enthalten aber nur Stammdaten ohne Personenbezug und ohne €.
Test: `tests/e2e/rechte-ui.js` (Teil „Geteiltes Gerät“).

## 3. Was ohne Befund geprüft wurde

**Matrix (alle 280 Routen, alle 5 Rollen, eigenes und fremdes Objekt):**
- 645 Leseproben je Lauf (104 GET-Routen × 5 Rollen, 106 Routen mit Varianten eigen/fremd); Status wie in der Matrix, Inhalt gescannt.
- 653 verweigerte Schreibproben mit plausiblem Body: alle 401/403/404, **DB-Fingerabdruck (SHA-256 je Tabelle) vor/nach identisch**. 617 erlaubte Schreibproben je auf frischer DB-Kopie: keine wird fälschlich abgewiesen.
- 280 Proben ohne Anmeldung: alle 401 (Test-Schnittstellen 403); öffentlich sind nur `/gesundheit`, `/auth/benutzerliste`, `/auth/login`, `/auth/login/2fa`, `/fern/:token*`.
- 653 Proben „veraltete version“: nur R-07 prüft den Zustand vor dem Recht.
- **Ausnahmen:** GF vergibt Mitarbeiter, Polier und Bauleiter über `PUT /api/rechte/ausnahme` jedes Recht: gesperrte (`preise_sehen`, `preise_bearbeiten`, `kalk_sehen`, `lohn`, `stammdaten`, `benutzer` bzw. beim Bauleiter `preise_bearbeiten`, `lohn`, `stammdaten`, `benutzer`) → 400, auch über `PUT /api/rechte/matrix`; `/auth/ich` zeigt sie nie. Mit allen übrigen Ausnahmen (u. a. `kolonne`, `bericht_erstellen`, `bericht_freigeben`, `fuhrpark`) wurden alle GET-Routen erneut gescannt: **kein €**. Bauleiter mit allen Ausnahmen: `PUT /preise`, `/monat`, `/monat/export.csv`, Nachträge, Rechnungen → 403.

**Kanarienvögel** (eindeutige Werte, in allen Formaten gesucht: `87654.32`, `87654,32`, `87.654,32` …): Rechnungsbeträge, Nachträge, Fremdleistungen, Zahlungen, Haftrücklass, Auftragssummen, Projekt-EP, PA-Mengen je Baustelle 1/3; globale Preise, Katalog-EP, geplante Preise, Gerätesatz, Reparaturkosten; Rechnungsnummern; Titel von Dokumenten der finanziellen Kategorien, von „Schriftverkehr“ und von Plänen fremder Baustellen; LV-Kurztext; SMTP-Host und Alarm-Adresse; Telefonnummer und Plan-Notiz eines anderen Mitarbeiters; Urlaubsnotiz eines anderen; Schadensmeldung eines Fremden. Gefunden wurde nur die Krankenstands-Notiz (R-02).

**Kanäle:** JSON; CSV (`/monat/export.csv`, `/monat/buak.csv`, `/fuhrpark/export.csv`, `/offene-posten.csv`, `/zahlungseingaenge.csv`, `/urlaub/export.csv`); XLSX (`/baustellen/:id/positionen/export.xlsx`, `/stammdaten/:art/export.xlsx` – mit ExcelJS geöffnet, Zellen, Formeln und Zahlenformate); PDF (Bautagesbericht AG/intern, Servicebuch, Tages-/Wochenplan, Fern-PDF – Flate-Streams entpackt, Text extrahiert); Fehlertexte (403/404/409/400); alle Benachrichtigungen aller Mitarbeiter/Poliere in der DB (keine Budget-Meldung, kein €); Push-Ausgang (Plan, Abwesenheit, Budget, Schaden); E-Mail-Ausgang (AG-Bericht); Oberfläche.

**Weitere Rechteprüfungen ohne Befund:** € nie an Mitarbeiter/Polier (auch nicht in `kostenTag`, Positionen, Leistungsmeldungen, Fuhrpark-Kosten, Servicebuch-PDF/CSV mit `?kosten=1` → 403); Bauleiter: Nachkalkulation, Positionen, Fremdleistungen, LV, Rechnungen, Offene Posten, Dokumente nur eigener Baustellen; nie `preise_bearbeiten`/`lohn`; Lohngruppe anderer nie an Mitarbeiter/Polier/Bauleiter (`/mitarbeiter`, `/benutzer/:id/lohngruppen-verlauf` → 403); Mitarbeiter sieht nur eigene Zeiten, Schichten, Abwesenheiten, Urlaub, Einsatz; Protokoll, Rechte-Matrix, Benutzerliste, KI-/SMTP-/Sicherheits-Einstellungen, Sicherung nur GF; Dokumente: Mitarbeiter 403, Polier nur Polier-Kategorien eigener Baustellen (Liste, Einzelabruf, Datei, Suche nach Titel/Kategorie-Name/Kategorie-Filter); Vier-Augen-Prinzip (eigene Anträge, eigene Stempelzeiten); Push-Abos und Benachrichtigungen nur eigene (fremde ID → 404).

**Umgehungsversuche (`rechte-umgehung.test.js`, alle ohne Erfolg außer R-06/R-07):**
- Pfade für 14 geschützte Routen × 27 Schreibweisen × GET/HEAD/OPTIONS als Mitarbeiter und Polier: `/API/PREISE`, `/Api/Preise`, Schrägstrich am Ende, `//`, `/./`, `/x/../`, `%2e`, `%2f`, kodierte Buchstaben, `.json`, `;x`, `%00`, `%20`, `\`, `~` … Express routet ohne Groß/Klein-Unterscheidung und mit optionalem Schlussstrich auf **dieselbe** Route samt Rechteprüfung (403); alle anderen Varianten → 404 bzw. die statische App-Hülle (HTML ohne Daten). HEAD liefert dieselbe Ablehnung ohne Körper, OPTIONS → 404. `X-HTTP-Method-Override`, `X-HTTP-Method`, `X-Method-Override`, `_method` werden ignoriert.
- Bauleiter mit 17 Schreibweisen der fremden ID (`03`, `3.0`, `+3`, `%33`, `1,3`, `0x3`, `3e0`, `-3` …) auf sechs Routen: nie Daten der Baustelle 3.
- Parameter: `benutzerId` doppelt, als Liste, mit `%00`, mit Vorzeichen/führender Null auf Zeit-, Abwesenheits- und Urlaubsrouten: nie Daten anderer. Body mit Liste/String/Objekt/Kommazahl statt ID: 400/403 und DB unverändert. `POST /zeit/stempeln` mit fremder `benutzerId` bucht nur für sich. Kolonne: fremde Partie ohne `gast` → `ok:false`.
- IDOR (eigene Baustelle im Pfad, Objekt der fremden Baustelle als Kind-ID oder im Body): Positionsverlauf, Mengen, Leistungsmeldungen, Abschnitte, Dokumente (auch Datei), Berichtsfotos, Fernunterschrift-Links, Diktat-Assistent, `verschiebenVon` aus einem fremden Einsatz (Personen und Anlagen bleiben dort), Fuhre per `PUT` auf fremde Baustelle umbiegen, fremde Fuhre kopieren, Fuhre zwischen zwei fremden Baustellen anlegen, Einsatz per `PUT` auf andere Baustelle/Datum verschieben, fremde Fuhre in den eigenen Bericht übernehmen: alle abgewiesen, DB unverändert.
- Mass Assignment: `rolle`, `rechte`, `ausnahmen`, `lohngruppe`, `aktiv`, `pnr`, `id`, `pin_hash`, `muss_pin_aendern`, `version` in `/auth/telefon`, `/auth/pin`, `PUT/POST /benutzer` werden ignoriert; Büro kann niemanden zu GF/Büro/Bauleiter machen, sich selbst nicht ändern, keine Rechte vergeben; `status:"genehmigt"` in eigenen Anträgen bleibt `beantragt`; Bericht-`status`/`baustelleId`/`datum` per PUT unverändert; Schaden/Mangel mit `status`/`gemeldetVon` → `offen`/eigener Melder.
- Prototype Pollution (`__proto__`, `constructor.prototype`) in neun Routen (auch verschachtelt in `typen`, `notizen`, `fahrer`, `empfaenger`, `zweiFaktorPflicht`): kein Absturz, `Object.prototype` unverändert, Rechte unverändert.
- Content-Type: `text/plain`, Formular, Multipart, XML, `text/json`, ohne Kopf → 415 (auch Formular-Login).
- Sitzung: Deaktivierung (API und direkt in der DB) beendet die Sitzung sofort; Entzug einer Ausnahme und Änderung der Matrix wirken bei der nächsten Anfrage; Rollenwechsel beendet alle Sitzungen; Abmelden löscht die Sitzung am Server (altes Cookie → 401); Session Fixation: ein mitgebrachtes Cookie wird beim Anmelden ersetzt und beendet; Cookie `HttpOnly; SameSite=Strict; Path=/`, hinter HTTPS-Proxy `Secure`; Token 32 Byte hex; doppelte/manipulierte Cookies → 401.
- PIN raten: 5 Fehlversuche → 429, auch mit wechselndem `X-Forwarded-For` (ohne `TRUST_PROXY` wirkungslos) und über `/auth/pin`; mit `TRUST_PROXY=1` und 21 IP-Adressen greift die Kontosperre (423, auch mit richtiger PIN).
- Zwei-Faktor: nach der PIN keine Sitzung, kein Zugriff; TOTP-Code und Wiederherstellungscode nur einmal; verbrauchter/geratener Vorgang wirkungslos; nach 5 Fehlversuchen im Vorgang keine Anmeldung.
- Fernunterschrift: geratene/veränderte Tokens → 404/410; Link nur einmal verwendbar, danach 410 auch beim Lesen; AG-Fassung ohne €, ohne Krankenstand, ohne interne Felder (`kostenTag`, `pnr`, `telefon`, `lohngruppe`).
- Test-Schnittstellen: ohne/mit falschem/zu langem/großgeschriebenem Token 403; ohne `BAUTAG_TEST` nicht vorhanden (anonym 401, angemeldet 404); `NODE_ENV=production` + `BAUTAG_TEST=1` → Start verweigert.

**Oberfläche (`tests/e2e/rechte-ui.js`, Playwright):** Mitarbeiter und Polier, je Handy (390 px) und PC (1440 px), 37 Adressen der App direkt aufgerufen (auch nicht im Menü verlinkte wie `#/kalkulation/1`, `#/preise`, `#/monat`, `#/benutzer`, `#/offene-posten`, `#/korrektur`, `#/lohn-vorlagen`), 148 Seitenaufrufe, 2.226 Netzwerkantworten gescannt: kein €-Zeichen, kein Betrag, kein verbotener Menüpunkt, kein Kanarienvogel – weder sichtbar noch versteckt im DOM. Die App blendet nichts nur per CSS aus: Die verbotenen Daten kommen gar nicht erst an (Ausnahme R-01/R-02/R-05, die der Server mitschickt). Statische Dateien (`index.html`, `sw.js`, Manifest, alle JS-Module) enthalten keine Daten.

**Beobachtungen ohne Befund (vertragsgemäß, zur Entscheidung durch den Inhaber):**
- Mitarbeiter und Polier sehen alle **aktiven** Baustellen mit Auftraggeber, AG-Adresse und Bauherr-Vertreter (API.md 4).
- Der Bauleiter sieht **firmenweite** Preise (`/preise` inkl. Kostensätze der Lohngruppen, Gerätesätze, Katalog) – `preise_sehen` ist laut API.md 2 nicht baustellenbezogen, der Katalog laut 10f freigegeben.
- Der Polier sieht Urlaubskonten (Anspruch/Rest) seiner Partie (12.19); der Bauleiter in der internen Bericht-PDF die Kürzel K/U (API.md 6, `bericht_freigeben`).
- Der Polier sieht in „Meine Partie“ alle Notizen und Telefonnummern der Einsätze, in denen er eingeteilt ist – auch fremder Baustellen (12.8a/12.8d).
- `TRUST_PROXY=1` darf nur hinter dem Proxy gesetzt sein (dann gilt die IP aus `X-Forwarded-For`); direkt erreichbar wären die IP-Sperren umgehbar, die Kontosperre bleibt.
- Viele Schreib-Routen prüfen Pflichtfelder vor dem Recht (400 „datum fehlt.“), weil das Ziel erst aus dem Body kommt; die Texte enthalten keine Fachdaten (geprüft).

## 4. Ausführen der Tests

Im Ordner `app`:

```
node --test tests/api/rechte-matrix.test.js     # Matrix: alle Routen × Rollen (ca. 4–5 Min.)
node --test tests/api/rechte-umgehung.test.js   # Umgehungsversuche (ca. 15 s)
node tests/e2e/rechte-ui.js                     # Oberfläche mit Playwright (ca. 4 Min., Exit-Code 1 bei Befunden)
npm test                                        # enthält beide API-Testdateien
```

- Fehlersuche: `BAUTAG_RECHTE_NUR='<RegExp>'` beschränkt die Matrix-Proben auf passende Routen (der Abdeckungstest bleibt vollständig); `BAUTAG_RECHTE_BERICHT=<datei.json>` schreibt alle Meldungen in eine Datei; `BAUTAG_RECHTE_UI_LOG=1` protokolliert den UI-Rundgang, `BAUTAG_RECHTE_UI_BERICHT=<datei.json>` schreibt das UI-Ergebnis.
- **Neue Route:** Eintrag in `tests/api/rechte-matrix.json` mit `r` (Reihenfolge Mitarbeiter Polier Bauleiter Büro GF; `J` erlaubt, `N` verweigert, `E` nur eigenes Objekt, `O` öffentlich, `T` Test-Token), `pfad`/`query`/`body` mit Platzhaltern (`{bs}`, `{bericht}`, `{rechnung}` … siehe `PLATZHALTER` in `rechte-matrix.test.js`) und `grund` (Fundstelle in API.md). Fehlt der Eintrag, scheitert „Abdeckung“.
- **Ausnahmen der Schlüsselprüfung** stehen mit Begründung in `SCHLUESSEL_AUSNAHMEN` (`rechte-matrix-hilfe.js`): `auftraggeber` (Name), `paletten.euro` (Stückzahl), `summe` in `/zeit/woche` (Stunden), Push-Schalter `budget`/`rechnung` (bool), `lohngruppen` in `/preise` und `lohngruppeId` in der Nachkalkulation (Preisliste bzw. Stunden je Lohngruppe, keine Person), eigene Lohngruppe in `/auth/ich` und nach der Anmeldung (API.md 12.22). Unter €-Schlüsseln zählen nur Zahlen, Zahl-Texte und Objekte (nicht `offen:false`, `db:"ok"`).
- **Flüchtige Tabellen** im DB-Fingerabdruck (`DB_FLUECHTIG`): `sitzung` (letzter Zugriff), `login_versuch`/`login_konto` (Anmeldebremse), `wetter_cache`, `push_abo` (Zustellversuch).

### Ergebnis der Läufe (Stand Commit 6f86efe)

| Lauf | Tests | bestanden | fehlgeschlagen | Bemerkung |
|---|---|---|---|---|
| `rechte-matrix.test.js` | 8 (1 + 7 Teiltests) | 4 | 4 | rot durch R-01, R-02, R-05 (Lesen, Ausnahmen) und R-07 |
| `rechte-umgehung.test.js` | 15 (1 + 14 Teiltests) | 11 | 4 | rot durch R-03, R-04, R-06 |
| `rechte-ui.js` | 148 Seitenaufrufe, 2.226 Antworten | – | 24 Meldungen | R-01, R-02, R-05 (Polier), R-08; Mitarbeiter ohne Meldung |
| `npm test` gesamt | 592 | 584 | 8 | alle 569 bestehenden Tests grün; die 8 roten sind die neuen Tests oben |

## 5. Neue Dateien

- `app/tests/api/rechte-matrix.test.js` – Matrix-Test (Abdeckung, Lesen, ohne Anmeldung, Benachrichtigungen/Push/E-Mail, Schreiben mit DB-Fingerabdruck, Recht vor Zustand, Ausnahmen)
- `app/tests/api/rechte-matrix.json` – Rechte-Matrix aller 280 Routen (Daten)
- `app/tests/api/rechte-matrix-hilfe.js` – Routen aus dem Router, Basis-DB mit Kanarienvögeln, Scanner (JSON/CSV/PDF/XLSX), DB-Fingerabdruck
- `app/tests/api/rechte-umgehung.test.js` – Umgehungsversuche
- `app/tests/e2e/rechte-ui.js` – Playwright-Rundgang (eigenständig; nicht in `tests/e2e/run.js` eingehängt, weil der dortige Lauf eigene Server je Bildschirmgröße startet)

Anwendungscode wurde nicht verändert, es wurde nichts eingecheckt.

## 6. Vollständige Matrix (wie geprüft)

Legende: ✔ erlaubt · – verweigert (401/403/404, DB unverändert) · eigene = nur eigene Baustelle/eigenes Objekt (fremdes geprüft und verweigert) · öff. = ohne Anmeldung · Token = nur mit `X-BauTag-Test-Token` (nur Testbetrieb). „ok“ = wie in der Matrix verhalten, Inhalt ohne Befund.

| Route | MA | Pol | BL | Bü | GF | Fundstelle API.md | Befund |
|---|---|---|---|---|---|---|---|
| `GET /test/ausgang` | Token | Token | Token | Token | Token | 12.18 Test-Schnittstelle, nur mit Token | ok |
| `POST /test/zuruecksetzen` | Token | Token | Token | Token | Token | 12.18 | ok |
| `POST /test/wetter` | Token | Token | Token | Token | Token | 12.18 | ok |
| `POST /test/email` | Token | Token | Token | Token | Token | 12.18 | ok |
| `POST /test/ocr` | Token | Token | Token | Token | Token | 12.18 | ok |
| `POST /test/ki` | Token | Token | Token | Token | Token | 12.18 | ok |
| `POST /test/stuendlich` | Token | Token | Token | Token | Token | 12.18 | ok |
| `POST /test/uhr` | Token | Token | Token | Token | Token | 12.18 | ok |
| `GET /gesundheit` | öff. | öff. | öff. | öff. | öff. | 4 System / 7: für alle | ok |
| `GET /auth/benutzerliste` | öff. | öff. | öff. | öff. | öff. | 4 Auth / 7 B-03: nur {id,name} | ok |
| `POST /auth/login` | öff. | öff. | öff. | öff. | öff. | 4 Auth | ok |
| `GET /auth/2fa` | ✔ | ✔ | ✔ | ✔ | ✔ | 12.7 eigener Stand | ok |
| `POST /auth/2fa/einrichten` | – | – | ✔ | ✔ | ✔ | 12.7 nur bauleiter/buero/gf | ok |
| `POST /auth/2fa/bestaetigen` | ✔ | ✔ | ✔ | ✔ | ✔ | 12.7 eigenes Konto (ohne Einrichtung 400) | ok |
| `POST /auth/2fa/codes` | ✔ | ✔ | ✔ | ✔ | ✔ | 12.7 eigenes Konto | ok |
| `POST /auth/2fa/aus` | ✔ | ✔ | ✔ | ✔ | ✔ | 12.7 eigenes Konto | ok |
| `POST /auth/login/2fa` | öff. | öff. | öff. | öff. | öff. | 12.7 | ok |
| `GET /einstellungen/sicherheit` | – | – | – | – | ✔ | 12.7 Recht benutzer | R-06 |
| `PUT /einstellungen/sicherheit` | – | – | – | – | ✔ | 12.7 Recht benutzer | R-06 |
| `DELETE /benutzer/:id/2fa` | – | – | – | – | ✔ | 12.7 Recht benutzer | R-06 |
| `POST /auth/logout` | ✔ | ✔ | ✔ | ✔ | ✔ | 4 Auth | ok |
| `GET /auth/ich` | ✔ | ✔ | ✔ | ✔ | ✔ | 4 Auth (eigene Lohngruppe erlaubt, 12.22) | ok |
| `PUT /auth/telefon` | ✔ | ✔ | ✔ | ✔ | ✔ | 12.8d eigene Nummer | ok |
| `POST /auth/pin` | ✔ | ✔ | ✔ | ✔ | ✔ | 7 eigene PIN | ok |
| `GET /fern/:token` | öff. | öff. | öff. | öff. | öff. | 12.9 öffentlich mit Token (AG-Fassung ohne €) | ok |
| `GET /fern/:token/pdf` | öff. | öff. | öff. | öff. | öff. | 12.9 | ok |
| `POST /fern/:token` | öff. | öff. | öff. | öff. | öff. | 12.9 | ok |
| `GET /baustellen` | ✔ | ✔ | ✔ | ✔ | ✔ | 4 Stammdaten: alle, gefiltert; € nur mit Recht | R-04 |
| `GET /baustellen/:id` | ✔ | ✔ | ✔ | ✔ | ✔ | 4: MA/Polier aktive bzw. eigene; Bauleiter fremde ohne € | R-04 |
| `POST /baustellen` | – | – | – | ✔ | ✔ | 4/8: stammdaten | ok |
| `PUT /baustellen/:id` | – | – | – | ✔ | ✔ | 4/8: stammdaten | ok |
| `POST /baustellen/:id/phase` | – | – | eigene | ✔ | ✔ | 12.15: Büro/GF, Bauleiter eigene | R-07 |
| `POST /baustellen/:id/fertigmeldung` | – | eigene | eigene | – | – | 12.15: Polier/Bauleiter der Baustelle | ok |
| `POST /baustellen/:id/archiv-aufheben` | – | – | – | – | ✔ | 12.15: nur GF | ok |
| `GET /baustellen/:id/phasen` | ✔ | ✔ | ✔ | ✔ | ✔ | 12.15: wer die Baustelle sieht | ok |
| `PUT /baustellen/:id/abschluss` | – | – | – | ✔ | ✔ | 12.15: Büro/GF | ok |
| `GET /baustellen-kennzahlen` | – | – | ✔ | ✔ | ✔ | 12.15: Büro/GF, Bauleiter eigene | ok |
| `PUT /baustellen/:id/auftrag` | – | – | – | ✔ | ✔ | 4: preise_bearbeiten | ok |
| `POST /baustellen/:id/nachtraege` | – | – | – | ✔ | ✔ | 4: preise_bearbeiten | ok |
| `DELETE /baustellen/:id/nachtraege/:nid` | – | – | – | ✔ | ✔ | 4: preise_bearbeiten | ok |
| `GET /baustellen/:id/leistungen` | – | – | eigene | ✔ | ✔ | 7 M-03: Nachkalkulation der Baustelle | ok |
| `POST /baustellen/:id/leistungen` | – | – | eigene | ✔ | ✔ | 4: preise_bearbeiten oder Bauleiter eigene | ok |
| `DELETE /baustellen/:id/leistungen/:lid` | – | – | eigene | ✔ | ✔ | 7 M-03: wie Erfassen | ok |
| `GET /baustellen/:id/fremdleistungen` | – | – | eigene | ✔ | ✔ | 7 M-03: Preise für die Baustelle | ok |
| `POST /baustellen/:id/fremdleistungen` | – | – | – | ✔ | ✔ | 6: preise_bearbeiten | ok |
| `DELETE /baustellen/:id/fremdleistungen/:fid` | – | – | – | ✔ | ✔ | 7 M-03: preise_bearbeiten | ok |
| `GET /mitarbeiter` | ✔ | ✔ | ✔ | ✔ | ✔ | 4/6: gefiltert, lohngruppe/pnr nur stammdaten/lohn/benutzer | ok |
| `GET /geraete` | ✔ | ✔ | ✔ | ✔ | ✔ | 4: €-Felder nur mit preise_sehen | ok |
| `GET /materialien` | ✔ | ✔ | ✔ | ✔ | ✔ | 4 | ok |
| `GET /leistungen` | ✔ | ✔ | ✔ | ✔ | ✔ | 6: EP nur mit preise_sehen | ok |
| `GET /preise` | – | – | ✔ | ✔ | ✔ | 4: preise_sehen | ok |
| `PUT /preise/:art/:id` | – | – | – | ✔ | ✔ | 4: preise_bearbeiten | ok |
| `GET /preise/:art/:id/verlauf` | – | – | ✔ | ✔ | ✔ | 12.2: preise_sehen | ok |
| `DELETE /preise/:art/:id/verlauf/:vid` | – | – | – | ✔ | ✔ | 12.2: preise_bearbeiten | ok |
| `GET /zeit/status` | ✔ | ✔ | ✔ | ✔ | ✔ | 4 Zeit: zeit_eigen | ok |
| `POST /zeit/stempeln` | ✔ | ✔ | ✔ | ✔ | ✔ | 4 Zeit: zeit_eigen | ok |
| `GET /zeit/anwesend` | – | – | ✔ | ✔ | ✔ | 6: freigeben/stammdaten/lohn/kalk_sehen; Bauleiter eigene | ok |
| `GET /zeit/kolonne` | – | eigene | eigene | – | ✔ | 6: kolonne, nur eigene Baustellen | ok |
| `POST /zeit/kolonne` | – | eigene | eigene | – | ✔ | 4/7 B-02: kolonne, eigene | ok |
| `GET /zeit/woche` | ✔ | ✔ | ✔ | ✔ | ✔ | 4: eigene Woche | ok |
| `GET /zeit/buchungen` | eigene | eigene | eigene | ✔ | ✔ | 7: ohne stammdaten nur eigene | ok |
| `POST /zeit/buchungen` | – | – | – | ✔ | ✔ | 7: stammdaten | ok |
| `PUT /zeit/buchungen/:id` | – | – | – | ✔ | ✔ | 7: stammdaten | ok |
| `DELETE /zeit/buchungen/:id` | – | – | – | ✔ | ✔ | 7: stammdaten | ok |
| `GET /zeit/schichten` | eigene | eigene | eigene | ✔ | ✔ | 8 C-04: eigene; andere nur Büro/GF | ok |
| `POST /zeit/schichten` | – | – | – | ✔ | ✔ | 8 C-04: Büro/GF | ok |
| `DELETE /zeit/schichten/:id` | – | – | – | ✔ | ✔ | 8 C-04: Büro/GF | ok |
| `GET /abwesenheiten` | ✔ | ✔ | ✔ | ✔ | ✔ | 7 B-07: Bereich; K nur stammdaten/lohn/selbst | R-01, R-02 |
| `POST /abwesenheiten` | eigene | eigene | eigene | ✔ | ✔ | 4/7: eigene U/ZA; andere stammdaten | R-03 |
| `PUT /abwesenheiten/:id` | – | – | – | ✔ | ✔ | 7 B-07: stammdaten/lohn (Bauleiter nur SW) | ok |
| `DELETE /abwesenheiten/:id` | eigene | eigene | eigene | ✔ | ✔ | 7 B-07: eigene beantragte, sonst stammdaten/lohn | ok |
| `POST /abwesenheiten/zeitraum` | eigene | eigene | eigene | ✔ | ✔ | 12.24: wie POST /abwesenheiten | R-03 |
| `GET /abwesenheiten/antraege` | ✔ | ✔ | ✔ | ✔ | ✔ | 12.24: Sichtbarkeit wie GET /abwesenheiten | R-02 |
| `PUT /abwesenheiten/antraege/:antragId` | – | – | – | ✔ | ✔ | 12.24: stammdaten/lohn | ok |
| `DELETE /abwesenheiten/antraege/:antragId` | eigene | eigene | eigene | ✔ | ✔ | 12.24: eigener beantragter, sonst stammdaten/lohn | ok |
| `GET /berichte` | – | ✔ | ✔ | ✔ | ✔ | 4: Polier eigene Baustellen | ok |
| `POST /berichte` | – | eigene | eigene | ✔ | ✔ | 4: bericht_erstellen im Bereich | ok |
| `GET /berichte/:id` | – | eigene | eigene | ✔ | ✔ | 4: kostenTag nur mit preise_sehen | ok |
| `PUT /berichte/:id` | – | eigene | eigene | ✔ | ✔ | 4: Bereich | ok |
| `POST /berichte/:id/personal-aktualisieren` | – | eigene | eigene | ✔ | ✔ | 6: Bereich | ok |
| `POST /berichte/:id/unterschrift` | – | eigene | eigene | ✔ | ✔ | 4: Bereich | ok |
| `DELETE /berichte/:id/unterschrift/:rolle` | – | eigene | eigene | ✔ | ✔ | 7: bericht_erstellen im Bereich | ok |
| `POST /berichte/:id/freigeben` | – | – | eigene | ✔ | ✔ | 2: bericht_freigeben (Bauleiter eigene) | ok |
| `GET /berichte/:id/pdf` | – | eigene | eigene | ✔ | ✔ | 4: nie € | ok |
| `GET /kalkulation` | – | – | ✔ | ✔ | ✔ | 4: kalk_sehen, Bauleiter eigene | ok |
| `GET /kalkulation/:baustelleId` | – | – | eigene | ✔ | ✔ | 4: kalk_sehen, Bauleiter eigene | ok |
| `GET /positionen/katalog` | – | – | ✔ | ✔ | ✔ | 10f: Bauleiter darf den Katalog sehen | ok |
| `POST /positionen/katalog` | – | – | – | ✔ | ✔ | 10: preise_bearbeiten | ok |
| `PUT /positionen/katalog/:id` | – | – | – | ✔ | ✔ | 10 | ok |
| `DELETE /positionen/katalog/:id` | – | – | – | ✔ | ✔ | 10 | ok |
| `POST /positionen/katalog/import` | – | – | – | ✔ | ✔ | 10 | ok |
| `GET /baustellen/:id/positionen` | – | – | eigene | ✔ | ✔ | 10: kalk_sehen | ok |
| `POST /baustellen/:id/positionen` | – | – | – | ✔ | ✔ | 10: preise_bearbeiten | ok |
| `PUT /baustellen/:id/positionen/:pid` | – | – | – | ✔ | ✔ | 10 | ok |
| `DELETE /baustellen/:id/positionen/:pid` | – | – | – | ✔ | ✔ | 10 | ok |
| `POST /baustellen/:id/positionen/aus-vorlage` | – | – | – | ✔ | ✔ | 10 | ok |
| `POST /baustellen/:id/positionen/:pid/mengen` | – | – | eigene | ✔ | ✔ | 10: preise_bearbeiten oder Bauleiter eigene | ok |
| `DELETE /baustellen/:id/positionen/:pid/mengen/:mid` | – | – | eigene | ✔ | ✔ | 10f E-07: Bauleiter nur selbst erfasste | ok |
| `GET /positionen/katalog/:id/verlauf` | – | – | ✔ | ✔ | ✔ | 12.2: preise_sehen | ok |
| `DELETE /positionen/katalog/:id/verlauf/:vid` | – | – | – | ✔ | ✔ | 12.2 | ok |
| `GET /baustellen/:id/positionen/:pid/verlauf` | – | – | eigene | ✔ | ✔ | 12.2: Preise der Baustelle | ok |
| `DELETE /baustellen/:id/positionen/:pid/verlauf/:vid` | – | – | – | ✔ | ✔ | 12.2: preise_bearbeiten | ok |
| `GET /baustellen/:id/positionen/export.xlsx` | – | – | eigene | ✔ | ✔ | 10: Export mit Preisen | ok |
| `GET /benachrichtigungen` | ✔ | ✔ | ✔ | ✔ | ✔ | 4: nur eigene, Budget nie an MA/Polier | ok |
| `POST /benachrichtigungen/alle-gelesen` | ✔ | ✔ | ✔ | ✔ | ✔ | 4: eigene | ok |
| `POST /benachrichtigungen/:id/gelesen` | eigene | eigene | eigene | eigene | eigene | 4: nur eigene | ok |
| `GET /monat` | – | – | – | ✔ | ✔ | 4: lohn | ok |
| `GET /monat/export.csv` | – | – | – | ✔ | ✔ | 4: lohn | ok |
| `GET /monat/buak.csv` | – | – | – | ✔ | ✔ | 4: lohn | ok |
| `GET /rechte` | – | – | – | – | ✔ | 4/8: benutzer (GF) | ok |
| `PUT /rechte/matrix` | – | – | – | – | ✔ | 4: benutzer | ok |
| `PUT /rechte/ausnahme` | – | – | – | – | ✔ | 4: benutzer | ok |
| `GET /benutzer` | – | – | – | ✔ | ✔ | 8 C-14: Büro verwaltet MA/Polier/Bauleiter | ok |
| `POST /benutzer` | – | – | – | ✔ | ✔ | 8/9 | ok |
| `PUT /benutzer/:id` | – | – | – | ✔ | ✔ | 8/9 | ok |
| `GET /benutzer/:id/lohngruppen-verlauf` | – | – | – | ✔ | ✔ | 12.22: stammdaten/lohn/benutzer | ok |
| `DELETE /benutzer/:id/lohngruppen-verlauf/:vid` | – | – | – | ✔ | ✔ | 12.22: Schreibrecht | ok |
| `POST /benutzer/:id/entsperren` | – | – | – | ✔ | ✔ | 8/9 | ok |
| `GET /integrationen` | ✔ | ✔ | ✔ | ✔ | ✔ | 12.14: Zustand ohne Einstellungen | ok |
| `POST /integrationen/:schluessel` | ✔ | ✔ | ✔ | ✔ | ✔ | 4: 501 nicht angebunden | ok |
| `POST /integrationen/:schluessel/*rest` | ✔ | ✔ | ✔ | ✔ | ✔ | 4: 501 nicht angebunden | ok |
| `GET /fuhrpark/anlagen` | ✔ | ✔ | ✔ | ✔ | ✔ | 11.1: alle (ohne € ohne preise_sehen) | ok |
| `GET /fuhrpark/anlagen/:id` | ✔ | ✔ | ✔ | ✔ | ✔ | 11.1 | ok |
| `POST /fuhrpark/anlagen` | – | – | – | ✔ | ✔ | 11.1: fuhrpark | ok |
| `GET /fuhrpark/anlagen/:id/vorlagen-vorschlag` | – | – | – | ✔ | ✔ | 11.10: fuhrpark | ok |
| `PUT /fuhrpark/anlagen/:id` | – | – | – | ✔ | ✔ | 11.1 | ok |
| `POST /fuhrpark/anlagen/:id/sperre` | – | – | – | ✔ | ✔ | 11.1 | ok |
| `POST /fuhrpark/anlagen/:id/ausscheiden` | – | – | – | ✔ | ✔ | 11.1 | ok |
| `POST /fuhrpark/anlagen/:id/zaehler` | – | – | – | ✔ | ✔ | 11.1 | ok |
| `PUT /fuhrpark/zaehler/:zid` | – | – | – | ✔ | ✔ | 11.1 | ok |
| `GET /fuhrpark/zaehler/:zid/verlauf` | – | ✔ | ✔ | ✔ | ✔ | 11.1: Leserecht | ok |
| `POST /fuhrpark/zaehlerstaende` | ✔ | ✔ | ✔ | ✔ | ✔ | 11.1: alle | ok |
| `PUT /fuhrpark/zaehlerstaende/:id` | – | – | – | ✔ | ✔ | 11.1: fuhrpark | ok |
| `POST /fuhrpark/zaehler/:zid/tausch` | – | – | – | ✔ | ✔ | 11.1 | ok |
| `GET /fuhrpark/zaehlerabfrage` | ✔ | ✔ | ✔ | ✔ | ✔ | 11.1: alle | ok |
| `GET /fuhrpark/vorlagen` | – | ✔ | ✔ | ✔ | ✔ | 11.1: Leserecht | ok |
| `POST /fuhrpark/vorlagen` | – | – | – | ✔ | ✔ | 11.1 | ok |
| `PUT /fuhrpark/vorlagen/:id` | – | – | – | ✔ | ✔ | 11.1 | ok |
| `POST /fuhrpark/vorlagen/:id/anwenden` | – | – | – | ✔ | ✔ | 11.1 | ok |
| `GET /fuhrpark/anlagen/:id/plan` | – | ✔ | ✔ | ✔ | ✔ | 11.1: Leserecht | ok |
| `POST /fuhrpark/anlagen/:id/plan` | – | – | – | ✔ | ✔ | 11.1 | ok |
| `PUT /fuhrpark/anlagen/:id/plan/:pid` | – | – | – | ✔ | ✔ | 11.1 | ok |
| `DELETE /fuhrpark/anlagen/:id/plan/:pid` | – | – | – | ✔ | ✔ | 11.1 | ok |
| `GET /fuhrpark/eintraege` | – | ✔ | ✔ | ✔ | ✔ | 11.1: Leserecht | ok |
| `GET /fuhrpark/eintraege/:id` | – | ✔ | ✔ | ✔ | ✔ | 11.3: Leserecht | ok |
| `POST /fuhrpark/eintraege` | – | – | – | ✔ | ✔ | 11.1 | ok |
| `PUT /fuhrpark/eintraege/:id` | – | – | – | ✔ | ✔ | 11.1 | ok |
| `POST /fuhrpark/eintraege/:id/storno` | – | – | – | ✔ | ✔ | 11.1 | ok |
| `GET /fuhrpark/maengel` | ✔ | ✔ | ✔ | ✔ | ✔ | 11.1: eigene bzw. alle mit Leserecht | ok |
| `POST /fuhrpark/maengel` | ✔ | ✔ | ✔ | ✔ | ✔ | 11.1: alle | ok |
| `PUT /fuhrpark/maengel/:id` | – | – | – | ✔ | ✔ | 11.1: fuhrpark | ok |
| `GET /fuhrpark/schaeden` | ✔ | ✔ | ✔ | ✔ | ✔ | 11.9: Sichtbereich | ok |
| `GET /fuhrpark/schaeden/:id` | eigene | eigene | eigene | ✔ | ✔ | 11.9: außerhalb des Sichtbereichs 403 | ok |
| `POST /fuhrpark/schaeden` | ✔ | ✔ | ✔ | ✔ | ✔ | 11.9: alle | ok |
| `PUT /fuhrpark/schaeden/:id` | – | – | – | ✔ | ✔ | 11.9: fuhrpark/Büro/GF | ok |
| `POST /fuhrpark/schaeden/:id/fotos` | eigene | – | – | ✔ | ✔ | 11.9: Melder (offene) bzw. fuhrpark/Büro/GF | ok |
| `GET /fuhrpark/schaeden/:id/fotos/:fid` | eigene | eigene | eigene | ✔ | ✔ | 11.9: Sichtbereich | ok |
| `DELETE /fuhrpark/schaeden/:id/fotos/:fid` | – | – | – | ✔ | ✔ | 11.9: fuhrpark/Büro/GF | ok |
| `GET /fuhrpark/fristen` | – | – | – | ✔ | ✔ | 11.1: fuhrpark | ok |
| `GET /fuhrpark/uebersicht` | – | – | – | ✔ | ✔ | 11.1: fuhrpark | ok |
| `GET /fuhrpark/export.csv` | – | – | – | ✔ | ✔ | 11.1: fuhrpark | ok |
| `GET /fuhrpark/anlagen/:id/servicebuch.pdf` | – | ✔ | ✔ | ✔ | ✔ | 11.1: Leserecht, Standard ohne € | ok |
| `GET /system/sicherung` | – | – | – | – | ✔ | 12.1: benutzer | ok |
| `GET /push/schluessel` | ✔ | ✔ | ✔ | ✔ | ✔ | 12.3 | ok |
| `POST /push/abo` | ✔ | ✔ | ✔ | ✔ | ✔ | 12.3: eigenes Abo | ok |
| `DELETE /push/abo` | ✔ | ✔ | ✔ | ✔ | ✔ | 12.3: nur eigene (fremder endpoint bleibt) | ok |
| `GET /push/abos` | ✔ | ✔ | ✔ | ✔ | ✔ | 12.3: eigene | ok |
| `DELETE /push/abos/:aid` | eigene | eigene | eigene | eigene | eigene | 12.3: eigenes Abo | ok |
| `GET /push/einstellungen` | ✔ | ✔ | ✔ | ✔ | ✔ | 12.3 | ok |
| `PUT /push/einstellungen` | ✔ | ✔ | ✔ | ✔ | ✔ | 12.3 | ok |
| `POST /push/test` | ✔ | ✔ | ✔ | ✔ | ✔ | 12.3: eigene Abos | ok |
| `GET /baustellen/:id/wetter` | ✔ | ✔ | ✔ | ✔ | ✔ | 12.4: wer die Baustelle sehen darf | ok |
| `POST /berichte/:id/wetter` | – | eigene | eigene | ✔ | ✔ | 12.4: Bearbeitungsrecht | ok |
| `GET /einstellungen/email` | – | – | – | – | ✔ | 12.5: benutzer | ok |
| `PUT /einstellungen/email` | – | – | – | – | ✔ | 12.5: benutzer | ok |
| `POST /einstellungen/email/test` | – | – | – | – | ✔ | 12.5: benutzer | ok |
| `POST /berichte/:id/email` | – | – | eigene | ✔ | ✔ | 12.5: bericht_freigeben im Bereich oder stammdaten | ok |
| `POST /berichte/:id/fotos` | – | eigene | eigene | ✔ | ✔ | 12.6: Bearbeitungsrecht | ok |
| `PUT /berichte/:id/fotos/:fid` | – | eigene | eigene | ✔ | ✔ | 12.6 | ok |
| `DELETE /berichte/:id/fotos/:fid` | – | eigene | eigene | ✔ | ✔ | 12.6 | ok |
| `GET /berichte/:id/fotos/:fid` | – | eigene | eigene | ✔ | ✔ | 12.6: wer den Bericht sehen darf | ok |
| `GET /stammdaten/:art` | – | – | ✔ | ✔ | ✔ | 12.21: stammdaten oder preise_sehen | ok |
| `POST /stammdaten/:art` | – | – | – | ✔ | ✔ | 12.21: stammdaten | ok |
| `PUT /stammdaten/:art/:id` | – | – | – | ✔ | ✔ | 12.21 | ok |
| `DELETE /stammdaten/:art/:id` | – | – | – | ✔ | ✔ | 12.21 | ok |
| `GET /stammdaten/:art/export.xlsx` | – | – | ✔ | ✔ | ✔ | 12.21: €-Spalten nur mit preise_sehen | ok |
| `POST /stammdaten/:art/import` | – | – | – | ✔ | ✔ | 12.21 | ok |
| `GET /einstellungen/plan` | – | – | ✔ | ✔ | ✔ | 12.8a: Planer/Bauleiter | ok |
| `PUT /einstellungen/plan` | – | – | – | ✔ | ✔ | 12.8a: Büro/GF | ok |
| `GET /plan/woche` | – | – | ✔ | ✔ | ✔ | 12.8: Planer, Bauleiter eigene | ok |
| `POST /plan/einsaetze` | – | – | eigene | ✔ | ✔ | 12.8: Bauleiter eigene | ok |
| `PUT /plan/einsaetze/:id` | – | – | eigene | ✔ | ✔ | 12.8 | ok |
| `DELETE /plan/einsaetze/:id` | – | – | eigene | ✔ | ✔ | 12.8 | ok |
| `POST /plan/einsaetze/:id/personen` | – | – | eigene | ✔ | ✔ | 12.8 | ok |
| `PUT /plan/einsaetze/:id/personen/:bid` | – | – | eigene | ✔ | ✔ | 12.8a | ok |
| `DELETE /plan/einsaetze/:id/personen/:bid` | – | – | eigene | ✔ | ✔ | 12.8 | ok |
| `POST /plan/einsaetze/:id/anlagen` | – | – | eigene | ✔ | ✔ | 12.8 | ok |
| `PUT /plan/einsaetze/:id/anlagen/:aid` | – | – | eigene | ✔ | ✔ | 12.8a | ok |
| `DELETE /plan/einsaetze/:id/anlagen/:aid` | – | – | eigene | ✔ | ✔ | 12.8 | ok |
| `POST /plan/tag/uebernehmen` | – | – | ✔ | ✔ | ✔ | 12.8c: Bauleiter nur Tage mit eigenen Baustellen | ok |
| `POST /plan/vorwoche-uebernehmen` | – | – | ✔ | ✔ | ✔ | 12.8 | ok |
| `POST /plan/veroeffentlichen` | – | – | ✔ | ✔ | ✔ | 12.8: Bauleiter nur seine Baustellen | ok |
| `GET /plan/ich` | ✔ | ✔ | ✔ | ✔ | ✔ | 12.8: alle, nur eigene | R-08 |
| `POST /plan/ich/bestaetigen` | ✔ | ✔ | ✔ | ✔ | ✔ | 12.8: eigene | ok |
| `GET /plan/partie` | – | ✔ | ✔ | ✔ | ✔ | 12.8: Polier (Planer/Bauleiter) | ok |
| `POST /plan/anfragen` | – | ✔ | ✔ | – | – | 12.8: Polier, Bauleiter | ok |
| `GET /plan/anfragen` | ✔ | ✔ | ✔ | ✔ | ✔ | 12.8: Planer alle; sonst nur eigene | ok |
| `PUT /plan/anfragen/:id` | – | – | eigene | ✔ | ✔ | 12.8: Planer (Bauleiter eigene) | ok |
| `GET /plan/zeitplan` | – | ✔ | ✔ | ✔ | ✔ | 12.8: Polier lesend Bereich | ok |
| `POST /baustellen/:id/abschnitte` | – | – | eigene | ✔ | ✔ | 12.8: wie Einsätze | ok |
| `PUT /baustellen/:id/abschnitte/:aid` | – | – | eigene | ✔ | ✔ | 12.8 | ok |
| `DELETE /baustellen/:id/abschnitte/:aid` | – | – | eigene | ✔ | ✔ | 12.8 | ok |
| `GET /plan/fuhren` | – | – | ✔ | ✔ | ✔ | 12.8b: Planer, Bauleiter eigene | ok |
| `POST /plan/fuhren` | – | – | eigene | ✔ | ✔ | 12.8b | ok |
| `PUT /plan/fuhren/:id` | – | – | eigene | ✔ | ✔ | 12.8b | ok |
| `DELETE /plan/fuhren/:id` | – | – | eigene | ✔ | ✔ | 12.8b | ok |
| `POST /plan/fuhren/kopieren` | – | – | eigene | ✔ | ✔ | 12.8b | ok |
| `POST /plan/fuhren/wie-vortag` | – | – | ✔ | ✔ | ✔ | 12.8c | ok |
| `POST /plan/fuhren/:id/status` | eigene | – | eigene | ✔ | ✔ | 12.8b: Fahrer oder Planer | ok |
| `POST /plan/fuhren/:id/foto` | eigene | – | eigene | ✔ | ✔ | 12.8b: Fahrer oder Planer | ok |
| `GET /plan/fuhren/:id/foto/:fid` | eigene | eigene | eigene | ✔ | ✔ | 12.8b: Fahrer, Planer, Polier der Zielbaustelle | ok |
| `POST /berichte/:id/fuhren-uebernehmen` | – | eigene | eigene | ✔ | ✔ | 12.8b: Bearbeitungsrecht | ok |
| `PUT /materialien/:id` | – | – | – | ✔ | ✔ | 12.8b: stammdaten | ok |
| `GET /plan/tag.pdf` | – | ✔ | ✔ | ✔ | ✔ | 12.23: Mitarbeiter 403 | ok |
| `GET /plan/woche.pdf` | – | ✔ | ✔ | ✔ | ✔ | 12.23 | ok |
| `GET /dokument-kategorien` | ✔ | ✔ | ✔ | ✔ | ✔ | 12.16: Liste der Kategorien (ohne Dokumente) | ok |
| `POST /dokument-kategorien` | – | – | – | – | ✔ | 12.16: nur GF | ok |
| `PUT /dokument-kategorien/:schluessel` | – | – | – | – | ✔ | 12.16: benutzer | ok |
| `DELETE /dokument-kategorien/:schluessel` | – | – | – | – | ✔ | 12.16: benutzer | ok |
| `GET /baustellen/:id/dokumente` | – | eigene | eigene | ✔ | ✔ | 12.16: Mitarbeiter 403, Polier/Bauleiter eigene | ok |
| `GET /dokumente/suche` | – | ✔ | ✔ | ✔ | ✔ | 12.16: über alle sichtbaren Baustellen | ok |
| `GET /baustellen/:id/dokumente/:did` | – | eigene | eigene | ✔ | ✔ | 12.16 | ok |
| `POST /baustellen/:id/dokumente` | – | – | eigene | ✔ | ✔ | 12.16: Polier nur lesen | ok |
| `POST /baustellen/:id/dokumente/:did/versionen` | – | – | eigene | ✔ | ✔ | 12.16 | ok |
| `PUT /baustellen/:id/dokumente/:did` | – | – | eigene | ✔ | ✔ | 12.16 | ok |
| `DELETE /baustellen/:id/dokumente/:did` | – | – | eigene | ✔ | ✔ | 12.16 | ok |
| `POST /baustellen/:id/dokumente/:did/wiederherstellen` | – | – | – | ✔ | ✔ | 12.16: Büro/GF | ok |
| `GET /baustellen/:id/dokumente/:did/datei` | – | eigene | eigene | ✔ | ✔ | 12.16 | ok |
| `GET /rechnungen` | – | – | ✔ | ✔ | ✔ | 12.17: preise_sehen, Bauleiter eigene | ok |
| `GET /rechnungen/:id` | – | – | eigene | ✔ | ✔ | 12.17 | ok |
| `POST /baustellen/:id/rechnungen` | – | – | – | ✔ | ✔ | 12.17: preise_bearbeiten | ok |
| `PUT /rechnungen/:id` | – | – | – | ✔ | ✔ | 12.17 | ok |
| `POST /rechnungen/:id/storno` | – | – | – | ✔ | ✔ | 12.17 | ok |
| `POST /rechnungen/:id/zahlungen` | – | – | – | ✔ | ✔ | 12.17 | ok |
| `DELETE /rechnungen/:id/zahlungen/:zid` | – | – | – | ✔ | ✔ | 12.17 | ok |
| `POST /rechnungen/:id/mahnungen` | – | – | – | ✔ | ✔ | 12.17 | ok |
| `GET /offene-posten` | – | – | ✔ | ✔ | ✔ | 12.17: Bauleiter eigene | ok |
| `GET /offene-posten.csv` | – | – | ✔ | ✔ | ✔ | 12.17 | ok |
| `GET /zahlungseingaenge.csv` | – | – | ✔ | ✔ | ✔ | 12.17 | ok |
| `GET /urlaub/feiertage` | ✔ | ✔ | ✔ | ✔ | ✔ | 12.19: alle | ok |
| `GET /urlaub/kalender` | ✔ | ✔ | ✔ | ✔ | ✔ | 12.19: Sichtbereich, K nur Büro/selbst | ok |
| `GET /urlaub/konto` | ✔ | ✔ | ✔ | ✔ | ✔ | 12.19: Mitarbeiter nur sich | R-05 |
| `PUT /urlaub/konto/:benutzerId/:jahr` | – | – | – | ✔ | ✔ | 12.19: stammdaten/lohn | ok |
| `POST /urlaub/betriebsurlaub` | – | – | – | ✔ | ✔ | 12.19: stammdaten | ok |
| `GET /urlaub/warnungen` | – | – | ✔ | ✔ | ✔ | 12.19: Planer, Bauleiter eigene | ok |
| `GET /einstellungen/urlaub` | – | – | – | ✔ | ✔ | 12.19: stammdaten | ok |
| `PUT /einstellungen/urlaub` | – | – | – | ✔ | ✔ | 12.19: stammdaten | ok |
| `GET /urlaub/export.csv` | – | – | – | ✔ | ✔ | 12.19: stammdaten/lohn | ok |
| `GET /import/bmd-op/zuordnung` | – | – | ✔ | ✔ | ✔ | 12.20 (Zuordnung ohne Beträge; Lesen mit preise_sehen) | ok |
| `PUT /import/bmd-op/zuordnung` | – | – | – | ✔ | ✔ | 12.20: preise_bearbeiten | ok |
| `POST /import/bmd-op` | – | – | – | ✔ | ✔ | 12.20: preise_bearbeiten | ok |
| `GET /import/lv/zuordnung` | – | – | ✔ | ✔ | ✔ | 12.20 | ok |
| `PUT /import/lv/zuordnung` | – | – | – | ✔ | ✔ | 12.20 | ok |
| `POST /baustellen/:id/lv-import` | – | – | – | ✔ | ✔ | 12.20: preise_bearbeiten | ok |
| `GET /baustellen/:id/lv` | – | – | eigene | ✔ | ✔ | 12.20: € nur mit Preisrecht (Baustelle) | ok |
| `PUT /baustellen/:id/lv/:lid` | – | – | – | ✔ | ✔ | 12.20 | ok |
| `GET /lohn-vorlagen` | – | – | – | ✔ | ✔ | 12.20: lohn | ok |
| `POST /lohn-vorlagen` | – | – | – | ✔ | ✔ | 12.20: lohn | ok |
| `PUT /lohn-vorlagen/:id` | – | – | – | ✔ | ✔ | 12.20 | ok |
| `DELETE /lohn-vorlagen/:id` | – | – | – | ✔ | ✔ | 12.20 | ok |
| `POST /berichte/:id/unterschrift-link` | – | eigene | eigene | ✔ | ✔ | 12.9: Bearbeitungsrecht | ok |
| `GET /berichte/:id/unterschrift-links` | – | eigene | eigene | ✔ | ✔ | 12.9 | ok |
| `DELETE /berichte/:id/unterschrift-links/:lid` | – | eigene | eigene | ✔ | ✔ | 12.9 | ok |
| `POST /bericht-assistent/text` | – | eigene | eigene | ✔ | ✔ | 12.10: Bearbeitungsrecht | ok |
| `POST /berichte/:id/lieferschein` | – | eigene | eigene | ✔ | ✔ | 12.11 | ok |
| `POST /berichte/:id/papier` | – | eigene | eigene | ✔ | ✔ | 12.12 | ok |
| `POST /berichte/papier` | – | ✔ | ✔ | ✔ | ✔ | 12.12: bericht_erstellen | ok |
| `GET /einstellungen/ki` | – | – | – | – | ✔ | 12.13: benutzer | ok |
| `PUT /einstellungen/ki` | – | – | – | – | ✔ | 12.13 | ok |
| `POST /einstellungen/ki/test` | – | – | – | – | ✔ | 12.13 | ok |

