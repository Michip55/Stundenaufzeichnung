'use strict';
/**
 * Inbetriebnahme: leere Echt-Datenbank mit Rechte-Matrix, Lohngruppen, Geräten und Material der
 * Papiervorlage (ohne Preise) und der ersten Geschäftsführung.
 *
 *   node server/einrichten.js --name "Vorname Nachname" --pnr 1 --pin 123456
 *   BAUTAG_GF_NAME=… BAUTAG_GF_PNR=… BAUTAG_GF_PIN=… node server/einrichten.js
 *   node server/einrichten.js            (fragt interaktiv)
 */
const path = require('node:path');
const readline = require('node:readline');
const { oeffneDatenbank } = require('./db');
const { schreibeStandardMatrix } = require('./rechte');
const { hashPinSync, pinFehler } = require('./auth');
const { LOHNGRUPPEN, GERAETE, MATERIAL } = require('./seed');

/**
 * @param {import('./db').Datenbank} db  leere Datenbank
 * @param {{name:string, pnr:number, pin:string, firma?:{name:string, ort:string}}} gf
 */
function einrichten(db, { name, pnr, pin, firma }, jetzt = new Date()) {
  if (db.eins('SELECT COUNT(*) AS n FROM benutzer').n > 0) throw new Error('Die Datenbank enthält bereits Benutzer – Einrichtung abgebrochen.');
  if (typeof name !== 'string' || name.trim().length < 3) throw new Error('Name der Geschäftsführung fehlt (mind. 3 Zeichen).');
  if (!Number.isInteger(pnr) || pnr < 1 || pnr > 999999) throw new Error('Personalnummer muss eine ganze Zahl von 1 bis 999999 sein.');
  const f = pinFehler(String(pin), 'gf');
  if (f) throw new Error(`PIN: ${f}`);
  const t = jetzt.toISOString();
  db.transaktion(() => {
    db.setzeEinstellung('firma', firma || { name: 'Michael Pichler Ges.m.b.H.', ort: '2624 Breitenau' });
    db.setzeEinstellung('arbeitszeit', { tagNormal: [0, 8, 8, 8, 8, 7, 0], wocheNormal: 39 });
    schreibeStandardMatrix(db);
    LOHNGRUPPEN.forEach(([id, n, kv], i) => db.lauf('INSERT OR IGNORE INTO lohngruppe (id, name, kv, kostensatz, regiesatz, sortierung) VALUES (?, ?, ?, 0, 0, ?)', id, n, kv, i));
    GERAETE.forEach(([code, n, gruppe], i) => db.lauf('INSERT OR IGNORE INTO geraet (code, name, gruppe, kostensatz, verrechnungssatz, vorlage, sortierung) VALUES (?, ?, ?, 0, 0, 1, ?)', code, n, gruppe, i));
    MATERIAL.forEach(([code, n, einheit, vorlage], i) => db.lauf('INSERT OR IGNORE INTO material (code, name, einheit, ek, vk, vorlage, sortierung) VALUES (?, ?, ?, 0, 0, ?, ?)', code, n, einheit, vorlage ? 1 : 0, i));
    const r = db.lauf('INSERT INTO benutzer (name, rolle, pnr, aktiv, pin_hash, erstellt, muss_pin_aendern, pin_laenge) VALUES (?, ?, ?, 1, ?, ?, 0, ?)',
      name.trim(), 'gf', pnr, hashPinSync(String(pin)), t, String(pin).length);
    db.protokolliere({ zeit: t, benutzerId: r.id, art: 'benutzer', objekt: `benutzer:${r.id}`, text: `Inbetriebnahme: erste Geschäftsführung ${name.trim()} angelegt` });
  });
  require('./positionen').katalogAnlegen(db, jetzt); // Positionskatalog aus der Firmenvorlage (mit EP)
  require('./fuhrpark-vorlagen').vorlagenAnlegen(db); // Servicebuch-Vorlagen (alle „Prüfen“, API.md 11)
  return db.eins("SELECT id, name, pnr FROM benutzer WHERE rolle = 'gf'");
}

function argument(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function frage(rl, text) {
  return new Promise((res) => rl.question(text, (a) => res(a.trim())));
}

if (require.main === module) {
  (async () => {
    let name = argument('name') || process.env.BAUTAG_GF_NAME;
    let pnr = argument('pnr') || process.env.BAUTAG_GF_PNR;
    let pin = argument('pin') || process.env.BAUTAG_GF_PIN;
    if (!name || !pnr || !pin) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      if (!name) name = await frage(rl, 'Name der Geschäftsführung: ');
      if (!pnr) pnr = await frage(rl, 'Personalnummer: ');
      if (!pin) pin = await frage(rl, 'PIN (6–12 Ziffern, keine Folge wie 123456): ');
      rl.close();
    }
    const dbPfad = process.env.BAUTAG_DB || path.join(__dirname, '..', 'data', 'bautag.db');
    const db = oeffneDatenbank(dbPfad);
    try {
      const gf = einrichten(db, { name, pnr: Number(pnr), pin: String(pin) });
      console.log(`BauTag eingerichtet in ${dbPfad}`);
      console.log(`  Geschäftsführung: ${gf.name} (Personalnummer ${gf.pnr}).`);
      console.log('  Nächste Schritte: zweites Verwaltungs-Konto (Büro oder zweite GF) anlegen, Preise und Baustellen erfassen.');
    } catch (e) {
      console.error('Einrichtung fehlgeschlagen: ' + e.message);
      process.exitCode = 1;
    } finally {
      db.schliessen();
    }
  })();
}

module.exports = { einrichten };
