# BauTag – Fortschritt der Umsetzung

Gestartet: 12.11.2026, 23:40 Uhr. Wird laufend aktualisiert und nach jedem Teilschritt gepusht (Branch `claude/jolly-newton-swaya9`).

## Erledigt
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
- Behebung der Befunde aus `PRUEFBERICHT_2.md` (blockierend: C-01 Doppelzählung im Lohnexport, C-04 ganze Schicht nachtragen/löschen, C-05 Bauleiter-Selbstzuteilung; dazu C-02…C-15) – Backend: Opus-Agent, Oberfläche: Fable-Agent

## Offen
- Befunde der Prüfung beheben, Tests erneut
- Freigabe: Pull Request nur wenn alle Tests grün

## Nächster Schritt
- Nach Behebung: alle Tests + dritte (Nach-)Prüfung; Freigabe (Pull Request) nur ohne offene blockierende Befunde
