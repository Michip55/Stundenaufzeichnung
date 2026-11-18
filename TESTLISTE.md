# BauTag – Testliste (Ausbaustufe 2)

So probieren Sie die Testversion aus. Alle Namen, Baustellen und Zahlen sind **erfunden** (Beispieldaten).

## Starten

1. Einmalig Node.js „LTS“ von https://nodejs.org installieren (immer „Weiter“).
2. Im Ordner **`BauTag-starten-Windows.bat`** doppelklicken (Mac: `BauTag-starten-Mac.command`). Der Browser öffnet sich mit http://localhost:3000.
3. Anmelden: Namen antippen, **PIN 1234**. Am Anmeldebildschirm ist **„Eigenes Handy“** vorgewählt (bleibt angemeldet, gilt sofort nach der Anmeldung); nur für ein Tablet, das mehrere benutzen, **„Geteiltes Gerät“** wählen (Abmeldung nach 30 Minuten ohne Bedienung; bleibt für dieses Gerät eingestellt, änderbar auch unter „Mehr“).
4. **Handy im selben WLAN:** Das Startfenster zeigt zusätzlich eine Adresse wie `192.168.0.23:3000` – diese am Handy mit `http://` davor öffnen. Fragt Windows nach der Firewall, „Zugriff zulassen“ (privates Netzwerk) wählen. Installieren am Startbildschirm, Push-Nachrichten und Offline-Betrieb gehen erst mit dem Server mit HTTPS.
5. Zum Neuanfang: BauTag-Fenster schließen, **`BauTag-Testdaten-zuruecksetzen-Windows.bat`** doppelklicken, `JA` eingeben.

Tipp: Zwei Browserfenster nebeneinander (eines davon „privat/inkognito“), dann können Sie z. B. als Büro und als Polier gleichzeitig angemeldet sein.

## Wer ist wer (Beispieldaten)

| Rolle | Name zum Anmelden | Wofür |
|---|---|---|
| Geschäftsführung | Michael Pichler | alles, inkl. Rechte sowie Büro- und Bauleiter-Konten |
| Büro | Martina Koller | Preise, Lohn, Rechnungen, Planung, Urlaub genehmigen |
| Bauleiter | Stefan Aigner | wie Büro (Entscheidung 13.11.2026), stempelt im Büro |
| Polier | Josef Haidbauer (WHA Pitten) | Partie, Bautagesbericht, Schlechtwetter melden |
| Mitarbeiter | Lukas Brandstätter | Stempeln, Mein Einsatz, Urlaub beantragen |
| LKW-Fahrer | Karl Ungersböck | Meine Fuhren mit Google-Maps-Link |

## 1. Büro / Bauleiter (Martina Koller oder Stefan Aigner)

**Einteilung für morgen (Baustellenplaner)**
- [ ] Planer öffnen → Ansicht **„Morgen“**. Die Einteilung ist „vorbereitet wie heute“. Freitags steht dort der **Montag**.
- [ ] Eine Person aus „Noch frei“ auf eine Baustelle ziehen (am Tablet: antippen → „Einteilen“).
- [ ] Bei einer Person und bei einem LKW eine **Notiz** eintragen, beim LKW einen **Fahrer** wählen, bei der Baustelle „**Benötigt/Mitnehmen**“ ausfüllen.
- [ ] Eine **Fuhre** anlegen: z. B. Rollschotter RK 16/63, 45 t, Grube → WHA Pitten, Abladestelle.
- [ ] **„Einteilung für morgen veröffentlichen“** → das Fenster zeigt, wer benachrichtigt wird. Erst nach „Bestätigen“ wird gesendet. Danach oben grün „Veröffentlicht hh:mm“.
- [ ] Etwas ändern und nochmals veröffentlichen → nur die Betroffenen bekommen „Geändert …“.
- [ ] **Tagesplan drucken (PDF)** – vor dem Veröffentlichen mit Wasserzeichen „ENTWURF“.
- [ ] Erwartung: Nichts wird je automatisch veröffentlicht. Um 17:00 kommt nur eine Erinnerung.

**Stammdaten & Preise**
- [ ] Ein Material **anlegen**, den **Preis mit „gültig ab“** ändern, einen **Code umbenennen** (Hinweis auf angepasste Verweise).
- [ ] Ein verwendetes Material **löschen** → Angebot „stattdessen deaktivieren“. Danach fehlt es in der Auswahl, alte Berichte zeigen es weiter.
- [ ] „Excel herunterladen“ → Preis ändern → „Excel hochladen“ → Vorschau → übernehmen.
- [ ] **Vordefinierte Pausen** (unten „Weitere Stammdaten“): Dauern z. B. auf „30, 45, 60“ lassen oder ändern – die Stempeluhr bietet genau diese plus „offen“ an.

**Nachkalkulation & Rechnungen**
- [ ] Baustelle öffnen → Nachkalkulation nach Positionen, Budget-Anzeige, Landschaftsabgabe.
- [ ] Eine **Rechnung erfassen**, eine **Zahlung** buchen → „Offene Posten“, Überfällige.
- [ ] Menü **„Rechnungen“** → **„Neue Rechnung“**: Die Eingabe ist in sechs Abschnitte gegliedert (Rechnung · Auftraggeber & Baustelle · Beträge · Zahlungsbedingungen · Rücklässe · Anhang & Notiz; am PC zweispaltig, am Handy untereinander). Eine echte Auer-Rechnung abschreiben, z. B. die **Regieaufstellung 000/W26**: Baustelle wählen (Rechnungsempfänger wird aus dem Auftraggeber vorbelegt und lässt sich überschreiben, z. B. „Handler Bau GmbH, Walter Handler Straße 1, 2853 Bad Schönau“), „KSt./Zeichen des Auftraggebers“ (KSt.: 030/1643.00), **Reverse Charge**, Netto **1.775,75** (USt 0,00 und Brutto 1.775,75 werden vorgeschlagen), Skonto **3 %** **21 Tage**, Zahlungsziel **30 Tage**. Erwartung: unter „Zahlungsvereinbarungen“ steht wie in Auer „21 Tage (bis …) · 3 % Skonto · € 1.722,48“ und „30 Tage (bis …) · ohne Abzug · € 1.775,75“.
- [ ] USt-Art, Zahlungsziel und Skonto sind bei einer neuen Rechnung **leer** – nichts wird still vorgegeben. Gibt es schon eine Rechnung an denselben Auftraggeber, erscheint der Hinweis „Letzte Rechnung an …“ mit **„Diese Werte übernehmen“** (nur auf Knopfdruck). „Kein Skonto“ ist auswählbar.
- [ ] Netto/USt/Brutto absichtlich falsch abschreiben (z. B. Brutto 1 Cent zu viel geht noch, 5 € zu viel nicht) → gelber Hinweis „Brutto passt nicht …“, Speichern geht erst, wenn die Beträge zusammenpassen (±0,02 €). Bei Reverse Charge ist die USt immer 0,00.
- [ ] Skonto **als Betrag** statt Prozent eintragen (z. B. € 53,27) → in der Rechnung steht beides (Betrag und gerechnete Prozent).
- [ ] Skonto **„Zahlbetrag mit Skonto“** wählen und den Betrag von der Rechnung abschreiben (z. B. Netto 40.000,00, Deckungsrücklass 3 %, „zahlbar abzgl. Skonto € 45.163,20“, 14 Tage) → unter dem Zahlbetrag 46.560,00 stehen „Skonto 3 % bis … − € 1.396,80“ und fett „Zahlbetrag mit Skonto € 45.163,20“. Zur Kontrolle „Skonto % laut Rechnung“ 3 eintragen → grün „passt“; den Betrag um 5 Cent falsch eintragen → gelber Hinweis „Papier … – gerechnet …, bitte prüfen“ (Speichern geht trotzdem). Betrag gleich oder größer als der Zahlbetrag → Meldung, nicht gespeichert. Zwischen %, € und Zahlbetrag mit Skonto wechseln → der Wert wird umgerechnet. Speichern, Rechnung öffnen (gleiche zwei Zeilen, „eingetragen als Zahlbetrag mit Skonto“), „Bearbeiten“ → wieder mit dem eingetragenen Betrag. Am Handy und am PC ansehen.
- [ ] Eine Teilrechnung mit **Deckungsrücklass** (z. B. 5 %) **und** **Haftrücklass** (z. B. € 300, „frei ab“) → Vorschau zieht beide vom Brutto ab; in „Offene Posten“ steht je Rücklass eine Zeile. Bei der Zahlung „Auszahlung Deckungsrücklass/Haftrücklass“ wählen.
- [ ] Seite **„Rechnungen“**: Filter Baustelle, Status (Offen/Überfällig/Bezahlt), Art, Rechnungsdatum von–bis.
- [ ] **Fälligkeiten** (Übersicht → „Geld“ → „Fälligkeiten“, oder auf der Seite „Rechnungen“): Gruppen **Überfällig · Diese Woche · Nächste Woche · Später**; je Rechnung „mit Skonto € … bis …“ (nur solange die Skontofrist läuft) und „ohne Skonto € … bis …“; Rücklässe als graue Zeilen „Haftrücklass € … frei ab …“; Summen je Gruppe. Am Handy und am PC ansehen. Zeile antippen öffnet die Rechnung.
- [ ] **„Offen gesamt“** steht oben auf „Rechnungen“ und „Fälligkeiten“ und in der Übersicht unter „Geld“ (davon überfällig, in den nächsten 7 Tagen fällig, Rücklässe einbehalten).
- [ ] **„Als bezahlt markieren“**: In den Fälligkeiten auf **✓** tippen (oder „Bezahlt“ in der Liste, „Als bezahlt markieren“ in der Rechnung) → vorgeschlagen ist heute und, solange die Skontofrist läuft, der Betrag **mit Skonto** (danach der volle Betrag). Rücklässe bleiben offen, außer „inkl. Rücklass“ ist angehakt. Nach dem Buchen im Hinweis oben **„Rückgängig“** tippen → alles wie vorher. Teilzahlungen weiter über „Zahlung buchen“.
- [ ] **Zahlungsabgleich**: „Als bezahlt markieren“ → bei „Tatsächlich bezahlt“ den Betrag vom Kontoauszug eintragen (z. B. 1.700,00 statt erwartet 1.722,48) → die **Differenz** erscheint sofort; aufteilen in Gründe, z. B. Bankspesen 2,48 **akzeptiert** und „Umlage/Abzug des Auftraggebers – Bauwesenversicherung“ 20,00 **strittig**. Gebucht wird erst, wenn alles aufgeteilt ist. Danach: Rechnung „bezahlt · Differenz strittig“, in den Fälligkeiten unter **„Offene Differenzen“**, in „Offen gesamt“ als „strittige Differenzen“. In der Rechnung lässt sich die Differenz später **akzeptieren**. Skonto nach der Frist abgezogen → wird als „verspätet – unberechtigt“ markiert. Mehr bezahlt → „Überzahlung“ mit Notiz.
- [ ] In der **Übersicht** heißt es jetzt „Rechnungen“ (z. B. „Weitere offene Rechnungen € … im Rahmen“) statt „Offene Posten“/„Schlussrechnungen offen“; „Schlussrechnung fehlt“ (abgenommen, keine Schlussrechnung) bleibt.
- [ ] **Dokument** zu einer Baustelle hochladen (z. B. Angebot als PDF).

**Urlaub**
- [ ] Offene Anträge → einen **ganzen Antrag** mit einem Klick genehmigen (keine Einzeltage). Den **eigenen** Antrag und das **eigene** Urlaubskonto kann niemand selbst entscheiden oder ändern (Vier-Augen-Prinzip).
- [ ] Einen genehmigten Antrag **korrigieren** (einen Tag herausnehmen) → Urlaubskonto rechnet neu.
- [ ] Urlaubskalender: Krankenstand „K“, Urlaub, Betriebsurlaub in eigener Farbe.

**Stempeln im Büro**
- [ ] Stempeluhr: Kostenstelle **„Büro“** ist vorgewählt.
- [ ] **Am Handy** öffnet BauTag nach der Anmeldung direkt die **Stempeluhr**; unten: Stempeln · Übersicht · Baustellen · Planer · Mehr (Berichte unter „Mehr“). Am PC startet weiter die Übersicht.
- [ ] **Am Handy** zoomt ein schneller Doppeltipp (z. B. auf „+“, Ziffern, Knöpfe) **nicht** hinein; mit zwei Fingern zoomen geht weiter.

**Benutzer**
- [ ] Büro/Bauleiter verwalten nur Mitarbeiter und Poliere. Büro- und Bauleiter-Konten verwaltet nur die Geschäftsführung; beim eigenen Konto steht statt „Bearbeiten“ ein Hinweis.

**Monat & Lohn**
- [ ] Monatsauswertung → Lohn-CSV, Vorlage „BMD NTCS“ (Lohnarten sind Platzhalter, bitte mit der Lohnverrechnung abstimmen).
- [ ] **Stunden als Std:Min**: Monatsauswertung zeigt Stunden als **9:51** (= 9 Std. 51 Min.) statt 9,85. Oben **„Std:Min | Dezimal“** umschalten → „Dezimal“ zeigt die Zahlen wie in der Lohnverrechnung (9,85); nach dem Neuladen bleibt die Wahl auf diesem Gerät. Die Lohn-CSV, BMD- und BUAK-Dateien bleiben immer dezimal. Als Mitarbeiter: „Meine Woche“ und Stempeluhr „Heute“ zeigen z. B. **„9 Std. 51 Min.“**. **Summen nachrechnen:** eine Woche mit 5 Tagen zu 07:00–14:40 → jeder Tag „7 Std. 40 Min.“, Summe **„38 Std. 20 Min.“** (nicht 38:21); in der Monatsauswertung ergibt die Summe die Zellen der Zeile, im Bautagesbericht die Gesamtstunden die Zeilen (3 × 7:40 = 23:00). Im Modus „Dezimal“ steht dagegen die Summe der Lohnverrechnung (z. B. 38,35).
- [ ] **Arbeitszeitmodelle** (Stammdaten & Preise → Reiter „Arbeitszeitmodelle“): ein Teilzeit-Modell anlegen (z. B. 20 Std., Mo–Do 5, nur Woche, Vollzeit 39) → unter **Benutzer** einer Person mit **„gültig ab“** zuordnen (rückwirkend wird eigens bestätigt), dort auch **„BUAK-pflichtig“** prüfen → Monatsauswertung zeigt unter dem Namen das Modell und in der Spalte **„Mehr“** die Mehrstunden; die BUAK-Grundlage enthält nur BUAK-pflichtige Personen. Bauarbeiter rechnen weiter nach KV Bau (8/8/8/8/7 Std.), Büro-Angestellte nach „Büro (Mo–Do 8,5 · Fr 5)“: z. B. Dienstag 9,5 Std. = 1 Überstunde.

## 2. Polier (Josef Haidbauer)

- [ ] **Meine Partie morgen**: wer eingeteilt ist, wer gelesen/bestätigt hat, Geräte mit Service-Hinweis, Fuhren mit Status.
- [ ] **Alle einstempeln** für die Partie. Jede Person wird angenommen – ob jemand laut Büro abwesend ist, erfährt nur das Büro.
- [ ] **Alle in Pause** (Kolonne): Auswahl **30 Min · 45 Min · 60 Min · offen** → bei jeder Person „Pause bis …“; nach Ablauf sind alle wieder eingestempelt, ohne dass jemand tippt. Wer früher fertig ist, beendet seine Pause selbst.
- [ ] **Bautagesbericht** ausfüllen, Fuhren-Mengen „aus Fuhre“ übernehmen, Foto anhängen, **Unterschrift per Link** an den Auftraggeber schicken.
- [ ] **Schlechtwetter melden** → Antwort „Schlechtwetter gemeldet – das Büro bestätigt.“
- [ ] **Lieferschein fotografieren**: Den eigenen sieht er wieder (auch mit Preisen), Lieferscheine anderer nicht.
- [ ] **Darf NICHT sehen** (bitte gezielt suchen): keine Preise, keine €-Beträge, keine Nachkalkulation, keine Rechnungen, **keine Abwesenheiten anderer** (weder Urlaub noch Krank, auch nicht als Zahl), keine Lohngruppen (auch nicht die eigene), keine Lieferscheine anderer. Gesperrte Funktionen erscheinen gar nicht erst im Menü.

## 3. Mitarbeiter (Lukas Brandstätter)

- [ ] **Mein Einsatz**: morgen, Uhrzeit, Treffpunkt, Polier anrufen, Route öffnen, meine Notiz.
- [ ] **Kollegen** in „Mein Einsatz“: Zeile **„Mit dir eingeteilt: …“** mit den Namen der Kollegen am selben veröffentlichten Einsatz (nur Namen – keine Notizen, keine Telefonnummern, keine Abwesenheiten). Erst nach dem Veröffentlichen sichtbar.
- [ ] **Stempeln** (auch im Flugmodus testen: Stempelung wird nachgereicht).
- [ ] **Pause mit fester Dauer**: „Pause“ → **30 Min** wählen → Uhr zeigt „Pause bis …“. Handy weglegen (auch Flugmodus oder ausschalten) – nach 30 Minuten läuft die Arbeitszeit von selbst weiter, in „Heute“ steht „Pause beendet – automatisch“. **„Pause beenden“** geht jederzeit früher; **„offen“** läuft wie bisher, bis man sie beendet. Es kommt keine Erinnerung.
- [ ] **Urlaub beantragen von–bis** → Vorschau zeigt Arbeitstage (ohne Wochenende/Feiertage) und Resturlaub. Ein Antrag, eine Nachricht ans Büro.
- [ ] **Schaden melden** mit Foto.
- [ ] **PIN ändern** (Mehr → PIN ändern): 4 Ziffern reichen für alle Rollen (z. B. 4826; nicht 1234 oder 7777).
- [ ] **Geteiltes Tablet** (am Anmeldebildschirm „Geteiltes Gerät“ wählen): als Mitarbeiter im Flugmodus stempeln, abmelden, als anderer anmelden → von der vorigen Person ist nichts zu sehen, ihre Stempelung wird erst bei ihrer nächsten Anmeldung gesendet.
- [ ] **Darf NICHT sehen:** Preise, Kosten, Abwesenheiten anderer, Daten anderer Mitarbeiter, Lohngruppe.

## 4. LKW-Fahrer (Karl Ungersböck)

- [ ] **Meine Fuhren**: Material und Menge groß, Abladestelle, Knopf **„In Google Maps öffnen“**.
- [ ] **Losgefahren** → **Abgeladen** (tatsächliche Menge, Foto vom Lieferschein) → die Menge erscheint im Bautagesbericht des Poliers „aus Fuhre“.

## 5. Geschäftsführung (Michael Pichler)

- [ ] Zusätzlich zum Büro: Rechte-Einstellungen, Büro- und Bauleiter-Konten, eigene Dokument-Kategorien, Zwei-Faktor-Anmeldung einrichten (QR-Code mit einer Authenticator-App) – sie ist freiwillig und lässt sich unter Mehr → Zwei-Faktor-Anmeldung mit PIN und Code wieder ausschalten, solange sie nicht für alle vorgeschrieben ist.
- [ ] Hinweis: Das Geschäftsführungs-Konto kann niemand über die App entsperren oder zurücksetzen – nur direkt am Server (`node server/entsperren.js`). Empfehlung: zwei GF-Konten.

## Bekannte Punkte, die erst im Echtbetrieb gehen

- Push-Nachrichten aufs Handy, Installieren am Startbildschirm: brauchen den Server mit HTTPS.
- E-Mail-Versand: braucht Ihre SMTP-Zugangsdaten.
- Wetter (GeoSphere Austria): im Test ggf. „nicht verfügbar“.
- KI: aus, bis ein API-Schlüssel eingetragen ist.
- BMD-/Auer-Formate und BMD-Lohnarten: mit echten Dateien bzw. der Lohnverrechnung abstimmen.

## Rückmeldung

Was nicht passt, einfach hier im Chat schreiben – am besten mit Rolle, Bildschirm und was Sie erwartet hätten.
