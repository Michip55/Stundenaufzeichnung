'use strict';
/**
 * PDF des Bautagesberichts im Aufbau der Papiervorlage (docs/vorlage/Vorlage_Bautagesbericht-1.png).
 * Firmenname als Text, kein Logo. Enthält nie €-Werte (bekommt keine Kostendaten übergeben).
 * Fassung 'ag' (Auftraggeber): Kürzel K und U erscheinen nicht. Fassung 'intern': alle Kürzel.
 */
const PDFDocument = require('pdfkit');
const { deDatum, wienDatum, wienZeit } = require('./datum');

const A4 = { w: 595.28, h: 841.89 };
const X0 = 30;
const BREITE = A4.w - 2 * X0;
const LINKS_B = 300;
const SPALT = 6;
const RX = X0 + LINKS_B + SPALT;
const RECHTS_B = X0 + BREITE - RX;
const GRAU = '#d9d9d9';
const ZEILE = 13.5;

const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const ERSATZ = { 'ı': 'i', 'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D', 'ß': 'ß', 'ŉ': 'n', ' ': ' ' };

/** Text auf den Zeichensatz der PDF-Standardschriften (WinAnsi) abbilden */
function winAnsi(s) {
  if (s === null || s === undefined) return '';
  let out = '';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if ((c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.has(ch) || ch === '\n') { out += ch; continue; }
    if (ERSATZ[ch]) { out += ERSATZ[ch]; continue; }
    const basis = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += /^[\x20-\x7e]$/.test(basis) ? basis : (ch === '\t' ? ' ' : '?');
  }
  return out;
}

const zahl = (x, st = 2) => (x === null || x === undefined || x === '' ? '' : Number(x).toLocaleString('de-AT', { minimumFractionDigits: 0, maximumFractionDigits: st }));

function erzeugeBerichtPdf(bericht, opt = {}) {
  const fassung = opt.fassung || 'ag';
  const firma = opt.firma || { name: 'Michael Pichler Ges.m.b.H.', ort: '2624 Breitenau' };
  const texte = opt.texte || [];
  const doc = new PDFDocument({
    size: 'A4', margin: 0, compress: !opt.unkomprimiert,
    info: { Title: `Bautagesbericht ${bericht.baustelle.kst} ${deDatum(bericht.datum)}`, Author: firma.name, Creator: 'BauTag' }
  });
  const teile = [];
  doc.on('data', (c) => teile.push(c));
  const fertig = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(teile)));
    doc.on('error', reject);
  });

  const t = (s, x, y, o = {}) => {
    const str = winAnsi(s);
    texte.push(str);
    doc.font(o.fett ? 'Helvetica-Bold' : 'Helvetica').fontSize(o.gr || 8.5).fillColor('#000')
      .text(str, x, y, { width: o.b, align: o.align || 'left', lineBreak: Boolean(o.umbruch), height: o.h, characterSpacing: o.abstand || 0, ellipsis: !o.umbruch && o.b ? true : undefined });
  };
  const box = (x, y, w, h, fuell) => {
    if (fuell) doc.rect(x, y, w, h).fillAndStroke(fuell, '#000');
    else doc.rect(x, y, w, h).stroke('#000');
  };
  const label = (s, x, y, w, h = ZEILE + 2) => { box(x, y, w, h, GRAU); t(s, x + 3, y + 3.5, { fett: true, gr: 9, b: w - 6 }); };
  doc.lineWidth(0.6);

  let y = 28;
  const neueSeiteWennNoetig = (bedarf) => {
    if (y + bedarf > A4.h - 34) { fusszeile(); doc.addPage(); y = 30; }
  };
  let seite = 1;
  function fusszeile() {
    const status = { entwurf: 'Entwurf', unterschrieben: 'unterschrieben', freigegeben: 'freigegeben' }[bericht.status] || bericht.status;
    t(`Bautagesbericht ${bericht.baustelle.kst} vom ${deDatum(bericht.datum)} · Status: ${status} · ${fassung === 'intern' ? 'Interne Fassung (mit allen Kürzeln)' : 'Fassung für den Auftraggeber'} · erstellt mit BauTag · Seite ${seite}`,
      X0, A4.h - 26, { gr: 6.5, b: BREITE });
    seite++;
  }

  /* ---- Kopf ---- */
  const kopfH = 66;
  box(X0, y, LINKS_B, kopfH);
  t(firma.name, X0 + 10, y + 10, { fett: true, gr: 15, b: LINKS_B - 20 });
  t('Asphaltierungen · Pflasterungen · Transporte · Kieswerk · Erdbau', X0 + 10, y + 31, { gr: 7.5, b: LINKS_B - 20 });
  t(firma.ort, X0 + 10, y + 45, { fett: true, gr: 10, b: LINKS_B - 20 });
  box(RX, y, RECHTS_B, kopfH);
  box(RX, y, RECHTS_B, 24, GRAU);
  t('BAUTAGESBERICHT', RX, y + 6, { fett: true, gr: 14, b: RECHTS_B, align: 'center', abstand: 3 });
  t(`Datum: ${deDatum(bericht.datum)}`, RX + 8, y + 31, { gr: 9.5, b: 120 });
  t(`KST.: ${bericht.baustelle.kst}`, RX + 130, y + 31, { gr: 9.5, b: RECHTS_B - 136 });
  const w = bericht.wetter;
  const wetterText = !w ? '' : typeof w === 'string' ? w : Object.entries(w).filter(([, x]) => x !== null && x !== '').map(([k, x]) => (k === 'temperatur' || k === 'temp' ? `${zahl(x, 1)} °C` : String(x))).join(', ');
  if (wetterText) t(`Wetter: ${wetterText}`, RX + 8, y + 47, { gr: 8, b: RECHTS_B - 16 });
  y += kopfH + 5;

  /* ---- Auftraggeber / Bauvorhaben ---- */
  const agH = 50;
  box(X0, y, LINKS_B, agH); label('AUFTRAGGEBER:', X0, y, 110);
  t(bericht.baustelle.auftraggeber || '', X0 + 4, y + 20, { gr: 9, b: LINKS_B - 8, fett: true });
  t(bericht.baustelle.agAdresse || '', X0 + 4, y + 33, { gr: 8, b: LINKS_B - 8 });
  box(RX, y, RECHTS_B, agH); label('BAUVORHABEN:', RX, y, 100);
  t(bericht.baustelle.name || bericht.baustelle.bauvorhaben || '', RX + 4, y + 20, { gr: 8.5, b: RECHTS_B - 8, fett: true });
  t(bericht.baustelle.adresse || '', RX + 4, y + 33, { gr: 8, b: RECHTS_B - 8 });
  y += agH + 5;

  /* ---- Links: Personal ---- */
  const yStart = y;
  let yl = y;
  const sp = [110, 30, 30, 30, 30, 32, 38]; // Name, von, bis, von, bis, Pause, Arbstd.
  const sx = [X0];
  for (const s of sp) sx.push(sx[sx.length - 1] + s);
  box(sx[1], yl, sx[5] - sx[1], ZEILE, GRAU);
  t('Arbeitszeit', sx[1], yl + 3, { fett: true, gr: 8.5, b: sx[5] - sx[1], align: 'center' });
  yl += ZEILE;
  box(X0, yl, sp[0], ZEILE + 1, GRAU);
  t('PERSONAL:', X0 + 3, yl + 3.5, { fett: true, gr: 9 });
  ['von', 'bis', 'von', 'bis', 'Pause', 'Arbstd.'].forEach((h, i) => { box(sx[i + 1], yl, sp[i + 1], ZEILE + 1); t(h, sx[i + 1], yl + 3.5, { b: sp[i + 1], align: 'center', gr: 8 }); });
  yl += ZEILE + 1;
  // R-01: Krankenstand nie im PDF – „abw.“ (AG-Fassung ganz ohne). Welche Zeilen/Kürzel der Aufrufer überhaupt bekommt,
  // entscheidet vorher server/datenschutz.js (berichtPersonalPdf) – hier wird nur gedruckt.
  // AG-Fassung: keine persönlichen Abwesenheiten (K, U, ZA) – auch der Polier lädt sie (Inhaber 13.11.2026)
  const versteckt = (c) => fassung === 'ag' && ['K', 'U', 'ZA', 'abwesend'].includes(c);
  const personal = bericht.personal.filter((p) => !(versteckt(p.code) && !p.stunden));
  const zeilen = Math.max(6, personal.length);
  let gesamt = 0;
  for (let i = 0; i < zeilen; i++) {
    const p = personal[i];
    sp.forEach((s, j) => box(sx[j], yl, s, ZEILE));
    if (p) {
      gesamt += p.stunden || 0;
      const code = p.code && !versteckt(p.code) ? (p.code === 'K' || p.code === 'abwesend' ? 'abw.' : p.code) : '';
      t(p.name, sx[0] + 3, yl + 3, { b: sp[0] - 5, gr: 8 });
      [p.von1, p.bis1, p.von2, p.bis2].forEach((z, j) => t(z || '', sx[j + 1], yl + 3, { b: sp[j + 1], align: 'center', gr: 8 }));
      t(p.pauseMin ? zahl(p.pauseMin / 60) : '', sx[5], yl + 3, { b: sp[5], align: 'center', gr: 8 });
      t([p.stunden ? zahl(p.stunden) : '', code].filter(Boolean).join(' '), sx[6], yl + 3, { b: sp[6], align: 'center', gr: 8 });
    }
    yl += ZEILE;
  }
  box(X0, yl, sx[6] - X0, ZEILE + 1, GRAU);
  t('Gesamtstunden:', X0, yl + 3.5, { b: sx[6] - X0, align: 'center', gr: 9 });
  box(sx[6], yl, sp[6], ZEILE + 1);
  t(zahl(gesamt), sx[6], yl + 3.5, { b: sp[6], align: 'center', gr: 8.5, fett: true });
  yl += ZEILE + 1;
  box(X0, yl, LINKS_B, ZEILE);
  // API.md 15.1: ohne Sicht auf fremde Abwesenheiten (Polier/Mitarbeiter, auch mit Ausnahmen) keine Abwesenheits-Legende –
  // nur die Kürzel, die tatsächlich gedruckt sind (SW und ggf. die eigene Zeile)
  const LEGENDE = { 'abw.': 'abw. = abwesend', U: 'U = Urlaub', SW: 'SW = Schlechtwetter', ZA: 'ZA = Zeitausgleich' };
  const gedruckt = new Set(personal.map((p) => (p.code && !versteckt(p.code) ? (p.code === 'K' || p.code === 'abwesend' ? 'abw.' : p.code) : null)).filter(Boolean));
  const legende = fassung === 'ag' ? 'SW = Schlechtwetter'
    : opt.abwesenheitenSichtbar ? 'abw. = abwesend      U = Urlaub      SW = Schlechtwetter      ZA = Zeitausgleich'
      : Object.keys(LEGENDE).filter((k) => k === 'SW' || gedruckt.has(k)).map((k) => LEGENDE[k]).join('      ');
  t(legende, X0 + 3, yl + 3, { gr: 7.5, b: LINKS_B - 6 });
  yl += ZEILE + 8;

  /* ---- Links: Material ---- */
  const mSp = [150, 100, 50];
  box(X0, yl, mSp[0], ZEILE + 1, GRAU); t('MATERIAL:', X0, yl + 3.5, { fett: true, gr: 9, b: mSp[0], align: 'center' });
  box(X0 + mSp[0], yl, mSp[1], ZEILE + 1); t('Menge', X0 + mSp[0], yl + 3.5, { b: mSp[1], align: 'center', gr: 8 });
  box(X0 + mSp[0] + mSp[1], yl, mSp[2], ZEILE + 1);
  yl += ZEILE + 1;
  const matMenge = new Map(bericht.material.map((m) => [m.materialId, m]));
  const vorlageMat = opt.materialien || [];
  const vorlageIds = new Set(vorlageMat.map((m) => m.id));
  const matZeilen = [
    // N-009: erfasste Zeilen mit Name/Einheit aus dem Bericht (Stand beim Erfassen), leere Vorlagezeilen aus den Stammdaten
    ...vorlageMat.map((v) => { const z = matMenge.get(v.id); const m = z ? { code: v.code, name: z.name, einheit: z.einheit } : v; return { name: m.name, einheit: m.einheit === 'to' && /aushub|bruch/i.test(m.code + m.name) ? 'to/m3' : m.einheit === 'to' ? 'to.' : m.einheit, menge: z ? z.menge : null }; }),
    ...bericht.material.filter((m) => !vorlageIds.has(m.materialId)).map((m) => ({ name: m.name, einheit: m.einheit, menge: m.menge }))
  ];
  for (const m of matZeilen) {
    box(X0, yl, mSp[0], ZEILE); box(X0 + mSp[0], yl, mSp[1], ZEILE); box(X0 + mSp[0] + mSp[1], yl, mSp[2], ZEILE);
    t(m.name, X0 + 3, yl + 3, { b: mSp[0] - 6, gr: 8 });
    t(m.menge != null ? zahl(m.menge) : '', X0 + mSp[0], yl + 3, { b: mSp[1], align: 'center', gr: 8 });
    t(m.einheit, X0 + mSp[0] + mSp[1], yl + 3, { b: mSp[2], align: 'center', gr: 8 });
    yl += ZEILE;
  }

  /* ---- Rechts: SEG-Zulagen ---- */
  let yr = yStart + ZEILE;
  const segH = 58;
  box(RX, yr, RECHTS_B, segH);
  label('SEG-Zulagen:', RX, yr, 100);
  t('Tätigkeit:', RX + 4, yr + 20, { gr: 9 });
  t(bericht.seg && bericht.seg.taetigkeit ? bericht.seg.taetigkeit : '', RX + 60, yr + 20, { gr: 8.5, b: RECHTS_B - 64, umbruch: true, h: 22 });
  t('Stunden:', RX + 4, yr + 43, { gr: 9 });
  t(bericht.seg && bericht.seg.stunden != null ? zahl(bericht.seg.stunden) : '', RX + 60, yr + 43, { gr: 8.5, b: 60 });
  yr += segH;

  /* ---- Rechts: Geräte (zwei Spalten wie Vorlage) ---- */
  box(RX, yr, RECHTS_B, ZEILE, null);
  box(RX, yr, 70, ZEILE, GRAU); t('GERÄTE:', RX + 3, yr + 3, { fett: true, gr: 8.5 });
  yr += ZEILE;
  const gStd = new Map();
  for (const g of bericht.geraete) gStd.set(g.geraetId, (gStd.get(g.geraetId) || 0) + g.stunden); // mehrere Anlagen je Gerät (API.md 11.11)
  const vorlageG = opt.geraete || [];
  const vorlageGIds = new Set(vorlageG.map((g) => g.id));
  const sonstige = [...new Map(bericht.geraete.filter((g) => !vorlageGIds.has(g.geraetId)).map((g) => [g.geraetId, { ...g, stunden: gStd.get(g.geraetId) }])).values()];
  const gName = new Map(bericht.geraete.map((g) => [g.geraetId, g.name])); // N-009: Name aus dem Bericht
  const vName = (g) => (gName.has(g.id) ? gName.get(g.id) : g.name);
  const links = vorlageG.slice(0, 7).map((g) => ({ name: vName(g), std: gStd.get(g.id) }));
  if (sonstige.length) sonstige.forEach((g) => links.push({ name: g.name, std: g.stunden }));
  else links.push({ name: '', std: null });
  links.push(...vorlageG.slice(7, 11).map((g) => ({ name: vName(g), std: gStd.get(g.id) })));
  const rechts = vorlageG.slice(11).map((g) => ({ name: vName(g), std: gStd.get(g.id) }));
  const halb = RECHTS_B / 2;
  const gz = Math.max(links.length, rechts.length);
  for (let i = 0; i < gz; i++) {
    for (const [liste, x] of [[links, RX], [rechts, RX + halb]]) {
      const g = liste[i];
      box(x, yr, halb - 34, ZEILE); box(x + halb - 34, yr, 18, ZEILE); box(x + halb - 16, yr, 16, ZEILE);
      if (g) {
        t(g.name, x + 2, yr + 3, { b: halb - 37, gr: 7.5 });
        t(g.std ? zahl(g.std, 1) : '', x + halb - 34, yr + 3, { b: 18, align: 'center', gr: 7.5, fett: true });
        t('Std.', x + halb - 16, yr + 3, { b: 16, align: 'center', gr: 6.5 });
      }
    }
    yr += ZEILE;
  }

  y = Math.max(yl, yr) + 8;

  /* ---- Abschnitte über die ganze Breite ---- */
  const hoehe = (s, b, gr = 8.5) => { doc.font('Helvetica').fontSize(gr); return doc.heightOfString(winAnsi(s) || ' ', { width: b }); };
  function textAbschnitt(titel, inhalt, minZeilen, hinweis) {
    const innen = Math.max(minZeilen * ZEILE, hoehe(inhalt, BREITE - 8) + 6);
    neueSeiteWennNoetig(ZEILE + 2 + innen);
    box(X0, y, BREITE, ZEILE + 2 + innen);
    label(titel, X0, y, titel.length > 16 ? 200 : 140);
    if (hinweis) t(hinweis, X0 + 210, y + 4, { gr: 8, b: BREITE - 214 });
    y += ZEILE + 2;
    for (let i = 1; i < minZeilen; i++) doc.moveTo(X0, y + i * ZEILE).lineTo(X0 + BREITE, y + i * ZEILE).stroke('#999');
    doc.lineWidth(0.6);
    t(inhalt || '', X0 + 4, y + 3, { umbruch: true, b: BREITE - 8, gr: 8.5 });
    y += innen + 6;
  }

  textAbschnitt('ARBEITSLEISTUNG:', bericht.arbeitsleistung, 4);

  // Materialbeistellung
  const mb = bericht.materialbeistellung || {};
  const mbH = Math.max(3 * ZEILE, hoehe(mb.eigen, BREITE / 2 - 8) + 6, hoehe(mb.fremd, BREITE / 2 - 8) + 6);
  neueSeiteWennNoetig(ZEILE + 2 + mbH + ZEILE * 2 + 10);
  box(X0, y, BREITE, ZEILE + 2 + mbH);
  label('MATERIALBEISTELLUNG:', X0, y, 160);
  box(X0 + 160, y, BREITE / 2 - 160, ZEILE + 2, GRAU); t('Eigenmaterial', X0 + 160, y + 3.5, { b: BREITE / 2 - 160, align: 'center', gr: 9 });
  box(X0 + BREITE / 2, y, 130, ZEILE + 2, GRAU); t('Fremdmaterial', X0 + BREITE / 2 + 3, y + 3.5, { gr: 9 });
  y += ZEILE + 2;
  doc.moveTo(X0 + BREITE / 2, y).lineTo(X0 + BREITE / 2, y + mbH).stroke('#000');
  t(mb.eigen || '', X0 + 4, y + 3, { umbruch: true, b: BREITE / 2 - 8 });
  t(mb.fremd || '', X0 + BREITE / 2 + 4, y + 3, { umbruch: true, b: BREITE / 2 - 8 });
  y += mbH;

  // Paletten
  box(X0, y, BREITE, ZEILE + 2); label('PALETTEN RETOUR:', X0, y, 140);
  y += ZEILE + 2;
  box(X0, y, BREITE / 2, ZEILE + 2); box(X0 + BREITE / 2, y, BREITE / 2, ZEILE + 2);
  box(X0, y, 100, ZEILE + 2); box(X0 + BREITE / 2, y, 100, ZEILE + 2);
  const pal = bericht.paletten || {};
  t('Euro:', X0 + 3, y + 3.5, { gr: 9 }); t(pal.euro ? String(pal.euro) : '', X0 + 104, y + 3.5, { gr: 9, fett: true });
  t('Weissenböck:', X0 + BREITE / 2 + 3, y + 3.5, { gr: 9 }); t(pal.weissenboeck ? String(pal.weissenboeck) : '', X0 + BREITE / 2 + 104, y + 3.5, { gr: 9, fett: true });
  y += ZEILE + 8;

  const regieText = (bericht.regie || []).map((r) => `${r.text} – ${zahl(r.stunden)} Std.`).join('\n');
  textAbschnitt('REGIELEISTUNGEN:', regieText, 2);
  textAbschnitt('BESONDERE VORKOMMNISSE:', bericht.vorkommnisse, 2, 'z.B.: Anweisungen AG, Beschädigungen, Sonstiges');

  /* ---- Vermerk: Unterschrift zurückgezogen (C-06) ---- */
  const gnu = bericht.geaendertNachUnterschrift;
  if (gnu) {
    const z = new Date(gnu.zeit);
    neueSeiteWennNoetig(ZEILE + 4);
    t(`Vermerk: Unterschrift ${gnu.rolle === 'bh' ? 'Bauherr' : 'Auftragnehmer'} am ${deDatum(wienDatum(z))} ${wienZeit(z)} zurückgezogen (${gnu.von}) – Bericht danach geändert und neu unterschrieben.`,
      X0, y, { gr: 8, fett: true, b: BREITE });
    y += ZEILE + 2;
  }

  /* ---- Unterschriften ---- */
  const uH = 60;
  neueSeiteWennNoetig(ZEILE + 2 + uH + 10);
  box(X0, y, BREITE, ZEILE + 2, GRAU);
  t('AUFTRAGNEHMER oder dessen Beauftragter', X0 + 3, y + 3.5, { fett: true, gr: 8.5, b: BREITE / 2 - 6 });
  t('BAUHERR oder dessen bevollmächtigter Vertreter', X0 + BREITE / 2 + 3, y + 3.5, { fett: true, gr: 8.5, b: BREITE / 2 - 6 });
  y += ZEILE + 2;
  box(X0, y, BREITE / 2, uH); box(X0 + BREITE / 2, y, BREITE / 2, uH);
  for (const [rolle, x] of [['an', X0], ['bh', X0 + BREITE / 2]]) {
    const u = bericht.unterschriften && bericht.unterschriften[rolle];
    if (!u) continue;
    if (u.bildPng) {
      try {
        const buf = Buffer.from(u.bildPng.slice(u.bildPng.indexOf(',') + 1), 'base64');
        doc.image(buf, x + 10, y + 4, { fit: [BREITE / 2 - 20, uH - 22], align: 'center', valign: 'center' });
      } catch (_) { /* ungültiges Bild: nur Name drucken */ }
    }
    const z = new Date(u.zeit);
    t(`${u.name} · ${deDatum(wienDatum(z))} ${wienZeit(z)}`, x + 4, y + uH - 13, { gr: 8, b: BREITE / 2 - 8 });
  }
  y += uH;
  fusszeile();
  // API.md 12.6: Fotoanhang (2 × 3 je Seite, Beschreibung darunter; WebP nur als Hinweis)
  const fotos = Array.isArray(opt.fotos) ? opt.fotos : [];
  for (let i = 0; i < fotos.length; i += 6) {
    doc.addPage({ size: 'A4', margin: 0 });
    t(`Fotos zum Bautagesbericht ${bericht.baustelle.kst} vom ${deDatum(bericht.datum)}${fotos.length > 6 ? ` (${i / 6 + 1}/${Math.ceil(fotos.length / 6)})` : ''}`, 40, 30, { gr: 11, fett: true, b: 515 });
    fotos.slice(i, i + 6).forEach((f, j) => {
      const fx = 40 + (j % 2) * 265, fy = 60 + Math.floor(j / 2) * 255;
      box(fx, fy, 250, 220);
      if (f.mime === 'image/jpeg' || f.mime === 'image/png') {
        try { doc.image(f.daten, fx + 4, fy + 4, { fit: [242, 212], align: 'center', valign: 'center' }); } catch (_) { t('Bild nicht darstellbar – in der App ansehen', fx + 8, fy + 100, { b: 234, align: 'center' }); }
      } else {
        t('Bild im Format WebP – in der App ansehen', fx + 8, fy + 100, { b: 234, align: 'center' });
      }
      t(`${i + j + 1}. ${f.beschreibung || f.dateiname || ''}`, fx, fy + 224, { gr: 8, b: 250 });
    });
  }
  doc.end();
  return fertig;
}

module.exports = { erzeugeBerichtPdf, winAnsi };
