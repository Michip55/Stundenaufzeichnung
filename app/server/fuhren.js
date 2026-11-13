'use strict';
/**
 * Fuhraufträge (API.md 12.8b): LKW-Fuhrplan, Koordinaten aus Maps-Links (ohne Abruf), mapsLink,
 * Übernahme erledigter Fuhren in den Bautagesbericht (genau einmal). Keine €-Felder.
 */
const { ungueltig } = require('./fehler');
const { benachrichtige } = require('./budget');

const r3 = (x) => Math.round((x + Number.EPSILON) * 1000) / 1000;

/** lat/lon aus Google-Maps-Link oder Text („47.62, 16.05“) – ruft nie etwas ab */
function koordinatenAus(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  let t = text.trim();
  try { t = decodeURIComponent(t); } catch (_) { /* roh */ }
  const zahl = '(-?\\d{1,3}(?:\\.\\d+)?)';
  const muster = [
    new RegExp(`@${zahl},${zahl}`), new RegExp(`[?&](?:q|ll|query|destination|daddr|center)=${zahl},\\s*${zahl}`),
    new RegExp(`!3d${zahl}!4d${zahl}`), new RegExp(`^${zahl}\\s*[,;]\\s*${zahl}$`)
  ];
  for (const re of muster) {
    const m = re.exec(t);
    if (m) {
      const lat = Number(m[1]), lon = Number(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
      return { ungueltig: true };
    }
  }
  return null;
}

function ziel(o) {
  return o.lat != null && o.lon != null ? `${o.lat},${o.lon}` : encodeURIComponent(o.text || '');
}
function mapsLink(nach, von) {
  return `https://www.google.com/maps/dir/?api=1${von ? `&origin=${ziel(von)}` : ''}&destination=${ziel(nach)}`;
}

/**
 * Halt prüfen (von/nach). art grube|baustelle|adresse.
 */
function haltPruefen(db, roh, feld, erlaubt, standard) {
  if (roh === undefined || roh === null) return standard;
  if (typeof roh !== 'object' || Array.isArray(roh)) throw ungueltig(`${feld} muss ein Objekt sein.`);
  const art = roh.art || (roh.baustelleId ? 'baustelle' : 'adresse');
  if (!erlaubt.includes(art)) throw ungueltig(`${feld}.art muss ${erlaubt.join('|')} sein.`);
  const o = { art };
  if (art === 'baustelle') {
    const bs = db.eins('SELECT id, kst, name, kurz, adresse, lat, lng FROM baustelle WHERE id = ?', Number(roh.baustelleId));
    if (!bs) throw ungueltig(`${feld}.baustelleId: Baustelle nicht gefunden.`);
    o.baustelleId = bs.id;
    o.text = roh.text ? String(roh.text).slice(0, 200) : `${bs.kurz || bs.name}${bs.adresse ? `, ${bs.adresse}` : ''}`;
    if (bs.lat != null && bs.lng != null) { o.lat = bs.lat; o.lon = bs.lng; }
  } else {
    o.text = String(roh.text || (standard && standard.text) || '').slice(0, 200);
    if (art === 'grube' && standard && standard.lat != null) { o.lat = standard.lat; o.lon = standard.lon; }
  }
  // Koordinaten: lat/lon, Link oder Text mit Koordinaten
  const k = roh.lat != null && roh.lon != null ? { lat: Number(roh.lat), lon: Number(roh.lon) } : koordinatenAus(roh.link) || (art === 'adresse' ? koordinatenAus(roh.text) : null);
  if (k && (k.ungueltig || !Number.isFinite(k.lat) || !Number.isFinite(k.lon) || Math.abs(k.lat) > 90 || Math.abs(k.lon) > 180)) throw ungueltig(`${feld}: Koordinaten außerhalb des gültigen Bereichs.`);
  if (k) { o.lat = Math.round(k.lat * 1e6) / 1e6; o.lon = Math.round(k.lon * 1e6) / 1e6; }
  if (!o.text) o.text = o.lat != null ? `${o.lat}, ${o.lon}` : '';
  if (!o.text) throw ungueltig(`${feld}.text fehlt.`);
  if (roh.abladestelle !== undefined && feld === 'nach') o.abladestelle = roh.abladestelle == null ? null : String(roh.abladestelle).slice(0, 200);
  return o;
}

function fuhreJson(db, f, K) {
  const von = JSON.parse(f.von), nach = JSON.parse(f.nach);
  const pers = f.fahrer_id ? (K ? K.personen.get(f.fahrer_id) : db.eins('SELECT name FROM benutzer WHERE id = ?', f.fahrer_id)) : null;
  const m = f.material_id ? db.eins('SELECT id, code, name, einheit FROM material WHERE id = ?', f.material_id) : null;
  const A = K ? require('./planer').anlageStatus(K, f.anlage_id) : (() => { const a = db.eins('SELECT id, nummer, bezeichnung, kennzeichen FROM anlage WHERE id = ?', f.anlage_id); return a ? { anlageId: a.id, nummer: a.nummer, bezeichnung: a.bezeichnung, kennzeichen: a.kennzeichen } : null; })();
  const erl = f.erledigt ? JSON.parse(f.erledigt) : null;
  return {
    id: f.id, datum: f.datum, anlageId: f.anlage_id,
    anlage: A ? { id: A.anlageId, nummer: A.nummer, bezeichnung: A.bezeichnung, kennzeichen: A.kennzeichen, status: A.status, gesperrt: A.gesperrt } : null,
    fahrer: f.fahrer_id ? { benutzerId: f.fahrer_id, name: pers ? pers.name : '?' } : null,
    reihenfolge: f.reihenfolge, beginn: f.beginn, materialId: f.material_id, material: m ? { id: m.id, code: m.code, name: m.name } : null, materialText: f.material_text || '',
    menge: f.menge, einheit: f.einheit, anzahlFuhren: f.anzahl_fuhren,
    von: { ...von, mapsLink: mapsLink(von) }, nach: { ...nach, mapsLink: mapsLink(nach) }, mapsLink: mapsLink(nach, von),
    notiz: f.notiz || '', status: f.status, erledigt: erl,
    berichtZeile: f.bericht_status ? { ...(f.bericht_id ? { berichtId: f.bericht_id } : {}), status: f.bericht_status, ...(f.bericht_hinweis ? { hinweis: f.bericht_hinweis } : {}) } : null,
    veroeffentlicht: Boolean(f.veroeffentlicht_zeit),
    version: f.version
  };
}

/** Inhalt, der für die Veröffentlichung zählt (ohne Status/Erledigung) */
function fuhreHash(st) {
  const { hash } = require('./planer');
  return hash([st.datum, st.anlageId, st.fahrer && st.fahrer.benutzerId, st.reihenfolge, st.beginn, st.materialId, st.materialText, st.menge, st.einheit, st.anzahlFuhren, st.von, st.nach, st.notiz]);
}

/** Fahrer-Sicht (Mein Einsatz) – ohne Status (der wird beim Abruf aktuell ergänzt) */
function fuhreFuerFahrer(f) {
  return {
    id: f.id, reihenfolge: f.reihenfolge, beginn: f.beginn, material: f.material ? f.material.name : f.materialText, menge: f.menge, einheit: f.einheit,
    anzahlFuhren: f.anzahlFuhren, von: f.von, nach: f.nach, mapsLink: f.mapsLink, notiz: f.notiz,
    anlage: f.anlage ? { bezeichnung: f.anlage.bezeichnung, kennzeichen: f.anlage.kennzeichen } : null
  };
}

/**
 * Erledigte Fuhre → Materialzeile im Bericht (genau einmal). Setzt bericht_status.
 */
function inBericht(bt, f, benutzerId) {
  const { db } = bt;
  if (f.bericht_status) return; // schon verarbeitet
  const nach = JSON.parse(f.nach);
  if (nach.art !== 'baustelle' || !nach.baustelleId) return;
  const erl = JSON.parse(f.erledigt || '{}');
  const zeit = bt.uhr().toISOString();
  const pruefen = (hinweis) => {
    db.lauf("UPDATE plan_fuhre SET bericht_status = 'pruefen', bericht_hinweis = ? WHERE id = ?", hinweis, f.id);
    for (const b of db.alle("SELECT id FROM benutzer WHERE aktiv = 1 AND rolle = 'buero'")) {
      benachrichtige(db, { benutzerId: b.id, typ: 'plan', titel: 'Fuhre prüfen: Menge nicht übernommen', text: `Fuhre ${f.id} (${f.datum.split('-').reverse().join('.')}): ${hinweis}`, zeit, baustelleId: nach.baustelleId, schluessel: `fuhre:pruefen:${f.id}` });
    }
  };
  if (!f.material_id) return pruefen('Material ist nicht aus dem Katalog – bitte im Bericht von Hand eintragen.');
  const m = db.eins('SELECT * FROM material WHERE id = ?', f.material_id);
  const einheitM = String(m.einheit).toLowerCase().replace('³', '3').replace(/^to$/, 't');
  let menge = Number(erl.menge != null ? erl.menge : f.menge);
  const einheitF = erl.einheit || f.einheit;
  if (einheitF === 'fuhren') return pruefen('Menge in Fuhren gemeldet – bitte Tonnen/m³ eintragen.');
  if (einheitF !== einheitM) {
    if (einheitF === 'm3' && einheitM === 't' && m.dichte) menge = r3(menge * m.dichte);
    else if (einheitF === 't' && einheitM === 'm3' && m.dichte) menge = r3(menge / m.dichte);
    else return pruefen(`Einheit ${einheitF} passt nicht zu ${m.name} (${m.einheit}) und keine Dichte hinterlegt.`);
  }
  const b = db.eins('SELECT id, status FROM bericht WHERE baustelle_id = ? AND datum = ?', nach.baustelleId, f.datum);
  const offen = b && b.status === 'entwurf' && !db.eins('SELECT 1 AS x FROM unterschrift WHERE bericht_id = ?', b.id);
  if (offen) {
    zeileHinzufuegen(db, b.id, f.material_id, menge);
    db.lauf("UPDATE plan_fuhre SET bericht_status = 'uebernommen', bericht_id = ?, bericht_menge = ? WHERE id = ?", b.id, menge, f.id);
    require('./routes/berichte').berichtGeaendert(db, b.id, zeit); // G-02: Version +1 und Fern-Links ungültig
    db.protokolliere({ zeit, benutzerId, art: 'bericht', objekt: `bericht:${b.id}`, neu: { fuhreId: f.id, materialId: f.material_id, menge }, text: `Fuhre ${f.id}: ${menge} ${m.einheit} ${m.name} in den Bericht übernommen (Quelle Fuhre)` });
  } else {
    db.lauf("UPDATE plan_fuhre SET bericht_status = 'vorschlag', bericht_id = ?, bericht_menge = ? WHERE id = ?", b ? b.id : null, menge, f.id);
  }
}

function zeileHinzufuegen(db, berichtId, materialId, menge) {
  const z = db.eins('SELECT menge FROM bericht_material WHERE bericht_id = ? AND material_id = ?', berichtId, materialId);
  if (z) db.lauf('UPDATE bericht_material SET menge = ? WHERE bericht_id = ? AND material_id = ?', r3(z.menge + menge), berichtId, materialId);
  else db.lauf('INSERT INTO bericht_material (bericht_id, material_id, menge) VALUES (?, ?, ?)', berichtId, materialId, menge);
}

/** Vorschläge (Fuhren) für einen Bericht */
function vorschlaegeFuer(db, b) {
  return db.alle(`SELECT f.*, m.name AS mname, m.einheit AS meinheit, u.name AS fname FROM plan_fuhre f LEFT JOIN material m ON m.id = f.material_id LEFT JOIN benutzer u ON u.id = f.fahrer_id
    WHERE f.datum = ? AND f.bericht_status = 'vorschlag' AND json_extract(f.nach, '$.baustelleId') = ?`, b.datum, b.baustelle_id)
    .map((f) => ({ fuhreId: f.id, materialId: f.material_id, name: f.mname, menge: f.bericht_menge, einheit: f.meinheit, fahrer: f.fname || null, zeit: (JSON.parse(f.erledigt || '{}')).zeit || null }));
}

module.exports = { koordinatenAus, mapsLink, haltPruefen, fuhreJson, fuhreHash, fuhreFuerFahrer, inBericht, zeileHinzufuegen, vorschlaegeFuer };
