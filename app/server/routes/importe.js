'use strict';
/** BMD-OP-Import, LV-Import (Auer Success / ÖNORM A 2063), Lohn-Vorlagen (API.md 12.20) */
const v = require('../validierung');
const { ungueltig, keinZugriff, nichtGefunden, konflikt } = require('../fehler');
const { darfPreise } = require('../rechte');
const { wienDatum } = require('../datum');
const { csv, feld } = require('../export');
const I = require('../importe');
const R = require('../rechnungen');

const MAX = 5 * 1024 * 1024;
const OP_VORLAGE = {
  name: 'BMD NTCS OP-Liste (Vorschlag – mit echter Datei prüfen)', trennzeichen: ';', kodierung: 'windows-1252', kopfzeile: true, dezimal: ',', datumFormat: 'TT.MM.JJJJ',
  spalten: { belegnr: 'Belegnr', datum: 'Belegdatum', kunde: 'Kontobezeichnung', netto: null, brutto: 'Betrag', offen: 'Offen', faellig: 'Fällig', bezahlt: null, zahlungsdatum: 'Zahlungsdatum' }
};
const LV_VORLAGE = { name: 'LV-Export (Excel/CSV)', trennzeichen: ';', kodierung: 'utf-8', kopfzeile: true, dezimal: ',', spalten: { oz: 'OZ', kurztext: 'Kurztext', einheit: 'Einheit', menge: 'Menge', ep: 'EP', gp: 'GP' } };
const BMD_LOHN = {
  id: 'bmd-ntcs', name: 'BMD NTCS (Vorschlag – mit Lohnverrechnung abstimmen)', trennzeichen: ';', kodierung: 'windows-1252', dezimal: ',', kopfzeile: true,
  spalten: [{ feld: 'pnr' }, { feld: 'monat' }, { feld: 'lohnart' }, { feld: 'stunden' }, { feld: 'tage' }, { feld: 'kst' }],
  lohnarten: { normal: '100', ueberstunden: '200', sw: '310', u: '400', k: '500', za: '450', seg: '600', taggeld: '700' },
  zeileJe: 'person_lohnart'
};

module.exports = function importRouten(api, bt) {
  const { db } = bt;
  const jetzt = () => bt.uhr().toISOString();
  const datei = (body) => {
    if (typeof body.dateiBase64 !== 'string' || !body.dateiBase64) throw ungueltig('dateiBase64 fehlt.');
    const b = Buffer.from(body.dateiBase64.replace(/^data:[^,]*,/, ''), 'base64');
    if (!b.length) throw ungueltig('Datei ist leer.');
    if (b.length > MAX) throw ungueltig('Datei ist größer als 5 MB.');
    return b;
  };
  function zuordnungPruefen(z, pflicht) {
    const o = v.objekt(z, 'zuordnung');
    const r = {};
    if (o.name !== undefined) r.name = v.text(o.name, 'name', { max: 100 });
    if (o.trennzeichen !== undefined) r.trennzeichen = v.auswahl(o.trennzeichen, 'trennzeichen', [';', ',', '\\t']);
    if (o.kodierung !== undefined) r.kodierung = v.auswahl(o.kodierung, 'kodierung', ['utf-8', 'windows-1252']);
    if (o.kopfzeile !== undefined) r.kopfzeile = v.bool(o.kopfzeile, 'kopfzeile');
    if (o.dezimal !== undefined) r.dezimal = v.auswahl(o.dezimal, 'dezimal', [',', '.']);
    if (o.datumFormat !== undefined) r.datumFormat = v.auswahl(o.datumFormat, 'datumFormat', ['TT.MM.JJJJ', 'JJJJ-MM-TT']);
    if (o.spalten !== undefined) {
      const s = v.objekt(o.spalten, 'spalten');
      r.spalten = {};
      for (const [k, x] of Object.entries(s)) {
        if (!pflicht.includes(k) && !Object.keys((pflicht.vorlage || {}).spalten || {}).includes(k)) throw ungueltig(`spalten.${k} ist unbekannt.`);
        r.spalten[k] = x === null || x === '' ? null : typeof x === 'number' ? v.zahl(x, `spalten.${k}`, { min: 1, max: 200, ganz: true }) : v.text(x, `spalten.${k}`, { max: 60 });
      }
    }
    return r;
  }

  /* ---------- BMD Offene Posten ---------- */
  const opZuordnung = () => ({ ...OP_VORLAGE, ...(db.einstellung('import_bmd_op', {}) || {}), spalten: { ...OP_VORLAGE.spalten, ...((db.einstellung('import_bmd_op', {}) || {}).spalten || {}) } });
  api.get('/import/bmd-op/zuordnung', (req, res) => { if (!req.ctx.hat('preise_sehen')) throw keinZugriff(); res.json(opZuordnung()); });
  api.put('/import/bmd-op/zuordnung', (req, res) => {
    if (!req.ctx.hat('preise_bearbeiten')) throw keinZugriff();
    const pf = Object.assign(Object.keys(OP_VORLAGE.spalten), { vorlage: OP_VORLAGE });
    const z = zuordnungPruefen(req.body, pf);
    const neu = { ...(db.einstellung('import_bmd_op', {}) || {}), ...z, spalten: { ...((db.einstellung('import_bmd_op', {}) || {}).spalten || {}), ...(z.spalten || {}) } };
    db.setzeEinstellung('import_bmd_op', neu);
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'einstellung', objekt: 'import_bmd_op', neu, text: 'Zuordnung BMD-OP-Import geändert' });
    res.json(opZuordnung());
  });

  api.post('/import/bmd-op', async (req, res) => {
    if (!req.ctx.hat('preise_bearbeiten')) throw keinZugriff('Den BMD-Import machen Büro bzw. GF.');
    const body = v.objekt(req.body);
    const vorschau = body.vorschau === undefined ? true : v.bool(body.vorschau, 'vorschau');
    const art = body.art === undefined ? 'op' : v.auswahl(body.art, 'art', ['op', 'zahlungen']);
    const Z = opZuordnung();
    let zeilen;
    try { zeilen = await I.tabelle(datei(body), Z); } catch (e) { throw ungueltig(`Datei nicht lesbar: ${e.message}`); }
    const kopf = Z.kopfzeile ? (zeilen.shift() || []).map(String) : [];
    const ix = Object.fromEntries(Object.entries(Z.spalten).map(([k, ref]) => [k, I.spaltenIndex(kopf, ref)]));
    if (ix.belegnr < 0) throw ungueltig(`Spalte für die Belegnummer („${Z.spalten.belegnr}“) nicht gefunden.`);
    if (art === 'op' && ix.offen < 0) throw ungueltig(`Spalte für den offenen Betrag („${Z.spalten.offen}“) nicht gefunden.`);
    const rechnungen = new Map(db.alle('SELECT * FROM rechnung WHERE storniert IS NULL').map((r) => [r.nr_norm, r]));
    const heute = wienDatum(bt.uhr());
    const zugeordnet = [], unbekannt = [], fehler = [], buchungen = [];
    zeilen.forEach((z, i) => {
      const nr = String(z[ix.belegnr] ?? '').trim();
      if (!nr) return;
      const zeile = i + 1 + (Z.kopfzeile ? 1 : 0);
      const r = rechnungen.get(R.nrNorm(nr));
      const kunde = ix.kunde >= 0 ? String(z[ix.kunde] ?? '') : '';
      if (art === 'op') {
        const offen = I.zahl(z[ix.offen], Z.dezimal);
        if (offen === null || Number.isNaN(offen)) { fehler.push({ zeile, text: `${nr}: offener Betrag ist keine Zahl.` }); return; }
        if (!r) { unbekannt.push({ zeile, belegnr: nr, kunde, offen }); return; }
        const s = R.rechnungStand(db, r, heute);
        const ziel = R.r2(Math.max(0, offen));
        const diff = R.r2(s.offen - ziel);
        const zd = ix.zahlungsdatum >= 0 ? I.datum(z[ix.zahlungsdatum], Z.datumFormat) : null;
        if (diff < -0.004) { fehler.push({ zeile, text: `${nr}: offener Betrag in BMD (${ziel}) ist höher als in BauTag (${s.offen}) – bitte prüfen.` }); return; }
        const neuStatus = ziel <= 0.004 ? 'bezahlt' : s.status === 'ueberfaellig' ? 'ueberfaellig' : 'teilbezahlt';
        zugeordnet.push({ zeile, rechnungId: r.id, nr: r.nr, alt: { offen: s.offen, status: s.status }, neu: { offen: ziel, status: diff > 0.004 ? neuStatus : s.status }, aenderung: diff > 0.004 });
        if (diff > 0.004) buchungen.push({ r, betrag: diff, datum: zd && zd <= heute ? zd : heute, schluessel: `op:${r.nr_norm}:${ziel}` });
      } else {
        const betrag = I.zahl(z[ix.bezahlt >= 0 ? ix.bezahlt : ix.brutto], Z.dezimal);
        const zd = ix.zahlungsdatum >= 0 ? I.datum(z[ix.zahlungsdatum], Z.datumFormat) : ix.datum >= 0 ? I.datum(z[ix.datum], Z.datumFormat) : null;
        if (!betrag || Number.isNaN(betrag) || !zd) { fehler.push({ zeile, text: `${nr}: Betrag oder Datum fehlt.` }); return; }
        if (!r) { unbekannt.push({ zeile, belegnr: nr, kunde, betrag }); return; }
        const schl = `za:${r.nr_norm}:${zd}:${R.r2(betrag)}`;
        const doppelt = db.eins('SELECT 1 AS x FROM rechnung_zahlung WHERE import_schluessel = ?', schl);
        zugeordnet.push({ zeile, rechnungId: r.id, nr: r.nr, betrag: R.r2(betrag), datum: zd, aenderung: !doppelt });
        if (!doppelt) buchungen.push({ r, betrag: R.r2(betrag), datum: zd, schluessel: schl });
      }
    });
    // G-04: Übernahme mit Fehlerzeilen → 400 im Standardformat, nichts gespeichert (wie E-05/Katalog-Import)
    if (!vorschau && fehler.length) throw ungueltig(`Die Datei enthält ${fehler.length} fehlerhafte Zeile(n) – nichts übernommen. Bitte die Zeilen korrigieren und erneut importieren.`, { zeilenFehler: fehler });
    const uebernehmen = !vorschau;
    if (uebernehmen && buchungen.length) {
      db.transaktion(() => {
        for (const b of buchungen) {
          db.lauf("INSERT INTO rechnung_zahlung (rechnung_id, datum, betrag, skonto, ruecklass, notiz, quelle, import_schluessel, erfasst, erfasst_von) VALUES (?, ?, ?, 0, 0, ?, 'bmd', ?, ?, ?)", b.r.id, b.datum, b.betrag, `BMD-Import ${body.dateiname ? String(body.dateiname).slice(0, 80) : ''}`.trim(), b.schluessel, jetzt(), req.ctx.benutzer.id);
        }
        db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'rechnung', objekt: 'import_bmd', neu: { art, buchungen: buchungen.length, unbekannt: unbekannt.length }, text: `BMD-Import (${art === 'op' ? 'Offene Posten' : 'Zahlungseingänge'}): ${buchungen.length} Zahlung(en) gebucht` });
      });
    }
    res.json({ zeilen: zeilen.length, zugeordnet, unbekannt, fehler, uebernommen: uebernehmen });
  });

  /* ---------- Leistungsverzeichnis ---------- */
  const lvZuordnung = () => ({ ...LV_VORLAGE, ...(db.einstellung('import_lv', {}) || {}), spalten: { ...LV_VORLAGE.spalten, ...((db.einstellung('import_lv', {}) || {}).spalten || {}) } });
  api.get('/import/lv/zuordnung', (req, res) => { if (!req.ctx.hat('preise_sehen')) throw keinZugriff(); res.json(lvZuordnung()); });
  api.put('/import/lv/zuordnung', (req, res) => {
    if (!req.ctx.hat('preise_bearbeiten')) throw keinZugriff();
    const z = zuordnungPruefen(req.body, Object.assign(Object.keys(LV_VORLAGE.spalten), { vorlage: LV_VORLAGE }));
    const neu = { ...(db.einstellung('import_lv', {}) || {}), ...z, spalten: { ...((db.einstellung('import_lv', {}) || {}).spalten || {}), ...(z.spalten || {}) } };
    db.setzeEinstellung('import_lv', neu);
    res.json(lvZuordnung());
  });

  async function lvLesen(buf, name) {
    let xml = null;
    const istZip = buf.readUInt32LE(0) === 0x04034b50;
    if (istZip) {
      const JSZip = require('jszip');
      require('../katalog-excel').pruefeZip(buf);
      const zip = await JSZip.loadAsync(buf);
      const excel = zip.file('[Content_Types].xml') && Object.keys(zip.files).some((n) => n.startsWith('xl/'));
      if (!excel) {
        const x = Object.values(zip.files).find((f) => !f.dir && /\.(xml|onlv)$/i.test(f.name));
        if (!x) throw new Error('Im ZIP ist keine LV-Datei (.xml/.onlv).');
        xml = await x.async('string');
      }
    } else {
      const t = buf.toString('utf8').replace(/^﻿/, '');
      if (/^\s*<\?xml|^\s*<[A-Za-z]/.test(t)) xml = t;
    }
    if (xml) {
      const r = I.onlvLesen(xml);
      return { format: 'oenorm_a2063', positionen: r.positionen.map((p) => ({ oz: p.oz, kurztext: p.kurztext, einheit: p.einheit, menge: p.menge, ep: p.ep, gp: p.gp })), dezimal: /\d,\d/.test(xml) ? ',' : '.' };
    }
    const Z = lvZuordnung();
    const zeilen = await I.tabelle(buf, Z);
    const kopf = Z.kopfzeile ? (zeilen.shift() || []).map(String) : [];
    const ix = Object.fromEntries(Object.entries(Z.spalten).map(([k, ref]) => [k, I.spaltenIndex(kopf, ref)]));
    if (ix.oz < 0 || ix.kurztext < 0) throw new Error(`Spalten „${Z.spalten.oz}“/„${Z.spalten.kurztext}“ nicht gefunden.`);
    return { format: 'tabelle', positionen: zeilen.map((z) => Object.fromEntries(Object.entries(ix).map(([k, i]) => [k, i >= 0 ? z[i] : null]))), dezimal: Z.dezimal };
  }

  function lvRechte(req, schreiben) {
    const bs = db.eins('SELECT * FROM baustelle WHERE id = ?', v.pfadId(req.params.id, 'Baustellen-ID'));
    if (!bs) throw nichtGefunden('Baustelle nicht gefunden.');
    if (!darfPreise(req.ctx, bs)) throw keinZugriff('Das LV enthält Preise.');
    if (schreiben && !req.ctx.hat('preise_bearbeiten')) throw keinZugriff('Das LV übernehmen Büro bzw. GF.');
    return bs;
  }

  api.post('/baustellen/:id/lv-import', async (req, res) => {
    const bs = lvRechte(req, true);
    const body = v.objekt(req.body);
    const vorschau = body.vorschau === undefined ? true : v.bool(body.vorschau, 'vorschau');
    let gelesen;
    try { gelesen = await lvLesen(datei(body), body.dateiname); } catch (e) { throw ungueltig(`LV-Datei nicht lesbar: ${e.message}`); }
    const warnungen = [];
    const positionen = [];
    gelesen.positionen.forEach((p, i) => {
      const oz = String(p.oz ?? '').trim(), kurztext = String(p.kurztext ?? '').trim().slice(0, 300);
      if (!oz && !kurztext) return;
      const menge = p.menge === null || p.menge === undefined || p.menge === '' ? null : I.zahl(p.menge, gelesen.dezimal);
      const ep = p.ep === null || p.ep === undefined || p.ep === '' ? null : I.zahl(p.ep, gelesen.dezimal);
      let gp = p.gp === null || p.gp === undefined || p.gp === '' ? null : I.zahl(p.gp, gelesen.dezimal);
      if ([menge, ep, gp].some((x) => Number.isNaN(x))) { warnungen.push(`Position ${oz || i + 1}: Zahl nicht lesbar – übersprungen.`); return; }
      if (gp == null && menge != null && ep != null) gp = R.r2(menge * ep);
      if (gp != null && menge != null && ep != null && Math.abs(R.r2(menge * ep) - gp) > 0.05) warnungen.push(`Position ${oz}: GP ${gp} ≠ Menge × EP ${R.r2(menge * ep)}.`);
      positionen.push({ oz: oz.slice(0, 40), kurztext, einheit: p.einheit ? String(p.einheit).slice(0, 20) : null, menge, ep: ep == null ? null : R.r2(ep), gp: gp == null ? null : R.r2(gp) });
    });
    if (!positionen.length) throw ungueltig('Keine Positionen gefunden (OZ, Kurztext, Einheit, Menge, EP).');
    const summe = R.r2(positionen.reduce((a, p) => a + (p.gp || 0), 0));
    if (gelesen.format === 'oenorm_a2063') warnungen.unshift('ÖNORM A 2063: Teilmenge gelesen – mit echter Exportdatei aus Auer Success prüfen.');
    if (!vorschau) {
      db.transaktion(() => {
        db.lauf('DELETE FROM lv_position WHERE baustelle_id = ?', bs.id);
        positionen.forEach((p, i) => db.lauf('INSERT INTO lv_position (baustelle_id, oz, kurztext, einheit, menge, ep, gp, sortierung) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', bs.id, p.oz, p.kurztext, p.einheit, p.menge, p.ep, p.gp, i * 10));
        db.lauf(`INSERT INTO lv_import (baustelle_id, datei, importiert, von, summe, format) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(baustelle_id) DO UPDATE SET datei = excluded.datei, importiert = excluded.importiert, von = excluded.von, summe = excluded.summe, format = excluded.format`,
          bs.id, body.dateiname ? String(body.dateiname).slice(0, 120) : null, jetzt(), req.ctx.benutzer.id, summe, gelesen.format);
        if (body.auftragssummeUebernehmen === true) db.lauf('UPDATE baustelle SET auftragssumme = ?, version = version + 1 WHERE id = ?', summe, bs.id);
        db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'auftrag', objekt: `baustelle:${bs.id}`, neu: { positionen: positionen.length, summe, format: gelesen.format, auftragssumme: body.auftragssummeUebernehmen === true }, text: `LV für ${bs.kst} importiert (${positionen.length} Positionen)` });
      });
      if (body.auftragssummeUebernehmen === true) require('../budget').pruefeBudget(bt, bs.id, { anlass: 'LV-Import', benutzerId: req.ctx.benutzer.id });
    }
    res.json({ format: gelesen.format, positionen, summe, warnungen, uebernommen: !vorschau });
  });

  function lvJson(bs) {
    const imp = db.eins('SELECT * FROM lv_import WHERE baustelle_id = ?', bs.id);
    const positionen = db.alle('SELECT * FROM lv_position WHERE baustelle_id = ? ORDER BY sortierung, id', bs.id).map((p) => ({ id: p.id, oz: p.oz, kurztext: p.kurztext, einheit: p.einheit, menge: p.menge, ep: p.ep, gp: p.gp, projektpositionId: p.projektposition_id }));
    return { positionen, summe: R.r2(positionen.reduce((a, p) => a + (p.gp || 0), 0)), importiert: imp ? imp.importiert : null, datei: imp ? imp.datei : null, format: imp ? imp.format : null };
  }
  api.get('/baustellen/:id/lv', (req, res) => res.json(lvJson(lvRechte(req, false))));
  api.put('/baustellen/:id/lv/:lid', (req, res) => {
    const bs = lvRechte(req, true);
    const p = db.eins('SELECT * FROM lv_position WHERE id = ? AND baustelle_id = ?', v.pfadId(req.params.lid), bs.id);
    if (!p) throw nichtGefunden('LV-Position nicht gefunden.');
    const body = v.objekt(req.body);
    let pp = null;
    if (body.projektpositionId !== null) {
      pp = db.eins('SELECT id FROM projektposition WHERE id = ? AND baustelle_id = ?', v.id(body.projektpositionId, 'projektpositionId'), bs.id);
      if (!pp) throw ungueltig('projektpositionId gehört nicht zu dieser Baustelle.');
    }
    db.lauf('UPDATE lv_position SET projektposition_id = ? WHERE id = ?', pp ? pp.id : null, p.id);
    res.json(lvJson(bs).positionen.find((x) => x.id === p.id));
  });

  /* ---------- Lohn-Vorlagen ---------- */
  function vorlagen() {
    const eigene = db.alle('SELECT * FROM lohn_vorlage ORDER BY name').map((z) => ({ id: z.id, ...JSON.parse(z.daten), eingebaut: z.eingebaut === 1 }));
    return eigene.some((x) => x.id === BMD_LOHN.id) ? eigene : [{ ...BMD_LOHN, eingebaut: true }, ...eigene];
  }
  function vorlagePruefen(body) {
    const o = v.objekt(body);
    const f = {
      name: v.text(o.name, 'name', { max: 100 }),
      trennzeichen: v.auswahl(o.trennzeichen ?? ';', 'trennzeichen', [';', ',', '\\t']),
      kodierung: v.auswahl(o.kodierung ?? 'windows-1252', 'kodierung', ['utf-8', 'windows-1252']),
      dezimal: v.auswahl(o.dezimal ?? ',', 'dezimal', [',', '.']),
      kopfzeile: o.kopfzeile === undefined ? true : v.bool(o.kopfzeile, 'kopfzeile'),
      zeileJe: v.auswahl(o.zeileJe ?? 'person_lohnart', 'zeileJe', ['person_lohnart', 'person_tag_lohnart']),
      spalten: v.liste(o.spalten, 'spalten', { max: 20 }).map((s, i) => {
        const x = v.objekt(s, `spalten[${i}]`);
        const f2 = v.auswahl(x.feld, `spalten[${i}].feld`, ['pnr', 'name', 'monat', 'lohnart', 'stunden', 'tage', 'betrag', 'kst', 'datum', 'fest']);
        return { feld: f2, ...(x.wert != null ? { wert: v.text(String(x.wert), `spalten[${i}].wert`, { max: 40 }) } : {}), ...(x.titel != null ? { titel: v.text(String(x.titel), `spalten[${i}].titel`, { max: 40 }) } : {}) };
      }),
      lohnarten: {}
    };
    const l = v.objekt(o.lohnarten ?? {}, 'lohnarten');
    for (const k of ['normal', 'ueberstunden', 'sw', 'u', 'k', 'za', 'seg', 'taggeld']) f.lohnarten[k] = l[k] == null ? '' : v.text(String(l[k]), `lohnarten.${k}`, { max: 20, pflicht: false });
    return f;
  }
  api.get('/lohn-vorlagen', (req, res) => { if (!req.ctx.hat('lohn')) throw keinZugriff(); res.json(vorlagen()); });
  api.post('/lohn-vorlagen', (req, res) => {
    if (!req.ctx.hat('lohn')) throw keinZugriff();
    const f = vorlagePruefen(req.body);
    const id = `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    db.lauf('INSERT INTO lohn_vorlage (id, name, daten, geaendert) VALUES (?, ?, ?, ?)', id, f.name, JSON.stringify({ ...f, id }), jetzt());
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'einstellung', objekt: `lohn_vorlage:${id}`, neu: f, text: `Lohn-Vorlage „${f.name}“ angelegt` });
    res.status(201).json({ ...f, id, eingebaut: false });
  });
  api.put('/lohn-vorlagen/:id', (req, res) => {
    if (!req.ctx.hat('lohn')) throw keinZugriff();
    const id = String(req.params.id).slice(0, 40);
    if (!vorlagen().some((x) => x.id === id)) throw nichtGefunden('Vorlage nicht gefunden.');
    const f = vorlagePruefen(req.body);
    db.lauf('INSERT INTO lohn_vorlage (id, name, daten, eingebaut, geaendert) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, daten = excluded.daten, geaendert = excluded.geaendert',
      id, f.name, JSON.stringify({ ...f, id }), id === BMD_LOHN.id ? 1 : 0, jetzt());
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'einstellung', objekt: `lohn_vorlage:${id}`, neu: f, text: `Lohn-Vorlage „${f.name}“ geändert` });
    res.json({ ...f, id, eingebaut: id === BMD_LOHN.id });
  });
  api.delete('/lohn-vorlagen/:id', (req, res) => {
    if (!req.ctx.hat('lohn')) throw keinZugriff();
    const id = String(req.params.id).slice(0, 40);
    if (id === BMD_LOHN.id) throw konflikt('Die eingebaute Vorlage kann nicht gelöscht werden (nur geändert).');
    db.lauf('DELETE FROM lohn_vorlage WHERE id = ?', id);
    res.json({ ok: true });
  });

  /** Lohn-Export nach Vorlage (wird von /monat/export.csv?vorlage= genutzt) */
  api.lohnExportNachVorlage = (vorlageId, m, daten) => {
    const vl = vorlagen().find((x) => x.id === vorlageId);
    if (!vl) throw nichtGefunden('Lohn-Vorlage nicht gefunden.');
    const zahlTxt = (x) => (x == null || x === '' ? '' : vl.dezimal === ',' ? String(x).replace('.', ',') : String(x));
    const ARTEN = [['normal', 'normal', 'stunden'], ['ueberstunden', 'ueberstunden', 'stunden'], ['sw', 'swStunden', 'stunden'], ['u', 'u', 'tage'], ['k', 'k', 'tage'], ['za', 'za', 'tage'], ['seg', 'seg', 'stunden']];
    const zeilen = [];
    if (vl.kopfzeile) zeilen.push(vl.spalten.map((s) => s.titel || s.feld));
    for (const p of daten.mitarbeiter) {
      const kst = [...new Set(Object.values(p.tage).flatMap((t) => (t.baustellen || []).map((b) => b.kst || b)))].join(',');
      const zeile = (lohnart, menge, art, datumWert) => zeilen.push(vl.spalten.map((s) => {
        switch (s.feld) {
          case 'pnr': return p.pnr ?? '';
          case 'name': return p.name;
          case 'monat': return m;
          case 'lohnart': return lohnart;
          case 'stunden': return art === 'stunden' ? zahlTxt(menge) : '';
          case 'tage': return art === 'tage' ? zahlTxt(menge) : '';
          case 'betrag': return '';
          case 'kst': return kst;
          case 'datum': return datumWert ? datumWert.split('-').reverse().join('.') : '';
          default: return s.wert || '';
        }
      }));
      if (vl.zeileJe === 'person_tag_lohnart') {
        for (const d of Object.keys(p.tage).sort()) {
          const t = p.tage[d];
          if (t.stunden) zeile(vl.lohnarten.normal, t.stunden, 'stunden', d);
          if (t.code && vl.lohnarten[t.code.toLowerCase()]) zeile(vl.lohnarten[t.code.toLowerCase()], 1, 'tage', d);
        }
      } else {
        for (const [k, feldname, art] of ARTEN) if (p[feldname]) zeile(vl.lohnarten[k], p[feldname], art, null);
      }
    }
    const trenn = vl.trennzeichen === '\\t' ? '\t' : vl.trennzeichen;
    // G-13: gemeinsamer Helfer – Formel-Schutz für jedes Trennzeichen
    const text = require('../export').csvText(zeilen.map((z) => z.map((x) => (typeof x === 'number' ? String(x) : x))), trenn);
    return { buf: vl.kodierung === 'windows-1252' ? Buffer.from(text.replace(/[^\x00-\xff]/g, '?'), 'latin1') : Buffer.from(`﻿${text}`, 'utf8'), kodierung: vl.kodierung, name: vl.name };
  };
};
module.exports.BMD_LOHN = BMD_LOHN;
