'use strict';
/**
 * N-105: Kategoriewechsel per PUT …/dokumente/:did und die Sicht des Poliers auf bestehende Dokumente
 * nach jedem Kategorie- oder Rechtewechsel (API.md 12.16): Liste, Suche, Einzelabruf und /datei?version=N aller Versionen.
 * Bauleiter = Büro (Inhaber 13.11.2026) – kein eigener Bauleiter-Fall.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');

const PDF = (n = '') => Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R ${n}>> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`, 'latin1').toString('base64');

test('Projektdokumente: Verschieben und Sicht des Poliers nach Kategorie-/Rechtewechsel', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const c = {};
  for (const r of ['mitarbeiter', 'polier', 'polier2', 'buero', 'gf']) c[r] = await s.login(U[r]);
  const url = `/baustellen/${BS.pitten}/dokumente`;
  const kategorie = (id) => s.db.eins('SELECT kategorie FROM dokument WHERE id = ?', id).kategorie;

  /** Was sieht ein Polier von einem Dokument? Alle Kanäle müssen dasselbe sagen. */
  async function sicht(wer, d) {
    const liste = await c[wer].get(url);
    const suche = await c[wer].get(`/dokumente/suche?q=${encodeURIComponent(d.titel)}`);
    const einzel = await c[wer].get(`${url}/${d.id}`);
    const dateien = [];
    for (let nr = 1; nr <= 2; nr++) dateien.push((await c[wer].anfrage('GET', `${url}/${d.id}/datei?version=${nr}`)).status);
    dateien.push((await c[wer].anfrage('GET', `${url}/${d.id}/datei`)).status);
    return {
      liste: liste.status === 200 && liste.daten.some((x) => x.id === d.id),
      suche: suche.status === 200 && suche.daten.some((x) => x.id === d.id),
      einzel: einzel.status,
      dateien,
    };
  }
  const SICHTBAR = { liste: true, suche: true, einzel: 200, dateien: [200, 200, 200] };
  const UNSICHTBAR = { liste: false, suche: false, einzel: 403, dateien: [403, 403, 403] };
  const FREMD = { liste: false, suche: false, einzel: 403, dateien: [403, 403, 403] };

  // Ausgangslage: Dokument in „Sonstiges“ (nicht polierlesbar) und eine eigene polierlesbare Kategorie, je mit zwei Versionen
  let r = await c.gf.post('/dokument-kategorien', { name: 'Absteckung', polierLesen: true });
  assert.equal(r.status, 201);
  assert.deepEqual([r.daten.schluessel, r.daten.finanziell, r.daten.polier], ['absteckung', false, true]);
  const neu = async (kat, titel) => {
    const x = await c.buero.post(url, { kategorie: kat, titel, dateiBase64: PDF(), dateiname: `${titel}.pdf` });
    assert.equal(x.status, 201, JSON.stringify(x.daten));
    assert.equal((await c.buero.post(`${url}/${x.daten.id}/versionen`, { dateiBase64: PDF('/Lang (de) '), dateiname: `${titel}_v2.pdf` })).status, 201);
    return x.daten;
  };
  const sonst = await neu('sonstiges', 'Baubesprechung Protokoll');
  const abst = await neu('absteckung', 'Absteckplan Achse 3');
  assert.deepEqual(await sicht('polier', sonst), UNSICHTBAR);
  assert.deepEqual(await sicht('polier', abst), SICHTBAR);
  assert.deepEqual(await sicht('polier2', abst), FREMD); // Polier einer anderen Partie
  assert.equal((await c.mitarbeiter.get(`${url}/${abst.id}`)).status, 403);

  await t.test('Polier darf nicht verschieben – weder lesbare noch unsichtbare Dokumente (403, nichts geändert)', async () => {
    for (const [d, ziel] of [[abst, 'fotos'], [abst, 'sonstiges'], [abst, 'angebot'], [sonst, 'fotos'], [sonst, 'plaene']]) {
      const vorher = kategorie(d.id);
      const x = await c.polier.put(`${url}/${d.id}`, { kategorie: ziel });
      assert.equal(x.status, 403, `${d.titel} → ${ziel}`);
      assert.equal(kategorie(d.id), vorher);
    }
    assert.equal((await c.polier.put(`${url}/${abst.id}`, { titel: 'Umbenannt' })).status, 403);
    assert.equal((await c.mitarbeiter.put(`${url}/${abst.id}`, { kategorie: 'fotos' })).status, 403);
    assert.equal(kategorie(sonst.id), 'sonstiges');
    assert.equal(kategorie(abst.id), 'absteckung');
  });

  await t.test('Büro verschiebt: Sicht des Poliers folgt der Zielkategorie über alle Kanäle und Versionen', async () => {
    const schiebe = async (d, ziel) => { const x = await c.buero.put(`${url}/${d.id}`, { kategorie: ziel }); assert.equal(x.status, 200, JSON.stringify(x.daten)); assert.equal(x.daten.kategorie, ziel); };
    await schiebe(sonst, 'fotos');
    assert.deepEqual(await sicht('polier', sonst), SICHTBAR);
    assert.deepEqual(await sicht('polier2', sonst), FREMD);
    await schiebe(sonst, 'sonstiges');
    assert.deepEqual(await sicht('polier', sonst), UNSICHTBAR);
    // in eine finanzielle Kategorie: weg für den Polier (auch alte Versionen)
    await schiebe(abst, 'angebot');
    assert.deepEqual(await sicht('polier', abst), UNSICHTBAR);
    assert.equal((await c.polier.get('/dokumente/suche?q=Absteckplan')).daten.length, 0);
    assert.ok(s.db.eins("SELECT 1 AS x FROM protokoll WHERE art = 'dokument' AND objekt = ? AND text LIKE '%geändert'", `dokument:${abst.id}`));
  });

  await t.test('ohne preise_sehen: in eine finanzielle Kategorie verschieben → 403 „In diese Kategorie dürfen Sie nicht verschieben.“', async () => {
    s.db.lauf("UPDATE rolle_recht SET wert = 0 WHERE rolle = 'buero' AND recht = 'preise_sehen'");
    try {
      const b2 = await s.login(U.buero);
      for (const ziel of ['angebot', 'auftrag', 'lv', 'ausgangsrechnungen', 'eingangsrechnungen']) {
        const x = await b2.put(`${url}/${sonst.id}`, { kategorie: ziel });
        assert.deepEqual([x.status, x.daten.fehler], [403, 'In diese Kategorie dürfen Sie nicht verschieben.'], ziel);
        assert.equal(kategorie(sonst.id), 'sonstiges');
      }
      // das Angebot selbst ist ohne preise_sehen gar nicht sichtbar
      assert.equal((await b2.put(`${url}/${abst.id}`, { kategorie: 'sonstiges' })).status, 403);
      assert.equal(kategorie(abst.id), 'angebot');
    } finally { s.db.lauf("UPDATE rolle_recht SET wert = 1 WHERE rolle = 'buero' AND recht = 'preise_sehen'"); }
  });

  await t.test('Rechte der Kategorie umstellen (GF): Polier sieht bestehende Dokumente nur, solange die Kategorie polierlesbar ist', async () => {
    const d = await neu('absteckung', 'Höhenplan Zufahrt');
    assert.deepEqual(await sicht('polier', d), SICHTBAR);
    const stelle = async (body, erwartet) => {
      const x = await c.gf.put('/dokument-kategorien/absteckung', body);
      assert.equal(x.status, 200, JSON.stringify(x.daten));
      assert.deepEqual([x.daten.finanziell, x.daten.polier], erwartet);
    };
    await stelle({ polierLesen: false }, [false, false]);
    assert.deepEqual(await sicht('polier', d), UNSICHTBAR);
    assert.ok(!(await c.polier.get('/dokument-kategorien')).daten.find((k) => k.schluessel === 'absteckung').polier);
    await stelle({ polierLesen: true }, [false, true]);
    assert.deepEqual(await sicht('polier', d), SICHTBAR);
    // „enthält Preise“ erzwingt polier:false – alle Versionen sofort gesperrt
    await stelle({ enthaeltPreise: true }, [true, false]);
    assert.deepEqual(await sicht('polier', d), UNSICHTBAR);
    // nur der Name ändern ändert keine Sicht
    await stelle({ name: 'Absteckung (mit Preisen)' }, [true, false]);
    assert.deepEqual(await sicht('polier', d), UNSICHTBAR);
    assert.deepEqual(await sicht('polier2', d), FREMD);
    // Büro (mit preise_sehen) sieht weiter alles
    assert.equal((await c.buero.get(`${url}/${d.id}`)).status, 200);
    assert.equal((await c.buero.anfrage('GET', `${url}/${d.id}/datei?version=1`)).status, 200);
  });
});
