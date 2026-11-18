'use strict';
/**
 * Arbeitszeitmodelle und BUAK-Pflicht je Person (API.md 15.23, Inhaber 17.11.2026).
 * Rechnung (KV Bau unverändert, Büro Mo–Do 8,5/Fr 5 mit dem Beispiel des Inhabers, Regel „nur Woche“, Teilzeit Mehr- vs. Überstunden, Wechsel mitten in der Woche,
 * Feiertage), Rechte (Modelle nur stammdaten, Zuordnung nach den Regeln der Benutzerverwaltung, Bauleiter = Büro,
 * Polier/Mitarbeiter 403 ohne Leck), BUAK-Export nur BUAK-pflichtige Personen, Urlaub BUAK/UrlG nach dem Kennzeichen,
 * Lohn-CSV/BMD mit Mehrstunden, Migration aus der Einstellung 'arbeitszeit'.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');
const AZ = require('../../server/arbeitszeit');
const { wienZuDate, plusTage, wochenbeginn, feiertag, wochentag } = require('../../server/datum');
const { Datenbank } = require('../../server/db');

const PIN = '482915';
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

test('Rechenregel: KV Bau identisch mit der bisherigen Regel (Zufallswochen), Teilzeit, Abschnitte', () => {
  // bisherige Regel (server/auswertung.js vor 15.23): je Kalenderwoche max(Σ Tagesüberschreitungen, Σ Std − Σ Soll, 0)
  const alt = (tage, tagNormal) => {
    const w = new Map();
    for (const t of tage) { const k = wochenbeginn(t.datum); if (!w.has(k)) w.set(k, []); w.get(k).push(t); }
    let u = 0;
    for (const l of w.values()) {
      let taeglich = 0, summe = 0, soll = 0;
      for (const t of l) { const n = feiertag(t.datum) ? 0 : tagNormal[wochentag(t.datum)]; taeglich += Math.max(0, t.stunden - n); summe += t.stunden; soll += n; }
      u += r2(Math.max(taeglich, summe - soll, 0));
    }
    return r2(u);
  };
  const kv = { id: 1, tagNormal: [0, 8, 8, 8, 8, 7, 0], wochenstunden: 39, regel: 'tag_oder_woche', vollzeit: null };
  let zufall = 7;
  const z = () => { zufall = (zufall * 1103515245 + 12345) % 2147483648; return zufall / 2147483648; };
  for (let n = 0; n < 300; n++) {
    const start = plusTage('2026-10-01', Math.floor(z() * 90));
    const tage = Array.from({ length: 1 + Math.floor(z() * 35) }, (_, i) => ({ datum: plusTage(start, i), stunden: z() < 0.3 ? 0 : r2(z() * 12) }));
    const neu = AZ.zeitraum(tage, () => kv);
    assert.equal(neu.ueberstunden, alt(tage, kv.tagNormal), JSON.stringify(tage));
    assert.equal(neu.mehrstunden, 0);
  }
  // Teilzeit 32 (Mo–Do 8) mit Vollzeit 39, nur Woche: 42 Std. → 7 Mehr-, 3 Überstunden
  const tz = { id: 3, tagNormal: [0, 8, 8, 8, 8, 0, 0], wochenstunden: 32, regel: 'woche', vollzeit: 39 };
  const woche = (std, mo = '2026-12-14') => std.map((h, i) => ({ datum: plusTage(mo, i), stunden: h }));
  assert.deepEqual(AZ.zeitraum(woche([9, 9, 9, 9, 6]), () => tz), { ueberstunden: 3, mehrstunden: 7, soll: 32 });
  assert.deepEqual(AZ.zeitraum(woche([8, 8, 8, 8, 4]), () => tz), { ueberstunden: 0, mehrstunden: 4, soll: 32 });
  assert.deepEqual(AZ.zeitraum(woche([8, 8, 8, 8]), () => tz), { ueberstunden: 0, mehrstunden: 0, soll: 32 });
  // Regel „nur Woche“: 10 Std. an einem Tag, Woche unter 39 → keine Überstunden; KV Bau: 2 Überstunden
  const ang = { id: 9, tagNormal: [0, 7.8, 7.8, 7.8, 7.8, 7.8, 0], wochenstunden: 39, regel: 'woche', vollzeit: null };
  assert.equal(AZ.zeitraum(woche([10, 7, 7, 7, 7]), () => ang).ueberstunden, 0);
  assert.equal(AZ.zeitraum(woche([10, 7, 7, 7, 7]), () => kv).ueberstunden, 2);
  // Inhaber 17.11.2026 (Büro): Mo–Do 8,5 Std., Fr 5 Std. normal, alles darüber Überstunden – „am Dienstag 9,5 h sind 1 h Überstunde“
  const buero = { id: 2, tagNormal: [0, 8.5, 8.5, 8.5, 8.5, 5, 0], wochenstunden: 39, regel: 'tag_oder_woche', vollzeit: null };
  assert.equal(AZ.zeitraum(woche([8.5, 9.5, 8.5, 8.5, 5]), () => buero).ueberstunden, 1, 'volle Woche, Dienstag 9,5');
  assert.equal(AZ.zeitraum(woche([0, 9.5]), () => buero).ueberstunden, 1, 'nur Dienstag 9,5');
  assert.equal(AZ.zeitraum(woche([8.5, 9.5, 7, 8.5, 5]), () => buero).ueberstunden, 1, 'Dienstag 9,5, Woche darunter');
  assert.equal(AZ.zeitraum(woche([8.5, 8.5, 8.5, 8.5, 6]), () => buero).ueberstunden, 1, 'Freitag 6');
});

test('Arbeitszeitmodelle und BUAK-Pflicht (15.23)', async (t) => {
  const s = await starte({ start: '2026-12-01T08:00:00.000Z' });
  t.after(() => s.stop());
  const c = {};
  for (const r of ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf']) c[r] = await s.login(U[r]);
  const zahl = (sql, ...p) => s.db.eins(sql, ...p).n;
  const zustand = () => JSON.stringify([s.db.alle('SELECT * FROM arbeitszeitmodell ORDER BY id'), s.db.alle('SELECT * FROM benutzer_arbeitszeitmodell ORDER BY id'), s.db.alle('SELECT id, buak_pflichtig FROM benutzer ORDER BY id')]);
  const neuePerson = async (name, rolle, extra = {}) => {
    const r = await c.gf.post('/benutzer', { name, rolle, pin: PIN, ...extra });
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    s.db.lauf('UPDATE benutzer SET muss_pin_aendern = 0 WHERE id = ?', r.daten.id);
    return r.daten;
  };
  /** Stunden an einem Tag (kommen 07:00, gehen nach h Std.) */
  const arbeite = (uid, datum, h) => {
    if (!h) return;
    const von = wienZuDate(datum, '07:00');
    s.db.lauf("INSERT INTO buchung (benutzer_id, typ, zeit, baustelle_id, quelle, erfasst_von, erfasst) VALUES (?, 'kommen', ?, ?, 'buero', ?, ?)", uid, von.toISOString(), BS.pitten, uid, von.toISOString());
    const bis = new Date(von.getTime() + h * 3600000);
    s.db.lauf("INSERT INTO buchung (benutzer_id, typ, zeit, baustelle_id, quelle, erfasst_von, erfasst) VALUES (?, 'gehen', ?, NULL, 'buero', ?, ?)", uid, bis.toISOString(), uid, bis.toISOString());
  };
  const woche = (uid, mo, stunden) => stunden.forEach((h, i) => arbeite(uid, plusTage(mo, i), h));
  const MODELL_NAMEN = ['Bau-Arbeiter (KV Bau)', 'Büro (Mo–Do 8,5 · Fr 5)', 'Teilzeit 32 Std.'];
  const ohneModell = (r, wo) => { const txt = JSON.stringify(r.daten); for (const n of [...MODELL_NAMEN, 'Teilzeit 30 Std.', 'buakPflichtig', 'arbeitszeitmodell', 'wochenstunden']) assert.ok(!txt.includes(n), `${wo}: ${n} in ${txt.slice(0, 200)}`); };

  await t.test('Grundausstattung: drei Modelle, Vorgabe nach der Rolle, Lesen nur mit stammdaten/lohn/benutzer', async () => {
    const l = (await c.buero.get('/arbeitszeitmodelle')).daten;
    assert.deepEqual(l.map((m) => [m.id, m.name, m.wochenstunden, m.regel, m.vollzeitWochenstunden, m.vorgabe]), [
      [1, 'Bau-Arbeiter (KV Bau)', 39, 'tag_oder_woche', null, 'feld'], [2, 'Büro (Mo–Do 8,5 · Fr 5)', 39, 'tag_oder_woche', null, 'sonst'], [3, 'Teilzeit 32 Std.', 32, 'woche', 39, null]]);
    assert.deepEqual(l[0].stunden, { mo: 8, di: 8, mi: 8, do: 8, fr: 7, sa: 0, so: 0 });
    assert.deepEqual(l[1].stunden, { mo: 8.5, di: 8.5, mi: 8.5, do: 8.5, fr: 5, sa: 0, so: 0 });
    assert.deepEqual(l[2].stunden, { mo: 8, di: 8, mi: 8, do: 8, fr: 0, sa: 0, so: 0 });
    const feld = zahl("SELECT COUNT(*) AS n FROM benutzer WHERE rolle IN ('mitarbeiter','polier')");
    assert.equal(l[0].personen, feld);
    assert.equal(l[1].personen, zahl('SELECT COUNT(*) AS n FROM benutzer') - feld);
    for (const r of ['bauleiter', 'gf']) assert.equal((await c[r].get('/arbeitszeitmodelle')).status, 200, r);
    for (const r of ['mitarbeiter', 'polier']) {
      const x = await c[r].get('/arbeitszeitmodelle?inaktiv=1');
      assert.equal(x.status, 403, r);
      ohneModell(x, r);
    }
    // Benutzerliste: heute gültiges Modell und BUAK-Pflicht (Vorgabe)
    const b = (await c.buero.get('/benutzer')).daten;
    const lukas = b.find((x) => x.id === U.mitarbeiter), martina = b.find((x) => x.id === U.buero);
    assert.deepEqual([lukas.arbeitszeitmodell, lukas.buakPflichtig, lukas.buakPflichtigVorgabe], [1, true, true]);
    assert.deepEqual([martina.arbeitszeitmodell, martina.buakPflichtig], [2, false]);
  });

  await t.test('Modelle pflegen: nur mit stammdaten, Prüfung, Bauleiter = Büro', async () => {
    const vorher = zustand();
    const body = { name: 'Teilzeit 30 Std.', wochenstunden: 30, stunden: { mo: 7.5, di: 7.5, mi: 7.5, do: 7.5 }, regel: 'woche', vollzeitWochenstunden: 39 };
    for (const r of ['mitarbeiter', 'polier']) {
      for (const x of [await c[r].post('/arbeitszeitmodelle', body), await c[r].put('/arbeitszeitmodelle/3', { version: 1, name: 'x' }), await c[r].del('/arbeitszeitmodelle/3')]) { assert.equal(x.status, 403, r); ohneModell(x, r); }
    }
    assert.equal(zustand(), vorher, 'Polier/Mitarbeiter haben nichts verändert');
    // Eingabeprüfung (Büro und Bauleiter gleich)
    const falsch = [
      [{ ...body, stunden: { mo: 8, di: 8, mi: 8, do: 8 } }, 400, /ergeben 32/],
      [{ ...body, vollzeitWochenstunden: 30 }, 400, /größer als die Wochenstunden/],
      [{ ...body, stunden: { ...body.stunden, xx: 1 } }, 400, /unbekannt/],
      [{ ...body, regel: 'gleitzeit' }, 400, /egel/],
      [{ ...body, wochenstunden: 0 }, 400, /Wochenstunden|wochenstunden/],
      [{ ...body, stunden: { mo: 13, di: 7.5, mi: 7.5, do: 2 } }, 400, /12/],
      [{ ...body, name: 'teilzeit 32 std.' }, 409, /gibt es schon/]
    ];
    for (const r of ['buero', 'bauleiter']) {
      for (const [b, st, text] of falsch) { const x = await c[r].post('/arbeitszeitmodelle', b); assert.equal(x.status, st, `${r} ${JSON.stringify(b)} → ${JSON.stringify(x.daten)}`); assert.match(x.daten.fehler, text); }
    }
    assert.equal(zustand(), vorher);
    const a = await c.buero.post('/arbeitszeitmodelle', body);
    assert.equal(a.status, 201, JSON.stringify(a.daten));
    assert.deepEqual([a.daten.wochenstunden, a.daten.stunden.fr, a.daten.vollzeitWochenstunden, a.daten.personen, a.daten.aktiv], [30, 0, 39, 0, true]);
    const b = await c.bauleiter.post('/arbeitszeitmodelle', { ...body, name: 'Teilzeit 20 Std.', wochenstunden: 20, stunden: { mo: 5, di: 5, mi: 5, do: 5 } });
    assert.equal(b.status, 201, 'Bauleiter wie Büro');
    // Ändern: Version, unbenutzt ohne Bestätigung, Deaktivieren/Löschen
    assert.equal((await c.bauleiter.put(`/arbeitszeitmodelle/${b.daten.id}`, { version: 99, name: 'x y' })).status, 409);
    let x = await c.bauleiter.put(`/arbeitszeitmodelle/${b.daten.id}`, { version: 1, wochenstunden: 24, stunden: { mo: 6, di: 6, mi: 6, do: 6 } });
    assert.equal(x.status, 200, JSON.stringify(x.daten));
    assert.equal(x.daten.wochenstunden, 24);
    x = await c.bauleiter.del(`/arbeitszeitmodelle/${b.daten.id}`);
    assert.equal(x.status, 200);
    // Vorgabe-Modelle: nie deaktivieren/löschen; benutzt: Rechenwerte nur mit Bestätigung (rückwirkend)
    for (const r of ['buero', 'bauleiter']) {
      assert.equal((await c[r].put('/arbeitszeitmodelle/1', { version: 1, aktiv: false })).status, 409, r);
      assert.equal((await c[r].del('/arbeitszeitmodelle/2')).status, 409, r);
      x = await c[r].put('/arbeitszeitmodelle/2', { version: 1, wochenstunden: 38.5, stunden: { mo: 7.7, di: 7.7, mi: 7.7, do: 7.7, fr: 7.7 } });
      assert.equal(x.status, 422, r);
      assert.match(x.daten.fehler, /bereits gerechnete Tage/);
    }
    assert.equal((await c.buero.put('/arbeitszeitmodelle/2', { version: 1, name: 'Büro Probe' })).status, 200, 'Name ändern ohne Bestätigung');
    assert.equal((await c.buero.put('/arbeitszeitmodelle/2', { version: 2, name: 'Büro (Mo–Do 8,5 · Fr 5)' })).status, 200);
    assert.equal(s.db.eins('SELECT version FROM arbeitszeitmodell WHERE id = 2').version, 3);
    s.db.lauf('UPDATE arbeitszeitmodell SET version = 1 WHERE id = 2');
    // Teilzeit 30 deaktivieren, kann dann nicht zugeordnet werden; reaktivieren
    x = await c.buero.put(`/arbeitszeitmodelle/${a.daten.id}`, { version: 1, aktiv: false });
    assert.equal(x.status, 200);
    assert.ok(!(await c.buero.get('/arbeitszeitmodelle')).daten.some((m) => m.id === a.daten.id));
    assert.ok((await c.buero.get('/arbeitszeitmodelle?inaktiv=1')).daten.some((m) => m.id === a.daten.id && m.aktiv === false));
    assert.equal((await c.buero.put(`/benutzer/${U.mitarbeiter}`, { arbeitszeitmodell: a.daten.id })).status, 400);
    assert.equal((await c.buero.put(`/arbeitszeitmodelle/${a.daten.id}`, { version: 2, aktiv: true })).status, 200);
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE art = 'arbeitszeitmodell'").n >= 5);
  });

  await t.test('Zuordnung je Person: Regeln der Benutzerverwaltung, Stichtag, Verlauf, kein Leck an Polier/Mitarbeiter', async () => {
    const vorher = zustand();
    const ziel = 3; // Mitarbeiter
    for (const r of ['mitarbeiter', 'polier']) {
      for (const x of [await c[r].put(`/benutzer/${ziel}`, { arbeitszeitmodell: 3 }), await c[r].put(`/benutzer/${ziel}`, { buakPflichtig: false }), await c[r].get(`/benutzer/${ziel}/arbeitszeit-verlauf`), await c[r].get('/benutzer'), await c[r].put(`/benutzer/${U[r]}`, { buakPflichtig: false })]) {
        assert.equal(x.status, 403, `${r} ${JSON.stringify(x.daten)}`);
        ohneModell(x, r);
      }
    }
    // Büro/Bauleiter: nur Polier/Mitarbeiter; nie das eigene Konto; GF alle anderen
    for (const r of ['buero', 'bauleiter']) {
      assert.equal((await c[r].put(`/benutzer/${U.gf}`, { arbeitszeitmodell: 3 })).status, 403, r);
      assert.equal((await c[r].put(`/benutzer/${r === 'buero' ? U.bauleiter : U.buero}`, { buakPflichtig: true })).status, 403, r);
      assert.equal((await c[r].put(`/benutzer/${U[r]}`, { arbeitszeitmodell: 3 })).status, 403, `${r} eigenes Konto`);
    }
    assert.equal((await c.gf.put(`/benutzer/${U.gf}`, { buakPflichtig: true })).status, 403, 'GF eigenes Konto');
    assert.equal(zustand(), vorher);
    // Eingabe: Stichtag nur mit Modell, rückwirkend nur bestätigt, unbekanntes Modell
    assert.equal((await c.buero.put(`/benutzer/${ziel}`, { arbeitszeitmodellGueltigAb: '2027-01-01' })).status, 400);
    let x = await c.buero.put(`/benutzer/${ziel}`, { arbeitszeitmodell: 3, arbeitszeitmodellGueltigAb: '2026-11-01' });
    assert.equal(x.status, 422);
    assert.match(x.daten.fehler, /rückwirkend/);
    assert.equal((await c.buero.put(`/benutzer/${ziel}`, { arbeitszeitmodell: 999 })).status, 400);
    assert.equal((await c.buero.put(`/benutzer/${ziel}`, { arbeitszeitmodell: 3, arbeitszeitmodellGueltigAb: '2026-02-30' })).status, 400);
    assert.equal(zustand(), vorher);
    // künftig (Büro), dann zurücknehmen; Bauleiter gleich
    x = await c.buero.put(`/benutzer/${ziel}`, { arbeitszeitmodell: 3, arbeitszeitmodellGueltigAb: '2027-01-01' });
    assert.equal(x.status, 200, JSON.stringify(x.daten));
    assert.equal(x.daten.arbeitszeitmodell, 1, 'heute gilt noch KV Bau');
    assert.deepEqual(x.daten.arbeitszeitVerlauf.map((v) => [v.arbeitszeitmodellId, v.gueltigAb, v.aktuell, v.kuenftig]), [[1, '2000-01-01', true, false], [3, '2027-01-01', false, true]]);
    const vid = x.daten.arbeitszeitVerlauf[1].id;
    assert.equal((await c.polier.del(`/benutzer/${ziel}/arbeitszeit-verlauf/${vid}`)).status, 403);
    assert.equal((await c.bauleiter.del(`/benutzer/${ziel}/arbeitszeit-verlauf/${vid}`)).status, 200);
    const basis = x.daten.arbeitszeitVerlauf[0].id;
    assert.equal((await c.buero.del(`/benutzer/${ziel}/arbeitszeit-verlauf/${basis}`)).status, 409, 'Vergangenheit nicht löschbar');
    // rückwirkend mit Bestätigung (Bauleiter)
    x = await c.bauleiter.put(`/benutzer/${ziel}`, { arbeitszeitmodell: 2, arbeitszeitmodellGueltigAb: '2026-11-16', arbeitszeitmodellRueckwirkend: true, buakPflichtig: false });
    assert.equal(x.status, 200, JSON.stringify(x.daten));
    assert.deepEqual([x.daten.arbeitszeitmodell, x.daten.buakPflichtig, x.daten.buakPflichtigVorgabe], [2, false, false]);
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE objekt = ? AND text LIKE 'Arbeitszeitmodell%rückwirkend%'", `benutzer:${ziel}`).n === 1);
    const v = (await c.buero.get(`/benutzer/${ziel}/arbeitszeit-verlauf`)).daten;
    assert.deepEqual(v.map((y) => [y.arbeitszeitmodellId, y.gueltigAb]), [[1, '2000-01-01'], [2, '2026-11-16']]);
    // Modell 1 und 2 jetzt benutzt → nicht löschbar; Teilzeit 30 unbenutzt
    // zurück auf Vorgabe (null) für die BUAK-Pflicht
    x = await c.buero.put(`/benutzer/${ziel}`, { buakPflichtig: null });
    assert.deepEqual([x.daten.buakPflichtig, x.daten.buakPflichtigVorgabe], [true, true]);
    // GF darf Büro-Konten zuordnen
    assert.equal((await c.gf.put(`/benutzer/${U.buero}`, { arbeitszeitmodell: 3, arbeitszeitmodellGueltigAb: '2027-02-01' })).status, 200);
    // Rollenwechsel schreibt die bisherige Vorgabe fest (kein rückwirkender Modell- oder BUAK-Wechsel)
    const p = await neuePerson('Rollen Wechsel', 'polier');
    assert.equal(zahl('SELECT COUNT(*) AS n FROM benutzer_arbeitszeitmodell WHERE benutzer_id = ?', p.id), 0, 'ohne Angabe: Vorgabe nach der Rolle');
    x = await c.gf.put(`/benutzer/${p.id}`, { rolle: 'buero' });
    assert.equal(x.status, 200, JSON.stringify(x.daten));
    assert.deepEqual([x.daten.arbeitszeitmodell, x.daten.buakPflichtig], [1, true]);
    assert.deepEqual(s.db.alle('SELECT modell_id, gueltig_ab FROM benutzer_arbeitszeitmodell WHERE benutzer_id = ?', p.id), [{ modell_id: 1, gueltig_ab: '2000-01-01' }]);
    // Anlegen mit Modell und BUAK-Kennzeichen (Büro: nur Mitarbeiter/Polier)
    const n = await c.buero.post('/benutzer', { name: 'Neu Teilzeit', rolle: 'mitarbeiter', pin: PIN, arbeitszeitmodell: 3, buakPflichtig: false });
    assert.equal(n.status, 201, JSON.stringify(n.daten));
    assert.deepEqual([n.daten.arbeitszeitmodell, n.daten.buakPflichtig], [3, false]);
    assert.equal((await c.buero.post('/benutzer', { name: 'Neu X', rolle: 'mitarbeiter', pin: PIN, arbeitszeitmodell: 999 })).status, 400);
  });

  await t.test('Rechnung im Monat: KV Bau, Büro (Beispiel Dienstag 9,5 Std.), Teilzeit Mehrstunden, Wechsel mitten in der Woche, Feiertag', async () => {
    const bau = await neuePerson('AZ Bau', 'mitarbeiter');
    const buero = await neuePerson('AZ Büro', 'buero');
    const teil = await neuePerson('AZ Teilzeit', 'mitarbeiter', { arbeitszeitmodell: 3 });
    const wechsel = await neuePerson('AZ Wechsel', 'buero');
    const beispiel = await neuePerson('AZ Beispiel', 'buero');
    // Wechsel Büro → Teilzeit ab Do 17.12. (künftig, ohne Bestätigung)
    assert.equal((await c.gf.put(`/benutzer/${wechsel.id}`, { arbeitszeitmodell: 3, arbeitszeitmodellGueltigAb: '2026-12-17' })).status, 200);
    for (const p of [bau, buero]) {
      woche(p.id, '2026-12-14', [10, 8, 8, 8, 7]); // 41 Std.: KV täglich 2 = wöchentlich 2; Büro täglich 1,5 (Mo) + 2 (Fr) = 3,5
      woche(p.id, '2026-12-21', [9, 9, 9, 9]); // 36 Std. (Fr 25.12. Feiertag): KV täglich 4; Büro täglich 2 = 36 − 34
      woche(p.id, '2026-12-07', [9, 0, 9, 9, 9]); // Di 8.12. Feiertag, 36 Std.: KV max(5, 36 − 31) = 5; Büro max(5,5, 36 − 30,5) = 5,5
    }
    woche(teil.id, '2026-12-14', [9, 9, 9, 9, 6]); // 42 Std.: 10 über 32 → 7 Mehr-, 3 Überstunden
    woche(teil.id, '2026-12-07', [9, 0, 9, 9, 3]); // Feiertag Di: Soll 24, 30 Std. → 6 drüber, davon 24 × 7/32 = 5,25 Mehr, 0,75 Über
    woche(wechsel.id, '2026-12-14', [9, 9, 9, 10, 5]); // Mo–Mi Büro: je 0,5 = 1,5 Üst.; Do–So Teilzeit: Soll 8, 15 Std. → 7 drüber, 8 × 7/32 = 1,75 Mehr, 5,25 Über
    woche(beispiel.id, '2026-12-14', [8.5, 9.5, 8.5, 8.5, 5]); // Inhaber: Dienstag 9,5 Std. = 1 Überstunde
    arbeite(beispiel.id, '2026-12-22', 9.5); // nur Dienstag 9,5 Std. in der Woche = 1 Überstunde
    const m = (await c.buero.get('/monat?monat=2026-12')).daten;
    const p = (x) => m.mitarbeiter.find((y) => y.id === x.id);
    const werte = (x) => { const y = p(x); return [y.summe, y.normal, y.ueberstunden, y.mehrstunden]; };
    assert.deepEqual(werte(bau), [113, 102, 11, 0]);
    assert.deepEqual(werte(buero), [113, 102, 11, 0]);
    assert.deepEqual(werte(beispiel), [49.5, 47.5, 2, 0], 'Beispiel des Inhabers: je Dienstag 9,5 Std. 1 Überstunde');
    assert.deepEqual(p(beispiel).arbeitszeitmodell, { id: 2, name: 'Büro (Mo–Do 8,5 · Fr 5)' });
    assert.deepEqual(werte(teil), [72, 56, 3.75, 12.25]);
    assert.deepEqual(werte(wechsel), [42, 33.5, 6.75, 1.75]);
    assert.deepEqual(p(bau).arbeitszeitmodell, { id: 1, name: 'Bau-Arbeiter (KV Bau)' });
    assert.deepEqual(p(buero).arbeitszeitmodell, { id: 2, name: 'Büro (Mo–Do 8,5 · Fr 5)' });
    assert.equal(p(bau).arbeitszeitmodelle, undefined);
    assert.deepEqual(p(wechsel).arbeitszeitmodelle.map((a) => [a.name, a.von, a.bis, a.stunden]), [['Büro (Mo–Do 8,5 · Fr 5)', '2026-12-01', '2026-12-16', 27], ['Teilzeit 32 Std.', '2026-12-17', '2026-12-31', 15]]);
    assert.equal(p(wechsel).tage['2026-12-14'].arbeitszeitmodell, 'Büro (Mo–Do 8,5 · Fr 5)', 'abweichendes Modell am Tag');
    assert.equal(p(wechsel).tage['2026-12-17'].arbeitszeitmodell, undefined);
    assert.deepEqual([p(bau).buakPflichtig, p(buero).buakPflichtig, p(teil).buakPflichtig], [true, false, true]);
    assert.ok(m.annahmen.modelle.some((x) => x.id === 3 && x.vollzeitWochenstunden === 39));
    assert.match(m.annahmen.hinweis, /Arbeitszeitmodell/);
    for (const y of m.mitarbeiter) assert.equal(r2(y.normal + y.ueberstunden + y.mehrstunden), y.summe, y.name);

    // Meine Woche der Teilzeitkraft: eigenes Soll, Mehr-/Überstunden, kein Modellname
    const ich = await s.login(teil.id, PIN);
    let w = await ich.get('/zeit/woche?datum=2026-12-16');
    assert.equal(w.status, 200);
    assert.deepEqual([w.daten.summe, w.daten.sollStunden, w.daten.ueberstunden, w.daten.mehrstunden], [42, 32, 3, 7]);
    ohneModell(w, 'eigene Woche');
    w = await ich.get('/zeit/woche?datum=2026-12-08');
    assert.deepEqual([w.daten.sollStunden, w.daten.ueberstunden, w.daten.mehrstunden], [24, 0.75, 5.25]);
    const ichW = await s.login(wechsel.id, PIN);
    w = (await ichW.get('/zeit/woche?datum=2026-12-14')).daten;
    assert.deepEqual([w.sollStunden, w.ueberstunden, w.mehrstunden], [33.5, 6.75, 1.75]);
    const ichB = await s.login(beispiel.id, PIN);
    w = (await ichB.get('/zeit/woche?datum=2026-12-22')).daten;
    assert.deepEqual([w.summe, w.sollStunden, w.ueberstunden, w.mehrstunden], [9.5, 34, 1, 0], 'eigene Woche: Dienstag 9,5 Std. = 1 Überstunde');
    // „Meine Woche“-Balken (Inhaber 17.11.2026, Bild: „über 8“ bei Büro): Tages-Soll je Tag aus dem eigenen Modell, nicht fest 8
    assert.deepEqual(w.tage.slice(0, 5).map((t) => t.sollStd), [8.5, 8.5, 8.5, 8.5, 0], 'Büro: Tages-Soll Mo–Do 8,5; Fr 25.12. Feiertag 0');
    assert.deepEqual((await ich.get('/zeit/woche?datum=2026-12-16')).daten.tage.slice(0, 5).map((t) => t.sollStd), [8, 8, 8, 8, 0], 'Teilzeit (Mitarbeiter): Tages-Soll Mo–Do 8, Fr 0');
    assert.equal((await ich.get('/monat?monat=2026-12')).status, 403);

    // Lohn-CSV: Mehrstunden-Spalte; BMD-Vorlage: Lohnart 210 für Mehrstunden; Hinweis zum Modellwechsel
    const csv = (await c.buero.get('/monat/export.csv?monat=2026-12')).daten.toString('utf8');
    const zeile = (pnr) => csv.split('\r\n').find((z) => z.startsWith(`${pnr};`) && z.includes(';2026-12;'));
    assert.match(zeile(teil.pnr), /;72;56;3,75;0;0;0;0;0;0;12,25;Teilzeit 32 Std\.$/);
    assert.match(zeile(bau.pnr), /;113;102;11;0;0;0;0;0;0;0;Bau-Arbeiter \(KV Bau\)$/);
    assert.match(csv, /Hinweis;Arbeitszeitmodell-Wechsel: AZ Wechsel ab 17\.12\.: Büro \(Mo–Do 8,5 · Fr 5\) → Teilzeit 32 Std\./);
    const vl = (await c.buero.get('/lohn-vorlagen')).daten.find((x) => x.id === 'bmd-ntcs');
    assert.equal(vl.lohnarten.mehrstunden, '210');
    const bmd = (await c.buero.get('/monat/export.csv?monat=2026-12&vorlage=bmd-ntcs')).daten.toString('latin1');
    assert.ok(bmd.split('\r\n').includes(`${teil.pnr};2026-12;210;12,25;;26-041`) || bmd.split('\r\n').some((z) => z.startsWith(`${teil.pnr};2026-12;210;12,25;`)), bmd.slice(0, 400));
    assert.ok(bmd.split('\r\n').some((z) => z.startsWith(`${teil.pnr};2026-12;200;3,75;`)));
    assert.ok(!bmd.split('\r\n').some((z) => z.startsWith(`${bau.pnr};2026-12;210;`)), 'ohne Mehrstunden keine Zeile');
    // ältere eigene Vorlage ohne Schlüssel „mehrstunden“ → Vorschlag 210
    s.db.lauf("INSERT INTO lohn_vorlage (id, name, daten, geaendert) VALUES ('alt1', 'Alt', ?, '2026-01-01')", JSON.stringify({ id: 'alt1', name: 'Alt', trennzeichen: ';', kodierung: 'utf-8', dezimal: ',', kopfzeile: false, zeileJe: 'person_lohnart', spalten: [{ feld: 'pnr' }, { feld: 'lohnart' }, { feld: 'stunden' }], lohnarten: { normal: '1', ueberstunden: '2' } }));
    const alt = (await c.buero.get('/monat/export.csv?monat=2026-12&vorlage=alt1')).daten.toString('utf8');
    assert.ok(alt.includes(`${teil.pnr};210;12,25`), alt.slice(0, 300));

    // BUAK-Grundlage: nur BUAK-pflichtige Personen
    const buak = (await c.buero.get('/monat/buak.csv?monat=2026-12')).daten.toString('utf8');
    const pnrs = buak.split('\r\n').map((z) => z.split(';')[0]);
    assert.ok(pnrs.includes(String(bau.pnr)) && pnrs.includes(String(teil.pnr)));
    assert.ok(!pnrs.includes(String(buero.pnr)) && !pnrs.includes(String(wechsel.pnr)), 'Büro-Personen nicht in der BUAK-Grundlage');
    assert.match(buak, /Hinweis;Enthält nur BUAK-pflichtige Personen/);
    // Kennzeichen umstellen: Bau-Arbeiter nicht BUAK-pflichtig, Büro-Person BUAK-pflichtig
    assert.equal((await c.buero.put(`/benutzer/${bau.id}`, { buakPflichtig: false })).status, 200);
    assert.equal((await c.gf.put(`/benutzer/${buero.id}`, { buakPflichtig: true })).status, 200);
    const buak2 = (await c.buero.get('/monat/buak.csv?monat=2026-12')).daten.toString('utf8').split('\r\n').map((z) => z.split(';')[0]);
    assert.ok(!buak2.includes(String(bau.pnr)) && buak2.includes(String(buero.pnr)));
    // Lohn-CSV enthält weiterhin alle
    assert.ok(zeile(bau.pnr) && zeile(buero.pnr));

    // Urlaub: BUAK/UrlG nach dem Kennzeichen (ohne Konto), gespeichertes Konto bleibt
    const konto = async (id) => (await c.buero.get(`/urlaub/konto?jahr=2026&benutzerId=${id}`)).daten[0];
    assert.equal((await konto(bau.id)).art, 'urlg');
    assert.equal((await konto(buero.id)).art, 'buak');
    assert.equal((await konto(teil.id)).art, 'buak');
    assert.equal((await c.buero.put(`/urlaub/konto/${teil.id}/2026`, { anspruch: 20 })).daten.art, 'buak', 'neues Konto: Art nach dem Kennzeichen');
    assert.equal((await c.buero.put(`/benutzer/${teil.id}`, { buakPflichtig: false })).status, 200);
    assert.equal((await konto(teil.id)).art, 'buak', 'gespeichertes Konto bleibt unverändert');
    assert.equal((await konto(U.mitarbeiter)).art, s.db.eins('SELECT art FROM urlaub_konto WHERE benutzer_id = ? AND jahr = 2026', U.mitarbeiter)?.art || 'buak');
  });

  await t.test('Löschen: benutztes Modell nur deaktivieren', async () => {
    const x = await c.buero.del('/arbeitszeitmodelle/3');
    assert.equal(x.status, 409);
    assert.match(x.daten.fehler, /deaktivieren/);
    assert.ok(x.daten.verwendet.personen >= 2);
  });
});

test('Migration: KV-Bau-Modell übernimmt die bisherige Einstellung „arbeitszeit“', () => {
  const db = new Datenbank(':memory:', { bisVersion: 47 });
  db.setzeEinstellung('arbeitszeit', { tagNormal: [0, 9, 9, 9, 9, 3, 0], wocheNormal: 39 });
  db.migrieren();
  const m = db.eins('SELECT * FROM arbeitszeitmodell WHERE id = 1');
  assert.deepEqual([m.name, m.wochenstunden, JSON.parse(m.tag_normal), m.regel], ['Bau-Arbeiter (KV Bau)', 39, [0, 9, 9, 9, 9, 3, 0], 'tag_oder_woche']);
  assert.equal(db.eins('SELECT COUNT(*) AS n FROM arbeitszeitmodell').n, 3);
  // ohne Einstellung: bisherige Standardregel
  const db2 = new Datenbank(':memory:');
  assert.equal(db2.eins('SELECT tag_normal FROM arbeitszeitmodell WHERE id = 1').tag_normal, '[0,8,8,8,8,7,0]');
  db.schliessen && db.schliessen(); db2.schliessen && db2.schliessen();
});
