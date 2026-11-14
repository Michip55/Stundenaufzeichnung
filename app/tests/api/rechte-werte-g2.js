'use strict';
/**
 * Rechte-Tests G2 (API.md 15.13): wertbasierte Prüfungen, die die Lücken der Abschlussprüfung schließen.
 *
 *  - G2-004 Abwesenheit als Wahrheitswert oder ID-Liste: Korrelation mit der Testdatenbank. Für jeden Tag mit fremden
 *    Abwesenheiten werden die Mengen der abwesenden Personen gebildet (alle, je Einsatz, je Stamm-Baustelle, je Code,
 *    nur genehmigte). Eine Zahlenliste mit genau dieser Personenmenge oder ein Wahrheitswert in einer Personenliste,
 *    der genau diese Personen trennt, ist eine Auskunft über Abwesenheiten – außer die Menge ist zugleich Plan-/
 *    Stammdaten, die der Aufrufer sehen darf (Personen eines Einsatzes, einer Baustelle).
 *  - G2-005 Namen in anderer Schreibweise (Nachname Vorname, „Nachname, Vorname“, Initiale, nur Nachname, Groß-/
 *    Kleinschreibung, ohne Akzente, ä→ae, Personalnummer) neben einem Abwesenheits-Kürzel (K/U/ZA/BU als eigenes Wort,
 *    jede Trennung) oder -Wort.
 *  - G2-006 Zählungen: Zahl neben einem Abwesenheitswort, die einer Tageszahl fremder Abwesenheiten entspricht;
 *    „N Kollegen/Personen … Urlaub“; Tageswerte (datum → Zahl), die über mehrere Tage den Abwesenheitszahlen folgen.
 *  - G2-007 abgeleitete Beträge: Produkte der Kanarien-Preise mit den Mengen/Stunden der Testdaten, Summen je
 *    Position/Gruppe/Baustelle/Tag/Bericht, Gesamtsummen und Prozente der Auftragssumme.
 *  - G2-008 Lohngruppen: je Person eine eigene Lohngruppe mit Kanarien-ID, -Name und -KV (Sätze = Geld-Kanarien).
 *  - G2-009 Bild-Kanarien: Lieferschein-Fotos mit eindeutigem Pixelmuster; gesucht als Datei-Bytes, als komprimierte
 *    Bilddaten (PNG-IDAT/JPEG-Scan) im PDF, als entpackte Pixelzeilen, als Base64 und als Bild-Adresse in JSON.
 */
const zlib = require('node:zlib');
const crypto = require('node:crypto');

/* ------------------------------------------------------------------ Vergleichstext, Namen */

/** Vergleichsform mit gleicher Länge (Akzente weg, ı→i); ß bleibt (Länge), Groß-/Kleinschreibung bleibt */
function vergleich(s) {
  return String(s).replace(/ı/g, 'i').normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
}
const TRANS = (s) => s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss');
// Nachnamen, die auch gewöhnliche Wörter sind, gelten allein nicht als Name
const NACHNAME_STOPP = new Set(['probe', 'tisch', 'scherz', 'dummy', 'zwei', 'koller']);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Schreibweisen eines Namens: [{form, gross}] – gross=true: nur mit großem Anfangsbuchstaben (Nachname allein)
 */
function namensVarianten(name, pnr) {
  const teile = String(name).trim().split(/\s+/);
  const out = new Map();
  const add = (f, gross = false) => { const v = vergleich(f); if (v.length >= 4 && !out.has(v)) out.set(v, gross); };
  add(name);
  if (teile.length >= 2) {
    const vor = teile.slice(0, -1).join(' '), nach = teile[teile.length - 1];
    for (const [v, n] of [[vor, nach], [TRANS(vor), TRANS(nach)]]) {
      add(`${v} ${n}`); add(`${n} ${v}`); add(`${n}, ${v}`); add(`${n},${v}`);
      add(`${v[0]}. ${n}`); add(`${v[0]}.${n}`); add(`${n} ${v[0]}.`); add(`${n}, ${v[0]}.`);
      add(`${v[0]}. ${n[0]}.`); add(`${v[0]}.${n[0]}.`);
      if (n.length >= 5 && !NACHNAME_STOPP.has(vergleich(n).toLowerCase())) add(n, true);
    }
  }
  if (pnr) add(`Pnr. ${pnr}`); // Personalnummer nur mit Kennzeichnung (Zahl allein ist zu häufig)
  return [...out].map(([form, gross]) => ({ form, gross }));
}

const _namenCache = new Map();
/** Ein Regex über alle Schreibweisen aller fremden Personen; Treffer → Personen-ID */
function namenSucher(namen, ich, pnr) {
  const key = `${ich}|${namen.size}`;
  if (_namenCache.has(key)) return _namenCache.get(key);
  const formen = [];
  for (const [n, id] of namen) if (id !== ich) for (const v of namensVarianten(n, pnr && pnr.get(id))) formen.push({ ...v, id });
  formen.sort((a, b) => b.form.length - a.form.length);
  const re = (liste, flags) => (liste.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${liste.map((x) => esc(x.form)).join('|')})(?![\\p{L}\\p{N}])`, flags) : null);
  const klein = formen.filter((x) => !x.gross), gross = formen.filter((x) => x.gross);
  const idVon = new Map();
  for (const f of klein) idVon.set(f.form.toLowerCase(), f.id);
  for (const f of gross) if (!idVon.has(f.form)) idVon.set(f.form, f.id);
  const s = { reI: re(klein, 'giu'), reG: re(gross, 'gu'), id: (m, g) => idVon.get(g ? m : m.toLowerCase()) };
  _namenCache.set(key, s);
  return s;
}

const _personCache = new Map();
/** G2-005: Person zu einem Namensfeld in anderer Schreibweise („Schwarz, Daniel“, „D. Schwarz“, „daniel schwarz“) */
function personAusName(text, namen) {
  if (typeof text !== 'string' || !namen || !namen.size) return undefined;
  let m = _personCache.get(namen);
  if (!m) {
    m = new Map();
    for (const [n, id] of namen) for (const v of namensVarianten(n)) if (!v.gross) { const k = v.form.toLowerCase(); m.set(k, m.has(k) && m.get(k) !== id ? null : id); }
    _personCache.set(namen, m);
  }
  const id = m.get(vergleich(text.trim()).toLowerCase());
  return id == null ? undefined : id;
}

/* ------------------------------------------------------------------ Abwesenheit im Text (G2-005, G2-006) */

const CODE_TOKEN = /(?<![\p{L}\p{N}])(K|U|ZA|BU)(?![\p{L}\p{N}])/u;
const ABW_WORT = /(?<![\p{L}])(Urlaub\p{L}*|urlaub\p{L}*|Krank\p{L}*|krank\p{L}*|Zeitausgleich\p{L}*|abwesend\p{L}*|Abwesen\p{L}*|Betriebsurlaub\p{L}*|Arztbesuch|Pflegeurlaub|Sonderurlaub|abw\.)/u;
const ABW_WORT_G = new RegExp(ABW_WORT.source, 'gu');
const ZAHLWORT = { ein: 1, eine: 1, einer: 1, zwei: 2, drei: 3, vier: 4, 'fünf': 5, funf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10 };
// „N (weitere/andere) Kollegen/Personen/Mitarbeiter …“ – Anzahl ANDERER Personen
const ANZAHL_ANDERE = /(?<![\p{L}\p{N}])(\d+|ein|eine|einer|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|mehrere|einige|viele)\s+(?:weitere[nr]?\s+|andere[nr]?\s+)?(Kolleg\p{L}*|Personen|Person|Mitarbeiter\p{L}*|Leute|Arbeiter|Mann|Partie-?Mitglied\p{L}*)(?![\p{L}])/giu;
// Zahl als eigenes Wort, keine Datums-/Uhrzeit-/Dezimalteile, keine Einheit danach (eigene Tage, Stunden, Prozent, €)
const ZAHL_FREI = /(?<![\p{L}\p{N}.,:/-])(\d{1,3})(?![\p{N}]|[.,:/-]\d|\s*(?:Tag|Tage|Arbeitstag|Arbeitstage|Std|Stunden|h\b|%|€|Uhr|Jahr|Woche|Monat|KW|m|t|lfm|Stk))/gu;

/**
 * Befunde für EINEN Text (JSON-String, Textzeile, PDF-Ausschnitt).
 * @param {string} text
 * @param {{ich:number, namen:Map, pnr?:Map, ignorieren?:string[], zaehl?:Set<number>}} o
 */
function textAbwesenheit(text0, o) {
  let text = String(text0);
  for (const ig of o.ignorieren || []) text = text.split(ig).join(' ');
  const t = vergleich(text);
  const out = [];
  const hatWort = ABW_WORT.test(t);
  // G2-005: Name (jede Schreibweise) einer anderen Person + Kürzel als eigenes Wort (±40 Zeichen) oder Abwesenheitswort
  const s = namenSucher(o.namen, o.ich, o.pnr);
  for (const [re, gross] of [[s.reI, false], [s.reG, true]]) {
    if (!re) continue;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t))) {
      const id = s.id(m[0], gross);
      const fenster = t.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40);
      const ohneName = fenster.replace(m[0], ' ');
      const wortNah = ABW_WORT.test(t.length <= 300 ? t.replace(m[0], ' ') : t.slice(Math.max(0, m.index - 80), m.index + m[0].length + 80).replace(m[0], ' '));
      if (CODE_TOKEN.test(ohneName) || wortNah) { out.push(`Abwesenheit einer anderen Person (${id}, „${m[0]}“) im Text „${text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 50).replace(/\s+/g, ' ')}“`); break; }
    }
    if (out.length) break;
  }
  if (hatWort) {
    // G2-006: „N Kollegen … Urlaub“ (Anzahl anderer Personen neben einem Abwesenheitswort)
    ANZAHL_ANDERE.lastIndex = 0;
    let m;
    while ((m = ANZAHL_ANDERE.exec(t))) {
      const umfeld = t.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60);
      if (ABW_WORT.test(umfeld)) { out.push(`Anzahl anderer Personen neben Abwesenheit „${umfeld.replace(/\s+/g, ' ')}“`); break; }
    }
    // G2-006: Zahl = Tageszahl fremder Abwesenheiten (Testdaten) neben einem Abwesenheitswort
    if (o.zaehl && o.zaehl.size) {
      ABW_WORT_G.lastIndex = 0;
      let w;
      while ((w = ABW_WORT_G.exec(t)) && out.length < 3) {
        const a = Math.max(0, w.index - 40), umfeld = t.slice(a, w.index + w[0].length + 40);
        ZAHL_FREI.lastIndex = 0;
        let z;
        while ((z = ZAHL_FREI.exec(umfeld))) {
          const n = Number(z[1]);
          if (o.zaehl.has(n)) { out.push(`Zahl ${n} (= Tageszahl fremder Abwesenheiten der Testdaten) neben „${w[0]}“: „${umfeld.replace(/\s+/g, ' ')}“`); break; }
        }
      }
      for (const [wort, n] of Object.entries(ZAHLWORT)) {
        if (!o.zaehl.has(n)) continue;
        const re = new RegExp(`(?<![\\p{L}])${wort}(?![\\p{L}])`, 'iu');
        const mm = re.exec(t);
        if (mm && ABW_WORT.test(t.slice(Math.max(0, mm.index - 40), mm.index + 60)) && ANZAHL_ANDERE.test(t)) { out.push(`Zahlwort „${wort}“ neben Abwesenheit: „${t.slice(Math.max(0, mm.index - 40), mm.index + 60)}“`); break; }
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ Abwesenheits-Testdaten (G2-004, G2-006) */

const ABW_CODES_DB = ['K', 'U', 'ZA']; // + betriebsurlaub=1 → BU

/** Rohdaten aus der Basis-DB (nach erstelleBasis in fixtures.json) */
function abwesenheitsDaten(db) {
  return {
    abw: db.alle('SELECT benutzer_id AS id, datum, code, status, betriebsurlaub AS bu FROM abwesenheit ORDER BY datum, benutzer_id'),
    einsaetze: db.alle('SELECT e.id, e.datum, e.baustelle_id AS bs, group_concat(p.benutzer_id) AS p FROM plan_einsatz e JOIN plan_person p ON p.einsatz_id = e.id WHERE e.geloescht = 0 GROUP BY e.id').map((e) => ({ id: e.id, datum: e.datum, bs: e.bs, personen: String(e.p).split(',').map(Number) })),
    stamm: db.alle('SELECT id, baustelle_id AS bs, rolle FROM benutzer'),
    pnr: db.alle('SELECT id, pnr FROM benutzer WHERE pnr IS NOT NULL')
  };
}

const _kandCache = new Map();
/**
 * Kandidaten-Mengen je Aufrufer: Personenmengen fremder Abwesender (Schlüssel „4,5,6“ → Beschreibung), erlaubte
 * Mengen (Plan/Stamm), Tageszahlen je Kontext (für Tageswerte) und alle Tageszahlen (für Texte).
 */
function abwKandidaten(A, ich) {
  if (!A) return null;
  const key = `${ich}`;
  if (_kandCache.has(key) && _kandCache.get(key).A === A) return _kandCache.get(key).k;
  const stammBs = new Map(A.stamm.map((b) => [b.id, b.bs]));
  const bsListe = [...new Set(A.stamm.map((b) => b.bs).filter((x) => x != null))];
  const tage = [...new Set(A.abw.map((a) => a.datum))];
  const sets = new Map(), legit = new Set(), zaehlKontext = new Map(), zaehl = new Set(), zaehlText = new Set();
  const sk = (ids) => [...new Set(ids)].filter((x) => x !== ich).sort((a, b) => a - b).join(',');
  for (const e of A.einsaetze) legit.add(sk(e.personen));
  for (const bs of bsListe) legit.add(sk(A.stamm.filter((b) => b.bs === bs).map((b) => b.id)));
  const filter = {
    abw: (a) => ABW_CODES_DB.includes(a.code) || a.bu,
    'abw genehmigt': (a) => (ABW_CODES_DB.includes(a.code) || a.bu) && a.status === 'genehmigt',
    'alle Codes': () => true,
    K: (a) => a.code === 'K', U: (a) => a.code === 'U' && !a.bu, ZA: (a) => a.code === 'ZA', BU: (a) => Boolean(a.bu)
  };
  for (const d of tage) {
    const amTag = A.abw.filter((a) => a.datum === d && a.id !== ich);
    for (const [fn, f] of Object.entries(filter)) {
      const ids = amTag.filter(f).map((a) => a.id);
      const gruppen = [['alle', ids], ...bsListe.map((bs) => [`Baustelle ${bs}`, ids.filter((x) => stammBs.get(x) === bs)]),
        ...A.einsaetze.filter((e) => e.datum === d).map((e) => [`Einsatz ${e.id}`, ids.filter((x) => e.personen.includes(x))])];
      for (const [gn, g] of gruppen) {
        const k = sk(g);
        if (k) { if (!sets.has(k)) sets.set(k, []); sets.get(k).push({ d, name: `${d} ${fn} ${gn}` }); }
        const n = new Set(g).size;
        if (n > 0) zaehl.add(n);
        if (n > 0 && fn !== 'alle Codes') zaehlText.add(n);
        if (!gn.startsWith('Einsatz')) {
          const kk = `${fn}|${gn}`;
          if (!zaehlKontext.has(kk)) zaehlKontext.set(kk, new Map());
          zaehlKontext.get(kk).set(d, n);
          // auch als Zeilenzahl (eine Person kann je Tag nur eine Abwesenheit haben – gleich)
        }
      }
    }
  }
  for (const k of legit) sets.delete(k);
  const k = { sets, legit, zaehl, zaehlText, zaehlKontext, tage: new Set(tage) };
  _kandCache.set(key, { A, k });
  return k;
}

const ID_SCHLUESSEL = /(^id$|Id$|_id$|^nr$|version|^pos$|sortierung|reihenfolge)/i;

/**
 * G2-004/G2-006 (JSON): Korrelation mit den Abwesenheiten der Testdaten.
 * @param {*} daten
 * @param {{ich:number, abw:object, namen:Map}} o
 */
function abwesenheitKorrelation(daten, o, wo, personVon) {
  const K = abwKandidaten(o.abw, o.ich);
  if (!K) return [];
  const v = [];
  // Tag der Antwort (nächstes „datum“ darüber): dann zählen nur die Abwesenden dieses Tages, sonst jedes Tages
  const treffer = (k, tag) => { const e = k && K.sets.get(k); if (!e) return null; const f = tag ? e.find((x) => x.d === tag) : e[0]; return f ? f.name : null; };
  const pruefeMenge = (ids, pfad, art, tag) => {
    if (ids.length < 1) return;
    const k = [...new Set(ids)].filter((x) => x !== o.ich).sort((a, b) => a - b).join(',');
    const n = treffer(k, tag);
    if (n) v.push(`${wo}: ${art} bei ${pfad} = Menge der fremden Abwesenden (${n}: ${k})`);
  };
  const lauf = (x, pfad, tag0) => {
    const tag = x && typeof x === 'object' && !Array.isArray(x) && typeof x.datum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.datum) ? x.datum : tag0;
    if (Array.isArray(x)) {
      // a) Zahlenliste (≥ 2 verschiedene Personen-IDs)
      if (x.length >= 2 && x.every((y) => Number.isInteger(y) && y > 0) && new Set(x).size === x.length) pruefeMenge(x, pfad, 'ID-Liste', tag);
      // a2) Liste von Personen-Objekten, die nur aus der Kennung besteht ({benutzerId} / {id})
      const obj = x.filter((y) => y && typeof y === 'object' && !Array.isArray(y));
      if (obj.length >= 2 && obj.length === x.length) {
        const pers = obj.map((y) => personVon(y, o.namen) ?? (Object.keys(y).length <= 2 && Number.isInteger(y.id) ? y.id : undefined));
        if (pers.every((p) => p !== undefined) && obj.every((y) => Object.keys(y).length <= 2)) pruefeMenge(pers, pfad, 'Personenliste', tag);
        // b) Wahrheitswert/0-1-Merker in einer Personenliste, der genau die Abwesenden trennt
        if (pers.every((p) => p !== undefined) && obj.length >= 3) {
          const schluessel = new Set(obj.flatMap((y) => Object.keys(y)));
          for (const s of schluessel) {
            const werte = obj.map((y) => y[s]);
            const bool = werte.every((w) => typeof w === 'boolean' || w === 0 || w === 1 || w === undefined || w === null);
            if (!bool) continue;
            const wahr = pers.filter((_, i) => werte[i] === true || werte[i] === 1), falsch = pers.filter((_, i) => werte[i] === false || werte[i] === 0 || werte[i] === null || werte[i] === undefined);
            if (!wahr.length || !falsch.length) continue;
            for (const [teil, w] of [[wahr, 'true'], [falsch, 'false/fehlt']]) {
              const k = [...new Set(teil)].filter((y) => y !== o.ich).sort((a, b) => a - b).join(',');
              const andere = (w === 'true' ? falsch : wahr).filter((y) => y !== o.ich);
              const n = andere.length ? treffer(k, tag) : null;
              if (n) v.push(`${wo}: Merker „${s}“=${w} bei ${pfad} trennt genau die fremden Abwesenden (${n}: ${k})`);
            }
          }
        }
      }
      // c) Tageswerte: Liste von {datum, …zahl} – folgt eine Zahl über mehrere Tage den Abwesenheitszahlen?
      const tageObj = obj.filter((y) => typeof y.datum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(y.datum));
      if (tageObj.length >= 3) pruefeTageswerte(tageObj.map((y) => [y.datum, y]), pfad);
      x.forEach((e, i) => lauf(e, `${pfad}[${i}]`, tag));
      return;
    }
    if (x && typeof x === 'object') {
      // c2) Objekt mit Datum als Schlüssel: { "2026-11-13": 5 } oder { "2026-11-13": {…} }
      const dk = Object.keys(x).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k));
      if (dk.length >= 3) pruefeTageswerte(dk.map((d) => [d, typeof x[d] === 'number' ? { wert: x[d] } : x[d]]), pfad);
      for (const [k, w] of Object.entries(x)) lauf(w, `${pfad}.${k}`, /^\d{4}-\d{2}-\d{2}$/.test(k) ? k : tag);
    }
  };
  const pruefeTageswerte = (paare, pfad) => {
    const schl = new Set(paare.flatMap(([, y]) => (y && typeof y === 'object' ? Object.keys(y) : [])));
    for (const s of schl) {
      if (ID_SCHLUESSEL.test(s)) continue;
      const werte = paare.map(([d, y]) => [d, y && typeof y === 'object' ? y[s] : undefined]).filter(([, w]) => Number.isInteger(w));
      if (werte.length < 3 || !werte.some(([, w]) => w > 0)) continue;
      for (const [kk, proTag] of K.zaehlKontext) {
        const soll = werte.map(([d]) => proTag.get(d) || 0);
        if (soll.filter((n) => n > 0).length < 2) continue;
        if (werte.every(([, w], i) => w === soll[i])) { v.push(`${wo}: Tageswert „${s}“ bei ${pfad} folgt der Zahl fremder Abwesenheiten (${kk}) an ${werte.length} Tagen`); return; }
      }
    }
  };
  lauf(daten, '$', undefined);
  return v;
}

/* ------------------------------------------------------------------ Lohngruppen-Kanarien (G2-008) */

/**
 * Je Person (und je ihrer Lohngruppen im Verlauf) eine eigene Lohngruppe: ID lgk-<Person>-<alt>, Name LG-KANARIE-…,
 * KV LGKV-KANARIE-… – Sätze übernimmt sie (werden danach Geld-Kanarien). Die alten Lohngruppen bleiben (Preisliste).
 * @returns {{id, name, kv, person}[]}
 */
function pflanzeLohnKanarien(db) {
  const spalten = db.alle('PRAGMA table_info(lohngruppe)').map((c) => c.name);
  const neu = new Map();
  const lg = (person, alt) => {
    const k = `${person}|${alt}`;
    if (neu.has(k)) return neu.get(k).id;
    const id = `lgk-${person}-${alt}`;
    const name = `LG-KANARIE-${person}-${String(alt).toUpperCase()}`, kv = `LGKV-KANARIE-${person}-${String(alt).toUpperCase()}`;
    const rest = spalten.filter((c) => !['id', 'name', 'kv'].includes(c));
    db.lauf(`INSERT INTO lohngruppe (id, name, kv, ${rest.map((c) => `"${c}"`).join(', ')}) SELECT ?, ?, ?, ${rest.map((c) => `"${c}"`).join(', ')} FROM lohngruppe WHERE id = ?`, id, name, kv, alt);
    neu.set(k, { id, name, kv, person, alt });
    return id;
  };
  for (const b of db.alle('SELECT id, lohngruppe_id FROM benutzer WHERE lohngruppe_id IS NOT NULL')) db.lauf('UPDATE benutzer SET lohngruppe_id = ? WHERE id = ?', lg(b.id, b.lohngruppe_id), b.id);
  for (const z of db.alle('SELECT id, benutzer_id, lohngruppe_id FROM benutzer_lohngruppe WHERE lohngruppe_id IS NOT NULL')) db.lauf('UPDATE benutzer_lohngruppe SET lohngruppe_id = ? WHERE id = ?', lg(z.benutzer_id, z.lohngruppe_id), z.id);
  return [...neu.values()];
}

/* ------------------------------------------------------------------ Abgeleitete Beträge (G2-007) */

/**
 * Beträge, die sich aus den Kanarien-Preisen und den Mengen/Stunden der Testdaten ergeben.
 * @returns {{betraege:{name,wert}[], prozente:{name,wert}[]}}
 */
function abgeleiteteBetraege(db) {
  const out = [];
  const add = (name, w) => { if (Number.isFinite(w) && Math.abs(w) >= 1) out.push({ name, wert: Math.round(w * 100) / 100 }); };
  const summe = new Map();
  const sum = (k, w) => { if (Number.isFinite(w)) summe.set(k, (summe.get(k) || 0) + w); };
  const alle = (sql, ...p) => { try { return db.alle(sql, ...p); } catch (_) { return []; } };
  const auftrag = new Map(alle('SELECT id, auftragssumme AS a FROM baustelle WHERE auftragssumme IS NOT NULL').map((b) => [b.id, b.a]));
  // Preise mit „gültig ab“ (API.md 12.2): Stammwert = heute gültiger Stand (Abgleich beim Serverstart), Rechnungen über
  // vergangene Tage mit dem Stand am Tag – beide Lesarten (V = [aktuell, am Tag])
  const heute = require('../../server/datum').wienDatum(db.uhr ? db.uhr() : new Date());
  const staende = new Map();
  for (const z of alle('SELECT art, ref, feld, wert, gueltig_ab FROM preis_stand ORDER BY gueltig_ab')) { const k = `${z.art}|${z.ref}|${z.feld}`; if (!staende.has(k)) staende.set(k, []); staende.get(k).push(z); }
  const am = (art, ref, feld, d, stamm) => { let w; for (const x of staende.get(`${art}|${ref}|${feld}`) || []) { if (x.gueltig_ab <= d) w = x.wert; else break; } return w === undefined ? stamm : w; };
  const V = (art, ref, feld, d, stamm) => [['aktuell', am(art, ref, feld, heute, stamm)], ['am Tag', am(art, ref, feld, d || heute, stamm)]].filter(([, w]) => w != null);
  // Projektpositionen: EP × Menge (je Eintrag, je Position, je Gruppe, je Baustelle, je Tag)
  for (const z of alle('SELECT p.id, p.baustelle_id AS bs, p.gruppe, p.ep, m.menge, m.datum FROM projektposition p JOIN projektposition_menge m ON m.position_id = p.id')) {
    for (const [v, ep] of V('projektposition', z.id, 'ep', z.datum, z.ep)) {
      const w = ep * z.menge;
      add(`Menge×EP Position ${z.id} ${z.datum} [${v}]`, w);
      for (const k of [`Position ${z.id}`, `Gruppe ${z.bs}/${z.gruppe}`, `Positionen Baustelle ${z.bs}`, `Positionen Baustelle ${z.bs} ${z.datum}`, `Erlös Baustelle ${z.bs}`, 'Positionen gesamt']) sum(`${k} [${v}]`, w);
    }
  }
  // LV: EP × LV-Menge
  for (const z of alle('SELECT id, baustelle_id AS bs, ep, menge FROM lv_position WHERE ep IS NOT NULL AND menge IS NOT NULL')) { add(`LV ${z.id} EP×Menge`, z.ep * z.menge); sum(`LV Baustelle ${z.bs} [aktuell]`, z.ep * z.menge); }
  // Leistungen: EP × gemeldete Menge
  for (const z of alle('SELECT m.id, m.baustelle_id AS bs, m.menge, m.leistung_id AS l, l.ep, m.datum FROM leistungsmeldung m JOIN leistung l ON l.id = m.leistung_id')) {
    for (const [v, ep] of V('leistungen', z.l, 'ep', z.datum, z.ep)) { add(`Leistung ${z.id} EP×Menge [${v}]`, ep * z.menge); sum(`Leistungen Baustelle ${z.bs} [${v}]`, ep * z.menge); sum(`Erlös Baustelle ${z.bs} [${v}]`, ep * z.menge); }
  }
  // Bericht: Stunden × Kosten-/Regiesatz der Lohngruppe, Gerätestunden × Satz, Material × EK/VK
  const lgSatz = new Map(alle('SELECT id, kostensatz, regiesatz FROM lohngruppe').map((x) => [x.id, x]));
  for (const z of alle('SELECT bp.bericht_id AS b, r.baustelle_id AS bs, r.datum, bp.stunden, u.lohngruppe_id AS lg FROM bericht_personal bp JOIN bericht r ON r.id = bp.bericht_id JOIN benutzer u ON u.id = bp.benutzer_id WHERE bp.stunden > 0')) {
    const s = lgSatz.get(z.lg);
    if (!s) continue;
    for (const [art, feld] of [['Lohn', 'kostensatz'], ['Regie', 'regiesatz']]) {
      for (const [v, satz] of V('lohngruppen', z.lg, feld, z.datum, s[feld])) {
        add(`${art} Bericht ${z.b} Person [${v}]`, z.stunden * satz); sum(`${art} Bericht ${z.b} [${v}]`, z.stunden * satz); sum(`${art} Baustelle ${z.bs} [${v}]`, z.stunden * satz);
        if (feld === 'kostensatz') { sum(`Kosten Bericht ${z.b} [${v}]`, z.stunden * satz); sum(`Kosten Baustelle ${z.bs} [${v}]`, z.stunden * satz); }
      }
    }
  }
  for (const z of alle('SELECT bg.bericht_id AS b, r.baustelle_id AS bs, r.datum, bg.stunden, g.id AS g, g.kostensatz, g.verrechnungssatz FROM bericht_geraet bg JOIN bericht r ON r.id = bg.bericht_id JOIN geraet g ON g.id = bg.geraet_id WHERE bg.stunden > 0')) {
    for (const [art, feld] of [['Gerät', 'kostensatz'], ['Gerät verrechnet', 'verrechnungssatz']]) {
      for (const [v, satz] of V('geraete', z.g, feld, z.datum, z[feld])) {
        add(`${art} Bericht ${z.b} Zeile [${v}]`, z.stunden * satz); sum(`${art} Bericht ${z.b} [${v}]`, z.stunden * satz); sum(`${art} Baustelle ${z.bs} [${v}]`, z.stunden * satz);
        if (feld === 'kostensatz') { sum(`Kosten Bericht ${z.b} [${v}]`, z.stunden * satz); sum(`Kosten Baustelle ${z.bs} [${v}]`, z.stunden * satz); }
      }
    }
  }
  for (const z of alle('SELECT bm.bericht_id AS b, r.baustelle_id AS bs, r.datum, bm.menge, m.id AS m, m.ek, m.vk FROM bericht_material bm JOIN bericht r ON r.id = bm.bericht_id JOIN material m ON m.id = bm.material_id WHERE bm.menge > 0')) {
    for (const [art, feld] of [['Material EK', 'ek'], ['Material VK', 'vk']]) {
      for (const [v, satz] of V('materialien', z.m, feld, z.datum, z[feld])) {
        add(`${art} Bericht ${z.b} Zeile [${v}]`, z.menge * satz); sum(`${art} Bericht ${z.b} [${v}]`, z.menge * satz); sum(`${art} Baustelle ${z.bs} [${v}]`, z.menge * satz);
        if (feld === 'ek') { sum(`Kosten Bericht ${z.b} [${v}]`, z.menge * satz); sum(`Kosten Baustelle ${z.bs} [${v}]`, z.menge * satz); }
      }
    }
  }
  // Planer: Geräte- und Lohnkosten eines Tages/Einsatzes/einer Baustelle am Tag (Satz × 1…12 h), Fuhren-Menge × EK/VK
  const planGeraet = alle('SELECT e.id AS e, e.datum, e.baustelle_id AS bs, COALESCE(g1.id, g2.id) AS g, COALESCE(g1.kostensatz, g2.kostensatz) AS kostensatz, COALESCE(g1.verrechnungssatz, g2.verrechnungssatz) AS verrechnungssatz FROM plan_anlage pa JOIN plan_einsatz e ON e.id = pa.einsatz_id JOIN anlage a ON a.id = pa.anlage_id LEFT JOIN geraet g1 ON g1.id = a.geraet_id LEFT JOIN geraet g2 ON g2.anlage_id = a.id WHERE e.geloescht = 0').filter((z) => z.g != null);
  const planLohn = alle('SELECT e.id AS e, e.datum, e.baustelle_id AS bs, l.id AS g, l.kostensatz, l.regiesatz AS verrechnungssatz FROM plan_person pp JOIN plan_einsatz e ON e.id = pp.einsatz_id JOIN benutzer u ON u.id = pp.benutzer_id JOIN lohngruppe l ON l.id = u.lohngruppe_id WHERE e.geloescht = 0');
  const satzSumme = new Map();
  for (const [art, liste, pa, felder] of [['Plan Gerät', planGeraet, 'geraete', ['kostensatz', 'verrechnungssatz']], ['Plan Lohn', planLohn, 'lohngruppen', ['kostensatz', 'regiesatz']]]) {
    for (const z of liste) for (const [s, feld] of [['Kosten', felder[0]], ['Verrechnung', felder[1]]]) {
      for (const [v, satz] of V(pa, z.g, feld, z.datum, s === 'Kosten' ? z.kostensatz : z.verrechnungssatz)) {
        for (const k of [`${art} ${s} Tag ${z.datum}`, `${art} ${s} Einsatz ${z.e}`, `${art} ${s} Baustelle ${z.bs} ${z.datum}`]) satzSumme.set(`${k} [${v}]`, (satzSumme.get(`${k} [${v}]`) || 0) + satz);
      }
    }
  }
  for (const [k, w] of satzSumme) for (let h = 1; h <= 12; h++) add(`${k} × ${h} h`, w * h);
  for (const z of alle('SELECT f.id, f.datum, f.menge, m.id AS m, m.ek, m.vk FROM plan_fuhre f JOIN material m ON m.id = f.material_id WHERE f.menge > 0')) {
    for (const feld of ['ek', 'vk']) for (const [v, satz] of V('materialien', z.m, feld, z.datum, z[feld])) add(`Fuhre ${z.id} Menge×${feld.toUpperCase()} [${v}]`, z.menge * satz);
  }
  // Rechnungen: Brutto, USt, offen (Netto − Zahlungen), Summen je Baustelle
  const gezahlt = new Map(alle('SELECT rechnung_id AS r, SUM(betrag) AS s FROM rechnung_zahlung GROUP BY rechnung_id').map((x) => [x.r, x.s]));
  for (const z of alle('SELECT id, baustelle_id AS bs, netto, ust_satz, ruecklass_prozent FROM rechnung WHERE netto IS NOT NULL')) {
    const ust = z.ust_satz == null ? 20 : z.ust_satz;
    add(`Rechnung ${z.id} brutto`, z.netto * (1 + ust / 100)); add(`Rechnung ${z.id} USt`, z.netto * ust / 100);
    add(`Rechnung ${z.id} offen`, z.netto - (gezahlt.get(z.id) || 0)); add(`Rechnung ${z.id} brutto offen`, z.netto * (1 + ust / 100) - (gezahlt.get(z.id) || 0));
    if (z.ruecklass_prozent) add(`Rechnung ${z.id} Rücklass`, z.netto * z.ruecklass_prozent / 100);
    sum(`Rechnungen Baustelle ${z.bs}`, z.netto); sum(`Rechnungen brutto Baustelle ${z.bs}`, z.netto * (1 + ust / 100)); sum('Rechnungen gesamt', z.netto);
  }
  for (const z of alle('SELECT r.baustelle_id AS bs, SUM(z.betrag) AS s FROM rechnung_zahlung z JOIN rechnung r ON r.id = z.rechnung_id GROUP BY r.baustelle_id')) add(`Zahlungen Baustelle ${z.bs}`, z.s);
  // Nachträge, Fremdleistungen, Servicebuch
  for (const z of alle('SELECT baustelle_id AS bs, SUM(betrag) AS s FROM nachtrag GROUP BY baustelle_id')) { add(`Nachträge Baustelle ${z.bs}`, z.s); if (auftrag.has(z.bs)) add(`Auftrag + Nachträge Baustelle ${z.bs}`, auftrag.get(z.bs) + z.s); }
  for (const z of alle('SELECT baustelle_id AS bs, SUM(betrag) AS s FROM fremdleistung GROUP BY baustelle_id')) { add(`Fremdleistungen Baustelle ${z.bs}`, z.s); for (const v of ['aktuell', 'am Tag']) sum(`Kosten Baustelle ${z.bs} [${v}]`, z.s); }
  for (const z of alle('SELECT anlage_id AS a, SUM(kosten) AS s FROM servicebuch_eintrag WHERE kosten IS NOT NULL GROUP BY anlage_id')) add(`Servicebuch Anlage ${z.a}`, z.s);
  for (const [k, w] of summe) add(k, w);
  // Kalkulation je Baustelle: Erlös − Kosten (Deckungsbeitrag), Auftrag − Rechnungen (Rest)
  for (const bs of new Set([...auftrag.keys(), ...[...summe.keys()].map((k) => Number((/Baustelle (\d+)(?: \[|$)/.exec(k) || [])[1])).filter(Boolean)])) {
    for (const v of ['aktuell', 'am Tag']) {
      const e = summe.get(`Erlös Baustelle ${bs} [${v}]`) || 0, kosten = summe.get(`Kosten Baustelle ${bs} [${v}]`) || 0;
      if (e && kosten) add(`Deckungsbeitrag Baustelle ${bs} [${v}]`, e - kosten);
    }
    if (auftrag.has(bs) && summe.has(`Rechnungen Baustelle ${bs}`)) add(`Auftrag − Rechnungen Baustelle ${bs}`, auftrag.get(bs) - summe.get(`Rechnungen Baustelle ${bs}`));
  }
  // Prozente der Auftragssumme: Betrag (Auftragssumme × p %) und Anteil abgeleiteter Summen an der Auftragssumme
  const prozente = [];
  for (const [bs, a] of auftrag) {
    for (let p = 1; p <= 100; p++) add(`${p} % der Auftragssumme Baustelle ${bs}`, a * p / 100);
    for (const p of [2.5, 3, 5, 7.5, 12.5]) add(`${p} % der Auftragssumme Baustelle ${bs}`, a * p / 100);
    for (const [k, w] of summe) if (new RegExp(`Baustelle ${bs}(?: \\[[^\\]]+\\])?$`).test(k)) prozente.push({ name: `${k} in % der Auftragssumme`, wert: w / a * 100 });
  }
  return { betraege: out, prozente };
}

/** Index für abgeleitete Beträge: genau (Cent); gerundet/abgeschnitten/eine Stelle nur ab 100 000 (sonst zu häufig) */
function geldIndexAbgeleitet(liste, m = new Map()) {
  for (const { name, wert } of liste) {
    const cent = Math.round(wert * 100);
    const keys = [`c:${cent}`];
    if (Math.abs(wert) >= 1e5) keys.push(`d:${Math.round(wert * 10)}`, `i:${Math.round(wert)}`, `i:${Math.trunc(wert)}`);
    for (const k of keys) if (!m.has(k)) m.set(k, `abgeleitet: ${name}`);
  }
  return m;
}

/** Prozentwerte („12,34 %“): nur mit Nachkommastelle und %-Zeichen; ganzzahlig nur ab 1000 % */
function findeProzent(text, prozente) {
  if (!prozente || !prozente.length) return [];
  const out = [];
  for (const m of String(text).matchAll(/(?<![\d.,])(\d{1,7}(?:[.,]\d{1,2})?)\s?%/g)) {
    const w = Number(m[1].replace(',', '.'));
    const stellen = (m[1].split(/[.,]/)[1] || '').length;
    if (!stellen && w < 1000) continue;
    const p = prozente.find((x) => Math.abs((stellen ? Number(x.wert.toFixed(stellen)) : Math.round(x.wert)) - w) < 1e-9);
    if (p) out.push({ name: p.name, form: m[0], stelle: m.index });
  }
  return out;
}

/* ------------------------------------------------------------------ Bild-Kanarien (G2-009) */

/** PNG (Graustufen) mit eindeutigem Pixelmuster aus einem Startwert */
function musterPng(start, kante = 40) {
  const { chunk } = require('./fuhrpark-bilder');
  let x = crypto.createHash('sha256').update(`BILD-KANARIE-${start}`).digest();
  const roh = Buffer.alloc(kante * (kante + 1));
  for (let y = 0; y < kante; y++) {
    roh[y * (kante + 1)] = 0;
    for (let i = 0; i < kante; i++) { if ((y * kante + i) % 32 === 0) x = crypto.createHash('sha256').update(x).digest(); roh[y * (kante + 1) + 1 + i] = x[(y * kante + i) % 32]; }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(kante, 0); ihdr.writeUInt32BE(kante, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(roh)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Kanarien-Formen eines gespeicherten Bildes: Prüfsumme, Bytes aus der Mitte der Bilddaten (PNG-IDAT bzw. JPEG-Scan),
 * entpackte Pixelzeilen (PNG), Base64 der Datei.
 */
function bildKanarie(name, buf, extra = {}) {
  const f = { name, sha: crypto.createHash('sha256').update(buf).digest('hex'), ...extra };
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') {
    let i = 8; const idat = [];
    while (i + 12 <= buf.length) { const len = buf.readUInt32BE(i); const typ = buf.toString('latin1', i + 4, i + 8); if (typ === 'IDAT') idat.push(buf.subarray(i + 8, i + 8 + len)); i += 12 + len; }
    const daten = Buffer.concat(idat);
    f.roh = daten.subarray(Math.floor(daten.length / 3), Math.floor(daten.length / 3) + 48).toString('hex');
    try { const px = zlib.inflateSync(daten); f.pixel = px.subarray(Math.floor(px.length / 2), Math.floor(px.length / 2) + 48).toString('hex'); } catch (_) { /* ohne */ }
  } else {
    f.roh = buf.subarray(Math.floor(buf.length / 2) - 24, Math.floor(buf.length / 2) + 24).toString('hex');
  }
  const b64 = buf.toString('base64');
  f.b64 = b64.slice(Math.floor(b64.length / 2) - 30, Math.floor(b64.length / 2) + 30);
  return f;
}

/** JSON-Objekt {id: <Lieferschein-Foto>, art: 'lieferschein'} irgendwo in der Antwort */
function enthaeltLieferschein(x, id) {
  if (Array.isArray(x)) return x.some((y) => enthaeltLieferschein(y, id));
  if (x && typeof x === 'object') return (x.id === id && x.art === 'lieferschein') || Object.values(x).some((y) => enthaeltLieferschein(y, id));
  return false;
}

/** Bild-Kanarien in einer Antwort (Buffer: Bytes und entpackte Streams; Text/JSON: Base64 und Bild-Adressen) */
function findeBild(r, kanarien) {
  if (!kanarien || !kanarien.length) return [];
  const out = [];
  const buf = Buffer.isBuffer(r.daten) ? r.daten : Buffer.from(typeof r.daten === 'string' ? r.daten : JSON.stringify(r.daten ?? null), 'utf8');
  let entpackt = null;
  const streams = () => {
    if (entpackt) return entpackt;
    entpackt = [];
    const roh = buf.toString('latin1');
    for (const m of roh.matchAll(/stream\r?\n/g)) {
      const a = m.index + m[0].length, e = roh.indexOf('endstream', a);
      if (e < 0) break;
      try { entpackt.push(zlib.inflateSync(buf.subarray(a, e))); } catch (_) { try { entpackt.push(zlib.inflateSync(buf.subarray(a, e - 1))); } catch (__) { /* nicht deflate */ } }
    }
    return entpackt;
  };
  const text = Buffer.isBuffer(r.daten) ? null : buf.toString('utf8');
  for (const k of kanarien) {
    const roh = Buffer.from(k.roh, 'hex');
    let fund = null;
    if (Buffer.isBuffer(r.daten) && crypto.createHash('sha256').update(r.daten).digest('hex') === k.sha) fund = 'Datei';
    else if (buf.includes(roh)) fund = 'Bilddaten';
    else if (k.pixel && Buffer.isBuffer(r.daten) && /^%PDF/.test(buf.toString('latin1', 0, 5)) && streams().some((s) => s.includes(Buffer.from(k.pixel, 'hex')))) fund = 'Pixelzeilen im PDF';
    else if (buf.includes(Buffer.from(k.b64, 'latin1'))) fund = 'Base64';
    else if (text && (k.urls || []).some((u) => new RegExp(u).test(text))) fund = 'Bild-Adresse';
    else if (!Buffer.isBuffer(r.daten) && k.lieferscheinId && enthaeltLieferschein(r.daten, k.lieferscheinId)) fund = 'Lieferschein-Eintrag (id/art) im JSON';
    if (fund) out.push({ name: k.name, fund });
  }
  return out;
}

module.exports = {
  vergleich, namensVarianten, personAusName, textAbwesenheit, abwesenheitsDaten, abwKandidaten, abwesenheitKorrelation, pflanzeLohnKanarien,
  abgeleiteteBetraege, geldIndexAbgeleitet, findeProzent, musterPng, bildKanarie, findeBild, CODE_TOKEN, ABW_WORT_G2: ABW_WORT
};
