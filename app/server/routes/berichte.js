'use strict';
const v = require('../validierung');
const { ungueltig, keinZugriff, nichtGefunden, konflikt } = require('../fehler');
const { baustelleImBereich, darfPreise, bereich } = require('../rechte');
const { ladeBaustelle, personalVorschlag, kostenTagFuer, parseJson } = require('../daten');
const { stundenAusBloecken, blockZeitleiste } = require('../stempel');
const { wienDatum, plusTage } = require('../datum');
const { pruefeBudget, benachrichtige } = require('../budget');
const { erzeugeBerichtPdf } = require('../pdf');

const CODES = ['K', 'U', 'SW', 'ZA'];
const WETTER_SCHLUESSEL = ['text', 'temperatur', 'niederschlag', 'wind', 'quelle'];
const GESPERRT_TEXT = 'Der Bericht ist bereits unterschrieben (Auftragnehmer/Bauherr) – Inhalt gesperrt. Unterschrift zurückziehen, um zu ändern.';
const MAX_PNG_BYTES = 400 * 1024;

/* ---------- Laden ---------- */

function ladeBerichtRoh(db, id) {
  const b = db.eins('SELECT * FROM bericht WHERE id = ?', id);
  if (!b) return null;
  b.personal = db.alle(`SELECT bp.*, u.name FROM bericht_personal bp JOIN benutzer u ON u.id = bp.benutzer_id
    WHERE bp.bericht_id = ? ORDER BY bp.pos, bp.id`, id);
  b.geraete = db.alle(`SELECT bg.geraet_id, bg.stunden, g.code, g.name, g.sortierung FROM bericht_geraet bg JOIN geraet g ON g.id = bg.geraet_id
    WHERE bg.bericht_id = ? ORDER BY g.sortierung, g.id`, id);
  b.material = db.alle(`SELECT bm.material_id, bm.menge, m.code, m.name, m.einheit, m.vorlage, m.sortierung FROM bericht_material bm JOIN material m ON m.id = bm.material_id
    WHERE bm.bericht_id = ? ORDER BY m.sortierung, m.id`, id);
  b.regie = db.alle('SELECT text, stunden FROM bericht_regie WHERE bericht_id = ? ORDER BY pos, id', id);
  b.unterschriften = db.alle('SELECT u.*, b.name AS erfasst_von_name FROM unterschrift u LEFT JOIN benutzer b ON b.id = u.erfasst_von WHERE u.bericht_id = ?', id);
  b.baustelle = ladeBaustelle(db, b.baustelle_id);
  return b;
}

const r2 = (x) => Math.round(x * 100) / 100;

function berichtJson(db, ctx, b, { mitBild = true } = {}) {
  const bs = b.baustelle;
  const unterschriften = {};
  for (const u of b.unterschriften) {
    unterschriften[u.rolle] = { name: u.name, zeit: u.zeit, ...(mitBild && u.bild_png ? { bildPng: u.bild_png } : {}) };
  }
  const o = {
    id: b.id,
    baustelleId: bs.id,
    baustelle: {
      id: bs.id, kst: bs.kst, name: bs.name, kurz: bs.kurz, auftraggeber: bs.auftraggeber, agAdresse: bs.ag_adresse,
      bauvorhaben: bs.bauvorhaben, adresse: bs.adresse, bauherrVertreter: bs.bauherr_vertreter, polierId: bs.polier_id, bauleiterId: bs.bauleiter_id
    },
    datum: b.datum,
    status: b.status,
    personal: b.personal.map((p) => ({
      benutzerId: p.benutzer_id, name: p.name, von1: p.von1, bis1: p.bis1, von2: p.von2, bis2: p.bis2,
      pauseMin: p.pause_min, stunden: p.stunden, code: p.code, segStunden: p.seg_stunden, ...(p.hinweis ? { hinweis: p.hinweis } : {})
    })),
    gesamtstunden: r2(b.personal.reduce((a, p) => a + p.stunden, 0)),
    seg: { taetigkeit: b.seg_taetigkeit || '', stunden: b.seg_stunden },
    geraete: b.geraete.map((g) => ({ geraetId: g.geraet_id, code: g.code, name: g.name, stunden: g.stunden })),
    material: b.material.map((m) => ({ materialId: m.material_id, code: m.code, name: m.name, menge: m.menge, einheit: m.einheit })),
    arbeitsleistung: b.arbeitsleistung,
    materialbeistellung: { eigen: b.mb_eigen, fremd: b.mb_fremd },
    paletten: { euro: b.paletten_euro, weissenboeck: b.paletten_weissenboeck },
    regie: b.regie.map((r) => ({ text: r.text, stunden: r.stunden })),
    vorkommnisse: b.vorkommnisse,
    wetter: parseJson(b.wetter, null),
    unterschriften,
    freigabe: b.freigegeben_zeit ? { benutzerId: b.freigegeben_von, zeit: b.freigegeben_zeit } : null,
    erstellt: b.erstellt,
    geaendert: b.geaendert,
    bearbeitbar: b.status === 'entwurf'
  };
  if (darfPreise(ctx, bs)) o.kostenTag = kostenTagFuer(db, b.id);
  return o;
}

/* ---------- Rechte ---------- */

function pruefeLesen(ctx, bs) {
  if (!ctx.hat('bericht_erstellen') && !ctx.hat('bericht_freigeben')) throw keinZugriff('Bautagesberichte sind für Ihre Rolle nicht freigeschaltet.');
  if (!baustelleImBereich(ctx.benutzer, bs)) throw keinZugriff('Dieser Bericht gehört zu einer Baustelle außerhalb Ihres Bereichs.');
}
function pruefeSchreiben(ctx, bs) {
  if (!ctx.hat('bericht_erstellen')) throw keinZugriff('Berichte erstellen ist für Ihre Rolle nicht freigeschaltet.');
  if (!baustelleImBereich(ctx.benutzer, bs)) throw keinZugriff('Dieser Bericht gehört zu einer Baustelle außerhalb Ihres Bereichs.');
}

/* ---------- Validierung Teil-Update ---------- */

function mehrzeilig(wert, feld, max = 5000) {
  if (wert === null || wert === undefined) return '';
  if (Array.isArray(wert)) {
    v.liste(wert, feld, { max: 50 });
    return wert.map((x, i) => v.text(x, `${feld}[${i}]`, { max: 500, pflicht: false }) || '').filter(Boolean).join('\n');
  }
  return v.text(wert, feld, { max, pflicht: false }) || '';
}

function pruefePersonal(db, liste) {
  v.liste(liste, 'personal', { max: 80 });
  const gesehen = new Set();
  return liste.map((p, i) => {
    const f = `personal[${i}]`;
    v.objekt(p, f);
    const benutzerId = v.id(p.benutzerId, `${f}.benutzerId`);
    if (gesehen.has(benutzerId)) throw ungueltig(`${f}: Person ist doppelt eingetragen.`);
    gesehen.add(benutzerId);
    if (!db.eins('SELECT id FROM benutzer WHERE id = ?', benutzerId)) throw ungueltig(`${f}: Mitarbeiter nicht gefunden.`);
    const z = {
      von1: v.uhrzeit(p.von1, `${f}.von1`), bis1: v.uhrzeit(p.bis1, `${f}.bis1`),
      von2: v.uhrzeit(p.von2, `${f}.von2`), bis2: v.uhrzeit(p.bis2, `${f}.bis2`)
    };
    for (const [a, b, n] of [['von1', 'bis1', '1'], ['von2', 'bis2', '2']]) {
      if (Boolean(z[a]) !== Boolean(z[b])) throw ungueltig(`${f}: Zeitblock ${n} braucht von und bis.`);
      if (z[a] && z[a] === z[b]) throw ungueltig(`${f}: Zeitblock ${n} – „von“ und „bis“ sind gleich.`);
    }
    if (z.von2 && !z.von1) throw ungueltig(`${f}: Zeitblock 2 ohne Zeitblock 1.`);
    // „bis“ vor „von“ = über Mitternacht (nächster Tag); gesamte Spanne höchstens 24 Std.
    if (blockZeitleiste(z).spanneMin > 24 * 60) throw ungueltig(`${f}: Die Zeitblöcke umfassen mehr als 24 Stunden.`);
    const pauseMin = v.zahl(p.pauseMin ?? 0, `${f}.pauseMin`, { min: 0, max: 600, ganz: true });
    const code = p.code === '' || p.code === null || p.code === undefined ? null : v.auswahl(p.code, `${f}.code`, CODES);
    let stunden = v.zahl(p.stunden, `${f}.stunden`, { min: 0, max: 24, pflicht: false });
    if (stunden === null) stunden = stundenAusBloecken({ ...z, pauseMin });
    const segStunden = v.zahl(p.segStunden ?? 0, `${f}.segStunden`, { min: 0, max: 24 });
    if (segStunden > stunden) throw ungueltig(`${f}: SEG-Stunden dürfen die Arbeitsstunden nicht übersteigen.`);
    return { benutzerId, ...z, pauseMin, stunden: r2(stunden), code, segStunden };
  });
}

function pruefeUpdate(db, body) {
  const u = {};
  if (body.personal !== undefined) u.personal = pruefePersonal(db, body.personal);
  if (body.seg !== undefined) {
    const s = body.seg === null ? {} : v.objekt(body.seg, 'seg');
    u.seg = { taetigkeit: v.text(s.taetigkeit ?? '', 'seg.taetigkeit', { max: 300, pflicht: false }) || '', stunden: v.zahl(s.stunden, 'seg.stunden', { min: 0, max: 1000, pflicht: false }) };
  }
  if (body.geraete !== undefined) {
    v.liste(body.geraete, 'geraete', { max: 100 });
    const gesehen = new Set();
    u.geraete = body.geraete.map((g, i) => {
      v.objekt(g, `geraete[${i}]`);
      const geraetId = v.id(g.geraetId, `geraete[${i}].geraetId`);
      if (gesehen.has(geraetId)) throw ungueltig(`geraete[${i}]: Gerät ist doppelt eingetragen.`);
      gesehen.add(geraetId);
      if (!db.eins('SELECT id FROM geraet WHERE id = ?', geraetId)) throw ungueltig(`geraete[${i}]: Gerät nicht gefunden.`);
      return { geraetId, stunden: v.zahl(g.stunden, `geraete[${i}].stunden`, { min: 0, max: 24 }) };
    }).filter((g) => g.stunden > 0);
  }
  if (body.material !== undefined) {
    v.liste(body.material, 'material', { max: 100 });
    const gesehen = new Set();
    u.material = body.material.map((m, i) => {
      v.objekt(m, `material[${i}]`);
      const materialId = v.id(m.materialId, `material[${i}].materialId`);
      if (gesehen.has(materialId)) throw ungueltig(`material[${i}]: Material ist doppelt eingetragen.`);
      gesehen.add(materialId);
      if (!db.eins('SELECT id FROM material WHERE id = ?', materialId)) throw ungueltig(`material[${i}]: Material nicht gefunden.`);
      return { materialId, menge: v.zahl(m.menge, `material[${i}].menge`, { min: 0, max: 100000 }) };
    }).filter((m) => m.menge > 0);
  }
  if (body.regie !== undefined) {
    v.liste(body.regie, 'regie', { max: 50 });
    u.regie = body.regie.map((r, i) => {
      v.objekt(r, `regie[${i}]`);
      return { text: v.text(r.text, `regie[${i}].text`, { max: 500 }), stunden: v.zahl(r.stunden, `regie[${i}].stunden`, { min: 0, max: 500 }) };
    });
  }
  if (body.arbeitsleistung !== undefined) u.arbeitsleistung = mehrzeilig(body.arbeitsleistung, 'arbeitsleistung', 10000);
  if (body.vorkommnisse !== undefined) u.vorkommnisse = mehrzeilig(body.vorkommnisse, 'vorkommnisse', 10000);
  if (body.materialbeistellung !== undefined) {
    const m = body.materialbeistellung === null ? {} : v.objekt(body.materialbeistellung, 'materialbeistellung');
    u.materialbeistellung = { eigen: mehrzeilig(m.eigen, 'materialbeistellung.eigen'), fremd: mehrzeilig(m.fremd, 'materialbeistellung.fremd') };
  }
  if (body.paletten !== undefined) {
    const p = body.paletten === null ? {} : v.objekt(body.paletten, 'paletten');
    u.paletten = {
      euro: v.zahl(p.euro ?? 0, 'paletten.euro', { min: 0, max: 10000, ganz: true }),
      weissenboeck: v.zahl(p.weissenboeck ?? 0, 'paletten.weissenboeck', { min: 0, max: 10000, ganz: true })
    };
  }
  if (body.wetter !== undefined) {
    const w = body.wetter;
    if (w === null || w === '') u.wetter = null;
    else if (typeof w === 'string') u.wetter = v.text(w, 'wetter', { max: 200 });
    else {
      v.objekt(w, 'wetter');
      const keys = Object.keys(w);
      if (keys.length > 10) throw ungueltig('wetter: zu viele Angaben.');
      for (const k of keys) {
        if (!WETTER_SCHLUESSEL.includes(k)) throw ungueltig(`wetter.${k} ist unbekannt (erlaubt: ${WETTER_SCHLUESSEL.join(', ')}).`);
        const x = w[k];
        if (!(x === null || typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x)) || (typeof x === 'string' && x.length <= 200))) throw ungueltig(`wetter.${k} ist ungültig.`);
      }
      u.wetter = w;
    }
  }
  return u;
}

function speichereUpdate(db, berichtId, u, zeit) {
  if (u.personal) {
    db.lauf('DELETE FROM bericht_personal WHERE bericht_id = ?', berichtId);
    u.personal.forEach((p, i) => db.lauf(`INSERT INTO bericht_personal (bericht_id, benutzer_id, von1, bis1, von2, bis2, pause_min, stunden, seg_stunden, code, pos)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, berichtId, p.benutzerId, p.von1, p.bis1, p.von2, p.bis2, p.pauseMin, p.stunden, p.segStunden || 0, p.code, i));
    u.personal.forEach((p) => { if (p.hinweis) db.lauf('UPDATE bericht_personal SET hinweis = ? WHERE bericht_id = ? AND benutzer_id = ?', p.hinweis, berichtId, p.benutzerId); });
  }
  if (u.geraete) {
    db.lauf('DELETE FROM bericht_geraet WHERE bericht_id = ?', berichtId);
    for (const g of u.geraete) db.lauf('INSERT INTO bericht_geraet (bericht_id, geraet_id, stunden) VALUES (?, ?, ?)', berichtId, g.geraetId, g.stunden);
  }
  if (u.material) {
    db.lauf('DELETE FROM bericht_material WHERE bericht_id = ?', berichtId);
    for (const m of u.material) db.lauf('INSERT INTO bericht_material (bericht_id, material_id, menge) VALUES (?, ?, ?)', berichtId, m.materialId, m.menge);
  }
  if (u.regie) {
    db.lauf('DELETE FROM bericht_regie WHERE bericht_id = ?', berichtId);
    u.regie.forEach((r, i) => db.lauf('INSERT INTO bericht_regie (bericht_id, text, stunden, pos) VALUES (?, ?, ?, ?)', berichtId, r.text, r.stunden, i));
  }
  const set = {};
  if (u.seg) { set.seg_taetigkeit = u.seg.taetigkeit; set.seg_stunden = u.seg.stunden; }
  if (u.arbeitsleistung !== undefined) set.arbeitsleistung = u.arbeitsleistung;
  if (u.vorkommnisse !== undefined) set.vorkommnisse = u.vorkommnisse;
  if (u.materialbeistellung) { set.mb_eigen = u.materialbeistellung.eigen; set.mb_fremd = u.materialbeistellung.fremd; }
  if (u.paletten) { set.paletten_euro = u.paletten.euro; set.paletten_weissenboeck = u.paletten.weissenboeck; }
  if (u.wetter !== undefined) set.wetter = u.wetter === null ? null : JSON.stringify(u.wetter);
  set.geaendert = zeit;
  const k = Object.keys(set);
  db.lauf(`UPDATE bericht SET ${k.map((x) => `${x} = ?`).join(', ')} WHERE id = ?`, ...k.map((x) => set[x]), berichtId);
}

function pruefePng(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) throw ungueltig('bildPng muss ein PNG als data-URL sein (data:image/png;base64,…).');
  const b64 = dataUrl.slice('data:image/png;base64,'.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw ungueltig('bildPng: ungültige Base64-Daten.');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > MAX_PNG_BYTES) throw ungueltig('bildPng ist zu groß (max. 400 KB).');
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) throw ungueltig('bildPng ist kein gültiges PNG.');
  return dataUrl;
}

module.exports = function berichtRouten(api, bt) {
  const { db } = bt;
  const jetzt = () => bt.uhr().toISOString();

  function ladeMitZugriff(req, schreiben) {
    const id = v.pfadId(req.params.id, 'Berichts-ID');
    const b = ladeBerichtRoh(db, id);
    if (!b) throw nichtGefunden('Bericht nicht gefunden.');
    if (schreiben) pruefeSchreiben(req.ctx, b.baustelle); else pruefeLesen(req.ctx, b.baustelle);
    return b;
  }

  api.get('/berichte', (req, res) => {
    const ctx = req.ctx;
    if (!ctx.hat('bericht_erstellen') && !ctx.hat('bericht_freigeben')) throw keinZugriff('Bautagesberichte sind für Ihre Rolle nicht freigeschaltet.');
    const q = req.query;
    const bedingungen = [];
    const p = [];
    // Bereich schon in SQL (vor LIMIT)
    const ber = bereich(ctx.benutzer);
    if (ber === 'bauleiter') { bedingungen.push('b.bauleiter_id = ?'); p.push(ctx.benutzer.id); }
    if (ber === 'partie') { bedingungen.push('(b.polier_id = ? OR b.id = ?)'); p.push(ctx.benutzer.id, ctx.benutzer.baustelle_id ?? -1); }
    if (q.baustelleId !== undefined) { bedingungen.push('r.baustelle_id = ?'); p.push(v.pfadId(String(q.baustelleId), 'baustelleId')); }
    if (q.von !== undefined) { bedingungen.push('r.datum >= ?'); p.push(v.datum(String(q.von), 'von')); }
    if (q.bis !== undefined) { bedingungen.push('r.datum <= ?'); p.push(v.datum(String(q.bis), 'bis')); }
    if (q.status !== undefined) { bedingungen.push('r.status = ?'); p.push(v.auswahl(String(q.status), 'status', ['entwurf', 'unterschrieben', 'freigegeben'])); }
    const zeilen = db.alle(`SELECT r.id, r.baustelle_id, r.datum, r.status, b.kst, b.name, b.kurz, b.polier_id, b.bauleiter_id,
        (SELECT COUNT(*) FROM bericht_personal bp WHERE bp.bericht_id = r.id) AS anzahl,
        (SELECT COALESCE(SUM(stunden), 0) FROM bericht_personal bp WHERE bp.bericht_id = r.id) AS stunden,
        (SELECT COUNT(*) FROM unterschrift u WHERE u.bericht_id = r.id AND u.rolle = 'an') AS an,
        (SELECT COUNT(*) FROM unterschrift u WHERE u.bericht_id = r.id AND u.rolle = 'bh') AS bh
      FROM bericht r JOIN baustelle b ON b.id = r.baustelle_id
      ${bedingungen.length ? 'WHERE ' + bedingungen.join(' AND ') : ''} ORDER BY r.datum DESC, b.kst LIMIT 1000`, ...p);
    res.json(zeilen
      .filter((z) => baustelleImBereich(ctx.benutzer, { id: z.baustelle_id, polier_id: z.polier_id, bauleiter_id: z.bauleiter_id }))
      .map((z) => ({
        id: z.id, baustelleId: z.baustelle_id, kst: z.kst, baustelle: z.kurz || z.name, datum: z.datum, status: z.status,
        personalAnzahl: z.anzahl, stunden: r2(z.stunden), unterschriften: { an: z.an > 0, bh: z.bh > 0 }
      })));
  });

  api.post('/berichte', (req, res) => {
    if (!req.ctx.hat('bericht_erstellen')) throw keinZugriff('Berichte erstellen ist für Ihre Rolle nicht freigeschaltet.');
    const body = v.objekt(req.body);
    const baustelleId = v.id(body.baustelleId, 'baustelleId');
    const datum = v.datum(body.datum, 'datum');
    const bs = ladeBaustelle(db, baustelleId);
    if (!bs) throw ungueltig('Baustelle nicht gefunden.');
    pruefeSchreiben(req.ctx, bs);
    const heute = wienDatum(bt.uhr());
    if (datum > heute) throw ungueltig('Ein Bericht kann nicht für ein zukünftiges Datum angelegt werden.');
    if (datum < plusTage(heute, -366)) throw ungueltig('Das Datum liegt mehr als ein Jahr zurück.');
    const vorhanden = db.eins('SELECT id FROM bericht WHERE baustelle_id = ? AND datum = ?', baustelleId, datum);
    if (vorhanden) throw konflikt('Für diese Baustelle und diesen Tag gibt es bereits einen Bericht.', { id: vorhanden.id });
    const zeit = jetzt();
    const id = db.transaktion(() => {
      const r = db.lauf('INSERT INTO bericht (baustelle_id, datum, status, erstellt_von, erstellt, geaendert) VALUES (?, ?, ?, ?, ?, ?)', baustelleId, datum, 'entwurf', req.ctx.benutzer.id, zeit, zeit);
      speichereUpdate(db, r.id, { personal: personalVorschlag(db, baustelleId, datum, bt.uhr()) }, zeit);
      return r.id;
    });
    res.status(201).json(berichtJson(db, req.ctx, ladeBerichtRoh(db, id)));
  });

  api.get('/berichte/:id', (req, res) => {
    res.json(berichtJson(db, req.ctx, ladeMitZugriff(req, false)));
  });

  api.put('/berichte/:id', (req, res) => {
    const b = ladeMitZugriff(req, true);
    if (b.status !== 'entwurf' || b.unterschriften.length) throw konflikt(GESPERRT_TEXT);
    const u = pruefeUpdate(db, v.objekt(req.body));
    if (!Object.keys(u).length) throw ungueltig('Keine bearbeitbaren Felder angegeben.');
    db.transaktion(() => {
      speichereUpdate(db, b.id, u, jetzt());
      db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'bericht', objekt: `bericht:${b.id}`, text: `Bericht ${b.baustelle.kst} ${b.datum} bearbeitet: ${Object.keys(u).join(', ')}` });
    });
    res.json(berichtJson(db, req.ctx, ladeBerichtRoh(db, b.id)));
  });

  /** Zusatz: Personal erneut aus den Stempelungen übernehmen (nur Entwurf) */
  api.post('/berichte/:id/personal-aktualisieren', (req, res) => {
    const b = ladeMitZugriff(req, true);
    if (b.status !== 'entwurf' || b.unterschriften.length) throw konflikt(GESPERRT_TEXT);
    const seg = new Map(b.personal.map((p) => [p.benutzer_id, p.seg_stunden]));
    const personal = personalVorschlag(db, b.baustelle_id, b.datum, bt.uhr()).map((p) => ({ ...p, segStunden: Math.min(seg.get(p.benutzerId) || 0, p.stunden) }));
    db.transaktion(() => speichereUpdate(db, b.id, { personal }, jetzt()));
    res.json(berichtJson(db, req.ctx, ladeBerichtRoh(db, b.id)));
  });

  api.post('/berichte/:id/unterschrift', (req, res) => {
    const b = ladeMitZugriff(req, true);
    if (b.status !== 'entwurf') throw konflikt('Der Bericht ist bereits unterschrieben.');
    const body = v.objekt(req.body);
    const rolle = v.auswahl(body.rolle, 'rolle', ['an', 'bh']);
    const name = v.text(body.name, 'name', { max: 120 });
    const bild = pruefePng(body.bildPng);
    const zeit = jetzt();
    let neuerStatus = 'entwurf';
    db.transaktion(() => {
      db.lauf(`INSERT INTO unterschrift (bericht_id, rolle, name, zeit, bild_png, erfasst_von) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(bericht_id, rolle) DO UPDATE SET name = excluded.name, zeit = excluded.zeit, bild_png = excluded.bild_png, erfasst_von = excluded.erfasst_von`,
      b.id, rolle, name, zeit, bild, req.ctx.benutzer.id);
      const n = db.eins('SELECT COUNT(*) AS n FROM unterschrift WHERE bericht_id = ?', b.id).n;
      if (n >= 2) {
        neuerStatus = 'unterschrieben';
        db.lauf("UPDATE bericht SET status = 'unterschrieben', geaendert = ? WHERE id = ?", zeit, b.id);
        db.protokolliere({ zeit, benutzerId: req.ctx.benutzer.id, art: 'bericht', objekt: `bericht:${b.id}`, alt: 'entwurf', neu: 'unterschrieben', text: `Bericht ${b.baustelle.kst} ${b.datum} unterschrieben` });
        // Hinweis an alle, die freigeben dürfen (Bauleiter der Baustelle, Büro, GF)
        const empf = db.alle("SELECT id, rolle FROM benutzer WHERE aktiv = 1 AND (rolle IN ('buero','gf') OR id = ?)", b.baustelle.bauleiter_id || -1);
        for (const e of empf) {
          benachrichtige(db, {
            benutzerId: e.id, typ: 'bericht', titel: `Bericht zur Freigabe: ${b.baustelle.kurz || b.baustelle.name}`,
            text: `Bautagesbericht vom ${b.datum.split('-').reverse().join('.')} ist unterschrieben und wartet auf Freigabe.`,
            zeit, baustelleId: b.baustelle_id, schluessel: `bericht:${b.id}:unterschrieben`
          });
        }
      }
    });
    if (neuerStatus === 'unterschrieben') pruefeBudget(bt, b.baustelle_id, { anlass: 'Unterschrift Bautagesbericht', benutzerId: req.ctx.benutzer.id });
    res.json(berichtJson(db, req.ctx, ladeBerichtRoh(db, b.id)));
  });

  /** Unterschrift zurückziehen (nur solange der Bericht noch Entwurf ist) – danach wieder bearbeitbar */
  api.delete('/berichte/:id/unterschrift/:rolle', (req, res) => {
    const b = ladeMitZugriff(req, true);
    const rolle = v.auswahl(req.params.rolle, 'rolle', ['an', 'bh']);
    if (b.status !== 'entwurf') throw konflikt('Der Bericht ist vollständig unterschrieben – Unterschriften können nicht mehr zurückgezogen werden.');
    const r = db.lauf('DELETE FROM unterschrift WHERE bericht_id = ? AND rolle = ?', b.id, rolle);
    if (!r.changes) throw nichtGefunden('Diese Unterschrift gibt es nicht.');
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'bericht', objekt: `bericht:${b.id}`, text: `Unterschrift (${rolle === 'an' ? 'Auftragnehmer' : 'Bauherr'}) zurückgezogen: ${b.baustelle.kst} ${b.datum}` });
    res.json(berichtJson(db, req.ctx, ladeBerichtRoh(db, b.id)));
  });

  api.post('/berichte/:id/freigeben', (req, res) => {
    const id = v.pfadId(req.params.id, 'Berichts-ID');
    const b = ladeBerichtRoh(db, id);
    if (!b) throw nichtGefunden('Bericht nicht gefunden.');
    if (!req.ctx.hat('bericht_freigeben')) throw keinZugriff('Berichte freigeben ist für Ihre Rolle nicht freigeschaltet.');
    if (!baustelleImBereich(req.ctx.benutzer, b.baustelle)) throw keinZugriff('Freigeben dürfen Sie nur Berichte Ihrer eigenen Baustellen.');
    if (b.status === 'freigegeben') throw konflikt('Der Bericht ist bereits freigegeben.');
    if (b.status !== 'unterschrieben') throw konflikt('Freigabe erst nach beiden Unterschriften (Auftragnehmer und Bauherr) möglich.');
    const zeit = jetzt();
    db.transaktion(() => {
      db.lauf("UPDATE bericht SET status = 'freigegeben', freigegeben_von = ?, freigegeben_zeit = ?, geaendert = ? WHERE id = ?", req.ctx.benutzer.id, zeit, zeit, b.id);
      db.protokolliere({ zeit, benutzerId: req.ctx.benutzer.id, art: 'freigabe', objekt: `bericht:${b.id}`, alt: 'unterschrieben', neu: 'freigegeben', text: `Bericht ${b.baustelle.kst} ${b.datum} freigegeben` });
    });
    pruefeBudget(bt, b.baustelle_id, { anlass: 'Freigabe Bautagesbericht', benutzerId: req.ctx.benutzer.id });
    res.json(berichtJson(db, req.ctx, ladeBerichtRoh(db, b.id)));
  });

  api.get('/berichte/:id/pdf', async (req, res) => {
    const b = ladeMitZugriff(req, false);
    const fassung = req.query.fassung === undefined ? 'ag' : v.auswahl(String(req.query.fassung), 'fassung', ['ag', 'intern']);
    if (fassung === 'intern' && !req.ctx.hat('bericht_freigeben') && !req.ctx.hat('stammdaten')) throw keinZugriff('Die interne Fassung ist Bauleitung und Büro vorbehalten.');
    const firma = db.einstellung('firma', { name: 'Michael Pichler Ges.m.b.H.', ort: '2624 Breitenau' });
    // Bewusst ohne kostenTag: das PDF enthält nie €-Werte
    const daten = berichtJson(db, { benutzer: req.ctx.benutzer, rechte: new Set(), hat: () => false }, b);
    const pdf = await erzeugeBerichtPdf(daten, { fassung, firma, unkomprimiert: Boolean(bt.pdfUnkomprimiert), geraete: db.alle('SELECT id, code, name FROM geraet WHERE vorlage = 1 ORDER BY sortierung, id'), materialien: db.alle('SELECT id, code, name, einheit FROM material WHERE vorlage = 1 ORDER BY sortierung, id') });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Bautagesbericht_${b.baustelle.kst}_${b.datum}${fassung === 'intern' ? '_intern' : ''}.pdf"`);
    res.send(pdf);
  });
};

module.exports.ladeBerichtRoh = ladeBerichtRoh;
module.exports.berichtJson = berichtJson;
module.exports.speichereUpdate = speichereUpdate;
module.exports.pruefePersonal = pruefePersonal;
