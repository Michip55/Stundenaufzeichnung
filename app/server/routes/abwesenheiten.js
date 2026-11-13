'use strict';
/** Abwesenheiten (K/U/SW/ZA): Antrag, Genehmigen/Ablehnen, Löschen – B-07 */
const v = require('../validierung');
const { ungueltig, keinZugriff, konflikt, nichtGefunden } = require('../fehler');
const { bereich, baustelleImBereich } = require('../rechte');
const { wienDatum, plusTage, deDatum } = require('../datum');
const { benachrichtige } = require('../budget');

const CODES = ['K', 'U', 'SW', 'ZA'];
const CODE_TEXT = { K: 'Krankenstand', U: 'Urlaub', SW: 'Schlechtwetter', ZA: 'Zeitausgleich' };

function json(a) {
  const o = { id: a.id, benutzerId: a.benutzer_id, name: a.name, datum: a.datum, code: a.code, status: a.status, erfasst: a.erfasst, erfasstVon: a.erfasst_von };
  if (a.entschieden) { o.entschieden = a.entschieden; o.entschiedenVon = a.entschieden_von; }
  return o;
}

module.exports = function abwesenheitsRouten(api, bt) {
  const { db } = bt;
  const darfEntscheiden = (ctx) => ctx.hat('stammdaten') || ctx.hat('lohn');

  /** Personen, deren Abwesenheiten der Benutzer sehen darf (null = alle) */
  function sichtbareIds(ctx) {
    if (darfEntscheiden(ctx)) return null;
    const ich = ctx.benutzer;
    const ids = new Set([ich.id]);
    const ber = bereich(ich);
    if (ber === 'bauleiter' || ich.rolle === 'polier') {
      const bs = db.alle('SELECT id, polier_id, bauleiter_id FROM baustelle').filter((b) => baustelleImBereich(ich, b)).map((b) => b.id);
      for (const b of db.alle('SELECT id, baustelle_id FROM benutzer')) if (bs.includes(b.baustelle_id)) ids.add(b.id);
    }
    return ids;
  }

  api.get('/abwesenheiten', (req, res) => {
    const q = req.query;
    const bed = [];
    const p = [];
    if (q.benutzerId !== undefined) { bed.push('a.benutzer_id = ?'); p.push(v.pfadId(String(q.benutzerId), 'benutzerId')); }
    if (q.von !== undefined) { bed.push('a.datum >= ?'); p.push(v.datum(String(q.von), 'von')); }
    if (q.bis !== undefined) { bed.push('a.datum <= ?'); p.push(v.datum(String(q.bis), 'bis')); }
    if (q.status !== undefined) { bed.push('a.status = ?'); p.push(v.auswahl(String(q.status), 'status', ['beantragt', 'genehmigt', 'abgelehnt'])); }
    const ids = sichtbareIds(req.ctx);
    const z = db.alle(`SELECT a.*, b.name FROM abwesenheit a JOIN benutzer b ON b.id = a.benutzer_id
      ${bed.length ? 'WHERE ' + bed.join(' AND ') : ''} ORDER BY a.datum DESC, b.name LIMIT 2000`, ...p);
    res.json(z.filter((a) => !ids || ids.has(a.benutzer_id)).map(json));
  });

  api.post('/abwesenheiten', (req, res) => {
    const ctx = req.ctx;
    const body = v.objekt(req.body);
    const benutzerId = v.id(body.benutzerId, 'benutzerId');
    const datum = v.datum(body.datum, 'datum');
    const code = v.auswahl(body.code, 'code', CODES);
    const ziel = db.eins('SELECT id, name, baustelle_id, aktiv FROM benutzer WHERE id = ?', benutzerId);
    if (!ziel) throw ungueltig('Mitarbeiter nicht gefunden.');
    const heute = wienDatum(bt.uhr());
    const ich = ctx.benutzer;
    let status, rueck;
    if (benutzerId === ich.id) {
      // Vier-Augen-Prinzip (C-09): eigene Anträge sind immer „beantragt“, auch für Büro/GF
      // D-09: der Polier meldet Schlechtwetter auch für sich selbst
      const erlaubt = ich.rolle === 'polier' ? ['U', 'ZA', 'SW'] : ['U', 'ZA'];
      if (!erlaubt.includes(code)) throw keinZugriff(ich.rolle === 'polier' ? 'Selbst können nur U, ZA oder SW gemeldet werden.' : 'Selbst können nur Urlaub (U) oder Zeitausgleich (ZA) beantragt werden.');
      status = 'beantragt'; rueck = code === 'SW' ? 3 : 7;
    } else if (ctx.hat('stammdaten')) {
      status = 'genehmigt'; rueck = 62;
    } else if (ich.rolle === 'polier' && code === 'SW') {
      const partie = ziel.baustelle_id && db.eins('SELECT id FROM baustelle WHERE id = ? AND polier_id = ?', ziel.baustelle_id, ich.id);
      if (!partie) throw keinZugriff('Schlechtwetter kann der Polier nur für seine Partie melden.');
      status = 'beantragt'; rueck = 3; // C-13: Büro bestätigt
    } else {
      throw keinZugriff('Abwesenheiten anderer erfasst das Büro.');
    }
    if (datum < plusTage(heute, -rueck)) throw ungueltig(`Das Datum darf höchstens ${rueck} Tage zurückliegen.`);
    if (datum > plusTage(heute, 366)) throw ungueltig('Das Datum liegt zu weit in der Zukunft.');
    const vorhanden = db.eins('SELECT * FROM abwesenheit WHERE benutzer_id = ? AND datum = ?', benutzerId, datum);
    if (vorhanden && vorhanden.status !== 'abgelehnt' && (!ctx.hat('stammdaten') || benutzerId === ich.id)) throw konflikt(`Für ${deDatum(datum)} ist bereits „${vorhanden.code}“ eingetragen.`);
    const zeit = bt.uhr().toISOString();
    let id;
    db.transaktion(() => {
      if (vorhanden) {
        db.lauf('UPDATE abwesenheit SET code = ?, status = ?, erfasst_von = ?, erfasst = ?, entschieden = NULL, entschieden_von = NULL WHERE id = ?', code, status, ich.id, zeit, vorhanden.id);
        id = vorhanden.id;
      } else {
        id = db.lauf('INSERT INTO abwesenheit (benutzer_id, datum, code, status, erfasst_von, erfasst) VALUES (?, ?, ?, ?, ?, ?)', benutzerId, datum, code, status, ich.id, zeit).id;
      }
      db.protokolliere({ zeit, benutzerId: ich.id, art: 'abwesenheit', objekt: `benutzer:${benutzerId}`, alt: vorhanden ? { datum, code: vorhanden.code, status: vorhanden.status } : null, neu: { datum, code, status } });
      if (status === 'beantragt') {
        for (const e of db.alle("SELECT id FROM benutzer WHERE aktiv = 1 AND rolle IN ('buero','gf') AND id <> ?", benutzerId)) {
          benachrichtige(db, { benutzerId: e.id, typ: 'abwesenheit', titel: `Antrag: ${CODE_TEXT[code]} – ${ziel.name}`, text: `${ziel.name} beantragt ${CODE_TEXT[code]} am ${deDatum(datum)}.`, zeit, schluessel: `abw:${id}:${zeit}` });
        }
      }
    });
    res.status(vorhanden ? 200 : 201).json({ id, benutzerId, datum, code, status });
  });

  api.put('/abwesenheiten/:id', (req, res) => {
    const ctx = req.ctx;
    const id = v.pfadId(req.params.id, 'ID');
    const a = db.eins('SELECT a.*, b.name, b.baustelle_id AS stamm FROM abwesenheit a JOIN benutzer b ON b.id = a.benutzer_id WHERE a.id = ?', id);
    // D-09: SW bestätigt auch der Bauleiter der Stamm-Baustelle der Person
    const bauleiterSw = a && a.code === 'SW' && ctx.benutzer.rolle === 'bauleiter' && a.stamm != null
      && Boolean(db.eins('SELECT id FROM baustelle WHERE id = ? AND bauleiter_id = ?', a.stamm, ctx.benutzer.id));
    if (!darfEntscheiden(ctx) && !bauleiterSw) throw keinZugriff('Anträge genehmigt das Büro bzw. die Lohnverrechnung (Schlechtwetter auch der Bauleiter der Baustelle).');
    if (!a) throw nichtGefunden('Abwesenheit nicht gefunden.');
    if (a.benutzer_id === ctx.benutzer.id) throw keinZugriff('Eigene Anträge entscheidet eine andere Person (Vier-Augen-Prinzip).');
    const status = v.auswahl(v.objekt(req.body).status, 'status', ['genehmigt', 'abgelehnt']);
    const zeit = bt.uhr().toISOString();
    db.transaktion(() => {
      db.lauf('UPDATE abwesenheit SET status = ?, entschieden = ?, entschieden_von = ? WHERE id = ?', status, zeit, ctx.benutzer.id, id);
      db.protokolliere({ zeit, benutzerId: ctx.benutzer.id, art: 'abwesenheit', objekt: `benutzer:${a.benutzer_id}`, alt: { datum: a.datum, code: a.code, status: a.status }, neu: { status }, text: `${CODE_TEXT[a.code]} ${a.name} ${deDatum(a.datum)} ${status}` });
      benachrichtige(db, { benutzerId: a.benutzer_id, typ: 'abwesenheit', titel: `${CODE_TEXT[a.code]} ${status}`, text: `Ihr Antrag (${CODE_TEXT[a.code]} am ${deDatum(a.datum)}) wurde ${status}.`, zeit, schluessel: `abw:${id}:${status}:${zeit}` });
    });
    res.json(json(db.eins('SELECT a.*, b.name FROM abwesenheit a JOIN benutzer b ON b.id = a.benutzer_id WHERE a.id = ?', id)));
  });

  api.delete('/abwesenheiten/:id', (req, res) => {
    const ctx = req.ctx;
    const id = v.pfadId(req.params.id, 'ID');
    const a = db.eins('SELECT * FROM abwesenheit WHERE id = ?', id);
    if (!a) throw nichtGefunden('Abwesenheit nicht gefunden.');
    const eigenerAntrag = a.benutzer_id === ctx.benutzer.id && a.status === 'beantragt';
    if (!eigenerAntrag && !darfEntscheiden(ctx)) throw keinZugriff('Löschen können Sie nur eigene, noch nicht entschiedene Anträge.');
    db.transaktion(() => {
      db.lauf('DELETE FROM abwesenheit WHERE id = ?', id);
      db.protokolliere({ zeit: bt.uhr().toISOString(), benutzerId: ctx.benutzer.id, art: 'abwesenheit', objekt: `benutzer:${a.benutzer_id}`, alt: { datum: a.datum, code: a.code, status: a.status }, text: 'Abwesenheit gelöscht' });
    });
    res.json({ ok: true });
  });
};
