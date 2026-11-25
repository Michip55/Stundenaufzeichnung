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

// 15.38 (Inhaber 25.11.2026): keine Hinweise zum Arbeitszeitgesetz mehr – gleiche Fälle, die Warnung fehlt jetzt
const AZG_TYPEN = ['tag_10h', 'tag_12h', 'pause', 'ruhezeit'];
const ohneAzg = (w) => assert.deepEqual(w.filter((x) => AZG_TYPEN.includes(x.typ)), []);

test('15.38: mehr als 10 Stunden am Tag → kein Hinweis', () => {
  const w = azgWarnungen(schichten(tag('2026-11-10', '06:00', '17:00')));
  assert.deepEqual(w, []);
  assert.ok(!w.some((x) => /10,5 Std\.|mehr als 10 Std/.test(x.text)));
});

test('15.38: mehr als 12 Stunden → kein Hinweis zur Höchstgrenze', () => {
  const w = azgWarnungen(schichten(tag('2026-11-10', '05:00', '18:00')));
  assert.deepEqual(w, []);
  assert.ok(!w.some((x) => /§ 9 AZG|Höchstarbeitszeit/.test(x.text)));
});

test('15.38: mehr als 6 Stunden ohne 30 Minuten Pause → kein Hinweis', () => {
  assert.deepEqual(azgWarnungen(schichten(tag('2026-11-10', '07:00', '15:30', null))), []);
  assert.deepEqual(azgWarnungen(schichten(tag('2026-11-10', '07:00', '15:30', ['12:00', '12:15']))), []);
  assert.deepEqual(azgWarnungen(schichten(tag('2026-11-10', '07:00', '12:30', null))), []); // 5,5 Std. ohne Pause wie bisher
});

test('Ausstempeln vergessen (offen über 12 Stunden)', () => {
  const sch = schichten(tag('2026-11-10', '07:00', null), wienZuDate('2026-11-10', '20:00'));
  const w = azgWarnungen(sch, { jetzt: wienZuDate('2026-11-10', '20:00') });
  assert.ok(w.some((x) => x.typ === 'offen'));
  const frueh = azgWarnungen(schichten(tag('2026-11-10', '07:00', null), wienZuDate('2026-11-10', '18:00')), { jetzt: wienZuDate('2026-11-10', '18:00') });
  assert.ok(!frueh.some((x) => x.typ === 'offen'));
});

test('15.38: weniger als 11 Stunden Ruhezeit → kein Hinweis', () => {
  const sch = schichten([...tag('2026-11-10', '07:00', '20:00'), ...tag('2026-11-11', '06:00', '14:00')]);
  const w = azgWarnungen(sch);
  assert.deepEqual(w, []);
  assert.ok(!w.some((x) => /Ruhezeit|§ 12 AZG/.test(x.text)));
  // 11 Stunden genau: wie bisher keine Warnung
  assert.ok(!azgWarnungen(schichten([...tag('2026-11-10', '07:00', '19:00'), ...tag('2026-11-11', '06:00', '14:00')])).some((x) => x.typ === 'ruhezeit'));
});

test('15.38: langer Tag ohne Pause mit kurzer Ruhezeit und offener Schicht → nur „Ausstempeln vergessen?“', () => {
  const jetzt = wienZuDate('2026-11-11', '20:00');
  const sch = schichten([...tag('2026-11-10', '05:00', '20:00', null), ...tag('2026-11-11', '06:00', null)], jetzt);
  const w = azgWarnungen(sch, { jetzt });
  ohneAzg(w);
  assert.deepEqual(typen(w), ['offen']);
});

test('geteilte Schicht am selben Tag ist keine Ruhezeit-Verletzung', () => {
  const sch = schichten([b('kommen', '2026-11-10', '07:00'), b('gehen', '2026-11-10', '10:00'), b('kommen', '2026-11-10', '11:00'), b('gehen', '2026-11-10', '14:00')]);
  assert.deepEqual(azgWarnungen(sch), []);
});

test('B-05: ausgestempelte Schicht über 16 Std. → Warnung unplausibel', () => {
  const sch = schichten([b('kommen', '2026-11-10', '07:00'), b('gehen', '2026-11-12', '11:00')]);
  assert.ok(azgWarnungen(sch).some((w) => w.typ === 'unplausibel' && w.datum === '2026-11-10'));
});
