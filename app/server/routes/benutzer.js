'use strict';
const v = require('../validierung');
const { ungueltig, nichtGefunden, konflikt, keinZugriff } = require('../fehler');
const R = require('../rechte');
const auth = require('../auth');
const { brauche } = require('./hilfe');

/** Protokoll-Arten mit €-Bezug: nur mit preise_sehen */
const EURO_ARTEN = ['preis', 'auftrag', 'nachtrag', 'fremdleistung', 'leistung', 'budget_alarm'];

function protokollFuer(ctx, zeilen) {
  if (ctx.hat('preise_sehen')) return zeilen;
  const saeubern = (t) => {
    if (t == null) return t;
    try { return JSON.stringify(R.entferneEuroFelder(JSON.parse(t), { kalk: false })); } catch (_) { return t; }
  };
  return zeilen.filter((p) => !EURO_ARTEN.includes(p.art)).map((p) => ({ ...p, alt: saeubern(p.alt), neu: saeubern(p.neu) }));
}

function benutzerVoll(b) {
  return { id: b.id, name: b.name, rolle: b.rolle, lohngruppe: b.lohngruppe_id, baustelleId: b.baustelle_id, pnr: b.pnr, aktiv: b.aktiv === 1 };
}

module.exports = function benutzerRouten(api, bt) {
  const { db } = bt;
  const jetzt = () => bt.uhr().toISOString();

  /* ---------- Rechte ---------- */
  api.get('/rechte', brauche('benutzer'), (req, res) => {
    const namen = new Map(db.alle('SELECT id, name FROM benutzer').map((b) => [b.id, b.name]));
    res.json({
      rollen: R.ROLLEN,
      rollenNamen: R.ROLLEN_NAMEN,
      rechte: R.RECHTE,
      matrix: R.ladeMatrix(db),
      gesperrt: R.GESPERRT,
      immer: R.IMMER,
      ausnahmen: db.alle('SELECT benutzer_id, recht, erteilt, erteilt_von FROM benutzer_recht ORDER BY benutzer_id, recht')
        .map((a) => ({ benutzerId: a.benutzer_id, name: namen.get(a.benutzer_id), recht: a.recht, erteilt: a.erteilt, erteiltVon: a.erteilt_von })),
      protokoll: protokollFuer(req.ctx, db.alle('SELECT * FROM protokoll ORDER BY id DESC LIMIT 300')).map((p) => ({
        id: p.id, zeit: p.zeit, benutzerId: p.benutzer_id, name: namen.get(p.benutzer_id) || null, art: p.art, objekt: p.objekt, alt: p.alt, neu: p.neu, text: p.text
      }))
    });
  });

  api.put('/rechte/matrix', brauche('benutzer'), (req, res) => {
    const body = v.objekt(req.body);
    const rolle = v.auswahl(body.rolle, 'rolle', R.ROLLEN);
    const recht = v.auswahl(body.recht, 'recht', R.RECHT_SCHLUESSEL);
    const wert = v.bool(body.wert, 'wert');
    if (wert && R.istGesperrt(rolle, recht)) throw ungueltig(`Das Recht „${recht}“ ist für die Rolle ${R.ROLLEN_NAMEN[rolle]} gesperrt und kann nicht vergeben werden.`);
    if (!wert && R.istImmer(rolle, recht)) throw ungueltig(`Das Recht „${recht}“ kann der Rolle ${R.ROLLEN_NAMEN[rolle]} nicht entzogen werden.`);
    const alt = db.eins('SELECT wert FROM rolle_recht WHERE rolle = ? AND recht = ?', rolle, recht);
    db.transaktion(() => {
      db.lauf('INSERT INTO rolle_recht (rolle, recht, wert) VALUES (?, ?, ?) ON CONFLICT(rolle, recht) DO UPDATE SET wert = excluded.wert', rolle, recht, wert ? 1 : 0);
      db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'recht', objekt: `rolle:${rolle}`, alt: { [recht]: alt ? alt.wert === 1 : false }, neu: { [recht]: wert }, text: `Rechte-Matrix: ${R.ROLLEN_NAMEN[rolle]} – ${recht} ${wert ? 'erteilt' : 'entzogen'}` });
    });
    res.json({ ok: true, matrix: R.ladeMatrix(db) });
  });

  api.put('/rechte/ausnahme', brauche('benutzer'), (req, res) => {
    const body = v.objekt(req.body);
    const benutzerId = v.id(body.benutzerId, 'benutzerId');
    const recht = v.auswahl(body.recht, 'recht', R.RECHT_SCHLUESSEL);
    const wert = v.bool(body.wert, 'wert');
    const b = db.eins('SELECT * FROM benutzer WHERE id = ?', benutzerId);
    if (!b) throw ungueltig('Benutzer nicht gefunden.');
    if (wert && R.istGesperrt(b.rolle, recht)) throw ungueltig(`Das Recht „${recht}“ ist für die Rolle ${R.ROLLEN_NAMEN[b.rolle]} gesperrt – auch nicht als Ausnahme vergebbar.`);
    const vorher = Boolean(db.eins('SELECT 1 AS x FROM benutzer_recht WHERE benutzer_id = ? AND recht = ?', benutzerId, recht));
    db.transaktion(() => {
      if (wert) db.lauf('INSERT INTO benutzer_recht (benutzer_id, recht, erteilt_von, erteilt) VALUES (?, ?, ?, ?) ON CONFLICT(benutzer_id, recht) DO NOTHING', benutzerId, recht, req.ctx.benutzer.id, jetzt());
      else db.lauf('DELETE FROM benutzer_recht WHERE benutzer_id = ? AND recht = ?', benutzerId, recht);
      db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'recht', objekt: `benutzer:${benutzerId}`, alt: { [recht]: vorher }, neu: { [recht]: wert }, text: `Ausnahme für ${b.name}: ${recht} ${wert ? 'erteilt' : 'entfernt'}` });
    });
    res.json({ ok: true, benutzerId, recht, wert, rechte: [...R.ladeRechteFuer(db, b)] });
  });

  /* ---------- Benutzer ---------- */
  function pruefeFelder(body, teil, rolleAlt) {
    const f = {};
    if (!teil || body.name !== undefined) f.name = v.text(body.name, 'name', { max: 100 });
    if (!teil || body.rolle !== undefined) f.rolle = v.auswahl(body.rolle, 'rolle', R.ROLLEN);
    if (body.lohngruppe !== undefined) {
      if (body.lohngruppe === null || body.lohngruppe === '') f.lohngruppe_id = null;
      else {
        if (typeof body.lohngruppe !== 'string' || !db.eins('SELECT id FROM lohngruppe WHERE id = ?', body.lohngruppe)) throw ungueltig('lohngruppe ist unbekannt.');
        f.lohngruppe_id = body.lohngruppe;
      }
    }
    if (body.baustelleId !== undefined) {
      if (body.baustelleId === null) f.baustelle_id = null;
      else {
        const id = v.id(body.baustelleId, 'baustelleId');
        if (!db.eins('SELECT id FROM baustelle WHERE id = ?', id)) throw ungueltig('baustelleId: Baustelle nicht gefunden.');
        f.baustelle_id = id;
      }
    }
    if (body.pnr !== undefined) f.pnr = v.zahl(body.pnr, 'pnr', { min: 1, max: 999999, ganz: true, pflicht: false });
    if (f.pnr != null) {
      const vergeben = db.eins('SELECT id, name FROM benutzer WHERE pnr = ?', f.pnr);
      if (vergeben && vergeben.id !== body.__id) throw konflikt(`Die Personalnummer ${f.pnr} ist bereits an ${vergeben.name} vergeben.`);
    }
    if (body.aktiv !== undefined) f.aktiv = v.bool(body.aktiv, 'aktiv') ? 1 : 0;
    let pin = null;
    if (!teil || body.pin !== undefined) {
      const fehler = auth.pinFehler(body.pin, f.rolle || rolleAlt);
      if (fehler) throw ungueltig(`pin: ${fehler}`);
      pin = body.pin;
    }
    return { f, pin };
  }

  api.get('/benutzer', brauche('benutzer'), (req, res) => {
    res.json(db.alle('SELECT * FROM benutzer ORDER BY name').map(benutzerVoll));
  });

  api.post('/benutzer', brauche('benutzer'), async (req, res) => {
    const { f, pin } = pruefeFelder(v.objekt(req.body), false);
    f.pin_hash = await auth.hashPin(pin);
    f.muss_pin_aendern = 1; // Start-PIN muss beim ersten Anmelden geändert werden
    f.erstellt = jetzt();
    if (f.aktiv === undefined) f.aktiv = 1;
    const k = Object.keys(f);
    const r = db.lauf(`INSERT INTO benutzer (${k.join(', ')}) VALUES (${k.map(() => '?').join(', ')})`, ...k.map((x) => f[x]));
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'benutzer', objekt: `benutzer:${r.id}`, neu: { name: f.name, rolle: f.rolle, lohngruppe: f.lohngruppe_id ?? null }, text: `Benutzer ${f.name} angelegt` });
    res.status(201).json(benutzerVoll(db.eins('SELECT * FROM benutzer WHERE id = ?', r.id)));
  });

  api.put('/benutzer/:id', brauche('benutzer'), async (req, res) => {
    const id = v.pfadId(req.params.id, 'Benutzer-ID');
    const alt = db.eins('SELECT * FROM benutzer WHERE id = ?', id);
    if (!alt) throw nichtGefunden('Benutzer nicht gefunden.');
    const body = v.objekt(req.body);
    const { f, pin } = pruefeFelder({ ...body, __id: id }, true, alt.rolle);
    if (!Object.keys(f).length && !pin) throw ungueltig('Keine Änderungen angegeben.');
    if (id === req.ctx.benutzer.id && ((f.rolle && f.rolle !== alt.rolle) || f.aktiv === 0)) {
      throw keinZugriff('Die eigene Rolle kann niemand selbst ändern, und man kann sich nicht selbst deaktivieren.');
    }
    // Aussperren verhindern: mindestens eine aktive Geschäftsführung bleibt
    const verliertGf = alt.rolle === 'gf' && ((f.rolle && f.rolle !== 'gf') || f.aktiv === 0);
    if (verliertGf && db.eins("SELECT COUNT(*) AS n FROM benutzer WHERE rolle = 'gf' AND aktiv = 1 AND id <> ?", id).n === 0) {
      throw konflikt('Mindestens eine aktive Geschäftsführung muss bestehen bleiben.');
    }
    if (pin) { f.pin_hash = await auth.hashPin(pin); f.muss_pin_aendern = 1; }
    const k = Object.keys(f);
    db.transaktion(() => {
      db.lauf(`UPDATE benutzer SET ${k.map((x) => `${x} = ?`).join(', ')} WHERE id = ?`, ...k.map((x) => f[x]), id);
      // Ausnahmen, die für die neue Rolle gesperrt sind, entfernen
      if (f.rolle && f.rolle !== alt.rolle) {
        for (const r of R.GESPERRT[f.rolle]) db.lauf('DELETE FROM benutzer_recht WHERE benutzer_id = ? AND recht = ?', id, r);
      }
      if (pin || f.aktiv === 0 || (f.rolle && f.rolle !== alt.rolle)) auth.beendeAlleSitzungen(db, id);
      if (pin) bt.bremse.entsperre(id);
      const altW = {}, neuW = {};
      for (const x of k) {
        if (x === 'pin_hash' || x === 'muss_pin_aendern') continue;
        altW[x] = alt[x]; neuW[x] = f[x];
      }
      if (pin) neuW.pin = 'zurückgesetzt';
      db.protokolliere({
        zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: f.rolle && f.rolle !== alt.rolle ? 'rolle' : 'benutzer', objekt: `benutzer:${id}`,
        alt: altW, neu: neuW, text: `Benutzer ${alt.name} geändert${pin ? ' (PIN zurückgesetzt)' : ''}`
      });
    });
    res.json(benutzerVoll(db.eins('SELECT * FROM benutzer WHERE id = ?', id)));
  });
};
