'use strict';
/**
 * Druckbarer Tages- und Wochenplan (API.md 12.23) – A4 quer, große Schrift, nie €-Werte.
 * Bekommt nur ein fertiges, schon nach Rechten gefiltertes Modell (keine Datenbank, keine Preise).
 */
const PDFDocument = require('pdfkit');
const { winAnsi } = require('./pdf');

const SEITE = { w: 841.89, h: 595.28 };
const RAND = 32;
const BREITE = SEITE.w - 2 * RAND;
const FUSS = 26; // Platz für die Fußzeile
const UNTEN = SEITE.h - RAND - FUSS;
const GR = { titel: 20, kopf: 15, text: 12, klein: 11 };
const GRAU = '#e6e6e6';
const WASSERZEICHEN = 'ENTWURF – nicht veröffentlicht';

function dokument(titel, opt) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, bufferPages: true, compress: !opt.unkomprimiert, info: { Title: winAnsi(titel), Author: winAnsi((opt.firma && opt.firma.name) || ''), Creator: 'BauTag' } });
  const teile = [];
  doc.on('data', (c) => teile.push(c));
  const fertig = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(teile))); doc.on('error', reject); });
  return { doc, fertig };
}

/** Wasserzeichen und Fußzeile „Seite n von m“ auf allen Seiten */
function abschliessen(doc, m) {
  const r = doc.bufferedPageRange();
  for (let i = r.start; i < r.start + r.count; i++) {
    doc.switchToPage(i);
    if (m.entwurf) {
      doc.save();
      doc.rotate(-24, { origin: [SEITE.w / 2, SEITE.h / 2] });
      doc.fillColor('#c00000').fillOpacity(0.16).font('Helvetica-Bold').fontSize(50)
        .text(winAnsi(WASSERZEICHEN), -150, SEITE.h / 2 - 30, { width: SEITE.w + 300, align: 'center', lineBreak: false });
      doc.restore();
      doc.fillOpacity(1);
    }
    doc.font('Helvetica').fontSize(10).fillColor('#444')
      .text(winAnsi(`${m.titel} · gedruckt ${m.gedruckt}${m.entwurf ? ' · ENTWURF' : ''}`), RAND, SEITE.h - RAND - 12, { width: BREITE * 0.75, lineBreak: false })
      .text(winAnsi(`Seite ${i - r.start + 1} von ${r.count}`), RAND, SEITE.h - RAND - 12, { width: BREITE, align: 'right', lineBreak: false });
  }
  doc.flushPages();
  doc.end();
}

function kopf(doc, m, fortsetzung) {
  let y = RAND;
  doc.font('Helvetica-Bold').fontSize(fortsetzung ? GR.kopf : GR.titel).fillColor('#000')
    .text(winAnsi(`${m.titel}${fortsetzung ? ' (Fortsetzung)' : ''}`), RAND, y, { width: BREITE * 0.62, lineBreak: false });
  const rechts = [`gedruckt ${m.gedruckt}`, m.veroeffentlichtUm ? `veröffentlicht ${m.veroeffentlichtUm}` : 'nicht veröffentlicht'];
  doc.font('Helvetica').fontSize(GR.klein).text(winAnsi(rechts.join('   ·   ')), RAND, y + 4, { width: BREITE, align: 'right', lineBreak: false });
  y += (fortsetzung ? GR.kopf : GR.titel) + 8;
  doc.moveTo(RAND, y).lineTo(RAND + BREITE, y).lineWidth(1.2).strokeColor('#000').stroke();
  return y + 8;
}

/* ---------- Tagesplan ---------- */

/** Zeilen eines Baustellen-Blocks: [{text, fett?, gr?, einzug?}] */
function blockZeilen(b) {
  const z = [];
  const pol = b.polier ? `Polier: ${b.polier.name}${b.polier.telefon ? `  ·  Tel. ${b.polier.telefon}` : ''}` : 'Polier: –';
  z.push({ text: pol, fett: true });
  const kopfTeile = [b.beginn ? `Beginn ${b.beginn}` : null, b.treffpunkt ? `Treffpunkt: ${b.treffpunkt}` : null, b.fahrzeug ? `Fahrzeug: ${b.fahrzeug}` : null].filter(Boolean);
  if (kopfTeile.length) z.push({ text: kopfTeile.join('   ·   ') });
  if (b.arbeit) z.push({ text: `Arbeit: ${b.arbeit}` });
  z.push({ text: `Personen (${b.personen.length})`, fett: true, abstand: 3 });
  for (const p of b.personen) z.push({ text: `${p.name}${p.rolle ? ` (${p.rolle})` : ''}${p.notiz ? `  –  ${p.notiz}` : ''}`, einzug: 14 });
  if (!b.personen.length) z.push({ text: '–', einzug: 14 });
  if (b.anlagen.length) {
    z.push({ text: 'Geräte / LKW', fett: true, abstand: 3 });
    for (const a of b.anlagen) z.push({ text: `${a.bezeichnung}${a.kennzeichen ? ` (${a.kennzeichen})` : ''}${a.fahrer ? `  ·  Fahrer: ${a.fahrer}` : ''}${a.notiz ? `  –  ${a.notiz}` : ''}`, einzug: 14 });
  }
  if (b.benoetigt) z.push({ text: `Benötigt / Mitnehmen: ${b.benoetigt}`, abstand: 3 });
  if (b.notiz) z.push({ text: `Notiz: ${b.notiz}`, abstand: b.benoetigt ? 0 : 3 });
  return z;
}

function hoeheZeilen(doc, zeilen, breite) {
  let h = 0;
  for (const z of zeilen) {
    doc.font(z.fett ? 'Helvetica-Bold' : 'Helvetica').fontSize(z.gr || GR.text);
    h += (z.abstand || 0) + doc.heightOfString(winAnsi(z.text), { width: breite - (z.einzug || 0) }) + 2;
  }
  return h;
}

function zeichneZeilen(doc, zeilen, x, y, breite, texte) {
  for (const z of zeilen) {
    y += z.abstand || 0;
    const s = winAnsi(z.text);
    texte.push(s);
    doc.font(z.fett ? 'Helvetica-Bold' : 'Helvetica').fontSize(z.gr || GR.text).fillColor('#000');
    const h = doc.heightOfString(s, { width: breite - (z.einzug || 0) });
    doc.text(s, x + (z.einzug || 0), y, { width: breite - (z.einzug || 0) });
    y += h + 2;
  }
  return y;
}

/**
 * @param {object} m {titel, gedruckt, veroeffentlichtUm, entwurf, bloecke, fuhren:[{lkw, zeilen}], nichtEingeteilt:[{name, rolle, status}]}
 */
function tagesplanPdf(m, opt = {}) {
  const { doc, fertig } = dokument(m.titel, opt);
  const texte = opt.texte || [];
  let y = kopf(doc, m, false);
  const neueSeite = () => { doc.addPage(); y = kopf(doc, m, true); };
  const KOPF_H = GR.kopf + 10;

  if (!m.bloecke.length) {
    doc.font('Helvetica').fontSize(GR.text).text(winAnsi('Für diesen Tag sind keine Einsätze eingeteilt.'), RAND, y);
    y += 24;
  }
  for (const b of m.bloecke) {
    const zeilen = blockZeilen(b);
    const h = KOPF_H + hoeheZeilen(doc, zeilen, BREITE - 16) + 14;
    // nie teilen: passt der Block nicht mehr, neue Seite (nur ein Block, der größer als eine ganze Seite ist, wird umbrochen)
    if (y + h > UNTEN && y > RAND + 60) neueSeite();
    doc.rect(RAND, y, BREITE, KOPF_H).fill(GRAU);
    const kopfText = winAnsi(`${b.kst}  ${b.name}`);
    texte.push(kopfText);
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(GR.kopf).text(kopfText, RAND + 8, y + 5, { width: BREITE * 0.55, lineBreak: false, ellipsis: true });
    if (b.adresse) doc.font('Helvetica').fontSize(GR.klein).text(winAnsi(b.adresse), RAND + BREITE * 0.55, y + 7, { width: BREITE * 0.45 - 8, align: 'right', lineBreak: false, ellipsis: true });
    const yEnde = zeichneZeilen(doc, zeilen, RAND + 8, y + KOPF_H + 5, BREITE - 16, texte);
    doc.rect(RAND, y, BREITE, yEnde - y + 4).lineWidth(0.8).strokeColor('#777').stroke();
    y = yEnde + 14;
  }

  // Fuhren je LKW (Tabelle)
  if (m.fuhren.length) {
    const sp = [{ t: 'Zeit', w: 52 }, { t: 'Material', w: 150 }, { t: 'Menge', w: 80 }, { t: 'von » nach', w: BREITE - 52 - 150 - 80 - 150 }, { t: 'Fahrer', w: 150 }];
    const zeile = (werte, fett) => {
      doc.font(fett ? 'Helvetica-Bold' : 'Helvetica').fontSize(GR.klein);
      const hs = werte.map((w, i) => doc.heightOfString(winAnsi(w), { width: sp[i].w - 6 }));
      return Math.max(...hs) + 6;
    };
    const titelH = GR.kopf + 10;
    if (y + titelH + 40 > UNTEN) neueSeite();
    doc.font('Helvetica-Bold').fontSize(GR.kopf).fillColor('#000').text(winAnsi('Fuhren'), RAND, y);
    texte.push('Fuhren');
    y += titelH;
    for (const g of m.fuhren) {
      const kopfH = zeile(sp.map((s) => s.t), true);
      const rows = g.zeilen.map((f) => [f.zeit || '', f.material || '', f.menge || '', f.strecke || '', f.fahrer || '']);
      const gesamt = GR.text + 8 + kopfH + rows.reduce((a, r) => a + zeile(r, false), 0);
      if (y + Math.min(gesamt, GR.text + 8 + kopfH + 40) > UNTEN) neueSeite();
      const lkw = winAnsi(g.lkw);
      texte.push(lkw);
      doc.font('Helvetica-Bold').fontSize(GR.text).text(lkw, RAND, y);
      y += GR.text + 6;
      const druckeZeile = (werte, fett) => {
        const h = zeile(werte, fett);
        if (y + h > UNTEN) { neueSeite(); }
        let x = RAND;
        if (fett) doc.rect(RAND, y, BREITE, h).fill(GRAU);
        doc.fillColor('#000').font(fett ? 'Helvetica-Bold' : 'Helvetica').fontSize(GR.klein);
        werte.forEach((w, i) => { const s = winAnsi(w); texte.push(s); doc.text(s, x + 3, y + 3, { width: sp[i].w - 6 }); x += sp[i].w; });
        doc.moveTo(RAND, y + h).lineTo(RAND + BREITE, y + h).lineWidth(0.4).strokeColor('#999').stroke();
        y += h;
      };
      druckeZeile(sp.map((s) => s.t), true);
      for (const r of rows) druckeZeile(r, false);
      y += 10;
    }
  }

  // Nicht eingeteilt
  if (m.nichtEingeteilt.length) {
    const text = m.nichtEingeteilt.map((p) => `${p.name}: ${p.status}`).join('   ·   ');
    doc.font('Helvetica').fontSize(GR.text);
    const h = GR.kopf + 10 + doc.heightOfString(winAnsi(text), { width: BREITE });
    if (y + h > UNTEN) neueSeite();
    doc.font('Helvetica-Bold').fontSize(GR.kopf).fillColor('#000').text(winAnsi(`Nicht eingeteilt (${m.nichtEingeteilt.length})`), RAND, y);
    texte.push('Nicht eingeteilt');
    y += GR.kopf + 8;
    const s = winAnsi(text);
    texte.push(s);
    doc.font('Helvetica').fontSize(GR.text).text(s, RAND, y, { width: BREITE });
  }
  abschliessen(doc, m);
  return fertig;
}

/* ---------- Wochenplan ---------- */

/**
 * @param {object} m {titel, gedruckt, veroeffentlichtUm, entwurf, tage:[{datum, label, entwurf}], zeilen:[{kst, name, zellen:{[datum]: string[]}}]}
 */
function wochenplanPdf(m, opt = {}) {
  const { doc, fertig } = dokument(m.titel, opt);
  const texte = opt.texte || [];
  const ERSTE = 150;
  const spB = (BREITE - ERSTE) / m.tage.length;
  let y = kopf(doc, m, false);
  const kopfZeile = () => {
    doc.rect(RAND, y, BREITE, 24).fill(GRAU);
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(GR.text).text(winAnsi('Baustelle'), RAND + 4, y + 6, { width: ERSTE - 8, lineBreak: false });
    m.tage.forEach((t, i) => { const s = winAnsi(t.label + (t.entwurf ? ' *' : '')); texte.push(s); doc.text(s, RAND + ERSTE + i * spB + 4, y + 6, { width: spB - 8, lineBreak: false }); });
    y += 24;
  };
  kopfZeile();
  if (!m.zeilen.length) doc.font('Helvetica').fontSize(GR.text).text(winAnsi('Keine Einsätze in dieser Woche.'), RAND, y + 8);
  for (const z of m.zeilen) {
    doc.font('Helvetica').fontSize(GR.klein);
    const zell = m.tage.map((t) => (z.zellen[t.datum] || []).join('\n'));
    const kopfText = `${z.kst}\n${z.name}`;
    const h = Math.max(doc.heightOfString(winAnsi(kopfText), { width: ERSTE - 8 }), ...zell.map((s) => doc.heightOfString(winAnsi(s || ' '), { width: spB - 8 }))) + 10;
    if (y + h > UNTEN) { doc.addPage(); y = kopf(doc, m, true); kopfZeile(); }
    const k = winAnsi(kopfText);
    texte.push(k);
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(GR.klein).text(k, RAND + 4, y + 5, { width: ERSTE - 8 });
    doc.font('Helvetica').fontSize(GR.klein);
    zell.forEach((s, i) => { const w = winAnsi(s); if (w) texte.push(w); doc.text(w, RAND + ERSTE + i * spB + 4, y + 5, { width: spB - 8 }); });
    doc.rect(RAND, y, BREITE, h).lineWidth(0.5).strokeColor('#888').stroke();
    for (let i = 0; i <= m.tage.length; i++) doc.moveTo(RAND + ERSTE + i * spB, y).lineTo(RAND + ERSTE + i * spB, y + h).stroke();
    y += h;
  }
  if (m.tage.some((t) => t.entwurf)) {
    doc.font('Helvetica').fontSize(10).fillColor('#444').text(winAnsi('* nicht oder nicht aktuell veröffentlicht'), RAND, Math.min(y + 6, UNTEN - 12));
  }
  abschliessen(doc, m);
  return fertig;
}

module.exports = { tagesplanPdf, wochenplanPdf, WASSERZEICHEN };
