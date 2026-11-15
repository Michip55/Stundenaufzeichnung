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

test('15.16 H-S2: jede Anfrage nennt die Person des Rahmens (X-BauTag-Ich); 409 ANMELDUNG_ANDERS → verworfen, Seite sperrt sich', async () => {
  const A = await modul('api.js');
  await mitUmgebung(async (ereignisse) => {
    const netz = langsamesNetz({ abbrechbar: true });
    globalThis.fetch = netz.f;
    A.sitzungWechsel();
    const p0 = A.get('/auth/ich');
    await new Promise((r) => setImmediate(r));
    assert.equal(netz.offen[0].opt.headers['X-BauTag-Ich'], undefined, 'vor GET /auth/ich ist die Person unbekannt');
    netz.offen[0].frei(200, { benutzer: { id: 101 } });
    await p0;
    A.setzAngemeldet(101);
    const p1 = A.get('/offene-posten');
    await new Promise((r) => setImmediate(r));
    assert.equal(netz.offen[1].opt.headers['X-BauTag-Ich'], '101');
    // im anderen Tab ist inzwischen der Polier angemeldet: der Server antwortet 409 – nichts wird übernommen
    netz.offen[1].frei(409, { code: 'ANMELDUNG_ANDERS', fehler: 'An diesem Gerät ist inzwischen eine andere Person angemeldet.' });
    await assert.rejects(p1, (e) => e.veraltet === true && !e.netz && e.status === undefined);
    assert.ok(ereignisse.includes('bt:fremd'), 'die Seite wird gesperrt');
    // An-/Abmelden und die Namensliste tragen den Kopf nie; nachgesendete Einträge nennen ihren Ersteller
    for (const [m, pf] of [['POST', '/auth/login'], ['POST', '/auth/logout'], ['GET', '/auth/benutzerliste']]) {
      const q = A.api(m, pf, m === 'GET' ? undefined : {});
      await new Promise((r) => setImmediate(r));
      assert.equal(netz.offen.at(-1).opt.headers['X-BauTag-Ich'], undefined, pf);
      netz.offen.at(-1).frei(200, {}); await q;
    }
    const q2 = A.post('/zeit/stempeln', { typ: 'kommen' }, { ersteller: 101 });
    await new Promise((r) => setImmediate(r));
    assert.equal(netz.offen.at(-1).opt.headers['X-BauTag-Ich'], undefined);
    netz.offen.at(-1).frei(201, {}); await q2;
    // nach dem Abmelden / einer neuen Anmeldung nennt keine Anfrage mehr die vorige Person
    A.sitzungWechsel();
    const p3 = A.get('/benachrichtigungen');
    await new Promise((r) => setImmediate(r));
    assert.equal(netz.offen.at(-1).opt.headers['X-BauTag-Ich'], undefined);
    netz.offen.at(-1).frei(200, []); await p3;
  });
});

test('15.16 H-S1: vorgemerktes Abmelden geht vor jeder anderen Anfrage hinaus – auch vor einer, die während des Abmeldens startet', async () => {
  const A = await modul('api.js');
  await mitUmgebung(async () => {
    const netz = langsamesNetz({ abbrechbar: true });
    globalThis.fetch = netz.f;
    globalThis.document = { cookie: '' };
    globalThis.location = { protocol: 'http:' };
    try {
      A.abmeldenVormerken(); A.bindungLoeschen(); A.sitzungWechsel();
      const ab = A.abmeldenSenden();
      const p = A.get('/offene-posten'); // z. B. Klick der nächsten Person, während POST /auth/logout unterwegs ist
      await new Promise((r) => setImmediate(r));
      assert.deepEqual(netz.offen.map((x) => x.url), ['/api/auth/logout'], 'nur das Abmelden ist unterwegs');
      assert.match(globalThis.document.cookie, /bt_bindung=;.*Max-Age=0/, 'Bindungs-Cookie sofort gelöscht');
      netz.offen[0].frei(200, { ok: true });
      await ab;
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(netz.offen[1].url, '/api/offene-posten', 'erst danach – ohne gültige Sitzung');
      assert.equal(A.abmeldenOffen(), false);
      netz.offen[1].frei(401, { code: 'NICHT_ANGEMELDET' });
      await assert.rejects(p, (e) => e.status === 401);
    } finally { delete globalThis.document; delete globalThis.location; }
  });
});

test('15.12 G2-021 / 15.16 H-S4: „Eigenes Handy“ gilt nur für die Person, die es nach ihrer Anmeldung gewählt hat', async () => {
  const A = await modul('api.js');
  await mitUmgebung(async () => {
    const nichts = { art: 'geteilt', zurueckgesetzt: false, bestaetigen: false };
    // nie gewählt: ein Benutzerwechsel speichert nichts (R-08: nur nötige Gerätedaten), es gilt „geteilt“
    assert.deepEqual(A.geraetArtBeiAnmeldung(2, 1), nichts);
    assert.equal(localStorage.getItem(A.GERAET_ART), null);
    assert.equal(localStorage.getItem(A.GERAET_ART_BENUTZER), null);
    // 15.16 (H-S4): neues Gerät, auf der Anmeldeseite (ohne Anmeldung) „eigen“ gewählt → gilt NICHT, auch nicht für die erste Person:
    // „geteilt“ (mit dieser Person gespeichert), die App fragt nach der Anmeldung nach (bestaetigen)
    A.geraetVorwahl('eigen');
    assert.equal(A.geraetArtInhaber(), null);
    assert.equal(A.geraetArtFuer(1), 'geteilt', 'vor der Bestätigung nie „eigen“');
    assert.deepEqual(A.geraetArtBeiAnmeldung(1, null), { art: 'geteilt', zurueckgesetzt: false, bestaetigen: true });
    assert.equal(A.geraetArt(), 'geteilt');
    assert.equal(A.geraetArtInhaber(), 1);
    // die angemeldete Person bestätigt (Hinweis bzw. „Mehr“) → gehört ihr; dieselbe Person behält die Wahl beim erneuten Anmelden
    A.setzGeraetArt('eigen', 1);
    assert.deepEqual(A.geraetArtBeiAnmeldung(1, 1), { art: 'eigen', zurueckgesetzt: false, bestaetigen: false });
    assert.equal(A.geraetArtFuer(1), 'eigen');
    assert.equal(A.geraetArtFuer(2), 'geteilt');
    // ein Klick auf „Eigenes Handy“ an der Anmeldeseite nimmt der Person ihre Wahl nicht weg (kein stilles Umschreiben)
    A.geraetVorwahl('eigen');
    assert.equal(A.geraetArtInhaber(), 1);
    assert.deepEqual(A.geraetArtBeiAnmeldung(1, 1), { art: 'eigen', zurueckgesetzt: false, bestaetigen: false });
    // eine andere Person meldet sich an → „geteilt“, deutlich zeigen
    assert.deepEqual(A.geraetArtBeiAnmeldung(2, 1), { art: 'geteilt', zurueckgesetzt: true, bestaetigen: false });
    assert.equal(A.geraetArt(), 'geteilt');
    assert.equal(A.geraetArtInhaber(), 2);
    assert.equal(localStorage.getItem(A.GERAET_ART), 'geteilt');
    // Vorbenutzer 2 stellt auf der Anmeldeseite (ohne Anmeldung) „eigen“ ein → gilt nicht für Person 3
    A.geraetVorwahl('eigen');
    assert.deepEqual(A.geraetArtBeiAnmeldung(3, 2), { art: 'geteilt', zurueckgesetzt: false, bestaetigen: true });
    // 15.16 (H-S4): … und auch NICHT für die zuletzt angemeldete Person (Befund: Voreinstellung vor der Anmeldung des Poliers)
    A.geraetVorwahl('eigen');
    assert.deepEqual(A.geraetArtBeiAnmeldung(3, 3), { art: 'geteilt', zurueckgesetzt: false, bestaetigen: true });
    assert.equal(A.geraetArtFuer(3), 'geteilt');
    // „Geteiltes Gerät“ auf der Anmeldeseite gilt sofort (sicherer)
    A.setzGeraetArt('eigen', 3);
    A.geraetVorwahl('geteilt');
    assert.equal(A.geraetArt(), 'geteilt');
    assert.deepEqual(A.geraetArtBeiAnmeldung(3, 3), nichts);
    // in „Mehr“ gewählt: gehört der angemeldeten Person, auch wenn bt_geraet_benutzer anders lautet
    A.setzGeraetArt('eigen', 5);
    assert.deepEqual(A.geraetArtBeiAnmeldung(3, 3), { art: 'geteilt', zurueckgesetzt: true, bestaetigen: false });
    // gemerkter Altbestand ohne Inhaber: gilt für niemanden, auch nicht für die zuletzt angemeldete Person
    localStorage.removeItem(A.GERAET_ART_BENUTZER); localStorage.setItem(A.GERAET_ART, 'eigen');
    assert.deepEqual(A.geraetArtBeiAnmeldung(6, 6), { art: 'geteilt', zurueckgesetzt: false, bestaetigen: true });
    localStorage.removeItem(A.GERAET_ART_BENUTZER); localStorage.setItem(A.GERAET_ART, 'eigen');
    assert.deepEqual(A.geraetArtBeiAnmeldung(7, 6), { art: 'geteilt', zurueckgesetzt: false, bestaetigen: true });
    // bereits „geteilt“: Wechsel ohne Hinweis
    assert.deepEqual(A.geraetArtBeiAnmeldung(8, 7), nichts);
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

test('15.12: Push nach der Anmeldung still wieder einschalten – nur dieselbe Person, eigenes Handy, Browser hat erlaubt', async () => {
  const A = await modul('api.js');
  const U = await modul('ui.js');
  await mitUmgebung(async () => {
    globalThis.sessionStorage = new Lager();
    try {
      // Person 1: eigenes Handy (in „Mehr“ gewählt) und Push eingeschaltet
      A.setzGeraetArt('eigen', 1);
      A.setzPushWunsch(1, true);
      assert.equal(A.pushGewuenscht(1), true);
      assert.equal(A.pushNachAnmeldung(1, 'granted'), true, 'dieselbe Person, erlaubt, eigenes Handy');
      // Erlaubnis des Browsers fehlt oder wurde verweigert → nichts (keine Rückfrage)
      assert.equal(A.pushNachAnmeldung(1, 'default'), false);
      assert.equal(A.pushNachAnmeldung(1, 'denied'), false);
      assert.equal(A.pushNachAnmeldung(1, undefined), false);
      // der Wunsch übersteht das Aufräumen beim Abmelden (R-08), enthält nur die ID
      U.speicher.raeumeBenutzer();
      assert.equal(localStorage.getItem(A.PUSH_WUNSCH), '[1]');
      assert.equal(A.pushNachAnmeldung(1, 'granted'), true);
      // Benutzerwechsel: Person 2 bekommt den Wunsch von Person 1 nie – auch nicht auf „eigen“
      assert.equal(A.pushNachAnmeldung(2, 'granted'), false, 'nie der Wunsch einer anderen Person');
      A.geraetArtBeiAnmeldung(2, 1); // Wechsel → „geteilt“, Inhaber 2
      assert.equal(A.pushNachAnmeldung(2, 'granted'), false);
      assert.equal(A.pushNachAnmeldung(1, 'granted'), false, 'Wahl gehört jetzt Person 2 – auch Person 1 nicht ohne eigene Wahl');
      // geteiltes Gerät: auch derselben Person nie automatisch (dort schaltet sie Push nach jeder Anmeldung selbst ein)
      A.setzGeraetArt('geteilt', 1);
      assert.equal(A.pushNachAnmeldung(1, 'granted'), false);
      // Person 2 schaltet selbst ein und wählt „eigen“ → nur für sie
      A.setzGeraetArt('eigen', 2); A.setzPushWunsch(2, true);
      assert.equal(A.pushNachAnmeldung(2, 'granted'), true);
      assert.deepEqual(JSON.parse(localStorage.getItem(A.PUSH_WUNSCH)), [1, 2]);
      // bewusst ausgeschaltet → nicht wieder ein
      A.setzPushWunsch(2, false);
      assert.equal(A.pushNachAnmeldung(2, 'granted'), false);
      // 15.16 (H-S4): Wahl „eigen“ ohne Inhaber (Anmeldeseite) → nie still Push, auch nicht für die Person mit Push-Wunsch
      A.setzPushWunsch(2, true);
      A.geraetVorwahl('geteilt'); A.geraetVorwahl('eigen');
      assert.equal(A.geraetArt(), 'eigen');
      assert.equal(A.pushNachAnmeldung(2, 'granted'), false);
      assert.equal(A.pushNachAnmeldung(2, 'granted', 'eigen'), false, 'auch nicht mit übergebener Art');
      // kaputter Speicher → sicher „nein“
      localStorage.setItem(A.PUSH_WUNSCH, '{"x":1}');
      assert.equal(A.pushGewuenscht(1), false);
    } finally { delete globalThis.sessionStorage; }
  });
});
