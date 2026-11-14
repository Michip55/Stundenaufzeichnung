'use strict';
/** 14.6 Korrekturen Nachprüfung – Tages-/Wochenplan-PDF-Layout (N-036, N-038, N-080) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { tagesplanPdf, wochenplanPdf } = require('../../server/planer-pdf');

const H = 595.28, RAND = 32, FUSS = 26, UNTEN = H - RAND - FUSS;

/** Seiten eines unkomprimierten pdfkit-PDFs: Texte (mit Grundlinie, von oben gemessen) und Rechtecke */
function seiten(buf) {
  const s = buf.toString('latin1');
  return [...s.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((m) => {
    const texte = [...m[1].matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm\n\/F\d+ ([\d.]+) Tf\n\[([^\]]*)\]\s*TJ/g)].map((t) => ({
      y: H - Number(t[2]), gr: Number(t[3]), text: [...t[4].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join('')
    }));
    const rects = [...m[1].matchAll(/([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re\n/g)].map((r) => ({ y: Number(r[2]), h: Number(r[4]) }));
    return { texte, rects, alles: texte.map((t) => t.text).join('\n') };
  });
}
const istFuss = (t) => /^Seite \d+ von \d+$/.test(t.text) || / · gedruckt /.test(t.text);

function pruefeSeiten(st, titel) {
  st.forEach((p, i) => {
    assert.ok(p.texte.some((t) => t.text.startsWith(titel)), `Seite ${i + 1}: Seitenkopf fehlt`);
    assert.ok(p.alles.includes(`Seite ${i + 1} von ${st.length}`), `Seite ${i + 1}: Fußzeile`);
    for (const t of p.texte) if (!istFuss(t)) assert.ok(t.y <= UNTEN + 0.5, `Seite ${i + 1}: Text „${t.text.slice(0, 40)}“ unter der Inhaltsgrenze (${t.y.toFixed(1)} > ${UNTEN.toFixed(1)})`);
    for (const r of p.rects) assert.ok(r.y + r.h <= UNTEN + 0.5 && r.y >= 0, `Seite ${i + 1}: Rahmen über die Seite hinaus (${r.y}+${r.h})`);
  });
}

const block = (kst, n, anlagen = 0, extra = {}) => ({
  kst, name: `Baustelle ${kst}`, adresse: 'Pitten', polier: { name: 'Polier P', telefon: '+43 664 1112223' }, beginn: '07:00', treffpunkt: 'Bauhof', arbeit: 'Pflaster', fahrzeug: '',
  personen: Array.from({ length: n }, (_, j) => ({ name: `Person ${kst}-${j}`, rolle: 'Mitarbeiter', notiz: j % 4 ? '' : 'kurze Notiz' })),
  anlagen: Array.from({ length: anlagen }, (_, j) => ({ bezeichnung: `Gerät ${j}`, kennzeichen: `NK-${j}`, fahrer: '', notiz: '' })), benoetigt: 'Rüttelplatte', notiz: `ENDE-BLOCK-${kst}`, ...extra
});
const modell = (bloecke) => ({ titel: 'Einteilung Test', gedruckt: 'jetzt', veroeffentlichtUm: '06:00', entwurf: false, bloecke, fuhren: [], nichtEingeteilt: [] });

test('N-036: Block größer als eine Seite wird mit Kopf und Fortsetzung umbrochen', async () => {
  const buf = await tagesplanPdf(modell([block('26-041', 30, 6), block('26-038', 3)]), { unkomprimiert: true });
  const st = seiten(buf);
  assert.ok(st.length <= 3, `Seiten ${st.length}`);
  assert.ok(st.length >= 2);
  pruefeSeiten(st, 'Einteilung Test');
  const alle = st.map((p) => p.alles).join('\n');
  for (let j = 0; j < 30; j++) assert.ok(alle.includes(`Person 26-041-${j} (Mitarbeiter)`), `Person ${j}`);
  assert.ok(alle.includes('ENDE-BLOCK-26-041') && alle.includes('ENDE-BLOCK-26-038'));
  assert.ok(st[1].texte.some((t) => t.text.startsWith('26-041  Baustelle 26-041 (Fortsetzung)')), 'Block-Kopf auf der Folgeseite');
  // keine Seite mit nur einer Zeile (alter Fehler: pdfkit-Autoumbruch eine Zeile je Seite)
  st.forEach((p, i) => assert.ok(p.texte.filter((t) => !istFuss(t)).length >= 3, `Seite ${i + 1} fast leer`));
});

test('N-036: eine einzelne Zeile höher als eine Seite wird abgeschnitten statt automatisch umbrochen', async () => {
  const buf = await tagesplanPdf(modell([block('26-050', 2, 0, { notiz: 'Sehr lange Notiz '.repeat(600) })]), { unkomprimiert: true });
  const st = seiten(buf);
  assert.ok(st.length <= 2, `Seiten ${st.length}`);
  pruefeSeiten(st, 'Einteilung Test');
});

test('N-038: langer Baustellenname wird im Blockkopf auf eine Zeile gekürzt', async () => {
  const name = 'Wohnhausanlage Pitten Außenanlagen Kanal Wasser Strom und Pflasterarbeiten Bauteil Nord Süd und noch viel mehr Text bis zum Ende';
  const buf = await tagesplanPdf(modell([block('26-041', 3, 0, { name, adresse: '2823 Pitten, Hauptstraße 1' })]), { unkomprimiert: true });
  const [p] = seiten(buf);
  const kopf = p.texte.filter((t) => t.gr === 15);
  assert.equal(kopf.length, 1, `Blockkopf in ${kopf.length} Zeilen: ${kopf.map((t) => t.text).join(' | ')}`);
  assert.ok(kopf[0].text.endsWith('\x85') /* WinAnsi-Ellipse */ && kopf[0].text.startsWith('26-041  Wohnhausanlage'));
  const polier = p.texte.find((t) => t.text.startsWith('Polier:'));
  assert.ok(polier.y - kopf[0].y > 12, 'Polier-Zeile nicht überdeckt');
  assert.ok(p.alles.includes('2823 Pitten'));
  // ein langes Einzelwort
  const [q] = seiten(await tagesplanPdf(modell([block('26-042', 3, 0, { name: 'X'.repeat(200) })]), { unkomprimiert: true }));
  assert.equal(q.texte.filter((t) => t.gr === 15).length, 1);
});

test('N-080: Wochenplan-Zeile höher als eine Seite wird auf Folgeseiten verteilt', async () => {
  const tage = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map((d) => ({ datum: d, label: d.slice(8), entwurf: false }));
  const lang = Array.from({ length: 60 }, (_, j) => `Doppelname Mitarbeiterin-${j} Huber-Wagner`);
  const m = { titel: 'Wochenplan Test', gedruckt: 'jetzt', veroeffentlichtUm: '06:00', entwurf: false, tage,
    zeilen: [{ kst: '26-001', name: 'Vorher', zellen: { '2026-11-09': ['A'] } }, { kst: '26-041', name: 'Pitten', zellen: { '2026-11-10': lang, '2026-11-11': ['B'] } }, { kst: '26-099', name: 'MARKER-NACHHER', zellen: { '2026-11-12': ['C'] } }] };
  const st = seiten(await wochenplanPdf(m, { unkomprimiert: true }));
  pruefeSeiten(st, 'Wochenplan Test');
  const alle = st.map((p) => p.alles).join('\n');
  for (let j = 0; j < 60; j++) assert.ok(alle.includes(`Mitarbeiterin-${j} `), `Eintrag ${j}`);
  assert.ok(st.slice(1).some((p) => p.alles.includes('26-041 (Forts.)')), 'Fortsetzungs-Kennzeichen');
  st.forEach((p, i) => assert.ok(p.alles.includes('Baustelle'), `Tabellenkopf auf Seite ${i + 1}`));
});

test('15.7 (Rest N-036): ein Block größer als eine Seite beginnt auf der laufenden Seite, sie bleibt nicht fast leer', async () => {
  const buf = await tagesplanPdf(modell([block('26-038', 3), block('26-041', 30, 6)]), { unkomprimiert: true });
  const st = seiten(buf);
  pruefeSeiten(st, 'Einteilung Test');
  assert.ok(st[0].texte.some((t) => t.text.startsWith('26-041  Baustelle 26-041') && !t.text.includes('Fortsetzung')), 'großer Block beginnt auf Seite 1');
  assert.ok(st[0].alles.includes('Person 26-041-0 (Mitarbeiter)'), 'erste Personen auf Seite 1');
  const alle = st.map((p) => p.alles).join('\n');
  for (let j = 0; j < 30; j++) assert.ok(alle.includes(`Person 26-041-${j} (Mitarbeiter)`), `Person ${j}`);
  assert.ok(alle.includes('ENDE-BLOCK-26-041') && alle.includes('ENDE-BLOCK-26-038'));
});

test('15.7 (Rest N-080): Wochenplan misst Zellen nach dem Seitenwechsel mit der Zellenschrift (nicht mit der Kopfschrift)', async () => {
  const tage = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map((d) => ({ datum: d, label: d.slice(8), entwurf: false }));
  const m = { titel: 'Wochenplan Test', gedruckt: 'jetzt', veroeffentlichtUm: '06:00', entwurf: false, tage,
    zeilen: [{ kst: '26-001', name: 'Vorher', zellen: { '2026-11-09': ['A'] } }, { kst: '26-041', name: 'Pitten', zellen: { '2026-11-10': Array.from({ length: 60 }, (_, j) => `Mitarbeiter ${j}`) } }, { kst: '26-002', name: 'MARKER-NACHHER', zellen: { '2026-11-09': ['B'] } }] };
  const st = seiten(await wochenplanPdf(m, { unkomprimiert: true }));
  pruefeSeiten(st, 'Wochenplan Test');
  // 60 einzeilige Einträge passen auf zwei Seiten (früher 4: zu früher Umbruch und fast leere erste Seite)
  assert.equal(st.length, 2, `Seiten ${st.length}`);
  const alle = st.map((p) => p.alles).join('\n');
  for (let j = 0; j < 60; j++) assert.ok(alle.includes(`Mitarbeiter ${j}`), `Eintrag ${j}`);
  assert.ok(alle.includes('MARKER-NACHHER'));
});
