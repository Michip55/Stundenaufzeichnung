'use strict';
/** Fernunterschrift per Einmal-Link (API.md 12.9) – ohne SMS-Anbieter */
const crypto = require('node:crypto');
const v = require('../validierung');
const { ungueltig, keinZugriff, nichtGefunden, konflikt, ApiFehler } = require('../fehler');
const { baustelleImBereich, kontext } = require('../rechte');
const B = require('./berichte');

const GUELTIG_STD = 72;
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

/**
 * 15.5 (F-047): Darf die Person, die den Link erstellt hat, den Bericht JETZT noch bearbeiten? Aktives Konto, aktuelles Recht
 * bericht_erstellen und Baustelle im Bereich – sonst gilt ihr Link nicht mehr (die Unterschrift würde auf ihren Namen gespeichert).
 */
function erstellerDarf(db, l, bericht) {
  const u = db.eins('SELECT * FROM benutzer WHERE id = ?', l.erstellt_von);
  if (!u || !u.aktiv) return false;
  const bs = bericht ? bericht.baustelle : null;
  if (!bs) return false;
  try { B.pruefeSchreiben(kontext(db, u), bs); return true; } catch (_) { return false; }
}

/**
 * 15.5 (F-047): offene Links widerrufen, deren Ersteller deaktiviert ist oder das Recht verloren hat (nach Deaktivierung,
 * Rollenwechsel und Rechteänderungen) → Anzahl. Wird zusätzlich beim Öffnen jedes Links geprüft.
 */
function linksOhneRechtWiderrufen(bt, { von = null } = {}) {
  const { db } = bt;
  let n = 0;
  for (const l of db.alle("SELECT * FROM unterschrift_link WHERE status = 'offen'")) {
    const b = B.ladeBerichtRoh(db, l.bericht_id);
    if (erstellerDarf(db, l, b)) continue;
    db.lauf("UPDATE unterschrift_link SET status = 'widerrufen' WHERE id = ? AND status = 'offen'", l.id);
    db.protokolliere({ zeit: bt.uhr().toISOString(), benutzerId: von, art: 'bericht', objekt: `bericht:${l.bericht_id}`, neu: { linkId: l.id }, text: 'Fernunterschrift-Link widerrufen: die erstellende Person darf den Bericht nicht mehr bearbeiten' });
    n++;
  }
  return n;
}

/** Öffentliche Routen (ohne Anmeldung) – vor `angemeldet` einbinden */
function oeffentlich(api, bt) {
  const { db } = bt;
  const zaehler = new Map(); // IP → [Zeitstempel]
  function bremse(req) {
    const ip = req.ip || '?';
    const t = Date.now();
    const l = (zaehler.get(ip) || []).filter((x) => t - x < 10 * 60000);
    l.push(t);
    zaehler.set(ip, l);
    if (zaehler.size > 5000) zaehler.clear();
    if (l.length > 60) throw new ApiFehler(429, 'ZU_VIELE_VERSUCHE', 'Zu viele Anfragen – bitte später erneut versuchen.');
  }
  function link(req, zaehlen = true) {
    bremse(req);
    const token = String(req.params.token || '');
    if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) throw nichtGefunden('Link unbekannt.');
    const l = db.eins('SELECT * FROM unterschrift_link WHERE token_hash = ?', hash(token));
    if (!l) throw nichtGefunden('Link unbekannt.');
    const weg = (text) => new ApiFehler(410, 'LINK_UNGUELTIG', text);
    if (l.status === 'verwendet') throw weg('Dieser Link wurde bereits verwendet – der Bericht ist unterschrieben.');
    if (l.status !== 'offen') throw weg('Dieser Link ist nicht mehr gültig (Bericht geändert oder Link widerrufen). Bitte neuen Link anfordern.');
    if (new Date(l.ablauf) < bt.uhr()) throw weg('Dieser Link ist abgelaufen. Bitte neuen Link anfordern.');
    if (zaehlen) {
      if (l.abrufe >= 20) throw new ApiFehler(429, 'ZU_VIELE_VERSUCHE', 'Dieser Link wurde zu oft aufgerufen.');
      db.lauf('UPDATE unterschrift_link SET abrufe = abrufe + 1 WHERE id = ?', l.id);
    }
    const b = B.ladeBerichtRoh(db, l.bericht_id);
    if (!b || b.status !== 'entwurf' || b.unterschriften.some((u) => u.rolle === l.rolle)) {
      db.lauf("UPDATE unterschrift_link SET status = 'ungueltig' WHERE id = ?", l.id);
      throw weg('Dieser Link ist nicht mehr gültig.');
    }
    // 15.5 (F-047): Ersteller muss JETZT noch aktiv sein und den Bericht bearbeiten dürfen
    if (!erstellerDarf(db, l, b)) {
      db.lauf("UPDATE unterschrift_link SET status = 'widerrufen' WHERE id = ? AND status = 'offen'", l.id);
      throw weg('Dieser Link ist nicht mehr gültig. Bitte neuen Link anfordern.');
    }
    return { l, b };
  }
  /** AG-Fassung als JSON (wie PDF fassung=ag): ohne €, ohne Kürzel K/U, ohne interne Felder */
  function agJson(b) {
    const j = B.berichtJson(db, { benutzer: { id: 0, rolle: 'mitarbeiter' }, rechte: new Set(), hat: () => false }, b, { mitBild: false });
    const versteckt = ['K', 'U', 'ZA', 'abwesend'];
    const personal = j.personal.filter((p) => !versteckt.includes(p.code) || p.stunden > 0).map((p) => ({ name: p.name, von1: p.von1, bis1: p.bis1, von2: p.von2, bis2: p.bis2, pauseMin: p.pauseMin, stunden: p.stunden, code: versteckt.includes(p.code) ? null : p.code }));
    return {
      baustelle: { kst: j.baustelle.kst, name: j.baustelle.name, auftraggeber: j.baustelle.auftraggeber, bauvorhaben: j.baustelle.bauvorhaben, adresse: j.baustelle.adresse },
      datum: j.datum, personal, gesamtstunden: j.gesamtstunden, geraete: j.geraete.map((g) => ({ code: g.code, name: g.name, stunden: g.stunden })),
      material: j.material.map((m) => ({ name: m.name, menge: m.menge, einheit: m.einheit })), arbeitsleistung: j.arbeitsleistung, materialbeistellung: j.materialbeistellung,
      regie: j.regie, vorkommnisse: j.vorkommnisse, wetter: j.wetter, unterschriften: Object.fromEntries(Object.entries(j.unterschriften).map(([k, u]) => [k, { name: u.name, zeit: u.zeit }]))
    };
  }

  api.get('/fern/:token', (req, res) => {
    const { l, b } = link(req);
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.json({ bericht: agJson(b), rolle: l.rolle, nameVorschlag: l.name || '', ablauf: l.ablauf, firma: (db.einstellung('firma', {}) || {}).name || '' });
  });
  api.get('/fern/:token/pdf', async (req, res) => {
    const { b } = link(req);
    const pdf = await B.agPdf(bt, b.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Bautagesbericht_${b.baustelle.kst}_${b.datum}.pdf"`);
    res.send(pdf);
  });
  api.post('/fern/:token', (req, res) => {
    const { l, b } = link(req, false);
    const body = v.objekt(req.body);
    if (body.bestaetigt !== true) throw ungueltig('Bitte bestätigen, dass Sie den Bericht gelesen haben (bestaetigt:true).');
    const name = v.text(body.name, 'name', { max: 100 });
    if (name.trim().length < 3) throw ungueltig('name: mindestens 3 Zeichen.');
    const bild = B.pruefePng(body.bildPng);
    const ip = req.ip || '?';
    let status;
    db.transaktion(() => {
      db.lauf("UPDATE unterschrift_link SET status = 'verwendet', verwendet = ?, verwendet_ip = ? WHERE id = ? AND status = 'offen'", bt.uhr().toISOString(), ip, l.id);
    });
    try {
      status = B.unterschriftSpeichern(b, { rolle: l.rolle, name: name.trim(), bild, benutzerId: l.erstellt_von, protokollZusatz: ' (Fernunterschrift)' });
    } catch (e) {
      db.lauf("UPDATE unterschrift_link SET status = 'offen', verwendet = NULL, verwendet_ip = NULL WHERE id = ?", l.id);
      throw e;
    }
    db.lauf("UPDATE unterschrift_link SET status = 'verwendet' WHERE id = ?", l.id); // linksUngueltig hat „ungueltig“ gesetzt
    db.protokolliere({ zeit: bt.uhr().toISOString(), benutzerId: null, art: 'bericht', objekt: `bericht:${b.id}`, neu: { rolle: l.rolle, name, ip, linkId: l.id }, text: `Fernunterschrift (${l.rolle === 'bh' ? 'Bauherr' : 'Auftragnehmer'}) von ${name} über Link (IP ${ip})` });
    res.json({ ok: true, status });
  });
}

/** Angemeldete Routen */
function intern(api, bt) {
  const { db } = bt;
  const jetzt = () => bt.uhr().toISOString();
  function bericht(req) {
    const b = B.ladeBerichtRoh(db, v.pfadId(req.params.id, 'Berichts-ID'));
    if (!b) throw nichtGefunden('Bericht nicht gefunden.');
    B.pruefeSchreiben(req.ctx, b.baustelle);
    return b;
  }
  const namen = () => new Map(db.alle('SELECT id, name FROM benutzer').map((x) => [x.id, x.name]));
  function linkJson(l, n) {
    const status = l.status === 'offen' && new Date(l.ablauf) < bt.uhr() ? 'abgelaufen' : l.status === 'widerrufen' ? 'ungueltig' : l.status;
    return { id: l.id, rolle: l.rolle, name: l.name || '', email: l.email || null, erstellt: l.erstellt, erstelltVon: { id: l.erstellt_von, name: n.get(l.erstellt_von) }, ablauf: l.ablauf, status, ...(l.verwendet ? { verwendet: l.verwendet } : {}) };
  }

  api.post('/berichte/:id/unterschrift-link', async (req, res) => {
    const b = bericht(req);
    const body = v.objekt(req.body);
    const rolle = v.auswahl(body.rolle ?? 'bh', 'rolle', ['bh']);
    if (b.status !== 'entwurf') throw konflikt('Der Bericht ist bereits unterschrieben.');
    if (b.unterschriften.some((u) => u.rolle === rolle)) throw konflikt('Diese Unterschrift liegt bereits vor.');
    const name = body.name == null ? null : v.text(body.name, 'name', { max: 100, pflicht: false }) || null;
    const email = body.email == null ? null : v.text(body.email, 'email', { max: 200 });
    if (email && !/^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(email)) throw ungueltig('email ist ungültig.');
    if (email && !require('../mail').eingerichtet(bt)) throw ungueltig('E-Mail ist nicht eingerichtet – Link bitte teilen (WhatsApp/E-Mail-Programm).');
    const token = crypto.randomBytes(32).toString('base64url');
    const ablauf = new Date(bt.uhr().getTime() + GUELTIG_STD * 3600e3).toISOString();
    const basis = (bt.url || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const url = `${basis}/unterschrift/${token}`;
    const id = db.transaktion(() => {
      db.lauf("UPDATE unterschrift_link SET status = 'ungueltig' WHERE bericht_id = ? AND rolle = ? AND status = 'offen'", b.id, rolle);
      const r = db.lauf('INSERT INTO unterschrift_link (bericht_id, rolle, token_hash, name, email, erstellt, erstellt_von, ablauf) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', b.id, rolle, crypto.createHash('sha256').update(token).digest('hex'), name, email, jetzt(), req.ctx.benutzer.id, ablauf);
      db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'bericht', objekt: `bericht:${b.id}`, neu: { linkId: r.id, rolle, email, ablauf }, text: `Fernunterschrift-Link (${rolle}) für Bericht ${b.baustelle.kst} ${b.datum} erstellt` });
      return r.id;
    });
    if (email) {
      const M = require('../mail');
      M.senden(bt, { an: email, betreff: `Bitte unterschreiben: Bautagesbericht ${b.baustelle.kst} vom ${b.datum.split('-').reverse().join('.')}`, text: `Guten Tag${name ? ` ${name}` : ''},\n\nbitte prüfen und unterschreiben Sie den Bautagesbericht über diesen Link (gültig bis ${new Date(ablauf).toLocaleString('de-AT', { timeZone: 'Europe/Vienna' })}):\n${url}\n\nMit freundlichen Grüßen\n${(db.einstellung('firma', {}) || {}).name || ''}` })
        .catch((e) => db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'email', objekt: `bericht:${b.id}`, neu: { fehler: e.message }, text: 'Fernunterschrift-Link: E-Mail nicht zugestellt' }));
    }
    res.status(201).json({ id, url, ablauf, rolle });
  });

  api.get('/berichte/:id/unterschrift-links', (req, res) => {
    const b = bericht(req);
    const n = namen();
    res.json(db.alle('SELECT * FROM unterschrift_link WHERE bericht_id = ? ORDER BY erstellt DESC, id DESC', b.id).map((l) => linkJson(l, n)));
  });
  api.delete('/berichte/:id/unterschrift-links/:lid', (req, res) => {
    const b = bericht(req);
    const r = db.lauf("UPDATE unterschrift_link SET status = 'widerrufen' WHERE id = ? AND bericht_id = ? AND status = 'offen'", v.pfadId(req.params.lid), b.id);
    if (!r.changes) throw nichtGefunden('Offener Link nicht gefunden.');
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'bericht', objekt: `bericht:${b.id}`, text: 'Fernunterschrift-Link widerrufen' });
    res.json({ ok: true });
  });
}

module.exports = { oeffentlich, intern, erstellerDarf, linksOhneRechtWiderrufen };
