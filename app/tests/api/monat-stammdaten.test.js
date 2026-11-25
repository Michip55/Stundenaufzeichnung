'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { starte, U, BS } = require('./hilfe');
const { schichten } = require('../../server/stempel');
const { letzteBuchungen } = require('../../server/daten');

/** 15.38: Vorbedingung – die Testdaten enthalten die Fälle der früheren AZG-Hinweise (gleiche Grenzen wie bis 15.37) */
function frueherAzgFaelle(db, benutzerId, jetzt, monat) {
  const sch = schichten(letzteBuchungen(db, benutzerId, 500), jetzt);
  const tage = new Map();
  for (const x of sch) { const t = tage.get(x.datum) || { arbeit: 0, pause: 0 }; t.arbeit += x.arbeitMin; t.pause += x.pauseMin; tage.set(x.datum, t); }
  const imMonat = [...tage].filter(([d]) => d.startsWith(monat)).map(([, t]) => t);
  let ruhe = false;
  for (let i = 1; i < sch.length; i++) {
    const a = sch[i - 1], b = sch[i];
    if (a.offen || a.datum === b.datum || !b.datum.startsWith(monat)) continue;
    const min = (b.start - a.ende) / 60000;
    if (min >= 0 && min < 660) ruhe = true;
  }
  return { ueber10: imMonat.some((t) => t.arbeit > 600), ohnePause: imMonat.some((t) => t.arbeit > 360 && t.pause < 30), ruhe };
}

test('Monatsauswertung, Exporte, Stammdaten, Integrationen', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const buero = await s.login(U.buero);
  const gf = await s.login(U.gf);
  const ma = await s.login(U.mitarbeiter);

  await t.test('GET /monat: Mitarbeiter mit Tagen, Summen, Kürzeln und Warnungen (15.38: ohne AZG-Warnungen)', async () => {
    const r = await buero.get('/monat?monat=2026-11');
    assert.equal(r.status, 200);
    assert.equal(r.daten.monat, '2026-11');
    assert.equal(r.daten.tage.length, 30);
    assert.equal(r.daten.tage.find((x) => x.datum === '2026-11-01').feiertag, 'Allerheiligen');
    const lukas = r.daten.mitarbeiter.find((m) => m.id === U.mitarbeiter);
    for (const f of ['id', 'name', 'tage', 'summe', 'normal', 'ueberstunden', 'sw', 'k', 'u', 'seg']) assert.ok(f in lukas, f);
    assert.ok(lukas.summe > 40);
    assert.equal(lukas.tage['2026-11-03'].code, 'SW');
    assert.equal(lukas.sw, 1);
    assert.equal(Math.round((lukas.normal + lukas.ueberstunden) * 100) / 100, lukas.summe);
    assert.ok(!r.daten.mitarbeiter.some((m) => m.rolle === 'gf'));
    const typen = new Set(r.daten.warnungen.map((w) => `${w.benutzerId}:${w.typ}`));
    // 15.38: gleiche Testdaten (12 langer Tag, 17 ohne Pause, 4 kurze Ruhezeit) – nur „Ausstempeln vergessen?“ bleibt
    assert.ok(frueherAzgFaelle(s.db, 12, s.uhr(), '2026-11').ueber10, 'Vorbedingung: 12 hat im November einen Tag über 10 Std.');
    assert.ok(frueherAzgFaelle(s.db, 17, s.uhr(), '2026-11').ohnePause, 'Vorbedingung: 17 hat im November einen Tag über 6 Std. ohne 30 Min. Pause');
    assert.ok(frueherAzgFaelle(s.db, 4, s.uhr(), '2026-11').ruhe, 'Vorbedingung: 4 hat im November weniger als 11 Std. Ruhezeit');
    for (const weg of ['12:tag_10h', '17:pause', '4:ruhezeit']) assert.ok(!typen.has(weg), weg);
    assert.ok(!r.daten.warnungen.some((w) => ['tag_10h', 'tag_12h', 'pause', 'ruhezeit'].includes(w.typ) || /AZG|Ruhezeit|mehr als 10 Std/.test(w.text)), JSON.stringify(r.daten.warnungen));
    assert.ok(typen.has('27:offen'), '27:offen');
    assert.ok(!JSON.stringify(r.daten).includes('€'));
    assert.equal((await buero.get('/monat?monat=2026-13')).status, 400);
    assert.equal((await buero.get('/monat?monat=11-2026')).status, 400);
    assert.equal((await buero.get('/monat')).daten.monat, '2026-11');
  });

  await t.test('Lohn-Export CSV: Semikolon, UTF-8 mit BOM, Dezimalkomma', async () => {
    const r = await buero.get('/monat/export.csv?monat=2026-11');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^text\/csv; charset=utf-8/);
    assert.match(r.headers.get('content-disposition'), /attachment; filename="BauTag_Lohn_2026-11\.csv"/);
    assert.deepEqual([...r.daten.subarray(0, 3)], [0xef, 0xbb, 0xbf]); // UTF-8-BOM
    const roh = r.daten.toString('utf8');
    assert.equal(roh.charCodeAt(0), 0xfeff);
    const zeilen = roh.slice(1).split('\r\n');
    assert.equal(zeilen[0], 'Personalnummer;Name;Lohngruppe;Datum;Wochentag;Beginn;Ende;Pause (Min.);Stunden;Kürzel;Kostenstellen');
    const lukas = zeilen.filter((z) => z.startsWith('1002;Lukas Brandstätter;fa;'));
    assert.ok(lukas.length >= 8);
    assert.ok(lukas.some((z) => /;03\.11\.2026;Di;07:00;11:00;0;4;SW;26-041$/.test(z)), lukas.join('\n'));
    assert.ok(zeilen.some((z) => /;8,5;/.test(z)));
    // 15.38: keine Hinweiszeilen zum Arbeitszeitgesetz mehr; „Ausstempeln vergessen?“ bleibt (als „Prüfen“)
    assert.ok(!zeilen.some((z) => /^Hinweis;AZG|AZG|Ruhezeit|Höchstarbeitszeit|mehr als 10 Std\.|ohne 30 Min\. Pause/.test(z)), zeilen.filter((z) => z.startsWith('Hinweis')).join('\n'));
    assert.ok(zeilen.includes('Hinweis;Prüfen: Ivan Horvat – Ausstempeln vergessen? Eingestempelt seit 11.11.2026 07:00 (über 12 Std.).'), zeilen.filter((z) => z.startsWith('Hinweis')).join('\n'));
    // 15.23: Mehrstunden und Arbeitszeitmodell am Ende angefügt (bisherige Spalten unverändert an ihrer Stelle)
    assert.ok(zeilen.includes('Personalnummer;Name;Lohngruppe;Monat;Summe Stunden;Normalstunden;Überstunden (Vorschlag);SW-Tage;SW-Stunden;K-Tage;U-Tage;ZA-Tage;SEG-Stunden;Mehrstunden (Vorschlag);Arbeitszeitmodell'));
    assert.ok(!roh.includes('€'));
  });

  await t.test('BUAK-Grundlage CSV mit Kennzeichnung', async () => {
    const r = await buero.get('/monat/buak.csv?monat=2026-11');
    assert.equal(r.status, 200);
    assert.deepEqual([...r.daten.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    const zeilen = r.daten.toString('utf8').slice(1).split('\r\n');
    assert.equal(zeilen[0], 'Hinweis;Grundlage für die BUAK-Meldung – Format mit BUAK/Lohnverrechnung abstimmen');
    assert.match(zeilen[1], /^Personalnummer;Name;Monat;Beschäftigungstage;/);
    const lukas = zeilen.find((z) => z.startsWith('1002;'));
    assert.match(lukas, /;03\.11\.2026$/);
    assert.ok(s.db.eins("SELECT COUNT(*) AS n FROM protokoll WHERE art = 'export'").n >= 2);
  });

  await t.test('Integrationen mit echtem Zustand (API.md 12.14); SMS weiter 501', async () => {
    const l = await ma.get('/integrationen');
    assert.equal(l.status, 200);
    assert.deepEqual(l.daten.map((i) => i.schluessel), ['push', 'wetter', 'email', 'fernunterschrift', 'diktat', 'lieferschein', 'papier', 'ki', 'sms']);
    assert.ok(l.daten.every((i) => i.hinweis && i.name && typeof i.angebunden === 'boolean' && i.zustand));
    const z = Object.fromEntries(l.daten.map((i) => [i.schluessel, i.zustand]));
    assert.equal(z.push, 'aktiv');
    assert.equal(z.sms, 'optional');
    assert.equal(z.ki, 'optional');
    assert.equal(z.diktat, 'aktiv_ohne_ki');
    assert.equal(l.daten.find((i) => i.schluessel === 'sms').angebunden, false);
    const r = await ma.post('/integrationen/sms/senden/123', {});
    assert.equal(r.status, 501);
    assert.equal(r.daten.code, 'NICHT_ANGEBUNDEN');
    assert.equal((await ma.post('/integrationen/gibtsnicht', {})).status, 404);
  });

  await t.test('Preise: lesen und Eingabeprüfung beim Ändern', async () => {
    const p = (await buero.get('/preise')).daten;
    assert.equal(p.lohngruppen.length, 6); // ohne Lehrling (13.11.2026)
    assert.equal(p.geraete.length, 23);
    assert.equal(p.geraete[0].name, 'LKW mit Kran 3-A');
    assert.ok('ep' in p.leistungen[0] && 'ek' in p.materialien[0] && 'regiesatz' in p.lohngruppen[0]);
    for (const [pfad, body, st] of [
      ['/preise/geraete/1', { feld: 'ek', wert: 5 }, 400], ['/preise/geraete/1', { feld: 'kostensatz', wert: -1 }, 400],
      ['/preise/geraete/1', { feld: 'kostensatz', wert: '5' }, 400], ['/preise/geraete/1', { feld: 'kostensatz' }, 400],
      ['/preise/autos/1', { feld: 'kostensatz', wert: 5 }, 400], ['/preise/geraete/9999', { feld: 'kostensatz', wert: 5 }, 404],
      ['/preise/lohngruppen/zz', { feld: 'kostensatz', wert: 5 }, 404], ['/preise/lohngruppen/a%20b', { feld: 'kostensatz', wert: 5 }, 400],
      ['/preise/materialien/1', { feld: 'vk', wert: 17.25 }, 200], ['/preise/leistungen/1', { feld: 'ep', wert: 2900 }, 200]
    ]) {
      assert.equal((await buero.put(pfad, body)).status, st, `${pfad} ${JSON.stringify(body)}`);
    }
  });

  await t.test('Baustellen anlegen/ändern mit Eingabeprüfung', async () => {
    const neu = { kst: '26-060', name: 'Testbaustelle Neunkirchen', auftraggeber: 'Gemeinde', polierId: U.polier2, bauleiterId: U.bauleiter, beginn: '2026-11-16', status: 'geplant' };
    const r = await buero.post('/baustellen', neu);
    assert.equal(r.status, 201, JSON.stringify(r.daten));
    assert.equal(r.daten.kst, '26-060');
    assert.equal((await buero.post('/baustellen', neu)).status, 409);
    for (const b of [{ ...neu, kst: '2606' }, { ...neu, kst: '26-061', name: '' }, { ...neu, kst: '26-061', polierId: U.mitarbeiter }, { ...neu, kst: '26-061', bauleiterId: U.polier }, { ...neu, kst: '26-061', status: 'fertig' }, { ...neu, kst: '26-061', beginn: '2026-02-30' }]) {
      assert.equal((await buero.post('/baustellen', b)).status, 400, JSON.stringify(b));
    }
    const u = await buero.putV(`/baustellen/${r.daten.id}`, { status: 'aktiv', adresse: '2620 Neunkirchen' });
    assert.equal(u.status, 200);
    assert.equal(u.daten.status, 'aktiv');
    assert.equal((await buero.putV(`/baustellen/${r.daten.id}`, { kst: '26-041' })).status, 409);
    assert.equal((await buero.putV('/baustellen/99999', { name: 'x' })).status, 404);
    // neue Baustelle erscheint beim Mitarbeiter (aktiv), ohne €
    assert.ok((await ma.get('/baustellen')).daten.some((b) => b.kst === '26-060'));
  });

  await t.test('Auftrag/Nachtrag/Leistung/Fremdleistung: Eingabeprüfung', async () => {
    const a = `/baustellen/${BS.pitten}`;
    for (const [m, p, b] of [
      ['putV', `${a}/auftrag`, { auftragssumme: -5 }], ['putV', `${a}/auftrag`, { auftragssumme: '100000' }], ['putV', `${a}/auftrag`, { schwellen: [] }],
      ['putV', `${a}/auftrag`, { schwellen: [80, 80] }], ['putV', `${a}/auftrag`, { schwellen: [300] }], ['putV', `${a}/auftrag`, { empfaenger: { polier: true } }],
      ['putV', `${a}/auftrag`, { empfaenger: { gf: 'ja' } }], ['putV', `${a}/auftrag`, {}],
      ['post', `${a}/nachtraege`, { betrag: 100 }], ['post', `${a}/nachtraege`, { text: 'x', betrag: 'viel' }],
      ['post', `${a}/leistungen`, { leistungId: 999, menge: 1, datum: '2026-11-12' }], ['post', `${a}/leistungen`, { leistungId: 1, menge: 0, datum: '2026-11-12' }],
      ['post', `${a}/leistungen`, { leistungId: 1, menge: 1, datum: 'heute' }],
      ['post', `${a}/fremdleistungen`, { text: 'x', betrag: '5', datum: '2026-11-12' }], ['post', `${a}/fremdleistungen`, { text: 'x', betrag: 5 }]
    ]) {
      const r = await gf[m](p, b);
      assert.equal(r.status, 400, `${p} ${JSON.stringify(b)} → ${r.status}`);
      assert.equal(r.daten.code, 'UNGUELTIG');
    }
    assert.equal((await gf.post('/baustellen/99999/nachtraege', { text: 'x', betrag: 1 })).status, 404);
    assert.equal((await gf.post('/baustellen/abc/nachtraege', { text: 'x', betrag: 1 })).status, 400);
    const ok = await gf.putV(`${a}/auftrag`, { schwellen: [90, 75, 100], empfaenger: { bauleiter: true, buero: false } });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.daten.schwellen, [75, 90, 100]);
    assert.deepEqual(ok.daten.empfaenger, { bauleiter: true, buero: false, gf: true });
  });

  await t.test('Stammdatenlisten', async () => {
    const g = (await ma.get('/geraete')).daten;
    assert.equal(g.length, 23);
    assert.deepEqual(Object.keys(g[0]).sort(), ['aktiv', 'anlageId', 'anlagen', 'code', 'einheit', 'gruppe', 'id', 'name', 'vorlage']); // anlagen: Servicebuch (11.4), aktiv/einheit/anlageId: 12.21
    const m = (await ma.get('/materialien')).daten;
    assert.deepEqual(m.filter((x) => x.vorlage).map((x) => x.name), ['Aushub', 'Betonbruch', 'Asphaltbruch', 'Frostschutz', 'Grädermaterial', 'Splitt']);
    assert.ok(!('ep' in (await ma.get('/leistungen')).daten[0]));
    assert.equal(typeof (await gf.get('/materialien')).daten[0].ek, 'number');
  });

  await t.test('Oberfläche: statisch + SPA-Fallback, API bleibt JSON', async () => {
    const r = await fetch(s.basis + '/irgendeine/seite');
    assert.ok([200, 404].includes(r.status));
    if (r.status === 200) assert.match(r.headers.get('content-type'), /text\/html/);
    const api = await fetch(s.basis + '/api/gibtsnicht');
    assert.match(api.headers.get('content-type'), /application\/json/);
  });
});
