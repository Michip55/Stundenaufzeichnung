# BauTag – Fortschritt der Umsetzung

Gestartet: 12.11.2026, 23:40 Uhr. Wird laufend aktualisiert und nach jedem Teilschritt gepusht (Branch `claude/jolly-newton-swaya9`).

## Erledigt
- Unabhängige Prüfung 1 abgeschlossen (`PRUEFBERICHT_1.md`): Urteil „nicht freigabefähig“
- Backend fertig (`app/server`): 117/117 Unit- und API-Tests grün (Stand 00:20)
- Gesamttest gegen echten Server: E2E 223/223 je Größe (Handy, Tablet, PC) grün
- Architektur & API-Vertrag festgelegt (`app/API.md`)
- Oberfläche/PWA fertig (`app/public`): alle Ansichten, rollenabhängig, Offline-Stempeln, „Noch nicht angebunden“ für externe Dienste
- E2E-Tests (`app/tests/e2e`): 223/223 Prüfungen je Größe (Handy, Tablet, PC) grün gegen den echten Server

## In Arbeit
- Behebung der Befunde aus `PRUEFBERICHT_1.md` (7 blockierend: B-01 Rechte-Eskalation, B-02 Kolonne fremde Personen, B-03 Anmeldung/PIN, B-04 Zahleneingabe, B-05 vergessenes Ausstempeln, B-06 Nachtschicht im Bericht, B-07 Urlaubsanträge im Export; dazu M-/N-Befunde) – Backend: Opus-Agent, Oberfläche: Fable-Agent

## Offen
- Befunde der Prüfung beheben, Tests erneut
- Freigabe: Pull Request nur wenn alle Tests grün

## Nächster Schritt
- Nach Behebung: alle Tests + zweite unabhängige Prüfung; Freigabe (Pull Request) nur ohne offene blockierende Befunde
