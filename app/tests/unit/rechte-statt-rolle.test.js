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
 * G2-012 (API.md 15.13) – auch die naheliegenden Umgehungen:
 *  5. Vergleich JEDES Ausdrucks mit dem Text 'buero'/'bauleiter' (`r === 'buero'`, `'bauleiter' == x`), auch wenn der
 *     Text zusammengesetzt ist ('bau' + 'leiter', `bau${'leiter'}`, `buero`)
 *  6. Rollenlisten mit indexOf/lastIndexOf/some/find/findIndex/Set.has; benannte Listen (`const X = ['buero', 'gf']`),
 *     die Büro und Bauleiter verschieden enthalten
 *  7. switch über den Rollennamen mit nur einem der beiden Fälle oder mit verschiedenen Zweigen für beide
 *  8. Rollen als Schlüssel einer Zuordnung, die mit dem Rollennamen gelesen wird (`{ bauleiter: x }[ctx.benutzer.rolle]`,
 *     `const M = { buero: true, gf: true }; … M[rolle]`) – nur einer der beiden Schlüssel oder verschiedene Werte
 *     (außer reinen Anzeigetexten)
 *  9. bauleiter_id in Rechenausdrücken/Hilfsfunktionen (`bauleiter_id - ich.id`, `Object.is(…bauleiter_id…)`,
 *     `[…].includes(bs.bauleiter_id)`, SQL `bauleiter_id IN (…)`, `bauleiter_id <> ?`, `bauleiter_id = ${…}`)
 * 15.17 (H-T6) – jede andere Auswertung des Rollentexts statt eines Rechts:
 * 10. RegExp auf den Rollentext (`/leiter$/.test(ctx.benutzer.rolle)`, `rolle.match(…)`, `new RegExp(…).exec(rolle)`),
 *     String-Methoden und Eigenschaften (`rolle.startsWith/endsWith/includes/indexOf/slice/length/split/…`), Index
 *     (`rolle[0]`) und Größenvergleich (`rolle < 'c'`, `x > rolle`)
 * 11. Bruchstücke der Rollennamen Büro/Bauleiter (je mindestens vier Buchstaben, z. B. „leiter“, „baul“, „buer“) in einem
 *     RegExp-Literal mit .test/.exec/.match/.search/.replace/.split bzw. new RegExp(…), als Argument einer String-Suche
 *     (`r.endsWith('leiter')`) oder als durchsuchter Text (`'bauleiter'.includes(r)`) – auch wenn der Rollentext unter
 *     einem anderen Namen steht
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
const ROLLEN_LISTE = /\[([^\][]*)\]\s*\.(?:includes|indexOf|lastIndexOf|some|find|findIndex|every|filter)\(|\brolle\s+(?:NOT\s+)?IN\s*\(([^)]*)\)|new\s+Set\(\s*\[([^\][]*)\]\s*\)\s*\.has\(/gi;
// G2-012: Vergleich eines beliebigen Ausdrucks mit dem Rollentext (nach dem Zusammensetzen von Text-Stücken)
const TEXT_VERGLEICH = /[!=]==?\s*['"`](bauleiter|buero)['"`]|['"`](bauleiter|buero)['"`]\s*[!=]==?/;
// G2-012: benannte Rollenliste (Definition) – enthält Rollennamen, aber nur einen von Büro/Bauleiter
const BENANNTE_LISTE = /\b(?:const|let|var)\s+\w+\s*=\s*(?:new\s+Set\(\s*)?\[([^\][]*)\]/g;
const BAULEITER_ID_SONST = /\bbauleiter_?[iI]d\s*(?:[-+^]|<>|!=(?!=)|\s+IN\s*\(|\s+IS\s+(?!NULL|NOT\s+NULL)|=\s*\$\{|=\s*:\w|=\s*\d)|[-^]\s*[\w.]*\bbauleiter_?[iI]d\b|Object\.is\([^)]*bauleiter_?[iI]d|\.(?:includes|indexOf|has)\(\s*[\w.]*bauleiter_?[iI]d|\[[^\]]*\bbauleiter_?[iI]d\b[^\]]*\]\s*\.(?:includes|indexOf|some|find)\(/;
const ROLLEN_NAMEN = /['"`](mitarbeiter|polier|bauleiter|buero|gf)['"`]/;
// 15.17 (H-T6) Regel 10: Rollentext mit RegExp, String-Methode/-Eigenschaft, Index oder < > ausgewertet
const ROLLE_TEXT_OP = /\.(?:test|exec)\(\s*[^)]*\brolle\b|\brolle\b\s*(?:\?\.|\.)\s*(?:match|matchAll|search|startsWith|endsWith|includes|indexOf|lastIndexOf|slice|substring|substr|charAt|charCodeAt|codePointAt|at|length|split|localeCompare|replace|replaceAll|toLowerCase|toUpperCase|toLocaleLowerCase|toLocaleUpperCase|trim|trimStart|trimEnd|normalize|padStart|padEnd|concat)\b|\brolle\b\s*(?:\?\.)?\[\s*\d|\brolle\b\s*(?:<=?|>=?)(?![=>])|(?<![=\-<>])(?:<=?|>=?)\s*[\w.]*\brolle\b(?!\s*=)/;
// Regel 11: Bruchstücke (≥ 4 Buchstaben) von „bauleiter“/„buero“ – ohne „iter“, „eite“, „eiter“ (weiter, Seite, Liter)
const ROLLEN_STUECKE = (() => { const f = new Set(); for (const w of ['bauleiter', 'buero']) for (let i = 0; i < w.length; i++) for (let j = i + 4; j <= w.length; j++) f.add(w.slice(i, j)); for (const x of ['iter', 'eite', 'eiter']) f.delete(x); return [...f]; })();
const hatRollenStueck = (t) => ROLLEN_STUECKE.some((x) => String(t).toLowerCase().includes(x));
const REGEX_LITERAL = /\/(?![*/])((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+)\/[dgimsuyv]*\s*\.\s*(?:test|exec)\(|\.(?:match|matchAll|search|replace|replaceAll|split)\(\s*\/((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+)\/|new\s+RegExp\(\s*(['"`])([^'"`]*)\3/g;
const TEXT_SUCHE_ARG = /\.\s*(?:startsWith|endsWith|includes|indexOf|lastIndexOf|search|match|localeCompare)\(\s*(['"`])([^'"`]*)\1/g;
const TEXT_SUCHE_IN = /(['"`])([^'"`\n]*)\1\s*\.\s*(?:includes|indexOf|lastIndexOf|startsWith|endsWith|search|match)\(/g;

/** Text-Stücke zusammensetzen: 'bau' + 'leiter' → 'bauleiter', `bu${'ero'}` → 'buero', `buero` → 'buero' */
function zusammensetzen(code) {
  let alt;
  let c = code.replace(/`([^`$\\]*)\$\{\s*(['"])([^'"\\]*)\2\s*\}([^`$\\]*)`/g, (m, a, q, b, z) => `'${a}${b}${z}'`).replace(/`([^`$\\]*)`/g, "'$1'");
  do { alt = c; c = c.replace(/(['"])([^'"\\\n]*)\1\s*\+\s*(['"])([^'"\\\n]*)\3/g, (m, q1, a, q2, b) => `'${a}${b}'`); } while (c !== alt);
  return c;
}

/** Kommentare entfernen (Zeilen bleiben erhalten), Texte bleiben */
function ohneKommentare(text) {
  let out = '';
  let i = 0, str = null;
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (str) { out += c; if (c === '\\') { out += n || ''; i += 2; continue; } if (c === str) str = null; i++; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { const e = text.indexOf('*/', i + 2); const stueck = text.slice(i, e < 0 ? text.length : e + 2); out += stueck.replace(/[^\n]/g, ' '); i += stueck.length; continue; }
    if (c === "'" || c === '"' || c === '`') str = c;
    out += c; i++;
  }
  return out;
}

/** G2-012: Strukturen über mehrere Zeilen – switch über die Rolle, Rollen-Zuordnungen */
function strukturVerstoesse(text, datei) {
  const code = zusammensetzen(ohneKommentare(text));
  const zeilen = text.split('\n');
  const zeileVon = (pos) => code.slice(0, pos).split('\n').length;
  const ok = (z) => /rolle-ok:/.test(zeilen[z - 1] || '') || /rolle-ok:/.test(zeilen[z - 2] || '');
  const out = [];
  const melde = (pos, grund) => { const z = zeileVon(pos); if (!ok(z)) out.push(`${datei}:${z}: ${grund} → ${(zeilen[z - 1] || '').trim().slice(0, 160)}`); };
  // switch (…) { case 'buero': … }
  for (const m of code.matchAll(/\bswitch\s*\(([^)]*)\)\s*\{/g)) {
    let tiefe = 1, i = m.index + m[0].length;
    while (i < code.length && tiefe) { if (code[i] === '{') tiefe++; else if (code[i] === '}') tiefe--; i++; }
    const block = code.slice(m.index + m[0].length, i - 1);
    const faelle = [...block.matchAll(/\bcase\s+['"](\w+)['"]\s*:/g)].map((x) => x[1]);
    const b = faelle.includes('buero'), bl = faelle.includes('bauleiter');
    if (!b && !bl) continue;
    if (b !== bl) { melde(m.index, `switch über die Rolle mit nur einem Fall für ${b ? 'buero' : 'bauleiter'}`); continue; }
    if (!/\bcase\s+['"](buero|bauleiter)['"]\s*:\s*case\s+['"](buero|bauleiter)['"]\s*:/.test(block)) melde(m.index, 'switch über die Rolle mit verschiedenen Zweigen für buero und bauleiter');
  }
  // Zuordnungen mit Rollen als Schlüssel, die mit einem Rollennamen gelesen werden
  const wert = (obj, k) => { const x = new RegExp(`(?:^|[{,\\s])['"]?${k}['"]?\\s*:\\s*([^,}]*)`).exec(obj); return x ? x[1].trim() : null; };
  for (const m of code.matchAll(/(?:\b(?:const|let|var)\s+(\w+)\s*=\s*)?\{([^{}]*)\}(\s*\[[^\]]*\])?/g)) {
    const obj = m[2];
    if (!/(?:^|[{,\s])['"]?(buero|bauleiter)['"]?\s*:/.test(obj)) continue;
    const gelesen = (m[3] && /rolle/i.test(m[3])) || (m[1] && new RegExp(`\\b${m[1]}\\s*(?:\\?\\.)?\\[[^\\]]*rolle`, 'i').test(code));
    if (!gelesen) continue;
    const wb = wert(obj, 'buero'), wbl = wert(obj, 'bauleiter');
    if ((wb === null) !== (wbl === null)) melde(m.index, `Zuordnung je Rolle mit nur dem Schlüssel ${wb === null ? 'bauleiter' : 'buero'}`);
    else if (wb !== wbl && !(/^(['"]).*\1$/.test(wb) && /^(['"]).*\1$/.test(wbl))) melde(m.index, `Zuordnung je Rolle mit verschiedenen Werten für buero (${wb}) und bauleiter (${wbl})`);
  }
  return out;
}
const ROLLEN_GRUPPE = /\bwieBuero\(\s*[^)]|\bBUERO_ROLLEN\.includes\(/;

/** Liefert die Verstöße einer Quelldatei (für den Selbsttest der Regel exportierbar) */
function verstoesse(text, datei) {
  const zeilen = text.split('\n');
  const out = [];
  zeilen.forEach((z, i) => {
    const code = zusammensetzen(z.replace(/\/\/.*$/, '').trim());
    if (!code || code.startsWith('*') || code.startsWith('/*')) return; // Kommentarzeilen
    if (/rolle-ok:/.test(z) || (i > 0 && /rolle-ok:/.test(zeilen[i - 1]))) return;
    const gruende = [];
    if (ROLLE_VERGLEICH.test(code) || TEXT_VERGLEICH.test(code)) gruende.push('Rollenname Büro/Bauleiter verglichen');
    if (BAULEITER_ID_VERGLEICH.test(code) || BAULEITER_ID_SONST.test(code)) gruende.push('bauleiter_id verglichen');
    for (const m of code.matchAll(BENANNTE_LISTE)) {
      const inhalt = m[1];
      if (!ROLLEN_NAMEN.test(inhalt)) continue;
      const b = /['"]buero['"]/.test(inhalt), bl = /['"]bauleiter['"]/.test(inhalt);
      if (b !== bl) gruende.push(`benannte Rollenliste behandelt Büro und Bauleiter verschieden: [${inhalt.trim()}]`);
    }
    for (const m of code.matchAll(ROLLEN_LISTE)) {
      const inhalt = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3];
      const b = /['"]buero['"]/.test(inhalt), bl = /['"]bauleiter['"]/.test(inhalt);
      if (b !== bl) gruende.push(`Rollenliste behandelt Büro und Bauleiter verschieden: [${inhalt.trim()}]`);
    }
    if (ROLLEN_GRUPPE.test(code)) gruende.push('Rollengruppe statt Recht');
    // 15.17 (H-T6)
    if (ROLLE_TEXT_OP.test(code)) gruende.push('Rollentext mit RegExp/String-Methode/Länge/Vergleich ausgewertet');
    for (const m of code.matchAll(REGEX_LITERAL)) if (hatRollenStueck(m[1] || m[2] || m[4] || '')) gruende.push(`RegExp mit Bruchstück eines Rollennamens: ${m[1] || m[2] || m[4]}`);
    for (const m of code.matchAll(TEXT_SUCHE_ARG)) if (hatRollenStueck(m[2])) gruende.push(`Text-Suche nach Bruchstück eines Rollennamens: '${m[2]}'`);
    for (const m of code.matchAll(TEXT_SUCHE_IN)) if (hatRollenStueck(m[2])) gruende.push(`Suche in einem Text mit Rollennamen: '${m[2]}'`);
    if (gruende.length) out.push(`${datei}:${i + 1}: ${[...new Set(gruende)].join('; ')} → ${z.trim().slice(0, 160)}`);
  });
  return out.concat(strukturVerstoesse(text, datei));
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

test('G2-012: die Regel erkennt auch naheliegende Umgehungen (Zusammensetzen, indexOf/Set, benannte Listen, switch, Zuordnungen, bauleiter_id-Rechnung)', () => {
  const umgehung = [
    // Abschlussprüfung G2-012, Injektion L11 (server/routes/berichte.js)
    '    const nurEigene = { bauleiter: q.baustelleId !== undefined }[ctx.benutzer.rolle];',
    '    if (nurEigene) sichtbar.splice(0, sichtbar.length, ...sichtbar.filter((z) => !(z.bauleiter_id - ctx.benutzer.id)));',
    "  if (r === 'bu' + 'ero') return 1;",
    "  if (x.rolle === `bau${'leiter'}`) return 1;",
    '  if (x.rolle === `buero`) return 1;',
    "  if ('buero' == typ) return 1;",
    "  if (['buero', 'gf'].indexOf(ctx.benutzer.rolle) >= 0) return 1;",
    "  if (new Set(['buero', 'gf']).has(rolle)) x();",
    "  const VERWALTUNG = ['buero', 'gf'];",
    "  switch (ctx.benutzer.rolle) {\n    case 'buero': return true;\n    default: return false;\n  }",
    "  switch (ctx.benutzer.rolle) {\n    case 'buero': return true;\n    case 'bauleiter': return false;\n  }",
    '  const M = { buero: true, gf: true };\n  if (M[ctx.benutzer.rolle]) x();',
    '  const M = { buero: true, bauleiter: false, gf: true };\n  if (M[ctx.benutzer.rolle]) x();',
    '  if (Object.is(bs.bauleiter_id, ich.id)) x();',
    '  if ([bs.bauleiter_id].includes(ich.id)) x();',
    "  db.alle('SELECT * FROM baustelle WHERE bauleiter_id IN (?)', id);",
    '  db.alle(`SELECT * FROM baustelle WHERE bauleiter_id = ${id}`);',
    "  db.alle('SELECT * FROM baustelle WHERE bauleiter_id <> ?', id);"
  ];
  for (const z of umgehung) assert.ok(verstoesse(z, 'umgehung.js').length >= 1, `nicht erkannt: ${z}`);
  const ok = [
    "  const ROLLE_KURZ = { mitarbeiter: 'Mitarbeiter', polier: 'Polier', bauleiter: 'Bauleiter', buero: 'Büro', gf: 'GF' };\n  x = ROLLE_KURZ[b.rolle];",
    "  switch (ctx.benutzer.rolle) {\n    case 'buero': case 'bauleiter': return true;\n    default: return false;\n  }",
    '  const emp = parseJson(bs.empfaenger, { bauleiter: true, buero: true, gf: true });',
    "  const ROLLEN = ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf'];",
    "  const alle = db.alle('SELECT id FROM baustelle WHERE bauleiter_id IS NULL');",
    "  const url = 'https://x.example/buero'; // Kommentar mit rolle === 'buero'"
  ];
  for (const z of ok) assert.deepEqual(verstoesse(z, 'ok.js'), [], `fälschlich gemeldet: ${z}`);
});

test('15.17 (H-T6): die Regel erkennt Rollenprüfungen per RegExp, String-Methode, Länge, Index, Größenvergleich und Bruchstück', () => {
  const umgehung = [
    // Nachkontrolle H-T6, Injektion public/js/views/baustellen.js:68 und server/routes/stammdaten.js
    "  const darf = ctx.kann('stammdaten') && !/leiter$/.test(ctx.ich.benutzer.rolle);",
    "    if (body.bauleiterId !== undefined && /leiter$/.test(req.ctx.benutzer.rolle)) throw keinZugriff('…');",
    "  if (ctx.benutzer.rolle.endsWith('leiter')) return false;",
    "  if (ich.rolle.startsWith('bau')) return false;",
    "  if (ich.rolle?.includes('eit')) return false;",
    "  if (rolle.match(/^b/)) x();",
    "  if (ctx.benutzer.rolle.length === 9) x();",
    "  if (ctx.benutzer.rolle[0] === 'b') x();",
    "  if (ctx.benutzer.rolle > 'buero') x();",
    "  if ('c' < ctx.benutzer.rolle) x();",
    "  if (new RegExp('leiter').exec(r)) x();",
    "  const r = ctx.benutzer.rolle; if (/bau.?leit/i.test(r)) x();",
    "  if (r.endsWith('leiter')) x();",
    "  if (String(r).indexOf('uero') >= 0) x();",
    "  if ('bauleiter gf'.includes(r)) x();",
    "  const kurz = r.replace(/leiter$/, ''); if (kurz === 'bau') x();"
  ];
  for (const z of umgehung) assert.ok(verstoesse(z, 'umgehung.js').length >= 1, `nicht erkannt: ${z}`);
  const ok = [
    "  const titel = `${ROLLE_KURZ[b.rolle]} ${b.name}`;",
    '  const zeilen = liste.filter((b) => b.aktiv).map((b) => ({ id: b.id, rolle: b.rolle }));',
    "  const fehler = /Büro/i.test(e.message || '') ? '' : ' Bitte im Büro melden.';",
    "  if (/weiter|Seite|Liter/.test(text)) x();",
    "  const f = (rolle) => rolle === 'polier';",
    "  const darf = ctx.kann('stammdaten') && !/leiter$/.test(ctx.ich.benutzer.rolle); // rolle-ok: nur Beispiel einer begründeten Anzeige"
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
