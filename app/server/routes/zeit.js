'use strict';
const v = require('../validierung');
const { ApiFehler, ungueltig, keinZugriff, konflikt } = require('../fehler');
const { baustelleImBereich } = require('../rechte');
const { statusAusBuchungen, pruefeBuchung, schichten, TYPEN } = require('../stempel');
const { azgWarnungen } = require('../azg');
const { wienDatum, wienZeit, plusTage, deDatum } = require('../datum');
const { letzteBuchungen, ladeBaustelle } = require('../daten');
const { benachrichtige } = require('../budget');
const { woche } = require('../auswertung');
const { brauche } = require('./hilfe');

const MAX_RUECK_MS = 24 * 60 * 60 * 1000;
const MAX_VOR_MS = 2 * 60 * 1000;

/** Status inkl. heutiger Buchungen und AZG-Warnungen */
function zeitStatus(db, benutzerId, jetzt) {
  const buchungen = letzteBuchungen(db, benutzerId, 300);
  const st = statusAusBuchungen(buchungen);
  const heute = wienDatum(jetzt);
  const gestern = plusTage(heute, -1);
  const sch = schichten(buchungen, jetzt);
  const heuteSch = sch.filter((s) => s.datum === heute);
  const warnungen = azgWarnungen(sch, { jetzt }).filter((w) => w.datum >= gestern || w.typ === 'offen');
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
    if (typeof zeit !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(zeit)) throw ungueltig('zeit muss ein ISO-8601-Zeitstempel sein.');
    zeitpunkt = new Date(zeit);
    if (Number.isNaN(zeitpunkt.getTime())) throw ungueltig('zeit ist ungültig.');
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
    const buchungen = letzteBuchungen(db, benutzerId, 50);
    const akt = statusAusBuchungen(buchungen);
    const letzte = buchungen[buchungen.length - 1];
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

module.exports = function zeitRouten(api, bt) {
  const { db } = bt;

  api.get('/zeit/status', brauche('zeit_eigen'), (req, res) => {
    res.json(zeitStatus(db, req.ctx.benutzer.id, bt.uhr()));
  });

  api.post('/zeit/stempeln', brauche('zeit_eigen'), (req, res) => {
    const body = v.objekt(req.body);
    const typ = v.auswahl(body.typ, 'typ', TYPEN);
    stempeln(bt, { benutzerId: req.ctx.benutzer.id, typ, baustelleId: body.baustelleId, zeit: body.zeit, quelle: 'app', erfasstVon: req.ctx.benutzer.id, standort: body.standort });
    res.json(zeitStatus(db, req.ctx.benutzer.id, bt.uhr()));
  });

  api.get('/zeit/kolonne', brauche('kolonne'), (req, res) => {
    const bsId = v.id(Number(req.query.baustelleId), 'baustelleId');
    const bs = ladeBaustelle(db, bsId);
    if (!bs) throw ungueltig('Baustelle nicht gefunden.');
    if (!baustelleImBereich(req.ctx.benutzer, bs)) throw keinZugriff('Diese Baustelle gehört nicht zu Ihrer Partie.');
    const jetzt = bt.uhr();
    const kandidaten = db.alle('SELECT id, name, rolle, baustelle_id FROM benutzer WHERE aktiv = 1 ORDER BY name');
    const out = [];
    for (const b of kandidaten) {
      const st = statusAusBuchungen(letzteBuchungen(db, b.id, 30));
      const partie = b.baustelle_id === bs.id || bs.polier_id === b.id;
      if (!partie && st.baustelleId !== bs.id) continue;
      const abw = db.eins('SELECT code FROM abwesenheit WHERE benutzer_id = ? AND datum = ?', b.id, wienDatum(jetzt));
      out.push({ benutzerId: b.id, name: b.name, rolle: b.rolle, partie, status: st.status, seit: st.seit, baustelleId: st.baustelleId, code: abw ? abw.code : null });
    }
    res.json(out);
  });

  api.post('/zeit/kolonne', brauche('kolonne'), (req, res) => {
    const body = v.objekt(req.body);
    const typ = v.auswahl(body.typ, 'typ', TYPEN);
    const bsId = v.id(body.baustelleId, 'baustelleId');
    const bs = ladeBaustelle(db, bsId);
    if (!bs) throw ungueltig('Baustelle nicht gefunden.');
    if (!baustelleImBereich(req.ctx.benutzer, bs)) throw keinZugriff('Diese Baustelle gehört nicht zu Ihrer Partie.');
    const ids = v.liste(body.benutzerIds, 'benutzerIds', { max: 60 });
    if (!ids.length) throw ungueltig('benutzerIds: mindestens eine Person auswählen.');
    ids.forEach((x, i) => v.id(x, `benutzerIds[${i}]`));
    if (new Set(ids).size !== ids.length) throw ungueltig('benutzerIds: doppelte Einträge.');
    const ergebnisse = ids.map((id) => {
      const b = db.eins('SELECT id, aktiv FROM benutzer WHERE id = ?', id);
      if (!b || !b.aktiv) return { benutzerId: id, ok: false, fehler: 'Mitarbeiter nicht gefunden oder inaktiv.' };
      try {
        const status = stempeln(bt, { benutzerId: id, typ, baustelleId: bsId, zeit: body.zeit, quelle: 'kolonne', erfasstVon: req.ctx.benutzer.id });
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

  /* ---------- Abwesenheiten ---------- */
  api.post('/abwesenheiten', (req, res) => {
    const ctx = req.ctx;
    const body = v.objekt(req.body);
    const benutzerId = v.id(body.benutzerId, 'benutzerId');
    const datum = v.datum(body.datum, 'datum');
    const code = v.auswahl(body.code, 'code', ['K', 'U', 'SW', 'ZA']);
    const ziel = db.eins('SELECT id, name, baustelle_id, aktiv FROM benutzer WHERE id = ?', benutzerId);
    if (!ziel) throw ungueltig('Mitarbeiter nicht gefunden.');
    const heute = wienDatum(bt.uhr());
    if (datum < plusTage(heute, -62) || datum > plusTage(heute, 366)) throw ungueltig('Datum liegt außerhalb des erlaubten Zeitraums.');
    const ich = ctx.benutzer;
    let status;
    if (ctx.hat('stammdaten')) {
      status = 'genehmigt';
    } else if (benutzerId === ich.id) {
      if (!['U', 'ZA'].includes(code)) throw keinZugriff('Selbst können nur Urlaub (U) oder Zeitausgleich (ZA) beantragt werden.');
      status = 'beantragt';
    } else if (ich.rolle === 'polier' && code === 'SW') {
      const partie = ziel.baustelle_id && db.eins('SELECT id FROM baustelle WHERE id = ? AND polier_id = ?', ziel.baustelle_id, ich.id);
      if (!partie) throw keinZugriff('Schlechtwetter kann der Polier nur für seine Partie melden.');
      status = 'genehmigt';
    } else {
      throw keinZugriff('Abwesenheiten anderer erfasst das Büro.');
    }
    const vorhanden = db.eins('SELECT * FROM abwesenheit WHERE benutzer_id = ? AND datum = ?', benutzerId, datum);
    if (vorhanden && !ctx.hat('stammdaten')) throw konflikt(`Für ${deDatum(datum)} ist bereits „${vorhanden.code}“ eingetragen.`);
    const zeit = bt.uhr().toISOString();
    let id;
    if (vorhanden) {
      db.lauf('UPDATE abwesenheit SET code = ?, status = ?, erfasst_von = ?, erfasst = ? WHERE id = ?', code, status, ich.id, zeit, vorhanden.id);
      id = vorhanden.id;
    } else {
      id = db.lauf('INSERT INTO abwesenheit (benutzer_id, datum, code, status, erfasst_von, erfasst) VALUES (?, ?, ?, ?, ?, ?)', benutzerId, datum, code, status, ich.id, zeit).id;
    }
    db.protokolliere({ zeit, benutzerId: ich.id, art: 'abwesenheit', objekt: `benutzer:${benutzerId}`, alt: vorhanden ? { datum, code: vorhanden.code } : null, neu: { datum, code, status } });
    res.status(vorhanden ? 200 : 201).json({ id, benutzerId, datum, code, status });
  });
};

module.exports.zeitStatus = zeitStatus;
module.exports.stempeln = stempeln;
