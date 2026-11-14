'use strict';
/** Diktat-Assistent, Lieferschein-OCR, Papierbericht, KI-Einstellungen (API.md 12.10–12.13) */
const v = require('../validierung');
const { ungueltig, keinZugriff, nichtGefunden, konflikt, ApiFehler } = require('../fehler');
const { baustelleImBereich } = require('../rechte');
const B = require('./berichte');
const Foto = require('./berichtfotos');
const Diktat = require('../diktat');
const OCR = require('../ocr');
const KI = require('../ki');
const G = require('../geheim');
const { wienDatum } = require('../datum');

/** Lieferschein-Text (OCR) → Vorschlag (Regeln) */
function lieferscheinAuswerten(text, stamm) {
  const zeilen = String(text || '').split(/\r?\n/).map((z) => z.trim()).filter(Boolean);
  const nr = /(?:lieferschein|wiegeschein|ls)[\s.-]*(?:nr|nummer|no)?[.:\s#]*([A-Z0-9][A-Z0-9/-]{1,20})/i.exec(text || '');
  const dm = /\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/.exec(text || '');
  const datum = dm ? `${dm[3].length === 2 ? `20${dm[3]}` : dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}` : null;
  const lieferant = zeilen.find((z) => /(gmbh|kg|ag|gesmbh|ges\.m\.b\.h|werk|bau|transporte)/i.test(z) && !/lieferschein|baustelle|datum/i.test(z)) || zeilen[0] || null;
  const material = [], unklar = [];
  for (const z of zeilen) {
    if (/lieferschein|datum|baustelle|kunde|fahrer|kennzeichen|gesamt|summe|unterschrift/i.test(z)) continue;
    if (!/\d/.test(z)) continue;
    const r = Diktat.auswerten(z, { geraete: [], materialien: stamm.materialien, personen: [] });
    material.push(...r.vorschlag.material);
    unklar.push(...r.unklar);
  }
  return { vorschlag: { lieferant, lieferscheinNr: nr ? nr[1] : null, datum, material }, unklar };
}

/** Papierbericht: Datum und KST aus gedrucktem Text */
function papierAuswerten(db, text) {
  const dm = /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/.exec(text || '');
  const datum = dm ? `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}` : null;
  const km = /\b(\d{2}-\d{3})\b/.exec(text || '');
  const kst = km ? km[1] : null;
  const bs = kst ? db.eins('SELECT id FROM baustelle WHERE kst = ?', kst) : null;
  return { datum, kst, baustelleId: bs ? bs.id : null };
}

module.exports = function assistentRouten(api, bt) {
  const { db } = bt;
  const jetzt = () => bt.uhr().toISOString();
  const stamm = () => ({
    geraete: db.alle('SELECT id, code, name, gruppe FROM geraet WHERE aktiv = 1'),
    materialien: db.alle('SELECT id, code, name, einheit FROM material WHERE aktiv = 1')
  });
  function bericht(req, { offen = true } = {}) {
    const b = B.ladeBerichtRoh(db, v.pfadId(req.params.id ?? req.body.berichtId, 'Berichts-ID'));
    if (!b) throw nichtGefunden('Bericht nicht gefunden.');
    B.pruefeSchreiben(req.ctx, b.baustelle);
    if (offen && (b.status !== 'entwurf' || b.unterschriften.length)) throw konflikt(B.GESPERRT_TEXT);
    return b;
  }
  const kiFehler = (e) => (e instanceof KI.KiFehler ? e.message : 'KI-Fehler');
  /** N-061: wurde das Foto (vermutlich) an die KI übermittelt, steht der Hinweis auch im Rückfall auf die Texterkennung */
  const kiGesendet = (e) => (e && e.nichtGesendet ? {} : { kiHinweis: KI.FOTO_HINWEIS });

  /** KI-Namen → Stammdaten (mit der Diktat-Zuordnung) */
  function kiZuordnen(k, s, personen) {
    const vorschlag = { geraete: [], material: [], personal: [], regie: k.regie || [], arbeitsleistung: k.arbeitsleistung || '', vorkommnisse: k.vorkommnisse || '' };
    const unklar = [];
    for (const g of k.geraete || []) {
      const r = Diktat.auswerten(`${g.name} ${g.stunden} Stunden`, { geraete: s.geraete, materialien: [], personen: [] });
      if (r.vorschlag.geraete.length) vorschlag.geraete.push(...r.vorschlag.geraete); else unklar.push(`Gerät „${g.name}“ (${g.stunden} Std.) nicht zugeordnet`);
    }
    for (const m of k.material || []) {
      const r = Diktat.auswerten(`${m.name} ${m.menge} ${m.einheit}`, { geraete: [], materialien: s.materialien, personen: [] });
      if (r.vorschlag.material.length) vorschlag.material.push(...r.vorschlag.material); else unklar.push(`Material „${m.name}“ (${m.menge} ${m.einheit}) nicht zugeordnet`);
    }
    for (const p of k.personal || []) {
      const t = p.name.toLowerCase().split(/\s+/);
      const x = personen.find((q) => q.name.toLowerCase().split(/\s+/).some((w) => t.includes(w)));
      if (x) vorschlag.personal.push({ benutzerId: x.id, name: x.name, ...(p.stunden != null ? { stunden: p.stunden } : {}), ...(p.von ? { von: p.von } : {}), ...(p.bis ? { bis: p.bis } : {}) });
      else unklar.push(`Person „${p.name}“ nicht gefunden`);
    }
    return { vorschlag, unklar };
  }

  /* ---------- Diktat (12.10) ---------- */
  api.post('/bericht-assistent/text', async (req, res) => {
    const body = v.objekt(req.body);
    const b = bericht({ ...req, params: { id: String(body.berichtId) } }, { offen: false });
    const text = v.text(body.text, 'text', { max: 5000 });
    const s = stamm();
    const personen = [...new Map([...b.personal.map((p) => ({ id: p.benutzer_id, name: p.name })), ...db.alle("SELECT id, name FROM benutzer WHERE aktiv = 1 AND rolle IN ('mitarbeiter','polier') AND baustelle_id = ?", b.baustelle_id)].map((p) => [p.id, p])).values()];
    const regeln = Diktat.auswerten(text, { ...s, personen });
    if (KI.aktiv(bt)) {
      try {
        const k = await KI.anfrage(bt, { zweck: 'diktat', benutzerId: req.ctx.benutzer.id, system: KI.SYSTEM.diktat, inhalt: [{ type: 'text', text }], schema: KI.SCHEMA.diktat });
        const z = kiZuordnen(k.daten, s, personen);
        return res.json({ vorschlag: z.vorschlag, erkannt: regeln.erkannt, unklar: z.unklar, quelle: 'ki' });
      } catch (e) {
        return res.json({ ...regeln, hinweis: `${kiFehler(e)} – Vorschlag nach festen Regeln.` });
      }
    }
    res.json(regeln);
  });

  /* ---------- Lieferschein (12.11) ---------- */
  api.post('/berichte/:id/lieferschein', async (req, res) => {
    const b = bericht(req);
    const body = v.objekt(req.body);
    // Lieferschein ist ein Berichtsfoto (zählt zu den 10, steht im PDF) → Version +1 wie POST …/fotos
    const r = db.transaktion(() => { const x = Foto.fotoSpeichern(bt, req, b, body, 'lieferschein'); if (x.neu) Foto.berichtGeaendert(bt, b.id); return x; });
    const foto = Foto.fotoJson(r.foto, new Map(db.alle('SELECT id, name FROM benutzer').map((x) => [x.id, x.name])));
    const berichtVersion = Foto.berichtVersion(db, b.id);
    const daten = r.bild ? r.bild.daten : require('node:fs').readFileSync(require('node:path').join(Foto.ordner(bt), r.foto.datei));
    const s = stamm();
    let kiH = {}, kiText = null;
    if (KI.aktiv(bt)) {
      try {
        const k = await KI.anfrage(bt, { zweck: 'lieferschein', benutzerId: req.ctx.benutzer.id, system: KI.SYSTEM.lieferschein, inhalt: [KI.bildBlock(r.foto.mime, daten), { type: 'text', text: 'Bitte diesen Lieferschein auslesen.' }], schema: KI.SCHEMA.lieferschein });
        const z = kiZuordnen({ material: k.daten.positionen.map((p) => ({ name: p.material, menge: p.menge, einheit: p.einheit })) }, s, []);
        return res.status(r.neu ? 201 : 200).json({ foto, berichtVersion, kiHinweis: KI.FOTO_HINWEIS, text: null, vorschlag: { lieferant: k.daten.lieferant, lieferscheinNr: k.daten.lieferscheinNr, datum: k.daten.datum, material: z.vorschlag.material }, unklar: z.unklar, quelle: 'ki' });
      } catch (e) {
        kiH = kiGesendet(e); kiText = kiFehler(e);
        if (!OCR.verfuegbar(bt)) return res.status(r.neu ? 201 : 200).json({ foto, berichtVersion, ...kiH, text: null, vorschlag: null, unklar: [], hinweis: `${kiText}; Texterkennung nicht verfügbar – Foto gespeichert.` });
      }
    }
    if (!OCR.verfuegbar(bt)) return res.status(r.neu ? 201 : 200).json({ foto, berichtVersion, text: null, vorschlag: null, unklar: [], hinweis: 'Texterkennung nicht verfügbar (Sprachdaten fehlen) – Foto gespeichert.' });
    let text;
    try { text = await OCR.erkennen(bt, daten); } catch (e) {
      return res.status(r.neu ? 201 : 200).json({ foto, berichtVersion, ...kiH, text: null, vorschlag: null, unklar: [], hinweis: `${kiText ? `${kiText}; ` : ''}Texterkennung fehlgeschlagen: ${e.message}` });
    }
    if (r.neu) db.lauf('UPDATE bericht_foto SET ocr_text = ? WHERE id = ?', text.slice(0, 20000), r.foto.id); // N-116: nur beim neu angelegten Foto
    const a = lieferscheinAuswerten(text, s);
    res.status(r.neu ? 201 : 200).json({ foto, berichtVersion, ...kiH, text, vorschlag: a.vorschlag, unklar: a.unklar, quelle: 'ocr', ...(kiText ? { hinweis: `${kiText} – Vorschlag per Texterkennung.` } : {}) });
  });

  /* ---------- Papierbericht (12.12) ---------- */
  async function papierErkennen(req, mime, daten) {
    let kiH = {}, kiText = null;
    if (KI.aktiv(bt)) {
      try {
        const k = await KI.anfrage(bt, { zweck: 'papier', benutzerId: req.ctx.benutzer.id, system: KI.SYSTEM.papier, inhalt: [KI.bildBlock(mime, daten), { type: 'text', text: 'Bitte Datum, Kostenstelle und Text lesen.' }], schema: KI.SCHEMA.papier });
        const bs = k.daten.kst ? db.eins('SELECT id FROM baustelle WHERE kst = ?', k.daten.kst) : null;
        return { text: k.daten.text, vorschlag: { datum: k.daten.datum, kst: k.daten.kst, baustelleId: bs ? bs.id : null }, quelle: 'ki', kiHinweis: KI.FOTO_HINWEIS };
      } catch (e) {
        kiH = kiGesendet(e); kiText = kiFehler(e);
        if (!OCR.verfuegbar(bt)) return { text: null, vorschlag: null, ...kiH, hinweis: kiText };
      }
    }
    if (!OCR.verfuegbar(bt)) return { text: null, vorschlag: null, hinweis: 'Texterkennung nicht verfügbar – nur als Archivfoto gespeichert.' };
    try {
      const text = await OCR.erkennen(bt, daten);
      return { text, vorschlag: papierAuswerten(db, text), quelle: 'ocr', ...kiH, hinweis: kiText ? `${kiText} – nur gedruckte Felder per Texterkennung gelesen.` : 'Handschrift wird nur mit KI erkannt.' };
    } catch (e) { return { text: null, vorschlag: null, ...kiH, hinweis: `${kiText ? `${kiText}; ` : ''}Texterkennung fehlgeschlagen: ${e.message}` }; }
  }
  api.post('/berichte/:id/papier', async (req, res) => {
    const b = bericht(req, { offen: false }); // Archivanhang auch nach Unterschrift/Freigabe
    const r = db.transaktion(() => Foto.fotoSpeichern(bt, req, b, v.objekt(req.body), 'papier'));
    const daten = r.bild ? r.bild.daten : require('node:fs').readFileSync(require('node:path').join(Foto.ordner(bt), r.foto.datei));
    const e = await papierErkennen(req, r.foto.mime, daten);
    if (e.text && r.neu) db.lauf('UPDATE bericht_foto SET ocr_text = ? WHERE id = ?', e.text.slice(0, 20000), r.foto.id); // N-116: nur beim neu angelegten Foto
    if (e.vorschlag) e.vorschlag.passt = e.vorschlag.datum === b.datum && (!e.vorschlag.kst || e.vorschlag.kst === b.baustelle.kst);
    res.status(r.neu ? 201 : 200).json({ foto: Foto.fotoJson(r.foto, new Map(db.alle('SELECT id, name FROM benutzer').map((x) => [x.id, x.name]))), ...e, berichtVersion: Foto.berichtVersion(db, b.id) });
  });
  api.post('/berichte/papier', async (req, res) => {
    if (!req.ctx.hat('bericht_erstellen')) throw keinZugriff();
    const body = v.objekt(req.body);
    let bild;
    try { bild = require('../fuhrpark-bild').bildPruefen(body.bildBase64); } catch (e) { throw ungueltig(e.message); }
    const e = await papierErkennen(req, bild.mime, bild.daten);
    if (e.vorschlag && e.vorschlag.baustelleId) {
      const bs = db.eins('SELECT * FROM baustelle WHERE id = ?', e.vorschlag.baustelleId);
      if (!baustelleImBereich(req.ctx.benutzer, bs)) e.vorschlag.baustelleId = null;
    }
    res.json(e);
  });

  /* ---------- KI-Einstellungen (12.13) ---------- */
  function kiJson() {
    const e = KI.einstellungen(db);
    const n = KI.heuteNutzung(db, wienDatum(bt.uhr()));
    const von = e.bestaetigtVon ? db.eins('SELECT id, name FROM benutzer WHERE id = ?', e.bestaetigtVon) : null;
    return {
      aktiv: KI.aktiv(bt), schluesselGesetzt: Boolean(e.apiKey), datenschutzBestaetigt: Boolean(e.datenschutzBestaetigt), ...(von ? { bestaetigtVon: von, bestaetigtAm: e.bestaetigtAm } : {}),
      tagesLimit: e.tagesLimit || 200, heute: { aufrufe: n.aufrufe, eingabeTokens: n.ein, ausgabeTokens: n.aus }, modell: KI.MODELL,
      hinweis: 'Übermittelt wird an Anthropic: der Diktat-Text und bei Lieferschein/Papierbericht das Foto – das Foto wird vollständig übermittelt (ohne EXIF/GPS) und kann Preise zeigen. Aus der Datenbank werden keine Preise, Löhne oder Kalkulationsdaten gesendet. Ergebnisse sind nur Vorschläge. AVV mit Anthropic abschließen.'
    };
  }
  api.get('/einstellungen/ki', (req, res) => { if (!req.ctx.hat('benutzer')) throw keinZugriff(); res.json(kiJson()); });
  api.put('/einstellungen/ki', (req, res) => {
    if (!req.ctx.hat('benutzer')) throw keinZugriff('Die KI richtet die Geschäftsführung ein.');
    const body = v.objekt(req.body);
    const e = { ...KI.einstellungen(db) };
    if (body.apiKey !== undefined) {
      if (body.apiKey === '' || body.apiKey === null) { e.apiKey = null; e.aktiv = false; } else {
        const k = v.text(body.apiKey, 'apiKey', { max: 300 }).trim();
        if (!/^sk-[A-Za-z0-9_-]{3,}$/.test(k)) throw ungueltig('apiKey hat nicht das erwartete Format (sk-…).');
        try { e.apiKey = G.verschluesseln(bt, k, { pflicht: true }); } catch (_) { throw ungueltig('Zum Speichern des API-Schlüssels muss auf dem Server BAUTAG_SCHLUESSEL gesetzt sein.'); }
      }
    }
    if (body.datenschutzBestaetigt !== undefined) {
      e.datenschutzBestaetigt = v.bool(body.datenschutzBestaetigt, 'datenschutzBestaetigt');
      if (e.datenschutzBestaetigt) { e.bestaetigtVon = req.ctx.benutzer.id; e.bestaetigtAm = jetzt(); } else e.aktiv = false;
    }
    if (body.tagesLimit !== undefined) e.tagesLimit = v.zahl(body.tagesLimit, 'tagesLimit', { min: 1, max: 5000, ganz: true });
    if (body.aktiv !== undefined) {
      const a = v.bool(body.aktiv, 'aktiv');
      if (a && (!e.apiKey || !e.datenschutzBestaetigt)) throw ungueltig('Einschalten nur mit API-Schlüssel und bestätigtem Datenschutz-Hinweis.');
      e.aktiv = a;
    }
    db.setzeEinstellung('ki', e);
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'einstellung', objekt: 'ki', neu: { aktiv: e.aktiv, schluesselGesetzt: Boolean(e.apiKey), datenschutzBestaetigt: e.datenschutzBestaetigt, tagesLimit: e.tagesLimit }, text: 'KI-Einstellungen geändert' });
    res.json(kiJson());
  });
  api.post('/einstellungen/ki/test', async (req, res) => {
    if (!req.ctx.hat('benutzer')) throw keinZugriff();
    const e = KI.einstellungen(db);
    if (!e.apiKey) throw ungueltig('Kein API-Schlüssel hinterlegt.');
    if (!e.datenschutzBestaetigt) throw ungueltig('Bitte zuerst den Datenschutz-Hinweis bestätigen.');
    try {
      const r = await KI.anfrage(bt, { zweck: 'test', benutzerId: req.ctx.benutzer.id, system: 'Antworte kurz auf Deutsch.', inhalt: [{ type: 'text', text: 'Bestätige in einem kurzen Satz, dass die Verbindung funktioniert.' }], schema: require('zod').z.object({ text: require('zod').z.string() }) });
      res.json({ ok: true, text: String(r.daten.text || '').slice(0, 300), modell: KI.MODELL, eingabeTokens: r.usage.input_tokens || 0, ausgabeTokens: r.usage.output_tokens || 0 });
    } catch (err) {
      throw new ApiFehler(502, 'KI_FEHLER', kiFehler(err));
    }
  });
};

module.exports.lieferscheinAuswerten = lieferscheinAuswerten;
module.exports.papierAuswerten = papierAuswerten;
