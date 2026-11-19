'use strict';
/** 15.27: Begrüßung und „Pause beim Gehen“ – reine Funktionen der Stempeluhr (public/js/pause-gehen.js) */
process.env.TZ = 'Europe/Vienna'; // Uhrzeiten wie am Gerät (fmt.uhr rechnet in Ortszeit)
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const laden = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'public', 'js', 'pause-gehen.js')).href);
const t = (hm, tag = '2026-11-18') => new Date(`${tag}T${hm}:00+01:00`).getTime();

test('15.27 Begrüßung: zweites Wort („Pilz Thomas“ → „Thomas“), ein Wort bleibt, Leerzeichen zählen nicht', async () => {
  const { grussName } = await laden();
  for (const [ein, aus] of [['Pilz Thomas', 'Thomas'], ['  Pilz   Thomas ', 'Thomas'], ['Pilz\tThomas', 'Thomas'], ['Pilz Thomas Maria', 'Thomas'], ['Pilz', 'Pilz'], ['  Pilz ', 'Pilz'], ['', ''], [null, ''], [undefined, '']]) {
    assert.equal(grussName(ein), aus, JSON.stringify(ein));
  }
});

test('15.27 Wann fragt „Gehen“ nach der Pause?', async () => {
  const { fragePauseBeimGehen, pauseInSchicht, schichtStart } = await laden();
  const st = (status, buchungen, extra = {}) => ({ status, heute: { buchungen }, ...extra });
  const kommen = { typ: 'kommen', zeit: new Date(t('07:00')).toISOString() };
  assert.equal(fragePauseBeimGehen(st('arbeit', [kommen])), true, 'gearbeitet, keine Pause');
  assert.equal(fragePauseBeimGehen(st('pause', [kommen, { typ: 'pause_start', zeit: new Date(t('12:00')).toISOString() }])), false, 'in der Pause');
  assert.equal(fragePauseBeimGehen(st('aus', [])), false);
  assert.equal(fragePauseBeimGehen(st('arbeit', [kommen, { typ: 'pause_start', zeit: new Date(t('12:00')).toISOString() }, { typ: 'pause_ende', zeit: new Date(t('12:30')).toISOString() }])), false, 'Pause gestempelt');
  // Pause in einer früheren Schicht desselben Tages zählt nicht
  const frueher = [{ typ: 'kommen', zeit: new Date(t('05:00')).toISOString() }, { typ: 'pause_start', zeit: new Date(t('05:30')).toISOString() }, { typ: 'pause_ende', zeit: new Date(t('05:45')).toISOString() }, { typ: 'gehen', zeit: new Date(t('06:00')).toISOString() }];
  assert.equal(fragePauseBeimGehen(st('arbeit', [...frueher, kommen])), true);
  assert.equal(schichtStart(st('arbeit', [...frueher, kommen])), t('07:00'));
  // Schicht seit gestern (über Mitternacht): Beginn vom Server; Pause vom Server gemeldet
  assert.equal(schichtStart(st('arbeit', [], { schichtBeginn: '2026-11-17T21:00:00.000Z' })), Date.parse('2026-11-17T21:00:00.000Z'));
  assert.equal(fragePauseBeimGehen(st('arbeit', [], { schichtBeginn: '2026-11-17T21:00:00.000Z' })), true);
  assert.equal(pauseInSchicht(st('arbeit', [], { schichtBeginn: '2026-11-17T21:00:00.000Z', pauseInSchicht: true })), true);
  assert.equal(fragePauseBeimGehen(st('arbeit', [], { schichtBeginn: '2026-11-17T21:00:00.000Z', pauseInSchicht: true })), false);
  assert.equal(fragePauseBeimGehen(st('arbeit', [])), false, 'ohne bekannten Schichtbeginn nicht fragen');
});

test('15.27 Vorschlag „Beginn ca.“: 12:00 bzw. nächste passende Viertelstunde, sonst Mitte der Schicht auf 15 Min', async () => {
  const { vorschlagBeginn, hm } = await laden();
  assert.equal(hm(vorschlagBeginn(t('07:00'), t('16:00'), 30)), '12:00');
  assert.equal(hm(vorschlagBeginn(t('07:00'), t('12:30'), 30)), '12:00', 'genau bis jetzt passt');
  // 13:00–18:00: 12:00 liegt vor dem Kommen → Mitte (15:30) minus halbe Pause = 15:15
  assert.equal(hm(vorschlagBeginn(t('13:00'), t('18:00'), 30)), '15:15');
  assert.equal(hm(vorschlagBeginn(t('13:00'), t('18:00'), 60)), '15:00');
  // 06:00–12:10: 12:00 liegt in der Schicht, aber 12:00 + 30 > jetzt → nächstgelegene passende Viertelstunde davor
  assert.equal(hm(vorschlagBeginn(t('06:00'), t('12:10'), 30)), '11:30');
  // kurze Schicht 13:07–13:50 → auf 15 Min gerundet, aber in der Schicht
  const v = vorschlagBeginn(t('13:07'), t('13:50'), 30);
  assert.ok(v >= t('13:07') && v + 30 * 60000 <= t('13:50'), hm(v));
  // zu kurz: Kommen-Zeitpunkt (die Prüfung meldet es)
  assert.equal(vorschlagBeginn(t('13:00'), t('13:20'), 30), t('13:00'));
  // Nachtschicht 20:00–04:00: 12:00 liegt nicht in der Schicht → Mitte 00:00 − 15 = 23:45 (Vortag)
  const n = vorschlagBeginn(t('20:00', '2026-11-17'), t('04:00'), 30);
  assert.equal(n, t('23:45', '2026-11-17'));
});

test('15.27 Vorschlag weicht Buchungen der Schicht aus (Baustellenwechsel um die Mittagszeit) – Review N8', async () => {
  const { vorschlagBeginn, pruefePause, hm } = await laden();
  const iso = (x) => new Date(t(x)).toISOString();
  const buch = [{ typ: 'kommen', zeit: iso('07:00') }, { typ: 'wechsel', zeit: iso('12:10') }];
  for (const dauer of [30, 45, 60]) {
    const v = vorschlagBeginn(t('07:00'), t('16:00'), dauer, buch);
    assert.equal(hm(v), '12:15', `${dauer} Min`);
    assert.ok(!pruefePause({ start: t('07:00'), jetzt: t('16:00'), beginn: v, dauer, buchungen: buch }).fehler);
  }
  // Wechsel 12:20, Gehen 12:50: nach dem Wechsel ist kein Platz für 30 Min → vor dem Wechsel (11:45 – 12:15)
  const b2 = [{ typ: 'kommen', zeit: iso('07:00') }, { typ: 'wechsel', zeit: iso('12:20') }];
  assert.equal(hm(vorschlagBeginn(t('07:00'), t('12:50'), 30, b2)), '11:45');
  // Wechsel genau 12:00 – Pause darf mit dem Wechsel beginnen
  assert.equal(hm(vorschlagBeginn(t('07:00'), t('16:00'), 30, [{ typ: 'wechsel', zeit: iso('12:00') }])), '12:00');
  // kurze Schicht mit Wechsel, keine Viertelstunde frei: Beginn auf die Minute
  const b3 = [{ typ: 'kommen', zeit: iso('13:07') }, { typ: 'wechsel', zeit: iso('13:20') }];
  const v3 = vorschlagBeginn(t('13:07'), t('13:58'), 30, b3);
  assert.ok(!pruefePause({ start: t('13:07'), jetzt: t('13:58'), beginn: v3, dauer: 30, buchungen: b3 }).fehler, hm(v3));
  // Schicht mit Sekunden beim Kommen: der Vorschlag ist über das Feld (HH:MM) wieder gültig
  const s4 = t('13:07') + 25000;
  const v4 = vorschlagBeginn(s4, t('13:45'), 30, []);
  const feld = t(hm(v4));
  assert.ok(!pruefePause({ start: s4, jetzt: t('13:45'), beginn: feld, dauer: 30, buchungen: [] }).fehler, hm(v4));
});

test('15.27 EIN Vorschlag für alle Dauern – das Feld zeigt, was gebucht wird (Review N8)', async () => {
  const { vorschlagFuerAuswahl, pruefePause, hm } = await laden();
  const iso = (x) => new Date(t(x)).toISOString();
  const pruef = (start, jetzt, buchungen, erwartet, passend) => {
    const v = vorschlagFuerAuswahl({ start: t(start), jetzt: t(jetzt), auswahl: [30, 45, 60], buchungen });
    if (erwartet) assert.equal(hm(v), erwartet, `${start}–${jetzt}`);
    for (const dauer of passend) assert.ok(!pruefePause({ start: t(start), jetzt: t(jetzt), beginn: t(hm(v)), dauer, buchungen }).fehler, `${start}–${jetzt} ${dauer} Min ab ${hm(v)}`);
    return v;
  };
  pruef('07:00', '16:00', [], '12:00', [30, 45, 60]);
  pruef('07:00', '09:00', [], '07:30', [30, 45, 60]); // Mitte für 60 Min – passt auch für 30 und 45
  pruef('13:00', '18:00', [], '15:00', [30, 45, 60]);
  pruef('07:00', '12:45', [], '11:45', [30, 45, 60]);
  pruef('07:00', '16:00', [{ typ: 'wechsel', zeit: iso('12:10') }], '12:15', [30, 45, 60]);
  // 07:00–07:50: 60 Min passt nicht hinein → mit 45 gerechnet, gilt auch für 30
  pruef('07:00', '07:50', [], null, [30, 45]);
  // zu kurz für alles: Vorschlag ab Kommen, die Prüfung meldet es
  assert.equal(vorschlagFuerAuswahl({ start: t('13:00'), jetzt: t('13:20'), auswahl: [30, 45, 60] }), t('13:00'));
  // Nachtschicht 22:00–06:00 → Mitte für 60 Min, gilt für alle
  const n = vorschlagFuerAuswahl({ start: t('22:00', '2026-11-17'), jetzt: t('06:00'), auswahl: [30, 45, 60] });
  assert.equal(n, t('01:30'));
});

test('15.27 Uhrzeit aus dem Feld: letztes Auftreten bis jetzt (über Mitternacht gestern)', async () => {
  const { zeitpunktAus } = await laden();
  assert.equal(zeitpunktAus('12:00', t('16:00')), t('12:00'));
  assert.equal(zeitpunktAus('23:30', t('01:00')), t('23:30', '2026-11-17'));
  assert.equal(zeitpunktAus('', t('16:00')), null);
  assert.equal(zeitpunktAus('25:00', t('16:00')), null);
  assert.equal(zeitpunktAus('ab', t('16:00')), null);
});

test('15.27 Prüfung der Pause vor dem Buchen (wie der Server, mit verständlichen Meldungen)', async () => {
  const { pruefePause } = await laden();
  const iso = (hm) => new Date(t(hm)).toISOString();
  const basis = { start: t('07:00'), jetzt: t('16:00'), buchungen: [{ typ: 'kommen', zeit: iso('07:00') }] };
  assert.deepEqual(pruefePause({ ...basis, beginn: t('12:00'), dauer: 30 }), { beginn: t('12:00'), ende: t('12:30') });
  assert.match(pruefePause({ ...basis, beginn: t('06:30'), dauer: 30 }).fehler, /frühestens um 07:00 Uhr/);
  assert.match(pruefePause({ ...basis, beginn: t('15:45'), dauer: 30 }).fehler, /bis jetzt \(16:00 Uhr\) vorbei.*spätestens 15:30 Uhr/);
  assert.match(pruefePause({ ...basis, beginn: null, dauer: 30 }).fehler, /Beginn der Pause/);
  // Kommen mit Sekunden (07:00:40): Feld „07:00“ gilt als Kommen
  const mitSek = { ...basis, start: t('07:00') + 40000 };
  assert.deepEqual(pruefePause({ ...mitSek, beginn: t('07:00'), dauer: 30 }), { beginn: t('07:00') + 40000, ende: t('07:30') + 40000 });
  // Baustellenwechsel in der Pause (auch genau am Ende) – nicht erlaubt; genau am Beginn – erlaubt
  const wechsel = { ...basis, buchungen: [...basis.buchungen, { typ: 'wechsel', zeit: iso('12:15') }] };
  assert.match(pruefePause({ ...wechsel, beginn: t('12:00'), dauer: 30 }).fehler, /Um 12:15 Uhr hast du die Baustelle gewechselt/);
  assert.match(pruefePause({ ...wechsel, beginn: t('11:45'), dauer: 30 }).fehler, /12:15/);
  assert.ok(!pruefePause({ ...wechsel, beginn: t('12:15'), dauer: 30 }).fehler);
  assert.ok(!pruefePause({ ...wechsel, beginn: t('11:15'), dauer: 30 }).fehler, 'endet 11:45 – vor dem Wechsel');
  // Schicht kürzer als Pause + 5 Min
  assert.match(pruefePause({ start: t('13:00'), jetzt: t('13:20'), beginn: t('13:00'), dauer: 30, buchungen: [] }).fehler, /Seit dem Kommen um 13:00 Uhr sind erst 20 Min vergangen – eine Pause von 30 Min passt nicht hinein/);
  assert.match(pruefePause({ start: t('13:00'), jetzt: t('13:34'), beginn: t('13:00'), dauer: 30, buchungen: [] }).fehler, /erst 34 Min/);
  assert.ok(!pruefePause({ start: t('13:00'), jetzt: t('13:35'), beginn: t('13:00'), dauer: 30, buchungen: [] }).fehler);
  assert.match(pruefePause({ start: t('13:00'), jetzt: t('14:20'), beginn: t('13:00'), dauer: 90, buchungen: [] }).fehler, /erst 1 Std\. 20 Min/);
});
