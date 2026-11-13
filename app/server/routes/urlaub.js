'use strict';
/** Urlaubsübersicht, Urlaubskonto, Betriebsurlaub, Warnungen (API.md 12.19) – keine €-Felder */
const v = require('../validierung');
const { ungueltig, keinZugriff } = require('../fehler');
const { bereich, baustelleImBereich } = require('../rechte');
const { wienDatum, plusTage, feiertage, istArbeitstag, wochentag } = require('../datum');
const { csv } = require('../export');
const { benachrichtige } = require('../budget');

const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const CODE_TEXT = { U: 'Urlaub', ZA: 'Zeitausgleich', K: 'Krank', SW: 'Schlechtwetter', BU: 'Betriebsurlaub' };

module.exports = function urlaubRouten(api, bt) {
  const { db } = bt;
  const jetzt = () => bt.uhr().toISOString();
  const heute = () => wienDatum(bt.uhr());
  const verwaltung = (ctx) => ctx.hat('stammdaten') || ctx.hat('lohn');
  const einst = () => ({ partieGrenze: 2, partieGrenzeProzent: 30, urlaubsjahrBeginn: '01-01', ...(db.einstellung('urlaub', {}) || {}) });

  function sichtbareIds(ctx) {
    if (verwaltung(ctx)) return null;
    const ich = ctx.benutzer;
    const ids = new Set([ich.id]);
    if (bereich(ich) === 'bauleiter' || ich.rolle === 'polier') {
      const bs = db.alle('SELECT id, polier_id, bauleiter_id FROM baustelle').filter((b) => baustelleImBereich(ich, b)).map((b) => b.id);
      for (const b of db.alle('SELECT id, baustelle_id FROM benutzer')) if (bs.includes(b.baustelle_id)) ids.add(b.id);
    }
    return ids;
  }
  const code = (a, ctx, ich) => {
    const c = a.betriebsurlaub ? 'BU' : a.code;
    if (c === 'K' && !verwaltung(ctx) && a.benutzer_id !== ich) return 'abwesend';
    return c;
  };
  function zeitraum(q, max = 62) {
    const von = q.von ? v.datum(String(q.von), 'von') : heute();
    const bis = q.bis ? v.datum(String(q.bis), 'bis') : plusTage(von, 27);
    if (bis < von || plusTage(von, max) < bis) throw ungueltig(`Zeitraum höchstens ${max} Tage.`);
    return { von, bis };
  }

  api.get('/urlaub/feiertage', (req, res) => {
    const jahr = req.query.jahr ? v.zahl(Number(req.query.jahr), 'jahr', { min: 2000, max: 2100, ganz: true }) : Number(heute().slice(0, 4));
    res.json(Object.entries(feiertage(jahr)).sort().map(([datum, name]) => ({ datum, name })));
  });

  api.get('/urlaub/kalender', (req, res) => {
    const { von, bis } = zeitraum(req.query);
    const ids = sichtbareIds(req.ctx);
    const tage = [];
    for (let d = von; d <= bis; d = plusTage(d, 1)) {
      const f = feiertage(Number(d.slice(0, 4)))[d];
      tage.push({ datum: d, wochentag: WT[wochentag(d)], ...(f ? { feiertag: f } : {}), arbeitstag: istArbeitstag(d) });
    }
    const bsFilter = req.query.baustelleId ? Number(req.query.baustelleId) : null;
    const personen = db.alle("SELECT id, name, rolle, baustelle_id FROM benutzer WHERE aktiv = 1 ORDER BY name")
      .filter((b) => (!ids || ids.has(b.id)) && (!bsFilter || b.baustelle_id === bsFilter))
      .map((b) => ({ benutzerId: b.id, name: b.name, rolle: b.rolle, baustelleId: b.baustelle_id, tage: {} }));
    const map = new Map(personen.map((p) => [p.benutzerId, p]));
    for (const a of db.alle('SELECT * FROM abwesenheit WHERE datum >= ? AND datum <= ?', von, bis)) {
      const p = map.get(a.benutzer_id);
      if (p) p.tage[a.datum] = { code: code(a, req.ctx, req.ctx.benutzer.id), status: a.status, id: a.id, antragId: a.antrag_id || `e${a.id}`, ...(a.betriebsurlaub ? { art: 'betriebsurlaub' } : {}) };
    }
    res.json({ tage, personen, warnungen: warnungen(req.ctx, von, bis, ids) });
  });

  /* ---------- Urlaubskonto ---------- */
  function zaehle(benutzerId, jahr, abDatum) {
    const beginn = einst().urlaubsjahrBeginn;
    const von = `${jahr}-${beginn}`;
    const bis = plusTage(`${jahr + 1}-${beginn}`, -1);
    const h = heute();
    let genommen = 0, geplant = 0, beantragt = 0;
    for (const a of db.alle("SELECT datum, status FROM abwesenheit WHERE benutzer_id = ? AND datum >= ? AND datum <= ? AND code = 'U' AND status IN ('genehmigt','beantragt')", benutzerId, abDatum && abDatum > von ? abDatum : von, bis)) {
      if (!istArbeitstag(a.datum)) continue;
      if (a.status === 'beantragt') beantragt++;
      else if (a.datum <= h) genommen++;
      else geplant++;
    }
    return { genommen, geplant, beantragt };
  }
  function konto(b, jahr) {
    const k = db.eins('SELECT * FROM urlaub_konto WHERE benutzer_id = ? AND jahr = ?', b.id, jahr);
    const art = k ? k.art : (['mitarbeiter', 'polier'].includes(b.rolle) ? 'buak' : 'urlg');
    const einheit = k ? k.einheit : 'Arbeitstage';
    const anspruch = k && k.anspruch != null ? k.anspruch : art === 'buak' ? (k && k.buak_stand != null ? k.buak_stand : null) : 25;
    const z = zaehle(b.id, jahr, art === 'buak' && k && k.buak_datum ? k.buak_datum : null);
    const uebertrag = k ? k.uebertrag : 0;
    const rest = anspruch == null ? null : Math.round((anspruch + (art === 'buak' ? 0 : uebertrag) - z.genommen - z.geplant) * 10) / 10;
    return {
      benutzerId: b.id, name: b.name, rolle: b.rolle, pnr: b.pnr, art, jahr, anspruch, einheit, uebertrag,
      ...(art === 'buak' ? { buak: { stand: k ? k.buak_stand : null, datum: k ? k.buak_datum : null } } : {}),
      ...z, rest, notiz: k ? k.notiz || '' : '',
      hinweis: art === 'buak' ? 'Bauarbeiter: Urlaub nach BUAK (Anwartschaftswochen) – Stand laut BUAK-Kontoauszug eintragen; gezählt wird ab diesem Datum.' : 'Angestellte: Anspruch nach UrlG (30 Werktage bzw. 25 Arbeitstage, ab 25. Dienstjahr mehr) – Prüfen mit der Lohnverrechnung.'
    };
  }
  /** 12.24: Konto im Urlaubsjahr des Datums → {rest, von, bis} (für den Zeitraum-Antrag) */
  bt.urlaubKonto = (b, datum) => {
    const beginn = einst().urlaubsjahrBeginn;
    const y = Number(datum.slice(0, 4));
    const jahr = datum >= `${y}-${beginn}` ? y : y - 1;
    const k = konto({ ...b, pnr: b.pnr ?? null }, jahr);
    return { rest: k.rest, von: `${jahr}-${beginn}`, bis: plusTage(`${jahr + 1}-${beginn}`, -1) };
  };
  api.get('/urlaub/konto', (req, res) => {
    const jahr = req.query.jahr ? v.zahl(Number(req.query.jahr), 'jahr', { min: 2000, max: 2100, ganz: true }) : Number(heute().slice(0, 4));
    const ids = sichtbareIds(req.ctx);
    let liste = db.alle('SELECT id, name, rolle, pnr FROM benutzer WHERE aktiv = 1 ORDER BY name').filter((b) => !ids || ids.has(b.id));
    if (req.query.benutzerId) liste = liste.filter((b) => b.id === Number(req.query.benutzerId));
    if (req.ctx.benutzer.rolle === 'mitarbeiter') liste = liste.filter((b) => b.id === req.ctx.benutzer.id);
    res.json(liste.map((b) => konto(b, jahr)));
  });
  api.put('/urlaub/konto/:benutzerId/:jahr', (req, res) => {
    if (!verwaltung(req.ctx)) throw keinZugriff('Urlaubskonten pflegen Büro bzw. Lohnverrechnung.');
    const b = db.eins('SELECT id, name, rolle, pnr FROM benutzer WHERE id = ?', v.pfadId(req.params.benutzerId));
    if (!b) throw ungueltig('Benutzer nicht gefunden.');
    const jahr = v.zahl(Number(req.params.jahr), 'jahr', { min: 2000, max: 2100, ganz: true });
    const body = v.objekt(req.body);
    const alt = db.eins('SELECT * FROM urlaub_konto WHERE benutzer_id = ? AND jahr = ?', b.id, jahr) || {};
    const f = { art: alt.art || (['mitarbeiter', 'polier'].includes(b.rolle) ? 'buak' : 'urlg'), anspruch: alt.anspruch ?? null, einheit: alt.einheit || 'Arbeitstage', uebertrag: alt.uebertrag || 0, buak_stand: alt.buak_stand ?? null, buak_datum: alt.buak_datum ?? null, notiz: alt.notiz ?? null };
    if (body.art !== undefined) f.art = v.auswahl(body.art, 'art', ['buak', 'urlg']);
    if (body.anspruch !== undefined) f.anspruch = body.anspruch === null ? null : v.zahl(body.anspruch, 'anspruch', { min: 0, max: 100 });
    if (body.einheit !== undefined) f.einheit = v.auswahl(body.einheit, 'einheit', ['Arbeitstage', 'Werktage']);
    if (body.uebertrag !== undefined) f.uebertrag = v.zahl(body.uebertrag, 'uebertrag', { min: -100, max: 100 });
    if (body.buakStand !== undefined) f.buak_stand = body.buakStand === null ? null : v.zahl(body.buakStand, 'buakStand', { min: 0, max: 200 });
    if (body.buakDatum !== undefined) f.buak_datum = v.datum(body.buakDatum, 'buakDatum', { pflicht: false });
    if (body.notiz !== undefined) f.notiz = body.notiz == null ? null : v.text(body.notiz, 'notiz', { max: 500, pflicht: false }) || null;
    db.transaktion(() => {
      db.lauf(`INSERT INTO urlaub_konto (benutzer_id, jahr, art, anspruch, einheit, uebertrag, buak_stand, buak_datum, notiz, geaendert, geaendert_von) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(benutzer_id, jahr) DO UPDATE SET art = excluded.art, anspruch = excluded.anspruch, einheit = excluded.einheit, uebertrag = excluded.uebertrag, buak_stand = excluded.buak_stand, buak_datum = excluded.buak_datum, notiz = excluded.notiz, geaendert = excluded.geaendert, geaendert_von = excluded.geaendert_von`,
      b.id, jahr, f.art, f.anspruch, f.einheit, f.uebertrag, f.buak_stand, f.buak_datum, f.notiz, jetzt(), req.ctx.benutzer.id);
      db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'urlaub', objekt: `benutzer:${b.id}`, alt, neu: f, text: `Urlaubskonto ${b.name} ${jahr} geändert` });
    });
    res.json(konto(b, jahr));
  });

  /* ---------- Betriebsurlaub ---------- */
  api.post('/urlaub/betriebsurlaub', (req, res) => {
    if (!req.ctx.hat('stammdaten')) throw keinZugriff('Betriebsurlaub trägt das Büro ein.');
    const body = v.objekt(req.body);
    const von = v.datum(body.von, 'von'), bis = v.datum(body.bis, 'bis');
    if (bis < von || plusTage(von, 62) < bis) throw ungueltig('Zeitraum höchstens 62 Tage.');
    if (von < plusTage(heute(), -62)) throw ungueltig('Höchstens 62 Tage zurück.');
    const codeNeu = v.auswahl(body.code ?? 'BU', 'code', ['BU', 'U']);
    const vorschau = body.vorschau === undefined ? true : v.bool(body.vorschau, 'vorschau');
    const notiz = body.notiz == null ? null : v.text(body.notiz, 'notiz', { max: 200, pflicht: false }) || null;
    let personen = db.alle("SELECT id, name, baustelle_id FROM benutzer WHERE aktiv = 1 AND rolle IN ('mitarbeiter','polier','bauleiter','buero') ORDER BY name");
    if (body.benutzerIds) { const s = new Set(v.liste(body.benutzerIds, 'benutzerIds', { max: 500 }).map(Number)); personen = personen.filter((p) => s.has(p.id)); } else if (body.baustelleIds) { const s = new Set(v.liste(body.baustelleIds, 'baustelleIds', { max: 100 }).map(Number)); personen = personen.filter((p) => s.has(p.baustelle_id)); } else if (body.alle !== true) throw ungueltig('benutzerIds, baustelleIds oder alle:true angeben.');
    const tage = [];
    for (let d = von; d <= bis; d = plusTage(d, 1)) if (istArbeitstag(d)) tage.push(d);
    const plan = new Map(db.alle('SELECT p.benutzer_id, e.datum FROM plan_person p JOIN plan_einsatz e ON e.id = p.einsatz_id WHERE e.datum >= ? AND e.datum <= ? AND e.geloescht = 0', von, bis).map((x) => [`${x.benutzer_id}|${x.datum}`, true]));
    const ergebnis = personen.map((p) => {
      const konflikte = [];
      let neu = 0;
      for (const d of tage) {
        const a = db.eins('SELECT code, status FROM abwesenheit WHERE benutzer_id = ? AND datum = ?', p.id, d);
        if (a && a.status === 'genehmigt') { konflikte.push({ datum: d, text: `schon ${CODE_TEXT[a.code] || a.code} (genehmigt) – bleibt` }); continue; }
        if (plan.has(`${p.id}|${d}`)) konflikte.push({ datum: d, text: 'im Baustellenplaner eingeteilt' });
        neu++;
      }
      return { benutzerId: p.id, name: p.name, neu, konflikte };
    });
    let angelegt = 0;
    if (!vorschau) {
      db.transaktion(() => {
        for (const p of personen) {
          const aid = require('node:crypto').randomBytes(6).toString('hex'); // 12.24: ein Antrag je Person
          for (const d of tage) {
            const a = db.eins('SELECT status FROM abwesenheit WHERE benutzer_id = ? AND datum = ?', p.id, d);
            if (a && a.status === 'genehmigt') continue;
            db.lauf(`INSERT INTO abwesenheit (benutzer_id, datum, code, status, erfasst_von, erfasst, entschieden_von, entschieden, betriebsurlaub, notiz, antrag_id) VALUES (?, ?, 'U', 'genehmigt', ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(benutzer_id, datum) DO UPDATE SET code = 'U', status = 'genehmigt', entschieden_von = excluded.entschieden_von, entschieden = excluded.entschieden, betriebsurlaub = excluded.betriebsurlaub, notiz = excluded.notiz, antrag_id = excluded.antrag_id, antwort = NULL`,
            p.id, d, req.ctx.benutzer.id, jetzt(), req.ctx.benutzer.id, jetzt(), codeNeu === 'BU' ? 1 : 0, notiz, aid);
            angelegt++;
          }
        }
        db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'abwesenheit', objekt: 'betriebsurlaub', neu: { von, bis, personen: personen.length, angelegt, code: codeNeu }, text: `${codeNeu === 'BU' ? 'Betriebsurlaub' : 'Urlaub'} ${von}–${bis} für ${personen.length} Personen eingetragen` });
      });
    }
    res.json({ tage, personen: ergebnis, ...(vorschau ? {} : { angelegt }) });
  });

  /* ---------- Warnungen ---------- */
  function warnungen(ctx, von, bis, ids) {
    const E = einst();
    const out = [];
    const personen = db.alle("SELECT id, name, rolle, baustelle_id FROM benutzer WHERE aktiv = 1");
    const abw = db.alle("SELECT * FROM abwesenheit WHERE datum >= ? AND datum <= ? AND status IN ('genehmigt','beantragt')", von, bis);
    const sicht = (id) => !ids || ids.has(id);
    // Partie: viele Abwesende
    const partien = new Map();
    for (const p of personen) if (p.baustelle_id && ['mitarbeiter', 'polier'].includes(p.rolle)) { if (!partien.has(p.baustelle_id)) partien.set(p.baustelle_id, []); partien.get(p.baustelle_id).push(p.id); }
    const proTag = new Map();
    for (const a of abw) { const p = personen.find((x) => x.id === a.benutzer_id); if (!p || !p.baustelle_id || !istArbeitstag(a.datum)) continue; const k = `${p.baustelle_id}|${a.datum}`; proTag.set(k, (proTag.get(k) || 0) + 1); }
    // 12.24: aufeinanderfolgende Arbeitstage derselben Partie zu einer Warnung zusammenfassen
    const proBs = new Map();
    for (const [k, n] of proTag) {
      const [bsId, datum] = k.split('|');
      const groesse = (partien.get(Number(bsId)) || []).length || 1;
      if (!(n > E.partieGrenze || (n / groesse) * 100 > E.partieGrenzeProzent)) continue;
      if (!(partien.get(Number(bsId)) || []).some(sicht)) continue;
      if (!proBs.has(bsId)) proBs.set(bsId, []);
      proBs.get(bsId).push({ datum, n, groesse });
    }
    const naechsterAT = (d) => { let x = plusTage(d, 1); while (!istArbeitstag(x)) x = plusTage(x, 1); return x; };
    const de = (d) => d.split('-').reverse().join('.');
    for (const [bsId, l] of proBs) {
      l.sort((a, b) => a.datum.localeCompare(b.datum));
      const bs = db.eins('SELECT kst, kurz, name FROM baustelle WHERE id = ?', Number(bsId));
      let g = null;
      const ausgeben = () => { if (g) out.push({ typ: 'partie_viele', datum: g.von, ...(g.bis !== g.von ? { bis: g.bis } : {}), baustelleId: Number(bsId), text: `${bs ? bs.kurz || bs.name : 'Partie'}: ${g.max === g.min ? g.max : `bis zu ${g.max}`} von ${g.groesse} Personen abwesend ${g.bis !== g.von ? `${de(g.von)}–${de(g.bis)}` : `am ${de(g.von)}`}.` }); };
      for (const x of l) {
        if (g && naechsterAT(g.bis) === x.datum) { g.bis = x.datum; g.max = Math.max(g.max, x.n); g.min = Math.min(g.min, x.n); continue; }
        ausgeben();
        g = { von: x.datum, bis: x.datum, max: x.n, min: x.n, groesse: x.groesse };
      }
      ausgeben();
    }
    // Abwesenheit vs. Planer – je Person und Antrag
    const planK = new Map();
    for (const x of db.alle(`SELECT p.benutzer_id, e.datum, e.baustelle_id FROM plan_person p JOIN plan_einsatz e ON e.id = p.einsatz_id WHERE e.datum >= ? AND e.datum <= ? AND e.geloescht = 0 ORDER BY e.datum`, von, bis)) {
      if (!sicht(x.benutzer_id)) continue;
      const a = abw.find((y) => y.benutzer_id === x.benutzer_id && y.datum === x.datum);
      if (!a) continue;
      const k = `${x.benutzer_id}|${a.antrag_id || `e${a.id}`}`;
      if (!planK.has(k)) planK.set(k, { typ: 'plan_konflikt', datum: x.datum, bis: x.datum, tage: 0, benutzerId: x.benutzer_id, baustelleId: x.baustelle_id, antragId: a.antrag_id || `e${a.id}` });
      const w = planK.get(k); w.bis = x.datum; w.tage++;
    }
    for (const w of planK.values()) {
      const n = (personen.find((p) => p.id === w.benutzerId) || {}).name;
      out.push({ ...w, ...(w.bis === w.datum ? { bis: undefined } : {}), text: w.tage === 1 ? `${n} ist eingeteilt, aber abwesend.` : `${n} ist an ${w.tage} Tagen eingeteilt, aber abwesend (${de(w.datum)}–${de(w.bis)}).` });
    }
    // Resturlaub negativ, Anträge offen > 3 Tage
    const jahr = Number(heute().slice(0, 4));
    for (const p of personen.filter((x) => sicht(x.id))) {
      const k = konto({ ...p, pnr: null }, jahr);
      if (k.rest != null && k.rest < 0) out.push({ typ: 'rest_negativ', benutzerId: p.id, text: `${p.name}: Resturlaub ${String(k.rest).replace('.', ',')} ${k.einheit}.` });
    }
    for (const g of offeneAntraege(db, bt)) {
      if (sicht(g.benutzerId)) out.push({ typ: 'antrag_offen', antragId: g.antragId, datum: g.von, ...(g.bis !== g.von ? { bis: g.bis } : {}), benutzerId: g.benutzerId, text: `Antrag von ${g.name} (${CODE_TEXT[g.code]} ${g.bis !== g.von ? `${de(g.von)}–${de(g.bis)}, ${g.tage} Tage` : `am ${de(g.von)}`}) seit über 3 Tagen offen.` });
    }
    return out;
  }
  api.get('/urlaub/warnungen', (req, res) => {
    const ich = req.ctx.benutzer;
    if (!verwaltung(req.ctx) && ich.rolle !== 'bauleiter') throw keinZugriff();
    const { von, bis } = zeitraum(req.query);
    res.json(warnungen(req.ctx, von, bis, sichtbareIds(req.ctx)));
  });

  api.get('/einstellungen/urlaub', (req, res) => {
    if (!req.ctx.hat('stammdaten')) throw keinZugriff();
    res.json(einst());
  });
  api.put('/einstellungen/urlaub', (req, res) => {
    if (!req.ctx.hat('stammdaten')) throw keinZugriff();
    const body = v.objekt(req.body);
    const e = { ...(db.einstellung('urlaub', {}) || {}) };
    if (body.partieGrenze !== undefined) e.partieGrenze = v.zahl(body.partieGrenze, 'partieGrenze', { min: 1, max: 50, ganz: true });
    if (body.partieGrenzeProzent !== undefined) e.partieGrenzeProzent = v.zahl(body.partieGrenzeProzent, 'partieGrenzeProzent', { min: 1, max: 100 });
    if (body.urlaubsjahrBeginn !== undefined) { if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(body.urlaubsjahrBeginn))) throw ungueltig('urlaubsjahrBeginn: MM-TT.'); e.urlaubsjahrBeginn = body.urlaubsjahrBeginn; }
    db.setzeEinstellung('urlaub', e);
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'einstellung', objekt: 'urlaub', neu: e, text: 'Urlaubs-Einstellungen geändert' });
    res.json(einst());
  });

  api.get('/urlaub/export.csv', (req, res) => {
    if (!verwaltung(req.ctx)) throw keinZugriff();
    const jahr = req.query.jahr ? v.zahl(Number(req.query.jahr), 'jahr', { min: 2000, max: 2100, ganz: true }) : Number(heute().slice(0, 4));
    const z = [['Personalnummer', 'Name', 'Art', 'Anspruch', 'Einheit', 'Übertrag', 'genommen', 'geplant', 'beantragt', 'Rest', 'BUAK-Stand', 'BUAK-Datum']];
    for (const b of db.alle('SELECT id, name, rolle, pnr FROM benutzer WHERE aktiv = 1 ORDER BY name')) {
      const k = konto(b, jahr);
      z.push([b.pnr, b.name, k.art === 'buak' ? 'BUAK' : 'UrlG', k.anspruch, k.einheit, k.uebertrag, k.genommen, k.geplant, k.beantragt, k.rest, k.buak ? k.buak.stand : '', k.buak && k.buak.datum ? k.buak.datum.split('-').reverse().join('.') : '']);
    }
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'export', objekt: 'urlaub', text: `Urlaubskonten ${jahr} als CSV exportiert` });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Urlaub_${jahr}.csv"`);
    res.send(csv(z));
  });
};

/** Stündlich: Anträge länger als 3 Tage offen → Benachrichtigung an Büro (einmal je Antrag) */
/** Offene Anträge (beantragt, älter als 3 Tage) gruppiert je Antrag (12.24) */
function offeneAntraege(db, bt) {
  const grenze = new Date(bt.uhr().getTime() - 3 * 864e5).toISOString();
  const g = new Map();
  for (const a of db.alle("SELECT a.*, b.name FROM abwesenheit a JOIN benutzer b ON b.id = a.benutzer_id WHERE a.status = 'beantragt' AND a.erfasst < ? ORDER BY a.datum", grenze)) {
    const k = a.antrag_id || `e${a.id}`;
    if (!g.has(k)) g.set(k, { antragId: k, benutzerId: a.benutzer_id, name: a.name, code: a.code, von: a.datum, bis: a.datum, tage: 0, ersteId: a.id });
    const x = g.get(k); x.bis = a.datum; x.tage++;
  }
  return [...g.values()];
}
module.exports.pruefeAntraege = (bt) => {
  const { db } = bt;
  const buero = db.alle("SELECT id FROM benutzer WHERE aktiv = 1 AND rolle = 'buero'");
  const de = (d) => d.split('-').reverse().join('.');
  for (const a of offeneAntraege(db, bt)) {
    // einmal je Antrag (Bestand: Schlüssel wie bisher je Eintrag)
    const schluessel = a.antragId.startsWith('e') ? `urlaub:antrag:${a.ersteId}` : `urlaub:antrag:${a.antragId}`;
    for (const e of buero) benachrichtige(db, { benutzerId: e.id, typ: 'urlaub', titel: `Antrag offen: ${a.name}`, text: `Antrag von ${a.name} für ${a.bis !== a.von ? `${de(a.von)}–${de(a.bis)} (${a.tage} Tage)` : de(a.von)} ist seit über 3 Tagen unbearbeitet.`, zeit: bt.uhr().toISOString(), schluessel });
  }
};
