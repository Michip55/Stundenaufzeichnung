'use strict';
/**
 * Datum/Zeit-Hilfen. Alle Tagesgrenzen gelten in Europe/Vienna.
 * Zeitstempel werden in der Datenbank als ISO 8601 (UTC, toISOString) gespeichert.
 */

const TZ = 'Europe/Vienna';
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

function teile(d) {
  const o = {};
  for (const p of fmt.formatToParts(d instanceof Date ? d : new Date(d))) o[p.type] = p.value;
  return o;
}

/** 'YYYY-MM-DD' in Wien */
function wienDatum(d) {
  const t = teile(d);
  return `${t.year}-${t.month}-${t.day}`;
}

/** 'HH:MM' in Wien */
function wienZeit(d) {
  const t = teile(d);
  return `${t.hour}:${t.minute}`;
}

/** Minuten seit Mitternacht (Wien) */
function wienMinuten(d) {
  const t = teile(d);
  return Number(t.hour) * 60 + Number(t.minute);
}

/** Versatz Wien gegenüber UTC in Minuten zum Zeitpunkt d */
function versatzMin(d) {
  const t = teile(d);
  const alsUtc = Date.UTC(+t.year, +t.month - 1, +t.day, +t.hour, +t.minute, +t.second);
  return Math.round((alsUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

/** Wiener Ortszeit (Datum + 'HH:MM') → Date (UTC) */
function wienZuDate(datum, zeit = '00:00') {
  const [y, m, t] = datum.split('-').map(Number);
  const [h, mi] = zeit.split(':').map(Number);
  const basis = Date.UTC(y, m - 1, t, h, mi);
  let d = new Date(basis - versatzMin(new Date(basis)) * 60000);
  d = new Date(basis - versatzMin(d) * 60000);
  return d;
}

const RE_DATUM = /^\d{4}-\d{2}-\d{2}$/;
const RE_ZEIT = /^([01]\d|2[0-3]):[0-5]\d$/;
const RE_MONAT = /^\d{4}-(0[1-9]|1[0-2])$/;

function istDatum(s) {
  if (typeof s !== 'string' || !RE_DATUM.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
const istZeit = (s) => typeof s === 'string' && RE_ZEIT.test(s);
const istMonat = (s) => typeof s === 'string' && RE_MONAT.test(s);

/** Kalendertage addieren (reines Datum) */
function plusTage(datum, n) {
  const [y, m, d] = datum.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** 0 = Sonntag … 6 = Samstag */
function wochentag(datum) {
  const [y, m, d] = datum.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
const WT_KURZ = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** Montag der Woche */
function wochenbeginn(datum) {
  const wt = wochentag(datum);
  return plusTage(datum, wt === 0 ? -6 : 1 - wt);
}

function tageZwischen(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

function tageImMonat(monat) {
  const [y, m] = monat.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out = [];
  for (let i = 1; i <= n; i++) out.push(`${monat}-${String(i).padStart(2, '0')}`);
  return out;
}

/** Ostersonntag (Gauß/Meeus) */
function ostersonntag(jahr) {
  const a = jahr % 19, b = Math.floor(jahr / 100), c = jahr % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31), tag = ((h + l - 7 * m + 114) % 31) + 1;
  return `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`;
}

/** Gesetzliche Feiertage Österreich → {datum: name} */
function feiertage(jahr) {
  const o = ostersonntag(jahr);
  const f = {
    [`${jahr}-01-01`]: 'Neujahr', [`${jahr}-01-06`]: 'Heilige Drei Könige',
    [plusTage(o, 1)]: 'Ostermontag', [`${jahr}-05-01`]: 'Staatsfeiertag',
    [plusTage(o, 39)]: 'Christi Himmelfahrt', [plusTage(o, 50)]: 'Pfingstmontag',
    [plusTage(o, 60)]: 'Fronleichnam', [`${jahr}-08-15`]: 'Mariä Himmelfahrt',
    [`${jahr}-10-26`]: 'Nationalfeiertag', [`${jahr}-11-01`]: 'Allerheiligen',
    [`${jahr}-12-08`]: 'Mariä Empfängnis', [`${jahr}-12-25`]: 'Christtag', [`${jahr}-12-26`]: 'Stefanitag'
  };
  return f;
}
function feiertag(datum) {
  return feiertage(Number(datum.slice(0, 4)))[datum] || null;
}
function istArbeitstag(datum) {
  const wt = wochentag(datum);
  return wt >= 1 && wt <= 5 && !feiertag(datum);
}

/**
 * Uhr: liefert eine Funktion () => Date.
 * - Funktion → wird verwendet
 * - ISO-String → Startzeit, läuft ab Programmstart in Echtzeit weiter
 * - sonst Systemzeit
 */
function erzeugeUhr(uhr) {
  if (typeof uhr === 'function') return () => new Date(uhr().getTime());
  if (typeof uhr === 'string' && uhr.trim()) {
    const start = new Date(uhr);
    if (Number.isNaN(start.getTime())) throw new Error('BAUTAG_UHR ist keine gültige ISO-Zeit: ' + uhr);
    const t0 = Date.now();
    return () => new Date(start.getTime() + (Date.now() - t0));
  }
  return () => new Date();
}

/** Deutsch formatiertes Datum 12.11.2026 */
function deDatum(datum) {
  if (!datum) return '';
  const [y, m, d] = datum.split('-');
  return `${d}.${m}.${y}`;
}

module.exports = {
  TZ, wienDatum, wienZeit, wienMinuten, wienZuDate, istDatum, istZeit, istMonat, plusTage,
  wochentag, WT_KURZ, wochenbeginn, tageZwischen, tageImMonat, ostersonntag, feiertage, feiertag,
  istArbeitstag, erzeugeUhr, deDatum
};
