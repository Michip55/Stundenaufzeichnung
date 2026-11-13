'use strict';
/** Bauvorhaben: Lebenslauf und Archiv (API.md 12.15) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS, euroFelder } = require('./hilfe');
const { wienDatum, plusTage } = require('../../server/datum');

test('Bauvorhaben: Phasen, Archiv, Erinnerungen', async (t) => {
  const s = await starte({ sitzung: { feldMin: 60 * 24 * 60, bueroMin: 60 * 24 * 60, maxH: 24 * 90 } });
  t.after(() => s.stop());
  const c = {};
  for (const r of ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf']) c[r] = await s.login(U[r]);
  const heute = wienDatum(s.uhr());
  const bs = (id = BS.pitten) => s.db.eins('SELECT * FROM baustelle WHERE id = ?', id);
  const phase = (rolle, body, id = BS.pitten) => c[rolle].post(`/baustellen/${id}/phase`, { version: bs(id).version, ...body });
  const meldungen = async (rolle, re) => (await c[rolle].get('/benachrichtigungen')).daten.filter((m) => re.test(m.titel));

  await t.test('Ausgangsstand: Phase aus dem Status, JSON-Felder', async () => {
    const d = (await c.buero.get(`/baustellen/${BS.pitten}`)).daten;
    assert.equal(d.phase, 'in_arbeit');
    assert.equal(d.status, 'aktiv');
    assert.equal(d.archiviert, false);
    assert.equal(bs().bauleiter_id, U.bauleiter);
    const ab = s.db.eins("SELECT id, phase, status FROM baustelle WHERE status = 'abgeschlossen' LIMIT 1");
    if (ab) assert.equal(ab.phase, 'fertiggestellt');
  });

  await t.test('Rechte und Übergänge', async () => {
    assert.equal((await phase('mitarbeiter', { phase: 'fertiggestellt' })).status, 403);
    assert.equal((await phase('polier', { phase: 'fertiggestellt' })).status, 403);
    assert.equal((await phase('buero', { phase: 'bezahlt' })).status, 409); // kein erlaubter Übergang
    assert.equal((await phase('buero', { phase: 'gibtsnicht' })).status, 400);
    assert.equal((await c.buero.post(`/baustellen/${BS.pitten}/phase`, { phase: 'pausiert', version: 99999 })).status, 409); // Version
    // Bauleiter einer fremden Baustelle
    const fremd = s.db.eins("SELECT id FROM baustelle WHERE (bauleiter_id IS NULL OR bauleiter_id <> ?) AND phase = 'in_arbeit' AND intern = 0 LIMIT 1", U.bauleiter).id;
    assert.equal((await phase('bauleiter', { phase: 'pausiert' }, fremd)).status, 403);
  });

  await t.test('Polier meldet Fertigstellung → Büro und Bauleiter benachrichtigt', async () => {
    assert.equal((await c.mitarbeiter.post(`/baustellen/${BS.pitten}/fertigmeldung`, {})).status, 403);
    const r = await c.polier.post(`/baustellen/${BS.pitten}/fertigmeldung`, { notiz: 'Pflaster fertig, Restarbeiten keine' });
    assert.equal(r.status, 201);
    assert.equal((await meldungen('buero', /Fertigstellung gemeldet/)).length, 1);
    assert.equal((await meldungen('bauleiter', /Fertigstellung gemeldet/)).length, 1);
    assert.equal((await meldungen('gf', /Fertigstellung gemeldet/)).length, 0);
    const d = (await c.buero.get(`/baustellen/${BS.pitten}`)).daten;
    assert.equal(d.fertigmeldung.von.id, U.polier);
    assert.equal((await c.buero.get('/baustellen-kennzahlen')).daten.fertigmeldungenOffen >= 1, true);
  });

  await t.test('Bauleiter: fertiggestellt, abgenommen (Abnahmedatum Pflicht, Gewährleistung +3 Jahre); weiter nur Büro', async () => {
    let r = await phase('bauleiter', { phase: 'fertiggestellt', notiz: 'bestätigt' });
    assert.equal(r.status, 200);
    assert.equal(r.daten.phase, 'fertiggestellt');
    assert.equal(r.daten.status, 'abgeschlossen');
    assert.equal(r.daten.fertigmeldung, undefined);
    // Stempeln/Bericht für spätere Tage gesperrt
    assert.equal((await phase('bauleiter', { phase: 'abgenommen' })).status, 400);
    r = await phase('bauleiter', { phase: 'abgenommen', abnahmeDatum: heute });
    assert.equal(r.status, 200);
    assert.equal(r.daten.abnahmeDatum, heute);
    assert.equal(r.daten.gewaehrleistungBis, `${Number(heute.slice(0, 4)) + 3}${heute.slice(4)}`);
    assert.equal((await phase('bauleiter', { phase: 'schlussrechnung' })).status, 403);
    const p = (await c.polier.get(`/baustellen/${BS.pitten}/phasen`)).daten;
    assert.deepEqual(p.slice(-2).map((x) => x.phase), ['fertiggestellt', 'abgenommen']);
    assert.equal(p[p.length - 2].notiz, 'bestätigt');
  });

  await t.test('Schlussrechnung (Betrag nur mit preise_bearbeiten), €-Schutz', async () => {
    const r = await phase('buero', { phase: 'schlussrechnung', schlussrechnung: { nr: 'AR-2026-117', betrag: 123456.785 } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.daten.schlussrechnung, { nr: 'AR-2026-117', datum: heute, betrag: 123456.79 });
    for (const rolle of ['polier', 'mitarbeiter']) {
      const d = (await c[rolle].get(`/baustellen/${BS.pitten}`)).daten;
      assert.equal(d.schlussrechnung, undefined, rolle);
      assert.deepEqual(euroFelder(d), [], rolle);
    }
    assert.equal((await c.bauleiter.get(`/baustellen/${BS.pitten}`)).daten.schlussrechnung.betrag, 123456.79);
    const k = (await c.buero.get('/baustellen-kennzahlen')).daten;
    assert.equal(k.phasen.schlussrechnung, 1);
    assert.equal(k.offeneSchlussrechnungen.summe, 123456.79);
    assert.equal((await c.polier.get('/baustellen-kennzahlen')).status, 403);
    assert.equal((await c.bauleiter.get('/baustellen-kennzahlen')).daten.phasen.schlussrechnung, 1);
  });

  await t.test('Abschluss: Gewährleistung, Haftrücklass (nur mit Preisrecht)', async () => {
    assert.equal((await c.bauleiter.put(`/baustellen/${BS.pitten}/abschluss`, { version: bs().version, gewaehrleistungBis: '2030-01-01' })).status, 403);
    const r = await c.buero.put(`/baustellen/${BS.pitten}/abschluss`, { version: bs().version, haftruecklass: { prozent: 3, betrag: 3703.7, bankgarantieBis: plusTage(heute, 20), freigabeAm: plusTage(heute, 40) } });
    assert.equal(r.status, 200);
    assert.equal(r.daten.haftruecklass.prozent, 3);
    assert.equal((await c.polier.get(`/baustellen/${BS.pitten}`)).daten.haftruecklass, undefined);
  });

  await t.test('Erinnerungen: Bankgarantie, Gewährleistung, Haftrücklass-Freigabe – je einmal', async () => {
    s.app.bt.stuendlich();
    s.app.bt.stuendlich();
    assert.equal((await meldungen('buero', /Bankgarantie läuft ab/)).length, 1);
    assert.equal((await meldungen('gf', /Bankgarantie läuft ab/)).length, 1);
    assert.equal((await meldungen('polier', /Bankgarantie/)).length, 0);
    const m = (await meldungen('buero', /Bankgarantie läuft ab/))[0];
    assert.ok(!/€|\d+,\d\d/.test(m.text), m.text);
    // Abnahme ohne Schlussrechnung > 14 Tage (andere Baustelle)
    const id = BS.kogler;
    await phase('buero', { phase: 'fertiggestellt' }, id);
    await phase('buero', { phase: 'abgenommen', abnahmeDatum: plusTage(heute, -20), gewaehrleistungBis: plusTage(heute, 60) }, id);
    s.app.bt.stuendlich();
    assert.equal((await meldungen('buero', /Schlussrechnung fehlt/)).length, 1);
    assert.equal((await meldungen('gf', /Schlussrechnung fehlt/)).length, 0);
    assert.equal((await meldungen('gf', /Gewährleistung endet/)).length, 1);
    s.app.bt.stuendlich();
    assert.equal((await meldungen('buero', /Schlussrechnung fehlt/)).length, 1);
  });

  await t.test('Archiv: nicht in Listen/Stempeln, lesbar; aufheben nur GF', async () => {
    assert.equal((await phase('buero', { phase: 'bezahlt' })).status, 200);
    assert.equal((await phase('bauleiter', { phase: 'archiviert' })).status, 403);
    const r = await phase('buero', { phase: 'archiviert', notiz: 'abgeschlossen' });
    assert.equal(r.status, 200);
    assert.equal(r.daten.archiviert, true);
    assert.ok(!(await c.buero.get('/baustellen')).daten.some((b) => b.id === BS.pitten));
    assert.ok((await c.buero.get('/baustellen?archiv=1')).daten.some((b) => b.id === BS.pitten));
    assert.ok((await c.buero.get(`/baustellen?archiv=1&jahr=${heute.slice(0, 4)}&suche=pitten`)).daten.some((b) => b.id === BS.pitten));
    assert.equal((await c.buero.get(`/baustellen?archiv=1&jahr=1999`)).daten.length, 0);
    assert.ok((await c.buero.get('/baustellen?alle=1')).daten.some((b) => b.id === BS.pitten));
    assert.equal((await c.buero.get(`/baustellen/${BS.pitten}`)).status, 200);
    assert.equal((await c.buero.get(`/kalkulation/${BS.pitten}`)).status, 200);
    assert.equal((await phase('buero', { phase: 'in_arbeit' })).status, 409);
    // Stempeln und neuer Bericht nicht möglich
    const st = await c.mitarbeiter.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten });
    assert.equal(st.status, 400, JSON.stringify([st.daten, s.db.eins('SELECT status, phase FROM baustelle WHERE id = ?', BS.pitten)]));
    assert.equal((await c.buero.post('/berichte', { baustelleId: BS.pitten, datum: heute })).status, 400);
    // aufheben
    assert.equal((await c.buero.post(`/baustellen/${BS.pitten}/archiv-aufheben`, { grund: 'Nachtrag' })).status, 403);
    assert.equal((await c.gf.post(`/baustellen/${BS.pitten}/archiv-aufheben`, {})).status, 400);
    const a = await c.gf.post(`/baustellen/${BS.pitten}/archiv-aufheben`, { grund: 'Nachtrag Gewährleistung' });
    assert.equal(a.status, 200);
    assert.equal(a.daten.phase, 'bezahlt');
    assert.ok((await c.buero.get('/baustellen')).daten.some((b) => b.id === BS.pitten));
  });

  await t.test('PUT /baustellen mit status setzt Phase; Koordinaten/AG-E-Mail', async () => {
    const id = BS.reisinger;
    let r = await c.buero.put(`/baustellen/${id}`, { version: bs(id).version, status: 'geplant', lat: 47.62, lng: 16.05, agEmail: 'bauherr@example.at, kopie@example.at', berichtMail: false });
    assert.equal(r.status, 200);
    assert.deepEqual([r.daten.phase, r.daten.status, r.daten.lat, r.daten.lng, r.daten.agEmail, r.daten.berichtMail], ['geplant', 'geplant', 47.62, 16.05, 'bauherr@example.at, kopie@example.at', false]);
    assert.equal((await c.buero.put(`/baustellen/${id}`, { version: bs(id).version, lat: 60 })).status, 400);
    assert.equal((await c.buero.put(`/baustellen/${id}`, { version: bs(id).version, agEmail: 'kein-mail' })).status, 400);
    assert.equal((await c.polier.get(`/baustellen/${id}`)).daten.agEmail, undefined);
    r = await c.buero.put(`/baustellen/${id}`, { version: bs(id).version, status: 'aktiv' });
    assert.equal(r.daten.phase, 'in_arbeit');
  });
});
