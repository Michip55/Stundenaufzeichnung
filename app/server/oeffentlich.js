'use strict';
/**
 * 15.11 (G2-017), 15.15 (H-G1), Inhaberregel 3: nicht fortlaufende öffentliche Kennungen für Abwesenheiten und Anträge.
 *
 * Fortlaufende Tabellen-IDs verraten über Differenzen, wie viele Einträge andere Personen dazwischen angelegt haben.
 * Wer fremde Abwesenheiten nicht sehen darf (ohne stammdaten/lohn, DS.stufe ≠ „voll“ – Polier, Mitarbeiter), bekommt deshalb
 * statt der Tabellen-ID eine nicht umkehrbare Kennung (HMAC-SHA256 mit einem zufälligen Geheimnis der Installation, Tabelle
 * einstellung, Schlüssel „id_geheimnis“). Sie nimmt in Routen den Platz der Tabellen-ID ein; aufgelöst wird sie nur unter
 * den eigenen Einträgen des Aufrufers. Büro, Bauleiter, GF (stammdaten/lohn) behalten die Tabellen-IDs.
 *
 * 15.15 (H-G1): Die Kennung leitet sich NICHT mehr aus der Tabellen-ID ab. SQLite vergibt die rowid einer gelöschten
 * letzten Zeile neu (abwesenheit.id ohne AUTOINCREMENT) – „anlegen, zurückziehen, neu anlegen“ ergab dieselbe Kennung bzw.
 * mit einem Wörterbuch früherer Kennungen die genaue Zahl fremder Einträge dazwischen. Grundlage ist jetzt die Spalte
 * abwesenheit.oeffentlich: ein zufälliger Wert je Zeile (80 Bit), gesetzt beim Anlegen durch einen Trigger (Migration 45),
 * gleich welcher Code einfügt. Eine neue Zeile hat so immer eine neue, unvorhersagbare Kennung – auch auf derselben rowid.
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

/** Zufallswert der Zeile (abwesenheit.oeffentlich); fehlt er (Zeile vor dem Trigger angelegt), wird er jetzt gesetzt */
function zufall(db, zeile) {
  if (zeile && typeof zeile === 'object' && typeof zeile.oeffentlich === 'string' && zeile.oeffentlich) return zeile.oeffentlich;
  const id = zeile && typeof zeile === 'object' ? zeile.id : zeile;
  const z = db.eins('SELECT oeffentlich FROM abwesenheit WHERE id = ?', id);
  if (!z) return null;
  if (z.oeffentlich) return z.oeffentlich;
  db.lauf('UPDATE abwesenheit SET oeffentlich = ? WHERE id = ? AND oeffentlich IS NULL', crypto.randomBytes(10).toString('hex'), id);
  return db.eins('SELECT oeffentlich FROM abwesenheit WHERE id = ?', id).oeffentlich;
}

/**
 * Öffentliche Kennung – Kleinbuchstaben/Ziffern, 21 Zeichen. Beide Arten beziehen sich auf eine Zeile der Tabelle abwesenheit
 * (Antrag: Bestand ohne antrag_id, Kennung über seine einzige Zeile).
 * @param {string} art 'abwesenheit' | 'antrag'
 * @param {number|{id:number, oeffentlich?:string}} zeile Tabellen-ID oder Zeile (mit Spalte oeffentlich spart eine Abfrage)
 */
function kennung(db, art, zeile) {
  const z = zufall(db, zeile);
  // ohne Zeile: zufällige, nie auflösbare Kennung (nichts Ableitbares)
  const basis = z == null ? crypto.randomBytes(10).toString('hex') : z;
  const h = crypto.createHmac('sha256', geheimnis(db)).update(`${art}:${basis}`).digest('hex').slice(0, 20);
  return `${PRAEFIX[art]}${h}`;
}

/** Ist das eine öffentliche Kennung dieser Art (Form)? */
const istKennung = (art, roh) => new RegExp(`^${PRAEFIX[art]}[0-9a-f]{20}$`).test(String(roh || ''));

/** Kennung unter den Kandidaten (Tabellen-IDs oder Zeilen {id, oeffentlich}) auflösen → Tabellen-ID oder null */
function aufloesen(db, art, roh, kandidaten) {
  if (!istKennung(art, roh)) return null;
  for (const k of kandidaten) if (kennung(db, art, k) === roh) return k && typeof k === 'object' ? k.id : k;
  return null;
}

module.exports = { geheimnis, kennung, istKennung, aufloesen };
