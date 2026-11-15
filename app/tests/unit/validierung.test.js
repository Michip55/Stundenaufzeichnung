'use strict';
/** N-096: Eingabeprüfung meldet deutsche Feldnamen und Zahlen im deutschen Format */
const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../../server/validierung');

const meldung = (fn) => { try { fn(); } catch (e) { return e.message; } assert.fail('kein Fehler'); };

test('Bereichsprüfung: deutscher Feldname und deutsches Zahlenformat', () => {
  assert.equal(meldung(() => v.zahl(9, 'dichte', { min: 0.1, max: 5 })), 'Dichte muss zwischen 0,1 und 5 liegen.');
  assert.equal(meldung(() => v.zahl(-1, 'vk', { min: 0, max: 1e6 })), 'Verkaufspreis muss zwischen 0 und 1.000.000 liegen.');
  assert.equal(meldung(() => v.betrag(2e6, 'ek', { min: 0, max: 1e6 })), 'Einkaufspreis muss zwischen 0 und 1.000.000 liegen.');
  assert.equal(meldung(() => v.zahl(0, 'menge', { min: 0.001, max: 100000 })), 'Menge muss zwischen 0,001 und 100.000 liegen.');
  // einseitige Grenze: kein „-Infinity“/„Infinity“ im Text
  assert.equal(meldung(() => v.zahl(-3, 'wert', { min: 0 })), 'Wert muss mindestens 0 sein.');
  assert.equal(meldung(() => v.zahl(1e7, 'wert', { max: 1e6 })), 'Wert darf höchstens 1.000.000 sein.');
});

test('übrige Prüfungen nennen das Feld deutsch; unbekannte und schon deutsche Namen bleiben', () => {
  assert.equal(meldung(() => v.zahl(undefined, 'dichte')), 'Dichte fehlt.');
  assert.equal(meldung(() => v.zahl('x', 'dichte')), 'Dichte muss eine Zahl sein.');
  assert.equal(meldung(() => v.text('', 'code')), 'Code darf nicht leer sein.');
  assert.equal(meldung(() => v.text('x'.repeat(2001), 'notiz', { max: 2000 })), 'Notiz ist zu lang (max. 2.000 Zeichen).');
  assert.equal(meldung(() => v.bool('ja', 'naturmaterial')), 'Naturmaterial muss true oder false sein.');
  assert.equal(meldung(() => v.datum('12.11.2026', 'von')), 'Von muss ein gültiges Datum im Format JJJJ-MM-TT sein.');
  assert.equal(meldung(() => v.id(0, 'materialId')), 'Material ist ungültig.');
  assert.equal(meldung(() => v.id(1.5, 'baustelleId')), 'Baustelle ist ungültig.');
  assert.equal(meldung(() => v.id(undefined, 'baustelleId')), 'Baustelle fehlt.');
  assert.equal(meldung(() => v.zahl(undefined, 'Betriebsstundenstand')), 'Betriebsstundenstand fehlt.');
  assert.equal(meldung(() => v.zahl(undefined, 'seg.stunden')), 'seg.stunden fehlt.');
  assert.equal(v.feldname('constructor'), 'constructor'); // kein Prototyp-Zugriff
});
