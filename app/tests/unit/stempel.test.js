'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../server/stempel');
const { wienZuDate } = require('../../server/datum');

const z = (hm, datum = '2026-11-10') => wienZuDate(datum, hm).toISOString();
const b = (typ, hm, baustelleId = null, datum) => ({ typ, zeit: z(hm, datum), baustelleId });

test('Zustandsautomat: gültige Übergänge', () => {
  assert.equal(S.naechsterStatus('aus', 'kommen'), 'arbeit');
  assert.equal(S.naechsterStatus('arbeit', 'pause_start'), 'pause');
  assert.equal(S.naechsterStatus('pause', 'pause_ende'), 'arbeit');
  assert.equal(S.naechsterStatus('arbeit', 'wechsel'), 'arbeit');
  assert.equal(S.naechsterStatus('arbeit', 'gehen'), 'aus');
  assert.equal(S.naechsterStatus('pause', 'gehen'), 'aus');
});

test('Zustandsautomat: ungültige Folgen', () => {
  for (const [st, typ] of [['aus', 'gehen'], ['aus', 'pause_start'], ['aus', 'pause_ende'], ['aus', 'wechsel'], ['arbeit', 'kommen'], ['arbeit', 'pause_ende'], ['pause', 'kommen'], ['pause', 'pause_start'], ['pause', 'wechsel']]) {
    assert.equal(S.naechsterStatus(st, typ), null, `${st} + ${typ}`);
  }
});

test('pruefeBuchung: zweimal kommen, Wechsel auf dieselbe Baustelle', () => {
  assert.equal(S.pruefeBuchung({ status: 'arbeit', baustelleId: 1 }, 'kommen', 1).ok, false);
  assert.match(S.pruefeBuchung({ status: 'arbeit', baustelleId: 1 }, 'kommen', 1).grund, /Bereits eingestempelt/);
  assert.equal(S.pruefeBuchung({ status: 'arbeit', baustelleId: 1 }, 'wechsel', 1).ok, false);
  assert.equal(S.pruefeBuchung({ status: 'arbeit', baustelleId: 1 }, 'wechsel', 2).ok, true);
  assert.equal(S.pruefeBuchung({ status: 'aus' }, 'xyz').ok, false);
});

test('Status aus Buchungen (Baustelle, seit, Schichtbeginn)', () => {
  const st = S.statusAusBuchungen([b('kommen', '07:00', 1), b('pause_start', '12:00'), b('pause_ende', '12:30'), b('wechsel', '13:00', 2)]);
  assert.equal(st.status, 'arbeit');
  assert.equal(st.baustelleId, 2);
  assert.equal(st.seit, z('13:00'));
  assert.equal(st.schichtBeginn, z('07:00'));
  assert.equal(S.statusAusBuchungen([b('kommen', '07:00', 1), b('gehen', '15:00')]).status, 'aus');
  assert.equal(S.statusAusBuchungen([]).status, 'aus');
});

test('Schichten: Arbeit und Pause in Minuten, offene Schicht bis jetzt', () => {
  const s = S.schichten([b('kommen', '07:00', 1), b('pause_start', '12:00'), b('pause_ende', '12:30'), b('gehen', '15:30')]);
  assert.equal(s.length, 1);
  assert.equal(s[0].arbeitMin, 480);
  assert.equal(s[0].pauseMin, 30);
  assert.equal(s[0].datum, '2026-11-10');
  const o = S.schichten([b('kommen', '07:00', 1)], new Date(z('09:00')));
  assert.equal(o[0].offen, true);
  assert.equal(o[0].arbeitMin, 120);
});

test('Personal für den Bericht: zwei Blöcke, Pause, Stunden', () => {
  const s = S.schichten([b('kommen', '07:00', 1), b('pause_start', '12:00'), b('pause_ende', '12:30'), b('gehen', '16:00')]);
  assert.deepEqual(S.personalAusSchichten(s, 1), { von1: '07:00', bis1: '12:00', von2: '12:30', bis2: '16:00', pauseMin: 30, stunden: 8.5 });
  assert.equal(S.personalAusSchichten(s, 2), null);
});

test('Personal bei Baustellenwechsel: Stunden je Baustelle getrennt', () => {
  const s = S.schichten([b('kommen', '07:00', 1), b('wechsel', '10:00', 2), b('pause_start', '12:00'), b('pause_ende', '12:30'), b('gehen', '15:30')]);
  const p1 = S.personalAusSchichten(s, 1);
  const p2 = S.personalAusSchichten(s, 2);
  assert.deepEqual([p1.von1, p1.bis1, p1.von2, p1.stunden], ['07:00', '10:00', null, 3]);
  assert.deepEqual([p2.von1, p2.bis1, p2.von2, p2.bis2, p2.pauseMin, p2.stunden], ['10:00', '12:00', '12:30', '15:30', 30, 5]);
});

test('Stunden aus händisch bearbeiteten Blöcken', () => {
  assert.equal(S.stundenAusBloecken({ von1: '07:00', bis1: '12:00', von2: '12:30', bis2: '16:00', pauseMin: 30 }), 8.5);
  assert.equal(S.stundenAusBloecken({ von1: '07:00', bis1: '16:00', pauseMin: 30 }), 8.5);
  assert.equal(S.stundenAusBloecken({ von1: '07:00', bis1: '12:00', von2: '12:15', bis2: '16:00', pauseMin: 30 }), 8.5);
  assert.equal(S.stundenAusBloecken({}), 0);
});

test('Sommerzeit/Winterzeit: Tagesgrenzen in Wien', () => {
  // 29.03.2026: Umstellung auf Sommerzeit – 07:00 Wien = 05:00 UTC
  assert.equal(wienZuDate('2026-03-30', '07:00').toISOString(), '2026-03-30T05:00:00.000Z');
  assert.equal(wienZuDate('2026-11-10', '07:00').toISOString(), '2026-11-10T06:00:00.000Z');
});
