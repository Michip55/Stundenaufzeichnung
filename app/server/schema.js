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
  },
  {
    version: 3,
    name: 'Hinweis je Personalzeile (z. B. Ausstempeln fehlt)',
    sql: `ALTER TABLE bericht_personal ADD COLUMN hinweis TEXT;`
  },
  {
    version: 4,
    name: 'Prüfbericht 2: Versionen, Gast-Zeilen, Unterschrift-Hash/Widerruf, Kontosperre, Sicherheits-Meldungen',
    sql: `
ALTER TABLE bericht_personal ADD COLUMN gast INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bericht ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bericht ADD COLUMN geaendert_nach_unterschrift TEXT;
ALTER TABLE baustelle ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE unterschrift ADD COLUMN bild_hash TEXT;
CREATE INDEX unterschrift_hash ON unterschrift(bild_hash);

CREATE TABLE unterschrift_widerruf (
  id INTEGER PRIMARY KEY,
  bericht_id INTEGER NOT NULL REFERENCES bericht(id) ON DELETE CASCADE,
  rolle TEXT NOT NULL,
  name TEXT,
  bild_hash TEXT,
  unterschrieben TEXT,
  zeit TEXT NOT NULL,
  von INTEGER REFERENCES benutzer(id)
);

CREATE TABLE login_konto (
  benutzer_id INTEGER PRIMARY KEY,
  fehlversuche INTEGER NOT NULL DEFAULT 0,
  erster TEXT,
  gesperrt INTEGER NOT NULL DEFAULT 0,
  gesperrt_seit TEXT
);

ALTER TABLE benachrichtigung RENAME TO benachrichtigung_alt;
CREATE TABLE benachrichtigung (
  id INTEGER PRIMARY KEY,
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  typ TEXT NOT NULL CHECK (typ IN ('budget','azg','bericht','abwesenheit','sicherheit')),
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
`
  },
  {
    version: 5,
    name: 'Prüfbericht 3: befristete Kontosperre, PIN-Länge, Selbstfreigabe, Bildpunkt-Hash',
    sql: `
ALTER TABLE login_konto ADD COLUMN sperren INTEGER NOT NULL DEFAULT 0;
ALTER TABLE login_konto ADD COLUMN gesperrt_bis TEXT;
UPDATE login_konto SET gesperrt_bis = datetime(gesperrt_seit, '+1 day') WHERE gesperrt = 1;
ALTER TABLE benutzer ADD COLUMN pin_laenge INTEGER;
ALTER TABLE bericht ADD COLUMN selbstfreigabe INTEGER NOT NULL DEFAULT 0;
UPDATE unterschrift SET bild_hash = NULL;
`
  },
  {
    version: 6,
    name: 'Nachkalkulation nach Positionen (Firmenvorlage, Projektpositionen, Mengen)',
    sql: `
CREATE TABLE katalog (
  id INTEGER PRIMARY KEY,
  gruppe TEXT NOT NULL CHECK (gruppe IN ('arbeit','transport','geraete','eigenmaterial','fremdmaterial','abgaben')),
  bezeichnung TEXT NOT NULL,
  einheit TEXT NOT NULL,
  ep REAL NOT NULL DEFAULT 0 CHECK (ep >= 0),
  sortierung INTEGER NOT NULL DEFAULT 0,
  quelle TEXT,
  zuordnung_pruefen INTEGER NOT NULL DEFAULT 0,
  aktiv INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  geaendert TEXT
);
CREATE TABLE projektposition (
  id INTEGER PRIMARY KEY,
  baustelle_id INTEGER NOT NULL REFERENCES baustelle(id) ON DELETE CASCADE,
  katalog_id INTEGER REFERENCES katalog(id),
  gruppe TEXT NOT NULL CHECK (gruppe IN ('arbeit','transport','geraete','eigenmaterial','fremdmaterial','abgaben')),
  bezeichnung TEXT NOT NULL,
  einheit TEXT NOT NULL,
  ep REAL NOT NULL DEFAULT 0 CHECK (ep >= 0),
  sortierung INTEGER NOT NULL DEFAULT 0,
  quelle TEXT,
  zuordnung_pruefen INTEGER NOT NULL DEFAULT 0,
  aktiv INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  erstellt TEXT NOT NULL,
  geaendert TEXT NOT NULL
);
CREATE INDEX projektposition_bs ON projektposition(baustelle_id, gruppe, sortierung);
CREATE TABLE projektposition_menge (
  id INTEGER PRIMARY KEY,
  position_id INTEGER NOT NULL REFERENCES projektposition(id) ON DELETE CASCADE,
  datum TEXT NOT NULL,
  menge REAL NOT NULL,
  notiz TEXT,
  erstellt TEXT NOT NULL,
  erstellt_von INTEGER REFERENCES benutzer(id)
);
CREATE INDEX projektposition_menge_pos ON projektposition_menge(position_id);
`
  },
  {
    version: 7,
    name: 'Naturmaterial-Kennzeichen und automatische Landschaftsabgabe (API.md 10a)',
    sql: `
ALTER TABLE katalog ADD COLUMN naturmaterial INTEGER NOT NULL DEFAULT 0;
ALTER TABLE katalog ADD COLUMN naturmaterial_pruefen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projektposition ADD COLUMN naturmaterial INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projektposition ADD COLUMN naturmaterial_pruefen INTEGER NOT NULL DEFAULT 0;
UPDATE katalog SET naturmaterial_pruefen = 1 WHERE gruppe = 'eigenmaterial';
UPDATE projektposition SET naturmaterial_pruefen = 1 WHERE gruppe = 'eigenmaterial';
UPDATE katalog SET naturmaterial = 1 WHERE gruppe = 'eigenmaterial' AND einheit = 't' AND (bezeichnung LIKE 'Sand %' OR bezeichnung LIKE 'Bruchsand%'
  OR bezeichnung LIKE 'Kies%' OR bezeichnung LIKE 'Rollschotter%' OR bezeichnung LIKE 'Splitt%' OR bezeichnung LIKE 'Wandschotter%' OR bezeichnung LIKE 'Grädermaterial%');
UPDATE projektposition SET naturmaterial = 1 WHERE gruppe = 'eigenmaterial' AND einheit = 't' AND (bezeichnung LIKE 'Sand %' OR bezeichnung LIKE 'Bruchsand%'
  OR bezeichnung LIKE 'Kies%' OR bezeichnung LIKE 'Rollschotter%' OR bezeichnung LIKE 'Splitt%' OR bezeichnung LIKE 'Wandschotter%' OR bezeichnung LIKE 'Grädermaterial%');
UPDATE katalog SET quelle = '{"art":"naturmaterial"}', zuordnung_pruefen = 1 WHERE bezeichnung = 'Landschaftsabgabe' AND quelle IS NULL;
UPDATE projektposition SET quelle = '{"art":"naturmaterial"}', zuordnung_pruefen = 1 WHERE bezeichnung = 'Landschaftsabgabe' AND quelle IS NULL;
`
  },
  {
    version: 8,
    name: 'Herkunft der Positionen (vorlage_excel | preisliste_2026 | eigen), API.md 10d',
    sql: `
ALTER TABLE katalog ADD COLUMN herkunft TEXT NOT NULL DEFAULT 'eigen' CHECK (herkunft IN ('vorlage_excel','preisliste_2026','eigen'));
ALTER TABLE projektposition ADD COLUMN herkunft TEXT NOT NULL DEFAULT 'eigen' CHECK (herkunft IN ('vorlage_excel','preisliste_2026','eigen'));
UPDATE katalog SET herkunft = 'vorlage_excel';
UPDATE projektposition SET herkunft = 'vorlage_excel' WHERE katalog_id IS NOT NULL;
`
  },
  {
    version: 9,
    name: 'Servicebuch für Fahrzeuge und Geräte (SERVICEBUCH_ENTWURF.md 3, API.md 11) inkl. Schäden mit Fotos',
    sql: `
CREATE TABLE anlage (
  id INTEGER PRIMARY KEY,
  nummer TEXT UNIQUE,
  bezeichnung TEXT NOT NULL,
  klasse TEXT NOT NULL CHECK (klasse IN ('pkw','bus','lkw','anhaenger','baumaschine','walze','brecher','kleingeraet','sonstiges')),
  fahrzeugklasse TEXT,
  hersteller TEXT, typ TEXT,
  kennzeichen TEXT, fin TEXT,
  baujahr INTEGER, erstzulassung TEXT,
  hzg_kg INTEGER,
  eigentum TEXT NOT NULL DEFAULT 'eigen' CHECK (eigentum IN ('eigen','leasing','miete')),
  vertragsende TEXT,
  versicherung TEXT,
  geraet_id INTEGER REFERENCES geraet(id),
  verantwortlich_id INTEGER REFERENCES benutzer(id),
  standort_baustelle_id INTEGER REFERENCES baustelle(id),
  standort_text TEXT,
  standort_datum TEXT,
  gesperrt INTEGER NOT NULL DEFAULT 0,
  sperr_grund TEXT, sperr_typ TEXT, gesperrt_seit TEXT, gesperrt_von INTEGER REFERENCES benutzer(id),
  ausgeschieden TEXT,
  notiz TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  erstellt TEXT NOT NULL
);
CREATE INDEX anlage_geraet ON anlage(geraet_id);

CREATE TABLE zaehler (
  id INTEGER PRIMARY KEY,
  anlage_id INTEGER NOT NULL REFERENCES anlage(id),
  art TEXT NOT NULL CHECK (art IN ('km','bh','brecher','kran','hub')),
  startstand REAL NOT NULL DEFAULT 0,
  startdatum TEXT NOT NULL,
  versatz REAL NOT NULL DEFAULT 0,
  aus_bericht INTEGER NOT NULL DEFAULT 0,
  aktiv INTEGER NOT NULL DEFAULT 1,
  UNIQUE (anlage_id, art)
);

CREATE TABLE plan_vorlage (
  id INTEGER PRIMARY KEY,
  schluessel TEXT NOT NULL UNIQUE,
  titel TEXT NOT NULL,
  art TEXT NOT NULL CHECK (art IN ('gesetzlich','hersteller','intern','vertrag')),
  klassen TEXT NOT NULL,
  regel TEXT NOT NULL,
  rechtsgrundlage TEXT, quelle_url TEXT,
  pruefen INTEGER NOT NULL DEFAULT 1,
  gueltig_ab TEXT, aktiv INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE servicebuch_eintrag (
  id INTEGER PRIMARY KEY,
  anlage_id INTEGER NOT NULL REFERENCES anlage(id),
  art TEXT NOT NULL CHECK (art IN ('service','reparatur','pruefung','reifen','sonstiges')),
  datum TEXT NOT NULL,
  werkstatt TEXT NOT NULL,
  titel TEXT NOT NULL,
  arbeiten TEXT, teile TEXT,
  arbeitsstunden_intern REAL,
  kosten REAL,
  rechnung_nr TEXT,
  pruef_ergebnis TEXT CHECK (pruef_ergebnis IN ('ohne_maengel','leichte_maengel','schwere_maengel')),
  pruefer TEXT,
  storniert TEXT, storno_grund TEXT, storno_von INTEGER REFERENCES benutzer(id),
  erfasst TEXT NOT NULL, erfasst_von INTEGER REFERENCES benutzer(id),
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX servicebuch_eintrag_anlage ON servicebuch_eintrag(anlage_id, datum);

CREATE TABLE zaehlerstand (
  id INTEGER PRIMARY KEY,
  zaehler_id INTEGER NOT NULL REFERENCES zaehler(id),
  datum TEXT NOT NULL,
  anzeige REAL NOT NULL,
  wert REAL NOT NULL,
  quelle TEXT NOT NULL CHECK (quelle IN ('manuell','eintrag','korrektur','tausch_alt','tausch_neu','start')),
  status TEXT NOT NULL DEFAULT 'gueltig' CHECK (status IN ('gueltig','unplausibel','ungueltig')),
  hinweis TEXT,
  notiz TEXT,
  eintrag_id INTEGER REFERENCES servicebuch_eintrag(id),
  erfasst TEXT NOT NULL, erfasst_von INTEGER REFERENCES benutzer(id),
  grund TEXT
);
CREATE INDEX zaehlerstand_z ON zaehlerstand(zaehler_id, datum);

CREATE TABLE planposition (
  id INTEGER PRIMARY KEY,
  anlage_id INTEGER NOT NULL REFERENCES anlage(id),
  vorlage_id INTEGER REFERENCES plan_vorlage(id),
  titel TEXT NOT NULL,
  art TEXT NOT NULL CHECK (art IN ('gesetzlich','hersteller','intern','vertrag')),
  regel TEXT NOT NULL,
  letzte_datum TEXT,
  letzte_zaehler TEXT,
  letzte_eintrag_id INTEGER REFERENCES servicebuch_eintrag(id),
  start_datum TEXT,
  start_zaehler TEXT,
  aktiv INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX planposition_anlage ON planposition(anlage_id);

CREATE TABLE eintrag_planposition (
  eintrag_id INTEGER NOT NULL REFERENCES servicebuch_eintrag(id),
  planposition_id INTEGER NOT NULL REFERENCES planposition(id),
  PRIMARY KEY (eintrag_id, planposition_id)
);

CREATE TABLE mangel (
  id INTEGER PRIMARY KEY,
  typ TEXT NOT NULL DEFAULT 'mangel' CHECK (typ IN ('mangel','schaden')),
  anlage_id INTEGER REFERENCES anlage(id),
  fremd_geraet TEXT,
  text TEXT NOT NULL,
  dringlichkeit TEXT NOT NULL CHECK (dringlichkeit IN ('hinweis','bald','sofort')),
  status TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','in_arbeit','behoben','verworfen')),
  baustelle_id INTEGER REFERENCES baustelle(id),
  gemeldet TEXT NOT NULL, gemeldet_von INTEGER NOT NULL REFERENCES benutzer(id),
  bearbeitet TEXT, bearbeitet_von INTEGER REFERENCES benutzer(id), notiz TEXT,
  eintrag_id INTEGER REFERENCES servicebuch_eintrag(id),
  schaden_art TEXT CHECK (schaden_art IS NULL OR schaden_art IN ('defekt','verschleiss','unfall','beschaedigung_dritte','sonstiges')),
  beschreibung TEXT,
  einsatzfaehig TEXT CHECK (einsatzfaehig IS NULL OR einsatzfaehig IN ('ja','eingeschraenkt','nein')),
  zeitpunkt TEXT,
  client_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  CHECK (anlage_id IS NOT NULL OR (typ = 'schaden' AND fremd_geraet IS NOT NULL))
);
CREATE INDEX mangel_anlage ON mangel(anlage_id, status);
CREATE UNIQUE INDEX mangel_client ON mangel(gemeldet_von, client_id) WHERE client_id IS NOT NULL;

CREATE TABLE schaden_foto (
  id INTEGER PRIMARY KEY,
  mangel_id INTEGER NOT NULL REFERENCES mangel(id),
  datei TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp')),
  groesse INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  dateiname TEXT,
  erstellt TEXT NOT NULL,
  erstellt_von INTEGER REFERENCES benutzer(id),
  UNIQUE (mangel_id, sha256)
);

CREATE TABLE fuhrpark_erinnerung (
  planposition_id INTEGER NOT NULL REFERENCES planposition(id),
  zyklus TEXT NOT NULL,
  stufe TEXT NOT NULL CHECK (stufe IN ('bald','faellig','ueberfaellig')),
  zeit TEXT NOT NULL,
  PRIMARY KEY (planposition_id, zyklus, stufe)
);

ALTER TABLE bericht_geraet ADD COLUMN anlage_id INTEGER REFERENCES anlage(id);

ALTER TABLE benachrichtigung RENAME TO benachrichtigung_alt;
CREATE TABLE benachrichtigung (
  id INTEGER PRIMARY KEY,
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  typ TEXT NOT NULL CHECK (typ IN ('budget','azg','bericht','abwesenheit','sicherheit','fuhrpark')),
  titel TEXT NOT NULL,
  text TEXT NOT NULL,
  zeit TEXT NOT NULL,
  gelesen INTEGER NOT NULL DEFAULT 0,
  baustelle_id INTEGER REFERENCES baustelle(id),
  schluessel TEXT,
  anlage_id INTEGER,
  UNIQUE (benutzer_id, schluessel)
);
INSERT INTO benachrichtigung (id, benutzer_id, typ, titel, text, zeit, gelesen, baustelle_id, schluessel)
  SELECT id, benutzer_id, typ, titel, text, zeit, gelesen, baustelle_id, schluessel FROM benachrichtigung_alt;
DROP TABLE benachrichtigung_alt;
DROP INDEX IF EXISTS benachrichtigung_benutzer;
CREATE INDEX benachrichtigung_benutzer ON benachrichtigung(benutzer_id, zeit);

-- Recht fuhrpark: Büro und GF (nur wenn die Matrix schon existiert; sonst schreibt der Start die Standard-Matrix)
INSERT OR IGNORE INTO rolle_recht (rolle, recht, wert) SELECT 'buero', 'fuhrpark', 1 WHERE EXISTS (SELECT 1 FROM rolle_recht);
INSERT OR IGNORE INTO rolle_recht (rolle, recht, wert) SELECT 'gf', 'fuhrpark', 1 WHERE EXISTS (SELECT 1 FROM rolle_recht);
`
  },
  {
    version: 10,
    name: 'Prüfbericht 5 Servicebuch: fester Bezugspunkt je Planposition (F-02), mehrere Anlagen je Gerät im Bericht (F-11)',
    sql: `
ALTER TABLE planposition ADD COLUMN bezug_datum TEXT;
-- Bestand: EZ-basierte Regeln (folgeMonate) ab Erstzulassung, sonst ab Anlage der Anlage
UPDATE planposition SET bezug_datum = (SELECT a.erstzulassung FROM anlage a WHERE a.id = planposition.anlage_id)
  WHERE regel LIKE '%"folgeMonate"%';
UPDATE planposition SET bezug_datum = (SELECT substr(a.erstellt, 1, 10) FROM anlage a WHERE a.id = planposition.anlage_id)
  WHERE bezug_datum IS NULL;

ALTER TABLE bericht_geraet RENAME TO bericht_geraet_alt;
CREATE TABLE bericht_geraet (
  bericht_id INTEGER NOT NULL REFERENCES bericht(id) ON DELETE CASCADE,
  geraet_id INTEGER NOT NULL REFERENCES geraet(id),
  stunden REAL NOT NULL,
  anlage_id INTEGER REFERENCES anlage(id)
);
INSERT INTO bericht_geraet (bericht_id, geraet_id, stunden, anlage_id) SELECT bericht_id, geraet_id, stunden, anlage_id FROM bericht_geraet_alt;
DROP TABLE bericht_geraet_alt;
CREATE UNIQUE INDEX bericht_geraet_eindeutig ON bericht_geraet(bericht_id, geraet_id, IFNULL(anlage_id, 0));
CREATE INDEX bericht_geraet_geraet ON bericht_geraet(geraet_id);
`
  },
  {
    version: 11,
    name: 'Ausbaustufe 2: Preise mit „gültig ab“ (API.md 12.2)',
    sql: `
-- Ohne Stand gilt der Wert der Stammtabelle seit 2000-01-01; der erste Änderungs-Stand legt diesen Basisstand an.
CREATE TABLE preis_stand (
  id INTEGER PRIMARY KEY,
  art TEXT NOT NULL CHECK (art IN ('lohngruppen','geraete','materialien','leistungen','katalog','projektposition')),
  ref TEXT NOT NULL,
  feld TEXT NOT NULL,
  wert REAL NOT NULL CHECK (wert >= 0),
  gueltig_ab TEXT NOT NULL,
  erstellt TEXT NOT NULL,
  erstellt_von INTEGER REFERENCES benutzer(id),
  UNIQUE (art, ref, feld, gueltig_ab)
);
CREATE INDEX preis_stand_ref ON preis_stand(art, ref, feld, gueltig_ab);
`
  },
  {
    version: 12,
    name: 'Ausbaustufe 2: Bauvorhaben-Lebenslauf/Archiv (12.15), Koordinaten und AG-E-Mail (12.4/12.5)',
    sql: `
ALTER TABLE baustelle ADD COLUMN phase TEXT NOT NULL DEFAULT 'in_arbeit' CHECK (phase IN ('angebot','geplant','in_arbeit','pausiert','fertiggestellt','abgenommen','schlussrechnung','bezahlt','archiviert','storniert'));
ALTER TABLE baustelle ADD COLUMN phase_seit TEXT;
ALTER TABLE baustelle ADD COLUMN phase_vor_archiv TEXT;
ALTER TABLE baustelle ADD COLUMN archiviert_am TEXT;
ALTER TABLE baustelle ADD COLUMN abnahme_datum TEXT;
ALTER TABLE baustelle ADD COLUMN gewaehrleistung_bis TEXT;
ALTER TABLE baustelle ADD COLUMN haftruecklass TEXT;
ALTER TABLE baustelle ADD COLUMN schlussrechnung TEXT;
ALTER TABLE baustelle ADD COLUMN fertigmeldung TEXT;
ALTER TABLE baustelle ADD COLUMN lat REAL;
ALTER TABLE baustelle ADD COLUMN lng REAL;
ALTER TABLE baustelle ADD COLUMN ag_email TEXT;
ALTER TABLE baustelle ADD COLUMN bericht_mail INTEGER NOT NULL DEFAULT 1;
UPDATE baustelle SET phase = CASE status WHEN 'geplant' THEN 'geplant' WHEN 'abgeschlossen' THEN 'fertiggestellt' ELSE 'in_arbeit' END,
  phase_seit = substr(erstellt, 1, 10);
CREATE TABLE baustelle_phase (
  id INTEGER PRIMARY KEY,
  baustelle_id INTEGER NOT NULL REFERENCES baustelle(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  datum TEXT NOT NULL,
  zeit TEXT NOT NULL,
  von INTEGER REFERENCES benutzer(id),
  notiz TEXT
);
CREATE INDEX baustelle_phase_bs ON baustelle_phase(baustelle_id, zeit);

-- Benachrichtigungstypen werden ab jetzt im Programm geprüft (neue Typen: baustelle, plan, rechnung, email, urlaub)
ALTER TABLE benachrichtigung RENAME TO benachrichtigung_alt;
CREATE TABLE benachrichtigung (
  id INTEGER PRIMARY KEY,
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  typ TEXT NOT NULL,
  titel TEXT NOT NULL,
  text TEXT NOT NULL,
  zeit TEXT NOT NULL,
  gelesen INTEGER NOT NULL DEFAULT 0,
  baustelle_id INTEGER REFERENCES baustelle(id),
  schluessel TEXT,
  anlage_id INTEGER,
  push TEXT,
  UNIQUE (benutzer_id, schluessel)
);
INSERT INTO benachrichtigung (id, benutzer_id, typ, titel, text, zeit, gelesen, baustelle_id, schluessel, anlage_id, push)
  SELECT id, benutzer_id, typ, titel, text, zeit, gelesen, baustelle_id, schluessel, anlage_id, 'alt' FROM benachrichtigung_alt;
DROP TABLE benachrichtigung_alt;
DROP INDEX IF EXISTS benachrichtigung_benutzer;
CREATE INDEX benachrichtigung_benutzer ON benachrichtigung(benutzer_id, zeit);
CREATE INDEX benachrichtigung_push ON benachrichtigung(push) WHERE push IS NULL;
`
  },
  {
    version: 13,
    name: 'Ausbaustufe 2: Push-Abos, Wetter-Zwischenspeicher, E-Mail-Ausgang (12.3–12.5)',
    sql: `
CREATE TABLE push_abo (
  id INTEGER PRIMARY KEY,
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  geraet TEXT,
  erstellt TEXT NOT NULL,
  zuletzt TEXT,
  fehler TEXT
);
CREATE INDEX push_abo_benutzer ON push_abo(benutzer_id);
CREATE TABLE push_einstellung (
  benutzer_id INTEGER PRIMARY KEY REFERENCES benutzer(id) ON DELETE CASCADE,
  typen TEXT NOT NULL
);
CREATE TABLE wetter_cache (
  baustelle_id INTEGER NOT NULL REFERENCES baustelle(id) ON DELETE CASCADE,
  datum TEXT NOT NULL,
  abgerufen TEXT NOT NULL,
  lat REAL, lng REAL,
  daten TEXT,
  fehler TEXT,
  PRIMARY KEY (baustelle_id, datum)
);
CREATE TABLE mail_ausgang (
  id INTEGER PRIMARY KEY,
  art TEXT NOT NULL,
  bezug TEXT,
  an TEXT NOT NULL,
  betreff TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('wartet','gesendet','fehler')),
  fehler TEXT,
  versuche INTEGER NOT NULL DEFAULT 0,
  erstellt TEXT NOT NULL,
  erstellt_von INTEGER REFERENCES benutzer(id),
  gesendet TEXT
);
CREATE INDEX mail_ausgang_bezug ON mail_ausgang(bezug);
`
  },
  {
    version: 14,
    name: 'Ausbaustufe 2: Fotos im Bautagesbericht, Lieferschein, Papierbericht (12.6, 12.11, 12.12)',
    sql: `
CREATE TABLE bericht_foto (
  id INTEGER PRIMARY KEY,
  bericht_id INTEGER NOT NULL REFERENCES bericht(id) ON DELETE CASCADE,
  art TEXT NOT NULL DEFAULT 'foto' CHECK (art IN ('foto','lieferschein','papier')),
  datei TEXT NOT NULL,
  mime TEXT NOT NULL,
  groesse INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  dateiname TEXT,
  beschreibung TEXT,
  ocr_text TEXT,
  erstellt TEXT NOT NULL,
  erstellt_von INTEGER REFERENCES benutzer(id)
);
CREATE INDEX bericht_foto_bericht ON bericht_foto(bericht_id);
`
  },
  {
    version: 15,
    name: 'Ausbaustufe 2: Zwei-Faktor-Anmeldung (TOTP, 12.7)',
    sql: `
CREATE TABLE benutzer_2fa (
  benutzer_id INTEGER PRIMARY KEY REFERENCES benutzer(id) ON DELETE CASCADE,
  geheimnis TEXT NOT NULL,
  aktiv INTEGER NOT NULL DEFAULT 0,
  bestaetigt TEXT,
  letzter_schritt INTEGER,
  codes TEXT NOT NULL DEFAULT '[]',
  salz TEXT NOT NULL,
  erstellt TEXT NOT NULL
);
CREATE TABLE login_2fa (
  token_hash TEXT PRIMARY KEY,
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  erstellt TEXT NOT NULL,
  versuche INTEGER NOT NULL DEFAULT 0,
  ip TEXT
);
`
  },
  {
    version: 16,
    name: 'Ausbaustufe 2: Baustellenplaner, Fuhraufträge, Projektzeitplan (12.8–12.8c)',
    sql: `
CREATE TABLE plan_einsatz (
  id INTEGER PRIMARY KEY,
  datum TEXT NOT NULL,
  baustelle_id INTEGER NOT NULL REFERENCES baustelle(id),
  beginn TEXT, treffpunkt TEXT,
  fahrzeug_anlage_id INTEGER REFERENCES anlage(id), fahrzeug_text TEXT,
  arbeit TEXT, notiz TEXT, benoetigt TEXT,
  uebernommen INTEGER NOT NULL DEFAULT 0,
  geloescht INTEGER NOT NULL DEFAULT 0,
  veroeffentlicht_stand TEXT, veroeffentlicht_hash TEXT, veroeffentlicht_zeit TEXT,
  erstellt TEXT NOT NULL, erstellt_von INTEGER REFERENCES benutzer(id), geaendert TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX plan_einsatz_zelle ON plan_einsatz(datum, baustelle_id) WHERE geloescht = 0;
CREATE INDEX plan_einsatz_datum ON plan_einsatz(datum);
CREATE TABLE plan_person (
  einsatz_id INTEGER NOT NULL REFERENCES plan_einsatz(id) ON DELETE CASCADE,
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id),
  kolonne_polier_id INTEGER REFERENCES benutzer(id),
  notiz TEXT,
  PRIMARY KEY (einsatz_id, benutzer_id)
);
CREATE TABLE plan_anlage (
  einsatz_id INTEGER NOT NULL REFERENCES plan_einsatz(id) ON DELETE CASCADE,
  anlage_id INTEGER NOT NULL REFERENCES anlage(id),
  notiz TEXT,
  fahrer_id INTEGER REFERENCES benutzer(id),
  PRIMARY KEY (einsatz_id, anlage_id)
);
-- je Person und Tag: zuletzt veröffentlichter Inhalt (Mein Einsatz), Lesebestätigung
CREATE TABLE plan_mitteilung (
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  datum TEXT NOT NULL,
  inhalt TEXT,
  hash TEXT,
  zeit TEXT NOT NULL,
  gelesen TEXT,
  bestaetigt TEXT,
  PRIMARY KEY (benutzer_id, datum)
);
CREATE TABLE plan_anfrage (
  id INTEGER PRIMARY KEY,
  datum TEXT NOT NULL,
  einsatz_id INTEGER REFERENCES plan_einsatz(id) ON DELETE SET NULL,
  baustelle_id INTEGER REFERENCES baustelle(id),
  text TEXT NOT NULL,
  von INTEGER NOT NULL REFERENCES benutzer(id),
  zeit TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','erledigt')),
  antwort TEXT, erledigt_von INTEGER REFERENCES benutzer(id), erledigt_zeit TEXT
);
CREATE TABLE plan_abschnitt (
  id INTEGER PRIMARY KEY,
  baustelle_id INTEGER NOT NULL REFERENCES baustelle(id) ON DELETE CASCADE,
  art TEXT NOT NULL CHECK (art IN ('erdbau','kanal','unterbau','pflaster','asphalt','eigen')),
  name TEXT NOT NULL,
  von TEXT NOT NULL, bis TEXT NOT NULL,
  sortierung INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE plan_fuhre (
  id INTEGER PRIMARY KEY,
  datum TEXT NOT NULL,
  anlage_id INTEGER NOT NULL REFERENCES anlage(id),
  fahrer_id INTEGER REFERENCES benutzer(id),
  reihenfolge INTEGER NOT NULL DEFAULT 10,
  beginn TEXT,
  material_id INTEGER REFERENCES material(id), material_text TEXT,
  menge REAL NOT NULL, einheit TEXT NOT NULL CHECK (einheit IN ('t','m3','fuhren')),
  anzahl_fuhren INTEGER,
  von TEXT NOT NULL, nach TEXT NOT NULL,
  notiz TEXT,
  status TEXT NOT NULL DEFAULT 'geplant' CHECK (status IN ('geplant','unterwegs','erledigt','storniert')),
  erledigt TEXT,
  bericht_status TEXT, bericht_id INTEGER REFERENCES bericht(id), bericht_hinweis TEXT, bericht_menge REAL,
  veroeffentlicht_stand TEXT, veroeffentlicht_hash TEXT, veroeffentlicht_zeit TEXT,
  erstellt TEXT NOT NULL, erstellt_von INTEGER REFERENCES benutzer(id), geaendert TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX plan_fuhre_datum ON plan_fuhre(datum, anlage_id);
CREATE TABLE plan_fuhre_foto (
  id INTEGER PRIMARY KEY,
  fuhre_id INTEGER NOT NULL REFERENCES plan_fuhre(id) ON DELETE CASCADE,
  datei TEXT NOT NULL, mime TEXT NOT NULL, groesse INTEGER NOT NULL, sha256 TEXT NOT NULL, dateiname TEXT,
  erstellt TEXT NOT NULL, erstellt_von INTEGER REFERENCES benutzer(id)
);
ALTER TABLE material ADD COLUMN dichte REAL;
`
  },
  {
    version: 17,
    name: 'Ausbaustufe 2: Stammdaten verwalten (12.21)',
    sql: `
ALTER TABLE geraet ADD COLUMN aktiv INTEGER NOT NULL DEFAULT 1;
ALTER TABLE geraet ADD COLUMN einheit TEXT NOT NULL DEFAULT 'Std.';
ALTER TABLE geraet ADD COLUMN anlage_id INTEGER REFERENCES anlage(id);
ALTER TABLE geraet ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE material ADD COLUMN aktiv INTEGER NOT NULL DEFAULT 1;
ALTER TABLE material ADD COLUMN naturmaterial INTEGER NOT NULL DEFAULT 0;
ALTER TABLE material ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE lohngruppe ADD COLUMN aktiv INTEGER NOT NULL DEFAULT 1;
ALTER TABLE lohngruppe ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE leistung ADD COLUMN aktiv INTEGER NOT NULL DEFAULT 1;
ALTER TABLE leistung ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE benutzer ADD COLUMN telefon TEXT;
`
  },
  {
    version: 18,
    name: 'Ausbaustufe 2: Projektdokumente (12.16)',
    sql: `
CREATE TABLE dokument_kategorie (
  schluessel TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  finanziell INTEGER NOT NULL DEFAULT 0,
  polier INTEGER NOT NULL DEFAULT 0,
  eigen INTEGER NOT NULL DEFAULT 0,
  sortierung INTEGER NOT NULL DEFAULT 0
);
INSERT INTO dokument_kategorie (schluessel, name, finanziell, polier, sortierung) VALUES
  ('angebot','Angebot',1,0,10), ('auftrag','Auftrag/Schlussbrief',1,0,20), ('lv','Leistungsverzeichnis',1,0,30), ('plaene','Pläne',0,1,40),
  ('bodengutachten','Bodengutachten',0,1,50), ('bescheide','Bescheide/Bewilligungen',0,1,60), ('leitungsauskuenfte','Leitungsauskünfte',0,1,70),
  ('abnahmeprotokoll','Abnahmeprotokoll',0,0,80), ('ausgangsrechnungen','Ausgangsrechnungen',1,0,90), ('eingangsrechnungen','Eingangsrechnungen',1,0,100),
  ('lieferscheine','Lieferscheine',0,1,110), ('schriftverkehr','Schriftverkehr',0,0,120), ('fotos','Fotos',0,1,130), ('sonstiges','Sonstiges',0,0,140);
CREATE TABLE dokument (
  id INTEGER PRIMARY KEY,
  baustelle_id INTEGER NOT NULL REFERENCES baustelle(id) ON DELETE CASCADE,
  kategorie TEXT NOT NULL REFERENCES dokument_kategorie(schluessel),
  titel TEXT NOT NULL,
  datum TEXT,
  notiz TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  geloescht_zeit TEXT, geloescht_von INTEGER REFERENCES benutzer(id), geloescht_grund TEXT,
  erstellt TEXT NOT NULL, erstellt_von INTEGER REFERENCES benutzer(id), geaendert TEXT
);
CREATE INDEX dokument_bs ON dokument(baustelle_id, kategorie);
CREATE TABLE dokument_datei (
  id INTEGER PRIMARY KEY,
  dokument_id INTEGER NOT NULL REFERENCES dokument(id) ON DELETE CASCADE,
  nr INTEGER NOT NULL,
  datei TEXT NOT NULL, mime TEXT NOT NULL, groesse INTEGER NOT NULL, sha256 TEXT NOT NULL, dateiname TEXT,
  notiz TEXT, erstellt TEXT NOT NULL, erstellt_von INTEGER REFERENCES benutzer(id),
  UNIQUE (dokument_id, nr)
);
`
  },
  {
    version: 19,
    name: 'Ausbaustufe 2: Ausgangsrechnungen und Zahlungen (12.17)',
    sql: `
CREATE TABLE rechnung (
  id INTEGER PRIMARY KEY,
  baustelle_id INTEGER NOT NULL REFERENCES baustelle(id),
  nr TEXT NOT NULL UNIQUE,
  nr_norm TEXT NOT NULL,
  typ TEXT NOT NULL CHECK (typ IN ('abschlag','teil','schluss','regie','gutschrift')),
  datum TEXT NOT NULL,
  leistung_von TEXT, leistung_bis TEXT,
  netto REAL NOT NULL,
  ust_modus TEXT NOT NULL DEFAULT 'normal' CHECK (ust_modus IN ('normal','reverse_charge')),
  ust_satz REAL NOT NULL DEFAULT 20,
  zahlungsziel_tage INTEGER NOT NULL DEFAULT 30,
  skonto_prozent REAL, skonto_tage INTEGER,
  ruecklass_art TEXT CHECK (ruecklass_art IN ('haft','deckung')), ruecklass_prozent REAL, ruecklass_betrag REAL,
  dokument_id INTEGER REFERENCES dokument(id),
  notiz TEXT,
  storniert TEXT, storniert_grund TEXT, storniert_von INTEGER REFERENCES benutzer(id),
  erstellt TEXT NOT NULL, erstellt_von INTEGER REFERENCES benutzer(id),
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX rechnung_bs ON rechnung(baustelle_id);
CREATE UNIQUE INDEX rechnung_nr_norm ON rechnung(nr_norm);
CREATE TABLE rechnung_zahlung (
  id INTEGER PRIMARY KEY,
  rechnung_id INTEGER NOT NULL REFERENCES rechnung(id) ON DELETE CASCADE,
  datum TEXT NOT NULL,
  betrag REAL NOT NULL,
  skonto REAL NOT NULL DEFAULT 0,
  ruecklass INTEGER NOT NULL DEFAULT 0,
  notiz TEXT,
  quelle TEXT NOT NULL DEFAULT 'manuell',
  import_schluessel TEXT,
  erfasst TEXT NOT NULL, erfasst_von INTEGER REFERENCES benutzer(id)
);
CREATE INDEX rechnung_zahlung_r ON rechnung_zahlung(rechnung_id);
CREATE TABLE rechnung_mahnung (
  id INTEGER PRIMARY KEY,
  rechnung_id INTEGER NOT NULL REFERENCES rechnung(id) ON DELETE CASCADE,
  stufe INTEGER NOT NULL CHECK (stufe IN (1,2,3)),
  datum TEXT NOT NULL,
  erfasst TEXT NOT NULL, erfasst_von INTEGER REFERENCES benutzer(id),
  UNIQUE (rechnung_id, stufe)
);
`
  },
  {
    version: 20,
    name: 'Ausbaustufe 2: Urlaubskonto, Betriebsurlaub (12.19)',
    sql: `
ALTER TABLE abwesenheit ADD COLUMN betriebsurlaub INTEGER NOT NULL DEFAULT 0;
ALTER TABLE abwesenheit ADD COLUMN notiz TEXT;
CREATE TABLE urlaub_konto (
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  jahr INTEGER NOT NULL,
  art TEXT NOT NULL DEFAULT 'buak' CHECK (art IN ('buak','urlg')),
  anspruch REAL,
  einheit TEXT NOT NULL DEFAULT 'Arbeitstage' CHECK (einheit IN ('Arbeitstage','Werktage')),
  uebertrag REAL NOT NULL DEFAULT 0,
  buak_stand REAL, buak_datum TEXT,
  notiz TEXT,
  geaendert TEXT, geaendert_von INTEGER REFERENCES benutzer(id),
  PRIMARY KEY (benutzer_id, jahr)
);
`
  },
  {
    version: 21,
    name: 'Ausbaustufe 2: Leistungsverzeichnis (ÖNORM A 2063), Lohn-Vorlagen (12.20)',
    sql: `
CREATE TABLE lv_position (
  id INTEGER PRIMARY KEY,
  baustelle_id INTEGER NOT NULL REFERENCES baustelle(id) ON DELETE CASCADE,
  oz TEXT NOT NULL, kurztext TEXT NOT NULL, einheit TEXT,
  menge REAL, ep REAL, gp REAL,
  projektposition_id INTEGER REFERENCES projektposition(id) ON DELETE SET NULL,
  sortierung INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX lv_position_bs ON lv_position(baustelle_id);
CREATE TABLE lv_import (
  baustelle_id INTEGER PRIMARY KEY REFERENCES baustelle(id) ON DELETE CASCADE,
  datei TEXT, importiert TEXT NOT NULL, von INTEGER REFERENCES benutzer(id), summe REAL, format TEXT
);
CREATE TABLE lohn_vorlage (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  daten TEXT NOT NULL,
  eingebaut INTEGER NOT NULL DEFAULT 0,
  geaendert TEXT
);
`
  },
  {
    version: 22,
    name: 'Ausbaustufe 2: Fernunterschrift per Link, KI-Nutzung (12.9, 12.13)',
    sql: `
CREATE TABLE unterschrift_link (
  id INTEGER PRIMARY KEY,
  bericht_id INTEGER NOT NULL REFERENCES bericht(id) ON DELETE CASCADE,
  rolle TEXT NOT NULL CHECK (rolle IN ('an','bh')),
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT, email TEXT,
  erstellt TEXT NOT NULL, erstellt_von INTEGER NOT NULL REFERENCES benutzer(id),
  ablauf TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','verwendet','ungueltig','widerrufen')),
  verwendet TEXT, verwendet_ip TEXT, abrufe INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX unterschrift_link_b ON unterschrift_link(bericht_id);
CREATE TABLE ki_nutzung (
  id INTEGER PRIMARY KEY,
  zeit TEXT NOT NULL, tag TEXT NOT NULL, zweck TEXT NOT NULL,
  benutzer_id INTEGER REFERENCES benutzer(id),
  eingabe_tokens INTEGER, ausgabe_tokens INTEGER, ok INTEGER NOT NULL, fehler TEXT
);
CREATE INDEX ki_nutzung_tag ON ki_nutzung(tag);
`
  },
  {
    version: 23,
    name: 'Ausbaustufe 2: Lohngruppe stichtaggenau (12.22)',
    sql: `
CREATE TABLE benutzer_lohngruppe (
  id INTEGER PRIMARY KEY,
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  lohngruppe_id TEXT REFERENCES lohngruppe(id),
  gueltig_ab TEXT NOT NULL,
  erstellt TEXT NOT NULL,
  erstellt_von INTEGER REFERENCES benutzer(id)
);
CREATE INDEX benutzer_lohngruppe_b ON benutzer_lohngruppe(benutzer_id, gueltig_ab);
-- Basisstand: die bisherige Zuordnung gilt von Anfang an
INSERT INTO benutzer_lohngruppe (benutzer_id, lohngruppe_id, gueltig_ab, erstellt)
  SELECT id, lohngruppe_id, '2000-01-01', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM benutzer WHERE lohngruppe_id IS NOT NULL;
`
  },
  {
    version: 24,
    name: 'Ausbaustufe 2: Abwesenheit als Zeitraum-Antrag (12.24)',
    sql: `
ALTER TABLE abwesenheit ADD COLUMN antrag_id TEXT;
ALTER TABLE abwesenheit ADD COLUMN antwort TEXT;
CREATE INDEX abwesenheit_antrag ON abwesenheit(antrag_id);
`
  },
  {
    version: 25,
    name: 'Prüfbericht 6: gespeicherte Planer-Tage (G-01)',
    sql: `
-- Ein Tag, für den je ein Einsatz gespeichert wurde, bleibt gespeichert (nie wieder Vorschau) – auch wenn alle Einsätze gelöscht werden
CREATE TABLE plan_tag (
  datum TEXT PRIMARY KEY,
  gespeichert TEXT NOT NULL
);
INSERT OR IGNORE INTO plan_tag (datum, gespeichert) SELECT datum, MIN(erstellt) FROM plan_einsatz GROUP BY datum;
CREATE TRIGGER plan_tag_merken AFTER INSERT ON plan_einsatz BEGIN
  INSERT OR IGNORE INTO plan_tag (datum, gespeichert) VALUES (NEW.datum, NEW.erstellt);
END;
`
  },
  {
    version: 26,
    name: 'Datenschutz: Schlechtwetter-Meldungen des Poliers ohne Auskunft über Abwesenheiten (13.11.2026)',
    sql: `
CREATE TABLE sw_meldung (
  id INTEGER PRIMARY KEY,
  polier_id INTEGER NOT NULL REFERENCES benutzer(id),
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id),
  von TEXT NOT NULL, bis TEXT NOT NULL,
  antrag_id TEXT NOT NULL,
  notiz TEXT,
  status TEXT NOT NULL DEFAULT 'gemeldet' CHECK (status IN ('gemeldet','bestaetigt')),
  erstellt TEXT NOT NULL,
  bestaetigt TEXT, bestaetigt_von INTEGER REFERENCES benutzer(id)
);
CREATE INDEX sw_meldung_polier ON sw_meldung(polier_id);
CREATE INDEX sw_meldung_antrag ON sw_meldung(antrag_id);
`
  },
  {
    version: 27,
    name: 'Inhaber 13.11.2026: Bauleiter in allem wie Büro (Rechte-Matrix)',
    sql: `
-- Bestehende Datenbanken: Matrix der Rolle bauleiter = Matrix der Rolle buero (Ausnahmen je Person bleiben)
DELETE FROM rolle_recht WHERE rolle = 'bauleiter' AND EXISTS (SELECT 1 FROM rolle_recht WHERE rolle = 'buero');
INSERT INTO rolle_recht (rolle, recht, wert) SELECT 'bauleiter', recht, wert FROM rolle_recht WHERE rolle = 'buero';
INSERT INTO protokoll (zeit, benutzer_id, art, objekt, alt, neu, text)
  SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, 'recht', 'rolle:bauleiter', NULL, '{"wieRolle":"buero"}',
    'Rechte-Matrix: Rolle Bauleiter erhält die Rechte der Rolle Büro (Entscheidung des Inhabers 13.11.2026)'
  WHERE EXISTS (SELECT 1 FROM rolle_recht WHERE rolle = 'bauleiter');
`
  },
  {
    version: 28,
    name: '12.25: interne Kostenstellen, Standard-Kostenstelle je Person',
    sql: `
-- Die Kostenstellen-Art ist das bestehende Kennzeichen baustelle.intern (0 = Baustelle, 1 = interne Kostenstelle).
ALTER TABLE benutzer ADD COLUMN standard_kostenstelle_id INTEGER REFERENCES baustelle(id);
`
  },
  {
    version: 29,
    name: '12.25: interne Kostenstellen im Format NN-NNN (9000 → 90-000, 9100 → 90-100)',
    sql: `
-- Büro: 9000 → 90-000, nur wenn 90-000 frei ist
INSERT INTO protokoll (zeit, benutzer_id, art, objekt, alt, neu, text)
  SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, 'stammdaten', 'baustelle:' || id, '{"kst":"9000"}', '{"kst":"90-000"}', 'Interne Kostenstelle ' || name || ': KST 9000 → 90-000 (einheitliches Format NN-NNN)'
  FROM baustelle WHERE kst = '9000' AND intern = 1 AND NOT EXISTS (SELECT 1 FROM baustelle WHERE kst = '90-000');
UPDATE baustelle SET kst = '90-000' WHERE kst = '9000' AND intern = 1 AND NOT EXISTS (SELECT 1 FROM baustelle WHERE kst = '90-000');
INSERT INTO protokoll (zeit, benutzer_id, art, objekt, alt, neu, text)
  SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, 'stammdaten', 'baustelle:' || id, '{"kst":"9000"}', NULL, 'Interne Kostenstelle ' || name || ': KST 9000 nicht umbenannt – 90-000 ist schon vergeben'
  FROM baustelle WHERE kst = '9000' AND intern = 1;
-- Werkstatt/Bauhof: 9100 → 90-100, nur wenn 90-100 frei ist
INSERT INTO protokoll (zeit, benutzer_id, art, objekt, alt, neu, text)
  SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, 'stammdaten', 'baustelle:' || id, '{"kst":"9100"}', '{"kst":"90-100"}', 'Interne Kostenstelle ' || name || ': KST 9100 → 90-100 (einheitliches Format NN-NNN)'
  FROM baustelle WHERE kst = '9100' AND intern = 1 AND NOT EXISTS (SELECT 1 FROM baustelle WHERE kst = '90-100');
UPDATE baustelle SET kst = '90-100' WHERE kst = '9100' AND intern = 1 AND NOT EXISTS (SELECT 1 FROM baustelle WHERE kst = '90-100');
INSERT INTO protokoll (zeit, benutzer_id, art, objekt, alt, neu, text)
  SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, 'stammdaten', 'baustelle:' || id, '{"kst":"9100"}', NULL, 'Interne Kostenstelle ' || name || ': KST 9100 nicht umbenannt – 90-100 ist schon vergeben'
  FROM baustelle WHERE kst = '9100' AND intern = 1;
`
  },
  {
    version: 30,
    name: 'Korrektur Nachprüfung Planer: gemerkte Abwesende je gespeichertem Tag, Art der letzten Planmeldung',
    sql: `
-- Beim Übernehmen eines Vorschau-Tags wegen Abwesenheit ausgelassene Personen (JSON), damit die Folgetage sie wieder vorschlagen
ALTER TABLE plan_tag ADD COLUMN uebersprungen TEXT;
-- Art der zuletzt gesendeten Meldung je Person und Tag ('neu' | 'geaendert' | 'entfaellt') für „Mein Einsatz“ (geaendert)
ALTER TABLE plan_mitteilung ADD COLUMN art TEXT;
`
  },
  {
    version: 32,
    name: 'Nachprüfung urlaub (14.3): Beginn des Urlaubsjahres je Konto',
    sql: `
-- Der Beginn des Urlaubsjahres gehört zum Konto (je Person und Jahr); bestehende Konten behalten die bisherige Vorgabe,
-- damit eine spätere Änderung der Vorgabe sie nicht rückwirkend verschiebt.
ALTER TABLE urlaub_konto ADD COLUMN beginn TEXT;
UPDATE urlaub_konto SET beginn = COALESCE((SELECT json_extract(wert, '$.urlaubsjahrBeginn') FROM einstellung WHERE schluessel = 'urlaub'), '01-01');
`
  },
  {
    version: 33,
    name: 'Nachprüfung sicherheit: kontoweiter Zähler falscher Zwei-Faktor-Codes (nicht durch PIN-Anmeldung zurückgesetzt)',
    sql: `
-- N-004/N-027: falsche 2FA-Codes je Konto über alle IPs; nur Ablauf des 24-h-Fensters, Kontosperre oder Entsperren durch Büro/GF setzen ihn zurück
CREATE TABLE login_2fa_fehler (
  benutzer_id INTEGER PRIMARY KEY,
  fehlversuche INTEGER NOT NULL DEFAULT 0,
  erster TEXT,
  letzter TEXT
);
`
  },
  {
    version: 35,
    name: '14.6: Name/Einheit von Material und Gerät je Berichtszeile festhalten (Stand beim Erfassen)',
    sql: `
-- N-009: Berichte zeigen Name/Einheit so, wie sie beim Erfassen der Zeile galten – spätere Stammdaten-Änderungen
-- ändern unterschriebene/freigegebene Berichte, Fern-Links und das AG-PDF nicht mehr rückwirkend.
ALTER TABLE bericht_material ADD COLUMN name TEXT;
ALTER TABLE bericht_material ADD COLUMN einheit TEXT;
ALTER TABLE bericht_geraet ADD COLUMN name TEXT;
UPDATE bericht_material SET name = (SELECT m.name FROM material m WHERE m.id = bericht_material.material_id),
  einheit = (SELECT m.einheit FROM material m WHERE m.id = bericht_material.material_id);
UPDATE bericht_geraet SET name = (SELECT g.name FROM geraet g WHERE g.id = bericht_geraet.geraet_id);
CREATE TRIGGER bericht_material_stand AFTER INSERT ON bericht_material WHEN NEW.name IS NULL BEGIN
  UPDATE bericht_material SET name = (SELECT m.name FROM material m WHERE m.id = NEW.material_id),
    einheit = (SELECT m.einheit FROM material m WHERE m.id = NEW.material_id)
    WHERE rowid = NEW.rowid;
END;
CREATE TRIGGER bericht_geraet_stand AFTER INSERT ON bericht_geraet WHEN NEW.name IS NULL BEGIN
  UPDATE bericht_geraet SET name = (SELECT g.name FROM geraet g WHERE g.id = NEW.geraet_id) WHERE rowid = NEW.rowid;
END;
`
  },
  {
    version: 39,
    name: '15.3: Benachrichtigungen speichern die nötigen Rechte (erfordert) – Rückfüllung des Bestands',
    // Gleiche Regeln wie erfordertFuer() in server/benachrichtigung.js (Paritätstest in tests/api/benachrichtigung-rechte.test.js).
    // Eine erfordert-Liste: jedes Element muss erfüllt sein; "a|b" = eines der Rechte genügt; [] = nur für den Empfänger selbst.
    sql: `
ALTER TABLE benachrichtigung ADD COLUMN erfordert TEXT;
UPDATE benachrichtigung SET erfordert = CASE
  WHEN typ = 'budget' THEN '["kalk_sehen"]'
  WHEN typ = 'rechnung' THEN '["preise_sehen"]'
  WHEN typ = 'email' THEN '["stammdaten"]'
  WHEN typ = 'urlaub' THEN '["lohn|stammdaten"]'
  WHEN typ = 'azg' THEN CASE WHEN substr(COALESCE(schluessel, ''), 1, length('azg:' || benutzer_id || ':')) = 'azg:' || benutzer_id || ':' THEN '[]' ELSE '["lohn"]' END
  WHEN typ = 'abwesenheit' THEN CASE
    WHEN COALESCE(schluessel, '') GLOB 'abw:*:genehmigt:*' OR COALESCE(schluessel, '') GLOB 'abw:*:abgelehnt:*'
      OR COALESCE(schluessel, '') GLOB 'abw:*:ersetzt:*' OR COALESCE(schluessel, '') GLOB 'abw:*:korrektur:*'
      OR COALESCE(schluessel, '') GLOB 'abw:*:weg' OR COALESCE(schluessel, '') GLOB 'abw:*:weg:*'
      OR ((COALESCE(schluessel, '') GLOB 'sw:*:bestaetigt' OR COALESCE(schluessel, '') GLOB 'sw:*:person') AND COALESCE(schluessel, '') NOT GLOB 'sw:*:*:*' AND COALESCE(schluessel, '') NOT GLOB 'sw::*')
    THEN '[]' ELSE '["lohn|stammdaten"]' END
  WHEN typ = 'baustelle' THEN CASE
    WHEN COALESCE(schluessel, '') GLOB 'bv:sr:*' OR COALESCE(schluessel, '') GLOB 'bv:bg:*' OR COALESCE(schluessel, '') GLOB 'bv:hr:*' THEN '["preise_sehen"]'
    ELSE '["stammdaten"]' END
  WHEN typ = 'bericht' THEN '["bericht_freigeben"]'
  WHEN typ = 'plan' THEN CASE
    WHEN COALESCE(schluessel, '') GLOB 'plan:erinnerung:*' OR COALESCE(schluessel, '') GLOB 'plan:anfrage:*' OR COALESCE(schluessel, '') GLOB 'fuhre:pruefen:*' THEN '["stammdaten"]'
    ELSE '[]' END
  WHEN typ = 'sicherheit' THEN CASE
    WHEN COALESCE(schluessel, '') GLOB 'konto:*' OR COALESCE(schluessel, '') GLOB 'konto-2fa:*' THEN '["benutzer|stammdaten"]'
    WHEN COALESCE(schluessel, '') GLOB 'rolle:*' OR COALESCE(schluessel, '') GLOB 'sicherung:*' THEN '["benutzer"]'
    ELSE '[]' END
  WHEN typ = 'fuhrpark' THEN CASE
    WHEN COALESCE(schluessel, '') GLOB 'fp:woche:*' OR COALESCE(schluessel, '') GLOB 'fp:unplausibel:*' OR COALESCE(schluessel, '') GLOB 'fp:gesperrt-genutzt:*' THEN '["fuhrpark"]'
    ELSE '[]' END
  ELSE '["stammdaten"]'
END;
-- Offene Push-Meldungen des Bestands prüft der Versand ohnehin gegen die aktuellen Rechte (15.3).
`
  },
  {
    version: 41,
    name: '15.5: Sitzungsbindung ans Gerät (bt_bindung) und Geräteschlüssel je Benutzer für wartende Einträge',
    // bindung_hash: SHA-256 des Bindungs-Cookies einer App-Sitzung; ohne passendes Cookie gilt die Sitzung nicht (F-029).
    // geraet_schluessel: zufälliger AES-Schlüssel je Benutzer, mit dem die App wartende Einträge beim Abmelden versiegelt (F-046).
    sql: `
ALTER TABLE sitzung ADD COLUMN bindung_hash TEXT;
CREATE TABLE geraet_schluessel (
  benutzer_id INTEGER PRIMARY KEY REFERENCES benutzer(id) ON DELETE CASCADE,
  schluessel TEXT NOT NULL,
  erstellt TEXT NOT NULL
);
`
  },
  {
    version: 43,
    name: '15.12 (G2-019, G2-020): Push-Abo an die Sitzung gebunden; kontoweite Fehlversuche im gleitenden 24-h-Fenster',
    // push_abo.sitzung_hash = token_hash der Sitzung, die das Abo angelegt hat. Endet die Sitzung (Abmelden, Ablauf, Rotation,
    // Bindungsfehler, Deaktivierung, Sperre, PIN-/2FA-Reset …), löscht der Trigger ihre Abos – gleich, welcher Code die Sitzung löscht.
    // Bestehende Abos haben keine Sitzung und werden entfernt; die Geräte schalten Push nach der nächsten Anmeldung neu ein.
    // login_konto_fehler: je Fehlversuch eine Zeile; es zählen die der letzten 24 h. Der Bestand wird mit dem Zeitpunkt
    // des ersten Fehlversuchs übernommen (läuft damit frühestens ab).
    sql: `
ALTER TABLE push_abo ADD COLUMN sitzung_hash TEXT;
CREATE INDEX push_abo_sitzung ON push_abo(sitzung_hash);
DELETE FROM push_abo;
CREATE TRIGGER sitzung_ende_push AFTER DELETE ON sitzung BEGIN
  DELETE FROM push_abo WHERE sitzung_hash = OLD.token_hash;
END;
CREATE TABLE login_konto_fehler (
  id INTEGER PRIMARY KEY,
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  zeit TEXT NOT NULL
);
CREATE INDEX login_konto_fehler_benutzer ON login_konto_fehler(benutzer_id, zeit);
WITH RECURSIVE z(b, e, i, n) AS (
  SELECT benutzer_id, erster, 1, fehlversuche FROM login_konto WHERE gesperrt = 0 AND erster IS NOT NULL AND fehlversuche > 0 AND benutzer_id IN (SELECT id FROM benutzer)
  UNION ALL SELECT b, e, i + 1, n FROM z WHERE i < n AND i < 100
)
INSERT INTO login_konto_fehler (benutzer_id, zeit) SELECT b, e FROM z;
`
  },
  {
    version: 44,
    name: '15.16 (H-S3): Push-Abo eines geteilten Geräts endet mit der Sperre nach Untätigkeit',
    // push_abo.geteilt = 1: das Abo stammt von einem „Geteilten Gerät“ (Wunsch der App, POST /push/abo {geteilt}). Zugestellt wird
    // dann nur, solange die Sitzung des Abos innerhalb von sperreMinuten (Feld 30 min) zuletzt benutzt wurde. Bestand: sicher „geteilt“.
    sql: `
ALTER TABLE push_abo ADD COLUMN geteilt INTEGER NOT NULL DEFAULT 1;
`
  },
  {
    version: 45,
    name: '15.15 (H-G1, H-G4): zufällige öffentliche Kennung je Abwesenheit; Sichtstand des Bautagesberichts',
    // H-G1: SQLite vergibt die rowid einer gelöschten letzten Zeile neu – eine aus der Tabellen-ID abgeleitete Kennung
    // verriete so die Zahl fremder Einträge dazwischen. Jede Zeile bekommt deshalb beim Anlegen (Trigger, gleich welcher
    // Code einfügt) einen zufälligen Wert; die öffentlichen Kennungen (server/oeffentlich.js) leiten sich nur davon ab.
    // H-G4: Sichtstand für Aufrufer ohne Sicht auf fremde Abwesenheiten und fremde Belege (server/berichtsicht.js):
    // sicht_version/sicht_geaendert/sicht_hash = allgemeine eingeschränkte Sicht, sicht_real = zuletzt nachgeführte echte Version,
    // bericht_sicht = eigene Zeilen/Belege je Person (Zusatzzähler).
    // Bestand: Sichtstand = bisherige Version; sicht_hash wird beim ersten Laden gesetzt.
    sql: `
ALTER TABLE abwesenheit ADD COLUMN oeffentlich TEXT;
UPDATE abwesenheit SET oeffentlich = lower(hex(randomblob(10)));
CREATE UNIQUE INDEX abwesenheit_oeffentlich ON abwesenheit(oeffentlich);
CREATE TRIGGER abwesenheit_oeffentlich_neu AFTER INSERT ON abwesenheit FOR EACH ROW WHEN NEW.oeffentlich IS NULL BEGIN
  UPDATE abwesenheit SET oeffentlich = lower(hex(randomblob(10))) WHERE id = NEW.id;
END;
ALTER TABLE bericht ADD COLUMN sicht_version INTEGER;
ALTER TABLE bericht ADD COLUMN sicht_geaendert TEXT;
ALTER TABLE bericht ADD COLUMN sicht_hash TEXT;
ALTER TABLE bericht ADD COLUMN sicht_real INTEGER;
UPDATE bericht SET sicht_version = version, sicht_geaendert = geaendert;
CREATE TABLE bericht_sicht (
  bericht_id INTEGER NOT NULL REFERENCES bericht(id) ON DELETE CASCADE,
  benutzer_id INTEGER NOT NULL,
  extra INTEGER NOT NULL DEFAULT 0,
  hash TEXT NOT NULL,
  geaendert TEXT,
  PRIMARY KEY (bericht_id, benutzer_id)
);
`
  },
  {
    version: 46,
    name: '15.15 (ID-Nachtrag): Sichtversion der Servicebuch-Einträge ohne Kosten/Rechnungs-Nr.',
    // Aufrufer ohne preise_sehen (Polier/Mitarbeiter mit Ausnahme fuhrpark) sehen Kosten und Rechnungs-Nr. nicht – eine
    // Änderung nur daran erhöht deshalb nur version (Büro), nicht sicht_version (ihre Version und Konfliktprüfung)
    sql: `
ALTER TABLE servicebuch_eintrag ADD COLUMN sicht_version INTEGER NOT NULL DEFAULT 1;
UPDATE servicebuch_eintrag SET sicht_version = version;
`
  },
  {
    version: 47,
    name: '15.22: Vordefinierte Pausen – geplante Dauer, automatisches Pausenende',
    // pause_plan_min: geplante Dauer einer „pause_start“-Buchung (NULL = offen). pause_auto_bis: geplantes Ende, solange es
    // noch aussteht (Merker für den Teilindex; wird beim Eintragen des Endes bzw. bei früherem Ende gelöscht).
    // automatisch = 1: „pause_ende“, das der Server zum geplanten Zeitpunkt eingetragen hat (server/pausen.js).
    sql: `
ALTER TABLE buchung ADD COLUMN pause_plan_min INTEGER;
ALTER TABLE buchung ADD COLUMN pause_auto_bis TEXT;
ALTER TABLE buchung ADD COLUMN automatisch INTEGER NOT NULL DEFAULT 0;
CREATE INDEX buchung_pause_auto ON buchung(pause_auto_bis) WHERE pause_auto_bis IS NOT NULL;
`
  },
  {
    version: 48,
    name: '15.23: Arbeitszeitmodelle je Person (stichtaggenau) und BUAK-Pflicht je Person',
    // tag_normal: JSON-Liste [So, Mo, Di, Mi, Do, Fr, Sa] (Index wie datum.wochentag). regel: tag_oder_woche = größere von
    // Tages- und Wochenüberschreitung (bisherige Regel), woche = nur Wochenüberschreitung. vollzeit: nur Teilzeit – Stunden
    // über wochenstunden bis vollzeit sind Mehrstunden. Grundausstattung: 1 = bisherige Regel (aus der Einstellung
    // 'arbeitszeit', falls gesetzt), 2 = Büro/Angestellte (Mo–Do 8,5, Fr 5, Tag oder Woche – Inhaber 17.11.2026), 3 = Teilzeit. Zuordnung: ohne Einträge gilt die Vorgabe nach der Rolle
    // (server/arbeitszeit.js) – bestehende Personen rechnen dadurch unverändert. buak_pflichtig NULL = Vorgabe nach der Rolle.
    sql: `
CREATE TABLE arbeitszeitmodell (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  wochenstunden REAL NOT NULL CHECK (wochenstunden > 0 AND wochenstunden <= 60),
  tag_normal TEXT NOT NULL,
  regel TEXT NOT NULL DEFAULT 'tag_oder_woche' CHECK (regel IN ('tag_oder_woche','woche')),
  vollzeit REAL CHECK (vollzeit IS NULL OR vollzeit > wochenstunden),
  aktiv INTEGER NOT NULL DEFAULT 1,
  sortierung INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  erstellt TEXT NOT NULL,
  geaendert TEXT
);
INSERT INTO arbeitszeitmodell (id, name, wochenstunden, tag_normal, regel, vollzeit, sortierung, erstellt) VALUES
  (1, 'Bau-Arbeiter (KV Bau)',
    COALESCE((SELECT json_extract(wert, '$.wocheNormal') FROM einstellung WHERE schluessel = 'arbeitszeit' AND json_valid(wert) AND json_type(wert, '$.wocheNormal') IN ('integer','real') AND json_extract(wert, '$.wocheNormal') > 0 AND json_extract(wert, '$.wocheNormal') <= 60), 39),
    COALESCE((SELECT json_extract(wert, '$.tagNormal') FROM einstellung WHERE schluessel = 'arbeitszeit' AND json_valid(wert) AND json_type(wert, '$.tagNormal') = 'array' AND json_array_length(wert, '$.tagNormal') = 7), '[0,8,8,8,8,7,0]'),
    'tag_oder_woche', NULL, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (2, 'Büro (Mo–Do 8,5 · Fr 5)', 39, '[0,8.5,8.5,8.5,8.5,5,0]', 'tag_oder_woche', NULL, 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (3, 'Teilzeit 32 Std.', 32, '[0,8,8,8,8,0,0]', 'woche', 39, 3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
CREATE TABLE benutzer_arbeitszeitmodell (
  id INTEGER PRIMARY KEY,
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  modell_id INTEGER NOT NULL REFERENCES arbeitszeitmodell(id),
  gueltig_ab TEXT NOT NULL,
  erstellt TEXT NOT NULL,
  erstellt_von INTEGER REFERENCES benutzer(id)
);
CREATE INDEX benutzer_arbeitszeitmodell_b ON benutzer_arbeitszeitmodell(benutzer_id, gueltig_ab);
ALTER TABLE benutzer ADD COLUMN buak_pflichtig INTEGER CHECK (buak_pflichtig IS NULL OR buak_pflichtig IN (0, 1));
`
  },
  {
    version: 49,
    name: '15.24: Rechnungen wie auf dem Papier – USt/Brutto, Skonto in %/€, Deckungs- und Haftrücklass, Empfänger',
    // ust_betrag/brutto: Beträge laut Rechnung (NULL = aus Netto × Satz gerechnet, wie bisher). skonto_betrag: Skonto in €
    // statt Prozent (gespeichert wird, was eingegeben wurde). Rücklässe getrennt: deckung_*/haft_* (je Prozent ODER Betrag;
    // Betrag geht vor), haft_frei_ab = Freigabe des Haftrücklasses laut Rechnung. Übernahme aus ruecklass_art/_prozent/_betrag,
    // danach werden die alten Spalten entfernt (eine Quelle). Zahlungen mit ruecklass = 1 bekommen die Art ihres Rücklasses.
    sql: `
ALTER TABLE rechnung ADD COLUMN ust_betrag REAL;
ALTER TABLE rechnung ADD COLUMN brutto REAL;
ALTER TABLE rechnung ADD COLUMN skonto_betrag REAL;
ALTER TABLE rechnung ADD COLUMN deckung_prozent REAL;
ALTER TABLE rechnung ADD COLUMN deckung_betrag REAL;
ALTER TABLE rechnung ADD COLUMN haft_prozent REAL;
ALTER TABLE rechnung ADD COLUMN haft_betrag REAL;
ALTER TABLE rechnung ADD COLUMN haft_frei_ab TEXT;
ALTER TABLE rechnung ADD COLUMN empfaenger TEXT;
ALTER TABLE rechnung ADD COLUMN ag_zeichen TEXT;
UPDATE rechnung SET
  deckung_prozent = CASE WHEN ruecklass_art = 'deckung' THEN ruecklass_prozent END,
  deckung_betrag = CASE WHEN ruecklass_art = 'deckung' THEN ruecklass_betrag END,
  haft_prozent = CASE WHEN ruecklass_art = 'haft' THEN ruecklass_prozent END,
  haft_betrag = CASE WHEN ruecklass_art = 'haft' THEN ruecklass_betrag END;
ALTER TABLE rechnung_zahlung ADD COLUMN ruecklass_art TEXT CHECK (ruecklass_art IS NULL OR ruecklass_art IN ('haft','deckung'));
UPDATE rechnung_zahlung SET ruecklass_art = COALESCE((SELECT r.ruecklass_art FROM rechnung r WHERE r.id = rechnung_zahlung.rechnung_id), 'haft') WHERE ruecklass = 1;
ALTER TABLE rechnung DROP COLUMN ruecklass_art;
ALTER TABLE rechnung DROP COLUMN ruecklass_prozent;
ALTER TABLE rechnung DROP COLUMN ruecklass_betrag;
`
  },
  {
    version: 50,
    name: '15.24: Zahlungsabgleich – Differenzen je Zahlung (akzeptiert, strittig, Rücklass einbehalten, Überzahlung)',
    // Eine Zeile je Grund einer Differenz zwischen erwartetem und tatsächlich bezahltem Betrag, verknüpft mit der Zahlung
    // (Rückgängig/Löschen der Zahlung löscht die Zeilen mit). status: akzeptiert (Abzug gilt, schließt den Betrag), strittig
    // (bleibt offen), einbehalten (zusätzlicher Deckungs-/Haftrücklass), offen/erledigt (Überzahlung).
    sql: `
CREATE TABLE rechnung_differenz (
  id INTEGER PRIMARY KEY,
  rechnung_id INTEGER NOT NULL REFERENCES rechnung(id) ON DELETE CASCADE,
  zahlung_id INTEGER REFERENCES rechnung_zahlung(id) ON DELETE CASCADE,
  grund TEXT NOT NULL CHECK (grund IN ('skonto','deckung','haft','umlage','maengel','spesen','sonstiges','ueberzahlung')),
  text TEXT,
  betrag REAL NOT NULL CHECK (betrag > 0),
  status TEXT NOT NULL CHECK (status IN ('akzeptiert','strittig','einbehalten','offen','erledigt')),
  skonto_verspaetet INTEGER NOT NULL DEFAULT 0,
  erfasst TEXT NOT NULL, erfasst_von INTEGER REFERENCES benutzer(id),
  geaendert TEXT, geaendert_von INTEGER REFERENCES benutzer(id)
);
CREATE INDEX rechnung_differenz_r ON rechnung_differenz(rechnung_id);
CREATE INDEX rechnung_differenz_z ON rechnung_differenz(zahlung_id);
`
  },
  {
    version: 51,
    name: '15.26: Zahlbetrag mit Skonto – Betrag nach Skonto wie auf der Rechnung',
    // skonto_zahlbetrag: der eingetragene Betrag „zahlbar … abzgl. Skonto € …“ (NULL = Skonto in % bzw. € oder kein Skonto).
    // Das Skonto in € steht weiter in skonto_betrag (= Zahlbetrag − skonto_zahlbetrag, beim Speichern gerechnet) – Zahlungen,
    // Fälligkeiten und Offene Posten rechnen unverändert damit. Bestehende Rechnungen bleiben unverändert (Spalte leer).
    sql: `
ALTER TABLE rechnung ADD COLUMN skonto_zahlbetrag REAL;
`
  },
  {
    version: 52,
    name: '15.28: PIN nur einmal pro Woche – Lebensdauer der Sitzung je Gerätewahl',
    // art: 'woche' = Anmeldung am „Eigenen Handy“ (gebundene App-Sitzung) – gilt ohne Untätigkeitsgrenze bis `bis`
    // (Montag 00:00 Wiener Zeit nach der Anmeldung). 'normal' = bisherige Regeln (Untätigkeit je Rolle, Höchstdauer).
    // Wechselt die Person in „Mehr“ auf „Geteiltes Gerät“, wird die Sitzung 'normal'; `bis` bleibt dann als Obergrenze.
    // Bestehende Sitzungen bleiben 'normal' (unverändert).
    sql: `
ALTER TABLE sitzung ADD COLUMN art TEXT NOT NULL DEFAULT 'normal' CHECK (art IN ('normal','woche'));
ALTER TABLE sitzung ADD COLUMN bis TEXT;
`
  },
  {
    version: 53,
    name: '15.27: Pause beim Gehen nachgetragen – Kennzeichen an der Buchung',
    // nachgetragen = 1: „pause_start“/„pause_ende“, die beim „Gehen“ in der Stempeluhr nachgetragen wurden (Dauer und Beginn
    // gewählt, keine Pause gestempelt). Nur ein Hinweis für Stempeluhr und Korrekturen – gerechnet wird wie mit jeder Pause.
    // Eine Büro-Korrektur macht daraus eine gewöhnliche Büro-Buchung (0).
    sql: `
ALTER TABLE buchung ADD COLUMN nachgetragen INTEGER NOT NULL DEFAULT 0;
`
  },
  {
    version: 54,
    name: '15.30: Standort beim Stempeln – Einwilligung je Person (freiwillig, nur selbst einschaltbar)',
    // standort_einwilligung: Zeitpunkt, zu dem die Person „Standort beim Stempeln mitsenden“ selbst eingeschaltet hat
    // (NULL = aus, Standard). Gilt je Person am Server, nicht je Gerät – auf einem geteilten Tablet erbt niemand die Wahl.
    sql: `
ALTER TABLE benutzer ADD COLUMN standort_einwilligung TEXT;
`
  },
  {
    version: 55,
    name: '15.30 (Prüfbefund n8-g): Standorte ohne Einwilligung löschen',
    // Bis 15.30 speicherte die App den Standort mit dem alten Geräteschalter ohne Einwilligung der Person (und ohne Hinweis, dass
    // das Büro ihn sieht); seit 15.30 zeigt die Korrektur Standorte an. Gelöscht werden die Koordinaten jeder Buchung, für die
    // die Person (noch) nicht eingewilligt hatte, als die Buchung erfasst wurde. Die Buchungen selbst bleiben unverändert.
    // Prüfbefund n8-s: behalten nur bei der eigenen Stempelung (erfasst_von = Person, quelle app/offline) – PUT /zeit/buchungen/:id
    // setzt erfasst auf den Zeitpunkt der Korrektur (quelle 'buero'), und bis 15.30 blieb der Standort dabei stehen; eine vor der
    // Einwilligung gestempelte, danach korrigierte Buchung gälte sonst als „nach der Einwilligung erfasst“. Auch Zeilen mit nur
    // `genauigkeit` werden geleert.
    sql: `
UPDATE buchung SET lat = NULL, lng = NULL, genauigkeit = NULL
 WHERE (lat IS NOT NULL OR lng IS NOT NULL OR genauigkeit IS NOT NULL)
   AND NOT (erfasst_von IS NOT NULL AND erfasst_von = benutzer_id AND quelle IN ('app', 'offline') AND lat IS NOT NULL AND lng IS NOT NULL
        AND EXISTS (SELECT 1 FROM benutzer b WHERE b.id = buchung.benutzer_id AND b.standort_einwilligung IS NOT NULL AND b.standort_einwilligung <= buchung.erfasst));
`
  },
  {
    version: 56,
    name: '15.34: Bautagesbericht löschen mit Papierkorb (30 Tage wiederherstellbar)',
    // Inhaber 19.11.2026: GF/Büro/Bauleiter löschen Bautagesberichte (jeder Status, Begründung Pflicht); 30 Tage im Papierkorb.
    // Weiches Löschen direkt am Bericht (geloescht_*), damit Personal-, Geräte-, Material-, Regiezeilen, Unterschriften, Fotos
    // und Sichtstand unverändert an derselben ID bleiben – Wiederherstellen ist damit verlustfrei. geloescht_fuhren: Fuhren,
    // die beim Löschen vom Bericht gelöst wurden (JSON [{id, status}]), für das Wiederherstellen.
    // Neuaufbau der Tabelle, weil UNIQUE (baustelle_id, datum) als Tabellen-Constraint nicht entfernt werden kann: an seine
    // Stelle tritt ein Teilindex nur über nicht gelöschte Berichte (neuer Bericht für denselben Tag nach dem Löschen möglich).
    // Läuft mit ausgeschalteten Fremdschlüsseln (sonst löschte DROP TABLE alle Kindzeilen); foreign_key_check danach (db.js).
    fremdschluesselAus: true,
    sql: `
CREATE TABLE bericht_neu (
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
  version INTEGER NOT NULL DEFAULT 1,
  geaendert_nach_unterschrift TEXT,
  selbstfreigabe INTEGER NOT NULL DEFAULT 0,
  sicht_version INTEGER,
  sicht_geaendert TEXT,
  sicht_hash TEXT,
  sicht_real INTEGER,
  geloescht_zeit TEXT,
  geloescht_von INTEGER REFERENCES benutzer(id),
  geloescht_grund TEXT,
  geloescht_fuhren TEXT,
  CHECK ((geloescht_zeit IS NULL) = (geloescht_grund IS NULL))
);
INSERT INTO bericht_neu (id, baustelle_id, datum, status, seg_taetigkeit, seg_stunden, arbeitsleistung, mb_eigen, mb_fremd, paletten_euro,
  paletten_weissenboeck, vorkommnisse, wetter, erstellt_von, erstellt, geaendert, freigegeben_von, freigegeben_zeit, version,
  geaendert_nach_unterschrift, selbstfreigabe, sicht_version, sicht_geaendert, sicht_hash, sicht_real)
SELECT id, baustelle_id, datum, status, seg_taetigkeit, seg_stunden, arbeitsleistung, mb_eigen, mb_fremd, paletten_euro,
  paletten_weissenboeck, vorkommnisse, wetter, erstellt_von, erstellt, geaendert, freigegeben_von, freigegeben_zeit, version,
  geaendert_nach_unterschrift, selbstfreigabe, sicht_version, sicht_geaendert, sicht_hash, sicht_real FROM bericht;
DROP TABLE bericht;
ALTER TABLE bericht_neu RENAME TO bericht;
CREATE UNIQUE INDEX bericht_tag ON bericht(baustelle_id, datum) WHERE geloescht_zeit IS NULL;
CREATE INDEX bericht_datum ON bericht(datum);
CREATE INDEX bericht_papierkorb ON bericht(geloescht_zeit) WHERE geloescht_zeit IS NOT NULL;
INSERT OR IGNORE INTO rolle_recht (rolle, recht, wert) SELECT r.rolle, 'bericht_loeschen', 1
  FROM (SELECT 'gf' AS rolle UNION ALL SELECT 'buero' UNION ALL SELECT 'bauleiter') r WHERE EXISTS (SELECT 1 FROM rolle_recht);
`
  },
  {
    version: 57,
    name: '15.36: Urlaubskonto – Übertrag aus dem Vorjahr automatisch (Angestellte, UrlG)',
    // uebertrag_auto = 1: der Übertrag wird live aus dem Rest des Vorjahres gerechnet (Spalte uebertrag ohne Bedeutung);
    // 0: das Büro hat den Übertrag ausdrücklich festgelegt (Spalte uebertrag gilt). Neue Konto-Zeilen: automatisch.
    // Bestand: bisher speicherte jeder Konto-Dialog den Übertrag mit (leer = 0), ein gespeicherter Wert ist also nicht von
    // „nie angefasst“ zu unterscheiden. Damit sich bereits begonnene oder abgerechnete Urlaubsjahre nicht nachträglich ändern,
    // bleibt jede bestehende Zeile ausdrücklich festgelegt (Übertrag ≠ 0 ohnehin) – ausgenommen UrlG-Zeilen mit Übertrag 0 für
    // ein Jahr nach dem laufenden Kalenderjahr: dort ist noch nichts verbraucht oder abgerechnet, die 0 war die Vorgabe.
    sql: `
ALTER TABLE urlaub_konto ADD COLUMN uebertrag_auto INTEGER NOT NULL DEFAULT 1 CHECK (uebertrag_auto IN (0, 1));
UPDATE urlaub_konto SET uebertrag_auto = 0
 WHERE NOT (art = 'urlg' AND uebertrag = 0 AND jahr > CAST(strftime('%Y', 'now') AS INTEGER));
-- 15.36 (Prüfbefund): eine UrlG-Zeile ohne Anspruch mit Einheit „Werktage“ zeigte „25 Werktage“ – bleibt so. Die Einheit gehört
-- zum Anspruch; ohne eigenen Anspruch übernähme die Zeile jetzt Anspruch und Einheit des Vorjahres.
UPDATE urlaub_konto SET anspruch = 25 WHERE art = 'urlg' AND anspruch IS NULL AND einheit = 'Werktage';
-- 15.36 (Prüfbefund): Tag des letzten Wechsels des wirksamen BUAK-Kennzeichens (buak_pflichtig, sonst nach der Rolle).
-- Urlaubsjahre ohne Konto-Zeile vor dem Urlaubsjahr dieses Tages hatten die andere Art – so reicht die Übertrags-Kette der
-- Angestellten nie in Arbeiter-Jahre zurück. Bestand: aus dem Änderungsprotokoll (letzte Änderung von Rolle/Kennzeichen mit
-- anderem wirksamem Wert; ein im Eintrag fehlender Schlüssel gilt mit dem heutigen Wert). Danach hält der Trigger den Tag
-- aktuell, auch bei Änderungen außerhalb von PUT /benutzer (dort setzt die App den Tag selbst, nach ihrer Uhr).
ALTER TABLE benutzer ADD COLUMN buak_wechsel TEXT;
UPDATE benutzer SET buak_wechsel = (
  SELECT substr(MAX(p.zeit), 1, 10) FROM protokoll p
   WHERE p.objekt = 'benutzer:' || benutzer.id AND p.art IN ('benutzer', 'rolle') AND json_valid(p.alt) AND json_valid(p.neu)
     AND (json_type(p.neu, '$.buak_pflichtig') IS NOT NULL OR json_type(p.neu, '$.rolle') IS NOT NULL)
     AND (CASE WHEN json_type(p.alt, '$.buak_pflichtig') = 'integer' THEN json_extract(p.alt, '$.buak_pflichtig')
               WHEN json_type(p.alt, '$.buak_pflichtig') IS NULL AND benutzer.buak_pflichtig IN (0, 1) THEN benutzer.buak_pflichtig
               WHEN COALESCE(json_extract(p.alt, '$.rolle'), benutzer.rolle) IN ('mitarbeiter', 'polier') THEN 1 ELSE 0 END)
      <> (CASE WHEN json_type(p.neu, '$.buak_pflichtig') = 'integer' THEN json_extract(p.neu, '$.buak_pflichtig')
               WHEN json_type(p.neu, '$.buak_pflichtig') IS NULL AND benutzer.buak_pflichtig IN (0, 1) THEN benutzer.buak_pflichtig
               WHEN COALESCE(json_extract(p.neu, '$.rolle'), benutzer.rolle) IN ('mitarbeiter', 'polier') THEN 1 ELSE 0 END));
CREATE TRIGGER benutzer_buak_wechsel AFTER UPDATE OF rolle, buak_pflichtig ON benutzer
 WHEN (CASE WHEN OLD.buak_pflichtig IN (0, 1) THEN OLD.buak_pflichtig WHEN OLD.rolle IN ('mitarbeiter', 'polier') THEN 1 ELSE 0 END)
   <> (CASE WHEN NEW.buak_pflichtig IN (0, 1) THEN NEW.buak_pflichtig WHEN NEW.rolle IN ('mitarbeiter', 'polier') THEN 1 ELSE 0 END)
  AND NEW.buak_wechsel IS OLD.buak_wechsel
BEGIN
  UPDATE benutzer SET buak_wechsel = date('now') WHERE id = NEW.id;
END;
`
  }
];

module.exports = { MIGRATIONEN };
