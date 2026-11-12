'use strict';
/**
 * SQL-Migrationen. Werden beim Start der Reihe nach angewendet (Tabelle schema_version).
 * Neue Änderungen immer als neue Migration anhängen, bestehende nie verändern.
 */

const MIGRATIONEN = [
  {
    version: 1,
    name: 'Grundschema',
    sql: `
CREATE TABLE lohngruppe (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kv TEXT,
  kostensatz REAL NOT NULL DEFAULT 0 CHECK (kostensatz >= 0),
  regiesatz REAL NOT NULL DEFAULT 0 CHECK (regiesatz >= 0),
  sortierung INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE baustelle (
  id INTEGER PRIMARY KEY,
  kst TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kurz TEXT,
  auftraggeber TEXT,
  ag_adresse TEXT,
  bauvorhaben TEXT,
  adresse TEXT,
  bauherr_vertreter TEXT,
  art TEXT,
  status TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('geplant','aktiv','abgeschlossen')),
  intern INTEGER NOT NULL DEFAULT 0 CHECK (intern IN (0,1)),
  polier_id INTEGER REFERENCES benutzer(id),
  bauleiter_id INTEGER REFERENCES benutzer(id),
  beginn TEXT,
  ende TEXT,
  auftragssumme REAL CHECK (auftragssumme IS NULL OR auftragssumme >= 0),
  schwellen TEXT NOT NULL DEFAULT '[80,90,100]',
  empfaenger TEXT NOT NULL DEFAULT '{"bauleiter":true,"buero":true,"gf":true}',
  erstellt TEXT NOT NULL
);

CREATE TABLE benutzer (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  rolle TEXT NOT NULL CHECK (rolle IN ('mitarbeiter','polier','bauleiter','buero','gf')),
  lohngruppe_id TEXT REFERENCES lohngruppe(id),
  baustelle_id INTEGER REFERENCES baustelle(id),
  pnr INTEGER,
  aktiv INTEGER NOT NULL DEFAULT 1 CHECK (aktiv IN (0,1)),
  pin_hash TEXT NOT NULL,
  erstellt TEXT NOT NULL
);

CREATE TABLE sitzung (
  token_hash TEXT PRIMARY KEY,
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  erstellt TEXT NOT NULL,
  letzte_aktivitaet TEXT NOT NULL
);
CREATE INDEX sitzung_benutzer ON sitzung(benutzer_id);

CREATE TABLE login_versuch (
  benutzer_id INTEGER PRIMARY KEY,
  fehlversuche INTEGER NOT NULL DEFAULT 0,
  gesperrt_bis TEXT
);

CREATE TABLE rolle_recht (
  rolle TEXT NOT NULL,
  recht TEXT NOT NULL,
  wert INTEGER NOT NULL CHECK (wert IN (0,1)),
  PRIMARY KEY (rolle, recht)
);

CREATE TABLE benutzer_recht (
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  recht TEXT NOT NULL,
  erteilt_von INTEGER REFERENCES benutzer(id),
  erteilt TEXT NOT NULL,
  PRIMARY KEY (benutzer_id, recht)
);

CREATE TABLE nachtrag (
  id INTEGER PRIMARY KEY,
  baustelle_id INTEGER NOT NULL REFERENCES baustelle(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  betrag REAL NOT NULL,
  erstellt TEXT NOT NULL,
  erstellt_von INTEGER REFERENCES benutzer(id)
);

CREATE TABLE geraet (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  gruppe TEXT,
  kostensatz REAL NOT NULL DEFAULT 0 CHECK (kostensatz >= 0),
  verrechnungssatz REAL NOT NULL DEFAULT 0 CHECK (verrechnungssatz >= 0),
  vorlage INTEGER NOT NULL DEFAULT 1,
  sortierung INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE material (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  einheit TEXT NOT NULL,
  ek REAL NOT NULL DEFAULT 0 CHECK (ek >= 0),
  vk REAL NOT NULL DEFAULT 0 CHECK (vk >= 0),
  vorlage INTEGER NOT NULL DEFAULT 0,
  hinweis TEXT,
  sortierung INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE leistung (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  text TEXT NOT NULL,
  einheit TEXT NOT NULL,
  ep REAL NOT NULL DEFAULT 0 CHECK (ep >= 0)
);

CREATE TABLE leistungsmeldung (
  id INTEGER PRIMARY KEY,
  baustelle_id INTEGER NOT NULL REFERENCES baustelle(id) ON DELETE CASCADE,
  leistung_id INTEGER NOT NULL REFERENCES leistung(id),
  menge REAL NOT NULL,
  datum TEXT NOT NULL,
  erstellt_von INTEGER REFERENCES benutzer(id),
  erstellt TEXT NOT NULL
);
CREATE INDEX leistungsmeldung_bs ON leistungsmeldung(baustelle_id);

CREATE TABLE fremdleistung (
  id INTEGER PRIMARY KEY,
  baustelle_id INTEGER NOT NULL REFERENCES baustelle(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  betrag REAL NOT NULL,
  datum TEXT NOT NULL,
  erstellt_von INTEGER REFERENCES benutzer(id),
  erstellt TEXT NOT NULL
);
CREATE INDEX fremdleistung_bs ON fremdleistung(baustelle_id);

CREATE TABLE buchung (
  id INTEGER PRIMARY KEY,
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id),
  typ TEXT NOT NULL CHECK (typ IN ('kommen','gehen','pause_start','pause_ende','wechsel')),
  zeit TEXT NOT NULL,
  baustelle_id INTEGER REFERENCES baustelle(id),
  quelle TEXT NOT NULL CHECK (quelle IN ('app','kolonne','offline','buero','seed')),
  erfasst_von INTEGER REFERENCES benutzer(id),
  erfasst TEXT NOT NULL,
  lat REAL, lng REAL, genauigkeit REAL
);
CREATE INDEX buchung_benutzer_zeit ON buchung(benutzer_id, zeit);
CREATE INDEX buchung_baustelle_zeit ON buchung(baustelle_id, zeit);

CREATE TABLE abwesenheit (
  id INTEGER PRIMARY KEY,
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id),
  datum TEXT NOT NULL,
  code TEXT NOT NULL CHECK (code IN ('K','U','SW','ZA')),
  status TEXT NOT NULL CHECK (status IN ('beantragt','genehmigt')),
  erfasst_von INTEGER REFERENCES benutzer(id),
  erfasst TEXT NOT NULL,
  UNIQUE (benutzer_id, datum)
);

CREATE TABLE bericht (
  id INTEGER PRIMARY KEY,
  baustelle_id INTEGER NOT NULL REFERENCES baustelle(id),
  datum TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf','unterschrieben','freigegeben')),
  seg_taetigkeit TEXT,
  seg_stunden REAL,
  arbeitsleistung TEXT NOT NULL DEFAULT '',
  mb_eigen TEXT NOT NULL DEFAULT '',
  mb_fremd TEXT NOT NULL DEFAULT '',
  paletten_euro INTEGER NOT NULL DEFAULT 0,
  paletten_weissenboeck INTEGER NOT NULL DEFAULT 0,
  vorkommnisse TEXT NOT NULL DEFAULT '',
  wetter TEXT,
  erstellt_von INTEGER REFERENCES benutzer(id),
  erstellt TEXT NOT NULL,
  geaendert TEXT NOT NULL,
  freigegeben_von INTEGER REFERENCES benutzer(id),
  freigegeben_zeit TEXT,
  UNIQUE (baustelle_id, datum)
);

CREATE TABLE bericht_personal (
  id INTEGER PRIMARY KEY,
  bericht_id INTEGER NOT NULL REFERENCES bericht(id) ON DELETE CASCADE,
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id),
  von1 TEXT, bis1 TEXT, von2 TEXT, bis2 TEXT,
  pause_min INTEGER NOT NULL DEFAULT 0,
  stunden REAL NOT NULL DEFAULT 0,
  seg_stunden REAL NOT NULL DEFAULT 0,
  code TEXT,
  pos INTEGER NOT NULL DEFAULT 0,
  UNIQUE (bericht_id, benutzer_id)
);

CREATE TABLE bericht_geraet (
  bericht_id INTEGER NOT NULL REFERENCES bericht(id) ON DELETE CASCADE,
  geraet_id INTEGER NOT NULL REFERENCES geraet(id),
  stunden REAL NOT NULL,
  PRIMARY KEY (bericht_id, geraet_id)
);

CREATE TABLE bericht_material (
  bericht_id INTEGER NOT NULL REFERENCES bericht(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES material(id),
  menge REAL NOT NULL,
  PRIMARY KEY (bericht_id, material_id)
);

CREATE TABLE bericht_regie (
  id INTEGER PRIMARY KEY,
  bericht_id INTEGER NOT NULL REFERENCES bericht(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  stunden REAL NOT NULL,
  pos INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE unterschrift (
  bericht_id INTEGER NOT NULL REFERENCES bericht(id) ON DELETE CASCADE,
  rolle TEXT NOT NULL CHECK (rolle IN ('an','bh')),
  name TEXT NOT NULL,
  zeit TEXT NOT NULL,
  bild_png TEXT,
  erfasst_von INTEGER REFERENCES benutzer(id),
  PRIMARY KEY (bericht_id, rolle)
);

CREATE TABLE budget_alarm (
  baustelle_id INTEGER NOT NULL REFERENCES baustelle(id) ON DELETE CASCADE,
  schwelle TEXT NOT NULL,
  ausgeloest TEXT NOT NULL,
  verbrauch REAL,
  leistungsstand REAL,
  basis REAL,
  PRIMARY KEY (baustelle_id, schwelle)
);

CREATE TABLE benachrichtigung (
  id INTEGER PRIMARY KEY,
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  typ TEXT NOT NULL CHECK (typ IN ('budget','azg','bericht')),
  titel TEXT NOT NULL,
  text TEXT NOT NULL,
  zeit TEXT NOT NULL,
  gelesen INTEGER NOT NULL DEFAULT 0,
  baustelle_id INTEGER REFERENCES baustelle(id),
  schluessel TEXT,
  UNIQUE (benutzer_id, schluessel)
);
CREATE INDEX benachrichtigung_benutzer ON benachrichtigung(benutzer_id, zeit);

CREATE TABLE einstellung (
  schluessel TEXT PRIMARY KEY,
  wert TEXT NOT NULL
);

CREATE TABLE protokoll (
  id INTEGER PRIMARY KEY,
  zeit TEXT NOT NULL,
  benutzer_id INTEGER,
  art TEXT NOT NULL,
  objekt TEXT,
  alt TEXT,
  neu TEXT,
  text TEXT
);
CREATE INDEX protokoll_zeit ON protokoll(zeit);

-- Das Änderungsprotokoll ist unveränderbar (Konzept 2.2): weder ändern noch löschen.
CREATE TRIGGER protokoll_kein_update BEFORE UPDATE ON protokoll
BEGIN SELECT RAISE(ABORT, 'Das Protokoll ist unveränderbar'); END;
CREATE TRIGGER protokoll_kein_delete BEFORE DELETE ON protokoll
BEGIN SELECT RAISE(ABORT, 'Das Protokoll ist unveränderbar'); END;
`
  },
  {
    version: 2,
    name: 'Prüfbericht 1: Login-Sperre je IP, Abwesenheit abgelehnt, PIN-Pflicht, eindeutige Personalnummer',
    sql: `
DROP TABLE login_versuch;
CREATE TABLE login_versuch (
  benutzer_id INTEGER NOT NULL,
  ip TEXT NOT NULL,
  fehlversuche INTEGER NOT NULL DEFAULT 0,
  sperren INTEGER NOT NULL DEFAULT 0,
  gesperrt_bis TEXT,
  letzter TEXT,
  PRIMARY KEY (benutzer_id, ip)
);

ALTER TABLE abwesenheit RENAME TO abwesenheit_alt;
CREATE TABLE abwesenheit (
  id INTEGER PRIMARY KEY,
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id),
  datum TEXT NOT NULL,
  code TEXT NOT NULL CHECK (code IN ('K','U','SW','ZA')),
  status TEXT NOT NULL CHECK (status IN ('beantragt','genehmigt','abgelehnt')),
  erfasst_von INTEGER REFERENCES benutzer(id),
  erfasst TEXT NOT NULL,
  entschieden_von INTEGER REFERENCES benutzer(id),
  entschieden TEXT,
  UNIQUE (benutzer_id, datum)
);
INSERT INTO abwesenheit (id, benutzer_id, datum, code, status, erfasst_von, erfasst)
  SELECT id, benutzer_id, datum, code, status, erfasst_von, erfasst FROM abwesenheit_alt;
DROP TABLE abwesenheit_alt;

ALTER TABLE benachrichtigung RENAME TO benachrichtigung_alt;
CREATE TABLE benachrichtigung (
  id INTEGER PRIMARY KEY,
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  typ TEXT NOT NULL CHECK (typ IN ('budget','azg','bericht','abwesenheit')),
  titel TEXT NOT NULL,
  text TEXT NOT NULL,
  zeit TEXT NOT NULL,
  gelesen INTEGER NOT NULL DEFAULT 0,
  baustelle_id INTEGER REFERENCES baustelle(id),
  schluessel TEXT,
  UNIQUE (benutzer_id, schluessel)
);
INSERT INTO benachrichtigung SELECT * FROM benachrichtigung_alt;
DROP TABLE benachrichtigung_alt;
DROP INDEX IF EXISTS benachrichtigung_benutzer;
CREATE INDEX benachrichtigung_benutzer ON benachrichtigung(benutzer_id, zeit);

ALTER TABLE benutzer ADD COLUMN muss_pin_aendern INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX benutzer_pnr ON benutzer(pnr) WHERE pnr IS NOT NULL;
`
  }
];

module.exports = { MIGRATIONEN };
