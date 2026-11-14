'use strict';
/** 14.6 Korrekturen Nachprüfung – Projektdokumente und Dokument-Kategorien (N-050, N-051, N-099, N-103, N-104) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');
const { pngGrau } = require('../../server/png');

const pdf = (text) => Buffer.from(`%PDF-1.4\n% ${text}\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`, 'latin1').toString('base64');

async function umgebung(t) {
  const s = await starte();
  t.after(() => s.stop());
  const c = {};
  for (const r of ['mitarbeiter', 'polier', 'buero', 'gf']) c[r] = await s.login(U[r]);
  const hoch = async (kategorie, titel) => {
    const r = await c.buero.post(`/baustellen/${BS.pitten}/dokumente`, { kategorie, titel, dateiBase64: pdf(titel), dateiname: `${titel}.pdf` });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    return r.daten;
  };
  const polierSieht = async (id) => (await c.polier.get(`/baustellen/${BS.pitten}/dokumente`)).daten.some((d) => d.id === id);
  return { s, c, hoch, polierSieht };
}

test('N-050: verknüpftes Rechnungs-PDF bleibt in „Ausgangsrechnungen“, Löschen gesperrt, rechnungId im JSON', async (t) => {
  const { s, c, hoch, polierSieht } = await umgebung(t);
  const d = await hoch('ausgangsrechnungen', 'Schlussrechnung brutto EUR 221.400,00');
  const re = await c.buero.post(`/baustellen/${BS.pitten}/rechnungen`, { nr: 'AR-2026-117', typ: 'schluss', datum: '2026-11-01', netto: 184500, dokumentId: d.id });
  assert.equal(re.status, 201, JSON.stringify(re.daten));
  // rechnungId laut 12.16 (nur mit Preisrecht)
  const einzel = (await c.buero.get(`/baustellen/${BS.pitten}/dokumente/${d.id}`)).daten;
  assert.equal(einzel.rechnungId, re.daten.id);
  assert.equal((await c.buero.get(`/baustellen/${BS.pitten}/dokumente`)).daten.find((x) => x.id === d.id).rechnungId, re.daten.id);
  // Verschieben (auch mit Bestätigung) → 409, Polier sieht weiterhin nichts
  for (const extra of [{}, { bestaetigtPreisfrei: true }]) {
    const r = await c.buero.put(`/baustellen/${BS.pitten}/dokumente/${d.id}`, { kategorie: 'fotos', ...extra });
    assert.equal(r.status, 409, JSON.stringify(r.daten));
    assert.match(r.daten.fehler, /AR-2026-117/);
  }
  assert.equal((await c.gf.put(`/baustellen/${BS.pitten}/dokumente/${d.id}`, { kategorie: 'angebot' })).status, 409, 'auch in eine andere finanzielle Kategorie nicht');
  assert.equal(s.db.eins('SELECT kategorie FROM dokument WHERE id = ?', d.id).kategorie, 'ausgangsrechnungen');
  assert.equal(await polierSieht(d.id), false);
  assert.equal((await c.polier.get(`/baustellen/${BS.pitten}/dokumente/${d.id}/datei?version=1`)).status, 403);
  // Titel ändern geht weiterhin
  assert.equal((await c.buero.put(`/baustellen/${BS.pitten}/dokumente/${d.id}`, { titel: 'Schlussrechnung AR-2026-117', kategorie: 'ausgangsrechnungen' })).status, 200);
  // Löschen → 409, Verknüpfung bleibt gültig
  const weg = await c.buero.anfrage('DELETE', `/baustellen/${BS.pitten}/dokumente/${d.id}`, { grund: 'test' });
  assert.equal(weg.status, 409);
  assert.equal(s.db.eins('SELECT geloescht_zeit FROM dokument WHERE id = ?', d.id).geloescht_zeit, null);
  // nach dem Lösen der Verknüpfung geht beides
  const rv = (await c.buero.get(`/rechnungen/${re.daten.id}`)).daten;
  assert.equal((await c.buero.put(`/rechnungen/${re.daten.id}`, { version: rv.version, dokumentId: null })).status, 200);
  assert.equal((await c.buero.get(`/baustellen/${BS.pitten}/dokumente/${d.id}`)).daten.rechnungId, undefined);
  assert.equal((await c.buero.anfrage('DELETE', `/baustellen/${BS.pitten}/dokumente/${d.id}`, { grund: 'test' })).status, 200);
});

test('N-103: Wechsel aus einer Kategorie mit Preisen in eine ohne nur mit Bestätigung', async (t) => {
  const { c, hoch, polierSieht } = await umgebung(t);
  const d = await hoch('angebot', 'Angebot v1 EUR 99.000,00');
  const v2 = await c.buero.post(`/baustellen/${BS.pitten}/dokumente/${d.id}/versionen`, { dateiBase64: pngGrau(8, 8, 128).toString('base64'), dateiname: 'foto.png' });
  assert.equal(v2.status, 201, JSON.stringify(v2.daten));
  const r = await c.buero.put(`/baustellen/${BS.pitten}/dokumente/${d.id}`, { kategorie: 'fotos' });
  assert.equal(r.status, 409, JSON.stringify(r.daten));
  assert.equal(r.daten.bestaetigung, 'bestaetigtPreisfrei');
  assert.equal(r.daten.versionen, 2);
  assert.match(r.daten.fehler, /alle 2 Version/);
  assert.equal(await polierSieht(d.id), false);
  assert.equal((await c.polier.get(`/baustellen/${BS.pitten}/dokumente/${d.id}/datei?version=1`)).status, 403);
  // finanziell → finanziell braucht keine Bestätigung
  assert.equal((await c.buero.put(`/baustellen/${BS.pitten}/dokumente/${d.id}`, { kategorie: 'lv' })).status, 200);
  // mit ausdrücklicher Bestätigung: verschoben und protokolliert
  const ok = await c.buero.put(`/baustellen/${BS.pitten}/dokumente/${d.id}`, { kategorie: 'fotos', bestaetigtPreisfrei: true });
  assert.equal(ok.status, 200);
  assert.equal(await polierSieht(d.id), true);
  // nicht finanziell → nicht finanziell: keine Rückfrage
  assert.equal((await c.buero.put(`/baustellen/${BS.pitten}/dokumente/${d.id}`, { kategorie: 'plaene' })).status, 200);
});

test('N-104: „enthält Preise“ abschalten mit vorhandenen Dokumenten nur mit Bestätigung', async (t) => {
  const { s, c, hoch, polierSieht } = await umgebung(t);
  const k = (await c.gf.post('/dokument-kategorien', { name: 'Nachtraege intern', enthaeltPreise: true })).daten;
  assert.equal(k.finanziell, true);
  const d = await hoch(k.schluessel, 'Nachtrag 3 EP 48,50 EUR/m3');
  const r = await c.gf.put(`/dokument-kategorien/${k.schluessel}`, { finanziell: false, polier: true });
  assert.equal(r.status, 409, JSON.stringify(r.daten));
  assert.equal(r.daten.anzahl, 1);
  assert.equal(r.daten.bestaetigung, 'bestaetigtPreisfrei');
  assert.equal(s.db.eins('SELECT finanziell, polier FROM dokument_kategorie WHERE schluessel = ?', k.schluessel).finanziell, 1);
  assert.equal(await polierSieht(d.id), false);
  assert.equal((await c.polier.get(`/baustellen/${BS.pitten}/dokumente/${d.id}/datei`)).status, 403);
  // Name ändern ohne Rechte-Änderung geht ohne Rückfrage
  assert.equal((await c.gf.put(`/dokument-kategorien/${k.schluessel}`, { name: 'Nachträge intern' })).status, 200);
  // mit Bestätigung
  const ok = await c.gf.put(`/dokument-kategorien/${k.schluessel}`, { finanziell: false, polier: true, bestaetigtPreisfrei: true });
  assert.equal(ok.status, 200);
  assert.equal(await polierSieht(d.id), true);
  // leere Kategorie: keine Rückfrage
  const leer = (await c.gf.post('/dokument-kategorien', { name: 'Leer mit Preisen', enthaeltPreise: true })).daten;
  assert.equal((await c.gf.put(`/dokument-kategorien/${leer.schluessel}`, { finanziell: false })).status, 200);
});

test('N-051/N-099: POST lehnt gleichnamige Kategorien ab (ohne Groß-/Kleinschreibung, mit Umlauten)', async (t) => {
  const { c } = await umgebung(t);
  const vorher = (await c.gf.get('/dokument-kategorien')).daten.length;
  for (const name of ['Leistungsverzeichnis', 'LEISTUNGSVERZEICHNIS', 'Pläne', 'pläne ', 'Auftrag/Schlussbrief']) {
    const lv = (await c.gf.get('/dokument-kategorien')).daten;
    if (!lv.some((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase())) continue;
    const r = await c.gf.post('/dokument-kategorien', { name, polier: true });
    assert.equal(r.status, 409, `${name}: ${JSON.stringify(r.daten)}`);
  }
  // mindestens die eingebauten „Pläne“ und die finanzielle LV-Kategorie sind abgedeckt
  const kats = (await c.gf.get('/dokument-kategorien')).daten;
  const lv = kats.find((x) => x.schluessel === 'lv');
  assert.ok(kats.some((x) => x.name === 'Pläne'));
  assert.equal((await c.gf.post('/dokument-kategorien', { name: 'Pläne', polier: true })).status, 409);
  assert.equal((await c.gf.post('/dokument-kategorien', { name: lv.name.toUpperCase(), polier: true })).status, 409);
  assert.equal((await c.gf.get('/dokument-kategorien')).daten.length, vorher, 'nichts angelegt');
  // Umlaute im Schlüssel
  const r = await c.gf.post('/dokument-kategorien', { name: 'Prüfberichte Böden', polier: true });
  assert.equal(r.status, 201);
  assert.equal(r.daten.schluessel, 'pruefberichte_boeden');
});
