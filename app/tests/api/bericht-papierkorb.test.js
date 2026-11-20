'use strict';
/**
 * 15.34: Bautagesbericht löschen mit Papierkorb (Inhaber 19.11.2026).
 * Recht bericht_loeschen (GF/Büro/Bauleiter laut Matrix, nie nach Rollenname), Begründung Pflicht, jeder Status,
 * gelöschte Berichte nirgends mehr (Listen, Zähler, Nachkalkulation, Regie, Monat/Exporte, Servicebuch, PDF, Fern-Link),
 * Wiederherstellen (auch Konflikt mit neuem Bericht), endgültiges Löschen nach 30 Tagen samt Dateien.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { starte, U, BS } = require('./hilfe');
const { demoUnterschrift } = require('../../server/png');
const { testJpeg } = require('./fuhrpark-bilder');

const ROLLEN = ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf'];
const GRUND = 'Doppelt angelegt, richtiger Bericht ist vorhanden';

async function version(c, id) { return (await c.get(`/berichte/${id}`)).daten.version; }
async function loesche(c, id, grund = GRUND) { return c.post(`/berichte/${id}/loeschen`, { grund, version: await version(c, id) }); }
/** Bericht bis zum gewünschten Status bringen (zwei Unterschriften, ggf. Freigabe durch eine zweite Person) */
async function berichtMitStatus(s, c, status, datum, baustelleId = BS.pitten) {
  s.db.lauf('DELETE FROM bericht WHERE baustelle_id = ? AND datum = ?', baustelleId, datum);
  const b = (await c.pol.post('/berichte', { baustelleId, datum })).daten;
  assert.ok(b.id, `Bericht ${datum} angelegt`);
  if (status === 'entwurf') return b.id;
  for (const rolle of ['an', 'bh']) {
    const r = await c.pol.postV(`/berichte/${b.id}/unterschrift`, { rolle, name: rolle === 'an' ? 'Josef Haidbauer' : 'DI Bauherr', bildPng: demoUnterschrift(`${rolle}-${datum}-${baustelleId}`) });
    assert.equal(r.status, 200, JSON.stringify(r.daten));
  }
  if (status === 'freigegeben') assert.equal((await c.buero.post(`/berichte/${b.id}/freigeben`)).status, 200);
  return b.id;
}

test('15.34 Bericht löschen mit Papierkorb', async (t) => {
  const s = await starte({ test: true, url: 'https://bautag.example.at' });
  t.after(() => s.stop());
  const c = {};
  for (const r of ROLLEN) c[r] = await s.login(U[r]);
  c.pol = c.polier;

  await t.test('Rechte: Standard je Rolle – Polier/Mitarbeiter 403 (vor Existenz und Body), Bauleiter = Büro = GF', async () => {
    const id = await berichtMitStatus(s, c, 'entwurf', '2026-11-02');
    for (const r of ['mitarbeiter', 'polier']) {
      assert.equal((await c[r].get('/berichte/papierkorb')).status, 403, r);
      assert.equal((await c[r].post(`/berichte/${id}/loeschen`, { grund: GRUND })).status, 403, r);
      assert.equal((await c[r].post('/berichte/999999/loeschen', {})).status, 403, `${r}: auch für unbekannte ID dieselbe 403`);
      assert.equal((await c[r].post(`/berichte/${id}/wiederherstellen`, {})).status, 403, r);
      assert.ok(!(await c[r].get('/auth/ich')).daten.rechte.includes('bericht_loeschen'));
    }
    for (const r of ['bauleiter', 'buero', 'gf']) {
      assert.equal((await c[r].get('/berichte/papierkorb')).status, 200, r);
      assert.ok((await c[r].get('/auth/ich')).daten.rechte.includes('bericht_loeschen'), r);
    }
    const m = (await c.gf.get('/rechte')).daten;
    assert.ok(m.rechte.some((x) => x.schluessel === 'bericht_loeschen' && x.text === 'Bautagesberichte löschen'), 'in der Rechte-Matrix sichtbar');
    assert.equal(m.matrix.bauleiter.bericht_loeschen, m.matrix.buero.bericht_loeschen);
    assert.ok(!m.gesperrt.polier.includes('bericht_loeschen'), 'für Polier vergebbar (nicht gesperrt)');
    assert.equal((await c.buero.post('/berichte/999999/loeschen', { grund: GRUND, version: 1 })).status, 404);
  });

  await t.test('Rechte-Matrix entscheidet, nicht der Rollenname (Polier erhält, Bauleiter verliert das Recht)', async () => {
    const id = await berichtMitStatus(s, c, 'entwurf', '2026-11-03');
    const fremd = await berichtMitStatus(s, c, 'entwurf', '2026-11-03', BS.reisinger).catch(() => null);
    assert.equal((await c.gf.put('/rechte/matrix', { rolle: 'polier', recht: 'bericht_loeschen', wert: true })).status, 200);
    assert.equal((await c.gf.put('/rechte/matrix', { rolle: 'bauleiter', recht: 'bericht_loeschen', wert: false })).status, 200);
    try {
      assert.equal((await c.bauleiter.get('/berichte/papierkorb')).status, 403);
      assert.equal((await c.bauleiter.post(`/berichte/${id}/loeschen`, { grund: GRUND, version: 1 })).status, 403);
      // Polier: nur Berichte der eigenen Baustellen (Bereich)
      if (fremd) {
        const v3 = (await c.gf.get(`/berichte/${fremd}`)).daten.version;
        assert.equal((await c.pol.post(`/berichte/${fremd}/loeschen`, { grund: GRUND, version: v3 })).status, 403);
      }
      const r = await loesche(c.pol, id);
      assert.equal(r.status, 200, JSON.stringify(r.daten));
      const pk = (await c.pol.get('/berichte/papierkorb')).daten;
      assert.ok(pk.berichte.some((x) => x.id === id));
      assert.ok(pk.berichte.every((x) => x.baustelleId !== BS.reisinger), 'Polier sieht im Papierkorb nur eigene Baustellen');
      assert.equal((await c.pol.post(`/berichte/${id}/wiederherstellen`, {})).status, 200);
    } finally {
      await c.gf.put('/rechte/matrix', { rolle: 'polier', recht: 'bericht_loeschen', wert: false });
      await c.gf.put('/rechte/matrix', { rolle: 'bauleiter', recht: 'bericht_loeschen', wert: true });
    }
    // Ausnahme für eine einzelne Person wirkt ebenso
    assert.equal((await c.gf.put('/rechte/ausnahme', { benutzerId: U.polier, recht: 'bericht_loeschen', wert: true })).status, 200);
    assert.equal((await c.pol.get('/berichte/papierkorb')).status, 200);
    assert.equal((await c.gf.put('/rechte/ausnahme', { benutzerId: U.polier, recht: 'bericht_loeschen', wert: false })).status, 200);
    assert.equal((await c.pol.get('/berichte/papierkorb')).status, 403);
  });

  await t.test('Begründung ist Pflicht (mind. 5 Zeichen), Version wie bei jeder Änderung', async () => {
    const id = await berichtMitStatus(s, c, 'entwurf', '2026-11-04');
    const v = await version(c.buero, id);
    for (const grund of [undefined, '', '   ', 'abc', '  ab  ']) {
      const r = await c.buero.post(`/berichte/${id}/loeschen`, { grund, version: v });
      assert.equal(r.status, 400, `grund ${JSON.stringify(grund)}`);
      assert.match(r.daten.fehler, /begründen/);
    }
    assert.equal((await c.buero.post(`/berichte/${id}/loeschen`, { grund: GRUND })).status, 400, 'ohne version');
    const alt = await c.buero.post(`/berichte/${id}/loeschen`, { grund: GRUND, version: v + 7 });
    assert.equal(alt.status, 409);
    assert.equal(alt.daten.version, v);
    assert.equal((await c.buero.get(`/berichte/${id}`)).status, 200, 'nichts gelöscht');
    assert.equal((await c.buero.post(`/berichte/${id}/loeschen`, { grund: GRUND, version: v })).status, 200);
    assert.equal((await c.buero.post(`/berichte/${id}/loeschen`, { grund: GRUND, version: v + 1 })).status, 404, 'schon gelöscht');
    assert.equal((await c.buero.post(`/berichte/${id}/wiederherstellen`, {})).status, 200);
  });

  await t.test('alle drei Status löschbar; Protokoll mit Grund; Liste, Detail, PDF, Zähler ohne gelöschte', async () => {
    const ids = {
      entwurf: await berichtMitStatus(s, c, 'entwurf', '2026-10-20'),
      unterschrieben: await berichtMitStatus(s, c, 'unterschrieben', '2026-10-21'),
      freigegeben: await berichtMitStatus(s, c, 'freigegeben', '2026-10-22')
    };
    const wer = { entwurf: c.gf, unterschrieben: c.bauleiter, freigegeben: c.buero };
    const vorher = (await c.buero.get('/berichte?status=unterschrieben')).daten.length;
    for (const [st, id] of Object.entries(ids)) {
      assert.equal((await c.buero.get(`/berichte/${id}`)).daten.status, st);
      const r = await loesche(wer[st], id, `Test ${st}: falsche Baustelle`);
      assert.equal(r.status, 200, `${st}: ${JSON.stringify(r.daten)}`);
      assert.equal(new Date(r.daten.endgueltigAm) - new Date(r.daten.geloeschtZeit), 30 * 24 * 3600e3);
      const p = s.db.eins("SELECT * FROM protokoll WHERE objekt = ? AND text LIKE '%gelöscht%' ORDER BY id DESC", `bericht:${id}`);
      assert.ok(p && p.text.includes(`Test ${st}: falsche Baustelle`), 'Protokoll mit Begründung');
      assert.equal(JSON.parse(p.alt).status, st);
    }
    for (const r of ['polier', 'bauleiter', 'buero', 'gf']) {
      const liste = (await c[r].get('/berichte')).daten;
      for (const id of Object.values(ids)) {
        assert.ok(!liste.some((b) => b.id === id), `${r}: gelöschter Bericht ${id} nicht in der Liste`);
        assert.equal((await c[r].get(`/berichte/${id}`)).status, 404);
        assert.equal((await c[r].anfrage('GET', `/berichte/${id}/pdf`)).status, 404);
        assert.equal((await c[r].put(`/berichte/${id}`, { version: 99, arbeitsleistung: 'x' })).status, 404);
      }
    }
    assert.equal((await c.buero.get('/berichte?status=unterschrieben')).daten.length, vorher - 1, 'Übersicht „Zur Freigabe“ zählt ihn nicht mehr');
    const pk = (await c.buero.get('/berichte/papierkorb')).daten;
    for (const [st, id] of Object.entries(ids)) {
      const e = pk.berichte.find((x) => x.id === id);
      assert.ok(e, `${st} im Papierkorb`);
      assert.equal(e.status, st);
      assert.equal(e.kst, '26-041');
      assert.ok(e.geloescht.von && e.geloescht.von.name);
      assert.equal(e.geloescht.grund, `Test ${st}: falsche Baustelle`);
      assert.equal(e.wiederherstellbar, true);
      assert.match(e.endgueltigDatum, /^\d{4}-\d{2}-\d{2}$/);
    }
    assert.equal(pk.fristTage, 30);
    for (const id of Object.values(ids)) assert.equal((await c.gf.post(`/berichte/${id}/wiederherstellen`, {})).status, 200);
  });

  await t.test('Nachkalkulation, Regie, Mengen, Monat/Exporte, Servicebuch: ohne gelöschte – nach Wiederherstellen wie vorher', async () => {
    const id = 10; // Pitten 05.11.2026, freigegeben, mit Regie und Geräten (Testdaten)
    assert.equal(s.db.eins('SELECT status FROM bericht WHERE id = ?', id).status, 'freigegeben');
    assert.ok(s.db.eins('SELECT COUNT(*) AS n FROM bericht_regie WHERE bericht_id = ?', id).n > 0);
    const stand = async () => {
      const k = (await c.gf.get(`/kalkulation/${BS.pitten}`)).daten;
      return {
        kalk: JSON.stringify({ kosten: k.kosten, stunden: k.stunden, erloesRegie: k.erloesRegie, positionen: k.positionen }),
        pos: JSON.stringify((await c.gf.get(`/baustellen/${BS.pitten}/positionen`)).daten),
        monat: JSON.stringify((await c.gf.get('/monat?monat=2026-11')).daten),
        csv: (await c.gf.anfrage('GET', '/monat/export.csv?monat=2026-11')).daten.toString(),
        buak: (await c.gf.anfrage('GET', '/monat/buak.csv?monat=2026-11')).daten.toString(),
        // Servicebuch: Gerätestunden je Anlage aus unterschriebenen/freigegebenen Berichten (fuhrpark-daten.js)
        geraeteBerichte: [...require('../../server/fuhrpark-daten').ladeStand(s.db, '2026-11-12').anlagen.values()].flatMap((A) => A.stunden.map((x) => x.berichtId)).sort((a, b) => a - b)
      };
    };
    const buchungen = s.db.eins('SELECT COUNT(*) AS n, SUM(LENGTH(zeit)) AS z FROM buchung');
    const vorher = await stand();
    const regieVorher = JSON.parse(vorher.kalk).stunden.regie;
    assert.equal((await loesche(c.buero, id, 'Bericht gehört zu einer anderen Baustelle')).status, 200);
    const weg = await stand();
    assert.ok(JSON.parse(weg.kalk).stunden.lohn < JSON.parse(vorher.kalk).stunden.lohn, 'Lohnstunden der Nachkalkulation ohne gelöschten Bericht');
    assert.ok(JSON.parse(weg.kalk).stunden.regie < regieVorher, 'Regiestunden ohne gelöschten Bericht');
    assert.notEqual(weg.pos, vorher.pos, 'Mengen aus Berichten');
    assert.notEqual(weg.monat, vorher.monat, 'Monatsauswertung');
    assert.ok(vorher.geraeteBerichte.includes(id) && !weg.geraeteBerichte.includes(id), 'Gerätestunden im Servicebuch');
    assert.deepEqual(s.db.eins('SELECT COUNT(*) AS n, SUM(LENGTH(zeit)) AS z FROM buchung'), buchungen, 'Stempelzeiten bleiben unverändert');
    const r = await c.buero.post(`/berichte/${id}/wiederherstellen`, {});
    assert.equal(r.status, 200);
    assert.equal(r.daten.status, 'freigegeben');
    assert.equal(r.daten.id, id);
    const wieder = await stand();
    assert.deepEqual(wieder, vorher, 'nach Wiederherstellen alles wie vorher');
    assert.ok(s.db.eins("SELECT 1 AS x FROM protokoll WHERE objekt = ? AND text LIKE '%wiederhergestellt%'", `bericht:${id}`));
  });

  await t.test('Wiederherstellen verweigert (409), solange es einen neuen Bericht für denselben Tag gibt', async () => {
    const id = await berichtMitStatus(s, c, 'unterschrieben', '2026-10-23');
    assert.equal((await loesche(c.gf, id)).status, 200);
    const neu = await c.pol.post('/berichte', { baustelleId: BS.pitten, datum: '2026-10-23' });
    assert.equal(neu.status, 201, 'neuer Bericht für denselben Tag nach dem Löschen möglich');
    assert.notEqual(neu.daten.id, id);
    const e = (await c.gf.get('/berichte/papierkorb')).daten.berichte.find((x) => x.id === id);
    assert.equal(e.wiederherstellbar, false);
    assert.equal(e.neuerBerichtId, neu.daten.id);
    const r = await c.gf.post(`/berichte/${id}/wiederherstellen`, {});
    assert.equal(r.status, 409);
    assert.match(r.daten.fehler, /neuen Bericht/);
    assert.equal(r.daten.id, neu.daten.id);
    // neuen Bericht löschen → alter wiederherstellbar, neuer bleibt im Papierkorb (gleicher Tag zweimal im Papierkorb möglich)
    assert.equal((await loesche(c.gf, neu.daten.id)).status, 200);
    assert.equal((await c.gf.post(`/berichte/${id}/wiederherstellen`, {})).status, 200);
    const pk = (await c.gf.get('/berichte/papierkorb')).daten.berichte;
    assert.equal(pk.find((x) => x.id === neu.daten.id).wiederherstellbar, false);
    assert.equal((await c.gf.post(`/berichte/${id}/wiederherstellen`, {})).status, 404, 'nicht (mehr) im Papierkorb');
    assert.equal((await c.gf.post(`/berichte/${id}/wiederherstellen`, { version: 'x' })).status, 404);
  });

  await t.test('Fernunterschrift-Link wird ungültig und bleibt es nach dem Wiederherstellen', async () => {
    const id = await berichtMitStatus(s, c, 'entwurf', '2026-10-26');
    const l = await c.pol.post(`/berichte/${id}/unterschrift-link`, { rolle: 'bh', name: 'DI Bauherr' });
    assert.equal(l.status, 201);
    const token = l.daten.url.split('/').pop();
    const anon = s.client();
    assert.equal((await anon.get(`/fern/${token}`)).status, 200);
    assert.equal((await loesche(c.buero, id)).status, 200);
    assert.equal((await anon.get(`/fern/${token}`)).status, 410);
    assert.equal(s.db.eins('SELECT status FROM unterschrift_link WHERE id = ?', l.daten.id).status, 'ungueltig');
    assert.equal((await c.buero.post(`/berichte/${id}/wiederherstellen`, {})).status, 200);
    assert.equal((await anon.get(`/fern/${token}`)).status, 410);
    assert.equal((await anon.post(`/fern/${token}`, { name: 'DI Bauherr', bildPng: demoUnterschrift('fern-x'), bestaetigt: true })).status, 410);
  });

  await t.test('Fuhren: beim Löschen wieder Vorschlag ohne Bericht, beim Wiederherstellen wieder übernommen', async () => {
    const id = await berichtMitStatus(s, c, 'entwurf', '2026-10-19');
    const fuhre = s.db.lauf(`INSERT INTO plan_fuhre (datum, anlage_id, material_id, menge, einheit, von, nach, status, erledigt, bericht_status, bericht_id, bericht_menge, erstellt)
      VALUES ('2026-10-19', 4, (SELECT id FROM material ORDER BY id LIMIT 1), 12, 't', '{"art":"text","text":"Kieswerk"}', ?, 'erledigt', '{}', 'uebernommen', ?, 12, '2026-10-19T08:00:00Z')`,
    JSON.stringify({ art: 'baustelle', baustelleId: BS.pitten }), id).id;
    assert.equal((await loesche(c.buero, id)).status, 200);
    assert.deepEqual(s.db.eins('SELECT bericht_status, bericht_id FROM plan_fuhre WHERE id = ?', fuhre), { bericht_status: 'vorschlag', bericht_id: null });
    assert.equal((await c.buero.post(`/berichte/${id}/wiederherstellen`, {})).status, 200);
    assert.deepEqual(s.db.eins('SELECT bericht_status, bericht_id FROM plan_fuhre WHERE id = ?', fuhre), { bericht_status: 'uebernommen', bericht_id: id });
    // neuer Bericht am selben Tag sieht die Fuhre als Vorschlag
    assert.equal((await loesche(c.buero, id)).status, 200);
    const neu = (await c.pol.post('/berichte', { baustelleId: BS.pitten, datum: '2026-10-19' })).daten;
    assert.ok((neu.fuhrenVorschlag || []).some((f) => f.fuhreId === fuhre), 'Fuhre im neuen Bericht vorgeschlagen');
  });

  await t.test('Prüfung 19.11.2026: Wiederherstellen verweigert (409), wenn Personalzeiten inzwischen in einem anderen aktiven Bericht stehen', async () => {
    const datum = '2026-10-13';
    s.db.lauf('DELETE FROM bericht WHERE datum = ?', datum);
    const pers = [{ gast: true, benutzerId: 3, von1: '07:00', bis1: '12:00', von2: '12:30', bis2: '16:00' }];
    const a = (await c.buero.post('/berichte', { baustelleId: BS.pitten, datum })).daten;
    assert.equal((await c.buero.put(`/berichte/${a.id}`, { version: a.version, personal: pers })).status, 200);
    const b = (await c.buero.post('/berichte', { baustelleId: BS.kogler, datum })).daten;
    const vorher = await c.buero.put(`/berichte/${b.id}`, { version: b.version, personal: pers });
    assert.equal(vorher.status, 400, 'Überschneidung wird beim Speichern abgelehnt');
    assert.equal((await loesche(c.buero, a.id)).status, 200);
    assert.equal((await c.buero.put(`/berichte/${b.id}`, { version: await version(c.buero, b.id), personal: pers })).status, 200, 'nach dem Löschen ist die Zeit frei');
    const kstB = s.db.eins('SELECT kst FROM baustelle WHERE id = ?', BS.kogler).kst;
    // Papierkorb kennzeichnet den Eintrag
    const e = (await c.buero.get('/berichte/papierkorb')).daten.berichte.find((x) => x.id === a.id);
    assert.equal(e.wiederherstellbar, false);
    assert.equal(e.hindernis.art, 'ueberschneidung');
    assert.ok(e.hindernis.text.includes('Daniel Schwarz') && e.hindernis.text.includes(kstB), e.hindernis.text);
    assert.equal(e.neuerBerichtId, undefined);
    const r = await c.buero.post(`/berichte/${a.id}/wiederherstellen`, {});
    assert.equal(r.status, 409);
    assert.match(r.daten.fehler, /Daniel Schwarz steht am 13\.10\.2026 inzwischen im Bericht von/);
    assert.equal(r.daten.hindernis, 'ueberschneidung');
    assert.equal(r.daten.ueberschneidungen[0].berichte[0].id, b.id);
    assert.ok(s.db.eins('SELECT geloescht_zeit FROM bericht WHERE id = ?', a.id).geloescht_zeit, 'bleibt im Papierkorb');
    // Polier mit Ausnahme (ohne stammdaten/lohn): neutraler Text ohne fremde Baustelle/Zeiten (15.11 G2-016)
    assert.equal((await c.gf.put('/rechte/ausnahme', { benutzerId: U.polier, recht: 'bericht_loeschen', wert: true })).status, 200);
    try {
      const ep = (await c.pol.get('/berichte/papierkorb')).daten.berichte.find((x) => x.id === a.id);
      assert.equal(ep.wiederherstellbar, false);
      assert.equal(ep.hindernis.art, 'ueberschneidung');
      const rp = await c.pol.post(`/berichte/${a.id}/wiederherstellen`, {});
      assert.equal(rp.status, 409);
      for (const t2 of [ep.hindernis.text, rp.daten.fehler]) {
        assert.match(t2, /Büro/);
        assert.ok(!t2.includes(kstB) && !t2.includes('07:00') && !t2.includes('Daniel'), t2);
      }
      assert.equal(rp.daten.ueberschneidungen, undefined);
    } finally {
      await c.gf.put('/rechte/ausnahme', { benutzerId: U.polier, recht: 'bericht_loeschen', wert: false });
    }
    // Klärung im anderen Bericht (Person dort entfernt) → Wiederherstellen geht
    assert.equal((await c.buero.put(`/berichte/${b.id}`, { version: await version(c.buero, b.id), personal: [] })).status, 200);
    assert.equal((await c.buero.get('/berichte/papierkorb')).daten.berichte.find((x) => x.id === a.id).wiederherstellbar, true);
    assert.equal((await c.buero.post(`/berichte/${a.id}/wiederherstellen`, {})).status, 200);
    const aktiv = s.db.alle('SELECT r.id FROM bericht_personal bp JOIN bericht r ON r.id = bp.bericht_id WHERE bp.benutzer_id = 3 AND r.datum = ? AND r.geloescht_zeit IS NULL', datum);
    assert.deepEqual(aktiv.map((x) => x.id), [a.id], 'die Person steht nur in einem aktiven Bericht');
  });

  await t.test('Prüfung 19.11.2026: bericht_loeschen wirkt nur mit erstellen oder freigeben (kein Lese-Umweg für Mitarbeiter)', async () => {
    const id = await berichtMitStatus(s, c, 'entwurf', '2026-10-12');
    const m = (await c.gf.get('/rechte')).daten.rechte.find((x) => x.schluessel === 'bericht_loeschen');
    assert.match(m.hinweis, /nur zusammen mit/);
    for (const art of ['matrix', 'ausnahme']) {
      const setze = (wert) => (art === 'matrix' ? c.gf.put('/rechte/matrix', { rolle: 'mitarbeiter', recht: 'bericht_loeschen', wert }) : c.gf.put('/rechte/ausnahme', { benutzerId: U.mitarbeiter, recht: 'bericht_loeschen', wert }));
      const gesetzt = await setze(true);
      assert.equal(gesetzt.status, 200, art);
      if (art === 'ausnahme') {
        // Nachprüfung 19.11.2026: keine stille Sackgasse – Antwort und Ausnahmen-Liste sagen, dass die Ausnahme (noch) nicht wirkt
        assert.equal(gesetzt.daten.wirksam, false, 'PUT meldet: ohne Wirkung');
        const r = (await c.gf.get('/rechte')).daten;
        assert.deepEqual(r.voraussetzung.bericht_loeschen, ['bericht_erstellen', 'bericht_freigeben']);
        assert.equal(r.ausnahmen.find((a) => a.benutzerId === U.mitarbeiter && a.recht === 'bericht_loeschen').wirksam, false, 'Liste: ohne Wirkung');
      }
      try {
        assert.ok(!(await c.mitarbeiter.get('/auth/ich')).daten.rechte.includes('bericht_loeschen'), `${art}: nicht wirksam ohne Berichtsrecht`);
        assert.equal((await c.mitarbeiter.get('/berichte/papierkorb')).status, 403, art);
        assert.equal((await c.mitarbeiter.post(`/berichte/${id}/loeschen`, { grund: GRUND, version: await version(c.gf, id) })).status, 403, art);
        assert.equal((await c.gf.post(`/berichte/${id}/loeschen`, { grund: GRUND, version: await version(c.gf, id) })).status, 200);
        const w = await c.mitarbeiter.post(`/berichte/${id}/wiederherstellen`, {});
        assert.equal(w.status, 403, art);
        assert.equal(w.daten.personal, undefined, 'kein Berichtsinhalt');
        assert.ok(s.db.eins('SELECT geloescht_zeit FROM bericht WHERE id = ?', id).geloescht_zeit, 'bleibt gelöscht');
        assert.equal((await c.gf.post(`/berichte/${id}/wiederherstellen`, {})).status, 200);
      } finally { await setze(false); }
    }
    // mit zusätzlichem Berichtsrecht (Ausnahme bericht_erstellen) wirkt es – wie beim Polier
    assert.equal((await c.gf.put('/rechte/ausnahme', { benutzerId: U.mitarbeiter, recht: 'bericht_loeschen', wert: true })).daten.wirksam, false);
    assert.equal((await c.gf.put('/rechte/ausnahme', { benutzerId: U.mitarbeiter, recht: 'bericht_erstellen', wert: true })).daten.wirksam, true);
    try {
      const aus = (await c.gf.get('/rechte')).daten.ausnahmen.filter((a) => a.benutzerId === U.mitarbeiter);
      assert.deepEqual(aus.map((a) => [a.recht, a.wirksam]).sort(), [['bericht_erstellen', true], ['bericht_loeschen', true]], 'mit Berichtsrecht wirkt die Ausnahme');
      assert.ok((await c.mitarbeiter.get('/auth/ich')).daten.rechte.includes('bericht_loeschen'));
      assert.equal((await c.mitarbeiter.get('/berichte/papierkorb')).status, 200);
    } finally {
      await c.gf.put('/rechte/ausnahme', { benutzerId: U.mitarbeiter, recht: 'bericht_loeschen', wert: false });
      await c.gf.put('/rechte/ausnahme', { benutzerId: U.mitarbeiter, recht: 'bericht_erstellen', wert: false });
    }
  });

  await t.test('Prüfung 20.11.2026: Ersteller/Polier erfährt das Löschen (Benachrichtigung, 404 mit Hinweis), andere nur die neutrale 404', async () => {
    const id = await berichtMitStatus(s, c, 'entwurf', '2026-11-12');
    const bs = s.db.eins('SELECT kst, polier_id FROM baustelle WHERE id = ?', BS.pitten);
    assert.equal(bs.polier_id, U.polier);
    const meldungen = async (cl) => (await cl.get('/benachrichtigungen')).daten.filter((n) => n.typ === 'bericht' && /Bautagesbericht (gelöscht|wiederhergestellt)/.test(n.titel) && n.text.includes('12.11.2026'));
    const vorher = (await meldungen(c.pol)).length;
    const v0 = await version(c.pol, id);
    assert.equal((await loesche(c.buero, id, 'Doppelt angelegt, richtiger Bericht ist 26-041.')).status, 200);
    // Benachrichtigung an den Polier (Ersteller + Polier der Baustelle: genau eine), nicht an die löschende Person
    const m = await meldungen(c.pol);
    assert.equal(m.length, vorher + 1, JSON.stringify(m));
    assert.equal(m[0].titel, 'Bautagesbericht gelöscht');
    assert.match(m[0].text, new RegExp(`^Bautagesbericht ${bs.kst} vom 12\\.11\\.2026 wurde von Martina Koller gelöscht – Begründung: Doppelt angelegt, richtiger Bericht ist 26-041\\. Eingaben`));
    assert.equal(m[0].gelesen, false);
    assert.deepEqual(await meldungen(c.buero), [], 'wer löscht, bekommt keine Meldung');
    assert.ok(!(await meldungen(c.mitarbeiter)).length);
    // 404 mit Hinweis für den Polier: Laden, Speichern, Unterschrift, Foto
    const g = await c.pol.get(`/berichte/${id}`);
    assert.equal(g.status, 404);
    assert.equal(g.daten.geloescht, true);
    assert.equal(g.daten.fehler, `Der Bautagesbericht ${bs.kst} vom 12.11.2026 wurde am ${g.daten.geloeschtAm.split('-').reverse().join('.')} gelöscht und kann nicht mehr bearbeitet werden. Bitte im Büro nachfragen.`);
    assert.equal(g.daten.grund, 'Doppelt angelegt, richtiger Bericht ist 26-041.');
    assert.equal(g.daten.personal, undefined, 'kein Berichtsinhalt');
    const p = await c.pol.put(`/berichte/${id}`, { vorkommnisse: 'weitergetippt', version: v0 + 1 });
    assert.equal(p.status, 404); assert.equal(p.daten.geloescht, true);
    const u = await c.pol.postV(`/berichte/${id}/unterschrift`, { rolle: 'an', name: 'Josef Haidbauer', bildPng: demoUnterschrift('an-weg') });
    assert.equal(u.status, 404); assert.equal(u.daten.geloescht, true);
    const f = await c.pol.post(`/berichte/${id}/fotos`, { bildBase64: testJpeg().toString('base64'), dateiname: 'f.jpg' });
    assert.equal(f.status, 404); assert.equal(f.daten.geloescht, true);
    assert.equal(s.db.eins('SELECT vorkommnisse FROM bericht WHERE id = ?', id).vorkommnisse, '', 'nichts gespeichert');
    // außerhalb des Bereichs bzw. unbekannt: neutral wie bisher; ohne Berichtsrecht 403
    const p2 = await s.login(U.polier2);
    const bs2 = s.db.eins('SELECT polier_id FROM baustelle WHERE id = ?', BS.pitten);
    if (bs2.polier_id !== U.polier2) {
      const n2 = await p2.get(`/berichte/${id}`);
      assert.equal(n2.status, 404); assert.equal(n2.daten.fehler, 'Bericht nicht gefunden.'); assert.equal(n2.daten.geloescht, undefined);
    }
    const unbek = await c.pol.get('/berichte/999999');
    assert.equal(unbek.status, 404); assert.equal(unbek.daten.geloescht, undefined); assert.equal(unbek.daten.fehler, 'Bericht nicht gefunden.');
    assert.equal((await c.mitarbeiter.get(`/berichte/${id}`)).status, 403);
    // Wiederherstellen: Lösch-Meldung gelesen, neue Meldung „wiederhergestellt“
    assert.equal((await c.buero.post(`/berichte/${id}/wiederherstellen`, {})).status, 200);
    const m2 = await meldungen(c.pol);
    assert.equal(m2[0].titel, 'Bautagesbericht wiederhergestellt');
    assert.match(m2[0].text, /wieder in der Liste/);
    assert.equal(m2.find((x) => x.titel === 'Bautagesbericht gelöscht' && x.text.includes('26-041.')).gelesen, true);
    assert.equal((await c.pol.get(`/berichte/${id}`)).status, 200);
    // Begründung mit Geldwörtern: Polier bekommt sie weder in der Meldung noch in der 404, das Büro schon
    assert.equal((await loesche(c.gf, id, 'Falscher Preis beim Material, neu anlegen')).status, 200);
    const m3 = (await meldungen(c.pol))[0];
    assert.equal(m3.titel, 'Bautagesbericht gelöscht');
    assert.match(m3.text, /wurde von Michael Pichler gelöscht\. Eingaben/);
    assert.ok(!/Preis/.test(m3.text), m3.text);
    const g3 = await c.pol.get(`/berichte/${id}`);
    assert.equal(g3.status, 404); assert.equal(g3.daten.geloescht, true); assert.equal(g3.daten.grund, undefined);
    assert.ok(!/Preis/.test(JSON.stringify(g3.daten)));
    assert.equal((await c.buero.get(`/berichte/${id}`)).daten.grund, 'Falscher Preis beim Material, neu anlegen');
    assert.equal((await c.gf.post(`/berichte/${id}/wiederherstellen`, {})).status, 200);
  });

  await t.test('nach 30 Tagen endgültig gelöscht – samt Fotodateien, Unterschriften, Zeilen und Links; vorher nicht', async () => {
    const id = await berichtMitStatus(s, c, 'entwurf', '2026-10-16');
    const foto = await c.pol.post(`/berichte/${id}/fotos`, { bildBase64: testJpeg().toString('base64'), dateiname: 'f.jpg' });
    assert.equal(foto.status, 201);
    const datei = path.join(s.app.bt.uploads, 'berichte', s.db.eins('SELECT datei FROM bericht_foto WHERE id = ?', foto.daten.id).datei);
    assert.ok(fs.existsSync(datei));
    await c.pol.post(`/berichte/${id}/unterschrift-link`, { rolle: 'bh', name: 'DI Bauherr' });
    assert.equal((await c.pol.postV(`/berichte/${id}/unterschrift`, { rolle: 'an', name: 'Josef Haidbauer', bildPng: demoUnterschrift('an-purge') })).status, 200);
    const buchungen = s.db.eins('SELECT COUNT(*) AS n FROM buchung').n;
    const start = s.uhr().toISOString();
    assert.equal((await loesche(c.gf, id, 'Testbericht, nie gebraucht')).status, 200);
    const zaehle = () => ['bericht_personal', 'bericht_geraet', 'bericht_material', 'bericht_regie', 'unterschrift', 'bericht_foto', 'unterschrift_link', 'bericht_sicht']
      .reduce((a, tab) => a + s.db.eins(`SELECT COUNT(*) AS n FROM ${tab} WHERE bericht_id = ?`, id).n, 0);
    assert.ok(zaehle() > 0);
    s.uhr.setze(new Date(new Date(start).getTime() + 29 * 24 * 3600e3).toISOString());
    c.gf = await s.login(U.gf); // Sitzung nach dem Uhrsprung neu
    await c.gf.post('/test/stuendlich', {});
    assert.ok(s.db.eins('SELECT 1 AS x FROM bericht WHERE id = ?', id), 'nach 29 Tagen noch im Papierkorb');
    assert.ok((await c.gf.get('/berichte/papierkorb')).daten.berichte.some((x) => x.id === id));
    s.uhr.setze(new Date(new Date(start).getTime() + 30 * 24 * 3600e3 + 1000).toISOString());
    c.gf = await s.login(U.gf);
    // abgelaufen, aber der Lauf war noch nicht: nicht mehr in der Liste, Wiederherstellen verweigert
    assert.ok(!(await c.gf.get('/berichte/papierkorb')).daten.berichte.some((x) => x.id === id));
    assert.equal((await c.gf.post(`/berichte/${id}/wiederherstellen`, {})).status, 409);
    await c.gf.post('/test/stuendlich', {});
    assert.equal(s.db.eins('SELECT 1 AS x FROM bericht WHERE id = ?', id), null, 'Bericht endgültig gelöscht');
    assert.equal(zaehle(), 0, 'Personal, Geräte, Material, Regie, Unterschriften, Fotos, Links, Sichtstand gelöscht');
    assert.equal(fs.existsSync(datei), false, 'Fotodatei gelöscht');
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM buchung').n, buchungen, 'Stempelzeiten bleiben');
    assert.ok(s.db.eins("SELECT 1 AS x FROM protokoll WHERE objekt = ? AND text LIKE '%endgültig gelöscht%'", `bericht:${id}`));
    assert.equal((await c.gf.post(`/berichte/${id}/wiederherstellen`, {})).status, 404);
    s.uhr.setze(start);
  });
});

test('15.34 Migration 56: Bestand bleibt erhalten, ein Bericht je Tag nur unter den nicht gelöschten', () => {
  const os = require('node:os');
  const { oeffneDatenbank } = require('../../server/db');
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'bautag-m56-'));
  try {
    const datei = path.join(ordner, 'a.db');
    const alt = oeffneDatenbank(datei, { bisVersion: 55 });
    // Bestand wie vor 15.34 (Testdaten mit dem damaligen Schema: Baustelle, Person, zwei Berichte mit Kindzeilen, Matrix)
    // Pflichtspalten ohne Vorgabe mit einfachen Werten füllen (Schema-Stand 55)
    const zeile = (tab, werte) => {
      const w = { ...werte };
      for (const c of alt.alle(`PRAGMA table_info(${tab})`)) if (c.notnull && c.dflt_value == null && !c.pk && !(c.name in w)) w[c.name] = /INT|REAL/i.test(c.type) ? 0 : 'x';
      alt.lauf(`INSERT INTO ${tab} (${Object.keys(w).join(', ')}) VALUES (${Object.keys(w).map(() => '?').join(', ')})`, ...Object.values(w));
    };
    zeile('baustelle', { id: 1, kst: '26-041', name: 'Pitten', status: 'aktiv' });
    zeile('benutzer', { id: 1, pnr: '1', name: 'Polier', rolle: 'polier', aktiv: 1 });
    zeile('geraet', { id: 1, code: 'b9', name: 'Bagger' });
    zeile('material', { id: 1, code: 'kies', name: 'Kies', einheit: 't' });
    for (const [id, datum, status] of [[1, '2026-11-10', 'freigegeben'], [2, '2026-11-11', 'unterschrieben']]) {
      zeile('bericht', { id, baustelle_id: 1, datum, status });
      zeile('bericht_personal', { bericht_id: id, benutzer_id: 1, von1: '07:00', bis1: '16:00', stunden: 8.5 });
      zeile('bericht_geraet', { bericht_id: id, geraet_id: 1, stunden: 4 });
      zeile('bericht_material', { bericht_id: id, material_id: 1, menge: 12 });
      zeile('bericht_regie', { bericht_id: id, text: 'Regie', stunden: 2 });
      zeile('unterschrift', { bericht_id: id, rolle: 'an', name: 'A', zeit: 'x' });
    }
    for (const [rolle, recht] of [['buero', 'zeit_eigen'], ['buero', 'bericht_freigeben'], ['bauleiter', 'bericht_freigeben'], ['gf', 'benutzer']]) alt.lauf('INSERT INTO rolle_recht (rolle, recht, wert) VALUES (?, ?, 1)', rolle, recht);
    const zaehle = (d) => ['bericht', 'bericht_personal', 'bericht_geraet', 'bericht_material', 'bericht_regie', 'unterschrift'].map((tab) => d.eins(`SELECT COUNT(*) AS n FROM ${tab}`).n);
    const vorher = zaehle(alt);
    const b = alt.eins('SELECT id, baustelle_id, datum FROM bericht ORDER BY id LIMIT 1');
    alt.schliessen();
    const db = oeffneDatenbank(datei);
    try {
      assert.deepEqual(zaehle(db), vorher, 'keine Zeile verloren (Fremdschlüssel während des Neuaufbaus aus)');
      assert.equal(db.eins('PRAGMA foreign_keys').foreign_keys, 1);
      assert.deepEqual(db.alle('PRAGMA foreign_key_check'), []);
      assert.ok(db.eins("SELECT 1 AS x FROM rolle_recht WHERE rolle = 'bauleiter' AND recht = 'bericht_loeschen' AND wert = 1"));
      assert.equal(db.eins("SELECT 1 AS x FROM rolle_recht WHERE rolle = 'polier' AND recht = 'bericht_loeschen'"), null);
      assert.throws(() => db.lauf("INSERT INTO bericht (baustelle_id, datum, erstellt, geaendert) VALUES (?, ?, 'x', 'x')", b.baustelle_id, b.datum), /UNIQUE/);
      db.lauf("UPDATE bericht SET geloescht_zeit = '2026-11-12T00:00:00Z', geloescht_grund = 'Test' WHERE id = ?", b.id);
      db.lauf("INSERT INTO bericht (baustelle_id, datum, erstellt, geaendert) VALUES (?, ?, 'x', 'x')", b.baustelle_id, b.datum);
      assert.throws(() => db.lauf('UPDATE bericht SET geloescht_zeit = NULL, geloescht_grund = NULL WHERE id = ?', b.id), /UNIQUE/);
      assert.throws(() => db.lauf("UPDATE bericht SET geloescht_zeit = '2026-11-12T00:00:00Z' WHERE id = (SELECT MAX(id) FROM bericht)"), /CHECK/, 'Löschen nur mit Grund');
    } finally { db.schliessen(); }
  } finally { fs.rmSync(ordner, { recursive: true, force: true }); }
});
