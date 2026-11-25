'use strict';
/**
 * Hinweise zu Stempelzeiten (reine Funktionen). Die App verhindert nichts, sie macht aufmerksam.
 *  - Ausstempeln vergessen (offen > 12 Std.)
 *  - unplausible Schicht (> 16 Std. ausgestempelt – vermutlich vergessen, zählt mit 0 Std.)
 * 15.38 (Inhaber 25.11.2026): Die Hinweise zum Arbeitszeitgesetz (> 10 bzw. > 12 Std. am Tag, > 6 Std. ohne 30 Min. Pause,
 * < 11 Std. Ruhezeit) sind entfernt – sie störten. Name der Datei und der Funktion bleiben (Benachrichtigungstyp 'azg').
 */
const { deDatum, wienZeit } = require('./datum');

const GRENZEN = { offenMin: 720, unplausibelMin: 960 };

const zahl = (x) => (Math.round(x * 100) / 100).toLocaleString('de-AT', { maximumFractionDigits: 2 });

/**
 * @param {Array} schichten  Ergebnis von stempel.schichten() (sortiert)
 * @param {{jetzt?:Date|number, grenzen?:object}} opt
 * @returns {Array<{typ:'offen'|'unplausibel', datum:string, text:string, stufe:'hinweis'|'grenze'}>}
 */
function azgWarnungen(schichten, opt = {}) {
  const g = { ...GRENZEN, ...(opt.grenzen || {}) };
  const jetzt = opt.jetzt != null ? new Date(opt.jetzt).getTime() : null;
  const out = [];
  for (const s of schichten) {
    if (!s.offen && s.ende - s.start > g.unplausibelMin * 60000) {
      out.push({ typ: 'unplausibel', datum: s.datum, stufe: 'grenze', text: `${deDatum(s.datum)}: Schicht über ${zahl((s.ende - s.start) / 3600000)} Std. – vermutlich Ausstempeln vergessen. Bitte im Büro korrigieren (zählt bis dahin mit 0 Std.).` });
    }
    if (s.offen && jetzt != null && jetzt - s.start > g.offenMin * 60000) {
      out.push({ typ: 'offen', datum: s.datum, stufe: 'hinweis', text: `Ausstempeln vergessen? Eingestempelt seit ${deDatum(s.datum)} ${wienZeit(new Date(s.start))} (über 12 Std.).` });
    }
  }
  return out.sort((x, y) => (x.datum < y.datum ? -1 : x.datum > y.datum ? 1 : 0));
}

module.exports = { azgWarnungen, GRENZEN };
