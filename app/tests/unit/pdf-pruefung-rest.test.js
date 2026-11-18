'use strict';
/**
 * Korrekturen Nachprüfung – Rest PDF (API.md 14.8): N-010/N-025 (Laufzeit bei überlappenden bzw. verschachtelten Streams
 * und bei indirekter /Length mit vielen Werten, gemeinsames Byte-Budget, Obergrenze der Objekte) und N-064 (PDF-Strings
 * werden vor der Prüfung von Link- und Aktionszielen dekodiert: Escapes, Oktal, Hex, UTF-16BE/LE und UTF-8 mit BOM).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { pdfPruefen, DokumentFehler, MAX_OBJEKTE, MAX_LAENGEN } = require('../../server/dokument-pruefung');

const abgelehnt = (buf, muster, info) => assert.throws(() => pdfPruefen(buf), (e) => e instanceof DokumentFehler && muster.test(e.message), info);
const angenommen = (buf, info) => assert.equal(pdfPruefen(buf).mime, 'application/pdf', info);
const NICHT = /nicht prüfbare Inhalte/;
const B = (s) => Buffer.from(s, 'latin1');
const KOPF = '%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\n';
const ENDE = 'trailer << /Root 1 0 R >>\n%%EOF\n';

/** Laufzeit in ms (bestes von drei Läufen); das Ergebnis muss eine Ablehnung bzw. Annahme sein, nie ein anderer Fehler */
function laufzeit(buf) {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t = process.hrtime.bigint();
    try { pdfPruefen(buf); } catch (e) { assert.ok(e instanceof DokumentFehler, e.message); }
    best = Math.min(best, Number(process.hrtime.bigint() - t) / 1e6);
    if (best > 2000) break; // deutlich zu langsam – nicht weiter messen
  }
  return best;
}
/**
 * Erzeugt das PDF für n und 4n (≈ 1 MB): beide müssen abgelehnt werden, 4n unter 500 ms, und 4n darf höchstens etwa
 * linear länger dauern (quadratisch wäre das 16-Fache).
 */
function linear(erzeuge, n, muster = NICHT) {
  const klein = erzeuge(n), gross = erzeuge(4 * n);
  assert.ok(gross.length > 900 * 1024 && gross.length < 1300 * 1024, `Größe ${gross.length}`);
  const t1 = laufzeit(klein); // zuerst die kleine Datei – so scheitert der Test ohne Korrektur schnell
  assert.ok(t1 < 500, `n (${(klein.length / 1024).toFixed(0)} KB): ${t1.toFixed(1)} ms`);
  abgelehnt(klein, muster);
  const t4 = laufzeit(gross);
  assert.ok(t4 < 500, `4n (${(gross.length / 1024).toFixed(0)} KB): ${t4.toFixed(1)} ms`);
  assert.ok(t4 < 8 * t1 + 25, `nicht linear: n ${t1.toFixed(1)} ms, 4n ${t4.toFixed(1)} ms`);
  abgelehnt(gross, muster);
}

// ---------------------------------------------------------------- N-010 / N-025: überlappende Streams

/** n Köpfe „i 0 obj << /Length 1 >> stream“ ohne eigenes „endstream“ – jeder Stream reicht bis zum einzigen Ende */
const ueberlappend = (n) => {
  const t = [];
  for (let i = 0; i < n; i++) t.push(`${i + 3} 0 obj\n<< /Length 1 >>\nstream\nx\n`);
  return B(`${KOPF}${t.join('')}endstream\nendobj\n${ENDE}`);
};
/** n verschachtelte Streams: jede /Length zeigt genau auf das gemeinsame „endstream“ am Ende (gültige Lesart) */
const verschachtelt = (n) => {
  const koepfe = [];
  for (let i = 0; i < n; i++) koepfe.push(`${i + 3} 0 obj\n<< /Length ${'0'.repeat(7)} >>\nstream\n`);
  const rest = '\nendstream\nendobj\n';
  let laenge = 0;
  const teile = [];
  for (let i = n - 1; i >= 0; i--) { // von hinten: Länge = alles nach diesem Kopf bis vor „\nendstream“
    teile[i] = koepfe[i].replace('0000000', String(laenge).padStart(7, '0'));
    laenge += teile[i].length;
  }
  return B(`${KOPF}${teile.join('')}${rest}${ENDE}`);
};

test('N-010/N-025: überlappende Streams (jeder bis zum einzigen „endstream“) – nicht prüfbar, linear, ≈ 1 MB < 500 ms', { timeout: 60000 }, () => {
  linear(ueberlappend, 7500);
});

test('N-010/N-025: verschachtelte Streams mit gültiger /Length bis zum gemeinsamen Ende – nicht prüfbar, linear', { timeout: 60000 }, () => {
  linear(verschachtelt, 6500);
});

test('N-025: überlappender Stream versteckt JavaScript nicht und wird nie angenommen', () => {
  // Stream 4 (Bild, nicht durchsucht) reicht laut /Length über den Kopf von Stream 5 hinweg
  const js = '<< /S /JavaScript /JS (app.alert\\(1\\)) >>';
  const innen = `\nendstream\nendobj\n5 0 obj\n<< /Length ${js.length} >>\nstream\n${js}`;
  abgelehnt(B(`${KOPF}4 0 obj\n<< /Subtype /Image /Filter /DCTDecode /Length ${innen.length + 4} >>\nstream\n\xff\xd8\xff\xd9${innen}\nendstream\nendobj\n${ENDE}`), /nicht prüfbare|aktive Inhalte/);
  // zwei Streams ohne JS, der erste überlappt den zweiten → nicht prüfbar statt angenommen
  abgelehnt(B(`${KOPF}4 0 obj\n<< /Length 1 >>\nstream\nx\n5 0 obj\n<< /Length 1 >>\nstream\ny\nendstream\nendobj\n${ENDE}`), NICHT);
  // getrennte Streams bleiben erlaubt, aktive Inhalte davor werden weiterhin als solche gemeldet
  angenommen(B(`${KOPF}4 0 obj\n<< /Length 1 >>\nstream\nx\nendstream\nendobj\n5 0 obj\n<< /Length 1 >>\nstream\ny\nendstream\nendobj\n${ENDE}`));
  abgelehnt(B(`${KOPF}4 0 obj\n<< /Length ${js.length} >>\nstream\n${js}\nendstream\nendobj\n5 0 obj\n<< /Length 1 >>\nstream\nx\n6 0 obj\n<< /Length 1 >>\nstream\ny\nendstream\nendobj\n${ENDE}`), /JavaScript/);
});

// ---------------------------------------------------------------- N-010: indirekte /Length mit vielen Werten

/** Objekt 7 0 n-mal mit verschiedenen Ganzzahlen, ein Stream mit /Length 7 0 R – je Wert eine Lesart */
const vieleLaengen = (n) => {
  const t = [];
  for (let i = 0; i < n; i++) t.push(`7 0 obj ${i} endobj\n`);
  return B(`${KOPF}${t.join('')}8 0 obj\n<< /Length 7 0 R >>\nstream\n${'x'.repeat(n)}\nendstream\nendobj\n${ENDE}`);
};

test('N-010: indirekte /Length mit vielen verschiedenen Werten – nicht prüfbar, linear, ≈ 1 MB < 500 ms', { timeout: 60000 }, () => {
  linear(vieleLaengen, 12500);
  // bis MAX_LAENGEN verschiedene Werte (z. B. inkrementelle Updates) bleiben lesbar
  const werte = Array.from({ length: MAX_LAENGEN }, (_, i) => 5 + i);
  angenommen(B(`${KOPF}${werte.map((w) => `7 0 obj ${w} endobj\n`).join('')}7 0 obj 5 endobj\n8 0 obj\n<< /Length 7 0 R >>\nstream\nhallo\nendstream\nendobj\n${ENDE}`));
  abgelehnt(B(`${KOPF}${[...werte, 99].map((w) => `7 0 obj ${w} endobj\n`).join('')}8 0 obj\n<< /Length 7 0 R >>\nstream\nhallo\nendstream\nendobj\n${ENDE}`), NICHT);
});

// ---------------------------------------------------------------- N-010: Obergrenzen

test('N-010: höchstens MAX_OBJEKTE Objektköpfe', { timeout: 60000 }, () => {
  assert.equal(MAX_OBJEKTE, 500000);
  const pdf = (n) => B(`${KOPF}${'9 0 obj\n'.repeat(n)}${ENDE}`);
  abgelehnt(pdf(MAX_OBJEKTE + 1), NICHT);
});

test('N-010: gemeinsames Byte-Budget – kleines PDF mit großen dekodierten Daten ist nicht prüfbar, übliches bleibt erlaubt', () => {
  // drei Flate-Streams mit je 19 MB Nullen (je Stream unter 20 MB, zusammen unter 100 MB), Datei ≈ 60 KB
  const z = zlib.deflateSync(Buffer.alloc(19 * 1024 * 1024));
  const st = (nr) => Buffer.concat([B(`${nr} 0 obj\n<< /Filter /FlateDecode /Length ${z.length} >>\nstream\n`), z, B('\nendstream\nendobj\n')]);
  const bombe = Buffer.concat([B(KOPF), st(4), st(5), st(6), B(ENDE)]);
  assert.ok(bombe.length < 100 * 1024);
  const t = Date.now();
  abgelehnt(bombe, NICHT);
  assert.ok(Date.now() - t < 1500, `${Date.now() - t} ms`);
  // übliche Inhalts-Streams: ≈ 6 MB Text, gut komprimiert (≈ 1:8), werden geprüft und angenommen
  const zeilen = [];
  for (let i = 0; i < 120000; i++) zeilen.push(`BT /F1 9 Tf ${i % 500} ${(i * 7) % 800} Td (Position ${i}: Aushub ${i % 97} m3) Tj ET`);
  const inhalt = zlib.deflateSync(B(zeilen.join('\n')));
  angenommen(Buffer.concat([B(`${KOPF}4 0 obj\n<< /Filter /FlateDecode /Length ${inhalt.length} >>\nstream\n`), inhalt, B(`\nendstream\nendobj\n${ENDE}`)]));
});

// ---------------------------------------------------------------- N-064: Strings vor der Zielprüfung dekodieren

const mitAktion = (aktion) => B(`%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R /OpenAction ${aktion} >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\n${ENDE}`);
const utf16be = (s) => `FEFF${Buffer.from(s, 'utf16le').swap16().toString('hex').toUpperCase()}`;
const utf16le = (s) => `FFFE${Buffer.from(s, 'utf16le').toString('hex')}`;
const oktal = (buf) => [...buf].map((b) => `\\${b.toString(8).padStart(3, '0')}`).join('');

test('N-064: /URI in UTF-16BE (Hex) – „javascript:“ wird erkannt (Befund <FEFF006A0061…>)', () => {
  abgelehnt(mitAktion(`<< /S /URI /URI <${utf16be('javascript:app.alert(1)')}> >>`), /\/URI javascript:/);
  abgelehnt(mitAktion(`<< /S /URI /URI <${utf16be('javascript:x').toLowerCase()}> >>`), /\/URI javascript:/); // kleine Hex-Ziffern
  abgelehnt(mitAktion(`<< /S /URI /URI <${utf16be('file:///C:/Windows/calc.exe').replace(/(..)/g, '$1 ')}> >>`), /\/URI file:/); // mit Leerraum
});

test('N-064: /URI in allen String-Kodierungen – UTF-16LE, UTF-8 mit BOM, Literal mit Oktal, Escapes, Zeilenfortsetzung', () => {
  const faelle = {
    'UTF-16LE Hex': `<${utf16le('javascript:x')}>`,
    'UTF-8-BOM Hex': `<EFBBBF${Buffer.from('javascript:x').toString('hex')}>`,
    'UTF-16BE Literal (Oktal)': `(${oktal(Buffer.from(utf16be('javascript:x'), 'hex'))})`,
    'UTF-16LE Literal (Oktal)': `(${oktal(Buffer.from(utf16le('javascript:x'), 'hex'))})`,
    'UTF-16BE Literal roh': `(\xfe\xff${'javascript:x'.split('').map((c) => `\\000${c}`).join('')})`,
    'Literal Oktal kurz': '(\\152\\141va\\163cript:x)',
    'Literal Escapes': '(\\j\\a\\v\\a\\s\\cr\\i\\pt\\:x)', // \\x ohne Bedeutung = x (\\r, \\t wären CR bzw. Tab)
    'Literal Zeilenfortsetzung': '(java\\\nscr\\\r\nipt:x)',
    'Literal Klammern': '(javascript:alert\\(1\\))',
    'UTF-16BE mit unsichtbaren Zeichen': `<${utf16be('\u200bjava\u00adscript\ufeff:x')}>`,
    'UTF-16BE Großschreibung': `<${utf16be('JaVaScRiPt:x')}>`,
    'UTF-16BE vbscript': `<${utf16be('vbscript:x')}>`,
    'UTF-16BE UNC': `<${utf16be('\\\\angreifer\\freigabe\\x.exe')}>`
  };
  for (const [name, uri] of Object.entries(faelle)) abgelehnt(mitAktion(`<< /S /URI /URI ${uri} >>`), /\/URI (javascript:|vbscript:|mit Dateipfad)/, name);
  // erlaubte Ziele bleiben erlaubt – auch in UTF-16
  for (const ziel of ['https://www.firma.at/plan?x=1', 'mailto:office@firma.at', 'www.firma.at/a:b', 'tel:+43123']) {
    angenommen(mitAktion(`<< /S /URI /URI <${utf16be(ziel)}> >>`), ziel);
    angenommen(mitAktion(`<< /S /URI /URI <${utf16le(ziel)}> >>`), ziel);
    angenommen(mitAktion(`<< /S /URI /URI (${oktal(Buffer.from(ziel))}) >>`), ziel);
  }
});

test('N-064: Ziele von /Launch, /SubmitForm, URL-Dateiangaben (/F, /UF, /Win …) werden dekodiert geprüft', () => {
  // URL-Dateiangabe ohne verbotenen Aktionsnamen: das Ziel selbst wird geprüft
  abgelehnt(mitAktion(`<< /S /URI /URI (https://firma.at) /Next << /FS /URL /F <${utf16be('javascript:x')}> >> >>`), /\/F javascript:/);
  abgelehnt(mitAktion(`<< /FS /URL /UF (${oktal(Buffer.from(utf16le('file:///etc/passwd'), 'hex'))}) >>`), /\/UF file:/);
  abgelehnt(mitAktion(`<< /Win << /F <${utf16be('C:\\Windows\\System32\\calc.exe')}> >> >>`), /\/F c:/);
  abgelehnt(mitAktion(`<< /Unix (\\\\\\\\server\\\\x) >>`), /\/Unix mit Dateipfad/);
  // Aktionen mit Ziel bleiben abgelehnt (Name), auch wenn das Ziel kodiert ist
  abgelehnt(mitAktion(`<< /S /Launch /F <${utf16be('calc.exe')}> >>`), /Launch/);
  abgelehnt(mitAktion(`<< /S /SubmitForm /F << /FS /URL /F <${utf16be('https://firma.at/x')}> >> >>`), /SubmitForm/);
  // Aktionsart als String (pypdf vergleicht Namen und Strings gleich) – in jeder Kodierung
  const arten = { Launch: /\/Launch/, JavaScript: /\/JavaScript/, JS: /\/JS/, SubmitForm: /\/SubmitForm/ };
  for (const [art, muster] of Object.entries(arten)) {
    for (const s of [`(${art})`, `(/${art})`, `<${utf16be(art)}>`, `<${utf16le(`/${art}`)}>`, `(${oktal(Buffer.from(art))})`, `<${Buffer.from(art).toString('hex')}>`]) {
      abgelehnt(mitAktion(`<< /S ${s} >>`), muster, `${art}: ${s}`);
    }
  }
  abgelehnt(mitAktion(`<< /Subtype <${utf16be('FileAttachment')}> >>`), /FileAttachment/);
  // harmlose Werte bleiben erlaubt
  angenommen(mitAktion('<< /S /URI /URI (https://firma.at) /Next << /Type /Filespec /F (plan.pdf) /UF <FEFF0070006C0061006E002E007000640066> >> >>'));
  angenommen(mitAktion(`<< /S /GoTo /D [2 0 R /Fit] /Next << /S (GoTo) /F <${utf16be('http://firma.at/plan.pdf')}> >> >>`));
});
