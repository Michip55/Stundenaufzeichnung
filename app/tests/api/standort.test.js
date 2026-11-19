'use strict';
/**
 * API.md 15.30 – Standort beim Stempeln (Inhaber 19.11.2026):
 *  - Einwilligung je PERSON am Server (benutzer.standort_einwilligung), freiwillig, Standard aus; nur selbst schaltbar
 *    (PUT /auth/standort), jede Änderung im Protokoll; das Büro sieht nur, OB es an ist.
 *  - Ohne Einwilligung wird nie ein Standort gespeichert (auch nicht offline nachgesendet).
 *  - Nachreichen: POST /zeit/stempeln/:id/standort – nur eigene, selbst in der App erfasste Buchung, höchstens 10 Minuten
 *    alt, noch ohne Standort (nie überschreiben), Einwilligung an, gültige Koordinaten.
 *  - Sichtbar nur in GET /zeit/buchungen (die Person selbst bzw. Recht stammdaten); Polier/Mitarbeiter erhalten in keiner
 *    Antwort die Koordinaten einer anderen Person.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');
const { routenAusApp } = require('./rechte-matrix-hilfe');

const PUNKT = { lat: 47.7341234, lng: 16.1829876, genauigkeit: 24 };
const FORMEN = (p) => [String(p.lat), String(p.lng), String(p.lat).replace('.', ','), String(p.lng).replace('.', ','), p.lat.toFixed(5), p.lng.toFixed(5), p.lat.toFixed(5).replace('.', ','), p.lng.toFixed(5).replace('.', ',')];

test('15.30 Standort beim Stempeln', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const ma = await s.login(U.mitarbeiter);
  const pol = await s.login(U.polier);
  const buero = await s.login(U.buero);
  const bl = await s.login(U.bauleiter);
  const gf = await s.login(U.gf);
  const einw = (id) => s.db.eins('SELECT standort_einwilligung AS e FROM benutzer WHERE id = ?', id).e;
  const prot = (id) => s.db.alle("SELECT * FROM protokoll WHERE objekt = ? AND text LIKE '%Standort beim Stempeln%' ORDER BY id", `benutzer:${id}`);
  const geo = (id) => s.db.eins('SELECT lat, lng, genauigkeit FROM buchung WHERE id = ?', id);

  await t.test('Standard aus: /auth/ich meldet null; ein mitgesendeter Standort wird ohne Einwilligung verworfen', async () => {
    for (const c of [ma, pol, buero, bl, gf]) {
      const r = await c.get('/auth/ich');
      assert.equal(r.status, 200);
      assert.equal(r.daten.benutzer.standortEinwilligung, null);
    }
    const r = await ma.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten, standort: PUNKT });
    assert.equal(r.status, 200);
    assert.ok(Number.isInteger(r.daten.buchungId));
    assert.equal(r.daten.standortGespeichert, false);
    assert.deepEqual(geo(r.daten.buchungId), { lat: null, lng: null, genauigkeit: null });
    // Nachreichen ohne Einwilligung → 409, nichts gespeichert
    const n = await ma.post(`/zeit/stempeln/${r.daten.buchungId}/standort`, { standort: PUNKT });
    assert.equal(n.status, 409);
    assert.match(n.daten.fehler, /ausgeschaltet/);
    assert.equal(geo(r.daten.buchungId).lat, null);
    s.uhr.plus(5);
    assert.equal((await ma.post('/zeit/stempeln', { typ: 'gehen' })).status, 200);
  });

  await t.test('Einschalten nur selbst: Zeitpunkt + Protokoll, erneut „an“ ändert nichts, fremd → 403 (auch GF/Büro), Verwaltung kann es nicht setzen', async () => {
    // für eine andere Person: immer 403, DB unverändert
    for (const [c, ziel] of [[gf, U.mitarbeiter], [buero, U.mitarbeiter], [bl, U.polier], [pol, U.mitarbeiter], [ma, U.polier]]) {
      const r = await c.put('/auth/standort', { an: true, benutzerId: ziel });
      assert.equal(r.status, 403, `${ziel}: ${JSON.stringify(r.daten)}`);
      assert.equal(einw(ziel), null);
    }
    // auch nicht über die Benutzerverwaltung (Feld wird nicht angenommen)
    const pv = await gf.put(`/benutzer/${U.mitarbeiter}`, { standortEinwilligung: '2026-11-12T00:00:00Z' });
    assert.ok([200, 400].includes(pv.status), `${pv.status}`);
    assert.equal((await gf.put(`/benutzer/${U.mitarbeiter}`, { name: 'Lukas Brandstätter', standortEinwilligung: '2026-11-12T00:00:00Z' })).status, 200);
    assert.equal(einw(U.mitarbeiter), null);
    assert.equal(prot(U.mitarbeiter).length, 0);
    // ungültig
    for (const body of [{}, { an: 'ja' }, { an: 1 }, { an: null }]) assert.equal((await ma.put('/auth/standort', body)).status, 400, JSON.stringify(body));
    assert.equal(einw(U.mitarbeiter), null);
    // selbst (auch mit der eigenen benutzerId)
    const jetzt = s.uhr().toISOString();
    let r = await ma.put('/auth/standort', { an: true, benutzerId: U.mitarbeiter });
    assert.equal(r.status, 200);
    assert.equal(r.daten.standortEinwilligung, jetzt);
    assert.equal(einw(U.mitarbeiter), jetzt);
    assert.equal((await ma.get('/auth/ich')).daten.benutzer.standortEinwilligung, jetzt);
    let p = prot(U.mitarbeiter);
    assert.equal(p.length, 1);
    assert.equal(p[0].benutzer_id, U.mitarbeiter);
    assert.match(p[0].text, /selbst eingeschaltet/);
    assert.deepEqual(JSON.parse(p[0].neu), { standortEinwilligung: jetzt });
    // nochmals „an“ später: Zeitpunkt der Einwilligung bleibt, kein neuer Protokolleintrag
    s.uhr.plus(3);
    r = await ma.put('/auth/standort', { an: true });
    assert.equal(r.daten.standortEinwilligung, jetzt);
    assert.equal(prot(U.mitarbeiter).length, 1);
    // gilt je Person: andere Personen (auch am selben Gerät) bleiben aus
    for (const c of [pol, buero, gf]) assert.equal((await c.get('/auth/ich')).daten.benutzer.standortEinwilligung, null);
    // das Büro (Verwaltung) sieht, OB es an ist
    const liste = (await gf.get('/benutzer')).daten;
    assert.equal(liste.find((b) => b.id === U.mitarbeiter).standortEinwilligung, jetzt);
    assert.equal(liste.find((b) => b.id === U.polier).standortEinwilligung, null);
    const lb = (await buero.get('/benutzer')).daten;
    if (Array.isArray(lb)) assert.equal(lb.find((b) => b.id === U.mitarbeiter).standortEinwilligung, jetzt);
    // bleibt über Abmelden/Anmelden erhalten (am Server, nicht am Gerät)
    await ma.post('/auth/logout', {});
    const ma2 = await s.login(U.mitarbeiter);
    assert.equal((await ma2.get('/auth/ich')).daten.benutzer.standortEinwilligung, jetzt);
    ma.cookie = ma2.cookie;
  });

  let kommenId;
  await t.test('Stempeln mit Einwilligung: sofort gebucht, Standort mitgesendet oder nachgereicht (eigene, frische Buchung ohne Standort)', async () => {
    s.uhr.plus(10);
    let r = await ma.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
    assert.equal(r.status, 200);
    kommenId = r.daten.buchungId;
    assert.equal(r.daten.standortGespeichert, false);
    assert.equal(geo(kommenId).lat, null);
    // ungültig → 400, nichts gespeichert
    for (const body of [{}, { standort: null }, { standort: 'hier' }, { standort: { lat: 100, lng: 16 } }, { standort: { lat: 47, lng: 200 } }, { standort: { lat: '47', lng: 16 } }, { standort: { lat: 47, lng: 16, genauigkeit: -1 } }, { standort: { lat: 47, lng: 16, genauigkeit: 200000 } }]) {
      assert.equal((await ma.post(`/zeit/stempeln/${kommenId}/standort`, body)).status, 400, JSON.stringify(body));
    }
    assert.equal(geo(kommenId).lat, null);
    // eine andere Person (auch GF/Büro, Polier der Partie) kann nichts an diese Buchung hängen → 404
    for (const c of [pol, buero, bl, gf]) assert.equal((await c.post(`/zeit/stempeln/${kommenId}/standort`, { standort: PUNKT })).status, 404);
    assert.equal(geo(kommenId).lat, null);
    // unbekannte ID
    assert.equal((await ma.post('/zeit/stempeln/99999999/standort', { standort: PUNKT })).status, 404);
    assert.equal((await ma.post('/zeit/stempeln/abc/standort', { standort: PUNKT })).status, 400);
    // nach 1 Minute (Ortung dauert): angenommen
    s.uhr.plus(1);
    r = await ma.post(`/zeit/stempeln/${kommenId}/standort`, { standort: PUNKT });
    assert.equal(r.status, 200);
    assert.deepEqual(r.daten.standort, PUNKT);
    assert.deepEqual(geo(kommenId), PUNKT);
    // nie überschreiben
    r = await ma.post(`/zeit/stempeln/${kommenId}/standort`, { standort: { lat: 48, lng: 16, genauigkeit: 5 } });
    assert.equal(r.status, 409);
    assert.match(r.daten.fehler, /nicht überschrieben/);
    assert.deepEqual(geo(kommenId), PUNKT);
    // Pause: gleich mit Standort im Stempeln → gespeichert
    s.uhr.plus(60);
    r = await ma.post('/zeit/stempeln', { typ: 'pause_start', standort: { lat: 47.7339, lng: 16.1831, genauigkeit: 8 } });
    assert.equal(r.daten.standortGespeichert, true);
    assert.deepEqual(geo(r.daten.buchungId), { lat: 47.7339, lng: 16.1831, genauigkeit: 8 });
    // Pause beenden: erst nach mehr als 10 Minuten nachgereicht → 409
    s.uhr.plus(30);
    r = await ma.post('/zeit/stempeln', { typ: 'pause_ende' });
    const ende = r.daten.buchungId;
    s.uhr.plus(10); // genau 10 Minuten nach dem Stempeln: noch angenommen
    assert.equal((await ma.post(`/zeit/stempeln/${ende}/standort`, { standort: PUNKT })).status, 200);
  });

  await t.test('Nachreichen: 10-Minuten-Grenze, Einwilligung widerrufen, fremd erfasste Buchungen (Kolonne, Büro) nie', async () => {
    s.uhr.plus(30);
    let r = await ma.post('/zeit/stempeln', { typ: 'wechsel', baustelleId: BS.kogler });
    const w = r.daten.buchungId;
    s.uhr.plus(10.5);
    r = await ma.post(`/zeit/stempeln/${w}/standort`, { standort: PUNKT });
    assert.equal(r.status, 409);
    assert.match(r.daten.fehler, /10 Minuten/);
    assert.equal(geo(w).lat, null);
    // Kolonne: der Polier stempelt den Mitarbeiter 3 – dessen Buchung erhält nie einen Standort, weder vom Polier noch von ihm selbst
    const ma3 = await s.login(3);
    assert.equal((await ma3.put('/auth/standort', { an: true })).status, 200);
    const k = await pol.post('/zeit/kolonne', { typ: 'kommen', baustelleId: BS.pitten, benutzerIds: [3], standort: PUNKT });
    assert.equal(k.status, 200);
    assert.equal(k.daten.ergebnisse[0].ok, true, JSON.stringify(k.daten));
    const kb = s.db.eins('SELECT id, lat FROM buchung WHERE benutzer_id = 3 ORDER BY id DESC LIMIT 1');
    assert.equal(kb.lat, null);
    assert.equal((await ma3.post(`/zeit/stempeln/${kb.id}/standort`, { standort: PUNKT })).status, 404);
    assert.equal((await pol.post(`/zeit/stempeln/${kb.id}/standort`, { standort: PUNKT })).status, 404);
    assert.equal(geo(kb.id).lat, null);
    // Büro-Nachtrag (quelle buero) ebenso
    s.uhr.plus(3);
    const nb = await buero.post('/zeit/buchungen', { benutzerId: 3, typ: 'gehen', zeit: new Date(s.uhr().getTime() - 60000).toISOString(), grund: 'Probe Standort' });
    assert.equal(nb.status, 201, JSON.stringify(nb.daten));
    assert.equal((await ma3.post(`/zeit/stempeln/${nb.daten.id}/standort`, { standort: PUNKT })).status, 404);
    // Widerruf: danach weder mitgesendet noch nachgereicht; Protokoll
    s.uhr.plus(1);
    r = await ma.post('/zeit/stempeln', { typ: 'gehen' });
    const g = r.daten.buchungId;
    // Prüfbefund n8-g: der Widerruf löscht die gespeicherten Standorte der Person (nicht die Buchungen), mit Anzahl im Protokoll
    const mitOrt = s.db.eins('SELECT COUNT(*) AS n FROM buchung WHERE benutzer_id = ? AND lat IS NOT NULL', U.mitarbeiter).n;
    assert.ok(mitOrt >= 2 && geo(kommenId).lat !== null, `Vorbedingung: ${mitOrt} Standorte`);
    const buchungenVorher = s.db.eins('SELECT COUNT(*) AS n FROM buchung WHERE benutzer_id = ?', U.mitarbeiter).n;
    const fremdVorher = s.db.eins('SELECT COUNT(*) AS n FROM buchung WHERE benutzer_id <> ? AND lat IS NOT NULL', U.mitarbeiter).n;
    const wr = await ma.put('/auth/standort', { an: false });
    assert.equal(wr.status, 200);
    assert.equal(wr.daten.standorteGeloescht, mitOrt);
    assert.equal(einw(U.mitarbeiter), null);
    assert.match(prot(U.mitarbeiter).at(-1).text, /ausgeschaltet \(Einwilligung widerrufen, \d+ gespeicherte Standorte gelöscht\)/);
    assert.equal(JSON.parse(prot(U.mitarbeiter).at(-1).neu).standorteGeloescht, mitOrt);
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM buchung WHERE benutzer_id = ? AND (lat IS NOT NULL OR lng IS NOT NULL OR genauigkeit IS NOT NULL)', U.mitarbeiter).n, 0);
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM buchung WHERE benutzer_id = ?', U.mitarbeiter).n, buchungenVorher);
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM buchung WHERE benutzer_id <> ? AND lat IS NOT NULL', U.mitarbeiter).n, fremdVorher);
    for (const c of [ma, buero, gf]) assert.ok((await c.get(`/zeit/buchungen?benutzerId=${U.mitarbeiter}&von=2026-11-01&bis=2026-11-30`)).daten.every((b) => b.standort === null));
    // erneutes „aus“ ändert nichts (kein weiterer Protokolleintrag)
    const nProt = prot(U.mitarbeiter).length;
    assert.equal((await ma.put('/auth/standort', { an: false })).status, 200);
    assert.equal(prot(U.mitarbeiter).length, nProt);
    assert.equal((await ma.post(`/zeit/stempeln/${g}/standort`, { standort: PUNKT })).status, 409);
    assert.equal(geo(g).lat, null);
    // offline nachgesendet mit Standort, aber Einwilligung inzwischen aus → Buchung ja, Standort nein
    s.uhr.plus(60);
    r = await ma.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten, zeit: new Date(s.uhr().getTime() - 5 * 60000).toISOString(), standort: PUNKT });
    assert.equal(r.status, 200);
    assert.equal(r.daten.standortGespeichert, false);
    assert.equal(geo(r.daten.buchungId).lat, null);
    // wieder an: offline nachgesendet mit Standort → gespeichert (quelle offline)
    assert.equal((await ma.put('/auth/standort', { an: true })).status, 200);
    s.uhr.plus(60);
    r = await ma.post('/zeit/stempeln', { typ: 'gehen', zeit: new Date(s.uhr().getTime() - 2 * 60000).toISOString(), standort: PUNKT });
    assert.equal(r.daten.standortGespeichert, true);
    assert.deepEqual(geo(r.daten.buchungId), PUNKT);
    assert.equal(s.db.eins('SELECT quelle FROM buchung WHERE id = ?', r.daten.buchungId).quelle, 'offline');
    kommenId = r.daten.buchungId; // die früheren Standorte sind mit dem Widerruf gelöscht – ab hier gilt diese Buchung
  });

  await t.test('Sichtbar: die Person selbst und Recht stammdaten (Büro, Bauleiter, GF) in GET /zeit/buchungen; Polier/Mitarbeiter nie fremd', async () => {
    const q = `/zeit/buchungen?benutzerId=${U.mitarbeiter}&von=2026-11-12&bis=2026-11-12`;
    for (const c of [ma, buero, bl, gf]) {
      const r = await c.get(q);
      assert.equal(r.status, 200);
      const k = r.daten.find((b) => b.id === kommenId);
      assert.deepEqual(k.standort, PUNKT);
      assert.ok(r.daten.some((b) => b.standort === null));
    }
    for (const c of [pol, await s.login(3)]) assert.equal((await c.get(q)).status, 403);
    // ohne Recht stammdaten (GF entzieht es dem Büro) → 403 wie für alle Buchungen anderer
    const pr = await gf.put('/rechte/matrix', { rolle: 'buero', recht: 'stammdaten', wert: false });
    assert.equal(pr.status, 200, JSON.stringify(pr.daten));
    assert.equal((await buero.get(q)).status, 403);
  });

  await t.test('Keine Koordinaten einer anderen Person in irgendeiner GET-Antwort an Polier/Mitarbeiter', async () => {
    assert.deepEqual(geo(kommenId), PUNKT);
    const formen = FORMEN(PUNKT);
    const pfade = routenAusApp(s.app).filter((r) => r.startsWith('GET /api/') && !r.includes(':') && !r.includes('*')).map((r) => r.slice(8))
      .concat([`/zeit/kolonne?baustelleId=${BS.pitten}`, `/zeit/kolonne?baustelleId=${BS.pitten}&plan=1`, '/zeit/woche?datum=2026-11-12', '/monat?monat=2026-11', '/monat?jahr=2026&monat=11', `/baustellen/${BS.pitten}`]);
    assert.ok(pfade.length > 60, `nur ${pfade.length} Pfade`);
    const v = [];
    let gelesen = 0;
    for (const [wer, c] of [['Polier', pol], ['Mitarbeiter 3', await s.login(3)]]) {
      for (const p of pfade) {
        const r = await c.get(p);
        if (r.status >= 200 && r.status < 300) gelesen++;
        const text = Buffer.isBuffer(r.daten) ? r.daten.toString('latin1') : typeof r.daten === 'string' ? r.daten : JSON.stringify(r.daten);
        for (const f of formen) if (text.includes(f)) { v.push(`${wer} GET ${p}: Koordinate „${f}“ von Mitarbeiter ${U.mitarbeiter}`); break; }
      }
    }
    assert.ok(gelesen > 40, `nur ${gelesen} lesbare Antworten`);
    assert.deepEqual(v, []);
    // Gegenprobe: der Mitarbeiter selbst sieht seinen Standort
    const eigen = JSON.stringify((await ma.get('/zeit/buchungen')).daten);
    assert.ok(eigen.includes(String(PUNKT.lat)));
  });
});
