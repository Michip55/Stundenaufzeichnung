'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS, euroFelder } = require('./hilfe');

const ROLLEN = ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf'];
const OK = 'ok';
const NEIN = 403;

/**
 * Jede sensible Route gegen jede Rolle. 'ok' = weder 401 noch 403 (kann 200/201/400 sein).
 * Reihenfolge: mitarbeiter, polier, bauleiter, buero, gf
 * Owner-Entscheidung 13.11.2026: Bauleiter = Büro (Spalte 3 = Spalte 4).
 */
const MATRIX = [
  ['GET', '/preise', null, [NEIN, NEIN, OK, OK, OK]],
  ['GET', '/kalkulation', null, [NEIN, NEIN, OK, OK, OK]],
  ['GET', `/kalkulation/${BS.pitten}`, null, [NEIN, NEIN, OK, OK, OK]],
  ['GET', `/kalkulation/${BS.reisinger}`, null, [NEIN, NEIN, OK, OK, OK]],
  ['GET', '/monat?monat=2026-11', null, [NEIN, NEIN, OK, OK, OK]],
  ['GET', '/monat/export.csv?monat=2026-11', null, [NEIN, NEIN, OK, OK, OK]],
  ['GET', '/monat/buak.csv?monat=2026-11', null, [NEIN, NEIN, OK, OK, OK]],
  ['GET', '/rechte', null, [NEIN, NEIN, NEIN, NEIN, OK]],
  ['GET', '/benutzer', null, [NEIN, NEIN, OK, OK, OK]], // C-14: Büro verwaltet Mitarbeiter/Polier/Bauleiter
  ['GET', '/zeit/anwesend', null, [NEIN, NEIN, OK, OK, OK]],
  ['GET', '/berichte', null, [NEIN, OK, OK, OK, OK]],
  ['GET', `/zeit/kolonne?baustelleId=${BS.pitten}`, null, [NEIN, OK, NEIN, NEIN, OK]],
  ['PUT', '/preise/geraete/1', { feld: 'kostensatz', wert: 52 }, [NEIN, NEIN, OK, OK, OK]],
  ['PUT', '/preise/lohngruppen/fa', { feld: 'kostensatz', wert: 46 }, [NEIN, NEIN, OK, OK, OK]],
  ['PUT', `/baustellen/${BS.pitten}/auftrag`, { schwellen: [80, 90, 100] }, [NEIN, NEIN, OK, OK, OK]],
  ['POST', `/baustellen/${BS.pitten}/nachtraege`, { text: 'Test', betrag: 0 }, [NEIN, NEIN, OK, OK, OK]],
  ['POST', `/baustellen/${BS.pitten}/fremdleistungen`, { text: 'Test', betrag: 0, datum: '2026-11-12' }, [NEIN, NEIN, OK, OK, OK]],
  ['POST', `/baustellen/${BS.pitten}/leistungen`, { leistungId: 4, menge: 0.001, datum: '2026-11-12' }, [NEIN, NEIN, OK, OK, OK]],
  ['POST', `/baustellen/${BS.reisinger}/leistungen`, { leistungId: 4, menge: 0.001, datum: '2026-11-12' }, [NEIN, NEIN, OK, OK, OK]],
  ['POST', '/baustellen', {}, [NEIN, NEIN, OK, OK, OK]],
  ['PUT', `/baustellen/${BS.pitten}`, {}, [NEIN, NEIN, OK, OK, OK]],
  ['PUT', '/rechte/matrix', { rolle: 'buero', recht: 'kolonne', wert: false }, [NEIN, NEIN, NEIN, NEIN, OK]],
  ['PUT', '/rechte/ausnahme', { benutzerId: 2, recht: 'kolonne', wert: false }, [NEIN, NEIN, NEIN, NEIN, OK]],
  ['POST', '/benutzer', {}, [NEIN, NEIN, OK, OK, OK]],
  ['PUT', '/benutzer/2', {}, [NEIN, NEIN, OK, OK, OK]],
  ['PUT', `/benutzer/${U.gf}`, { name: 'X' }, [NEIN, NEIN, NEIN, NEIN, OK]],
  ['POST', '/zeit/kolonne', {}, [NEIN, OK, NEIN, NEIN, OK]],
  ['POST', '/berichte', {}, [NEIN, OK, OK, OK, OK]]
];

test('Rechte je Rolle und Route (serverseitig)', async (t) => {
  const s = await starte({ euroSicherheitsnetz: false });
  t.after(() => s.stop());
  const c = {};
  for (const r of ROLLEN) c[r] = await s.login(U[r]);

  await t.test('Matrix: jede Rolle gegen jede sensible Route', async () => {
    for (const [methode, pfad, body, erwartet] of MATRIX) {
      for (let i = 0; i < ROLLEN.length; i++) {
        const r = await c[ROLLEN[i]].anfrage(methode, pfad, body === null ? undefined : body);
        const was = `${ROLLEN[i]} ${methode} ${pfad} → ${r.status}`;
        if (erwartet[i] === NEIN) {
          assert.equal(r.status, 403, was);
          assert.equal(r.daten.code, 'KEIN_ZUGRIFF', was);
        } else {
          assert.ok(r.status !== 403 && r.status !== 401, was);
          assert.ok(r.status < 500, was);
        }
      }
    }
  });

  await t.test('Mitarbeiter und Polier erhalten nie €-Felder (Listen und Details, ohne Sicherheitsnetz)', async () => {
    const polierBerichte = (await c.polier.get('/berichte')).daten;
    assert.ok(polierBerichte.length > 5);
    const pfade = [
      '/auth/ich', '/baustellen', ...Object.values(BS).map((id) => `/baustellen/${id}`), '/mitarbeiter', '/geraete', '/materialien', '/leistungen',
      '/zeit/status', '/zeit/woche', '/zeit/woche?datum=2026-11-03', '/benachrichtigungen', '/integrationen'
    ];
    for (const rolle of ['mitarbeiter', 'polier']) {
      const extra = rolle === 'polier' ? ['/berichte', `/berichte/${polierBerichte[0].id}`, `/berichte/${polierBerichte[polierBerichte.length - 1].id}`, `/zeit/kolonne?baustelleId=${BS.pitten}`] : [];
      for (const p of [...pfade, ...extra]) {
        const r = await c[rolle].get(p);
        if (r.status === 404) continue; // nicht sichtbare Baustelle
        assert.equal(r.status, 200, `${rolle} ${p}`);
        assert.deepEqual(euroFelder(r.daten), [], `${rolle} ${p} enthält €-Felder`);
        assert.ok(!JSON.stringify(r.daten).includes('€'), `${rolle} ${p} enthält €-Zeichen`);
      }
    }
  });

  await t.test('Mitarbeiter/Polier sehen nur aktive bzw. eigene Baustellen', async () => {
    s.db.lauf("UPDATE baustelle SET status = 'abgeschlossen' WHERE id = ?", BS.reisinger);
    const ids = (await c.mitarbeiter.get('/baustellen')).daten.map((b) => b.id);
    assert.ok(!ids.includes(BS.reisinger));
    assert.equal((await c.mitarbeiter.get(`/baustellen/${BS.reisinger}`)).status, 404);
    assert.equal((await c.gf.get(`/baustellen/${BS.reisinger}`)).status, 200);
    s.db.lauf("UPDATE baustelle SET status = 'aktiv' WHERE id = ?", BS.reisinger);
  });

  await t.test('Mitarbeiter sieht in /mitarbeiter nur sich selbst, ohne Lohngruppe', async () => {
    const r = await c.mitarbeiter.get('/mitarbeiter');
    assert.deepEqual(r.daten.map((m) => m.id), [U.mitarbeiter]);
    assert.ok(!('lohngruppe' in r.daten[0]));
    const p = await c.polier.get('/mitarbeiter');
    assert.ok(p.daten.length > 20);
    assert.ok(p.daten.every((m) => !('lohngruppe' in m)));
    const b = await c.buero.get('/mitarbeiter');
    assert.ok(b.daten.some((m) => m.lohngruppe === 'fa'));
  });

  await t.test('Bauleiter wie Büro: €/Budget für alle Baustellen (13.11.2026)', async () => {
    const liste = (await c.bauleiter.get('/baustellen')).daten;
    const buero = (await c.buero.get('/baustellen')).daten;
    assert.deepEqual(liste.map((b) => b.id).sort(), buero.map((b) => b.id).sort());
    for (const id of [BS.pitten, BS.reisinger]) {
      const b = liste.find((x) => x.id === id);
      assert.equal(typeof b.auftragssumme, 'number');
      assert.equal(typeof b.budgetVerbrauchProzent, 'number');
    }
    assert.ok(Array.isArray((await c.bauleiter.get(`/baustellen/${BS.reisinger}`)).daten.nachtraege));
    // Kalkulationsübersicht: alle wie Büro
    const k = (await c.bauleiter.get('/kalkulation')).daten.map((x) => x.baustelleId).sort();
    assert.deepEqual(k, (await c.buero.get('/kalkulation')).daten.map((x) => x.baustelleId).sort());
    assert.equal((await c.gf.get('/kalkulation')).daten.length, 7);
    // Berichte: alle Baustellen
    const ber = (await c.bauleiter.get('/berichte')).daten;
    assert.ok(ber.some((b) => b.baustelleId === BS.reisinger));
    const fremderBericht = s.db.eins('SELECT id FROM bericht WHERE baustelle_id = ?', BS.reisinger).id;
    const fb = await c.bauleiter.get(`/berichte/${fremderBericht}`);
    assert.equal(fb.status, 200);
    assert.equal(typeof fb.daten.kostenTag.gesamt, 'number');
    assert.equal(typeof (await c.bauleiter.get('/geraete')).daten[0].kostensatz, 'number');
  });

  await t.test('Polier: Berichte nur eigener Baustellen', async () => {
    const ber = (await c.polier.get('/berichte')).daten;
    assert.ok(ber.every((b) => b.baustelleId === BS.pitten));
    const fremd = s.db.eins('SELECT id FROM bericht WHERE baustelle_id = ?', BS.kogler).id;
    assert.equal((await c.polier.get(`/berichte/${fremd}`)).status, 403);
    assert.equal((await c.polier.get(`/berichte/${fremd}/pdf`)).status, 403);
    assert.equal((await c.polier.post('/berichte', { baustelleId: BS.kogler, datum: '2026-11-12' })).status, 403);
  });

  await t.test('Polier und Mitarbeiter: gesperrte Rechte weder per Matrix noch per Ausnahme vergebbar (400)', async () => {
    for (const rolle of ['mitarbeiter', 'polier']) {
      for (const recht of ['preise_sehen', 'preise_bearbeiten', 'kalk_sehen', 'lohn']) {
        const m = await c.gf.put('/rechte/matrix', { rolle, recht, wert: true });
        assert.equal(m.status, 400, `${rolle}/${recht}`);
        assert.equal(m.daten.code, 'UNGUELTIG');
        const a = await c.gf.put('/rechte/ausnahme', { benutzerId: rolle === 'polier' ? U.polier : U.mitarbeiter, recht, wert: true });
        assert.equal(a.status, 400, `Ausnahme ${rolle}/${recht}`);
      }
    }
    assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM benutzer_recht WHERE recht IN ('preise_sehen','kalk_sehen','lohn','preise_bearbeiten')").n, 0);
    // auch direkt in der DB gesetzte Ausnahme wirkt nicht
    s.db.lauf("INSERT INTO benutzer_recht (benutzer_id, recht, erteilt) VALUES (?, 'preise_sehen', '2026-11-12')", U.polier);
    s.db.lauf("UPDATE rolle_recht SET wert = 1 WHERE rolle = 'polier' AND recht = 'kalk_sehen'");
    const p2 = await s.login(U.polier);
    assert.ok(!(await p2.get('/auth/ich')).daten.rechte.includes('preise_sehen'));
    assert.equal((await p2.get('/preise')).status, 403);
    assert.equal((await p2.get('/kalkulation')).status, 403);
    assert.deepEqual(euroFelder((await p2.get('/geraete')).daten), []);
    s.db.lauf("DELETE FROM benutzer_recht WHERE benutzer_id = ? AND recht = 'preise_sehen'", U.polier);
    s.db.lauf("UPDATE rolle_recht SET wert = 0 WHERE rolle = 'polier' AND recht = 'kalk_sehen'");
  });

  await t.test('Bauleiter wie Büro: nur benutzer gesperrt; GF behält benutzer', async () => {
    assert.equal((await c.gf.put('/rechte/matrix', { rolle: 'bauleiter', recht: 'benutzer', wert: true })).status, 400);
    assert.equal((await c.gf.put('/rechte/ausnahme', { benutzerId: U.bauleiter, recht: 'benutzer', wert: true })).status, 400);
    const ich = (await c.bauleiter.get('/auth/ich')).daten.rechte.sort();
    assert.deepEqual(ich, (await c.buero.get('/auth/ich')).daten.rechte.sort());
    const r = await c.gf.put('/rechte/matrix', { rolle: 'gf', recht: 'benutzer', wert: false });
    assert.equal(r.status, 400);
    assert.equal((await c.gf.get('/rechte')).status, 200);
  });

  await t.test('Ausnahme: Polier darf freigeben (nur eigene Baustellen), Entzug wirkt sofort', async () => {
    const r = await c.gf.put('/rechte/ausnahme', { benutzerId: U.polier, recht: 'bericht_freigeben', wert: true });
    assert.equal(r.status, 200);
    assert.ok(r.daten.rechte.includes('bericht_freigeben'));
    const eigen = s.db.eins("SELECT id FROM bericht WHERE baustelle_id = ? AND status = 'unterschrieben' ORDER BY datum LIMIT 1", BS.pitten).id;
    const fremd = s.db.eins("SELECT id FROM bericht WHERE baustelle_id = ? AND status = 'unterschrieben' ORDER BY datum LIMIT 1", BS.kogler).id;
    assert.equal((await c.polier.post(`/berichte/${fremd}/freigeben`)).status, 403);
    // D-10: eigene AN-Unterschrift → nicht selbst freigeben
    const vier = await c.polier.post(`/berichte/${eigen}/freigeben`);
    assert.equal(vier.status, 403);
    assert.match(vier.daten.fehler, /Vier-Augen-Prinzip/);
    s.db.lauf("UPDATE unterschrift SET erfasst_von = ? WHERE bericht_id = ? AND rolle = 'an'", 4, eigen);
    assert.equal((await c.polier.post(`/berichte/${eigen}/freigeben`)).status, 200);
    // trotzdem keine Preise im Bericht
    assert.deepEqual(euroFelder((await c.polier.get(`/berichte/${eigen}`)).daten), []);
    await c.gf.put('/rechte/ausnahme', { benutzerId: U.polier, recht: 'bericht_freigeben', wert: false });
    const nochEiner = s.db.eins("SELECT id FROM bericht WHERE baustelle_id = ? AND status = 'unterschrieben' ORDER BY datum LIMIT 1", BS.pitten);
    if (nochEiner) assert.equal((await c.polier.post(`/berichte/${nochEiner.id}/freigeben`)).status, 403);
  });

  await t.test('Matrix-Änderung wirkt und wird protokolliert', async () => {
    assert.equal((await c.gf.put('/rechte/matrix', { rolle: 'mitarbeiter', recht: 'kolonne', wert: true })).status, 200);
    assert.equal((await c.mitarbeiter.get(`/zeit/kolonne?baustelleId=${BS.pitten}`)).status, 200);
    await c.gf.put('/rechte/matrix', { rolle: 'mitarbeiter', recht: 'kolonne', wert: false });
    assert.equal((await c.mitarbeiter.get(`/zeit/kolonne?baustelleId=${BS.pitten}`)).status, 403);
    const r = (await c.gf.get('/rechte')).daten;
    assert.deepEqual(r.rollen, ROLLEN);
    assert.deepEqual(r.gesperrt.polier.sort(), ['benutzer', 'kalk_sehen', 'lohn', 'preise_bearbeiten', 'preise_sehen', 'stammdaten']);
    assert.equal(r.matrix.gf.benutzer, true);
    assert.ok(r.protokoll.some((p) => p.art === 'recht' && /mitarbeiter – kolonne entzogen/i.test(p.text)));
    assert.ok(r.protokoll.some((p) => p.art === 'recht' && /Ausnahme für Josef Haidbauer/.test(p.text)));
  });

  await t.test('Protokoll ist unveränderbar', () => {
    assert.throws(() => s.db.lauf('DELETE FROM protokoll'), /unveränderbar/);
    assert.throws(() => s.db.lauf("UPDATE protokoll SET text = 'x'"), /unveränderbar/);
  });

  await t.test('Benutzer verwalten: anlegen, Rolle ändern, letzte GF nicht entfernbar', async () => {
    const n = await c.gf.post('/benutzer', { name: 'Test Neu', rolle: 'mitarbeiter', lohngruppe: 'hi', pin: '5917', baustelleId: BS.kogler });
    assert.equal(n.status, 201);
    assert.equal(n.daten.lohngruppe, 'hi');
    await s.login(n.daten.id, '5917');
    assert.equal((await c.gf.post('/benutzer', { name: 'X', rolle: 'chef', pin: '5917' })).status, 400);
    assert.equal((await c.gf.post('/benutzer', { name: 'X', rolle: 'mitarbeiter', pin: '12' })).status, 400);
    assert.equal((await c.gf.post('/benutzer', { name: 'X', rolle: 'mitarbeiter', pin: '1234', lohngruppe: 'zz' })).status, 400);
    // B-01: eigene Rolle nicht änderbar, sich selbst nicht deaktivieren (schützt auch die letzte GF)
    assert.equal((await c.gf.put(`/benutzer/${U.gf}`, { rolle: 'buero' })).status, 403);
    assert.equal((await c.gf.put(`/benutzer/${U.gf}`, { aktiv: false })).status, 403);
    assert.equal((await c.gf.put('/benutzer/99999', { name: 'x' })).status, 404);
    // Rollenwechsel → Protokoll art 'rolle'
    assert.equal((await c.gf.put(`/benutzer/${n.daten.id}`, { rolle: 'polier' })).status, 200);
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE art = 'rolle'").n >= 1);
  });

  await t.test('Anwesenheit: Bauleiter wie Büro alle Baustellen, keine €-Felder', async () => {
    const alle = (await c.buero.get('/zeit/anwesend')).daten;
    assert.ok(alle.length > 5);
    for (const a of alle) {
      assert.ok(['arbeit', 'pause'].includes(a.status));
      assert.deepEqual(Object.keys(a).sort(), ['baustelleId', 'benutzerId', 'name', 'rolle', 'schichtBeginn', 'seit', 'status']);
    }
    const bl = (await c.bauleiter.get('/zeit/anwesend')).daten;
    assert.deepEqual(bl, alle);
    // nach Ausnahme bericht_freigeben sieht der Polier nur seine Partie
    await c.gf.put('/rechte/ausnahme', { benutzerId: U.polier2, recht: 'bericht_freigeben', wert: true });
    const p2 = await s.login(U.polier2);
    const pl = (await p2.get('/zeit/anwesend')).daten;
    assert.ok(pl.every((a) => a.baustelleId === BS.kogler));
    assert.ok(pl.length > 0);
  });

  await t.test('Sicherheitsnetz entfernt €-Felder zusätzlich (Standard)', async () => {
    const s2 = await starte();
    try {
      const p = await s2.login(U.polier);
      assert.deepEqual(euroFelder((await p.get('/baustellen')).daten), []);
      const gf = await s2.login(U.gf);
      assert.equal(typeof (await gf.get('/geraete')).daten[0].kostensatz, 'number');
    } finally { await s2.stop(); }
  });
});
