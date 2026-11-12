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

function param(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

class Datenbank {
  constructor(dbPfad) {
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
    this.migrieren();
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
    const r = this.stmt(sql).run(...p.map(param));
    return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
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

  migrieren() {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, name TEXT, angewendet TEXT NOT NULL)');
    const vorhanden = new Set(this.alle('SELECT version FROM schema_version').map((z) => z.version));
    for (const m of MIGRATIONEN) {
      if (vorhanden.has(m.version)) continue;
      this.transaktion(() => {
        this.db.exec(m.sql);
        this.lauf('INSERT INTO schema_version (version, name, angewendet) VALUES (?, ?, ?)', m.version, m.name, new Date().toISOString());
      });
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

function oeffneDatenbank(dbPfad) {
  return new Datenbank(dbPfad);
}

module.exports = { oeffneDatenbank, Datenbank };
