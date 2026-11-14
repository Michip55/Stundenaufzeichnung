'use strict';
/**
 * API.md 15.12 (G2-018): Jede Anfrage aus public/js/api.js trägt die Generation der Anmeldung. Nach sitzungWechsel()
 * (Abmelden, Ablauf, neue Anmeldung) werden laufende Anfragen abgebrochen und späte Antworten verworfen – auch wenn der
 * Abbruch nicht greift. Ausnahme: nachgesendete Einträge (`ersteller`, 15.5), auf die das Abmelden wartet.
 * (G2-021): Gerätewahl je Person – bei der Anmeldung einer anderen Person wieder „geteilt“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const modul = (n) => import(pathToFileURL(path.join(__dirname, '..', '..', 'public', 'js', n)).href);

class Lager {
  getItem(k) { return Object.prototype.hasOwnProperty.call(this, k) ? this[k] : null; }
  setItem(k, v) { this[k] = String(v); }
  removeItem(k) { delete this[k]; }
}
async function mitUmgebung(fn) {
  const alt = { l: globalThis.localStorage, w: globalThis.window, f: globalThis.fetch };
  const ereignisse = [];
  globalThis.localStorage = new Lager();
  globalThis.window = { dispatchEvent(e) { ereignisse.push(e.type); } };
  try { return await fn(ereignisse); } finally {
    for (const [k, v] of [['localStorage', alt.l], ['window', alt.w], ['fetch', alt.f]]) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  }
}
/** fetch-Attrappe: hält jede Antwort zurück, bis `frei(i)`; beachtet das AbortSignal nur, wenn `abbrechbar` */
function langsamesNetz({ abbrechbar }) {
  const offen = [];
  const f = (url, opt) => new Promise((ok, nein) => {
    const eintrag = { url, opt, frei: (status = 200, daten = [{ id: 1, titel: 'Rechnung AR-2026-4711 fällig' }]) => ok(new Response(JSON.stringify(daten), { status, headers: { 'content-type': 'application/json' } })) };
    offen.push(eintrag);
    if (abbrechbar && opt.signal) opt.signal.addEventListener('abort', () => { const e = new Error('abgebrochen'); e.name = 'AbortError'; nein(e); });
  });
  return { f, offen };
}

test('15.12 G2-018: späte Antwort nach dem Benutzerwechsel wird verworfen – auch ohne wirksamen Abbruch', async () => {
  const A = await modul('api.js');
  await mitUmgebung(async (ereignisse) => {
    const netz = langsamesNetz({ abbrechbar: false });
    globalThis.fetch = netz.f;
    const p = A.get('/benachrichtigungen');
    await new Promise((r) => setImmediate(r));
    assert.equal(netz.offen.length, 1);
    assert.ok(netz.offen[0].opt.signal, 'jede Anfrage hat ein AbortSignal');
    A.sitzungWechsel(); // Abmelden / neue Anmeldung
    netz.offen[0].frei();
    await assert.rejects(p, (e) => e.veraltet === true && !e.netz && e.status === undefined);
    // auch eine späte 401 löst kein Abmelde-Ereignis für die neue Person aus
    const q = A.get('/fuhrpark/schaeden');
    await new Promise((r) => setImmediate(r));
    A.sitzungWechsel();
    netz.offen[1].frei(401, { code: 'NICHT_ANGEMELDET' });
    await assert.rejects(q, (e) => e.veraltet === true);
    assert.ok(!ereignisse.includes('bt:abgemeldet'), 'kein bt:abgemeldet aus einer alten Anfrage');
  });
});

test('15.12 G2-018: sitzungWechsel bricht laufende Anfragen ab (AbortController); neue Anfragen laufen normal', async () => {
  const A = await modul('api.js');
  await mitUmgebung(async () => {
    const netz = langsamesNetz({ abbrechbar: true });
    globalThis.fetch = netz.f;
    const p = A.get('/benachrichtigungen');
    await new Promise((r) => setImmediate(r));
    const signal = netz.offen[0].opt.signal;
    A.sitzungWechsel();
    assert.equal(signal.aborted, true, 'abgebrochen');
    await assert.rejects(p, (e) => e.veraltet === true && !e.netz);
    const neu = A.get('/benachrichtigungen');
    await new Promise((r) => setImmediate(r));
    assert.equal(netz.offen[1].opt.signal.aborted, false, 'neue Anfrage mit frischem Signal');
    netz.offen[1].frei(200, [{ id: 2 }]);
    assert.deepEqual(await neu, [{ id: 2 }]);
  });
});

test('15.12 G2-018: nachgesendete Einträge (ersteller) werden weder abgebrochen noch verworfen – das Abmelden wartet auf sie', async () => {
  const A = await modul('api.js');
  await mitUmgebung(async () => {
    const netz = langsamesNetz({ abbrechbar: true });
    globalThis.fetch = netz.f;
    const p = A.post('/zeit/stempeln', { typ: 'kommen' }, { ersteller: 1 });
    await new Promise((r) => setImmediate(r));
    assert.equal(netz.offen[0].opt.signal, undefined);
    assert.equal(netz.offen[0].opt.headers['X-BauTag-Ersteller'], '1');
    A.sitzungWechsel();
    netz.offen[0].frei(201, { ok: true });
    assert.deepEqual(await p, { ok: true });
  });
});

test('15.12 G2-021: „Eigenes Handy“ gilt nur für die Person, die es gewählt hat', async () => {
  const A = await modul('api.js');
  await mitUmgebung(async () => {
    // neues Gerät, Person 1 wählt vor der Anmeldung „eigen“ und meldet sich an → bleibt, gehört jetzt Person 1
    A.setzGeraetArt('eigen');
    assert.equal(A.geraetArtInhaber(), null);
    assert.deepEqual(A.geraetArtBeiAnmeldung(1, null), { art: 'eigen', zurueckgesetzt: false });
    assert.equal(A.geraetArtInhaber(), 1);
    // dieselbe Person meldet sich wieder an → behält die Wahl
    assert.deepEqual(A.geraetArtBeiAnmeldung(1, 1), { art: 'eigen', zurueckgesetzt: false });
    assert.equal(A.geraetArt(), 'eigen');
    // eine andere Person meldet sich an → „geteilt“, deutlich zeigen
    assert.deepEqual(A.geraetArtBeiAnmeldung(2, 1), { art: 'geteilt', zurueckgesetzt: true });
    assert.equal(A.geraetArt(), 'geteilt');
    assert.equal(A.geraetArtInhaber(), 2);
    assert.equal(localStorage.getItem(A.GERAET_ART), 'geteilt');
    // Vorbenutzer 2 stellt auf der Anmeldeseite (ohne Anmeldung) „eigen“ ein → gilt nicht für Person 3
    A.setzGeraetArt('eigen');
    assert.deepEqual(A.geraetArtBeiAnmeldung(3, 2), { art: 'geteilt', zurueckgesetzt: true });
    // … aber für die Person, die zuletzt angemeldet war und es dort eingestellt hat
    A.setzGeraetArt('eigen');
    assert.deepEqual(A.geraetArtBeiAnmeldung(3, 3), { art: 'eigen', zurueckgesetzt: false });
    // in „Mehr“ gewählt: gehört der angemeldeten Person, auch wenn bt_geraet_benutzer anders lautet
    A.setzGeraetArt('eigen', 5);
    assert.deepEqual(A.geraetArtBeiAnmeldung(3, 3), { art: 'geteilt', zurueckgesetzt: true });
    // gemerkter Altbestand ohne Inhaber: die zuletzt angemeldete Person zählt
    localStorage.removeItem(A.GERAET_ART_BENUTZER); localStorage.setItem(A.GERAET_ART, 'eigen');
    assert.deepEqual(A.geraetArtBeiAnmeldung(7, 6), { art: 'geteilt', zurueckgesetzt: true });
    // bereits „geteilt“: Wechsel ohne Hinweis
    assert.deepEqual(A.geraetArtBeiAnmeldung(8, 7), { art: 'geteilt', zurueckgesetzt: false });
  });
});

test('15.12 G2-021: Inhaber der Gerätewahl übersteht das Aufräumen beim Abmelden (R-08)', async () => {
  const U = await modul('ui.js');
  const A = await modul('api.js');
  await mitUmgebung(async () => {
    globalThis.sessionStorage = new Lager();
    try {
      A.setzGeraetArt('eigen', 4);
      U.speicher.raeumeBenutzer();
      assert.equal(A.geraetArt(), 'eigen');
      assert.equal(A.geraetArtInhaber(), 4);
      assert.match(U.geraetWahl('eigen'), /Gilt nur für die Person, die es gewählt hat/);
    } finally { delete globalThis.sessionStorage; }
  });
});
