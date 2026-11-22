'use strict';
/**
 * 15.36: Urlaubskonto – Angestellte (UrlG): Rest des Vorjahres automatisch als Übertrag, Anspruch aus dem Vorjahr;
 * Arbeiter (BUAK): Rechnung unverändert, Hinweis bei fehlendem oder über 6 Monate altem BUAK-Kontoauszug.
 * Feste Uhr Do 12.11.2026 (tests/api/hilfe.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { starte, U } = require('./hilfe');
const { oeffneDatenbank } = require('../../server/db');
const { createApp } = require('../../server/index');
const { istArbeitstag } = require('../../server/datum');

/** n aufeinanderfolgende Arbeitstage Mo–Fr ab `von` (die gewählten Wochen haben keinen Feiertag) */
function wochentage(von, n) {
  const out = [];
  for (let d = new Date(von + 'T12:00:00Z'); out.length < n; d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() % 6) out.push(d.toISOString().slice(0, 10));
  return out;
}

async function umgebung(t) {
  const s = await starte();
  t.after(() => s.stop());
  const c = { buero: await s.login(U.buero), gf: await s.login(U.gf), mitarbeiter: await s.login(U.mitarbeiter) };
  let naechste = 900;
  // eigene Personen ohne Testdaten-Urlaub: Rolle Büro → ohne Konto-Zeile Angestellte (UrlG)
  const person = (name, rolle = 'buero') => {
    const id = naechste++;
    s.db.lauf("INSERT INTO benutzer (id, name, rolle, pin_hash, aktiv, erstellt) VALUES (?, ?, ?, 'x', 1, '2020-01-01T00:00:00.000Z')", id, name, rolle);
    return id;
  };
  const urlaub = (id, tage, status = 'genehmigt') => {
    for (const d of tage) s.db.lauf("INSERT INTO abwesenheit (benutzer_id, datum, code, status, erfasst_von, erfasst) VALUES (?, ?, 'U', ?, 101, '2026-01-01T08:00:00Z') ON CONFLICT(benutzer_id, datum) DO UPDATE SET code = 'U', status = excluded.status", id, d, status);
  };
  const konto = async (id, jahr, wer = c.buero) => {
    const r = await wer.get(`/urlaub/konto?${jahr ? `jahr=${jahr}&` : ''}benutzerId=${id}`);
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    return r.daten[0];
  };
  const setze = async (id, jahr, body, wer = c.buero) => {
    const r = await wer.put(`/urlaub/konto/${id}/${jahr}`, body);
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    return r.daten;
  };
  return { s, c, person, urlaub, konto, setze };
}

test('15.36: Rest des Vorjahres wird automatisch und live übertragen, der Anspruch übernommen', async (t) => {
  const { person, urlaub, konto, setze } = await umgebung(t);
  const p = person('Angestellte Auto');
  // ohne Konto-Zeile und ohne Urlaub im Vorjahr: wie bisher 25 / 0
  let k = await konto(p, 2026);
  assert.deepEqual([k.art, k.anspruch, k.uebertrag, k.rest, k.uebertragAuto, k.uebertragAus, k.anspruchVorgabe], ['urlg', 25, 0, 25, true, undefined, true]);
  await setze(p, 2025, { art: 'urlg', anspruch: 30, einheit: 'Werktage' });
  urlaub(p, wochentage('2025-03-03', 5));
  k = await konto(p, 2026);
  assert.equal(k.uebertrag, 25, 'Rest 2025 = 30 − 5');
  assert.deepEqual([k.uebertragAuto, k.uebertragAus, k.uebertragAutoWert], [true, 2025, 25]);
  assert.deepEqual([k.anspruch, k.einheit, k.anspruchAus, k.anspruchVorgabe], [30, 'Werktage', 2025, undefined], 'Anspruch samt Einheit aus 2025');
  assert.equal(k.rest, 55);
  // live: ein weiterer genehmigter Tag 2025 verringert den Übertrag sofort; beantragte Tage zählen nicht (wie im Konto)
  urlaub(p, ['2025-06-02']);
  urlaub(p, ['2025-06-03'], 'beantragt');
  k = await konto(p, 2026);
  assert.deepEqual([k.uebertrag, k.rest], [24, 54]);
  // Urlaub im Jahr selbst zählt wie bisher (genommen/geplant)
  urlaub(p, wochentage('2026-12-14', 2));
  k = await konto(p, 2026);
  assert.deepEqual([k.geplant, k.rest], [2, 52]);
  // ausdrücklich gespeicherter Anspruch im Jahr selbst gilt (kein „wie 2025“)
  k = await setze(p, 2026, { anspruch: 25, einheit: 'Arbeitstage' });
  assert.deepEqual([k.anspruch, k.einheit, k.anspruchAus, k.uebertrag, k.uebertragAuto], [25, 'Arbeitstage', undefined, 24, true], 'eine neue Zeile ohne Übertrag bleibt automatisch');
});

test('15.36: Kette über zwei Jahre, ausdrücklicher Übertrag in der Kette, harte Grenze 10 Jahre', async (t) => {
  const { s, person, urlaub, konto, setze } = await umgebung(t);
  const p = person('Angestellte Kette');
  await setze(p, 2024, { art: 'urlg', anspruch: 25 });
  urlaub(p, wochentage('2024-03-04', 3)); // Rest 2024: 22
  urlaub(p, wochentage('2025-03-03', 5)); // 2025 ohne Zeile: 25 + 22 − 5 = 42
  let k = await konto(p, 2025);
  assert.deepEqual([k.anspruch, k.uebertrag, k.rest, k.uebertragAus, k.anspruchAus], [25, 22, 42, 2024, 2024]);
  k = await konto(p, 2026);
  assert.deepEqual([k.uebertrag, k.rest, k.uebertragAus], [42, 67, 2025]);
  k = await konto(p, 2027);
  assert.deepEqual([k.uebertrag, k.rest], [67, 92], 'auch das nächste Urlaubsjahr rechnet weiter');
  // ein ausdrücklich festgelegter Übertrag in der Mitte der Kette gilt für die Folgejahre
  await setze(p, 2025, { uebertrag: 10 });
  k = await konto(p, 2026);
  assert.deepEqual([k.uebertrag, k.rest], [30, 55], '25 + 10 − 5');
  // vor dem ersten Jahr mit Konto-Zeile oder Urlaub gibt es nichts zu übertragen
  k = await konto(p, 2024);
  assert.deepEqual([k.uebertrag, k.uebertragAus, k.rest], [0, undefined, 22]);

  // harte Grenze: höchstens 10 Urlaubsjahre zurück (2016–2025 je 25 Tage Rest → 250, nicht 16 × 25)
  const q = person('Angestellte Lang');
  s.db.lauf("INSERT INTO urlaub_konto (benutzer_id, jahr, art, anspruch, einheit, uebertrag, beginn) VALUES (?, 2010, 'urlg', 25, 'Arbeitstage', 0, '01-01')", q);
  const t0 = Date.now();
  k = await konto(q, 2026);
  assert.equal(k.uebertrag, 250);
  assert.ok(Date.now() - t0 < 2000, 'schnell');
});

test('15.36: ausdrücklich gesetzter Übertrag bleibt; „automatisch“ stellt zurück; Festhalten des automatischen Werts', async (t) => {
  const { s, c, person, urlaub, konto, setze } = await umgebung(t);
  const p = person('Angestellte Fest');
  await setze(p, 2025, { art: 'urlg', anspruch: 25 });
  urlaub(p, wochentage('2025-03-03', 5)); // Rest 2025: 20
  let k = await setze(p, 2026, { uebertrag: 3 });
  assert.deepEqual([k.uebertrag, k.uebertragAuto, k.uebertragAus, k.uebertragAutoWert, k.rest], [3, false, undefined, 20, 28]);
  urlaub(p, ['2025-06-02']);
  k = await konto(p, 2026);
  assert.deepEqual([k.uebertrag, k.uebertragAutoWert], [3, 19], 'ein festgelegter Übertrag folgt dem Vorjahr nicht');
  // eine andere Änderung (Notiz) lässt den festgelegten Übertrag stehen
  k = await setze(p, 2026, { notiz: 'mit Lohnverrechnung abgestimmt' });
  assert.deepEqual([k.uebertrag, k.uebertragAuto], [3, false]);
  // zurück auf automatisch
  k = await setze(p, 2026, { uebertragAuto: true });
  assert.deepEqual([k.uebertrag, k.uebertragAuto, k.uebertragAus], [19, true, 2025]);
  // automatischen Wert festhalten: folgt dem Vorjahr danach nicht mehr
  k = await setze(p, 2026, { uebertragAuto: false });
  assert.deepEqual([k.uebertrag, k.uebertragAuto], [19, false]);
  urlaub(p, ['2025-06-03']);
  assert.equal((await konto(p, 2026)).uebertrag, 19);
  // beides zugleich ist widersprüchlich
  const r = await c.buero.put(`/urlaub/konto/${p}/2026`, { uebertrag: 4, uebertragAuto: true });
  assert.equal(r.status, 400);
  assert.equal((await c.buero.put(`/urlaub/konto/${p}/2026`, { uebertragAuto: 'ja' })).status, 400);
  // das Protokoll vermerkt die Umstellung (alt/neu mit uebertrag_auto)
  const log = s.db.eins("SELECT alt, neu FROM protokoll WHERE art = 'urlaub' AND objekt = ? ORDER BY id DESC LIMIT 1", `benutzer:${p}`);
  assert.deepEqual([JSON.parse(log.alt).uebertrag_auto, JSON.parse(log.neu).uebertrag_auto, JSON.parse(log.neu).uebertrag], [1, 0, 19]);
});

test('15.36: negativer Rest (vorgegriffen) wird als negativer Übertrag übertragen', async (t) => {
  const { person, urlaub, konto, setze, c } = await umgebung(t);
  const p = person('Angestellte Vorgriff');
  await setze(p, 2025, { art: 'urlg', anspruch: 2 });
  urlaub(p, wochentage('2025-03-03', 5));
  assert.equal((await konto(p, 2025)).rest, -3);
  const k = await konto(p, 2026);
  assert.deepEqual([k.uebertrag, k.rest, k.anspruch], [-3, -1, 2]);
  // mit eigenem Anspruch 2026: 25 − 3
  assert.equal((await setze(p, 2026, { anspruch: 25 })).rest, 22);
  // laufendes Urlaubsjahr negativ → Warnung wie bisher
  await setze(p, 2026, { anspruch: 2 });
  const w = (await c.buero.get('/urlaub/warnungen?von=2026-11-12&bis=2026-11-20')).daten;
  assert.ok(w.some((x) => x.typ === 'rest_negativ' && x.benutzerId === p), JSON.stringify(w.filter((x) => x.typ === 'rest_negativ')));
});

test('15.36: Wechsel BUAK → UrlG – kein Übertrag und kein Anspruch aus BUAK-Jahren', async (t) => {
  const { person, urlaub, konto, setze } = await umgebung(t);
  const p = person('Wechsel BUAK', 'mitarbeiter');
  await setze(p, 2025, { art: 'buak', buakStand: 20, buakDatum: '2025-01-10' });
  urlaub(p, wochentage('2025-03-03', 5));
  await setze(p, 2026, { art: 'urlg' });
  const k = await konto(p, 2026);
  assert.deepEqual([k.art, k.anspruch, k.uebertrag, k.uebertragAuto, k.uebertragAus, k.anspruchVorgabe, k.rest], ['urlg', 25, 0, true, undefined, true, 25]);
  // UrlG → BUAK → UrlG: die Kette reißt am BUAK-Jahr ab
  const q = person('Hin und her', 'mitarbeiter');
  await setze(q, 2024, { art: 'urlg', anspruch: 25 });
  await setze(q, 2025, { art: 'buak', buakStand: 10, buakDatum: '2025-01-10' });
  await setze(q, 2026, { art: 'urlg' });
  assert.equal((await konto(q, 2026)).uebertrag, 0);
});

test('15.36: eigener Beginn des Urlaubsjahres – Vorjahr = Urlaubsjahr J−1 der Person', async (t) => {
  const { person, urlaub, konto, setze } = await umgebung(t);
  const p = person('Beginn April');
  await setze(p, 2025, { art: 'urlg', anspruch: 25, uebertrag: 0, urlaubsjahrBeginn: '04-01' });
  await setze(p, 2026, { art: 'urlg', urlaubsjahrBeginn: '04-01' });
  urlaub(p, ['2025-03-03']); // gehört zum Urlaubsjahr 2024 (bis 31.03.2025)
  urlaub(p, ['2026-02-02', '2026-03-31']); // gehören zum Urlaubsjahr 2025 (01.04.2025–31.03.2026)
  urlaub(p, ['2026-04-01']); // Urlaubsjahr 2026
  const v = await konto(p, 2025);
  assert.deepEqual([v.von, v.bis, v.genommen, v.rest], ['2025-04-01', '2026-03-31', 2, 23]);
  const k = await konto(p, 2026);
  assert.deepEqual([k.von, k.uebertrag, k.uebertragAus, k.genommen, k.rest], ['2026-04-01', 23, 2025, 1, 47]);
  // ohne jahr: das laufende Urlaubsjahr der Person (12.11.2026 → 2026)
  assert.equal((await konto(p)).uebertrag, 23);
});

test('15.36: Rest beim Zeitraum-Antrag und CSV-Export rechnen mit dem wirksamen Übertrag', async (t) => {
  const { s, c, person, urlaub, konto, setze } = await umgebung(t);
  // der Mitarbeiter als Angestellter (UrlG) mit Urlaub 2025
  await setze(U.mitarbeiter, 2025, { art: 'urlg', anspruch: 25 });
  await setze(U.mitarbeiter, 2026, { art: 'urlg', anspruch: 25 });
  const n2025 = () => s.db.alle("SELECT datum FROM abwesenheit WHERE benutzer_id = ? AND code = 'U' AND status = 'genehmigt' AND datum >= '2025-01-01' AND datum <= '2025-12-31'", U.mitarbeiter)
    .filter((a) => istArbeitstag(a.datum)).length;
  urlaub(U.mitarbeiter, wochentage('2025-03-03', 5));
  const k = await konto(U.mitarbeiter, 2026, c.mitarbeiter);
  assert.equal(k.uebertrag, 25 - n2025());
  assert.ok(k.uebertrag <= 20 && k.uebertragAuto && k.uebertragAus === 2025, JSON.stringify(k));
  const r = await c.mitarbeiter.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: '2026-12-14', bis: '2026-12-18', code: 'U', vorschau: true });
  assert.equal(r.status, 200, JSON.stringify(r.daten));
  assert.deepEqual(r.daten.konto, { rest: k.rest, restNachAntrag: Math.round((k.rest - 5) * 10) / 10 });
  assert.equal(k.rest, Math.round((k.anspruch + k.uebertrag - k.genommen - k.geplant) * 10) / 10);

  // CSV: Spalte „Übertrag“ = wirksamer Wert (automatisch bzw. festgelegt), Anspruch übernommen
  const p = person('Angestellte CSV');
  await setze(p, 2025, { art: 'urlg', anspruch: 26 });
  urlaub(p, wochentage('2025-03-03', 4));
  const q = person('Angestellte CSV fest');
  await setze(q, 2026, { art: 'urlg', anspruch: 25, uebertrag: 2.5 });
  const csv = await c.buero.get('/urlaub/export.csv?jahr=2026');
  assert.equal(csv.status, 200);
  const zeilen = csv.daten.toString('utf8').replace(/^﻿/, '').trim().split('\r\n').map((z) => z.split(';'));
  const kopf = zeilen[0];
  const spalte = (zeile, name) => zeile[kopf.indexOf(name)];
  const zp = zeilen.find((z) => z[1] === 'Angestellte CSV'), zq = zeilen.find((z) => z[1] === 'Angestellte CSV fest');
  assert.deepEqual([spalte(zp, 'Anspruch'), spalte(zp, 'Übertrag'), spalte(zp, 'Rest')], ['26', '22', '48']);
  assert.deepEqual([spalte(zq, 'Übertrag'), spalte(zq, 'Rest')], ['2,5', '27,5']);
});

test('15.36: Mitarbeiter sieht nur das eigene Konto (mit automatischem Übertrag), nie den BUAK-Hinweis; Vier-Augen-Prinzip bleibt', async (t) => {
  const { c, person, urlaub, konto, setze } = await umgebung(t);
  const p = person('Fremde Angestellte');
  await setze(p, 2025, { art: 'urlg', anspruch: 25 });
  urlaub(p, wochentage('2025-03-03', 5));
  await setze(U.mitarbeiter, 2025, { art: 'urlg', anspruch: 25 });
  await setze(U.mitarbeiter, 2026, { art: 'urlg' }); // ohne Zeile wäre der Mitarbeiter BUAK-pflichtig (Vorgabe nach der Rolle)
  const eigen = (await c.mitarbeiter.get('/urlaub/konto?jahr=2026')).daten;
  assert.equal(eigen.length, 1);
  assert.equal(eigen[0].benutzerId, U.mitarbeiter);
  assert.equal(eigen[0].uebertragAus, 2025);
  assert.deepEqual((await c.mitarbeiter.get(`/urlaub/konto?jahr=2026&benutzerId=${p}`)).daten, []);
  // BUAK-Hinweis nie für Mitarbeiter (auch nicht zum eigenen BUAK-Konto ohne Stand)
  await setze(U.mitarbeiter, 2026, { art: 'buak' });
  const ohne = (await c.mitarbeiter.get('/urlaub/konto')).daten;
  assert.equal(ohne.length, 1);
  assert.equal(ohne[0].buakHinweis, undefined);
  assert.ok(!JSON.stringify(ohne).includes('BUAK-Stand eingetragen'));
  // weder Mitarbeiter noch Büro (eigenes Konto) dürfen „automatisch“ setzen
  assert.equal((await c.mitarbeiter.put(`/urlaub/konto/${U.mitarbeiter}/2026`, { uebertragAuto: true })).status, 403);
  assert.equal((await c.buero.put(`/urlaub/konto/${U.buero}/2026`, { uebertragAuto: true })).status, 403);
  assert.equal((await c.gf.put(`/urlaub/konto/${U.buero}/2026`, { uebertragAuto: true })).status, 200);
});

test('15.36: BUAK-Rechnung unverändert (Anspruch laut Auszug, ab dessen Datum, Übertrag zählt nicht, kein Jahreswechsel)', async (t) => {
  const { person, urlaub, konto, setze } = await umgebung(t);
  const p = person('Arbeiter', 'mitarbeiter');
  await setze(p, 2025, { buakStand: 30, buakDatum: '2025-02-01' });
  urlaub(p, wochentage('2025-03-03', 5));
  urlaub(p, ['2026-01-12', '2026-06-01', '2026-06-02']);
  let k = await konto(p, 2026);
  assert.deepEqual([k.art, k.anspruch, k.uebertrag, k.rest, k.buak], ['buak', null, 0, null, { stand: null, datum: null }], 'kein Anspruch/Übertrag aus 2025');
  assert.equal(k.uebertragAuto, undefined);
  assert.equal(k.uebertragAus, undefined);
  k = await setze(p, 2026, { buakStand: 12, buakDatum: '2026-05-15', uebertrag: 5 });
  assert.deepEqual([k.anspruch, k.uebertrag, k.genommen, k.rest], [12, 5, 2, 10], 'gezählt ab dem Auszug, Übertrag nicht in der Rechnung');
  assert.equal(k.uebertragAuto, undefined);
});

test('15.36: Hinweis BUAK-Auszug fehlt oder älter als 6 Monate – nur Verwaltung, nur laufendes Urlaubsjahr', async (t) => {
  const { c, person, konto, setze } = await umgebung(t);
  const p = person('Arbeiter Auszug', 'mitarbeiter');
  let k = await konto(p);
  assert.deepEqual(k.buakHinweis, { typ: 'fehlt', text: 'Noch kein BUAK-Stand eingetragen' });
  k = await setze(p, 2026, { buakStand: 14, buakDatum: '2026-05-11' }); // 12.11.2026 − 6 Monate = 12.05.2026
  assert.deepEqual(k.buakHinweis, { typ: 'veraltet', datum: '2026-05-11', text: 'BUAK-Auszug vom 11.05.2026 – älter als 6 Monate, bitte neuen Stand eintragen' });
  assert.deepEqual((await konto(p)).buakHinweis, k.buakHinweis);
  k = await setze(p, 2026, { buakDatum: '2026-05-12' });
  assert.equal(k.buakHinweis, undefined, 'genau 6 Monate alt: noch kein Hinweis');
  assert.equal((await konto(p)).buakHinweis, undefined);
  k = await setze(p, 2026, { buakDatum: null });
  assert.equal(k.buakHinweis.typ, 'fehlt', 'Stand ohne Datum');
  // vergangenes oder künftiges Urlaubsjahr: kein Hinweis
  assert.equal((await konto(p, 2025)).buakHinweis, undefined);
  assert.equal((await konto(p, 2027)).buakHinweis, undefined);
  // Angestellte nie
  const q = person('Angestellte ohne Hinweis');
  assert.equal((await konto(q)).buakHinweis, undefined);
  // Liste der Verwaltung: alle Arbeiter ohne aktuellen Stand tragen den Hinweis
  const alle = (await c.buero.get('/urlaub/konto')).daten;
  assert.ok(alle.filter((x) => x.buakHinweis).length >= 2, 'Testdaten-Arbeiter ohne Stand');
  assert.ok(alle.filter((x) => x.buakHinweis).every((x) => x.art === 'buak'));
});

test('15.36 Prüfbefund: Arbeiter ohne Konto-Zeile wird Angestellter – kein Übertrag aus den BUAK-Jahren', async (t) => {
  const { s, c, person, urlaub, konto, setze } = await umgebung(t);
  // A) Rolle wechselt außerhalb der App (Trigger), keine Konto-Zeile, je 10 Urlaubstage 2023–2025
  const a = person('Arbeiter A', 'mitarbeiter');
  for (const d of ['2023-03-06', '2024-03-04', '2025-03-03']) urlaub(a, wochentage(d, 10));
  let k = await konto(a, 2026);
  assert.deepEqual([k.art, k.anspruch, k.rest], ['buak', null, null]);
  s.db.lauf("UPDATE benutzer SET rolle = 'bauleiter' WHERE id = ?", a);
  assert.ok(s.db.eins('SELECT buak_wechsel FROM benutzer WHERE id = ?', a).buak_wechsel, 'Trigger setzt den Tag des Wechsels');
  k = await konto(a, 2026);
  assert.deepEqual([k.art, k.anspruch, k.uebertrag, k.uebertragAus, k.rest], ['urlg', 25, 0, undefined, 25], 'kein Übertrag aus 2023–2025');
  assert.equal((await konto(a, 2025)).art, 'buak', 'Jahre vor dem Wechsel bleiben BUAK-Jahre');
  assert.deepEqual([(await konto(a, 2027)).uebertrag, (await konto(a, 2027)).uebertragAus], [25, 2026], 'ab dem Jahr des Wechsels rechnet die Kette');

  // B) Kennzeichen über PUT /benutzer (GF) – Tag nach der Uhr der App, nicht im Protokoll-Text
  const b = person('Arbeiter B', 'mitarbeiter');
  for (const d of ['2024-03-04', '2025-03-03']) urlaub(b, wochentage(d, 5));
  const r = await c.gf.put(`/benutzer/${b}`, { buakPflichtig: false });
  assert.equal(r.status, 200, JSON.stringify(r.daten));
  assert.equal(s.db.eins('SELECT buak_wechsel FROM benutzer WHERE id = ?', b).buak_wechsel, '2026-11-12');
  k = await konto(b, 2026);
  assert.deepEqual([k.art, k.uebertrag, k.rest], ['urlg', 0, 25]);
  // ein Rollenwechsel ohne wirksamen Wechsel (Kennzeichen wird festgeschrieben) setzt keinen Tag
  const b2 = person('Polier B2', 'polier');
  assert.equal((await c.gf.put(`/benutzer/${b2}`, { rolle: 'mitarbeiter' })).status, 200);
  assert.equal(s.db.eins('SELECT buak_wechsel FROM benutzer WHERE id = ?', b2).buak_wechsel, null);

  // C) BUAK-Zeile 2024, Lückenjahr 2025 ohne Zeile, danach Wechsel → auch 2025 zählt als BUAK-Jahr
  const x = person('Arbeiter C', 'mitarbeiter');
  await setze(x, 2024, { art: 'buak', buakStand: 20, buakDatum: '2024-01-10' });
  for (const d of ['2024-03-04', '2025-03-03']) urlaub(x, wochentage(d, 5));
  s.db.lauf('UPDATE benutzer SET buak_pflichtig = 0 WHERE id = ?', x);
  k = await konto(x, 2026);
  assert.deepEqual([k.art, k.uebertrag, k.rest], ['urlg', 0, 25]);
  // Gegenprobe: Angestellte ohne Wechsel behält den automatischen Übertrag
  const y = person('Angestellte ohne Wechsel');
  urlaub(y, wochentage('2025-03-03', 5));
  assert.equal((await konto(y, 2026)).uebertrag, 20);
});

test('15.36 Prüfbefund: Anspruch ohne 10-Jahres-Grenze; Übertrag von J = angezeigter Rest von J−1', async (t) => {
  const { person, konto, setze } = await umgebung(t);
  const p = person('Angestellte 2015');
  await setze(p, 2015, { art: 'urlg', anspruch: 30 });
  const k25 = await konto(p, 2025), k26 = await konto(p, 2026), k27 = await konto(p, 2027);
  assert.deepEqual([k26.anspruch, k26.anspruchAus, k26.anspruchVorgabe], [30, 2015, undefined], 'Anspruch aus 2015 trotz Grenze');
  assert.equal(k26.uebertrag, k25.rest, 'Übertrag 2026 = Rest 2025');
  assert.equal(k27.uebertrag, k26.rest, 'Übertrag 2027 = Rest 2026');
  assert.deepEqual([k25.rest, k26.uebertrag, k26.rest], [300, 300, 330], 'Übertrag ab 2016 (laufendes Urlaubsjahr 2026 − 10)');
});

test('15.36 Prüfbefund: Einheit allein geändert wirkt (mit dem übernommenen Anspruch)', async (t) => {
  const { person, konto, setze } = await umgebung(t);
  const p = person('Angestellte Einheit');
  await setze(p, 2025, { art: 'urlg', anspruch: 25 });
  let k = await setze(p, 2026, { einheit: 'Werktage' });
  assert.deepEqual([k.einheit, k.anspruch, k.anspruchAus], ['Werktage', 25, undefined]);
  k = await konto(p, 2026);
  assert.deepEqual([k.einheit, k.anspruch, k.anspruchAus], ['Werktage', 25, undefined]);
  // gleiche Einheit wie übernommen: nichts festgelegt, der Anspruch folgt weiter dem Vorjahr
  k = await setze(p, 2027, { einheit: 'Werktage' });
  assert.deepEqual([k.einheit, k.anspruch, k.anspruchAus], ['Werktage', 25, 2026]);
  await setze(p, 2026, { anspruch: 30 });
  assert.equal((await konto(p, 2027)).anspruch, 30);
});

test('15.36: Migration 57 auf Bestand – gespeicherte Überträge bleiben ausdrücklich, nur künftige UrlG-Zeilen mit 0 werden automatisch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bautag-mig57-'));
  const datei = path.join(dir, 'alt.db');
  try {
    const alt = oeffneDatenbank(datei, { bisVersion: 56 });
    assert.equal(alt.eins('SELECT MAX(version) AS v FROM schema_version').v, 56);
    alt.lauf("INSERT INTO benutzer (id, name, rolle, pin_hash, aktiv, erstellt) VALUES (60, 'Bestand', 'buero', 'x', 1, '2024-01-01T00:00:00.000Z')");
    alt.lauf("INSERT INTO benutzer (id, name, rolle, pin_hash, aktiv, erstellt) VALUES (61, 'Bestand Arbeiter', 'mitarbeiter', 'x', 1, '2024-01-01T00:00:00.000Z')");
    const zeile = (id, jahr, art, uebertrag) => alt.lauf("INSERT INTO urlaub_konto (benutzer_id, jahr, art, anspruch, einheit, uebertrag, beginn) VALUES (?, ?, ?, 25, 'Arbeitstage', ?, '01-01')", id, jahr, art, uebertrag);
    zeile(60, 2024, 'urlg', 4);
    zeile(60, 2025, 'urlg', 0);
    zeile(60, 2026, 'urlg', 0);
    zeile(60, 2098, 'urlg', 2);
    zeile(60, 2099, 'urlg', 0);
    zeile(61, 2026, 'buak', 0);
    zeile(61, 2099, 'buak', 0);
    alt.lauf("INSERT INTO abwesenheit (benutzer_id, datum, code, status, erfasst_von, erfasst) VALUES (60, '2025-03-03', 'U', 'genehmigt', 60, '2025-01-01T00:00:00Z')");
    // Prüfbefunde: Bestandszeile ohne Anspruch mit „Werktage“ (bisher „25 Werktage“); Kennzeichen-Wechsel laut Protokoll
    alt.lauf("INSERT INTO urlaub_konto (benutzer_id, jahr, art, anspruch, einheit, uebertrag, beginn) VALUES (60, 2023, 'urlg', NULL, 'Werktage', 0, '01-01')");
    alt.lauf("INSERT INTO benutzer (id, name, rolle, pin_hash, aktiv, erstellt, buak_pflichtig) VALUES (62, 'Bestand Wechsel', 'mitarbeiter', 'x', 1, '2024-01-01T00:00:00.000Z', 0)");
    alt.lauf("INSERT INTO benutzer (id, name, rolle, pin_hash, aktiv, erstellt, buak_pflichtig) VALUES (63, 'Bestand Rollenwechsel', 'bauleiter', 'x', 1, '2024-01-01T00:00:00.000Z', 1)");
    alt.lauf("INSERT INTO benutzer (id, name, rolle, pin_hash, aktiv, erstellt) VALUES (64, 'Bestand Rolle alt', 'buero', 'x', 1, '2024-01-01T00:00:00.000Z')");
    const prot = (zeit, id, art, a, n) => alt.lauf('INSERT INTO protokoll (zeit, benutzer_id, art, objekt, alt, neu, text) VALUES (?, 102, ?, ?, ?, ?, ?)', zeit, art, `benutzer:${id}`, JSON.stringify(a), JSON.stringify(n), 'Benutzer geändert');
    prot('2025-02-01T10:00:00.000Z', 62, 'benutzer', { telefon: null }, { telefon: '1' });
    prot('2025-06-01T10:00:00.000Z', 62, 'benutzer', { buak_pflichtig: null }, { buak_pflichtig: 0 });
    prot('2025-07-01T10:00:00.000Z', 63, 'rolle', { rolle: 'mitarbeiter', buak_pflichtig: null }, { rolle: 'bauleiter', buak_pflichtig: 1 });
    prot('2024-05-02T10:00:00.000Z', 64, 'rolle', { rolle: 'polier' }, { rolle: 'buero' });
    alt.schliessen();

    const app = createApp({ dbPath: datei, uhr: () => new Date('2026-11-12T09:00:00Z'), seed: false, demo: false, loginListe: false });
    const { db } = app.locals.bt;
    try {
      assert.ok(db.eins('SELECT 1 AS x FROM schema_version WHERE version = 57'));
      const z = Object.fromEntries(db.alle('SELECT benutzer_id, jahr, uebertrag, uebertrag_auto FROM urlaub_konto WHERE NOT (benutzer_id = 60 AND jahr = 2023)').map((x) => [`${x.benutzer_id}/${x.jahr}`, [x.uebertrag, x.uebertrag_auto]]));
      assert.deepEqual(z, { '60/2024': [4, 0], '60/2025': [0, 0], '60/2026': [0, 0], '60/2098': [2, 0], '60/2099': [0, 1], '61/2026': [0, 0], '61/2099': [0, 0] });
      // die bestehenden Jahre rechnen wie vorher: 2025 = 25 + 0 − 1, 2026 = 25 + 0 (nicht + Rest 2025)
      const b = db.eins('SELECT * FROM benutzer WHERE id = 60');
      assert.equal(app.locals.bt.urlaubKonto(b, '2025-06-01').rest, 24);
      assert.equal(app.locals.bt.urlaubKonto(b, '2026-06-01').rest, 25);
      // Prüfbefunde: „25 Werktage“ bleibt; Tag des Kennzeichen-Wechsels aus dem Protokoll (nur bei wirksamem Wechsel), Trigger
      assert.deepEqual(db.eins('SELECT anspruch, einheit FROM urlaub_konto WHERE benutzer_id = 60 AND jahr = 2023'), { anspruch: 25, einheit: 'Werktage' });
      const w = Object.fromEntries(db.alle('SELECT id, buak_wechsel FROM benutzer WHERE id IN (60, 61, 62, 63, 64)').map((x) => [x.id, x.buak_wechsel]));
      assert.deepEqual(w, { 60: null, 61: null, 62: '2025-06-01', 63: null, 64: '2024-05-02' });
      db.lauf('UPDATE benutzer SET buak_pflichtig = 0 WHERE id = 61');
      assert.ok(db.eins('SELECT buak_wechsel FROM benutzer WHERE id = 61').buak_wechsel);
      db.lauf("UPDATE benutzer SET rolle = 'gf' WHERE id = 60");
      assert.equal(db.eins('SELECT buak_wechsel FROM benutzer WHERE id = 60').buak_wechsel, null, 'kein wirksamer Wechsel');
      assert.equal(db.eins('PRAGMA integrity_check').integrity_check, 'ok');
    } finally { db.schliessen(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
