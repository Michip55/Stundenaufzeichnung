'use strict';
/**
 * Startzuordnung Bautagesbericht → Positionen der Excel-Vorlage (alle als „Zuordnung prüfen“ markiert).
 * Schlüssel: Bezeichnung + Einheit der Vorlage. quelle = {art, ref:[…], faktor?}
 *  - personal: Lohngruppen (Stunden); LKW-Fahrer und Maschinisten stecken in den Geräte-/Transportsätzen
 *  - geraet:   Geräte-Codes des Berichts (Stunden)
 *  - material: Material-Codes des Berichts (Menge × faktor, Einheit wie Vorlage)
 */
const ZUORDNUNG = [
  ['Facharbeiter', 'Std.', { art: 'personal', ref: ['pol', 'va', 'fa', 'hi', 'le'] }],
  ['LKW 2A', 'Std.', { art: 'geraet', ref: ['lkw2'] }],
  ['LKW 3A', 'Std.', { art: 'geraet', ref: ['lkw3'] }],
  ['LKW 4A', 'Std.', { art: 'geraet', ref: ['lkw4'] }],
  ['3A-Kran', 'Std.', { art: 'geraet', ref: ['kran3'] }],
  ['LKW 4A Mulde und Kran', 'Std.', { art: 'geraet', ref: ['kran4'] }],
  ['LKW Sattel', 'Std.', { art: 'geraet', ref: ['sattel'] }],
  ['LKW Tieflader', 'Std.', { art: 'geraet', ref: ['tieflader'] }],
  ['Bagger 1,8 to.', 'Std.', { art: 'geraet', ref: ['b15'] }],
  ['Komatsu PC27 3 to', 'Std.', { art: 'geraet', ref: ['b27'] }],
  ['Mobilbagger 9-11 to', 'Std.', { art: 'geraet', ref: ['b9'] }],
  ['Kettenbagger 23 to', 'Std.', { art: 'geraet', ref: ['b23'] }],
  ['Minilader Bobcat  3,3 to', 'Std.', { art: 'geraet', ref: ['bobcat'] }],
  ['Radlader Case 2,5 m3', 'Std.', { art: 'geraet', ref: ['radlader'] }],
  ['Walze Hamm 3,0 to', 'Std.', { art: 'geraet', ref: ['hamm'] }],
  ['Walze Bomag 7,0 to', 'Std.', { art: 'geraet', ref: ['bomag'] }],
  ['Grabenwalze', 'Std.', { art: 'geraet', ref: ['grabenwalze'] }],
  ['Dumper', 'Std.', { art: 'geraet', ref: ['dumper'] }],
  ['Kleingeräte', 'Std.', { art: 'geraet', ref: ['verlege', 'schneid', 'kompressor', 'handwalze', 'ruettel'] }],
  ['Wandschotter FSM 0/63', 't', { art: 'material', ref: ['frostschutz'] }],
  ['Grädermaterial KK 0/32', 't', { art: 'material', ref: ['graeder'] }],
  ['Splitt KK 2/4 oder KK 4/8', 't', { art: 'material', ref: ['splitt'] }],
  ['Bodenaushub, Kleinmenge bis 2000 to', 't', { art: 'material', ref: ['aushub'] }],
  ['Betonbruch bis 80cm', 't', { art: 'material', ref: ['betonbruch'] }],
  ['Asphaltbruch rein', 't', { art: 'material', ref: ['asphaltbruch'] }],
  ['Beton C 16/20', 'm3', { art: 'material', ref: ['beton'] }],
  ['Pflaster', 'm2', { art: 'material', ref: ['pflaster8'] }],
  ['PVC DN150', 'lfm', { art: 'material', ref: ['rohr150'] }],
  ['Leistenstein 100/10/20', 'Stk', { art: 'material', ref: ['randstein'], faktor: 1 }]
];

/** Bericht-Einträge ohne Zuordnung (bewusst): Gräder (kein Gerät in der Vorlage), Asphalt (Vorlage: Lieferantenrechnung PA) */
const OHNE_ZUORDNUNG = [
  { art: 'geraet', ref: 'graeder', grund: 'In der Vorlage gibt es keinen Gräder – bitte eigene Position anlegen oder zuordnen.' },
  { art: 'material', ref: 'asphalt', grund: 'Asphalt wird in der Vorlage als Lieferantenrechnung (PA × 1,15) erfasst – Rechnungsbetrag als Menge eintragen.' },
  { art: 'personal', ref: 'lkw', grund: 'LKW-Fahrer-Stunden sind in den Transport-Sätzen enthalten.' },
  { art: 'personal', ref: 'ma', grund: 'Maschinisten-Stunden sind in den Geräte-Sätzen enthalten.' }
];

const schluessel = (bez, eh) => `${String(bez).trim().replace(/\s+/g, ' ').toLowerCase()}|${String(eh).trim().toLowerCase()}`;
const MAP = new Map(ZUORDNUNG.map(([b, e, q]) => [schluessel(b, e), q]));

function zuordnungFuer(bezeichnung, einheit) {
  return MAP.get(schluessel(bezeichnung, einheit)) || null;
}

module.exports = { ZUORDNUNG, OHNE_ZUORDNUNG, zuordnungFuer, schluessel };
