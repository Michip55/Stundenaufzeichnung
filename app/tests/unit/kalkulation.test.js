'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../../server/kalkulation');

const preise = {
  lohngruppen: { fa: { name: 'Facharbeiter', kostensatz: 46, regiesatz: 62 }, hi: { name: 'Hilfsarbeiter', kostensatz: 39.5, regiesatz: 52 } },
  geraete: { 1: { code: 'b9', name: 'Bagger 9 to.', kostensatz: 34 }, 2: { code: 'ruettel', name: 'Rüttelplatte', kostensatz: 7 } },
  materialien: { 10: { code: 'frostschutz', name: 'Frostschutz', einheit: 'to', ek: 13.8 } },
  leistungen: { 100: { code: '03.01', text: 'Pflaster', einheit: 'm²', ep: 68.5 }, 101: { code: '02.04', text: 'Frostschutz', einheit: 'm²', ep: 14.6 } }
};

function basis(extra = {}) {
  return {
    auftragssumme: 10000,
    nachtraege: [],
    schwellen: [80, 90, 100],
    preise,
    berichte: [
      { datum: '2026-11-02', status: 'freigegeben', personal: [{ lohngruppeId: 'fa', stunden: 8 }, { lohngruppeId: 'hi', stunden: 8 }], geraete: [{ geraetId: 1, stunden: 6 }], material: [{ materialId: 10, menge: 20 }], regie: [{ stunden: 2 }] },
      { datum: '2026-11-03', status: 'unterschrieben', personal: [{ lohngruppeId: 'fa', stunden: 4 }], geraete: [{ geraetId: 2, stunden: 3 }], material: [], regie: [] },
      { datum: '2026-11-04', status: 'entwurf', personal: [{ lohngruppeId: 'fa', stunden: 100 }], geraete: [], material: [], regie: [] }
    ],
    fremdleistungen: [{ id: 1, text: 'Vermessung', betrag: 500, datum: '2026-11-02' }],
    leistungsmeldungen: [{ leistungId: 100, menge: 50, datum: '2026-11-03' }],
    ...extra
  };
}

test('Kosten nach Formel (Entwürfe nicht enthalten)', () => {
  const k = K.berechneKalkulation(basis());
  // Lohn: (8+4)*46 + 8*39.5 = 552 + 316 = 868
  assert.equal(k.kosten.lohn, 868);
  // Geräte: 6*34 + 3*7 = 204 + 21 = 225
  assert.equal(k.kosten.geraete, 225);
  // Material: 20*13.8 = 276
  assert.equal(k.kosten.material, 276);
  assert.equal(k.kosten.fremd, 500);
  assert.equal(k.kosten.gesamt, 1869);
  assert.equal(k.stunden.lohn, 20);
});

test('Erlös = Leistungsmeldungen × EP + Regiestunden × Regiesatz Facharbeiter', () => {
  const k = K.berechneKalkulation(basis());
  assert.equal(k.erloesLeistung, 3425); // 50 × 68.5
  assert.equal(k.erloesRegie, 124); // 2 × 62
  assert.equal(k.erloes, 3549);
  assert.equal(k.db, 3549 - 1869);
  assert.equal(k.dbProzent, Math.round(((3549 - 1869) / 3549) * 1000) / 10);
});

test('Leistungsstand und Budget-Verbrauch bezogen auf Auftragssumme inkl. Nachträge', () => {
  const k = K.berechneKalkulation(basis({ nachtraege: [{ id: 1, text: 'N1', betrag: 2500 }] }));
  assert.equal(k.auftragGesamt, 12500);
  assert.equal(k.leistungsstandProzent, Math.round((3425 / 12500) * 1000) / 10); // 27.4
  assert.equal(k.budgetVerbrauchProzent, Math.round((1869 / 12500) * 1000) / 10); // 15
  assert.equal(k.status, 'ok');
});

test('Status: warnung ab erster Schwelle, kritisch bei ≥ 100 %', () => {
  assert.equal(K.budgetStatus(79.9, 85), 'ok');
  assert.equal(K.budgetStatus(80, 85), 'warnung');
  assert.equal(K.budgetStatus(95, 90), 'warnung');
  assert.equal(K.budgetStatus(100, 99), 'kritisch');
  assert.equal(K.budgetStatus(70, 50, [60, 90]), 'kritisch'); // 20 Pp. über Leistung
  assert.equal(K.budgetStatus(65, 60, [60, 90]), 'warnung');
});

test('Status kritisch: Verbrauch − Leistungsstand > 10 Pp., erst ab 15 % Leistungsstand', () => {
  assert.equal(K.istKritisch(60, 45), true);
  assert.equal(K.istKritisch(55, 45), false); // genau 10 Pp. ist nicht > 10
  assert.equal(K.istKritisch(30, 10), false); // Leistungsstand < 15 %
  assert.equal(K.istKritisch(30, 15), true);
  assert.equal(K.istKritisch(null, 15), false);
});

test('erreichte Schwellen', () => {
  assert.deepEqual(K.erreichteSchwellen(91, [100, 80, 90]), [80, 90]);
  assert.deepEqual(K.erreichteSchwellen(null), []);
});

test('ohne Auftragssumme: keine Prozentwerte, Hinweis', () => {
  const k = K.berechneKalkulation(basis({ auftragssumme: null }));
  assert.equal(k.budgetVerbrauchProzent, null);
  assert.equal(k.leistungsstandProzent, null);
  assert.equal(k.status, 'ok');
  assert.ok(k.hinweise.some((h) => /Keine Auftragssumme/.test(h.text)));
});

test('Positionen und Verlauf (kumuliert)', () => {
  const k = K.berechneKalkulation(basis());
  const fa = k.positionen.lohn.find((p) => p.lohngruppeId === 'fa');
  assert.equal(fa.stunden, 12);
  assert.equal(fa.betrag, 552);
  assert.equal(k.positionen.geraete.length, 2);
  assert.equal(k.positionen.material[0].menge, 20);
  assert.equal(k.positionen.fremd[0].betrag, 500);
  assert.deepEqual(k.verlauf.map((v) => v.datum), ['2026-11-02', '2026-11-03']);
  const letzter = k.verlauf[k.verlauf.length - 1];
  assert.equal(letzter.kosten, k.kosten.gesamt);
  assert.equal(letzter.erloes, k.erloes);
  assert.ok(k.hinweise.some((h) => /Entwurf/.test(h.text)));
  assert.ok(k.hinweise.some((h) => /nicht freigegeben/.test(h.text)));
});

test('Stunden ohne Lohngruppe werden gezählt, aber ohne Kosten (Hinweis)', () => {
  const k = K.berechneKalkulation(basis({ berichte: [{ datum: '2026-11-02', status: 'freigegeben', personal: [{ lohngruppeId: null, stunden: 5 }] }] }));
  assert.equal(k.kosten.lohn, 0);
  assert.equal(k.stunden.lohn, 5);
  assert.ok(k.hinweise.some((h) => /ohne Lohngruppe/.test(h.text)));
});

test('kostenBericht für den Tag', () => {
  const k = K.kostenBericht({ personal: [{ lohngruppeId: 'fa', stunden: 8 }], geraete: [{ geraetId: 2, stunden: 2 }], material: [{ materialId: 10, menge: 10 }] }, preise);
  assert.deepEqual(k, { lohn: 368, geraete: 14, material: 138, gesamt: 520 });
});

test('Rundung auf 2 Nachkommastellen', () => {
  assert.equal(K.r2(1.005), 1.01);
  assert.equal(K.r2(0.1 + 0.2), 0.3);
});
