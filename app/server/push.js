'use strict';
/**
 * Web Push (API.md 12.3): VAPID-Schlüssel, Abos, Versand neuer Benachrichtigungen.
 * Push-Texte enthalten nie Beträge (Sperrbildschirm). Mit bt.test gehen Nachrichten in bt.testAusgang.push.
 */
const G = require('./geheim');
const B = require('./benachrichtigung');

const TYPEN = ['budget', 'fuhrpark', 'schaden', 'abwesenheit', 'bericht', 'plan', 'azg', 'sicherheit', 'baustelle', 'rechnung', 'email', 'urlaub'];
const NUR_VERWALTUNG = ['budget', 'rechnung', 'email'];

/** Push-Typen, die eine Rolle erhalten kann */
function typenFuerRolle(rolle) {
  return ['mitarbeiter', 'polier'].includes(rolle) ? TYPEN.filter((t) => !NUR_VERWALTUNG.includes(t)) : TYPEN;
}

/** VAPID-Schlüssel (beim ersten Aufruf erzeugt; privater Schlüssel verschlüsselt) */
function vapid(bt) {
  const { db } = bt;
  let v = db.einstellung('vapid', null);
  if (!v && !G.schluesselVorhanden(bt) && !G.klarErlaubt(bt)) {
    // N-063: ohne BAUTAG_SCHLUESSEL nie im Klartext speichern – Schlüssel nur bis zum Neustart (Startwarnung)
    if (!bt.vapidFluechtig) { const k = require('web-push').generateVAPIDKeys(); bt.vapidFluechtig = { publicKey: k.publicKey, privateKey: k.privateKey }; }
    return { ...bt.vapidFluechtig };
  }
  if (!v) {
    const k = require('web-push').generateVAPIDKeys();
    v = { publicKey: k.publicKey, privateKey: G.verschluesseln(bt, k.privateKey), erstellt: bt.uhr().toISOString() };
    db.setzeEinstellung('vapid', v);
  }
  return { publicKey: v.publicKey, privateKey: G.entschluesseln(bt, v.privateKey) };
}

function einstellungen(db, benutzer) {
  const z = db.eins('SELECT typen FROM push_einstellung WHERE benutzer_id = ?', benutzer.id);
  let gespeichert = {};
  try { gespeichert = z ? JSON.parse(z.typen) : {}; } catch (_) { gespeichert = {}; }
  const o = {};
  for (const t of typenFuerRolle(benutzer.rolle)) o[t] = gespeichert[t] !== false;
  return o;
}

/** Push-Typ einer Benachrichtigung */
function pushTyp(n) {
  if (n.typ === 'fuhrpark' && String(n.schluessel || '').startsWith('fp:schaden')) return 'schaden';
  return n.typ;
}

const EURO = /[-+]?\s?\d[\d.,'\s]*\s?(?:€|EUR\b)|(?:€|EUR)\s?[-+]?\d[\d.,']*/gi;
/** Text ohne Beträge (Sperrbildschirm) */
function ohneBetraege(text) {
  return String(text || '').replace(EURO, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
}

function payload(bt, n) {
  const typ = pushTyp(n);
  const body = typ === 'budget' ? 'Budget-Schwelle erreicht – Details in BauTag' : ohneBetraege(n.text).slice(0, 300);
  const basis = (bt.url || '').replace(/\/$/, '');
  const pfad = n.baustelle_id && ['budget', 'baustelle', 'rechnung'].includes(typ) ? `/#/baustellen/${n.baustelle_id}` : '/#/benachrichtigungen';
  return { title: ohneBetraege(n.titel).slice(0, 120), body, url: `${basis}${pfad}`, tag: `bt-${n.id}` };
}

/**
 * G-07: Push-Adressen nur bekannter Dienste (kein SSRF/Port-Scan): https, Port 443, keine IP-Literale, kein Benutzerteil,
 * Host exakt bzw. als Unterdomain der erlaubten Dienste. Im Testbetrieb zusätzlich die reservierten Test-Domains.
 */
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com'];
const PUSH_SUFFIXE = ['.push.apple.com', '.notify.windows.com'];
const TEST_SUFFIXE = ['.example.test', '.example.invalid'];
function endpointErlaubt(endpoint, { test = false } = {}) {
  const roh = String(endpoint);
  // N-028: Adresse muss in Rohform eindeutig sein – nur druckbares ASCII ohne Backslash, Host nur aus [a-z0-9.-],
  // höchstens „:443“. Sonst lesen WHATWG-URL (diese Prüfung) und url.parse (web-push beim Senden) verschiedene Hosts.
  if (roh.length > 1000 || !/^[\x21-\x7e]+$/.test(roh) || roh.includes('\\')) return false;
  const autoritaet = /^https:\/\/([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)(?::443)?(?=[/?]|$)/.exec(roh);
  if (!autoritaet) return false;
  let u;
  try { u = new URL(roh); } catch (_) { return false; }
  if (u.protocol !== 'https:' || (u.port && u.port !== '443') || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (h !== autoritaet[1].toLowerCase()) return false;
  let alt;
  try { alt = require('node:url').parse(roh); } catch (_) { return false; } // so liest web-push die Adresse
  if (String(alt.hostname || '').toLowerCase() !== h || (alt.port && alt.port !== '443')) return false;
  if (!h || h.startsWith('[') || require('node:net').isIP(h) || /^[\d.]+$/.test(h) || h.endsWith('.')) return false;
  if (PUSH_HOSTS.includes(h) || PUSH_SUFFIXE.some((x) => h.endsWith(x) && h.length > x.length)) return true;
  return Boolean(test) && TEST_SUFFIXE.some((x) => h.endsWith(x));
}
/** Fehlermeldung für /push/abos: nie Netzwerkdetails, nur HTTP-Status (G-07) */
const zustellFehler = (status) => `Zustellung fehlgeschlagen${status ? ` (HTTP ${status})` : ''}`;

/** Ein Abo beliefern → 'ok' | 'weg' (410/404 bzw. unzulässige Adresse) | Fehlertext */
async function sende(bt, abo, daten) {
  if (!endpointErlaubt(abo.endpoint, { test: bt.test })) return 'weg'; // Altbestand mit unzulässiger Adresse
  if (bt.test) {
    bt.testAusgang.push.push({ benutzerId: abo.benutzer_id, endpoint: abo.endpoint, ...daten, zeit: bt.uhr().toISOString() });
    return abo.endpoint.includes('gone') ? 'weg' : abo.endpoint.includes('fehler500') ? zustellFehler(500) : 'ok';
  }
  const k = vapid(bt);
  if (!k.privateKey) return 'VAPID-Schlüssel nicht lesbar (BAUTAG_SCHLUESSEL geändert?)';
  try {
    await require('web-push').sendNotification({ endpoint: abo.endpoint, keys: { p256dh: abo.p256dh, auth: abo.auth } }, JSON.stringify(daten), {
      TTL: 12 * 3600, urgency: 'normal', timeout: 10000,
      vapidDetails: { subject: bt.url && /^https:/.test(bt.url) ? bt.url : 'mailto:bautag@example.invalid', publicKey: k.publicKey, privateKey: k.privateKey }
    });
    return 'ok';
  } catch (e) {
    if (e && (e.statusCode === 404 || e.statusCode === 410)) return 'weg';
    return zustellFehler(e && Number.isInteger(e.statusCode) ? e.statusCode : null);
  }
}

/**
 * An alle Abos eines Benutzers senden → {gesendet, fehler} (+ abgebrochen:true, wenn vorSenden den Versand beendet hat)
 * @param {{vorSenden?: () => boolean}} opt  vorSenden: vor JEDEM Abo erneut prüfen (z. B. Rechte); false → nichts mehr senden
 */
async function anBenutzer(bt, benutzerId, daten, { vorSenden = null } = {}) {
  const { db } = bt;
  let gesendet = 0, fehler = 0, abgebrochen = false;
  for (const a of db.alle('SELECT * FROM push_abo WHERE benutzer_id = ?', benutzerId)) {
    if (vorSenden && !vorSenden()) { abgebrochen = true; break; }
    const r = await sende(bt, a, daten);
    if (r === 'ok') { gesendet++; db.lauf('UPDATE push_abo SET zuletzt = ?, fehler = NULL WHERE id = ?', bt.uhr().toISOString(), a.id); } else if (r === 'weg') db.lauf('DELETE FROM push_abo WHERE id = ?', a.id);
    else { fehler++; db.lauf('UPDATE push_abo SET fehler = ? WHERE id = ?', r, a.id); }
  }
  return abgebrochen ? { gesendet, fehler, abgebrochen } : { gesendet, fehler };
}

/**
 * Darf diese Benachrichtigung JETZT per Push an ihren Empfänger? (API.md 15.3)
 * Zählt allein der Stand zum Versandzeitpunkt: aktives Konto, aktuelle Rechte (erfordert), Push-Typ für die Rolle
 * und Einstellung. Wird vor jedem Versand und vor jedem Abo neu geprüft (auch bei einem erneuten Versuch).
 */
function pushErlaubt(db, nId) {
  const n = db.eins('SELECT * FROM benachrichtigung WHERE id = ?', nId);
  if (!n) return false;
  const ctx = B.aktuellerKontext(db, n.benutzer_id);
  if (!ctx || !ctx.benutzer.aktiv || !B.darfSehen(ctx, n)) return false;
  const typ = pushTyp(n);
  return typenFuerRolle(ctx.benutzer.rolle).includes(typ) && einstellungen(db, ctx.benutzer)[typ] !== false;
}

/** Eine wartende Benachrichtigung zustellen → Status für die Spalte push ('aus' = verworfen, nie nachgeholt) */
async function zustellen(bt, n) {
  if (!pushErlaubt(bt.db, n.id)) return 'aus';
  const r = await anBenutzer(bt, n.benutzer_id, payload(bt, n), { vorSenden: () => pushErlaubt(bt.db, n.id) });
  if (r.abgebrochen && !r.gesendet) return 'aus';
  return r.gesendet ? 'gesendet' : r.fehler ? 'fehler' : 'kein_abo';
}

/** Neue Benachrichtigungen verteilen (push IS NULL) – läuft nie doppelt */
async function verteilen(bt) {
  if (bt.pushLaeuft) { bt.pushNochmal = true; return; }
  bt.pushLaeuft = true;
  try {
    do {
      bt.pushNochmal = false;
      const { db } = bt;
      const neu = db.alle('SELECT * FROM benachrichtigung WHERE push IS NULL ORDER BY id LIMIT 200');
      for (const n of neu) {
        const status = await zustellen(bt, n);
        db.lauf('UPDATE benachrichtigung SET push = ? WHERE id = ?', status, n.id);
      }
      if (neu.length === 200) bt.pushNochmal = true;
    } while (bt.pushNochmal);
  } catch (e) {
    if (!bt.pushAus) console.error('[BauTag] Push:', e.message);
  } finally {
    bt.pushLaeuft = false;
  }
}

/**
 * 15.5 (F-014): alle Push-Abos einer Person löschen (PIN-Reset, 2FA-Reset, Deaktivierung, Rollen-/Rechtewechsel) → Anzahl.
 * Ein geteiltes Gerät erhält danach keine Meldungen dieser Person mehr; sie schaltet Push nach der Anmeldung neu ein.
 */
function abosLoeschen(db, benutzerId) {
  return db.lauf('DELETE FROM push_abo WHERE benutzer_id = ?', benutzerId).changes;
}

/** Nach Anfragen und stündlich anstoßen (ohne zu warten) */
function anstossen(bt) {
  if (bt.pushAus) return;
  setImmediate(() => { verteilen(bt).catch(() => {}); });
}

module.exports = { abosLoeschen, endpointErlaubt, zustellFehler, TYPEN, typenFuerRolle, vapid, einstellungen, pushTyp, ohneBetraege, payload, anBenutzer, pushErlaubt, zustellen, verteilen, anstossen };
