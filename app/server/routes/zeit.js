'use strict';
const v = require('../validierung');
const { ApiFehler, ungueltig, keinZugriff, konflikt, nichtGefunden } = require('../fehler');
const { baustelleImBereich, bereich } = require('../rechte');
const { pruefeBuchung, schichten, plausibilisieren, ungueltigeUebergaenge, TYPEN } = require('../stempel');
const { azgWarnungen } = require('../azg');
const { wienDatum, wienZeit, wienZuDate, plusTage, deDatum } = require('../datum');
const { ladeBaustelle, aktuellerStatus, buchungenSeit, letzteBuchungen } = require('../daten');
const { benachrichtige } = require('../budget');
const { woche } = require('../auswertung');
const { brauche } = require('./hilfe');

const MAX_RUECK_MS = 24 * 60 * 60 * 1000;
const MAX_VOR_MS = 2 * 60 * 1000;
const RE_ISO_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const KOLONNEN_ROLLEN = ['mitarbeiter', 'polier'];

/** ISO-Zeitstempel MIT Zeitzone (N-06) */
function zeitMitZone(wert, feld = 'zeit') {
  if (typeof wert !== 'string' || !RE_ISO_TZ.test(wert)) throw ungueltig(`${feld} muss ein ISO-8601-Zeitstempel mit Zeitzone sein (z. B. 2026-11-12T07:00:00+01:00 oder …Z).`);
  const d = new Date(wert);
  if (Number.isNaN(d.getTime())) throw ungueltig(`${feld} ist ungültig.`);
  return d;
}

/** Status inkl. heutiger Buchungen und AZG-Warnungen */
function zeitStatus(db, benutzerId, jetzt) {
  const st = aktuellerStatus(db, benutzerId);
  const heute = wienDatum(jetzt);
  const gestern = plusTage(heute, -1);
  const buchungen = buchungenSeit(db, benutzerId, wienZuDate(plusTage(heute, -3)).toISOString());
  const roh = schichten(buchungen, jetzt);
  const heuteSch = plausibilisieren(roh, jetzt).filter((s) => s.datum === heute);
  const warnungen = azgWarnungen(roh, { jetzt }).filter((w) => w.datum >= gestern || w.typ === 'offen');
  return {
    status: st.status,
    seit: st.seit,
    baustelleId: st.baustelleId,
    schichtBeginn: st.schichtBeginn,
    heute: {
      datum: heute,
      stunden: Math.round(heuteSch.reduce((a, s) => a + s.arbeitMin, 0) / 60 * 100) / 100,
      pauseMin: heuteSch.reduce((a, s) => a + s.pauseMin, 0),
      buchungen: buchungen.filter((b) => wienDatum(new Date(b.zeit)) === heute)
        .map((b) => ({ typ: b.typ, zeit: b.zeit, uhrzeit: wienZeit(new Date(b.zeit)), baustelleId: b.baustelleId, quelle: b.quelle }))
    },
    warnungen
  };
}

/**
 * Eine Stempelung buchen (eigene oder für die Kolonne). Wirft ApiFehler (400/409).
 */
function stempeln(bt, { benutzerId, typ, baustelleId, zeit, quelle, erfasstVon, standort }) {
  const { db } = bt;
  const jetzt = bt.uhr();
  let zeitpunkt = jetzt;
  if (zeit !== undefined && zeit !== null) {
    zeitpunkt = zeitMitZone(zeit);
    if (zeitpunkt.getTime() > jetzt.getTime() + MAX_VOR_MS) throw ungueltig('zeit liegt in der Zukunft.');
    if (zeitpunkt.getTime() < jetzt.getTime() - MAX_RUECK_MS) throw ungueltig('Nachbuchungen sind höchstens 24 Stunden zurück möglich – bitte Korrektur beim Büro melden.');
    quelle = 'offline';
  }
  let bsId = null;
  if (typ === 'kommen' || typ === 'wechsel') {
    if (baustelleId === undefined || baustelleId === null) throw ungueltig('baustelleId fehlt (Baustelle wählen).');
    bsId = v.id(baustelleId, 'baustelleId');
    const bs = ladeBaustelle(db, bsId);
    if (!bs) throw ungueltig('Baustelle nicht gefunden.');
    if (bs.status === 'abgeschlossen') throw ungueltig(`Baustelle ${bs.kst} ist abgeschlossen.`);
  }
  let geo = { lat: null, lng: null, genauigkeit: null };
  if (standort !== undefined && standort !== null) {
    const s = v.objekt(standort, 'standort');
    geo = {
      lat: v.zahl(s.lat, 'standort.lat', { min: -90, max: 90 }),
      lng: v.zahl(s.lng, 'standort.lng', { min: -180, max: 180 }),
      genauigkeit: v.zahl(s.genauigkeit, 'standort.genauigkeit', { min: 0, max: 100000, pflicht: false })
    };
  }
  return db.transaktion(() => {
    const akt = aktuellerStatus(db, benutzerId);
    const letzte = akt.letzte;
    if (letzte && zeitpunkt.getTime() < new Date(letzte.zeit).getTime()) {
      throw konflikt(`Der Zeitpunkt liegt vor der letzten Buchung (${wienZeit(new Date(letzte.zeit))}).`);
    }
    const p = pruefeBuchung(akt, typ, bsId);
    if (!p.ok) {
      const seit = akt.seit ? ` (seit ${deDatum(wienDatum(new Date(akt.seit)))} ${wienZeit(new Date(akt.seit))})` : '';
      throw konflikt(p.grund.replace(/\.$/, '') + (akt.status !== 'aus' ? seit : '') + '.', { status: akt.status });
    }
    if (typ !== 'kommen' && typ !== 'wechsel') bsId = akt.baustelleId;
    db.lauf(`INSERT INTO buchung (benutzer_id, typ, zeit, baustelle_id, quelle, erfasst_von, erfasst, lat, lng, genauigkeit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, benutzerId, typ, zeitpunkt.toISOString(), bsId, quelle, erfasstVon, jetzt.toISOString(), geo.lat, geo.lng, geo.genauigkeit);
    if (typ === 'gehen') azgNachGehen(bt, benutzerId, jetzt);
    return p.status;
  });
}

/** Nach dem Ausstempeln: AZG-Warnungen als Benachrichtigung (an die Person und das Büro) */
function azgNachGehen(bt, benutzerId, jetzt) {
  const { db } = bt;
  const sch = schichten(letzteBuchungen(db, benutzerId, 100), jetzt);
  const letzte = sch[sch.length - 1];
  if (!letzte) return;
  const w = azgWarnungen(sch, { jetzt }).filter((x) => x.datum === letzte.datum && x.typ !== 'offen');
  if (!w.length) return;
  const b = db.eins('SELECT id, name FROM benutzer WHERE id = ?', benutzerId);
  const buero = db.alle("SELECT id FROM benutzer WHERE rolle IN ('buero','gf') AND aktiv = 1");
  for (const x of w) {
    const titel = `AZG-Hinweis: ${b.name}`;
    for (const e of [{ id: b.id }, ...buero]) {
      benachrichtige(db, { benutzerId: e.id, typ: 'azg', titel, text: x.text, zeit: jetzt.toISOString(), schluessel: `azg:${benutzerId}:${x.datum}:${x.typ}` });
    }
  }
}

function buchungJson(b) {
  const z = new Date(b.zeit);
  return { id: b.id, benutzerId: b.benutzer_id, typ: b.typ, zeit: b.zeit, uhrzeit: wienZeit(z), datum: wienDatum(z), baustelleId: b.baustelle_id, quelle: b.quelle, erfasstVon: b.erfasst_von };
}

module.exports = function zeitRouten(api, bt) {
  const { db } = bt;
  const bsMap = () => new Map(db.alle('SELECT id, polier_id, bauleiter_id, kst FROM baustelle').map((b) => [b.id, b]));

  api.get('/zeit/status', brauche('zeit_eigen'), (req, res) => {
    res.json(zeitStatus(db, req.ctx.benutzer.id, bt.uhr()));
  });

  api.post('/zeit/stempeln', brauche('zeit_eigen'), (req, res) => {
    const body = v.objekt(req.body);
    const typ = v.auswahl(body.typ, 'typ', TYPEN);
    stempeln(bt, { benutzerId: req.ctx.benutzer.id, typ, baustelleId: body.baustelleId, zeit: body.zeit, quelle: 'app', erfasstVon: req.ctx.benutzer.id, standort: body.standort });
    res.json(zeitStatus(db, req.ctx.benutzer.id, bt.uhr()));
  });

  /** Wer ist gerade eingestempelt (Dashboard „Heute“). Bauleiter/Polier: nur eigene Baustellen. */
  api.get('/zeit/anwesend', brauche('bericht_freigeben', 'stammdaten', 'lohn', 'kalk_sehen'), (req, res) => {
    const ctx = req.ctx;
    const m = bsMap();
    const nurEigene = bereich(ctx.benutzer) !== 'alle';
    const out = [];
    for (const b of db.alle('SELECT id, name, rolle FROM benutzer WHERE aktiv = 1 ORDER BY name')) {
      const st = aktuellerStatus(db, b.id);
      if (st.status === 'aus') continue;
      if (nurEigene && !baustelleImBereich(ctx.benutzer, m.get(st.baustelleId))) continue;
      out.push({ benutzerId: b.id, name: b.name, rolle: b.rolle, status: st.status, seit: st.seit, baustelleId: st.baustelleId, schichtBeginn: st.schichtBeginn });
    }
    res.json(out);
  });

  api.get('/zeit/kolonne', brauche('kolonne'), (req, res) => {
    const bsId = v.id(Number(req.query.baustelleId), 'baustelleId');
    const bs = ladeBaustelle(db, bsId);
    if (!bs) throw ungueltig('Baustelle nicht gefunden.');
    if (!baustelleImBereich(req.ctx.benutzer, bs)) throw keinZugriff('Diese Baustelle gehört nicht zu Ihrer Partie.');
    const jetzt = bt.uhr();
    const out = [];
    for (const b of db.alle(`SELECT id, name, rolle, baustelle_id FROM benutzer WHERE aktiv = 1 AND rolle IN ('mitarbeiter','polier') ORDER BY name`)) {
      const st = aktuellerStatus(db, b.id);
      const partie = b.baustelle_id === bs.id || bs.polier_id === b.id;
      if (!partie && st.baustelleId !== bs.id) continue;
      const abw = db.eins("SELECT code FROM abwesenheit WHERE benutzer_id = ? AND datum = ? AND status = 'genehmigt'", b.id, wienDatum(jetzt));
      out.push({ benutzerId: b.id, name: b.name, rolle: b.rolle, partie, status: st.status, seit: st.seit, baustelleId: st.baustelleId, code: abw ? abw.code : null });
    }
    res.json(out);
  });

  api.post('/zeit/kolonne', brauche('kolonne'), (req, res) => {
    const ctx = req.ctx;
    const body = v.objekt(req.body);
    const typ = v.auswahl(body.typ, 'typ', TYPEN);
    const bsId = v.id(body.baustelleId, 'baustelleId');
    const gast = body.gast === undefined ? false : v.bool(body.gast, 'gast');
    const bs = ladeBaustelle(db, bsId);
    if (!bs) throw ungueltig('Baustelle nicht gefunden.');
    if (!baustelleImBereich(ctx.benutzer, bs)) throw keinZugriff('Diese Baustelle gehört nicht zu Ihrer Partie.');
    const ids = v.liste(body.benutzerIds, 'benutzerIds', { max: 60 });
    if (!ids.length) throw ungueltig('benutzerIds: mindestens eine Person auswählen.');
    ids.forEach((x, i) => v.id(x, `benutzerIds[${i}]`));
    if (new Set(ids).size !== ids.length) throw ungueltig('benutzerIds: doppelte Einträge.');
    if (body.zeit !== undefined && body.zeit !== null) zeitMitZone(body.zeit);
    const m = bsMap();
    const ergebnisse = ids.map((id) => {
      const b = db.eins('SELECT id, name, rolle, baustelle_id, aktiv FROM benutzer WHERE id = ?', id);
      if (!b || !b.aktiv) return { benutzerId: id, ok: false, fehler: 'Mitarbeiter nicht gefunden oder inaktiv.' };
      if (!KOLONNEN_ROLLEN.includes(b.rolle)) return { benutzerId: id, ok: false, fehler: 'Über die Kolonne können nur Mitarbeiter und Poliere gestempelt werden.' };
      // B-02: nur eigene Partie bzw. Personen auf eigenen Baustellen
      const st = aktuellerStatus(db, id);
      const inPartie = id === ctx.benutzer.id || (b.baustelle_id != null && baustelleImBereich(ctx.benutzer, m.get(b.baustelle_id)));
      if (typ === 'kommen') {
        if (!inPartie && !gast) return { benutzerId: id, ok: false, fehler: `${b.name} gehört nicht zu Ihrer Partie (als Gast stempeln: gast:true).` };
      } else if (st.status !== 'aus' && !baustelleImBereich(ctx.benutzer, m.get(st.baustelleId))) {
        return { benutzerId: id, ok: false, fehler: `${b.name} ist nicht auf einer Ihrer Baustellen eingestempelt.` };
      }
      try {
        const status = stempeln(bt, { benutzerId: id, typ, baustelleId: bsId, zeit: body.zeit, quelle: 'kolonne', erfasstVon: ctx.benutzer.id });
        if (typ === 'kommen' && !inPartie) {
          db.protokolliere({ zeit: bt.uhr().toISOString(), benutzerId: ctx.benutzer.id, art: 'zeit', objekt: `benutzer:${id}`, text: `${b.name} als Gast auf ${bs.kst} eingestempelt (Kolonne)` });
        }
        return { benutzerId: id, ok: true, status };
      } catch (e) {
        if (e instanceof ApiFehler && e.status === 400) throw e; // Eingabefehler gelten für alle
        if (e instanceof ApiFehler) return { benutzerId: id, ok: false, fehler: e.message };
        throw e;
      }
    });
    res.json({ ergebnisse });
  });

  api.get('/zeit/woche', brauche('zeit_eigen'), (req, res) => {
    const datum = req.query.datum ? v.datum(String(req.query.datum), 'datum') : wienDatum(bt.uhr());
    res.json(woche(db, req.ctx.benutzer.id, datum, bt.uhr()));
  });

  /* ---------- Korrektur von Buchungen (Büro/GF, immer mit Grund) – B-05 ---------- */

  api.get('/zeit/buchungen', (req, res) => {
    const ctx = req.ctx;
    const heute = wienDatum(bt.uhr());
    const benutzerId = req.query.benutzerId === undefined ? ctx.benutzer.id : v.pfadId(String(req.query.benutzerId), 'benutzerId');
    if (benutzerId !== ctx.benutzer.id && !ctx.hat('stammdaten')) throw keinZugriff('Buchungen anderer sieht nur das Büro.');
    const von = req.query.von === undefined ? plusTage(heute, -14) : v.datum(String(req.query.von), 'von');
    const bis = req.query.bis === undefined ? heute : v.datum(String(req.query.bis), 'bis');
    if (bis < von) throw ungueltig('bis liegt vor von.');
    if (plusTage(von, 93) < bis) throw ungueltig('Zeitraum höchstens 93 Tage.');
    const z = db.alle('SELECT * FROM buchung WHERE benutzer_id = ? AND zeit >= ? AND zeit < ? ORDER BY zeit, id',
      benutzerId, wienZuDate(von).toISOString(), wienZuDate(plusTage(bis, 1)).toISOString());
    res.json(z.map(buchungJson));
  });

  /** Prüft nach der Änderung die Stempelfolge (darf nicht schlechter werden) – innerhalb der Transaktion */
  function pruefeFolge(benutzerId, vorher) {
    const nachher = ungueltigeUebergaenge(db.alle('SELECT typ FROM buchung WHERE benutzer_id = ? ORDER BY zeit, id', benutzerId));
    if (nachher > vorher) throw konflikt('Die Korrektur ergibt eine ungültige Stempelfolge (z. B. zweimal „kommen“ oder „gehen“ ohne „kommen“).');
  }
  const fehlerVorher = (benutzerId) => ungueltigeUebergaenge(db.alle('SELECT typ FROM buchung WHERE benutzer_id = ? ORDER BY zeit, id', benutzerId));
  const grundAus = (body) => v.text(body.grund, 'grund', { max: 300, min: 3 });
  function korrekturZeit(wert, feld = 'zeit') {
    const z = zeitMitZone(wert, feld);
    const jetzt = bt.uhr().getTime();
    if (z.getTime() > jetzt + MAX_VOR_MS) throw ungueltig(`${feld} liegt in der Zukunft.`);
    if (z.getTime() < jetzt - 400 * 86400000) throw ungueltig(`${feld} liegt zu weit zurück.`);
    return z;
  }
  function korrekturBaustelle(wert) {
    const id = v.id(wert, 'baustelleId');
    if (!ladeBaustelle(db, id)) throw ungueltig('Baustelle nicht gefunden.');
    return id;
  }

  api.post('/zeit/buchungen', brauche('stammdaten'), (req, res) => {
    const body = v.objekt(req.body);
    const benutzerId = v.id(body.benutzerId, 'benutzerId');
    if (!db.eins('SELECT id FROM benutzer WHERE id = ?', benutzerId)) throw ungueltig('Mitarbeiter nicht gefunden.');
    const typ = v.auswahl(body.typ, 'typ', TYPEN);
    const zeit = korrekturZeit(body.zeit);
    const bsId = typ === 'kommen' || typ === 'wechsel' ? korrekturBaustelle(body.baustelleId) : null;
    const grund = grundAus(body);
    const jetzt = bt.uhr().toISOString();
    const id = db.transaktion(() => {
      const vorher = fehlerVorher(benutzerId);
      const r = db.lauf(`INSERT INTO buchung (benutzer_id, typ, zeit, baustelle_id, quelle, erfasst_von, erfasst) VALUES (?, ?, ?, ?, 'buero', ?, ?)`,
        benutzerId, typ, zeit.toISOString(), bsId, req.ctx.benutzer.id, jetzt);
      pruefeFolge(benutzerId, vorher);
      db.protokolliere({ zeit: jetzt, benutzerId: req.ctx.benutzer.id, art: 'zeitkorrektur', objekt: `buchung:${r.id}`, neu: { benutzerId, typ, zeit: zeit.toISOString(), baustelleId: bsId }, text: `Buchung nachgetragen: ${grund}` });
      return r.id;
    });
    res.status(201).json(buchungJson(db.eins('SELECT * FROM buchung WHERE id = ?', id)));
  });

  api.put('/zeit/buchungen/:id', brauche('stammdaten'), (req, res) => {
    const id = v.pfadId(req.params.id, 'Buchungs-ID');
    const alt = db.eins('SELECT * FROM buchung WHERE id = ?', id);
    if (!alt) throw nichtGefunden('Buchung nicht gefunden.');
    const body = v.objekt(req.body);
    const grund = grundAus(body);
    const f = {};
    if (body.zeit !== undefined) f.zeit = korrekturZeit(body.zeit).toISOString();
    if (body.baustelleId !== undefined) {
      if (alt.typ !== 'kommen' && alt.typ !== 'wechsel') throw ungueltig('Eine Baustelle haben nur „kommen“ und „wechsel“.');
      f.baustelle_id = korrekturBaustelle(body.baustelleId);
    }
    if (!Object.keys(f).length) throw ungueltig('Keine Änderungen angegeben (zeit, baustelleId).');
    const jetzt = bt.uhr().toISOString();
    db.transaktion(() => {
      const vorher = fehlerVorher(alt.benutzer_id);
      const k = Object.keys(f);
      db.lauf(`UPDATE buchung SET ${k.map((x) => `${x} = ?`).join(', ')}, quelle = 'buero', erfasst_von = ?, erfasst = ? WHERE id = ?`, ...k.map((x) => f[x]), req.ctx.benutzer.id, jetzt, id);
      pruefeFolge(alt.benutzer_id, vorher);
      db.protokolliere({ zeit: jetzt, benutzerId: req.ctx.benutzer.id, art: 'zeitkorrektur', objekt: `buchung:${id}`,
        alt: { zeit: alt.zeit, baustelleId: alt.baustelle_id, quelle: alt.quelle }, neu: { zeit: f.zeit ?? alt.zeit, baustelleId: f.baustelle_id ?? alt.baustelle_id }, text: `Buchung korrigiert: ${grund}` });
    });
    res.json(buchungJson(db.eins('SELECT * FROM buchung WHERE id = ?', id)));
  });

  api.delete('/zeit/buchungen/:id', brauche('stammdaten'), (req, res) => {
    const id = v.pfadId(req.params.id, 'Buchungs-ID');
    const alt = db.eins('SELECT * FROM buchung WHERE id = ?', id);
    if (!alt) throw nichtGefunden('Buchung nicht gefunden.');
    const grund = grundAus(v.objekt(req.body || {}));
    const jetzt = bt.uhr().toISOString();
    db.transaktion(() => {
      const vorher = fehlerVorher(alt.benutzer_id);
      db.lauf('DELETE FROM buchung WHERE id = ?', id);
      pruefeFolge(alt.benutzer_id, vorher);
      db.protokolliere({ zeit: jetzt, benutzerId: req.ctx.benutzer.id, art: 'zeitkorrektur', objekt: `buchung:${id}`,
        alt: { benutzerId: alt.benutzer_id, typ: alt.typ, zeit: alt.zeit, baustelleId: alt.baustelle_id, quelle: alt.quelle, erfasstVon: alt.erfasst_von }, text: `Buchung gelöscht: ${grund}` });
    });
    res.json({ ok: true });
  });
};

module.exports.zeitStatus = zeitStatus;
module.exports.stempeln = stempeln;
module.exports.zeitMitZone = zeitMitZone;
