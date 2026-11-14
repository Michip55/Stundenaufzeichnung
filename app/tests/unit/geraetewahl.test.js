'use strict';
/**
 * API.md 15.8 – Gerätewahl „Eigenes Handy“ / „Geteiltes Gerät“ (reine Regeln der App, public/js/api.js und ui.js).
 * Sperre nach Untätigkeit je Gerätewahl, sicherer Standard „geteilt“, Wahl gehört zum Gerät und übersteht das Abmelden.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const modul = (n) => import(pathToFileURL(path.join(__dirname, '..', '..', 'public', 'js', n)).href);

/** Speicher-Attrappe wie localStorage: Einträge als eigene Schlüssel (Object.keys), Methoden am Prototyp */
class Lager {
  getItem(k) { return Object.prototype.hasOwnProperty.call(this, k) ? this[k] : null; }
  setItem(k, v) { this[k] = String(v); }
  removeItem(k) { delete this[k]; }
}
function mitSpeicher(fn) {
  const alt = { l: globalThis.localStorage, s: globalThis.sessionStorage, w: globalThis.window };
  globalThis.localStorage = new Lager(); globalThis.sessionStorage = new Lager(); globalThis.window = { dispatchEvent() {} };
  try { return fn(); } finally {
    for (const [k, v] of [['localStorage', alt.l], ['sessionStorage', alt.s], ['window', alt.w]]) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  }
}

const FELD = { benutzer: { rolle: 'polier' }, sperreMinuten: 30, sitzungMinuten: 720 };
const BUERO = { benutzer: { rolle: 'buero' }, sperreMinuten: 60, sitzungMinuten: 60 };

test('15.8: Sperre am Gerät – geteilt 30 min (Feld), eigenes Handy = Sitzungsdauer des Servers, Büro unverändert', async () => {
  const A = await modul('api.js');
  assert.equal(A.sperreMinutenFuer(FELD, 'geteilt'), 30);
  assert.equal(A.sperreMinutenFuer(FELD, 'eigen'), 720, 'eigenes Handy: keine 30-min-Sperre, sondern die Sitzungsdauer');
  // nie länger als der Server: genau sitzungMinuten, auch wenn kürzer eingestellt
  assert.equal(A.sperreMinutenFuer({ sperreMinuten: 30, sitzungMinuten: 300 }, 'eigen'), 300);
  // Büro/Bauleiter/GF: Sperre ist ohnehin die Sitzungsdauer – die Gerätewahl ändert nichts
  assert.equal(A.sperreMinutenFuer(BUERO, 'geteilt'), 60);
  assert.equal(A.sperreMinutenFuer(BUERO, 'eigen'), 60);
  // unbekannte Wahl oder ohne Wahl = geteilt
  for (const art of [undefined, null, '', 'EIGEN', 'eigenes', 'x']) assert.equal(A.sperreMinutenFuer(FELD, art), 30, String(art));
  // alter gemerkter Stand ohne sitzungMinuten: es bleibt die Sperre (sicher)
  assert.equal(A.sperreMinutenFuer({ sperreMinuten: 30 }, 'eigen'), 30);
  assert.equal(A.sperreMinutenFuer({ sperreMinuten: 30, sitzungMinuten: 'viel' }, 'eigen'), 30);
  // „eigen“ ist nie strenger als „geteilt“
  assert.equal(A.sperreMinutenFuer({ sperreMinuten: 30, sitzungMinuten: 10 }, 'eigen'), 30);
  assert.equal(A.sperreMinutenFuer(null, 'eigen'), 0);
});

test('15.8: Gerätewahl – Standard „geteilt“, gemerkt je Gerät, ungültige Werte = geteilt', async () => {
  const A = await modul('api.js');
  mitSpeicher(() => {
    assert.equal(A.geraetArt(), 'geteilt', 'Gerät ohne Wahl ist ein geteiltes Gerät');
    assert.equal(A.setzGeraetArt('eigen'), 'eigen');
    assert.equal(A.geraetArt(), 'eigen');
    assert.equal(localStorage.getItem(A.GERAET_ART), 'eigen');
    assert.equal(A.setzGeraetArt('irgendwas'), 'geteilt');
    assert.equal(A.geraetArt(), 'geteilt');
    localStorage.setItem(A.GERAET_ART, '"eigen"');
    assert.equal(A.geraetArt(), 'geteilt', 'nur genau „eigen“ schaltet die Sperre ab');
  });
  // Speicher gesperrt (z. B. privater Modus): sicherer Standard
  const alt = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('gesperrt'); }, setItem() { throw new Error('gesperrt'); } };
  try { assert.equal(A.geraetArt(), 'geteilt'); } finally { if (alt === undefined) delete globalThis.localStorage; else globalThis.localStorage = alt; }
});

test('15.8: die Gerätewahl übersteht das Aufräumen beim Abmelden (R-08), Benutzerdaten nicht', async () => {
  const U = await modul('ui.js');
  const A = await modul('api.js');
  mitSpeicher(() => {
    A.setzGeraetArt('eigen');
    localStorage.setItem('bt_ich', '{"benutzer":{"id":1}}');
    localStorage.setItem('bt_tresor', '{"benutzerId":1}');
    localStorage.setItem('bt_aktiv', '123');
    U.speicher.raeumeBenutzer();
    assert.equal(localStorage.getItem('bt_geraet_art'), 'eigen');
    assert.equal(A.geraetArt(), 'eigen');
    for (const k of ['bt_ich', 'bt_tresor', 'bt_aktiv']) assert.equal(localStorage.getItem(k), null, k);
  });
});

test('15.8: Auswahl in der Oberfläche – zwei Optionen, gewählte markiert, Standard geteilt', async () => {
  const U = await modul('ui.js');
  const zaehle = (h, re) => (h.match(re) || []).length;
  const g = U.geraetWahl('geteilt');
  assert.equal(zaehle(g, /name="geraet-art"/g), 2);
  assert.match(g, /value="geteilt" checked/);
  assert.doesNotMatch(g, /value="eigen" checked/);
  assert.match(g, /Eigenes Handy/);
  assert.match(g, /Geteiltes Gerät/);
  assert.match(g, /Tablet im Bauhof/);
  assert.match(U.geraetWahl('eigen'), /value="eigen" checked/);
  assert.match(U.geraetWahl(undefined), /value="geteilt" checked/);
  assert.match(U.geraetWahl('unsinn'), /data-art="geteilt"/);
});
