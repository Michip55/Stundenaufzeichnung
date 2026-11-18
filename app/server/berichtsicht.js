'use strict';
/**
 * 15.15 (H-G4, Inhaberregeln 2b/3): Sichtstand des Bautagesberichts – `version` und `geaendert` für Aufrufer, die nicht alles sehen.
 *
 * Die Tabellenspalte bericht.version steigt bei JEDER Änderung, auch bei Inhalten, die Polier/Mitarbeiter nicht sehen
 * (fremder Lieferschein N-112, vom Büro eingetragene Abwesenheitszeile 15.1, Abwesenheits-Code an einer fremden Zeile).
 * Ein Versionssprung ohne sichtbare Änderung verriete solche Einträge. Deshalb:
 *  - Volle Sicht (Recht stammdaten oder lohn – Büro, Bauleiter, Lohnverrechnung, GF laut Matrix; für Polier/Mitarbeiter
 *    gesperrt): `version`/`geaendert` = Tabellenwerte. Die optimistische Sperre (C-08) erkennt wie bisher jede Änderung.
 *  - Alle anderen (Polier, Mitarbeiter – auch mit allen Ausnahmen): Sichtversion. Sie steigt genau dann, wenn sich das
 *    ändert, was DIESE Person im Bericht sieht, und nur um 1 – unabhängig davon, wie viele verborgene Änderungen es gab.
 *    PUT/Unterschrift/Personal-Übernahme prüfen gegen diese Sichtversion; die 409-Antwort trägt sie ebenfalls.
 *
 * Umsetzung (eine Stelle, ohne Rückschlüsse auf Zeitpunkte verborgener Änderungen):
 *  - „Allgemeine Sicht“ G = was eine Person ohne Rechte und ohne eigene Zeilen/Belege sieht. bericht.sicht_hash = Prüfsumme
 *    von G beim letzten Nachführen; ändert sie sich, steigt bericht.sicht_version um 1 (sicht_geaendert = Zeitpunkt).
 *  - Eigene Zeilen und eigene Lieferscheine sieht nur die Person selbst: Tabelle bericht_sicht je Person mit Prüfsumme ihrer
 *    Sicht und Zusatzzähler `extra` (steigt, wenn sich nur ihre eigene Sicht ändert). Sichtversion = sicht_version + extra.
 *  - nachfuehren() läuft nach jeder Änderung am Bericht (alle Stellen, die bericht.version erhöhen). Ein Sicherheitsnetz
 *    beim Lesen holt es nach, falls die Tabellenversion seit dem letzten Nachführen gestiegen ist (sicht_real).
 * Die Prüfsumme umfasst nur gespeicherte Inhalte, wie sie die Person sieht (dieselben Regeln wie berichtJson:
 * DS.berichtPersonal, Belege.berichtFotoSichtbar) – keine abgeleiteten Vorschläge (Wetter-Zwischenspeicher, Fuhren,
 * Anlagen) und keine Namen aus den Stammdaten.
 */
const crypto = require('node:crypto');
const DS = require('./datenschutz');
const Belege = require('./belege');

/** Sieht ctx alle Zeilen (auch fremde Abwesenheiten)? Dann echte Tabellenversion. */
const volleSicht = (ctx) => DS.berichtSiehtAbwesenheiten(ctx);
/** Kontext einer Person ohne Rechte (allgemeine Sicht: id 0) */
const ohneRechte = (uid) => ({ benutzer: { id: uid }, rechte: new Set(), hat: () => false });

function laden(db, id) {
  const b = db.eins('SELECT * FROM bericht WHERE id = ?', id);
  if (!b) return null;
  b.personal = db.alle('SELECT * FROM bericht_personal WHERE bericht_id = ? ORDER BY pos, id', id);
  b.geraete = db.alle('SELECT geraet_id, stunden, anlage_id, name FROM bericht_geraet WHERE bericht_id = ? ORDER BY geraet_id', id);
  b.material = db.alle('SELECT material_id, menge, name, einheit FROM bericht_material WHERE bericht_id = ? ORDER BY material_id', id);
  b.regie = db.alle('SELECT text, stunden FROM bericht_regie WHERE bericht_id = ? ORDER BY pos, id', id);
  b.unterschriften = db.alle('SELECT rolle, name, zeit, bild_hash FROM unterschrift WHERE bericht_id = ? ORDER BY rolle', id);
  b.fotos = db.alle('SELECT id, art, dateiname, beschreibung, sha256, mime, erstellt, erstellt_von FROM bericht_foto WHERE bericht_id = ? ORDER BY id', id);
  return b;
}

/** Prüfsumme der Sicht von `uid` (0 = allgemeine Sicht ohne eigene Zeilen/Belege) */
function pruefsumme(b, uid) {
  const ctx = ohneRechte(uid);
  const personal = DS.berichtPersonal(ctx, b.personal.map((p) => ({
    benutzerId: p.benutzer_id, von1: p.von1, bis1: p.bis1, von2: p.von2, bis2: p.bis2, pauseMin: p.pause_min, stunden: p.stunden,
    code: p.code, segStunden: p.seg_stunden, hinweis: p.hinweis || null, gast: Boolean(p.gast)
  })));
  const inhalt = {
    datum: b.datum, baustelle: b.baustelle_id, status: b.status, personal,
    seg: [b.seg_taetigkeit, b.seg_stunden], geraete: b.geraete, material: b.material, regie: b.regie,
    texte: [b.arbeitsleistung, b.mb_eigen, b.mb_fremd, b.paletten_euro, b.paletten_weissenboeck, b.vorkommnisse, b.wetter],
    unterschriften: b.unterschriften, freigabe: [b.freigegeben_von, b.freigegeben_zeit, b.selbstfreigabe], erstellt: b.erstellt,
    nachUnterschrift: b.geaendert_nach_unterschrift,
    // Papierbericht-Seiten sind Archivanhang (ohne Versionssprung, 12.12) – sie zählen hier ebenfalls nicht
    fotos: b.fotos.filter((f) => f.art !== 'papier' && Belege.berichtFotoSichtbar(ctx, f))
  };
  return crypto.createHash('sha256').update(JSON.stringify(inhalt)).digest('hex');
}

/**
 * Sichtstand nach einer Änderung nachführen (in der Transaktion des Aufrufers, nach dem Schreiben).
 * @param {object} o basis=true: nur Prüfsummen übernehmen, nichts zählen (Inhalt, den noch niemand gesehen hat)
 */
function nachfuehren(db, berichtId, zeit, { basis = false } = {}) {
  const b = laden(db, berichtId);
  if (!b) return;
  zeit = zeit || b.geaendert;
  const g = pruefsumme(b, 0);
  // Ausgangsstand (nichts zählen, Sichtversion = Tabellenversion): neu angelegt bzw. Bestand vor Migration 45 (sicht_hash fehlt)
  const neu = b.sicht_hash == null;
  // Tabellenversion gesunken (nur bei Eingriffen direkt in die Datenbank, kein Weg über die API): nichts zählen, Abstand
  // zwischen Tabellen- und Sichtversion beibehalten
  const zurueck = !neu && b.sicht_real != null && b.version < b.sicht_real;
  const zaehlen = !neu && !zurueck && !basis;
  const gNeu = zaehlen && g !== b.sicht_hash;
  const sv = neu || b.sicht_version == null ? b.version
    : zurueck ? Math.max(1, b.version - Math.max(0, b.sicht_real - b.sicht_version)) : b.sicht_version;
  db.lauf('UPDATE bericht SET sicht_hash = ?, sicht_version = ?, sicht_geaendert = ?, sicht_real = ? WHERE id = ?',
    g, sv + (gNeu ? 1 : 0), gNeu ? zeit : neu || zurueck ? b.geaendert : (b.sicht_geaendert || b.geaendert), b.version, b.id);
  if (neu) db.lauf('DELETE FROM bericht_sicht WHERE bericht_id = ?', b.id);
  const zeilen = neu ? new Map() : new Map(db.alle('SELECT * FROM bericht_sicht WHERE bericht_id = ?', b.id).map((r) => [r.benutzer_id, r]));
  const personen = new Set([...zeilen.keys(), ...b.personal.map((p) => p.benutzer_id),
    ...b.fotos.filter((f) => Belege.BERICHT_ARTEN.includes(f.art) && f.erstellt_von != null).map((f) => f.erstellt_von)]);
  for (const uid of personen) {
    const h = pruefsumme(b, uid);
    const r = zeilen.get(uid);
    if (!r) {
      if (h === g) continue; // sieht genau die allgemeine Sicht (und hat sie bisher gesehen – sonst gäbe es eine Zeile)
      const plus = zaehlen && !gNeu ? 1 : 0; // bisher allgemeine Sicht, jetzt eigene Zeile/Beleg
      db.lauf('INSERT INTO bericht_sicht (bericht_id, benutzer_id, extra, hash, geaendert) VALUES (?, ?, ?, ?, ?)', b.id, uid, plus, h, plus ? zeit : null);
    } else if (h !== r.hash) {
      const plus = zaehlen && !gNeu ? 1 : 0; // ändert sich auch die allgemeine Sicht, zählt schon sicht_version
      db.lauf('UPDATE bericht_sicht SET hash = ?, extra = extra + ?, geaendert = ? WHERE bericht_id = ? AND benutzer_id = ?',
        h, plus, plus ? zeit : r.geaendert, b.id, uid);
    }
  }
}

/** Ausgangsstand setzen, falls noch keiner da ist (vor einer Änderung aufrufen, z. B. beim Laden) */
function vorbereiten(db, berichtId) {
  const z = db.eins('SELECT sicht_hash FROM bericht WHERE id = ?', berichtId);
  if (z && z.sicht_hash == null) nachfuehren(db, berichtId, null);
}

/**
 * Version und Änderungszeitpunkt des Berichts, wie ctx sie sieht.
 * @param {object} b Zeile bericht (mindestens id, version, geaendert)
 * @returns {{version:number, geaendert:string}}
 */
function stand(db, ctx, b) {
  if (volleSicht(ctx)) return { version: b.version, geaendert: b.geaendert };
  let z = db.eins('SELECT version, geaendert, sicht_version, sicht_geaendert, sicht_hash, sicht_real FROM bericht WHERE id = ?', b.id);
  if (!z) return { version: b.version, geaendert: b.geaendert };
  // Sicherheitsnetz: Tabellenversion gestiegen, ohne dass nachgeführt wurde → jetzt nachführen
  if (z.sicht_hash == null || z.sicht_real !== z.version) { // (auch: Tabellenversion direkt zurückgesetzt → Ausgangsstand)
    nachfuehren(db, b.id, z.geaendert);
    z = db.eins('SELECT version, geaendert, sicht_version, sicht_geaendert FROM bericht WHERE id = ?', b.id);
  }
  const uid = ctx && ctx.benutzer ? ctx.benutzer.id : 0;
  const r = uid ? db.eins('SELECT extra, geaendert FROM bericht_sicht WHERE bericht_id = ? AND benutzer_id = ?', b.id, uid) : null;
  const sg = z.sicht_geaendert || z.geaendert;
  return {
    version: z.sicht_version + (r ? r.extra : 0),
    geaendert: r && r.geaendert && r.geaendert > sg ? r.geaendert : sg
  };
}

module.exports = { volleSicht, pruefsumme, nachfuehren, vorbereiten, stand };
