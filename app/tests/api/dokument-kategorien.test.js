'use strict';
/** Dokument-Kategorien bearbeiten/löschen (API.md 12.16, Ergänzung Prüfbericht 6) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1').toString('base64');

test('Dokument-Kategorien: PUT/DELETE mit Rechten und Regeln', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const c = {};
  for (const r of ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf']) c[r] = await s.login(U[r]);
  const kat = async (k) => (await c.gf.get('/dokument-kategorien')).daten.find((x) => x.schluessel === k);

  // POST: enthält Preise erzwingt polier:false (auch mit den Aliasnamen)
  let r = await c.gf.post('/dokument-kategorien', { name: 'Nachträge intern', enthaeltPreise: true, polierLesen: true });
  assert.equal(r.status, 201);
  assert.deepEqual([r.daten.finanziell, r.daten.polier], [true, false]);
  const intern = r.daten.schluessel;
  r = await c.gf.post('/dokument-kategorien', { name: 'Vermessung', polier: true });
  assert.deepEqual([r.daten.schluessel, r.daten.finanziell, r.daten.polier], ['vermessung', false, true]);

  // Rechte: nur GF (Recht benutzer)
  for (const rolle of ['mitarbeiter', 'polier', 'bauleiter', 'buero']) {
    assert.equal((await c[rolle].put('/dokument-kategorien/vermessung', { name: 'X' })).status, 403, rolle);
    assert.equal((await c[rolle].del('/dokument-kategorien/vermessung')).status, 403, rolle);
  }
  assert.equal((await c.gf.put('/dokument-kategorien/gibtsnicht', { name: 'X' })).status, 404);

  // eigene: Name und Rechte; enthält Preise → nie Polier
  r = await c.gf.put('/dokument-kategorien/vermessung', { name: 'Vermessung & Absteckung', enthaeltPreise: true });
  assert.equal(r.status, 200);
  assert.deepEqual(r.daten, { schluessel: 'vermessung', name: 'Vermessung & Absteckung', finanziell: true, polier: false, eigen: true });
  r = await c.gf.put('/dokument-kategorien/vermessung', { finanziell: false, polierLesen: true });
  assert.deepEqual([r.daten.finanziell, r.daten.polier], [false, true]);
  assert.ok((await c.polier.get('/dokument-kategorien')).daten.some((x) => x.schluessel === 'vermessung'));
  assert.equal((await c.gf.put('/dokument-kategorien/vermessung', { name: 'Pläne' })).status, 409); // Name doppelt
  assert.equal((await c.gf.put('/dokument-kategorien/vermessung', { name: 'x' })).status, 400);

  // eingebaute: nur der Name, Rechte fest
  r = await c.gf.put('/dokument-kategorien/plaene', { name: 'Pläne und Schnitte' });
  assert.equal(r.status, 200);
  assert.deepEqual(await kat('plaene'), { schluessel: 'plaene', name: 'Pläne und Schnitte', finanziell: false, polier: true, eigen: false });
  assert.equal((await c.gf.put('/dokument-kategorien/plaene', { polier: false })).status, 400);
  assert.equal((await c.gf.put('/dokument-kategorien/angebot', { enthaeltPreise: false })).status, 400);
  assert.equal((await c.gf.put('/dokument-kategorien/angebot', { name: 'Angebote', finanziell: true })).status, 200); // unverändert erlaubt
  assert.equal((await c.gf.del('/dokument-kategorien/plaene')).status, 409);

  // Löschen nur leer, sonst 409 mit Anzahl (auch gelöschte Dokumente zählen)
  const d = await c.buero.post(`/baustellen/${BS.pitten}/dokumente`, { kategorie: 'vermessung', titel: 'Absteckplan', dateiBase64: PDF, dateiname: 'a.pdf' });
  assert.equal(d.status, 201, JSON.stringify(d.daten));
  r = await c.gf.del('/dokument-kategorien/vermessung');
  assert.equal(r.status, 409);
  assert.equal(r.daten.anzahl, 1);
  assert.equal((await c.gf.del(`/dokument-kategorien/${intern}`)).status, 200);
  assert.equal(await kat(intern), undefined);
  assert.ok(s.db.eins("SELECT 1 AS x FROM protokoll WHERE text = 'Dokumentkategorie „Nachträge intern“ gelöscht'"));
});
