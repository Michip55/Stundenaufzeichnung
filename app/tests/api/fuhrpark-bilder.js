'use strict';
/** Test-Bilder (JPEG/PNG/WebP) mit Metadaten und Polyglot-Anhang für die Foto-Tests */
const zlib = require('node:zlib');
const { pngGrau } = require('../../server/png');

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const seg = (m, data) => Buffer.concat([Buffer.from([0xff, m]), u16(data.length + 2), data]);
const ANHANG = Buffer.from('<html><script>alert(1)</script></html>');

function testJpeg({ exif = true, anhang = true } = {}) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.concat([Buffer.from('JFIF\0', 'latin1'), Buffer.from([1, 1, 0]), u16(72), u16(72), Buffer.from([0, 0])])),
    ...(exif ? [seg(0xe1, Buffer.from('Exif\0\0GPSLatitude=47.61N GPSLongitude=16.01E Kamera Max Mustermann', 'latin1')),
      seg(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>GPS</x:xmpmeta>', 'latin1')), seg(0xfe, Buffer.from('Kommentar mit Namen', 'latin1')), seg(0xed, Buffer.from('Photoshop 3.0\0IPTC', 'latin1'))] : []),
    seg(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)])),
    seg(0xc0, Buffer.concat([Buffer.from([8]), u16(2), u16(3), Buffer.from([1, 1, 0x11, 0])])),
    seg(0xc4, Buffer.concat([Buffer.from([0]), Buffer.from([1, ...Array(15).fill(0)]), Buffer.from([0])])),
    seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
    Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]),
    Buffer.from([0xff, 0xd9]),
    ...(anhang ? [ANHANG] : [])
  ]);
}

function chunk(typ, daten) {
  const len = Buffer.alloc(4); len.writeUInt32BE(daten.length);
  const td = Buffer.concat([Buffer.from(typ, 'latin1'), daten]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
  return Buffer.concat([len, td, crc]);
}
function testPng({ anhang = true } = {}) {
  const p = pngGrau(4, 4, () => 100);
  const ihdrEnde = 8 + 25;
  return Buffer.concat([p.subarray(0, ihdrEnde), chunk('tEXt', Buffer.from('Author\0Max Mustermann', 'latin1')), chunk('eXIf', Buffer.from('MM\0*GPS', 'latin1')),
    chunk('iTXt', Buffer.from('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>', 'latin1')), p.subarray(ihdrEnde), ...(anhang ? [ANHANG] : [])]);
}
function riffChunk(typ, daten) {
  const len = Buffer.alloc(4); len.writeUInt32LE(daten.length);
  return Buffer.concat([Buffer.from(typ, 'latin1'), len, daten, daten.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}
function testWebp({ anhang = true } = {}) {
  const vp8x = Buffer.alloc(10); vp8x[0] = 0x08 | 0x04 | 0x10; // EXIF, XMP, Alpha
  const inhalt = Buffer.concat([Buffer.from('WEBP', 'latin1'), riffChunk('VP8X', vp8x), riffChunk('VP8L', Buffer.from([0x2f, 1, 2, 3, 4])),
    riffChunk('EXIF', Buffer.from('MM\0*GPSLatitude', 'latin1')), riffChunk('XMP ', Buffer.from('<x:xmpmeta>GPS</x:xmpmeta>', 'latin1'))]);
  const kopf = Buffer.alloc(8); kopf.write('RIFF', 0, 'latin1'); kopf.writeUInt32LE(inhalt.length, 4);
  return Buffer.concat([kopf, inhalt, ...(anhang ? [ANHANG] : [])]);
}

module.exports = { testJpeg, testPng, testWebp, riffChunk, chunk, ANHANG };
