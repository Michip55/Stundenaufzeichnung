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

test('15.25 Review: Summen in Std:Min aus den auf Minuten gerundeten Einzelwerten (5 × 7:40 = 38:20, nicht 38:21)', async () => {
  const { stundenSumme: summe, stundenMinuten: minuten, stundenHM: hm, stundenLang: lang } = await laden();
  // Die API liefert 7:40 als 7,67 und summiert gerundete Tage: 5 × 7,67 = 38,35 = „38:21“
  assert.equal(hm(38.35), '38:21');
  assert.equal(hm(summe([7.67, 7.67, 7.67, 7.67, 7.67])), '38:20');
  assert.equal(lang(summe([7.67, 7.67, 7.67, 7.67, 7.67])), '38 Std. 20 Min.');
  assert.equal(hm(summe(Array(20).fill(7.67))), '153:20'); // statt 153:24 aus 153,4
  assert.equal(hm(summe([7.67, 7.67, 7.67])), '23:00'); // Bericht: 3 Personen, statt 23:01 aus 23,01
  // Minuten wie in der Anzeige gerundet; keine Zahl zählt 0, Minus bleibt Minus
  assert.equal(minuten(9.85), 591); assert.equal(minuten(9.999), 600); assert.equal(minuten(-0.5), -30);
  for (const x of [null, undefined, NaN, '8', {}]) assert.equal(minuten(x), 0);
  assert.equal(summe([]), 0); assert.equal(summe(null), 0); assert.equal(hm(summe([8, null, undefined, 0.5])), '8:30');
  // Eigenschaft: die Summe ist immer genau die Summe der angezeigten Einzelwerte (zufällige Tage)
  const zuMin = (t) => { const [h, m] = t.replace('−', '-').split(':').map(Number); return h * 60 + (t.startsWith('−') ? -m : m); };
  for (let i = 0; i < 500; i++) {
    const werte = Array.from({ length: 1 + (i % 23) }, () => Math.round(Math.random() * 1200) / 100);
    assert.equal(zuMin(hm(summe(werte))), werte.reduce((a, w) => a + zuMin(hm(w)), 0), JSON.stringify(werte));
  }
});

test('15.25 Review: Monatsauswertung, Meine Woche und Bericht bilden Std:Min-Summen aus den Einzelwerten; Dezimal bleibt API', () => {
  const monat = fs.readFileSync(path.join(JS, 'views', 'monat.js'), 'utf8');
  assert.match(monat, /const ma = dez \? d\.mitarbeiter \|\| \[\] : \(d\.mitarbeiter \|\| \[\]\)\.map\(minutenSummen\)/);
  assert.match(monat, /export function minutenSummen\(m\)/);
  const woche = fs.readFileSync(path.join(JS, 'views', 'woche.js'), 'utf8');
  assert.match(woche, /id="woche-summe">\$\{fmt\.stdLangHtml\(stundenSumme\(/);
  assert.doesNotMatch(woche, /stdLangHtml\(w\.summe/);
  const ber = fs.readFileSync(path.join(JS, 'views', 'berichte.js'), 'utf8');
  assert.match(ber, /const gesamtHM = \(\) => fmt\.hm\(stundenSumme\(/);
  assert.doesNotMatch(ber, /fmt\.hm\(gesamt\(\)\)/);
});

test('15.25 Review: Arbeitszeitmodell-Dialog meldet dezimal wie die Eingabe; Nachkalkulations-Hinweis in Langform', async () => {
  const az = fs.readFileSync(path.join(JS, 'views', 'arbeitszeitmodelle.js'), 'utf8');
  assert.match(az, /Summe der Tage: \$\{stdEingabe\(s\)\} Std\./);
  assert.match(az, /Die Tage ergeben \$\{stdEingabe\(summe\(\)\)\} Std\./);
  const kalk = fs.readFileSync(path.join(JS, 'views', 'kalkulation.js'), 'utf8');
  assert.match(kalk, /esc\(stundenImText\(h\.text\)\)/);
  // genau der Text vom Server (server/kalkulation.js) – andere Kalkulations-Hinweise haben keine Kommazahl vor „Std.“
  const { stundenImText: t } = await laden();
  assert.equal(t('12,5 Std. ohne Lohngruppe – dafür sind keine Lohnkosten gerechnet.'), '12 Std. 30 Min. ohne Lohngruppe – dafür sind keine Lohnkosten gerechnet.');
  assert.equal(t('Budget-Verbrauch liegt 12,5 Prozentpunkte über dem Leistungsstand – die Kosten laufen der Leistung davon.'), 'Budget-Verbrauch liegt 12,5 Prozentpunkte über dem Leistungsstand – die Kosten laufen der Leistung davon.');
  const srv = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'kalkulation.js'), 'utf8');
  const mitStd = srv.split('\n').filter((z) => /hinweise\.push|text: `/.test(z) && /Std\./.test(z));
  assert.equal(mitStd.length, 1, mitStd.join('\n'));
  assert.match(mitStd[0], /ohne Lohngruppe/);
});
