'use strict';
/**
 * Korrekturen Rechte-Kontrolle 14.11.2026 – Bautagesbericht und fremde Abwesenheiten (API.md 15.1).
 * Regel 3 des Inhabers: Polier und Mitarbeiter erfahren über den Bericht NICHTS über fremde Abwesenheiten – auch nicht
 * mit jeder vergebbaren Ausnahme, nicht als „abwesend“, nicht als Zählung und nicht über Fehlertexte.
 * Je Befund (F-xxx aus der Rechte-Kontrolle) ein Regressionstest; jeder scheitert ohne die Korrektur.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./rechte-matrix-hilfe');
const { starte, U, BS } = require('./hilfe');
const { winAnsi } = require('../../server/pdf');

const TAG = '2026-11-12'; // Seed: Daniel Schwarz (3, Partie Pitten) U, Elias Woltron (24, BS 6) K, Erwin Pürrer (28, BS 7) U
const DANIEL = 3, ROLAND = 4, MEHMET = 5, FABIAN = 6, KARL = 7, PATRICK = 16, ELIAS = 24, ERWIN = 28, JOHANN = 29; // 7, 16, 29: am 12.11. weder abwesend noch gestempelt
const B14 = 14; // Pitten 11.11.2026 (unterschrieben): Mehmet U, Karl U ohne Stunden
const NEUTRAL = 'Für andere Personen sind im Bericht nur „–“ oder „SW“ möglich – Abwesenheiten trägt das Büro ein.';

const zeile = (z) => ({ benutzerId: z.benutzerId, von1: z.von1 || null, bis1: z.bis1 || null, von2: z.von2 || null, bis2: z.bis2 || null, pauseMin: z.pauseMin || 0, code: z.code || null, segStunden: z.segStunden || 0, ...(z.gast ? { gast: true } : {}) });
const text = (r) => winAnsi(H.pdfText(r.daten));
const name = (db, id) => winAnsi(db.eins('SELECT name FROM benutzer WHERE id = ?', id).name);

test('Bautagesbericht: keine fremden Abwesenheiten für Polier/Mitarbeiter – auch mit Ausnahmen (API.md 15.1)', async (t) => {
  const s = await starte({ test: true, pdfUnkomprimiert: true });
  t.after(() => s.stop());
  const gf = await s.login(U.gf);
  const buero = await s.login(U.buero);
  const pol = await s.login(U.polier);
  // Ausnahmen über die offizielle API (API.md 2: bericht_freigeben für den Polier ausdrücklich vergebbar)
  for (const [id, recht] of [[U.polier, 'bericht_freigeben'], [FABIAN, 'bericht_erstellen'], [FABIAN, 'bericht_freigeben']]) {
    const r = await gf.put('/rechte/ausnahme', { benutzerId: id, recht, wert: true });
    assert.equal(r.status, 200, JSON.stringify(r.daten));
  }
  const ma = await s.login(FABIAN);

  // Entwurf Pitten 12.11.: Polier legt an (Vorschlag aus Stempelungen + Daniel mit U), Büro ergänzt Erwin (fremd, U) als Gast
  // und Roland mit Stunden und ZA (Zeile mit Stunden: Code nur für das Büro)
  s.db.lauf('DELETE FROM bericht WHERE baustelle_id = ? AND datum = ?', BS.pitten, TAG);
  const neu = await pol.post('/berichte', { baustelleId: BS.pitten, datum: TAG });
  assert.equal(neu.status, 201, JSON.stringify(neu.daten));
  const BID = neu.daten.id;
  const b0 = (await buero.get(`/berichte/${BID}`)).daten;
  const personalBuero = [...b0.personal.filter((p) => p.benutzerId !== ROLAND).map(zeile), { benutzerId: ROLAND, von1: '07:00', bis1: '11:00', code: 'ZA' }, { benutzerId: ERWIN, gast: true, code: 'U' }];
  const rb = await buero.put(`/berichte/${BID}`, { version: b0.version, personal: personalBuero });
  assert.equal(rb.status, 200, JSON.stringify(rb.daten));
  const stand = () => s.db.alle('SELECT benutzer_id, code, stunden, gast FROM bericht_personal WHERE bericht_id = ? ORDER BY benutzer_id', BID);
  const STAND0 = stand();
  assert.deepEqual(STAND0.filter((z) => [DANIEL, ROLAND, ERWIN].includes(z.benutzer_id)).map((z) => [z.benutzer_id, z.code, z.gast]), [[DANIEL, 'U', 0], [ROLAND, 'ZA', 0], [ERWIN, 'U', 1]]);
  const ZUSTAND = s.db.alle('SELECT * FROM bericht_personal WHERE bericht_id = ?', BID);
  const VERSION = s.db.eins('SELECT version FROM bericht WHERE id = ?', BID).version;
  /** Bericht auf den Stand nach dem Büro zurücksetzen (jede Probe startet gleich) */
  const zuruecksetzen = () => {
    s.db.lauf('DELETE FROM bericht_personal WHERE bericht_id = ?', BID);
    for (const z of ZUSTAND) {
      const k = Object.keys(z).filter((x) => x !== 'id');
      s.db.lauf(`INSERT INTO bericht_personal (${k.join(', ')}) VALUES (${k.map(() => '?').join(', ')})`, ...k.map((x) => z[x]));
    }
    s.db.lauf("UPDATE bericht SET version = ?, geaendert = '2026-11-12T09:00:00.000Z' WHERE id = ?", VERSION, BID);
  };
  /** Bericht so speichern, wie der Aufrufer ihn bekommen hat (+ optionale Zeilen) */
  const speichere = async (c, extra = [], ohne = []) => {
    const b = (await c.get(`/berichte/${BID}`)).daten;
    return c.put(`/berichte/${BID}`, { version: b.version, personal: [...b.personal.filter((p) => !ohne.includes(p.benutzerId)).map(zeile), ...extra] });
  };

  /** interne/AG-PDF-Fassung: keine verborgenen Abwesenden, keine fremden Kürzel, keine Abwesenheits-Legende */
  function pruefePdf(r, berichtId, ich, wo) {
    assert.equal(r.status, 200, `${wo}: ${r.status}`);
    const tx = text(r);
    assert.ok(/PERSONAL/.test(tx), `${wo}: PDF-Text nicht lesbar`);
    assert.deepEqual(H.berichtPdfAbwesenheitVerstoesse(s.db, berichtId, ich, tx, wo), []);
    return tx;
  }

  await t.test('F-001: Polier mit Ausnahme bericht_freigeben – interne PDF-Fassung zeigt keine fremden Abwesenheiten (U/ZA, „abw.“, Legende)', async () => {
    for (const bid of [B14, BID]) {
      const tx = pruefePdf(await pol.get(`/berichte/${bid}/pdf?fassung=intern`), bid, U.polier, `Polier intern Bericht ${bid}`);
      assert.ok(!/abw\. = abwesend|U = Urlaub|ZA = Zeitausgleich/.test(tx), 'Abwesenheits-Legende');
    }
    // Gegenprobe: das Büro sieht die interne Fassung vollständig (nie K)
    const tb = text(await buero.get(`/berichte/${B14}/pdf?fassung=intern`));
    assert.ok(tb.includes(name(s.db, MEHMET)) && tb.includes(name(s.db, KARL)) && /abw\. = abwesend/.test(tb), 'Büro: interne Fassung vollständig');
  });

  await t.test('F-002/F-005: Mitarbeiter mit Ausnahme bericht_freigeben – interne PDF-Fassung wie für den Polier (nicht wie für das Büro)', async () => {
    for (const bid of [B14, BID, 12, 11]) pruefePdf(await ma.get(`/berichte/${bid}/pdf?fassung=intern`), bid, FABIAN, `Mitarbeiter intern Bericht ${bid}`);
    const mb = await ma.get(`/berichte/${B14}/pdf?fassung=intern`);
    const bb = await buero.get(`/berichte/${B14}/pdf?fassung=intern`);
    assert.notEqual(text(mb), text(bb), 'Mitarbeiter bekommt dieselbe interne Fassung wie das Büro');
  });

  await t.test('F-009: interne Fassung blendet verborgene Abwesende nicht wieder ein; fremde Zeile mit Stunden ohne Kürzel; AG-Fassung, E-Mail und Fern-Ansicht ebenso', async () => {
    for (const [c, ich] of [[pol, U.polier], [ma, FABIAN]]) {
      for (const fassung of ['intern', 'ag']) {
        const tx = pruefePdf(await c.get(`/berichte/${BID}/pdf?fassung=${fassung}&fotos=1`), BID, ich, `${ich} ${fassung}`);
        for (const id of [DANIEL, ERWIN]) assert.ok(!tx.includes(name(s.db, id)), `${ich} ${fassung}: verborgene Person ${id} im PDF`);
        assert.ok(tx.includes(name(s.db, ROLAND)), 'Zeile mit Stunden bleibt (ohne Kürzel)');
        assert.ok(!/\bZA\b/.test(tx), `${ich} ${fassung}: Kürzel ZA im PDF`);
      }
    }
    // E-Mail an den Auftraggeber und Fernunterschrift (AG-Fassung ohne Aufrufer)
    const B = require('../../server/routes/berichte');
    const ag = await B.agPdf(s.app.bt, BID);
    pruefePdf({ status: 200, daten: ag }, BID, -1, 'AG-PDF (E-Mail/Fern)');
    const link = await gf.post(`/berichte/${BID}/unterschrift-link`, { rolle: 'bh', name: 'Bauherr' });
    assert.equal(link.status, 201, JSON.stringify(link.daten));
    const fern = await s.client().get(`/fern/${link.daten.url.split('/').pop()}`);
    assert.equal(fern.status, 200);
    const fj = JSON.stringify(fern.daten);
    for (const id of [DANIEL, ERWIN]) assert.ok(!fj.includes(s.db.eins('SELECT name FROM benutzer WHERE id = ?', id).name), `Fern-Ansicht nennt ${id}`);
    assert.ok(!fern.daten.bericht.personal.some((p) => ['K', 'U', 'ZA', 'abwesend'].includes(p.code)));
    s.db.lauf("UPDATE unterschrift_link SET status = 'ungueltig' WHERE bericht_id = ?", BID);
  });

  await t.test('F-006/F-011: GET /berichte – personalAnzahl zählt verborgene Abwesende nicht (= Länge von Detail-personal[])', async () => {
    for (const [c, wer] of [[pol, 'Polier'], [ma, 'Mitarbeiter'], [await s.login(U.polier2), 'Polier 8']]) {
      const liste = (await c.get('/berichte')).daten;
      assert.ok(liste.length > 3, `${wer}: Liste leer`);
      for (const z of liste) {
        const d = (await c.get(`/berichte/${z.id}`)).daten;
        assert.equal(z.personalAnzahl, d.personal.length, `${wer}: Bericht ${z.id} Liste ${z.personalAnzahl} ≠ Detail ${d.personal.length}`);
      }
    }
    // Büro zählt weiter alle Zeilen
    assert.equal((await buero.get('/berichte?baustelleId=1')).daten.find((z) => z.id === B14).personalAnzahl, 7);
  });

  await t.test('F-003/F-010: Abwesenheits-Orakel über code „abwesend“ – gleiche Antwort für abwesende und anwesende Personen (auch Gäste anderer Baustellen)', async () => {
    for (const [c, ich, paare] of [[pol, U.polier, [[ERWIN, JOHANN], [ELIAS, PATRICK], [DANIEL, KARL]]], [ma, FABIAN, [[ELIAS, PATRICK], [ERWIN, JOHANN]]]]) {
      for (const [abw, anw] of paare) {
        for (const code of ['abwesend', 'K', 'U', 'ZA', 'X']) {
          const antwort = async (id) => {
            zuruecksetzen();
            const vorher = stand();
            const r = await speichere(c, [{ benutzerId: id, code, gast: true }], [id]);
            const unveraendert = JSON.stringify(stand()) === JSON.stringify(vorher);
            return { status: r.status, fehler: r.daten.fehler, unveraendert };
          };
          const a = await antwort(abw);
          const p = await antwort(anw);
          assert.deepEqual(a, p, `${ich}: code „${code}“ für abwesende ${abw} vs. anwesende ${anw}`);
          assert.equal(a.status, 400);
          assert.equal(a.fehler, `personal[${a.fehler.match(/personal\[(\d+)\]/)[1]}].code: ${NEUTRAL}`);
          assert.ok(a.unveraendert, 'DB unverändert nach 400');
        }
      }
    }
    zuruecksetzen();
  });

  await t.test('F-027: Speichern als Polier/Mitarbeiter mit verborgener abwesender Gast-Zeile – kein Name im Fehlertext, Speichern klappt, Zeile bleibt', async () => {
    for (const c of [pol, ma]) {
      zuruecksetzen();
      const r = await speichere(c);
      assert.equal(r.status, 200, JSON.stringify(r.daten));
      assert.ok(!JSON.stringify(r.daten).includes('Pürrer'), 'Name der verborgenen Person in der Antwort');
      assert.deepEqual(stand(), STAND0, 'verborgene Zeilen (Daniel U, Erwin U als Gast) und Rolands ZA bleiben unverändert');
      // auch mit zusätzlich hinzugefügter Person (Gast)
      zuruecksetzen();
      const r2 = await speichere(c, [{ benutzerId: JOHANN, gast: true }]);
      assert.equal(r2.status, 200, JSON.stringify(r2.daten));
      assert.ok(!/Pürrer|Partie/.test(JSON.stringify(r2.daten)));
      assert.equal(s.db.eins('SELECT gast FROM bericht_personal WHERE bericht_id = ? AND benutzer_id = ?', BID, ERWIN).gast, 1);
      // „Personal aus Stempelungen übernehmen“ löscht die verborgene Gast-Zeile des Büros nicht
      zuruecksetzen();
      const pa = await c.post(`/berichte/${BID}/personal-aktualisieren`, { version: VERSION });
      assert.equal(pa.status, 200, JSON.stringify(pa.daten));
      assert.ok(!JSON.stringify(pa.daten).includes('Pürrer'));
      assert.deepEqual(s.db.eins('SELECT code, gast FROM bericht_personal WHERE bericht_id = ? AND benutzer_id = ?', BID, ERWIN), { code: 'U', gast: 1 }, 'verborgene Gast-Zeile beim Aktualisieren verloren');
    }
    zuruecksetzen();
  });

  await t.test('F-028: Polier/Mitarbeiter setzen für andere nur „–“ oder SW – K/U/ZA → neutraler 400, unabhängig vom Abwesenheitsstand', async () => {
    for (const [c, ich] of [[pol, U.polier], [ma, FABIAN]]) {
      for (const code of ['K', 'U', 'ZA']) {
        for (const id of [KARL, DANIEL, ROLAND]) {
          zuruecksetzen();
          const vorher = stand();
          const b = (await c.get(`/berichte/${BID}`)).daten;
          const personal = [...b.personal.filter((p) => p.benutzerId !== id).map(zeile), { benutzerId: id, code }];
          const r = await c.put(`/berichte/${BID}`, { version: b.version, personal });
          assert.equal(r.status, 400, `${ich}: ${code} für ${id} → ${r.status}`);
          assert.equal(r.daten.fehler, `personal[${personal.length - 1}].code: ${NEUTRAL}`);
          assert.deepEqual(stand(), vorher);
        }
      }
      // SW und „–“ bleiben möglich (Schlechtwetter meldet der Polier)
      for (const code of ['SW', '–', '', null]) {
        zuruecksetzen();
        const r = await speichere(c, [{ benutzerId: KARL, code, von1: null }], [KARL]);
        assert.equal(r.status, 200, `${ich}: ${code} → ${r.status} ${JSON.stringify(r.daten)}`);
        assert.equal(r.daten.personal.find((p) => p.benutzerId === KARL).code, code === 'SW' ? 'SW' : null);
      }
      // die eigene Zeile darf der Aufrufer weiter selbst kennzeichnen
      zuruecksetzen();
      const eigen = await speichere(c, [{ benutzerId: ich, code: 'U' }], [ich]);
      assert.equal(eigen.status, 200, JSON.stringify(eigen.daten));
    }
    zuruecksetzen();
  });

  await t.test('Konflikte löst der Server: Zeile für abwesende Person sieht für den Polier aus wie für eine anwesende; nur das Büro wird gewarnt', async () => {
    const normal = (o, id) => JSON.stringify(o).split(s.db.eins('SELECT name FROM benutzer WHERE id = ?', id).name).join('NAME').split(`"benutzerId":${id},`).join('"benutzerId":"X",');
    for (const variante of [{ von1: '07:00', bis1: '12:00' }, { code: 'SW' }, { code: 'SW', von1: '07:00', bis1: '09:00' }, {}]) {
      const ergebnis = {};
      for (const id of [DANIEL, KARL]) { // Daniel: U genehmigt + verborgene Zeile; Karl: an dem Tag nicht abwesend
        zuruecksetzen();
        const r = await speichere(pol, [{ benutzerId: id, ...variante }], [id]);
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        const liste = (await pol.get(`/berichte?baustelleId=${BS.pitten}`)).daten.find((z) => z.id === BID);
        const pdf = text(await pol.get(`/berichte/${BID}/pdf?fassung=intern`));
        ergebnis[id] = { antwort: normal({ ...r.daten, geaendert: null }, id), liste: normal({ ...liste }, id), pdf: pdf.split(name(s.db, id)).join('NAME') };
      }
      assert.deepEqual(ergebnis[DANIEL], ergebnis[KARL], `Variante ${JSON.stringify(variante)}`);
      // Büro sieht den Konflikt (Daniel ist genehmigt im Urlaub)
      zuruecksetzen();
      await speichere(pol, [{ benutzerId: DANIEL, ...variante }], [DANIEL]);
      const bb = (await buero.get(`/berichte/${BID}`)).daten;
      assert.ok(bb.abwesenheitHinweise.some((h) => h.benutzerId === DANIEL), `Büro-Hinweis fehlt (${JSON.stringify(variante)})`);
      if (variante.von1 && !variante.code) assert.equal(s.db.eins('SELECT code FROM bericht_personal WHERE bericht_id = ? AND benutzer_id = ?', BID, DANIEL).code, 'U', 'U des Büros bleibt bei Zeile mit Stunden');
      assert.ok(!('abwesenheitHinweise' in (await pol.get(`/berichte/${BID}`)).daten), 'Polier bekommt keine Abwesenheits-Hinweise');
    }
    zuruecksetzen();
  });

  await t.test('Diktat-Assistent: verborgene abwesende Gast-Zeile ist für den Polier keine bekannte Person', async () => {
    const r = await pol.post('/bericht-assistent/text', { berichtId: BID, text: 'Erwin Pürrer 8 Stunden' });
    const j = (n) => JSON.stringify(n.daten);
    const r2 = await pol.post('/bericht-assistent/text', { berichtId: BID, text: 'Johann Tisch 8 Stunden' });
    assert.equal(r.status, r2.status);
    assert.equal(j(r).replace(/Erwin Pürrer|Pürrer|Erwin/g, 'N'), j(r2).replace(/Johann Tisch|Tisch|Johann/g, 'N'));
  });
});
