# BauTag – Fortschritt der Umsetzung

Gestartet: 12.11.2026, 23:40 Uhr. Wird laufend aktualisiert und nach jedem Teilschritt gepusht (Branch `claude/jolly-newton-swaya9`).

## Erledigt
- Vierte Prüfung (`PRUEFBERICHT_4.md`): **freigabefähig**, keine kritischen/hohen Befunde; alle Befunde aus Prüfbericht 3 bestätigt behoben. Tests: Server 277/277, E2E 463/463 je Größe grün
- Oberfläche Positions-Nachkalkulation fertig; E2E uhrzeitunabhängig (feste Uhr), 463/463 je Größe laut Agent; Server 277/277 grün
- Servicebuch: Recherche und Konzept (Kapitel 5 in `docs/Konzept.md`) und Umsetzungsvertrag `app/SERVICEBUCH_ENTWURF.md`
- Katalog an Preislisten 2026 angepasst (119 Positionen; Kundenfreigabe 10d). Server 277/277 grün
- Positions-Nachkalkulation Backend fertig (Katalog aus Excel, je Baustelle anpassbar, Mengen aus Berichten + manuell, Landschaftsabgabe automatisch, Excel-Import/-Export, Budget-Alarm auf Positionsbasis). Server 272/272 grün
- Kundenentscheidungen 10a–10d eingearbeitet (EP = Verrechnungspreise, PA/VE = Rechnungsbetrag × Faktor, Landschaftsabgabe je t Naturmaterial, Abgleich Preislisten 2026)
- Befunde aus Prüfbericht 3 behoben (D-01…D-12). Server 253/253 grün
- Dritte Prüfung (`PRUEFBERICHT_3.md`): alle Blocker aus Bericht 2 bestätigt behoben, €-Kernregel hält (314 Adressen je Rolle geprüft); 1 neuer Blocker
- Befunde aus Prüfbericht 2 behoben (C-01…C-15, M-01; M-05 als Inhaber-Entscheidung dokumentiert). Tests: Server 225/225, E2E 377/377 je Größe grün (05:30)
- 01:30–04:45 Pause durch Nutzungslimit (kein Datenverlust, alles war gepusht). Stand danach: Server 225/225, E2E 377/377 je Größe grün
- Zweite unabhängige Prüfung (`PRUEFBERICHT_2.md`): Prüfbericht-1-Befunde großteils behoben; €-Kernregel für Polier/Mitarbeiter hält auf allen Wegen; 3 neue blockierende Befunde
- Befunde aus Prüfbericht 1 behoben (B-01…B-07, M-01…M-07, N-01…N-09; M-08 als bekannte Einschränkung dokumentiert)
- Tests nach Behebung: Server 203/203, E2E 324/324 je Größe (Handy, Tablet, PC) – Stand 01:20
- Unabhängige Prüfung 1 abgeschlossen (`PRUEFBERICHT_1.md`): Urteil „nicht freigabefähig“
- Backend fertig (`app/server`): 117/117 Unit- und API-Tests grün (Stand 00:20)
- Gesamttest gegen echten Server: E2E 223/223 je Größe (Handy, Tablet, PC) grün
- Architektur & API-Vertrag festgelegt (`app/API.md`)
- Oberfläche/PWA fertig (`app/public`): alle Ansichten, rollenabhängig, Offline-Stempeln, „Noch nicht angebunden“ für externe Dienste
- E2E-Tests (`app/tests/e2e`): 223/223 Prüfungen je Größe (Handy, Tablet, PC) grün gegen den echten Server

## In Arbeit
- Behebung der mittleren/niedrigen Befunde aus `PRUEFBERICHT_4.md` (E-01 Landschaftsabgabe geht beim Bestätigen verloren, E-02 Excel-Import-Absturz, E-03 Migration Bestands-DB, E-04 Re-Import der Vorlage, E-05…E-09) – danach kurze Nachprüfung und Pull Request
- **Servicebuch + Schadensmeldung mit Fotos**: PAUSIERT (Nutzungslimit 90 %). Zwischenstand lokal im Arbeitsstand `/home/user/bautag-servicebuch` (Branch `servicebuch`, Commit 50f8891): Server-Routen /api/fuhrpark inkl. Schäden mit Fotos, Fälligkeitslogik mit Unit-Tests, Oberfläche Übersicht/Geräte/Fristen/Zeitleiste/Schäden. Noch offen: Tests komplett, E2E, Prüfung, Übernahme in den Hauptstand

## Offen
- Befunde der Prüfung beheben, Tests erneut
- Freigabe: Pull Request nur wenn alle Tests grün

## Nächster Schritt
- Nach Behebung: alle Tests + dritte (Nach-)Prüfung; Freigabe (Pull Request) nur ohne offene blockierende Befunde
