'use strict';
// Unit-Test der Zahlen- und Zeitlogik der Oberfläche (Prüfbericht B-04, B-06).
// Aufruf: node tests/e2e/parse.test.js  (wird auch von tests/e2e/run.js gestartet)
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');

(async () => {
  // public/js/zahl.js ist ein ES-Modul ohne Browser-Abhängigkeit; als data:-Modul laden, unabhängig vom Pakettyp
  const quelle = fs.readFileSync(path.resolve(__dirname, '..', '..', 'public', 'js', 'zahl.js'), 'utf8');
  const z = await import('data:text/javascript;base64,' + Buffer.from(quelle).toString('base64')).catch(() => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'public', 'js', 'zahl.js')).href));
  let n = 0;
  const gleich = (ein, soll) => { n++; assert.equal(z.parseZahl(ein), soll, `parseZahl(${JSON.stringify(ein)})`); };
  const ungueltig = (ein) => { n++; assert.ok(Number.isNaN(z.parseZahl(ein)), `parseZahl(${JSON.stringify(ein)}) muss ungültig sein, ist ${z.parseZahl(ein)}`); };

  // B-04: Tausenderpunkte
  gleich('250.000', 250000);
  gleich('250.000,50', 250000.5);
  gleich('1.234.567', 1234567);
  gleich('1.234.567,89', 1234567.89);
  gleich('1.234', 1234);
  gleich('12,5', 12.5);
  gleich('12.5', 12.5);
  gleich('12.50', 12.5);
  gleich('0,5', 0.5);
  gleich('86900', 86900);
  gleich('86900,00', 86900);
  gleich('€ 1.250,00', 1250);
  gleich('1 250,00', 1250);
  gleich('1 250,5 €', 1250.5);
  gleich('-12,5', -12.5);
  gleich(' 7 ', 7);
  gleich(8.5, 8.5);
  for (const x of ['', '   ', 'abc', '1.2345', '12.345,6.7', '1,2,3', '12,5.3', '1..000', '.5', ',5', '5,', '5.', '1.00.000', '12.3456', '1,234.56', '1e6', '0x10', '--5', NaN, Infinity, null, undefined]) ungueltig(x);

  // Rückfrage bei Änderung um mehr als Faktor 10
  assert.equal(z.starkGeaendert(86900, 250), true); n++;
  assert.equal(z.starkGeaendert(250, 250000), true); n++;
  assert.equal(z.starkGeaendert(86900, 95000), false); n++;
  assert.equal(z.starkGeaendert(null, 250000), false); n++;
  assert.equal(z.starkGeaendert(0, 250000), false); n++;
  assert.equal(z.starkGeaendert(100, 1000), false); n++;

  // B-06: Stunden, auch über Mitternacht
  const std = (p, soll) => { n++; assert.equal(z.stundenAus(p), soll, `stundenAus(${JSON.stringify(p)})`); };
  std({ von1: '07:00', bis1: '12:00', von2: '12:30', bis2: '16:00', pauseMin: 30 }, 8.5);
  std({ von1: '07:00', bis1: '16:00', pauseMin: 30 }, 8.5);
  std({ von1: '22:00', bis1: '06:00', pauseMin: 30 }, 7.5);
  std({ von1: '22:00', bis1: '02:00', von2: '02:30', bis2: '06:00', pauseMin: 30 }, 7.5);
  std({ von1: '20:00', bis1: '23:30', von2: '00:00', bis2: '04:00', pauseMin: 30 }, 7.5);
  std({ von1: '22:00', bis1: '00:36', pauseMin: 0 }, 2.6);
  std({ von1: '', bis1: '', pauseMin: 0 }, 0);
  const fehler = (p, soll) => { n++; assert.equal(!!z.personalFehler(p), soll, `personalFehler(${JSON.stringify(p)}) = „${z.personalFehler(p)}“`); };
  fehler({ von1: '22:00', bis1: '02:00', von2: '02:30', bis2: '06:00' }, false);
  fehler({ von1: '22:00', bis1: '06:00' }, false);
  fehler({ von1: '07:00', bis1: '12:00', von2: '12:30', bis2: '16:00' }, false);
  fehler({ von1: '07:00', bis1: '' }, true);
  fehler({ von1: '07:00', bis1: '07:00' }, true);
  fehler({ von1: '', bis1: '', von2: '12:00', bis2: '13:00' }, true);
  fehler({ von1: '07:00', bis1: '12:00', von2: '11:00', bis2: '16:00' }, true);
  fehler({ von1: '22:00', bis1: '02:00', von2: '01:00', bis2: '06:00' }, true);
  fehler({}, false);
  n++; assert.equal(z.bloecke({ von1: '22:00', bis1: '06:00' }).naechsterTag, true);
  n++; assert.equal(z.bloecke({ von1: '07:00', bis1: '16:00' }).naechsterTag, false);

  console.log(`parse.test.js: ${n} Prüfungen bestanden`);
})().catch((e) => { console.error('parse.test.js FEHLER: ' + e.message); process.exit(1); });
