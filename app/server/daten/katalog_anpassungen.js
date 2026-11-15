'use strict';
/**
 * Versionierte Anpassungen des Positionskatalogs gegenüber der Excel-Vorlage (API.md 10c/10d).
 * Basis bleibt die Excel-Datei (docs/vorlage/…); diese Schicht wird beim Erzeugen von katalog_vorlage.json
 * und – einmalig je Version – auf bestehende Firmenkataloge angewendet. Bestehende Baustellen bleiben unverändert.
 */
module.exports = [
  {
    version: '10d-2026-11-13',
    beschreibung: 'Abgleich mit den Preislisten 2026 (vom Kunden freigegeben am 13.11.2026)',
    preise: [
      { bezeichnung: 'Rollschotter RK 16/63', einheit: 't', ep: 12.5 }
    ],
    umbenennungen: [
      { alt: 'Komatsu PC27 3 to', neu: 'Minibagger Takeuchi 3,0 t', einheit: 'Std.' },
      { alt: 'Mobilbagger 9-11 to', neu: 'Mobilbagger 7-11 t', einheit: 'Std.' },
      { alt: 'Minilader Bobcat  3,3 to', neu: 'Minilader CASE 3,5 t', einheit: 'Std.' },
      { alt: 'Bagger 1,8 to.', neu: 'Minibagger Cat 1,8 t', einheit: 'Std.' },
      { alt: 'Kettenbagger 23 to', neu: 'Kettenbagger CAT 320 23,0 t', einheit: 'Std.' },
      { alt: 'Radlader Case 2,5 m3', neu: 'Radlader CASE 721 2,5 m3', einheit: 'Std.' },
      { alt: 'Radlader Cat 3,5 m3', neu: 'Radlader CAT 950 M 3,5 m3', einheit: 'Std.' }
    ],
    // neue Positionen (herkunft preisliste_2026); nach = Einfügen hinter dieser Position (sonst am Gruppenende)
    neu: [
      { gruppe: 'geraete', bezeichnung: 'Aufzahlung Meißel/Abbruchzange Minibagger Takeuchi 3,0 t (50 % vom Regiepreis)', einheit: 'Std.', ep: 39.2, nach: 'Minibagger Takeuchi 3,0 t' },
      { gruppe: 'geraete', bezeichnung: 'Aufzahlung Meißel/Abbruchzange Mobilbagger 7-11 t (50 % vom Regiepreis)', einheit: 'Std.', ep: 47.2, nach: 'Mobilbagger 7-11 t' },
      { gruppe: 'geraete', bezeichnung: 'Aufzahlung Meißel/Abbruchzange Kettenbagger CAT 320 23,0 t (50 % vom Regiepreis)', einheit: 'Std.', ep: 51.7, nach: 'Kettenbagger CAT 320 23,0 t' },
      { gruppe: 'eigenmaterial', bezeichnung: 'Wandschotter KK ungewaschen', einheit: 't', ep: 8.3, naturmaterial: true, nach: 'Wandschotter FSM 0/63' },
      { gruppe: 'eigenmaterial', bezeichnung: 'RMH III 0/32, U-A', einheit: 't', ep: 1.7, naturmaterial: false, nach: 'RMH 0/63, U-A' },
      { gruppe: 'eigenmaterial', bezeichnung: 'Aushubmaterial Inertabfallqualität < 30 % b.f. Bestandteile', einheit: 't', ep: 38.6, naturmaterial: false },
      { gruppe: 'eigenmaterial', bezeichnung: 'Aushubmaterial Inertabfallqualität > 30 % b.f. Bestandteile', einheit: 't', ep: 49.5, naturmaterial: false },
      { gruppe: 'eigenmaterial', bezeichnung: 'Aushubmaterial techn. Schüttmaterial < 5 Vol%', einheit: 't', ep: 38.6, naturmaterial: false },
      { gruppe: 'eigenmaterial', bezeichnung: 'Aushubmaterial techn. Schüttmaterial > 5 Vol%', einheit: 't', ep: 49.5, naturmaterial: false },
      { gruppe: 'eigenmaterial', bezeichnung: 'verunreinigtes Aushubmaterial BRM-Deponiequalität < 30 %', einheit: 't', ep: 38.6, naturmaterial: false },
      { gruppe: 'eigenmaterial', bezeichnung: 'verunreinigtes Aushubmaterial BRM-Deponiequalität > 30 %', einheit: 't', ep: 49.5, naturmaterial: false },
      { gruppe: 'eigenmaterial', bezeichnung: 'Gleisschottermaterial o. ALSAG', einheit: 't', ep: 38.6, naturmaterial: false },
      { gruppe: 'eigenmaterial', bezeichnung: 'Sortierkostenpauschale', einheit: 't', ep: 20, naturmaterial: false },
      { gruppe: 'abgaben', bezeichnung: 'Gefälligkeitswiegung', einheit: 'Stk', ep: 15 },
      { gruppe: 'abgaben', bezeichnung: 'Abfallinformation', einheit: 'Stk', ep: 35 },
      { gruppe: 'abgaben', bezeichnung: 'Fehlende grundlegende Charakterisierung', einheit: 'Stk', ep: 2500 }
    ]
  }
];
