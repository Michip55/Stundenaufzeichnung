'use strict';
/**
 * Plan-Vorlagen des Servicebuchs (SERVICEBUCH_ENTWURF.md 9). Alle Werte beruhen auf Recherche und sind
 * mit „Prüfen“ gekennzeichnet (pruefen:true) – vom Büro änderbar.
 */
const KFG = 'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10011384';
const AMVO = null; // Quelle: AM-VO im RIS (Link vom Büro nachtragen)
const TACHO = 'https://eur-lex.europa.eu/eli/reg/2014/165/oj';

const V = (schluessel, titel, art, klassen, regel, rechtsgrundlage, quelleUrl = null, extra = {}) => ({ schluessel, titel, art, klassen, regel, rechtsgrundlage, quelleUrl, pruefen: true, gueltigAb: null, aktiv: true, ...extra });
const SCHWER = ['lkw:N2', 'lkw:N3', 'bus:M2', 'bus:M3'];

const VORLAGEN = [
  V('57a_m1', '§57a-Begutachtung (Pickerl)', 'gesetzlich', ['pkw:M1', 'bus:M1', 'bus:N1', 'anhaenger:O1', 'anhaenger:O2', 'lkw:N1'],
    { folgeMonate: [36, 24, 12], monatsgenau: true, toleranzVorMonate: 1, toleranzNachMonate: 4, sperrtBeiUeberfaellig: true },
    '§ 57a KFG, derzeitige Regel (Einstufung N1 prüfen)', KFG),
  V('57a_m1_2027', '§57a-Begutachtung ab 19.05.2027', 'gesetzlich', ['pkw:M1', 'bus:M1'],
    { folgeMonate: [48, 24, 24, 24, 12], monatsgenau: true, toleranzVorMonate: 4, toleranzNachMonate: 0, sperrtBeiUeberfaellig: true },
    '42. KFG-Novelle, BGBl. I 79/2026 – nach Prüfung mit „Vorlage anwenden“ aktivieren', KFG, { aktiv: false, gueltigAb: '2027-05-19' }),
  V('57a_jaehrlich', '§57a-Begutachtung jährlich', 'gesetzlich', [...SCHWER, 'anhaenger:O3', 'anhaenger:O4'],
    { folgeMonate: [12], monatsgenau: true, toleranzVorMonate: 3, toleranzNachMonate: 0, sperrtBeiUeberfaellig: true },
    '§ 57a KFG; Toleranz laut Quellen nur vorher', KFG),
  V('tacho_nachpruefung', 'Fahrtenschreiber-Nachprüfung', 'gesetzlich', SCHWER, { intervallMonate: 24, toleranzNachTage: 0 }, 'Art. 23 VO (EU) 165/2014', TACHO),
  V('tacho_massenspeicher', 'Massenspeicher auslesen', 'gesetzlich', SCHWER, { intervallTage: 90, toleranzNachTage: 0 }, '90 Tage bzw. 3 Monate (WKO)'),
  V('kran_amvo', 'Kranprüfung (Ladekran)', 'gesetzlich', ['lkw+kran'], { intervallMonate: 12, toleranzNachMonate: 3, sperrtBeiUeberfaellig: true },
    '§ 8 AM-VO: jährlich, längstens 15 Monate; Prüfbefund § 11', AMVO),
  V('hebezeug_amvo', 'Prüfung Hebezeugbetrieb (Bagger/Radlader)', 'gesetzlich', ['baumaschine'], { intervallMonate: 12, toleranzNachMonate: 3, sperrtBeiUeberfaellig: true },
    '§ 8 AM-VO; nur anlegen, wenn Einzellasten gehoben werden; extern mind. alle 4 Jahre bei interner Prüfung (WKO)', AMVO, { empfohlen: false }),
  V('winter_lkw', 'Winterausrüstung (Reifen, Ketten)', 'gesetzlich', ['lkw:N2', 'lkw:N3'], { jaehrlichAm: '10-31', vorlaufTage: 30 }, '§ 102 KFG: 1.11.–15.4.', KFG),
  V('verbandkasten', 'Verbandkasten prüfen', 'intern', ['pkw', 'bus', 'lkw'], { intervallMonate: 12 }, '§ 102 KFG; kein Ablaufdatum', KFG),
  V('feuerloescher', 'Feuerlöscher überprüfen', 'intern', ['lkw', 'baumaschine', 'brecher'], { intervallMonate: 24 }, 'ÖNORM F 1053 (Praxis)'),
  V('cat_250', 'Service 250 Std.', 'hersteller', ['baumaschine', 'walze'], { intervallStunden: 250 }, 'Herstellerplan (Cat PM1); an Serviceheft anpassen'),
  V('cat_500', 'Service 500 Std.', 'hersteller', ['baumaschine', 'walze'], { intervallStunden: 500, intervallMonate: 12, schliesstEin: ['cat_250'] }, 'Herstellerplan (Cat PM2); an Serviceheft anpassen'),
  V('cat_1000', 'Service 1.000 Std.', 'hersteller', ['baumaschine', 'walze'], { intervallStunden: 1000, schliesstEin: ['cat_250', 'cat_500'] }, 'Herstellerplan (Cat PM3); an Serviceheft anpassen'),
  V('cat_2000', 'Service 2.000 Std.', 'hersteller', ['baumaschine', 'walze'], { intervallStunden: 2000, schliesstEin: ['cat_250', 'cat_500', 'cat_1000'] }, 'Herstellerplan (Cat PM4); an Serviceheft anpassen'),
  V('service_lkw', 'Service laut Serviceheft', 'hersteller', ['lkw'], { intervallMonate: 12, intervallKm: 60000 }, 'an Serviceheft anpassen'),
  V('service_pkw', 'Service laut Serviceheft', 'hersteller', ['pkw', 'bus'], { intervallMonate: 12, intervallKm: 30000 }, 'an Serviceheft anpassen'),
  V('service_brecher', 'Service Brecher', 'hersteller', ['brecher'], { intervallStunden: 250, zaehlerArtStunden: 'brecher' }, 'Herstellerangabe prüfen'),
  V('service_klein', 'Jahresservice Kleingerät', 'hersteller', ['kleingeraet'], { intervallMonate: 12 }, null),
  V('vertrag_leasing', 'Leasing-/Mietende', 'vertrag', ['alle'], { datumAus: 'vertragsende', vorlaufTage: 90 }, null),
  V('vertrag_versicherung', 'Versicherung Hauptfälligkeit', 'vertrag', ['pkw', 'bus', 'lkw', 'anhaenger'], { stichtagJeAnlage: true, vorlaufTage: 90 }, null)
];

/** Vorlagen anlegen, die es noch nicht gibt (einmalig je Vorlagenstand; spätere Änderungen des Büros bleiben). */
function vorlagenAnlegen(db) {
  const STAND = 'servicebuch-2026-11-13';
  if (db.einstellung('fuhrpark_vorlagen', null) === STAND) return 0;
  let n = 0;
  db.transaktion(() => {
    for (const v of VORLAGEN) {
      const r = db.lauf(`INSERT OR IGNORE INTO plan_vorlage (schluessel, titel, art, klassen, regel, rechtsgrundlage, quelle_url, pruefen, gueltig_ab, aktiv)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`, v.schluessel, v.titel, v.art, JSON.stringify(v.klassen), JSON.stringify(v.regel), v.rechtsgrundlage, v.quelleUrl, v.gueltigAb, v.aktiv ? 1 : 0);
      n += r.changes;
    }
    db.setzeEinstellung('fuhrpark_vorlagen', STAND);
  });
  return n;
}

/** Passt eine Vorlage zur Anlage? klassen-Einträge: "lkw", "lkw:N3", "lkw+kran", "alle" */
function vorlagePasst(klassen, anlage, zaehlerArten = []) {
  return klassen.some((k) => {
    if (k === 'alle') return true;
    if (k.includes('+')) { const [kl, z] = k.split('+'); return kl === anlage.klasse && zaehlerArten.includes(z); }
    if (k.includes(':')) { const [kl, fz] = k.split(':'); return kl === anlage.klasse && (anlage.fahrzeugklasse || '').toUpperCase() === fz.toUpperCase(); }
    return k === anlage.klasse;
  });
}

const EMPFOHLEN = new Map(VORLAGEN.map((v) => [v.schluessel, v.empfohlen !== false]));

module.exports = { VORLAGEN, vorlagenAnlegen, vorlagePasst, EMPFOHLEN };
