'use strict';
/** Push, Wetter, E-Mail (API.md 12.3–12.5) */
const v = require('../validierung');
const { ungueltig, keinZugriff, nichtGefunden, konflikt, ApiFehler } = require('../fehler');
const { brauche, baustelleAusPfad } = require('./hilfe');
const B = require('./berichte');
const P = require('../push');
const W = require('../wetter');
const M = require('../mail');
const G = require('../geheim');
const { wienDatum } = require('../datum');
const { bereich, baustelleImBereich } = require('../rechte');

module.exports = function diensteRouten(api, bt) {
  const { db } = bt;
  const jetzt = () => bt.uhr().toISOString();

  /* ---------- Push (12.3) ---------- */
  api.get('/push/schluessel', (req, res) => res.json({ publicKey: P.vapid(bt).publicKey }));

  api.post('/push/abo', (req, res) => {
    const body = v.objekt(req.body);
    const endpoint = v.text(body.endpoint, 'endpoint', { max: 1000 });
    if (!/^https:\/\/[^\s]+$/.test(endpoint)) throw ungueltig('endpoint muss eine https-Adresse sein.');
    // G-07: nur bekannte Push-Dienste (Google, Mozilla, Apple, Microsoft) – kein Zugriff auf interne Adressen
    if (!require('../push').endpointErlaubt(endpoint, { test: bt.test })) throw ungueltig('endpoint: nur Adressen bekannter Push-Dienste (Google, Mozilla, Apple, Microsoft) über https auf Port 443.');
    const k = v.objekt(body.keys, 'keys');
    const p256dh = v.text(k.p256dh, 'keys.p256dh', { max: 200 });
    const auth = v.text(k.auth, 'keys.auth', { max: 100 });
    if (!/^[A-Za-z0-9_-]+=*$/.test(p256dh) || !/^[A-Za-z0-9_-]+=*$/.test(auth)) throw ungueltig('keys müssen Base64url sein.');
    const geraet = body.geraet == null ? null : v.text(body.geraet, 'geraet', { max: 100, pflicht: false });
    const ich = req.ctx.benutzer.id;
    const alt = db.eins('SELECT id FROM push_abo WHERE endpoint = ?', endpoint);
    db.transaktion(() => {
      if (alt) db.lauf('UPDATE push_abo SET benutzer_id = ?, p256dh = ?, auth = ?, geraet = ?, fehler = NULL WHERE id = ?', ich, p256dh, auth, geraet, alt.id);
      else db.lauf('INSERT INTO push_abo (benutzer_id, endpoint, p256dh, auth, geraet, erstellt) VALUES (?, ?, ?, ?, ?, ?)', ich, endpoint, p256dh, auth, geraet, jetzt());
      const ueber = db.alle('SELECT id FROM push_abo WHERE benutzer_id = ? ORDER BY erstellt DESC, id DESC', ich).slice(10);
      for (const u of ueber) db.lauf('DELETE FROM push_abo WHERE id = ?', u.id);
    });
    const a = db.eins('SELECT id, geraet, erstellt FROM push_abo WHERE endpoint = ?', endpoint);
    res.status(alt ? 200 : 201).json(a);
  });

  api.delete('/push/abo', (req, res) => {
    const body = v.objekt(req.body);
    db.lauf('DELETE FROM push_abo WHERE endpoint = ? AND benutzer_id = ?', String(body.endpoint || ''), req.ctx.benutzer.id);
    res.json({ ok: true });
  });
  // G-07: nie rohe Netzwerkfehler zurückgeben (auch nicht aus Altbestand)
  api.get('/push/abos', (req, res) => res.json(db.alle('SELECT id, geraet, erstellt, zuletzt, fehler FROM push_abo WHERE benutzer_id = ? ORDER BY erstellt', req.ctx.benutzer.id)
    .map((a) => ({ ...a, fehler: a.fehler == null ? null : /^Zustellung fehlgeschlagen( \(HTTP \d{3}\))?$/.test(a.fehler) ? a.fehler : 'Zustellung fehlgeschlagen' }))));
  api.delete('/push/abos/:aid', (req, res) => {
    const r = db.lauf('DELETE FROM push_abo WHERE id = ? AND benutzer_id = ?', v.pfadId(req.params.aid), req.ctx.benutzer.id);
    if (!r.changes) throw nichtGefunden('Abo nicht gefunden.');
    res.json({ ok: true });
  });
  api.get('/push/einstellungen', (req, res) => res.json({ typen: P.einstellungen(db, req.ctx.benutzer) }));
  api.put('/push/einstellungen', (req, res) => {
    const body = v.objekt(req.body);
    const t = v.objekt(body.typen, 'typen');
    const erlaubt = P.typenFuerRolle(req.ctx.benutzer.rolle);
    const neu = P.einstellungen(db, req.ctx.benutzer);
    for (const [k, x] of Object.entries(t)) {
      if (!erlaubt.includes(k)) throw ungueltig(`typen.${k} ist unbekannt oder für Ihre Rolle nicht vorgesehen.`);
      neu[k] = v.bool(x, `typen.${k}`);
    }
    db.lauf('INSERT INTO push_einstellung (benutzer_id, typen) VALUES (?, ?) ON CONFLICT(benutzer_id) DO UPDATE SET typen = excluded.typen', req.ctx.benutzer.id, JSON.stringify(neu));
    res.json({ typen: P.einstellungen(db, req.ctx.benutzer) });
  });
  api.post('/push/test', async (req, res) => {
    const r = await P.anBenutzer(bt, req.ctx.benutzer.id, { title: 'Test-Benachrichtigung von BauTag', body: 'Push-Benachrichtigungen funktionieren auf diesem Gerät.', url: `${(bt.url || '').replace(/\/$/, '')}/`, tag: 'bt-test' });
    res.json(r);
  });

  /* ---------- Wetter (12.4) ---------- */
  function darfBaustelleSehen(ctx, bs) {
    return bereich(ctx.benutzer) !== 'partie' || bs.status === 'aktiv' || baustelleImBereich(ctx.benutzer, bs);
  }
  api.get('/baustellen/:id/wetter', async (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    if (!darfBaustelleSehen(req.ctx, bs)) throw keinZugriff();
    const datum = req.query.datum === undefined ? wienDatum(bt.uhr()) : v.datum(String(req.query.datum), 'datum');
    res.json(await W.wetterFuer(bt, bs, datum));
  });
  api.post('/berichte/:id/wetter', async (req, res) => {
    B.pruefeGrundrecht(req.ctx, true); // 15.7 (F-036): Recht vor Existenz
    const b = B.ladeBerichtRoh(db, v.pfadId(req.params.id, 'Berichts-ID'));
    if (!b) throw nichtGefunden('Bericht nicht gefunden.');
    B.pruefeSchreiben(req.ctx, b.baustelle);
    if (b.status !== 'entwurf' || b.unterschriften.length) throw konflikt(B.GESPERRT_TEXT);
    const w = await W.wetterFuer(bt, b.baustelle, b.datum);
    if (!w.verfuegbar) throw new ApiFehler(503, 'NICHT_VERFUEGBAR', `Wetter nicht verfügbar: ${w.grund}`);
    db.transaktion(() => {
      db.lauf('UPDATE bericht SET wetter = ?, geaendert = ?, version = version + 1 WHERE id = ?', JSON.stringify(W.berichtWetter(w)), jetzt(), b.id);
      if (typeof B.linksUngueltig === 'function') B.linksUngueltig(db, b.id);
    });
    res.json({ ...B.berichtJson(db, req.ctx, B.ladeBerichtRoh(db, b.id)), wetterVorschlag: w.schlechtwetter });
  });

  /* ---------- E-Mail (12.5) ---------- */
  function emailJson() {
    const k = M.konfig(bt);
    return {
      host: k ? k.host : null, port: k ? k.port : null, sicher: k ? k.sicher : false, benutzer: k ? k.benutzer : null, absender: k ? k.absender : null,
      alarmAn: k ? k.alarmAn : (db.einstellung('email', {}) || {}).alarmAn || null, passwortGesetzt: Boolean(k && k.passwortGesetzt), aktiv: Boolean(k && k.aktiv),
      quelle: k ? k.quelle : null, schluesselVorhanden: G.schluesselVorhanden(bt)
    };
  }
  api.get('/einstellungen/email', brauche('benutzer'), (req, res) => res.json(emailJson()));
  api.put('/einstellungen/email', brauche('benutzer'), (req, res) => {
    const body = v.objekt(req.body);
    const alt = db.einstellung('email', null) || {};
    const e = { ...alt };
    if (body.host !== undefined) e.host = body.host === null || body.host === '' ? null : v.text(body.host, 'host', { max: 200 });
    if (e.host && !/^[A-Za-z0-9.-]+$/.test(e.host)) throw ungueltig('host ist ungültig.');
    if (body.port !== undefined) e.port = v.zahl(body.port, 'port', { min: 1, max: 65535, ganz: true });
    if (body.sicher !== undefined) e.sicher = v.bool(body.sicher, 'sicher');
    if (body.benutzer !== undefined) e.benutzer = body.benutzer === null ? '' : v.text(body.benutzer, 'benutzer', { max: 200, pflicht: false });
    const mail = (x, f) => { if (x && !/^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(x)) throw ungueltig(`${f} ist keine gültige E-Mail-Adresse.`); return x; };
    if (body.absender !== undefined) e.absender = mail(body.absender === null ? '' : v.text(body.absender, 'absender', { max: 200, pflicht: false }), 'absender');
    if (body.alarmAn !== undefined) e.alarmAn = mail(body.alarmAn === null ? '' : v.text(body.alarmAn, 'alarmAn', { max: 200, pflicht: false }), 'alarmAn');
    if (body.aktiv !== undefined) e.aktiv = v.bool(body.aktiv, 'aktiv');
    if (body.passwort !== undefined) {
      if (body.passwort === '' || body.passwort === null) e.passwort = null;
      else {
        const pw = v.text(body.passwort, 'passwort', { max: 300 });
        try { e.passwort = G.verschluesseln(bt, pw, { pflicht: true }); } catch (_) { throw ungueltig('Zum Speichern des Passworts muss auf dem Server BAUTAG_SCHLUESSEL gesetzt sein (siehe deploy/.env).'); }
      }
    }
    db.setzeEinstellung('email', e);
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'einstellung', objekt: 'email', neu: { ...e, passwort: e.passwort ? 'gesetzt' : null }, text: 'E-Mail-Einstellungen geändert' });
    res.json(emailJson());
  });
  api.post('/einstellungen/email/test', brauche('benutzer'), async (req, res) => {
    const body = v.objekt(req.body);
    const an = v.text(body.an, 'an', { max: 200 });
    if (!/^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(an)) throw ungueltig('an ist keine gültige E-Mail-Adresse.');
    try {
      await M.senden(bt, { an, betreff: 'BauTag: Test-E-Mail', text: 'Diese Test-E-Mail bestätigt, dass der Versand aus BauTag funktioniert.' });
    } catch (e) {
      db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'email', objekt: 'test', neu: { an, fehler: String(e.message).slice(0, 200) }, text: 'Test-E-Mail fehlgeschlagen' });
      throw new ApiFehler(502, 'EMAIL_FEHLER', `Versand fehlgeschlagen: ${String(e.message || e).slice(0, 200)}`);
    }
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'email', objekt: 'test', neu: { an }, text: 'Test-E-Mail gesendet' });
    res.json({ ok: true });
  });
  api.post('/berichte/:id/email', (req, res) => {
    // 15.7 (F-036): ohne stammdaten und ohne bericht_freigeben sofort 403 – vor der Existenzprüfung
    if (!req.ctx.hat('stammdaten') && !req.ctx.hat('bericht_freigeben')) throw keinZugriff('Berichte versenden Bauleitung und Büro.');
    const b = B.ladeBerichtRoh(db, v.pfadId(req.params.id, 'Berichts-ID'));
    if (!b) throw nichtGefunden('Bericht nicht gefunden.');
    B.pruefeLesen(req.ctx, b.baustelle);
    const ich = req.ctx.benutzer;
    const darf = req.ctx.hat('stammdaten') || (req.ctx.hat('bericht_freigeben') && baustelleImBereich(ich, b.baustelle));
    if (!darf) throw keinZugriff('Berichte versenden Bauleitung und Büro.');
    if (b.status === 'entwurf') throw konflikt('Der Bericht ist noch nicht unterschrieben.');
    if (!M.eingerichtet(bt)) throw ungueltig('E-Mail ist nicht eingerichtet (Einstellungen → E-Mail).');
    const body = v.objekt(req.body);
    const an = body.an == null ? b.baustelle.ag_email : v.text(body.an, 'an', { max: 300 });
    if (!an) throw ungueltig('Keine E-Mail-Adresse des Auftraggebers hinterlegt – bitte „an“ angeben.');
    for (const x of an.split(',').map((y) => y.trim()).filter(Boolean)) if (!/^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(x)) throw ungueltig(`„${x}“ ist keine gültige E-Mail-Adresse.`);
    const id = M.berichtVersenden(bt, b.id, an, ich.id);
    res.status(202).json({ id, status: 'wartet' });
  });
};
