'use strict';
/**
 * API.md 15.4 – Rechte statt Rollenname (Befunde F-008, F-012, F-016, F-017, F-019, F-020, F-021, F-035).
 *
 * Quelltext-Regel für Server (server/**) und Oberfläche (public/js/**): Eine Zugriffsentscheidung hängt an RECHTEN
 * (`ctx.hat(…)` am Server, `ctx.kann(…)` in der Oberfläche), nie am Rollennamen Büro/Bauleiter und nie an `bauleiter_id`
 * (13.1: Bauleiter = Büro in allem; `bauleiterId` bestimmt nur Empfänger von Benachrichtigungen).
 *
 * Verboten (außer mit Kommentar `rolle-ok: <Grund>` auf derselben oder der vorigen Zeile, nur für Anzeige, Routing
 * von Benachrichtigungen, Prüfung der ZIEL-Person oder den Umfang „Büro = Bauleiter = GF“):
 *  1. Vergleich des Rollennamens mit 'bauleiter' oder 'buero' (`rolle === 'bauleiter'`, `rolle !== 'buero'` …)
 *  2. Vergleich mit `bauleiter_id`/`bauleiterId` (JS `===`/`!==` oder SQL `bauleiter_id = ?`)
 *  3. Rollenlisten, die Büro und Bauleiter verschieden behandeln (`['buero','gf'].includes(…)`, `rolle IN ('buero','gf')`)
 *  4. Rollengruppen statt Rechten (`wieBuero(…)`, `BUERO_ROLLEN.includes(…)`)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..');
// Seed/Demo-Daten und Migrationen (schema.js) treffen keine Zugriffsentscheidungen; routes/test.js nur mit BAUTAG_TEST
const AUSGENOMMEN = new Set(['server/seed.js', 'server/fuhrpark-demo.js', 'server/schema.js']);

function dateien(ordner) {
  const out = [];
  const lauf = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'daten') lauf(p); } else if (e.name.endsWith('.js')) out.push(p);
    }
  };
  lauf(path.join(APP, ordner));
  return out;
}

const ROLLE_VERGLEICH = /\brolle\s*[!=]==?\s*['"](bauleiter|buero)['"]|['"](bauleiter|buero)['"]\s*[!=]==?\s*[\w.]*rolle\b/;
const BAULEITER_ID_VERGLEICH = /\bbauleiter_?[iI]d\s*(?:(?:[!=]==|[!=]=(?!=))(?!\s*(?:undefined|null)\b)|=\s*\?)|[!=]==?\s*[\w.]*\bbauleiter_?[iI]d\b/;
const ROLLEN_LISTE = /\[([^\][]*)\]\s*\.includes\(|\brolle\s+(?:NOT\s+)?IN\s*\(([^)]*)\)/gi;
const ROLLEN_GRUPPE = /\bwieBuero\(\s*[^)]|\bBUERO_ROLLEN\.includes\(/;

/** Liefert die Verstöße einer Quelldatei (für den Selbsttest der Regel exportierbar) */
function verstoesse(text, datei) {
  const zeilen = text.split('\n');
  const out = [];
  zeilen.forEach((z, i) => {
    const code = z.replace(/\/\/.*$/, '').trim();
    if (!code || code.startsWith('*') || code.startsWith('/*')) return; // Kommentarzeilen
    if (/rolle-ok:/.test(z) || (i > 0 && /rolle-ok:/.test(zeilen[i - 1]))) return;
    const gruende = [];
    if (ROLLE_VERGLEICH.test(code)) gruende.push('Rollenname Büro/Bauleiter verglichen');
    if (BAULEITER_ID_VERGLEICH.test(code)) gruende.push('bauleiter_id verglichen');
    for (const m of code.matchAll(ROLLEN_LISTE)) {
      const inhalt = m[1] !== undefined ? m[1] : m[2];
      const b = /['"]buero['"]/.test(inhalt), bl = /['"]bauleiter['"]/.test(inhalt);
      if (b !== bl) gruende.push(`Rollenliste behandelt Büro und Bauleiter verschieden: [${inhalt.trim()}]`);
    }
    if (ROLLEN_GRUPPE.test(code)) gruende.push('Rollengruppe statt Recht');
    if (gruende.length) out.push(`${datei}:${i + 1}: ${gruende.join('; ')} → ${z.trim().slice(0, 160)}`);
  });
  return out;
}

test('15.4: keine Zugriffsentscheidung über Rollenname Büro/Bauleiter oder bauleiter_id (Server und Oberfläche)', () => {
  const v = [];
  let n = 0;
  for (const p of [...dateien('server'), ...dateien('public/js')]) {
    const rel = path.relative(APP, p).split(path.sep).join('/');
    if (AUSGENOMMEN.has(rel)) continue;
    n++;
    v.push(...verstoesse(fs.readFileSync(p, 'utf8'), rel));
  }
  assert.ok(n > 80, `nur ${n} Dateien geprüft – Dateisuche defekt?`);
  assert.deepEqual(v, [], `Rollenname/bauleiter_id entscheidet über Zugriff (Recht verwenden oder „rolle-ok: <Grund>“ begründen):\n${v.join('\n')}`);
});

test('15.4: die Regel erkennt die früheren Sonderwege (Selbsttest gegen leere Prüfung)', () => {
  const alt = [
    "  const darfLeistung = (ctx, bs) => ctx.hat('preise_bearbeiten') || (ctx.benutzer.rolle === 'bauleiter' && bs.bauleiter_id === ctx.benutzer.id);",
    "    if (!(req.ctx.hat('preise_bearbeiten') || (ich.rolle === 'bauleiter' && bs.bauleiter_id === ich.id && darfKalk(req.ctx, bs)))) {",
    "    if (!darfEntscheiden(ctx) && ctx.benutzer.rolle !== 'bauleiter') throw keinZugriff('…');",
    "      && Boolean(db.eins('SELECT id FROM baustelle WHERE id = ? AND bauleiter_id = ?', a.stamm, ctx.benutzer.id));",
    "  if ((typeof ctx.hat === 'function' && (ctx.hat('stammdaten') || ctx.hat('lohn'))) || ctx.benutzer.rolle === 'bauleiter') return 'voll';",
    "const istVerwaltung = (ctx) => ctx.hat('fuhrpark') || ['buero', 'gf'].includes(ctx.benutzer.rolle);",
    "const istPlaner = (ctx) => ['buero', 'gf'].includes(ctx.benutzer.rolle) || ctx.hat('stammdaten');",
    "const darfPlanen = () => !!ich && (wieBuero(ich.benutzer.rolle) || kann('stammdaten'));",
    "  const darfBs = (id) => planer || (ich.rolle === 'bauleiter' && eigene.includes(Number(id)));",
    "    if (!verwaltung(req.ctx) && ich.rolle !== 'bauleiter') throw keinZugriff();",
    "  return db.alle(\"SELECT * FROM benutzer WHERE aktiv = 1 AND rolle IN ('buero','gf')\");",
    "      if (!require('../rechte').BUERO_ROLLEN.includes(req.ctx.benutzer.rolle)) throw keinZugriff();",
    "    if (ctx.benutzer.rolle === 'bauleiter') return bs.bauleiter_id === ctx.benutzer.id;"
  ];
  for (const z of alt) assert.equal(verstoesse(z, 'alt.js').length, 1, `nicht erkannt: ${z}`);
  // erlaubt: Rechte, begründete Anzeige/Routing, Listen mit Büro UND Bauleiter, Polier-/Mitarbeiter-Regeln
  const ok = [
    "  const darfLeistung = (ctx) => ctx.hat('preise_bearbeiten');",
    "      if (emp.bauleiter && bs.bauleiter_id === b.id) return true; // rolle-ok: Empfänger des Budget-Alarms (Routing)",
    "  if (['buero', 'bauleiter', 'gf'].includes(b.rolle)) {",
    "    if (ich.rolle === 'polier' && baustelleImBereich(ich, bs)) return;",
    "// const x = rolle === 'bauleiter'",
    "  const alle = db.alle('SELECT id, polier_id, bauleiter_id FROM baustelle');"
  ];
  for (const z of ok) assert.deepEqual(verstoesse(z, 'ok.js'), [], `fälschlich gemeldet: ${z}`);
});

test('15.4: datenschutz.stufe, Planer, Schäden, Leistungen und Mengen hängen allein an Rechten', () => {
  const DS = require('../../server/datenschutz');
  const ctx = (rolle, rechte) => ({ benutzer: { id: 900, rolle }, rechte: new Set(rechte), hat: (r) => rechte.includes(r) });
  for (const rechte of [[], ['stammdaten'], ['lohn'], ['stammdaten', 'lohn'], ['preise_sehen', 'kalk_sehen', 'preise_bearbeiten', 'fuhrpark']]) {
    const s = new Set(['buero', 'bauleiter', 'gf'].map((r) => DS.stufe(ctx(r, rechte))));
    assert.equal(s.size, 1, `Datenschutzstufe hängt am Rollennamen (${rechte.join(',') || 'ohne Rechte'}): ${[...s]}`);
    assert.equal(DS.stufe(ctx('bauleiter', rechte)), rechte.includes('stammdaten') || rechte.includes('lohn') ? 'voll' : 'keine');
    for (const r of ['buero', 'bauleiter', 'gf']) {
      assert.equal(DS.darfDetails(ctx(r, rechte), 3), rechte.includes('stammdaten') || rechte.includes('lohn'));
      assert.equal(DS.aggregateErlaubt(ctx(r, rechte)), rechte.includes('stammdaten') || rechte.includes('lohn'));
    }
  }
  const FD = require('../../server/fuhrpark-daten');
  for (const r of ['buero', 'bauleiter', 'gf']) {
    assert.equal(FD.istVerwaltung(ctx(r, ['stammdaten', 'lohn'])), false, `${r}: Schäden bearbeiten ohne Recht fuhrpark`);
    assert.equal(FD.istVerwaltung(ctx(r, ['fuhrpark'])), true);
  }
  const BV = require('../../server/bauvorhaben');
  for (const r of ['buero', 'bauleiter', 'gf']) {
    assert.equal(BV.istPlaner(ctx(r, ['lohn', 'preise_bearbeiten'])), false, `${r}: Planer ohne Recht stammdaten`);
    assert.equal(BV.istPlaner(ctx(r, ['stammdaten'])), true);
  }
});

module.exports = { verstoesse };
