'use strict';
/**
 * CSV-Exporte für die Lohnverrechnung (Semikolon, UTF-8 mit BOM, Dezimalkomma, CRLF).
 * Enthalten keine €-Werte – die App rechnet keine Löhne aus (Konzept 3.5).
 */
const { deDatum, WT_KURZ, wochentag } = require('./datum');

const BOM = '﻿';

/**
 * Ein CSV-Feld – gemeinsamer Helfer für ALLE CSV-Exporte (G-13): Formel-Schutz (', =, +, -, @, Tab, CR am Anfang
 * → mit ' entschärft) unabhängig vom Trennzeichen, danach Anführungszeichen, wenn Trennzeichen/"/Zeilenumbruch vorkommen.
 */
function feld(x, trenn = ';') {
  if (x === null || x === undefined) return '';
  let s = typeof x === 'number' ? String(x).replace('.', trenn === ',' ? '.' : ',') : String(x);
  if (typeof x !== 'number' && /^[=+\-@\t\r']/.test(s)) s = "'" + s;
  if (s.includes(trenn) || /["\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Zeilen → CSV-Text (ohne BOM) mit beliebigem Trennzeichen */
function csvText(zeilen, trenn = ';') {
  return zeilen.map((z) => z.map((x) => feld(x, trenn)).join(trenn)).join('\r\n') + '\r\n';
}

function csv(zeilen) {
  return BOM + csvText(zeilen, ';');
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
  // 15.23: Mehrstunden (Teilzeit) und Arbeitszeitmodell am Ende angefügt – bestehende Spaltenzuordnungen bleiben gültig
  z.push(['Personalnummer', 'Name', 'Lohngruppe', 'Monat', 'Summe Stunden', 'Normalstunden', 'Überstunden (Vorschlag)', 'SW-Tage', 'SW-Stunden', 'K-Tage', 'U-Tage', 'ZA-Tage', 'SEG-Stunden', 'Mehrstunden (Vorschlag)', 'Arbeitszeitmodell']);
  for (const ma of m.mitarbeiter) {
    z.push([ma.pnr ?? '', ma.name, ma.lohngruppe ?? '', m.monat, ma.summe, ma.normal, ma.ueberstunden, ma.sw, ma.swStunden, ma.k, ma.u, ma.za, ma.seg, ma.mehrstunden || 0, (ma.arbeitszeitmodell || {}).name || '']);
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
  // 15.23: Wechsel des Arbeitszeitmodells im Monat
  for (const ma of m.mitarbeiter) {
    const a = ma.arbeitszeitmodelle || [];
    for (let i = 1; i < a.length; i++) {
      const tt = a[i].von.split('-');
      wechsel.push(`Arbeitszeitmodell-Wechsel: ${ma.name} ab ${tt[2]}.${tt[1]}.: ${a[i - 1].name || '–'} → ${a[i].name || '–'} (Über-/Mehrstunden je Abschnitt gerechnet)`);
    }
  }
  const hinweise = [
    ...wechsel,
    ...(m.beantragt || []).map((b) => `Beantragt, nicht genehmigt (nicht gezählt): ${b.name} ${deDatum(b.datum)} ${b.code}`),
    ...(m.offeneSchichten || []).map((o) => `Offene/unplausible Schicht (0 Std. gezählt, bitte korrigieren): ${o.name} ${deDatum(o.datum)} ab ${o.beginn || '?'}`),
    // 15.38: keine AZG-Hinweise mehr; „Ausstempeln vergessen?“ (offen) nennt das Datum selbst im Text
    ...(m.warnungen || []).filter((w) => w.typ !== 'unplausibel').map((w) => (['ueberschneidung', 'nicht_im_bericht', 'abwesenheit_mit_stunden', 'selbstfreigabe'].includes(w.typ)
      ? `Prüfen: ${w.name} ${deDatum(w.datum)} – ${w.text}` : `Prüfen: ${w.name} – ${w.text}`))
  ];
  if (hinweise.length) {
    z.push([]);
    for (const h of hinweise) z.push(['Hinweis', h]);
  }
  return csv(z);
}

/**
 * Grundlage für die BUAK-Meldung (Format mit BUAK/Lohnverrechnung abstimmen). 15.23: nur BUAK-pflichtige Personen
 * (Kennzeichen je Person, Vorgabe Mitarbeiter/Polier) – alle anderen fehlen ganz.
 */
function buakCsv(m) {
  const z = [
    ['Hinweis', 'Grundlage für die BUAK-Meldung – Format mit BUAK/Lohnverrechnung abstimmen'],
    ['Personalnummer', 'Name', 'Monat', 'Beschäftigungstage', 'Arbeitsstunden', 'Urlaubstage', 'Krankenstandstage', 'Schlechtwettertage', 'Schlechtwetterstunden', 'Schlechtwetter-Daten']
  ];
  const pflichtig = m.mitarbeiter.filter((ma) => ma.buakPflichtig !== false);
  for (const ma of pflichtig) {
    const tage = Object.entries(ma.tage);
    const gilt = (t, c) => t.code === c && !t.codeStatus; // nur genehmigte Abwesenheiten
    const beschaeftigt = tage.filter(([, t]) => t.stunden > 0 || ['U', 'K', 'SW', 'ZA'].some((c) => gilt(t, c))).length;
    const swDaten = tage.filter(([, t]) => gilt(t, 'SW')).map(([d]) => deDatum(d)).join(', ');
    z.push([ma.pnr ?? '', ma.name, m.monat, beschaeftigt, ma.summe, ma.u, ma.k, ma.sw, ma.swStunden, swDaten]);
  }
  z.push([]);
  z.push(['Hinweis', `Enthält nur BUAK-pflichtige Personen (${pflichtig.length}) – Kennzeichen je Person unter Benutzer & Rechte.`]);
  return csv(z);
}

module.exports = { csv, csvText, feld, lohnCsv, buakCsv, BOM };
