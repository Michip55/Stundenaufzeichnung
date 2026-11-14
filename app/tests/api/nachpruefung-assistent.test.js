'use strict';
/** 14.6 Korrekturen Nachprüfung – KI-Hinweise, Diktat-Freitext, Papier/Lieferschein-Duplikate (N-061, N-115, N-116) */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Anthropic = require('@anthropic-ai/sdk').default;
const { starte, U, BS } = require('./hilfe');
const { pngGrau } = require('../../server/png');
const { wienDatum, plusTage } = require('../../server/datum');

function attrappe() {
  const a = { aufrufe: 0, fehler: null };
  a.fabrik = () => ({ beta: { messages: { parse: async () => { a.aufrufe += 1; if (a.fehler) throw a.fehler; return { stop_reason: 'refusal', parsed_output: null, usage: { input_tokens: 1, output_tokens: 1 }, content: [] }; } } } });
  return a;
}
const bild = (n) => pngGrau(6, 6, Array(36).fill(n)).toString('base64');

test('Assistent: KI-Hinweis im Rückfall, Duplikate je Art, Freitext mit Dezimalkomma', async (t) => {
  const ki = attrappe();
  const s = await starte({ schluessel: 'test-schluessel-0123456789abcdef', kiClient: ki.fabrik });
  t.after(() => s.stop());
  const pol = await s.login(U.polier);
  const gf = await s.login(U.gf);
  const datum = plusTage(wienDatum(s.uhr()), -9);
  s.db.lauf('DELETE FROM bericht WHERE baustelle_id = ? AND datum = ?', BS.pitten, datum);
  const b = (await pol.post('/berichte', { baustelleId: BS.pitten, datum })).daten;

  await t.test('N-116: Papierbericht mit dem Bild eines Lieferscheins → 409, Lieferschein bleibt unverändert', async () => {
    const r = await pol.post(`/berichte/${b.id}/lieferschein`, { bildBase64: bild(210), dateiname: 'ls.png' });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    assert.equal(r.daten.foto.art, 'lieferschein');
    s.db.lauf("UPDATE bericht_foto SET ocr_text = 'LIEFERSCHEIN-TEXT' WHERE id = ?", r.daten.foto.id);
    const p = await pol.post(`/berichte/${b.id}/papier`, { bildBase64: bild(210), dateiname: 'p.png' });
    assert.equal(p.status, 409, JSON.stringify(p.daten));
    assert.match(p.daten.fehler, /Lieferschein/);
    assert.equal(s.db.eins('SELECT ocr_text FROM bericht_foto WHERE id = ?', r.daten.foto.id).ocr_text, 'LIEFERSCHEIN-TEXT');
    assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM bericht_foto WHERE bericht_id = ? AND art = 'papier'", b.id).n, 0);
    // gleiches Bild noch einmal als Lieferschein: bestehendes Foto, ocr_text wird nicht überschrieben
    const r2 = await pol.post(`/berichte/${b.id}/lieferschein`, { bildBase64: bild(210), dateiname: 'ls.png' });
    assert.equal(r2.status, 200);
    assert.equal(r2.daten.foto.id, r.daten.foto.id);
    assert.equal(s.db.eins('SELECT ocr_text FROM bericht_foto WHERE id = ?', r.daten.foto.id).ocr_text, 'LIEFERSCHEIN-TEXT');
    // umgekehrt: Papierseite, dann dasselbe Bild als Foto/Lieferschein → 409
    assert.equal((await pol.post(`/berichte/${b.id}/papier`, { bildBase64: bild(60), dateiname: 'p.png' })).status, 201);
    assert.equal((await pol.post(`/berichte/${b.id}/lieferschein`, { bildBase64: bild(60), dateiname: 'p.png' })).status, 409);
    assert.equal((await pol.post(`/berichte/${b.id}/fotos`, { bildBase64: bild(60), dateiname: 'p.png' })).status, 409);
  });

  await t.test('N-061: KI-Fehler mit Rückfall auf die Texterkennung liefert kiHinweis', async () => {
    assert.equal((await gf.put('/einstellungen/ki', { apiKey: 'sk-ant-api03-abcdef' })).status, 200);
    assert.equal((await gf.put('/einstellungen/ki', { datenschutzBestaetigt: true, aktiv: true, tagesLimit: 100 })).status, 200);
    ki.fehler = new Anthropic.APIConnectionError({ message: 'Connection error.' });
    const r = await pol.post(`/berichte/${b.id}/lieferschein`, { bildBase64: bild(120), dateiname: 'ls2.png' });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    assert.equal(ki.aufrufe, 1);
    assert.match(r.daten.kiHinweis || '', /an die KI übermittelt/);
    assert.match(r.daten.hinweis || '', /nicht erreichbar/);
    const p = await pol.post(`/berichte/${b.id}/papier`, { bildBase64: bild(130), dateiname: 'p2.png' });
    assert.equal(p.status, 201, JSON.stringify(p.daten));
    assert.match(p.daten.kiHinweis || '', /an die KI übermittelt/);
    const l = await pol.post('/berichte/papier', { bildBase64: bild(140) });
    assert.match(l.daten.kiHinweis || '', /an die KI übermittelt/);
    // Tageslimit erreicht: nichts übermittelt → kein kiHinweis
    assert.equal((await gf.put('/einstellungen/ki', { tagesLimit: 1 })).status, 200);
    const n = ki.aufrufe;
    const r2 = await pol.post(`/berichte/${b.id}/lieferschein`, { bildBase64: bild(150), dateiname: 'ls3.png' });
    assert.equal(ki.aufrufe, n);
    assert.equal(r2.daten.kiHinweis, undefined);
    await gf.put('/einstellungen/ki', { aktiv: false });
  });

  await t.test('N-061: Texte der Oberfläche nennen die vollständige Foto-Übermittlung, kiHinweis wird angezeigt', async () => {
    const js = (f) => fs.readFileSync(path.join(__dirname, '../../public/js/views', f), 'utf8');
    assert.ok(!/Preise, Löhne und Kalkulationsdaten werden nie gesendet/.test(js('dienste.js')));
    assert.match(js('dienste.js'), /Fotos gehen vollständig/);
    assert.ok((js('bericht-assistent.js').match(/kiHinweis/g) || []).length >= 3, 'Lieferschein- und Papier-Dialog zeigen kiHinweis');
    const k = (await gf.get('/einstellungen/ki')).daten.hinweis;
    assert.ok(!/keine €-Daten/.test(k) && /vollständig/.test(k));
  });

  await t.test('N-115: Diktat-Freitext behält das Dezimalkomma, Mengen werden weiter erkannt', async () => {
    const r = await pol.post('/bericht-assistent/text', { berichtId: b.id, text: 'Fugen auf 1,5 cm geschnitten, Gefälle 2,5 Prozent hergestellt. Preis netto 1.234,00 EUR. Vier komma fünf Tonnen Splitt eingebaut' });
    assert.equal(r.status, 200);
    assert.equal(r.daten.vorschlag.arbeitsleistung, 'Fugen auf 1,5 cm geschnitten. Gefälle 2,5 Prozent hergestellt. Preis netto 1.234,00 EUR.');
    assert.deepEqual(r.daten.vorschlag.material.map((m) => [m.code, m.menge]), [['splitt', 4.5]]);
  });
});
