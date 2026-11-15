'use strict';
/**
 * Überwachung der Datensicherung (API.md 12.1): wertet den von deploy/backup.sh gemeldeten Status aus
 * (Einstellung `sicherung`) und alarmiert die Geschäftsführung (In-App + E-Mail), wenn ein Schritt
 * gescheitert ist oder die letzte erfolgreiche Sicherung zu alt ist.
 */
const { benachrichtige, empfaengerMitRecht } = require('./benachrichtigung');
const { wienDatum } = require('./datum');

const GRENZEN_STUNDEN = { lokal: 26, offsite: 26, test: 8 * 24 };
const NAMEN = { lokal: 'Lokale Sicherung', offsite: 'Externe (verschlüsselte) Sicherung', test: 'Wiederherstellungstest' };

/** Ist die Überwachung aktiv? (Server-Betrieb mit deploy/backup.sh oder bereits gemeldeter Status) */
function aktiv(bt) {
  return Boolean(bt.sicherungPruefen || bt.db.einstellung('sicherung', null));
}

/**
 * @returns {{aktiv:boolean, lokal, offsite, test, warnungen:Array<{art, text}>}}
 */
function sicherungsStatus(bt, jetzt = bt.uhr()) {
  const s = bt.db.einstellung('sicherung', null) || {};
  const warnungen = [];
  for (const art of Object.keys(GRENZEN_STUNDEN)) {
    const x = s[art];
    if (!x) { warnungen.push({ art, text: `${NAMEN[art]}: noch nie gemeldet.` }); continue; }
    if (!x.ok) warnungen.push({ art, text: `${NAMEN[art]} fehlgeschlagen: ${x.text || 'ohne Angabe'}` });
    if (x.warnung) warnungen.push({ art, text: `${NAMEN[art]}: ${x.warnung}` }); // N-011: Füllstand
    const alter = x.letzteOk ? (jetzt - new Date(x.letzteOk)) / 36e5 : Infinity;
    if (alter > GRENZEN_STUNDEN[art]) {
      warnungen.push({ art, text: `${NAMEN[art]}: letzte erfolgreiche ${x.letzteOk ? `am ${new Date(x.letzteOk).toLocaleString('de-AT', { timeZone: 'Europe/Vienna' })}` : 'noch nie'} – älter als ${GRENZEN_STUNDEN[art]} Std.` });
    }
  }
  return { aktiv: aktiv(bt), lokal: s.lokal || null, offsite: s.offsite || null, test: s.test || null, grenzenStunden: GRENZEN_STUNDEN, warnungen: aktiv(bt) ? warnungen : [] };
}

/** Stündlicher Lauf: bei Handlungsbedarf GF benachrichtigen (je Tag und Befund einmal) und E-Mail senden */
function pruefeSicherung(bt) {
  const st = sicherungsStatus(bt);
  if (!st.aktiv || !st.warnungen.length) return [];
  const zeit = bt.uhr().toISOString();
  const tag = wienDatum(bt.uhr());
  const schluessel = `sicherung:${tag}:${[...new Set(st.warnungen.map((w) => w.art))].sort().join('+')}`;
  const text = st.warnungen.map((w) => w.text).join(' ');
  let neu = false;
  for (const g of empfaengerMitRecht(bt.db, 'benutzer')) { // 15.3: Geschäftsführung über ihr Recht
    if (benachrichtige(bt.db, { benutzerId: g.id, typ: 'sicherheit', titel: 'Datensicherung: bitte prüfen', text, zeit, schluessel })) neu = true;
  }
  if (neu) {
    bt.db.protokolliere({ zeit, benutzerId: null, art: 'sicherung', objekt: 'sicherung', text: `Alarm Datensicherung: ${text}` });
    if (bt.mail && typeof bt.mail.alarm === 'function') bt.mail.alarm('BauTag: Datensicherung prüfen', `${text}\n\nAnleitung: deploy/SICHERHEIT.md (Abschnitt „Wenn ein Alarm kommt“).`);
  }
  return st.warnungen;
}

function pruefeSicherungSicher(bt) {
  try { return pruefeSicherung(bt); } catch (e) { console.error('[BauTag] Sicherungsprüfung:', e.message); return []; }
}

module.exports = { sicherungsStatus, pruefeSicherung, pruefeSicherungSicher, GRENZEN_STUNDEN };
