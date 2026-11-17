'use strict';
/**
 * Vordefinierte Pausen (Inhaber 17.11.2026, API.md 15.22).
 *
 * Modell: Eine Pause mit fester Dauer ist eine gewöhnliche „pause_start“-Buchung mit `pause_plan_min` (geplante Dauer) und
 * `pause_auto_bis` (geplantes Ende, ISO). Das Ende wird als ECHTE „pause_ende“-Buchung (`automatisch = 1`) genau zum Zeitpunkt
 * start + Dauer eingetragen – vom Server, sobald dieser Zeitpunkt erreicht ist: vor jeder API-Anfrage (Middleware in index.js),
 * in jeder Stempelung (innerhalb der Transaktion) und minütlich im Hintergrund. Zukünftige Buchungen gibt es damit nie, und
 * alle Auswertungen (Status, Tagessummen, Kolonne, Übersicht, Monat, Lohn/BMD, Arbeitszeit-Warnungen, Bautagesbericht,
 * Korrekturen) lesen dieselben Buchungen wie bei einer von Hand beendeten Pause.
 *
 * `pause_auto_bis` ist nur ein Merker „hier steht noch ein automatisches Ende aus“ (Teilindex, damit die Prüfung billig ist):
 * Beim Fälligwerden wird geprüft, ob die Pause noch die letzte Buchung der Person ist – nur dann wird das Ende eingetragen;
 * in jedem Fall wird der Merker gelöscht. Ein früheres „Pause beenden“ oder „Gehen“ beendet die Pause also einfach vorher.
 */
const { ungueltig } = require('./fehler');
const v = require('./validierung');

const STANDARD_AUSWAHL = [30, 45, 60];
const MIN_DAUER = 5;
const MAX_DAUER = 240;
const MAX_EINTRAEGE = 6;

/** Angebotene Dauern in Minuten (aufsteigend); „offen“ wird immer zusätzlich angeboten */
function auswahl(db) {
  const e = db.einstellung('pausen', null);
  const l = e && Array.isArray(e.auswahl) ? e.auswahl.filter((x) => Number.isInteger(x) && x >= MIN_DAUER && x <= MAX_DAUER) : null;
  return l ? [...new Set(l)].sort((a, b) => a - b).slice(0, MAX_EINTRAEGE) : [...STANDARD_AUSWAHL];
}

/** Prüft die Liste aus PUT /einstellungen/pausen */
function pruefeAuswahl(wert) {
  const l = v.liste(wert, 'auswahl', { max: MAX_EINTRAEGE });
  const out = l.map((x, i) => v.zahl(x, `auswahl[${i}]`, { min: MIN_DAUER, max: MAX_DAUER, ganz: true }));
  if (new Set(out).size !== out.length) throw ungueltig('auswahl: jede Dauer nur einmal.');
  return out.sort((a, b) => a - b);
}

/** Geplante Dauer einer Pause (null = offen) */
function pruefeDauer(wert, typ) {
  if (wert === undefined || wert === null) return null;
  if (typ !== 'pause_start') throw ungueltig('dauerMin gibt es nur bei „pause_start“.');
  return v.zahl(wert, 'dauerMin', { min: MIN_DAUER, max: MAX_DAUER, ganz: true });
}

/**
 * Trägt fällige automatische Pausenenden als „pause_ende“-Buchung genau zum geplanten Zeitpunkt ein.
 * @param {object} db
 * @param {Date} jetzt
 * @param {number} [benutzerId] nur diese Person (sonst alle)
 * @returns {number} Anzahl eingetragener Pausenenden
 */
function pausenAbschliessen(db, jetzt, benutzerId) {
  const t = jetzt.toISOString();
  const nur = benutzerId != null;
  const faellig = db.alle(`SELECT id, benutzer_id, zeit, baustelle_id, quelle, erfasst_von, pause_auto_bis FROM buchung
    WHERE pause_auto_bis IS NOT NULL AND pause_auto_bis <= ?${nur ? ' AND benutzer_id = ?' : ''} ORDER BY pause_auto_bis, id`, ...(nur ? [t, benutzerId] : [t]));
  if (!faellig.length) return 0;
  let n = 0;
  db.transaktion(() => {
    for (const p of faellig) {
      // noch offen = keine spätere Buchung der Person (gleiche Zeit: höhere ID kommt danach)
      const danach = db.eins('SELECT 1 AS x FROM buchung WHERE benutzer_id = ? AND (zeit > ? OR (zeit = ? AND id > ?)) LIMIT 1', p.benutzer_id, p.zeit, p.zeit, p.id);
      if (!danach) {
        db.lauf(`INSERT INTO buchung (benutzer_id, typ, zeit, baustelle_id, quelle, erfasst_von, erfasst, automatisch)
          VALUES (?, 'pause_ende', ?, ?, ?, ?, ?, 1)`, p.benutzer_id, p.pause_auto_bis, p.baustelle_id, p.quelle, p.erfasst_von, t);
        n++;
      }
      db.lauf('UPDATE buchung SET pause_auto_bis = NULL WHERE id = ?', p.id);
    }
  });
  return n;
}

/** Sicher (für Middleware und Hintergrundlauf): Fehler werden protokolliert, nie weitergereicht */
function pausenAbschliessenSicher(db, jetzt) {
  try { return pausenAbschliessen(db, jetzt); } catch (e) {
    console.error('[BauTag] Automatisches Pausenende:', e && e.message); // eslint-disable-line no-console
    return 0;
  }
}

module.exports = { STANDARD_AUSWAHL, MIN_DAUER, MAX_DAUER, MAX_EINTRAEGE, auswahl, pruefeAuswahl, pruefeDauer, pausenAbschliessen, pausenAbschliessenSicher };
