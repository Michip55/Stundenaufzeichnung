'use strict';
/**
 * Datenbankzugriff über das eingebaute node:sqlite (DatabaseSync).
 * - Fremdschlüssel EIN, WAL für Datei-Datenbanken
 * - Migrationen beim Öffnen
 * - ausschließlich parametrisierte Abfragen (Hilfsfunktionen alle/eins/lauf)
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { MIGRATIONEN } = require('./schema');

/*
 * 15.15 (ID-Nachtrag, Inhaberregel 3): Tabellen-IDs aus der Zeit statt fortlaufend. Fortlaufende IDs verrieten über die
 * Lücke zwischen zwei eigenen Einträgen, wie viele Einträge andere Personen dazwischen angelegt haben (Benachrichtigungen,
 * Fotos, Berichte, Buchungen, Planeinträge …). Neue Zeilen bekommen deshalb – sobald zeitIds eingeschaltet ist (nach dem
 * Einrichten in createApp; Testdaten und Grundausstattung bleiben fortlaufend) – die ID max(größte ID + 1, Zeit in µs seit
 * 2020). Die ID hängt damit nur vom Zeitpunkt ab (monoton – Reihenfolge nach ID bleibt die Reihenfolge des Anlegens), nicht
 * von der Zahl fremder Einträge. Gilt für jede Tabelle mit INTEGER PRIMARY KEY „id“, wenn das INSERT keine id angibt.
 * Ausnahme: abwesenheit – nach außen nur die zufälligen Kennungen aus server/oeffentlich.js (15.11, H-G1).
 */
const ID_EPOCHE_US = Date.UTC(2020, 0, 1) * 1000;
const ZEIT_ID_AUSNAHMEN = new Set(['abwesenheit']);
const INSERT_RE = /^(\s*INSERT\s+(?:OR\s+[A-Za-z]+\s+)?INTO\s+)([A-Za-z_][A-Za-z0-9_]*)(\s*\()([^()]*)(\)\s*VALUES\s*\()/i;

function param(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

class Datenbank {
  /** @param {{bisVersion?: number}} [opt] nur für Tests: Migrationen nur bis zu dieser Version */
  constructor(dbPfad, opt = {}) {
    this.pfad = dbPfad || ':memory:';
    if (this.pfad !== ':memory:') {
      fs.mkdirSync(path.dirname(path.resolve(this.pfad)), { recursive: true });
    }
    this.db = new DatabaseSync(this.pfad);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA busy_timeout = 5000');
    if (this.pfad !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL');
    this.cache = new Map();
    this.tiefe = 0;
    this.zeitIds = false; // createApp schaltet nach dem Einrichten ein
    this.idUhr = () => Math.floor((performance.timeOrigin + performance.now()) * 1000); // µs (Wanduhr)
    this.umschrift = new Map();
    this.idTabelle = new Map();
    this.migrieren(opt.bisVersion);
    if (!opt.bisVersion) this.nachMigration();
  }

  stmt(sql) {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  /** Alle Zeilen als Array */
  alle(sql, ...p) {
    return this.stmt(sql).all(...p.map(param)).map((z) => ({ ...z }));
  }

  /** Erste Zeile oder null */
  eins(sql, ...p) {
    const z = this.stmt(sql).get(...p.map(param));
    return z ? { ...z } : null;
  }

  /** Schreibende Anweisung; liefert {changes, lastInsertRowid} */
  lauf(sql, ...p) {
    const u = this.zeitIds ? this.mitZeitId(sql) : null;
    const r = u ? this.stmt(u.sql).run(this.neueId(u.tabelle), ...p.map(param)) : this.stmt(sql).run(...p.map(param));
    return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
  }

  /** Hat die Tabelle eine INTEGER-PRIMARY-KEY-Spalte „id“ (rowid)? */
  hatIdSpalte(tabelle) {
    if (!this.idTabelle.has(tabelle)) {
      const pk = this.alle(`PRAGMA table_info(${tabelle})`).filter((c) => c.pk);
      this.idTabelle.set(tabelle, pk.length === 1 && pk[0].name === 'id' && /^INTEGER$/i.test(pk[0].type));
    }
    return this.idTabelle.get(tabelle);
  }

  /** INSERT ohne id in eine Tabelle mit Zeit-IDs → {sql mit id als erstem Wert, tabelle}; sonst null */
  mitZeitId(sql) {
    if (this.umschrift.has(sql)) return this.umschrift.get(sql);
    let u = null;
    const m = INSERT_RE.exec(sql);
    if (m && !ZEIT_ID_AUSNAHMEN.has(m[2]) && this.hatIdSpalte(m[2]) && !m[4].split(',').some((c) => c.trim().toLowerCase() === 'id')) {
      const rest = sql.slice(m[0].length);
      // nur einzeilige VALUES (mehrere Zeilen in einer Anweisung gibt es im Server-Code nicht)
      if (!/\)\s*,\s*\(/.test(rest)) u = { sql: `${m[1]}${m[2]}${m[3]}id, ${m[4]}${m[5]}?, ${rest}`, tabelle: m[2] };
    }
    this.umschrift.set(sql, u);
    return u;
  }

  /** Neue ID: Zeitpunkt in µs seit 2020, mindestens größte vorhandene ID + 1 */
  neueId(tabelle) {
    const max = this.eins(`SELECT MAX(id) AS m FROM ${tabelle}`).m || 0;
    return Math.max(max + 1, this.idUhr() - ID_EPOCHE_US);
  }

  /** Führt fn in einer Transaktion aus (verschachtelt = Teil der äußeren). */
  transaktion(fn) {
    if (this.tiefe > 0) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.tiefe++;
    try {
      const r = fn();
      this.tiefe--;
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.tiefe--;
      try { this.db.exec('ROLLBACK'); } catch (_) { /* bereits zurückgerollt */ }
      throw e;
    }
  }

  migrieren(bisVersion = Infinity) {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, name TEXT, angewendet TEXT NOT NULL)');
    const vorhanden = new Set(this.alle('SELECT version FROM schema_version').map((z) => z.version));
    for (const m of MIGRATIONEN) {
      if (vorhanden.has(m.version) || m.version > bisVersion) continue;
      this.transaktion(() => {
        this.db.exec(m.sql);
        this.lauf('INSERT INTO schema_version (version, name, angewendet) VALUES (?, ?, ?)', m.version, m.name, new Date().toISOString());
      });
    }
  }

  /** Nachträge, die SQL allein nicht kann (z. B. Hash der Unterschriftsbilder) */
  nachMigration() {
    for (const u of this.alle('SELECT bericht_id, rolle, bild_png FROM unterschrift WHERE bild_hash IS NULL AND bild_png IS NOT NULL')) {
      this.lauf('UPDATE unterschrift SET bild_hash = ? WHERE bericht_id = ? AND rolle = ?', bildHash(u.bild_png), u.bericht_id, u.rolle);
    }
  }

  einstellung(schluessel, standard) {
    const z = this.eins('SELECT wert FROM einstellung WHERE schluessel = ?', schluessel);
    if (!z) return standard;
    try { return JSON.parse(z.wert); } catch (_) { return standard; }
  }

  setzeEinstellung(schluessel, wert) {
    this.lauf('INSERT INTO einstellung (schluessel, wert) VALUES (?, ?) ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert', schluessel, JSON.stringify(wert));
  }

  /** Eintrag ins unveränderbare Änderungsprotokoll */
  protokolliere({ zeit, benutzerId, art, objekt, alt, neu, text }) {
    const s = (v) => (v === undefined || v === null ? null : typeof v === 'string' ? v : JSON.stringify(v));
    this.lauf('INSERT INTO protokoll (zeit, benutzer_id, art, objekt, alt, neu, text) VALUES (?, ?, ?, ?, ?, ?, ?)',
      zeit, benutzerId ?? null, art, objekt ?? null, s(alt), s(neu), text ?? null);
  }

  schliessen() {
    try { this.db.close(); } catch (_) { /* schon zu */ }
  }
}

/**
 * SHA-256 über die dekodierten Bildpunkte einer PNG-data-URL (D-05); bei nicht lesbarem PNG über die Bytes.
 */
function bildHash(dataUrl) {
  const crypto = require('node:crypto');
  const b64 = String(dataUrl).slice(String(dataUrl).indexOf(',') + 1);
  const buf = Buffer.from(b64, 'base64');
  try {
    const p = require('./png').pngBildpunkte(buf);
    return crypto.createHash('sha256').update(`png:${p.w}x${p.h}:${p.farbtyp}:${p.bittiefe}:`).update(p.palette || Buffer.alloc(0)).update(p.daten).digest('hex');
  } catch (_) {
    return crypto.createHash('sha256').update(buf).digest('hex');
  }
}

function oeffneDatenbank(dbPfad, opt) {
  return new Datenbank(dbPfad, opt);
}

module.exports = { oeffneDatenbank, Datenbank, bildHash };
