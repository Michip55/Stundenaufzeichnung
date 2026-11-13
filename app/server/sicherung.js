'use strict';
/**
 * Datensicherung (API.md 12.1): konsistente Kopie der SQLite-Datenbank (Backup-API, auch bei laufendem
 * Server), Fotos als tar.gz, Rotation 14 täglich / 8 wöchentlich / 12 monatlich, Prüfung einer Sicherung
 * (integrity_check + Zeilenzahlen) und Status-Meldung in die Datenbank (für Alarm in der App).
 *
 *   node server/sicherung.js sichern <Zielordner> [--uploads <Ordner>]
 *   node server/sicherung.js pruefen <Sicherungsdatei.db>
 *   node server/sicherung.js status <lokal|offsite|test> <ok|fehler> [Text]
 *   node server/sicherung.js anzeigen
 *
 * Die Datenbank kommt aus BAUTAG_DB (Standard data/bautag.db). Ausgabe immer als JSON (eine Zeile).
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync, backup } = require('node:sqlite');

const AUFBEWAHRUNG = { taeglich: 14, woechentlich: 8, monatlich: 12 };
/** Tabellen, deren Zeilenzahl die Prüfung meldet (fehlende werden übersprungen) */
const ZAEHL_TABELLEN = ['benutzer', 'baustelle', 'buchung', 'bericht', 'bericht_personal', 'abwesenheit', 'projektposition', 'projektposition_menge', 'anlage', 'protokoll'];
const ARTEN = ['lokal', 'offsite', 'test'];

/** Wiener Datum JJJJ-MM-TT */
function wienDatum(d) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * Konsistente Sicherung der Datenbank (+ Fotos) in `ziel`.
 * @returns {Promise<{datei:string, groesse:number, uploads:string|null, geloescht:string[]}>}
 */
async function sichern(dbPfad, ziel, { uploads = null, jetzt = new Date(), aufbewahrung = AUFBEWAHRUNG } = {}) {
  if (!fs.existsSync(dbPfad)) throw new Error(`Datenbank ${dbPfad} nicht gefunden.`);
  fs.mkdirSync(ziel, { recursive: true, mode: 0o700 });
  const tag = wienDatum(jetzt);
  const datei = path.join(ziel, `bautag-${tag}.db`);
  const tmp = `${datei}.tmp-${process.pid}`;
  const quelle = new DatabaseSync(dbPfad, { readOnly: true });
  try {
    await backup(quelle, tmp);
  } finally {
    quelle.close();
  }
  // Kopie als eigenständige Datei (ohne WAL-Begleitdateien)
  const kopie = new DatabaseSync(tmp);
  kopie.exec('PRAGMA journal_mode = DELETE');
  kopie.close();
  const pruefung = pruefen(tmp);
  if (!pruefung.ok) { fs.rmSync(tmp, { force: true }); throw new Error(`Sicherung fehlerhaft: ${pruefung.integritaet}`); }
  fs.renameSync(tmp, datei);
  fs.chmodSync(datei, 0o600);
  let uploadsDatei = null;
  if (uploads && fs.existsSync(uploads)) {
    uploadsDatei = path.join(ziel, `uploads-${tag}.tar.gz`);
    const r = spawnSync('tar', ['-czf', uploadsDatei, '-C', path.dirname(path.resolve(uploads)), path.basename(path.resolve(uploads))], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`Fotos konnten nicht gesichert werden: ${(r.stderr || r.error || '').toString().trim()}`);
    fs.chmodSync(uploadsDatei, 0o600);
  }
  const geloescht = rotieren(ziel, { jetzt, aufbewahrung });
  return { datei, groesse: fs.statSync(datei).size, uploads: uploadsDatei, geloescht, tabellen: pruefung.tabellen };
}

/**
 * Welche Tagesstände bleiben? Die jüngsten `taeglich` Tage, je ISO-Woche der jüngste Stand für die
 * jüngsten `woechentlich` Wochen und je Monat der jüngste für die jüngsten `monatlich` Monate.
 * @param {string[]} tage  JJJJ-MM-TT
 * @returns {Set<string>}
 */
function behalten(tage, aufbewahrung = AUFBEWAHRUNG) {
  const sortiert = [...new Set(tage)].sort().reverse();
  const bleibt = new Set(sortiert.slice(0, aufbewahrung.taeglich));
  const woche = (t) => {
    const d = new Date(`${t}T00:00:00Z`);
    const tagNr = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - tagNr); // Donnerstag der ISO-Woche
    const jahresanfang = Date.UTC(d.getUTCFullYear(), 0, 1);
    return `${d.getUTCFullYear()}-W${String(Math.ceil(((d - jahresanfang) / 864e5 + 1) / 7)).padStart(2, '0')}`;
  };
  for (const [schluessel, anzahl] of [[woche, aufbewahrung.woechentlich], [(t) => t.slice(0, 7), aufbewahrung.monatlich]]) {
    const gesehen = new Set();
    for (const t of sortiert) {
      const k = schluessel(t);
      if (gesehen.has(k)) continue;
      if (gesehen.size >= anzahl) break;
      gesehen.add(k);
      bleibt.add(t);
    }
  }
  return bleibt;
}

/** Alte Stände löschen (Datenbank und Fotos gemeinsam) → gelöschte Dateinamen */
function rotieren(ziel, { aufbewahrung = AUFBEWAHRUNG } = {}) {
  const re = /^(bautag|uploads)-(\d{4}-\d{2}-\d{2})\.(db|tar\.gz)$/;
  const dateien = fs.readdirSync(ziel).filter((f) => re.test(f));
  const bleibt = behalten(dateien.map((f) => re.exec(f)[2]), aufbewahrung);
  const geloescht = [];
  for (const f of dateien) {
    if (!bleibt.has(re.exec(f)[2])) { fs.rmSync(path.join(ziel, f), { force: true }); geloescht.push(f); }
  }
  return geloescht.sort();
}

/** Prüft eine Sicherungsdatei: integrity_check + Zeilenzahlen + Schema-Version */
function pruefen(datei) {
  if (!fs.existsSync(datei)) return { ok: false, integritaet: 'Datei fehlt', tabellen: {} };
  let db;
  try {
    db = new DatabaseSync(datei, { readOnly: true });
    const integritaet = db.prepare('PRAGMA integrity_check').all().map((z) => Object.values(z)[0]).join('; ');
    const vorhanden = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((z) => z.name));
    const tabellen = {};
    for (const t of ZAEHL_TABELLEN) if (vorhanden.has(t)) tabellen[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    const version = vorhanden.has('schema_version') ? db.prepare('SELECT MAX(version) AS v FROM schema_version').get().v : null;
    const ok = integritaet === 'ok' && vorhanden.has('benutzer') && version != null;
    return { ok, integritaet, schemaVersion: version, tabellen };
  } catch (e) {
    return { ok: false, integritaet: e.message, tabellen: {} };
  } finally {
    if (db) db.close();
  }
}

/** Status einer Sicherungsart in die Datenbank schreiben (Einstellung `sicherung`) */
function statusMelden(dbPfad, art, ok, text = '', jetzt = new Date()) {
  if (!ARTEN.includes(art)) throw new Error(`Art muss ${ARTEN.join('|')} sein.`);
  const db = new DatabaseSync(dbPfad);
  try {
    db.exec('PRAGMA busy_timeout = 10000');
    const z = db.prepare("SELECT wert FROM einstellung WHERE schluessel = 'sicherung'").get();
    let s = {};
    try { s = z ? JSON.parse(z.wert) : {}; } catch (_) { s = {}; }
    const alt = s[art] || {};
    s[art] = { zeit: jetzt.toISOString(), ok: Boolean(ok), text: String(text).slice(0, 500), letzteOk: ok ? jetzt.toISOString() : (alt.letzteOk || null) };
    db.prepare("INSERT INTO einstellung (schluessel, wert) VALUES ('sicherung', ?) ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert").run(JSON.stringify(s));
    return s;
  } finally {
    db.close();
  }
}

module.exports = { sichern, rotieren, behalten, pruefen, statusMelden, wienDatum, AUFBEWAHRUNG };

if (require.main === module) {
  const [befehl, ...rest] = process.argv.slice(2);
  const dbPfad = process.env.BAUTAG_DB || path.join(__dirname, '..', 'data', 'bautag.db');
  const aus = (o, code = 0) => { process.stdout.write(JSON.stringify(o) + '\n'); process.exitCode = code; };
  (async () => {
    try {
      if (befehl === 'sichern') {
        const ziel = rest[0];
        if (!ziel) throw new Error('Zielordner fehlt.');
        const i = rest.indexOf('--uploads');
        const uploads = i > 0 ? rest[i + 1] : (process.env.BAUTAG_UPLOADS || path.join(path.dirname(path.resolve(dbPfad)), 'uploads'));
        try {
          const r = await sichern(dbPfad, ziel, { uploads });
          statusMelden(dbPfad, 'lokal', true, `${path.basename(r.datei)} (${Math.round(r.groesse / 1024)} KB)`);
          aus({ ok: true, ...r });
        } catch (e) {
          try { statusMelden(dbPfad, 'lokal', false, e.message); } catch (_) { /* DB nicht erreichbar */ }
          throw e;
        }
      } else if (befehl === 'pruefen') {
        const r = pruefen(rest[0]);
        aus(r, r.ok ? 0 : 2);
      } else if (befehl === 'status') {
        aus({ ok: true, sicherung: statusMelden(dbPfad, rest[0], rest[1] === 'ok', rest.slice(2).join(' ')) });
      } else if (befehl === 'anzeigen') {
        const db = new DatabaseSync(dbPfad, { readOnly: true });
        const z = db.prepare("SELECT wert FROM einstellung WHERE schluessel = 'sicherung'").get();
        db.close();
        aus({ ok: true, sicherung: z ? JSON.parse(z.wert) : {} });
      } else {
        throw new Error('Befehl: sichern <Ziel> [--uploads <Ordner>] | pruefen <Datei> | status <lokal|offsite|test> <ok|fehler> [Text] | anzeigen');
      }
    } catch (e) {
      aus({ ok: false, fehler: e.message }, 1);
    }
  })();
}
