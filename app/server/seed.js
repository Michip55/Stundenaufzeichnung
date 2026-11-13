'use strict';
/**
 * Testdaten (fiktiv, wie im Prototyp prototype/data/data.js) – `npm run seed` erzeugt app/data/bautag.db neu.
 * Demo-PIN für alle Benutzer: 1234 – NUR für Testdaten, vor Echtbetrieb ändern!
 *
 * Alle Daten sind relativ zu „heute“ (Uhr bzw. BAUTAG_UHR): Der Prototyp spielt am 12.11.2026,
 * die Datumswerte werden um die Differenz verschoben. Historie: ca. 3 Wochen Stempelungen und Berichte.
 */
const fs = require('node:fs');
const path = require('node:path');
const { oeffneDatenbank } = require('./db');
const { schreibeStandardMatrix } = require('./rechte');
const { hashPinSync } = require('./auth');
const { wienDatum, wienZuDate, plusTage, tageZwischen, istArbeitstag, wochentag, erzeugeUhr } = require('./datum');
const { personalVorschlag, kalkulationFuer, ladeBaustelle } = require('./daten');
const { speichereUpdate } = require('./routes/berichte');
const { pruefeAlleBudgets } = require('./budget');
const { demoUnterschrift, zufall, hash } = require('./png');
const { katalogAnlegen, katalogKopieren } = require('./positionen');

const DEMO_PIN = '1234';
const PROTOTYP_HEUTE = '2026-11-12';

/* ---------------- Stammdaten aus dem Prototyp ---------------- */
const LOHNGRUPPEN = [
  ['pol', 'Polier', 'Polier · Angestellte Bau A3', 58.0, 74.0], ['va', 'Vorarbeiter', 'KV Bau · Lohngruppe IIa', 49.5, 66.0],
  ['fa', 'Facharbeiter', 'KV Bau · Lohngruppe IIb', 46.0, 62.0], ['ma', 'Maschinist', 'KV Bau · Lohngruppe IIb', 47.0, 63.0],
  ['lkw', 'LKW-Fahrer', 'KV Güterbeförderung', 44.0, 58.0], ['hi', 'Hilfsarbeiter', 'KV Bau · Lohngruppe IV', 39.5, 52.0],
  ['le', 'Lehrling', 'KV Bau · 2. Lehrjahr', 19.0, 34.0]
];

// Reihenfolge exakt wie auf der Papiervorlage (linke Spalte, dann rechte Spalte)
const GERAETE = [
  ['kran3', 'LKW mit Kran 3-A', 'LKW', 52, 78], ['kran4', 'LKW mit Kran 4-A', 'LKW', 58, 86], ['lkw2', 'LKW 2-Achser', 'LKW', 38, 58],
  ['lkw3', 'LKW 3-Achser', 'LKW', 46, 68], ['lkw4', 'LKW 4-Achser', 'LKW', 52, 76], ['sattel', 'LKW Zug oder Sattel', 'LKW', 60, 88],
  ['tieflader', 'LKW mit Tieflader', 'LKW', 64, 95], ['verlege', 'Verlegemaschine', 'Pflasterung', 24, 42], ['schneid', 'Schneidgerät', 'Pflasterung', 9, 18],
  ['kompressor', 'Kompressor', 'Kleingerät', 12, 22], ['dumper', 'Dumper', 'Erdbau', 18, 32], ['bobcat', 'Bobcat', 'Erdbau', 22, 38],
  ['b15', 'Bagger 1,5 to.', 'Bagger', 16, 29], ['b27', 'Bagger 2,7 to.', 'Bagger', 19, 34], ['b9', 'Bagger 9 to.', 'Bagger', 34, 56],
  ['b23', 'Bagger 23 to.', 'Bagger', 58, 92], ['radlader', 'Radlader', 'Erdbau', 36, 58], ['graeder', 'Gräder', 'Erdbau', 48, 78],
  ['bomag', 'Bomag BW 177', 'Verdichtung', 32, 52], ['hamm', 'Hamm Walz 2 to.', 'Verdichtung', 18, 30], ['handwalze', 'Handwalze', 'Verdichtung', 9, 16],
  ['ruettel', 'Rüttelplatte', 'Verdichtung', 7, 14], ['grabenwalze', 'Grabenwalze', 'Verdichtung', 14, 24]
];

const MATERIAL = [
  ['aushub', 'Aushub', 'to', true, 9.5, 16.0, 'Deponie / Verfuhr'], ['betonbruch', 'Betonbruch', 'to', true, 14.0, 22.0, 'Entsorgung'],
  ['asphaltbruch', 'Asphaltbruch', 'to', true, 18.0, 28.0, 'Entsorgung'], ['frostschutz', 'Frostschutz', 'to', true, 13.8, 21.5, 'KK 0/63 · Kieswerk Breitenau'],
  ['graeder', 'Grädermaterial', 'to', true, 15.2, 23.5, 'KK 0/32'], ['splitt', 'Splitt', 'to', true, 24.5, 36.0, 'Körnung 2/4'],
  ['pflaster8', 'Betonsteinpflaster 8 cm grau', 'm²', false, 16.9, 24.5, 'Weissenböck, Rechteck 20/10'], ['randstein', 'Randleiste 8/25/100', 'lfm', false, 6.4, 9.8, ''],
  ['beton', 'Beton C20/25 erdfeucht', 'm³', false, 112.0, 148.0, 'Lieferbeton'], ['asphalt', 'Asphalt AC 11 deck', 'to', false, 96.0, 128.0, 'ab Mischwerk'],
  ['rohr150', 'Kanalrohr PVC DN 150', 'lfm', false, 11.8, 17.5, '']
];

const LEISTUNGEN = [
  ['be', '01.01', 'Baustelleneinrichtung und -räumung', 'PA', 2850.0], ['aushub', '02.01', 'Aushub BKL 3–5 inkl. Verfuhr und Deponie', 'm³', 24.8],
  ['frost', '02.04', 'Frostschutzschicht 30 cm liefern, einbauen, verdichten', 'm²', 14.6], ['planum', '02.06', 'Feinplanum herstellen', 'm²', 2.9],
  ['pflaster', '03.01', 'Betonsteinpflaster 8 cm verlegen inkl. Splittbett', 'm²', 68.5], ['rand', '03.04', 'Randleisten versetzen in Beton C20/25', 'lfm', 34.0],
  ['trag', '04.01', 'Asphalttragschicht AC 16 trag, 8 cm', 'm²', 31.5], ['deck', '04.02', 'Asphaltdeckschicht AC 11 deck, 3 cm', 'm²', 17.8],
  ['kuenette', '05.01', 'Künette ausheben, Rohr verlegen, verfüllen', 'lfm', 86.0], ['regie', '09.01', 'Regiestunde Facharbeiter', 'Std.', 62.0]
];

const M = (id, vn, nn, lg, kst, rolle = 'mitarbeiter') => ({ id, name: `${vn} ${nn}`, lg, kst, rolle, pnr: 1000 + id });
const MITARBEITER = [
  M(1, 'Josef', 'Haidbauer', 'pol', '26-041', 'polier'), M(2, 'Lukas', 'Brandstätter', 'fa', '26-041'), M(3, 'Daniel', 'Schwarz', 'fa', '26-041'),
  M(4, 'Roland', 'Kerschbaumer', 'ma', '26-041'), M(5, 'Mehmet', 'Yıldız', 'hi', '26-041'), M(6, 'Fabian', 'Stickler', 'le', '26-041'),
  M(7, 'Karl', 'Ungersböck', 'lkw', '26-041'), M(8, 'Franz', 'Leitgeb', 'pol', '26-038', 'polier'), M(9, 'Christian', 'Trimmel', 'fa', '26-038'),
  M(10, 'Günter', 'Scherz', 'ma', '26-038'), M(11, 'Bogdan', 'Ionescu', 'hi', '26-038'), M(12, 'Zoran', 'Petrović', 'lkw', '26-038'),
  M(13, 'Thomas', 'Riegler', 'va', '26-044', 'polier'), M(14, 'Mario', 'Gruber', 'fa', '26-044'), M(15, 'Peter', 'Schabauer', 'hi', '26-044'),
  M(16, 'Patrick', 'Hofer', 'fa', '26-029'), M(17, 'Markus', 'Zöchling', 'fa', '26-029'), M(18, 'Reinhard', 'Luef', 'lkw', '26-029'),
  M(19, 'Manfred', 'Puchegger', 'va', '26-047', 'polier'), M(20, 'Herbert', 'Flasch', 'ma', '26-047'), M(21, 'Dominik', 'Kogelbauer', 'hi', '26-047'),
  M(22, 'Andreas', 'Stangl', 'va', '26-035', 'polier'), M(23, 'Stefan', 'Weninger', 'fa', '26-035'), M(24, 'Elias', 'Woltron', 'le', '26-035'),
  M(25, 'Gerhard', 'Wallner', 'pol', '26-050', 'polier'), M(26, 'Werner', 'Posch', 'ma', '26-050'), M(27, 'Ivan', 'Horvat', 'hi', '26-050'),
  M(28, 'Erwin', 'Pürrer', 'lkw', '26-050'), M(29, 'Johann', 'Tisch', 'lkw', '26-050'), M(30, 'Alois', 'Dorfmeister', 'ma', '90-001')
];
const BUERO = [
  { id: 101, name: 'Martina Koller', rolle: 'buero', pnr: 1101 },
  { id: 102, name: 'Michael Pichler', rolle: 'gf', pnr: 1102 },
  { id: 103, name: 'Stefan Aigner', rolle: 'bauleiter', pnr: 1103 }
];

const BAUSTELLEN = [
  {
    kst: '26-041', name: 'Wohnhausanlage Pitten – Außenanlagen', kurz: 'WHA Pitten', ag: 'Wohnbau Schwarzatal Gen.m.b.H.', agAdr: 'Hauptplatz 14, 2620 Neunkirchen',
    bv: 'Wohnhausanlage Pitten, Feldgasse 7–11 · Zufahrt, Parkplätze, Gehwege', ort: '2823 Pitten, Feldgasse 7–11', vertreter: 'Ing. Helga Auer', art: 'Erdbau · Pflasterung',
    start: '2026-09-28', ende: '2026-11-27', polier: 1, bauleiter: 103, ziel: [0.60, 0.72],
    geraete: { b9: [8, 0.85], lkw3: [4, 0.7], ruettel: [6, 0.75], bomag: [3, 0.3], dumper: [4, 0.35], schneid: [3, 0.45], verlege: [5, 0.3], b27: [4, 0.25], kran3: [2, 0.2] },
    material: { frostschutz: [42, 0.5], splitt: [6, 0.45], aushub: [56, 0.35], graeder: [14, 0.25], betonbruch: [8, 0.08], pflaster8: [46, 0.45], randstein: [28, 0.3], beton: [2.5, 0.3] },
    pos: { be: 0.02, aushub: 0.14, frost: 0.2, planum: 0.04, pflaster: 0.42, rand: 0.14 },
    fremd: [['2026-10-06', 'Vermessung Absteckung – ZT Büro Kern', 1480], ['2026-10-20', 'Saugbagger Leitungsfreilegung – Fa. Kanal-Tec', 2260], ['2026-11-04', 'Deponiegebühr Baurestmassen', 940]],
    texte: ['Aushub Zufahrt Stiege 2 bis Planum, Verfuhr mit 3-Achser.', 'Frostschutz 0/63 lagenweise eingebracht und verdichtet (Bomag).', 'Randleisten versetzt Parkplatz Reihe B, 28 lfm.', 'Betonsteinpflaster 8 cm verlegt Gehweg Stiege 1, Fugen eingekehrt und abgerüttelt.', 'Feinplanum hergestellt, Splittbett abgezogen.', 'Schneidarbeiten Anschlüsse Schachtdeckel und Einfassungen.']
  },
  {
    kst: '26-038', name: 'Betriebszufahrt Holzbau Kogler', kurz: 'Zufahrt Kogler', ag: 'Holzbau Kogler GmbH', agAdr: 'Industriestraße 22, 2620 Neunkirchen',
    bv: 'Betriebsgelände Neunkirchen · Zufahrt und Lagerfläche asphaltieren', ort: '2620 Neunkirchen, Industriestraße 22', vertreter: 'Bernhard Kogler', art: 'Erdbau · Asphaltierung',
    start: '2026-10-05', ende: '2026-11-20', polier: 8, bauleiter: 103, ziel: [0.84, 0.93], nachtraege: [['Nachtrag 01 – Entwässerungsrinne Lagerfläche', 6400]],
    geraete: { b23: [7, 0.5], lkw4: [6, 0.7], graeder: [5, 0.45], bomag: [6, 0.6], radlader: [4, 0.4], hamm: [4, 0.3], sattel: [5, 0.3] },
    material: { frostschutz: [84, 0.55], graeder: [38, 0.45], aushub: [120, 0.4], asphaltbruch: [22, 0.2], asphalt: [38, 0.22] },
    pos: { be: 0.03, aushub: 0.2, frost: 0.25, planum: 0.05, trag: 0.3, deck: 0.15 },
    fremd: [['2026-11-03', 'Asphalteinbau Fertiger samt Partie – Fa. Asphaltbau Süd', 11800], ['2026-10-14', 'Bodenprüfung Lastplatte', 620]],
    texte: ['Abtrag Oberboden und Aushub Lagerfläche.', 'Frostschutz eingebaut und verdichtet, Lastplattenversuch vorbereitet.', 'Grädermaterial eingebaut, Planum auf ± 2 cm abgezogen.', 'Asphalttragschicht AC 16 eingebaut (Fertiger Fremdfirma), Anschlüsse händisch.']
  },
  {
    kst: '26-044', name: 'Einfamilienhaus Reisinger – Hof und Zufahrt', kurz: 'EFH Reisinger', ag: 'Fam. Reisinger', agAdr: 'Schlossweg 3, 2824 Seebenstein',
    bv: 'Hofpflasterung, Zufahrt und Terrassenunterbau', ort: '2824 Seebenstein, Schlossweg 3', vertreter: 'Claudia Reisinger', art: 'Pflasterung',
    start: '2026-10-19', ende: '2026-11-13', polier: 13, bauleiter: 102, ziel: [0.92, 0.97],
    geraete: { b27: [6, 0.7], lkw2: [3, 0.5], ruettel: [5, 0.8], schneid: [3, 0.5], dumper: [3, 0.3], kran3: [1.5, 0.25] },
    material: { frostschutz: [16, 0.4], splitt: [4, 0.5], aushub: [18, 0.3], pflaster8: [24, 0.6], randstein: [12, 0.35], beton: [1, 0.3] },
    pos: { be: 0.02, aushub: 0.1, frost: 0.14, pflaster: 0.56, rand: 0.14 },
    fremd: [['2026-10-22', 'Containerdienst Grünschnitt', 380]],
    texte: ['Aushub Hof bis Planum, Material seitlich gelagert.', 'Frostschutz eingebracht, verdichtet.', 'Pflaster im Hof verlegt (Fischgrät), Zuschnitte an der Hausmauer.', 'Randleisten Zufahrt versetzt.']
  },
  {
    kst: '26-029', name: 'Gemeinde Breitenau – Gehsteig Hauptstraße', kurz: 'Gehsteig Breitenau', ag: 'Gemeinde Breitenau', agAdr: 'Gemeindeplatz 1, 2624 Breitenau',
    bv: 'Gehsteigsanierung Hauptstraße, Abschnitt Kirche bis Feuerwehrhaus', ort: '2624 Breitenau, Hauptstraße', vertreter: 'Bauamtsleiter K. Steiner', art: 'Pflasterung · Regie',
    start: '2026-09-14', ende: '2026-11-18', polier: 13, bauleiter: 102, ziel: [0.83, 0.90],
    geraete: { b15: [6, 0.7], lkw2: [3, 0.5], ruettel: [5, 0.7], schneid: [4, 0.6], kompressor: [3, 0.3], handwalze: [3, 0.3] },
    material: { betonbruch: [6, 0.4], asphaltbruch: [5, 0.35], frostschutz: [9, 0.4], splitt: [3, 0.5], pflaster8: [18, 0.55], randstein: [16, 0.5], beton: [1.2, 0.4] },
    pos: { be: 0.03, aushub: 0.08, frost: 0.1, pflaster: 0.45, rand: 0.24 },
    fremd: [['2026-10-08', 'Verkehrssicherung / Ampelregelung', 1650]],
    texte: ['Abbruch bestehender Gehsteig, Asphaltbruch verladen.', 'Randleisten neu versetzt, 16 lfm.', 'Pflaster verlegt, Einfahrten angepasst.', 'Regie: Schieberkappen und Hydrant auf Niveau gesetzt (Anweisung Bauamt).']
  },
  {
    kst: '26-047', name: 'Kanalanschluss Werkstraße Ternitz', kurz: 'Kanal Ternitz', ag: 'Stahlservice Ternitz GmbH', agAdr: 'Werkstraße 40, 2630 Ternitz',
    bv: 'Schmutzwasserkanal-Anschluss Halle 3, Künette 86 lfm', ort: '2630 Ternitz, Werkstraße 40', vertreter: 'DI Martin Ebner', art: 'Erdbau · Kanal',
    start: '2026-10-27', ende: '2026-11-25', polier: 19, bauleiter: 103, ziel: [0.57, 0.42],
    geraete: { b9: [8, 0.8], lkw3: [3, 0.5], grabenwalze: [4, 0.6], dumper: [5, 0.5], kompressor: [3, 0.25] },
    material: { aushub: [34, 0.5], frostschutz: [18, 0.4], graeder: [10, 0.3], asphaltbruch: [6, 0.15], rohr150: [9, 0.6], beton: [0.8, 0.2] },
    pos: { be: 0.04, aushub: 0.12, kuenette: 0.66, frost: 0.12 },
    fremd: [['2026-11-05', 'Kanal-TV-Befahrung und Dichtheitsprüfung', 890]],
    texte: ['Künette ausgehoben, Verbau gesetzt, 9 lfm Rohr DN 150 verlegt.', 'Künette lagenweise verfüllt und mit Grabenwalze verdichtet.', 'Schacht S2 versetzt.']
  },
  {
    kst: '26-035', name: 'Parkplatz Nahversorger Gloggnitz', kurz: 'Parkplatz Gloggnitz', ag: 'Frischemarkt Semmering KG', agAdr: 'Wiener Straße 61, 2640 Gloggnitz',
    bv: 'Erweiterung Kundenparkplatz, 18 Stellplätze, Pflaster und Entwässerung', ort: '2640 Gloggnitz, Wiener Straße 61', vertreter: 'Filialleiter R. Pammer', art: 'Erdbau · Pflasterung',
    start: '2026-09-21', ende: '2026-11-13', polier: 22, bauleiter: 102, ziel: [1.03, 0.95],
    geraete: { b9: [7, 0.6], lkw3: [4, 0.5], ruettel: [6, 0.7], verlege: [6, 0.4], schneid: [3, 0.4], bomag: [3, 0.25] },
    material: { frostschutz: [30, 0.4], splitt: [5, 0.5], aushub: [40, 0.3], pflaster8: [38, 0.55], randstein: [14, 0.3], beton: [1.5, 0.3] },
    pos: { be: 0.03, aushub: 0.14, frost: 0.2, planum: 0.03, pflaster: 0.46, rand: 0.12 },
    fremd: [['2026-10-01', 'Mehraufwand Felsabtrag – Hydraulikhammer Miete', 3900], ['2026-10-16', 'Entwässerungsrinnen Lieferung und Versetzen', 4200]],
    texte: ['Aushub erschwert (Fels), Hydraulikhammer im Einsatz.', 'Frostschutz eingebracht und verdichtet.', 'Pflaster maschinell verlegt, Stellplatzmarkierung mit Farbsteinen.']
  },
  {
    kst: '26-050', name: 'Lagerhalle Wiener Neustadt – Unterbau', kurz: 'Halle Wr. Neustadt', ag: 'Logistikpark Steinfeld GmbH', agAdr: 'Ferdinand-Graf-von-Zeppelin-Straße 9, 2700 Wiener Neustadt',
    bv: 'Neubau Lagerhalle C · Erdbau, Unterbau Bodenplatte und Umfahrung', ort: '2700 Wiener Neustadt, Civitas Nova', vertreter: 'Bmst. Ing. P. Holzer', art: 'Erdbau',
    start: '2026-11-02', ende: '2027-01-29', polier: 25, bauleiter: 103, ziel: [0.14, 0.17],
    geraete: { b23: [8.5, 0.9], sattel: [8, 0.8], lkw4: [8, 0.8], radlader: [6, 0.6], graeder: [4, 0.3], bomag: [5, 0.5], tieflader: [2, 0.12] },
    material: { aushub: [260, 0.8], frostschutz: [140, 0.5], graeder: [40, 0.2] },
    pos: { be: 0.06, aushub: 0.52, frost: 0.36, planum: 0.04 },
    fremd: [['2026-11-03', 'Vermessung Höhenfestpunkte', 760]],
    texte: ['Humusabtrag und Aushub Baufeld Achse 1–4, Verfuhr mit Sattel und 4-Achser.', 'Frostschutz lagenweise eingebaut, Verdichtung mit Bomag BW 177.']
  },
  {
    kst: '90-001', name: 'Kieswerk Breitenau (intern)', kurz: 'Kieswerk', intern: true, ag: 'Michael Pichler Ges.m.b.H.', agAdr: '2624 Breitenau',
    bv: 'Kieswerk – Aufbereitung und Verladung', ort: '2624 Breitenau', vertreter: '', art: 'Kieswerk', start: '2026-01-07', ende: '2026-12-18', polier: null, bauleiter: 102
  }
];

const SW_TAG = '2026-11-03';

/* ---------------- Seed ---------------- */

/**
 * Spielt die Testdaten in eine LEERE Datenbank ein.
 * @param {import('./db').Datenbank} db
 * @param {{uhr?: Date, demo?: boolean}} [opt]  demo=true: PIN 1234 ohne Änderungspflicht (nur Vorführung/Tests)
 */
function seed(db, opt = {}) {
  const jetzt = opt.uhr instanceof Date ? opt.uhr : new Date();
  if (db.eins('SELECT COUNT(*) AS n FROM benutzer').n > 0) throw new Error('Seed nur in eine leere Datenbank (npm run seed erzeugt die Datei neu).');
  const heute = wienDatum(jetzt);
  const versatz = tageZwischen(PROTOTYP_HEUTE, heute);
  const d = (s) => plusTage(s, versatz);
  const iso = (datum, hm) => wienZuDate(datum, hm).toISOString();
  const jetztIso = jetzt.toISOString();
  const jetztMin = (() => { const z = new Date(jetzt); return z; })();

  // Arbeitstage der Historie: letzte 3 Wochen vor heute
  const historie = [];
  for (let s = plusTage(heute, -21); s < heute; s = plusTage(s, 1)) if (istArbeitstag(s)) historie.push(s);
  const letzterArbeitstagBis = (s) => { let x = s; while (!istArbeitstag(x)) x = plusTage(x, -1); return x; };

  db.transaktion(() => {
    db.setzeEinstellung('firma', { name: 'Michael Pichler Ges.m.b.H.', ort: '2624 Breitenau' });
    db.setzeEinstellung('arbeitszeit', { tagNormal: [0, 8, 8, 8, 8, 7, 0], wocheNormal: 39 });
    schreibeStandardMatrix(db);

    LOHNGRUPPEN.forEach(([id, name, kv, k, r], i) => db.lauf('INSERT INTO lohngruppe (id, name, kv, kostensatz, regiesatz, sortierung) VALUES (?, ?, ?, ?, ?, ?)', id, name, kv, k, r, i));
    const geraetId = {};
    GERAETE.forEach(([code, name, gruppe, k, vk], i) => { geraetId[code] = db.lauf('INSERT INTO geraet (code, name, gruppe, kostensatz, verrechnungssatz, vorlage, sortierung) VALUES (?, ?, ?, ?, ?, 1, ?)', code, name, gruppe, k, vk, i).id; });
    const materialId = {};
    MATERIAL.forEach(([code, name, einheit, vorlage, ek, vk, hinweis], i) => { materialId[code] = db.lauf('INSERT INTO material (code, name, einheit, ek, vk, vorlage, hinweis, sortierung) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', code, name, einheit, ek, vk, vorlage ? 1 : 0, hinweis, i).id; });
    const leistungId = {};
    const leistungEp = {};
    LEISTUNGEN.forEach(([key, code, text, einheit, ep]) => { leistungId[key] = db.lauf('INSERT INTO leistung (code, text, einheit, ep) VALUES (?, ?, ?, ?)', code, text, einheit, ep).id; leistungEp[key] = ep; });

    // Benutzer (Start-PIN 1234, je Benutzer eigener Salt). Ohne Demo-Modus muss jeder die PIN beim ersten Anmelden ändern.
    const mussAendern = opt.demo ? 0 : 1;
    for (const m of [...MITARBEITER, ...BUERO]) {
      db.lauf('INSERT INTO benutzer (id, name, rolle, lohngruppe_id, pnr, aktiv, pin_hash, erstellt, muss_pin_aendern, pin_laenge) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)', m.id, m.name, m.rolle, m.lg || null, m.pnr || null, hashPinSync(DEMO_PIN), jetztIso, mussAendern, DEMO_PIN.length);
    }

    // Baustellen
    const bsId = {};
    for (const b of BAUSTELLEN) {
      const status = d(b.ende) < heute ? 'abgeschlossen' : d(b.start) > heute ? 'geplant' : 'aktiv';
      bsId[b.kst] = db.lauf(`INSERT INTO baustelle (kst, name, kurz, auftraggeber, ag_adresse, bauvorhaben, adresse, bauherr_vertreter, art, status, intern, polier_id, bauleiter_id, beginn, ende, erstellt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, b.kst, b.name, b.kurz, b.ag, b.agAdr, b.bv, b.ort, b.vertreter, b.art, b.intern ? 'aktiv' : status, b.intern ? 1 : 0,
      b.polier, b.bauleiter, d(b.start), d(b.ende), jetztIso).id;
    }
    for (const m of MITARBEITER) db.lauf('UPDATE benutzer SET baustelle_id = ? WHERE id = ?', bsId[m.kst], m.id);

    /* ---- Stempelungen der Historie ---- */
    const buche = (uid, datum, hm, typ, kst) => db.lauf(`INSERT INTO buchung (benutzer_id, typ, zeit, baustelle_id, quelle, erfasst_von, erfasst) VALUES (?, ?, ?, ?, 'seed', ?, ?)`,
      uid, typ, iso(datum, hm), typ === 'kommen' || typ === 'wechsel' ? bsId[kst] : null, uid, iso(datum, hm));
    const abwesend = (uid, datum, code, status = 'genehmigt') => db.lauf('INSERT INTO abwesenheit (benutzer_id, datum, code, status, erfasst_von, erfasst) VALUES (?, ?, ?, ?, 101, ?) ON CONFLICT(benutzer_id, datum) DO NOTHING', uid, datum, code, status, jetztIso);
    const hmPlus = (hm, min) => { const [h, m] = hm.split(':').map(Number); const t = h * 60 + m + min; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

    const special = {};
    const tagRel = (n) => letzterArbeitstagBis(plusTage(heute, n));
    special[`12|${tagRel(-1)}`] = { kommen: '06:00', pause: ['12:00', '12:30'], gehen: '17:30' }; // > 10 Std.
    special[`17|${tagRel(-2)}`] = { kommen: '07:00', pause: null, gehen: '15:30' }; // > 6 Std. ohne Pause
    special[`27|${tagRel(-1)}`] = { kommen: '07:00', pause: ['12:00', '12:30'], gehen: null }; // Ausstempeln vergessen
    // langer Tag mit direkt folgendem Arbeitstag (für das Ruhezeit-Beispiel)
    let iRuhe = Math.max(0, historie.indexOf(tagRel(-6)));
    while (iRuhe > 0 && historie[iRuhe + 1] !== plusTage(historie[iRuhe], 1)) iRuhe--;
    const tRuhe = historie[iRuhe];
    special[`4|${tRuhe}`] = { kommen: '06:30', pause: ['12:00', '12:30'], gehen: '19:00' }; // langer Tag …
    const naechster = historie[historie.indexOf(tRuhe) + 1];
    if (naechster) special[`4|${naechster}`] = { kommen: '05:30', pause: ['12:00', '12:30'], gehen: '14:00' }; // … < 11 Std. Ruhezeit

    for (const m of MITARBEITER) {
      const r = zufall(hash('ts' + m.id));
      let block = null;
      for (const datum of historie) {
        if (d(BAUSTELLEN.find((b) => b.kst === m.kst).start) > datum) continue;
        const sp = special[`${m.id}|${datum}`];
        if (!sp && !block) { const x = r(); if (x < 0.012) block = { c: 'K', n: 2 + Math.floor(r() * 3) }; else if (x < 0.024) block = { c: 'U', n: 2 + Math.floor(r() * 3) }; }
        if (!sp && block) { abwesend(m.id, datum, block.c); block.n--; if (block.n <= 0) block = null; continue; }
        if (sp) {
          buche(m.id, datum, sp.kommen, 'kommen', m.kst);
          if (sp.pause) { buche(m.id, datum, sp.pause[0], 'pause_start'); buche(m.id, datum, sp.pause[1], 'pause_ende'); }
          if (sp.gehen) buche(m.id, datum, sp.gehen, 'gehen');
          continue;
        }
        const fahrer = m.lg === 'lkw' || m.lg === 'ma';
        const kommen = fahrer && r() < 0.5 ? '06:30' : '07:00';
        if (datum === d(SW_TAG) && m.lg !== 'lkw' && m.kst !== '90-001') {
          buche(m.id, datum, kommen, 'kommen', m.kst);
          buche(m.id, datum, '11:00', 'gehen');
          abwesend(m.id, datum, 'SW');
          continue;
        }
        const fr = wochentag(datum) === 5;
        const x = r();
        const extra = fr ? 0 : x < 0.04 ? 60 : x < 0.18 ? 30 : 0;
        buche(m.id, datum, kommen, 'kommen', m.kst);
        buche(m.id, datum, '12:00', 'pause_start');
        buche(m.id, datum, '12:30', 'pause_ende');
        buche(m.id, datum, hmPlus(kommen, (fr ? 7.5 : 8.5) * 60 + extra), 'gehen');
      }
    }

    /* ---- Heute: Abwesenheiten und laufende Stempelungen (Uhrzeit-abhängig) ---- */
    const heuteAbw = { 3: 'U', 28: 'U', 24: 'K' };
    for (const [id, c] of Object.entries(heuteAbw)) abwesend(Number(id), heute, c);
    const heuteOffen = new Set([29, 16, 27]);
    const minutenJetzt = (() => { const z = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(jetztMin).split(':').map(Number); return z[0] * 60 + z[1]; })();
    if (istArbeitstag(heute)) {
      for (const m of MITARBEITER) {
        if (heuteAbw[m.id] || heuteOffen.has(m.id) || m.kst === '26-041') continue; // Partie Pitten stempelt in der Demo selbst
        const b = BAUSTELLEN.find((x) => x.kst === m.kst);
        if (d(b.start) > heute || d(b.ende) < heute) continue;
        const r = zufall(hash('heute' + m.id));
        const kommen = hmPlus('06:25', Math.floor(r() * 6) * 5);
        const kMin = Number(kommen.slice(0, 2)) * 60 + Number(kommen.slice(3));
        if (minutenJetzt < kMin + 10) continue;
        buche(m.id, heute, kommen, 'kommen', m.kst);
        if (minutenJetzt >= 12 * 60 + 40) { buche(m.id, heute, '12:00', 'pause_start'); buche(m.id, heute, '12:30', 'pause_ende'); }
        const fr = wochentag(heute) === 5;
        const gehen = fr ? '14:30' : '15:30';
        if (minutenJetzt >= (fr ? 15 * 60 : 16 * 60)) buche(m.id, heute, gehen, 'gehen');
      }
    }
    // Urlaubsantrag (offen) für die Demo
    abwesend(2, letzterArbeitstagBis(plusTage(heute, 11)), 'U', 'beantragt');

    /* ---- Fremdleistungen ---- */
    for (const b of BAUSTELLEN) for (const [datum, text, betrag] of b.fremd || []) {
      db.lauf('INSERT INTO fremdleistung (baustelle_id, text, betrag, datum, erstellt_von, erstellt) VALUES (?, ?, ?, ?, 101, ?)', bsId[b.kst], text, betrag, d(datum), jetztIso);
    }

    /* ---- Bautagesberichte ---- */
    const sigCache = new Map();
    const sig = (k) => { if (!sigCache.has(k)) sigCache.set(k, demoUnterschrift(k)); return sigCache.get(k); };
    const namen = new Map([...MITARBEITER, ...BUERO].map((m) => [m.id, m.name]));
    const lg = new Map(MITARBEITER.map((m) => [m.id, m.lg]));
    for (const b of BAUSTELLEN) {
      if (b.intern) continue;
      for (const datum of historie) {
        const personal = personalVorschlag(db, bsId[b.kst], datum, jetzt);
        if (!personal.some((p) => p.stunden > 0)) continue;
        const r = zufall(hash(b.kst + datum));
        const sw = datum === d(SW_TAG);
        const f = sw ? 0.45 : wochentag(datum) === 5 ? 0.8 : 1;
        const pick = (prof, round) => Object.entries(prof).filter(([, [, p]]) => r() < p).map(([k, [q]]) => [k, Math.max(round, Math.round((q * f * (0.8 + r() * 0.4)) / round) * round)]);
        const geraete = pick(b.geraete, 0.5).map(([k, v]) => ({ geraetId: geraetId[k], stunden: Math.min(v, 10) }));
        const material = pick(b.material, 1).map(([k, v]) => ({ materialId: materialId[k], menge: v }));
        for (const p of personal) {
          if (p.stunden > 0 && ['fa', 'hi', 'le'].includes(lg.get(p.benutzerId)) && r() < 0.2) p.segStunden = 2 + Math.floor(r() * 3);
        }
        const segSumme = personal.reduce((a, p) => a + (p.segStunden || 0), 0);
        const t1 = b.texte[Math.floor(r() * b.texte.length)], t2 = b.texte[Math.floor(r() * b.texte.length)];
        const zusatzMat = material.some((m) => m.materialId === materialId.pflaster8);
        const u = {
          personal,
          geraete, material,
          seg: segSumme ? { taetigkeit: geraete.some((g) => g.geraetId === geraetId.schneid) ? 'Staubzulage (Schneidarbeiten)' : 'Schmutzzulage', stunden: segSumme } : { taetigkeit: '', stunden: null },
          regie: r() < 0.14 ? [{ text: 'Zusatzarbeit laut Anweisung Bauleitung (Regie)', stunden: 1 + Math.floor(r() * 3) }] : [],
          arbeitsleistung: sw ? 'Arbeiten wegen Starkregen um 11:00 eingestellt (Schlechtwetter). ' + t1 : t1 === t2 ? t1 : t1 + '\n' + t2,
          vorkommnisse: sw ? 'Schlechtwetter ab 11:00 Uhr, Baustelle gesichert.' : r() < 0.08 ? 'Anweisung AG: Einfahrt bis 15:00 Uhr freihalten.' : '',
          materialbeistellung: { eigen: material.some((m) => m.materialId === materialId.frostschutz) ? 'Frostschutz 0/63 aus Kieswerk Breitenau' : '', fremd: r() < 0.15 ? 'Schachtabdeckung Kl. D 400 – beigestellt vom AG' : '' },
          paletten: { euro: zusatzMat && r() < 0.5 ? 2 + Math.floor(r() * 6) : 0, weissenboeck: zusatzMat && r() < 0.6 ? 2 + Math.floor(r() * 8) : 0 },
          wetter: sw ? 'Regen, 6 °C' : `${['sonnig', 'bewölkt', 'bewölkt', 'heiter'][Math.floor(r() * 4)]}, ${Math.round(4 + r() * 10)} °C`
        };
        const alter = tageZwischen(datum, heute);
        let status = alter >= 4 ? 'freigegeben' : 'unterschrieben';
        if (alter === 1 && (b.kst === '26-047' || b.kst === '26-029')) status = 'entwurf';
        const erstellt = iso(datum, '16:00');
        const id = db.lauf('INSERT INTO bericht (baustelle_id, datum, status, erstellt_von, erstellt, geaendert) VALUES (?, ?, ?, ?, ?, ?)', bsId[b.kst], datum, 'entwurf', b.polier || 101, erstellt, erstellt).id;
        speichereUpdate(db, id, u, erstellt);
        if (status !== 'entwurf') {
          db.lauf('INSERT INTO unterschrift (bericht_id, rolle, name, zeit, bild_png, erfasst_von) VALUES (?, ?, ?, ?, ?, ?)', id, 'an', namen.get(b.polier) || 'Bauleitung', iso(datum, '16:05'), sig('an' + b.kst), b.polier);
          db.lauf('INSERT INTO unterschrift (bericht_id, rolle, name, zeit, bild_png, erfasst_von) VALUES (?, ?, ?, ?, ?, ?)', id, 'bh', b.vertreter || 'Auftraggeber', iso(datum, '16:07'), sig('bh' + b.kst), b.polier);
          db.lauf('UPDATE bericht SET status = ? WHERE id = ?', 'unterschrieben', id);
        }
        if (status === 'freigegeben') {
          const zeit = iso(plusTage(datum, 1), '08:15');
          db.lauf("UPDATE bericht SET status = 'freigegeben', freigegeben_von = ?, freigegeben_zeit = ?, geaendert = ? WHERE id = ?", b.bauleiter, zeit, zeit, id);
        }
      }
    }

    /* ---- Nachkalkulation nach Positionen: Katalog kopieren, manuelle Mengen (Rechnungen, Maut, Abgaben) ---- */
    katalogAnlegen(db, jetzt);
    const posId = (bs, bez, eh) => (db.eins('SELECT id FROM projektposition WHERE baustelle_id = ? AND bezeichnung = ? AND einheit = ?', bs, bez, eh) || {}).id;
    for (const b of BAUSTELLEN) {
      const id = bsId[b.kst];
      katalogKopieren(db, id, jetzt);
      if (b.intern) continue;
      const r = zufall(hash('pos' + b.kst));
      const tage = historie.filter((x) => x >= d(b.start));
      const eintrag = (bez, eh, menge, notiz, datum) => {
        const pid = posId(id, bez, eh);
        if (pid && menge > 0) db.lauf('INSERT INTO projektposition_menge (position_id, datum, menge, notiz, erstellt, erstellt_von) VALUES (?, ?, ?, ?, ?, 101)', pid, datum, Math.round(menge * 100) / 100, notiz, jetztIso);
      };
      for (const [i, tag] of tage.entries()) if (i % 5 === 4) eintrag('Maut', 'VE', 40 + Math.round(r() * 80), 'Maut-Abrechnung Woche', tag);
      if (tage.length) {
        // Landschaftsabgabe: automatisch aus den Tonnen Naturmaterial (API.md 10a)
        eintrag('Lagerhaus', 'PA', 250 + Math.round(r() * 500), 'Lagerhaus-Rechnung Kleinmaterial', tage[Math.floor(tage.length / 2)]);
      }
    }

    /* ---- Auftragssumme, Nachträge, Leistungsmeldungen (kalibriert auf Zielwerte der Nachkalkulation) ---- */
    for (const b of BAUSTELLEN) {
      if (b.intern) continue;
      const id = bsId[b.kst];
      const k = kalkulationFuer(db, ladeBaustelle(db, id));
      const [zielVerbrauch, zielLeistung] = b.ziel;
      const nachtragSumme = (b.nachtraege || []).reduce((a, [, x]) => a + x, 0);
      const basis = Math.max(5000, Math.round(k.positionen.gesamtsumme / zielVerbrauch / 100) * 100);
      db.lauf('UPDATE baustelle SET auftragssumme = ? WHERE id = ?', basis - nachtragSumme, id);
      for (const [text, betrag] of b.nachtraege || []) db.lauf('INSERT INTO nachtrag (baustelle_id, text, betrag, erstellt, erstellt_von) VALUES (?, ?, ?, ?, 101)', id, text, betrag, jetztIso);
      const erloesZiel = basis * zielLeistung;
      const summeAnteile = Object.values(b.pos).reduce((a, x) => a + x, 0);
      const meldeTage = historie.filter((x) => x >= d(b.start));
      const tage = [meldeTage[Math.floor(meldeTage.length / 3)], meldeTage[Math.floor((2 * meldeTage.length) / 3)], meldeTage[meldeTage.length - 1]].filter(Boolean);
      for (const [key, anteil] of Object.entries(b.pos)) {
        const menge = (erloesZiel * (anteil / summeAnteile)) / leistungEp[key];
        const teile = key === 'be' ? [menge] : [menge * 0.3, menge * 0.35, menge * 0.35];
        teile.forEach((mg, i) => {
          const m2 = Math.round(mg * 100) / 100;
          if (m2 > 0) db.lauf('INSERT INTO leistungsmeldung (baustelle_id, leistung_id, menge, datum, erstellt_von, erstellt) VALUES (?, ?, ?, ?, ?, ?)', id, leistungId[key], m2, tage[Math.min(i, tage.length - 1)] || heute, b.bauleiter, jetztIso);
        });
      }
    }
  });

  // Budget-Alarme für den Ausgangsstand auslösen (an Bauleiter/Büro/GF)
  pruefeAlleBudgets({ db, uhr: () => jetzt }, { anlass: 'Einspielen der Testdaten' });
  return { heute, historieTage: historie.length };
}

/* ---------------- CLI: npm run seed ---------------- */
if (require.main === module) {
  if (process.env.BAUTAG_DEMO !== '1') {
    console.error('Testdaten werden nur im Demo-Modus eingespielt: BAUTAG_DEMO=1 npm run seed');
    console.error('Für den Echtbetrieb stattdessen: node server/einrichten.js (leere Datenbank mit erster Geschäftsführung).');
    process.exit(1);
  }
  const dbPfad = process.env.BAUTAG_DB || path.join(__dirname, '..', 'data', 'bautag.db');
  if (dbPfad !== ':memory:') {
    for (const f of [dbPfad, dbPfad + '-wal', dbPfad + '-shm']) { try { fs.unlinkSync(f); } catch (_) { /* nicht vorhanden */ } }
  }
  const db = oeffneDatenbank(dbPfad);
  const uhr = erzeugeUhr(process.env.BAUTAG_UHR);
  const t0 = Date.now();
  const demo = true;
  const r = seed(db, { uhr: uhr(), demo });
  const zahl = (t) => db.eins(`SELECT COUNT(*) AS n FROM ${t}`).n;
  console.log(`BauTag-Testdaten eingespielt in ${dbPfad} (${Date.now() - t0} ms)`);
  console.log(`  heute: ${r.heute}, Historie: ${r.historieTage} Arbeitstage`);
  console.log(`  Benutzer: ${zahl('benutzer')}, Baustellen: ${zahl('baustelle')}, Buchungen: ${zahl('buchung')}, Berichte: ${zahl('bericht')}, Benachrichtigungen: ${zahl('benachrichtigung')}`);
  console.log('  DEMO-Modus (BAUTAG_DEMO=1): PIN 1234 für alle, keine Änderungspflicht – nur zur Vorführung, nie im Echtbetrieb!');
  db.schliessen();
}

module.exports = { seed, DEMO_PIN, LOHNGRUPPEN, GERAETE, MATERIAL };
