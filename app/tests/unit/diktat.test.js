'use strict';
/** Diktat-Parser (API.md 12.10) – realistische Formulierungen */
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../server/diktat');

const STAMM = {
  geraete: [
    { id: 1, code: 'mobilbagger', name: 'Mobilbagger 7-11 t', gruppe: 'Bagger' },
    { id: 2, code: 'minibagger', name: 'Minibagger 1,8 t', gruppe: 'Bagger' },
    { id: 3, code: 'walze', name: 'Walze BOMAG 7 t', gruppe: 'Verdichtung' },
    { id: 4, code: 'ruettel', name: 'Rüttelplatte 400 kg', gruppe: 'Verdichtung' },
    { id: 5, code: 'lkw4', name: 'LKW 4-Achser', gruppe: 'LKW' },
    { id: 6, code: 'radlader', name: 'Radlader CASE 721', gruppe: 'Lader' }
  ],
  materialien: [
    { id: 11, code: 'frostschutz', name: 'Frostschutz', einheit: 'to' },
    { id: 12, code: 'splitt', name: 'Splitt', einheit: 'to' },
    { id: 13, code: 'pflaster8', name: 'Betonsteinpflaster 8 cm grau', einheit: 'm²' },
    { id: 14, code: 'randstein', name: 'Randleiste 8/25/100', einheit: 'lfm' },
    { id: 15, code: 'beton', name: 'Beton C20/25 erdfeucht', einheit: 'm³' },
    { id: 16, code: 'aushub', name: 'Aushub', einheit: 'to' }
  ],
  personen: [{ id: 2, name: 'Lukas Brandstätter' }, { id: 3, name: 'Mehmet Yildiz' }, { id: 1, name: 'Josef Haidbauer' }]
};

test('Zahlwörter', () => {
  const f = [['zweiundvierzig', 42], ['acht', 8], ['dreihundertzwanzig', 320], ['zwölf', 12], ['dreieinhalb', 3.5], ['eineinhalb', 1.5], ['halb', 0.5],
    ['zweitausendvierhundert', 2400], ['neunundneunzig', 99], ['siebzehn', 17], ['hundert', 100], ['einhundertfünf', 105], ['zwanzig', 20]];
  for (const [w, z] of f) assert.equal(D.zahlwort(w), z, w);
  assert.equal(D.zahlwort('baustelle'), null);
  assert.equal(D.zahlenNormalisieren('vier komma fünf Kubik'), '4.5 Kubik');
  assert.equal(D.zahlenNormalisieren('4,5 m³'), '4.5 m³');
  assert.equal(D.zahlenNormalisieren('zwei und halb Stunden'), '2.5 Stunden');
});

test('Einheiten', () => {
  for (const [w, e] of [['Tonnen', 't'], ['to', 't'], ['t', 't'], ['m³', 'm³'], ['Kubik', 'm³'], ['Quadratmeter', 'm²'], ['lfm', 'lfm'], ['Stunden', 'Std.'], ['h', 'Std.'], ['Stück', 'Stk']]) assert.equal(D.einheit(w), e, w);
});

const fall = (text) => D.auswerten(text, STAMM).vorschlag;

test('Geräte mit Stunden', () => {
  let v = fall('Mobilbagger acht Stunden');
  assert.deepEqual(v.geraete.map((g) => [g.geraetId, g.stunden]), [[1, 8]]);
  v = fall('Die Walze lief sechseinhalb Stunden. Rüttelplatte 3 h.');
  assert.deepEqual(v.geraete.map((g) => [g.geraetId, g.stunden]).sort(), [[3, 6.5], [4, 3]]);
  v = fall('Radlader zwei Stunden, LKW vier Stunden');
  assert.deepEqual(v.geraete.map((g) => [g.geraetId, g.stunden]).sort(), [[5, 4], [6, 2]]);
  const r = D.auswerten('Bagger 5 Stunden', STAMM);
  assert.equal(r.vorschlag.geraete.length, 0); // zwei Bagger → unklar
  assert.match(r.unklar[0], /mehrere Geräte/);
});

test('Material mit Menge und Einheit', () => {
  let v = fall('42 t Frostschutz eingebaut');
  assert.deepEqual(v.material, [{ materialId: 11, code: 'frostschutz', name: 'Frostschutz', menge: 42, einheit: 'to' }]);
  v = fall('zweiundvierzig Tonnen Frostschutz und 12 Tonnen Splitt');
  assert.deepEqual(v.material.map((m) => [m.materialId, m.menge]).sort((a, b) => a[0] - b[0]), [[11, 42], [12, 12]]);
  v = fall('Beton 4,5 m³ geliefert');
  assert.deepEqual(v.material.map((m) => [m.materialId, m.menge, m.einheit]), [[15, 4.5, 'm³']]);
  v = fall('Pflastersteine hundertzwanzig Quadratmeter verlegt');
  assert.deepEqual(v.material.map((m) => [m.materialId, m.menge, m.einheit]), [[13, 120, 'm²']]);
  v = fall('35 Laufmeter Randleisten gesetzt');
  assert.deepEqual(v.material.map((m) => [m.materialId, m.menge]), [[14, 35]]);
  v = fall('Frostschutz 20 t. Frostschutz noch einmal 10 t');
  assert.deepEqual(v.material.map((m) => [m.materialId, m.menge]), [[11, 30]]);
  const r = D.auswerten('Kies 10 Tonnen', STAMM);
  assert.equal(r.vorschlag.material.length, 0);
  assert.match(r.unklar[0], /ohne erkanntes Material/);
});

test('Personal mit Zeiten, Regie, Arbeitsleistung, Vorkommnisse', () => {
  let v = fall('Lukas von 7 bis 16 Uhr. Mehmet acht Stunden.');
  assert.deepEqual(v.personal, [{ benutzerId: 2, name: 'Lukas Brandstätter', von: '07:00', bis: '16:00' }, { benutzerId: 3, name: 'Mehmet Yildiz', stunden: 8 }]);
  v = fall('Regie Schacht anheben zwei Stunden');
  assert.deepEqual(v.regie, [{ text: 'Regie Schacht anheben 2 Stunden', stunden: 2 }]);
  v = fall('Pflaster im Hof fertig verlegt. Fugen eingekehrt. Vorkommnis: Zufahrt durch Anrainer blockiert');
  assert.equal(v.arbeitsleistung, 'Pflaster im Hof fertig verlegt. Fugen eingekehrt.');
  assert.equal(v.vorkommnisse, 'Zufahrt durch Anrainer blockiert.');
});

test('Gemischter Bericht (realistisch, Tastatur-Diktat)', () => {
  const text = 'Heute Unterbau hergestellt und verdichtet. Mobilbagger sieben Stunden, Walze vier Stunden. Zweiundvierzig Tonnen Frostschutz eingebaut. Josef von 6:30 bis 15 Uhr. Regie Leitung freigelegt eineinhalb Stunden';
  const r = D.auswerten(text, STAMM);
  assert.deepEqual(r.vorschlag.geraete.map((g) => [g.geraetId, g.stunden]).sort(), [[1, 7], [3, 4]]);
  assert.deepEqual(r.vorschlag.material.map((m) => [m.materialId, m.menge]), [[11, 42]]);
  assert.deepEqual(r.vorschlag.personal, [{ benutzerId: 1, name: 'Josef Haidbauer', von: '06:30', bis: '15:00' }]);
  assert.deepEqual(r.vorschlag.regie.map((x) => x.stunden), [1.5]);
  assert.equal(r.vorschlag.arbeitsleistung, 'Heute Unterbau hergestellt und verdichtet.');
  assert.equal(r.quelle, 'regeln');
  assert.ok(r.erkannt.length >= 5);
});
