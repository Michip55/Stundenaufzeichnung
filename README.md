# BauTag – Stundenaufzeichnung, Bautagesbericht & Nachkalkulation (Entwurf)

Entwurf einer Plattform für einen Erdbau- und Pflasterbetrieb in Österreich (ca. 30 Mitarbeiter). Sie läuft als **eine** Web-App auf PC, Tablet und Handy.

![Vorschau](video/vorschau.jpg)

## Inhalt

| Ordner / Datei | Was ist das? |
|---|---|
| [`video/BauTag_Entwurfsvideo.mp4`](video/BauTag_Entwurfsvideo.mp4) | **Entwurfsvideo** (3:48 min, Full HD): Rundgang durch alle Funktionen auf Handy, Tablet und PC |
| [`docs/Konzept.md`](docs/Konzept.md) | **Fachkonzept**: Funktionen, Rollen & Berechtigungen, innovative Funktionen, Österreich-Recht (AZG, KV Bau, BUAK, SEG, DSGVO), Datenmodell, Technik, Kaufen vs. Bauen, Kosten, Phasenplan, offene Fragen |
| [`prototype/`](prototype/) | **Klickbarer Prototyp** (reines HTML/CSS/JS, ohne Backend, fiktive Beispieldaten). Ablauf und Routen: [`prototype/DEMO.md`](prototype/DEMO.md) |
| [`docs/vorlage/`](docs/vorlage/) | Bestehende Papiervorlage des Bautagesberichts |
| `video/stage.html`, `video/record.js`, `video/lib/` | Aufnahme-Werkzeug des Videos (Bühne mit Geräterahmen, Drehbuch, Screencast → MP4) |

## Funktionen im Überblick

- **Einstempeln am Handy:** Ankunfts-Hinweis, Standort nur im Moment des Stempelns, Pause und Baustellenwechsel. Der Polier stempelt seine Kolonne mit einem Tipp. Geräte per NFC/QR, 5 Sprachen und ein Baustellen-Modus.
- **Bautagesbericht:** aufgebaut wie die Papiervorlage und vorbefüllt aus den Stempelzeiten. Man kann ihn **diktieren** (die KI füllt die Felder), **Lieferscheine fotografieren**, und das Wetter wird automatisch eingetragen, samt Schlechtwetter-Vorschlag.
- **Tablet:** Der Bauherr unterschreibt vor Ort oder über einen SMS-Link. Das PDF geht automatisch an den Auftraggeber, ohne interne Preise.
- **Büro (PC):** Live-Dashboard mit Warnungen nach dem Arbeitszeitgesetz und Berichtsfreigabe. Dazu kommen Preise & Stammdaten und die **Nachkalkulation je Baustelle** mit Hochrechnung und automatischen Hinweisen. Die Monatsauswertung lässt sich für Lohnverrechnung und BUAK exportieren.
- **Rollen & Berechtigungen:** Preise, €-Werte und Nachkalkulation sehen nur Büro/Lohnverrechnung und Geschäftsführung, der Bauleiter nur für seine eigenen Baustellen. Polier und Mitarbeiter sind fix gesperrt.

## Prototyp starten

```bash
python3 -m http.server 8765
# dann im Browser öffnen, z. B.:
#   http://localhost:8765/prototype/index.html                         (Login)
#   http://localhost:8765/prototype/index.html?rolle=polier#/stempeluhr  (Handy-Ansicht: Fenster schmal ziehen)
#   http://localhost:8765/prototype/index.html?rolle=buero#/dashboard    (Büro)
#   http://localhost:8765/prototype/index.html?rolle=gf#/benutzer        (Berechtigungen)
```

Rollen: `mitarbeiter`, `polier`, `bauleiter`, `buero`, `gf`. Alle Parameter stehen in [`prototype/DEMO.md`](prototype/DEMO.md).

## Video neu aufnehmen

```bash
python3 -m http.server 8765 &          # im Repo-Wurzelverzeichnis
node video/record.js                    # erzeugt video/BauTag_Entwurfsvideo.mp4 (benötigt Playwright + ffmpeg)
```

> Hinweis: Das ist ein Entwurf. Alle Namen, Baustellen und Preise sind fiktive Beispielwerte, und es wird bewusst noch kein Firmenlogo verwendet. Rechtliche Punkte im Konzept sind mit **„Prüfen:“** markiert und mit Steuerberatung, Lohnverrechnung bzw. WKO abzustimmen.
