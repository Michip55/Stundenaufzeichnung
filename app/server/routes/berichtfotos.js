'use strict';
/** Fotos im Bautagesbericht (API.md 12.6) – gleiche Bildprüfung wie Schadensfotos (11.9) */
const fs = require('node:fs');
const path = require('node:path');
const v = require('../validierung');
const { ungueltig, nichtGefunden, konflikt } = require('../fehler');
const Bild = require('../fuhrpark-bild');
const B = require('./berichte');

const MAX_FOTOS = 10;
const MAX_PAPIER = 5;

function ordner(bt) { return path.join(bt.uploads, 'berichte'); }

function fotoJson(f, namen) {
  return {
    id: f.id, art: f.art, dateiname: f.dateiname, beschreibung: f.beschreibung || '', mime: f.mime, groesse: f.groesse, erstellt: f.erstellt,
    erstelltVon: f.erstellt_von ? { id: f.erstellt_von, name: namen.get(f.erstellt_von) || '?' } : null,
    url: `/api/berichte/${f.bericht_id}/fotos/${f.id}`
  };
}

function fotosJson(db, berichtId) {
  const namen = new Map(db.alle('SELECT id, name FROM benutzer').map((b) => [b.id, b.name]));
  return db.alle('SELECT * FROM bericht_foto WHERE bericht_id = ? ORDER BY id', berichtId).map((f) => fotoJson(f, namen));
}

/**
 * Bild prüfen und speichern (in einer Transaktion des Aufrufers). Gleiches Bild im Bericht → bestehendes Foto.
 * @returns {{foto, neu:boolean}}
 */
function fotoSpeichern(bt, req, b, body, art = 'foto') {
  const { db } = bt;
  let bild;
  try { bild = Bild.bildPruefen(body.bildBase64); } catch (e) { throw ungueltig(e.message); }
  const gleich = db.eins('SELECT * FROM bericht_foto WHERE bericht_id = ? AND sha256 = ?', b.id, bild.sha256);
  if (gleich) return { foto: gleich, neu: false };
  if (art === 'papier') {
    if (db.eins("SELECT COUNT(*) AS n FROM bericht_foto WHERE bericht_id = ? AND art = 'papier'", b.id).n >= MAX_PAPIER) throw ungueltig(`Höchstens ${MAX_PAPIER} Seiten Papierbericht je Bericht.`);
  } else if (db.eins("SELECT COUNT(*) AS n FROM bericht_foto WHERE bericht_id = ? AND art <> 'papier'", b.id).n >= MAX_FOTOS) {
    throw ungueltig(`Höchstens ${MAX_FOTOS} Fotos je Bericht.`);
  }
  const beschreibung = body.beschreibung == null ? null : v.text(body.beschreibung, 'beschreibung', { max: 300, pflicht: false });
  const datei = Bild.speichere(ordner(bt), bild.mime, bild.daten);
  try {
    const r = db.lauf(`INSERT INTO bericht_foto (bericht_id, art, datei, mime, groesse, sha256, dateiname, beschreibung, erstellt, erstellt_von)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, b.id, art, datei, bild.mime, bild.daten.length, bild.sha256, Bild.sichererName(body.dateiname, bild.mime), beschreibung, bt.uhr().toISOString(), req.ctx.benutzer.id);
    db.protokolliere({ zeit: bt.uhr().toISOString(), benutzerId: req.ctx.benutzer.id, art: 'bericht', objekt: `bericht:${b.id}`, neu: { fotoId: r.id, art, sha256: bild.sha256 }, text: `${art === 'papier' ? 'Papierbericht' : art === 'lieferschein' ? 'Lieferschein' : 'Foto'} zum Bericht ${b.baustelle.kst} ${b.datum} hinzugefügt` });
    return { foto: db.eins('SELECT * FROM bericht_foto WHERE id = ?', r.id), neu: true, bild };
  } catch (e) {
    try { fs.unlinkSync(Bild.dateiPfad(ordner(bt), datei)); } catch (_) { /* egal */ }
    throw e;
  }
}

/** Bericht als geändert markieren: Version +1, offene Fern-Unterschrift-Links ungültig (12.6/12.9) */
function berichtGeaendert(bt, berichtId) {
  bt.db.lauf('UPDATE bericht SET geaendert = ?, version = version + 1 WHERE id = ?', bt.uhr().toISOString(), berichtId);
  if (typeof B.linksUngueltig === 'function') B.linksUngueltig(bt.db, berichtId);
}
/** aktuelle Berichtsversion für Antworten der Anhang-Routen (`berichtVersion`) */
const berichtVersion = (db, berichtId) => db.eins('SELECT version FROM bericht WHERE id = ?', berichtId).version;

/** Fotoanhang für das PDF (Fotos und Lieferscheine, ohne Papierbericht) */
function fotoAnhang(bt, berichtId) {
  return bt.db.alle("SELECT * FROM bericht_foto WHERE bericht_id = ? AND art <> 'papier' ORDER BY id", berichtId).map((f) => {
    let daten = null;
    try { daten = fs.readFileSync(Bild.dateiPfad(ordner(bt), f.datei)); } catch (_) { /* fehlt */ }
    return { mime: daten ? f.mime : 'fehlt', daten, beschreibung: f.beschreibung, dateiname: f.dateiname };
  });
}

module.exports = function berichtFotoRouten(api, bt) {
  const { db } = bt;
  B.fotosJson = fotosJson;
  B.fotoAnhang = fotoAnhang;
  const namen = () => new Map(db.alle('SELECT id, name FROM benutzer').map((x) => [x.id, x.name]));

  function bericht(req, schreiben) {
    const b = B.ladeBerichtRoh(db, v.pfadId(req.params.id, 'Berichts-ID'));
    if (!b) throw nichtGefunden('Bericht nicht gefunden.');
    if (schreiben) {
      B.pruefeSchreiben(req.ctx, b.baustelle);
      if (b.status !== 'entwurf' || b.unterschriften.length) throw konflikt(B.GESPERRT_TEXT);
    } else B.pruefeLesen(req.ctx, b.baustelle);
    return b;
  }
  function foto(req, b) {
    const f = db.eins('SELECT * FROM bericht_foto WHERE id = ? AND bericht_id = ?', v.pfadId(req.params.fid, 'Foto-ID'), b.id);
    if (!f) throw nichtGefunden('Foto nicht gefunden.');
    return f;
  }
  const geaendert = (b) => berichtGeaendert(bt, b.id);

  api.post('/berichte/:id/fotos', (req, res) => {
    const b = bericht(req, true);
    const r = db.transaktion(() => { const x = fotoSpeichern(bt, req, b, v.objekt(req.body), 'foto'); if (x.neu) geaendert(b); return x; });
    res.status(r.neu ? 201 : 200).json({ ...fotoJson(r.foto, namen()), berichtVersion: berichtVersion(db, b.id) });
  });

  api.put('/berichte/:id/fotos/:fid', (req, res) => {
    const b = bericht(req, true);
    const f = foto(req, b);
    const body = v.objekt(req.body);
    const beschreibung = body.beschreibung == null ? null : v.text(body.beschreibung, 'beschreibung', { max: 300, pflicht: false });
    db.transaktion(() => { db.lauf('UPDATE bericht_foto SET beschreibung = ? WHERE id = ?', beschreibung, f.id); geaendert(b); });
    res.json({ ...fotoJson(db.eins('SELECT * FROM bericht_foto WHERE id = ?', f.id), namen()), berichtVersion: berichtVersion(db, b.id) });
  });

  api.delete('/berichte/:id/fotos/:fid', (req, res) => {
    const b0 = B.ladeBerichtRoh(db, v.pfadId(req.params.id, 'Berichts-ID'));
    if (!b0) throw nichtGefunden('Bericht nicht gefunden.');
    const f0 = db.eins('SELECT * FROM bericht_foto WHERE id = ? AND bericht_id = ?', v.pfadId(req.params.fid, 'Foto-ID'), b0.id);
    // Papierbericht-Seiten löschen nur Büro/GF (Archiv, 12.12)
    let b, f;
    if (f0 && f0.art === 'papier') {
      if (!['buero', 'gf'].includes(req.ctx.benutzer.rolle)) throw require('../fehler').keinZugriff('Archivierte Papierberichte löschen nur Büro bzw. GF.');
      b = b0; f = f0;
    } else { b = bericht(req, true); f = foto(req, b); }
    db.transaktion(() => {
      db.lauf('DELETE FROM bericht_foto WHERE id = ?', f.id);
      if (f.art !== 'papier') geaendert(b);
      db.protokolliere({ zeit: bt.uhr().toISOString(), benutzerId: req.ctx.benutzer.id, art: 'bericht', objekt: `bericht:${b.id}`, alt: { fotoId: f.id, art: f.art, sha256: f.sha256 }, text: `Foto ${f.id} vom Bericht ${b.baustelle.kst} ${b.datum} gelöscht` });
    });
    try { fs.unlinkSync(Bild.dateiPfad(ordner(bt), f.datei)); } catch (_) { /* weg */ }
    res.json({ ok: true, berichtVersion: berichtVersion(db, b.id) });
  });

  api.get('/berichte/:id/fotos/:fid', (req, res) => {
    const b = bericht(req, false);
    const f = foto(req, b);
    let daten;
    try { daten = fs.readFileSync(Bild.dateiPfad(ordner(bt), f.datei)); } catch (_) { throw nichtGefunden('Fotodatei nicht vorhanden.'); }
    res.setHeader('Content-Type', f.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="bericht-${b.id}-${f.id}.${Bild.ENDUNG[f.mime]}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.send(daten);
  });
};

module.exports.fotoSpeichern = fotoSpeichern;
module.exports.fotosJson = fotosJson;
module.exports.fotoJson = fotoJson;
module.exports.ordner = ordner;
module.exports.berichtGeaendert = berichtGeaendert;
module.exports.berichtVersion = berichtVersion;
