'use strict';
/** Servicebuch: Fälligkeit, Prognose, Plausibilität – Rechenbeispiele SERVICEBUCH_ENTWURF.md 5.3 (H = 2026-11-13) */
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../../server/fuhrpark');

const H = '2026-11-13';

/** Zähler-Kontext für berechnePosition aus Ständen und Berichtsstunden */
function zaehlerCtx(art, { staende, berichte = [], aus_bericht = 1, startstand = 0, startdatum = '2026-01-01', wochenschnitt } = {}) {
  const z = { art, startstand, startdatum, aus_bericht };
  const st = staende.map((s, i) => ({ id: i + 1, quelle: 'manuell', status: 'gueltig', anzeige: s.wert, ...s }));
  const info = F.zaehlerInfo(z, st, berichte, H);
  if (wochenschnitt !== undefined) info.wochenschnitt = wochenschnitt;
  return {
    [art]: {
      info, startstand,
      standAm: (d) => { const v = st.filter((s) => s.datum <= d).sort(F.sortStaende); return v.length ? v[v.length - 1].wert : null; }
    }
  };
}

const regel57aM1 = { folgeMonate: [36, 24, 12], monatsgenau: true, toleranzVorMonate: 1, toleranzNachMonate: 4, sperrtBeiUeberfaellig: true };

test('5.3/1: M1, EZ 2023-12-05, keine Durchführung → bald', () => {
  const p = F.berechnePosition({ regel: regel57aM1 }, { H, erstzulassung: '2023-12-05' });
  assert.equal(p.faelligAm, '2026-12-01');
  assert.equal(p.fruehestens, '2026-11-01');
  assert.equal(p.spaetestens, '2027-04-30');
  assert.equal(p.kriterien[0].vorlaufTage, 90);
  assert.equal(p.status, 'bald');
  assert.equal(p.zyklus, '2026-12');
});

test('5.3/2: M1, EZ 2020-09-10, letzte 2025-09-15 → S = 2026-09, fällig in Toleranz', () => {
  const p = F.berechnePosition({ regel: regel57aM1, letzteDatum: '2025-09-15' }, { H, erstzulassung: '2020-09-10' });
  assert.equal(p.faelligAm, '2026-09-01');
  assert.equal(p.spaetestens, '2027-01-31');
  assert.equal(p.status, 'faellig');
});

test('5.3/3: N3 jährlich, vor 3/nach 0, letzte 2025-10-08, sperrt → überfällig → Anlage gesperrt', () => {
  const regel = { folgeMonate: [12], monatsgenau: true, toleranzVorMonate: 3, toleranzNachMonate: 0, sperrtBeiUeberfaellig: true };
  const p = F.berechnePosition({ regel, letzteDatum: '2025-10-08' }, { H, erstzulassung: '2021-10-01' });
  assert.equal(p.faelligAm, '2026-10-01');
  assert.equal(p.spaetestens, '2026-10-31');
  assert.equal(p.status, 'ueberfaellig');
  const a = F.anlagenStatus({ ausgeschieden: null, gesperrt: 0 }, [{ ...p, id: 1, titel: '§57a-Begutachtung' }], []);
  assert.equal(a.status, 'gesperrt');
  assert.equal(a.ampel, 'rot');
  assert.equal(a.sperrGruende[0].typ, 'frist');
  assert.equal(a.sperrGruende[0].seit, '2026-11-01');
});

test('5.3/4: Massenspeicher 90 Tage, letzte 2026-08-25 → 2026-11-23, vorlaufEff 30 → bald', () => {
  const p = F.berechnePosition({ regel: { intervallTage: 90, toleranzNachTage: 0 }, letzteDatum: '2026-08-25' }, { H });
  assert.equal(p.faelligAm, '2026-11-23');
  assert.equal(p.kriterien[0].vorlaufTage, 30);
  assert.equal(p.status, 'bald');
});

test('5.3/5: Ladekran 12 Monate + 3 Monate Toleranz, letzte 2025-10-02 → fällig', () => {
  const p = F.berechnePosition({ regel: { intervallMonate: 12, toleranzNachMonate: 3 }, letzteDatum: '2025-10-02' }, { H });
  assert.equal(p.faelligAm, '2026-10-02');
  assert.equal(p.spaetestens, '2027-01-02');
  assert.equal(p.status, 'faellig');
});

// CAT 320: Ablesung 4.062 am 09.10., 4.150 am 06.11. (28 Tage, +88 → 22,0 Std./Woche), danach 30 Berichtsstunden
const cat320 = (zusatzBericht = 0) => zaehlerCtx('bh', {
  staende: [{ datum: '2026-10-09', wert: 4062 }, { datum: '2026-11-06', wert: 4150 }],
  berichte: [{ datum: '2026-11-06', stunden: 8 }, { datum: '2026-11-09', stunden: 10 }, { datum: '2026-11-10', stunden: 12 }, { datum: '2026-11-12', stunden: 8 + zusatzBericht }],
  startstand: 4000, startdatum: '2026-06-01'
});

test('5.3/6: CAT 320 500-Std.-Service → aktuell 4.180 (geschätzt), Rest 320, Prognose 2027-02-23, ok', () => {
  const z = cat320();
  assert.equal(z.bh.info.aktuell, 4180); // Bericht vom 06.11. zählt nicht (Stand am Tagesende)
  assert.equal(z.bh.info.geschaetzt, true);
  assert.equal(z.bh.info.wochenschnitt, 22);
  assert.equal(z.bh.info.schnittQuelle, 'ablesung');
  const p = F.berechnePosition({ regel: { intervallStunden: 500 }, letzteZaehler: { bh: 4000 } }, { H, zaehler: z });
  assert.deepEqual(p.faelligBei, { art: 'bh', wert: 4500 });
  assert.deepEqual(p.rest, { art: 'bh', wert: 320 });
  assert.equal(p.prognoseAm, '2027-02-23');
  assert.equal(p.kriterien[0].vorlaufTage, 53);
  assert.equal(p.status, 'ok');
  assert.equal(p.grund, 'Betriebsstunden');
});

test('5.3/7: wie 6, aktuell 4.460 → Rest 40 ≤ 50 → bald', () => {
  const z = cat320(280);
  assert.equal(z.bh.info.aktuell, 4460);
  const p = F.berechnePosition({ regel: { intervallStunden: 500 }, letzteZaehler: { bh: 4000 } }, { H, zaehler: z });
  assert.equal(p.rest.wert, 40);
  assert.equal(p.status, 'bald');
  assert.equal(p.zyklus, 'bh4500');
});

test('5.3/8: PKW 12 Monate + 30.000 km, letzte 2026-03-01 bei 84.000, aktuell 112.500 → bald, Grund Kilometer', () => {
  const z = zaehlerCtx('km', { staende: [{ datum: '2026-03-01', wert: 84000 }, { datum: '2026-11-10', wert: 112500 }], aus_bericht: 0 });
  const p = F.berechnePosition({ regel: { intervallMonate: 12, intervallKm: 30000 }, letzteDatum: '2026-03-01', letzteZaehler: { km: 84000 } }, { H, zaehler: z });
  const km = p.kriterien.find((k) => k.typ === 'zaehler');
  const dat = p.kriterien.find((k) => k.typ === 'datum');
  assert.equal(km.rest, 1500);
  assert.equal(km.status, 'bald');
  assert.equal(dat.faelligAm, '2027-03-01');
  assert.equal(dat.status, 'ok');
  assert.equal(p.status, 'bald');
  assert.equal(p.grund, 'Kilometer');
});

test('5.3/9: Winterausrüstung jährlich 31.10., Vorlauf 30, letzte 2025-10-20 → 2026-10-31 fällig', () => {
  const p = F.berechnePosition({ regel: { jaehrlichAm: '10-31', vorlaufTage: 30 }, letzteDatum: '2025-10-20' }, { H });
  assert.equal(p.faelligAm, '2026-10-31');
  assert.equal(p.spaetestens, '2026-11-14');
  assert.equal(p.status, 'faellig');
});

const zStaende = [{ id: 1, datum: '2026-11-03', wert: 4150, anzeige: 4150, status: 'gueltig' }];

test('5.3/10: Zählerstand 4.100 nach 4.150 → Fehler (400)', () => {
  const r = F.pruefeZaehlerstand({ art: 'bh', klasse: 'baumaschine' }, zStaende, { datum: '2026-11-10', wert: 4100 });
  assert.equal(r.fehler, 'Zählerstand kleiner als am 03.11.2026 (4.150 Std.) – bei Zählertausch bitte das Büro verständigen.');
});

test('5.3/11: +60 Std. in 2 Tagen → unplausibel', () => {
  const r = F.pruefeZaehlerstand({ art: 'bh', klasse: 'baumaschine' }, zStaende, { datum: '2026-11-05', wert: 4210 });
  assert.equal(r.fehler, undefined);
  assert.equal(r.status, 'unplausibel');
  assert.ok(r.warnung);
});

test('zahlDe', () => {
  assert.equal(F.zahlDe(4150), '4.150');
  assert.equal(F.zahlDe(1234567.25, 2), '1.234.567,25');
  assert.equal(F.zahlDe(22.04), '22');
  assert.equal(F.zahlDe(-20), '-20');
});

test('Plausibilität: km-Grenzen je Klasse, Nachfolger, Bericht-Abgleich', () => {
  const st = [{ id: 1, datum: '2026-11-01', wert: 1000, anzeige: 1000, status: 'gueltig' }, { id: 2, datum: '2026-11-10', wert: 5000, anzeige: 5000, status: 'gueltig' }];
  assert.equal(F.pruefeZaehlerstand({ art: 'km', klasse: 'lkw' }, st, { datum: '2026-11-02', wert: 2400 }).status, 'gueltig'); // 1.400 ≤ 1.500
  assert.equal(F.pruefeZaehlerstand({ art: 'km', klasse: 'pkw' }, st, { datum: '2026-11-02', wert: 2400 }).status, 'unplausibel'); // > 1.200
  assert.match(F.pruefeZaehlerstand({ art: 'km', klasse: 'lkw' }, st, { datum: '2026-11-05', wert: 5100 }).fehler, /größer als der spätere Stand am 10\.11\.2026/);
  const b = [{ datum: '2026-11-02', stunden: 20 }, { datum: '2026-11-03', stunden: 21 }];
  const r = F.pruefeZaehlerstand({ art: 'bh', klasse: 'baumaschine', aus_bericht: 1 }, [{ id: 1, datum: '2026-11-01', wert: 100, anzeige: 100, status: 'gueltig' }], { datum: '2026-11-04', wert: 112 }, b);
  assert.equal(r.status, 'gueltig');
  assert.equal(r.hinweis, 'Abgelesen +12 Std., laut Bautagesberichten +41 Std. – Gerätestunden prüfen');
  // unplausible Stände zählen nicht als Vorgänger
  const mitUnpl = [...st, { id: 3, datum: '2026-11-03', wert: 9000, anzeige: 9000, status: 'unplausibel' }];
  assert.equal(F.pruefeZaehlerstand({ art: 'km', klasse: 'lkw' }, mitUnpl, { datum: '2026-11-04', wert: 2000 }).status, 'gueltig');
});

test('plusMonate: Monatsende-Regel', () => {
  assert.equal(F.plusMonate('2026-01-31', 1), '2026-02-28');
  assert.equal(F.plusMonate('2028-01-31', 1), '2028-02-29');
  assert.equal(F.plusMonate('2026-03-31', -1), '2026-02-28');
  assert.equal(F.plusMonate('2026-11-13', 14), '2028-01-13');
  assert.equal(F.plusMonate('2026-08-31', 6), '2027-02-28');
  assert.equal(F.letzterTag('2028-02'), '2028-02-29');
  assert.equal(F.monatPlus('2026-11', -12), '2025-11');
});

test('§57a-Rhythmus: vorzeitige und verspätete Begutachtung verschieben den Rhythmus nicht', () => {
  const ctx = { H: '2027-06-10', erstzulassung: '2020-09-10' };
  // Termine 2023-09, 2025-09, 2026-09, 2027-09 …
  // vorzeitig im Fenster (August 2026 = 1 Monat vorher) → nächster Termin wieder September 2027
  assert.equal(F.berechnePosition({ regel: regel57aM1, letzteDatum: '2026-08-20' }, ctx).faelligAm, '2027-09-01');
  // verspätet (Jänner 2027, in der Toleranz) → nächster Termin September 2027, nicht Jänner 2028
  assert.equal(F.berechnePosition({ regel: regel57aM1, letzteDatum: '2027-01-15' }, ctx).faelligAm, '2027-09-01');
  // Erstzulassung fehlt → unvollständig
  const u = F.berechnePosition({ regel: regel57aM1 }, { H });
  assert.equal(u.status, 'unvollstaendig');
  assert.match(u.hinweis, /Erstzulassung/);
});

test('Prognose ohne Schnitt, Vorlauf nur über Stunden', () => {
  assert.equal(F.prognose(100, null, H), null);
  assert.equal(F.prognose(0, null, H), H);
  assert.equal(F.prognose(-5, 10, H), H);
  assert.equal(F.prognose(7, 7, H), '2026-11-20');
  const z = zaehlerCtx('bh', { staende: [{ datum: '2026-11-10', wert: 1000 }], aus_bericht: 0 });
  assert.equal(z.bh.info.wochenschnitt, null);
  const p = F.berechnePosition({ regel: { intervallStunden: 250 }, letzteZaehler: { bh: 810 } }, { H, zaehler: z });
  assert.equal(p.prognoseAm, null);
  assert.equal(p.kriterien[0].vorlaufTage, null);
  assert.equal(p.status, 'ok'); // Rest 60 > 50
  assert.equal(F.berechnePosition({ regel: { intervallStunden: 250 }, letzteZaehler: { bh: 800 } }, { H, zaehler: z }).status, 'bald'); // Rest 50 ≤ 50
});

test('Wochenschnitt aus Bautagesberichten, wenn Ablesungen < 14 Tage auseinander', () => {
  const z = F.zaehlerInfo({ art: 'bh', startstand: 100, startdatum: '2026-11-05', aus_bericht: 1 },
    [{ id: 1, datum: '2026-11-05', wert: 100, anzeige: 100, quelle: 'start', status: 'gueltig' }],
    [{ datum: '2026-10-01', stunden: 40 }, { datum: '2026-11-10', stunden: 8 }], H);
  assert.equal(z.schnittQuelle, 'bericht');
  assert.equal(z.wochenschnitt, 6); // 48 / 8
  assert.equal(z.aktuell, 108);
});

test('Zählertausch: Gesamtstand läuft stetig weiter, Fälligkeit nach Gesamtstand', () => {
  // alter Zähler bis 9.990, neuer startet bei 0 → versatz 9.990
  const st = [
    { id: 1, datum: '2026-10-01', anzeige: 9800, wert: 9800, quelle: 'manuell', status: 'gueltig' },
    { id: 2, datum: '2026-10-20', anzeige: 9990, wert: 9990, quelle: 'tausch_alt', status: 'gueltig' },
    { id: 3, datum: '2026-10-20', anzeige: 0, wert: 9990, quelle: 'tausch_neu', status: 'gueltig' },
    { id: 4, datum: '2026-11-10', anzeige: 120, wert: 10110, quelle: 'manuell', status: 'gueltig' }
  ];
  const info = F.zaehlerInfo({ art: 'bh', startstand: 0, startdatum: '2026-01-01', aus_bericht: 0 }, st, [], H);
  assert.equal(info.aktuell, 10110);
  assert.equal(info.letzterStand.anzeige, 120);
  assert.equal(info.wochenschnitt, r1((10110 - 9800) / 40 * 7));
  // Stand nach dem Tausch: kleinere Anzeige, aber größerer Gesamtstand ist gültig
  assert.equal(F.pruefeZaehlerstand({ art: 'bh', klasse: 'baumaschine' }, st, { datum: '2026-11-12', wert: 10130 }).status, 'gueltig');
});
function r1(x) { return Math.round(x * 10) / 10; }

test('schliesstEin / Regelprüfung', () => {
  assert.deepEqual(F.pruefeRegel({ intervallStunden: 1000, schliesstEin: ['cat_250', 'cat_500'] }), { intervallStunden: 1000, schliesstEin: ['cat_250', 'cat_500'] });
  assert.throws(() => F.pruefeRegel({}), /mindestens ein Kriterium/);
  assert.throws(() => F.pruefeRegel({ intervallMonate: 12, intervallTage: 30 }), /nur ein Datumskriterium/);
  assert.throws(() => F.pruefeRegel({ intervallMonate: 12, foo: 1 }), /unbekannt/);
  assert.throws(() => F.pruefeRegel({ jaehrlichAm: '02-30' }), /ungültig/);
  assert.deepEqual(F.pruefeRegel({ intervallMonate: 12, toleranzNachTage: null }), { intervallMonate: 12 }); // leere Felder entfallen
  assert.deepEqual(F.pruefeRegel({ datumAus: 'vertragsende', vorlaufTage: 90 }, { vorlage: true }), { datumAus: 'vertragsende', vorlaufTage: 90 });
  assert.throws(() => F.pruefeRegel({ datumAus: 'vertragsende' }), /mindestens ein Kriterium/);
});

test('einmaligAm: Vorlauf ungekürzt, nach Erledigung erledigt', () => {
  const p = F.berechnePosition({ regel: { einmaligAm: '2027-01-31', vorlaufTage: 90 } }, { H });
  assert.equal(p.status, 'bald'); // 2027-01-31 − 90 = 2026-11-02
  assert.equal(F.berechnePosition({ regel: { einmaligAm: '2027-01-31' }, letzteDatum: '2026-11-01' }, { H }).status, 'erledigt');
});

test('Anlagenstatus: Mangel sofort sperrt, ausgeschieden, fällig/bald/einsatzbereit', () => {
  const a = { ausgeschieden: null, gesperrt: 0 };
  assert.equal(F.anlagenStatus(a, [{ status: 'bald' }], [{ typ: 'mangel', text: 'Lenkung blockiert', dringlichkeit: 'sofort', gemeldet: '2026-11-12T08:00:00Z' }]).status, 'gesperrt');
  assert.equal(F.anlagenStatus({ ...a, ausgeschieden: '2026-01-01' }, [], []).status, 'ausgeschieden');
  assert.equal(F.anlagenStatus(a, [{ status: 'faellig' }, { status: 'ok' }], []).ampel, 'rot');
  assert.equal(F.anlagenStatus(a, [{ status: 'bald' }], []).status, 'bald');
  assert.equal(F.anlagenStatus(a, [{ status: 'unvollstaendig' }], []).status, 'einsatzbereit');
  assert.equal(F.anlagenStatus({ ...a, gesperrt: 1, sperr_grund: 'Hydraulik' }, [], []).sperrGruende[0].typ, 'manuell');
});
