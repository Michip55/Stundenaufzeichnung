'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { azgWarnungen } = require('../../server/azg');
const { schichten } = require('../../server/stempel');
const { wienZuDate } = require('../../server/datum');

const b = (typ, datum, hm) => ({ typ, zeit: wienZuDate(datum, hm).toISOString(), baustelleId: typ === 'kommen' ? 1 : null });
const tag = (datum, kommen, gehen, pause = ['12:00', '12:30']) => [
  b('kommen', datum, kommen), ...(pause ? [b('pause_start', datum, pause[0]), b('pause_ende', datum, pause[1])] : []), ...(gehen ? [b('gehen', datum, gehen)] : [])
];
const typen = (w) => w.map((x) => x.typ).sort();

test('normaler Tag ohne Warnung', () => {
  assert.deepEqual(azgWarnungen(schichten(tag('2026-11-10', '07:00', '15:30'))), []);
});

test('mehr als 10 Stunden am Tag', () => {
  const w = azgWarnungen(schichten(tag('2026-11-10', '06:00', '17:00')));
  assert.deepEqual(typen(w), ['tag_10h']);
  assert.match(w[0].text, /10,5 Std\./);
});

test('mehr als 12 Stunden: Höchstgrenze', () => {
  const w = azgWarnungen(schichten(tag('2026-11-10', '05:00', '18:00')));
  assert.deepEqual(typen(w), ['tag_12h']);
});

test('mehr als 6 Stunden ohne 30 Minuten Pause', () => {
  assert.deepEqual(typen(azgWarnungen(schichten(tag('2026-11-10', '07:00', '15:30', null)))), ['pause']);
  assert.deepEqual(typen(azgWarnungen(schichten(tag('2026-11-10', '07:00', '15:30', ['12:00', '12:15'])))), ['pause']);
  assert.deepEqual(azgWarnungen(schichten(tag('2026-11-10', '07:00', '12:30', null))), []); // 5,5 Std. ohne Pause ist ok
});

test('Ausstempeln vergessen (offen über 12 Stunden)', () => {
  const sch = schichten(tag('2026-11-10', '07:00', null), wienZuDate('2026-11-10', '20:00'));
  const w = azgWarnungen(sch, { jetzt: wienZuDate('2026-11-10', '20:00') });
  assert.ok(w.some((x) => x.typ === 'offen'));
  const frueh = azgWarnungen(schichten(tag('2026-11-10', '07:00', null), wienZuDate('2026-11-10', '18:00')), { jetzt: wienZuDate('2026-11-10', '18:00') });
  assert.ok(!frueh.some((x) => x.typ === 'offen'));
});

test('weniger als 11 Stunden Ruhezeit', () => {
  const sch = schichten([...tag('2026-11-10', '07:00', '20:00'), ...tag('2026-11-11', '06:00', '14:00')]);
  const w = azgWarnungen(sch);
  const r = w.find((x) => x.typ === 'ruhezeit');
  assert.ok(r);
  assert.equal(r.datum, '2026-11-11');
  assert.match(r.text, /10 Std\. Ruhezeit/);
  // 11 Stunden genau: keine Warnung
  assert.ok(!azgWarnungen(schichten([...tag('2026-11-10', '07:00', '19:00'), ...tag('2026-11-11', '06:00', '14:00')])).some((x) => x.typ === 'ruhezeit'));
});

test('geteilte Schicht am selben Tag ist keine Ruhezeit-Verletzung', () => {
  const sch = schichten([b('kommen', '2026-11-10', '07:00'), b('gehen', '2026-11-10', '10:00'), b('kommen', '2026-11-10', '11:00'), b('gehen', '2026-11-10', '14:00')]);
  assert.deepEqual(azgWarnungen(sch), []);
});
