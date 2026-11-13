'use strict';
/** Diktat, Lieferschein-OCR, Papierbericht, optionale KI (API.md 12.10–12.14) – SDK als Attrappe, keine Live-Aufrufe */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Anthropic = require('@anthropic-ai/sdk').default;
const { starte, U, BS } = require('./hilfe');
const { pngGrau, demoUnterschrift } = require('../../server/png');
const { wienDatum, plusTage } = require('../../server/datum');

const SCHL = 'test-schluessel-0123456789abcdef';

/** SDK-Attrappe: zeichnet Parameter auf, liefert vorgegebene Antworten oder Fehler */
function attrappe() {
  const a = { aufrufe: [], antwort: null, fehler: null, stop: 'end_turn' };
  a.fabrik = (apiKey) => ({
    beta: {
      messages: {
        parse: async (params) => {
          a.aufrufe.push({ apiKey, params });
          if (a.fehler) { const f = a.fehler; a.fehler = null; throw f; }
          const parsed = a.stop === 'end_turn' ? params.output_config.format.parse(JSON.stringify(a.antwort || {})) : null;
          return { stop_reason: a.stop, parsed_output: parsed, usage: { input_tokens: 1234, output_tokens: 56 }, content: [] };
        }
      }
    }
  });
  return a;
}

test('Assistent und KI', async (t) => {
  const ki = attrappe();
  const s = await starte({ schluessel: SCHL, kiClient: ki.fabrik });
  t.after(() => s.stop());
  const pol = await s.login(U.polier);
  const ma = await s.login(U.mitarbeiter);
  const gf = await s.login(U.gf);
  const heute = wienDatum(s.uhr());
  const datum = plusTage(heute, -8);
  s.db.lauf('DELETE FROM bericht WHERE baustelle_id = ? AND datum = ?', BS.pitten, datum);
  const b = (await pol.post('/berichte', { baustelleId: BS.pitten, datum })).daten;

  await t.test('Diktat ohne KI: Regeln, nur Vorschlag (schreibt nichts), Rechte', async () => {
    assert.equal((await ma.post('/bericht-assistent/text', { berichtId: b.id, text: 'Walze 4 Stunden' })).status, 403);
    const vorher = JSON.stringify((await pol.get(`/berichte/${b.id}`)).daten.geraete);
    const r = await pol.post('/bericht-assistent/text', { berichtId: b.id, text: 'Zweiundvierzig Tonnen Frostschutz eingebaut. Lukas acht Stunden. Unterbau verdichtet.' });
    assert.equal(r.status, 200);
    assert.equal(r.daten.quelle, 'regeln');
    assert.deepEqual(r.daten.vorschlag.material.map((m) => [m.code, m.menge]), [['frostschutz', 42]]);
    assert.ok(r.daten.vorschlag.personal.some((p) => p.benutzerId === U.mitarbeiter && p.stunden === 8));
    assert.equal(JSON.stringify((await pol.get(`/berichte/${b.id}`)).daten.geraete), vorher);
    assert.equal(ki.aufrufe.length, 0);
  });

  await t.test('Integrationen: ohne KI „aktiv_ohne_ki“, KI optional', async () => {
    const z = Object.fromEntries((await gf.get('/integrationen')).daten.map((i) => [i.schluessel, i.zustand]));
    assert.equal(z.diktat, 'aktiv_ohne_ki');
    assert.equal(z.ki, 'optional');
    assert.equal(z.lieferschein, 'aktiv_ohne_ki'); // Sprachdaten im npm-Paket
  });

  await t.test('KI einrichten: Schlüssel verschlüsselt, Datenschutz nötig, Test', async () => {
    assert.equal((await pol.put('/einstellungen/ki', { apiKey: 'sk-ant-x' })).status, 403);
    assert.equal((await gf.put('/einstellungen/ki', { apiKey: 'kein' })).status, 400);
    let r = await gf.put('/einstellungen/ki', { apiKey: 'sk-ant-api03-abcdef' });
    assert.equal(r.status, 200);
    assert.deepEqual([r.daten.schluesselGesetzt, r.daten.aktiv, r.daten.modell], [true, false, 'claude-opus-5-5']);
    assert.ok(!JSON.stringify(s.db.einstellung('ki', {})).includes('abcdef'));
    assert.equal((await gf.put('/einstellungen/ki', { aktiv: true })).status, 400); // Datenschutz fehlt
    assert.equal((await gf.post('/einstellungen/ki/test', {})).status, 400);
    r = await gf.put('/einstellungen/ki', { datenschutzBestaetigt: true });
    ki.antwort = { text: 'Verbindung funktioniert.' };
    r = await gf.post('/einstellungen/ki/test', {});
    assert.deepEqual([r.status, r.daten.ok, r.daten.text, r.daten.eingabeTokens], [200, true, 'Verbindung funktioniert.', 1234]);
    const p = ki.aufrufe[0].params;
    assert.equal(ki.aufrufe[0].apiKey, 'sk-ant-api03-abcdef');
    assert.equal(p.model, 'claude-opus-5-5');
    assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
    assert.equal(p.fallbacks, 'default');
    assert.equal(p.output_config.effort, 'medium');
    assert.equal(p.output_config.format.type, 'json_schema');
    assert.equal(p.max_tokens, 16000);
    assert.equal(p.thinking, undefined);
    assert.equal(p.temperature, undefined);
    ki.fehler = new Anthropic.AuthenticationError(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid' } }, 'invalid x-api-key', new Headers());
    r = await gf.post('/einstellungen/ki/test', {});
    assert.deepEqual([r.status, r.daten.code, r.daten.fehler], [502, 'KI_FEHLER', 'API-Schlüssel ungültig']);
    r = await gf.put('/einstellungen/ki', { aktiv: true, tagesLimit: 6 });
    assert.equal(r.daten.aktiv, true);
    assert.equal(Object.fromEntries((await gf.get('/integrationen')).daten.map((i) => [i.schluessel, i.zustand])).diktat, 'aktiv_mit_ki');
  });

  await t.test('Diktat mit KI: Zuordnung durch den Server; Fehler/Ablehnung → Regeln; Tageslimit', async () => {
    ki.antwort = { geraete: [{ name: 'Walze BOMAG', stunden: 4 }, { name: 'Raumschiff', stunden: 1 }], material: [{ name: 'Frostschutz', menge: 42, einheit: 't' }], personal: [{ name: 'Lukas', stunden: 8, von: null, bis: null }], regie: [], arbeitsleistung: 'Unterbau verdichtet.', vorkommnisse: '' };
    let r = await pol.post('/bericht-assistent/text', { berichtId: b.id, text: 'Walze vier Stunden, 42 t Frostschutz, Lukas acht Stunden, Unterbau verdichtet' });
    assert.equal(r.daten.quelle, 'ki', JSON.stringify(r.daten));
    assert.ok(r.daten.vorschlag.material.some((m) => m.code === 'frostschutz' && m.menge === 42));
    assert.ok(r.daten.vorschlag.personal.some((p) => p.benutzerId === U.mitarbeiter));
    assert.ok(r.daten.unklar.some((u) => /Raumschiff/.test(u)));
    assert.equal(ki.aufrufe[ki.aufrufe.length - 1].params.messages[0].content[0].type, 'text');
    ki.fehler = new Anthropic.RateLimitError(429, { type: 'error', error: { type: 'rate_limit_error', message: 'x' } }, 'rate', new Headers());
    r = await pol.post('/bericht-assistent/text', { berichtId: b.id, text: 'Walze 4 Stunden' });
    assert.equal(r.daten.quelle, 'regeln');
    assert.match(r.daten.hinweis, /ausgelastet/);
    ki.stop = 'refusal';
    r = await pol.post('/bericht-assistent/text', { berichtId: b.id, text: 'Walze 4 Stunden' });
    assert.match(r.daten.hinweis, /abgelehnt/);
    ki.stop = 'end_turn';
    ki.fehler = new Anthropic.APIConnectionError({ message: 'Connection error.' });
    r = await pol.post('/bericht-assistent/text', { berichtId: b.id, text: 'Walze 4 Stunden' });
    assert.match(r.daten.hinweis, /nicht erreichbar/);
    r = await pol.post('/bericht-assistent/text', { berichtId: b.id, text: 'Walze 4 Stunden' });
    assert.match(r.daten.hinweis, /Tageslimit/); // Limit 4 erreicht
    const n = (await gf.get('/einstellungen/ki')).daten.heute;
    assert.ok(n.aufrufe >= 4 && n.eingabeTokens > 0);
    await gf.put('/einstellungen/ki', { aktiv: false });
  });

  await t.test('Lieferschein: Foto (art lieferschein) + echte OCR (Deutsch, offline) → Vorschlag', async (tt) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bautag-ls-'));
    tt.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'ls.txt'), 'Kieswerk Mustermann GmbH\nLieferschein Nr. 4711\nDatum: 12.11.2026\nBaustelle: 26-041 WHA Pitten\n\nFrostschutz 0/63      24,50 t\nSplitt 2/4            8,0 t\n');
    const r0 = spawnSync('soffice', ['--headless', '--convert-to', 'png', path.join(dir, 'ls.txt'), '--outdir', dir], { timeout: 120000 });
    if (r0.status !== 0 || !fs.existsSync(path.join(dir, 'ls.png'))) { tt.skip('LibreOffice fehlt – Testbild nicht erzeugbar'); return; }
    const bild = fs.readFileSync(path.join(dir, 'ls.png')).toString('base64');
    assert.equal((await ma.post(`/berichte/${b.id}/lieferschein`, { bildBase64: bild, dateiname: 'ls.png' })).status, 403);
    const r = await pol.post(`/berichte/${b.id}/lieferschein`, { bildBase64: bild, dateiname: 'ls.png' });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    assert.equal(r.daten.quelle, 'ocr');
    assert.equal(r.daten.foto.art, 'lieferschein');
    assert.match(r.daten.text, /Lieferschein/);
    assert.equal(r.daten.vorschlag.lieferscheinNr, '4711');
    assert.equal(r.daten.vorschlag.datum, '2026-11-12');
    assert.match(r.daten.vorschlag.lieferant, /Kieswerk/);
    assert.deepEqual(r.daten.vorschlag.material.map((m) => [m.code, m.menge]).sort(), [['frostschutz', 24.5], ['splitt', 8]]);
    assert.ok((await pol.get(`/berichte/${b.id}`)).daten.fotos.some((f) => f.art === 'lieferschein'));
  });

  await t.test('Lieferschein mit KI: Bild als Base64-Block', async () => {
    await gf.put('/einstellungen/ki', { aktiv: true, tagesLimit: 100 });
    ki.antwort = { lieferant: 'Kieswerk', lieferscheinNr: 'A-17', datum: '2026-11-04', positionen: [{ material: 'Splitt', menge: 12, einheit: 't' }] };
    const v0 = (await pol.get(`/berichte/${b.id}`)).daten.version;
    const r = await pol.post(`/berichte/${b.id}/lieferschein`, { bildBase64: pngGrau(6, 6, Array(36).fill(200)).toString('base64'), dateiname: 'x.png' });
    assert.equal(r.daten.quelle, 'ki');
    // Regression: Lieferschein erhöht die Berichtsversion und liefert sie mit
    assert.equal(r.daten.berichtVersion, v0 + 1);
    assert.equal((await pol.get(`/berichte/${b.id}`)).daten.version, r.daten.berichtVersion);
    assert.deepEqual(r.daten.vorschlag.material.map((m) => [m.code, m.menge]), [['splitt', 12]]);
    const c = ki.aufrufe[ki.aufrufe.length - 1].params.messages[0].content;
    assert.deepEqual([c[0].type, c[0].source.type, c[0].source.media_type], ['image', 'base64', 'image/png']);
    await gf.put('/einstellungen/ki', { aktiv: false });
  });

  await t.test('Papierbericht: Archiv auch nach Unterschrift, höchstens 5 Seiten, nur Büro/GF löschen', async () => {
    await pol.postV(`/berichte/${b.id}/unterschrift`, { rolle: 'an', name: 'Josef Haidbauer', bildPng: demoUnterschrift('p1') });
    const r = await pol.post(`/berichte/${b.id}/papier`, { bildBase64: pngGrau(5, 5, Array(25).fill(90)).toString('base64'), dateiname: 'seite1.png' });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    assert.equal(r.daten.foto.art, 'papier');
    // Regression: Papierbericht ist nur Archivanhang – Version bleibt, wird aber mitgeliefert
    assert.equal(r.daten.berichtVersion, (await pol.get(`/berichte/${b.id}`)).daten.version);
    for (let i = 0; i < 4; i++) assert.equal((await pol.post(`/berichte/${b.id}/papier`, { bildBase64: pngGrau(5, 5, Array(25).fill(100 + i)).toString('base64') })).status, 201);
    assert.equal((await pol.post(`/berichte/${b.id}/papier`, { bildBase64: pngGrau(5, 5, Array(25).fill(150)).toString('base64') })).status, 400);
    assert.equal((await pol.del(`/berichte/${b.id}/fotos/${r.daten.foto.id}`)).status, 403);
    assert.equal((await gf.del(`/berichte/${b.id}/fotos/${r.daten.foto.id}`)).status, 200);
  });
});

test('Papier-Erkennung (Testbetrieb, OCR-Vorgabe)', async (t) => {
  const s = await starte({ test: true });
  t.after(() => s.stop());
  const pol = await s.login(U.polier);
  await pol.post('/test/ocr', { text: 'BAUTAGESBERICHT\nKST 26-041 WHA Pitten\nDatum 05.11.2026\nhandschriftlich …' });
  const r = await pol.post('/berichte/papier', { bildBase64: pngGrau(4, 4, Array(16).fill(1)).toString('base64') });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data ?? r.daten.vorschlag, { datum: '2026-11-05', kst: '26-041', baustelleId: BS.pitten });
  assert.match(r.daten.hinweis, /Handschrift/);
});
