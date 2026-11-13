'use strict';
/** Prüfbericht 6 – Bericht: G-02 (Fuhren ändern den Bericht → Version + Fern-Links ungültig), G-15 (KI-Hinweis, Foto ohne EXIF) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');
const { testJpeg } = require('./fuhrpark-bilder');

const HEUTE = '2026-11-12';

test('G-02: erledigte Fuhre und fuhren-uebernehmen erhöhen die Version und machen Fern-Links ungültig', async (t) => {
  const s = await starte({ test: true, url: 'https://bautag.example.at' });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  const pol = await s.login(U.polier);
  const anon = s.client();
  const linkStatus = async (id) => (await pol.get(`/berichte/${id}/unterschrift-links`)).daten.map((x) => x.status);
  const ver = async (id) => (await pol.get(`/berichte/${id}`)).daten.version;

  // a) offener Bericht: Fuhre erledigt → Zeile direkt im Bericht
  s.db.lauf('DELETE FROM bericht WHERE baustelle_id = ? AND datum = ?', BS.pitten, HEUTE);
  const b = (await pol.post('/berichte', { baustelleId: BS.pitten, datum: HEUTE })).daten;
  const l = (await pol.post(`/berichte/${b.id}/unterschrift-link`, { rolle: 'bh' })).daten;
  const tok = l.url.split('/').pop();
  assert.equal((await anon.get(`/fern/${tok}`)).status, 200);
  const v0 = await ver(b.id);
  const f = await gf.post('/plan/fuhren', { datum: HEUTE, anlageId: 4, materialId: 4, menge: 12, einheit: 't', nach: { art: 'baustelle', baustelleId: BS.pitten } });
  assert.equal(f.status, 201, JSON.stringify(f.daten));
  const st = await gf.post(`/plan/fuhren/${f.daten.id}/status`, { status: 'erledigt' });
  assert.equal(st.status, 200);
  assert.equal(st.daten.berichtZeile.status, 'uebernommen');
  assert.equal(await ver(b.id), v0 + 1);
  assert.equal(st.daten.berichtZeile.berichtVersion, v0 + 1);
  assert.deepEqual(await linkStatus(b.id), ['ungueltig']);
  assert.notEqual((await anon.get(`/fern/${tok}`)).status, 200, 'Bauherr kann den geänderten Bericht nicht mehr über den alten Link unterschreiben');

  // b) Vorschlag (noch kein Bericht) → später übernehmen
  s.db.lauf('DELETE FROM bericht WHERE baustelle_id = ? AND datum = ?', BS.kogler, HEUTE);
  const f2 = await gf.post('/plan/fuhren', { datum: HEUTE, anlageId: 4, materialId: 4, menge: 8, einheit: 't', nach: { art: 'baustelle', baustelleId: BS.kogler } });
  assert.equal((await gf.post(`/plan/fuhren/${f2.daten.id}/status`, { status: 'erledigt' })).daten.berichtZeile.status, 'vorschlag');
  const b2 = (await gf.post('/berichte', { baustelleId: BS.kogler, datum: HEUTE })).daten;
  const l2r = await gf.post(`/berichte/${b2.id}/unterschrift-link`, { rolle: 'bh' });
  assert.equal(l2r.status, 201, JSON.stringify(l2r.daten));
  const l2 = l2r.daten;
  const w0 = (await gf.get(`/berichte/${b2.id}`)).daten.version;
  const u = await gf.post(`/berichte/${b2.id}/fuhren-uebernehmen`, { fuhreIds: [f2.daten.id] });
  assert.equal(u.status, 200);
  assert.equal(u.daten.uebernommen, 1);
  assert.equal(u.daten.berichtVersion, w0 + 1);
  assert.equal(u.daten.bericht.version, w0 + 1);
  assert.deepEqual((await gf.get(`/berichte/${b2.id}/unterschrift-links`)).daten.map((x) => x.status), ['ungueltig']);
  assert.notEqual((await anon.get(`/fern/${l2.url.split('/').pop()}`)).status, 200);
});

test('G-15: Foto an die KI nur ohne EXIF/GPS und mit Hinweis', async (t) => {
  const aufrufe = [];
  const fabrik = () => ({ beta: { messages: { parse: async (params) => { aufrufe.push(params); return { stop_reason: 'end_turn', parsed_output: params.output_config.format.parse(JSON.stringify({ lieferant: 'K', lieferscheinNr: '1', datum: HEUTE, positionen: [], text: 'x', kst: null })), usage: { input_tokens: 1, output_tokens: 1 }, content: [] }; } } } });
  const s = await starte({ schluessel: 'test-schluessel-0123456789abcdef', kiClient: fabrik });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  const pol = await s.login(U.polier);
  await gf.put('/einstellungen/ki', { apiKey: 'sk-ant-api03-abcdef', datenschutzBestaetigt: true });
  await gf.put('/einstellungen/ki', { aktiv: true });
  const k = (await gf.get('/einstellungen/ki')).daten;
  assert.match(k.hinweis, /das Foto wird an die KI übermittelt/i);
  assert.ok(!/keine €-Daten\.?$/.test(k.hinweis));
  const integ = Object.fromEntries((await gf.get('/integrationen')).daten.map((i) => [i.schluessel, i.hinweis]));
  assert.match(integ.lieferschein, /Foto wird an die KI übermittelt/);
  assert.match(integ.papier, /Foto wird an die KI übermittelt/);
  s.db.lauf('DELETE FROM bericht WHERE baustelle_id = ? AND datum = ?', BS.pitten, HEUTE);
  const b = (await pol.post('/berichte', { baustelleId: BS.pitten, datum: HEUTE })).daten;
  const jpg = testJpeg();
  assert.ok(jpg.includes(Buffer.from('GPSLatitude')), 'Testbild trägt GPS');
  const r = await pol.post(`/berichte/${b.id}/lieferschein`, { bildBase64: jpg.toString('base64'), dateiname: 'ls.jpg' });
  assert.equal(r.status, 201, JSON.stringify(r.daten));
  assert.equal(r.daten.quelle, 'ki');
  assert.equal(r.daten.kiHinweis, 'Das Foto wird an die KI übermittelt (Anthropic; ohne EXIF/GPS).');
  const bild = Buffer.from(aufrufe[aufrufe.length - 1].messages[0].content[0].source.data, 'base64');
  assert.ok(!bild.includes(Buffer.from('GPSLatitude')) && !bild.includes(Buffer.from('Exif')), 'kein EXIF/GPS an die KI');
  const p = await pol.post(`/berichte/${b.id}/papier`, { bildBase64: jpg.toString('base64'), dateiname: 'p.jpg' });
  assert.equal(p.daten.kiHinweis, 'Das Foto wird an die KI übermittelt (Anthropic; ohne EXIF/GPS).');
});
