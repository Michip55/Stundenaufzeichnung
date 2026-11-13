'use strict';
/** Fotos zu Schadensmeldungen: Magic Bytes, Strukturprüfung, Entfernen der Metadaten, Polyglot-Anhänge */
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../../server/fuhrpark-bild');
const { pngGrau } = require('../../server/png');

const { testJpeg, testPng, testWebp, riffChunk } = require('../api/fuhrpark-bilder');

const enthaelt = (buf, s) => buf.includes(Buffer.from(s, 'latin1'));

test('JPEG: EXIF/XMP/GPS, Kommentar, IPTC und Anhang nach EOI werden entfernt; JFIF bleibt', () => {
  const r = B.bildPruefen(testJpeg().toString('base64'));
  assert.equal(r.mime, 'image/jpeg');
  for (const s of ['Exif', 'GPS', 'xmpmeta', 'Kommentar', 'Photoshop', '<script', '<html']) assert.ok(!enthaelt(r.daten, s), s);
  assert.ok(enthaelt(r.daten, 'JFIF'));
  assert.equal(r.daten.readUInt16BE(r.daten.length - 2), 0xffd9);
  assert.ok(enthaelt(r.daten, '\x12\xff\x00\x34\xff\xd0\x56')); // Bilddaten unverändert
  // erneut bereinigen ist idempotent
  assert.ok(B.jpegBereinigen(r.daten).equals(r.daten));
  assert.match(r.sha256, /^[0-9a-f]{64}$/);
});

test('PNG: tEXt/eXIf/iTXt und Anhang nach IEND werden entfernt, Bild bleibt gültig', () => {
  const r = B.bildPruefen('data:image/png;base64,' + testPng().toString('base64'));
  assert.equal(r.mime, 'image/png');
  for (const s of ['tEXt', 'eXIf', 'iTXt', 'Mustermann', 'GPS', '<script']) assert.ok(!enthaelt(r.daten, s), s);
  assert.ok(r.daten.equals(pngGrau(4, 4, () => 100)));
  // Prüfsumme falsch → abgelehnt
  const kaputt = Buffer.from(pngGrau(4, 4, () => 100)); kaputt[kaputt.length - 20] ^= 0xff;
  assert.throws(() => B.bildPruefen(kaputt.toString('base64')), /beschädigt/);
});

test('WebP: EXIF- und XMP-Chunks entfernt, VP8X-Kennzeichen gelöscht, RIFF-Länge neu', () => {
  const r = B.bildPruefen(testWebp().toString('base64'));
  assert.equal(r.mime, 'image/webp');
  for (const s of ['EXIF', 'XMP ', 'GPS', '<script']) assert.ok(!enthaelt(r.daten, s), s);
  assert.equal(r.daten.readUInt32LE(4), r.daten.length - 8);
  const vp8x = r.daten.indexOf(Buffer.from('VP8X'));
  assert.equal(r.daten[vp8x + 8] & 0x0c, 0);
  assert.equal(r.daten[vp8x + 8] & 0x10, 0x10); // Alpha bleibt
});

test('Abgelehnt: falsche Magic Bytes, getarnte Dateien, Polyglot ohne Bildstruktur, zu groß, kein Base64', () => {
  const ab = (buf, re) => assert.throws(() => B.bildPruefen(Buffer.isBuffer(buf) ? buf.toString('base64') : buf), re);
  ab(Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1'), /Nur Fotos im Format JPEG, PNG oder WebP/);
  ab(Buffer.from('<html><body>kein Bild</body></html>'), /Nur Fotos/);
  ab(Buffer.from('%PDF-1.7\n'), /Nur Fotos/);
  ab(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('<html><script>alert(1)</script>')]), /JPEG-Datei/); // Polyglot: Magic + HTML
  ab(testJpeg({ anhang: false }).subarray(0, 120), /JPEG-Datei/); // abgeschnitten
  ab(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('<?php echo 1; ?>')]), /PNG-Datei/);
  ab(Buffer.concat([Buffer.from('RIFF\x10\x00\x00\x00WEBP', 'latin1'), riffChunk('EXIF', Buffer.from('xx'))]), /WebP/);
  ab(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(B.MAX_BYTES)]), /zu groß/);
  ab('##keinbase64##', /Base64/);
  ab('', /fehlt/);
});

test('Dateinamen ohne Pfad und Steuerzeichen; Speicherpfad nur Zufallsnamen', () => {
  assert.equal(B.sichererName('../../etc/passwd', 'image/png'), 'passwd');
  assert.equal(B.sichererName('C:\\Users\\x\\IMG_0001.JPG', 'image/jpeg'), 'IMG_0001.JPG');
  assert.equal(B.sichererName('..', 'image/png'), 'foto.png');
  assert.equal(B.sichererName('a"<b>\u0000.jpg', 'image/jpeg'), 'ab.jpg');
  assert.throws(() => B.dateiPfad('/tmp/x', '../../etc/passwd'), /Ungültiger Dateiname/);
  assert.throws(() => B.dateiPfad('/tmp/x', 'abc.jpg'), /Ungültiger Dateiname/);
  assert.equal(B.dateiPfad('/tmp/x', 'a'.repeat(32) + '.jpg'), '/tmp/x/' + 'a'.repeat(32) + '.jpg');
});

