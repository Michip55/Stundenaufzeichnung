'use strict';
/** 15.30: Standort beim Stempeln – Lage zur Baustelle, Entfernungstext, Karten-Link (public/js/standort.js) */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const laden = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'public', 'js', 'standort.js')).href);
// Baustelle Pitten (Testdaten-ähnlich) und Punkte in bekanntem Abstand: 1° Breite ≈ 111,195 km (Erdradius 6 371 km)
const BS = { lat: 47.7333, lng: 16.1833 };
const nord = (m) => ({ lat: BS.lat + m / 111195, lng: BS.lng });

test('15.30: Entfernung (Haversine) – bekannte Abstände, symmetrisch, ungültig → null', async () => {
  const { entfernungM: e } = await laden();
  assert.equal(e(BS, BS), 0);
  assert.ok(Math.abs(e(BS, nord(1000)) - 1000) < 1, `1 km nach Norden: ${e(BS, nord(1000))}`);
  assert.ok(Math.abs(e(BS, nord(250)) - 250) < 0.5);
  // Wien Stephansplatz → Graz Hauptplatz ≈ 145 km Luftlinie
  const wien = { lat: 48.2085, lng: 16.3731 }, graz = { lat: 47.0707, lng: 15.4395 };
  assert.ok(Math.abs(e(wien, graz) - 145000) < 2000, `Wien–Graz ${e(wien, graz)}`);
  assert.equal(Math.round(e(wien, graz)), Math.round(e(graz, wien)));
  for (const [a, b] of [[null, BS], [BS, null], [{ lat: null, lng: 16 }, BS], [{ lat: '47', lng: '16' }, BS], [{ lat: 91, lng: 0 }, BS], [{ lat: NaN, lng: 1 }, BS], [BS, { lat: 1, lng: 181 }]]) assert.equal(e(a, b), null);
});

test('15.30: „bei der Baustelle“ bis max(300 m, Genauigkeit), sonst Entfernung; Baustelle ohne Koordinaten → „Standort“', async () => {
  const { standortLage: lage } = await laden();
  assert.deepEqual(lage({ ...nord(0), genauigkeit: 10 }, BS), { art: 'bei', meter: 0, text: 'bei der Baustelle' });
  assert.equal(lage({ ...nord(299), genauigkeit: 5 }, BS).art, 'bei');
  assert.equal(lage({ ...nord(301), genauigkeit: 5 }, BS).art, 'weg');
  assert.equal(lage({ ...nord(301) }, BS).art, 'weg'); // ohne Genauigkeit gelten 300 m
  // schlechte Genauigkeit erweitert den Kreis (±800 m → 700 m entfernt gilt noch als „bei der Baustelle“)
  assert.equal(lage({ ...nord(700), genauigkeit: 800 }, BS).art, 'bei');
  assert.equal(lage({ ...nord(801), genauigkeit: 800 }, BS).art, 'weg');
  assert.deepEqual(lage({ ...nord(3200), genauigkeit: 20 }, BS), { art: 'weg', meter: 3200, text: '3,2 km von der Baustelle' });
  assert.equal(lage({ ...nord(850), genauigkeit: 20 }, BS).text, '850 m von der Baustelle');
  assert.equal(lage({ ...nord(25400), genauigkeit: 20 }, BS).text, '25 km von der Baustelle');
  // Baustelle ohne (oder mit halben) Koordinaten bzw. unbekannt: nur „Standort“
  for (const b of [{ lat: null, lng: null }, { lat: 47.7, lng: null }, {}, null, undefined]) assert.deepEqual(lage({ ...nord(10), genauigkeit: 5 }, b), { art: 'ohne', meter: null, text: 'Standort' });
  // Koordinaten als Zahl-Text (z. B. aus einem Formular) an der Baustelle gelten
  assert.equal(lage({ ...nord(10) }, { lat: '47.7333', lng: '16.1833' }).art, 'bei');
  // kein oder ungültiger Standort → null (nichts anzeigen)
  for (const s of [null, undefined, {}, { lat: 47 }, { lat: 'x', lng: 16 }, { lat: 100, lng: 16 }]) assert.equal(lage(s, BS), null);
});

test('15.30: Texte für Entfernung und Genauigkeit, Karten-Link OpenStreetMap', async () => {
  const { entfernungText: t, genauText: g, kartenLink: k } = await laden();
  assert.equal(t(0), '10 m');
  assert.equal(t(304), '300 m');
  assert.equal(t(994), '990 m');
  assert.equal(t(995), '1,0 km'); // nie „1000 m“
  assert.equal(t(1000), '1,0 km');
  assert.equal(t(3249), '3,2 km');
  assert.equal(t(9949), '9,9 km');
  assert.equal(t(12345), '12 km');
  for (const x of [null, undefined, NaN, -1, '5']) assert.equal(t(x), '');
  assert.equal(g(24.6), '±25 m');
  assert.equal(g(0), '±0 m');
  for (const x of [null, undefined, NaN, -3, '12']) assert.equal(g(x), '');
  assert.equal(k({ lat: 47.7333123456, lng: 16.1833987654 }), 'https://www.openstreetmap.org/?mlat=47.733312&mlon=16.183399#map=17/47.733312/16.183399');
  assert.equal(k({ lat: 48.2, lng: 16.37 }), 'https://www.openstreetmap.org/?mlat=48.2&mlon=16.37#map=17/48.2/16.37');
  for (const x of [null, {}, { lat: 'a', lng: 1 }]) assert.equal(k(x), '');
});

test('15.30: Ortung – ohne Browser-Ortung „fehlt“, Erlaubnis unbekannt (kein Abruf beim Laden des Moduls)', async () => {
  const { ortHolen, ortErlaubnis } = await laden();
  assert.deepEqual(await ortHolen(), { fehler: 'fehlt' });
  assert.equal(await ortErlaubnis(), null);
});
