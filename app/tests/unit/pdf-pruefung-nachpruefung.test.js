'use strict';
/**
 * Korrekturen Nachprüfung – PDF-Prüfung (API.md 12.16, 14.4): N-010 (Laufzeit), N-025 (Umgehungen), N-026 (ASCII85-„z“),
 * N-029 (eingebettete Dateien), N-064 (weitere aktive Aktionen). Die PDFs in pdf-faelle/ stammen aus der Nachprüfung;
 * Poppler bzw. pypdf führen dort das JavaScript aus bzw. listen den Anhang.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { pdfPruefen, dokumentPruefen, DokumentFehler, NICHT_PRUEFBAR, MAX_STREAMS, ascii85 } = require('../../server/dokument-pruefung');

const FAELLE = path.join(__dirname, 'pdf-faelle');
const datei = (n) => fs.readFileSync(path.join(FAELLE, `${n}.pdf`));
const abgelehnt = (buf, muster, info) => assert.throws(() => pdfPruefen(buf), (e) => e instanceof DokumentFehler && muster.test(e.message), info);
const AKTIV = /aktive Inhalte/;
const AKTIV_ODER_NICHT = /aktive Inhalte|nicht prüfbare/;

/** PDF aus Objekten {nr, roh, kopf?} mit klassischer xref */
function bauen(objekte) {
  const teile = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  for (const o of objekte) teile.push(Buffer.from(o.kopf || `${o.nr} 0 obj\n`, 'latin1'), Buffer.isBuffer(o.roh) ? o.roh : Buffer.from(o.roh, 'latin1'), Buffer.from('\nendobj\n', 'latin1'));
  teile.push(Buffer.from('trailer\n<< /Root 1 0 R >>\nstartxref\n0\n%%EOF\n', 'latin1'));
  return Buffer.concat(teile);
}
function stream(dict, daten, wort = 'stream\n') {
  const d = Buffer.isBuffer(daten) ? daten : Buffer.from(daten, 'latin1');
  return Buffer.concat([Buffer.from(`<< ${dict} /Length ${d.length} >>\n${wort}`, 'latin1'), d, Buffer.from('\nendstream', 'latin1')]);
}
const KATALOG = { nr: 1, roh: '<< /Type /Catalog /Pages 2 0 R /OpenAction 5 0 R >>' };
const SEITEN = { nr: 2, roh: '<< /Type /Pages /Kids [] /Count 0 >>' };
const JS = '<< /S /JavaScript /JS (app.alert\\(1\\)) >>';
/** Objekt-Stream mit der JS-Aktion als Objekt 5 */
function objStm(dictZusatz, daten = (b) => zlib.deflateSync(b), wort) {
  const kopf = '5 0\n';
  return bauen([KATALOG, SEITEN, { nr: 4, roh: stream(`/Type /ObjStm /N 1 /First ${kopf.length} ${dictZusatz}`, daten(Buffer.from(kopf + JS, 'latin1')), wort) }]);
}

test('N-025: Umgehungen aus der Nachprüfung werden abgelehnt (Gegenprobe P_kontrolle)', () => {
  abgelehnt(datei('P_kontrolle'), AKTIV, 'P_kontrolle');
  for (const n of ['Q_dp_vor', 'Q_dp_vor_leer', 'Q_nested_dct_dp', 'Q_nested_dct_nach', 'Q_nested_foo', 'P_nested_dct', 'B_nested_dct', 'B2_nested_leer',
    'R_D_endstream', 'D_endstream_im_stream', 'R_G_obj_cr', 'G_obj_cr', 'C_stream_space', 'C2_stream_cr', 'P_stream_space', 'A2_objstm_flate']) {
    abgelehnt(datei(n), AKTIV, n); // JavaScript gefunden
  }
  for (const n of ['F_doppelter_filter', 'B3_nested_image_lzw']) abgelehnt(datei(n), /nicht prüfbare/, n); // doppelter Schlüssel bzw. LZW im Objekt-Stream
});

test('N-025: Filter nur aus der obersten Ebene, Objektköpfe in allen Schreibweisen, „stream“ mit Leerraum', () => {
  abgelehnt(objStm('/DecodeParms << /Filter /DCTDecode /Subtype /Image >> /Filter /FlateDecode'), AKTIV);
  abgelehnt(objStm('/Bypass << /Filter [] >> /Filter /FlateDecode'), AKTIV);
  abgelehnt(objStm('/Filter /FlateDecode', undefined, 'stream \r\n'), AKTIV);
  abgelehnt(objStm('/Filter /FlateDecode', undefined, 'stream\r'), AKTIV);
  abgelehnt(objStm('/Filter /FlateDecode', undefined, 'stream%x\n'), AKTIV_ODER_NICHT);
  const s = '5 0\n' + JS;
  for (const kopf of ['4 0\robj\r', '4 0obj ', '4\n0\nobj', '4 0 % Kommentar\nobj\n']) {
    const pdf = bauen([KATALOG, SEITEN, { nr: 7, roh: '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /Filter /DCTDecode /Length 0 >>' },
      { nr: 4, kopf, roh: stream(`/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode`, zlib.deflateSync(Buffer.from(s, 'latin1'))) }]);
    abgelehnt(pdf, kopf.includes('%') ? /nicht prüfbare/ : AKTIV, JSON.stringify(kopf)); // Kommentar im Kopf: Stream ohne erkannten Kopf → nicht prüfbar
  }
  // Objekt-Stream mit Bildfilter oder /Subtype /Image wird trotzdem gelesen – sonst nicht prüfbar
  abgelehnt(objStm('/Subtype /Image /Filter /FlateDecode'), AKTIV);
  abgelehnt(objStm('/Filter /CCITTFaxDecode', (b) => b), /nicht prüfbare/);
  // doppelte Schlüssel, externe Stream-Daten
  abgelehnt(objStm('/Filter [] /Filter /FlateDecode'), /nicht prüfbare/);
  abgelehnt(objStm('/F (daten.bin) /Filter /FlateDecode'), /nicht prüfbare/);
});

test('N-025: Stream-Grenzen über /Length – „endstream“ in den Daten, falsche /Length, indirekte /Length', () => {
  // „endstream“ in einem gespeicherten Deflate-Block, JS dahinter
  const vor = Buffer.from('5 0\n(xx endstream xx) ', 'latin1');
  const z = Buffer.concat([Buffer.from([0x78, 0x01, 0x00, vor.length & 255, vor.length >> 8, ~vor.length & 255, (~vor.length >> 8) & 255]), vor, zlib.deflateRawSync(Buffer.from(JS, 'latin1'))]);
  abgelehnt(bauen([KATALOG, SEITEN, { nr: 4, roh: stream('/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode', z) }]), AKTIV);
  // /Length zeigt hinter das erste „endstream“ (Leser mit /Length sehen mehr)
  const roh = Buffer.concat([Buffer.from('<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length 6 0 R >>\nstream\n', 'latin1'), z, Buffer.from('\nendstream', 'latin1')]);
  abgelehnt(bauen([KATALOG, SEITEN, { nr: 6, roh: String(z.length) }, { nr: 4, roh }]), AKTIV);
  // falsche /Length: Lesart bis zum ersten „endstream“ wird geprüft
  const z2 = zlib.deflateSync(Buffer.from('5 0\n' + JS, 'latin1'));
  const roh2 = Buffer.concat([Buffer.from('<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length 3 >>\nstream\n', 'latin1'), z2, Buffer.from('\nendstream', 'latin1')]);
  abgelehnt(bauen([KATALOG, SEITEN, { nr: 4, roh: roh2 }]), AKTIV);
  // Prüfsumme falsch (manche Leser ignorieren sie) bzw. kaputter Rest nach dem JS
  const z3 = Buffer.from(z2); z3[z3.length - 1] ^= 0xff;
  abgelehnt(bauen([KATALOG, SEITEN, { nr: 4, roh: stream('/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode', z3) }]), AKTIV);
});

test('N-025: PNG-Prädiktor wird rückgängig gemacht (sonst wären Namen zerstückelt)', () => {
  const daten = Buffer.from('5 0\n' + JS, 'latin1');
  const spalten = 4;
  const zeilen = [];
  for (let i = 0; i < daten.length; i += spalten) { const z = Buffer.alloc(spalten); daten.copy(z, 0, i, i + spalten); zeilen.push(Buffer.from([0]), z); }
  const roh = Buffer.concat(zeilen);
  assert.ok(!/JavaScript/.test(roh.toString('latin1')));
  abgelehnt(objStm(`/Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns ${spalten} >>`, () => zlib.deflateSync(roh)), AKTIV);
  abgelehnt(objStm('/Filter /FlateDecode /DecodeParms 9 0 R'), /nicht prüfbare/);
});

test('N-025: Grenzen führen zu „nicht prüfbar“ statt zur Annahme (100 MB dekodiert, Stream-Anzahl)', () => {
  const bombe = zlib.deflateSync(Buffer.alloc(20 * 1024 * 1024 - 1000));
  const objekte = [{ nr: 1, roh: '<< /Type /Catalog /Pages 2 0 R >>' }, SEITEN];
  for (let i = 0; i < 6; i++) objekte.push({ nr: 10 + i, roh: stream('/Filter /FlateDecode', bombe) });
  objekte.push({ nr: 4, roh: stream('/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode', zlib.deflateSync(Buffer.from('5 0\n' + JS, 'latin1'))) });
  abgelehnt(bauen(objekte), /nicht prüfbare/);
  // zu viele Streams
  const viele = [];
  for (let i = 0; i <= MAX_STREAMS; i++) viele.push(`${i + 3} 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n`);
  abgelehnt(Buffer.from(`%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n${viele.join('')}trailer << /Root 1 0 R >>\n%%EOF\n`, 'latin1'), /nicht prüfbare/);
});

test('N-025: jedes „stream“ muss zu einem gelesenen Objekt gehören; Objekte in Bilddaten werden mitgeprüft', () => {
  // Stream ohne erkennbaren Objektkopf
  abgelehnt(Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\nx<< /Filter /FlateDecode /Length 3 >>\nstream\nabc\nendstream\ntrailer << >>\n%%EOF\n', 'latin1'), /nicht prüfbare/);
  // per xref erreichbares Objekt mitten in JPEG-Daten
  const versteckt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]), Buffer.from(`\n5 0 obj\n${JS}\nendobj\n`, 'latin1'), Buffer.from([0xff, 0xd9])]);
  abgelehnt(bauen([KATALOG, SEITEN, { nr: 7, roh: stream('/Type /XObject /Subtype /Image /Width 1 /Height 1 /Filter /DCTDecode', versteckt) }]), AKTIV);
  // zufällige Bytefolgen wie „/JS“ in Bilddaten ohne Objektkopf sind nur Pixel – bleiben erlaubt
  const pixel = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('/JS)/EF]/XFA>', 'latin1'), Buffer.from([0xff, 0xd9])]);
  assert.equal(pdfPruefen(bauen([{ nr: 1, roh: '<< /Type /Catalog /Pages 2 0 R >>' }, SEITEN, { nr: 7, roh: stream('/Type /XObject /Subtype /Image /Width 1 /Height 1 /Filter /DCTDecode', pixel) }])).mime, 'application/pdf');
});

test('N-010: Laufzeit linear – viele (auch leere) Streams', () => {
  const zeit = (buf) => { const t = Date.now(); try { pdfPruefen(buf); } catch (e) { assert.ok(e instanceof DokumentFehler, e.message); } return Date.now() - t; };
  // Befund: ein Dictionary, 8000 leere Streams (136 KB) – vorher 6,4 s und angenommen
  const leer = Buffer.from(`%PDF-1.7\n1 0 obj\n<< >>\n${'stream\nendstream\n'.repeat(8000)}%%EOF`, 'latin1');
  abgelehnt(leer, /nicht prüfbare/);
  assert.ok(zeit(leer) < 1500, 'leere Streams');
  // 40 000 gültige leere Stream-Objekte (≈ 2 MB) – angenommen, schnell
  const teile = [];
  for (let i = 0; i < 40000; i++) teile.push(`${i + 3} 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n`);
  const gueltig = Buffer.from(`%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n${teile.join('')}trailer << /Root 1 0 R >>\n%%EOF\n`, 'latin1');
  const t = Date.now();
  assert.equal(pdfPruefen(gueltig).mime, 'application/pdf');
  assert.ok(Date.now() - t < 4000, `40 000 Streams: ${Date.now() - t} ms`);
  // lange Zeile mit Ziffern und „%“ (z. B. ASCII85-Bilddaten) – kein Rückverfolgen bis zum Zeilenende
  const a85 = Buffer.from(`%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n2 0 obj\n<< /Subtype /Image /Filter [/ASCII85Decode /DCTDecode] /Length 1200000 >>\nstream\n${'1 %'.repeat(400000)}\nendstream\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`, 'latin1');
  assert.ok(zeit(a85) < 1500, 'ASCII85-Zeile');
});

test('N-026: ASCII85 „z“ ist begrenzt – kleines PDF erzeugt keine Gigabytes', () => {
  assert.throws(() => ascii85(Buffer.from('z'.repeat(6 * 1024 * 1024), 'latin1')), /zu groß/);
  const daten = zlib.deflateSync(Buffer.from('z'.repeat(20 * 1024 * 1024), 'latin1'));
  const pdf = bauen([{ nr: 1, roh: '<< /Type /Catalog /Pages 2 0 R >>' }, SEITEN, { nr: 4, roh: stream('/Filter [/FlateDecode /ASCII85Decode]', daten) }, { nr: 8, roh: stream('/Filter [/FlateDecode /ASCII85Decode]', daten) }]);
  assert.ok(pdf.length < 60 * 1024);
  const vorher = process.memoryUsage().rss;
  const t = Date.now();
  abgelehnt(pdf, /nicht prüfbare/);
  assert.ok(Date.now() - t < 2500, `${Date.now() - t} ms`);
  assert.ok(process.memoryUsage().rss - vorher < 600 * 1024 * 1024, 'Speicher');
});

test('N-029: eingebettete Dateien auch ohne /Type /EmbeddedFile (/EmbeddedFiles, /EF, Datei-Anhang)', () => {
  abgelehnt(datei('S_anhang_ohne_type'), AKTIV);
  abgelehnt(datei('S_anhang_mit_type'), AKTIV);
  const pdf = (k) => bauen([{ nr: 1, roh: `<< /Type /Catalog /Pages 2 0 R ${k} >>` }, SEITEN]);
  abgelehnt(pdf('/Names << /EmbeddedFiles << /Names [(a.exe) 6 0 R] >> >>'), /EmbeddedFile/);
  abgelehnt(pdf('/X << /Type /Filespec /F (a.exe) /EF << /F 7 0 R >> >>'), /\/EF/);
  abgelehnt(pdf('/X << /Type /Filespec /F (a.exe) /E#46 << /F 7 0 R >> >>'), /\/EF/);
  abgelehnt(pdf('/Annots [<< /Subtype /FileAttachment /FS 6 0 R >>]'), /FileAttachment/);
  abgelehnt(pdf('/X /RichMediaExecute'), /RichMedia/);
});

test('N-064: XFA, SubmitForm, ImportData, GoToR/GoToE, /URI mit javascript:/file:/UNC werden abgelehnt', () => {
  abgelehnt(datei('H3_xfa'), /XFA/);
  abgelehnt(datei('H_uri_js'), /URI javascript:/);
  abgelehnt(datei('H4_gotor'), /GoToR/);
  abgelehnt(datei('H5_submitform'), /SubmitForm/);
  abgelehnt(datei('H2_aa'), AKTIV);
  const pdf = (aktion) => bauen([{ nr: 1, roh: `<< /Type /Catalog /Pages 2 0 R /OpenAction ${aktion} >>` }, SEITEN]);
  abgelehnt(pdf('<< /S /ImportData /F (x.fdf) >>'), /ImportData/);
  abgelehnt(pdf('<< /S /GoToE /T << /R /C /N (a) >> >>'), /GoToE/);
  for (const uri of ['(javascript:alert\\(1\\))', '(JavaScript:alert\\(1\\))', '(\\152avascript:alert\\(1\\))', '(java\tscript:x)', '<6a6176617363726970743a78>', '( javascript:x)',
    '(file:///C:/Windows/calc.exe)', '(\\\\\\\\angreifer\\\\freigabe\\\\x)', '(vbscript:x)', '(data:text/html,x)', '9 0 R']) {
    abgelehnt(pdf(`<< /S /URI /URI ${uri} >>`), /URI/, uri);
  }
  abgelehnt(pdf('<< /S /UR#49 /UR#49 (javascript:x) >>'), /URI/);
  // erlaubte Links
  for (const uri of ['(https://www.firma.at/plan?x=1)', '(http://firma.at)', '(mailto:office@firma.at)', '(tel:+43123)', '(www.firma.at)', '(https://firma.at/a%20b)']) {
    assert.equal(pdfPruefen(pdf(`<< /S /URI /URI ${uri} >>`)).mime, 'application/pdf', uri);
    assert.equal(pdfPruefen(pdf(`<< /URI ${uri} /S /URI >>`)).mime, 'application/pdf', uri);
  }
  assert.equal(pdfPruefen(bauen([{ nr: 1, roh: '<< /Type /Catalog /Pages 2 0 R /URI << /Base (https://firma.at/) >> >>' }, SEITEN])).mime, 'application/pdf');
});

test('PDF-Prüfung über dokumentPruefen (Base64) – Umgehung abgelehnt, übliches PDF erlaubt', () => {
  assert.throws(() => dokumentPruefen(datei('Q_dp_vor').toString('base64')), (e) => e instanceof DokumentFehler && AKTIV.test(e.message));
  assert.equal(NICHT_PRUEFBAR, 'PDF enthält nicht prüfbare Inhalte – bitte als PDF/A oder neu drucken.');
});
