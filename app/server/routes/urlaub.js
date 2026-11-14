'use strict';
/** Urlaubsübersicht, Urlaubskonto, Betriebsurlaub, Warnungen (API.md 12.19) – keine €-Felder */
const v = require('../validierung');
const { ungueltig, keinZugriff } = require('../fehler');
const { wienDatum, plusTage, feiertage, istArbeitstag, wochentag, istDatum } = require('../datum');
const { csv } = require('../export');
const { benachrichtige, empfaengerMitRecht } = require('../benachrichtigung');
const DS = require('../datenschutz');

const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const CODE_TEXT = { U: 'Urlaub', ZA: 'Zeitausgleich', K: 'Krank', SW: 'Schlechtwetter', BU: 'Betriebsurlaub' };
/** Beginn des Urlaubsjahres MM-TT: ein Tag, den es in jedem Jahr gibt (also ohne 29.02.) – 14.3 */
function pruefeBeginn(wert, feld) {
  const x = String(wert);
  if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(x) || !istDatum(`2001-${x}`)) throw ungueltig(`${feld}: ein gültiger Tag im Format MM-TT (z. B. 01-01; den 29.02. gibt es nicht in jedem Jahr).`);
  return x;
}

module.exports = function urlaubRouten(api, bt) {
  const { db } = bt;
  const jetzt = () => bt.uhr().toISOString();
  const heute = () => wienDatum(bt.uhr());
  const verwaltung = (ctx) => ctx.hat('stammdaten') || ctx.hat('lohn');
  const einst = () => ({ partieGrenze: 2, partieGrenzeProzent: 30, urlaubsjahrBeginn: '01-01', ...(db.einstellung('urlaub', {}) || {}) });

  function sichtbareIds(ctx) {
    // eine Regel (server/datenschutz.js, 15.4): stammdaten|lohn → alle Personen; sonst nur sich – nie nach Rollenname
    return DS.stufe(ctx) === 'voll' ? null : new Set([ctx.benutzer.id]);
  }
  // R-01: Krankenstand nur über den zentralen Datenschutz-Helfer
  const code = (a, ctx) => (a.betriebsurlaub ? 'BU' : DS.code(ctx, a.benutzer_id, a.code));
  function zeitraum(q, max = 62) {
    const von = q.von ? v.datum(String(q.von), 'von') : heute();
    const bis = q.bis ? v.datum(String(q.bis), 'bis') : plusTage(von, 27);
    // höchstens `max` Kalendertage einschließlich von und bis (wie POST /abwesenheiten/zeitraum)
    if (bis < von || plusTage(von, max - 1) < bis) throw ungueltig(`Zeitraum höchstens ${max} Tage.`);
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

  /* ---------- Urlaubsjahr (14.3): Beginn je Konto, Vorgabe nur für neue Konten, nie rückwirkend ---------- */
  /** Vorgabe für ein Urlaubsjahr: frühere Vorgaben gelten für die Jahre, für die sie galten (beginnVerlauf) */
  function standardBeginn(jahr, E = einst()) {
    for (const e of E.beginnVerlauf || []) if (jahr <= e.bisJahr) return e.beginn;
    return E.urlaubsjahrBeginn;
  }
  function beginnFuer(benutzerId, jahr) {
    const k = db.eins('SELECT beginn FROM urlaub_konto WHERE benutzer_id = ? AND jahr = ?', benutzerId, jahr);
    return (k && k.beginn) || standardBeginn(jahr);
  }
  /** Urlaubsjahr `jahr` der Person: vom eigenen Beginn bis zum Tag vor dem Beginn des nächsten Urlaubsjahres */
  function grenzen(benutzerId, jahr) {
    return { von: `${jahr}-${beginnFuer(benutzerId, jahr)}`, bis: plusTage(`${jahr + 1}-${beginnFuer(benutzerId, jahr + 1)}`, -1) };
  }
  /** Urlaubsjahr der Person, in dem `datum` liegt */
  function jahrVon(benutzerId, datum) {
    const y = Number(datum.slice(0, 4));
    return datum >= `${y}-${beginnFuer(benutzerId, y)}` ? y : y - 1;
  }
  /** laufendes Urlaubsjahr nach der Vorgabe (Export ohne jahr) */
  function standardJahr(datum) {
    const y = Number(datum.slice(0, 4));
    return datum >= `${y}-${standardBeginn(y)}` ? y : y - 1;
  }

  /* ---------- Urlaubskonto ---------- */
  function zaehle(benutzerId, jahr, abDatum) {
    const { von, bis } = grenzen(benutzerId, jahr);
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
    const g = grenzen(b.id, jahr);
    return {
      benutzerId: b.id, name: b.name, rolle: b.rolle, pnr: b.pnr, art, jahr, urlaubsjahrBeginn: g.von.slice(5), von: g.von, bis: g.bis, anspruch, einheit, uebertrag,
      ...(art === 'buak' ? { buak: { stand: k ? k.buak_stand : null, datum: k ? k.buak_datum : null } } : {}),
      ...z, rest, notiz: k ? k.notiz || '' : '',
      hinweis: art === 'buak' ? 'Bauarbeiter: Urlaub nach BUAK (Anwartschaftswochen) – Stand laut BUAK-Kontoauszug eintragen; gezählt wird ab diesem Datum.' : 'Angestellte: Anspruch nach UrlG (30 Werktage bzw. 25 Arbeitstage, ab 25. Dienstjahr mehr) – Prüfen mit der Lohnverrechnung.'
    };
  }
  /** 12.24: Konto im Urlaubsjahr des Datums → {rest, von, bis, ab} (für den Zeitraum-Antrag); ab = Zählbeginn (BUAK: ab dem Kontoauszug, 14.3) */
  bt.urlaubKonto = (b, datum) => {
    const jahr = jahrVon(b.id, datum);
    const k = konto({ ...b, pnr: b.pnr ?? null }, jahr);
    const ab = k.art === 'buak' && k.buak && k.buak.datum && k.buak.datum > k.von ? k.buak.datum : k.von;
    return { rest: k.rest, von: k.von, bis: k.bis, ab };
  };
  api.get('/urlaub/konto', (req, res) => {
    // ohne jahr: das laufende Urlaubsjahr der Person (14.3), nicht das Kalenderjahr
    const jahr = req.query.jahr ? v.zahl(Number(req.query.jahr), 'jahr', { min: 2000, max: 2100, ganz: true }) : null;
    const ids = sichtbareIds(req.ctx);
    let liste = db.alle('SELECT id, name, rolle, pnr FROM benutzer WHERE aktiv = 1 ORDER BY name').filter((b) => !ids || ids.has(b.id));
    if (req.query.benutzerId) liste = liste.filter((b) => b.id === Number(req.query.benutzerId));
    if (req.ctx.benutzer.rolle === 'mitarbeiter') liste = liste.filter((b) => b.id === req.ctx.benutzer.id);
    // R-05: Personalnummer nur mit stammdaten/lohn/benutzer (wie /mitarbeiter) bzw. die eigene
    const pnrSichtbar = req.ctx.hat('stammdaten') || req.ctx.hat('lohn') || req.ctx.hat('benutzer');
    // 15.7 (N-034 Rest): vorgabeJahr = laufendes Urlaubsjahr nach der Vorgabe (wie export.csv ohne jahr) – Basis für CSV-Link und Jahresnavigation
    const vorgabeJahr = standardJahr(heute());
    res.json(liste.map((b) => { const k = konto(b, jahr ?? jahrVon(b.id, heute())); if (!pnrSichtbar && b.id !== req.ctx.benutzer.id) delete k.pnr; return { ...k, vorgabeJahr }; }));
  });
  api.put('/urlaub/konto/:benutzerId/:jahr', (req, res) => {
    if (!verwaltung(req.ctx)) throw keinZugriff('Urlaubskonten pflegen Büro bzw. Lohnverrechnung.');
    const b = db.eins('SELECT id, name, rolle, pnr FROM benutzer WHERE id = ?', v.pfadId(req.params.benutzerId));
    if (!b) throw ungueltig('Benutzer nicht gefunden.');
    // 15.9 (Vier-Augen-Prinzip): das eigene Urlaubskonto pflegt eine andere Person – für jede Rolle, auch die GF
    // (ihr Konto pflegt eine andere GF oder das Büro)
    if (b.id === req.ctx.benutzer.id) throw keinZugriff('Das eigene Urlaubskonto pflegt eine andere Person (Vier-Augen-Prinzip).');
    const jahr = v.zahl(Number(req.params.jahr), 'jahr', { min: 2000, max: 2100, ganz: true });
    const body = v.objekt(req.body);
    const alt = db.eins('SELECT * FROM urlaub_konto WHERE benutzer_id = ? AND jahr = ?', b.id, jahr) || {};
    // 14.3: der Beginn des Urlaubsjahres wird mit dem Konto gespeichert (Vorgabe zum Zeitpunkt des Anlegens)
    const f = { art: alt.art || (['mitarbeiter', 'polier'].includes(b.rolle) ? 'buak' : 'urlg'), anspruch: alt.anspruch ?? null, einheit: alt.einheit || 'Arbeitstage', uebertrag: alt.uebertrag || 0, buak_stand: alt.buak_stand ?? null, buak_datum: alt.buak_datum ?? null, notiz: alt.notiz ?? null, beginn: alt.beginn || standardBeginn(jahr) };
    if (body.urlaubsjahrBeginn !== undefined) f.beginn = body.urlaubsjahrBeginn === null ? standardBeginn(jahr) : pruefeBeginn(body.urlaubsjahrBeginn, 'urlaubsjahrBeginn');
    if (body.art !== undefined) f.art = v.auswahl(body.art, 'art', ['buak', 'urlg']);
    if (body.anspruch !== undefined) f.anspruch = body.anspruch === null ? null : v.zahl(body.anspruch, 'anspruch', { min: 0, max: 100 });
    if (body.einheit !== undefined) f.einheit = v.auswahl(body.einheit, 'einheit', ['Arbeitstage', 'Werktage']);
    if (body.uebertrag !== undefined) f.uebertrag = v.zahl(body.uebertrag, 'uebertrag', { min: -100, max: 100 });
    if (body.buakStand !== undefined) f.buak_stand = body.buakStand === null ? null : v.zahl(body.buakStand, 'buakStand', { min: 0, max: 200 });
    if (body.buakDatum !== undefined) f.buak_datum = v.datum(body.buakDatum, 'buakDatum', { pflicht: false });
    if (body.notiz !== undefined) f.notiz = body.notiz == null ? null : v.text(body.notiz, 'notiz', { max: 500, pflicht: false }) || null;
    db.transaktion(() => {
      db.lauf(`INSERT INTO urlaub_konto (benutzer_id, jahr, art, anspruch, einheit, uebertrag, buak_stand, buak_datum, notiz, geaendert, geaendert_von, beginn) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(benutzer_id, jahr) DO UPDATE SET art = excluded.art, anspruch = excluded.anspruch, einheit = excluded.einheit, uebertrag = excluded.uebertrag, buak_stand = excluded.buak_stand, buak_datum = excluded.buak_datum, notiz = excluded.notiz, geaendert = excluded.geaendert, geaendert_von = excluded.geaendert_von, beginn = excluded.beginn`,
      b.id, jahr, f.art, f.anspruch, f.einheit, f.uebertrag, f.buak_stand, f.buak_datum, f.notiz, jetzt(), req.ctx.benutzer.id, f.beginn);
      db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'urlaub', objekt: `benutzer:${b.id}`, alt, neu: f, text: `Urlaubskonto ${b.name} ${jahr} geändert` });
    });
    res.json(konto(b, jahr));
  });

  /* ---------- Betriebsurlaub ---------- */
  api.post('/urlaub/betriebsurlaub', (req, res) => {
    if (!req.ctx.hat('stammdaten')) throw keinZugriff('Betriebsurlaub trägt das Büro ein.');
    const ich = req.ctx.benutzer;
    const body = v.objekt(req.body);
    const von = v.datum(body.von, 'von'), bis = v.datum(body.bis, 'bis');
    // höchstens 62 Kalendertage einschließlich von und bis (wie POST /abwesenheiten/zeitraum, 14.3)
    if (bis < von || plusTage(von, 61) < bis) throw ungueltig('Zeitraum höchstens 62 Kalendertage.');
    if (von < plusTage(heute(), -62)) throw ungueltig('Höchstens 62 Tage zurück.');
    const codeNeu = v.auswahl(body.code ?? 'BU', 'code', ['BU', 'U']);
    const vorschau = body.vorschau === undefined ? true : v.bool(body.vorschau, 'vorschau');
    const notiz = body.notiz == null ? null : v.text(body.notiz, 'notiz', { max: 200, pflicht: false }) || null;
    let personen = db.alle("SELECT id, name, baustelle_id FROM benutzer WHERE aktiv = 1 AND rolle IN ('mitarbeiter','polier','bauleiter','buero') ORDER BY name");
    if (body.benutzerIds) { const s = new Set(v.liste(body.benutzerIds, 'benutzerIds', { max: 500 }).map(Number)); personen = personen.filter((p) => s.has(p.id)); } else if (body.baustelleIds) { const s = new Set(v.liste(body.baustelleIds, 'baustelleIds', { max: 100 }).map(Number)); personen = personen.filter((p) => s.has(p.baustelle_id)); } else if (body.alle !== true) throw ungueltig('benutzerIds, baustelleIds oder alle:true angeben.');
    const tage = [];
    for (let d = von; d <= bis; d = plusTage(d, 1)) if (istArbeitstag(d)) tage.push(d);
    const plan = new Map(db.alle('SELECT p.benutzer_id, e.datum FROM plan_person p JOIN plan_einsatz e ON e.id = p.einsatz_id WHERE e.datum >= ? AND e.datum <= ? AND e.geloescht = 0', von, bis).map((x) => [`${x.benutzer_id}|${x.datum}`, true]));
    const betroffen = typeof bt.offeneAntraegeBetroffen === 'function' ? bt.offeneAntraegeBetroffen : () => ({ ganz: [], teil: [] });
    const vorhaben = personen.map((p) => {
      // Vier-Augen-Prinzip (7, 14.3): der eigene Eintrag ist auch beim Betriebsurlaub nur beantragt – eine andere Person genehmigt
      const eigen = p.id === ich.id;
      const konflikte = [], kandidaten = [];
      for (const d of tage) {
        const a = db.eins('SELECT code, status FROM abwesenheit WHERE benutzer_id = ? AND datum = ?', p.id, d);
        if (a && a.status === 'genehmigt') { konflikte.push({ datum: d, text: `schon ${CODE_TEXT[a.code] || a.code} (genehmigt) – bleibt` }); continue; }
        kandidaten.push(d);
      }
      // Inhaber 13.11.2026: offene Anträge nur als Ganzes ersetzen; ragt einer über den Zeitraum hinaus, bleibt er (bitte entscheiden)
      const b = betroffen(p.id, kandidaten);
      const bleibt = new Set(b.teil.flatMap((g) => g.tage.map((x) => x.datum)));
      const anlegen = [];
      for (const d of kandidaten) {
        if (bleibt.has(d)) { konflikte.push({ datum: d, text: 'offener Antrag, der über den Zeitraum hinausreicht – bleibt; bitte den ganzen Antrag entscheiden' }); continue; }
        if (b.ganz.some((g) => g.tage.some((x) => x.datum === d))) konflikte.push({ datum: d, text: 'offener Antrag – wird als Ganzes ersetzt' });
        if (plan.has(`${p.id}|${d}`)) konflikte.push({ datum: d, text: 'im Baustellenplaner eingeteilt' });
        anlegen.push(d);
      }
      return { p, eigen, status: eigen ? 'beantragt' : 'genehmigt', konflikte, anlegen, ersetzt: b.ganz };
    });
    const ergebnis = vorhaben.map((x) => ({ benutzerId: x.p.id, name: x.p.name, neu: x.anlegen.length, status: x.status, ...(x.eigen ? { hinweis: 'Eigener Eintrag – wird beantragt und von einer anderen Person genehmigt (Vier-Augen-Prinzip).' } : {}), konflikte: x.konflikte }));
    let angelegt = 0;
    if (!vorschau) {
      const zeit = jetzt();
      const art = codeNeu === 'BU' ? 'Betriebsurlaub' : 'Urlaub';
      db.transaktion(() => {
        for (const x of vorhaben) {
          if (!x.anlegen.length) continue;
          const aid = `a${require('node:crypto').randomBytes(6).toString('hex')}`; // 12.24: ein Antrag je Person
          const entschVon = x.eigen ? null : ich.id, entsch = x.eigen ? null : zeit;
          for (const d of x.anlegen) {
            const r = db.lauf(`INSERT INTO abwesenheit (benutzer_id, datum, code, status, erfasst_von, erfasst, entschieden_von, entschieden, betriebsurlaub, notiz, antrag_id) VALUES (?, ?, 'U', ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(benutzer_id, datum) DO UPDATE SET code = 'U', status = excluded.status, erfasst_von = excluded.erfasst_von, erfasst = excluded.erfasst, entschieden_von = excluded.entschieden_von, entschieden = excluded.entschieden, betriebsurlaub = excluded.betriebsurlaub, notiz = excluded.notiz, antrag_id = excluded.antrag_id, antwort = NULL
              WHERE abwesenheit.status <> 'genehmigt'`,
            x.p.id, d, x.status, ich.id, zeit, entschVon, entsch, codeNeu === 'BU' ? 1 : 0, notiz, aid);
            if (r.changes) angelegt++;
          }
          if (!x.eigen && typeof bt.antragErsetztMelden === 'function') bt.antragErsetztMelden(x.ersetzt, { text: `${art} ${x.anlegen[0].split('-').reverse().join('.')}–${x.anlegen[x.anlegen.length - 1].split('-').reverse().join('.')}, genehmigt` }, zeit);
          if (x.eigen) {
            for (const e of empfaengerMitRecht(db, 'stammdaten|lohn', { ohne: ich.id })) { // 15.3: wer entscheidet (Vier-Augen-Prinzip, Bauleiter = Büro)
              benachrichtige(db, { benutzerId: e.id, typ: 'abwesenheit', titel: `Antrag ${art}: ${x.p.name}`, text: `${x.p.name} hat ${art} für sich selbst eingetragen (${x.anlegen.length} ${x.anlegen.length === 1 ? 'Arbeitstag' : 'Arbeitstage'}) – bitte den Antrag entscheiden (Vier-Augen-Prinzip).`, zeit, schluessel: `abw:antrag:${aid}` });
            }
          }
        }
        db.protokolliere({ zeit, benutzerId: ich.id, art: 'abwesenheit', objekt: 'betriebsurlaub', neu: { von, bis, personen: personen.length, angelegt, code: codeNeu, eigenBeantragt: vorhaben.some((x) => x.eigen && x.anlegen.length) }, text: `${art} ${von}–${bis} für ${personen.length} Personen eingetragen` });
      });
    }
    res.json({ tage, personen: ergebnis, ...(vorschau ? {} : { angelegt }) });
  });

  /* ---------- Warnungen ---------- */
  function warnungen(ctx, von, bis, ids) {
    if (!DS.aggregateErlaubt(ctx)) return []; // Inhaber 13.11.2026: Polier/Mitarbeiter keine Warnungen (zählen fremde Abwesenheiten)
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
    // Resturlaub negativ (laufendes Urlaubsjahr der Person, 14.3), Anträge offen > 3 Tage
    for (const p of personen.filter((x) => sicht(x.id))) {
      const k = konto({ ...p, pnr: null }, jahrVon(p.id, heute()));
      if (k.rest != null && k.rest < 0) out.push({ typ: 'rest_negativ', benutzerId: p.id, text: `${p.name}: Resturlaub ${String(k.rest).replace('.', ',')} ${k.einheit}.` });
    }
    for (const g of offeneAntraege(db, bt)) {
      if (sicht(g.benutzerId)) out.push({ typ: 'antrag_offen', antragId: g.antragId, datum: g.von, ...(g.bis !== g.von ? { bis: g.bis } : {}), benutzerId: g.benutzerId, text: `Antrag von ${g.name} (${DS.text(ctx, g.benutzerId, g.code)} ${g.bis !== g.von ? `${de(g.von)}–${de(g.bis)}, ${g.tage} Tage` : `am ${de(g.von)}`}) seit über 3 Tagen offen.` });
    }
    return out;
  }
  api.get('/urlaub/warnungen', (req, res) => {
    if (!verwaltung(req.ctx)) throw keinZugriff(); // 15.4 (F-016/F-019/F-020): allein stammdaten|lohn, kein Rollen-Sonderweg
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
    if (body.urlaubsjahrBeginn !== undefined) {
      const neu = pruefeBeginn(body.urlaubsjahrBeginn, 'urlaubsjahrBeginn');
      const alt = einst();
      if (neu !== alt.urlaubsjahrBeginn) {
        // 14.3: die Vorgabe gilt erst ab dem nächsten Urlaubsjahr, das nach heute beginnt – bestehende Jahre verschieben sich nie rückwirkend
        const h = heute();
        let ab = standardJahr(h) + 1;
        while (`${ab}-${neu}` <= h) ab++;
        const verlauf = [];
        for (let j = 2000; j < ab; j++) { const b = standardBeginn(j, alt); const l = verlauf[verlauf.length - 1]; if (l && l.beginn === b) l.bisJahr = j; else verlauf.push({ bisJahr: j, beginn: b }); }
        if (verlauf.length && verlauf[verlauf.length - 1].beginn === neu) verlauf.pop();
        e.beginnVerlauf = verlauf;
        e.urlaubsjahrBeginn = neu;
        e.urlaubsjahrBeginnAb = ab;
      }
    }
    db.setzeEinstellung('urlaub', e);
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'einstellung', objekt: 'urlaub', neu: e, text: 'Urlaubs-Einstellungen geändert' });
    res.json(einst());
  });

  api.get('/urlaub/export.csv', (req, res) => {
    if (!verwaltung(req.ctx)) throw keinZugriff();
    const jahr = req.query.jahr ? v.zahl(Number(req.query.jahr), 'jahr', { min: 2000, max: 2100, ganz: true }) : standardJahr(heute());
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
    if (!g.has(k)) g.set(k, { antragId: k, bestand: !a.antrag_id, benutzerId: a.benutzer_id, name: a.name, code: a.code, von: a.datum, bis: a.datum, tage: 0, ersteId: a.id });
    const x = g.get(k); x.bis = a.datum; x.tage++;
  }
  return [...g.values()];
}
module.exports.pruefeAntraege = (bt) => {
  const { db } = bt;
  const buero = empfaengerMitRecht(db, 'stammdaten|lohn'); // 15.3: wer entscheidet (Bauleiter = Büro)
  const de = (d) => d.split('-').reverse().join('.');
  for (const a of offeneAntraege(db, bt)) {
    // einmal je Antrag (Bestand: Schlüssel wie bisher je Eintrag)
    const schluessel = a.bestand ? `urlaub:antrag:${a.ersteId}` : `urlaub:antrag:${a.antragId}`;
    for (const e of buero) benachrichtige(db, { benutzerId: e.id, typ: 'urlaub', titel: `Antrag offen: ${a.name}`, text: `Antrag von ${a.name} für ${a.bis !== a.von ? `${de(a.von)}–${de(a.bis)} (${a.tage} Tage)` : de(a.von)} ist seit über 3 Tagen unbearbeitet.`, zeit: bt.uhr().toISOString(), schluessel });
  }
};
