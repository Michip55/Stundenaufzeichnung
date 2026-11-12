'use strict';
/**
 * Stempel-Zustandsautomat und Auswertung von Buchungen zu Schichten/Zeitblöcken (reine Funktionen).
 *
 *   aus ──kommen──▶ arbeit ──pause_start──▶ pause
 *                    │  ▲ └─wechsel─┘          │
 *                    │  └────pause_ende────────┘
 *                    └──gehen──▶ aus ◀──gehen── pause
 */
const { wienDatum, wienZeit } = require('./datum');

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

/**
 * Personalzeile für einen Bautagesbericht aus den Schichten eines Tages für eine Baustelle.
 * Zwei Zeitblöcke (von1–bis1, von2–bis2), Pause, Arbeitsstunden.
 * @returns {null|{von1,bis1,von2,bis2,pauseMin,stunden}}
 */
function personalAusSchichten(schichtenDesTages, baustelleId) {
  const arbeit = [];
  let pauseMin = 0;
  for (const s of schichtenDesTages) {
    for (const i of s.intervalle) {
      if (i.baustelleId !== baustelleId) continue;
      if (i.art === 'arbeit') arbeit.push({ von: i.von, bis: i.bis });
      else pauseMin += (i.bis - i.von) / 60000;
    }
  }
  if (!arbeit.length) return null;
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
  return {
    von1: z(erster.von), bis1: z(erster.bis),
    von2: zweiter ? z(zweiter.von) : null, bis2: zweiter ? z(zweiter.bis) : null,
    pauseMin: Math.round(pauseMin),
    stunden: r2(minuten / 60)
  };
}

/** 'HH:MM' → Minuten */
function hm(s) {
  if (!s) return null;
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Arbeitsstunden einer (händisch bearbeiteten) Personalzeile:
 * Summe der Blöcke minus der Pause, soweit sie nicht schon in der Lücke zwischen den Blöcken liegt.
 */
function stundenAusBloecken({ von1, bis1, von2, bis2, pauseMin = 0 }) {
  let min = 0;
  let luecke = 0;
  const b1 = von1 && bis1 ? [hm(von1), hm(bis1)] : null;
  const b2 = von2 && bis2 ? [hm(von2), hm(bis2)] : null;
  if (b1) min += Math.max(0, b1[1] - b1[0]);
  if (b2) min += Math.max(0, b2[1] - b2[0]);
  if (b1 && b2) luecke = Math.max(0, b2[0] - b1[1]);
  min -= Math.max(0, (pauseMin || 0) - luecke);
  return r2(Math.max(0, min) / 60);
}

module.exports = {
  TYPEN, UEBERGAENGE, STATUS_TEXT, naechsterStatus, statusAusBuchungen, pruefeBuchung, schichten,
  personalAusSchichten, stundenAusBloecken, hm
};
