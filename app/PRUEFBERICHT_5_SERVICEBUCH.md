# BEFUNDE 5 – Servicebuch und „Schäden mit Fotos“ (Branch `servicebuch`, Stand ede0dd6)

Geprüft am 13.11.2026, unabhängig, ohne Änderung am Checkout (`git status` vorher/nachher leer).

## Urteil

**Nicht freigabereif.** Zwei Befunde der Stufe „hoch“ blockieren (F-01, F-02). Kein Befund „kritisch“.
Die Sicherheitsanforderungen (€-Sperre, Foto-Sichtbereich, Pfad-Tricks, XSS) haben in allen Versuchen gehalten.

| ID | Stufe | Kurz |
|---|---|---|
| F-01 | hoch | Schaden an fremdem Gerät + „nicht einsatzfähig“ → 500; Meldung hängt ewig in der Warteschlange und blockiert alle weiteren |
| F-02 | hoch | Fristen ohne erfasste letzte Durchführung werden nie überfällig (§57a sperrt nie, springt still auf grün) |
| F-03 | mittel | Rückdatierter Eintrag setzt „zuletzt durchgeführt“ zurück → Position fälschlich überfällig |
| F-04 | mittel | Storno macht fremde Zählerstände ungültig (auch den Startstand) |
| F-05 | mittel | Geräteuhr > 5 min voraus → Schadensmeldung 400; offline gemeldet → nur „Verwerfen“ |
| F-06 | mittel | Warteschlange: jedes 5xx gilt als „keine Verbindung“, kein Verwerfen, Kopf blockiert alle |
| F-07 | mittel | Bildprüfung nur strukturell: leere/kaputte Bilder, Riesenmaße, Metadaten in Sonderabschnitten bleiben |
| F-08 | niedrig | Eintrag „behebt“ auch verworfene Mängel; Storno öffnet sie wieder → Sperre |
| F-09 | niedrig | Prüfung „schwere Mängel“ setzt die §57a-Position trotzdem auf erledigt |
| F-10 | niedrig | „gesperrt seit“ mit UTC-Datum statt Wiener Datum |
| F-11 | niedrig | Zweite Anlage zum selben Gerät senkt rückwirkend die Schätzung der ersten |
| F-12 | niedrig | Bauleiter sieht Schäden seiner Leute ohne Baustellenangabe nicht |
| F-13 | niedrig | Servicebuch-PDF zeigt Schadenstexte außerhalb des Sichtbereichs (keine Fotos) |
| F-14 | niedrig | Uploads: Ordner nicht an die Datenbank gebunden, Datei-Waisen, keine Mengengrenze |
| F-15 | niedrig | Doku weicht ab (Cache-Control, `einmaligAm` erledigt) |
| F-16 | niedrig | Abgelehnte Fotos beim Nachsenden gehen ohne Hinweis verloren (unbestätigt) |

## Testergebnisse

- `npm test`: **358/358 bestanden** (43 s).
- `npm run test:e2e`: **bestanden** – Handy 727/727, Tablet 722/722, PC 722/722 (mit `BAUTAG_UPLOADS` auf Scratch, siehe F-14).
- Eigene API-Proben gegen den echten Server (`:memory:`, steuerbare Uhr): Skripte `p1.js`–`p5.js` im Scratch-Ordner.
- Eigener UI-Durchlauf mit Playwright: 6 Rollen (Mitarbeiter, Polier, Polier mit `fuhrpark`, Bauleiter, Büro, GF) × 390×844 / 1180×820 / 1440×900. Alle Bestandsansichten, alle Fuhrpark-Reiter, 6 Anlagen mit allen Reitern und Dialogen, Schadensdetail, Glocke. Daten vorher mit HTML/JS-Nutzlast in 30 Textfeldern und Dateinamen gefüllt.
  **Ergebnis: 0 Konsolenfehler, 0 fehlgeschlagene Anfragen, kein waagrechter Überlauf, kein eingeschleustes HTML, kein € ohne Preisrecht.** (Einziger Treffer war der Satz „Exporte enthalten keine Kosten.“)
- Migration: Datenbank mit dem Hauptstand (Schema 8, Demo-Daten, eine Rechte-Ausnahme) erzeugt, dann diesen Stand darauf gestartet. Schema 9 angewendet, `buero`/`gf` haben `fuhrpark`, 20 Vorlagen angelegt, Benachrichtigungen erhalten, `foreign_key_check` und `integrity_check` sauber, Anlage anlegen und `/geraete` funktionieren.

## Was gehalten hat

- **€:** Polier/Mitarbeiter (auch mit `fuhrpark`) erhalten in keiner Route, keinem CSV/PDF, keiner Benachrichtigung und keiner Fehlermeldung Beträge – geprüft ohne Sicherheitsnetz. `kosten=1` → 403, Kosten senden → 400, `preise_sehen` als Ausnahme → 400. Eine Protokoll-Route gibt es nicht.
- **Fotos:** Sichtbereich laut Vertrag für 8 Meldungsfälle × 8 Benutzer geprüft, kein Leck. Kein statischer Zugriff, Pfad-Tricks → 400/404, GIF/SVG/HTML abgelehnt, > 8 MB → 400, > 12 MB → 413, Polyglot-Anhang abgeschnitten, EXIF/XMP/Kommentare echter Kamerabilder entfernt. Auslieferung mit `nosniff`, `no-store`, eigener CSP mit `sandbox`. Service Worker fasst `/api` nicht an.
- **Fälligkeit:** Rechenbeispiele 5.3, Monatsgenauigkeit (31.10. fällig, 01.11. überfällig), Monatsende-Regel, Vorlauf-Drittelung (90 Tage → 30), −10 %-Grenze, Prognose, Tagesgrenze nach Wiener Zeit (23:59 / 00:01).
- **Erinnerungen:** je Stufe und Zyklus einmal, auch nach Ungültig-Setzen und erneutem Eintragen; Montagslauf erst ab 06:00 Wien.
- **Zähler:** kein Rückgang, Sprung → `unplausibel`, idempotente Wiederholung, Tausch mit stetigem Gesamtstand.
- **Offline:** Antwort geht zweimal verloren, Server hat aber verarbeitet → am Ende genau eine Meldung mit zwei Fotos. Parallele Anfragen mit gleicher `clientId` → 201/200, kein Duplikat.

---

## Befunde

### F-01 (hoch) – Schaden an fremdem Gerät + „nicht einsatzfähig“ → 500, Warteschlange blockiert
`app/server/routes/fuhrpark.js:901-904` (`meldeMangel`), Aufruf `:1047`.

**Repro (API):** als beliebiger Benutzer
`POST /api/fuhrpark/schaeden {"fremdGeraet":"Mietbagger Fa. Huber","art":"unfall","ursache":"Ausleger gegen Brücke gestoßen","einsatzfaehig":"nein"}`
**Repro (Oberfläche, Handy, Mitarbeiter):** Mehr → Schaden melden → „Anderes Gerät“ → Art, Ursache → „Nein – stilllegen“ → senden.

**Beobachtet:**
- 500, `TypeError: Cannot read properties of null (reading 'row')` – `A` ist bei fremdem Gerät `null`.
- Die Oberfläche meldet „Keine Verbindung – die Meldung ist am Gerät gespeichert und wird automatisch gesendet.“ Bei jedem Nachsenden wieder 500.
- Eine danach **offline** erfasste zweite Meldung wurde nach Rückkehr des Netzes nicht gesendet (2× `POST … 500`, Warteschlange weiter mit beiden Einträgen, am Server nichts). Die Reihenfolge wird gewahrt, der fehlerhafte Kopf blockiert alles dahinter.
- Der Eintrag zeigt „wartet auf Verbindung“ und hat keinen Knopf „Verwerfen“.
- Mit Foto im selben Aufruf bleibt die Datei im Upload-Ordner liegen, obwohl die Transaktion zurückgerollt wurde.

**Erwartet:** 201, Benachrichtigung „Schaden gemeldet“ an Fuhrpark/Büro/GF, keine Sperre (kein eigenes Gerät).

**Vorschlag:** `const gesperrt = A && m.dringlichkeit === 'sofort';` und den Zweig ohne Anlage wie bisher benachrichtigen. Test für `fremdGeraet` × alle drei `einsatzfaehig` ergänzen. Dazu F-06.

### F-02 (hoch) – Ohne erfasste letzte Durchführung wird eine Frist nie überfällig
`app/server/fuhrpark.js:194` (`folgeMonate`), `:229` (`jaehrlichAm`).

**Repro:** Büro legt an: PKW M1, Erstzulassung 05.12.2023, Vorlage `57a_m1`, ohne `letzteDatum`. Uhr vorstellen.

| Datum | Status Position | Anlage |
|---|---|---|
| 12.11.2026 | bald (Begutachtungsmonat 12/2026) | bald |
| 15.12.2026 – 30.04.2027 | fällig | fällig |
| **01.05.2027** | **ok, nächster Termin 12/2028** | **einsatzbereit** |

Gleiches Bild bei LKW N3 (EZ 10/2021, `57a_jaehrlich`, ohne letzte Durchführung): am 12.11.2026 sofort „ok, 10/2027“, obwohl die Begutachtung 10/2026 nicht erfasst ist. `winter_lkw`: am 14.11. fällig, am 16.11. „ok, 31.10.2027“.

**Beobachtet:** Der Zyklus wird ohne `letzte_datum` aus „heute“ bestimmt und wandert mit. `ueberfaellig` ist so unerreichbar, `sperrtBeiUeberfaellig` greift nie, es gibt keine Überfällig-Meldung. Betrifft jede Erstbegutachtung eines Neufahrzeugs (Demo A10) und jede Anlage, deren Papiere nicht nachgetragen wurden.

**Erwartet:** Konzept 5.5/5.7: nach Ablauf der Toleranz überfällig, sperrende Position sperrt.

**Einordnung:** Der Code folgt dem Entwurf 5.2 A1/A3 wörtlich („ohne L: erstes Sk mit Sk + Toleranz ≥ Monat(H)“). Der Fehler liegt im Vertrag, wirkt aber im Betrieb.

**Vorschlag:** Den Bezugspunkt ohne `letzte_datum` festhalten statt mitlaufen lassen – z. B. Anlagedatum der Planposition (neue Spalte `erstellt`) statt `H`. Der einmal bestimmte Termin bleibt dann stehen, bis ein Eintrag ihn erledigt. Entwurf und Unit-Tests anpassen.

### F-03 (mittel) – Rückdatierter Eintrag setzt „zuletzt durchgeführt“ zurück
`app/server/routes/fuhrpark.js:820`.

**Repro:** A01, „Massenspeicher auslesen“ hat letzte Durchführung 24.08.2026 (Status bald). Büro erfasst nachträglich einen Eintrag mit Datum 15.07.2026 und hakt die Position an.
**Beobachtet:** `letzteDatum` = 15.07.2026, Status **überfällig** (fällig 13.10.2026). Bei einer sperrenden Position wäre das Fahrzeug damit gesperrt.
**Erwartet:** Es gilt die jüngste nicht stornierte Durchführung – so rechnet der Storno-Pfad (`positionNeuBerechnen`) bereits.
**Vorschlag:** Nach dem Einfügen `positionNeuBerechnen(pid)` aufrufen statt direkt zu überschreiben, oder nur überschreiben, wenn `datum ≥ letzte_datum`.

### F-04 (mittel) – Storno macht übernommene Zählerstände ungültig
`app/server/routes/fuhrpark.js:811` (Übernahme) und `:876` (Storno).

**Repro 1:** Mitarbeiter trägt für A05 heute 389.100 km ein. Büro erfasst einen Eintrag mit demselben Stand und storniert ihn.
**Beobachtet:** Der Stand des Mitarbeiters ist `ungueltig`, letzter Stand wieder 389.000 km vom 08.11.
**Repro 2:** Eintrag am Startdatum des Zählers mit dem Startstand, dann Storno.
**Beobachtet:** Der Stand mit Quelle `start` ist `ungueltig`; der Wochenschnitt ändert sich (923 → 956,9), ältere Nachträge scheitern danach mit „vor dem Beginn der Zählererfassung“.
**Erwartet:** Storno entwertet nur Stände, die der Eintrag selbst angelegt hat.
**Vorschlag:** Beim Storno nur `quelle = 'eintrag'` ungültig setzen; bei übernommenen Ständen lediglich `eintrag_id` lösen.

### F-05 (mittel) – Geräteuhr geht vor: Schadensmeldung wird abgelehnt
`app/public/js/views/schaeden.js:136`, `app/server/routes/fuhrpark.js:1031`.

**Repro:** Browseruhr 10 Minuten vorstellen, Schaden melden.
**Beobachtet:** 400, im Dialog steht „zeitpunkt darf nicht in der Zukunft liegen.“ Senden ist nicht möglich. Wird dieselbe Meldung offline erfasst, landet sie beim Nachsenden im Zustand „Fehler“ mit „Verwerfen“ als einziger Möglichkeit (aus dem Code gelesen, nicht durchgespielt).
**Erwartet:** Die Meldung kommt an.
**Vorschlag:** Server kappt einen Zeitpunkt in der Zukunft auf „jetzt“ statt abzulehnen (die Grenze „älter als 1 Jahr“ kann bleiben).

### F-06 (mittel) – Warteschlange unterscheidet Serverfehler nicht von fehlendem Netz
`app/public/js/schaden-offline.js:30`, `:70`; `app/public/js/views/schaeden.js:211`.

**Beobachtet (in F-01 belegt):** Jede Antwort ≥ 500 gilt als vorläufig. Der Eintrag wird endlos wiederholt, der Benutzer liest „wartet auf Verbindung“, kann nicht verwerfen, und `break` hält alle späteren Meldungen auf.
**Erwartet:** Ein dauerhaft fehlschlagender Eintrag blockiert die übrigen nicht und ist für den Benutzer erkennbar.
**Vorschlag:** Versuche je Eintrag zählen; nach z. B. 3 Antworten 5xx Zustand „Fehler“ mit Text „Server meldet einen Fehler – bitte Büro verständigen“ und „Verwerfen“/„Erneut senden“; mit dem nächsten Eintrag fortfahren statt `break`.

### F-07 (mittel) – Bildprüfung nur strukturell
`app/server/fuhrpark-bild.js:63`, `:86`, `:99`, `:113`, `:164`.

Alle Fälle über `POST /schaeden/:id/fotos` angenommen (201):
- JPEG aus SOI, SOF, SOS, EOI ohne Bilddaten (27 Bytes) – wird als kaputtes Bild angezeigt.
- PNG mit 100.000 × 100.000 Pixeln und 10 Bytes IDAT – keine Obergrenze für die Bildgröße.
- Text bleibt erhalten in: reservierten JPEG-Segmenten (0xF0, 0xC8), PNG-`iCCP` (Profilname und Inhalt), WebP-Unterabschnitten innerhalb `ANMF`.
- Dateiname behält Unicode-Steuerzeichen (U+202E, „a‮gpj.exe“).

**Einordnung:** EXIF/GPS üblicher Kamerabilder wird entfernt, die Oberfläche schreibt Fotos ohnehin neu als JPEG, und die Auslieferung ist gegen aktive Inhalte abgesichert. Es bleibt die Annahme nicht darstellbarer Bilder und ein Schlupfloch für absichtlich versteckte Daten über die API.
**Vorschlag:** JPEG-Segmente auf eine feste Liste beschränken (DQT, DHT, SOFn, SOS, DRI, DNL, JFIF-APP0) und DQT + DHT verlangen; `iCCP` und animierte WebP verwerfen; Kantenlänge begrenzen (z. B. 12.000 px); Steuerzeichen der Kategorien Cf/Cc aus Dateinamen entfernen.

### F-08 (niedrig) – Eintrag „behebt“ auch verworfene Mängel, Storno öffnet sie
`app/server/routes/fuhrpark.js:803`, `:822`, `:878`.
**Repro:** Mangel „sofort“ verwerfen; Eintrag mit `maengelIds:[id]` → Status `behoben`; Eintrag stornieren → Status `offen`, Anlage wieder gesperrt.
**Vorschlag:** In `maengelIds` nur offene Meldungen zulassen (sonst 400).

### F-09 (niedrig) – Prüfung mit schweren Mängeln erledigt die Frist trotzdem
`app/server/routes/fuhrpark.js:820`, `:823`.
**Repro:** A12, Eintrag Art `pruefung`, `schwere_maengel`, §57a-Position angehakt.
**Beobachtet:** Anlage gesperrt (richtig), Position aber „ok“, nächster Termin im Folgezyklus. Nach dem Entsperren steht das Fahrzeug grün da, obwohl die Begutachtung nicht bestanden ist.
**Vorschlag:** Bei `schwere_maengel` `planpositionIds` ablehnen oder ignorieren und in der Antwort darauf hinweisen.

### F-10 (niedrig) – „gesperrt seit“ nach UTC
`app/server/fuhrpark.js:348`, `:350`; ebenso `fuhrpark-export.js` (PDF-Datum der Mängel).
**Repro:** Mangel „sofort“ um 00:01 Wiener Zeit am 13.11. → `seit: "2026-11-12"`.
**Vorschlag:** `wienDatum(new Date(…))` statt `slice(0, 10)`.

### F-11 (niedrig) – Zweite Anlage zum selben Gerät verändert rückwirkend die Schätzung
`app/server/fuhrpark-daten.js:42`; `app/server/routes/berichte.js:222`.
**Repro:** A17 (einziger Mobilbagger): Stand ≈ 6.410, Rest 300 Std. Zweite Anlage mit demselben Gerät anlegen.
**Beobachtet:** A17 fällt auf 6.385 (nicht mehr geschätzt), Rest 325; 193,5 Std. der letzten 90 Tage erscheinen als „nicht zugeordnet“.
**Einordnung:** Entspricht Entwurf 7.1, überrascht aber im Betrieb. Zusätzlich lässt der Bericht je Gerät nur eine Zeile zu – zwei Radlader am selben Tag auf derselben Baustelle lassen sich nicht getrennt erfassen.
**Vorschlag:** Beim Anlegen der zweiten Anlage die bisher automatisch zugerechneten Zeilen der ersten fest zuschreiben (`anlage_id` setzen); Hinweis in der Oberfläche.

### F-12 (niedrig) – Bauleiter sieht Schäden ohne Baustellenangabe nicht
`app/server/fuhrpark-daten.js:262-276`.
**Beobachtet:** Meldung von Mitarbeiter 2 (Partie Pitten) ohne `baustelleId`: Polier 1 sieht sie, Bauleiter 103 (Bauleiter von Pitten) erhält 403. Über „Mehr → Schaden melden“ wird keine Baustelle mitgegeben, wenn der Melder nicht eingestempelt ist.
**Einordnung:** Entspricht API.md 11.9, die Vorgabe „sein Polier/Bauleiter“ ist damit für den Bauleiter nur teilweise erfüllt. Kein Leck.
**Vorschlag:** Für den Bauleiter die Stamm-Baustelle des Melders wie beim Polier heranziehen oder die Baustelle im Dialog abfragen.

### F-13 (niedrig) – Servicebuch-PDF zeigt Schadenstexte außerhalb des Sichtbereichs
`app/server/fuhrpark-export.js:152`.
**Beobachtet:** Jeder mit Leserecht (z. B. Polier einer anderen Baustelle) erhält im PDF unter „Offene Mängel und Schäden“ Ursache und Melder aller offenen Schäden der Anlage. Dasselbe gilt für die Ursache im Sperrgrund der Anlagenliste (für alle). Fotos sind nicht betroffen.
**Vorschlag:** Bewusst entscheiden und in API.md festhalten, oder Schäden im PDF über `schadenSichtbar` filtern.

### F-14 (niedrig) – Uploads: Ablage und Aufräumen
`app/server/index.js:53-55`, `app/server/routes/fuhrpark.js:974`, `:1044`.
- Der Standardordner `app/data/uploads` hängt nicht an `BAUTAG_DB`. `npm run test:e2e` setzt `BAUTAG_DB` auf einen Temp-Pfad, aber nicht `BAUTAG_UPLOADS` und schreibt deshalb in den Checkout – dort lagen vor meinem Lauf bereits 30 Testdateien.
- Scheitert die Transaktion nach dem Schreiben der Datei, bleibt die Datei liegen (in F-01 belegt).
- Keine Mengengrenze je Benutzer: beliebig viele Meldungen mit je 5 Fotos.
- Sicherung von Datenbank **und** Fotoordner ist nicht dokumentiert.

**Vorschlag:** Standard `<Ordner der DB>/uploads`; im E2E `BAUTAG_UPLOADS` setzen; Datei erst nach erfolgreichem Commit behalten bzw. bei Fehler löschen; Hinweis zur Sicherung in die README.

### F-15 (niedrig) – Dokumentation weicht ab
- API.md 11.9 nennt `Cache-Control: private, max-age=300`; der Code sendet `no-store` (`routes/fuhrpark.js:1110`, Commit 9b5780f).
- API.md 11.2: `einmaligAm` gilt als erledigt, wenn `letzteDatum` ≥ Anlage der Frist; der Code setzt bei jedem `letzteDatum` „erledigt“ (`fuhrpark.js:239`, belegt mit `letzteDatum 2020-01-01`, Frist 2028).

### F-16 (niedrig, unbestätigt) – Abgelehnte Fotos beim Nachsenden ohne Hinweis
`app/public/js/schaden-offline.js:52`, `:69`.
Aus dem Code gelesen: Lehnt der Server beim automatischen Nachsenden ein Foto ab (400/403, z. B. Meldung inzwischen abgeschlossen), wird es als gesendet markiert und das Ergebnis `fotoFehler` verworfen. Der Benutzer erfährt nichts. Nicht durchgespielt.

---

## Hinweise

- Auf der Maschine läuft ein fremder BauTag-Server (PID 725, Port 4599, `BAUTAG_DB=/tmp/bt-smoke-…`, gestartet 12:34 aus diesem Checkout). Er stammt nicht aus dieser Prüfung und wurde nicht angefasst. Die von mir gestarteten Server (3500, 3501, 3502) sind beendet.
- Nicht geprüft: echte Kamerafotos von iPhone/Android (nur synthetische Bilder), Verhalten bei sehr großem Datenbestand (`ladeStand` lädt bei jeder Anfrage alle Zählerstände und Berichtszeilen; mit Demo-Daten 5 ms).
- Scratch: `/tmp/claude-0/-home-user-Stundenaufzeichnung/1c043855-ef33-5685-9374-56f053b5f049/scratchpad/review5/` (Skripte `p1.js`–`p5.js`, `ui1.js`, `ui2.js`, `xss-seed.js`, Protokolle `npmtest.log`, `e2e.log`, Bildschirmfotos in `shots/`).
