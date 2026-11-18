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
    // E-06: jede Menge auf 3 Stellen, Summe = RUNDEN(Menge × EP; 2) – wie im Excel-Export
    const mengeManuell = r3((p.eintraege || []).reduce((a, e) => a + r3(e.menge), 0));
    const mengeAuto = r3(p.mengeAuto || 0);
    const menge = r3(mengeAuto + mengeManuell);
    let summe = r2(menge * p.ep);
    const extra = {};
    if (p.epStaende && p.epStaende.length > 1) {
      extra.perioden = perioden(p, p.epStaende);
      summe = r2(extra.perioden.reduce((a, x) => a + x.summe, 0));
    }
    const g = nach.get(p.gruppe);
    const { epStaende, mengeAutoNachDatum, ...ohne } = p; // eslint-disable-line no-unused-vars
    g.positionen.push({ ...ohne, mengeAuto, mengeManuell, menge, summe, ...extra });
    if (p.aktiv) g.summe = r2(g.summe + summe);
    else if (menge) hinweise.push({ typ: 'info', text: `Ausgeblendete Position „${p.bezeichnung}“ hat ${menge.toLocaleString('de-AT')} ${p.einheit} – nicht in der Summe.` });
  }
  const gesamtsumme = r2(gruppen.reduce((a, g) => a + g.summe, 0));
  for (const g of gruppen) g.anteilProzent = gesamtsumme > 0 ? r1((g.summe / gesamtsumme) * 100) : null;
  const anteilSummeProzent = gesamtsumme > 0 ? r1(gruppen.reduce((a, g) => a + (g.anteilProzent || 0), 0)) : null;
  const basis = auftragGesamt != null && auftragGesamt > 0 ? auftragGesamt : null;
  return {
    gruppen,
    gesamtsumme,
    anteilSummeProzent,
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
      for (const p of a.preise || []) {
        db.lauf('UPDATE katalog SET ep = ?, version = version + 1, geaendert = ? WHERE bezeichnung = ? AND einheit = ?', p.ep, t, p.bezeichnung, p.einheit);
        // gibt es schon Preis-Stände (12.2), wird die Anpassung ein Stand ab heute (sonst setzte der Abgleich zurück)
        for (const k of db.alle("SELECT k.id FROM katalog k WHERE k.bezeichnung = ? AND k.einheit = ? AND EXISTS (SELECT 1 FROM preis_stand s WHERE s.art = 'katalog' AND s.ref = CAST(k.id AS TEXT))", p.bezeichnung, p.einheit)) {
          require('./preise-verlauf').setzePreis(db, { art: 'katalog', ref: k.id, feld: 'ep', wert: p.ep, gueltigAb: require('./datum').wienDatum(jetzt), jetzt });
        }
      }
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

/**
 * E-03: einmalige Übernahme für Bestands-Datenbanken.
 * - Baustellen ohne Projektpositionen erhalten den aktuellen Katalog (Zuordnungen „bitte prüfen“)
 * - alte Budget-Alarm-Zeilen (Basis interne Kosten) werden gelöscht, damit die Alarme auf der neuen Basis neu greifen
 * @returns {{kopiert:string[], alarmeGeloescht:number|null}}
 */
function bestandUebernehmen(db, jetzt = new Date()) {
  const t = jetzt.toISOString();
  const kopiert = [];
  let alarmeGeloescht = null;
  db.transaktion(() => {
    if (!db.einstellung('positionen_bestand', false)) {
      for (const b of db.alle('SELECT id, kst FROM baustelle ORDER BY kst')) {
        if (db.eins('SELECT COUNT(*) AS n FROM projektposition WHERE baustelle_id = ?', b.id).n === 0) {
          katalogKopieren(db, b.id, jetzt);
          kopiert.push(b.kst);
        }
      }
      db.setzeEinstellung('positionen_bestand', true);
      if (kopiert.length) db.protokolliere({ zeit: t, benutzerId: null, art: 'nachkalkulation', objekt: 'baustellen', neu: { baustellen: kopiert }, text: `Positionskatalog in ${kopiert.length} bestehende Baustelle(n) übernommen (Zuordnungen bitte prüfen)` });
    }
    if (db.einstellung('budget_basis', null) !== 'positionen') {
      alarmeGeloescht = db.lauf('DELETE FROM budget_alarm').changes;
      db.setzeEinstellung('budget_basis', 'positionen');
      if (alarmeGeloescht) db.protokolliere({ zeit: t, benutzerId: null, art: 'budget_alarm', objekt: 'baustellen', text: `Budget-Basis auf Nachkalkulationssumme umgestellt: ${alarmeGeloescht} alte Alarm-Zeile(n) gelöscht, Alarme werden neu bewertet` });
    }
  });
  return { kopiert, alarmeGeloescht };
}

/** Katalog (aktive Positionen) in eine Baustelle kopieren; nur fehlende (nach katalog_id) */
function katalogKopieren(db, baustelleId, jetzt = new Date()) {
  const t = jetzt.toISOString();
  const PV = require('./preise-verlauf');
  const heute = require('./datum').wienDatum(jetzt);
  const vorhanden = new Set(db.alle('SELECT katalog_id FROM projektposition WHERE baustelle_id = ? AND katalog_id IS NOT NULL', baustelleId).map((x) => x.katalog_id));
  let n = 0;
  for (const k of db.alle('SELECT * FROM katalog WHERE aktiv = 1 ORDER BY sortierung, id')) {
    if (vorhanden.has(k.id)) continue;
    const ins = db.lauf(`INSERT INTO projektposition (baustelle_id, katalog_id, gruppe, bezeichnung, einheit, ep, sortierung, quelle, zuordnung_pruefen, aktiv, version, erstellt, geaendert, naturmaterial, naturmaterial_pruefen, herkunft)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?)`, baustelleId, k.id, k.gruppe, k.bezeichnung, k.einheit, k.ep, k.sortierung, k.quelle, k.zuordnung_pruefen, t, t, k.naturmaterial, k.naturmaterial_pruefen, k.herkunft);
    // API.md 12.2: angekündigte (künftige) Katalogpreise gelten auch in der neuen Baustelle
    for (const st of db.alle("SELECT wert, gueltig_ab FROM preis_stand WHERE art = 'katalog' AND ref = ? AND feld = 'ep' AND gueltig_ab > ? ORDER BY gueltig_ab", String(k.id), heute)) {
      PV.setzePreis(db, { art: 'projektposition', ref: ins.id, feld: 'ep', wert: st.wert, gueltigAb: st.gueltig_ab, jetzt });
    }
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
  const nachDatum = new Map();
  const hinweise = [];
  // auch ausgeblendete Positionen (für den Hinweis „nicht in der Summe“)
  const mitQuelle = positionen.filter((p) => p.quelle && p.quelle.art !== 'naturmaterial');
  if (!mitQuelle.length) return { mengen, nachDatum, hinweise };
  // je Quelle und Berichtsdatum (API.md 12.2: Mengen zählen zum Berichtsdatum)
  const gruppiert = (zeilen) => {
    const m = new Map();
    for (const z of zeilen) {
      if (!m.has(z.ref)) m.set(z.ref, { ref: z.ref, einheit: z.einheit, m: 0, tage: [] });
      const x = m.get(z.ref);
      x.m += z.m || 0;
      x.tage.push({ datum: z.datum, m: z.m || 0 });
    }
    return [...m.values()];
  };
  // 12.22: Stunden nach der Lohngruppe, die die Person am Berichtstag hatte
  const personal = gruppiert(db.alle(`SELECT ${require('./lohngruppen').lgAm('b', 'r.datum')} AS ref, r.datum, SUM(bp.stunden) AS m FROM bericht_personal bp JOIN bericht r ON r.id = bp.bericht_id
    JOIN benutzer b ON b.id = bp.benutzer_id WHERE r.baustelle_id = ? AND r.status <> 'entwurf' GROUP BY ref, r.datum`, baustelleId));
  const geraete = gruppiert(db.alle(`SELECT g.code AS ref, r.datum, SUM(bg.stunden) AS m FROM bericht_geraet bg JOIN bericht r ON r.id = bg.bericht_id
    JOIN geraet g ON g.id = bg.geraet_id WHERE r.baustelle_id = ? AND r.status <> 'entwurf' GROUP BY g.code, r.datum`, baustelleId));
  const material = gruppiert(db.alle(`SELECT m.code AS ref, m.einheit, r.datum, SUM(bm.menge) AS m FROM bericht_material bm JOIN bericht r ON r.id = bm.bericht_id
    JOIN material m ON m.id = bm.material_id WHERE r.baustelle_id = ? AND r.status <> 'entwurf' GROUP BY m.code, r.datum`, baustelleId));
  const quellen = { personal, geraet: geraete, material };
  const verwendet = new Map();
  const gemeldet = new Set();
  for (const p of mitQuelle) {
    const q = p.quelle;
    const refs = Array.isArray(q.ref) ? q.ref : [q.ref];
    let m = 0;
    const tage = new Map();
    for (const z of quellen[q.art] || []) {
      if (!(refs.includes('alle') || refs.includes(z.ref))) continue;
      if (q.art === 'material' && q.faktor == null && einheitNorm(z.einheit) !== einheitNorm(p.einheit)) {
        hinweise.push({ typ: 'warnung', text: `„${p.bezeichnung}“: Material ${z.ref} wird in ${z.einheit} gemeldet, die Position rechnet in ${p.einheit} – bitte Umrechnungsfaktor in der Zuordnung angeben.` });
        continue;
      }
      const f = q.art === 'material' && q.faktor != null ? q.faktor : 1;
      m += (z.m || 0) * f;
      for (const t of z.tage) tage.set(t.datum, (tage.get(t.datum) || 0) + t.m * f);
      const k = `${q.art}:${z.ref}`;
      // E-09: Mehrfachzuordnung nur unter aktiven Positionen melden (einmal je Eintrag)
      if (p.aktiv) {
        if (verwendet.has(k) && verwendet.get(k) !== p.id && !gemeldet.has(k)) {
          hinweise.push({ typ: 'warnung', text: `${q.art} „${z.ref}“ ist mehreren Positionen zugeordnet – Mengen werden doppelt gezählt.` });
          gemeldet.add(k);
        }
        verwendet.set(k, p.id);
      }
    }
    nachDatum.set(p.id, tage);
    mengen.set(p.id, r3(m));
  }
  return { mengen, nachDatum, hinweise };
}

/**
 * API.md 10a: Positionen mit quelle {art:"naturmaterial"} (Landschaftsabgabe) erhalten als automatische Menge
 * die Summe der Tonnen aller aktiven Naturmaterial-Positionen (Bericht + manuelle Einträge).
 */
function naturmaterialMengen(positionen) {
  const natur = positionen.filter((p) => p.aktiv && p.naturmaterial && einheitNorm(p.einheit) === 't');
  const tonnen = r3(natur.reduce((a, p) => a + r3(p.mengeAuto || 0) + (p.eintraege || []).reduce((x, e) => x + r3(e.menge), 0), 0));
  // je Datum (API.md 12.2): Berichtsmengen am Berichtsdatum, Einträge an ihrem Datum
  const tage = new Map();
  for (const p of natur) {
    for (const [d, m] of p.mengeAutoNachDatum || []) tage.set(d, (tage.get(d) || 0) + m);
    for (const e of p.eintraege || []) tage.set(e.datum, (tage.get(e.datum) || 0) + r3(e.menge));
  }
  for (const p of positionen) {
    if (p.quelle && p.quelle.art === 'naturmaterial' && p.aktiv) { p.mengeAuto = tonnen; p.mengeAutoNachDatum = tage; }
  }
  return tonnen;
}

/**
 * Perioden je EP-Stand (API.md 12.2): Menge je Zeitraum, Summe = RUNDEN(Menge × EP; 2).
 * @param {Array<{gueltig_ab, wert}>} staende aufsteigend
 * @returns {Array<{gueltigAb, bis, ep, menge, summe}>}
 */
function perioden(p, staende) {
  const tage = new Map();
  for (const [d, m] of p.mengeAutoNachDatum || []) tage.set(d, (tage.get(d) || 0) + m);
  for (const e of p.eintraege || []) tage.set(e.datum, (tage.get(e.datum) || 0) + r3(e.menge));
  return staende.map((s, i) => {
    const ab = s.gueltig_ab;
    const naechst = staende[i + 1] ? staende[i + 1].gueltig_ab : null;
    let menge = 0;
    for (const [d, m] of tage) if (d >= ab && (!naechst || d < naechst)) menge += m;
    menge = r3(menge);
    const bis = naechst ? new Date(Date.parse(`${naechst}T12:00:00Z`) - 864e5).toISOString().slice(0, 10) : null;
    return { gueltigAb: ab, bis, ep: s.wert, menge, summe: r2(menge * s.wert) };
  });
}

function positionJson(p) {
  return {
    id: p.id, katalogId: p.katalog_id, gruppe: p.gruppe, bezeichnung: p.bezeichnung, einheit: p.einheit, ep: p.ep,
    sortierung: p.sortierung, quelle: parseJson(p.quelle, null), zuordnungPruefen: p.zuordnung_pruefen === 1,
    naturmaterial: p.naturmaterial === 1, naturmaterialPruefen: p.naturmaterial_pruefen === 1, naturmaterialMoeglich: einheitNorm(p.einheit) === 't', herkunft: p.herkunft,
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
  const staende = require('./preise-verlauf').epStaendeBaustelle(db, bs.id);
  const mitMengen = zeilen.map((p) => ({
    ...p, mengeAuto: auto.mengen.get(p.id) || 0, mengeAutoNachDatum: auto.nachDatum.get(p.id) || new Map(), eintraege: eintraege.get(p.id) || [],
    ...(staende.has(p.id) ? { epStaende: staende.get(p.id) } : {})
  }));
  naturmaterialMengen(mitMengen);
  const r = berechnePositionen(mitMengen, auftragGesamt);
  // API.md 12.20: Soll aus dem LV (zugeordnete LV-Positionen)
  const soll = new Map();
  for (const l of db.alle('SELECT projektposition_id AS pid, SUM(menge) AS menge, SUM(gp) AS gp FROM lv_position WHERE baustelle_id = ? AND projektposition_id IS NOT NULL GROUP BY projektposition_id', bs.id)) soll.set(l.pid, l);
  // API.md 12.2: Stand des heutigen EP und geplante EP je Position
  const heute = require('./datum').wienDatum(db.uhr ? db.uhr() : new Date());
  for (const g of r.gruppen) {
    for (const p of g.positionen) {
      const st = staende.get(p.id);
      p.epAb = st ? st.filter((x) => x.gueltig_ab <= heute).reduce((a, x) => x.gueltig_ab, '2000-01-01') : '2000-01-01';
      const sl = soll.get(p.id);
      if (sl) p.soll = { menge: sl.menge, gp: Math.round((sl.gp || 0) * 100) / 100, ep: sl.menge ? Math.round(((sl.gp || 0) / sl.menge) * 100) / 100 : null };
      if (st && st.some((x) => x.gueltig_ab > heute)) p.epGeplant = st.filter((x) => x.gueltig_ab > heute).map((x) => ({ id: x.id, ep: x.wert, gueltigAb: x.gueltig_ab }));
    }
  }
  const hinweise = [...auto.hinweise, ...r.hinweise];
  const natur = zeilen.filter((p) => p.aktiv && p.quelle && p.quelle.art === 'naturmaterial');
  if (natur.length > 1) hinweise.push({ typ: 'warnung', text: `${natur.length} aktive Positionen rechnen die Landschaftsabgabe aus den Tonnen Naturmaterial (${natur.map((p) => `„${p.bezeichnung}“`).join(', ')}) – sie wird mehrfach gezählt.` });
  const positionenFehlen = zeilen.filter((p) => p.aktiv).length === 0;
  if (positionenFehlen) {
    r.budgetVerbrauchProzent = null;
    hinweise.unshift({ typ: 'warnung', text: 'Diese Baustelle hat noch keine Positionen – Budget-Verbrauch nicht berechenbar. Bitte „Aus Vorlage übernehmen“.' });
  }
  return { baustelleId: bs.id, auftragGesamt: auftragGesamt == null ? null : auftragGesamt, ...r, positionenFehlen, hinweise };
}

module.exports = { einheitNorm, naturmaterialMengen, berechnePositionen, katalogAnlegen, katalogAnpassungenAnwenden, bestandUebernehmen, katalogKopieren, autoMengen, projektPositionen, positionJson };
