'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const X = require('../../server/katalog-excel');
const P = require('../../server/positionen');
const Z = require('../../server/positionen-zuordnung');

test('Katalog-JSON = Excel-Vorlage + versionierte Anpassungen 10d', async () => {
  const gelesen = await X.leseVorlage(fs.readFileSync(X.VORLAGE));
  const json = X.ladeKatalogVorlage();
  assert.equal(gelesen.offen.length, 0);
  // Basis aus der Excel-Datei (unverändert)
  assert.equal(gelesen.positionen.length, 103);
  const anzahl = {};
  for (const p of gelesen.positionen) anzahl[p.gruppe] = (anzahl[p.gruppe] || 0) + 1;
  assert.deepEqual(anzahl, { arbeit: 1, transport: 8, geraete: 13, eigenmaterial: 35, fremdmaterial: 44, abgaben: 2 });
  const basis = (b, e) => gelesen.positionen.find((p) => p.bezeichnung.trim() === b && p.einheit === e);
  assert.equal(basis('Facharbeiter', 'Std.').ep, 72.5);
  assert.equal(basis('Rollschotter RK 16/63', 't').ep, 14.5); // EP als Formel „=14.5“
  assert.equal(basis('Pflasterfuge Murexin', 'Stk').ep, 55.05);
  assert.equal(basis('Maut', 'VE').ep, 1.05);
  assert.equal(basis('Landschaftsabgabe', 'PA').ep, 0.25);
  assert.equal(basis('Bodenaushub, Kleinmenge bis 2000 to', 'm³').ep, 14.6);
  assert.equal(basis('Bodenaushub, Kleinmenge bis 2000 to', 't').ep, 8.1);
  // JSON = Basis + Anpassungen
  const erwartet = X.wendeAnpassungenAn(gelesen.positionen, X.ladeAnpassungen());
  const feld = (p) => [p.gruppe, p.bezeichnung, p.einheit, p.ep, p.herkunft, p.naturmaterial];
  assert.deepEqual(json.positionen.map(feld), erwartet.map(feld));
  assert.deepEqual(json.anpassungen.map((a) => a.version), ['10d-2026-11-13']);
  assert.equal(json.positionen.length, 119);
  assert.equal(json.positionen.filter((p) => p.herkunft === 'vorlage_excel').length, 103);
  assert.equal(json.positionen.filter((p) => p.herkunft === 'preisliste_2026').length, 16);
});

test('10d: Preise, Umbenennungen, neue Positionen, Abgaben, kein Gräder', () => {
  const json = X.ladeKatalogVorlage();
  const f = (b, e) => json.positionen.find((p) => p.bezeichnung === b && (!e || p.einheit === e));
  assert.equal(f('Rollschotter RK 16/63', 't').ep, 12.5);
  assert.equal(f('Sand RK 0/8 gewaschen', 't').ep, 17.7);
  assert.equal(f('Sand RK 0/16 gewaschen', 't').ep, 17.7);
  const umbenannt = { 'Komatsu PC27 3 to': ['Minibagger Takeuchi 3,0 t', 78.4], 'Mobilbagger 9-11 to': ['Mobilbagger 7-11 t', 94.4], 'Minilader Bobcat  3,3 to': ['Minilader CASE 3,5 t', 77.3],
    'Bagger 1,8 to.': ['Minibagger Cat 1,8 t', 74], 'Kettenbagger 23 to': ['Kettenbagger CAT 320 23,0 t', 103.4], 'Radlader Case 2,5 m3': ['Radlader CASE 721 2,5 m3', 102.2],
    'Radlader Cat 3,5 m3': ['Radlader CAT 950 M 3,5 m3', 112.5] };
  for (const [alt, [neu, ep]] of Object.entries(umbenannt)) {
    assert.ok(!f(alt), `alter Name ${alt} noch vorhanden`);
    assert.equal(f(neu, 'Std.').ep, ep, neu);
    assert.equal(f(neu, 'Std.').herkunft, 'vorlage_excel');
  }
  const neu = [
    ['geraete', 'Aufzahlung Meißel/Abbruchzange Minibagger Takeuchi 3,0 t (50 % vom Regiepreis)', 'Std.', 39.2, false],
    ['geraete', 'Aufzahlung Meißel/Abbruchzange Mobilbagger 7-11 t (50 % vom Regiepreis)', 'Std.', 47.2, false],
    ['geraete', 'Aufzahlung Meißel/Abbruchzange Kettenbagger CAT 320 23,0 t (50 % vom Regiepreis)', 'Std.', 51.7, false],
    ['eigenmaterial', 'Aushubmaterial Inertabfallqualität < 30 % b.f. Bestandteile', 't', 38.6, false],
    ['eigenmaterial', 'Aushubmaterial Inertabfallqualität > 30 % b.f. Bestandteile', 't', 49.5, false],
    ['eigenmaterial', 'Aushubmaterial techn. Schüttmaterial < 5 Vol%', 't', 38.6, false],
    ['eigenmaterial', 'Aushubmaterial techn. Schüttmaterial > 5 Vol%', 't', 49.5, false],
    ['eigenmaterial', 'verunreinigtes Aushubmaterial BRM-Deponiequalität < 30 %', 't', 38.6, false],
    ['eigenmaterial', 'verunreinigtes Aushubmaterial BRM-Deponiequalität > 30 %', 't', 49.5, false],
    ['eigenmaterial', 'Gleisschottermaterial o. ALSAG', 't', 38.6, false],
    ['eigenmaterial', 'Sortierkostenpauschale', 't', 20, false],
    ['eigenmaterial', 'Wandschotter KK ungewaschen', 't', 8.3, true],
    ['eigenmaterial', 'RMH III 0/32, U-A', 't', 1.7, false],
    ['abgaben', 'Gefälligkeitswiegung', 'Stk', 15, false],
    ['abgaben', 'Abfallinformation', 'Stk', 35, false],
    ['abgaben', 'Fehlende grundlegende Charakterisierung', 'Stk', 2500, false]
  ];
  for (const [g, b, e, ep, natur] of neu) {
    const p = f(b, e);
    assert.ok(p, b);
    assert.deepEqual([p.gruppe, p.ep, p.naturmaterial, p.herkunft], [g, ep, natur, 'preisliste_2026'], b);
  }
  // Aufzahlung direkt hinter dem jeweiligen Gerät
  const ger = json.positionen.filter((p) => p.gruppe === 'geraete').map((p) => p.bezeichnung);
  assert.equal(ger[ger.indexOf('Mobilbagger 7-11 t') + 1], 'Aufzahlung Meißel/Abbruchzange Mobilbagger 7-11 t (50 % vom Regiepreis)');
  // 10c: Abgaben enthalten Maut und Landschaftsabgabe; kein Gräder
  assert.deepEqual(json.positionen.filter((p) => p.gruppe === 'abgaben').map((p) => p.bezeichnung),
    ['Landschaftsabgabe', 'Maut', 'Gefälligkeitswiegung', 'Abfallinformation', 'Fehlende grundlegende Charakterisierung']);
  assert.ok(!json.positionen.some((p) => /gräder$/i.test(p.bezeichnung) || p.bezeichnung === 'Gräder'));
  // Zuordnungen bleiben unter neuen Namen erhalten
  assert.deepEqual(Z.zuordnungFuer('Mobilbagger 7-11 t', 'Std.'), { art: 'geraet', ref: ['b9'] });
  assert.deepEqual(Z.zuordnungFuer('Minibagger Takeuchi 3,0 t', 'Std.'), { art: 'geraet', ref: ['b27'] });
  assert.deepEqual(Z.zuordnungFuer('Minibagger Cat 1,8 t', 'Std.'), { art: 'geraet', ref: ['b15'] });
  assert.deepEqual(Z.zuordnungFuer('Kettenbagger CAT 320 23,0 t', 'Std.'), { art: 'geraet', ref: ['b23'] });
  assert.deepEqual(Z.zuordnungFuer('Minilader CASE 3,5 t', 'Std.'), { art: 'geraet', ref: ['bobcat'] });
  assert.deepEqual(Z.zuordnungFuer('Radlader CASE 721 2,5 m3', 'Std.'), { art: 'geraet', ref: ['radlader'] });
});

test('Rechnung: Menge × EP auf Cent, Gruppensummen, Anteile, Ergebnis, ausgeblendete Positionen', () => {
  const pos = [
    { id: 1, gruppe: 'arbeit', bezeichnung: 'Facharbeiter', einheit: 'Std.', ep: 72.5, aktiv: true, mengeAuto: 10, eintraege: [{ menge: 2.5 }] },
    { id: 2, gruppe: 'eigenmaterial', bezeichnung: 'Sand', einheit: 't', ep: 17.7, aktiv: true, mengeAuto: 3.333, eintraege: [] },
    { id: 3, gruppe: 'fremdmaterial', bezeichnung: 'Lagerhaus', einheit: 'PA', ep: 1.15, aktiv: true, mengeAuto: 0, eintraege: [{ menge: 100.01 }] },
    { id: 4, gruppe: 'geraete', bezeichnung: 'Dumper', einheit: 'Std.', ep: 45, aktiv: false, mengeAuto: 0, eintraege: [{ menge: 2 }] }
  ];
  const r = P.berechnePositionen(pos, 2000);
  const p = (id) => r.gruppen.flatMap((g) => g.positionen).find((x) => x.id === id);
  assert.equal(p(1).menge, 12.5);
  assert.equal(p(1).summe, 906.25);
  assert.equal(p(2).summe, 58.99); // 3,333 × 17,7 = 58,9941
  assert.equal(p(3).summe, 115.01); // 100,01 × 1,15 = 115,0115
  assert.equal(r.gruppen.find((g) => g.schluessel === 'geraete').summe, 0); // ausgeblendet
  assert.equal(r.gesamtsumme, 1080.25);
  assert.equal(r.ergebnis, 919.75);
  assert.equal(r.ergebnisProzent, 46);
  assert.equal(r.budgetVerbrauchProzent, 54);
  assert.equal(r.gruppen.find((g) => g.schluessel === 'arbeit').anteilProzent, 83.9);
  assert.ok(r.hinweise.some((h) => /Ausgeblendete Position „Dumper“/.test(h.text)));
  assert.deepEqual(r.gruppen.map((g) => g.schluessel), ['arbeit', 'transport', 'geraete', 'eigenmaterial', 'fremdmaterial', 'abgaben']);
  const ohne = P.berechnePositionen(pos, null);
  assert.equal(ohne.budgetVerbrauchProzent, null);
  assert.equal(ohne.ergebnis, null);
});

test('Landschaftsabgabe (10a): Σ Tonnen Naturmaterial inkl. manueller Einträge', () => {
  const pos = [
    { id: 1, gruppe: 'eigenmaterial', einheit: 't', aktiv: true, naturmaterial: true, mengeAuto: 40, eintraege: [{ menge: 5 }] },
    { id: 2, gruppe: 'eigenmaterial', einheit: 't', aktiv: true, naturmaterial: false, mengeAuto: 100, eintraege: [] },
    { id: 3, gruppe: 'eigenmaterial', einheit: 't', aktiv: false, naturmaterial: true, mengeAuto: 7, eintraege: [] },
    { id: 4, gruppe: 'eigenmaterial', einheit: 'm³', aktiv: true, naturmaterial: true, mengeAuto: 9, eintraege: [] },
    { id: 5, gruppe: 'abgaben', einheit: 'PA', aktiv: true, quelle: { art: 'naturmaterial' }, mengeAuto: 0, eintraege: [{ menge: 2 }] }
  ];
  assert.equal(P.naturmaterialMengen(pos), 45);
  assert.equal(pos[4].mengeAuto, 45);
  const r = P.berechnePositionen(pos.map((p) => ({ ...p, ep: p.id === 5 ? 0.25 : 1, bezeichnung: String(p.id) })), null);
  assert.equal(r.gruppen.find((g) => g.schluessel === 'abgaben').positionen[0].summe, 11.75); // 47 t × 0,25
});

test('Startzuordnung: alle Ziele existieren in der Vorlage; Naturmaterial-Regel', () => {
  const json = X.ladeKatalogVorlage();
  for (const [b, e] of Z.ZUORDNUNG) {
    assert.ok(json.positionen.some((p) => Z.schluessel(p.bezeichnung, p.einheit) === Z.schluessel(b, e)), `${b} (${e})`);
  }
  const codes = Z.ZUORDNUNG.flatMap(([, , q]) => (q.ref || []).map((r) => `${q.art}:${r}`));
  assert.equal(new Set(codes).size, codes.length, 'kein Bericht-Eintrag doppelt zugeordnet');
  assert.equal(Z.istNaturmaterial('Kies RK 4/8', 't', 'eigenmaterial'), true);
  assert.equal(Z.istNaturmaterial('Sand RK 0/4 Estrichsand', 't', 'eigenmaterial'), true);
  assert.equal(Z.istNaturmaterial('RB 0/32, U-A', 't', 'eigenmaterial'), false);
  assert.equal(Z.istNaturmaterial('Erde gesiebt', 't', 'eigenmaterial'), false);
  assert.equal(Z.istNaturmaterial('Bodenaushub mit BN', 't', 'eigenmaterial'), false);
  assert.equal(Z.istNaturmaterial('Wurzelstöcke', 't', 'eigenmaterial'), false);
  assert.equal(json.positionen.filter((p) => p.herkunft === 'vorlage_excel' && Z.istNaturmaterial(p.bezeichnung, p.einheit, p.gruppe)).length, 14);
  assert.equal(json.positionen.filter((p) => p.naturmaterial).length, 15); // + Wandschotter KK ungewaschen (10d)
});

test('Einheiten vergleichen', () => {
  assert.equal(P.einheitNorm('to'), 't');
  assert.equal(P.einheitNorm('m³'), P.einheitNorm('m3'));
  assert.equal(P.einheitNorm('m²'), P.einheitNorm('m2'));
  assert.equal(P.einheitNorm('Std.'), 'h');
  assert.notEqual(P.einheitNorm('lfm'), P.einheitNorm('Stk'));
});

test('Excel-Export im Aufbau der Vorlage: Formeln, Rücklesen ergibt dieselben Positionen', async () => {
  const json = X.ladeKatalogVorlage();
  const gruppen = X.GRUPPEN.map((g) => ({ schluessel: g.schluessel, positionen: json.positionen.filter((p) => p.gruppe === g.schluessel).map((p, i) => ({ ...p, mengeAuto: i === 0 ? 2 : 0, eintraege: i === 0 ? [{ menge: 1.5 }] : [] })) }));
  const reihenfolge = X.GRUPPEN.flatMap((g) => json.positionen.filter((p) => p.gruppe === g.schluessel));
  const buf = await X.schreibeExport({ titel: 'Test', gruppen });
  const zurueck = await X.leseVorlage(buf);
  assert.deepEqual(zurueck.positionen.map((p) => [p.gruppe, p.bezeichnung, p.einheit, p.ep]), reihenfolge.map((p) => [p.gruppe, p.bezeichnung.trim(), p.einheit, p.ep]));
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  assert.equal(ws.getCell('A2').value, 'Facharbeiter');
  assert.equal(ws.getCell('C2').value, 2);
  assert.equal(ws.getCell('D2').value, 1.5);
  assert.deepEqual(ws.getCell('M2').value, { formula: 'SUM(C2:L2)', result: 3.5 });
  assert.deepEqual(ws.getCell('O2').value, { formula: 'ROUND(M2*N2,2)', result: 253.75 });
  assert.equal(ws.getCell('A3').value, 'Summe Arbeit');
  assert.deepEqual(ws.getCell('O3').value, { formula: 'SUM(O2:O2)', result: 253.75 });
});
