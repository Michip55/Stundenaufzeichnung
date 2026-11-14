'use strict';
const v = require('../validierung');
const { ungueltig, nichtGefunden, konflikt, keinZugriff } = require('../fehler');
const R = require('../rechte');
const auth = require('../auth');
const { brauche } = require('./hilfe');
const L = require('../lohngruppen');
const { wienDatum } = require('../datum');

/** Protokoll-Arten mit €-Bezug: nur mit preise_sehen */
/** Rollenwechsel, die das Büro vornehmen darf (D-02) */
const BUERO_ROLLENWECHSEL = ['mitarbeiter', 'polier'];
const { benachrichtige, empfaengerMitRecht } = require('../benachrichtigung');

const EURO_ARTEN = ['preis', 'auftrag', 'nachtrag', 'fremdleistung', 'leistung', 'budget_alarm', 'katalog', 'nachkalkulation'];

function protokollFuer(ctx, zeilen) {
  if (ctx.hat('preise_sehen')) return zeilen;
  const saeubern = (t) => {
    if (t == null) return t;
    try { return JSON.stringify(R.entferneEuroFelder(JSON.parse(t), { kalk: false })); } catch (_) { return t; }
  };
  return zeilen.filter((p) => !EURO_ARTEN.includes(p.art)).map((p) => ({ ...p, alt: saeubern(p.alt), neu: saeubern(p.neu) }));
}

/** Dienstliche Telefonnummer (12.8d): Ziffern, +, Leerzeichen, ≤ 30 */
function telefonPruefen(t) {
  if (t === null || t === '') return null;
  if (typeof t !== 'string' || t.length > 30 || !/^\+?[0-9 ]{3,30}$/.test(t.trim())) throw ungueltig('telefon: nur Ziffern, + und Leerzeichen (höchstens 30 Zeichen).');
  return t.trim();
}

function benutzerVoll(b) {
  return { id: b.id, name: b.name, rolle: b.rolle, lohngruppe: b.lohngruppe_id, baustelleId: b.baustelle_id, pnr: b.pnr, aktiv: b.aktiv === 1, telefon: b.telefon || null, standardKostenstelleId: b.standard_kostenstelle_id || null };
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
  function pruefeFelder(body, teil, rolleAlt, eigeneId = null) {
    const f = {};
    if (!teil || body.name !== undefined) f.name = v.text(body.name, 'name', { max: 100 });
    if (!teil || body.rolle !== undefined) f.rolle = v.auswahl(body.rolle, 'rolle', R.ROLLEN);
    if (body.telefon !== undefined) f.telefon = telefonPruefen(body.telefon); // 12.8d
    if (body.lohngruppe !== undefined) {
      if (body.lohngruppe === null || body.lohngruppe === '') f.lohngruppe_id = null;
      else {
        if (typeof body.lohngruppe !== 'string' || !db.eins('SELECT id FROM lohngruppe WHERE id = ?', body.lohngruppe)) throw ungueltig('lohngruppe ist unbekannt.');
        if (!db.eins('SELECT id FROM lohngruppe WHERE id = ? AND aktiv = 1', body.lohngruppe)) throw ungueltig('Die Lohngruppe ist deaktiviert.');
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
    if (body.standardKostenstelleId !== undefined) { // 12.25: Standard beim Einstempeln (z. B. Büro, Werkstatt)
      if (body.standardKostenstelleId === null) f.standard_kostenstelle_id = null;
      else {
        const id = v.id(body.standardKostenstelleId, 'standardKostenstelleId');
        const bs = db.eins("SELECT id FROM baustelle WHERE id = ? AND status <> 'abgeschlossen'", id);
        if (!bs) throw ungueltig('standardKostenstelleId: Kostenstelle nicht gefunden oder abgeschlossen.');
        f.standard_kostenstelle_id = id;
      }
    }
    if (body.pnr !== undefined) f.pnr = v.zahl(body.pnr, 'pnr', { min: 1, max: 999999, ganz: true, pflicht: false });
    if (f.pnr != null) {
      const vergeben = db.eins('SELECT id, name FROM benutzer WHERE pnr = ?', f.pnr);
      if (vergeben && vergeben.id !== eigeneId) throw konflikt(`Die Personalnummer ${f.pnr} ist bereits an ${vergeben.name} vergeben.`);
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

  const verwalterPruefen = (req, res, next) => (R.darfBenutzerVerwalten(req.ctx) ? next() : next(keinZugriff()));

  api.get('/benutzer', verwalterPruefen, (req, res) => {
    const jetztIso = bt.uhr().toISOString();
    const sperren = new Map(db.alle('SELECT benutzer_id, gesperrt_seit, gesperrt_bis FROM login_konto WHERE gesperrt = 1 AND gesperrt_bis > ?', jetztIso).map((k) => [k.benutzer_id, k]));
    res.json(db.alle('SELECT * FROM benutzer ORDER BY name').map((b) => {
      const k = sperren.get(b.id);
      return { ...benutzerVoll(b), gesperrt: Boolean(k), ...(k ? { gesperrtSeit: k.gesperrt_seit, gesperrtBis: k.gesperrt_bis } : {}) };
    }));
  });

  api.post('/benutzer', verwalterPruefen, async (req, res) => {
    const { f, pin } = pruefeFelder(v.objekt(req.body), false);
    if (!R.darfBenutzerVerwalten(req.ctx, f.rolle)) throw keinZugriff('Benutzer der Rollen Büro und Geschäftsführung legt nur die GF an.');
    if (!req.ctx.hat('benutzer') && !BUERO_ROLLENWECHSEL.includes(f.rolle)) throw keinZugriff('Bauleiter legt nur die Geschäftsführung an (Büro: Mitarbeiter und Poliere).');
    if (f.pnr == null) {
      const max = db.eins('SELECT MAX(pnr) AS m FROM benutzer').m;
      f.pnr = Math.max(1000, max || 0) + 1; // nächste freie Personalnummer (C-12)
    }
    f.pin_hash = await auth.hashPin(pin);
    f.pin_laenge = pin.length;
    f.muss_pin_aendern = 1; // Start-PIN muss beim ersten Anmelden geändert werden
    f.erstellt = jetzt();
    if (f.aktiv === undefined) f.aktiv = 1;
    const k = Object.keys(f);
    const r = db.lauf(`INSERT INTO benutzer (${k.join(', ')}) VALUES (${k.map(() => '?').join(', ')})`, ...k.map((x) => f[x]));
    if (f.lohngruppe_id) db.lauf('INSERT INTO benutzer_lohngruppe (benutzer_id, lohngruppe_id, gueltig_ab, erstellt, erstellt_von) VALUES (?, ?, ?, ?, ?)', r.id, f.lohngruppe_id, L.BASIS, jetzt(), req.ctx.benutzer.id); // 12.22
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'benutzer', objekt: `benutzer:${r.id}`, neu: { name: f.name, rolle: f.rolle, lohngruppe: f.lohngruppe_id ?? null }, text: `Benutzer ${f.name} angelegt` });
    res.status(201).json(benutzerVoll(db.eins('SELECT * FROM benutzer WHERE id = ?', r.id)));
  });

  api.put('/benutzer/:id', verwalterPruefen, async (req, res) => {
    const id = v.pfadId(req.params.id, 'Benutzer-ID');
    const alt = db.eins('SELECT * FROM benutzer WHERE id = ?', id);
    if (!alt) throw nichtGefunden('Benutzer nicht gefunden.');
    if (!R.darfBenutzerVerwalten(req.ctx, alt.rolle)) throw keinZugriff('Benutzer der Rollen Büro und Geschäftsführung verwaltet nur die GF.');
    const body = v.objekt(req.body);
    const { f, pin } = pruefeFelder(body, true, alt.rolle, id);
    // 12.22: Lohngruppe als Verlaufseintrag (stichtaggenau), nicht direkt überschreiben
    let lgNeu;
    const heute = wienDatum(bt.uhr());
    if (body.lohngruppeGueltigAb !== undefined && body.lohngruppe === undefined) throw ungueltig('lohngruppeGueltigAb nur zusammen mit lohngruppe.');
    if ('lohngruppe_id' in f) {
      lgNeu = { id: f.lohngruppe_id, gueltigAb: L.pruefeGueltigAb(body.lohngruppeGueltigAb, body.lohngruppeRueckwirkend, heute), explizit: body.lohngruppeGueltigAb != null && body.lohngruppeGueltigAb !== '' };
      delete f.lohngruppe_id;
    }
    if (f.rolle && !R.darfBenutzerVerwalten(req.ctx, f.rolle)) throw keinZugriff('Die Rollen Büro und Geschäftsführung vergibt nur die GF.');
    const rollenwechsel = Boolean(f.rolle && f.rolle !== alt.rolle);
    if (rollenwechsel && !req.ctx.hat('benutzer') && !(BUERO_ROLLENWECHSEL.includes(alt.rolle) && BUERO_ROLLENWECHSEL.includes(f.rolle))) {
      throw keinZugriff('Zum oder vom Bauleiter macht nur die Geschäftsführung (Büro: Mitarbeiter ↔ Polier).');
    }
    if (!Object.keys(f).length && !pin && !lgNeu) throw ungueltig('Keine Änderungen angegeben.');
    if (id === req.ctx.benutzer.id && ((f.rolle && f.rolle !== alt.rolle) || f.aktiv === 0)) {
      throw keinZugriff('Die eigene Rolle kann niemand selbst ändern, und man kann sich nicht selbst deaktivieren.');
    }
    // Aussperren verhindern: mindestens eine aktive Geschäftsführung bleibt
    const verliertGf = alt.rolle === 'gf' && ((f.rolle && f.rolle !== 'gf') || f.aktiv === 0);
    if (verliertGf && db.eins("SELECT COUNT(*) AS n FROM benutzer WHERE rolle = 'gf' AND aktiv = 1 AND id <> ?", id).n === 0) {
      throw konflikt('Mindestens eine aktive Geschäftsführung muss bestehen bleiben.');
    }
    if (pin) { f.pin_hash = await auth.hashPin(pin); f.pin_laenge = pin.length; f.muss_pin_aendern = 1; }
    // D-02: neue Rolle mit Mindestlänge 6 und kürzere/unbekannte PIN → PIN-Wechsel erzwingen
    if (rollenwechsel && !auth.FELD_ROLLEN.includes(f.rolle) && !pin && !(alt.pin_laenge >= 6)) f.muss_pin_aendern = 1;
    const k = Object.keys(f);
    const entfernt = [];
    let lgErg = null;
    db.transaktion(() => {
      if (k.length) db.lauf(`UPDATE benutzer SET ${k.map((x) => `${x} = ?`).join(', ')} WHERE id = ?`, ...k.map((x) => f[x]), id);
      if (lgNeu) {
        lgErg = L.setzen(db, { benutzerId: id, lohngruppeId: lgNeu.id, gueltigAb: lgNeu.gueltigAb, von: req.ctx.benutzer.id, zeit: jetzt(), explizit: lgNeu.explizit });
        L.abgleichen(db, heute, id);
        db.protokolliere({
          zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'benutzer', objekt: `benutzer:${id}`,
          alt: { lohngruppe: lgErg.ersetzt !== undefined ? lgErg.ersetzt : lgErg.alt, gueltigAb: lgErg.gueltigAb }, neu: { lohngruppe: lgErg.neu, gueltigAb: lgErg.gueltigAb, ...(lgErg.ersetzt !== undefined ? { ersetzt: true } : {}) },
          text: `Lohngruppe ${alt.name}: ${lgErg.alt || '–'} → ${lgErg.neu || '–'} ab ${lgErg.gueltigAb.split('-').reverse().join('.')}${lgErg.gueltigAb < heute ? ' (rückwirkend)' : ''}`
        });
      }
      // Ausnahmen, die für die neue Rolle gesperrt sind, entfernen
      if (rollenwechsel) {
        for (const r of R.GESPERRT[f.rolle]) db.lauf('DELETE FROM benutzer_recht WHERE benutzer_id = ? AND recht = ?', id, r);
        // D-11: unpassende Zuordnungen räumen
        if (!['bauleiter', 'gf'].includes(f.rolle)) {
          for (const b of db.alle('SELECT id, kst FROM baustelle WHERE bauleiter_id = ?', id)) entfernt.push({ baustelleId: b.id, kst: b.kst, feld: 'bauleiterId' });
          db.lauf('UPDATE baustelle SET bauleiter_id = NULL, version = version + 1 WHERE bauleiter_id = ?', id);
        }
        if (f.rolle !== 'polier') {
          for (const b of db.alle('SELECT id, kst FROM baustelle WHERE polier_id = ?', id)) entfernt.push({ baustelleId: b.id, kst: b.kst, feld: 'polierId' });
          db.lauf('UPDATE baustelle SET polier_id = NULL, version = version + 1 WHERE polier_id = ?', id);
        }
        // D-02: Rollenwechsel durch das Büro → GF informieren
        if (!req.ctx.hat('benutzer')) {
          for (const g of empfaengerMitRecht(db, 'benutzer')) { // 15.3: GF über ihr Recht
            benachrichtige(db, { benutzerId: g.id, typ: 'sicherheit', titel: `Rollenwechsel: ${alt.name}`, text: `${req.ctx.benutzer.name} hat ${alt.name} von ${R.ROLLEN_NAMEN[alt.rolle]} zu ${R.ROLLEN_NAMEN[f.rolle]} geändert.`, zeit: jetzt(), schluessel: `rolle:${id}:${jetzt()}` });
          }
        }
      }
      if (pin || f.aktiv === 0 || (f.rolle && f.rolle !== alt.rolle)) auth.beendeAlleSitzungen(db, id);
      if (pin) { bt.bremse.entsperre(id); bt.bremse.kontoEntsperren(id); }
      const altW = {}, neuW = {};
      for (const x of k) {
        if (['pin_hash', 'muss_pin_aendern', 'pin_laenge'].includes(x)) continue;
        altW[x] = alt[x]; neuW[x] = f[x];
      }
      if (pin) neuW.pin = 'zurückgesetzt';
      if (entfernt.length) neuW.zuordnungenEntfernt = entfernt;
      if (k.length || pin) db.protokolliere({
        zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: f.rolle && f.rolle !== alt.rolle ? 'rolle' : 'benutzer', objekt: `benutzer:${id}`,
        alt: altW, neu: neuW, text: `Benutzer ${alt.name} geändert${pin ? ' (PIN zurückgesetzt)' : ''}`
      });
    });
    // 12.22: Budget-Alarme neu prüfen, wenn schon gerechnete Tage betroffen sind
    if (lgErg && lgErg.gueltigAb <= heute) {
      const B = require('../budget');
      for (const bsId of L.betroffeneBaustellen(db, id, lgErg.gueltigAb)) B.pruefeBudget(bt, bsId, { anlass: 'Lohngruppe geändert', benutzerId: req.ctx.benutzer.id });
    }
    res.json({ ...benutzerVoll(db.eins('SELECT * FROM benutzer WHERE id = ?', id)), ...(entfernt.length ? { zuordnungenEntfernt: entfernt } : {}), ...(lgNeu ? { lohngruppeVerlauf: L.verlaufJson(db, id, heute) } : {}) });
  });

  /* ---------- Lohngruppen-Verlauf (12.22, vertraulich) ---------- */
  const darfLohngruppeSehen = (ctx) => ctx.hat('stammdaten') || ctx.hat('lohn') || ctx.hat('benutzer');
  api.get('/benutzer/:id/lohngruppen-verlauf', (req, res) => {
    if (!darfLohngruppeSehen(req.ctx)) throw keinZugriff('Die Lohngruppe ist vertraulich.');
    const id = v.pfadId(req.params.id, 'Benutzer-ID');
    if (!db.eins('SELECT id FROM benutzer WHERE id = ?', id)) throw nichtGefunden('Benutzer nicht gefunden.');
    res.json(L.verlaufJson(db, id, wienDatum(bt.uhr())));
  });
  api.delete('/benutzer/:id/lohngruppen-verlauf/:vid', verwalterPruefen, (req, res) => {
    const id = v.pfadId(req.params.id, 'Benutzer-ID');
    const b = db.eins('SELECT * FROM benutzer WHERE id = ?', id);
    if (!b) throw nichtGefunden('Benutzer nicht gefunden.');
    if (!R.darfBenutzerVerwalten(req.ctx, b.rolle)) throw keinZugriff('Benutzer der Rollen Büro und Geschäftsführung verwaltet nur die GF.');
    const e = db.eins('SELECT * FROM benutzer_lohngruppe WHERE id = ? AND benutzer_id = ?', v.pfadId(req.params.vid, 'Eintrag-ID'), id);
    if (!e) throw nichtGefunden('Eintrag nicht gefunden.');
    const heute = wienDatum(bt.uhr());
    if (e.gueltig_ab <= heute) throw konflikt('Nur künftige Lohngruppen-Einträge können gelöscht werden. Für die Vergangenheit einen neuen Eintrag (rückwirkend) setzen.');
    db.transaktion(() => {
      db.lauf('DELETE FROM benutzer_lohngruppe WHERE id = ?', e.id);
      L.abgleichen(db, heute, id);
      db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'benutzer', objekt: `benutzer:${id}`, alt: { lohngruppe: e.lohngruppe_id, gueltigAb: e.gueltig_ab }, neu: null, text: `Künftige Lohngruppe ${e.lohngruppe_id || '–'} ab ${e.gueltig_ab.split('-').reverse().join('.')} für ${b.name} gelöscht` });
    });
    res.json({ ok: true, lohngruppeVerlauf: L.verlaufJson(db, id, heute) });
  });

  /** Konto entsperren (C-07): Büro für Mitarbeiter/Polier/Bauleiter, GF für alle */
  api.post('/benutzer/:id/entsperren', verwalterPruefen, (req, res) => {
    const id = v.pfadId(req.params.id, 'Benutzer-ID');
    const b = db.eins('SELECT * FROM benutzer WHERE id = ?', id);
    if (!b) throw nichtGefunden('Benutzer nicht gefunden.');
    // D-01: Büro darf auch GF-/Büro-Konten ENTSPERREN (nur entsperren), damit sich die Verwaltung nicht aussperrt
    if (!R.darfBenutzerVerwalten(req.ctx)) throw keinZugriff();
    if (id === req.ctx.benutzer.id) throw keinZugriff('Das eigene Konto entsperrt eine andere Person.');
    db.transaktion(() => {
      bt.bremse.entsperre(id);
      bt.bremse.kontoEntsperren(id);
      db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'benutzer', objekt: `benutzer:${id}`, text: `Anmeldung von ${b.name} entsperrt` });
    });
    res.json({ ok: true });
  });
};

module.exports.telefonPruefen = telefonPruefen;
