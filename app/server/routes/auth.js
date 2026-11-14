'use strict';
const v = require('../validierung');
const { nichtAngemeldet, ungueltig, nichtGefunden } = require('../fehler');
const { benachrichtige, empfaengerMitRecht } = require('../benachrichtigung');
const auth = require('../auth');
const { eigeneBaustellenIds } = require('../rechte');

function benutzerJson(b, mitLohngruppe) {
  const o = { id: b.id, name: b.name, rolle: b.rolle };
  if (mitLohngruppe && b.lohngruppe_id) o.lohngruppe = b.lohngruppe_id;
  return o;
}

/**
 * Fehlversuch zählen (IP und Konto); bei Kontosperre Büro/GF benachrichtigen.
 * 15.5 (F-031): `inSitzung` = PIN-/Code-Prüfung innerhalb einer Sitzung (/auth/pin, 2FA-Einstellungen) – führt sie zur
 * Kontosperre, enden zusätzlich alle Sitzungen des Kontos (wer dort rät, hat eine Sitzung, aber offenbar nicht die PIN).
 */
function fehlversuch(bt, b, ip, { inSitzung = false } = {}) {
  const gesperrt = bt.bremse.fehlversuch(b ? b.id : null, ip);
  if (b && bt.bremse.kontoFehlversuch(b.id)) {
    const zeit = bt.uhr().toISOString();
    if (inSitzung) auth.beendeAlleSitzungen(bt.db, b.id);
    bt.db.protokolliere({ zeit, benutzerId: null, art: 'sicherheit', objekt: `benutzer:${b.id}`, text: `Konto ${b.name} nach ${auth.KONTO_MAX_FEHLVERSUCHE} Fehlversuchen in 24 Std. gesperrt (letzte IP ${ip})${inSitzung ? ' – alle Sitzungen beendet' : ''}` });
    for (const e of empfaengerMitRecht(bt.db, 'stammdaten|benutzer', { ohne: b.id })) { // 15.3: wer entsperren kann
      benachrichtige(bt.db, { benutzerId: e.id, typ: 'sicherheit', titel: `Konto gesperrt: ${b.name}`, text: `Nach ${auth.KONTO_MAX_FEHLVERSUCHE} falschen PIN-Eingaben in 24 Std. ist die Anmeldung von ${b.name} befristet gesperrt. Bitte prüfen und ggf. entsperren.`, zeit, schluessel: `konto:${b.id}:${zeit}` });
    }
    bt.bremse.pruefeKonto(b.id); // wirft 423 mit Sperrdauer
  }
  if (gesperrt) throw bt.bremse.fehler(gesperrt);
}

/**
 * N-004/N-027: falscher Zwei-Faktor-Code (nach richtiger PIN bzw. in den 2FA-Einstellungen). Zählt kontoweit über alle IPs
 * (10 in 24 h → Kontosperre, unabhängig von PIN-Anmeldungen), wird protokolliert und der Person gemeldet – die PIN ist dann
 * offenbar bekannt. Danach zählt der Versuch wie ein PIN-Fehlversuch (Sperre je Benutzer+IP, 20er-Kontogrenze).
 */
function zweiFaktorFehlversuch(bt, b, ip, { anlass = 'anmeldung', schluessel = null } = {}) {
  const inSitzung = anlass !== 'anmeldung';
  const zeit = bt.uhr().toISOString();
  const z = bt.bremse.zweiFaktorFehlversuch(b.id);
  const wo = anlass === 'anmeldung' ? 'bei der Anmeldung nach richtiger PIN' : 'in den Einstellungen zur Zwei-Faktor-Anmeldung';
  bt.db.protokolliere({ zeit, benutzerId: null, art: 'sicherheit', objekt: `benutzer:${b.id}`, text: `${b.name}: falscher Zwei-Faktor-Code ${wo} (${z.anzahl}. in 24 Std., IP ${ip})` });
  benachrichtige(bt.db, {
    benutzerId: b.id, typ: 'sicherheit', titel: 'Falscher Zwei-Faktor-Code',
    text: anlass === 'anmeldung'
      ? 'Bei einer Anmeldung mit Ihrer richtigen PIN wurde ein falscher Code aus der Authenticator-App eingegeben. Waren Sie das nicht, ist Ihre PIN wahrscheinlich bekannt: bitte sofort die PIN ändern und Büro bzw. Geschäftsführung informieren.'
      : 'In Ihren Einstellungen zur Zwei-Faktor-Anmeldung wurde ein falscher Code eingegeben. Waren Sie das nicht, bitte sofort abmelden, die PIN ändern und Büro bzw. Geschäftsführung informieren.',
    zeit, schluessel: schluessel || `2fa-falsch:${b.id}:${zeit}`
  });
  if (z.gesperrt) {
    if (inSitzung) auth.beendeAlleSitzungen(bt.db, b.id); // 15.5 (F-031)
    bt.db.protokolliere({ zeit, benutzerId: null, art: 'sicherheit', objekt: `benutzer:${b.id}`, text: `Konto ${b.name} nach ${auth.ZF_MAX_FEHLVERSUCHE} falschen Zwei-Faktor-Codes in 24 Std. gesperrt (letzte IP ${ip})` });
    for (const e of empfaengerMitRecht(bt.db, 'stammdaten|benutzer', { ohne: b.id })) { // 15.3: wer entsperren kann
      benachrichtige(bt.db, { benutzerId: e.id, typ: 'sicherheit', titel: `Konto gesperrt: ${b.name}`, text: `Nach ${auth.ZF_MAX_FEHLVERSUCHE} falschen Zwei-Faktor-Codes in 24 Std. (die PIN war jeweils richtig) ist die Anmeldung von ${b.name} befristet gesperrt. Die PIN ist vermutlich bekannt – bitte prüfen, PIN zurücksetzen und ggf. entsperren.`, zeit, schluessel: `konto-2fa:${b.id}:${zeit}` });
    }
    bt.bremse.pruefeKonto(b.id); // wirft 423 mit Sperrdauer
  }
  fehlversuch(bt, b, ip, { inSitzung });
}

/** N-120: Client-IP für Sperren – IPv6 je /64, IPv4-mapped als IPv4, Unlesbares gemeinsam */
const clientIp = (req) => auth.ipSchluessel(req.ip || (req.socket && req.socket.remoteAddress) || '');

module.exports = function authRouten(api, bt) {
  const { db } = bt;

  /** Namensliste für die Anmeldung – ohne Rollen; per BAUTAG_LOGIN_LISTE=0 abschaltbar */
  api.get('/auth/benutzerliste', (req, res) => {
    if (!bt.loginListe) throw nichtGefunden('Die Namensliste ist abgeschaltet – Anmeldung mit Personalnummer und PIN.');
    res.json(db.alle('SELECT id, name FROM benutzer WHERE aktiv = 1 ORDER BY name').map((b) => ({ id: b.id, name: b.name })));
  });

  api.post('/auth/login', async (req, res) => {
    const body = v.objekt(req.body);
    if (typeof body.pin !== 'string' || !/^\d{4,12}$/.test(body.pin)) throw ungueltig('PIN muss aus 4 bis 12 Ziffern bestehen.');
    let b = null;
    let benutzerId = null;
    if (body.benutzerId !== undefined) {
      // D-12: ohne Namensliste nur Anmeldung mit Personalnummer
      if (!bt.loginListe) throw ungueltig('Anmeldung bitte mit Personalnummer (pnr) und PIN.');
      benutzerId = v.id(body.benutzerId, 'benutzerId');
      b = db.eins('SELECT * FROM benutzer WHERE id = ? AND aktiv = 1', benutzerId);
    } else if (body.pnr !== undefined) {
      const pnr = v.zahl(body.pnr, 'pnr', { min: 1, max: 999999, ganz: true });
      b = db.eins('SELECT * FROM benutzer WHERE pnr = ? AND aktiv = 1', pnr);
      benutzerId = b ? b.id : null;
    } else {
      throw ungueltig('benutzerId oder pnr fehlt.');
    }
    const ip = clientIp(req);
    bt.bremse.pruefe(benutzerId, ip);
    bt.bremse.pruefeKonto(b ? b.id : null);
    const ok = await auth.pruefePin(body.pin, b ? b.pin_hash : auth.DUMMY_HASH);
    if (!b || !ok) {
      fehlversuch(bt, b, ip);
      throw nichtAngemeldet('Benutzer oder PIN falsch.');
    }
    // D-02: PIN kürzer als für die Rolle vorgeschrieben → Wechsel erzwingen
    const zuKurz = !bt.demo && !auth.FELD_ROLLEN.includes(b.rolle) && body.pin.length < 6; // Demo-Modus: 1234 bleibt
    db.lauf('UPDATE benutzer SET pin_laenge = ?, muss_pin_aendern = CASE WHEN ? THEN 1 ELSE muss_pin_aendern END WHERE id = ?', body.pin.length, zuKurz ? 1 : 0, b.id);
    if (zuKurz) b.muss_pin_aendern = 1;
    // API.md 12.7: mit aktiver Zwei-Faktor-Anmeldung erst nach dem Code anmelden
    const zf = require('./zweifaktor');
    // N-004/N-027: Zähler erst nach dem zweiten Faktor zurücksetzen – eine richtige PIN allein setzt keine Sperre zurück
    if (zf.aktiv(db, b.id)) return res.json({ zweiterFaktor: true, vorgang: zf.neuerVorgang(bt, b.id, ip) });
    bt.bremse.erfolg(b.id, ip);
    anmelden(req, res, b);
  });

  /**
   * Sitzung anlegen (nach PIN bzw. PIN + zweitem Faktor). 15.5: Eine mitgeschickte alte Sitzung endet immer (Rotation).
   * `bindung: true` (App am Gerät): die Sitzung gilt nur mit dem Bindungs-Cookie, das die App beim Abmelden löscht.
   * `pushEndpoint`: Push-Abo dieses Geräts – gehört es einer anderen Person, wird es gelöscht (F-014).
   */
  function anmelden(req, res, b) {
    if (req.token) auth.beendeSitzung(db, req.token);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const s = auth.neueSitzung(db, b.id, bt.uhr(), { bindung: body.bindung === true });
    auth.setzeCookie(req, res, typeof s === 'string' ? s : s.token, typeof s === 'string' ? null : s.bindung);
    if (typeof body.pushEndpoint === 'string' && body.pushEndpoint.length <= 1000) {
      const weg = db.lauf('DELETE FROM push_abo WHERE endpoint = ? AND benutzer_id <> ?', body.pushEndpoint, b.id).changes;
      if (weg) db.protokolliere({ zeit: bt.uhr().toISOString(), benutzerId: b.id, art: 'sicherheit', objekt: `benutzer:${b.id}`, text: `${b.name} hat sich an einem Gerät angemeldet, das Push-Meldungen einer anderen Person erhielt – Abo der anderen Person gelöscht` });
    }
    res.json({ benutzer: benutzerJson(b, true), mussPinAendern: b.muss_pin_aendern === 1 });
  }

  require('./zweifaktor')(api, bt, { anmelden, fehlversuch: (b, ip, o) => fehlversuch(bt, b, ip, o), zweiFaktorFehlversuch: (b, ip, o) => zweiFaktorFehlversuch(bt, b, ip, o), clientIp });

  /**
   * Abmelden (15.5): beendet die Sitzung des Cookies – auch eine abgelaufene oder (nach dem Abmelden ohne Netz) ungebundene –
   * und löscht mit `endpoint` das Push-Abo dieses Geräts der Person, der die Sitzung gehörte (F-014).
   */
  api.post('/auth/logout', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const wer = req.ctx ? req.ctx.benutzer.id : req.tokenBenutzerId;
    if (wer && typeof body.endpoint === 'string' && body.endpoint.length <= 1000) {
      db.lauf('DELETE FROM push_abo WHERE endpoint = ? AND benutzer_id = ?', body.endpoint, wer);
    }
    auth.beendeSitzung(db, req.token);
    auth.loescheCookie(req, res);
    res.json({ ok: true });
  });

  /**
   * 15.5 (F-046): Geräteschlüssel der angemeldeten Person (AES-256, Base64). Die App versiegelt damit beim Abmelden und beim
   * Benutzerwechsel die noch wartenden Einträge dieser Person; ohne ihre Anmeldung sind sie am Gerät nicht lesbar.
   * `?benutzerId=` muss die angemeldete Person sein (sonst 403).
   */
  api.get('/auth/geraet-schluessel', (req, res) => {
    if (!req.ctx) throw nichtAngemeldet();
    const id = req.ctx.benutzer.id;
    // nur der eigene Schlüssel – auch die GF erhält nie den einer anderen Person
    if (v.pfadId(String(req.query.benutzerId ?? ''), 'benutzerId') !== id) throw require('../fehler').keinZugriff('Nur der eigene Geräteschlüssel.');
    let z = db.eins('SELECT schluessel FROM geraet_schluessel WHERE benutzer_id = ?', id);
    if (!z) {
      db.lauf('INSERT INTO geraet_schluessel (benutzer_id, schluessel, erstellt) VALUES (?, ?, ?) ON CONFLICT(benutzer_id) DO NOTHING', id, require('node:crypto').randomBytes(32).toString('base64'), bt.uhr().toISOString());
      z = db.eins('SELECT schluessel FROM geraet_schluessel WHERE benutzer_id = ?', id);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ benutzerId: id, schluessel: z.schluessel });
  });

  api.get('/auth/ich', (req, res) => {
    if (!req.ctx) throw nichtAngemeldet();
    const b = req.ctx.benutzer;
    res.json({
      benutzer: { ...benutzerJson(b, true), baustelleId: b.baustelle_id ?? null },
      rechte: [...req.ctx.rechte],
      baustellenIds: eigeneBaustellenIds(db, b),
      mussPinAendern: b.muss_pin_aendern === 1,
      sitzungMinuten: auth.inaktivMinuten(b.rolle, bt.sitzung),
      sperreMinuten: auth.sperreMinuten(b.rolle, bt.sitzung), // 15.5: Abmelden am Gerät nach Untätigkeit
      zweiFaktor: require('./zweifaktor').stand(db, b)
    });
  });

  /** Eigene dienstliche Telefonnummer (12.8d) */
  api.put('/auth/telefon', (req, res) => {
    if (!req.ctx) throw nichtAngemeldet();
    const t = require('./benutzer').telefonPruefen(v.objekt(req.body).telefon);
    db.lauf('UPDATE benutzer SET telefon = ? WHERE id = ?', t, req.ctx.benutzer.id);
    db.protokolliere({ zeit: bt.uhr().toISOString(), benutzerId: req.ctx.benutzer.id, art: 'benutzer', objekt: `benutzer:${req.ctx.benutzer.id}`, neu: { telefon: t }, text: 'Eigene Telefonnummer geändert' });
    res.json({ telefon: t });
  });

  /** Eigene PIN ändern (auch bei erzwungener Änderung) */
  api.post('/auth/pin', async (req, res) => {
    if (!req.ctx) throw nichtAngemeldet();
    const body = v.objekt(req.body);
    const ich = db.eins('SELECT * FROM benutzer WHERE id = ?', req.ctx.benutzer.id);
    if (typeof body.alt !== 'string' || !/^\d{4,12}$/.test(body.alt)) throw ungueltig('Bisherige PIN fehlt.');
    const fehler = auth.pinFehler(body.neu, ich.rolle);
    if (fehler) throw ungueltig(fehler);
    if (body.neu === body.alt) throw ungueltig('Die neue PIN muss sich von der bisherigen unterscheiden.');
    const ip = clientIp(req);
    bt.bremse.pruefe(ich.id, ip);
    bt.bremse.pruefeKonto(ich.id); // 15.5 (F-031): dieselbe Kontosperre wie bei der Anmeldung
    if (!(await auth.pruefePin(body.alt, ich.pin_hash))) {
      fehlversuch(bt, ich, ip, { inSitzung: true });
      throw nichtAngemeldet('Die bisherige PIN ist falsch.');
    }
    const hash = await auth.hashPin(body.neu);
    const zeit = bt.uhr().toISOString();
    db.transaktion(() => {
      db.lauf('UPDATE benutzer SET pin_hash = ?, muss_pin_aendern = 0, pin_laenge = ? WHERE id = ?', hash, body.neu.length, ich.id);
      db.lauf('DELETE FROM sitzung WHERE benutzer_id = ? AND token_hash <> ?', ich.id, require('node:crypto').createHash('sha256').update(req.token).digest('hex'));
      db.protokolliere({ zeit, benutzerId: ich.id, art: 'benutzer', objekt: `benutzer:${ich.id}`, neu: { pin: 'selbst geändert' }, text: `${ich.name} hat die eigene PIN geändert` });
    });
    bt.bremse.erfolg(ich.id, ip);
    res.json({ ok: true });
  });
};

module.exports.benutzerJson = benutzerJson;
module.exports.clientIp = clientIp;
