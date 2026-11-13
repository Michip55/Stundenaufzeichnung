// BauTag – Zahleneingabe nach österreichischer Schreibweise (Prüfbericht B-04).
// Reine Funktionen ohne Browser-Abhängigkeit, damit sie auch unter Node getestet werden können.
//
//   "250.000"      → 250000      (Punkte in Dreiergruppen = Tausendertrennung)
//   "250.000,50"   → 250000.5
//   "1.234.567"    → 1234567
//   "12,5"         → 12.5
//   "12.5"         → 12.5        (ein Punkt mit 1–2 Nachkommastellen = Dezimalpunkt)
//   "1.2345", "1,2,3", "12,5.3", "abc", "" → NaN (mehrdeutig oder ungültig – nie raten)
export function parseZahl(eingabe) {
  if (typeof eingabe === 'number') return Number.isFinite(eingabe) ? eingabe : NaN;
  let t = String(eingabe == null ? '' : eingabe).replace(/[\s  ]/g, '').replace(/^€|€$/g, '').replace(/^EUR|EUR$/i, '');
  if (!t) return NaN;
  let vz = 1;
  if (t[0] === '-' || t[0] === '−') { vz = -1; t = t.slice(1); } else if (t[0] === '+') t = t.slice(1);
  let m;
  if (/^\d+$/.test(t)) return vz * Number(t);                                   // 1234
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return vz * Number(t.replace(/\./g, ''));  // 250.000 · 1.234.567
  if ((m = /^(\d{1,3}(?:\.\d{3})+|\d+),(\d+)$/.exec(t))) return vz * Number(m[1].replace(/\./g, '') + '.' + m[2]); // 250.000,50 · 12,5
  if (/^\d+\.\d{1,2}$/.test(t)) return vz * Number(t);                          // 12.5 · 12.50
  return NaN;
}

// true, wenn sich ein Wert um mehr als Faktor 10 ändert (Tippfehler-Schutz mit Rückfrage)
export function starkGeaendert(alt, neu) {
  if (!(typeof alt === 'number' && typeof neu === 'number') || !(alt > 0) || !(neu > 0)) return false;
  return neu / alt > 10 || alt / neu > 10;
}

// Arbeitsstunden aus zwei Zeitblöcken – gleiche Regel wie am Server (Prüfbericht B-06):
// „bis“ kleiner als „von“ bedeutet: der Block endet am nächsten Tag (Schicht über Mitternacht).
const minuten = (hhmm) => { const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
export function bloecke(p) {
  const a = minuten(p.von1), b = minuten(p.bis1), c = minuten(p.von2), d = minuten(p.bis2);
  const out = { b1: null, b2: null, naechsterTag: false };
  if (a != null && b != null) {
    let ende = b; if (ende < a) { ende += 1440; out.naechsterTag = true; }
    out.b1 = [a, ende];
  }
  if (c != null && d != null) {
    let start = c;
    // Der zweite Block folgt auf den ersten: liegt sein Beginn vor dessen Ende, gehört er zum nächsten Tag
    if (out.b1 && start < out.b1[1]) { start += 1440; out.naechsterTag = true; }
    let ende = d + (start - c);
    if (ende < start) { ende += 1440; out.naechsterTag = true; }
    out.b2 = [start, ende];
  }
  return out;
}
/* ---------- Wiener Ortszeit (unabhängig von der Zeitzone des Geräts; Prüfbericht 2 C-10, C-15) ---------- */
const WIEN = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
function wienTeile(ms) {
  const t = {}; for (const x of WIEN.formatToParts(new Date(ms))) t[x.type] = x.value;
  return { datum: `${t.year}-${t.month}-${t.day}`, zeit: `${t.hour}:${t.minute}` };
}
// Zeitpunkt (ms seit 1970) für eine Wiener Ortszeit „YYYY-MM-DD“ + „HH:MM“
export function wienMs(datum, hhmm) {
  const [y, m, d] = datum.split('-').map(Number); const [h, mi] = hhmm.split(':').map(Number);
  const wand = Date.UTC(y, m - 1, d, h, mi);
  const versatz = (ms) => { const w = wienTeile(ms); const [yy, mm, dd] = w.datum.split('-').map(Number); const [hh, mn] = w.zeit.split(':').map(Number); return Date.UTC(yy, mm - 1, dd, hh, mn) - ms; };
  let v = versatz(wand - 3600e3);
  v = versatz(wand - v);
  return wand - v;
}
export const wienIso = (datum, hhmm) => new Date(wienMs(datum, hhmm)).toISOString();
// ISO-Zeitstempel → Wert für <input type="datetime-local"> in Wiener Ortszeit
export const wienLokal = (iso) => { const w = wienTeile(new Date(iso).getTime()); return `${w.datum}T${w.zeit}`; };
export const wienHeute = () => wienTeile(Date.now()).datum;

// Arbeitsstunden einer Berichtszeile. Mit Datum wird in echter Zeit gerechnet (Zeitumstellung: Nachtschicht 7 bzw. 9 Std.),
// ohne Datum nach der Wanduhr. Pause wird nur abgezogen, soweit sie nicht schon in der Lücke zwischen den Blöcken liegt.
export function stundenAus(p, datum) {
  const { b1, b2 } = bloecke(p);
  const dauer = (von, bis) => {
    if (!datum) return bis - von;
    const punkt = (min) => { const [y, m, d] = datum.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + Math.floor(min / 1440))); const tag = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`; const r = min % 1440; return wienMs(tag, `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`); };
    return Math.round((punkt(bis) - punkt(von)) / 60000);
  };
  let m = 0;
  if (b1) m += dauer(b1[0], b1[1]);
  if (b2) m += dauer(b2[0], b2[1]);
  const luecke = b1 && b2 ? Math.max(0, dauer(b1[1], b2[0])) : 0;
  m -= Math.max(0, (Number(p.pauseMin) || 0) - luecke);
  return Math.round((Math.max(0, m) / 60) * 100) / 100;
}
// Fehlertext für eine Personalzeile oder '' wenn in Ordnung
export function personalFehler(p) {
  const z = (k) => p[k] || '';
  if (!!z('von1') !== !!z('bis1') || !!z('von2') !== !!z('bis2')) return 'Zeitblock unvollständig – bitte „von“ und „bis“ eintragen.';
  if ((z('von1') && z('von1') === z('bis1')) || (z('von2') && z('von2') === z('bis2'))) return '„von“ und „bis“ sind gleich – bitte das Ende eintragen.';
  if (z('von2') && !z('von1')) return 'Zweiter Zeitblock ohne ersten.';
  const { b1, b2 } = bloecke(p);
  if (b1 && b2 && b2[0] < b1[1]) return 'Die beiden Zeitblöcke überschneiden sich.';
  if (b1 && (b2 ? b2[1] : b1[1]) - b1[0] > 1440) return 'Die Zeiten ergeben mehr als 24 Stunden.';
  if (Number(p.segStunden) > 0 && Number(p.segStunden) > Number(p.stunden || 0)) return 'SEG-Stunden dürfen die Arbeitsstunden nicht übersteigen.';
  return '';
}
