'use strict';
/**
 * 15.11 (G2-017, Inhaberregel 3): nicht fortlaufende öffentliche Kennungen für Abwesenheiten und Anträge.
 *
 * Fortlaufende Tabellen-IDs verraten über Differenzen, wie viele Einträge andere Personen dazwischen angelegt haben.
 * Wer fremde Abwesenheiten nicht sehen darf (ohne stammdaten/lohn, DS.stufe ≠ „voll“ – Polier, Mitarbeiter), bekommt deshalb
 * statt der Tabellen-ID eine aus ihr abgeleitete, nicht umkehrbare Kennung (HMAC-SHA256 mit einem zufälligen Geheimnis der
 * Installation, Tabelle einstellung, Schlüssel „id_geheimnis“). Sie ist je Eintrag stabil (auch über Neustarts) und nimmt
 * in Routen den Platz der Tabellen-ID ein; aufgelöst wird sie nur unter den eigenen Einträgen des Aufrufers.
 * Büro, Bauleiter, GF (stammdaten/lohn) behalten die Tabellen-IDs.
 */
const crypto = require('node:crypto');

const PRAEFIX = { abwesenheit: 'p', antrag: 'x' };
const cache = new WeakMap();

function geheimnis(db) {
  if (cache.has(db)) return cache.get(db);
  let g = db.einstellung('id_geheimnis', null);
  if (typeof g !== 'string' || g.length < 32) {
    g = crypto.randomBytes(32).toString('hex');
    db.setzeEinstellung('id_geheimnis', g);
  }
  cache.set(db, g);
  return g;
}

/** Öffentliche Kennung für (art, Tabellen-ID) – Kleinbuchstaben/Ziffern, 21 Zeichen */
function kennung(db, art, id) {
  const h = crypto.createHmac('sha256', geheimnis(db)).update(`${art}:${id}`).digest('hex').slice(0, 20);
  return `${PRAEFIX[art]}${h}`;
}

/** Ist das eine öffentliche Kennung dieser Art (Form)? */
const istKennung = (art, roh) => new RegExp(`^${PRAEFIX[art]}[0-9a-f]{20}$`).test(String(roh || ''));

/** Kennung unter den Kandidaten (Tabellen-IDs) auflösen → Tabellen-ID oder null */
function aufloesen(db, art, roh, kandidaten) {
  if (!istKennung(art, roh)) return null;
  for (const id of kandidaten) if (kennung(db, art, id) === roh) return id;
  return null;
}

module.exports = { geheimnis, kennung, istKennung, aufloesen };
