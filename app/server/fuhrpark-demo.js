'use strict';
/**
 * Demo-Fuhrpark (SERVICEBUCH_ENTWURF.md 10) – nur mit BAUTAG_DEMO=1 bzw. Seed im Demo-Modus.
 * Alle Kennzeichen, FIN und Seriennummern sind FIKTIV. Datumswerte relativ zu „heute“, damit die Vorführung
 * immer alle Zustände zeigt (ok, bald, fällig, überfällig/gesperrt, Mangel „sofort“).
 */
const { plusTage, wienDatum } = require('./datum');
const { plusMonate, monatPlus, monat } = require('./fuhrpark');
const { vorlagenAnlegen } = require('./fuhrpark-vorlagen');
const { zufall, hash } = require('./png');

const LKW_FAHRER = [7, 12, 18, 28, 29];
const MASCHINISTEN = [4, 10, 20, 26, 30];
const WERKSTATT_POLIER = 25; // Gerhard Wallner: Recht fuhrpark per Ausnahme (zeigt die €-Sperre)

// [nr, bezeichnung, klasse, fzkl, geraet, kennzeichen, ez:[jahr, monatsVersatz]|null, baujahr, zaehler:[[art, wert, schnittProWoche, ausBericht]], hersteller, typ]
const ANLAGEN = [
  ['A01', 'LKW 3-Achser MAN TGS 26.400 Kipper', 'lkw', 'N3', 'lkw3', 'NK-301 BP', [2018, 5], 2018, [['km', 412300, 900]], 'MAN', 'TGS 26.400'],
  ['A02', 'LKW 3-Achser mit Kran MAN TGS 26.440 + Ladekran', 'lkw', 'N3', 'kran3', 'NK-302 BP', [2020, 1], 2020, [['km', 268900, 700], ['kran', 3410, 6]], 'MAN', 'TGS 26.440'],
  ['A03', 'LKW 4-Achser Scania R 450 Kipper', 'lkw', 'N3', 'lkw4', 'NK-303 BP', [2021, -1], 2021, [['km', 301200, 800]], 'Scania', 'R 450'],
  ['A04', 'LKW 4-Achser Mulde und Kran Volvo FMX 460', 'lkw', 'N3', 'kran4', 'NK-304 BP', [2017, 7], 2017, [['km', 521700, 650], ['kran', 5120, 5]], 'Volvo', 'FMX 460'],
  ['A05', 'Sattelzugmaschine Mercedes Actros 1848', 'lkw', 'N3', 'sattel', 'NK-305 BP', [2022, 3], 2022, [['km', 389000, 1400]], 'Mercedes-Benz', 'Actros 1848'],
  ['A06', 'Kippsattel Schwarzmüller 3-Achs', 'anhaenger', 'O4', null, 'NK-306 BP', [2022, 3], 2022, [], 'Schwarzmüller', 'Kippsattel'],
  ['A07', 'Zugmaschine MAN TGX 26.510 (Tieflader)', 'lkw', 'N3', 'tieflader', 'NK-307 BP', [2016, 9], 2016, [['km', 604300, 500]], 'MAN', 'TGX 26.510'],
  ['A08', 'Tieflader-Anhänger Goldhofer 3-Achs', 'anhaenger', 'O4', null, 'NK-308 BP', [2016, 9], 2016, [], 'Goldhofer', 'STZ-L3'],
  ['A09', 'LKW 2-Achser MAN TGL 12.250 Pritsche', 'lkw', 'N2', 'lkw2', 'NK-309 BP', [2019, 4], 2019, [['km', 187400, 450]], 'MAN', 'TGL 12.250'],
  ['A10', 'Mannschaftsbus VW Crafter 9-Sitzer', 'bus', 'M1', null, 'NK-311 BP', 'erst', 2023, [['km', 98600, 600]], 'Volkswagen', 'Crafter'],
  ['A11', 'Pritschenbus Ford Transit Doppelkabine', 'bus', 'N1', null, 'NK-312 BP', [2021, 6], 2021, [['km', 143900, 700]], 'Ford', 'Transit'],
  ['A12', 'PKW Škoda Octavia Combi', 'pkw', 'M1', null, 'NK-321 BP', [2024, 4], 2024, [['km', 61200, 450]], 'Škoda', 'Octavia Combi'],
  ['A13', 'PKW Dacia Duster', 'pkw', 'M1', null, 'NK-322 BP', [2020, -2], 2020, [['km', 118000, 350]], 'Dacia', 'Duster'],
  ['A14', 'PKW-Anhänger Humbaur Kipper 2,7 t', 'anhaenger', 'O2', null, 'NK-331 BP', [2019, 10], 2019, [], 'Humbaur', 'HTK 2700'],
  ['A15', 'Minibagger Cat 301.8 (1,8 t)', 'baumaschine', null, 'b15', null, null, 2020, [['bh', 3120, 10, true]], 'Caterpillar', '301.8'],
  ['A16', 'Minibagger Takeuchi TB230 (3,0 t)', 'baumaschine', null, 'b27', null, null, 2021, [['bh', 2870, 14, true]], 'Takeuchi', 'TB230'],
  ['A17', 'Mobilbagger Liebherr A 910 Compact (7–11 t)', 'baumaschine', null, 'b9', 'NK-341 BP', null, 2019, [['bh', 6410, 24, true]], 'Liebherr', 'A 910 Compact'],
  ['A18', 'Kettenbagger CAT 320 (23,0 t)', 'baumaschine', null, 'b23', null, null, 2022, [['bh', 4180, 22, true]], 'Caterpillar', '320'],
  ['A19', 'Minilader CASE SR160 (3,5 t)', 'baumaschine', null, 'bobcat', null, null, 2020, [['bh', 2240, 8, true]], 'CASE', 'SR160'],
  ['A20', 'Radlader CASE 721G (2,5 m³)', 'baumaschine', null, 'radlader', 'NK-342 BP', null, 2018, [['bh', 8950, 15, true]], 'CASE', '721G'],
  ['A21', 'Radlader CAT 950M (3,5 m³)', 'baumaschine', null, 'radlader', 'NK-343 BP', null, 2021, [['bh', 5300, 15, true]], 'Caterpillar', '950M'],
  ['A22', 'Walze HAMM HD 12 VV (3,0 t)', 'walze', null, 'hamm', null, null, 2019, [['bh', 1880, 6, true]], 'HAMM', 'HD 12 VV'],
  ['A23', 'Walze BOMAG BW 177 D-5 (7,0 t)', 'walze', null, 'bomag', null, null, 2017, [['bh', 4420, 12, true]], 'BOMAG', 'BW 177 D-5'],
  ['A24', 'Mobilbrecher Rubble Master RM 100GO!', 'brecher', null, null, null, null, 2020, [['brecher', 3650, 15]], 'Rubble Master', 'RM 100GO!'],
  ['A25', 'Rüttelplatte Wacker DPU 6555', 'kleingeraet', null, 'ruettel', null, null, 2019, [['bh', 1210, 5, true]], 'Wacker Neuson', 'DPU 6555'],
  ['A26', 'Rüttelplatte Bomag BPR 35/60', 'kleingeraet', null, 'ruettel', null, null, 2022, [['bh', 640, 4, true]], 'BOMAG', 'BPR 35/60'],
  ['A27', 'Grabenwalze Bomag BMP 8500', 'kleingeraet', null, 'grabenwalze', null, null, 2018, [['bh', 980, 4, true]], 'BOMAG', 'BMP 8500'],
  ['A28', 'Schneidgerät Stihl TS 800', 'kleingeraet', null, 'schneid', null, null, 2023, [], 'Stihl', 'TS 800'],
  ['A29', 'Kompressor Kaeser M 31', 'kleingeraet', null, 'kompressor', null, null, 2016, [['bh', 2050, 4, true]], 'Kaeser', 'M 31'],
  ['A30', 'Dumper Wacker DW 30', 'kleingeraet', null, 'dumper', null, null, 2019, [['bh', 1640, 6, true]], 'Wacker Neuson', 'DW 30'],
  ['A31', 'Verlegemaschine Optimas S10', 'kleingeraet', null, 'verlege', null, null, 2017, [['bh', 2980, 6, true]], 'Optimas', 'S10'],
  ['A32', 'Handwalze Bomag BW 55 E', 'kleingeraet', null, 'handwalze', null, null, 2020, [], 'BOMAG', 'BW 55 E']
];

/**
 * @param {import('./db').Datenbank} db  (innerhalb der Seed-Transaktion, nach den Berichten)
 * @param {Date} jetzt
 */
function seedFuhrpark(db, jetzt) {
  vorlagenAnlegen(db);
  const H = wienDatum(jetzt);
  const t0 = jetzt.toISOString();
  const M = monat(H);
  const geraet = new Map(db.alle('SELECT id, code FROM geraet').map((g) => [g.code, g.id]));
  const vorlage = new Map(db.alle('SELECT id, schluessel, titel, art, regel FROM plan_vorlage').map((v) => [v.schluessel, v]));
  /** Erstzulassung „Jahr, Monat M+n“ (bezogen auf den Prototyp-Monat 2026-11, verschoben auf H) */
  const ez = ([jahr, off]) => {
    const m = ((((10 + off) % 12) + 12) % 12) + 1;
    return `${monatPlus(M, (jahr - 2026) * 12 + (m - 11))}-10`;
  };
  const vor = (monate, tag = 15) => `${monatPlus(M, -monate)}-${String(tag).padStart(2, '0')}`;
  const r = zufall(hash('fuhrpark-demo'));
  let lkw = 0, masch = 0;
  const ids = {};
  const zid = {};
  const aktuell = {};

  for (const [nr, bez, klasse, fzkl, gcode, kz, ezDef, bj, zaehler, hersteller, typ] of ANLAGEN) {
    const erst = ezDef === 'erst' ? `${monatPlus(M, 1 - 36)}-10` : ezDef ? ez(ezDef) : null;
    const istFz = ['lkw', 'bus', 'pkw'].includes(klasse);
    const verantwortlich = klasse === 'lkw' ? LKW_FAHRER[lkw++ % LKW_FAHRER.length] : zaehler.some((z) => z[0] === 'bh') && ['baumaschine', 'walze'].includes(klasse) ? MASCHINISTEN[masch++ % MASCHINISTEN.length] : null;
    const fin = istFz || klasse === 'anhaenger' ? `DEMO${nr}FIN${String(1000 + Number(nr.slice(1)) * 37).padStart(6, '0')}` : `SN-DEMO-${nr}-${2000 + Number(nr.slice(1))}`;
    const id = db.lauf(`INSERT INTO anlage (nummer, bezeichnung, klasse, fahrzeugklasse, hersteller, typ, kennzeichen, fin, baujahr, erstzulassung, hzg_kg, eigentum, vertragsende,
        versicherung, geraet_id, verantwortlich_id, standort_text, standort_datum, notiz, erstellt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    nr, bez, klasse, fzkl, hersteller, typ, kz, fin, bj, erst, klasse === 'lkw' ? (fzkl === 'N2' ? 12000 : 26000) : klasse === 'anhaenger' ? (fzkl === 'O2' ? 2700 : 39000) : null,
    nr === 'A12' ? 'leasing' : 'eigen', nr === 'A12' ? plusMonate(H, 5) : null, istFz || klasse === 'anhaenger' ? 'Muster Versicherung AG (fiktiv)' : null,
    gcode ? geraet.get(gcode) || null : null, verantwortlich, 'Bauhof Breitenau', plusTage(H, -120), 'Demo-Daten (fiktiv)', t0).id;
    ids[nr] = id;
    // Zähler: Start H−120, 3–6 Ablesungen im Abstand 1–3 Wochen, letzte H−3…10
    for (const [art, ziel, schnitt, ausBericht] of zaehler) {
      const start = plusTage(H, -120);
      const z = db.lauf('INSERT INTO zaehler (anlage_id, art, startstand, startdatum, versatz, aus_bericht, aktiv) VALUES (?, ?, ?, ?, 0, ?, 1)', id, art, 0, start, ausBericht ? 1 : 0).id;
      zid[`${nr}:${art}`] = z;
      // Gerätestunden aus Berichten nach der letzten Ablesung werden geschätzt dazugezählt
      const letzte = plusTage(H, -(3 + Math.floor(r() * 8)));
      let nachher = 0;
      if (ausBericht && gcode) {
        const zeilen = db.alle(`SELECT bg.stunden FROM bericht_geraet bg JOIN bericht b ON b.id = bg.bericht_id
          WHERE bg.geraet_id = ? AND b.status IN ('unterschrieben','freigegeben') AND b.datum > ? AND b.datum <= ? AND (bg.anlage_id IS NULL OR bg.anlage_id = ?)`, geraet.get(gcode), letzte, H, id);
        nachher = gcode === 'radlader' || gcode === 'ruettel' ? 0 : zeilen.reduce((a, x) => a + x.stunden, 0);
      }
      const wertLetzte = Math.round(ziel - nachher);
      const daten = [letzte];
      let d = letzte;
      const n = 3 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) { d = plusTage(d, -(7 + Math.floor(r() * 15))); if (d <= plusTage(start, 3)) break; daten.unshift(d); }
      const proTag = schnitt / 7;
      const werte = new Map([[letzte, wertLetzte]]);
      let w = wertLetzte;
      for (let i = daten.length - 1; i > 0; i--) { w -= (proTag * (0.85 + r() * 0.3)) * (Date.parse(daten[i]) - Date.parse(daten[i - 1])) / 86400000; werte.set(daten[i - 1], Math.round(w)); }
      const startstand = Math.max(0, Math.round(w - proTag * (Date.parse(daten[0]) - Date.parse(start)) / 86400000));
      db.lauf('UPDATE zaehler SET startstand = ? WHERE id = ?', startstand, z);
      db.lauf("INSERT INTO zaehlerstand (zaehler_id, datum, anzeige, wert, quelle, status, erfasst, erfasst_von) VALUES (?, ?, ?, ?, 'start', 'gueltig', ?, 101)", z, start, startstand, startstand, t0);
      for (const dd of daten) {
        const x = werte.get(dd);
        db.lauf("INSERT INTO zaehlerstand (zaehler_id, datum, anzeige, wert, quelle, status, erfasst, erfasst_von) VALUES (?, ?, ?, ?, 'manuell', 'gueltig', ?, ?)", z, dd, x, x, t0, verantwortlich || 101);
      }
      aktuell[`${nr}:${art}`] = ziel;
    }
  }

  // Gerätestunden der Radlader und Rüttelplatten teils zuordnen (Rest „nicht zugeordnet“)
  const zuordnen = (code, anlagen) => {
    db.alle('SELECT bg.bericht_id FROM bericht_geraet bg JOIN bericht b ON b.id = bg.bericht_id WHERE bg.geraet_id = ? ORDER BY b.datum, b.id', geraet.get(code))
      .forEach((z, i) => { const a = anlagen[i % anlagen.length]; if (a) db.lauf('UPDATE bericht_geraet SET anlage_id = ? WHERE bericht_id = ? AND geraet_id = ?', ids[a], z.bericht_id, geraet.get(code)); });
  };
  zuordnen('radlader', ['A20', 'A21', null]);
  zuordnen('ruettel', ['A25', 'A26']);

  // Planpositionen: [anlage, vorlage, letzteDatum, letzteZaehler|null, regelErgaenzung]
  const lz = (nr, art, minus) => ({ [art]: Math.round(aktuell[`${nr}:${art}`] - minus) });
  const P = [];
  const jaehrlich57a = (nr, ezDef, lzt) => { const m = ((((10 + ezDef[1]) % 12) + 12) % 12) + 1; const monatsDiff = ((m - 11 + 12) % 12) || 12; P.push([nr, '57a_jaehrlich', lzt || vor(12 - monatsDiff), null]); };
  jaehrlich57a('A01', [2018, 5]); P.push(['A01', 'service_lkw', vor(5), lz('A01', 'km', 20000)], ['A01', 'tacho_nachpruefung', vor(22), null], ['A01', 'tacho_massenspeicher', plusTage(H, -80), null], ['A01', 'winter_lkw', `${Number(H.slice(0, 4)) - (H.slice(5, 7) >= '11' ? 1 : 2)}-10-20`, null]);
  jaehrlich57a('A02', [2020, 1]); P.push(['A02', 'kran_amvo', vor(13, 2), null]);
  P.push(['A03', '57a_jaehrlich', vor(13, 8), null], ['A03', 'service_lkw', vor(4), lz('A03', 'km', 15000)]);
  P.push(['A04', 'kran_amvo', vor(4), null], ['A04', 'service_lkw', vor(6), lz('A04', 'km', 22000)]);
  jaehrlich57a('A04', [2017, 7]);
  jaehrlich57a('A05', [2022, 3]); P.push(['A05', 'tacho_massenspeicher', plusTage(H, -40), null]);
  jaehrlich57a('A06', [2022, 3]);
  jaehrlich57a('A07', [2016, 9]); jaehrlich57a('A08', [2016, 9]); jaehrlich57a('A09', [2019, 4]); P.push(['A09', 'service_lkw', vor(3), lz('A09', 'km', 9000)]);
  P.push(['A10', '57a_m1', null, null], ['A10', 'service_pkw', vor(4), lz('A10', 'km', 10000)]);
  P.push(['A11', '57a_m1', vor(6), null], ['A11', 'service_pkw', vor(7), lz('A11', 'km', 28500)]);
  P.push(['A12', '57a_m1', null, null], ['A12', 'vertrag_leasing', null, null]);
  P.push(['A13', '57a_m1', vor(14), null], ['A13', 'service_pkw', vor(5), lz('A13', 'km', 6000)]);
  P.push(['A14', '57a_m1', vor(2), null]);
  P.push(['A15', 'cat_250', vor(2), lz('A15', 'bh', 100)], ['A15', 'cat_500', vor(2), lz('A15', 'bh', 100)], ['A15', 'cat_1000', vor(6), lz('A15', 'bh', 300)]);
  P.push(['A16', 'cat_250', vor(4), lz('A16', 'bh', 220)]);
  P.push(['A17', 'cat_500', vor(2), lz('A17', 'bh', 200)], ['A17', 'cat_1000', vor(5), lz('A17', 'bh', 400)], ['A17', 'hebezeug_amvo', vor(10), null]);
  P.push(['A18', 'cat_500', vor(3), { bh: 4000 }]);
  P.push(['A19', 'cat_500', vor(3), lz('A19', 'bh', 120)]);
  P.push(['A20', 'cat_1000', vor(8), lz('A20', 'bh', 1020)], ['A20', 'cat_500', vor(2), lz('A20', 'bh', 120)]);
  P.push(['A21', 'cat_500', vor(2), lz('A21', 'bh', 150)]);
  P.push(['A22', 'cat_500', vor(3), lz('A22', 'bh', 100)]);
  P.push(['A23', 'cat_500', vor(5), lz('A23', 'bh', 460)]);
  P.push(['A24', 'service_brecher', vor(2), lz('A24', 'brecher', 100)]);
  P.push(['A25', 'service_klein', vor(4), null], ['A26', 'service_klein', vor(9), null], ['A27', 'service_klein', vor(5), null]);
  P.push(['A28', 'service_klein', plusTage(plusMonate(H, -12), -5), null]);
  P.push(['A29', 'service_klein', vor(3), null], ['A30', 'service_klein', vor(7), null], ['A31', 'cat_500', vor(4), lz('A31', 'bh', 90)], ['A32', 'service_klein', vor(6), null]);

  const pos = {};
  for (const [nr, schl, letzte, lzt] of P) {
    const vo = vorlage.get(schl);
    const regel = JSON.parse(vo.regel);
    if (regel.datumAus) { delete regel.datumAus; regel.einmaligAm = plusMonate(H, 5); }
    const lzJ = lzt ? JSON.stringify(lzt) : null;
    pos[`${nr}:${schl}`] = db.lauf(`INSERT INTO planposition (anlage_id, vorlage_id, titel, art, regel, letzte_datum, letzte_zaehler, start_datum, start_zaehler, aktiv, bezug_datum)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`, ids[nr], vo.id, vo.titel, vo.art, JSON.stringify(regel), letzte, lzJ, letzte, lzJ, plusTage(H, -120)).id;
  }

  // Servicebuch-Einträge: je Anlage 1–4 der letzten 18 Monate (Altbestand ohne Zählerstand-Zeilen, Werte aus den Papieren)
  let rnr = 101;
  const eintrag = (nr, art, datum, titel, werkstatt, kosten, extra = {}) => {
    const e = db.lauf(`INSERT INTO servicebuch_eintrag (anlage_id, art, datum, werkstatt, titel, arbeiten, teile, arbeitsstunden_intern, kosten, rechnung_nr, pruef_ergebnis, pruefer, erfasst, erfasst_von)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 101)`, ids[nr], art, datum, werkstatt, titel, extra.arbeiten || null, extra.teile || null, extra.stunden ?? null, kosten,
    werkstatt === 'intern' ? null : `RE-26-0${rnr++}`, extra.pruef || null, extra.pruefer || null, t0).id;
    return e;
  };
  for (const [schlNr, id] of Object.entries(pos)) {
    const [nr, schl] = schlNr.split(':');
    const p = db.eins('SELECT * FROM planposition WHERE id = ?', id);
    if (!p.letzte_datum || p.letzte_datum < plusTage(H, -548)) continue;
    const pruefung = schl.startsWith('57a') || schl.endsWith('amvo') || schl.startsWith('tacho_nach');
    const kosten = Math.round((80 + r() * (pruefung ? 300 : schl.startsWith('cat_1000') ? 6400 : 1800)) * 100) / 100;
    const werkstatt = schl.startsWith('57a') ? 'Prüfstelle Kfz-Muster (fiktiv)' : schl.endsWith('amvo') ? 'Prüftechnik Muster GmbH' : schl.startsWith('service_klein') || schl === 'tacho_massenspeicher' || schl === 'winter_lkw' ? 'intern' : 'Fachwerkstatt Muster (fiktiv)';
    const e = eintrag(nr, pruefung ? 'pruefung' : schl === 'winter_lkw' ? 'reifen' : 'service', p.letzte_datum, p.titel, werkstatt, schl === 'tacho_massenspeicher' ? null : kosten, {
      arbeiten: pruefung ? 'Wiederkehrende Prüfung durchgeführt' : schl === 'tacho_massenspeicher' ? 'Massenspeicher und Fahrerkarten ausgelesen, archiviert' : 'Service laut Serviceheft, Öl und Filter gewechselt',
      pruef: pruefung ? (r() < 0.25 ? 'leichte_maengel' : 'ohne_maengel') : null, pruefer: pruefung ? werkstatt : null, stunden: werkstatt === 'intern' ? 1.5 : null
    });
    db.lauf('INSERT INTO eintrag_planposition (eintrag_id, planposition_id) VALUES (?, ?)', e, id);
    db.lauf('UPDATE planposition SET letzte_eintrag_id = ? WHERE id = ?', e, id);
  }
  eintrag('A20', 'reparatur', plusTage(H, -45), 'Hydraulikschlauch Hubzylinder getauscht', 'Fachwerkstatt Muster (fiktiv)', 486.4, { teile: 'Hydraulikschlauch DN12, 2 Dichtringe' });
  eintrag('A05', 'reifen', plusTage(H, -30), 'Winterreifen Antriebsachse montiert', 'Reifen Muster (fiktiv)', 2380, { teile: '4 Reifen 315/80 R22,5' });
  eintrag('A18', 'reparatur', plusTage(H, -200), 'Zahnspitzen Tieflöffel erneuert', 'intern', 312.9, { stunden: 3 });

  // Mängel: A24 offen (bald), A27 „sofort“ (gesperrt, gemeldet von Polier Haidbauer)
  db.lauf("INSERT INTO mangel (typ, anlage_id, text, dringlichkeit, status, baustelle_id, gemeldet, gemeldet_von) VALUES ('mangel', ?, 'Gurt Magnetabscheider eingerissen', 'bald', 'offen', NULL, ?, 30)", ids.A24, new Date(jetzt.getTime() - 4 * 86400000).toISOString());
  const pitten = db.eins("SELECT id FROM baustelle WHERE kst = '26-041'");
  db.lauf("INSERT INTO mangel (typ, anlage_id, text, dringlichkeit, status, baustelle_id, gemeldet, gemeldet_von) VALUES ('mangel', ?, 'Lenkung blockiert – Gerät abgestellt', 'sofort', 'offen', ?, ?, 1)", ids.A27, pitten ? pitten.id : null, new Date(jetzt.getTime() - 86400000).toISOString());

  // Recht fuhrpark per Ausnahme für einen Demo-Polier („Werkstatt“) – € bleiben für Poliere gesperrt
  db.lauf('INSERT OR IGNORE INTO benutzer_recht (benutzer_id, recht, erteilt_von, erteilt) VALUES (?, ?, 102, ?)', WERKSTATT_POLIER, 'fuhrpark', t0);
  return { anlagen: Object.keys(ids).length, positionen: Object.keys(pos).length };
}

module.exports = { seedFuhrpark, ANLAGEN, WERKSTATT_POLIER };
