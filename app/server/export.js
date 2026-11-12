'use strict';
/**
 * CSV-Exporte für die Lohnverrechnung (Semikolon, UTF-8 mit BOM, Dezimalkomma, CRLF).
 * Enthalten keine €-Werte – die App rechnet keine Löhne aus (Konzept 3.5).
 */
const { deDatum, WT_KURZ, wochentag } = require('./datum');

const BOM = '﻿';

function feld(x) {
  if (x === null || x === undefined) return '';
  let s = typeof x === 'number' ? String(x).replace('.', ',') : String(x);
  // Schutz vor Formel-Injektion in Tabellenprogrammen
  if (/^[=+\-@\t\r]/.test(s) && typeof x !== 'number') s = "'" + s;
  if (/[;"\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function csv(zeilen) {
  return BOM + zeilen.map((z) => z.map(feld).join(';')).join('\r\n') + '\r\n';
}

const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

/** Export für die Lohnverrechnung: je Mitarbeiter und Tag eine Zeile + Summenzeile */
function lohnCsv(m) {
  const z = [['Personalnummer', 'Name', 'Lohngruppe', 'Datum', 'Wochentag', 'Beginn', 'Ende', 'Pause (Min.)', 'Stunden', 'Kürzel', 'Kostenstellen']];
  for (const ma of m.mitarbeiter) {
    for (const d of Object.keys(ma.tage).sort()) {
      const t = ma.tage[d];
      z.push([ma.pnr ?? '', ma.name, ma.lohngruppe ?? '', deDatum(d), WT_KURZ[wochentag(d)], t.von || '', t.bis || '', t.pauseMin ?? '', r2(t.stunden), t.code || '', (t.baustellen || []).join(', ')]);
    }
  }
  z.push([]);
  z.push(['Personalnummer', 'Name', 'Lohngruppe', 'Monat', 'Summe Stunden', 'Normalstunden', 'Überstunden (Vorschlag)', 'SW-Tage', 'SW-Stunden', 'K-Tage', 'U-Tage', 'ZA-Tage', 'SEG-Stunden']);
  for (const ma of m.mitarbeiter) {
    z.push([ma.pnr ?? '', ma.name, ma.lohngruppe ?? '', m.monat, ma.summe, ma.normal, ma.ueberstunden, ma.sw, ma.swStunden, ma.k, ma.u, ma.za, ma.seg]);
  }
  return csv(z);
}

/** Grundlage für die BUAK-Meldung (Format mit BUAK/Lohnverrechnung abstimmen) */
function buakCsv(m) {
  const z = [
    ['Hinweis', 'Grundlage für die BUAK-Meldung – Format mit BUAK/Lohnverrechnung abstimmen'],
    ['Personalnummer', 'Name', 'Monat', 'Beschäftigungstage', 'Arbeitsstunden', 'Urlaubstage', 'Krankenstandstage', 'Schlechtwettertage', 'Schlechtwetterstunden', 'Schlechtwetter-Daten']
  ];
  for (const ma of m.mitarbeiter) {
    const tage = Object.entries(ma.tage);
    const beschaeftigt = tage.filter(([, t]) => t.stunden > 0 || ['U', 'K', 'SW', 'ZA'].includes(t.code)).length;
    const swDaten = tage.filter(([, t]) => t.code === 'SW').map(([d]) => deDatum(d)).join(', ');
    z.push([ma.pnr ?? '', ma.name, m.monat, beschaeftigt, ma.summe, ma.u, ma.k, ma.sw, ma.swStunden, swDaten]);
  }
  return csv(z);
}

module.exports = { csv, feld, lohnCsv, buakCsv, BOM };
