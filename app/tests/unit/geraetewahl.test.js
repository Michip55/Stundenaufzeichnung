'use strict';
/**
 * API.md 15.8 – Gerätewahl „Eigenes Handy“ / „Geteiltes Gerät“ (reine Regeln der App, public/js/api.js und ui.js).
 * Sperre nach Untätigkeit je Gerätewahl, Wahl gehört zum Gerät und übersteht das Abmelden. 15.21: Standard der Anmeldeseite
 * „Eigenes Handy“ (wirksam erst mit der Anmeldung einer Person); ohne lesbaren Speicher bleibt es „geteilt“.
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

test('15.8 / 15.21: Gerätewahl – Standard „Eigenes Handy“, gemerkt je Gerät, wirksam nur genau „eigen“ der Person', async () => {
  const A = await modul('api.js');
  mitSpeicher(() => {
    assert.equal(A.geraetArt(), 'eigen', '15.21: Gerät ohne Wahl zeigt „Eigenes Handy“');
    assert.equal(A.geraetArtFuer(1), 'geteilt', '… wirksam aber erst mit der Anmeldung');
    assert.equal(A.setzGeraetArt('geteilt'), 'geteilt');
    assert.equal(A.geraetArt(), 'geteilt', '„Geteiltes Gerät“ wird für das Gerät gemerkt');
    assert.equal(A.setzGeraetArt('eigen', 1), 'eigen');
    assert.equal(A.geraetArt(), 'eigen');
    assert.equal(A.geraetArtFuer(1), 'eigen');
    assert.equal(localStorage.getItem(A.GERAET_ART), 'eigen');
    assert.equal(A.setzGeraetArt('irgendwas', 1), 'geteilt');
    assert.equal(A.geraetArt(), 'geteilt');
    assert.equal(A.geraetArtFuer(1), 'geteilt');
    localStorage.setItem(A.GERAET_ART, '"eigen"'); localStorage.setItem(A.GERAET_ART_BENUTZER, '1');
    assert.equal(A.geraetArtFuer(1), 'geteilt', 'nur genau „eigen“ schaltet die Sperre ab');
  });
  // Speicher gesperrt (z. B. privater Modus): sicherer Standard
  const alt = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('gesperrt'); }, setItem() { throw new Error('gesperrt'); } };
  try { assert.equal(A.geraetArt(), 'geteilt'); assert.equal(A.geraetArtFuer(1), 'geteilt'); } finally { if (alt === undefined) delete globalThis.localStorage; else globalThis.localStorage = alt; }
});

test('15.8: die Gerätewahl übersteht das Aufräumen beim Abmelden (R-08), Benutzerdaten nicht', async () => {
  const U = await modul('ui.js');
  const A = await modul('api.js');
  mitSpeicher(() => {
    A.setzGeraetArt('eigen', 1);
    localStorage.setItem('bt_ich', '{"benutzer":{"id":1}}');
    localStorage.setItem('bt_tresor', '{"benutzerId":1}');
    localStorage.setItem('bt_aktiv', '123');
    U.speicher.raeumeBenutzer();
    assert.equal(localStorage.getItem('bt_geraet_art'), 'eigen');
    assert.equal(A.geraetArtFuer(1), 'eigen');
    for (const k of ['bt_ich', 'bt_tresor', 'bt_aktiv']) assert.equal(localStorage.getItem(k), null, k);
  });
});

test('15.8 / 15.21: Auswahl in der Oberfläche – zwei Optionen, gewählte markiert, Texte', async () => {
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
  // 15.21: kein „erst nach Bestätigung“ mehr; Anmeldeseite sagt, für wen es gilt
  const anm = U.geraetWahl('eigen', { anmeldeseite: true });
  assert.match(anm, /Gilt ab der Anmeldung für die Person, die sich jetzt anmeldet/);
  assert.doesNotMatch(anm, /bestätigen|wieder ein „Geteiltes Gerät“/);
  assert.match(U.geraetWahl('geteilt', { anmeldeseite: true }), /30 Minuten/);
});

test('15.28: Wochen-Sitzung am eigenen Handy – keine Abmeldung nach Untätigkeit am Gerät; geteilt unverändert', async () => {
  const A = await modul('api.js');
  for (const rolle of ['mitarbeiter', 'polier', 'bauleiter', 'buero', 'gf']) {
    const feld = ['mitarbeiter', 'polier'].includes(rolle);
    const ich = { benutzer: { rolle }, sperreMinuten: feld ? 30 : 60, sitzungMinuten: feld ? 720 : 60, sitzungArt: 'woche', sitzungBis: '2026-11-22T23:00:00.000Z' };
    assert.equal(A.sperreMinutenFuer(ich, 'eigen'), 0, `${rolle}: eigenes Handy mit Woche → keine Sperre`);
    assert.equal(A.sperreMinutenFuer(ich, 'geteilt'), feld ? 30 : 60, `${rolle}: geteiltes Gerät unverändert`);
    for (const art of [undefined, null, '', 'EIGEN', 'x']) assert.equal(A.sperreMinutenFuer(ich, art), feld ? 30 : 60, `${rolle}/${art}`);
    // normale Sitzung (z. B. als geteiltes Gerät angemeldet, danach in „Mehr“ eigen) → wie 15.8
    assert.equal(A.sperreMinutenFuer({ ...ich, sitzungArt: 'normal' }, 'eigen'), feld ? 720 : 60, `${rolle}: normale Sitzung wie 15.8`);
    assert.equal(A.sperreMinutenFuer({ ...ich, sitzungArt: undefined }, 'eigen'), feld ? 720 : 60, `${rolle}: alter Stand ohne sitzungArt wie 15.8`);
  }
});

test('15.28: Texte – „Eigenes Handy“ sagt „bis Sonntag … am Montag einmal die PIN“, „Geteiltes Gerät“ unverändert', async () => {
  const U = await modul('ui.js');
  assert.match(U.GERAET_TEXT.eigen, /^Du bleibst bis Sonntag angemeldet\. Am Montag fragt die App einmal nach der PIN\./);
  assert.equal(U.GERAET_TEXT.geteilt, 'Mitarbeiter und Polier werden nach 30 Minuten ohne Bedienung automatisch abgemeldet, damit niemand unter fremdem Namen weiterarbeitet.');
  assert.match(U.geraetWahl('eigen', { anmeldeseite: true }), /Du bleibst bis Sonntag angemeldet\. Am Montag fragt die App einmal nach der PIN\./);
  const mehr = U.geraetWahl('eigen', { klasse: 'im-menue', woche: true });
  assert.match(mehr, /Du bleibst bis Sonntag angemeldet/);
  assert.match(mehr, /data-woche="1"/);
  assert.match(mehr, /Gilt für dich an diesem Gerät/);
  const spaeter = U.geraetWahl('eigen', { klasse: 'im-menue', woche: false });
  assert.match(spaeter, /data-woche="0"/);
  assert.match(spaeter, /Gilt ab deiner nächsten Anmeldung mit PIN/);
  assert.doesNotMatch(U.geraetWahl('eigen', { anmeldeseite: true }), /data-woche/);
  // Namen der Optionen bleiben
  assert.match(mehr, /<b>Eigenes Handy<\/b>/);
  assert.match(mehr, /<b>Geteiltes Gerät<\/b>/);
});

test('15.33: gemerkte Person am eigenen Handy – nur „eigen“ dieser Person, ersetzt, übersteht Abmelden, weg bei „Geteiltes Gerät“', async () => {
  const A = await modul('api.js');
  mitSpeicher(() => {
    const ma = { id: 2, name: 'Lukas Brandstätter', pnr: 1002 };
    const po = { id: 1, name: 'Josef Haidbauer', pnr: 1001 };
    // ohne Anmeldung mit „Eigenes Handy“ (Gerätewahl noch nicht dieser Person zugeordnet): nichts gemerkt
    A.merkeHandyPerson(ma);
    assert.equal(A.handyPerson(), null);
    // Anmeldung mit „Eigenes Handy“ (app.js: geraetArtBeiAnmeldung, dann merkeHandyPerson)
    A.geraetArtBeiAnmeldung(ma.id); A.merkeHandyPerson(ma);
    assert.deepEqual(A.handyPerson(), { id: 2, pnr: 1002, name: 'Lukas Brandstätter' });
    // eine andere Person meldet sich am eigenen Handy an → ersetzt die gemerkte
    A.geraetArtBeiAnmeldung(po.id); A.merkeHandyPerson(po);
    assert.deepEqual(A.handyPerson(), { id: 1, pnr: 1001, name: 'Josef Haidbauer' });
    // ohne Personalnummer lässt sich niemand mit Namen anmelden → nichts gemerkt
    A.geraetArtBeiAnmeldung(9); A.merkeHandyPerson({ id: 9, name: 'Ohne Nummer', pnr: null });
    assert.equal(A.handyPerson(), null);
    A.geraetArtBeiAnmeldung(ma.id); A.merkeHandyPerson(ma);
    // Stand ohne Feld pnr (altes gemerktes bt_ich, ohne Netz): dieselbe Person bleibt gemerkt, eine andere wird vergessen
    A.merkeHandyPerson({ id: ma.id, name: ma.name });
    assert.equal(A.handyPerson().pnr, 1002);
    A.geraetArtBeiAnmeldung(po.id); A.merkeHandyPerson({ id: po.id, name: po.name });
    assert.equal(A.handyPerson(), null);
    A.geraetArtBeiAnmeldung(ma.id); A.merkeHandyPerson(ma);
    // „Geteiltes Gerät“ (Anmeldeseite oder „Mehr“) → sofort vergessen, auch der Name im Speicher
    A.geraetVorwahl('geteilt');
    assert.equal(A.handyPerson(), null);
    assert.equal(localStorage.getItem(A.HANDY_PERSON), null);
    // am geteilten Gerät wird nie gemerkt – auch nicht nach einer Anmeldung
    A.geraetArtBeiAnmeldung(ma.id); A.merkeHandyPerson(ma);
    assert.equal(localStorage.getItem(A.HANDY_PERSON), null);
    // in „Mehr“ „Eigenes Handy“ gewählt → gemerkt; „Geteiltes Gerät“ in „Mehr“ → vergessen
    A.setzGeraetArt('eigen', ma.id); A.merkeHandyPerson(ma);
    assert.equal(A.handyPerson().pnr, 1002);
    A.setzGeraetArt('geteilt', ma.id); A.merkeHandyPerson(ma);
    assert.equal(localStorage.getItem(A.HANDY_PERSON), null);
    // kaputter oder fremder Inhalt → keine gemerkte Person
    A.setzGeraetArt('eigen', ma.id);
    for (const roh of ['x', '{}', '{"pnr":"1002","name":"A"}', '{"pnr":0,"name":"A"}', '{"pnr":1002,"name":""}']) {
      localStorage.setItem(A.HANDY_PERSON, roh);
      assert.equal(A.handyPerson(), null, roh);
    }
  });
});

test('15.33: bt_handy_person übersteht das Abmelden (R-08 räumt nur Daten der Person ab), bt_letzte_pnr nicht mehr', async () => {
  const A = await modul('api.js');
  const U = await modul('ui.js');
  mitSpeicher(() => {
    A.geraetArtBeiAnmeldung(2); A.merkeHandyPerson({ id: 2, name: 'Lukas Brandstätter', pnr: 1002 });
    localStorage.setItem('bt_letzte_pnr', '"1002"');
    localStorage.setItem('bt_ich', '{"benutzer":{"id":2}}');
    U.speicher.raeumeBenutzer();
    assert.equal(A.handyPerson().name, 'Lukas Brandstätter');
    assert.equal(localStorage.getItem('bt_letzte_pnr'), null);
    assert.equal(localStorage.getItem('bt_ich'), null);
  });
});
