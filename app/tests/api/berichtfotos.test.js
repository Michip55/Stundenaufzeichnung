'use strict';
/** Fotos im Bautagesbericht (API.md 12.6) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');
const { testJpeg, testPng, testWebp } = require('./fuhrpark-bilder');
const { pngGrau, demoUnterschrift } = require('../../server/png');
const { wienDatum, plusTage } = require('../../server/datum');

test('Fotos im Bautagesbericht', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const c = {};
  for (const r of ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf']) c[r] = await s.login(U[r]);
  const heute = wienDatum(s.uhr());
  const datum = plusTage(heute, -5);
  s.db.lauf('DELETE FROM bericht WHERE baustelle_id = ? AND datum = ?', BS.pitten, datum);
  const b = (await c.polier.post('/berichte', { baustelleId: BS.pitten, datum })).daten;
  const url = `/berichte/${b.id}/fotos`;
  const b64 = (buf) => buf.toString('base64');
  let fotoId;

  await t.test('Hochladen: Prüfung, Metadaten entfernt, gleiches Bild kein Duplikat', async () => {
    assert.equal((await c.mitarbeiter.post(url, { bildBase64: b64(testPng()), dateiname: 'a.png' })).status, 403);
    assert.equal((await c.polier.post(url, { bildBase64: Buffer.from('<html>').toString('base64'), dateiname: 'x.png' })).status, 400);
    let r = await c.polier.post(url, { bildBase64: `data:image/jpeg;base64,${b64(testJpeg())}`, dateiname: 'Pflaster.jpg', beschreibung: 'Pflaster fertig' });
    assert.equal(r.status, 201);
    fotoId = r.daten.id;
    assert.deepEqual([r.daten.mime, r.daten.beschreibung, r.daten.art, r.daten.erstelltVon.id], ['image/jpeg', 'Pflaster fertig', 'foto', U.polier]);
    r = await c.polier.post(url, { bildBase64: b64(testJpeg()), dateiname: 'nochmal.jpg' });
    assert.equal(r.status, 200);
    assert.equal(r.daten.id, fotoId);
    const bild = await c.bauleiter.anfrage('GET', `${url}/${fotoId}`);
    assert.equal(bild.status, 200);
    assert.equal(bild.headers.get('cache-control'), 'no-store');
    assert.equal(bild.headers.get('x-content-type-options'), 'nosniff');
    assert.match(bild.headers.get('content-disposition'), new RegExp(`bericht-${b.id}-${fotoId}\\.jpg`));
    const roh = Buffer.from(await (await fetch(`${s.basis}/api${url}/${fotoId}`, { headers: { cookie: c.bauleiter.cookie } })).arrayBuffer());
    assert.ok(!roh.includes(Buffer.from('GPSLatitude')) && !roh.includes(Buffer.from('<script>')));
    assert.equal((await c.mitarbeiter.get(`${url}/${fotoId}`)).status, 403);
    const d = (await c.buero.get(`/berichte/${b.id}`)).daten;
    assert.equal(d.fotos.length, 1);
    assert.equal(d.fotos[0].url, `/api${url}/${fotoId}`);
  });

  await t.test('Beschreibung ändern, Grenze 10 Fotos, löschen', async () => {
    assert.equal((await c.polier.put(`${url}/${fotoId}`, { beschreibung: 'Pflaster Abschnitt 1' })).daten.beschreibung, 'Pflaster Abschnitt 1');
    assert.equal((await c.polier.post(url, { bildBase64: b64(testWebp()), dateiname: 'w.webp' })).status, 201);
    for (let i = 0; i < 8; i++) {
      assert.equal((await c.polier.post(url, { bildBase64: b64(pngGrau(4, 4, Array(16).fill(10 + i))), dateiname: `p${i}.png` })).status, 201);
    }
    const r = await c.polier.post(url, { bildBase64: b64(pngGrau(4, 4, Array(16).fill(99))), dateiname: 'zuviel.png' });
    assert.equal(r.status, 400);
    assert.match(r.daten.fehler, /10 Fotos/);
    const liste = (await c.polier.get(`/berichte/${b.id}`)).daten.fotos;
    assert.equal((await c.polier.del(`${url}/${liste[9].id}`)).status, 200);
    assert.equal((await c.polier.get(`/berichte/${b.id}`)).daten.fotos.length, 9);
  });

  await t.test('PDF mit Fotoseiten (?fotos=1), ohne Fotos Standard', async () => {
    const ohne = await c.polier.anfrage('GET', `/berichte/${b.id}/pdf`);
    const mit = await c.polier.anfrage('GET', `/berichte/${b.id}/pdf?fotos=1`);
    assert.equal(mit.status, 200);
    const seiten = (buf) => (buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
    assert.equal(seiten(ohne.daten) + 2, seiten(mit.daten)); // 9 Fotos → 2 Seiten
  });

  await t.test('nach der Unterschrift gesperrt (409), lesen weiter möglich', async () => {
    assert.equal((await c.polier.postV(`/berichte/${b.id}/unterschrift`, { rolle: 'an', name: 'Josef Haidbauer', bildPng: demoUnterschrift('a') })).status, 200);
    assert.equal((await c.polier.post(url, { bildBase64: b64(pngGrau(4, 4, Array(16).fill(77))), dateiname: 'spaet.png' })).status, 409);
    assert.equal((await c.polier.del(`${url}/${fotoId}`)).status, 409);
    assert.equal((await c.buero.get(`${url}/${fotoId}`)).status, 200);
  });
});
