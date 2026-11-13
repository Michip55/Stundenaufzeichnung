'use strict';
/** Stammdaten verwalten: Geräte, Materialien, Lohngruppen, Leistungen (API.md 12.21) */
const ExcelJS = require('exceljs');
const v = require('../validierung');
const { ungueltig, keinZugriff, nichtGefunden, konflikt, ApiFehler } = require('../fehler');
const PV = require('../preise-verlauf');
const { pruefeAlleBudgets } = require('../budget');
const { pruefeZip } = require('../katalog-excel');

const CODE = /^[a-z0-9_-]{1,20}$/;
const DEF = {
  geraete: { tabelle: 'geraet', schluessel: 'code', euro: ['kostensatz', 'verrechnungssatz'], felder: ['code', 'name', 'gruppe', 'einheit', 'anlageId', 'aktiv', 'sortierung'], name: 'Gerät' },
  materialien: { tabelle: 'material', schluessel: 'code', euro: ['ek', 'vk'], felder: ['code', 'name', 'einheit', 'dichte', 'naturmaterial', 'aktiv', 'sortierung'], name: 'Material' },
  lohngruppen: { tabelle: 'lohngruppe', schluessel: 'id', euro: ['kostensatz', 'regiesatz'], felder: ['id', 'name', 'kv', 'aktiv', 'sortierung'], name: 'Lohngruppe' },
  leistungen: { tabelle: 'leistung', schluessel: 'code', euro: ['ep'], felder: ['code', 'text', 'einheit', 'aktiv'], name: 'Leistung' }
};
const SPALTEN = { anlageId: 'anlage_id' };

function json(art, z, mitPreisen) {
  const d = DEF[art];
  const o = { id: z.id, version: z.version, aktiv: z.aktiv === 1 };
  for (const f of d.felder) {
    if (f === 'id' || f === 'aktiv') continue;
    const sp = SPALTEN[f] || f;
    o[f] = f === 'naturmaterial' ? z[sp] === 1 : z[sp] ?? null;
  }
  if (mitPreisen) for (const f of d.euro) o[f] = z[f];
  return o;
}

/** Verwendung eines Eintrags (für Löschen/Code-Änderung) */
function verwendung(db, art, z) {
  const zahl = (sql, ...p) => db.eins(sql, ...p).n;
  const quelle = (artQ, ref) => db.alle("SELECT quelle FROM projektposition WHERE quelle LIKE ? UNION ALL SELECT quelle FROM katalog WHERE quelle LIKE ?", `%"art":"${artQ}"%`, `%"art":"${artQ}"%`)
    .filter((x) => { try { const q = JSON.parse(x.quelle); return (Array.isArray(q.ref) ? q.ref : [q.ref]).includes(ref); } catch (_) { return false; } }).length;
  const u = { berichte: 0, positionen: 0, personen: 0, fuhren: 0, meldungen: 0 };
  if (art === 'geraete') { u.berichte = zahl('SELECT COUNT(*) AS n FROM bericht_geraet WHERE geraet_id = ?', z.id); u.positionen = quelle('geraet', z.code); u.personen = zahl('SELECT COUNT(*) AS n FROM anlage WHERE geraet_id = ?', z.id); }
  if (art === 'materialien') { u.berichte = zahl('SELECT COUNT(*) AS n FROM bericht_material WHERE material_id = ?', z.id); u.positionen = quelle('material', z.code); u.fuhren = zahl('SELECT COUNT(*) AS n FROM plan_fuhre WHERE material_id = ?', z.id); }
  if (art === 'lohngruppen') { u.personen = zahl('SELECT COUNT(*) AS n FROM benutzer WHERE lohngruppe_id = ? OR id IN (SELECT benutzer_id FROM benutzer_lohngruppe WHERE lohngruppe_id = ?)', z.id, z.id); u.positionen = quelle('personal', z.id); }
  if (art === 'leistungen') u.meldungen = zahl('SELECT COUNT(*) AS n FROM leistungsmeldung WHERE leistung_id = ?', z.id);
  return u;
}
const benutzt = (u) => Object.values(u).some((x) => x > 0);

/** Quellen-Art je Stammdaten-Art (Positions-Quellen speichern den CODE, nicht die id) */
const QUELLE_ART = { geraete: 'geraet', materialien: 'material' };
/**
 * Verweise per Code für eine Umbenennung (12.21): Positions-Quellen im Katalog und in allen Projekten
 * (auch Listen-Refs). → [{tabelle, id, quelle}] mit der neuen Quelle (JSON). Verweise per id bleiben unberührt.
 */
function codeVerweise(db, art, alt, neu) {
  const qa = QUELLE_ART[art];
  if (!qa) return [];
  const out = [];
  for (const tabelle of ['katalog', 'projektposition']) {
    for (const z of db.alle(`SELECT id, quelle FROM ${tabelle} WHERE quelle LIKE ?`, `%"art":"${qa}"%`)) {
      let q;
      try { q = JSON.parse(z.quelle); } catch (_) { continue; }
      if (!q || q.art !== qa) continue;
      const refs = Array.isArray(q.ref) ? q.ref : [q.ref];
      if (!refs.includes(alt)) continue;
      const neuRefs = refs.map((r) => (r === alt ? neu : r));
      out.push({ tabelle, id: z.id, quelle: JSON.stringify({ ...q, ref: Array.isArray(q.ref) ? [...new Set(neuRefs)] : neu }) });
    }
  }
  return out;
}

module.exports = function stammdatenVerwaltung(api, bt) {
  const { db } = bt;
  const jetzt = () => bt.uhr().toISOString();

  function art(req, schreiben) {
    const a = req.params.art;
    const d = DEF[a];
    if (!d) throw nichtGefunden('Unbekannte Stammdaten-Art (geraete, materialien, lohngruppen, leistungen).');
    const ctx = req.ctx;
    if (a === 'lohngruppen') {
      if (schreiben ? !ctx.hat('preise_bearbeiten') : !ctx.hat('preise_sehen')) throw keinZugriff('Lohngruppen sind vertraulich (Preisrecht).');
    } else if (schreiben ? !ctx.hat('stammdaten') && !ctx.hat('preise_bearbeiten') : !ctx.hat('stammdaten') && !ctx.hat('preise_sehen')) throw keinZugriff();
    return { a, d };
  }
  function zeile(d, id) {
    const z = db.eins(`SELECT * FROM ${d.tabelle} WHERE id = ?`, id);
    if (!z) throw nichtGefunden(`${d.name} nicht gefunden.`);
    return z;
  }
  const idAus = (a, roh) => (a === 'lohngruppen' ? (CODE.test(String(roh)) ? String(roh) : (() => { throw ungueltig('ID ist ungültig.'); })()) : v.pfadId(roh));

  /** Nicht-€-Felder prüfen → Spalten */
  function felder(a, d, body, teil) {
    const f = {};
    const t = (k, max, { pflicht = !teil, min = 1 } = {}) => { if (!teil || body[k] !== undefined) { const x = body[k] == null ? '' : v.text(body[k], k, { max, pflicht }); if (pflicht && x.length < min) throw ungueltig(`${k} fehlt.`); f[SPALTEN[k] || k] = x || null; } };
    if (d.schluessel === 'code' && (!teil || body.code !== undefined)) {
      const c = String(body.code || '').trim().toLowerCase();
      if (!CODE.test(c)) throw ungueltig('code: 1–20 Zeichen a–z, 0–9, _ oder -.');
      f.code = c;
    }
    if (a === 'leistungen') t('text', 200); else t('name', 120);
    if (a !== 'lohngruppen') {
      if (!teil || body.einheit !== undefined) {
        const e = body.einheit == null ? (a === 'geraete' ? 'Std.' : '') : v.text(body.einheit, 'einheit', { max: 20 });
        if (!e || e.length > 20) throw ungueltig('einheit: 1–20 Zeichen.');
        f.einheit = e;
      }
    }
    if (a === 'geraete') {
      if (body.gruppe !== undefined) f.gruppe = body.gruppe == null ? null : v.text(body.gruppe, 'gruppe', { max: 60, pflicht: false }) || null;
      if (body.anlageId !== undefined) {
        f.anlage_id = body.anlageId === null ? null : v.id(body.anlageId, 'anlageId');
        if (f.anlage_id && !db.eins('SELECT id FROM anlage WHERE id = ?', f.anlage_id)) throw ungueltig('anlageId: Anlage nicht gefunden.');
      }
    }
    if (a === 'materialien') {
      if (body.dichte !== undefined) f.dichte = body.dichte === null ? null : Math.round(v.zahl(body.dichte, 'dichte', { min: 0.1, max: 5 }) * 1000) / 1000;
      if (body.naturmaterial !== undefined) f.naturmaterial = v.bool(body.naturmaterial, 'naturmaterial') ? 1 : 0;
    }
    if (a === 'lohngruppen' && body.kv !== undefined) f.kv = body.kv == null ? null : v.text(body.kv, 'kv', { max: 120, pflicht: false }) || null;
    if (body.aktiv !== undefined) f.aktiv = v.bool(body.aktiv, 'aktiv') ? 1 : 0;
    if (body.sortierung !== undefined && a !== 'leistungen') f.sortierung = v.zahl(body.sortierung, 'sortierung', { min: 0, max: 1e6, ganz: true });
    return f;
  }
  /** €-Felder → [{feld, wert}] (nur mit preise_bearbeiten) */
  function euro(req, d, body) {
    const out = [];
    for (const k of d.euro) {
      if (body[k] === undefined) continue;
      if (!req.ctx.hat('preise_bearbeiten')) throw keinZugriff('Preise ändern Büro bzw. GF (preise_bearbeiten).');
      out.push({ feld: k, wert: v.betrag(body[k], k, { min: 0, max: 1e6 }) });
    }
    return out;
  }

  api.get('/stammdaten/:art', (req, res) => {
    const { a, d } = art(req, false);
    const alle = req.query.inaktiv === '1';
    const ord = a === 'leistungen' ? 'code' : 'sortierung, id';
    res.json(db.alle(`SELECT * FROM ${d.tabelle} ${alle ? '' : 'WHERE aktiv = 1'} ORDER BY ${ord}`).map((z) => json(a, z, req.ctx.hat('preise_sehen'))));
  });

  api.post('/stammdaten/:art', (req, res) => {
    const { a, d } = art(req, true);
    if (a !== 'lohngruppen' && !req.ctx.hat('stammdaten')) throw keinZugriff('Stammdaten anlegen dürfen Büro bzw. GF (Recht stammdaten).');
    const body = v.objekt(req.body);
    const f = felder(a, d, body, false);
    const e = euro(req, d, body);
    if (a === 'lohngruppen') {
      let id = body.id == null ? String(f.name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) : String(body.id);
      if (!CODE.test(id)) throw ungueltig('id: 1–20 Zeichen a–z, 0–9, _ oder -.');
      if (db.eins('SELECT id FROM lohngruppe WHERE id = ?', id)) throw konflikt(`Die Lohngruppe ${id} gibt es bereits.`);
      f.id = id;
    } else if (db.eins(`SELECT id FROM ${d.tabelle} WHERE code = ?`, f.code)) throw konflikt(`Der Code ${f.code} ist schon vergeben.`);
    if (f.sortierung === undefined && a !== 'leistungen') f.sortierung = (db.eins(`SELECT MAX(sortierung) AS m FROM ${d.tabelle}`).m || 0) + 10;
    for (const x of e) f[x.feld] = x.wert;
    const k = Object.keys(f);
    const id = db.transaktion(() => {
      const r = db.lauf(`INSERT INTO ${d.tabelle} (${k.join(', ')}) VALUES (${k.map(() => '?').join(', ')})`, ...k.map((x) => f[x]));
      const neuId = a === 'lohngruppen' ? f.id : r.id;
      db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: e.length ? 'preis' : 'stammdaten', objekt: `${a}:${neuId}`, neu: f, text: `${d.name} „${f.name || f.text}“ angelegt` });
      return neuId;
    });
    res.status(201).json(json(a, zeile(d, id), req.ctx.hat('preise_sehen')));
  });

  api.put('/stammdaten/:art/:id', (req, res) => {
    const { a, d } = art(req, true);
    const z = zeile(d, idAus(a, req.params.id));
    const body = v.objekt(req.body);
    const ver = v.zahl(body.version, 'version', { min: 1, ganz: true });
    if (ver !== z.version) throw konflikt(`${d.name} wurde inzwischen geändert. Bitte neu laden.`, { version: z.version });
    if (a === 'lohngruppen' && body.id !== undefined && body.id !== z.id) throw new ApiFehler(422, 'UNGUELTIG', 'Die ID einer Lohngruppe ist unveränderlich.');
    const f = felder(a, d, body, true);
    if (Object.keys(f).length && a !== 'lohngruppen' && !req.ctx.hat('stammdaten')) throw keinZugriff('Stammdaten ändern dürfen Büro bzw. GF (Recht stammdaten).');
    // 12.21 (geändert 13.11.2026): Code auch bei Verwendung änderbar – Verweise per Code werden mitgezogen
    let umbenennen = null;
    if (f.code !== undefined && f.code !== z.code) {
      if (db.eins(`SELECT id FROM ${d.tabelle} WHERE code = ? AND id <> ?`, f.code, z.id)) throw konflikt(`Der Code ${f.code} ist schon vergeben.`);
      umbenennen = { alt: z.code, neu: f.code, verweise: codeVerweise(db, a, z.code, f.code) };
    }
    if (body.vorschau === true) {
      return res.json({ vorschau: true, umbenannt: umbenennen ? { alt: umbenennen.alt, neu: umbenennen.neu, referenzen: umbenennen.verweise.length } : null, verwendet: verwendung(db, a, z) });
    }
    const e = euro(req, d, body);
    if (!Object.keys(f).length && !e.length) throw ungueltig('Keine Änderungen angegeben.');
    const g = e.length ? PV.pruefeGueltigAb(db, body.gueltigAb, body.rueckwirkend) : null;
    db.transaktion(() => {
      const k = Object.keys(f);
      db.lauf(`UPDATE ${d.tabelle} SET ${[...k.map((x) => `${x} = ?`), 'version = version + 1'].join(', ')} WHERE id = ?`, ...k.map((x) => f[x]), z.id);
      for (const x of e) PV.setzePreis(db, { art: a, ref: z.id, feld: x.feld, wert: x.wert, gueltigAb: g.gueltigAb, benutzerId: req.ctx.benutzer.id, jetzt: bt.uhr() });
      if (umbenennen) for (const x of umbenennen.verweise) db.lauf(`UPDATE ${x.tabelle} SET quelle = ? WHERE id = ?`, x.quelle, x.id);
      const alt = {}; for (const x of k) alt[x] = z[x]; for (const x of e) alt[x.feld] = z[x.feld];
      db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: e.length ? 'preis' : 'stammdaten', objekt: `${a}:${z.id}`, alt, neu: { ...f, ...Object.fromEntries(e.map((x) => [x.feld, x.wert])), ...(g ? { gueltigAb: g.gueltigAb } : {}), ...(umbenennen ? { umbenannt: { alt: umbenennen.alt, neu: umbenennen.neu, referenzen: umbenennen.verweise.length } } : {}) },
        text: umbenennen ? `${d.name} „${z.name || z.text}“: Code ${umbenennen.alt} → ${umbenennen.neu} (${umbenennen.verweise.length} Verweise angepasst)` : `${d.name} „${z.name || z.text}“ geändert` });
    });
    if (e.length) pruefeAlleBudgets(bt, { anlass: 'Preisänderung', benutzerId: req.ctx.benutzer.id });
    res.json({ ...json(a, zeile(d, z.id), req.ctx.hat('preise_sehen')), ...(umbenennen ? { umbenannt: { alt: umbenennen.alt, neu: umbenennen.neu, referenzen: umbenennen.verweise.length } } : {}) });
  });

  api.delete('/stammdaten/:art/:id', (req, res) => {
    const { a, d } = art(req, true);
    if (a !== 'lohngruppen' && !req.ctx.hat('stammdaten')) throw keinZugriff();
    const z = zeile(d, idAus(a, req.params.id));
    const u = verwendung(db, a, z);
    if (benutzt(u)) throw konflikt(`${d.name} „${z.name || z.text}“ wird verwendet und kann nicht gelöscht werden – stattdessen deaktivieren (aktiv:false).`, { verwendet: u });
    db.transaktion(() => {
      db.lauf(`DELETE FROM ${d.tabelle} WHERE id = ?`, z.id);
      db.lauf('DELETE FROM preis_stand WHERE art = ? AND ref = ?', a, String(z.id));
      db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'stammdaten', objekt: `${a}:${z.id}`, alt: { code: z.code || z.id, name: z.name || z.text }, text: `${d.name} „${z.name || z.text}“ gelöscht` });
    });
    res.json({ ok: true });
  });

  /* ---------- Excel ---------- */
  const spaltenListe = (a, d, mitPreisen) => [...d.felder.filter((f) => f !== 'anlageId'), ...(mitPreisen ? d.euro : [])];

  api.get('/stammdaten/:art/export.xlsx', async (req, res) => {
    const { a, d } = art(req, false);
    const mit = req.ctx.hat('preise_sehen');
    const sp = spaltenListe(a, d, mit);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(d.name);
    ws.addRow(sp);
    ws.getRow(1).font = { bold: true };
    for (const z of db.alle(`SELECT * FROM ${d.tabelle} ORDER BY ${a === 'leistungen' ? 'code' : 'sortierung, id'}`)) {
      const j = json(a, z, mit);
      ws.addRow(sp.map((f) => (f === 'id' ? z.id : f === 'aktiv' ? (j.aktiv ? 1 : 0) : f === 'naturmaterial' ? (j.naturmaterial ? 1 : 0) : j[f])));
    }
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'export', objekt: a, text: `${d.name}-Stammdaten als Excel exportiert` });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Stammdaten_${a}.xlsx"`);
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  });

  api.post('/stammdaten/:art/import', async (req, res) => {
    const { a, d } = art(req, true);
    if (a !== 'lohngruppen' && !req.ctx.hat('stammdaten')) throw keinZugriff();
    const body = v.objekt(req.body);
    const vorschau = body.vorschau === undefined ? true : v.bool(body.vorschau, 'vorschau');
    if (typeof body.dateiBase64 !== 'string') throw ungueltig('dateiBase64 fehlt.');
    const buf = Buffer.from(body.dateiBase64.replace(/^data:[^,]*,/, ''), 'base64');
    const wb = new ExcelJS.Workbook();
    try { pruefeZip(buf); await wb.xlsx.load(buf); } catch (e) { throw ungueltig(`Die Excel-Datei wurde abgewiesen: ${e.message}`); }
    const ws = wb.worksheets[0];
    if (!ws || ws.rowCount < 1 || ws.rowCount > 5000) throw ungueltig('Tabelle leer oder zu groß (höchstens 5000 Zeilen).');
    const kopf = (ws.getRow(1).values || []).slice(1).map((x) => String(x == null ? '' : x).trim());
    const key = d.schluessel;
    if (!kopf.includes(key)) throw ungueltig(`Spalte „${key}“ fehlt (Kopfzeile wie im Export).`);
    const g = PV.pruefeGueltigAb(db, body.gueltigAb, body.rueckwirkend);
    const bestand = new Map(db.alle(`SELECT * FROM ${d.tabelle}`).map((z) => [String(z[key]), z]));
    const neu = [], geaendert = [], fehler = [], gesehen = new Set();
    let unveraendert = 0;
    const plan = [];
    ws.eachRow({ includeEmpty: false }, (row, nr) => {
      if (nr === 1) return;
      const werte = {};
      kopf.forEach((k, i) => { let x = row.getCell(i + 1).value; if (x && typeof x === 'object' && 'result' in x) x = x.result; if (x !== null && x !== undefined && x !== '') werte[k] = x; });
      const code = String(werte[key] == null ? '' : werte[key]).trim().toLowerCase();
      if (!code) return;
      if (gesehen.has(code)) { fehler.push({ zeile: nr, text: `${code}: doppelt in der Datei.` }); return; }
      gesehen.add(code);
      const b = {};
      for (const f of [...d.felder, ...d.euro]) if (werte[f] !== undefined && f !== 'id' && f !== 'anlageId') b[f] = ['aktiv', 'naturmaterial'].includes(f) ? Boolean(Number(werte[f]) || werte[f] === true || /^(ja|true|x)$/i.test(String(werte[f]))) : typeof werte[f] === 'number' ? werte[f] : String(werte[f]);
      if (key === 'code') b.code = code;
      try {
        const z = bestand.get(code);
        const f = felder(a, d, b, Boolean(z));
        const e = [];
        for (const k of d.euro) {
          if (b[k] === undefined) continue;
          const w = v.betrag(Number(b[k]), k, { min: 0, max: 1e6 });
          if (z && Math.abs(z[k] - w) < 0.005) continue;
          if (!req.ctx.hat('preise_bearbeiten')) throw ungueltig(`${k}: Preise ändern nur mit Preisrecht.`);
          e.push({ feld: k, wert: w });
        }
        if (!z) {
          if (a === 'lohngruppen') f.id = code;
          neu.push({ [key]: code, name: f.name || f.text });
          plan.push({ neu: true, f, e });
        } else {
          const diff = {};
          for (const [k2, x] of Object.entries(f)) if (k2 !== 'code' && z[k2] !== x && !(z[k2] == null && x == null)) diff[k2] = { alt: z[k2], neu: x };
          for (const x of e) diff[x.feld] = { alt: z[x.feld], neu: x.wert };
          if (Object.keys(diff).length) { geaendert.push({ [key]: code, felder: diff }); plan.push({ z, f: Object.fromEntries(Object.keys(diff).filter((k2) => !d.euro.includes(k2)).map((k2) => [k2, diff[k2].neu])), e }); } else unveraendert++;
        }
      } catch (x) { fehler.push({ zeile: nr, text: `${code}: ${x.message}` }); }
    });
    const fehlend = [...bestand.keys()].filter((c) => !gesehen.has(c));
    const uebernehmen = !vorschau && !fehler.length;
    if (uebernehmen) {
      db.transaktion(() => {
        for (const p of plan) {
          if (p.neu) {
            if (p.f.sortierung === undefined && a !== 'leistungen') p.f.sortierung = (db.eins(`SELECT MAX(sortierung) AS m FROM ${d.tabelle}`).m || 0) + 10;
            for (const x of p.e) p.f[x.feld] = x.wert;
            const k = Object.keys(p.f);
            db.lauf(`INSERT INTO ${d.tabelle} (${k.join(', ')}) VALUES (${k.map(() => '?').join(', ')})`, ...k.map((x) => p.f[x]));
          } else {
            const k = Object.keys(p.f);
            if (k.length) db.lauf(`UPDATE ${d.tabelle} SET ${[...k.map((x) => `${x} = ?`), 'version = version + 1'].join(', ')} WHERE id = ?`, ...k.map((x) => p.f[x]), p.z.id);
            for (const x of p.e) PV.setzePreis(db, { art: a, ref: p.z.id, feld: x.feld, wert: x.wert, gueltigAb: g.gueltigAb, benutzerId: req.ctx.benutzer.id, jetzt: bt.uhr() });
          }
        }
        db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'stammdaten', objekt: a, neu: { neu: neu.length, geaendert: geaendert.length }, text: `${d.name}-Stammdaten aus Excel übernommen` });
      });
      if (plan.some((p) => p.e.length)) pruefeAlleBudgets(bt, { anlass: 'Preisänderung (Import)', benutzerId: req.ctx.benutzer.id });
    }
    res.json({ neu, geaendert, unveraendert, fehlend, fehler, uebernommen: uebernehmen });
  });
};

module.exports.verwendung = verwendung;
