'use strict';
/** 14.6 Korrekturen Nachprüfung – Lohngruppen-Verlauf (N-081) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U } = require('./hilfe');

test('N-081: lohngruppeGueltigAb lehnt ungültige Kalenderdaten ab', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  const lg = s.db.alle('SELECT id FROM lohngruppe WHERE aktiv = 1').map((x) => x.id);
  const b = s.db.eins('SELECT id, lohngruppe_id FROM benutzer WHERE id = ?', U.mitarbeiter);
  const neu = lg.find((x) => x !== b.lohngruppe_id);
  const vorher = s.db.alle('SELECT * FROM benutzer_lohngruppe WHERE benutzer_id = ?', b.id);
  for (const d of ['2026-11-31', '2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10']) {
    const r = await gf.put(`/benutzer/${b.id}`, { lohngruppe: neu, lohngruppeGueltigAb: d });
    assert.equal(r.status, 400, `${d}: ${JSON.stringify(r.daten)}`);
    assert.match(r.daten.fehler, /gültiges Datum/);
  }
  assert.deepEqual(s.db.alle('SELECT * FROM benutzer_lohngruppe WHERE benutzer_id = ?', b.id), vorher, 'nichts gespeichert');
  // gültige Daten gehen weiter (Schaltjahr, Monatsende)
  const r = await gf.put(`/benutzer/${b.id}`, { lohngruppe: neu, lohngruppeGueltigAb: '2028-02-29' });
  assert.equal(r.status, 200, JSON.stringify(r.daten));
  assert.equal((await gf.put(`/benutzer/${b.id}`, { lohngruppe: neu, lohngruppeGueltigAb: '2026-11-30' })).status, 200);
});
