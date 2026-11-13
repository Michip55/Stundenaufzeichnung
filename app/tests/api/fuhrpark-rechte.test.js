'use strict';
/**
 * Servicebuch: jede neue Route × jede Rolle (inkl. Mitarbeiter/Polier mit Ausnahme `fuhrpark`) und €-Freiheit
 * aller Fuhrpark-Antworten für Mitarbeiter/Polier – ohne €-Sicherheitsnetz.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS, euroFelder } = require('./hilfe');
const { pngGrau } = require('../../server/png');

const OK = 'ok', N = 403;
const ROLLEN = ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf', 'polierFP', 'mitarbeiterFP'];
const ID = { mitarbeiter: U.mitarbeiter, polier: U.polier, bauleiter: U.bauleiter, buero: U.buero, gf: U.gf, polierFP: 25, mitarbeiterFP: 3 };
const ALLE = [OK, OK, OK, OK, OK, OK, OK];
const LESE = [N, OK, OK, OK, OK, OK, OK];
const PFLEGE = [N, N, N, OK, OK, OK, OK];
const KOSTEN_LESE = [N, N, OK, OK, OK, N, N]; // Leserecht + preise_sehen
const KOSTEN_PFLEGE = [N, N, N, OK, OK, N, N]; // fuhrpark + preise_sehen

function pdfText(buf) {
  const s = buf.toString('latin1');
  const out = [];
  for (const m of s.matchAll(/\[([^\]]*)\]\s*TJ/g)) out.push([...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join(''));
  return out.join('\n');
}

test('Servicebuch: Rechte je Rolle und Route, nie € für Mitarbeiter/Polier', async (t) => {
  const s = await starte({ euroSicherheitsnetz: false, pdfUnkomprimiert: true });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  // Ausnahme fuhrpark für einen Mitarbeiter (Polier 25 hat sie aus den Demo-Daten)
  assert.equal((await gf.put('/rechte/ausnahme', { benutzerId: 3, recht: 'fuhrpark', wert: true })).status, 200);
  // preise_sehen bleibt für Mitarbeiter/Polier gesperrt – auch mit fuhrpark
  assert.equal((await gf.put('/rechte/ausnahme', { benutzerId: 25, recht: 'preise_sehen', wert: true })).status, 400);
  const c = {};
  for (const r of ROLLEN) c[r] = await s.login(ID[r]);
  assert.ok((await c.polierFP.get('/auth/ich')).daten.rechte.includes('fuhrpark'));
  assert.ok((await c.mitarbeiterFP.get('/auth/ich')).daten.rechte.includes('fuhrpark'));
  assert.ok(!(await c.polierFP.get('/auth/ich')).daten.rechte.includes('preise_sehen'));

  const A = 18; // A18 Kettenbagger CAT 320
  const Z = s.db.eins("SELECT id FROM zaehler WHERE anlage_id = ? AND art = 'bh'", A).id;
  const P = s.db.eins('SELECT id FROM planposition WHERE anlage_id = ? LIMIT 1', A).id;
  const E = s.db.eins('SELECT id FROM servicebuch_eintrag WHERE anlage_id = ? LIMIT 1', A).id;
  const ST = s.db.eins('SELECT id FROM zaehlerstand WHERE zaehler_id = ? ORDER BY id DESC LIMIT 1', Z).id;
  const M = s.db.eins("SELECT id FROM mangel WHERE typ = 'mangel' LIMIT 1").id;
  // Schäden: von Mitarbeiter 2 auf seiner Baustelle Pitten (sichtbar für Polier/Bauleiter Pitten)
  const ma = c.mitarbeiter;
  const foto = { bildBase64: pngGrau(4, 4, () => 128).toString('base64'), dateiname: 'riss.png' };
  const sch = await ma.post('/fuhrpark/schaeden', { anlageId: 15, baustelleId: BS.pitten, art: 'defekt', ursache: 'Hydraulikschlauch beim Baggern geplatzt', einsatzfaehig: 'eingeschraenkt', fotos: [foto] });
  assert.equal(sch.status, 201, JSON.stringify(sch.daten));
  const SCH = sch.daten.id, FOTO = sch.daten.fotos[0].id;
  // Schaden eines Mitarbeiters der Partie Reisinger (nicht im Bereich von Polier 1/Bauleiter 103)
  const fremd = await (await s.login(14)).post('/fuhrpark/schaeden', { anlageId: 16, baustelleId: BS.reisinger, art: 'verschleiss', ursache: 'Gummikette rissig, läuft schief', einsatzfaehig: 'ja' });
  assert.equal(fremd.status, 201);
  const SCH2 = fremd.daten.id;

  const MATRIX = [
    ['GET', '/fuhrpark/anlagen', null, ALLE],
    ['GET', `/fuhrpark/anlagen/${A}`, null, ALLE],
    ['GET', '/fuhrpark/zaehlerabfrage', null, ALLE],
    ['GET', '/fuhrpark/maengel', null, ALLE],
    ['GET', '/fuhrpark/schaeden', null, ALLE],
    ['GET', `/fuhrpark/anlagen/${A}/plan`, null, LESE],
    ['GET', `/fuhrpark/zaehler/${Z}/verlauf`, null, LESE],
    ['GET', '/fuhrpark/eintraege', null, LESE],
    ['GET', `/fuhrpark/eintraege/${E}`, null, LESE],
    ['GET', '/fuhrpark/vorlagen', null, LESE],
    ['GET', `/fuhrpark/anlagen/${A}/servicebuch.pdf`, null, LESE],
    ['GET', `/fuhrpark/anlagen/${A}/servicebuch.pdf?kosten=1`, null, KOSTEN_LESE],
    ['GET', '/fuhrpark/fristen', null, PFLEGE],
    ['GET', '/fuhrpark/uebersicht', null, PFLEGE],
    ['GET', '/fuhrpark/export.csv?art=fristen', null, PFLEGE],
    ['GET', '/fuhrpark/export.csv?art=eintraege', null, PFLEGE],
    ['GET', '/fuhrpark/export.csv?art=anlagen', null, PFLEGE],
    ['GET', '/fuhrpark/export.csv?art=eintraege&kosten=1', null, KOSTEN_PFLEGE],
    ['GET', `/fuhrpark/anlagen/${A}/vorlagen-vorschlag`, null, PFLEGE],
    ['POST', '/fuhrpark/anlagen', {}, PFLEGE],
    ['PUT', `/fuhrpark/anlagen/${A}`, {}, PFLEGE],
    ['POST', `/fuhrpark/anlagen/${A}/sperre`, {}, PFLEGE],
    ['POST', `/fuhrpark/anlagen/${A}/ausscheiden`, {}, PFLEGE],
    ['POST', `/fuhrpark/anlagen/${A}/zaehler`, {}, PFLEGE],
    ['PUT', `/fuhrpark/zaehler/${Z}`, {}, PFLEGE],
    ['POST', `/fuhrpark/zaehler/${Z}/tausch`, {}, PFLEGE],
    ['POST', '/fuhrpark/zaehlerstaende', {}, ALLE],
    ['PUT', `/fuhrpark/zaehlerstaende/${ST}`, {}, PFLEGE],
    ['POST', '/fuhrpark/vorlagen', {}, PFLEGE],
    ['PUT', '/fuhrpark/vorlagen/1', {}, PFLEGE],
    ['POST', '/fuhrpark/vorlagen/1/anwenden', { vorschau: true }, PFLEGE],
    ['POST', `/fuhrpark/anlagen/${A}/plan`, {}, PFLEGE],
    ['PUT', `/fuhrpark/anlagen/${A}/plan/${P}`, {}, PFLEGE],
    ['DELETE', `/fuhrpark/anlagen/${A}/plan/999999`, undefined, PFLEGE],
    ['POST', '/fuhrpark/eintraege', {}, PFLEGE],
    ['PUT', `/fuhrpark/eintraege/${E}`, {}, PFLEGE],
    ['POST', `/fuhrpark/eintraege/${E}/storno`, {}, PFLEGE],
    ['POST', '/fuhrpark/maengel', {}, ALLE],
    ['PUT', `/fuhrpark/maengel/${M}`, { status: 'unbekannt' }, PFLEGE],
    ['POST', '/fuhrpark/schaeden', {}, ALLE],
    ['GET', `/fuhrpark/schaeden/${SCH}`, null, ALLE],
    ['GET', `/fuhrpark/schaeden/${SCH}/fotos/${FOTO}`, null, ALLE],
    ['GET', `/fuhrpark/schaeden/${SCH2}`, null, [N, N, N, OK, OK, OK, OK]],
    ['GET', `/fuhrpark/schaeden/${SCH2}/fotos/1`, null, [N, N, N, OK, OK, OK, OK]],
    ['PUT', `/fuhrpark/schaeden/${SCH}`, {}, PFLEGE],
    ['POST', `/fuhrpark/schaeden/${SCH}/fotos`, {}, [OK, N, N, OK, OK, OK, OK]],
    ['POST', `/fuhrpark/schaeden/${SCH2}/fotos`, {}, [N, N, N, OK, OK, OK, OK]],
    ['DELETE', `/fuhrpark/schaeden/${SCH}/fotos/999999`, undefined, PFLEGE]
  ];

  await t.test('Matrix: jede Fuhrpark-Route gegen jede Rolle', async () => {
    for (const [methode, pfad, body, erwartet] of MATRIX) {
      for (let i = 0; i < ROLLEN.length; i++) {
        const r = await c[ROLLEN[i]].anfrage(methode, pfad, body === null ? undefined : body);
        const was = `${ROLLEN[i]} ${methode} ${pfad} → ${r.status} ${JSON.stringify(r.daten).slice(0, 160)}`;
        if (erwartet[i] === N) {
          assert.equal(r.status, 403, was);
          assert.equal(r.daten.code, 'KEIN_ZUGRIFF', was);
        } else {
          assert.ok(r.status !== 403 && r.status !== 401, was);
          assert.ok(r.status < 500, was);
        }
      }
    }
  });

  await t.test('Ohne Anmeldung: 401', async () => {
    for (const p of ['/fuhrpark/anlagen', `/fuhrpark/schaeden/${SCH}/fotos/${FOTO}`]) assert.equal((await s.client().get(p)).status, 401);
  });

  await t.test('Mitarbeiter/Polier (auch mit fuhrpark) erhalten nie €-Felder', async () => {
    const pfade = [
      '/fuhrpark/anlagen', '/fuhrpark/anlagen?inaktiv=1', ...[1, 3, 12, 18, 20, 27].map((id) => `/fuhrpark/anlagen/${id}`), `/fuhrpark/anlagen/${A}/plan`,
      `/fuhrpark/zaehler/${Z}/verlauf`, '/fuhrpark/eintraege', `/fuhrpark/eintraege/${E}`, '/fuhrpark/vorlagen', '/fuhrpark/maengel', '/fuhrpark/schaeden', `/fuhrpark/schaeden/${SCH}`,
      '/fuhrpark/zaehlerabfrage', '/fuhrpark/fristen', '/fuhrpark/uebersicht', '/geraete', '/benachrichtigungen'
    ];
    for (const rolle of ['mitarbeiter', 'polier', 'polierFP', 'mitarbeiterFP']) {
      for (const p of pfade) {
        const r = await c[rolle].get(p);
        if (r.status === 403) continue;
        assert.equal(r.status, 200, `${rolle} ${p}`);
        assert.deepEqual(euroFelder(r.daten), [], `${rolle} ${p} enthält €-Felder`);
        assert.ok(!/"kosten(Jahr|Gesamt|JeStunde)?"\s*:/.test(JSON.stringify(r.daten)), `${rolle} ${p}`);
      }
    }
    // Gegenprobe: Büro sieht Kosten
    const liste = (await c.buero.get('/fuhrpark/anlagen')).daten;
    assert.ok(liste.every((a) => typeof a.kostenJahr === 'number'));
    const det = (await c.buero.get('/fuhrpark/anlagen/20')).daten;
    assert.ok('kostenGesamt' in det && 'verrechnungssatz' in det && 'kostenJeStunde' in det);
    assert.ok((await c.buero.get('/fuhrpark/eintraege')).daten.some((e) => typeof e.kosten === 'number'));
    assert.ok('kostenJahr' in (await c.buero.get('/fuhrpark/uebersicht')).daten);
    // Bauleiter (Leserecht + preise_sehen) sieht Kosten in Einträgen
    assert.ok((await c.bauleiter.get('/fuhrpark/eintraege')).daten.some((e) => typeof e.kosten === 'number'));
  });

  await t.test('CSV und PDF: Standard ohne €, Kosten nur mit Recht', async () => {
    for (const art of ['fristen', 'eintraege', 'anlagen']) {
      const r = await c.polierFP.get(`/fuhrpark/export.csv?art=${art}`);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /text\/csv/);
      const txt = r.daten.toString('utf8');
      assert.ok(txt.startsWith('﻿'));
      assert.ok(!/Kosten/.test(txt) && !/€/.test(txt), art);
      assert.ok(!/Kosten/.test((await c.buero.get(`/fuhrpark/export.csv?art=${art}`)).daten.toString('utf8')), `Büro Standard ohne Kosten ${art}`);
    }
    assert.equal((await c.polierFP.get('/fuhrpark/export.csv?art=eintraege&kosten=1')).status, 403);
    const mit = (await c.buero.get('/fuhrpark/export.csv?art=eintraege&kosten=1')).daten.toString('utf8');
    assert.match(mit, /Kosten netto/);
    const pdf = await c.polier.get(`/fuhrpark/anlagen/20/servicebuch.pdf`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    const text = pdfText(pdf.daten);
    assert.match(text, /Servicebuch: Radlader CASE 721G/);
    assert.ok(!/[€\x80]/.test(text) && !/Kosten netto/.test(text)); // € ist in WinAnsi 0x80
    assert.equal((await c.polier.get('/fuhrpark/anlagen/20/servicebuch.pdf?kosten=1')).status, 403);
    const pdfB = pdfText((await c.buero.get('/fuhrpark/anlagen/20/servicebuch.pdf?kosten=1')).daten);
    assert.match(pdfB, /Kosten netto/);
    assert.match(pdfB, /\x80/);
  });

  await t.test('Polier mit fuhrpark pflegt, darf aber keine Kosten senden', async () => {
    const pfp = c.polierFP;
    const basis = { anlageId: 25, art: 'service', datum: '2026-11-12', werkstatt: 'intern', titel: 'Grundplatte gereinigt', zaehler: [{ art: 'bh', anzeige: 1300 }] };
    const r1 = await pfp.post('/fuhrpark/eintraege', { ...basis, kosten: 120 });
    assert.equal(r1.status, 400);
    assert.match(r1.daten.fehler, /Kosten/);
    const r2 = await pfp.post('/fuhrpark/eintraege', basis);
    assert.equal(r2.status, 201, JSON.stringify(r2.daten));
    assert.ok(!('kosten' in r2.daten));
    const r3 = await pfp.put(`/fuhrpark/eintraege/${r2.daten.id}`, { version: r2.daten.version, kosten: 50 });
    assert.equal(r3.status, 400);
    assert.equal((await pfp.put(`/fuhrpark/eintraege/${r2.daten.id}`, { version: r2.daten.version, arbeiten: 'Ölstand geprüft', kosten: null })).status, 200);
    // Büro darf Kosten nachtragen
    const e = (await c.buero.get(`/fuhrpark/eintraege/${r2.daten.id}`)).daten;
    const r4 = await c.buero.put(`/fuhrpark/eintraege/${e.id}`, { version: e.version, kosten: 75.5 });
    assert.equal(r4.status, 200);
    assert.equal(r4.daten.kosten, 75.5);
    assert.ok(!('kosten' in (await pfp.get(`/fuhrpark/eintraege/${e.id}`)).daten));
    // Protokoll: Betrag unter dem Schlüssel kosten → für Nicht-Preisberechtigte entfernt (GF-Sicht hat ihn)
    const prot = (await gf.get('/rechte')).daten.protokoll.filter((p) => p.art === 'fuhrpark_eintrag');
    assert.ok(prot.some((p) => /75\.5/.test(JSON.stringify(p.neu))));
  });

  await t.test('Ohne Leserecht: Detail ohne Plan/Einträge, nur eigene Mängel', async () => {
    const d = (await c.mitarbeiter.get('/fuhrpark/anlagen/24')).daten;
    assert.equal(d.leserecht, false);
    assert.ok(!('plan' in d) && !('letzteEintraege' in d));
    assert.equal(d.maengel.length, 0); // Mangel A24 hat ein anderer gemeldet
    assert.ok(Array.isArray(d.naechsteTermine) && d.naechsteTermine.length);
    assert.ok((await c.polier.get('/fuhrpark/anlagen/24')).daten.maengel.length >= 1);
  });
});
