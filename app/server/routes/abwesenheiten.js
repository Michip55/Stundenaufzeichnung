'use strict';
/** Abwesenheiten (K/U/SW/ZA): Antrag, Genehmigen/Ablehnen, Löschen – B-07 */
const v = require('../validierung');
const { ungueltig, keinZugriff, konflikt, nichtGefunden } = require('../fehler');
const { bereich, baustelleImBereich } = require('../rechte');
const { wienDatum, plusTage, deDatum, istArbeitstag, feiertag, wochentag } = require('../datum');
const crypto = require('node:crypto');
const { benachrichtige } = require('../budget');

const CODES = ['K', 'U', 'SW', 'ZA'];
const CODE_TEXT = { K: 'Krankenstand', U: 'Urlaub', SW: 'Schlechtwetter', ZA: 'Zeitausgleich' };

const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
/** Antrags-ID (12.24): Bestand ohne Antrag → "e<id>" */
const antragId = (a) => a.antrag_id || `e${a.id}`;
const ANTRAG_SQL = "COALESCE(a.antrag_id, 'e' || a.id)";
const neueAntragId = () => crypto.randomBytes(6).toString('hex');
const tagKurz = (d) => `${WT[wochentag(d)]} ${d.slice(8, 10)}.${d.slice(5, 7)}.`;

function json(a) {
  const o = { id: a.id, antragId: antragId(a), benutzerId: a.benutzer_id, name: a.name, datum: a.datum, code: a.code, status: a.status, erfasst: a.erfasst, erfasstVon: a.erfasst_von };
  if (a.notiz) o.notiz = a.notiz;
  if (a.antwort) o.antwort = a.antwort;
  // Betriebsurlaub: zählt (Konto, Monat, Lohn, BUAK) als U, ist aber eigens gekennzeichnet (API.md 12.19)
  if (a.betriebsurlaub) o.art = 'betriebsurlaub';
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

  /** Status und Rückdatierungs-Grenze je Rolle und Code (B-07, C-09, C-13, D-09) – auch für 12.24 */
  function antragsRegel(ctx, benutzerId, ziel, code) {
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
    return { status, rueck };
  }

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
    const { status, rueck } = antragsRegel(ctx, benutzerId, ziel, code);
    if (datum < plusTage(heute, -rueck)) throw ungueltig(`Das Datum darf höchstens ${rueck} Tage zurückliegen.`);
    if (datum > plusTage(heute, 366)) throw ungueltig('Das Datum liegt zu weit in der Zukunft.');
    const vorhanden = db.eins('SELECT * FROM abwesenheit WHERE benutzer_id = ? AND datum = ?', benutzerId, datum);
    if (vorhanden && vorhanden.status !== 'abgelehnt' && (!ctx.hat('stammdaten') || benutzerId === ich.id)) throw konflikt(`Für ${deDatum(datum)} ist bereits „${vorhanden.code}“ eingetragen.`);
    const zeit = bt.uhr().toISOString();
    let id;
    db.transaktion(() => {
      if (vorhanden) {
        db.lauf('UPDATE abwesenheit SET code = ?, status = ?, erfasst_von = ?, erfasst = ?, entschieden = NULL, entschieden_von = NULL, betriebsurlaub = 0, notiz = NULL, antwort = NULL, antrag_id = ? WHERE id = ?', code, status, ich.id, zeit, neueAntragId(), vorhanden.id);
        id = vorhanden.id;
      } else {
        id = db.lauf('INSERT INTO abwesenheit (benutzer_id, datum, code, status, erfasst_von, erfasst, antrag_id) VALUES (?, ?, ?, ?, ?, ?, ?)', benutzerId, datum, code, status, ich.id, zeit, neueAntragId()).id;
      }
      db.protokolliere({ zeit, benutzerId: ich.id, art: 'abwesenheit', objekt: `benutzer:${benutzerId}`, alt: vorhanden ? { datum, code: vorhanden.code, status: vorhanden.status } : null, neu: { datum, code, status } });
      if (status === 'beantragt') {
        for (const e of db.alle("SELECT id FROM benutzer WHERE aktiv = 1 AND rolle IN ('buero','gf') AND id <> ?", benutzerId)) {
          benachrichtige(db, { benutzerId: e.id, typ: 'abwesenheit', titel: `Antrag: ${CODE_TEXT[code]} – ${ziel.name}`, text: `${ziel.name} beantragt ${CODE_TEXT[code]} am ${deDatum(datum)}.`, zeit, schluessel: `abw:${id}:${zeit}` });
        }
      }
    });
    res.status(vorhanden ? 200 : 201).json({ id, antragId: antragId(db.eins('SELECT id, antrag_id FROM abwesenheit WHERE id = ?', id)), benutzerId, datum, code, status });
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
    // 12.24: mehrtägige Anträge nur als Ganzes entscheiden (Entscheidung 13.11.2026)
    if (a.antrag_id && db.eins('SELECT COUNT(*) AS n FROM abwesenheit WHERE antrag_id = ?', a.antrag_id).n > 1) {
      throw konflikt('Bitte den ganzen Antrag entscheiden.', { antragId: a.antrag_id });
    }
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
    const korrektur = a.benutzer_id !== ctx.benutzer.id;
    db.transaktion(() => {
      db.lauf('DELETE FROM abwesenheit WHERE id = ?', id);
      db.protokolliere({ zeit: bt.uhr().toISOString(), benutzerId: ctx.benutzer.id, art: 'abwesenheit', objekt: `benutzer:${a.benutzer_id}`, alt: { datum: a.datum, code: a.code, status: a.status, antragId: antragId(a), ...(korrektur && a.status === 'genehmigt' ? { korrektur: true } : {}) }, text: 'Abwesenheit gelöscht' });
      // 12.24: Korrektur durch das Büro → Person einmal informieren
      if (korrektur) benachrichtige(db, { benutzerId: a.benutzer_id, typ: 'abwesenheit', titel: `${CODE_TEXT[a.code]} gelöscht`, text: `${CODE_TEXT[a.code]} am ${tagKurz(a.datum)} wurde gelöscht (${a.status === 'genehmigt' ? 'Korrektur durch das Büro' : 'durch das Büro'}).`, zeit: bt.uhr().toISOString(), schluessel: `abw:${id}:weg` });
    });
    res.json({ ok: true });
  });
  /* ---------- Zeitraum-Anträge (12.24) ---------- */
  const zeitText = (von, bis) => (von === bis ? tagKurz(von) : `${tagKurz(von)}–${tagKurz(bis)}`);
  const titelCode = (code) => (code === 'U' ? 'Urlaubsantrag' : `Antrag ${CODE_TEXT[code]}`);
  function darfKontoSehen(ctx, benutzerId) {
    const ids = sichtbareIds(ctx);
    if (ctx.benutzer.rolle === 'mitarbeiter') return benutzerId === ctx.benutzer.id;
    return !ids || ids.has(benutzerId);
  }

  api.post('/abwesenheiten/zeitraum', (req, res) => {
    const ctx = req.ctx;
    const ich = ctx.benutzer;
    const body = v.objekt(req.body);
    const benutzerId = v.id(body.benutzerId, 'benutzerId');
    const von = v.datum(body.von, 'von');
    const bis = v.datum(body.bis, 'bis');
    const code = v.auswahl(body.code, 'code', CODES);
    const notiz = body.notiz == null || body.notiz === '' ? null : v.text(body.notiz, 'notiz', { max: 200 });
    const vorschau = body.vorschau === undefined ? false : v.bool(body.vorschau, 'vorschau');
    if (bis < von) throw ungueltig('bis darf nicht vor von liegen.');
    if (plusTage(von, 61) < bis) throw ungueltig('Zeitraum höchstens 62 Kalendertage.');
    const ziel = db.eins('SELECT id, name, rolle, pnr, baustelle_id, aktiv FROM benutzer WHERE id = ?', benutzerId);
    if (!ziel) throw ungueltig('Mitarbeiter nicht gefunden.');
    const { status, rueck } = antragsRegel(ctx, benutzerId, ziel, code);
    const heute = wienDatum(bt.uhr());
    if (von < plusTage(heute, -rueck)) throw ungueltig(`Das Datum darf höchstens ${rueck} Tage zurückliegen (${deDatum(von)}).`);
    if (bis > plusTage(heute, 366)) throw ungueltig('Das Datum liegt zu weit in der Zukunft.');
    const ersetzenErlaubt = ctx.hat('stammdaten') && benutzerId !== ich.id;
    const tage = [], uebersprungen = [], ersetzen = [], konflikte = [];
    for (let d = von; d <= bis; d = plusTage(d, 1)) {
      if (!istArbeitstag(d)) { const f = feiertag(d); if (f && wochentag(d) >= 1 && wochentag(d) <= 5) uebersprungen.push({ datum: d, grund: `Feiertag: ${f}` }); continue; }
      const a = db.eins('SELECT * FROM abwesenheit WHERE benutzer_id = ? AND datum = ?', benutzerId, d);
      if (a && a.status === 'genehmigt') { uebersprungen.push({ datum: d, grund: `schon ${a.code} genehmigt` }); continue; }
      if (a && a.status === 'beantragt' && !ersetzenErlaubt) { konflikte.push(d); continue; }
      if (a) ersetzen.push(a.id);
      tage.push(d);
    }
    if (konflikte.length) throw konflikt(`Für ${konflikte.map(deDatum).join(', ')} gibt es schon einen offenen Antrag – bitte zuerst zurückziehen.`, { tage: konflikte });
    let konto = null;
    if (code === 'U' && typeof bt.urlaubKonto === 'function' && darfKontoSehen(ctx, benutzerId)) {
      const k = bt.urlaubKonto(ziel, von);
      const neu = tage.filter((d) => d >= k.von && d <= k.bis).length;
      konto = { rest: k.rest, restNachAntrag: k.rest == null ? null : Math.round((k.rest - neu) * 10) / 10 };
    }
    const antwort = { antragId: null, benutzerId, code, status, tage, uebersprungen, arbeitstage: tage.length, konto };
    if (vorschau) return res.json(antwort);
    if (!tage.length) throw ungueltig('Im Zeitraum liegt kein Arbeitstag, der beantragt werden kann.');
    const zeit = bt.uhr().toISOString();
    const aid = neueAntragId();
    db.transaktion(() => {
      for (const d of tage) {
        db.lauf(`INSERT INTO abwesenheit (benutzer_id, datum, code, status, erfasst_von, erfasst, antrag_id, notiz) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(benutzer_id, datum) DO UPDATE SET code = excluded.code, status = excluded.status, erfasst_von = excluded.erfasst_von, erfasst = excluded.erfasst,
            entschieden = NULL, entschieden_von = NULL, betriebsurlaub = 0, antwort = NULL, antrag_id = excluded.antrag_id, notiz = excluded.notiz`,
        benutzerId, d, code, status, ich.id, zeit, aid, notiz);
        // Schutz: ein inzwischen genehmigter Tag darf nicht überschrieben werden (Transaktion bricht ab)
        const z = db.eins('SELECT status, antrag_id FROM abwesenheit WHERE benutzer_id = ? AND datum = ?', benutzerId, d);
        if (z.antrag_id !== aid) throw konflikt(`${deDatum(d)} konnte nicht gespeichert werden.`);
      }
      db.protokolliere({ zeit, benutzerId: ich.id, art: 'abwesenheit', objekt: `benutzer:${benutzerId}`, neu: { antragId: aid, von, bis, code, status, tage: tage.length, uebersprungen: uebersprungen.length, ersetzt: ersetzen.length }, text: `${titelCode(code)} ${ziel.name}: ${zeitText(tage[0], tage[tage.length - 1])} (${tage.length} Arbeitstage, ${status})` });
      if (status === 'beantragt') {
        const text = `${titelCode(code)} ${ziel.name}: ${zeitText(tage[0], tage[tage.length - 1])} (${tage.length} ${tage.length === 1 ? 'Arbeitstag' : 'Arbeitstage'})${notiz ? ` – ${notiz}` : ''}`;
        for (const e of db.alle("SELECT id FROM benutzer WHERE aktiv = 1 AND rolle IN ('buero','gf') AND id <> ?", benutzerId)) {
          benachrichtige(db, { benutzerId: e.id, typ: 'abwesenheit', titel: `${titelCode(code)}: ${ziel.name}`, text, zeit, schluessel: `abw:antrag:${aid}` });
        }
      }
    });
    res.status(201).json({ ...antwort, antragId: aid });
  });

  /** Anträge gruppiert (12.24) */
  function antraegeLaden(ctx, f = {}) {
    const bed = [], p = [];
    if (f.antragId) { bed.push(`${ANTRAG_SQL} = ?`); p.push(f.antragId); }
    if (f.benutzerId) { bed.push('a.benutzer_id = ?'); p.push(f.benutzerId); }
    const zeilen = db.alle(`SELECT a.*, b.name FROM abwesenheit a JOIN benutzer b ON b.id = a.benutzer_id ${bed.length ? 'WHERE ' + bed.join(' AND ') : ''} ORDER BY a.datum`, ...p);
    const ids = sichtbareIds(ctx);
    const gruppen = new Map();
    for (const a of zeilen) {
      if (ids && !ids.has(a.benutzer_id)) continue;
      const k = antragId(a);
      if (!gruppen.has(k)) gruppen.set(k, []);
      gruppen.get(k).push(a);
    }
    const kSichtbar = (a) => darfEntscheiden(ctx) || a.benutzer_id === ctx.benutzer.id;
    return [...gruppen].map(([k, l]) => {
      // Status gilt für den ganzen Antrag (kein „teilweise“, Entscheidung 13.11.2026); Bestand gemischt → offen vor genehmigt vor abgelehnt
      const st = ['beantragt', 'genehmigt', 'abgelehnt'].filter((x) => l.some((a) => a.status === x));
      const erst = l.reduce((m, a) => (a.erfasst < m.erfasst ? a : m), l[0]);
      return {
        antragId: k, benutzerId: l[0].benutzer_id, name: l[0].name, code: l[0].code === 'K' && !kSichtbar(l[0]) ? 'abwesend' : l[0].code,
        von: l[0].datum, bis: l[l.length - 1].datum, arbeitstage: l.length, status: st[0],
        notiz: (l.find((a) => a.notiz) || {}).notiz || '', antwort: (l.find((a) => a.antwort) || {}).antwort || '',
        erfasst: erst.erfasst, erfasstVon: erst.erfasst_von, ...(l.some((a) => a.betriebsurlaub) ? { art: 'betriebsurlaub' } : {}),
        tage: l.map((a) => ({ id: a.id, datum: a.datum, status: a.status }))
      };
    });
  }
  const antragPfad = (roh) => { const x = String(roh || ''); if (!/^[a-z0-9]{1,40}$/.test(x)) throw ungueltig('antragId ist ungültig.'); return x; };

  api.get('/abwesenheiten/antraege', (req, res) => {
    const q = req.query;
    const status = q.status === undefined ? null : v.auswahl(String(q.status), 'status', ['beantragt', 'genehmigt', 'abgelehnt']);
    const von = q.von === undefined ? null : v.datum(String(q.von), 'von');
    const bis = q.bis === undefined ? null : v.datum(String(q.bis), 'bis');
    const benutzerId = q.benutzerId === undefined ? null : v.pfadId(String(q.benutzerId), 'benutzerId');
    const liste = antraegeLaden(req.ctx, { benutzerId })
      .filter((a) => (!status || a.status === status) && (!von || a.bis >= von) && (!bis || a.von <= bis))
      .sort((a, b) => (b.erfasst || '').localeCompare(a.erfasst || '') || b.von.localeCompare(a.von));
    res.json(liste.slice(0, 1000));
  });

  api.put('/abwesenheiten/antraege/:antragId', (req, res) => {
    const ctx = req.ctx;
    const aid = antragPfad(req.params.antragId);
    const body = v.objekt(req.body);
    const status = v.auswahl(body.status, 'status', ['genehmigt', 'abgelehnt']);
    const antwortText = body.antwort == null || body.antwort === '' ? null : v.text(body.antwort, 'antwort', { max: 300 });
    const zeilen = db.alle(`SELECT a.*, b.name, b.baustelle_id AS stamm FROM abwesenheit a JOIN benutzer b ON b.id = a.benutzer_id WHERE ${ANTRAG_SQL} = ? ORDER BY a.datum`, aid);
    if (!zeilen.length) throw nichtGefunden('Antrag nicht gefunden.');
    const a0 = zeilen[0];
    const bauleiterSw = zeilen.every((a) => a.code === 'SW') && ctx.benutzer.rolle === 'bauleiter' && a0.stamm != null
      && Boolean(db.eins('SELECT id FROM baustelle WHERE id = ? AND bauleiter_id = ?', a0.stamm, ctx.benutzer.id));
    if (!darfEntscheiden(ctx) && !bauleiterSw) throw keinZugriff('Anträge genehmigt das Büro bzw. die Lohnverrechnung (Schlechtwetter auch der Bauleiter der Baustelle).');
    if (a0.benutzer_id === ctx.benutzer.id) throw keinZugriff('Eigene Anträge entscheidet eine andere Person (Vier-Augen-Prinzip).');
    const offen = zeilen.filter((a) => a.status === 'beantragt');
    if (!offen.length) throw konflikt('Der Antrag ist schon entschieden.');
    const zeit = bt.uhr().toISOString();
    db.transaktion(() => {
      for (const a of offen) db.lauf('UPDATE abwesenheit SET status = ?, entschieden = ?, entschieden_von = ?, antwort = COALESCE(?, antwort) WHERE id = ?', status, zeit, ctx.benutzer.id, antwortText, a.id);
      const z = zeitText(offen[0].datum, offen[offen.length - 1].datum);
      db.protokolliere({ zeit, benutzerId: ctx.benutzer.id, art: 'abwesenheit', objekt: `benutzer:${a0.benutzer_id}`, alt: { antragId: aid, status: 'beantragt', tage: offen.length }, neu: { status, antwort: antwortText }, text: `${CODE_TEXT[a0.code]} ${a0.name} ${z} (${offen.length} Tage) ${status}` });
      benachrichtige(db, { benutzerId: a0.benutzer_id, typ: 'abwesenheit', titel: `${CODE_TEXT[a0.code]} ${status}`, text: `Ihr Antrag (${CODE_TEXT[a0.code]} ${z}, ${offen.length} ${offen.length === 1 ? 'Arbeitstag' : 'Arbeitstage'}) wurde ${status}.${antwortText ? ` ${antwortText}` : ''}`, zeit, schluessel: `abw:antrag:${aid}:${status}:${zeit}` });
    });
    res.json(antraegeLaden(ctx, { antragId: aid })[0]);
  });

  api.delete('/abwesenheiten/antraege/:antragId', (req, res) => {
    const ctx = req.ctx;
    const aid = antragPfad(req.params.antragId);
    const zeilen = db.alle(`SELECT a.* FROM abwesenheit a WHERE ${ANTRAG_SQL} = ?`, aid);
    if (!zeilen.length) throw nichtGefunden('Antrag nicht gefunden.');
    let weg;
    const eigen = zeilen[0].benutzer_id === ctx.benutzer.id;
    if (darfEntscheiden(ctx) && !(eigen && zeilen.every((a) => a.status === 'beantragt'))) weg = zeilen;
    else if (eigen) {
      weg = zeilen.filter((a) => a.status === 'beantragt');
      if (!weg.length) throw konflikt('Der Antrag ist schon entschieden – zurückziehen nicht mehr möglich.');
    } else throw keinZugriff('Zurückziehen können Sie nur eigene, noch nicht entschiedene Anträge.');
    const korrektur = !eigen && weg.some((a) => a.status !== 'beantragt');
    db.transaktion(() => {
      for (const a of weg) db.lauf('DELETE FROM abwesenheit WHERE id = ?', a.id);
      const z = zeitText(weg[0].datum, weg[weg.length - 1].datum);
      db.protokolliere({ zeit: bt.uhr().toISOString(), benutzerId: ctx.benutzer.id, art: 'abwesenheit', objekt: `benutzer:${zeilen[0].benutzer_id}`, alt: { antragId: aid, code: zeilen[0].code, status: zeilen[0].status, tage: weg.map((a) => a.datum) }, text: `Antrag ${CODE_TEXT[zeilen[0].code]} ${z} (${weg.length} Tage) ${eigen ? 'zurückgezogen' : korrektur ? 'gelöscht (Korrektur)' : 'gelöscht'}` });
      if (!eigen) benachrichtige(db, { benutzerId: zeilen[0].benutzer_id, typ: 'abwesenheit', titel: `${CODE_TEXT[zeilen[0].code]} gelöscht`, text: `Ihr Antrag (${CODE_TEXT[zeilen[0].code]} ${z}, ${weg.length} ${weg.length === 1 ? 'Arbeitstag' : 'Arbeitstage'}) wurde gelöscht (${korrektur ? 'Korrektur durch das Büro' : 'durch das Büro'}).`, zeit: bt.uhr().toISOString(), schluessel: `abw:antrag:${aid}:weg:${bt.uhr().toISOString()}` });
    });
    res.json({ ok: true, geloescht: weg.length });
  });
};
