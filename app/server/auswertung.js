'use strict';
/**
 * Tages-/Wochen-/Monatswerte aus Buchungen und Abwesenheiten.
 * Annahme Überstunden (im Konzept als „Prüfen“ markiert, konfigurierbar über Einstellung 'arbeitszeit'):
 * über der Normalarbeitszeit je Tag (Mo–Do 8 Std., Fr 7 Std.) bzw. über der Wochenarbeitszeit 39 Std.
 *
 * Stunden je Person und Tag (M-07): Für Baustellen mit einem FREIGEGEBENEN Bericht, der eine Zeile dieser
 * Person enthält, gelten die Berichtsstunden; sonst die Stempelzeiten. Unplausible Schichten (> 16 Std.,
 * vergessenes Ausstempeln) zählen mit 0 Std. und werden gekennzeichnet (B-05).
 * Abwesenheiten zählen nur mit Status „genehmigt“ (B-07).
 */
const { schichten, plausibilisieren } = require('./stempel');
const { azgWarnungen } = require('./azg');
const { wienZuDate, plusTage, wochentag, wochenbeginn, tageImMonat, feiertag, WT_KURZ, wienZeit } = require('./datum');

const STANDARD_ARBEITSZEIT = { tagNormal: [0, 8, 8, 8, 8, 7, 0], wocheNormal: 39 };
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

function arbeitszeitConfig(db) {
  const c = db ? db.einstellung('arbeitszeit', null) : null;
  return c && Array.isArray(c.tagNormal) && c.tagNormal.length === 7 ? c : STANDARD_ARBEITSZEIT;
}

/**
 * Überstunden für einen Wochen(abschnitt): max(Σ Tagesüberschreitungen, Σ Stunden − Σ Soll der Tage)
 * @param {Array<{datum:string, stunden:number}>} tage  Tage einer Kalenderwoche (Mo–So, ggf. Teil)
 */
function ueberstundenWoche(tage, cfg = STANDARD_ARBEITSZEIT) {
  let taeglich = 0, summe = 0, soll = 0;
  for (const t of tage) {
    const n = feiertag(t.datum) ? 0 : cfg.tagNormal[wochentag(t.datum)];
    taeglich += Math.max(0, t.stunden - n);
    summe += t.stunden;
    soll += n;
  }
  return r2(Math.max(taeglich, summe - soll, 0));
}

/** Überstunden über mehrere Tage, je Kalenderwoche gerechnet */
function ueberstundenZeitraum(tage, cfg) {
  const wochen = new Map();
  for (const t of tage) {
    const w = wochenbeginn(t.datum);
    if (!wochen.has(w)) wochen.set(w, []);
    wochen.get(w).push(t);
  }
  let u = 0;
  for (const w of wochen.values()) u += ueberstundenWoche(w, cfg);
  return r2(u);
}

/**
 * Lädt Schichten eines Benutzers für [vonDatum, bisDatum] (Wiener Tage) inkl. Puffer.
 * @returns {Array} Schichten (alle im Puffer) – filtern nach datum durch Aufrufer
 */
function ladeSchichten(db, benutzerId, vonDatum, bisDatum, jetzt) {
  const von = wienZuDate(plusTage(vonDatum, -2)).toISOString();
  const bis = wienZuDate(plusTage(bisDatum, 2)).toISOString();
  const b = db.alle(`SELECT typ, zeit, baustelle_id AS baustelleId FROM buchung WHERE benutzer_id = ? AND zeit >= ? AND zeit < ? ORDER BY zeit, id`, benutzerId, von, bis);
  return schichten(b, jetzt);
}

/** Tageswerte je Datum aus Schichten */
function tageswerte(schichtListe, daten, baustellenNamen) {
  const out = new Map(daten.map((d) => [d, { datum: d, stunden: 0, pauseMin: 0, von: null, bis: null, baustellen: new Map(), offen: false, unplausibel: false }]));
  for (const s of schichtListe) {
    const t = out.get(s.datum);
    if (!t) continue;
    if (s.unplausibel) { t.unplausibel = true; if (!t.von) t.von = wienZeit(new Date(s.start)); continue; }
    t.stunden += s.arbeitMin / 60;
    t.pauseMin += s.pauseMin;
    if (s.offen) t.offen = true;
    const von = wienZeit(new Date(s.start));
    const bis = s.offen ? null : wienZeit(new Date(s.ende));
    if (!t.von) t.von = von;
    t.bis = bis;
    for (const i of s.intervalle) {
      if (i.art !== 'arbeit') continue;
      const x = t.baustellen.get(i.baustelleId) || 0;
      t.baustellen.set(i.baustelleId, x + (i.bis - i.von) / 3600000);
    }
  }
  return [...out.values()].map((t) => ({
    ...t,
    stunden: r2(t.stunden),
    baustellen: [...t.baustellen.entries()].map(([id, st]) => ({ id, kst: (baustellenNamen.get(id) || {}).kst, name: (baustellenNamen.get(id) || {}).kurz || (baustellenNamen.get(id) || {}).name, stunden: r2(st) }))
  }));
}

function baustellenMap(db) {
  return new Map(db.alle('SELECT id, kst, name, kurz FROM baustelle').map((b) => [b.id, b]));
}

/** Zeilen aus FREIGEGEBENEN Berichten je Benutzer und Datum: Map "id|datum" → [Zeile] */
function berichtsZeilen(db, vonDatum, bisDatum, benutzerId = null) {
  const z = db.alle(`SELECT bp.benutzer_id, bp.stunden, bp.von1, bp.bis1, bp.von2, bp.bis2, bp.pause_min, r.datum, r.baustelle_id
    FROM bericht_personal bp JOIN bericht r ON r.id = bp.bericht_id
    WHERE r.status = 'freigegeben' AND r.datum BETWEEN ? AND ? ${benutzerId ? 'AND bp.benutzer_id = ?' : ''}`,
  ...[vonDatum, bisDatum, ...(benutzerId ? [benutzerId] : [])]);
  const m = new Map();
  for (const x of z) {
    const k = `${x.benutzer_id}|${x.datum}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

/** Tageswert aus Stempelung (t) und freigegebenen Berichtszeilen zusammenführen (M-07) */
function mitBericht(t, zeilen, bsMap) {
  const nurMitZeit = (zeilen || []).filter((z) => z.stunden > 0 || z.von1);
  if (!nurMitZeit.length) return { ...t, quelle: t.stunden > 0 || t.von ? 'stempel' : null };
  const gedeckt = new Set(nurMitZeit.map((z) => z.baustelle_id));
  const stempelRest = t.baustellen.filter((b) => !gedeckt.has(b.id));
  const restStunden = stempelRest.reduce((a, b) => a + b.stunden, 0);
  const berichtStunden = nurMitZeit.reduce((a, z) => a + z.stunden, 0);
  const name = (id) => (bsMap.get(id) || {});
  const baustellen = [
    ...nurMitZeit.map((z) => ({ id: z.baustelle_id, kst: name(z.baustelle_id).kst, name: name(z.baustelle_id).kurz || name(z.baustelle_id).name, stunden: r2(z.stunden) })),
    ...stempelRest
  ];
  const erste = nurMitZeit[0];
  return {
    ...t,
    stunden: r2(berichtStunden + restStunden),
    von: t.von && !t.unplausibel ? t.von : erste.von1,
    bis: t.von && !t.unplausibel ? t.bis : (erste.bis2 || erste.bis1),
    pauseMin: t.von && !t.unplausibel ? t.pauseMin : nurMitZeit.reduce((a, z) => a + (z.pause_min || 0), 0),
    baustellen,
    quelle: restStunden > 0 ? 'gemischt' : 'bericht'
  };
}

/** Eigene Woche (Mo–So) */
function woche(db, benutzerId, datum, jetzt) {
  const mo = wochenbeginn(datum);
  const daten = Array.from({ length: 7 }, (_, i) => plusTage(mo, i));
  const sch = plausibilisieren(ladeSchichten(db, benutzerId, daten[0], daten[6], jetzt), jetzt);
  const abw = new Map(db.alle("SELECT datum, code, status FROM abwesenheit WHERE benutzer_id = ? AND datum BETWEEN ? AND ? AND status <> 'abgelehnt'", benutzerId, daten[0], daten[6]).map((a) => [a.datum, a]));
  const bsMap = baustellenMap(db);
  const ber = berichtsZeilen(db, daten[0], daten[6], benutzerId);
  const tage = tageswerte(sch, daten, bsMap).map((t0) => {
    const t = mitBericht(t0, ber.get(`${benutzerId}|${t0.datum}`), bsMap);
    const a = abw.get(t.datum);
    const o = { datum: t.datum, wochentag: WT_KURZ[wochentag(t.datum)], stunden: t.stunden, pauseMin: t.pauseMin, von: t.von, bis: t.bis, baustellen: t.baustellen };
    if (t.quelle) o.quelle = t.quelle;
    if (t.unplausibel) o.unplausibel = true;
    if (a) { o.code = a.code; o.codeStatus = a.status; }
    const f = feiertag(t.datum);
    if (f) o.feiertag = f;
    return o;
  });
  const cfg = arbeitszeitConfig(db);
  const summe = r2(tage.reduce((x, t) => x + t.stunden, 0));
  return { von: daten[0], bis: daten[6], tage, summe, ueberstunden: ueberstundenWoche(tage, cfg), sollStunden: cfg.wocheNormal };
}

/** Monatsauswertung für alle (aktiven oder mit Buchungen/Berichtszeilen) Mitarbeiter */
function monat(db, monatStr, jetzt) {
  const daten = tageImMonat(monatStr);
  const erster = daten[0], letzter = daten[daten.length - 1];
  const cfg = arbeitszeitConfig(db);
  const bsMap = baustellenMap(db);
  const tage = daten.map((d) => ({ datum: d, wochentag: WT_KURZ[wochentag(d)], feiertag: feiertag(d), arbeitstag: wochentag(d) >= 1 && wochentag(d) <= 5 && !feiertag(d) }));
  const vonIso = wienZuDate(erster).toISOString();
  const bisIso = wienZuDate(plusTage(letzter, 1)).toISOString();
  const ber = berichtsZeilen(db, erster, letzter);
  const mitDaten = new Set(db.alle('SELECT DISTINCT benutzer_id FROM buchung WHERE zeit >= ? AND zeit < ?', vonIso, bisIso).map((z) => z.benutzer_id));
  for (const k of ber.keys()) mitDaten.add(Number(k.split('|')[0]));
  const benutzer = db.alle('SELECT id, name, rolle, lohngruppe_id, pnr, aktiv FROM benutzer ORDER BY name')
    .filter((b) => mitDaten.has(b.id) || (b.aktiv && ['mitarbeiter', 'polier'].includes(b.rolle)));
  // M-01: SEG-Stunden nur aus freigegebenen Berichten
  const seg = new Map(db.alle(`SELECT bp.benutzer_id, SUM(bp.seg_stunden) AS s FROM bericht_personal bp JOIN bericht r ON r.id = bp.bericht_id
    WHERE r.status = 'freigegeben' AND r.datum BETWEEN ? AND ? GROUP BY bp.benutzer_id`, erster, letzter).map((z) => [z.benutzer_id, z.s || 0]));
  const warnungen = [];
  const beantragt = [];
  const offeneSchichten = [];
  const mitarbeiter = benutzer.map((b) => {
    const roh = ladeSchichten(db, b.id, erster, letzter, jetzt);
    const sch = plausibilisieren(roh, jetzt);
    const tw = tageswerte(sch, daten, bsMap).map((t) => mitBericht(t, ber.get(`${b.id}|${t.datum}`), bsMap));
    const abw = new Map(db.alle("SELECT datum, code, status FROM abwesenheit WHERE benutzer_id = ? AND datum BETWEEN ? AND ? AND status <> 'abgelehnt'", b.id, erster, letzter).map((a) => [a.datum, a]));
    const tageObj = {};
    let sw = 0, k = 0, u = 0, za = 0, swStunden = 0;
    for (const t of tw) {
      const a = abw.get(t.datum);
      if (!t.stunden && !a && !t.unplausibel && !t.von) continue;
      const genehmigt = a && a.status === 'genehmigt';
      const e = { stunden: t.stunden, code: genehmigt ? a.code : null };
      if (t.von) { e.von = t.von; e.bis = t.bis; e.pauseMin = t.pauseMin; e.baustellen = t.baustellen.map((x) => x.kst).filter(Boolean); }
      if (t.quelle) e.quelle = t.quelle;
      if (a && !genehmigt) { e.code = a.code; e.codeStatus = a.status; beantragt.push({ benutzerId: b.id, name: b.name, datum: t.datum, code: a.code }); }
      if (t.unplausibel && t.quelle !== 'bericht') {
        e.unplausibel = true;
        offeneSchichten.push({ benutzerId: b.id, name: b.name, datum: t.datum, beginn: t.von, text: 'Schicht über 16 Std. bzw. nicht ausgestempelt – zählt mit 0 Std., bitte korrigieren.' });
      }
      tageObj[t.datum] = e;
      if (genehmigt) {
        if (a.code === 'SW') { sw++; swStunden += Math.max(0, (feiertag(t.datum) ? 0 : cfg.tagNormal[wochentag(t.datum)]) - t.stunden); }
        if (a.code === 'K') k++;
        if (a.code === 'U') u++;
        if (a.code === 'ZA') za++;
      }
    }
    const summe = r2(tw.reduce((x, t) => x + t.stunden, 0));
    const ueberstunden = ueberstundenZeitraum(tw, cfg);
    for (const w of azgWarnungen(roh, { jetzt })) {
      if (w.datum >= erster && w.datum <= letzter) warnungen.push({ benutzerId: b.id, name: b.name, ...w });
    }
    return {
      id: b.id, name: b.name, pnr: b.pnr, lohngruppe: b.lohngruppe_id, tage: tageObj, summe,
      normal: r2(summe - ueberstunden), ueberstunden, sw, swStunden: r2(swStunden), k, u, za, seg: r2(seg.get(b.id) || 0)
    };
  });
  return {
    monat: monatStr, tage, mitarbeiter, warnungen, beantragt, offeneSchichten,
    annahmen: {
      tagNormal: cfg.tagNormal, wocheNormal: cfg.wocheNormal,
      hinweis: 'Überstunden-Regel ist eine Annahme (Prüfen mit Lohnverrechnung). Stunden aus freigegebenen Berichten haben Vorrang vor Stempelzeiten. Nur genehmigte Abwesenheiten zählen.'
    }
  };
}

module.exports = { STANDARD_ARBEITSZEIT, arbeitszeitConfig, ueberstundenWoche, ueberstundenZeitraum, ladeSchichten, tageswerte, berichtsZeilen, mitBericht, woche, monat };
