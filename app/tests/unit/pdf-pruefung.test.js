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
