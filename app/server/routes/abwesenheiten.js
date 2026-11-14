'use strict';
/** Abwesenheiten (K/U/SW/ZA): Antrag, Genehmigen/Ablehnen, Löschen – B-07 */
const v = require('../validierung');
const { ungueltig, keinZugriff, konflikt, nichtGefunden } = require('../fehler');
const { bereich, baustelleImBereich } = require('../rechte');
const { wienDatum, plusTage, deDatum, istArbeitstag, feiertag, wochentag } = require('../datum');
const crypto = require('node:crypto');
const DS = require('../datenschutz'); // R-01…R-03: Krankenstand/Notizen nur für stammdaten/lohn und die Person selbst
const { benachrichtige } = require('../budget');

const CODES = ['K', 'U', 'SW', 'ZA'];
const CODE_TEXT = { K: 'Krankenstand', U: 'Urlaub', SW: 'Schlechtwetter', ZA: 'Zeitausgleich' };

const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
/** Antrags-ID (12.24): Bestand ohne Antrag → "e<id>" */
const antragId = (a) => a.antrag_id || `e${a.id}`;
const ANTRAG_SQL = "COALESCE(a.antrag_id, 'e' || a.id)";
// „a“ + Zufall: nie verwechselbar mit Bestands-IDs „e<id>“
const neueAntragId = () => `a${crypto.randomBytes(6).toString('hex')}`;
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
    if (DS.stufe(ctx) === 'voll') return null; // Büro/Lohn/GF und Bauleiter: alle Personen (nur lesen)
    const ich = ctx.benutzer;
    const ids = new Set([ich.id]);
    // Inhaber 13.11.2026: Polier und Mitarbeiter sehen Abwesenheiten anderer gar nicht – nur die eigenen
    if (DS.stufe(ctx) === 'keine') return ids;
    const ber = bereich(ich);
    if (ber === 'bauleiter' || ich.rolle === 'polier') {
      const bs = db.alle('SELECT id, polier_id, bauleiter_id FROM baustelle').filter((b) => baustelleImBereich(ich, b)).map((b) => b.id);
      for (const b of db.alle('SELECT id, baustelle_id FROM benutzer')) if (bs.includes(b.baustelle_id)) ids.add(b.id);
    }
    return ids;
  }

  /**
   * Offene (beantragte) Anträge der Person, die von den Tagen berührt werden (Inhaber 13.11.2026: Urlaub nur als ganzer Antrag).
   * ganz = alle offenen Tage des Antrags liegen in `tage` (darf als Ganzes ersetzt werden), teil = nur ein Teil (→ 409 bzw. bleibt).
   */
  function offeneBetroffen(benutzerId, tage) {
    const menge = new Set(tage);
    const ganz = [], teil = [], gesehen = new Set();
    for (const d of menge) {
      const a = db.eins("SELECT * FROM abwesenheit WHERE benutzer_id = ? AND datum = ? AND status = 'beantragt'", benutzerId, d);
      if (!a || gesehen.has(antragId(a))) continue;
      gesehen.add(antragId(a));
      const offen = a.antrag_id ? db.alle("SELECT * FROM abwesenheit WHERE antrag_id = ? AND status = 'beantragt' ORDER BY datum", a.antrag_id) : [a];
      (offen.every((x) => x.benutzer_id === benutzerId && menge.has(x.datum)) ? ganz : teil).push({ antragId: antragId(a), tage: offen });
    }
    return { ganz, teil };
  }
  bt.offeneAntraegeBetroffen = offeneBetroffen;
  /** Person informieren: ihr offener Antrag wurde vom Büro als Ganzes ersetzt (14.3) */
  function ersetztMelden(ganz, neu, zeit) {
    for (const g of ganz) {
      const a0 = g.tage[0], z = zeitText(a0.datum, g.tage[g.tage.length - 1].datum);
      benachrichtige(db, { benutzerId: a0.benutzer_id, typ: 'abwesenheit', titel: `${CODE_TEXT[a0.code]}: Antrag ersetzt`, text: `Ihr Antrag (${CODE_TEXT[a0.code]} ${z}) wurde vom Büro durch einen neuen Eintrag ersetzt (${neu.text}).`, zeit, schluessel: `abw:antrag:${g.antragId}:ersetzt:${zeit}` });
    }
  }
  bt.antragErsetztMelden = ersetztMelden;
  const mehrtaegigOffen = (a) => a.status === 'beantragt' && a.antrag_id && db.eins("SELECT COUNT(*) AS n FROM abwesenheit WHERE antrag_id = ? AND status = 'beantragt'", a.antrag_id).n > 1;

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
    res.json(z.filter((a) => !ids || ids.has(a.benutzer_id)).map(json).map((a) => DS.abwesenheitFuer(req.ctx, a)));
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
    if (swMeldung(ctx, benutzerId, code)) return swMelden(req, res, { ziel, von: datum, bis: datum, notiz: null, vorschau: false });
    const vorhanden = db.eins('SELECT * FROM abwesenheit WHERE benutzer_id = ? AND datum = ?', benutzerId, datum);
    if (vorhanden && vorhanden.status !== 'abgelehnt' && (!ctx.hat('stammdaten') || benutzerId === ich.id)) throw konflikt(`Für ${deDatum(datum)} ist ${DS.bereits(ctx, benutzerId, vorhanden.code)}.`);
    // 14.3: ein offener Antrag wird nur als Ganzes ersetzt – ein Tag aus einem mehrtägigen offenen Antrag → 409
    let ersetzt = [];
    if (vorhanden && vorhanden.status === 'beantragt') {
      const b = offeneBetroffen(benutzerId, [datum]);
      if (b.teil.length) throw konflikt('Der Tag gehört zu einem offenen Antrag über mehrere Tage – bitte den ganzen Antrag entscheiden.', { antragId: b.teil[0].antragId });
      ersetzt = b.ganz;
    }
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
      ersetztMelden(ersetzt, { text: `${CODE_TEXT[code]} am ${tagKurz(datum)}, ${status}` }, zeit);
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
    // 12.24/14.3: wie beim Antrag – Entschiedenes wird nicht umentschieden (Korrektur nur über Löschen)
    if (a.status !== 'beantragt') throw konflikt('Der Antrag ist schon entschieden.');
    const status = v.auswahl(v.objekt(req.body).status, 'status', ['genehmigt', 'abgelehnt']);
    const zeit = bt.uhr().toISOString();
    db.transaktion(() => {
      db.lauf('UPDATE abwesenheit SET status = ?, entschieden = ?, entschieden_von = ? WHERE id = ?', status, zeit, ctx.benutzer.id, id);
      db.protokolliere({ zeit, benutzerId: ctx.benutzer.id, art: 'abwesenheit', objekt: `benutzer:${a.benutzer_id}`, alt: { datum: a.datum, code: a.code, status: a.status }, neu: { status }, text: `${CODE_TEXT[a.code]} ${a.name} ${deDatum(a.datum)} ${status}` });
      benachrichtige(db, { benutzerId: a.benutzer_id, typ: 'abwesenheit', titel: `${CODE_TEXT[a.code]} ${status}`, text: `Ihr Antrag (${CODE_TEXT[a.code]} am ${deDatum(a.datum)}) wurde ${status}.`, zeit, schluessel: `abw:${id}:${status}:${zeit}` });
    });
    if (a.antrag_id) swAbgleich(a.antrag_id, ctx.benutzer.id);
    res.json(DS.abwesenheitFuer(ctx, json(db.eins('SELECT a.*, b.name FROM abwesenheit a JOIN benutzer b ON b.id = a.benutzer_id WHERE a.id = ?', id))));
  });

  api.delete('/abwesenheiten/:id', (req, res) => {
    const ctx = req.ctx;
    const id = v.pfadId(req.params.id, 'ID');
    const a = db.eins('SELECT * FROM abwesenheit WHERE id = ?', id);
    if (!a || !DS.siehtAbwesenheit(ctx, a.benutzer_id)) throw nichtGefunden('Abwesenheit nicht gefunden.'); // nie Auskunft über fremde Einträge
    const eigen = a.benutzer_id === ctx.benutzer.id;
    // Vier-Augen-Prinzip (7, 14.3): eigene entschiedene Abwesenheiten löscht nur eine andere Person – auch für Büro/GF
    if (eigen && a.status !== 'beantragt') throw keinZugriff(darfEntscheiden(ctx) ? 'Eigene entschiedene Abwesenheiten korrigiert eine andere Person (Vier-Augen-Prinzip).' : 'Löschen können Sie nur eigene, noch nicht entschiedene Anträge.');
    if (!eigen && !darfEntscheiden(ctx)) throw keinZugriff('Löschen können Sie nur eigene, noch nicht entschiedene Anträge.');
    // Inhaber 13.11.2026: ein offener mehrtägiger Antrag nur als Ganzes (zurückziehen bzw. entscheiden)
    if (mehrtaegigOffen(a)) throw konflikt(eigen ? 'Bitte den ganzen Antrag zurückziehen.' : 'Bitte den ganzen Antrag entscheiden.', { antragId: a.antrag_id });
    const korrektur = !eigen;
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
    if (swMeldung(ctx, benutzerId, code)) return swMelden(req, res, { ziel, von, bis, notiz, vorschau });
    const ersetzenErlaubt = ctx.hat('stammdaten') && benutzerId !== ich.id;
    const tage = [], uebersprungen = [], ersetzen = [], konflikte = [], vorab = new Map();
    for (let d = von; d <= bis; d = plusTage(d, 1)) {
      if (!istArbeitstag(d)) { const f = feiertag(d); if (f && wochentag(d) >= 1 && wochentag(d) <= 5) uebersprungen.push({ datum: d, grund: `Feiertag: ${f}` }); continue; }
      const a = db.eins('SELECT * FROM abwesenheit WHERE benutzer_id = ? AND datum = ?', benutzerId, d);
      if (a && a.status === 'genehmigt') { uebersprungen.push({ datum: d, grund: DS.darfDetails(ctx, benutzerId) ? `schon ${a.code} genehmigt` : 'bereits abwesend' }); continue; }
      if (a && a.status === 'beantragt' && !ersetzenErlaubt) { konflikte.push(d); continue; }
      if (a) ersetzen.push(a.id);
      vorab.set(d, a ? { status: a.status, antragId: a.antrag_id || '' } : null);
      tage.push(d);
    }
    if (konflikte.length) throw konflikt(`Für ${konflikte.map(deDatum).join(', ')} gibt es schon einen offenen Antrag – bitte zuerst zurückziehen.`, { tage: konflikte });
    // 14.3 (Inhaber 13.11.2026): offene Anträge der Person nur als Ganzes ersetzen; ragt einer über den Zeitraum hinaus → 409
    let ersetzt = [];
    if (ersetzenErlaubt) {
      const b = offeneBetroffen(benutzerId, tage);
      if (b.teil.length) {
        const td = b.teil.flatMap((g) => g.tage.map((x) => x.datum)).filter((d) => tage.includes(d));
        throw konflikt(`Für ${td.map(deDatum).join(', ')} gibt es einen offenen Antrag, der über diesen Zeitraum hinausreicht – bitte zuerst den ganzen Antrag entscheiden.`, { antragIds: b.teil.map((g) => g.antragId) });
      }
      ersetzt = b.ganz;
    }
    let konto = null;
    if (code === 'U' && typeof bt.urlaubKonto === 'function' && darfKontoSehen(ctx, benutzerId)) {
      const k = bt.urlaubKonto(ziel, von);
      // gezählt wird wie im Konto: ab Beginn des Urlaubsjahres bzw. ab dem BUAK-Stichtag (14.3)
      const neu = tage.filter((d) => d >= k.ab && d <= k.bis).length;
      konto = { rest: k.rest, restNachAntrag: k.rest == null ? null : Math.round((k.rest - neu) * 10) / 10 };
    }
    const antwort = { antragId: null, benutzerId, code, status, tage, uebersprungen, ersetzt: ersetzt.flatMap((g) => g.tage.map((x) => ({ datum: x.datum, antragId: g.antragId }))), arbeitstage: tage.length, konto };
    if (vorschau) return res.json(antwort);
    if (!tage.length) throw ungueltig('Im Zeitraum liegt kein Arbeitstag, der beantragt werden kann.');
    const zeit = bt.uhr().toISOString();
    const aid = neueAntragId();
    db.transaktion(() => {
      for (const d of tage) {
        db.lauf(`INSERT INTO abwesenheit (benutzer_id, datum, code, status, erfasst_von, erfasst, antrag_id, notiz) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(benutzer_id, datum) DO UPDATE SET code = excluded.code, status = excluded.status, erfasst_von = excluded.erfasst_von, erfasst = excluded.erfasst,
            entschieden = NULL, entschieden_von = NULL, betriebsurlaub = 0, antwort = NULL, antrag_id = excluded.antrag_id, notiz = excluded.notiz
          WHERE abwesenheit.status = ? AND COALESCE(abwesenheit.antrag_id, '') = ?`,
        benutzerId, d, code, status, ich.id, zeit, aid, notiz, vorab.get(d) ? vorab.get(d).status : '', vorab.get(d) ? vorab.get(d).antragId : '');
        // Schutz (N-076): nur der vorab geprüfte Stand wird ersetzt – ein inzwischen geänderter (z. B. genehmigter) Tag bricht die Transaktion ab
        const z = db.eins('SELECT status, antrag_id FROM abwesenheit WHERE benutzer_id = ? AND datum = ?', benutzerId, d);
        if (z.antrag_id !== aid) throw konflikt(`${deDatum(d)} wurde inzwischen geändert – bitte neu laden.`);
      }
      ersetztMelden(ersetzt, { text: `${CODE_TEXT[code]} ${zeitText(tage[0], tage[tage.length - 1])}, ${status}` }, zeit);
      db.protokolliere({ zeit, benutzerId: ich.id, art: 'abwesenheit', objekt: `benutzer:${benutzerId}`, neu: { antragId: aid, von, bis, code, status, tage: tage.length, uebersprungen: uebersprungen.length, ersetzt: ersetzen.length, ersetzteAntraege: ersetzt.map((g) => g.antragId) }, text: `${titelCode(code)} ${ziel.name}: ${zeitText(tage[0], tage[tage.length - 1])} (${tage.length} Arbeitstage, ${status})` });
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
    return [...gruppen].map(([k, l]) => {
      // Status gilt für den ganzen Antrag (kein „teilweise“, Entscheidung 13.11.2026); Bestand gemischt → offen vor genehmigt vor abgelehnt
      const st = ['beantragt', 'genehmigt', 'abgelehnt'].filter((x) => l.some((a) => a.status === x));
      const erst = l.reduce((m, a) => (a.erfasst < m.erfasst ? a : m), l[0]);
      return {
        antragId: k, benutzerId: l[0].benutzer_id, name: l[0].name, code: DS.code(ctx, l[0].benutzer_id, l[0].code),
        von: l[0].datum, bis: l[l.length - 1].datum, arbeitstage: l.length, status: st[0],
        notiz: DS.notiz(ctx, l[0].benutzer_id, (l.find((a) => a.notiz) || {}).notiz || '') || '', antwort: DS.notiz(ctx, l[0].benutzer_id, (l.find((a) => a.antwort) || {}).antwort || '') || '',
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
    if (!darfEntscheiden(ctx) && ctx.benutzer.rolle !== 'bauleiter') throw keinZugriff('Anträge genehmigt das Büro bzw. die Lohnverrechnung (Schlechtwetter auch der Bauleiter der Baustelle).');
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
    swAbgleich(aid, ctx.benutzer.id);
    res.json(antraegeLaden(ctx, { antragId: aid })[0]);
  });

  api.delete('/abwesenheiten/antraege/:antragId', (req, res) => {
    const ctx = req.ctx;
    const aid = antragPfad(req.params.antragId);
    const zeilen = db.alle(`SELECT a.* FROM abwesenheit a WHERE ${ANTRAG_SQL} = ?`, aid);
    if (!zeilen.length || !DS.siehtAbwesenheit(ctx, zeilen[0].benutzer_id)) throw nichtGefunden('Antrag nicht gefunden.');
    let weg;
    const eigen = zeilen[0].benutzer_id === ctx.benutzer.id;
    if (eigen) {
      // Vier-Augen-Prinzip (7, 14.3): selbst nur den offenen Antrag zurückziehen – Entschiedenes löscht eine andere Person
      weg = zeilen.filter((a) => a.status === 'beantragt');
      if (!weg.length && darfEntscheiden(ctx)) throw keinZugriff('Eigene entschiedene Abwesenheiten korrigiert eine andere Person (Vier-Augen-Prinzip).');
      if (!weg.length) throw konflikt('Der Antrag ist schon entschieden – zurückziehen nicht mehr möglich.');
    } else if (darfEntscheiden(ctx)) weg = zeilen;
    else throw keinZugriff('Zurückziehen können Sie nur eigene, noch nicht entschiedene Anträge.');
    const korrektur = !eigen && weg.some((a) => a.status !== 'beantragt');
    db.transaktion(() => {
      for (const a of weg) db.lauf('DELETE FROM abwesenheit WHERE id = ?', a.id);
      const z = zeitText(weg[0].datum, weg[weg.length - 1].datum);
      db.protokolliere({ zeit: bt.uhr().toISOString(), benutzerId: ctx.benutzer.id, art: 'abwesenheit', objekt: `benutzer:${zeilen[0].benutzer_id}`, alt: { antragId: aid, code: zeilen[0].code, status: zeilen[0].status, tage: weg.map((a) => a.datum) }, text: `Antrag ${CODE_TEXT[zeilen[0].code]} ${z} (${weg.length} Tage) ${eigen ? 'zurückgezogen' : korrektur ? 'gelöscht (Korrektur)' : 'gelöscht'}` });
      if (!eigen) benachrichtige(db, { benutzerId: zeilen[0].benutzer_id, typ: 'abwesenheit', titel: `${CODE_TEXT[zeilen[0].code]} gelöscht`, text: `Ihr Antrag (${CODE_TEXT[zeilen[0].code]} ${z}, ${weg.length} ${weg.length === 1 ? 'Arbeitstag' : 'Arbeitstage'}) wurde gelöscht (${korrektur ? 'Korrektur durch das Büro' : 'durch das Büro'}).`, zeit: bt.uhr().toISOString(), schluessel: `abw:antrag:${aid}:weg:${bt.uhr().toISOString()}` });
    });
    res.json({ ok: true, geloescht: weg.length });
  });

  /** 14.3: Korrektur eines entschiedenen Antrags – mehrere Tage auf einmal, atomar, genau eine Benachrichtigung */
  api.post('/abwesenheiten/antraege/:antragId/korrektur', (req, res) => {
    const ctx = req.ctx;
    if (!darfEntscheiden(ctx)) throw keinZugriff('Korrekturen nimmt das Büro bzw. die Lohnverrechnung vor.');
    const aid = antragPfad(req.params.antragId);
    const zeilen = db.alle(`SELECT a.* FROM abwesenheit a WHERE ${ANTRAG_SQL} = ? ORDER BY a.datum`, aid);
    if (!zeilen.length) throw nichtGefunden('Antrag nicht gefunden.');
    if (zeilen[0].benutzer_id === ctx.benutzer.id) throw keinZugriff('Eigene entschiedene Abwesenheiten korrigiert eine andere Person (Vier-Augen-Prinzip).');
    const body = v.objekt(req.body);
    const ids = [...new Set(v.liste(body.tage, 'tage', { max: 100 }).map((x) => v.id(x, 'tage')))];
    if (!ids.length) throw ungueltig('tage: bitte mindestens einen Tag angeben.');
    const weg = zeilen.filter((a) => ids.includes(a.id));
    if (weg.length !== ids.length) throw ungueltig('tage: nicht alle Tage gehören zu diesem Antrag.');
    if (zeilen.some((a) => a.status === 'beantragt')) throw konflikt('Der Antrag ist noch offen – bitte den ganzen Antrag entscheiden.');
    if (weg.some((a) => a.status !== 'genehmigt')) throw konflikt('Korrigiert werden nur genehmigte Tage.');
    const zeit = bt.uhr().toISOString();
    const a0 = zeilen[0];
    db.transaktion(() => {
      for (const a of weg) db.lauf('DELETE FROM abwesenheit WHERE id = ?', a.id);
      const z = weg.length === 1 ? tagKurz(weg[0].datum) : weg.map((a) => tagKurz(a.datum)).join(', ');
      db.protokolliere({ zeit, benutzerId: ctx.benutzer.id, art: 'abwesenheit', objekt: `benutzer:${a0.benutzer_id}`, alt: { antragId: aid, code: a0.code, status: 'genehmigt', tage: weg.map((a) => a.datum), korrektur: true }, text: `Antrag ${CODE_TEXT[a0.code]}: ${weg.length} ${weg.length === 1 ? 'Tag' : 'Tage'} gelöscht (Korrektur)` });
      benachrichtige(db, { benutzerId: a0.benutzer_id, typ: 'abwesenheit', titel: `${CODE_TEXT[a0.code]} korrigiert`, text: `${CODE_TEXT[a0.code]} am ${z} wurde gelöscht (Korrektur durch das Büro, ${weg.length} ${weg.length === 1 ? 'Arbeitstag' : 'Arbeitstage'}).`, zeit, schluessel: `abw:antrag:${aid}:korrektur:${zeit}` });
    });
    res.json({ ok: true, geloescht: weg.length, antrag: antraegeLaden(ctx, { antragId: aid })[0] || null });
  });

  /* ---------- Schlechtwetter-Meldung des Poliers (Inhaber 13.11.2026) ----------
   * Der Polier meldet SW für seine Partie, erfährt dabei aber nie, ob jemand schon abwesend ist: jede Meldung wird
   * angenommen („gemeldet“); Tage mit bestehender Abwesenheit werden still übergangen (das Büro sieht alles).
   */
  function swMeldung(ctx, benutzerId, code) {
    return code === 'SW' && benutzerId !== ctx.benutzer.id && DS.stufe(ctx) === 'keine';
  }
  function swMelden(req, res, { ziel, von, bis, notiz, vorschau }) {
    const ich = req.ctx.benutzer;
    const tage = [];
    for (let d = von; d <= bis; d = plusTage(d, 1)) if (istArbeitstag(d)) tage.push(d); // nur Kalender – keine Auskunft aus der DB
    const basis = { benutzerId: ziel.id, von, bis, code: 'SW', arbeitstage: tage.length, text: DS.SW_GEMELDET };
    if (vorschau) return res.json({ vorschau: true, ...basis });
    if (!tage.length) throw ungueltig('Im Zeitraum liegt kein Arbeitstag.');
    const zeit = bt.uhr().toISOString();
    const aid = neueAntragId();
    let meldungId;
    db.transaktion(() => {
      for (const d of tage) {
        const a = db.eins('SELECT * FROM abwesenheit WHERE benutzer_id = ? AND datum = ?', ziel.id, d);
        if (a && a.status !== 'abgelehnt') continue; // still übergehen – das Büro klärt beim Bestätigen
        db.lauf(`INSERT INTO abwesenheit (benutzer_id, datum, code, status, erfasst_von, erfasst, antrag_id, notiz) VALUES (?, ?, 'SW', 'beantragt', ?, ?, ?, ?)
          ON CONFLICT(benutzer_id, datum) DO UPDATE SET code = 'SW', status = 'beantragt', erfasst_von = excluded.erfasst_von, erfasst = excluded.erfasst,
            entschieden = NULL, entschieden_von = NULL, betriebsurlaub = 0, antwort = NULL, antrag_id = excluded.antrag_id, notiz = excluded.notiz`, ziel.id, d, ich.id, zeit, aid, notiz);
      }
      meldungId = db.lauf('INSERT INTO sw_meldung (polier_id, benutzer_id, von, bis, antrag_id, notiz, erstellt) VALUES (?, ?, ?, ?, ?, ?, ?)', ich.id, ziel.id, von, bis, aid, notiz, zeit).id;
      db.protokolliere({ zeit, benutzerId: ich.id, art: 'abwesenheit', objekt: `benutzer:${ziel.id}`, neu: { swMeldung: meldungId, antragId: aid, von, bis }, text: `Schlechtwetter gemeldet von ${ich.name} für ${ziel.name}: ${zeitText(von, bis)}` });
      for (const e of db.alle("SELECT id FROM benutzer WHERE aktiv = 1 AND rolle IN ('buero','gf') AND id <> ?", ziel.id)) {
        benachrichtige(db, { benutzerId: e.id, typ: 'abwesenheit', titel: `Schlechtwetter gemeldet: ${ziel.name}`, text: `${ich.name} meldet Schlechtwetter für ${ziel.name}: ${zeitText(von, bis)}. Bitte bestätigen.`, zeit, schluessel: `sw:${meldungId}` });
      }
    });
    swAbgleich(aid, null); // keine offenen Tage (alle übergangen) → bleibt „gemeldet“ bis das Büro bestätigt
    res.status(201).json({ meldungId, ...basis, status: 'gemeldet' });
  }
  /** Status einer SW-Meldung: „bestaetigt“, sobald das Büro alle ihre offenen Tage entschieden hat */
  function swAbgleich(aid, vonId) {
    const m = db.eins("SELECT * FROM sw_meldung WHERE antrag_id = ? AND status = 'gemeldet'", aid);
    if (!m || vonId == null) return;
    if (db.eins("SELECT 1 AS x FROM abwesenheit WHERE antrag_id = ? AND status = 'beantragt' LIMIT 1", aid)) return;
    swBestaetigen(m, vonId);
  }
  function swBestaetigen(m, vonId) {
    const zeit = bt.uhr().toISOString();
    db.lauf("UPDATE sw_meldung SET status = 'bestaetigt', bestaetigt = ?, bestaetigt_von = ? WHERE id = ?", zeit, vonId, m.id);
    const ziel = db.eins('SELECT name FROM benutzer WHERE id = ?', m.benutzer_id) || {};
    benachrichtige(db, { benutzerId: m.polier_id, typ: 'abwesenheit', titel: 'Schlechtwetter-Meldung bestätigt', text: `Ihre Schlechtwetter-Meldung für ${ziel.name || '?'} (${zeitText(m.von, m.bis)}) wurde vom Büro bestätigt.`, zeit, schluessel: `sw:${m.id}:bestaetigt` });
  }
  const swJson = (m, namen) => ({ id: m.id, benutzerId: m.benutzer_id, name: namen.get(m.benutzer_id) || '?', von: m.von, bis: m.bis, status: m.status, erstellt: m.erstellt, polier: { id: m.polier_id, name: namen.get(m.polier_id) || '?' }, ...(m.bestaetigt ? { bestaetigt: m.bestaetigt } : {}) });
  api.get('/abwesenheiten/sw-meldungen', (req, res) => {
    const ctx = req.ctx;
    const namen = new Map(db.alle('SELECT id, name FROM benutzer').map((b) => [b.id, b.name]));
    let liste;
    if (darfEntscheiden(ctx)) liste = db.alle('SELECT * FROM sw_meldung ORDER BY erstellt DESC LIMIT 500');
    else if (ctx.benutzer.rolle === 'polier') liste = db.alle('SELECT * FROM sw_meldung WHERE polier_id = ? ORDER BY erstellt DESC LIMIT 500', ctx.benutzer.id);
    else if (ctx.benutzer.rolle === 'bauleiter') { const ids = sichtbareIds(ctx); liste = db.alle('SELECT * FROM sw_meldung ORDER BY erstellt DESC LIMIT 500').filter((m) => ids.has(m.benutzer_id)); } else throw keinZugriff();
    res.json(liste.map((m) => swJson(m, namen)));
  });
  api.post('/abwesenheiten/sw-meldungen/:id/bestaetigen', (req, res) => {
    const ctx = req.ctx;
    if (!darfEntscheiden(ctx)) throw keinZugriff('Schlechtwetter-Meldungen bestätigt das Büro.');
    const m = db.eins('SELECT * FROM sw_meldung WHERE id = ?', v.pfadId(req.params.id, 'ID'));
    if (!m) throw nichtGefunden('Meldung nicht gefunden.');
    if (m.status === 'bestaetigt') throw konflikt('Die Meldung ist schon bestätigt.');
    if (m.benutzer_id === ctx.benutzer.id) throw keinZugriff('Eigene Meldungen bestätigt eine andere Person (Vier-Augen-Prinzip).');
    const zeit = bt.uhr().toISOString();
    db.transaktion(() => {
      const offen = db.alle("SELECT * FROM abwesenheit WHERE antrag_id = ? AND status = 'beantragt'", m.antrag_id);
      for (const a of offen) db.lauf("UPDATE abwesenheit SET status = 'genehmigt', entschieden = ?, entschieden_von = ? WHERE id = ?", zeit, ctx.benutzer.id, a.id);
      if (offen.length) benachrichtige(db, { benutzerId: m.benutzer_id, typ: 'abwesenheit', titel: 'Schlechtwetter genehmigt', text: `Schlechtwetter ${zeitText(offen[0].datum, offen[offen.length - 1].datum)} wurde genehmigt.`, zeit, schluessel: `sw:${m.id}:person` });
      swBestaetigen(m, ctx.benutzer.id);
      db.protokolliere({ zeit, benutzerId: ctx.benutzer.id, art: 'abwesenheit', objekt: `benutzer:${m.benutzer_id}`, neu: { swMeldung: m.id, genehmigt: offen.length }, text: `Schlechtwetter-Meldung ${m.id} bestätigt (${offen.length} Tage genehmigt)` });
    });
    const namen = new Map(db.alle('SELECT id, name FROM benutzer').map((b) => [b.id, b.name]));
    res.json(swJson(db.eins('SELECT * FROM sw_meldung WHERE id = ?', m.id), namen));
  });
};
