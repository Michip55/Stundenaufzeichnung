'use strict';
/** Test-Schnittstellen (API.md 12.18) – nur mit BAUTAG_TEST=1 bzw. createApp({test:true}) eingebunden. */
const v = require('../validierung');
const { ungueltig } = require('../fehler');

function leer() {
  return { push: [], mails: [], ki: [] };
}

module.exports = function testRouten(router, bt) {
  // G-06: zusätzlich zum Schalter BAUTAG_TEST muss jede Anfrage den Test-Token mitsenden
  router.use('/test', (req, res, next) => {
    const t = Buffer.from(String(req.get('x-bautag-test-token') || ''));
    const soll = Buffer.from(String(bt.testToken || ''));
    if (!soll.length || t.length !== soll.length || !require('node:crypto').timingSafeEqual(t, soll)) return res.status(403).json({ fehler: 'Test-Schnittstelle: Token fehlt oder falsch.', code: 'KEIN_ZUGRIFF' });
    next();
  });
  router.get('/test/ausgang', (req, res) => res.json(bt.testAusgang));
  router.post('/test/zuruecksetzen', (req, res) => {
    bt.testAusgang = leer();
    bt.testVorgaben = {};
    res.json({ ok: true });
  });
  router.post('/test/wetter', (req, res) => {
    const b = v.objekt(req.body);
    bt.testVorgaben.wetterAus = b.verfuegbar === false;
    bt.db.lauf('DELETE FROM wetter_cache');
    res.json({ ok: true });
  });
  router.post('/test/email', (req, res) => {
    const b = v.objekt(req.body);
    bt.testVorgaben.emailFehler = b.fehler ? String(b.fehler).slice(0, 200) : null;
    res.json({ ok: true });
  });
  router.post('/test/ocr', (req, res) => {
    const b = v.objekt(req.body);
    bt.testVorgaben.ocrText = b.text == null ? null : String(b.text).slice(0, 20000);
    res.json({ ok: true });
  });
  router.post('/test/ki', (req, res) => {
    const b = v.objekt(req.body);
    if (b.fehler !== undefined && !['ungueltig', 'limit', 'verbindung', 'ablehnung', null].includes(b.fehler)) throw ungueltig('fehler: ungueltig|limit|verbindung|ablehnung');
    bt.testVorgaben.kiAntwort = b.antwort === undefined ? null : b.antwort;
    bt.testVorgaben.kiFehler = b.fehler || null;
    res.json({ ok: true });
  });
  router.post('/test/stuendlich', async (req, res) => {
    bt.stuendlich();
    await require('../push').verteilen(bt);
    await Promise.all(bt.laufend || []);
    res.json({ ok: true });
  });
  router.post('/test/uhr', (req, res) => {
    const b = v.objekt(req.body);
    if (typeof bt.uhr.setze !== 'function') throw ungueltig('Die Uhr ist nicht steuerbar (Server mit BAUTAG_UHR starten).');
    const d = new Date(String(b.iso));
    if (Number.isNaN(d.getTime())) throw ungueltig('iso ist ungültig.');
    bt.uhr.setze(d.toISOString());
    res.json({ ok: true, jetzt: bt.uhr().toISOString() });
  });
};
module.exports.leer = leer;
