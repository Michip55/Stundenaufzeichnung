'use strict';
/**
 * Web Push (API.md 12.3): VAPID-Schlüssel, Abos, Versand neuer Benachrichtigungen.
 * Push-Texte enthalten nie Beträge (Sperrbildschirm). Mit bt.test gehen Nachrichten in bt.testAusgang.push.
 */
const G = require('./geheim');

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

/** Ein Abo beliefern → 'ok' | 'weg' (410/404) | Fehlertext */
async function sende(bt, abo, daten) {
  if (bt.test) {
    bt.testAusgang.push.push({ benutzerId: abo.benutzer_id, endpoint: abo.endpoint, ...daten, zeit: bt.uhr().toISOString() });
    return abo.endpoint.includes('gone') ? 'weg' : 'ok';
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
    return String((e && (e.body || e.message)) || e).slice(0, 200);
  }
}

/** An alle Abos eines Benutzers senden → {gesendet, fehler} */
async function anBenutzer(bt, benutzerId, daten) {
  const { db } = bt;
  let gesendet = 0, fehler = 0;
  for (const a of db.alle('SELECT * FROM push_abo WHERE benutzer_id = ?', benutzerId)) {
    const r = await sende(bt, a, daten);
    if (r === 'ok') { gesendet++; db.lauf('UPDATE push_abo SET zuletzt = ?, fehler = NULL WHERE id = ?', bt.uhr().toISOString(), a.id); } else if (r === 'weg') db.lauf('DELETE FROM push_abo WHERE id = ?', a.id);
    else { fehler++; db.lauf('UPDATE push_abo SET fehler = ? WHERE id = ?', r, a.id); }
  }
  return { gesendet, fehler };
}

/** Neue Benachrichtigungen verteilen (push IS NULL) – läuft nie doppelt */
async function verteilen(bt) {
  if (bt.pushLaeuft) { bt.pushNochmal = true; return; }
  bt.pushLaeuft = true;
  try {
    do {
      bt.pushNochmal = false;
      const { db } = bt;
      const neu = db.alle('SELECT n.*, b.rolle, b.aktiv FROM benachrichtigung n JOIN benutzer b ON b.id = n.benutzer_id WHERE n.push IS NULL ORDER BY n.id LIMIT 200');
      for (const n of neu) {
        const typ = pushTyp(n);
        const ein = einstellungen(db, { id: n.benutzer_id, rolle: n.rolle });
        let status = 'aus';
        if (n.aktiv && ein[typ] !== false && typenFuerRolle(n.rolle).includes(typ)) {
          const r = await anBenutzer(bt, n.benutzer_id, payload(bt, n));
          status = r.gesendet ? 'gesendet' : r.fehler ? 'fehler' : 'kein_abo';
        }
        db.lauf('UPDATE benachrichtigung SET push = ? WHERE id = ?', status, n.id);
      }
      if (neu.length === 200) bt.pushNochmal = true;
    } while (bt.pushNochmal);
  } catch (e) {
    console.error('[BauTag] Push:', e.message);
  } finally {
    bt.pushLaeuft = false;
  }
}

/** Nach Anfragen und stündlich anstoßen (ohne zu warten) */
function anstossen(bt) {
  if (bt.pushAus) return;
  setImmediate(() => { verteilen(bt).catch(() => {}); });
}

module.exports = { TYPEN, typenFuerRolle, vapid, einstellungen, pushTyp, ohneBetraege, payload, anBenutzer, verteilen, anstossen };
