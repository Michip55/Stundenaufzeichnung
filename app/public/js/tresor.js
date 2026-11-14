// BauTag – Gerätetresor für wartende Einträge am geteilten Gerät (API.md 15.5, Befunde F-030/F-046).
// Noch nicht gesendete Stempelungen, Fuhren-Meldungen und Schadensmeldungen (samt Fotos) sowie die Listen „nicht übernommen“
// gehören genau einer Person. Beim Abmelden, beim Ablauf der Sitzung und beim Benutzerwechsel werden sie mit dem Geräteschlüssel
// dieser Person (vom Server, nur angemeldet abrufbar) per AES-GCM versiegelt; der Schlüssel wird danach vom Gerät gelöscht.
// Versiegelte Einträge tragen KEINE Angaben im Klartext (auch nicht die Person) – niemand sonst kann sie lesen, verändern
// oder senden. Meldet sich dieselbe Person wieder an, holt die App ihren Schlüssel, entsiegelt und sendet wie gewohnt.
import { get } from './api.js';
import { schadenRohAlle, schadenRohSetzen, schadenRohWeg } from './schaden-offline.js';

const SCHL = 'bt_tresor';
const LISTEN = ['bt_stempel_queue', 'bt_stempel_abgelehnt', 'bt_fuhren_warten', 'bt_fuhren_abgelehnt'];
const QUARANTAENE = { bt_stempel_queue: 'bt_stempel_abgelehnt', bt_fuhren_warten: 'bt_fuhren_abgelehnt' };
const GRUND = 'Am Gerät ohne Ihre Anmeldung gefunden – nicht automatisch gesendet. Bitte prüfen und bei Bedarf dem Büro melden.';

const lies = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const schreib = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };

function zuB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function vonB64(t) { const s = atob(t); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
const subtil = () => (window.crypto && window.crypto.subtle) || null;

async function schluessel() {
  const t = lies(SCHL, null);
  if (!t || !t.k || t.benutzerId == null || !subtil()) return null;
  try { return { id: t.benutzerId, key: await subtil().importKey('raw', vonB64(t.k), 'AES-GCM', false, ['encrypt', 'decrypt']) }; } catch (e) { return null; }
}
async function zu(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const d = await subtil().encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { iv: zuB64(iv), d: zuB64(new Uint8Array(d)) };
}
async function auf(key, v) {
  try { return JSON.parse(new TextDecoder().decode(await subtil().decrypt({ name: 'AES-GCM', iv: vonB64(v.iv) }, key, vonB64(v.d)))); } catch (e) { return null; }
}
const zufallsId = () => `v-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`}`;

/** Ist für diese Person ein Schlüssel am Gerät? */
export const schluesselDa = (benutzerId) => { const t = lies(SCHL, null); return !!(t && t.k && t.benutzerId === benutzerId); };

/** Geräteschlüssel der angemeldeten Person holen (einmal je Anmeldung; braucht Verbindung) */
export async function schluesselHolen(benutzerId) {
  if (schluesselDa(benutzerId)) return true;
  try {
    const r = await get(`/auth/geraet-schluessel?benutzerId=${encodeURIComponent(benutzerId)}`);
    if (r && r.benutzerId === benutzerId && r.schluessel) return schreib(SCHL, { benutzerId, k: r.schluessel });
  } catch (e) { /* ohne Netz: beim nächsten Mal */ }
  return false;
}

/**
 * Alle Einträge der Person, deren Schlüssel am Gerät liegt, versiegeln – danach den Schlüssel löschen.
 * Ohne Schlüssel (nie abgerufen) bleiben die Einträge, wie sie sind: sie werden nur der Person selbst angezeigt und gesendet.
 */
export async function versiegeln() {
  const s = await schluessel();
  if (s) {
    for (const k of LISTEN) {
      const l = lies(k, []);
      if (!Array.isArray(l) || !l.some((e) => e && !e.versiegelt && e.benutzerId === s.id)) continue;
      const neu = [];
      for (const e of l) neu.push(e && !e.versiegelt && e.benutzerId === s.id ? { versiegelt: await zu(s.key, e) } : e);
      schreib(k, neu);
    }
    for (const e of await schadenRohAlle()) {
      if (e.versiegelt || e.benutzerId !== s.id) continue;
      try { await schadenRohSetzen({ clientId: zufallsId(), versiegelt: await zu(s.key, e) }); await schadenRohWeg(e.clientId); } catch (x) { /* Gerätespeicher voll – Eintrag bleibt unverändert */ }
    }
  }
  try { localStorage.removeItem(SCHL); } catch (e) { /* egal */ }
}

/**
 * Nach der Anmeldung: eigene versiegelte Einträge wieder öffnen (an ihrer Stelle in der Reihenfolge).
 * frisch = nach einer neuen Anmeldung: eigene Einträge, die UNVERSIEGELT am Gerät lagen, stammen nicht aus der eigenen Sitzung
 * (z. B. von jemand anderem am Gerät angelegt) – sie werden nicht gesendet, sondern als „nicht übernommen“ zur Prüfung gezeigt.
 */
export async function entsiegeln(benutzerId, { frisch = false } = {}) {
  const s = await schluessel();
  const offen = s && s.id === benutzerId;
  for (const k of LISTEN) {
    const l = lies(k, []);
    if (!Array.isArray(l) || !l.length) continue;
    const neu = [], weg = [];
    let geaendert = false;
    for (const e of l) {
      if (e && e.versiegelt) {
        const x = offen ? await auf(s.key, e.versiegelt) : null;
        if (x && x.benutzerId === benutzerId) { neu.push(x); geaendert = true; } else neu.push(e);
      } else if (frisch && QUARANTAENE[k] && e && e.benutzerId === benutzerId) { weg.push(e); geaendert = true; } else neu.push(e);
    }
    if (!geaendert) continue;
    if (weg.length) {
      const ziel = QUARANTAENE[k];
      const zeit = new Date().toISOString();
      schreib(ziel, [...lies(ziel, []), ...weg.map((e) => ({ ...e, grund: GRUND, code: 0, abgelehntUm: zeit, abgelehnt: zeit }))]);
    }
    schreib(k, neu);
  }
  for (const e of await schadenRohAlle()) {
    try {
      if (e.versiegelt) {
        const x = offen ? await auf(s.key, e.versiegelt) : null;
        if (x && x.benutzerId === benutzerId) { await schadenRohSetzen(x); await schadenRohWeg(e.clientId); }
      } else if (frisch && e.benutzerId === benutzerId && (e.zustand || 'wartet') === 'wartet') {
        await schadenRohSetzen({ ...e, zustand: 'fehler', fehlerArt: 'abgelehnt', grund: GRUND });
      }
    } catch (x) { /* nächster Eintrag */ }
  }
}

/** Liegt am Gerät etwas Versiegeltes? (nur Anzahl, ohne Inhalt) */
export async function versiegeltAnzahl() {
  let n = 0;
  for (const k of LISTEN) { const l = lies(k, []); if (Array.isArray(l)) n += l.filter((e) => e && e.versiegelt).length; }
  return n + (await schadenRohAlle()).filter((e) => e.versiegelt).length;
}
