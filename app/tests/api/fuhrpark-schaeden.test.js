'use strict';
/**
 * Schäden mit Fotos (API.md 11.9): Meldung, Sperre bei „nicht einsatzfähig“, Status-Ablauf, Idempotenz (clientId),
 * Foto-Prüfung (Magic Bytes, Größe, Polyglot), Entfernen der Metadaten, Ablage, Zugriffsschutz, Pfad-Tricks, Löschen.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { starte, U, BS, euroFelder } = require('./hilfe');
const { testJpeg, testPng, testWebp } = require('./fuhrpark-bilder');
const B = require('../../server/fuhrpark-bild');

const b64 = (buf) => buf.toString('base64');

test('Schäden mit Fotos', async (t) => {
  const s = await starte({ euroSicherheitsnetz: false });
  t.after(() => s.stop());
  const ma = await s.login(U.mitarbeiter); // Partie Pitten
  const ma2 = await s.login(9); // andere Partie (Kogler)
  const pol = await s.login(U.polier); // Polier Pitten
  const pol8 = await s.login(U.polier2); // Polier Kogler
  const bl = await s.login(U.bauleiter);
  const buero = await s.login(U.buero);
  const gf = await s.login(U.gf);
  let schaden;

  await t.test('Meldung mit Foto: einsatzfähig „nein“ sperrt sofort und meldet Fuhrpark/Büro/GF', async () => {
    const r = await ma.post('/fuhrpark/schaeden', {
      clientId: 'offline-0001', anlageId: 30, baustelleId: BS.pitten, zeitpunkt: '2026-11-12T08:15:00+01:00', art: 'unfall',
      ursache: 'Beim Rückwärtsfahren gegen Betonsockel gestoßen, Mulde verbogen', beschreibung: 'Kippmulde lässt sich nicht mehr senken', einsatzfaehig: 'nein',
      fotos: [{ bildBase64: b64(testJpeg()), dateiname: '../../IMG_0001.jpg' }]
    });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    schaden = r.daten;
    assert.equal(schaden.status, 'gemeldet');
    assert.equal(schaden.zeitpunkt, '2026-11-12T07:15:00.000Z');
    assert.equal(schaden.fotos.length, 1);
    assert.equal(schaden.fotos[0].dateiname, 'IMG_0001.jpg');
    assert.equal(schaden.fotos[0].mime, 'image/jpeg');
    assert.equal(schaden.darfFotos, true);
    assert.equal(schaden.darfBearbeiten, false);
    const a = (await ma.get('/fuhrpark/anlagen/30')).daten;
    assert.equal(a.status, 'gesperrt');
    assert.ok(a.sperrGruende.some((g) => g.typ === 'schaden' && g.schadenId === schaden.id));
    assert.equal(a.offeneSchaeden, 1);
    for (const c of [buero, gf]) assert.ok((await c.get('/benachrichtigungen')).daten.some((n) => n.typ === 'fuhrpark' && n.titel === 'Gerät stillgelegt (Schaden): Dumper Wacker DW 30'));
    // Schäden erscheinen nicht unter /maengel
    assert.ok(!(await buero.get('/fuhrpark/maengel')).daten.some((m) => m.id === schaden.id));
    assert.ok(s.db.eins("SELECT 1 AS x FROM protokoll WHERE art = 'fuhrpark_schaden' AND objekt = ?", `schaden:${schaden.id}`));
  });

  await t.test('clientId: Wiederholung liefert dieselbe Meldung, kein Duplikat, keine doppelten Fotos', async () => {
    const r = await ma.post('/fuhrpark/schaeden', { clientId: 'offline-0001', anlageId: 30, art: 'unfall', ursache: 'Beim Rückwärtsfahren gegen Betonsockel gestoßen', einsatzfaehig: 'nein', fotos: [{ bildBase64: b64(testJpeg()) }] });
    assert.equal(r.status, 200);
    assert.equal(r.daten.id, schaden.id);
    assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM mangel WHERE client_id = 'offline-0001'").n, 1);
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM schaden_foto WHERE mangel_id = ?', schaden.id).n, 1);
    // gleiche clientId eines anderen Melders ist eine eigene Meldung
    const r2 = await ma2.post('/fuhrpark/schaeden', { clientId: 'offline-0001', fremdGeraet: 'Leihbagger der Firma Muster', art: 'beschaedigung_dritte', ursache: 'Von Fremdfirma angefahren, Spiegel ab', einsatzfaehig: 'ja' });
    assert.equal(r2.status, 201);
    assert.equal(r2.daten.anlageId, null);
    assert.equal(r2.daten.fremdGeraet, 'Leihbagger der Firma Muster');
  });

  await t.test('Validierung der Meldung', async () => {
    const basis = { anlageId: 29, art: 'defekt', ursache: 'Motor startet nicht mehr', einsatzfaehig: 'eingeschraenkt' };
    for (const [aend, re] of [
      [{ ursache: 'kaputt' }, /ursache/], [{ art: 'diebstahl' }, /art/], [{ einsatzfaehig: 'vielleicht' }, /einsatzfaehig/],
      [{ fremdGeraet: 'Fremdgerät' }, /nicht beides/], [{ anlageId: undefined }, /fremdGeraet/], [{ zeitpunkt: '2026-11-12 08:00' }, /Zeitzone/],
      [{ zeitpunkt: '2025-01-01T08:00:00Z' }, /Jahr/], [{ clientId: 'a/b' }, /clientId/],
      [{ anlageId: 99999 }, /Anlage nicht gefunden/]
    ]) {
      const r = await ma.post('/fuhrpark/schaeden', { ...basis, ...aend });
      assert.equal(r.status, 400, JSON.stringify(aend));
      assert.match(r.daten.fehler, re);
    }
  });

  await t.test('Fotos: JPEG/PNG/WebP, Metadaten entfernt, Zufallsnamen im nicht öffentlichen Ordner', async () => {
    for (const [buf, mime] of [[testPng(), 'image/png'], [testWebp(), 'image/webp']]) {
      const r = await ma.post(`/fuhrpark/schaeden/${schaden.id}/fotos`, { bildBase64: b64(buf), dateiname: `foto.${mime.split('/')[1]}` });
      assert.equal(r.status, 201, JSON.stringify(r.daten));
      assert.equal(r.daten.mime, mime);
    }
    const fotos = s.db.alle('SELECT * FROM schaden_foto WHERE mangel_id = ? ORDER BY id', schaden.id);
    assert.equal(fotos.length, 3);
    const dir = s.app.bt.uploads;
    assert.ok(!path.resolve(dir).startsWith(path.resolve(__dirname, '..', '..', 'public')));
    for (const f of fotos) {
      assert.match(f.datei, /^[0-9a-f]{32}\.(jpg|png|webp)$/);
      const inhalt = fs.readFileSync(path.join(dir, f.datei));
      for (const x of ['Exif', 'GPS', 'xmpmeta', 'Mustermann', '<script', 'tEXt', 'EXIF']) assert.ok(!inhalt.includes(Buffer.from(x, 'latin1')), `${f.mime}: ${x}`);
    }
    // Abruf: richtiger Typ, nosniff, inline, privat
    const g = await ma.get(`/fuhrpark/schaeden/${schaden.id}/fotos/${fotos[0].id}`);
    assert.equal(g.status, 200);
    assert.equal(g.headers.get('content-type'), 'image/jpeg');
    assert.equal(g.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(g.headers.get('content-disposition'), `inline; filename="schaden-${schaden.id}-${fotos[0].id}.jpg"`);
    assert.equal(g.headers.get('cache-control'), 'no-store');
    const bytes = Buffer.from(await (await fetch(`${s.basis}/api/fuhrpark/schaeden/${schaden.id}/fotos/${fotos[0].id}`, { headers: { cookie: ma.cookie } })).arrayBuffer());
    assert.equal(bytes[0], 0xff);
    assert.ok(!bytes.includes(Buffer.from('<script')) && !bytes.includes(Buffer.from('GPS')));
    // nie statisch erreichbar
    assert.equal((await fetch(`${s.basis}/uploads/${fotos[0].datei}`)).status, 404);
    assert.equal((await fetch(`${s.basis}/data/uploads/${fotos[0].datei}`)).status, 404);
  });

  await t.test('Fotos: falsche Magic Bytes, Polyglot, zu groß, zu viele, doppelt', async () => {
    const pfad = `/fuhrpark/schaeden/${schaden.id}/fotos`;
    const gif = await ma.post(pfad, { bildBase64: b64(Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1')), dateiname: 'tarnung.jpg' });
    assert.equal(gif.status, 400);
    assert.match(gif.daten.fehler, /JPEG, PNG oder WebP/);
    const html = await ma.post(pfad, { bildBase64: 'data:image/jpeg;base64,' + b64(Buffer.from('<svg onload=alert(1)>')), dateiname: 'x.jpg' });
    assert.equal(html.status, 400);
    const poly = await ma.post(pfad, { bildBase64: b64(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('<html><script>alert(1)</script></html>')])) });
    assert.equal(poly.status, 400);
    assert.match(poly.daten.fehler, /JPEG-Datei/);
    const gross = await ma.post(pfad, { bildBase64: b64(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(B.MAX_BYTES - 2)])) });
    assert.equal(gross.status, 400);
    assert.match(gross.daten.fehler, /zu groß \(max\. 8 MB\)/);
    const doppelt = await ma.post(pfad, { bildBase64: b64(testPng()) });
    assert.equal(doppelt.status, 200); // gleiches Bild (nach Bereinigung) → bestehendes Foto
    assert.equal((await ma.post(pfad, { bildBase64: b64(testJpeg({ exif: false })) })).status, 200); // gleiches JPEG ohne Metadaten
    // 5 Fotos erreichbar, 6. abgelehnt
    const { pngGrau } = require('../../server/png');
    assert.equal((await ma.post(pfad, { bildBase64: b64(pngGrau(3, 3, new Uint8Array(9).fill(10))) })).status, 201);
    assert.equal((await ma.post(pfad, { bildBase64: b64(pngGrau(3, 3, new Uint8Array(9).fill(20))) })).status, 201);
    const sechs = await ma.post(pfad, { bildBase64: b64(pngGrau(3, 3, new Uint8Array(9).fill(30))) });
    assert.equal(sechs.status, 400);
    assert.match(sechs.daten.fehler, /Höchstens 5 Fotos/);
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM schaden_foto WHERE mangel_id = ?', schaden.id).n, 5);
    assert.equal(fs.readdirSync(s.app.bt.uploads).length, 5); // abgelehnte Fotos hinterlassen keine Dateien
    // Anfrage über 12 MB → 413
    assert.equal((await ma.post(pfad, { bildBase64: 'A'.repeat(13 * 1024 * 1024) })).status, 413);
  });

  await t.test('Zugriff: fremde Meldungen und Fotos → 403, Pfad-Tricks → 400/404', async () => {
    const fid = s.db.eins('SELECT id FROM schaden_foto WHERE mangel_id = ? ORDER BY id LIMIT 1', schaden.id).id;
    const foto = `/fuhrpark/schaeden/${schaden.id}/fotos/${fid}`;
    for (const c of [ma2, pol8]) {
      assert.equal((await c.get(`/fuhrpark/schaeden/${schaden.id}`)).status, 403);
      assert.equal((await c.get(foto)).status, 403);
      assert.equal((await c.post(`/fuhrpark/schaeden/${schaden.id}/fotos`, { bildBase64: b64(testPng()) })).status, 403);
      assert.ok(!(await c.get('/fuhrpark/schaeden')).daten.some((x) => x.id === schaden.id));
    }
    for (const c of [ma, pol, bl, buero, gf]) {
      assert.equal((await c.get(`/fuhrpark/schaeden/${schaden.id}`)).status, 200);
      assert.equal((await c.get(foto)).status, 200);
    }
    // Polier sieht Meldungen seiner Partie, Bauleiter seiner Baustellen – nicht die des anderen Poliers
    assert.ok((await pol8.get('/fuhrpark/schaeden')).daten.some((x) => x.gemeldetVon.id === 9));
    assert.ok(!(await pol.get('/fuhrpark/schaeden')).daten.some((x) => x.gemeldetVon.id === 9));
    for (const p of [`/fuhrpark/schaeden/${schaden.id}/fotos/..%2F..%2Fetc%2Fpasswd`, `/fuhrpark/schaeden/${schaden.id}/fotos/1;rm`, '/fuhrpark/schaeden/..%2F1/fotos/1']) {
      assert.ok([400, 404].includes((await buero.get(p)).status), p);
    }
    // Foto gehört zu einer anderen Meldung → 404
    const andere = s.db.eins("SELECT id FROM mangel WHERE typ = 'schaden' AND id <> ? ORDER BY id LIMIT 1", schaden.id).id;
    assert.equal((await buero.get(`/fuhrpark/schaeden/${andere}/fotos/${fid}`)).status, 404);
  });

  await t.test('Bearbeitung: Status-Ablauf, Kommentar beim Ablehnen, Verknüpfung mit Reparatur, Kosten nur mit Preisrecht', async () => {
    assert.equal((await ma.put(`/fuhrpark/schaeden/${schaden.id}`, { version: schaden.version, status: 'in_bearbeitung' })).status, 403);
    assert.equal((await buero.put(`/fuhrpark/schaeden/${schaden.id}`, { status: 'in_bearbeitung' })).status, 400); // version Pflicht
    const akt = (await buero.get(`/fuhrpark/schaeden/${schaden.id}`)).daten;
    const r1 = await buero.put(`/fuhrpark/schaeden/${schaden.id}`, { version: akt.version, status: 'in_bearbeitung', kommentar: 'Werkstatt beauftragt' });
    assert.equal(r1.status, 200);
    assert.equal(r1.daten.status, 'in_bearbeitung');
    assert.equal((await buero.put(`/fuhrpark/schaeden/${schaden.id}`, { version: akt.version, status: 'behoben' })).status, 409);
    assert.equal((await buero.put(`/fuhrpark/schaeden/${schaden.id}`, { version: r1.daten.version, status: 'gemeldet' })).status, 400);
    // Reparatur erfassen und Schaden darüber beheben
    const d = (await buero.get('/fuhrpark/anlagen/30')).daten;
    const e = await buero.post('/fuhrpark/eintraege', { anlageId: 30, art: 'reparatur', datum: '2026-11-12', werkstatt: 'Fachwerkstatt Muster', titel: 'Mulde gerichtet, Hydraulik geprüft', kosten: 890, zaehler: [{ art: 'bh', anzeige: Math.ceil(d.zaehler[0].aktuell) }], maengelIds: [schaden.id] });
    assert.equal(e.status, 201, JSON.stringify(e.daten));
    const nach = (await ma.get(`/fuhrpark/schaeden/${schaden.id}`)).daten;
    assert.equal(nach.status, 'behoben');
    assert.equal(nach.eintragId, e.daten.id);
    assert.ok(nach.eintrag && !('kosten' in nach.eintrag)); // Mitarbeiter: keine Reparaturkosten
    assert.deepEqual(euroFelder(nach), []);
    assert.equal((await buero.get(`/fuhrpark/schaeden/${schaden.id}`)).daten.eintrag.kosten, 890);
    assert.equal((await ma.get('/fuhrpark/anlagen/30')).daten.status === 'gesperrt', false);
    assert.equal(nach.darfFotos, false); // Meldung geschlossen → Melder ergänzt keine Fotos mehr
    assert.equal((await ma.post(`/fuhrpark/schaeden/${schaden.id}/fotos`, { bildBase64: b64(testPng()) })).status, 403);
    // Ablehnen nur mit Kommentar
    const neu = (await ma.post('/fuhrpark/schaeden', { anlageId: 22, art: 'verschleiss', ursache: 'Abstreifer an der Bandage abgenutzt', einsatzfaehig: 'ja' })).daten;
    assert.equal((await gf.put(`/fuhrpark/schaeden/${neu.id}`, { version: neu.version, status: 'abgelehnt', kommentar: '' })).status, 400);
    const abg = await gf.put(`/fuhrpark/schaeden/${neu.id}`, { version: neu.version, status: 'abgelehnt', kommentar: 'Normaler Verschleiß, Tausch beim nächsten Service' });
    assert.equal(abg.status, 200);
    assert.equal(abg.daten.status, 'abgelehnt');
    assert.equal((await gf.put(`/fuhrpark/schaeden/${neu.id}`, { version: abg.daten.version, eintragId: e.daten.id })).status, 400); // Eintrag anderer Anlage
    // nachträglich „nicht einsatzfähig“ → Sperre + Meldung
    const neu2 = (await ma.post('/fuhrpark/schaeden', { anlageId: 22, art: 'defekt', ursache: 'Vibration fällt immer wieder aus', einsatzfaehig: 'eingeschraenkt' })).daten;
    assert.equal((await ma.get('/fuhrpark/anlagen/22')).daten.status === 'gesperrt', false);
    const g = await buero.put(`/fuhrpark/schaeden/${neu2.id}`, { version: neu2.version, einsatzfaehig: 'nein' });
    assert.equal(g.status, 200);
    assert.equal((await ma.get('/fuhrpark/anlagen/22')).daten.status, 'gesperrt');
  });

  await t.test('Foto löschen: nur Fuhrpark/Büro/GF, protokolliert, Datei entfernt', async () => {
    const f = s.db.eins('SELECT * FROM schaden_foto WHERE mangel_id = ? ORDER BY id DESC LIMIT 1', schaden.id);
    const pfad = `/fuhrpark/schaeden/${schaden.id}/fotos/${f.id}`;
    assert.equal((await ma.del(pfad)).status, 403);
    assert.equal((await pol.del(pfad)).status, 403);
    assert.equal((await buero.del(pfad)).status, 200);
    assert.ok(!fs.existsSync(path.join(s.app.bt.uploads, f.datei)));
    assert.equal((await buero.get(pfad)).status, 404);
    assert.ok(s.db.eins("SELECT 1 AS x FROM protokoll WHERE art = 'fuhrpark_schaden' AND text LIKE ?", `Foto ${f.id} %gelöscht%`));
  });

  await t.test('Übersicht zeigt offene Schäden', async () => {
    const u = (await buero.get('/fuhrpark/uebersicht')).daten;
    assert.ok(u.anzahl.offeneSchaeden >= 2);
    assert.ok(u.offeneSchaeden.every((x) => ['gemeldet', 'in_bearbeitung'].includes(x.status)));
  });
});
