'use strict';
/**
 * Stempel-Zustandsautomat und Auswertung von Buchungen zu Schichten/Zeitblöcken (reine Funktionen).
 *
 *   aus ──kommen──▶ arbeit ──pause_start──▶ pause
 *                    │  ▲ └─wechsel─┘          │
 *                    │  └────pause_ende────────┘
 *                    └──gehen──▶ aus ◀──gehen── pause
 */
const { wienDatum, wienZeit, wienZuDate, plusTage } = require('./datum');

const TYPEN = ['kommen', 'gehen', 'pause_start', 'pause_ende', 'wechsel'];
const UEBERGAENGE = {
  aus: { kommen: 'arbeit' },
  arbeit: { pause_start: 'pause', wechsel: 'arbeit', gehen: 'aus' },
  pause: { pause_ende: 'arbeit', gehen: 'aus' }
};
const STATUS_TEXT = { aus: 'nicht eingestempelt', arbeit: 'eingestempelt', pause: 'in Pause' };

/** Nächster Status oder null, wenn die Folge ungültig ist */
function naechsterStatus(status, typ) {
  return (UEBERGAENGE[status] && UEBERGAENGE[status][typ]) || null;
}

function ms(z) { return z instanceof Date ? z.getTime() : new Date(z).getTime(); }

/**
 * Aktueller Status aus allen Buchungen (sortiert nach Zeit).
 * @returns {{status:string, seit:string|null, baustelleId:number|null, schichtBeginn:string|null}}
 */
function statusAusBuchungen(buchungen) {
  let st = { status: 'aus', seit: null, baustelleId: null, schichtBeginn: null };
  for (const b of buchungen) {
    const neu = naechsterStatus(st.status, b.typ);
    if (!neu) continue; // fehlerhafte Altdaten überspringen
    st = {
      status: neu,
      seit: b.zeit,
      baustelleId: neu === 'aus' ? null : (b.typ === 'kommen' || b.typ === 'wechsel' ? b.baustelleId : st.baustelleId),
      schichtBeginn: neu === 'aus' ? null : (b.typ === 'kommen' ? b.zeit : st.schichtBeginn)
    };
  }
  return st;
}

/**
 * Prüft eine neue Buchung gegen den aktuellen Status.
 * @returns {{ok:true, status:string}|{ok:false, grund:string}}
 */
function pruefeBuchung(aktuell, typ, baustelleId) {
  if (!TYPEN.includes(typ)) return { ok: false, grund: 'Unbekannte Stempelart.' };
  const neu = naechsterStatus(aktuell.status, typ);
  if (!neu) {
    const texte = {
      kommen: 'Bereits eingestempelt.',
      gehen: 'Nicht eingestempelt.',
      pause_start: aktuell.status === 'pause' ? 'Pause läuft bereits.' : 'Nicht eingestempelt.',
      pause_ende: 'Keine Pause aktiv.',
      wechsel: aktuell.status === 'pause' ? 'Während der Pause ist kein Baustellenwechsel möglich.' : 'Nicht eingestempelt.'
    };
    return { ok: false, grund: texte[typ] };
  }
  if (typ === 'wechsel' && baustelleId === aktuell.baustelleId) return { ok: false, grund: 'Bereits auf dieser Baustelle eingestempelt.' };
  return { ok: true, status: neu };
}

/**
 * Fasst Buchungen zu Schichten (kommen … gehen) mit Intervallen zusammen.
 * Offene Schichten werden bis `jetzt` gerechnet (offen = true).
 */
function schichten(buchungen, jetzt) {
  const out = [];
  let s = null;
  let cur = null;
  let status = 'aus';
  const schliessen = (t) => {
    if (cur) {
      cur.bis = t;
      if (cur.bis > cur.von) s.intervalle.push(cur);
      cur = null;
    }
  };
  for (const b of buchungen) {
    const neu = naechsterStatus(status, b.typ);
    if (!neu) continue;
    const t = ms(b.zeit);
    if (b.typ === 'kommen') {
      s = { start: t, ende: null, offen: false, intervalle: [], buchungen: [] };
      out.push(s);
      cur = { art: 'arbeit', baustelleId: b.baustelleId, von: t, bis: null };
    } else if (b.typ === 'pause_start') {
      const bs = cur ? cur.baustelleId : null;
      schliessen(t);
      cur = { art: 'pause', baustelleId: bs, von: t, bis: null };
    } else if (b.typ === 'pause_ende') {
      const bs = cur ? cur.baustelleId : null;
      schliessen(t);
      cur = { art: 'arbeit', baustelleId: bs, von: t, bis: null };
    } else if (b.typ === 'wechsel') {
      schliessen(t);
      cur = { art: 'arbeit', baustelleId: b.baustelleId, von: t, bis: null };
    } else if (b.typ === 'gehen') {
      schliessen(t);
      s.ende = t;
    }
    s.buchungen.push(b);
    status = neu;
  }
  if (status !== 'aus' && s) {
    s.offen = true;
    if (jetzt !== undefined && jetzt !== null) schliessen(Math.max(ms(jetzt), cur ? cur.von : 0));
  }
  for (const x of out) {
    x.datum = wienDatum(new Date(x.start));
    x.arbeitMin = Math.round(x.intervalle.filter((i) => i.art === 'arbeit').reduce((a, i) => a + (i.bis - i.von), 0) / 60000);
    x.pauseMin = Math.round(x.intervalle.filter((i) => i.art === 'pause').reduce((a, i) => a + (i.bis - i.von), 0) / 60000);
    x.ende = x.ende || (x.intervalle.length ? x.intervalle[x.intervalle.length - 1].bis : x.start);
  }
  return out;
}

const r2 = (x) => Math.round(x * 100) / 100;

/** Schichten länger als 16 Std. (offen oder ausgestempelt) gelten als unplausibel (Ausstempeln vergessen) */
const MAX_SCHICHT_MIN = 16 * 60;

/**
 * Kennzeichnet unplausible Schichten: sie zählen mit 0 Std. (Kopie, Original bleibt unverändert).
 * @returns {Array} Schichten mit Feld `unplausibel`
 */
function plausibilisieren(liste, jetzt, maxMin = MAX_SCHICHT_MIN) {
  const t = jetzt == null ? null : (jetzt instanceof Date ? jetzt.getTime() : new Date(jetzt).getTime());
  return liste.map((s) => {
    const dauer = s.offen ? (t == null ? 0 : t - s.start) : s.ende - s.start;
    if (dauer <= maxMin * 60000) return { ...s, unplausibel: false };
    return { ...s, unplausibel: true, intervalleRoh: s.intervalle, intervalle: [], arbeitMin: 0, pauseMin: 0 };
  });
}

const HINWEIS_UNPLAUSIBEL = 'Ausstempeln fehlt – Zeiten bitte eintragen';

/**
 * Personalzeile für einen Bautagesbericht aus den Schichten eines Tages für eine Baustelle.
 * Zwei Zeitblöcke (von1–bis1, von2–bis2), Pause, Arbeitsstunden. Über Mitternacht: bis < von.
 * Unplausible Schichten liefern eine leere Zeile mit Hinweis.
 * @returns {null|{von1,bis1,von2,bis2,pauseMin,stunden,hinweis?}}
 */
function personalAusSchichten(schichtenDesTages, baustelleId) {
  const arbeit = [];
  let pauseMin = 0;
  let unplausibel = false;
  for (const s of schichtenDesTages) {
    if (s.unplausibel) {
      if ((s.intervalleRoh || []).some((i) => i.baustelleId === baustelleId)) unplausibel = true;
      continue;
    }
    for (const i of s.intervalle) {
      if (i.baustelleId !== baustelleId) continue;
      if (i.art === 'arbeit') arbeit.push({ von: i.von, bis: i.bis });
      else pauseMin += (i.bis - i.von) / 60000;
    }
  }
  if (!arbeit.length) {
    return unplausibel ? { von1: null, bis1: null, von2: null, bis2: null, pauseMin: 0, stunden: 0, hinweis: HINWEIS_UNPLAUSIBEL } : null;
  }
  arbeit.sort((a, b) => a.von - b.von);
  const bloecke = [];
  for (const a of arbeit) {
    const l = bloecke[bloecke.length - 1];
    if (l && a.von <= l.bis) l.bis = Math.max(l.bis, a.bis);
    else bloecke.push({ ...a });
  }
  const minuten = arbeit.reduce((x, a) => x + (a.bis - a.von) / 60000, 0);
  const z = (t) => wienZeit(new Date(t));
  const erster = bloecke[0];
  const zweiter = bloecke.length > 1 ? { von: bloecke[1].von, bis: bloecke[bloecke.length - 1].bis } : null;
  const o = {
    von1: z(erster.von), bis1: z(erster.bis),
    von2: zweiter ? z(zweiter.von) : null, bis2: zweiter ? z(zweiter.bis) : null,
    pauseMin: Math.round(pauseMin),
    stunden: r2(minuten / 60)
  };
  if (unplausibel) o.hinweis = HINWEIS_UNPLAUSIBEL;
  return o;
}

/** 'HH:MM' → Minuten */
function hm(s) {
  if (!s) return null;
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

/** Dauer von a bis b in Minuten; b < a heißt „am nächsten Tag“ */
const dauerMin = (a, b) => (hm(b) - hm(a) + 1440) % 1440;

/**
 * Zeitleiste der Blöcke (über Mitternacht erlaubt).
 * @returns {{arbeitMin:number, lueckeMin:number, spanneMin:number}}
 */
function blockZeitleiste({ von1, bis1, von2, bis2 }, datum) {
  if (datum) {
    const iv = bloeckeAlsZeitpunkte(datum, { von1, bis1, von2, bis2 });
    if (!iv.length) return { arbeitMin: 0, lueckeMin: 0, spanneMin: 0 };
    const m = (x) => Math.round(x / 60000);
    return {
      arbeitMin: iv.reduce((a, [x, y]) => a + m(y - x), 0),
      lueckeMin: iv.length > 1 ? m(iv[1][0] - iv[0][1]) : 0,
      spanneMin: m(iv[iv.length - 1][1] - iv[0][0])
    };
  }
  let arbeit = 0, luecke = 0, spanne = 0;
  if (von1 && bis1) {
    const d1 = dauerMin(von1, bis1);
    arbeit += d1;
    spanne = d1;
    if (von2 && bis2) {
      luecke = dauerMin(bis1, von2);
      const d2 = dauerMin(von2, bis2);
      arbeit += d2;
      spanne += luecke + d2;
    }
  }
  return { arbeitMin: arbeit, lueckeMin: luecke, spanneMin: spanne };
}

/**
 * Zeitblöcke als echte Zeitpunkte (Europe/Vienna, C-10): jede Uhrzeit ist das nächste Auftreten
 * nach der vorigen – so stimmen Dauern auch über Mitternacht und über die Zeitumstellung.
 * @returns {Array<[number, number]>} Intervalle in ms
 */
function bloeckeAlsZeitpunkte(datum, { von1, bis1, von2, bis2 }) {
  if (!von1 || !bis1) return [];
  const naechster = (hm, nach, strikt) => {
    for (let k = 0; k <= 2; k++) {
      const t = wienZuDate(plusTage(datum, k), hm).getTime();
      if (strikt ? t > nach : t >= nach) return t;
    }
    return null;
  };
  const v1 = wienZuDate(datum, von1).getTime();
  const b1 = naechster(bis1, v1, true);
  const out = [[v1, b1]];
  if (von2 && bis2) {
    const v2 = naechster(von2, b1, false);
    const b2 = naechster(bis2, v2, true);
    out.push([v2, b2]);
  }
  return out;
}

/**
 * Arbeitsstunden einer (händisch bearbeiteten) Personalzeile:
 * Summe der Blöcke minus der Pause, soweit sie nicht schon in der Lücke zwischen den Blöcken liegt.
 * Über Mitternacht: bis < von zählt bis zum nächsten Tag.
 */
function stundenAusBloecken({ von1, bis1, von2, bis2, pauseMin = 0 }, datum) {
  const z = blockZeitleiste({ von1, bis1, von2, bis2 }, datum);
  const min = z.arbeitMin - Math.max(0, (pauseMin || 0) - z.lueckeMin);
  return r2(Math.max(0, min) / 60);
}

/** Anzahl ungültiger Übergänge in einer Buchungsfolge (für Korrekturen) */
function ungueltigeUebergaenge(buchungen) {
  let st = 'aus', n = 0;
  for (const b of buchungen) {
    const neu = naechsterStatus(st, b.typ);
    if (!neu) { n++; continue; }
    st = neu;
  }
  return n;
}

module.exports = {
  TYPEN, UEBERGAENGE, STATUS_TEXT, MAX_SCHICHT_MIN, HINWEIS_UNPLAUSIBEL, naechsterStatus, statusAusBuchungen, pruefeBuchung, schichten,
  plausibilisieren, personalAusSchichten, stundenAusBloecken, blockZeitleiste, bloeckeAlsZeitpunkte, dauerMin, ungueltigeUebergaenge, hm
};
