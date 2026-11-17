'use strict';
/**
 * Arbeitszeitmodelle und BUAK-Pflicht je Person (API.md 15.23, Inhaber 17.11.2026).
 *
 * Modell (Tabelle `arbeitszeitmodell`): Name, Wochenstunden, Normalstunden je Wochentag (Mo–So), Überstunden-Regel
 * `tag_oder_woche` (größere von Σ Tagesüberschreitungen und Wochenüberschreitung – KV Bau, bisherige Regel) oder `woche`
 * (nur Wochenüberschreitung) und – für Teilzeit – optional Vollzeit-Wochenstunden: Stunden über den Wochenstunden des
 * Modells bis zur Vollzeit sind MEHRSTUNDEN (eigene Lohnart), darüber Überstunden.
 *
 * Zuordnung je Person stichtaggenau in `benutzer_arbeitszeitmodell` (Muster wie Lohngruppe 12.22): gültig an Tag D ist der
 * Eintrag mit dem größten gueltig_ab ≤ D (bei gleichem Datum der jüngste). Ohne Einträge gilt seit BASIS die Vorgabe nach
 * der Rolle der Person (Datenvorgabe, keine Rechteentscheidung): Mitarbeiter/Polier → „Bau-Arbeiter (KV Bau)“ (id 1),
 * alle anderen → „Büro (Mo–Do 8,5 · Fr 5)“ (id 2). Bei einem Rollenwechsel wird die bisherige Vorgabe als Basisstand
 * festgeschrieben – ein Rollenwechsel ändert nie rückwirkend das Modell.
 *
 * BUAK-Pflicht: `benutzer.buak_pflichtig` (1/0); NULL = Vorgabe nach der Rolle (Mitarbeiter/Polier ja, sonst nein).
 */
const { ungueltig, konflikt, ApiFehler } = require('./fehler');
const { plusTage, wochentag, wochenbeginn, feiertag } = require('./datum');

const BASIS = '2000-01-01';
const VORGABE = { feld: 1, sonst: 2 };
const FELD_ROLLEN = ['mitarbeiter', 'polier'];
const REGELN = ['tag_oder_woche', 'woche'];
/** Schlüssel der Wochentage in der API (Mo–So) → Index in tagNormal (0 = Sonntag, wie datum.wochentag) */
const TAGE = [['mo', 1], ['di', 2], ['mi', 3], ['do', 4], ['fr', 5], ['sa', 6], ['so', 0]];
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

const istFeldrolle = (rolle) => FELD_ROLLEN.includes(rolle);
const vorgabeId = (rolle) => (istFeldrolle(rolle) ? VORGABE.feld : VORGABE.sonst);
const istVorgabe = (id) => id === VORGABE.feld || id === VORGABE.sonst;

/** Zeile → Rechenmodell {id, name, wochenstunden, tagNormal[7], regel, vollzeit, aktiv} */
function ausZeile(z) {
  let t;
  try { t = JSON.parse(z.tag_normal); } catch (_) { t = null; }
  if (!Array.isArray(t) || t.length !== 7) t = [0, 8, 8, 8, 8, 7, 0];
  return { id: z.id, name: z.name, wochenstunden: z.wochenstunden, tagNormal: t.map((x) => Number(x) || 0), regel: REGELN.includes(z.regel) ? z.regel : 'tag_oder_woche', vollzeit: z.vollzeit ?? null, aktiv: z.aktiv === 1, version: z.version, sortierung: z.sortierung };
}

/** Alle Modelle als Map id → Rechenmodell */
function modelle(db) {
  return new Map(db.alle('SELECT * FROM arbeitszeitmodell ORDER BY sortierung, name').map((z) => [z.id, ausZeile(z)]));
}

/** Ersatz, falls ein Modell fehlt (nie erwartet): bisherige Regel aus der Einstellung 'arbeitszeit' */
function ersatzModell(db) {
  const c = db.einstellung('arbeitszeit', null);
  const t = c && Array.isArray(c.tagNormal) && c.tagNormal.length === 7 ? c.tagNormal : [0, 8, 8, 8, 8, 7, 0];
  return { id: null, name: 'Standard', wochenstunden: t.reduce((a, x) => a + x, 0), tagNormal: t, regel: 'tag_oder_woche', vollzeit: null, aktiv: true };
}

/** Verlauf roh (aufsteigend); ohne Einträge ein Basisstand nach der Rolle (id null) */
function verlaufRoh(db, benutzerId) {
  const z = db.alle('SELECT * FROM benutzer_arbeitszeitmodell WHERE benutzer_id = ? ORDER BY gueltig_ab, id', benutzerId);
  if (z.length) return z;
  const b = db.eins('SELECT rolle FROM benutzer WHERE id = ?', benutzerId);
  return b ? [{ id: null, benutzer_id: benutzerId, modell_id: vorgabeId(b.rolle), gueltig_ab: BASIS, erstellt: null, erstellt_von: null, vorgabe: true }] : [];
}

/** Funktion datum → Modell-ID für eine Person */
function idAchse(db, benutzerId) {
  const z = verlaufRoh(db, benutzerId);
  return (d) => {
    let m = null;
    for (const x of z) { if (x.gueltig_ab <= d) m = x.modell_id; else break; }
    return m;
  };
}

/** Funktion datum → Rechenmodell für eine Person (für Schleifen über Tage) */
function zeitachse(db, benutzerId, alle = modelle(db)) {
  const ids = idAchse(db, benutzerId);
  const ersatz = ersatzModell(db);
  return (d) => alle.get(ids(d)) || alle.get(VORGABE.feld) || ersatz;
}

const modellIdAm = (db, benutzerId, d) => idAchse(db, benutzerId)(d);

/** Normalstunden eines Tages nach Modell (Feiertag → 0, wie bisher) */
const tagSoll = (m, datum) => (feiertag(datum) ? 0 : m.tagNormal[wochentag(datum)] || 0);

/**
 * Mehr- und Überstunden eines Abschnitts (Tage einer Kalenderwoche mit DEMSELBEN Modell, ggf. nur ein Teil der Woche):
 *  Soll = Σ Normalstunden der Tage (Feiertag 0). Überschreitung E:
 *   tag_oder_woche: max(Σ max(0, Std − Tagessoll), Σ Std − Soll, 0)   (bisherige Regel, KV Bau)
 *   woche:          max(Σ Std − Soll, 0)
 *  Teilzeit mit Vollzeit V > Wochenstunden W: die ersten Soll × (V/W − 1) Stunden von E sind Mehrstunden, der Rest
 *  Überstunden (bei einer vollen Woche ohne Feiertag genau V − W).
 * @returns {{ueberstunden:number, mehrstunden:number, soll:number}}
 */
function abschnitt(tage, m) {
  let taeglich = 0, summe = 0, soll = 0;
  for (const t of tage) {
    const n = tagSoll(m, t.datum);
    taeglich += Math.max(0, (t.stunden || 0) - n);
    summe += t.stunden || 0;
    soll += n;
  }
  const woche = summe - soll;
  const e = Math.max(m.regel === 'woche' ? 0 : taeglich, woche, 0);
  const band = m.vollzeit && m.wochenstunden > 0 && m.vollzeit > m.wochenstunden ? soll * (m.vollzeit / m.wochenstunden - 1) : 0;
  const mehr = Math.min(e, Math.max(0, band));
  return { ueberstunden: r2(e - mehr), mehrstunden: r2(mehr), soll: r2(soll) };
}

/**
 * Mehr-/Überstunden über beliebige Tage: je Kalenderwoche (Mo–So) und darin je Abschnitt gleichen Modells.
 * Wechselt das Modell mitten in der Woche, rechnet jeder Abschnitt mit seinem Modell und seinen Tagen (Soll = Σ der
 * Tagessoll-Stunden des Abschnitts); die Wochensummen werden also nicht über den Wechsel hinweg verrechnet.
 * @param {Array<{datum:string, stunden:number}>} tage
 * @param {(d:string)=>object} modellAm
 */
function zeitraum(tage, modellAm) {
  const sortiert = [...tage].sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0));
  let u = 0, mehr = 0, soll = 0;
  let akt = null;
  const ab = () => { if (!akt) return; const x = abschnitt(akt.tage, akt.m); u += x.ueberstunden; mehr += x.mehrstunden; soll += x.soll; akt = null; };
  for (const t of sortiert) {
    const m = modellAm(t.datum);
    const w = wochenbeginn(t.datum);
    if (!akt || akt.w !== w || akt.m !== m) { ab(); akt = { w, m, tage: [] }; }
    akt.tage.push(t);
  }
  ab();
  return { ueberstunden: r2(u), mehrstunden: r2(mehr), soll: r2(soll) };
}

/** Abschnitte gleichen Modells über aufeinanderfolgende Tage (für Anzeige/Export) */
function abschnitteUeberTage(daten, modellAm, stundenAm) {
  const out = [];
  for (const d of daten) {
    const m = modellAm(d);
    const l = out[out.length - 1];
    if (l && l.id === m.id) { l.bis = d; l.stunden += stundenAm(d); } else out.push({ id: m.id, name: m.name, von: d, bis: d, stunden: stundenAm(d) });
  }
  return out.map((a) => ({ ...a, stunden: r2(a.stunden) }));
}

/* ------------------------------------------------------------ BUAK-Pflicht */

/** Effektive BUAK-Pflicht einer Person (Zeile mit rolle, buak_pflichtig) */
function buakPflichtig(b) {
  if (!b) return false;
  if (b.buak_pflichtig === 1 || b.buak_pflichtig === 0) return b.buak_pflichtig === 1;
  return istFeldrolle(b.rolle);
}
/** wie buakPflichtig, lädt die Zeile bei Bedarf */
function buakPflichtigVon(db, b) {
  if (b && b.buak_pflichtig !== undefined && b.rolle !== undefined) return buakPflichtig(b);
  return buakPflichtig(db.eins('SELECT rolle, buak_pflichtig FROM benutzer WHERE id = ?', typeof b === 'object' ? b.id : b));
}

/* ------------------------------------------------------------ Prüfung, JSON */

/** Anzahl Personen, denen das Modell (je) zugeordnet ist – auch über die Vorgabe nach der Rolle */
function verwendung(db, id) {
  const explizit = db.alle('SELECT DISTINCT benutzer_id AS b FROM benutzer_arbeitszeitmodell WHERE modell_id = ?', id).map((x) => x.b);
  const ohne = db.alle('SELECT id, rolle FROM benutzer WHERE id NOT IN (SELECT benutzer_id FROM benutzer_arbeitszeitmodell)').filter((b) => vorgabeId(b.rolle) === id).map((b) => b.id);
  return new Set([...explizit, ...ohne]).size;
}

function json(db, z, { mitVerwendung = true } = {}) {
  const m = ausZeile(z);
  const stunden = Object.fromEntries(TAGE.map(([k, i]) => [k, m.tagNormal[i]]));
  return {
    id: m.id, name: m.name, wochenstunden: m.wochenstunden, stunden, regel: m.regel, vollzeitWochenstunden: m.vollzeit,
    aktiv: m.aktiv, version: m.version, vorgabe: m.id === VORGABE.feld ? 'feld' : m.id === VORGABE.sonst ? 'sonst' : null,
    ...(mitVerwendung ? { personen: verwendung(db, m.id) } : {})
  };
}

/** Eingabe eines Modells prüfen → Spalten (teil = PUT: nur gegebene Felder) */
function pruefe(body, alt = null) {
  const v = require('./validierung');
  const f = {};
  const teil = Boolean(alt);
  if (!teil || body.name !== undefined) {
    const n = v.text(body.name, 'name', { max: 80 });
    if (n.trim().length < 2) throw ungueltig('name: mindestens 2 Zeichen.');
    f.name = n.trim();
  }
  if (!teil || body.wochenstunden !== undefined) f.wochenstunden = r2(v.zahl(body.wochenstunden, 'wochenstunden', { min: 1, max: 60 }));
  if (!teil || body.stunden !== undefined) {
    const s = v.objekt(body.stunden, 'stunden');
    for (const k of Object.keys(s)) if (!TAGE.some(([x]) => x === k)) throw ungueltig(`stunden.${k} ist unbekannt (mo, di, mi, do, fr, sa, so).`);
    const t = [0, 0, 0, 0, 0, 0, 0];
    for (const [k, i] of TAGE) t[i] = r2(v.zahl(s[k] ?? 0, `stunden.${k}`, { min: 0, max: 12 }));
    f.tag_normal = JSON.stringify(t);
  }
  if (!teil || body.regel !== undefined) f.regel = v.auswahl(body.regel, 'regel', REGELN);
  if (body.vollzeitWochenstunden !== undefined) f.vollzeit = body.vollzeitWochenstunden === null || body.vollzeitWochenstunden === '' ? null : r2(v.zahl(body.vollzeitWochenstunden, 'vollzeitWochenstunden', { min: 1, max: 60 }));
  else if (!teil) f.vollzeit = null;
  // Gesamtprüfung mit dem bisherigen Stand
  const w = f.wochenstunden ?? (alt && alt.wochenstunden);
  const tage = JSON.parse(f.tag_normal ?? alt.tag_normal);
  const summe = r2(tage.reduce((a, x) => a + x, 0));
  if (Math.abs(summe - w) > 0.011) throw ungueltig(`Die Normalstunden der Wochentage ergeben ${String(summe).replace('.', ',')} Std. – sie müssen zusammen die Wochenstunden (${String(w).replace('.', ',')} Std.) ergeben.`);
  const vz = f.vollzeit !== undefined ? f.vollzeit : alt ? alt.vollzeit : null;
  if (vz != null && vz <= w) throw ungueltig('vollzeitWochenstunden: nur bei Teilzeit – muss größer als die Wochenstunden des Modells sein (leer lassen bei Vollzeit).');
  if (body.aktiv !== undefined) f.aktiv = v.bool(body.aktiv, 'aktiv') ? 1 : 0;
  return f;
}
/** Felder, deren Änderung bereits gerechnete Tage verändert */
const RECHENFELDER = ['wochenstunden', 'tag_normal', 'regel', 'vollzeit'];

/** gueltigAb der Zuordnung prüfen (Standard heute; rückwirkend nur mit Bestätigung) */
function pruefeGueltigAb(gueltigAb, rueckwirkend, heute) {
  const d = gueltigAb === undefined || gueltigAb === null || gueltigAb === '' ? heute : gueltigAb;
  const { istDatum } = require('./datum');
  if (typeof d !== 'string' || !istDatum(d)) throw ungueltig('arbeitszeitmodellGueltigAb muss ein gültiges Datum JJJJ-MM-TT sein.');
  if (d > plusTage(heute, 731)) throw ungueltig('arbeitszeitmodellGueltigAb darf höchstens 2 Jahre in der Zukunft liegen.');
  if (d < heute && rueckwirkend !== true) {
    throw new ApiFehler(422, 'UNGUELTIG', `Das Arbeitszeitmodell soll rückwirkend ab ${d.split('-').reverse().join('.')} gelten – das ändert bereits gerechnete Tage (Überstunden, Monatsauswertung, Export für die Lohnverrechnung). Bitte bestätigen (arbeitszeitmodellRueckwirkend:true).`);
  }
  return d;
}

/** Modell für eine Zuordnung prüfen (bekannt und aktiv) → id */
function pruefeZuordnung(db, wert) {
  const v = require('./validierung');
  const id = v.id(wert, 'arbeitszeitmodell');
  const z = db.eins('SELECT id, aktiv FROM arbeitszeitmodell WHERE id = ?', id);
  if (!z) throw ungueltig('arbeitszeitmodell ist unbekannt.');
  if (z.aktiv !== 1) throw ungueltig('Das Arbeitszeitmodell ist deaktiviert.');
  return id;
}

/**
 * Basisstand festschreiben (vor einem Rollenwechsel oder der ersten Zuordnung): ohne Einträge gilt die Vorgabe der
 * bisherigen Rolle ab BASIS. Aufruf innerhalb einer Transaktion.
 */
function basisFestschreiben(db, benutzerId, rolle, zeit) {
  if (db.eins('SELECT 1 AS x FROM benutzer_arbeitszeitmodell WHERE benutzer_id = ? LIMIT 1', benutzerId)) return false;
  db.lauf('INSERT INTO benutzer_arbeitszeitmodell (benutzer_id, modell_id, gueltig_ab, erstellt, erstellt_von) VALUES (?, ?, ?, ?, NULL)', benutzerId, vorgabeId(rolle), BASIS, zeit);
  return true;
}

/** Zuordnung setzen (gleiches Datum ersetzt) → {alt, neu, gueltigAb, ersetzt, geaendert} – innerhalb einer Transaktion */
function setzen(db, { benutzerId, rolle, modellId, gueltigAb, von, zeit }) {
  const alt = modellIdAm(db, benutzerId, gueltigAb);
  const gleich = db.eins('SELECT * FROM benutzer_arbeitszeitmodell WHERE benutzer_id = ? AND gueltig_ab = ? ORDER BY id DESC LIMIT 1', benutzerId, gueltigAb);
  if (!gleich && alt === modellId) return { alt, neu: modellId, gueltigAb, geaendert: false };
  basisFestschreiben(db, benutzerId, rolle, zeit);
  const gleich2 = db.eins('SELECT * FROM benutzer_arbeitszeitmodell WHERE benutzer_id = ? AND gueltig_ab = ? ORDER BY id DESC LIMIT 1', benutzerId, gueltigAb);
  if (gleich2) db.lauf('UPDATE benutzer_arbeitszeitmodell SET modell_id = ?, erstellt = ?, erstellt_von = ? WHERE id = ?', modellId, zeit, von, gleich2.id);
  else db.lauf('INSERT INTO benutzer_arbeitszeitmodell (benutzer_id, modell_id, gueltig_ab, erstellt, erstellt_von) VALUES (?, ?, ?, ?, ?)', benutzerId, modellId, gueltigAb, zeit, von);
  return { alt, neu: modellId, gueltigAb, ersetzt: gleich2 ? gleich2.modell_id : undefined, geaendert: true };
}

/** Verlauf als JSON */
function verlaufJson(db, benutzerId, heute) {
  const z = verlaufRoh(db, benutzerId);
  const namen = new Map(db.alle('SELECT id, name FROM arbeitszeitmodell').map((x) => [x.id, x.name]));
  const pers = new Map(db.alle('SELECT id, name FROM benutzer').map((x) => [x.id, x.name]));
  let aktuellIdx = -1;
  z.forEach((x, i) => { if (x.gueltig_ab <= heute) aktuellIdx = i; });
  return z.map((x, i) => ({
    id: x.id, arbeitszeitmodellId: x.modell_id, name: namen.get(x.modell_id) || null, gueltigAb: x.gueltig_ab,
    erstellt: x.erstellt, erstelltVon: x.erstellt_von ? { id: x.erstellt_von, name: pers.get(x.erstellt_von) || '?' } : null,
    aktuell: i === aktuellIdx, kuenftig: x.gueltig_ab > heute, ...(x.vorgabe ? { vorgabe: true } : {})
  }));
}

/** Löschen eines Modells: nur unbenutzt und nicht Vorgabe */
function pruefeLoeschen(db, z) {
  if (istVorgabe(z.id)) throw konflikt(`„${z.name}“ ist die Vorgabe für ${z.id === VORGABE.feld ? 'Mitarbeiter und Poliere' : 'alle anderen Rollen'} und kann nicht gelöscht werden.`, { verwendet: { personen: verwendung(db, z.id) } });
  const n = verwendung(db, z.id);
  if (n > 0) throw konflikt(`„${z.name}“ ist ${n} Person${n === 1 ? '' : 'en'} zugeordnet (auch früher) und kann nicht gelöscht werden – stattdessen deaktivieren.`, { verwendet: { personen: n } });
}

module.exports = {
  BASIS, VORGABE, FELD_ROLLEN, REGELN, TAGE, RECHENFELDER, istFeldrolle, vorgabeId, istVorgabe, ausZeile, modelle, ersatzModell,
  verlaufRoh, idAchse, zeitachse, modellIdAm, tagSoll, abschnitt, zeitraum, abschnitteUeberTage, buakPflichtig, buakPflichtigVon,
  verwendung, json, pruefe, pruefeGueltigAb, pruefeZuordnung, basisFestschreiben, setzen, verlaufJson, pruefeLoeschen
};
