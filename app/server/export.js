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
      const kuerzel = t.code && !t.codeStatus ? t.code : '';
      if (!t.stunden && !kuerzel && !t.unplausibel && !t.von) continue; // nur beantragt → Hinweiszeile
      z.push([ma.pnr ?? '', ma.name, (t.lohngruppe !== undefined ? t.lohngruppe : ma.lohngruppe) ?? '', deDatum(d), WT_KURZ[wochentag(d)], t.von || '', t.bis || '', t.pauseMin ?? '', r2(t.stunden), kuerzel, (t.baustellen || []).join(', ')]);
    }
  }
  z.push([]);
  z.push(['Personalnummer', 'Name', 'Lohngruppe', 'Monat', 'Summe Stunden', 'Normalstunden', 'Überstunden (Vorschlag)', 'SW-Tage', 'SW-Stunden', 'K-Tage', 'U-Tage', 'ZA-Tage', 'SEG-Stunden']);
  for (const ma of m.mitarbeiter) {
    z.push([ma.pnr ?? '', ma.name, ma.lohngruppe ?? '', m.monat, ma.summe, ma.normal, ma.ueberstunden, ma.sw, ma.swStunden, ma.k, ma.u, ma.za, ma.seg]);
  }
  // 12.22: Lohngruppenwechsel im Monat (Tageszeilen tragen die Lohngruppe des Tages)
  const wechsel = [];
  for (const ma of m.mitarbeiter) {
    const a = ma.lohngruppen || [];
    for (let i = 1; i < a.length; i++) {
      const tt = a[i].von.split('-');
      wechsel.push(`Lohngruppenwechsel: ${ma.name} ab ${tt[2]}.${tt[1]}.: ${a[i - 1].lohngruppe || '–'} → ${a[i].lohngruppe || '–'} (Stunden ${a[i - 1].lohngruppe || '–'}: ${String(a[i - 1].stunden).replace('.', ',')}, ${a[i].lohngruppe || '–'}: ${String(a[i].stunden).replace('.', ',')})`);
    }
  }
  const hinweise = [
    ...wechsel,
    ...(m.beantragt || []).map((b) => `Beantragt, nicht genehmigt (nicht gezählt): ${b.name} ${deDatum(b.datum)} ${b.code}`),
    ...(m.offeneSchichten || []).map((o) => `Offene/unplausible Schicht (0 Std. gezählt, bitte korrigieren): ${o.name} ${deDatum(o.datum)} ab ${o.beginn || '?'}`),
    ...(m.warnungen || []).filter((w) => w.typ !== 'unplausibel').map((w) => (['ueberschneidung', 'nicht_im_bericht', 'abwesenheit_mit_stunden', 'selbstfreigabe'].includes(w.typ)
      ? `Prüfen: ${w.name} ${deDatum(w.datum)} – ${w.text}` : `AZG: ${w.name} – ${w.text}`))
  ];
  if (hinweise.length) {
    z.push([]);
    for (const h of hinweise) z.push(['Hinweis', h]);
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
    const gilt = (t, c) => t.code === c && !t.codeStatus; // nur genehmigte Abwesenheiten
    const beschaeftigt = tage.filter(([, t]) => t.stunden > 0 || ['U', 'K', 'SW', 'ZA'].some((c) => gilt(t, c))).length;
    const swDaten = tage.filter(([, t]) => gilt(t, 'SW')).map(([d]) => deDatum(d)).join(', ');
    z.push([ma.pnr ?? '', ma.name, m.monat, beschaeftigt, ma.summe, ma.u, ma.k, ma.sw, ma.swStunden, swDaten]);
  }
  return csv(z);
}

module.exports = { csv, feld, lohnCsv, buakCsv, BOM };
