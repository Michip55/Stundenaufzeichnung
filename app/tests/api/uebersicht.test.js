'use strict';
/**
 * API.md 15.20 – Neue Übersicht (Inhaber 17.11.2026): Daten, die die Übersicht zusätzlich braucht.
 *  - GET /zeit/heute-eingeteilt: veröffentlichter Plan von heute + wer heute schon gestempelt hat – allein Recht stammdaten
 *    (Bauleiter = Büro; Polier/Mitarbeiter auch mit allen vergebbaren Ausnahmen nicht), keine Abwesenheitsgründe, kein €.
 *  - GET /berichte: polierName je Zeile; freigabeVierAugen nur mit bericht_freigeben, gleiche Regel wie GET /berichte/:id.
 * Feste Uhr: Do 12.11.2026 10:24 Wiener Zeit.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS, euroFelder } = require('./hilfe');

const HEUTE = '2026-11-12';

test('Übersicht (15.20): heute eingeteilt / gestempelt', async (t) => {
  const s = await starte({ test: true });
  t.after(() => s.stop());
  const c = {};
  for (const r of ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf']) c[r] = await s.login(U[r]);

  await t.test('Rechte: nur stammdaten – Bauleiter = Büro, Polier/Mitarbeiter nie (auch nicht mit Ausnahmen)', async () => {
    for (const r of ['mitarbeiter', 'polier']) assert.equal((await c[r].get('/zeit/heute-eingeteilt')).status, 403, r);
    for (const r of ['bauleiter', 'buero', 'gf']) assert.equal((await c[r].get('/zeit/heute-eingeteilt')).status, 200, r);
    // Polier mit allen vergebbaren Ausnahmen (u. a. bericht_freigeben → Übersicht sichtbar): stammdaten bleibt gesperrt
    for (const recht of ['bericht_freigeben', 'fuhrpark']) assert.equal((await c.gf.put('/rechte/ausnahme', { benutzerId: U.polier2, recht, wert: true })).status, 200, recht);
    const p2 = await s.login(U.polier2);
    assert.equal((await p2.get('/zeit/heute-eingeteilt')).status, 403);
    assert.equal((await p2.get('/zeit/anwesend')).status, 200); // die Übersicht selbst bleibt erreichbar
    // Büro ohne stammdaten (Matrix) → 403, wie der Planer
    assert.equal((await c.gf.put('/rechte/matrix', { rolle: 'buero', recht: 'stammdaten', wert: false })).status, 200);
    assert.equal((await c.buero.get('/zeit/heute-eingeteilt')).status, 403);
    assert.equal((await c.gf.put('/rechte/matrix', { rolle: 'buero', recht: 'stammdaten', wert: true })).status, 200);
    assert.equal((await c.buero.get('/zeit/heute-eingeteilt')).status, 200);
  });

  await t.test('Inhalt: nur der VERÖFFENTLICHTE Stand von heute; gestempelt = heute irgendeine Buchung', async () => {
    let r = await c.buero.get('/zeit/heute-eingeteilt');
    assert.equal(r.daten.datum, HEUTE);
    assert.ok(Array.isArray(r.daten.eingeteilt) && Array.isArray(r.daten.gestempelt));
    const vorher = r.daten.eingeteilt.length;
    // gestempelt = genau die Personen mit einer Buchung seit 00:00 Wiener Zeit (eine Schicht seit gestern zählt nicht –
    // die Übersicht nimmt die gerade Eingestempelten selbst dazu)
    const seit = new Date('2026-11-11T23:00:00.000Z').toISOString(), bis = new Date('2026-11-12T23:00:00.000Z').toISOString();
    const db = s.db.alle('SELECT DISTINCT benutzer_id FROM buchung WHERE zeit >= ? AND zeit < ? ORDER BY benutzer_id', seit, bis).map((x) => x.benutzer_id);
    assert.ok(db.length > 0, 'Seed ohne Buchungen heute');
    assert.deepEqual(r.daten.gestempelt, db);
    // Einsatz für heute anlegen – unveröffentlicht zählt er nicht
    const e = await c.buero.post('/plan/einsaetze', { datum: HEUTE, baustelleId: BS.pitten, beginn: '06:30', benutzerIds: [U.mitarbeiter] });
    assert.ok([201, 409].includes(e.status), JSON.stringify(e.daten));
    if (e.status === 409) assert.equal((await c.buero.post(`/plan/einsaetze/${e.daten.id}/personen`, { benutzerIds: [U.mitarbeiter] })).status < 300, true);
    r = await c.buero.get('/zeit/heute-eingeteilt');
    assert.equal(vorher, 0, 'Seed: heute ist nichts veröffentlicht');
    assert.equal(r.daten.eingeteilt.length, 0, 'ein unveröffentlichter Einsatz zählt nicht');
    // veröffentlichen → enthalten, mit Name, Baustelle und Beginn
    assert.equal((await c.buero.post('/plan/veroeffentlichen', { von: HEUTE, bis: HEUTE })).status, 200);
    r = await c.buero.get('/zeit/heute-eingeteilt');
    const ich = r.daten.eingeteilt.find((p) => p.benutzerId === U.mitarbeiter);
    assert.ok(ich, `Mitarbeiter nicht eingeteilt: ${JSON.stringify(r.daten.eingeteilt)}`);
    assert.equal(ich.baustelleId, BS.pitten);
    assert.equal(typeof ich.name, 'string');
    assert.equal(ich.beginn, '06:30');
    // Felder: nur benutzerId, name, baustelleId, baustelle, beginn – keine Gründe, keine Beträge
    for (const p of r.daten.eingeteilt) assert.deepEqual(Object.keys(p).sort(), ['baustelle', 'baustelleId', 'beginn', 'benutzerId', 'name']);
    assert.deepEqual(euroFelder(r.daten), []);
    // Bauleiter = Büro: gleiche Antwort
    assert.deepEqual((await c.bauleiter.get('/zeit/heute-eingeteilt')).daten, r.daten);
    // eine neue Buchung heute → gestempelt
    const ma = c.mitarbeiter;
    const st = (await ma.get('/zeit/status')).daten;
    if (st.status === 'aus') assert.equal((await ma.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten })).status, 200);
    r = await c.buero.get('/zeit/heute-eingeteilt');
    assert.ok(r.daten.gestempelt.includes(U.mitarbeiter));
  });
});

test('Übersicht (15.20): /berichte mit polierName und Vier-Augen-Hinweis', async (t) => {
  const s = await starte({ test: true });
  t.after(() => s.stop());
  const buero = await s.login(U.buero), gf = await s.login(U.gf), polier = await s.login(U.polier), bauleiter = await s.login(U.bauleiter);
  const liste = (await buero.get('/berichte?status=unterschrieben')).daten;
  assert.ok(liste.length > 0, 'Seed ohne unterschriebene Berichte');
  // polierName = Polier der Baustelle (wie polierId im Bericht)
  for (const z of liste) {
    const bs = s.db.eins('SELECT b.polier_id, p.name FROM baustelle b LEFT JOIN benutzer p ON p.id = b.polier_id WHERE b.id = ?', z.baustelleId);
    assert.equal(z.polierName, bs.name || null, `Bericht ${z.id}`);
    assert.equal(z.freigabeVierAugen, false, `Bericht ${z.id}: niemand vom Büro hat unterschrieben`);
  }
  // Büro hat die AN-Unterschrift selbst erfasst → Vier-Augen-Prinzip (wie GET /berichte/:id), GF ausgenommen
  const id = liste[0].id;
  s.db.lauf("UPDATE unterschrift SET erfasst_von = ? WHERE bericht_id = ? AND rolle = 'an'", U.buero, id);
  const z = (await buero.get('/berichte?status=unterschrieben')).daten.find((x) => x.id === id);
  assert.equal(z.freigabeVierAugen, true);
  assert.equal((await buero.get(`/berichte/${id}`)).daten.freigabeVierAugen, true);
  assert.equal((await bauleiter.get('/berichte?status=unterschrieben')).daten.find((x) => x.id === id).freigabeVierAugen, false);
  assert.equal((await gf.get('/berichte?status=unterschrieben')).daten.find((x) => x.id === id).freigabeVierAugen, false);
  assert.equal((await buero.post(`/berichte/${id}/freigeben`)).status, 403);
  // ohne bericht_freigeben (Polier): kein Feld freigabeVierAugen
  for (const x of (await polier.get('/berichte')).daten) assert.equal('freigabeVierAugen' in x, false);
  // Freigabe aus der Übersicht: gleicher Endpunkt, zweimal → 409 (die Oberfläche öffnet dann den Bericht)
  const andere = liste.find((x) => x.id !== id);
  assert.equal((await bauleiter.post(`/berichte/${andere.id}/freigeben`)).status, 200);
  assert.equal((await buero.post(`/berichte/${andere.id}/freigeben`)).status, 409);
});
