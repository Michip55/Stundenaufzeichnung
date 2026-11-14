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

/** N-038: Text auf eine Zeile der Breite kürzen (eigene Ellipse – pdfkit bricht trotz lineBreak:false um) */
function kuerze(doc, s, breite) {
  if (doc.widthOfString(s) <= breite) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (doc.widthOfString(`${s.slice(0, mid).trimEnd()}…`) <= breite) lo = mid; else hi = mid - 1; }
  return `${s.slice(0, lo).trimEnd()}…`;
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
  // Kopfzeile eines Blocks (auch als Fortsetzung auf der Folgeseite): Name/Adresse vorab auf die Breite gekürzt
  const blockKopf = (b, forts) => {
    doc.rect(RAND, y, BREITE, KOPF_H).fill(GRAU);
    doc.font('Helvetica').fontSize(GR.klein);
    const adresse = b.adresse ? kuerze(doc, winAnsi(b.adresse), BREITE * 0.4 - 10) : '';
    const adrB = adresse ? doc.widthOfString(adresse) + 4 : 0;
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(GR.kopf);
    const zusatz = forts ? winAnsi(' (Fortsetzung)') : '';
    const kopfText = kuerze(doc, winAnsi(`${b.kst}  ${b.name}`), BREITE - 16 - adrB - 12 - doc.widthOfString(zusatz)) + zusatz;
    texte.push(kopfText);
    doc.text(kopfText, RAND + 8, y + 5, { width: BREITE - 16 - adrB - 8, lineBreak: false });
    if (adresse) doc.font('Helvetica').fontSize(GR.klein).text(adresse, RAND + BREITE - 8 - adrB, y + 7, { width: adrB, align: 'right', lineBreak: false });
    y += KOPF_H + 5;
  };
  const rahmen = (von) => doc.rect(RAND, von, BREITE, y - von + 4).lineWidth(0.8).strokeColor('#777').stroke();
  // Platz einer Folgeseite unter dem Seitenkopf (der Kopf der Folgeseiten ist kleiner als der der ersten Seite)
  const FOLGE_OBEN = RAND + GR.kopf + 16;
  for (const b of m.bloecke) {
    const zeilen = blockZeilen(b);
    const h = KOPF_H + hoeheZeilen(doc, zeilen, BREITE - 16) + 14;
    // nie teilen: passt der Block nicht mehr, neue Seite. N-036: nur ein Block, der größer als eine ganze Seite ist,
    // wird umbrochen – Zeile für Zeile, mit Seitenkopf und Block-Kopf „(Fortsetzung)“, Rahmen je Seitenteil.
    // 15.7 (Rest N-036): ein solcher Block beginnt gleich auf der laufenden Seite (sonst bliebe sie fast leer), sofern dort
    // noch Platz für den Block-Kopf und einige Zeilen ist
    const zuGross = h > UNTEN - FOLGE_OBEN;
    if (y + h > UNTEN && y > RAND + 60 && (!zuGross || UNTEN - y < KOPF_H + 80)) neueSeite();
    let start = y;
    blockKopf(b, false);
    for (const z of zeilen) {
      const s = winAnsi(z.text);
      texte.push(s);
      const breite = BREITE - 16 - (z.einzug || 0);
      doc.font(z.fett ? 'Helvetica-Bold' : 'Helvetica').fontSize(z.gr || GR.text);
      // eine einzelne Zeile höher als eine ganze Seite wird abgeschnitten (sonst Autoumbruch von pdfkit ohne Kopf)
      const maxH = UNTEN - (RAND + GR.kopf + 16 + KOPF_H + 5) - 8;
      const h1 = Math.min(doc.heightOfString(s, { width: breite }), maxH);
      if (y + (z.abstand || 0) + h1 + 6 > UNTEN) { rahmen(start); neueSeite(); start = y; blockKopf(b, true); } else y += z.abstand || 0;
      doc.font(z.fett ? 'Helvetica-Bold' : 'Helvetica').fontSize(z.gr || GR.text).fillColor('#000');
      doc.text(s, RAND + 8 + (z.einzug || 0), y, { width: breite, ...(h1 >= maxH ? { height: h1, ellipsis: true } : {}) });
      y += h1 + 2;
    }
    rahmen(start);
    y += 14;
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
  const neueSeite = () => { doc.addPage(); y = kopf(doc, m, true); kopfZeile(); };
  const OBEN = y; // y unter dem Tabellenkopf der ersten Seite (Folgeseiten: kleinerer Kopf)
  // 15.7 (Rest N-080): immer mit der Schrift messen, mit der gedruckt wird (Zellen Helvetica, Baustelle Helvetica-Bold, GR.klein) –
  // nach neueSeite() stünde sonst noch die Schrift des Tabellenkopfs (größer, fett) und es würde zu früh umbrochen
  const hoehe = (s, w, fett = false) => doc.font(fett ? 'Helvetica-Bold' : 'Helvetica').fontSize(GR.klein).heightOfString(winAnsi(s || ' '), { width: w });
  for (const z of m.zeilen) {
    doc.font('Helvetica').fontSize(GR.klein);
    const kopfText = `${z.kst}\n${z.name}`;
    let rest = m.tage.map((t) => [...(z.zellen[t.datum] || [])]);
    const zeilenH = (zellen, kt) => Math.max(hoehe(kt, ERSTE - 8, true), ...zellen.map((e) => hoehe(e.join('\n'), spB - 8))) + 10;
    let h = zeilenH(rest, kopfText);
    // eine Zeile, die auch auf eine leere Seite nicht passt, beginnt auf der laufenden Seite (sofern dort Platz für einige Einträge ist)
    const zuGross = h > UNTEN - OBEN;
    if (y + h > UNTEN && y > OBEN + 1 && (!zuGross || UNTEN - y < 80)) neueSeite();
    let forts = false;
    // N-080: eine Zeile höher als eine Seite wird auf Folgeseiten verteilt (je Zelle so viele Einträge, wie passen)
    for (;;) {
      const kt = forts ? `${z.kst} (Forts.)\n${z.name}` : kopfText;
      const platz = UNTEN - y;
      let teil = rest, weiter = null;
      if (zeilenH(rest, kt) > platz) {
        teil = rest.map((e) => {
          let n = 0;
          while (n < e.length && hoehe(e.slice(0, n + 1).join('\n'), spB - 8) + 10 <= platz) n += 1;
          return e.slice(0, Math.max(n, e.length ? 1 : 0));
        });
        weiter = rest.map((e, i) => e.slice(teil[i].length));
        if (!weiter.some((e) => e.length)) weiter = null;
      }
      h = Math.min(zeilenH(teil, kt), platz);
      const k = winAnsi(kt);
      texte.push(k);
      doc.fillColor('#000').font('Helvetica-Bold').fontSize(GR.klein).text(k, RAND + 4, y + 5, { width: ERSTE - 8, height: h - 6, ellipsis: true });
      doc.font('Helvetica').fontSize(GR.klein);
      teil.forEach((e, i) => { const w = winAnsi(e.join('\n')); if (w) texte.push(w); doc.text(w, RAND + ERSTE + i * spB + 4, y + 5, { width: spB - 8, height: h - 6, ellipsis: true }); });
      doc.rect(RAND, y, BREITE, h).lineWidth(0.5).strokeColor('#888').stroke();
      for (let i = 0; i <= m.tage.length; i++) doc.moveTo(RAND + ERSTE + i * spB, y).lineTo(RAND + ERSTE + i * spB, y + h).stroke();
      y += h;
      if (!weiter) break;
      rest = weiter; forts = true;
      neueSeite();
    }
  }
  if (m.tage.some((t) => t.entwurf)) {
    doc.font('Helvetica').fontSize(10).fillColor('#444').text(winAnsi('* nicht oder nicht aktuell veröffentlicht'), RAND, Math.min(y + 6, UNTEN - 12));
  }
  abschliessen(doc, m);
  return fertig;
}

module.exports = { tagesplanPdf, wochenplanPdf, WASSERZEICHEN };
