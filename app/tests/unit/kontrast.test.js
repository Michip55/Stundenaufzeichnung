'use strict';
/**
 * N-100: Status-Chips und Hinweisflächen erreichen WCAG 2.1 AA (Kontrast ≥ 4,5:1 für normale Schrift).
 * Liest die Farben direkt aus public/css/app.css (Variablen in :root aufgelöst) – ändert jemand eine Farbe, schlägt der Test an.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../../public/css/app.css'), 'utf8');
const root = css.match(/:root\s*\{([^}]*)\}/)[1];
const vars = Object.fromEntries([...root.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const farbe = (w) => { const v = w.trim().match(/^var\(--([\w-]+)\)$/); const x = v ? vars[v[1]] : w.trim(); assert.match(x, /^#[0-9a-f]{6}$/i, `Farbe ${w} nicht auflösbar`); return x; };
const regel = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|[\\s}])${esc}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `Regel ${sel} fehlt in app.css`);
  const wert = (eig) => { const x = m[1].match(new RegExp(`(?:^|;)\\s*${eig}\\s*:\\s*([^;]+)`)); return x && x[1]; };
  return { vordergrund: farbe(wert('color')), hintergrund: farbe(wert('background')) };
};
const lum = (h) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const kontrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('Kontrastberechnung (Referenzwerte WCAG)', () => {
  assert.equal(kontrast('#000000', '#ffffff').toFixed(2), '21.00');
  assert.equal(kontrast('#777777', '#ffffff').toFixed(2), '4.48');
  // die alten Farben aus dem Befund N-100 lagen knapp darunter
  assert.ok(kontrast('#14803c', '#e3f5e9') < 4.5);
  assert.ok(kontrast('#a85a06', '#fdf0cf') < 4.5);
});

test('Status-Chips und „veröffentlicht“-Hinweis: Text/Hintergrund ≥ 4,5:1', () => {
  const zuKlein = [];
  for (const sel of ['.st-grey', '.st-amber', '.st-green', '.st-blue', '.st-red', '.tg-auto.veroeffentlicht']) {
    const { vordergrund, hintergrund } = regel(sel);
    const k = kontrast(vordergrund, hintergrund);
    if (k < 4.5) zuKlein.push(`${sel}: ${vordergrund} auf ${hintergrund} = ${k.toFixed(2)}:1`);
  }
  assert.deepEqual(zuKlein, []);
});

test('Grün und Gelb als Textfarbe auf Weiß ≥ 4,5:1', () => {
  for (const v of ['green', 'amber', 'blue', 'red-d', 'muted']) assert.ok(kontrast(farbe(`var(--${v})`), '#ffffff') >= 4.5, `--${v} auf Weiß`);
});
