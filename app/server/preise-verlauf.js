'use strict';
/**
 * Preise mit „gültig ab“ (API.md 12.2, löst M-08).
 *
 * Jede Preisänderung ist ein Stand (Tabelle `preis_stand`: art, ref, feld, wert, gueltig_ab). Gibt es für
 * einen Preis noch keinen Stand, gilt der Wert der Stammtabelle seit 2000-01-01. Die Spalte in der
 * Stammtabelle (z. B. geraet.kostensatz) zeigt immer den **heute** gültigen Wert (Abgleich beim Start,
 * stündlich und nach jeder Änderung) – Programmteile, die „den aktuellen Preis“ brauchen, lesen weiter dort.
 * Rechnungen über vergangene Tage verwenden `preisZeitachse(db).am(datum)` bzw. `epStaende`.
 */
const { ungueltig, konflikt, nichtGefunden } = require('./fehler');
const { wienDatum, plusTage, istDatum } = require('./datum');

const BASIS_DATUM = '2000-01-01';
/** art → Tabelle, Felder, ID ist Text? */
const ARTEN = {
  lohngruppen: { tabelle: 'lohngruppe', felder: ['kostensatz', 'regiesatz'], idText: true },
  geraete: { tabelle: 'geraet', felder: ['kostensatz', 'verrechnungssatz'] },
  materialien: { tabelle: 'material', felder: ['ek', 'vk'] },
  leistungen: { tabelle: 'leistung', felder: ['ep'] },
  katalog: { tabelle: 'katalog', felder: ['ep'] },
  projektposition: { tabelle: 'projektposition', felder: ['ep'] }
};

const heuteVon = (db) => wienDatum(db.uhr ? db.uhr() : new Date());

/** Stände eines Preises aufsteigend; ohne Stände: synthetischer Basisstand aus der Stammtabelle */
function staende(db, art, ref, feld) {
  const z = db.alle('SELECT id, wert, gueltig_ab, erstellt, erstellt_von FROM preis_stand WHERE art = ? AND ref = ? AND feld = ? ORDER BY gueltig_ab', art, String(ref), feld);
  if (z.length) return z;
  const zeile = db.eins(`SELECT ${feld} AS w FROM ${ARTEN[art].tabelle} WHERE id = ?`, ref);
  return zeile ? [{ id: null, wert: zeile.w, gueltig_ab: BASIS_DATUM, erstellt: null, erstellt_von: null }] : [];
}

/** Wert am Datum aus einer aufsteigenden Liste [{gueltig_ab, wert}] */
function wertAm(liste, datum, fallback) {
  let w = fallback;
  for (const s of liste) { if (s.gueltig_ab <= datum) w = s.wert; else break; }
  return w;
}

/**
 * Prüft und normalisiert gueltigAb (Standard heute). Rückwirkend nur mit Bestätigung.
 * @returns {{gueltigAb:string, rueckwirkend:boolean}}
 */
function pruefeGueltigAb(db, gueltigAb, rueckwirkend) {
  const heute = heuteVon(db);
  const d = gueltigAb === undefined || gueltigAb === null || gueltigAb === '' ? heute : gueltigAb;
  if (!istDatum(d)) throw ungueltig('gueltigAb muss ein Datum JJJJ-MM-TT sein.');
  if (d < BASIS_DATUM) throw ungueltig('gueltigAb darf nicht vor dem 01.01.2000 liegen.');
  if (d > plusTage(heute, 731)) throw ungueltig('gueltigAb darf höchstens 2 Jahre in der Zukunft liegen.');
  const rw = d < heute;
  if (rw && rueckwirkend !== true) {
    throw ungueltig(`Der Preis soll rückwirkend ab ${d.split('-').reverse().join('.')} gelten – das ändert bereits gerechnete Tage. Bitte rückwirkend bestätigen (rueckwirkend:true).`);
  }
  return { gueltigAb: d, rueckwirkend: rw };
}

/**
 * Setzt einen Preis-Stand (gleiches Datum ersetzt). Legt beim ersten Stand den bisherigen Wert als
 * Basisstand seit 2000-01-01 an. Gleicht danach die Stammtabelle mit dem heute gültigen Wert ab.
 * @returns {{alt:number, neu:number, gueltigAb:string, heute:number}}
 */
function setzePreis(db, { art, ref, feld, wert, gueltigAb, benutzerId = null, jetzt = new Date() }) {
  const def = ARTEN[art];
  if (!def || !def.felder.includes(feld)) throw ungueltig(`Unbekannter Preis ${art}.${feld}.`);
  const zeile = db.eins(`SELECT ${feld} AS w FROM ${def.tabelle} WHERE id = ?`, ref);
  if (!zeile) throw nichtGefunden('Eintrag nicht gefunden.');
  const t = jetzt.toISOString();
  const r = String(ref);
  const vorhanden = db.eins('SELECT COUNT(*) AS n FROM preis_stand WHERE art = ? AND ref = ? AND feld = ?', art, r, feld).n;
  const vorher = wertAm(staende(db, art, ref, feld), gueltigAb, zeile.w);
  if (!vorhanden && gueltigAb > BASIS_DATUM) {
    db.lauf('INSERT INTO preis_stand (art, ref, feld, wert, gueltig_ab, erstellt, erstellt_von) VALUES (?, ?, ?, ?, ?, ?, NULL)', art, r, feld, zeile.w, BASIS_DATUM, t);
  }
  db.lauf(`INSERT INTO preis_stand (art, ref, feld, wert, gueltig_ab, erstellt, erstellt_von) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(art, ref, feld, gueltig_ab) DO UPDATE SET wert = excluded.wert, erstellt = excluded.erstellt, erstellt_von = excluded.erstellt_von`,
  art, r, feld, wert, gueltigAb, t, benutzerId);
  const heute = abgleichen(db, { art, ref: r, feld });
  return { alt: vorher, neu: wert, gueltigAb, heute };
}

/** Künftigen Stand löschen (nur gueltig_ab > heute) */
function loescheStand(db, { art, ref, feld = null, id }) {
  const s = db.eins('SELECT * FROM preis_stand WHERE id = ? AND art = ? AND ref = ?', id, art, String(ref));
  if (!s || (feld && s.feld !== feld)) throw nichtGefunden('Preis-Stand nicht gefunden.');
  if (s.gueltig_ab <= heuteVon(db)) throw konflikt('Nur künftige Preis-Stände können gelöscht werden. Für eine Korrektur einen neuen Stand anlegen.');
  db.lauf('DELETE FROM preis_stand WHERE id = ?', id);
  abgleichen(db, { art, ref: s.ref, feld: s.feld });
  return s;
}

/**
 * Stammtabellen mit dem heute gültigen Wert abgleichen (alle oder ein Preis).
 * @returns {number|undefined} heutiger Wert (bei Einzelabgleich)
 */
function abgleichen(db, nur = null) {
  const heute = heuteVon(db);
  const zeilen = nur
    ? db.alle('SELECT art, ref, feld, wert, gueltig_ab FROM preis_stand WHERE art = ? AND ref = ? AND feld = ? ORDER BY gueltig_ab', nur.art, String(nur.ref), nur.feld)
    : db.alle('SELECT art, ref, feld, wert, gueltig_ab FROM preis_stand ORDER BY art, ref, feld, gueltig_ab');
  const gruppen = new Map();
  for (const z of zeilen) {
    const k = `${z.art}|${z.ref}|${z.feld}`;
    if (!gruppen.has(k)) gruppen.set(k, []);
    gruppen.get(k).push(z);
  }
  let letzter;
  for (const liste of gruppen.values()) {
    const { art, ref, feld } = liste[0];
    const def = ARTEN[art];
    if (!def) continue;
    const w = wertAm(liste, heute, undefined);
    if (w === undefined) continue;
    db.lauf(`UPDATE ${def.tabelle} SET ${feld} = ? WHERE id = ? AND ${feld} IS NOT ?`, w, ref, w);
    letzter = w;
  }
  return letzter;
}

/** Künftige Stände je Eintrag → Map ref → [{id, feld, wert, gueltigAb}] */
function geplant(db, art) {
  const heute = heuteVon(db);
  const m = new Map();
  for (const z of db.alle('SELECT id, ref, feld, wert, gueltig_ab FROM preis_stand WHERE art = ? AND gueltig_ab > ? ORDER BY gueltig_ab', art, heute)) {
    if (!m.has(z.ref)) m.set(z.ref, []);
    m.get(z.ref).push({ id: z.id, feld: z.feld, wert: z.wert, gueltigAb: z.gueltig_ab });
  }
  return m;
}

/** gueltigAb des heute gültigen Werts je Feld → Map ref → {feld: datum} */
function gueltigSeit(db, art) {
  const heute = heuteVon(db);
  const m = new Map();
  for (const z of db.alle('SELECT ref, feld, MAX(gueltig_ab) AS ab FROM preis_stand WHERE art = ? AND gueltig_ab <= ? GROUP BY ref, feld', art, heute)) {
    if (!m.has(z.ref)) m.set(z.ref, {});
    m.get(z.ref)[z.feld] = z.ab;
  }
  return m;
}

/** Verlauf für die API */
function verlaufJson(db, art, ref) {
  const namen = new Map(db.alle('SELECT id, name FROM benutzer').map((b) => [b.id, b.name]));
  const out = [];
  for (const feld of ARTEN[art].felder) {
    for (const s of staende(db, art, ref, feld)) {
      out.push({ id: s.id, feld, wert: s.wert, gueltigAb: s.gueltig_ab, erstellt: s.erstellt, erstelltVon: s.erstellt_von ? { id: s.erstellt_von, name: namen.get(s.erstellt_von) || '?' } : null });
    }
  }
  return out;
}

/**
 * Preise der Stammtabellen je Datum (für interne Kosten). `heute` = Maps wie ladePreise;
 * `am(datum)` liefert dieselbe Struktur mit den am Datum gültigen Werten.
 */
function preisZeitachse(db, heute) {
  const nachArt = { lohngruppen: new Map(), geraete: new Map(), materialien: new Map(), leistungen: new Map() };
  for (const z of db.alle("SELECT art, ref, feld, wert, gueltig_ab FROM preis_stand WHERE art IN ('lohngruppen','geraete','materialien','leistungen') ORDER BY gueltig_ab")) {
    const m = nachArt[z.art];
    const k = `${z.ref}|${z.feld}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(z);
  }
  const leer = Object.values(nachArt).every((m) => m.size === 0);
  const cache = new Map();
  function am(datum) {
    if (leer || !datum) return heute;
    if (cache.has(datum)) return cache.get(datum);
    const o = {};
    for (const art of Object.keys(nachArt)) {
      const basis = heute[art];
      const st = nachArt[art];
      if (!st.size) { o[art] = basis; continue; }
      const neu = new Map();
      for (const [id, e] of basis) {
        let x = e;
        for (const feld of ARTEN[art].felder) {
          const liste = st.get(`${id}|${feld}`);
          if (!liste) continue;
          const w = wertAm(liste, datum, e[feld]);
          if (w !== x[feld]) x = { ...x, [feld]: w };
        }
        neu.set(id, x);
      }
      o[art] = neu;
    }
    cache.set(datum, o);
    return o;
  }
  return am;
}

/** EP-Stände von Projektpositionen einer Baustelle → Map positionId → [{gueltig_ab, wert, id}] (nur mit Ständen) */
function epStaendeBaustelle(db, baustelleId) {
  const m = new Map();
  for (const z of db.alle(`SELECT s.id, CAST(s.ref AS INTEGER) AS pid, s.wert, s.gueltig_ab FROM preis_stand s
      JOIN projektposition p ON p.id = CAST(s.ref AS INTEGER) WHERE s.art = 'projektposition' AND s.feld = 'ep' AND p.baustelle_id = ? ORDER BY s.gueltig_ab`, baustelleId)) {
    if (!m.has(z.pid)) m.set(z.pid, []);
    m.get(z.pid).push(z);
  }
  return m;
}

module.exports = {
  BASIS_DATUM, ARTEN, staende, wertAm, pruefeGueltigAb, setzePreis, loescheStand, abgleichen, geplant, gueltigSeit,
  verlaufJson, preisZeitachse, epStaendeBaustelle
};
