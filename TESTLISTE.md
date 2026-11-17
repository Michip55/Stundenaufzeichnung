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
