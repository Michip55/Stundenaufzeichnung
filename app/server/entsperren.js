'use strict';
/**
 * Notfall-Entsperrung ohne Anmeldung (nur lokal am Server):  node server/entsperren.js <Personalnummer>
 * Hebt Konto- und IP-Sperren der Anmeldung auf und protokolliert den Vorgang.
 */
const path = require('node:path');
const { oeffneDatenbank } = require('./db');

function entsperren(db, pnr, jetzt = new Date()) {
  const b = db.eins('SELECT id, name, rolle FROM benutzer WHERE pnr = ?', pnr);
  if (!b) throw new Error(`Keine Person mit Personalnummer ${pnr}.`);
  db.transaktion(() => {
    db.lauf('DELETE FROM login_konto WHERE benutzer_id = ?', b.id);
    db.lauf('DELETE FROM login_versuch WHERE benutzer_id = ?', b.id);
    db.protokolliere({ zeit: jetzt.toISOString(), benutzerId: null, art: 'sicherheit', objekt: `benutzer:${b.id}`, text: `Notfall-Entsperrung per Kommandozeile: ${b.name} (Pnr. ${pnr})` });
  });
  return b;
}

if (require.main === module) {
  const pnr = Number(process.argv[2]);
  if (!Number.isInteger(pnr) || pnr < 1) {
    console.error('Aufruf: node server/entsperren.js <Personalnummer>');
    process.exit(2);
  }
  const db = oeffneDatenbank(process.env.BAUTAG_DB || path.join(__dirname, '..', 'data', 'bautag.db'));
  try {
    const b = entsperren(db, pnr);
    console.log(`Entsperrt: ${b.name} (${b.rolle}, Pnr. ${pnr}). Vorgang ist im Protokoll vermerkt.`);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    db.schliessen();
  }
}

module.exports = { entsperren };
