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
const { schichten, plausibilisieren, bloeckeAlsZeitpunkte } = require('./stempel');
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
  const out = new Map(daten.map((d) => [d, { datum: d, stunden: 0, pauseMin: 0, von: null, bis: null, baustellen: new Map(), intervalle: [], offen: false, unplausibel: false }]));
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
      t.intervalle.push({ baustelleId: i.baustelleId, von: i.von, bis: i.bis });
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

/**
 * Freigegebene Berichte im Zeitraum: zeilen = Map "id|datum" → [Zeile], gedeckt = Map datum → Set(baustelleId)
 */
function berichtsZeilen(db, vonDatum, bisDatum, benutzerId = null) {
  const z = db.alle(`SELECT bp.benutzer_id, bp.stunden, bp.von1, bp.bis1, bp.von2, bp.bis2, bp.pause_min, bp.code, r.datum, r.baustelle_id
    FROM bericht_personal bp JOIN bericht r ON r.id = bp.bericht_id
    WHERE r.status = 'freigegeben' AND r.datum BETWEEN ? AND ? ${benutzerId ? 'AND bp.benutzer_id = ?' : ''}`,
  ...[vonDatum, bisDatum, ...(benutzerId ? [benutzerId] : [])]);
  const zeilen = new Map();
  for (const x of z) {
    const k = `${x.benutzer_id}|${x.datum}`;
    if (!zeilen.has(k)) zeilen.set(k, []);
    zeilen.get(k).push(x);
  }
  const gedeckt = new Map();
  for (const r of db.alle("SELECT baustelle_id, datum FROM bericht WHERE status = 'freigegeben' AND datum BETWEEN ? AND ?", vonDatum, bisDatum)) {
    if (!gedeckt.has(r.datum)) gedeckt.set(r.datum, new Set());
    gedeckt.get(r.datum).add(r.baustelle_id);
  }
  return { zeilen, gedeckt };
}

const ueberlappungMs = (a, b) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));

/**
 * Tageswert aus Stempelung (t) und freigegebenen Berichten (M-07, C-01, C-03):
 * - Baustellen mit freigegebenem Bericht: nur der Bericht zählt (auch 0 Std. oder Person fehlt → 0, Warnung)
 * - andere Baustellen: Stempelzeiten
 * - Überschneidungen (Bericht ↔ Stempel anderer Baustellen, Bericht ↔ Bericht) zählen nur einmal (Warnung)
 */
function mitBericht(t, zeilen, gedeckt, bsMap) {
  const rows = zeilen || [];
  const gedecktSet = gedeckt || new Set();
  const stempelGedeckt = t.baustellen.filter((b) => gedecktSet.has(b.id));
  if (!rows.length && !stempelGedeckt.length) return { ...t, quelle: t.stunden > 0 || t.von ? 'stempel' : null, warnungen: [] };
  const name = (id) => (bsMap.get(id) || {});
  const warnungen = [];
  for (const b of stempelGedeckt) {
    if (b.stunden > 0 && !rows.some((z) => z.baustelle_id === b.id)) {
      warnungen.push({ typ: 'nicht_im_bericht', text: `${b.stunden.toLocaleString('de-AT')} Std. auf ${b.kst} gestempelt, aber nicht im freigegebenen Bericht – zählt mit 0 Std.` });
    }
  }
  const stempelRest = t.baustellen.filter((b) => !gedecktSet.has(b.id));
  const restIv = (t.intervalle || []).filter((i) => !gedecktSet.has(i.baustelleId)).map((i) => [i.von, i.bis]);
  const restStunden = stempelRest.reduce((a, b) => a + b.stunden, 0);
  const berichtStunden = rows.reduce((a, z) => a + (z.stunden || 0), 0);
  // Sicherheitsnetz gegen Doppelzählung
  const bIv = rows.map((z) => ({ bs: z.baustelle_id, iv: bloeckeAlsZeitpunkte(t.datum, z) }));
  let ueberMs = 0;
  for (let i = 0; i < bIv.length; i++) {
    for (const a of bIv[i].iv) {
      for (const r of restIv) ueberMs += ueberlappungMs(a, r);
      for (let j = i + 1; j < bIv.length; j++) for (const b of bIv[j].iv) ueberMs += ueberlappungMs(a, b);
    }
  }
  const ueberStunden = ueberMs / 3600000;
  if (ueberStunden > 0) {
    warnungen.push({ typ: 'ueberschneidung', text: `Bericht- und Stempelzeiten überschneiden sich um ${r2(ueberStunden).toLocaleString('de-AT')} Std. – nur einmal gezählt, bitte prüfen.` });
  }
  const mitZeit = rows.filter((z) => z.von1);
  const baustellen = [
    ...rows.filter((z) => z.stunden > 0 || z.von1).map((z) => ({ id: z.baustelle_id, kst: name(z.baustelle_id).kst, name: name(z.baustelle_id).kurz || name(z.baustelle_id).name, stunden: r2(z.stunden) })),
    ...stempelRest
  ];
  const stempelSichtbar = t.von && !t.unplausibel && restStunden > 0;
  const erste = mitZeit[0];
  return {
    ...t,
    stunden: r2(Math.max(0, berichtStunden + restStunden - ueberStunden)),
    von: stempelSichtbar || !erste ? (t.unplausibel ? (erste ? erste.von1 : t.von) : t.von) : erste.von1,
    bis: stempelSichtbar || !erste ? (t.unplausibel ? (erste ? erste.bis2 || erste.bis1 : null) : t.bis) : (erste.bis2 || erste.bis1),
    pauseMin: stempelSichtbar ? t.pauseMin : mitZeit.reduce((a, z) => a + (z.pause_min || 0), 0),
    baustellen,
    ueberschneidung: ueberStunden > 0,
    quelle: restStunden > 0 ? 'gemischt' : 'bericht',
    warnungen
  };
}

const FELD = ['mitarbeiter', 'polier'];

/**
 * D-03: Sicherheitsnetz über die Tagesgrenze. Überschneidet sich eine Berichtszeile eines Tages mit
 * gezählten Stempelzeiten anderer Tage oder mit Berichtszeilen des Vortags, wird die Überschneidung
 * am Berichtstag abgezogen.
 */
function tagesuebergreifend(tw, zeilenFuer, gedecktFuer) {
  const stempelIv = new Map(tw.map((t) => [t.datum, (t.intervalle || []).filter((i) => !(gedecktFuer(t.datum) || new Set()).has(i.baustelleId)).map((i) => [i.von, i.bis])]));
  const zeilenIv = new Map(tw.map((t) => [t.datum, (zeilenFuer(t.datum) || []).flatMap((z) => bloeckeAlsZeitpunkte(t.datum, z))]));
  for (const t of tw) {
    const eigen = zeilenIv.get(t.datum);
    if (!eigen.length) continue;
    let ms = 0;
    for (const [d, iv] of stempelIv) {
      if (d === t.datum) continue;
      for (const a of eigen) for (const b of iv) ms += ueberlappungMs(a, b);
    }
    const vortag = zeilenIv.get(plusTage(t.datum, -1)) || [];
    for (const a of eigen) for (const b of vortag) ms += ueberlappungMs(a, b);
    if (ms > 0) {
      const h = ms / 3600000;
      t.stunden = r2(Math.max(0, t.stunden - h));
      t.ueberschneidung = true;
      t.warnungen = [...(t.warnungen || []), { typ: 'ueberschneidung', text: `Berichtszeiten überschneiden sich über die Tagesgrenze um ${r2(h).toLocaleString('de-AT')} Std. mit einem anderen Tag – nur einmal gezählt, bitte prüfen.` }];
    }
  }
  return tw;
}

/** Eigene Woche (Mo–So) */
function woche(db, benutzerId, datum, jetzt) {
  const mo = wochenbeginn(datum);
  const daten = Array.from({ length: 7 }, (_, i) => plusTage(mo, i));
  const sch = plausibilisieren(ladeSchichten(db, benutzerId, daten[0], daten[6], jetzt), jetzt);
  const abw = new Map(db.alle("SELECT datum, code, status FROM abwesenheit WHERE benutzer_id = ? AND datum BETWEEN ? AND ? AND status <> 'abgelehnt'", benutzerId, daten[0], daten[6]).map((a) => [a.datum, a]));
  const bsMap = baustellenMap(db);
  const ber = berichtsZeilen(db, daten[0], daten[6], benutzerId);
  const feld = FELD.includes((db.eins('SELECT rolle FROM benutzer WHERE id = ?', benutzerId) || {}).rolle);
  const zeilenFuer = (d) => (feld ? ber.zeilen.get(`${benutzerId}|${d}`) : null);
  const gedecktFuer = (d) => (feld ? ber.gedeckt.get(d) : null);
  const tw = tagesuebergreifend(tageswerte(sch, daten, bsMap).map((t0) => mitBericht(t0, zeilenFuer(t0.datum), gedecktFuer(t0.datum), bsMap)), zeilenFuer, gedecktFuer);
  const tage = tw.map((t) => {
    const a = abw.get(t.datum);
    const o = { datum: t.datum, wochentag: WT_KURZ[wochentag(t.datum)], stunden: t.stunden, pauseMin: t.pauseMin, von: t.von, bis: t.bis, baustellen: t.baustellen };
    if (t.quelle) o.quelle = t.quelle;
    if (t.unplausibel) o.unplausibel = true;
    if (t.ueberschneidung) o.ueberschneidung = true;
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
  for (const k of ber.zeilen.keys()) mitDaten.add(Number(k.split('|')[0]));
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
    const gestempeltAm = new Set(roh.map((x) => x.datum)); // Tage mit eigener Stempelung (auch offene/unplausible Schichten)
    // D-04: für Bauleiter/Büro/GF zählen immer die Stempelzeiten
    const feld = FELD.includes(b.rolle);
    const zeilenFuer = (d) => (feld ? ber.zeilen.get(`${b.id}|${d}`) : null);
    const gedecktFuer = (d) => (feld ? ber.gedeckt.get(d) : null);
    const tw = tagesuebergreifend(tageswerte(sch, daten, bsMap).map((t) => mitBericht(t, zeilenFuer(t.datum), gedecktFuer(t.datum), bsMap)), zeilenFuer, gedecktFuer);
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
      if (t.ueberschneidung) e.ueberschneidung = true;
      for (const w of t.warnungen || []) warnungen.push({ benutzerId: b.id, name: b.name, datum: t.datum, stufe: 'hinweis', ...w });
      if (a && !genehmigt) { e.code = a.code; e.codeStatus = a.status; beantragt.push({ benutzerId: b.id, name: b.name, datum: t.datum, code: a.code }); }
      if (t.unplausibel && t.quelle !== 'bericht') {
        e.unplausibel = true;
        offeneSchichten.push({ benutzerId: b.id, name: b.name, datum: t.datum, beginn: t.von, text: 'Schicht über 16 Std. bzw. nicht ausgestempelt – zählt mit 0 Std., bitte korrigieren.' });
      }
      tageObj[t.datum] = e;
      const gestempelt = gestempeltAm.has(t.datum);
      if (genehmigt && ['K', 'U', 'ZA'].includes(a.code) && (t.stunden > 0 || gestempelt)) {
        // D-08: Abwesenheit und Arbeitsstunden am selben Tag; API.md 15.2: auch jede Stempelung trotz Abwesenheit (z. B. über die Kolonne)
        const zusatz = gestempelt ? ' Stempelung trotz eingetragener Abwesenheit – bitte klären.' : '';
        warnungen.push({ benutzerId: b.id, name: b.name, datum: t.datum, typ: 'abwesenheit_mit_stunden', stufe: 'hinweis', ...(gestempelt ? { gestempelt: true } : {}),
          text: t.stunden > 0 ? `Genehmigte Abwesenheit „${a.code}“ und ${t.stunden.toLocaleString('de-AT')} Arbeitsstunden am selben Tag – bitte prüfen.${zusatz}` : `Genehmigte Abwesenheit „${a.code}“ und Stempelung am selben Tag (0 Std. gezählt) – bitte klären.` });
      }
      if (genehmigt) {
        if (a.code === 'SW') { sw++; swStunden += Math.max(0, (feiertag(t.datum) ? 0 : cfg.tagNormal[wochentag(t.datum)]) - t.stunden); }
        if (a.code === 'K') k++;
        if (a.code === 'U') u++;
        if (a.code === 'ZA') za++;
      }
    }
    // 12.22: Lohngruppe stichtaggenau – Monatsletzter, abweichende Tage, Abschnitte bei Wechsel
    const lgTag = require('./lohngruppen').zeitachse(db, b.id);
    const lgMonat = lgTag(letzter);
    const abschnitte = [];
    for (const d of daten) {
      const lg = lgTag(d);
      const st = tageObj[d] ? tageObj[d].stunden || 0 : 0;
      const l = abschnitte[abschnitte.length - 1];
      if (l && l.lohngruppe === lg) { l.bis = d; l.stunden += st; } else abschnitte.push({ lohngruppe: lg, von: d, bis: d, stunden: st });
      if (tageObj[d] && lg !== lgMonat) tageObj[d].lohngruppe = lg;
    }
    const summe = r2(tw.reduce((x, t) => x + t.stunden, 0));
    const ueberstunden = ueberstundenZeitraum(tw, cfg);
    for (const w of azgWarnungen(roh, { jetzt })) {
      if (w.datum >= erster && w.datum <= letzter) warnungen.push({ benutzerId: b.id, name: b.name, ...w });
    }
    return {
      id: b.id, name: b.name, pnr: b.pnr, lohngruppe: lgMonat, ...(abschnitte.length > 1 ? { lohngruppen: abschnitte.map((a) => ({ ...a, stunden: r2(a.stunden) })) } : {}), tage: tageObj, summe,
      normal: r2(summe - ueberstunden), ueberstunden, sw, swStunden: r2(swStunden), k, u, za, seg: r2(seg.get(b.id) || 0)
    };
  });
  // D-10: GF-Selbstfreigaben kennzeichnen
  for (const r of db.alle(`SELECT r.id, r.datum, b.kst, u.id AS uid, u.name FROM bericht r JOIN baustelle b ON b.id = r.baustelle_id
      LEFT JOIN benutzer u ON u.id = r.freigegeben_von WHERE r.selbstfreigabe = 1 AND r.datum BETWEEN ? AND ?`, erster, letzter)) {
    warnungen.push({ benutzerId: r.uid, name: r.name, datum: r.datum, typ: 'selbstfreigabe', stufe: 'hinweis', berichtId: r.id, text: `Bericht ${r.kst} vom ${r.datum.split('-').reverse().join('.')} von derselben Person unterschrieben (AN) und freigegeben.` });
  }
  return {
    monat: monatStr, tage, mitarbeiter, warnungen, beantragt, offeneSchichten,
    annahmen: {
      tagNormal: cfg.tagNormal, wocheNormal: cfg.wocheNormal,
      hinweis: 'Überstunden-Regel ist eine Annahme (Prüfen mit Lohnverrechnung). Stunden aus freigegebenen Berichten haben Vorrang vor Stempelzeiten. Nur genehmigte Abwesenheiten zählen.'
    }
  };
}

module.exports = { STANDARD_ARBEITSZEIT, arbeitszeitConfig, ueberstundenWoche, ueberstundenZeitraum, ladeSchichten, tageswerte, berichtsZeilen, mitBericht, woche, monat };
