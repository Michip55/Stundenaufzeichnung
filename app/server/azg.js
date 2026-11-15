'use strict';
/**
 * AZG-Warnungen (reine Funktionen). Die App verhindert nichts, sie macht aufmerksam.
 *  - mehr als 10 Std. am Tag (ab 12 Std.: Höchstgrenze § 9 AZG überschritten)
 *  - mehr als 6 Std. Arbeit ohne 30 Min. Pause (§ 11 AZG)
 *  - Ausstempeln vergessen (offen > 12 Std.)
 *  - weniger als 11 Std. Ruhezeit (§ 12 AZG)
 *  - unplausible Schicht (> 16 Std. ausgestempelt – vermutlich vergessen)
 */
const { deDatum, wienZeit } = require('./datum');

const GRENZEN = { tagHinweisMin: 600, tagMaxMin: 720, pauseNachMin: 360, pauseMin: 30, offenMin: 720, ruheMin: 660, unplausibelMin: 960 };

const zahl = (x) => (Math.round(x * 100) / 100).toLocaleString('de-AT', { maximumFractionDigits: 2 });

/**
 * @param {Array} schichten  Ergebnis von stempel.schichten() (sortiert)
 * @param {{jetzt?:Date|number, grenzen?:object}} opt
 * @returns {Array<{typ:string, datum:string, text:string, stufe:'hinweis'|'grenze'}>}
 */
function azgWarnungen(schichten, opt = {}) {
  const g = { ...GRENZEN, ...(opt.grenzen || {}) };
  const jetzt = opt.jetzt != null ? new Date(opt.jetzt).getTime() : null;
  const out = [];
  const tage = new Map();
  for (const s of schichten) {
    const t = tage.get(s.datum) || { arbeit: 0, pause: 0 };
    t.arbeit += s.arbeitMin;
    t.pause += s.pauseMin;
    tage.set(s.datum, t);
  }
  for (const [datum, t] of tage) {
    if (t.arbeit > g.tagMaxMin) {
      out.push({ typ: 'tag_12h', datum, stufe: 'grenze', text: `${deDatum(datum)}: ${zahl(t.arbeit / 60)} Std. – Höchstarbeitszeit von 12 Std. überschritten (§ 9 AZG).` });
    } else if (t.arbeit > g.tagHinweisMin) {
      out.push({ typ: 'tag_10h', datum, stufe: 'hinweis', text: `${deDatum(datum)}: ${zahl(t.arbeit / 60)} Std. – mehr als 10 Std. Arbeitszeit.` });
    }
    if (t.arbeit > g.pauseNachMin && t.pause < g.pauseMin) {
      out.push({ typ: 'pause', datum, stufe: 'grenze', text: `${deDatum(datum)}: mehr als 6 Std. gearbeitet ohne 30 Min. Pause (§ 11 AZG).` });
    }
  }
  for (const s of schichten) {
    if (!s.offen && s.ende - s.start > g.unplausibelMin * 60000) {
      out.push({ typ: 'unplausibel', datum: s.datum, stufe: 'grenze', text: `${deDatum(s.datum)}: Schicht über ${zahl((s.ende - s.start) / 3600000)} Std. – vermutlich Ausstempeln vergessen. Bitte im Büro korrigieren (zählt bis dahin mit 0 Std.).` });
    }
    if (s.offen && jetzt != null && jetzt - s.start > g.offenMin * 60000) {
      out.push({ typ: 'offen', datum: s.datum, stufe: 'hinweis', text: `Ausstempeln vergessen? Eingestempelt seit ${deDatum(s.datum)} ${wienZeit(new Date(s.start))} (über 12 Std.).` });
    }
  }
  for (let i = 1; i < schichten.length; i++) {
    const a = schichten[i - 1], b = schichten[i];
    if (a.offen || a.datum === b.datum) continue;
    const ruhe = (b.start - a.ende) / 60000;
    if (ruhe >= 0 && ruhe < g.ruheMin) {
      out.push({ typ: 'ruhezeit', datum: b.datum, stufe: 'grenze', text: `${deDatum(b.datum)}: nur ${zahl(ruhe / 60)} Std. Ruhezeit seit dem Vortag (mind. 11 Std., § 12 AZG).` });
    }
  }
  return out.sort((x, y) => (x.datum < y.datum ? -1 : x.datum > y.datum ? 1 : 0));
}

module.exports = { azgWarnungen, GRENZEN };
