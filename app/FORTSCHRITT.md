# BauTag – Fortschritt der Umsetzung

Gestartet: 12.11.2026, 23:40 Uhr. Wird laufend aktualisiert und nach jedem Teilschritt gepusht (Branch `claude/jolly-newton-swaya9`).

## Erledigt
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
- Behebung der Befunde aus `PRUEFBERICHT_3.md` (blockierend: D-01 dauerhafte Kontosperre von GF/Büro; mittel: D-02 Rollenwechsel zu Bauleiter nur GF, D-03 Nachtschicht-Doppelzählung, D-04 Bauleiter/Büro/GF im Personalvorschlag, D-05 Unterschrift überschreiben, D-06 Erstinbetriebnahme ohne Demo-PIN; dazu D-07…D-12)

## Offen
- Befunde der Prüfung beheben, Tests erneut
- Freigabe: Pull Request nur wenn alle Tests grün

## Nächster Schritt
- Nach Behebung: alle Tests + dritte (Nach-)Prüfung; Freigabe (Pull Request) nur ohne offene blockierende Befunde
