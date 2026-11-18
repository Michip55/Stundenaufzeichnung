'use strict';
/** G-08: aktive PDF-Inhalte auch mit Namens-Escapes (#xx), Kommentaren und Leerraum-Varianten erkennen */
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { pdfPruefen, DokumentFehler } = require('../../server/dokument-pruefung');

const pdf = (koerper) => Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R ${koerper} >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`, 'latin1');
const mitStream = (inhalt) => {
  const z = zlib.deflateSync(Buffer.from(inhalt, 'latin1'));
  return Buffer.concat([Buffer.from('%PDF-1.5\n3 0 obj << /Type /ObjStm /Filter /FlateDecode /Length ' + z.length + ' >>\nstream\n', 'latin1'), z, Buffer.from('\nendstream\nendobj\ntrailer << >>\n%%EOF\n', 'latin1')]);
};

test('G-08: Escapes und Varianten aktiver Inhalte werden abgelehnt', () => {
  const boese = [
    '/OpenAction << /S /J#61vaScript /J#53 (app.alert(1)) >>',
    '/OpenAction << /S /JavaScript /JS (x) >>',
    '/OpenAction << /S /L#61unch /F (calc.exe) >>',
    '/OpenAction << /S /#4C#61#75#6E#63#68 /F (calc.exe) >>',
    '/OpenAction << /S /#4a#61#76#61#53#63#72#69#70#74 >>', // klein geschriebene Hex-Ziffern
    '/AA << /O << /#4A#53 (x) >> >>',
    '/Names << /E#6dbeddedFiles << >> /EmbeddedFile 4 0 R >>',
    '/OpenAction << /S /JavaScript%Kommentar\n/JS(x) >>',
    '/OpenAction<</S/JavaScript/JS(x)>>',
    '/Encr#79pt 5 0 R',
    '/RichM#65dia 6 0 R'
  ];
  for (const b of boese) assert.throws(() => pdfPruefen(pdf(b)), DokumentFehler, b);
  // auch in Flate-komprimierten Objekt-Streams
  assert.throws(() => pdfPruefen(mitStream('<< /S /J#61vaScript /JS (x) >>')), DokumentFehler);
  assert.throws(() => pdfPruefen(mitStream('<< /S /L#61unch >>')), DokumentFehler);
});

test('G-08: harmlose PDFs bleiben erlaubt', () => {
  assert.equal(pdfPruefen(pdf('/Lang (de-AT) /Title (Plan #61 Juni)')).mime, 'application/pdf');
  assert.equal(pdfPruefen(pdf('/Info << /Producer (Java Script-Editor 1.0) >>')).mime, 'application/pdf'); // Text, kein Name
  assert.equal(pdfPruefen(mitStream('BT /F1 12 Tf (Hallo) Tj ET')).mime, 'application/pdf');
});

/* ---------- Filter (Nachtrag G-08): ASCIIHex, ASCII85, Ketten, nicht prüfbare Filter ---------- */
const PDFDocument = require('pdfkit');
const { NICHT_PRUEFBAR, ascii85 } = require('../../server/dokument-pruefung');
const { testJpeg } = require('../api/fuhrpark-bilder');

/** Minimales PDF mit beliebigen Stream-Objekten [{dict, daten:Buffer}] */
function pdfMitStreams(streams, kopf = '1.5') {
  const teile = [Buffer.from(`%PDF-${kopf}\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n`, 'latin1')];
  streams.forEach((st, i) => {
    teile.push(Buffer.from(`${i + 3} 0 obj\n<< ${st.dict} /Length ${st.daten.length} >>\nstream\n`, 'latin1'), st.daten, Buffer.from('\nendstream\nendobj\n', 'latin1'));
  });
  teile.push(Buffer.from('trailer\n<< /Root 1 0 R >>\nstartxref\n0\n%%EOF\n', 'latin1'));
  return Buffer.concat(teile);
}
const hex = (t) => Buffer.from(Buffer.from(t, 'latin1').toString('hex').replace(/(.{40})/g, '$1\n') + '>', 'latin1');
function a85(buf) { // Encoder für die Tests
  let out = '';
  for (let i = 0; i < buf.length; i += 4) {
    const g = buf.subarray(i, i + 4); const n = g.length;
    const p = Buffer.concat([g, Buffer.alloc(4 - n)]);
    let v = p.readUInt32BE(0);
    if (v === 0 && n === 4) { out += 'z'; continue; }
    const z = []; for (let k = 0; k < 5; k++) { z.unshift(String.fromCharCode((v % 85) + 33)); v = Math.floor(v / 85); }
    out += z.join('').slice(0, n + 1);
  }
  return Buffer.from(`${out}~>`, 'latin1');
}
const BOESE = '<< /Type /Action /S /JavaScript /JS (app.alert(1)) >>';
const HARMLOS = 'BT /F1 12 Tf 72 712 Td (Bautagesbericht Pitten) Tj ET';
const pdfkit = (f) => new Promise((ok) => { const d = new PDFDocument({ size: 'A4' }); const t = []; d.on('data', (c) => t.push(c)); d.on('end', () => ok(Buffer.concat(t))); f(d); d.end(); });

test('G-08 Filter: ASCII85-Dekoder (Rundreise)', () => {
  for (const t of ['', 'a', 'ab', 'abc', 'abcd', 'Hallo Welt!', '\0\0\0\0x', BOESE]) assert.equal(ascii85(a85(Buffer.from(t, 'latin1'))).toString('latin1'), t);
  assert.equal(ascii85(Buffer.from('<~87cURD]i,"Ebo80~>', 'latin1')).toString(), 'Hello World!'); // bekannter Testvektor
});

test('G-08 Filter: aktive Inhalte in ASCIIHex, ASCII85 und Ketten werden gefunden', () => {
  const ab = (dict, daten) => assert.throws(() => pdfPruefen(pdfMitStreams([{ dict, daten }])), (e) => e instanceof DokumentFehler && /aktive Inhalte/.test(e.message), dict);
  ab('/Filter /ASCIIHexDecode', hex(BOESE));
  ab('/Filter /AHx', hex(BOESE));
  ab('/Filter /ASCII85Decode', a85(Buffer.from(BOESE, 'latin1')));
  ab('/Filter [/ASCII85Decode /FlateDecode]', a85(zlib.deflateSync(Buffer.from('<< /S /Launch /F (calc.exe) >>'))));
  ab('/Filter [ /ASCIIHexDecode /FlateDecode ]', hex(zlib.deflateSync(Buffer.from('<< /S /J#61vaScript /JS (x) >>')).toString('latin1')));
  ab('/F#69lter /A#53CIIHexDecode', hex(BOESE)); // Escapes im Filternamen
  ab('/Filter /FlateDecode', zlib.deflateRawSync(Buffer.from(BOESE))); // ohne zlib-Kopf
  // harmlos → angenommen
  for (const [dict, daten] of [['/Filter /ASCIIHexDecode', hex(HARMLOS)], ['/Filter /ASCII85Decode', a85(Buffer.from(HARMLOS))], ['/Filter [/ASCII85Decode /FlateDecode]', a85(zlib.deflateSync(Buffer.from(HARMLOS)))]]) {
    assert.equal(pdfPruefen(pdfMitStreams([{ dict, daten }])).mime, 'application/pdf', dict);
  }
});

test('G-08 Filter: LZW, RunLength und unbekannte Filter außerhalb von Bildern → nicht prüfbar; Bildfilter erlaubt', () => {
  const nicht = (dict) => assert.throws(() => pdfPruefen(pdfMitStreams([{ dict, daten: Buffer.from([0x80, 0x0b, 0x60, 0x50, 0x22, 0x0c]) }])), (e) => e instanceof DokumentFehler && e.message === NICHT_PRUEFBAR, dict);
  nicht('/Filter /LZWDecode');
  nicht('/Filter /RunLengthDecode');
  nicht('/Filter /RL');
  nicht('/Filter /Crypt');
  nicht('/Filter /GibtsNichtDecode');
  nicht('/Filter [/LZWDecode]'); // Liste mit LZW
  nicht('/Filter 9 0 R');
  assert.equal(NICHT_PRUEFBAR, 'PDF enthält nicht prüfbare Inhalte – bitte als PDF/A oder neu drucken.');
  // kaputter Flate-Stream ist ebenfalls nicht prüfbar
  assert.throws(() => pdfPruefen(pdfMitStreams([{ dict: '/Filter /FlateDecode', daten: Buffer.from('kein zlib '.repeat(5)) }])), (e) => e.message === NICHT_PRUEFBAR);
  // Bilder: Bildfilter und LZW/RunLength bei Bild-XObjects sind in Ordnung
  for (const dict of ['/Type /XObject /Subtype /Image /Width 1 /Height 1 /Filter /DCTDecode', '/Subtype /Image /Filter /JPXDecode', '/Subtype /Image /Filter /CCITTFaxDecode', '/Subtype /Image /Filter /JBIG2Decode',
    '/Subtype /Image /Filter [/DCTDecode]', '/Type /XObject /Subtype /Image /Filter /LZWDecode', '/Subtype /Image /Filter /RunLengthDecode', '/Filter /DCTDecode']) {
    assert.equal(pdfPruefen(pdfMitStreams([{ dict, daten: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) }])).mime, 'application/pdf', dict);
  }
});

test('G-08 Filter: übliche PDFs bleiben erlaubt (pdfkit, Scanner mit JPEG, Excel-Export mit Flate)', async () => {
  // 1. pdfkit (Flate-komprimierte Inhalte, Schriften)
  const a = await pdfkit((d) => { d.fontSize(14).text('Bautagesbericht WHA Pitten – 13.11.2026'); d.addPage().text('Seite 2'); });
  assert.equal(pdfPruefen(a).mime, 'application/pdf');
  // 2. Scanner: Seiten als JPEG-Bilder (DCTDecode) plus Flate-Inhalt
  const b = await pdfkit((d) => { d.image(testJpeg(), 0, 0, { width: 595 }); d.addPage(); d.image(testJpeg(), 0, 0, { width: 595 }); });
  assert.match(b.toString('latin1'), /\/DCTDecode/);
  assert.equal(pdfPruefen(b).mime, 'application/pdf');
  // 3. Excel „Als PDF speichern“: Inhalt [/FlateDecode], Objekt-Stream und XRef-Stream mit Prädiktor
  const objStm = zlib.deflateSync(Buffer.from('5 0 6 30 << /Type /Font /Subtype /TrueType >> << /Type /ExtGState /CA 1 >>', 'latin1'));
  const xref = zlib.deflateSync(Buffer.from([2, 1, 0, 0, 15, 0, 2, 0, 0, 0, 0, 1]));
  const c = pdfMitStreams([
    { dict: '/Filter [/FlateDecode]', daten: zlib.deflateSync(Buffer.from(`${HARMLOS}\n0.5 w 72 700 m 500 700 l S`)) },
    { dict: '/Type /ObjStm /N 2 /First 8 /Filter /FlateDecode', daten: objStm },
    { dict: '/Type /XRef /Size 9 /W [1 2 1] /Filter /FlateDecode /DecodeParms << /Columns 4 /Predictor 12 >>', daten: xref },
    { dict: '/Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode', daten: testJpeg() }
  ], '1.7');
  assert.equal(pdfPruefen(c).mime, 'application/pdf');
});
