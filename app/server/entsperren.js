'use strict';
/**
 * Notfall-Entsperrung ohne Anmeldung (nur lokal am Server):
 *   node server/entsperren.js <Personalnummer>          Konto- und IP-Sperren aufheben
 *   node server/entsperren.js <Personalnummer> --2fa    zusätzlich Zwei-Faktor-Anmeldung zurücksetzen (G-03) und alle Sitzungen beenden
 *   node server/entsperren.js --2fa-alle                Zwei-Faktor-Anmeldung aller Personen zurücksetzen (z. B. nach neuem BAUTAG_SCHLUESSEL), deren Sitzungen beenden
 *   node server/entsperren.js <Personalnummer> --pin    neue Start-PIN (8 Ziffern, wird angezeigt) – Änderung bei der nächsten Anmeldung Pflicht
 * Jeder Vorgang wird protokolliert. 15.5 (F-050/F-051): Für Konten der Geschäftsführung ist dieser Befehl der EINZIGE Weg,
 * PIN, Zwei-Faktor-Anmeldung und Sperren zurückzusetzen – über die Oberfläche/API geht das nicht.
 */
const path = require('node:path');
const crypto = require('node:crypto');
const { oeffneDatenbank } = require('./db');
const auth = require('./auth');
const { benachrichtige } = require('./benachrichtigung');

function entsperren(db, pnr, jetzt = new Date()) {
  const b = db.eins('SELECT id, name, rolle FROM benutzer WHERE pnr = ?', pnr);
  if (!b) throw new Error(`Keine Person mit Personalnummer ${pnr}.`);
  db.transaktion(() => {
    db.lauf('DELETE FROM login_konto WHERE benutzer_id = ?', b.id);
    db.lauf('DELETE FROM login_versuch WHERE benutzer_id = ?', b.id);
    db.lauf('DELETE FROM login_2fa_fehler WHERE benutzer_id = ?', b.id);
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
      db.lauf('DELETE FROM login_2fa_fehler WHERE benutzer_id = ?', b.id);
      // N-118: wie DELETE /benutzer/:id/2fa – alte Sitzungen (z. B. auf einem verlorenen Gerät) enden
      const sitzungen = db.lauf('DELETE FROM sitzung WHERE benutzer_id = ?', b.id).changes;
      db.lauf('DELETE FROM push_abo WHERE benutzer_id = ?', b.id); // 15.5 (F-014)
      db.protokolliere({ zeit: jetzt.toISOString(), benutzerId: null, art: 'sicherheit', objekt: `benutzer:${b.id}`, neu: { sitzungenBeendet: sitzungen }, text: `Zwei-Faktor-Anmeldung von ${b.name} per Kommandozeile zurückgesetzt` });
    }
  });
  return personen.length;
}

/** Zufällige Start-PIN ohne triviale Folge (8 Ziffern) */
function neueStartPin() {
  for (;;) {
    const pin = Array.from(crypto.randomBytes(8), (x) => String(x % 10)).join('');
    if (!auth.pinFehler(pin, 'gf')) return pin;
  }
}

/**
 * 15.5 (F-050): PIN zurücksetzen (auch für die GF). Die neue Start-PIN muss bei der nächsten Anmeldung geändert werden;
 * alle Sitzungen und Push-Abos enden, Sperren werden aufgehoben, die Person wird benachrichtigt. → {b, pin}
 */
function pinZuruecksetzen(db, pnr, jetzt = new Date()) {
  const b = db.eins('SELECT id, name, rolle FROM benutzer WHERE pnr = ?', pnr);
  if (!b) throw new Error(`Keine Person mit Personalnummer ${pnr}.`);
  const pin = neueStartPin();
  const zeit = jetzt.toISOString();
  db.transaktion(() => {
    db.lauf('UPDATE benutzer SET pin_hash = ?, pin_laenge = ?, muss_pin_aendern = 1 WHERE id = ?', auth.hashPinSync(pin), pin.length, b.id);
    db.lauf('DELETE FROM sitzung WHERE benutzer_id = ?', b.id);
    db.lauf('DELETE FROM push_abo WHERE benutzer_id = ?', b.id);
    db.lauf('DELETE FROM login_konto WHERE benutzer_id = ?', b.id);
    db.lauf('DELETE FROM login_versuch WHERE benutzer_id = ?', b.id);
    db.lauf('DELETE FROM login_2fa_fehler WHERE benutzer_id = ?', b.id);
    benachrichtige(db, { benutzerId: b.id, typ: 'sicherheit', titel: 'PIN zurückgesetzt', text: 'Ihre PIN wurde am Server mit dem Notfall-Befehl zurückgesetzt. Bei der nächsten Anmeldung wählen Sie eine neue PIN. Haben Sie das nicht veranlasst, bitte sofort reagieren.', zeit, schluessel: `pin-reset:${b.id}:${zeit}` });
    db.protokolliere({ zeit, benutzerId: null, art: 'sicherheit', objekt: `benutzer:${b.id}`, neu: { pin: 'zurückgesetzt' }, text: `PIN von ${b.name} per Kommandozeile zurückgesetzt (Änderung bei der nächsten Anmeldung Pflicht)` });
  });
  return { b, pin };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const alle = args.includes('--2fa-alle');
  const zf = args.includes('--2fa');
  const mitPin = args.includes('--pin');
  const pnr = Number(args.find((a) => !a.startsWith('--')));
  if (!alle && (!Number.isInteger(pnr) || pnr < 1)) {
    console.error('Aufruf: node server/entsperren.js <Personalnummer> [--2fa] [--pin]   |   node server/entsperren.js --2fa-alle');
    process.exit(2);
  }
  const db = oeffneDatenbank(process.env.BAUTAG_DB || path.join(__dirname, '..', 'data', 'bautag.db'));
  try {
    if (alle) {
      const n = zweiFaktorZuruecksetzen(db, null);
      console.log(`Zwei-Faktor-Anmeldung bei ${n} Person(en) zurückgesetzt, ihre Sitzungen sind beendet. Bitte nach der Anmeldung neu einrichten.`);
    } else {
      const b = entsperren(db, pnr);
      console.log(`Entsperrt: ${b.name} (${b.rolle}, Pnr. ${pnr}). Vorgang ist im Protokoll vermerkt.`);
      if (zf) { zweiFaktorZuruecksetzen(db, pnr); console.log(`Zwei-Faktor-Anmeldung von ${b.name} zurückgesetzt, alle Sitzungen beendet – nach der Anmeldung neu einrichten.`); }
      if (mitPin) { const r = pinZuruecksetzen(db, pnr); console.log(`Neue Start-PIN für ${b.name}: ${r.pin} – bei der nächsten Anmeldung muss sie geändert werden. Bitte persönlich übergeben.`); }
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    db.schliessen();
  }
}

module.exports = { entsperren, zweiFaktorZuruecksetzen, pinZuruecksetzen };
