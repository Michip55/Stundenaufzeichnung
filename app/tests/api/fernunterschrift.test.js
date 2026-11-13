'use strict';
/** Fernunterschrift per Link (API.md 12.9) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS, euroFelder } = require('./hilfe');
const { demoUnterschrift } = require('../../server/png');
const { wienDatum, plusTage } = require('../../server/datum');

test('Fernunterschrift', async (t) => {
  const s = await starte({ test: true, url: 'https://bautag.example.at' });
  t.after(() => s.stop());
  const pol = await s.login(U.polier);
  const buero = await s.login(U.buero);
  const ma = await s.login(U.mitarbeiter);
  const anon = s.client();
  const datum = plusTage(wienDatum(s.uhr()), -6);
  s.db.lauf('DELETE FROM bericht WHERE baustelle_id = ? AND datum = ?', BS.pitten, datum);
  const b = (await pol.post('/berichte', { baustelleId: BS.pitten, datum })).daten;
  let token, link;

  await t.test('Link erstellen: Rechte, URL, nur Hash gespeichert', async () => {
    assert.equal((await ma.post(`/berichte/${b.id}/unterschrift-link`, { rolle: 'bh' })).status, 403);
    const r = await pol.post(`/berichte/${b.id}/unterschrift-link`, { rolle: 'bh', name: 'DI Bauherr' });
    assert.equal(r.status, 201);
    link = r.daten;
    assert.match(link.url, /^https:\/\/bautag\.example\.at\/unterschrift\/[A-Za-z0-9_-]{43}$/);
    token = link.url.split('/').pop();
    assert.ok(!JSON.stringify(s.db.alle('SELECT * FROM unterschrift_link')).includes(token));
    assert.equal(new Date(link.ablauf) - s.uhr(), 72 * 3600e3);
  });

  await t.test('Öffentliche Seite: AG-Fassung ohne €, PDF; unbekannt 404', async () => {
    const r = await anon.get(`/fern/${token}`);
    assert.equal(r.status, 200);
    assert.equal(r.daten.rolle, 'bh');
    assert.equal(r.daten.nameVorschlag, 'DI Bauherr');
    assert.deepEqual(euroFelder(r.daten), []);
    assert.ok(!('kostenTag' in r.daten.bericht));
    assert.equal((await anon.anfrage('GET', `/fern/${token}/pdf`)).status, 200);
    assert.equal((await anon.get(`/fern/${'x'.repeat(43)}`)).status, 404);
  });

  await t.test('Änderung am Bericht macht den Link ungültig (410); neuer Link', async () => {
    assert.equal((await pol.putV(`/berichte/${b.id}`, { arbeitsleistung: 'Pflaster verlegt' })).status, 200);
    const r = await anon.get(`/fern/${token}`);
    assert.equal(r.status, 410);
    assert.equal(r.daten.code, 'LINK_UNGUELTIG');
    const l = (await pol.get(`/berichte/${b.id}/unterschrift-links`)).daten;
    assert.equal(l[0].status, 'ungueltig');
    const n = await pol.post(`/berichte/${b.id}/unterschrift-link`, { rolle: 'bh', email: 'bauherr@ag.example' });
    assert.equal(n.status, 201);
    token = n.daten.url.split('/').pop();
    await new Promise((x) => setTimeout(x, 50));
    assert.ok(s.app.bt.testAusgang.mails.some((m) => m.an === 'bauherr@ag.example' && m.text.includes(n.daten.url)));
  });

  await t.test('Unterschreiben über den Link: einmalig, Bericht wird unterschrieben', async () => {
    assert.equal((await anon.post(`/fern/${token}`, { name: 'DI Bauherr', bildPng: demoUnterschrift('fern') })).status, 400); // ohne Bestätigung
    assert.equal((await pol.postV(`/berichte/${b.id}/unterschrift`, { rolle: 'an', name: 'Josef Haidbauer', bildPng: demoUnterschrift('an') })).status, 200);
    const r = await anon.post(`/fern/${token}`, { name: 'DI Bauherr', bildPng: demoUnterschrift('fern'), bestaetigt: true });
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    assert.equal(r.daten.status, 'unterschrieben');
    const d = (await buero.get(`/berichte/${b.id}`)).daten;
    assert.equal(d.unterschriften.bh.name, 'DI Bauherr');
    assert.equal((await anon.post(`/fern/${token}`, { name: 'Nochmal', bildPng: demoUnterschrift('x'), bestaetigt: true })).status, 410);
    assert.equal((await pol.get(`/berichte/${b.id}/unterschrift-links`)).daten[0].status, 'verwendet');
    assert.ok(s.db.eins("SELECT 1 AS x FROM protokoll WHERE text LIKE 'Fernunterschrift (Bauherr) von DI Bauherr%'"));
  });

  await t.test('Ablauf nach 72 Std.; Widerruf', async () => {
    const datum2 = plusTage(datum, -1);
    s.db.lauf('DELETE FROM bericht WHERE baustelle_id = ? AND datum = ?', BS.pitten, datum2);
    const b2 = (await pol.post('/berichte', { baustelleId: BS.pitten, datum: datum2 })).daten;
    const l = (await pol.post(`/berichte/${b2.id}/unterschrift-link`, { rolle: 'bh' })).daten;
    const tk = l.url.split('/').pop();
    s.uhr.plus(73 * 60);
    assert.equal((await anon.get(`/fern/${tk}`)).status, 410);
    s.uhr.plus(-73 * 60);
    const l2 = (await pol.post(`/berichte/${b2.id}/unterschrift-link`, { rolle: 'bh' })).daten;
    assert.equal((await pol.del(`/berichte/${b2.id}/unterschrift-links/${l2.id}`)).status, 200);
    assert.equal((await anon.get(`/fern/${l2.url.split('/').pop()}`)).status, 410);
  });
});
