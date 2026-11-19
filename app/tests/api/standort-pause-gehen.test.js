'use strict';
/**
 * Zusammenspiel 15.27 (Pause beim Gehen) und 15.30 (Standort beim Stempeln):
 *  - „Gehen“ mit nachgetragener Pause trägt in derselben Transaktion zuerst pause_start/pause_ende ein; `buchungId` in der
 *    Antwort von POST /zeit/stempeln ist trotzdem die Gehen-Buchung – an sie hängt die Stempeluhr den Standort.
 *  - Der Standort (mitgesendet, nachgereicht oder offline im Warteschlangen-Eintrag) landet nur am „Gehen“; die
 *    nachgetragenen Pausenbuchungen bekommen keinen (POST /zeit/stempeln/:id/standort → 409).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');

const TAG = '2026-11-18'; // Mi; Wiener Zeit = UTC + 1
const um = (hm) => `${TAG}T${hm}:00.000+01:00`;
const iso = (hm) => new Date(um(hm)).toISOString();
const PUNKT = { lat: 47.7341234, lng: 16.1829876, genauigkeit: 24 };

async function umgebung(t) {
  const s = await starte();
  t.after(() => s.stop());
  s.db.lauf(`DELETE FROM buchung WHERE benutzer_id IN (${[U.polier, U.mitarbeiter].join(',')}) AND zeit >= '2026-11-10'`);
  s.db.lauf('DELETE FROM abwesenheit WHERE datum = ?', TAG);
  s.uhr.setze(um('07:00'));
  return s;
}
const buchungen = (s, id) => s.db.alle('SELECT id, typ, quelle, nachgetragen, lat, lng, genauigkeit FROM buchung WHERE benutzer_id = ? AND zeit >= ? ORDER BY zeit, id', id, iso('00:00'));

test('15.27 + 15.30: Gehen mit Pause – buchungId ist das Gehen, der Standort hängt nur dort', async (t) => {
  const s = await umgebung(t);
  const ma = await s.login(U.mitarbeiter);
  const pol = await s.login(U.polier);
  for (const c of [ma, pol]) assert.equal((await c.put('/auth/standort', { an: true })).status, 200);

  await t.test('Standort mit der Stempelung mitgesendet', async () => {
    assert.equal((await ma.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten })).status, 200);
    s.uhr.setze(um('16:00'));
    const r = await ma.post('/zeit/stempeln', { typ: 'gehen', pauseBeimGehen: { beginn: um('12:00'), dauerMin: 30 }, standort: PUNKT });
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    assert.equal(r.daten.standortGespeichert, true);
    const b = buchungen(s, U.mitarbeiter);
    assert.deepEqual(b.map((x) => [x.typ, x.nachgetragen]), [['kommen', 0], ['pause_start', 1], ['pause_ende', 1], ['gehen', 0]]);
    assert.equal(r.daten.buchungId, b[3].id, 'buchungId = Gehen, nicht eine Pausenbuchung');
    assert.deepEqual([b[3].lat, b[3].lng, b[3].genauigkeit], [PUNKT.lat, PUNKT.lng, PUNKT.genauigkeit]);
    for (const x of b.slice(1, 3)) assert.equal(x.lat, null, `${x.typ} ohne Standort`);
  });

  await t.test('Standort nachgereicht (Ortung nach der Buchung): nur an das Gehen, nicht an die nachgetragene Pause', async () => {
    s.uhr.setze(um('07:00'));
    assert.equal((await pol.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten })).status, 200);
    s.uhr.setze(um('15:30'));
    const r = await pol.post('/zeit/stempeln', { typ: 'gehen', pauseBeimGehen: { beginn: um('12:00'), dauerMin: 30 } });
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    assert.equal(r.daten.standortGespeichert, false);
    const b = buchungen(s, U.polier);
    assert.deepEqual(b.map((x) => x.typ), ['kommen', 'pause_start', 'pause_ende', 'gehen']);
    assert.equal(r.daten.buchungId, b[3].id);
    s.uhr.plus(0.25);
    for (const x of b.slice(1, 3)) {
      const n = await pol.post(`/zeit/stempeln/${x.id}/standort`, { standort: PUNKT });
      assert.equal(n.status, 409, `${x.typ}: ${JSON.stringify(n.daten)}`);
      assert.match(n.daten.fehler, /nachgetragene Pause/);
    }
    const n = await pol.post(`/zeit/stempeln/${r.daten.buchungId}/standort`, { standort: PUNKT });
    assert.equal(n.status, 200, JSON.stringify(n.daten));
    const nach = buchungen(s, U.polier);
    assert.equal(nach[3].lat, PUNKT.lat);
    assert.deepEqual(nach.slice(0, 3).map((x) => x.lat), [null, null, null]);
  });

  await t.test('ohne Netz: ein Warteschlangen-Eintrag mit Pause und Standort – Standort am Gehen', async () => {
    s.db.lauf(`DELETE FROM buchung WHERE benutzer_id = ? AND zeit >= '2026-11-10'`, U.mitarbeiter);
    s.uhr.setze(um('07:00'));
    assert.equal((await ma.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten })).status, 200);
    s.uhr.setze(um('16:20'));
    const r = await ma.post('/zeit/stempeln', { typ: 'gehen', zeit: um('16:00'), pauseBeimGehen: { beginn: um('12:00'), dauerMin: 45 }, standort: PUNKT });
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    const b = buchungen(s, U.mitarbeiter);
    assert.deepEqual(b.map((x) => [x.typ, x.quelle]), [['kommen', 'app'], ['pause_start', 'offline'], ['pause_ende', 'offline'], ['gehen', 'offline']]);
    assert.equal(r.daten.buchungId, b[3].id);
    assert.equal(r.daten.standortGespeichert, true);
    assert.equal(b[3].lat, PUNKT.lat);
    assert.deepEqual([b[1].lat, b[2].lat], [null, null]);
  });
});
