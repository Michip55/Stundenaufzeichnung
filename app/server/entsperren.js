'use strict';
/**
 * Notfall-Entsperrung ohne Anmeldung (nur lokal am Server):
 *   node server/entsperren.js <Personalnummer>          Konto- und IP-Sperren aufheben
 *   node server/entsperren.js <Personalnummer> --2fa    zusätzlich Zwei-Faktor-Anmeldung zurücksetzen (G-03)
 *   node server/entsperren.js --2fa-alle                Zwei-Faktor-Anmeldung aller Personen zurücksetzen (z. B. nach neuem BAUTAG_SCHLUESSEL)
 * Jeder Vorgang wird protokolliert.
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

/** Zwei-Faktor-Anmeldung zurücksetzen (eine Person per Pnr. oder alle mit pnr = null) → Anzahl */
function zweiFaktorZuruecksetzen(db, pnr = null, jetzt = new Date()) {
  const personen = pnr == null
    ? db.alle('SELECT b.id, b.name FROM benutzer b JOIN benutzer_2fa z ON z.benutzer_id = b.id')
    : [db.eins('SELECT id, name FROM benutzer WHERE pnr = ?', pnr)].filter(Boolean);
  if (pnr != null && !personen.length) throw new Error(`Keine Person mit Personalnummer ${pnr}.`);
  db.transaktion(() => {
    for (const b of personen) {
      db.lauf('DELETE FROM benutzer_2fa WHERE benutzer_id = ?', b.id);
      db.lauf('DELETE FROM login_2fa WHERE benutzer_id = ?', b.id);
      db.protokolliere({ zeit: jetzt.toISOString(), benutzerId: null, art: 'sicherheit', objekt: `benutzer:${b.id}`, text: `Zwei-Faktor-Anmeldung von ${b.name} per Kommandozeile zurückgesetzt` });
    }
  });
  return personen.length;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const alle = args.includes('--2fa-alle');
  const zf = args.includes('--2fa');
  const pnr = Number(args.find((a) => !a.startsWith('--')));
  if (!alle && (!Number.isInteger(pnr) || pnr < 1)) {
    console.error('Aufruf: node server/entsperren.js <Personalnummer> [--2fa]   |   node server/entsperren.js --2fa-alle');
    process.exit(2);
  }
  const db = oeffneDatenbank(process.env.BAUTAG_DB || path.join(__dirname, '..', 'data', 'bautag.db'));
  try {
    if (alle) {
      const n = zweiFaktorZuruecksetzen(db, null);
      console.log(`Zwei-Faktor-Anmeldung bei ${n} Person(en) zurückgesetzt. Bitte nach der Anmeldung neu einrichten.`);
    } else {
      const b = entsperren(db, pnr);
      console.log(`Entsperrt: ${b.name} (${b.rolle}, Pnr. ${pnr}). Vorgang ist im Protokoll vermerkt.`);
      if (zf) { zweiFaktorZuruecksetzen(db, pnr); console.log(`Zwei-Faktor-Anmeldung von ${b.name} zurückgesetzt – nach der Anmeldung neu einrichten.`); }
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    db.schliessen();
  }
}

module.exports = { entsperren, zweiFaktorZuruecksetzen };
