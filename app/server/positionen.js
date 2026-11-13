'use strict';
/**
 * Nachkalkulation nach Positionen (API.md Abschnitt 10).
 * Katalog (Firmenvorlage) → Kopie je Baustelle (Projektpositionen) → Mengen aus Berichten (quelle) + manuelle Einträge.
 * Summe je Position = Menge × EP (auf Cent), Gruppensummen, Zusammenstellung, Nachkalkulationssumme.
 */
const { GRUPPEN, ladeKatalogVorlage } = require('./katalog-excel');
const { zuordnungFuer, istNaturmaterial } = require('./positionen-zuordnung');
const { parseJson } = require('./daten');

const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const r1 = (x) => Math.round((x + Number.EPSILON) * 10) / 10;
const r3 = (x) => Math.round((x + Number.EPSILON) * 1000) / 1000;

/** Einheiten vergleichbar machen (to/t, m³/m3, m²/m2, Std./h) */
function einheitNorm(e) {
  const x = String(e || '').trim().toLowerCase().replace('³', '3').replace('²', '2').replace(/\.$/, '');
  return { to: 't', tonnen: 't', std: 'h', stunden: 'h', 'stück': 'stk', st: 'stk' }[x] || x;
}

/* ---------------- reine Rechnung ---------------- */

/**
 * @param {Array<{id,gruppe,bezeichnung,einheit,ep,aktiv,mengeAuto,eintraege:[{menge}]}>} positionen
 * @param {number|null} auftragGesamt
 */
function berechnePositionen(positionen, auftragGesamt) {
  const gruppen = GRUPPEN.map((g) => ({ schluessel: g.schluessel, name: g.name, summe: 0, anteilProzent: null, positionen: [] }));
  const nach = new Map(gruppen.map((g) => [g.schluessel, g]));
  const hinweise = [];
  for (const p of positionen) {
    const mengeManuell = r3((p.eintraege || []).reduce((a, e) => a + e.menge, 0));
    const mengeAuto = r3(p.mengeAuto || 0);
    const menge = r3(mengeAuto + mengeManuell);
    const summe = r2(menge * p.ep);
    const g = nach.get(p.gruppe);
    g.positionen.push({ ...p, mengeAuto, mengeManuell, menge, summe });
    if (p.aktiv) g.summe = r2(g.summe + summe);
    else if (menge) hinweise.push({ typ: 'info', text: `Ausgeblendete Position „${p.bezeichnung}“ hat ${menge.toLocaleString('de-AT')} ${p.einheit} – nicht in der Summe.` });
  }
  const gesamtsumme = r2(gruppen.reduce((a, g) => a + g.summe, 0));
  for (const g of gruppen) g.anteilProzent = gesamtsumme > 0 ? r1((g.summe / gesamtsumme) * 100) : null;
  const basis = auftragGesamt != null && auftragGesamt > 0 ? auftragGesamt : null;
  return {
    gruppen,
    gesamtsumme,
    ergebnis: basis == null ? null : r2(basis - gesamtsumme),
    ergebnisProzent: basis == null ? null : r1(((basis - gesamtsumme) / basis) * 100),
    budgetVerbrauchProzent: basis == null ? null : r1((gesamtsumme / basis) * 100),
    hinweise
  };
}

/* ---------------- Datenbank ---------------- */

/** Katalog aus der Firmenvorlage (Excel + Anpassungen 10d) anlegen (nur wenn leer) */
function katalogAnlegen(db, jetzt = new Date()) {
  if (db.eins('SELECT COUNT(*) AS n FROM katalog').n > 0) return 0;
  const v = ladeKatalogVorlage();
  const t = jetzt.toISOString();
  db.transaktion(() => {
    v.positionen.forEach((p, i) => {
      const q = zuordnungFuer(p.bezeichnung, p.einheit);
      const natur = p.naturmaterial !== undefined ? Boolean(p.naturmaterial) : istNaturmaterial(p.bezeichnung, p.einheit, p.gruppe);
      db.lauf(`INSERT INTO katalog (gruppe, bezeichnung, einheit, ep, sortierung, quelle, zuordnung_pruefen, aktiv, version, geaendert, naturmaterial, naturmaterial_pruefen, herkunft)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)`, p.gruppe, p.bezeichnung.trim(), p.einheit, p.ep, (i + 1) * 10, q ? JSON.stringify(q) : null, q ? 1 : 0, t,
      natur ? 1 : 0, p.gruppe === 'eigenmaterial' ? 1 : 0, p.herkunft || 'vorlage_excel');
    });
    db.setzeEinstellung('katalog_stand', v.stand);
    db.setzeEinstellung('katalog_anpassungen', (v.anpassungen || []).map((a) => a.version));
  });
  return v.positionen.length;
}

/**
 * Versionierte Anpassungen (API.md 10d) einmalig auf einen bestehenden Firmenkatalog anwenden.
 * Bestehende Baustellen bleiben unverändert („Aus Vorlage übernehmen“ je Baustelle).
 */
function katalogAnpassungenAnwenden(db, jetzt = new Date()) {
  const { ladeAnpassungen } = require('./katalog-excel');
  const erledigt = new Set(db.einstellung('katalog_anpassungen', []));
  const t = jetzt.toISOString();
  const neuAngewendet = [];
  for (const a of ladeAnpassungen()) {
    if (erledigt.has(a.version)) continue;
    db.transaktion(() => {
      for (const u of a.umbenennungen || []) {
        db.lauf('UPDATE katalog SET bezeichnung = ?, version = version + 1, geaendert = ? WHERE bezeichnung = ? AND einheit = ?', u.neu, t, u.alt.trim(), u.einheit);
        const q = zuordnungFuer(u.neu, u.einheit);
        if (q) db.lauf('UPDATE katalog SET quelle = ?, zuordnung_pruefen = 1 WHERE bezeichnung = ? AND einheit = ? AND quelle IS NULL', JSON.stringify(q), u.neu, u.einheit);
      }
      for (const p of a.preise || []) db.lauf('UPDATE katalog SET ep = ?, version = version + 1, geaendert = ? WHERE bezeichnung = ? AND einheit = ?', p.ep, t, p.bezeichnung, p.einheit);
      for (const n of a.neu || []) {
        if (db.eins('SELECT id FROM katalog WHERE gruppe = ? AND bezeichnung = ? AND einheit = ?', n.gruppe, n.bezeichnung, n.einheit)) continue;
        const nach = n.nach ? db.eins('SELECT sortierung FROM katalog WHERE gruppe = ? AND bezeichnung = ?', n.gruppe, n.nach) : null;
        const sort = nach ? nach.sortierung + 1 + db.eins('SELECT COUNT(*) AS c FROM katalog WHERE gruppe = ? AND sortierung > ? AND sortierung < ?', n.gruppe, nach.sortierung, nach.sortierung + 10).c
          : (db.eins('SELECT MAX(sortierung) AS m FROM katalog WHERE gruppe = ?', n.gruppe).m || 0) + 10;
        db.lauf(`INSERT INTO katalog (gruppe, bezeichnung, einheit, ep, sortierung, aktiv, version, geaendert, naturmaterial, naturmaterial_pruefen, herkunft)
          VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?, 'preisliste_2026')`, n.gruppe, n.bezeichnung, n.einheit, n.ep, sort, t, n.naturmaterial ? 1 : 0, n.gruppe === 'eigenmaterial' ? 1 : 0);
      }
      db.protokolliere({ zeit: t, benutzerId: null, art: 'katalog', objekt: 'katalog', neu: { version: a.version }, text: `Katalog-Anpassung ${a.version} angewendet: ${a.beschreibung}` });
      db.setzeEinstellung('katalog_anpassungen', [...erledigt, ...neuAngewendet, a.version]);
    });
    neuAngewendet.push(a.version);
  }
  return neuAngewendet;
}

/** Katalog (aktive Positionen) in eine Baustelle kopieren; nur fehlende (nach katalog_id) */
function katalogKopieren(db, baustelleId, jetzt = new Date()) {
  const t = jetzt.toISOString();
  const vorhanden = new Set(db.alle('SELECT katalog_id FROM projektposition WHERE baustelle_id = ? AND katalog_id IS NOT NULL', baustelleId).map((x) => x.katalog_id));
  let n = 0;
  for (const k of db.alle('SELECT * FROM katalog WHERE aktiv = 1 ORDER BY sortierung, id')) {
    if (vorhanden.has(k.id)) continue;
    db.lauf(`INSERT INTO projektposition (baustelle_id, katalog_id, gruppe, bezeichnung, einheit, ep, sortierung, quelle, zuordnung_pruefen, aktiv, version, erstellt, geaendert, naturmaterial, naturmaterial_pruefen, herkunft)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?)`, baustelleId, k.id, k.gruppe, k.bezeichnung, k.einheit, k.ep, k.sortierung, k.quelle, k.zuordnung_pruefen, t, t, k.naturmaterial, k.naturmaterial_pruefen, k.herkunft);
    n++;
  }
  return n;
}

/**
 * Automatische Mengen aus Berichten (Status ≠ entwurf) je Projektposition mit quelle.
 * @returns {{mengen:Map<number,number>, hinweise:Array}}
 */
function autoMengen(db, baustelleId, positionen) {
  const mengen = new Map();
  const hinweise = [];
  // auch ausgeblendete Positionen (für den Hinweis „nicht in der Summe“)
  const mitQuelle = positionen.filter((p) => p.quelle && p.quelle.art !== 'naturmaterial');
  if (!mitQuelle.length) return { mengen, hinweise };
  const personal = db.alle(`SELECT b.lohngruppe_id AS ref, SUM(bp.stunden) AS m FROM bericht_personal bp JOIN bericht r ON r.id = bp.bericht_id
    JOIN benutzer b ON b.id = bp.benutzer_id WHERE r.baustelle_id = ? AND r.status <> 'entwurf' GROUP BY b.lohngruppe_id`, baustelleId);
  const geraete = db.alle(`SELECT g.code AS ref, SUM(bg.stunden) AS m FROM bericht_geraet bg JOIN bericht r ON r.id = bg.bericht_id
    JOIN geraet g ON g.id = bg.geraet_id WHERE r.baustelle_id = ? AND r.status <> 'entwurf' GROUP BY g.code`, baustelleId);
  const material = db.alle(`SELECT m.code AS ref, m.einheit, SUM(bm.menge) AS m FROM bericht_material bm JOIN bericht r ON r.id = bm.bericht_id
    JOIN material m ON m.id = bm.material_id WHERE r.baustelle_id = ? AND r.status <> 'entwurf' GROUP BY m.code`, baustelleId);
  const quellen = { personal, geraet: geraete, material };
  const verwendet = new Map();
  for (const p of mitQuelle) {
    const q = p.quelle;
    const refs = Array.isArray(q.ref) ? q.ref : [q.ref];
    let m = 0;
    for (const z of quellen[q.art] || []) {
      if (!(refs.includes('alle') || refs.includes(z.ref))) continue;
      if (q.art === 'material' && q.faktor == null && einheitNorm(z.einheit) !== einheitNorm(p.einheit)) {
        hinweise.push({ typ: 'warnung', text: `„${p.bezeichnung}“: Material ${z.ref} wird in ${z.einheit} gemeldet, die Position rechnet in ${p.einheit} – bitte Umrechnungsfaktor in der Zuordnung angeben.` });
        continue;
      }
      m += (z.m || 0) * (q.art === 'material' && q.faktor != null ? q.faktor : 1);
      const k = `${q.art}:${z.ref}`;
      if (verwendet.has(k) && verwendet.get(k) !== p.id) hinweise.push({ typ: 'warnung', text: `${q.art} „${z.ref}“ ist mehreren Positionen zugeordnet – Mengen werden doppelt gezählt.` });
      verwendet.set(k, p.id);
    }
    mengen.set(p.id, r3(m));
  }
  return { mengen, hinweise };
}

/**
 * API.md 10a: Positionen mit quelle {art:"naturmaterial"} (Landschaftsabgabe) erhalten als automatische Menge
 * die Summe der Tonnen aller aktiven Naturmaterial-Positionen (Bericht + manuelle Einträge).
 */
function naturmaterialMengen(positionen) {
  const tonnen = r3(positionen.filter((p) => p.aktiv && p.naturmaterial && einheitNorm(p.einheit) === 't')
    .reduce((a, p) => a + (p.mengeAuto || 0) + (p.eintraege || []).reduce((x, e) => x + e.menge, 0), 0));
  for (const p of positionen) if (p.quelle && p.quelle.art === 'naturmaterial' && p.aktiv) p.mengeAuto = tonnen;
  return tonnen;
}

function positionJson(p) {
  return {
    id: p.id, katalogId: p.katalog_id, gruppe: p.gruppe, bezeichnung: p.bezeichnung, einheit: p.einheit, ep: p.ep,
    sortierung: p.sortierung, quelle: parseJson(p.quelle, null), zuordnungPruefen: p.zuordnung_pruefen === 1,
    naturmaterial: p.naturmaterial === 1, naturmaterialPruefen: p.naturmaterial_pruefen === 1, herkunft: p.herkunft,
    aktiv: p.aktiv === 1, version: p.version
  };
}

/** Projektpositionen einer Baustelle inkl. Mengen und Summen (mit €-Werten – nur nach Rechteprüfung ausliefern) */
function projektPositionen(db, bs, auftragGesamt) {
  const zeilen = db.alle('SELECT * FROM projektposition WHERE baustelle_id = ? ORDER BY gruppe, sortierung, id', bs.id).map(positionJson);
  const eintraege = new Map();
  for (const e of db.alle(`SELECT m.*, b.name AS von_name FROM projektposition_menge m JOIN projektposition p ON p.id = m.position_id
      LEFT JOIN benutzer b ON b.id = m.erstellt_von WHERE p.baustelle_id = ? ORDER BY m.datum, m.id`, bs.id)) {
    if (!eintraege.has(e.position_id)) eintraege.set(e.position_id, []);
    eintraege.get(e.position_id).push({ id: e.id, datum: e.datum, menge: e.menge, notiz: e.notiz, erstellt: e.erstellt, erstelltVon: e.erstellt_von, erstelltVonName: e.von_name });
  }
  const auto = autoMengen(db, bs.id, zeilen);
  const mitMengen = zeilen.map((p) => ({ ...p, mengeAuto: auto.mengen.get(p.id) || 0, eintraege: eintraege.get(p.id) || [] }));
  naturmaterialMengen(mitMengen);
  const r = berechnePositionen(mitMengen, auftragGesamt);
  return { baustelleId: bs.id, auftragGesamt: auftragGesamt == null ? null : auftragGesamt, ...r, hinweise: [...auto.hinweise, ...r.hinweise] };
}

module.exports = { einheitNorm, naturmaterialMengen, berechnePositionen, katalogAnlegen, katalogAnpassungenAnwenden, katalogKopieren, autoMengen, projektPositionen, positionJson };
