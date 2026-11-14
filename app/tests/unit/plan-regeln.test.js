'use strict';
/** Reine Regeln der Planer-/Fuhren-Oberfläche (public/js/plan-regeln.js) – Korrekturen Nachprüfung (API.md 14.1) */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const laden = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'public', 'js', 'plan-regeln.js')).href);

test('N-017: Fuhren-Warteschlange behält 401/403 (wie die Stempel-Warteschlange), verwirft nur endgültige Ablehnungen', async () => {
  const R = await laden();
  for (const x of [{ netz: true }, { status: 500 }, { status: 503 }, { status: 429 }, { status: 408 }, { status: 401 }, { status: 403, code: 'PIN_AENDERN' }, { status: 403, code: '2FA_EINRICHTEN' }, { status: 403 }]) assert.equal(R.fuhreVorlaeufig(x), true, JSON.stringify(x));
  for (const x of [{ status: 400 }, { status: 404 }, { status: 409 }, { status: 422 }]) assert.equal(R.fuhreVorlaeufig(x), false, JSON.stringify(x));
  assert.equal(R.fuhreAnmeldungNoetig({ status: 401 }), true);
  assert.equal(R.fuhreAnmeldungNoetig({ netz: true }), false);
});

test('15.7 (N-017 Rest): 403 KEIN_ZUGRIFF (z. B. nach Fahrerwechsel) ist endgültig – nicht gemerkt, keine Anmelde-Meldung', async () => {
  const R = await laden();
  const x = { status: 403, code: 'KEIN_ZUGRIFF', message: 'Den Status meldet der eingeteilte Fahrer.' };
  assert.equal(R.fuhreVorlaeufig(x), false);
  assert.equal(R.fuhreAnmeldungNoetig(x), false);
  assert.equal(R.fuhreAnmeldungNoetig({ status: 403, code: 'PIN_AENDERN' }), true);
});

test('N-039: die zuletzt gemerkte Meldung je Fuhre zählt', async () => {
  const R = await laden();
  const w = [{ fuhreId: 5, body: { status: 'unterwegs' } }, { fuhreId: 6, body: { status: 'unterwegs' } }, { fuhreId: 5, body: { status: 'erledigt', menge: 12 } }];
  assert.equal(R.letzteMeldung(w, 5).body.status, 'erledigt');
  assert.equal(R.letzteMeldung(w, '6').body.status, 'unterwegs');
  assert.equal(R.letzteMeldung(w, 7), null);
});

test('N-102: LKW-Auswahl nur Klasse LKW, gesperrte gekennzeichnet', async () => {
  const R = await laden();
  const anl = [
    { id: 1, klasse: 'lkw', bezeichnung: 'LKW 3-Achser', kennzeichen: 'NK-301 BP', status: 'einsatzbereit' },
    { id: 3, klasse: 'lkw', bezeichnung: 'LKW 4-Achser', kennzeichen: 'NK-303 BP', status: 'gesperrt', gesperrt: true },
    { id: 6, klasse: 'anhaenger', bezeichnung: 'Kippsattel', kennzeichen: 'NK-306 BP' },
    { id: 10, klasse: 'bus', bezeichnung: 'Mannschaftsbus', kennzeichen: 'NK-311 BP' },
    { id: 13, klasse: 'pkw', bezeichnung: 'PKW Dacia Duster', kennzeichen: 'NK-322 BP' },
    { id: 20, klasse: 'baumaschine', bezeichnung: 'Radlader CASE 721G', kennzeichen: 'NK-342 BP' },
    { id: 9, klasse: 'lkw', bezeichnung: 'Alt', status: 'ausgeschieden' }
  ];
  assert.deepEqual(anl.filter(R.istLkw).map((a) => a.id), [1, 3]);
  assert.equal(R.lkwText(anl[1]), 'LKW 4-Achser · NK-303 BP – gesperrt');
  assert.equal(R.lkwText(anl[0]), 'LKW 3-Achser · NK-301 BP');
});

test('N-092: „Für weitere Tage kopieren“ ohne Feiertage und Wochenenden', async () => {
  const R = await laden();
  assert.deepEqual(R.kopieTage('2026-12-07', 5, new Set(['2026-12-08'])), ['2026-12-09', '2026-12-10', '2026-12-11', '2026-12-14', '2026-12-15']);
  assert.deepEqual(R.kopieTage('2026-11-12', 3, new Set()), ['2026-11-13', '2026-11-16', '2026-11-17']);
});

test('N-049: Zähler oben zählt Vorschau-Einsätze mit', async () => {
  const R = await laden();
  const d = { unveroeffentlicht: 0, einsaetze: [{ baustelleId: 1, vorschau: true }, { baustelleId: 2, vorschau: true }, { baustelleId: 1, veroeffentlicht: true }] };
  assert.equal(R.pubAnzahl(d), 2);
  assert.equal(R.pubAnzahl({ ...d, unveroeffentlicht: 1 }, (id) => id === 1), 2);
  assert.equal(R.pubAnzahl({ unveroeffentlicht: 0, einsaetze: [] }), 0);
});

test('N-098: Notizen-Knopf nennt den Quelltag', async () => {
  const R = await laden();
  assert.equal(R.vortagNotizenText('2026-11-16', '2026-11-13'), 'Notizen von Mo 16.11. übernehmen');
  assert.equal(R.vortagNotizenText('2026-11-12', '2026-11-13'), 'Notizen von gestern übernehmen');
  assert.equal(R.vortagNotizenText('2026-11-13', '2026-11-13'), 'Notizen von heute übernehmen');
  assert.equal(R.vortagNotizenToast('2026-11-16', '2026-11-13'), 'Notizen von Mo 16.11. übernommen.');
});

test('N-094: Rückmeldung nennt verschiedene Personen, Nachrichten getrennt', async () => {
  const R = await laden();
  assert.equal(R.pubToast({ benachrichtigt: 4, personen: 3 }), 'Veröffentlicht – 3 Personen benachrichtigt (4 Nachrichten).');
  assert.equal(R.pubToast({ benachrichtigt: 1, personen: 1 }), 'Veröffentlicht – 1 Person benachrichtigt.');
  assert.equal(R.pubToast({ benachrichtigt: 0, personen: 0 }), 'Veröffentlicht – 0 Personen benachrichtigt.');
});

test('N-097: Mein Einsatz – Wochenende/Feiertag statt „noch nicht eingeteilt“, Leertext mit nächstem Arbeitstag', async () => {
  const R = await laden();
  const frei = new Set(['2026-12-08']); frei.namen = new Map([['2026-12-08', 'Mariä Empfängnis']]);
  assert.equal(R.wochenLeerText('2026-12-08', frei), 'Feiertag: Mariä Empfängnis');
  assert.equal(R.wochenLeerText('2026-12-12', frei), 'frei (Wochenende)');
  assert.equal(R.wochenLeerText('2026-12-09', frei), 'noch nicht eingeteilt');
  assert.equal(R.einsatzLeerText('2026-11-12', '2026-11-13'), 'Für heute und morgen ist noch kein Einsatz veröffentlicht.');
  assert.equal(R.einsatzLeerText('2026-11-13', '2026-11-16'), 'Für heute und den nächsten Arbeitstag (Mo 16.11.) ist noch kein Einsatz veröffentlicht.');
});

test('N-058: Reiter „Meine Partie“ mit Samstagseinsatz vor dem Montag', async () => {
  const R = await laden();
  assert.deepEqual(R.partieReiter('2026-11-13', '2026-11-14', '2026-11-16'), ['2026-11-13', '2026-11-14', '2026-11-16']);
  assert.deepEqual(R.partieReiter('2026-11-13', '2026-11-16', '2026-11-16'), ['2026-11-13', '2026-11-16']);
  assert.deepEqual(R.partieReiter('2026-11-12', '2026-11-13', '2026-11-13'), ['2026-11-12', '2026-11-13']);
});

test('15.7: „Plan veröffentlichen“ zählt nur echte Änderungen, Vorschau-Tage stehen getrennt', async () => {
  const R = await laden();
  // nach dem Veröffentlichen von Mo: Di–Fr nur Vorschau (je zwei Zellen) – früher „· 8 Änderungen“
  const vor = ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'].flatMap((datum) => [1, 2].map((bs) => ({ datum, baustelleId: bs, vorschau: true })));
  const d = { unveroeffentlicht: 0, einsaetze: [{ datum: '2026-11-16', baustelleId: 1 }, ...vor] };
  assert.equal(R.pubBeschriftung(d).text, 'Plan veröffentlichen · Di–Fr vorbereitet');
  assert.equal(R.pubBeschriftung(d).aenderungen, 0);
  assert.equal(R.pubAnzahl(d), 8, 'Knopf bleibt aktiv (N-049)');
  assert.equal(R.pubBeschriftung({ ...d, unveroeffentlicht: 2 }).text, 'Plan veröffentlichen · 2 Änderungen · Di–Fr vorbereitet');
  assert.equal(R.pubBeschriftung({ unveroeffentlicht: 1, einsaetze: [] }).text, 'Plan veröffentlichen · 1 Änderung');
  assert.equal(R.pubBeschriftung({ unveroeffentlicht: 0, einsaetze: [{ datum: '2026-11-17', baustelleId: 1, vorschau: true }, { datum: '2026-11-19', baustelleId: 1, vorschau: true }] }).text, 'Plan veröffentlichen · Di, Do vorbereitet');
  // über das Wochenende: Fr und Mo sind aufeinanderfolgende Arbeitstage
  assert.equal(R.pubBeschriftung({ unveroeffentlicht: 0, einsaetze: [{ datum: '2026-11-20', baustelleId: 1, vorschau: true }, { datum: '2026-11-23', baustelleId: 1, vorschau: true }] }).text, 'Plan veröffentlichen · Fr–Mo vorbereitet');
  // Vorschau fremder Baustellen zählt nicht
  assert.equal(R.pubBeschriftung(d, (id) => id === 3).text, 'Plan veröffentlichen');
});
