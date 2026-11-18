'use strict';
/** 15.25: Stunden als Stunden:Minuten in der Oberfläche (public/js/zahl.js: stundenHM, stundenLang) */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '..', '..', 'public', 'js');
const laden = () => import(pathToFileURL(path.join(JS, 'zahl.js')).href);

test('15.25: Kurzform „9:51“ – Minuten gerundet, nie „:60“, Minus mit echtem Minuszeichen', async () => {
  const { stundenHM: hm } = await laden();
  const faelle = [
    [9.85, '9:51'], [9.999, '10:00'], [9.991, '9:59'], [0.0833, '0:05'], [1 / 12, '0:05'], [0, '0:00'], [-0, '0:00'],
    [8, '8:00'], [8.5, '8:30'], [7.75, '7:45'], [0.25, '0:15'], [10, '10:00'], [23.99, '23:59'], [168.75, '168:45'],
    [1234.0833, '1234:05'], [12345.5, '12345:30'], [-0.5, '−0:30'], [-1.25, '−1:15'], [-0.004, '0:00'], [0.004, '0:00'], [0.009, '0:01'],
    [9.85 + 0.1 + 0.05, '10:00'], [0.1 + 0.2, '0:18']
  ];
  for (const [ein, soll] of faelle) assert.equal(hm(ein), soll, `stundenHM(${ein})`);
  // Minuszeichen ist U+2212, kein Bindestrich
  assert.equal(hm(-0.5).charCodeAt(0), 0x2212);
  // Keine Zahl → wie bisher „–“ (fmt.zahl), eigener Leerwert möglich
  for (const x of [null, undefined, NaN, Infinity, -Infinity, '9,85', '9.85', {}, []]) assert.equal(hm(x), '–', `stundenHM(${String(x)})`);
  assert.equal(hm(null, ''), '');
});

test('15.25: Langform „9 Std. 51 Min.“ – volle Stunden ohne Minuten, nur Minuten, null als „0 Min.“', async () => {
  const { stundenLang: lang } = await laden();
  const faelle = [
    [9.85, '9 Std. 51 Min.'], [9.999, '10 Std.'], [8, '8 Std.'], [0.75, '45 Min.'], [0.0833, '5 Min.'], [0, '0 Min.'], [0.004, '0 Min.'],
    [38.5, '38 Std. 30 Min.'], [1 / 60, '1 Min.'], [168.75, '168 Std. 45 Min.'], [1234.0833, '1234 Std. 5 Min.'],
    [-0.5, '−30 Min.'], [-1.25, '−1 Std. 15 Min.'], [-2, '−2 Std.'], [-0.004, '0 Min.']
  ];
  for (const [ein, soll] of faelle) assert.equal(lang(ein), soll, `stundenLang(${ein})`);
  for (const x of [null, undefined, NaN, Infinity, '8']) assert.equal(lang(x), '–', `stundenLang(${String(x)})`);
});

test('15.25: Kurz- und Langform zeigen dieselben Minuten (zufällige Werte)', async () => {
  const { stundenHM: hm, stundenLang: lang } = await laden();
  for (let i = 0; i < 2000; i++) {
    const h = Math.round(Math.random() * 30000) / 100;
    const [s, m] = hm(h).split(':').map(Number);
    assert.ok(m >= 0 && m < 60, `${h} → ${hm(h)}`);
    assert.equal(s * 60 + m, Math.round(h * 60), `${h} → ${hm(h)}`);
    const t = lang(h); const ls = /(\d+) Std\./.exec(t), lm = /(\d+) Min\./.exec(t);
    assert.equal((ls ? Number(ls[1]) : 0) * 60 + (lm ? Number(lm[1]) : 0), Math.round(h * 60), `${h} → ${t}`);
  }
});

test('15.25: Oberfläche nutzt die zentralen Funktionen; Monatsauswertung hat den Schalter und merkt ihn je Gerät', () => {
  const ui = fs.readFileSync(path.join(JS, 'ui.js'), 'utf8');
  assert.match(ui, /hm: \(stunden\) => stundenHM\(stunden\)/);
  assert.match(ui, /stdLang: \(stunden\) => stundenLang\(stunden\)/);
  // Gerätespeicher: die Einstellung bleibt beim Abmelden (kein Personenbezug)
  assert.match(ui, /const GERAET = \[[^\]]*'bt_stunden_format'/);
  const monat = fs.readFileSync(path.join(JS, 'views', 'monat.js'), 'utf8');
  assert.match(monat, /STUNDEN_FORMAT = 'bt_stunden_format'/);
  assert.match(monat, /data-zf="\$\{k\}"/);
  // Stunden-Spalten nicht mehr direkt dezimal (nur noch über den Schalter)
  for (const k of ['summe', 'normal', 'ueberstunden', 'mehrstunden', 'seg']) assert.doesNotMatch(monat, new RegExp(`fmt\\.zahl\\(m\\.${k} `), `monat.js: ${k} direkt mit fmt.zahl`);
  assert.doesNotMatch(monat, /fmt\.zahl\(z\.stunden\)/);
  // Die Exporte bleiben dezimal: der Server formatiert sie, die Oberfläche verlinkt sie nur
  assert.match(monat, /href="\/api\/monat\/export\.csv\?monat=/);
});

test('15.25: Server-Hinweise – nur Stunden mit Dezimalkomma werden zur Langform, alles andere bleibt', async () => {
  const { stundenImText: t } = await laden();
  const faelle = [
    ['12.11.2026: 11,08 Std. – mehr als 10 Std. Arbeitszeit.', '12.11.2026: 11 Std. 5 Min. – mehr als 10 Std. Arbeitszeit.'],
    ['12.11.2026: 12,5 Std. – Höchstarbeitszeit von 12 Std. überschritten (§ 9 AZG).', '12.11.2026: 12 Std. 30 Min. – Höchstarbeitszeit von 12 Std. überschritten (§ 9 AZG).'],
    ['10.11.2026: nur 9,5 Std. Ruhezeit seit dem Vortag (mind. 11 Std., § 12 AZG).', '10.11.2026: nur 9 Std. 30 Min. Ruhezeit seit dem Vortag (mind. 11 Std., § 12 AZG).'],
    ['4,25 Std. auf 26-041 gestempelt', '4 Std. 15 Min. auf 26-041 gestempelt'],
    ['Genehmigte Abwesenheit „U“ und 7,5 Arbeitsstunden am selben Tag – bitte prüfen.', 'Genehmigte Abwesenheit „U“ und 7 Std. 30 Min. Arbeitszeit am selben Tag – bitte prüfen.'],
    ['überschneiden sich um 0,25 Std. – nur einmal gezählt', 'überschneiden sich um 15 Min. – nur einmal gezählt'],
    ['mehr als 6 Std. gearbeitet ohne 30 Min. Pause (§ 11 AZG).', 'mehr als 6 Std. gearbeitet ohne 30 Min. Pause (§ 11 AZG).'],
    ['Betrag 1.234,50 € · 12,5 t · Version 1,5', 'Betrag 1.234,50 € · 12,5 t · Version 1,5'],
    ['1.234,5 Std.', '1.234,5 Std.'], // mehrdeutig (Tausenderpunkt) – nie raten
    ['', ''],
  ];
  for (const [ein, soll] of faelle) assert.equal(t(ein), soll, ein);
  assert.equal(t(null), null);
  assert.equal(t(undefined), undefined);
});
