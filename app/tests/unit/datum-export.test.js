'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../server/datum');
const { csv, feld, BOM } = require('../../server/export');
const { ueberstundenWoche, STANDARD_ARBEITSZEIT } = require('../../server/auswertung');
const { winAnsi } = require('../../server/pdf');
const { pngGrau, demoUnterschrift } = require('../../server/png');

test('Wiener Datum über Mitternacht UTC', () => {
  assert.equal(D.wienDatum(new Date('2026-11-12T23:30:00Z')), '2026-11-13');
  assert.equal(D.wienZeit(new Date('2026-11-12T23:30:00Z')), '00:30');
  assert.equal(D.wienDatum(new Date('2026-07-01T22:30:00Z')), '2026-07-02');
});

test('Datumsprüfung und Hilfen', () => {
  assert.equal(D.istDatum('2026-02-29'), false);
  assert.equal(D.istDatum('2028-02-29'), true);
  assert.equal(D.istDatum('2026-13-01'), false);
  assert.equal(D.istZeit('24:00'), false);
  assert.equal(D.istZeit('07:30'), true);
  assert.equal(D.wochenbeginn('2026-11-12'), '2026-11-09');
  assert.equal(D.wochenbeginn('2026-11-15'), '2026-11-09');
  assert.equal(D.tageImMonat('2026-02').length, 28);
});

test('Feiertage Österreich 2026', () => {
  assert.equal(D.ostersonntag(2026), '2026-04-05');
  assert.equal(D.feiertag('2026-10-26'), 'Nationalfeiertag');
  assert.equal(D.feiertag('2026-04-06'), 'Ostermontag');
  assert.equal(D.feiertag('2026-06-04'), 'Fronleichnam');
  assert.equal(D.istArbeitstag('2026-10-26'), false);
  assert.equal(D.istArbeitstag('2026-11-12'), true);
});

test('Überstunden: Tagesüberschreitung bzw. Wochensumme über 39 Std.', () => {
  const woche = (h) => ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map((datum, i) => ({ datum, stunden: h[i] }));
  assert.equal(ueberstundenWoche(woche([8, 8, 8, 8, 7]), STANDARD_ARBEITSZEIT), 0);
  assert.equal(ueberstundenWoche(woche([9, 8, 8, 8, 7]), STANDARD_ARBEITSZEIT), 1);
  assert.equal(ueberstundenWoche(woche([9, 7, 8, 8, 7]), STANDARD_ARBEITSZEIT), 1); // täglich 1, Woche 0
  assert.equal(ueberstundenWoche([...woche([8, 8, 8, 8, 7]), { datum: '2026-11-14', stunden: 4 }], STANDARD_ARBEITSZEIT), 4); // Samstag
});

test('CSV: Semikolon, BOM, Dezimalkomma, Maskierung, Formel-Schutz', () => {
  const s = csv([['a', 1.5, 'x;y'], ['"q"', '=SUMME(A1)', null]]);
  assert.ok(s.startsWith(BOM));
  assert.equal(s, BOM + 'a;1,5;"x;y"\r\n"""q""";\'=SUMME(A1);\r\n');
  assert.equal(feld(-3), '-3');
});

test('PDF-Text: Zeichen außerhalb WinAnsi werden ersetzt', () => {
  assert.equal(winAnsi('Yıldız Petrović Größe'), 'Yildiz Petrovic Größe');
  assert.equal(winAnsi(null), '');
});

test('PNG-Encoder erzeugt gültige Signatur', () => {
  const p = pngGrau(2, 2, new Uint8Array([0, 255, 255, 0]));
  assert.equal(p.readUInt32BE(0), 0x89504e47);
  assert.match(demoUnterschrift('x'), /^data:image\/png;base64,/);
});
