'use strict';
/**
 * Wertbasierte Prüfungen für die Rechte-Tests (F-022, F-023, F-037, F-040):
 *  - Geld-Kanarien: JEDE Preis-/Betragsspalte der Test-Datenbank trägt einen eindeutigen Kanarien-Betrag. Eine Antwort für
 *    Polier/Mitarbeiter darf keinen davon enthalten – egal unter welchem Schlüssel, in welchem Format (4711.37, 4711,37,
 *    4.711,37, 4 711,37, 4,711.37), gerundet (4711), abgeschnitten, auf eine Nachkommastelle (4711,4) oder in Cent (471137).
 *  - Abwesenheiten anderer: Person (benutzerId, id+Name, Name, benutzer.id, personId …) zusammen mit Abwesenheitswerten
 *    (K/U/ZA/BU/abwesend/abw./Urlaub/Krank/Zeitausgleich/Betriebsurlaub) – in JSON unter jedem Schlüssel, in Texten
 *    (PDF/CSV/XLSX) als Name in derselben Zeile bzw. in den folgenden PDF-Textstücken.
 */

/* ------------------------------------------------------------------ Preis-Spalten der Datenbank */

/** Spalten mit €-Bezug (jede Zeile bekommt einen Kanarien-Betrag) */
const PREIS_SPALTEN = {
  lohngruppe: ['kostensatz', 'regiesatz'],
  baustelle: ['auftragssumme'],
  fremdleistung: ['betrag'],
  nachtrag: ['betrag'],
  geraet: ['kostensatz', 'verrechnungssatz'],
  katalog: ['ep'],
  leistung: ['ep'],
  lv_import: ['summe'],
  lv_position: ['ep', 'gp'],
  material: ['ek', 'vk'],
  preis_stand: ['wert'],
  projektposition: ['ep'],
  rechnung: ['netto', 'ruecklass_betrag'],
  rechnung_zahlung: ['betrag', 'skonto'],
  servicebuch_eintrag: ['kosten'],
  budget_alarm: ['basis']
};
/** REAL-Spalten ohne €-Bezug – jede neue REAL-Spalte braucht eine Entscheidung (Abdeckungstest) */
const KEINE_PREIS_SPALTEN = {
  'baustelle.lat': 'Koordinate', 'baustelle.lng': 'Koordinate', 'bericht.seg_stunden': 'Stunden', 'bericht_geraet.stunden': 'Stunden',
  'bericht_material.menge': 'Menge', 'bericht_personal.stunden': 'Stunden', 'bericht_personal.seg_stunden': 'Stunden', 'bericht_regie.stunden': 'Stunden',
  'buchung.lat': 'Koordinate', 'buchung.lng': 'Koordinate', 'buchung.genauigkeit': 'GPS-Genauigkeit (m)',
  'budget_alarm.verbrauch': 'Prozent', 'budget_alarm.leistungsstand': 'Prozent', 'leistungsmeldung.menge': 'Menge', 'lv_position.menge': 'Menge',
  'material.dichte': 't/m³', 'plan_fuhre.menge': 'Menge', 'plan_fuhre.bericht_menge': 'Menge', 'projektposition_menge.menge': 'Menge',
  'rechnung.ust_satz': 'Prozent', 'rechnung.skonto_prozent': 'Prozent', 'rechnung.ruecklass_prozent': 'Prozent',
  'servicebuch_eintrag.arbeitsstunden_intern': 'Stunden', 'urlaub_konto.anspruch': 'Tage', 'urlaub_konto.uebertrag': 'Tage', 'urlaub_konto.buak_stand': 'Tage',
  'wetter_cache.lat': 'Koordinate', 'wetter_cache.lng': 'Koordinate', 'zaehler.startstand': 'Zählerstand', 'zaehler.versatz': 'Zählerstand',
  'zaehlerstand.anzeige': 'Zählerstand', 'zaehlerstand.wert': 'Zählerstand'
};

/** Alle REAL-Spalten ohne Entscheidung (leer = vollständig) */
function unentschiedeneSpalten(db) {
  const out = [];
  for (const { name } of db.alle("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")) {
    for (const c of db.alle(`PRAGMA table_info("${name}")`)) {
      if (!/REAL|NUM|DEC|FLOAT|DOUBLE/i.test(c.type || '')) continue;
      if ((PREIS_SPALTEN[name] || []).includes(c.name) || KEINE_PREIS_SPALTEN[`${name}.${c.name}`]) continue;
      out.push(`${name}.${c.name}`);
    }
  }
  return out;
}

/**
 * Setzt in jeder Preis-Spalte jeder Zeile einen eindeutigen Kanarien-Betrag (Werte, die schon Kanarien sind, bleiben).
 * Betrag k: 4 700 000 + 13·k + 0,37 – siebenstellig, kommt in Testdaten sonst nicht vor (Zählerstände < 1 Mio.).
 * @returns {{name:string, wert:number}[]}
 */
function pflanzeGeldKanarien(db, schonKanarien) {
  const behalten = new Set(schonKanarien.map((w) => Math.round(w * 100)));
  const liste = [];
  let k = 0;
  for (const [t, spalten] of Object.entries(PREIS_SPALTEN)) {
    for (const z of db.alle(`SELECT rowid AS rid, ${spalten.map((x) => `"${x}"`).join(', ')} FROM "${t}"`)) {
      for (const sp of spalten) {
        if (z[sp] !== null && behalten.has(Math.round(z[sp] * 100))) continue;
        const wert = Math.round((4700000 + 13 * k + 0.37) * 100) / 100;
        k++;
        db.lauf(`UPDATE "${t}" SET "${sp}" = ? WHERE rowid = ?`, wert, z.rid);
        liste.push({ name: `${t}.${sp}#${z.rid}`, wert });
      }
    }
  }
  // Haftrücklass (JSON-Text) der übrigen Baustellen
  for (const b of db.alle('SELECT id, haftruecklass FROM baustelle WHERE haftruecklass IS NOT NULL')) {
    let h; try { h = JSON.parse(b.haftruecklass); } catch (_) { continue; }
    if (!h || typeof h.betrag !== 'number' || behalten.has(Math.round(h.betrag * 100))) continue;
    const wert = Math.round((4700000 + 13 * k++ + 0.37) * 100) / 100;
    db.lauf('UPDATE baustelle SET haftruecklass = ? WHERE id = ?', JSON.stringify({ ...h, betrag: wert }), b.id);
    liste.push({ name: `baustelle.haftruecklass#${b.id}`, wert });
  }
  return liste;
}

/* ------------------------------------------------------------------ Zahlen in Texten finden */

/** Schlüssel eines Betrags für den Vergleich (exakt in Cent, gerundet, abgeschnitten, eine Nachkommastelle, Cent als Zahl) */
function betragSchluessel(w) {
  const cent = Math.round(w * 100);
  const s = [`c:${cent}`, `d:${Math.round(w * 10)}`, `i:${Math.round(w)}`, `i:${Math.trunc(w)}`, `i:${cent}`];
  return [...new Set(s)];
}

/** Index: Schlüssel → Name des Kanarienvogels */
function geldIndex(kanarien) {
  const m = new Map();
  for (const { name, wert } of kanarien) for (const s of betragSchluessel(wert)) if (!m.has(s)) m.set(s, name);
  return m;
}

// Zahl mit Tausendertrennung (Punkt, Komma, Apostroph, Leerzeichen, geschützte Leerzeichen) oder ohne
const ZAHL_GRUPPIERT = /(?<![\w.,])\d{1,3}(?:[.,'   ]\d{3})+(?:[.,]\d+)?(?![\w])/g;
const ZAHL_EINFACH = /(?<![\w])\d+(?:[.,]\d+)?(?![\w])/g;

/** Mögliche Zahlwerte eines Zahl-Texts (mehrdeutige Schreibweisen ergeben mehrere Werte) */
function werteAus(t) {
  const out = new Set();
  const n = t.replace(/[  ' ]/g, (x) => (x === ' ' || x === ' ' || x === ' ' || x === "'" ? '_' : x));
  const seps = [...n.matchAll(/[.,_]/g)].map((m) => m[0]);
  const ziffern = n.replace(/[.,_]/g, '');
  if (!seps.length) { out.add(Number(ziffern)); return [...out]; }
  const letzte = Math.max(n.lastIndexOf('.'), n.lastIndexOf(','), n.lastIndexOf('_'));
  const nach = n.slice(letzte + 1);
  const vor = n.slice(0, letzte).replace(/[.,_]/g, '');
  // letzte Trennung als Dezimalstelle
  if (n[letzte] !== '_') out.add(Number(`${vor}.${nach}`));
  // alle Trennungen als Tausender (nur wenn die letzte Gruppe dreistellig ist)
  if (nach.length === 3) out.add(Number(ziffern));
  return [...out].filter((x) => Number.isFinite(x));
}

/** Findet Geld-Kanarien in einem Text. @returns {{name, form, stelle}[]} */
function findeGeld(text, index) {
  if (!index || !index.size || !text) return [];
  const treffer = [];
  const gesehen = new Set();
  for (const re of [ZAHL_GRUPPIERT, ZAHL_EINFACH]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      for (const w of werteAus(m[0])) {
        const keys = [];
        if (Number.isInteger(w)) keys.push(`i:${w}`);
        if (Math.abs(w * 100 - Math.round(w * 100)) < 1e-4) keys.push(`c:${Math.round(w * 100)}`);
        if (Math.abs(w * 10 - Math.round(w * 10)) < 1e-4) keys.push(`d:${Math.round(w * 10)}`);
        for (const key of keys) {
          const name = index.get(key);
          if (name && !gesehen.has(`${name}|${m.index}`)) { gesehen.add(`${name}|${m.index}`); treffer.push({ name, form: m[0], stelle: m.index }); }
        }
      }
    }
  }
  return treffer;
}

/* ------------------------------------------------------------------ Abwesenheiten anderer */

const ABW_WERTE = new Set(['K', 'U', 'ZA', 'BU', 'abwesend', 'abw.', 'Krank', 'Urlaub', 'Zeitausgleich', 'Betriebsurlaub']);
const ABW_WORT = /\b(Urlaub\w*|Krank\w*|krank\w*|Zeitausgleich|abwesend|Betriebsurlaub)\b|\babw\./;
const ABW_KUERZEL_IM_TEXT = /\((K|U|ZA|BU)\)|:\s*(K|U|ZA|BU)\b/;

/** Personen-Kennung eines JSON-Objekts (oder undefined) */
function personVon(x, namen) {
  for (const k of ['benutzerId', 'personId', 'mitarbeiterId', 'uid', 'personenId']) if (Number.isInteger(x[k])) return x[k];
  if (Number.isInteger(x.person)) return x.person;
  if (x.benutzer && typeof x.benutzer === 'object' && Number.isInteger(x.benutzer.id)) return x.benutzer.id;
  if (typeof x.name === 'string' && namen.has(x.name)) return namen.get(x.name);
  return undefined;
}

/**
 * JSON: fremde Person + Abwesenheitswert unter beliebigem Schlüssel im selben Objekt (bis zum nächsten Personen-Objekt).
 * (Objekte ohne Kennung prüft scanne über EIGENE_PFADE.)
 * @param {{ich:number, namen:Map<string,number>, texte:string[]}} o
 */
function abwesenheitJson(daten, o, wo) {
  const v = [];
  const fremdeNamen = [...o.namen.entries()].filter(([, id]) => id !== o.ich).map(([n]) => n);
  const wertTreffer = (w) => typeof w === 'string' && (ABW_WERTE.has(w.trim()) || ABW_WORT.test(w) || o.texte.some((t) => w.includes(t)));
  const innen = (x, pfad, treffer) => {
    if (Array.isArray(x)) return x.forEach((e, i) => innen(e, `${pfad}[${i}]`, treffer));
    if (x && typeof x === 'object') {
      if (personVon(x, o.namen) !== undefined) return; // eigenes Personen-Objekt – wird für sich geprüft
      for (const [k, w] of Object.entries(x)) innen(w, `${pfad}.${k}`, treffer);
      return;
    }
    if (wertTreffer(x)) treffer.push(`${pfad}=${JSON.stringify(x).slice(0, 60)}`);
  };
  const lauf = (x, pfad) => {
    if (typeof x === 'string') {
      // Text mit Name einer anderen Person und einem Abwesenheitswort (z. B. „Urlaub ab 01.12.: Daniel Schwarz“)
      if ((ABW_WORT.test(x) || ABW_KUERZEL_IM_TEXT.test(x)) && fremdeNamen.some((n) => x.includes(n))) v.push(`${wo}: Abwesenheit einer anderen Person im Text „${x.slice(0, 100)}“ bei ${pfad}`);
      return;
    }
    if (Array.isArray(x)) return x.forEach((e, i) => lauf(e, `${pfad}[${i}]`));
    if (!x || typeof x !== 'object') return;
    const p = personVon(x, o.namen);
    if (p !== undefined && p !== o.ich) {
      const treffer = [];
      for (const [k, w] of Object.entries(x)) innen(w, `${pfad}.${k}`, treffer);
      if (treffer.length) v.push(`${wo}: Abwesenheitswert einer anderen Person (${p}) – ${treffer.slice(0, 3).join(', ')}`);
    }
    for (const [k, w] of Object.entries(x)) lauf(w, `${pfad}.${k}`);
  };
  lauf(daten, '$');
  return v;
}

/**
 * Text (PDF/CSV/XLSX/Text): Name einer anderen Person und Abwesenheitswert in derselben Zeile; bei PDFs (je Textstück
 * eine Zeile) auch in den folgenden 6 Stücken, solange kein anderer Name dazwischen steht.
 */
function abwesenheitText(text, o, wo, { fenster = 0 } = {}) {
  const v = [];
  const zeilen = String(text).split('\n');
  const alleNamen = [...o.namen.keys()];
  const fremd = alleNamen.filter((n) => o.namen.get(n) !== o.ich);
  const namensFormen = (n) => [n, require('../../server/pdf').winAnsi(n)];
  const treffer = (z) => {
    const t = z.trim();
    if (ABW_WERTE.has(t) || ABW_WORT.test(t) || ABW_KUERZEL_IM_TEXT.test(t) || o.texte.some((x) => t.includes(x))) return true;
    return t.split(/[;,|\t]/).map((x) => x.trim().replace(/^"|"$/g, '')).some((x) => ABW_WERTE.has(x));
  };
  // Firmenname (enthält z. B. den Namen der GF: „Michael Pichler Ges.m.b.H.“) ist keine Person
  for (const ig of o.ignorieren || []) for (let i = 0; i < zeilen.length; i++) zeilen[i] = zeilen[i].split(ig).join(' ');
  for (let i = 0; i < zeilen.length; i++) {
    const n = fremd.find((x) => namensFormen(x).some((f) => zeilen[i].includes(f)));
    if (!n) continue;
    const rest = namensFormen(n).reduce((z, f) => z.split(f).join(''), zeilen[i]);
    let fund = treffer(rest) ? zeilen[i] : null;
    for (let j = i + 1; !fund && j <= i + fenster && j < zeilen.length; j++) {
      if (alleNamen.some((x) => namensFormen(x).some((f) => zeilen[j].includes(f)))) break;
      if (treffer(zeilen[j])) fund = `${zeilen[i].trim()} … ${zeilen[j].trim()}`;
    }
    if (fund) v.push(`${wo}: Abwesenheit einer anderen Person (${n}) im Text „${fund.slice(0, 120)}“`);
  }
  return v;
}

module.exports = { PREIS_SPALTEN, KEINE_PREIS_SPALTEN, unentschiedeneSpalten, pflanzeGeldKanarien, betragSchluessel, geldIndex, werteAus, findeGeld, abwesenheitJson, abwesenheitText, personVon, ABW_WERTE, ABW_WORT };
