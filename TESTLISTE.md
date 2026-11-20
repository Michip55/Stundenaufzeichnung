# BauTag – Testliste (Ausbaustufe 2)

So probieren Sie die Testversion aus. Alle Namen, Baustellen und Zahlen sind **erfunden** (Beispieldaten).

## Starten

1. Einmalig Node.js „LTS“ von https://nodejs.org installieren (immer „Weiter“).
2. Im Ordner **`BauTag-starten-Windows.bat`** doppelklicken (Mac: `BauTag-starten-Mac.command`). Der Browser öffnet sich mit http://localhost:3000.
3. Anmelden: **Personalnummer** (siehe Tabelle unten, z. B. 1102) und **PIN 1234**; am eigenen Handy merkt sich die App danach den Namen – beim nächsten Mal nur noch die PIN. Am Anmeldebildschirm ist **„Eigenes Handy“** vorgewählt (bleibt bis Sonntag angemeldet, am Montag einmal die PIN; gilt sofort nach der Anmeldung); nur für ein Tablet, das mehrere benutzen, **„Geteiltes Gerät“** wählen (Abmeldung nach 30 Minuten ohne Bedienung; bleibt für dieses Gerät eingestellt, änderbar auch unter „Mehr“).
4. **Handy im selben WLAN:** Das Startfenster zeigt zusätzlich eine Adresse wie `192.168.0.23:3000` – diese am Handy mit `http://` davor öffnen. Fragt Windows nach der Firewall, „Zugriff zulassen“ (privates Netzwerk) wählen. Installieren am Startbildschirm, Push-Nachrichten und Offline-Betrieb gehen erst mit dem Server mit HTTPS.
5. Zum Neuanfang: BauTag-Fenster schließen, **`BauTag-Testdaten-zuruecksetzen-Windows.bat`** doppelklicken, `JA` eingeben.

Tipp: Zwei Browserfenster nebeneinander (eines davon „privat/inkognito“), dann können Sie z. B. als Büro und als Polier gleichzeitig angemeldet sein.

## Wer ist wer (Beispieldaten)

| Rolle | Name (Personalnummer zum Anmelden) | Wofür |
|---|---|---|
| Geschäftsführung | Michael Pichler (1102) | alles, inkl. Rechte sowie Büro- und Bauleiter-Konten |
| Büro | Martina Koller (1101) | Preise, Lohn, Rechnungen, Planung, Urlaub genehmigen |
| Bauleiter | Stefan Aigner (1103) | wie Büro (Entscheidung 13.11.2026), stempelt im Büro |
| Polier | Josef Haidbauer (1001, WHA Pitten) | Partie, Bautagesbericht, Schlechtwetter melden |
| Mitarbeiter | Lukas Brandstätter (1002) | Stempeln, Mein Einsatz, Urlaub beantragen |
| LKW-Fahrer | Karl Ungersböck (1007) | Meine Fuhren mit Google-Maps-Link |

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
- [ ] **Fälligkeiten** (Übersicht → „Rechnungen“ → „Fälligkeiten“, oder auf der Seite „Rechnungen“): Gruppen **Überfällig · Diese Woche · Nächste Woche · Später**; je Rechnung „mit Skonto € … bis …“ (nur solange die Skontofrist läuft) und „ohne Skonto € … bis …“; Rücklässe als graue Zeilen „Haftrücklass € … frei ab …“; Summen je Gruppe. Am Handy und am PC ansehen. Zeile antippen öffnet die Rechnung.
- [ ] **„Offen gesamt“** steht oben auf „Rechnungen“ und „Fälligkeiten“ und in der Übersicht unter „Rechnungen“ (davon überfällig, in den nächsten 7 Tagen fällig, Rücklässe einbehalten).
- [ ] **„Als bezahlt markieren“**: In den Fälligkeiten auf **✓** tippen (oder „Bezahlt“ in der Liste, „Als bezahlt markieren“ in der Rechnung) → vorgeschlagen ist heute und, solange die Skontofrist läuft, der Betrag **mit Skonto** (danach der volle Betrag). Rücklässe bleiben offen, außer „inkl. Rücklass“ ist angehakt. Nach dem Buchen im Hinweis oben **„Rückgängig“** tippen → alles wie vorher. Teilzahlungen weiter über „Zahlung buchen“.
- [ ] **Zahlungsabgleich**: „Als bezahlt markieren“ → bei „Tatsächlich bezahlt“ den Betrag vom Kontoauszug eintragen (z. B. 1.700,00 statt erwartet 1.722,48) → die **Differenz** erscheint sofort; aufteilen in Gründe, z. B. Bankspesen 2,48 **akzeptiert** und „Umlage/Abzug des Auftraggebers – Bauwesenversicherung“ 20,00 **strittig**. Gebucht wird erst, wenn alles aufgeteilt ist. Danach: Rechnung „bezahlt · Differenz strittig“, in den Fälligkeiten unter **„Offene Differenzen“**, in „Offen gesamt“ als „strittige Differenzen“. In der Rechnung lässt sich die Differenz später **akzeptieren**. Skonto nach der Frist abgezogen → wird als „verspätet – unberechtigt“ markiert. Mehr bezahlt → „Überzahlung“ mit Notiz.
- [ ] In der **Übersicht** heißt es jetzt „Rechnungen“ (z. B. „Weitere offene Rechnungen € … im Rahmen“) statt „Offene Posten“/„Schlussrechnungen offen“; „Schlussrechnung fehlt“ (abgenommen, keine Schlussrechnung) bleibt.
- [ ] **Klassische Übersicht** (Mehr → „Klassische Übersicht verwenden“): die zweite Kachelreihe (Offene Schlussrechnungen, Abnahmen ohne Rechnung, Gewährleistung, Offene Posten) steht direkt unter der ersten, nicht am Seitenende – am Handy und am PC.
- [ ] **Übersicht nach geänderten Rechten** (als GF unter Rechte-Einstellungen dem Büro „Bautagesbericht erstellen“, „… freigeben“ und „Stammdaten pflegen“ wegnehmen, dann als Büro anmelden): am PC stehen „Heute“ und „Rechnungen“ nebeneinander; zusätzlich „Preise und €-Werte sehen“ und „Nachkalkulation und Budget sehen“ weg → nur „Heute“, über die ganze Breite, ohne €-Beträge. Danach die Rechte wieder zurücksetzen.
- [ ] **Dokument** zu einer Baustelle hochladen (z. B. Angebot als PDF).

**Bautagesbericht löschen (Papierkorb)**
- [ ] Einen **unterschriebenen** Bericht öffnen → oben **„Bericht löschen“** (rot umrandet). Das Fenster zeigt Baustelle, Datum und Status und warnt „bereits unterschrieben – die Unterschriften werden mitgelöscht“. Bei einem **freigegebenen** Bericht steht „freigegeben … fehlt dann in Nachkalkulation, Monatsauswertung, Lohn und Regie“.
- [ ] „Bericht löschen“ im Fenster geht erst mit einer **Begründung** (mindestens 5 Zeichen). Abbrechen ändert nichts.
- [ ] Nach dem Löschen: zurück in der Liste, Hinweis „im Papierkorb bis TT.MM.JJJJ“ (30 Tage). Der Bericht fehlt in der Liste, in der Übersicht („Zur Freigabe“), in der Nachkalkulation der Baustelle (Stunden/Regie weniger) und in der Monatsauswertung. Die **Stempelzeiten** der Leute sind unverändert (Meine Woche/Korrektur).
- [ ] Ein Link „Unterschrift per Link“, der vor dem Löschen verschickt wurde, sagt jetzt „nicht mehr gültig“ – auch nach dem Wiederherstellen.
- [ ] Bautagesberichte → **„Papierkorb“**: der Bericht steht dort mit Grund, „Gelöscht am … von …“ und „Endgültig weg am …“. **Wiederherstellen** → er ist wieder in der Liste, mit allen Zeilen, Fotos und Unterschriften, im alten Status.
- [ ] Bericht löschen, dann für **denselben Tag einen neuen Bericht** anlegen (geht) → im Papierkorb ist „Wiederherstellen“ gesperrt mit dem Hinweis „Für diesen Tag gibt es einen neuen Bericht …“ und Link zum neuen Bericht.
- [ ] Bericht A (Baustelle 1) mit einer Person 07:00–16:00 löschen, dann dieselbe Person am selben Tag zur selben Zeit in einen Bericht einer **anderen Baustelle** eintragen (geht jetzt) → im Papierkorb ist bei A „Wiederherstellen“ gesperrt mit „… steht am TT.MM. inzwischen im Bericht von 26-… – die Zeiten überschneiden sich“. Person im anderen Bericht entfernen → A lässt sich wiederherstellen.
- [ ] Als GF in der Rechte-Matrix beim **Mitarbeiter** „Bautagesberichte löschen“ einschalten → der Mitarbeiter sieht trotzdem keinen „Papierkorb“ und keine Berichte (Hinweis in der Matrix: „wirkt nur zusammen mit „Bautagesbericht erstellen“ oder „freigeben““); wieder ausschalten.
- [ ] Als GF unter Benutzer & Rechte → **„Ausnahme“** einem **Mitarbeiter** (z. B. Lukas Brandstätter) „Bautagesberichte löschen“ wählen → im Dialog gelbe Warnung „Bei Lukas Brandstätter noch ohne Wirkung: wirkt nur zusammen mit …“; „Vergeben“ → Meldung „Ausnahme vergeben, aber noch ohne Wirkung …“, in „Ausnahmen je Benutzer“ steht unter dem Eintrag „Noch ohne Wirkung – …“. Beim **Polier** steht im Dialog nur der graue Hinweis (er hat „erstellen“). Ausnahme wieder entfernen.
- [ ] Als GF unter Rechte-Einstellungen beim **Bauleiter** „Bautagesberichte löschen“ wegnehmen → Stefan Aigner sieht weder „Bericht löschen“ noch „Papierkorb“; wieder einschalten. (Das Recht steht in der Rechte-Matrix wie alle anderen.)
- [ ] Als GF in der Rechte-Matrix dem **Büro** „Bautagesbericht erstellen“ und „… freigeben“ wegnehmen → der Schalter „Bautagesberichte löschen“ beim Büro wird **orange mit Warnzeichen** (Maus darauf: „Ohne Wirkung – erst „Bautagesbericht erstellen“ oder „Bautagesbericht freigeben“ einschalten“); einen der beiden wieder einschalten → wieder grün. Danach beide zurücksetzen.
- [ ] **Polier erfährt das Löschen:** Josef Haidbauer (Handy) öffnet einen Entwurf seiner Baustelle; währenddessen löscht das Büro diesen Bericht mit Begründung. Josef tippt weiter → statt „Nicht gespeichert“ erscheint **„Dieser Bericht wurde gelöscht“** mit Baustelle, Tag, Begründung und **„Zur Berichtsliste“**; auch nach dem Neuladen. In der **Glocke** steht „Bautagesbericht gelöscht“ mit Name und Begründung. Nach dem Wiederherstellen: Meldung „Bautagesbericht wiederhergestellt“. Enthält die Begründung ein Wort wie „Preis“, sieht der Polier sie nicht (nur „wurde von … gelöscht“).
- [ ] Benutzer & Rechte → Protokoll: Löschen und Wiederherstellen stehen dort mit Begründung.

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
- [ ] **Bericht löschen** gibt es für den Polier nicht: weder der Knopf im Bericht noch „Papierkorb“ in der Liste; die Adresse `#/berichte/papierkorb` zeigt „Seite nicht verfügbar“.
- [ ] Löscht das Büro einen Bericht, den der Polier angelegt hat oder dessen Baustelle er führt, bekommt er eine Benachrichtigung mit Begründung; ein offener Bericht zeigt „Dieser Bericht wurde gelöscht“ (siehe Büro → Papierkorb).
- [ ] **Darf NICHT sehen** (bitte gezielt suchen): keine Preise, keine €-Beträge, keine Nachkalkulation, keine Rechnungen, **keine Abwesenheiten anderer** (weder Urlaub noch Krank, auch nicht als Zahl), keine Lohngruppen (auch nicht die eigene), keine Lieferscheine anderer. Gesperrte Funktionen erscheinen gar nicht erst im Menü.

## 3. Mitarbeiter (Lukas Brandstätter)

- [ ] **Mein Einsatz**: morgen, Uhrzeit, Treffpunkt, Polier anrufen, Route öffnen, meine Notiz.
- [ ] **Kollegen** in „Mein Einsatz“: Zeile **„Mit dir eingeteilt: …“** mit den Namen der Kollegen am selben veröffentlichten Einsatz (nur Namen – keine Notizen, keine Telefonnummern, keine Abwesenheiten). Erst nach dem Veröffentlichen sichtbar.
- [ ] **Stempeln** (auch im Flugmodus testen: Stempelung wird nachgereicht).
- [ ] **Standort beim Stempeln** (freiwillig): unter „Mehr“ selbst einschalten → das Handy fragt sofort um Erlaubnis. Abmelden und wieder anmelden → bleibt an. Stempeln → unter dem Knopf „Standort erfasst (±… m)“; das Büro sieht in „Zeiten korrigieren“ „bei der Baustelle“ (oder die Entfernung) und „Karte“. Ausschalten → nichts mehr erfasst, und die schon gespeicherten Standorte sind gelöscht (das Büro sieht bei früheren Buchungen keinen Standort mehr). Am geteilten Tablet erbt die nächste Person die Einstellung nicht. Gleich nach dem Stempeln abmelden → kurz „Standort wird noch gesendet …“, der Standort steht trotzdem bei der Buchung; die nächste Person am Tablet muss beim Abmelden nicht warten. Während „Standort wird noch gesendet …“ die App schließen → beim nächsten Öffnen ist niemand mehr angemeldet. Bei schlechtem Empfang stempeln (Buchung „wird nachgesendet“) und gleich abmelden → nach dem Warten ist die Buchung samt Standort beim Büro, nicht erst bei der nächsten Anmeldung – auch wenn zwei Buchungen nachgesendet werden (z. B. Pause und Pause beenden im Funkloch, Empfang kommt zurück, sofort abmelden). Im Flugmodus abmelden und die App später wieder im Flugmodus öffnen → die Anmeldeseite kommt ohne die Meldung „Ohne Verbindung abgemeldet …“.
- [ ] **Pause mit fester Dauer**: „Pause“ → **30 Min** wählen → Uhr zeigt „Pause bis …“. Handy weglegen (auch Flugmodus oder ausschalten) – nach 30 Minuten läuft die Arbeitszeit von selbst weiter, in „Heute“ steht „Pause beendet – automatisch“. **„Pause beenden“** geht jederzeit früher; **„offen“** läuft wie bisher, bis man sie beendet. Es kommt keine Erinnerung.
- [ ] **Begrüßung und Pause beim Gehen**: Die Stempeluhr grüßt mit dem **zweiten Namen** („Pilz Thomas“ → „Guten Morgen, Thomas“; hier in den Beispieldaten also „Brandstätter“). Kommen, **ohne Pause** auf **Gehen** tippen → „Heute keine Pause gestempelt – Wie lange war deine Pause?“: **30 Min** (Beginn ca. 12:00, änderbar) → in „Heute“ stehen Pause 30 Min. und die Pause mit „beim Gehen nachgetragen“, kein AZG-Hinweis mehr. **„Keine Pause“** bucht nur das Gehen, **Abbrechen/X** bucht gar nichts. Mit gestempelter Pause kommt die Frage nicht – auch nicht, wenn der Polier die Pause inzwischen über die Kolonne gebucht hat. Auch im Flugmodus testen: Bucht der Polier in der Zwischenzeit die Pause, wird das Gehen nach dem Nachsenden trotzdem übernommen (Hinweis „Pausenangabe dazu nicht“). Bei einem Baustellenwechsel um 12:10 schlägt die App 12:15 vor; was im Feld „Beginn ca.“ steht, gilt für jede Dauer.
- [ ] **Meine Woche mit Urlaubsantrag** (Handy): an einem beantragten Urlaubstag stehen „U Urlaub“ und „beantragt“ **in einer Zeile**, rechts nur „–“.
- [ ] **Meine Woche** (Handy und PC): je Tag rechts die Stunden **in einer Zeile** („9 Std. 51 Min.“, „10 Std.“, leerer Tag nur „–“), die Zeiten stehen rechtsbündig untereinander. Der Balken ist kürzer (am PC höchstens etwa ein Drittel der Zeile), alle Balken der Woche im selben Maßstab (grau = Normalstunden, orange = darüber). Ein langer Baustellenname bricht um, nichts ragt über den Rand – auch nicht der Hinweis „Ausstempeln fehlt“. Der Hinweis ist nur so breit wie sein Text (am PC kein rosa Streifen über die ganze Zeile, auch an einem Tag mit Stunden); an einem Tag nur mit diesem Hinweis steht darunter kein einzelner Strich „–“.
- [ ] **Urlaub beantragen von–bis** → Vorschau zeigt Arbeitstage (ohne Wochenende/Feiertage) und Resturlaub. Ein Antrag, eine Nachricht ans Büro.
- [ ] **Schaden melden** mit Foto.
- [ ] **PIN ändern** (Mehr → PIN ändern): 4 Ziffern reichen für alle Rollen (z. B. 4826; nicht 1234 oder 7777).
- [ ] **PIN nur einmal pro Woche** (auch als Büro, Bauleiter und GF prüfen): mit „Eigenes Handy“ anmelden – unter der Auswahl steht „Du bleibst bis Sonntag angemeldet. Am Montag fragt die App einmal nach der PIN.“ Handy einen Tag liegen lassen bzw. App schließen und wieder öffnen → ohne PIN weiter angemeldet. Am Montag früh fragt die App einmal nach der PIN. Mit „Geteiltes Gerät“ angemeldet: wie bisher nach 30 Minuten (Büro 60 Minuten) ohne Bedienung abgemeldet. In „Mehr“ auf „Geteiltes Gerät“ umstellen gilt sofort; zurück auf „Eigenes Handy“ gilt ab der nächsten Anmeldung mit PIN.
- [ ] **Anmelden mit eigenem Namen am eigenen Handy:** Personalnummer 1002 und PIN eingeben. Unter „Mehr“ steht oben die eigene **Personalnummer**. Abmelden → die Anmeldeseite zeigt jetzt nur „Lukas Brandstätter – Auf diesem Handy gemerkt“ und das PIN-Feld; PIN eingeben → angemeldet. **„Andere Person“** → Personalnummer eingeben (Feld leer); „Zurück“ führt wieder zum gemerkten Namen. Meldet sich am selben Handy jemand anderer an, steht danach dessen Name dort. Am kleinen Handy (bzw. im Browser mit Adressleiste) mit dem Finger nach oben wischen → „Andere Person“ und darunter „Eigenes Handy / Geteiltes Gerät“ lassen sich erreichen und antippen.
- [ ] **Personalnummer geändert:** als Büro bei Lukas Brandstätter eine andere Personalnummer eintragen (z. B. 1092). Am Handy, das sich Lukas gemerkt hat, PIN 1234 eingeben → „Benutzer oder PIN falsch.“ und darunter der Hinweis, über „Andere Person“ mit der Personalnummer anzumelden oder im Büro nachzufragen. „Andere Person“ → 1092 → PIN → angemeldet; danach ist die neue Nummer gemerkt. (Danach die Nummer wieder auf 1002 setzen.)
- [ ] **Keine Namen am geteilten Gerät:** am Anmeldebildschirm „Geteiltes Gerät“ wählen → der gemerkte Name verschwindet sofort; auch nach Anmelden und Abmelden erscheint nie ein Name, das Feld „Personalnummer“ ist immer leer. Eine öffentliche Namensliste gibt es nicht mehr.
- [ ] **Geteiltes Tablet** (am Anmeldebildschirm „Geteiltes Gerät“ wählen): als Mitarbeiter im Flugmodus stempeln, abmelden, als anderer anmelden → von der vorigen Person ist nichts zu sehen, ihre Stempelung wird erst bei ihrer nächsten Anmeldung gesendet.
- [ ] **Darf NICHT sehen:** Preise, Kosten, Abwesenheiten anderer, Daten anderer Mitarbeiter, Lohngruppe.

## 4. LKW-Fahrer (Karl Ungersböck)

- [ ] **Meine Fuhren**: Material und Menge groß, Abladestelle, Knopf **„In Google Maps öffnen“**.
- [ ] **Losgefahren** → **Abgeladen** (tatsächliche Menge, Foto vom Lieferschein) → die Menge erscheint im Bautagesbericht des Poliers „aus Fuhre“.

## 5. Geschäftsführung (Michael Pichler)

- [ ] Zusätzlich zum Büro: Rechte-Einstellungen, Büro- und Bauleiter-Konten, eigene Dokument-Kategorien, Zwei-Faktor-Anmeldung einrichten (QR-Code mit einer Authenticator-App) – sie ist freiwillig und lässt sich unter Mehr → Zwei-Faktor-Anmeldung mit PIN und Code wieder ausschalten, solange sie nicht für alle vorgeschrieben ist.
- [ ] **Eigene Zeiten selbst korrigieren:** Monat → „Zeiten korrigieren“ → bei „Mitarbeiter“ den eigenen Namen „(eigene Zeiten)“ wählen → z. B. „Ganze Schicht nachtragen“: im Fenster steht gelb „Eigene Zeiten – wird im Protokoll als Selbstkorrektur vermerkt.“, ein Grund ist Pflicht. Danach tragen Schicht und Buchungen das Kennzeichen „Selbstkorrektur GF“, ebenso der Eintrag unter Benutzer → Protokoll („… (Selbstkorrektur durch GF – Vier-Augen-Prinzip nicht eingehalten)“). Gegenprobe als Büro (Martina Koller): der eigene Name steht dort nicht zur Wahl – die eigenen Zeiten korrigiert weiter eine andere Person.
- [ ] **Selbst gestempeltes „Gehen“ korrigieren:** in der Stempeluhr Kommen und Gehen stempeln, dann in „Zeiten korrigieren“ (eigene Zeiten) beim Gehen „Ändern“ → nur Uhrzeit und Grund, keine Baustelle; Speichern klappt. Hatte die Buchung einen Standort, steht im Fenster, dass er beim Ändern der Uhrzeit entfernt wird. Ohne Änderung speichern → „Nichts geändert – bitte die Uhrzeit ändern.“ (bei Kommen: „… Uhrzeit oder Baustelle ändern.“).
- [ ] **Hilfe passt zur Anmeldung:** Mehr → Hilfe → „Gut zu wissen“: „Anmelden: mit Personalnummer … und PIN“. Nur wenn am Server die Namensliste eingeschaltet ist (`BAUTAG_LOGIN_LISTE=1`), steht dort „Namen antippen und die PIN eingeben“, und im Thema „Benutzer und Rechte“ heißt die Personalnummer „freiwillig“.
- [ ] **Personalnummern prüfen:** Benutzer & Rechte → Benutzer. Hat eine aktive Person keine Personalnummer, steht oben gelb „… aktive Personen ohne Personalnummer – sie können sich nicht anmelden“ mit den Namen. „Bearbeiten“ → ohne Nummer speichern geht nicht (Meldung), mit Nummer verschwindet die Person aus der Warnung. (In den Beispieldaten haben alle eine Nummer – zum Ausprobieren ist die Warnung daher leer.)
- [ ] Hinweis: Das Geschäftsführungs-Konto kann niemand über die App entsperren oder zurücksetzen – nur direkt am Server (`node server/entsperren.js`). Empfehlung: zwei GF-Konten.

## Bekannte Punkte, die erst im Echtbetrieb gehen

- Push-Nachrichten aufs Handy, Installieren am Startbildschirm: brauchen den Server mit HTTPS.
- E-Mail-Versand: braucht Ihre SMTP-Zugangsdaten.
- Wetter (GeoSphere Austria): im Test ggf. „nicht verfügbar“.
- KI: aus, bis ein API-Schlüssel eingetragen ist.
- BMD-/Auer-Formate und BMD-Lohnarten: mit echten Dateien bzw. der Lohnverrechnung abstimmen.

## Rückmeldung

Was nicht passt, einfach hier im Chat schreiben – am besten mit Rolle, Bildschirm und was Sie erwartet hätten.
