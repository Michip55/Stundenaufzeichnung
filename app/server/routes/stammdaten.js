'use strict';
const v = require('../validierung');
const { ungueltig, keinZugriff, nichtGefunden, konflikt } = require('../fehler');
const { darfPreise, darfKalk, bereich, baustelleImBereich } = require('../rechte');
const { kalkulationFuer, parseJson, ladePreise } = require('../daten');
const { pruefeBudget } = require('../budget');
const { brauche, baustelleAusPfad } = require('./hilfe');
const { wienDatum, plusTage } = require('../datum');

const BS_STATUS = ['geplant', 'aktiv', 'abgeschlossen'];

/** Baustelle als JSON – €/Budget-Felder nur mit Recht (Bauleiter nur eigene) */
function baustelleJson(db, ctx, bs, { detail = false, preise } = {}) {
  const o = {
    id: bs.id, kst: bs.kst, name: bs.name, kurz: bs.kurz, auftraggeber: bs.auftraggeber, agAdresse: bs.ag_adresse,
    bauvorhaben: bs.bauvorhaben, adresse: bs.adresse, bauherrVertreter: bs.bauherr_vertreter, art: bs.art,
    status: bs.status, intern: bs.intern === 1, polierId: bs.polier_id, bauleiterId: bs.bauleiter_id,
    beginn: bs.beginn, ende: bs.ende, version: bs.version
  };
  const mitPreisen = darfPreise(ctx, bs);
  const mitKalk = darfKalk(ctx, bs);
  if (mitPreisen) o.auftragssumme = bs.auftragssumme;
  if (mitKalk && !bs.intern) {
    const k = kalkulationFuer(db, bs, preise);
    o.budgetVerbrauchProzent = k.budgetVerbrauchProzent;
    o.leistungsstandProzent = k.leistungsstandProzent;
    o.budgetStatus = k.status;
    if (detail) {
      o.schwellen = parseJson(bs.schwellen, [80, 90, 100]);
      o.empfaenger = parseJson(bs.empfaenger, { bauleiter: true, buero: true, gf: true });
    }
    if (detail && mitPreisen) {
      o.nachtraege = k.nachtraege;
      o.auftragGesamt = k.auftragGesamt;
    }
  }
  return o;
}

function sichtbar(ctx, bs) {
  if (bereich(ctx.benutzer) !== 'partie') return true;
  return bs.status === 'aktiv' || baustelleImBereich(ctx.benutzer, bs);
}

function pruefeBenutzerRolle(db, id, rollen, feld) {
  if (id === null) return null;
  const b = db.eins('SELECT id, rolle, aktiv FROM benutzer WHERE id = ?', v.id(id, feld));
  if (!b) throw ungueltig(`${feld}: Benutzer nicht gefunden.`);
  if (!rollen.includes(b.rolle)) throw ungueltig(`${feld}: Benutzer hat nicht die passende Rolle (${rollen.join('/')}).`);
  return b.id;
}

/** Optimistische Sperre (C-08): version muss zum gespeicherten Stand passen */
function pruefeVersion(body, aktuell, was = 'Die Baustelle') {
  const version = v.zahl(body.version, 'version', { min: 1, max: 1e9, ganz: true });
  if (version !== aktuell) throw konflikt(`${was} wurde inzwischen von jemand anderem geändert. Bitte neu laden und die Änderung wiederholen.`, { version: aktuell });
}

/** Bauleiter-/Polier-Zuordnung ändern nur Büro und GF (C-05) */
function pruefeZuordnung(ctx, body) {
  if ((body.bauleiterId !== undefined || body.polierId !== undefined) && !['buero', 'gf'].includes(ctx.benutzer.rolle)) {
    throw keinZugriff('Bauleiter und Polier einer Baustelle ordnet nur das Büro bzw. die Geschäftsführung zu.');
  }
}

function baustellenFelder(db, body, teil) {
  const f = {};
  const t = (k, feld, max = 200, pflicht = false) => { if (body[k] !== undefined) f[feld] = v.text(body[k], k, { max, pflicht, min: pflicht ? 1 : 0 }); };
  if (!teil || body.kst !== undefined) {
    const kst = v.text(body.kst, 'kst', { max: 20 });
    if (!/^\d{2}-\d{3}$/.test(kst)) throw ungueltig('kst muss das Format NN-NNN haben (z. B. 26-041).');
    f.kst = kst;
  }
  if (!teil || body.name !== undefined) f.name = v.text(body.name, 'name', { max: 200 });
  t('kurz', 'kurz', 60); t('auftraggeber', 'auftraggeber'); t('agAdresse', 'ag_adresse'); t('bauvorhaben', 'bauvorhaben', 500);
  t('adresse', 'adresse'); t('bauherrVertreter', 'bauherr_vertreter'); t('art', 'art', 100);
  if (body.status !== undefined) f.status = v.auswahl(body.status, 'status', BS_STATUS);
  if (body.intern !== undefined) f.intern = v.bool(body.intern, 'intern') ? 1 : 0;
  if (body.polierId !== undefined) f.polier_id = pruefeBenutzerRolle(db, body.polierId, ['polier'], 'polierId');
  if (body.bauleiterId !== undefined) f.bauleiter_id = pruefeBenutzerRolle(db, body.bauleiterId, ['bauleiter', 'gf'], 'bauleiterId');
  if (body.beginn !== undefined) f.beginn = v.datum(body.beginn, 'beginn', { pflicht: false });
  if (body.ende !== undefined) f.ende = v.datum(body.ende, 'ende', { pflicht: false });
  return f;
}

module.exports = function stammdatenRouten(api, bt) {
  const { db } = bt;
  const jetzt = () => bt.uhr().toISOString();

  /* ---------- Baustellen ---------- */
  api.get('/baustellen', (req, res) => {
    const preise = ladePreise(db);
    const liste = db.alle('SELECT * FROM baustelle ORDER BY intern, kst')
      .filter((bs) => sichtbar(req.ctx, bs))
      .map((bs) => baustelleJson(db, req.ctx, bs, { preise }));
    res.json(liste);
  });

  api.get('/baustellen/:id', (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    if (!sichtbar(req.ctx, bs)) throw nichtGefunden('Baustelle nicht gefunden.');
    res.json(baustelleJson(db, req.ctx, bs, { detail: true }));
  });

  api.post('/baustellen', brauche('stammdaten'), (req, res) => {
    pruefeZuordnung(req.ctx, v.objekt(req.body));
    const f = baustellenFelder(db, v.objekt(req.body), false);
    if (db.eins('SELECT id FROM baustelle WHERE kst = ?', f.kst)) throw konflikt(`Die Kostenstelle ${f.kst} gibt es bereits.`);
    f.erstellt = jetzt();
    const spalten = Object.keys(f);
    const r = db.lauf(`INSERT INTO baustelle (${spalten.join(', ')}) VALUES (${spalten.map(() => '?').join(', ')})`, ...spalten.map((k) => f[k]));
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'stammdaten', objekt: `baustelle:${r.id}`, neu: f, text: `Baustelle ${f.kst} angelegt` });
    res.status(201).json(baustelleJson(db, req.ctx, db.eins('SELECT * FROM baustelle WHERE id = ?', r.id), { detail: true }));
  });

  api.put('/baustellen/:id', brauche('stammdaten'), (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    const body = v.objekt(req.body);
    pruefeZuordnung(req.ctx, body);
    const f = baustellenFelder(db, body, true);
    if (!Object.keys(f).length) throw ungueltig('Keine Änderungen angegeben.');
    pruefeVersion(body, bs.version);
    if (f.kst && f.kst !== bs.kst && db.eins('SELECT id FROM baustelle WHERE kst = ?', f.kst)) throw konflikt(`Die Kostenstelle ${f.kst} gibt es bereits.`);
    const spalten = Object.keys(f);
    db.lauf(`UPDATE baustelle SET ${spalten.map((k) => `${k} = ?`).join(', ')}, version = version + 1 WHERE id = ?`, ...spalten.map((k) => f[k]), bs.id);
    const alt = {};
    for (const k of spalten) alt[k] = bs[k];
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'stammdaten', objekt: `baustelle:${bs.id}`, alt, neu: f, text: `Baustelle ${bs.kst} geändert` });
    res.json(baustelleJson(db, req.ctx, db.eins('SELECT * FROM baustelle WHERE id = ?', bs.id), { detail: true }));
  });

  api.put('/baustellen/:id/auftrag', brauche('preise_bearbeiten'), (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    const body = v.objekt(req.body);
    const f = {};
    if (body.auftragssumme !== undefined) f.auftragssumme = v.betrag(body.auftragssumme, 'auftragssumme', { pflicht: false });
    if (body.schwellen !== undefined) {
      const s = v.liste(body.schwellen, 'schwellen', { max: 5 });
      if (!s.length) throw ungueltig('schwellen: mindestens eine Schwelle angeben.');
      s.forEach((x, i) => v.zahl(x, `schwellen[${i}]`, { min: 1, max: 200, ganz: true }));
      if (new Set(s).size !== s.length) throw ungueltig('schwellen: doppelte Werte.');
      f.schwellen = JSON.stringify([...s].sort((a, b) => a - b));
    }
    if (body.empfaenger !== undefined) {
      const e = v.objekt(body.empfaenger, 'empfaenger');
      const o = {};
      for (const k of Object.keys(e)) {
        if (!['bauleiter', 'buero', 'gf'].includes(k)) throw ungueltig(`empfaenger.${k} ist unbekannt (erlaubt: bauleiter, buero, gf). Polier und Mitarbeiter erhalten nie Budget-Alarme.`);
        o[k] = v.bool(e[k], `empfaenger.${k}`);
      }
      f.empfaenger = JSON.stringify({ bauleiter: true, buero: true, gf: true, ...o });
    }
    if (!Object.keys(f).length) throw ungueltig('Keine Änderungen angegeben.');
    pruefeVersion(body, bs.version, 'Auftrag und Budget-Einstellungen');
    const spalten = Object.keys(f);
    db.lauf(`UPDATE baustelle SET ${spalten.map((k) => `${k} = ?`).join(', ')}, version = version + 1 WHERE id = ?`, ...spalten.map((k) => f[k]), bs.id);
    const alt = {};
    for (const k of spalten) alt[k] = bs[k];
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'auftrag', objekt: `baustelle:${bs.id}`, alt, neu: f, text: `Auftragssumme/Budget-Einstellungen ${bs.kst} geändert` });
    pruefeBudget(bt, bs.id, { anlass: 'Änderung der Auftragssumme', benutzerId: req.ctx.benutzer.id });
    res.json(baustelleJson(db, req.ctx, db.eins('SELECT * FROM baustelle WHERE id = ?', bs.id), { detail: true }));
  });

  api.post('/baustellen/:id/nachtraege', brauche('preise_bearbeiten'), (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    const body = v.objekt(req.body);
    const text = v.text(body.text, 'text', { max: 300 });
    const betrag = v.betrag(body.betrag, 'betrag', { min: -1e8, max: 1e8 });
    const r = db.lauf('INSERT INTO nachtrag (baustelle_id, text, betrag, erstellt, erstellt_von) VALUES (?, ?, ?, ?, ?)', bs.id, text, betrag, jetzt(), req.ctx.benutzer.id);
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'nachtrag', objekt: `baustelle:${bs.id}`, neu: { id: r.id, text, betrag }, text: `Nachtrag zu ${bs.kst} erfasst` });
    pruefeBudget(bt, bs.id, { anlass: 'Nachtrag', benutzerId: req.ctx.benutzer.id });
    res.status(201).json({ id: r.id, text, betrag });
  });

  api.delete('/baustellen/:id/nachtraege/:nid', brauche('preise_bearbeiten'), (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    const nid = v.pfadId(req.params.nid, 'Nachtrags-ID');
    const n = db.eins('SELECT * FROM nachtrag WHERE id = ? AND baustelle_id = ?', nid, bs.id);
    if (!n) throw nichtGefunden('Nachtrag nicht gefunden.');
    db.lauf('DELETE FROM nachtrag WHERE id = ?', nid);
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'nachtrag', objekt: `baustelle:${bs.id}`, alt: { id: n.id, text: n.text, betrag: n.betrag }, text: `Nachtrag zu ${bs.kst} gelöscht` });
    pruefeBudget(bt, bs.id, { anlass: 'Löschen eines Nachtrags', benutzerId: req.ctx.benutzer.id });
    res.json({ ok: true });
  });

  /** Buchungsdatum für Leistung/Fremdleistung: nicht in der Zukunft, höchstens 2 Jahre zurück */
  function buchungsDatum(wert) {
    const datum = v.datum(wert, 'datum');
    const heute = wienDatum(bt.uhr());
    if (datum > heute) throw ungueltig('datum darf nicht in der Zukunft liegen.');
    if (datum < plusTage(heute, -731)) throw ungueltig('datum liegt mehr als 2 Jahre zurück.');
    return datum;
  }
  const darfLeistung = (ctx, bs) => ctx.hat('preise_bearbeiten') || (ctx.benutzer.rolle === 'bauleiter' && bs.bauleiter_id === ctx.benutzer.id);

  api.get('/baustellen/:id/leistungen', (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    if (!darfKalk(req.ctx, bs) && !req.ctx.hat('preise_bearbeiten')) throw keinZugriff('Leistungsmeldungen sehen Bauleitung (eigene Baustellen), Büro und GF.');
    const mitPreis = darfPreise(req.ctx, bs);
    res.json(db.alle(`SELECT m.*, l.code, l.text, l.einheit, l.ep, b.name AS von_name FROM leistungsmeldung m JOIN leistung l ON l.id = m.leistung_id
        LEFT JOIN benutzer b ON b.id = m.erstellt_von WHERE m.baustelle_id = ? ORDER BY m.datum DESC, m.id DESC`, bs.id).map((m) => {
      const o = { id: m.id, leistungId: m.leistung_id, code: m.code, text: m.text, einheit: m.einheit, menge: m.menge, datum: m.datum, erstellt: m.erstellt, erstelltVon: m.erstellt_von, erstelltVonName: m.von_name };
      if (mitPreis) { o.ep = m.ep; o.betrag = Math.round(m.menge * m.ep * 100) / 100; }
      return o;
    }));
  });

  api.post('/baustellen/:id/leistungen', (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    const ich = req.ctx.benutzer;
    if (!darfLeistung(req.ctx, bs)) throw keinZugriff('Leistungsmeldungen erfassen dürfen Büro, Geschäftsführung und der Bauleiter der Baustelle.');
    const body = v.objekt(req.body);
    const leistungId = v.id(body.leistungId, 'leistungId');
    const l = db.eins('SELECT id, code, text FROM leistung WHERE id = ?', leistungId);
    if (!l) throw ungueltig('leistungId: Leistungsposition nicht gefunden.');
    const menge = v.zahl(body.menge, 'menge', { min: 0.001, max: 100000 });
    const datum = buchungsDatum(body.datum);
    const r = db.transaktion(() => {
      const r2 = db.lauf('INSERT INTO leistungsmeldung (baustelle_id, leistung_id, menge, datum, erstellt_von, erstellt) VALUES (?, ?, ?, ?, ?, ?)', bs.id, leistungId, menge, datum, ich.id, jetzt());
      db.protokolliere({ zeit: jetzt(), benutzerId: ich.id, art: 'leistung', objekt: `baustelle:${bs.id}`, neu: { id: r2.id, leistungId, menge, datum }, text: `Leistungsmeldung ${l.code} zu ${bs.kst}` });
      return r2;
    });
    pruefeBudget(bt, bs.id, { anlass: 'Leistungsmeldung', benutzerId: ich.id });
    res.status(201).json({ id: r.id, baustelleId: bs.id, leistungId, menge, datum });
  });

  api.delete('/baustellen/:id/leistungen/:lid', (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    if (!darfLeistung(req.ctx, bs)) throw keinZugriff('Leistungsmeldungen stornieren dürfen Büro, Geschäftsführung und der Bauleiter der Baustelle.');
    const lid = v.pfadId(req.params.lid, 'Leistungsmeldungs-ID');
    const m = db.eins('SELECT * FROM leistungsmeldung WHERE id = ? AND baustelle_id = ?', lid, bs.id);
    if (!m) throw nichtGefunden('Leistungsmeldung nicht gefunden.');
    db.transaktion(() => {
      db.lauf('DELETE FROM leistungsmeldung WHERE id = ?', lid);
      db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'leistung', objekt: `baustelle:${bs.id}`, alt: { id: m.id, leistungId: m.leistung_id, menge: m.menge, datum: m.datum }, text: `Leistungsmeldung zu ${bs.kst} storniert` });
    });
    pruefeBudget(bt, bs.id, { anlass: 'Storno Leistungsmeldung', benutzerId: req.ctx.benutzer.id });
    res.json({ ok: true });
  });

  api.get('/baustellen/:id/fremdleistungen', (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    if (!darfPreise(req.ctx, bs)) throw keinZugriff('Fremdleistungen (€) sehen Bauleitung (eigene Baustellen), Büro und GF.');
    res.json(db.alle('SELECT * FROM fremdleistung WHERE baustelle_id = ? ORDER BY datum DESC, id DESC', bs.id)
      .map((f) => ({ id: f.id, text: f.text, betrag: f.betrag, datum: f.datum, erstellt: f.erstellt, erstelltVon: f.erstellt_von })));
  });

  api.post('/baustellen/:id/fremdleistungen', brauche('preise_bearbeiten'), (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    const body = v.objekt(req.body);
    const text = v.text(body.text, 'text', { max: 300 });
    const betrag = v.betrag(body.betrag, 'betrag', { min: -5e6, max: 5e6 });
    const datum = buchungsDatum(body.datum);
    const r = db.lauf('INSERT INTO fremdleistung (baustelle_id, text, betrag, datum, erstellt_von, erstellt) VALUES (?, ?, ?, ?, ?, ?)', bs.id, text, betrag, datum, req.ctx.benutzer.id, jetzt());
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'fremdleistung', objekt: `baustelle:${bs.id}`, neu: { id: r.id, text, betrag, datum }, text: `Fremdleistung zu ${bs.kst} erfasst` });
    pruefeBudget(bt, bs.id, { anlass: 'Fremdleistung', benutzerId: req.ctx.benutzer.id });
    res.status(201).json({ id: r.id, baustelleId: bs.id, text, betrag, datum });
  });

  api.delete('/baustellen/:id/fremdleistungen/:fid', brauche('preise_bearbeiten'), (req, res) => {
    const bs = baustelleAusPfad(db, req.params.id);
    const fid = v.pfadId(req.params.fid, 'Fremdleistungs-ID');
    const f = db.eins('SELECT * FROM fremdleistung WHERE id = ? AND baustelle_id = ?', fid, bs.id);
    if (!f) throw nichtGefunden('Fremdleistung nicht gefunden.');
    db.transaktion(() => {
      db.lauf('DELETE FROM fremdleistung WHERE id = ?', fid);
      db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'fremdleistung', objekt: `baustelle:${bs.id}`, alt: { id: f.id, text: f.text, betrag: f.betrag, datum: f.datum }, text: `Fremdleistung zu ${bs.kst} storniert` });
    });
    pruefeBudget(bt, bs.id, { anlass: 'Storno Fremdleistung', benutzerId: req.ctx.benutzer.id });
    res.json({ ok: true });
  });

  /* ---------- Mitarbeiter, Geräte, Material, Leistungen ---------- */
  api.get('/mitarbeiter', (req, res) => {
    const ctx = req.ctx;
    const mitLohngruppe = ctx.hat('stammdaten') || ctx.hat('lohn') || ctx.hat('benutzer');
    let liste = db.alle('SELECT id, name, rolle, lohngruppe_id, baustelle_id, aktiv, pnr FROM benutzer ORDER BY name');
    if (ctx.benutzer.rolle === 'mitarbeiter' && !ctx.hat('kolonne') && !ctx.hat('bericht_erstellen')) liste = liste.filter((b) => b.id === ctx.benutzer.id);
    else if (!mitLohngruppe) liste = liste.filter((b) => b.aktiv === 1);
    res.json(liste.map((b) => {
      const o = { id: b.id, name: b.name, rolle: b.rolle, aktiv: b.aktiv === 1, baustelleId: b.baustelle_id };
      if (mitLohngruppe) { o.lohngruppe = b.lohngruppe_id; o.pnr = b.pnr; }
      return o;
    }));
  });

  api.get('/geraete', (req, res) => {
    const p = req.ctx.hat('preise_sehen');
    res.json(db.alle('SELECT * FROM geraet ORDER BY sortierung, id').map((g) => {
      const o = { id: g.id, code: g.code, name: g.name, gruppe: g.gruppe, vorlage: g.vorlage === 1 };
      if (p) { o.kostensatz = g.kostensatz; o.verrechnungssatz = g.verrechnungssatz; }
      return o;
    }));
  });

  api.get('/materialien', (req, res) => {
    const p = req.ctx.hat('preise_sehen');
    res.json(db.alle('SELECT * FROM material ORDER BY sortierung, id').map((m) => {
      const o = { id: m.id, code: m.code, name: m.name, einheit: m.einheit, vorlage: m.vorlage === 1, hinweis: m.hinweis };
      if (p) { o.ek = m.ek; o.vk = m.vk; }
      return o;
    }));
  });

  api.get('/leistungen', (req, res) => {
    const p = req.ctx.hat('preise_sehen');
    res.json(db.alle('SELECT * FROM leistung ORDER BY code').map((l) => {
      const o = { id: l.id, code: l.code, text: l.text, einheit: l.einheit };
      if (p) o.ep = l.ep;
      return o;
    }));
  });
};

module.exports.baustelleJson = baustelleJson;
