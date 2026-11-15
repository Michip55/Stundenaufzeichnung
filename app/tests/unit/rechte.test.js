'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../server/rechte');

test('Standard-Matrix entspricht API.md', () => {
  const eff = (rolle) => R.effektiveRechte(rolle, R.STANDARD_MATRIX[rolle], []);
  assert.deepEqual([...eff('mitarbeiter')].sort(), ['zeit_eigen']);
  assert.deepEqual([...eff('polier')].sort(), ['bericht_erstellen', 'kolonne', 'zeit_eigen']);
  // Inhaber 13.11.2026: Bauleiter in allem wie Büro
  assert.deepEqual([...eff('bauleiter')].sort(), ['bericht_erstellen', 'bericht_freigeben', 'fuhrpark', 'kalk_sehen', 'lohn', 'preise_bearbeiten', 'preise_sehen', 'stammdaten', 'zeit_eigen']);
  assert.deepEqual([...eff('buero')].sort(), ['bericht_erstellen', 'bericht_freigeben', 'fuhrpark', 'kalk_sehen', 'lohn', 'preise_bearbeiten', 'preise_sehen', 'stammdaten', 'zeit_eigen']);
  assert.equal(eff('gf').size, R.RECHT_SCHLUESSEL.length);
});

test('Polier und Mitarbeiter: Preis-/Lohnrechte gesperrt – weder Matrix noch Ausnahme wirken', () => {
  for (const rolle of ['mitarbeiter', 'polier']) {
    for (const recht of ['preise_sehen', 'preise_bearbeiten', 'kalk_sehen', 'lohn']) {
      assert.equal(R.istGesperrt(rolle, recht), true);
      const alles = Object.fromEntries(R.RECHT_SCHLUESSEL.map((r) => [r, true]));
      assert.equal(R.effektiveRechte(rolle, alles, []).has(recht), false, `${rolle}/${recht} über Matrix`);
      assert.equal(R.effektiveRechte(rolle, {}, [recht]).has(recht), false, `${rolle}/${recht} über Ausnahme`);
    }
  }
});

test('Ausnahmen erweitern die Rolle', () => {
  assert.equal(R.effektiveRechte('polier', R.STANDARD_MATRIX.polier, ['bericht_freigeben']).has('bericht_freigeben'), true);
  assert.equal(R.effektiveRechte('mitarbeiter', R.STANDARD_MATRIX.mitarbeiter, ['kolonne']).has('kolonne'), true);
});

test('Bauleiter wie Büro (13.11.2026): Preise, Lohn, Stammdaten vergebbar; nur benutzer gesperrt', () => {
  assert.deepEqual([...R.effektiveRechte('bauleiter', {}, ['preise_bearbeiten', 'lohn', 'stammdaten'])].sort(), ['lohn', 'preise_bearbeiten', 'stammdaten']);
  assert.equal(R.effektiveRechte('bauleiter', {}, ['benutzer']).has('benutzer'), false);
  assert.deepEqual(R.GESPERRT.bauleiter, R.GESPERRT.buero);
});

test('GF behält immer das Recht benutzer', () => {
  assert.equal(R.effektiveRechte('gf', {}, []).has('benutzer'), true);
  assert.equal(R.istImmer('gf', 'benutzer'), true);
});

test('Bereich: Bauleiter wie Büro alle Baustellen (13.11.2026), Polier Partie, Büro/GF alle', () => {
  const bs = { id: 5, polier_id: 1, bauleiter_id: 103 };
  assert.equal(R.baustelleImBereich({ id: 103, rolle: 'bauleiter' }, bs), true);
  assert.equal(R.baustelleImBereich({ id: 104, rolle: 'bauleiter' }, bs), true);
  assert.equal(R.baustelleImBereich({ id: 1, rolle: 'polier' }, bs), true);
  assert.equal(R.baustelleImBereich({ id: 8, rolle: 'polier', baustelle_id: 5 }, bs), true);
  assert.equal(R.baustelleImBereich({ id: 8, rolle: 'polier', baustelle_id: 2 }, bs), false);
  assert.equal(R.baustelleImBereich({ id: 2, rolle: 'mitarbeiter', baustelle_id: 5 }, bs), true);
  assert.equal(R.baustelleImBereich({ id: 101, rolle: 'buero' }, bs), true);
  assert.equal(R.baustelleImBereich({ id: 102, rolle: 'gf' }, null), false);
});

test('darfPreise/darfKalk: Bauleiter wie Büro für alle Baustellen (13.11.2026)', () => {
  const ctx = { benutzer: { id: 103, rolle: 'bauleiter' }, rechte: new Set(['preise_sehen', 'kalk_sehen']) };
  assert.equal(R.darfKalk(ctx, { bauleiter_id: 103 }), true);
  assert.equal(R.darfKalk(ctx, { bauleiter_id: 102 }), true);
  assert.equal(R.darfPreise(ctx, { bauleiter_id: 102 }), true);
  const buero = { benutzer: { id: 101, rolle: 'buero' }, rechte: new Set(['preise_sehen', 'kalk_sehen']) };
  assert.equal(R.darfKalk(buero, { bauleiter_id: 103 }), true);
  const polier = { benutzer: { id: 1, rolle: 'polier' }, rechte: new Set(['bericht_erstellen']) };
  assert.equal(R.darfPreise(polier, null), false);
});

test('entferneEuroFelder entfernt €-Felder rekursiv (auch verschachtelt)', () => {
  const ein = {
    id: 1, name: 'x', kostensatz: 3, liste: [{ ek: 1, vk: 2, name: 'm' }],
    bericht: { kostenTag: { gesamt: 5 }, materialbeistellung: { eigen: 'a', fremd: 'b' } },
    budgetVerbrauchProzent: 50
  };
  const aus = R.entferneEuroFelder(ein);
  assert.deepEqual(aus, { id: 1, name: 'x', liste: [{ name: 'm' }], bericht: { materialbeistellung: { eigen: 'a', fremd: 'b' } } });
  assert.equal(R.entferneEuroFelder(ein, { kalk: true }).budgetVerbrauchProzent, 50);
  assert.deepEqual(R.findeEuroFelder(ein).sort(), ['$.bericht.kostenTag', '$.budgetVerbrauchProzent', '$.kostensatz', '$.liste[0].ek', '$.liste[0].vk']);
  assert.deepEqual(R.findeEuroFelder(aus), []);
});

test('B-01: benutzer nur GF; stammdaten für Polier/Mitarbeiter gesperrt', () => {
  for (const rolle of ['mitarbeiter', 'polier', 'bauleiter', 'buero']) {
    assert.equal(R.effektiveRechte(rolle, { benutzer: true }, ['benutzer']).has('benutzer'), false, rolle);
  }
  assert.equal(R.effektiveRechte('polier', { stammdaten: true }, ['stammdaten']).has('stammdaten'), false);
  assert.equal(R.effektiveRechte('bauleiter', {}, ['stammdaten']).has('stammdaten'), true); // Bauleiter wie Büro (13.11.2026)
  assert.equal(R.effektiveRechte('mitarbeiter', {}, ['stammdaten']).has('stammdaten'), false);
});

test('B-03: PIN-Regeln je Rolle', () => {
  const { pinFehler } = require('../../server/auth');
  assert.equal(pinFehler('4826', 'mitarbeiter'), null);
  assert.match(pinFehler('4826', 'gf'), /6 bis 12/);
  assert.equal(pinFehler('482619', 'buero'), null);
  assert.match(pinFehler('1234', 'polier'), /Zahlenfolge/);
  assert.match(pinFehler('987654', 'gf'), /Zahlenfolge/);
  assert.match(pinFehler('7777', 'polier'), /gleichen/);
  assert.match(pinFehler('12a4', 'polier'), /Ziffern/);
  assert.match(pinFehler('1234567890123', 'polier'), /bis 12/);
});
