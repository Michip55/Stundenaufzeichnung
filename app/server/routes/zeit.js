'use strict';
const v = require('../validierung');
const { ApiFehler, ungueltig, keinZugriff, konflikt, nichtGefunden } = require('../fehler');
const { baustelleImBereich, bereich } = require('../rechte');
const { pruefeBuchung, schichten, plausibilisieren, ungueltigeUebergaenge, TYPEN } = require('../stempel');
const { azgWarnungen } = require('../azg');
const { wienDatum, wienZeit, wienZuDate, plusTage, deDatum } = require('../datum');
const { ladeBaustelle, aktuellerStatus, buchungenSeit, letzteBuchungen } = require('../daten');
const { benachrichtige, empfaengerMitRecht } = require('../benachrichtigung');
const { woche } = require('../auswertung');
const { brauche } = require('./hilfe');
const DS = require('../datenschutz');
const PA = require('../pausen');

const MAX_RUECK_MS = 24 * 60 * 60 * 1000;
const MAX_VOR_MS = 2 * 60 * 1000;
const RE_ISO_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const KOLONNEN_ROLLEN = ['mitarbeiter', 'polier'];

/** ISO-Zeitstempel MIT Zeitzone (N-06) */
function zeitMitZone(wert, feld = 'zeit') {
  if (typeof wert !== 'string' || !RE_ISO_TZ.test(wert)) throw ungueltig(`${feld} muss ein ISO-8601-Zeitstempel mit Zeitzone sein (z. B. 2026-11-12T07:00:00+01:00 oder …Z).`);
  const d = new Date(wert);
  if (Number.isNaN(d.getTime())) throw ungueltig(`${feld} ist ungültig.`);
  return d;
}

/** Status inkl. heutiger Buchungen und AZG-Warnungen */
function zeitStatus(db, benutzerId, jetzt) {
  const st = aktuellerStatus(db, benutzerId);
  const heute = wienDatum(jetzt);
  const gestern = plusTage(heute, -1);
  const buchungen = buchungenSeit(db, benutzerId, wienZuDate(plusTage(heute, -3)).toISOString());
  const roh = schichten(buchungen, jetzt);
  const heuteSch = plausibilisieren(roh, jetzt).filter((s) => s.datum === heute);
  const warnungen = azgWarnungen(roh, { jetzt }).filter((w) => w.datum >= gestern || w.typ === 'offen');
  return {
    status: st.status,
    seit: st.seit,
    baustelleId: st.baustelleId,
    schichtBeginn: st.schichtBeginn,
    pauseBis: st.pauseBis, // 15.22: geplantes Ende der laufenden Pause (null = offen bzw. keine Pause)
    pauseDauerMin: st.pauseDauerMin,
    pausenAuswahl: PA.auswahl(db),
    // 15.27: in der laufenden Schicht schon eine Pause gebucht? (sonst fragt die Stempeluhr beim „Gehen“ nach der Pause)
    pauseInSchicht: Boolean(st.schichtBeginn && db.eins("SELECT 1 AS x FROM buchung WHERE benutzer_id = ? AND typ = 'pause_start' AND zeit >= ? LIMIT 1", benutzerId, st.schichtBeginn)),
    heute: {
      datum: heute,
      stunden: Math.round(heuteSch.reduce((a, s) => a + s.arbeitMin, 0) / 60 * 100) / 100,
      pauseMin: heuteSch.reduce((a, s) => a + s.pauseMin, 0),
      buchungen: buchungen.filter((b) => wienDatum(new Date(b.zeit)) === heute)
        .map((b) => ({ typ: b.typ, zeit: b.zeit, uhrzeit: wienZeit(new Date(b.zeit)), baustelleId: b.baustelleId, quelle: b.quelle,
          ...(b.automatisch ? { automatisch: true } : {}), ...(b.nachgetragen ? { nachgetragen: true } : {}), ...(b.typ === 'pause_start' && b.dauerMin ? { dauerMin: b.dauerMin } : {}) }))
    },
    geplant: require('./planer').geplantHeute(db, benutzerId, heute), // 12.8: nur veröffentlichte Einsätze
    standardKostenstelleId: require('../kostenstellen').standardFuer(db, benutzerId), // 12.25: Büro/Bauleiter/GF → „Büro“
    warnungen
  };
}

/**
 * Eine Stempelung buchen (eigene oder für die Kolonne). Wirft ApiFehler (400/409).
 */
function stempeln(bt, { benutzerId, typ, baustelleId, zeit, quelle, erfasstVon, standort, dauerMin, pauseBeimGehen, hinweis }) {
  const { db } = bt;
  const jetzt = bt.uhr();
  const dauer = PA.pruefeDauer(dauerMin, typ); // 15.22: geplante Pausendauer (null = offen)
  let zeitpunkt = jetzt;
  if (zeit !== undefined && zeit !== null) {
    zeitpunkt = zeitMitZone(zeit);
    if (zeitpunkt.getTime() > jetzt.getTime() + MAX_VOR_MS) throw ungueltig('zeit liegt in der Zukunft.');
    if (zeitpunkt.getTime() < jetzt.getTime() - MAX_RUECK_MS) throw ungueltig('Nachbuchungen sind höchstens 24 Stunden zurück möglich – bitte Korrektur beim Büro melden.');
    quelle = 'offline';
  }
  // 15.27: „Gehen“ mit nachgetragener Pause (nur eigene Stempeluhr) – Form hier, Lage in der Schicht unten in der Transaktion
  const angabe = pruefePauseBeimGehen(db, pauseBeimGehen, typ, quelle === 'offline');
  let bsId = null;
  if (typ === 'kommen' || typ === 'wechsel') {
    if (baustelleId === undefined || baustelleId === null) throw ungueltig('baustelleId fehlt (Baustelle wählen).');
    bsId = v.id(baustelleId, 'baustelleId');
    const bs = ladeBaustelle(db, bsId);
    if (!bs) throw ungueltig('Baustelle nicht gefunden.');
    if (bs.status === 'abgeschlossen') throw ungueltig(`Baustelle ${bs.kst} ist abgeschlossen.`);
  }
  let geo = { lat: null, lng: null, genauigkeit: null };
  if (standort !== undefined && standort !== null) {
    const s = v.objekt(standort, 'standort');
    geo = {
      lat: v.zahl(s.lat, 'standort.lat', { min: -90, max: 90 }),
      lng: v.zahl(s.lng, 'standort.lng', { min: -180, max: 180 }),
      genauigkeit: v.zahl(s.genauigkeit, 'standort.genauigkeit', { min: 0, max: 100000, pflicht: false })
    };
  }
  return db.transaktion(() => {
    PA.pausenAbschliessen(db, jetzt, benutzerId); // 15.22: fällige automatische Pausenenden zuerst
    let akt = aktuellerStatus(db, benutzerId);
    let letzte = akt.letzte;
    // 15.22: Ein früheres Ende (Pause beenden / Gehen – z. B. offline erfasst und erst jetzt nachgesendet) ersetzt das
    // automatische Ende, das der Server inzwischen eingetragen hat – sofern es nach dem Beginn dieser Pause liegt.
    if ((typ === 'pause_ende' || typ === 'gehen') && letzte && letzte.automatisch && letzte.typ === 'pause_ende' && zeitpunkt.getTime() < new Date(letzte.zeit).getTime()) {
      const start = db.eins('SELECT id, typ, zeit FROM buchung WHERE benutzer_id = ? AND (zeit < ? OR (zeit = ? AND id < ?)) ORDER BY zeit DESC, id DESC LIMIT 1', benutzerId, letzte.zeit, letzte.zeit, letzte.id);
      if (start && start.typ === 'pause_start' && zeitpunkt.getTime() >= new Date(start.zeit).getTime()) {
        db.lauf('DELETE FROM buchung WHERE id = ?', letzte.id);
        db.protokolliere({ zeit: jetzt.toISOString(), benutzerId: erfasstVon, art: 'zeit', objekt: `buchung:${letzte.id}`, alt: { benutzerId, typ: 'pause_ende', zeit: letzte.zeit, automatisch: true },
          text: `Automatisches Pausenende ${wienZeit(new Date(letzte.zeit))} durch früheres ${typ === 'gehen' ? '„Gehen“' : '„Pause beenden“'} ${wienZeit(zeitpunkt)} ersetzt` });
        akt = aktuellerStatus(db, benutzerId);
        letzte = akt.letzte;
      }
    }
    // 15.22: „Pause beenden“ nach dem automatischen Ende (z. B. Knopf auf einem veralteten Bildschirm) – die Pause ist schon
    // vorbei; nichts buchen, aktuellen Status melden
    if (typ === 'pause_ende' && akt.status === 'arbeit' && letzte && letzte.automatisch && letzte.typ === 'pause_ende' && zeitpunkt.getTime() >= new Date(letzte.zeit).getTime()) return 'arbeit';
    if (letzte && zeitpunkt.getTime() < new Date(letzte.zeit).getTime()) {
      throw konflikt(`Der Zeitpunkt liegt vor der letzten Buchung (${wienZeit(new Date(letzte.zeit))}).`);
    }
    if (typ === 'kommen' && erfasstVon === benutzerId) {
      // Eigene Stempelung (auch der Polier selbst in der Kolonne): gesperrt bei genehmigtem K/U, Grund nur für die Person selbst.
      // Über die Kolonne für ANDERE gibt es keine Sperre (Inhaber, API.md 15.2) – dort wird angenommen und das Büro informiert.
      const abw = db.eins("SELECT code FROM abwesenheit WHERE benutzer_id = ? AND datum = ? AND status = 'genehmigt' AND code IN ('K','U')", benutzerId, wienDatum(zeitpunkt));
      if (abw) throw konflikt(`Für diesen Tag ist ${abw.code === 'K' ? 'Krankenstand' : 'Urlaub'} eingetragen – Einstempeln nicht möglich. Bitte im Büro klären.`);
    }
    const p = pruefeBuchung(akt, typ, bsId);
    if (!p.ok) {
      const seit = akt.seit ? ` (seit ${deDatum(wienDatum(new Date(akt.seit)))} ${wienZeit(new Date(akt.seit))})` : '';
      throw konflikt(p.grund.replace(/\.$/, '') + (akt.status !== 'aus' ? seit : '') + '.', { status: akt.status });
    }
    if (typ !== 'kommen' && typ !== 'wechsel') bsId = akt.baustelleId;
    // 15.27: nachgetragene Pause zuerst prüfen und als gewöhnliche Pausenbuchungen (Beginn + Ende) vor dem „Gehen“ eintragen
    const verworfen = angabe ? pauseEintragen(bt, { benutzerId, akt, angabe, gehen: zeitpunkt, quelle, erfasstVon, jetzt }) : null;
    // jede neue Buchung beendet eine noch ausstehende geplante Pause dieser Person (Merker löschen)
    db.lauf('UPDATE buchung SET pause_auto_bis = NULL WHERE benutzer_id = ? AND pause_auto_bis IS NOT NULL', benutzerId);
    const bis = dauer ? new Date(zeitpunkt.getTime() + dauer * 60000).toISOString() : null;
    const neu = db.lauf(`INSERT INTO buchung (benutzer_id, typ, zeit, baustelle_id, quelle, erfasst_von, erfasst, lat, lng, genauigkeit, pause_plan_min, pause_auto_bis)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, benutzerId, typ, zeitpunkt.toISOString(), bsId, quelle, erfasstVon, jetzt.toISOString(), geo.lat, geo.lng, geo.genauigkeit, dauer, bis);
    if (verworfen) {
      // 15.27: Pausenangabe nicht übernommen, das „Gehen“ gilt – fürs Büro im Protokoll, für die Person in der Antwort
      db.protokolliere({ zeit: jetzt.toISOString(), benutzerId: erfasstVon, art: 'zeit', objekt: `buchung:${neu.id}`, alt: verworfen.alt, text: verworfen.text });
      if (hinweis) hinweis.pauseVerworfen = verworfen.grund;
    }
    // offline nachgesendet und schon vorbei: Ende sofort eintragen (genau Beginn + Dauer)
    if (bis) PA.pausenAbschliessen(db, jetzt, benutzerId);
    if (typ === 'gehen') azgNachGehen(bt, benutzerId, jetzt);
    return p.status;
  });
}

/**
 * 15.27 (Inhaber 19.11.2026): Form der nachgetragenen Pause beim „Gehen“ – `{beginn: ISO mit Zone, dauerMin}`.
 * Die Dauer muss eine der angebotenen sein (`pausenAuswahl`); beim Nachsenden ohne Netz genügt der Rahmen 5–240 Min
 * (die Einstellung kann sich inzwischen geändert haben – wie 15.22). Gibt null zurück, wenn nichts nachgetragen wird.
 */
function pruefePauseBeimGehen(db, wert, typ, offline) {
  if (wert === undefined || wert === null) return null;
  if (typ !== 'gehen') throw ungueltig('pauseBeimGehen gibt es nur bei „gehen“.');
  const o = v.objekt(wert, 'pauseBeimGehen');
  const beginn = zeitMitZone(o.beginn, 'pauseBeimGehen.beginn');
  const dauer = v.zahl(o.dauerMin, 'pauseBeimGehen.dauerMin', { min: PA.MIN_DAUER, max: PA.MAX_DAUER, ganz: true });
  const auswahl = PA.auswahl(db);
  if (!offline && !auswahl.includes(dauer)) throw ungueltig(`Diese Pausendauer steht nicht zur Auswahl (${auswahl.length ? auswahl.map((x) => `${x} Min`).join(', ') : 'keine'}).`);
  return { beginn, dauer };
}

/**
 * 15.27: Pause der laufenden Schicht nachtragen (in der Transaktion des „Gehen“, vor dessen Buchung).
 * Die Pause liegt ganz zwischen „Kommen“ und „Gehen“ und überschneidet keine andere Buchung (z. B. Baustellenwechsel).
 * Eingetragen als gewöhnliche „pause_start“ (mit Dauer) und „pause_ende“ mit `nachgetragen = 1` – alle Auswertungen lesen
 * sie wie eine gestempelte Pause.
 * Ist in der Schicht inzwischen schon eine Pause gebucht oder läuft eine (z. B. vom Polier über die Kolonne, während das
 * Gerät einen alten Stand zeigte oder kein Netz hatte), ist die Frage gegenstandslos: die Angabe wird verworfen und das
 * „Gehen“ trotzdem gebucht. Beim Nachsenden ohne Netz gilt das auch, wenn die Pause nicht (mehr) in die Schicht passt –
 * das Arbeitsende darf nicht verloren gehen. Den Protokolleintrag dazu schreibt stempeln() am „Gehen“.
 * @returns {{grund:string, text:string, alt:object}|null} verworfene Angabe, sonst null (eingetragen)
 */
function pauseEintragen(bt, { benutzerId, akt, angabe, gehen, quelle, erfasstVon, jetzt }) {
  const { db } = bt;
  const uhr = (d) => wienZeit(d instanceof Date ? d : new Date(d));
  const von = angabe.beginn.getTime();
  const bis = von + angabe.dauer * 60000;
  const verwerfen = (grund) => ({ grund, text: `Pausenangabe beim Gehen verworfen (${angabe.dauer} Min ab ${uhr(new Date(von))}) – ${grund}`,
    alt: { benutzerId, beginn: new Date(von).toISOString(), dauerMin: angabe.dauer, quelle } });
  if (akt.status === 'pause') return verwerfen('in der Schicht läuft schon eine Pause');
  if (akt.status !== 'arbeit' || !akt.schichtBeginn) throw konflikt('Nicht eingestempelt.');
  const schicht = db.alle('SELECT id, typ, zeit, baustelle_id AS baustelleId FROM buchung WHERE benutzer_id = ? AND zeit >= ? ORDER BY zeit, id', benutzerId, akt.schichtBeginn);
  if (schicht.some((b) => b.typ === 'pause_start')) return verwerfen('in der Schicht ist schon eine Pause gebucht');
  const start = new Date(akt.schichtBeginn).getTime();
  // keine andere Buchung innerhalb der Pause (gleiche Zeit wie der Beginn ist in Ordnung – die Pause kommt danach)
  const dazwischen = schicht.find((b) => { const t = new Date(b.zeit).getTime(); return t > von && t <= bis; });
  const fehler = gehen.getTime() - start < angabe.dauer * 60000 ? `Seit dem Kommen um ${uhr(akt.schichtBeginn)} Uhr sind keine ${angabe.dauer} Min vergangen – diese Pause passt nicht in die Schicht.`
    : von < start ? `Die Pause kann frühestens um ${uhr(akt.schichtBeginn)} Uhr beginnen (Kommen).`
    : bis > gehen.getTime() ? `Die Pause muss bis ${uhr(gehen)} Uhr zu Ende sein – bitte einen früheren Beginn wählen.`
    : dazwischen ? `Um ${uhr(dazwischen.zeit)} Uhr ist eine andere Buchung (${dazwischen.typ === 'wechsel' ? 'Baustelle gewechselt' : dazwischen.typ}) – die Pause darf sie nicht überschneiden.`
    : null;
  if (fehler && quelle === 'offline') return verwerfen(`passt nicht in die Schicht: ${fehler}`);
  if (fehler) throw ungueltig(fehler);
  // Baustelle zur Zeit der Pause = letzte „kommen“/„wechsel“ bis zum Beginn
  const bsId = schicht.filter((b) => (b.typ === 'kommen' || b.typ === 'wechsel') && new Date(b.zeit).getTime() <= von).map((b) => b.baustelleId).pop() ?? akt.baustelleId;
  const vonIso = new Date(von).toISOString(), bisIso = new Date(bis).toISOString();
  const r = db.lauf(`INSERT INTO buchung (benutzer_id, typ, zeit, baustelle_id, quelle, erfasst_von, erfasst, pause_plan_min, nachgetragen)
    VALUES (?, 'pause_start', ?, ?, ?, ?, ?, ?, 1)`, benutzerId, vonIso, bsId, quelle, erfasstVon, jetzt.toISOString(), angabe.dauer);
  db.lauf(`INSERT INTO buchung (benutzer_id, typ, zeit, baustelle_id, quelle, erfasst_von, erfasst, nachgetragen)
    VALUES (?, 'pause_ende', ?, ?, ?, ?, ?, 1)`, benutzerId, bisIso, bsId, quelle, erfasstVon, jetzt.toISOString());
  db.protokolliere({ zeit: jetzt.toISOString(), benutzerId: erfasstVon, art: 'zeit', objekt: `buchung:${r.id}`, neu: { benutzerId, beginn: vonIso, ende: bisIso, dauerMin: angabe.dauer, quelle },
    text: `Pause beim Gehen nachgetragen (${angabe.dauer} Min ab ${uhr(vonIso)})` });
  return null;
}

/** Nach dem Ausstempeln: AZG-Warnungen als Benachrichtigung (an die Person und das Büro) */
function azgNachGehen(bt, benutzerId, jetzt) {
  const { db } = bt;
  const sch = schichten(letzteBuchungen(db, benutzerId, 100), jetzt);
  const letzte = sch[sch.length - 1];
  if (!letzte) return;
  const w = azgWarnungen(sch, { jetzt }).filter((x) => x.datum === letzte.datum && x.typ !== 'offen');
  if (!w.length) return;
  const b = db.eins('SELECT id, name FROM benutzer WHERE id = ?', benutzerId);
  const buero = empfaengerMitRecht(db, 'lohn', { ohne: benutzerId }); // 15.3: AZG anderer nur für die Lohnverrechnung (Recht lohn)
  for (const x of w) {
    const titel = `AZG-Hinweis: ${b.name}`;
    for (const e of [{ id: b.id }, ...buero]) {
      benachrichtige(db, { benutzerId: e.id, typ: 'azg', titel, text: x.text, zeit: jetzt.toISOString(), schluessel: `azg:${benutzerId}:${x.datum}:${x.typ}` });
    }
  }
}

/** Genehmigte persönliche Abwesenheit (K, U – auch Betriebsurlaub –, ZA) an diesem Tag? SW ist Wetter, keine persönliche Abwesenheit. */
function eingetrageneAbwesenheit(db, benutzerId, datum) {
  return db.eins("SELECT code, betriebsurlaub FROM abwesenheit WHERE benutzer_id = ? AND datum = ? AND status = 'genehmigt' AND code IN ('K','U','ZA')", benutzerId, datum) || null;
}

/**
 * Wer erfährt von einer Stempelung trotz Abwesenheit: alle aktiven Benutzer mit stammdaten oder lohn (15.2/15.3, über Rechte,
 * nie über Rollennamen – Bauleiter = Büro); nie Polier/Mitarbeiter (Sicherheitsnetz, beide Rechte sind für sie gesperrt).
 */
function klaerungsEmpfaenger(db) {
  return empfaengerMitRecht(db, 'stammdaten|lohn').filter((b) => !['polier', 'mitarbeiter'].includes(b.rolle));
}

/** API.md 15.2: Kolonne hat jemanden trotz eingetragener Abwesenheit gestempelt → Hinweis an das Büro (einmal je Person und Tag). */
function meldeStempelungTrotzAbwesenheit(bt, liste) {
  try {
    const { db } = bt;
    const zeit = bt.uhr().toISOString();
    const empf = klaerungsEmpfaenger(db);
    for (const k of liste) {
      const text = `Stempelung trotz eingetragener Abwesenheit: ${k.name}, ${deDatum(k.datum)} – bitte klären`;
      for (const e of empf) benachrichtige(db, { benutzerId: e.id, typ: 'abwesenheit', titel: 'Stempelung trotz eingetragener Abwesenheit', text, zeit, baustelleId: k.baustelleId, schluessel: `abw-stempel:${k.benutzerId}:${k.datum}` });
    }
  } catch (e) {
    console.error('Hinweis „Stempelung trotz Abwesenheit“ nicht gespeichert:', e && e.message); // eslint-disable-line no-console
  }
}

/** 15.29: zuletzt von der Person selbst korrigiert (nur die GF darf das) – Büro-Korrektur mit erfasst_von = Person */
// rolle-ok: 'buero' ist hier die Buchungsquelle „Korrektur“, kein Rollenname und keine Zugriffsentscheidung
const istSelbstkorrektur = (b) => b.quelle === 'buero' && b.erfasst_von != null && b.erfasst_von === b.benutzer_id && !b.automatisch;

function buchungJson(b) {
  const z = new Date(b.zeit);
  return { id: b.id, benutzerId: b.benutzer_id, typ: b.typ, zeit: b.zeit, uhrzeit: wienZeit(z), datum: wienDatum(z), baustelleId: b.baustelle_id, quelle: b.quelle, erfasstVon: b.erfasst_von,
    automatisch: Boolean(b.automatisch), nachgetragen: Boolean(b.nachgetragen), dauerMin: b.typ === 'pause_start' ? b.pause_plan_min ?? null : null, pauseBis: b.pause_auto_bis || null,
    ...(istSelbstkorrektur(b) ? { selbstkorrektur: true } : {}) };
}

module.exports = function zeitRouten(api, bt) {
  const { db } = bt;
  const bsMap = () => new Map(db.alle('SELECT id, polier_id, bauleiter_id, kst FROM baustelle').map((b) => [b.id, b]));

  api.get('/zeit/status', brauche('zeit_eigen'), (req, res) => {
    res.json(zeitStatus(db, req.ctx.benutzer.id, bt.uhr()));
  });

  api.post('/zeit/stempeln', brauche('zeit_eigen'), (req, res) => {
    const body = v.objekt(req.body);
    const typ = v.auswahl(body.typ, 'typ', TYPEN);
    const hinweis = {};
    stempeln(bt, { benutzerId: req.ctx.benutzer.id, typ, baustelleId: body.baustelleId, zeit: body.zeit, quelle: 'app', erfasstVon: req.ctx.benutzer.id, standort: body.standort, dauerMin: body.dauerMin, pauseBeimGehen: body.pauseBeimGehen, hinweis });
    const antwort = zeitStatus(db, req.ctx.benutzer.id, bt.uhr());
    // 15.27: Pausenangabe verworfen (schon eine Pause in der Schicht / offline nachgesendet und passt nicht) – das Gehen gilt
    if (hinweis.pauseVerworfen) antwort.pauseVerworfen = hinweis.pauseVerworfen;
    // Servicebuch (API.md 11.4): nach dem Ausstempeln eigene Fahrzeuge mit altem Zählerstand abfragen
    if (typ === 'gehen') {
      const { ladeStand } = require('../fuhrpark-daten');
      antwort.zaehlerAbfrage = require('../fuhrpark-erinnerung').zaehlerAbfrage(ladeStand(db, wienDatum(bt.uhr())), req.ctx.benutzer.id);
    }
    res.json(antwort);
  });

  /** Wer ist gerade eingestempelt (Dashboard „Heute“). Bauleiter/Polier: nur eigene Baustellen. */
  api.get('/zeit/anwesend', brauche('bericht_freigeben', 'stammdaten', 'lohn', 'kalk_sehen'), (req, res) => {
    const ctx = req.ctx;
    const m = bsMap();
    const nurEigene = bereich(ctx.benutzer) !== 'alle';
    const out = [];
    for (const b of db.alle('SELECT id, name, rolle FROM benutzer WHERE aktiv = 1 ORDER BY name')) {
      const st = aktuellerStatus(db, b.id);
      if (st.status === 'aus') continue;
      if (nurEigene && !baustelleImBereich(ctx.benutzer, m.get(st.baustelleId))) continue;
      out.push({ benutzerId: b.id, name: b.name, rolle: b.rolle, status: st.status, seit: st.seit, baustelleId: st.baustelleId, schichtBeginn: st.schichtBeginn, pauseBis: st.pauseBis });
    }
    res.json(out);
  });

  /**
   * API.md 15.20 (Übersicht „Heute“): wer laut VERÖFFENTLICHTEM Plan heute eingeteilt ist (dieselbe Quelle wie die Polier-Sicht,
   * veroeffentlicht_stand – 15.10) und wer heute (Wiener Kalendertag) schon gestempelt hat (nur Benutzer-IDs) – daraus
   * „Eingestempelt N / M“ und „Eingeteilte fehlen noch“. Allein das Recht stammdaten (wie Planer und /zeit/buchungen
   * anderer; Bauleiter = Büro, 15.4). Keine Abwesenheitsgründe, keine Beträge.
   */
  api.get('/zeit/heute-eingeteilt', brauche('stammdaten'), (req, res) => {
    const heute = wienDatum(bt.uhr());
    const gestempelt = db.alle('SELECT DISTINCT benutzer_id FROM buchung WHERE zeit >= ? AND zeit < ? ORDER BY benutzer_id',
      wienZuDate(heute).toISOString(), wienZuDate(plusTage(heute, 1)).toISOString()).map((x) => x.benutzer_id);
    const je = new Map();
    for (const e of db.alle('SELECT veroeffentlicht_stand FROM plan_einsatz WHERE datum = ? AND veroeffentlicht_stand IS NOT NULL ORDER BY id', heute)) {
      let st = null; try { st = JSON.parse(e.veroeffentlicht_stand); } catch (x) { continue; }
      if (!st || !Array.isArray(st.personen)) continue;
      const bs = st.baustelle || {};
      for (const p of st.personen) {
        if (!je.has(p.benutzerId)) je.set(p.benutzerId, { benutzerId: p.benutzerId, name: p.name, baustelleId: st.baustelleId, baustelle: bs.kurz || bs.name || '', beginn: st.beginn || null });
      }
    }
    res.json({ datum: heute, eingeteilt: [...je.values()].sort((a, b) => a.benutzerId - b.benutzerId), gestempelt });
  });

  api.get('/zeit/kolonne', brauche('kolonne'), (req, res) => {
    const bsId = v.id(Number(req.query.baustelleId), 'baustelleId');
    const bs = ladeBaustelle(db, bsId);
    if (!bs) throw ungueltig('Baustelle nicht gefunden.');
    if (!baustelleImBereich(req.ctx.benutzer, bs)) throw keinZugriff('Diese Baustelle gehört nicht zu Ihrer Partie.');
    const jetzt = bt.uhr();
    const out = [];
    const geplant = new Set(require('./planer').geplantAufBaustelle(db, bs.id, wienDatum(bt.uhr()))); // 12.8
    const mitPlan = req.query.plan === '1';
    for (const b of db.alle(`SELECT id, name, rolle, baustelle_id FROM benutzer WHERE aktiv = 1 AND rolle IN ('mitarbeiter','polier') ORDER BY name`)) {
      const st = aktuellerStatus(db, b.id);
      const partie = b.baustelle_id === bs.id || bs.polier_id === b.id;
      if (!partie && st.baustelleId !== bs.id && !(mitPlan && geplant.has(b.id))) continue;
      // API.md 15.2: kein Feld, keine Reihenfolge und keine Vorauswahl hängt für Polier/Mitarbeiter von fremden Abwesenheiten ab.
      // `seit` nur bei laufender Schicht – das letzte „gehen“ früherer Tage verriete Fehltage.
      // `code` nur, wer Abwesenheiten dieser Person sehen darf (Büro/Lohn/Bauleiter/GF bzw. die Person selbst) – sonst immer null.
      const abw = DS.siehtAbwesenheit(req.ctx, b.id) ? db.eins("SELECT code FROM abwesenheit WHERE benutzer_id = ? AND datum = ? AND status = 'genehmigt'", b.id, wienDatum(jetzt)) : null;
      out.push({ benutzerId: b.id, name: b.name, rolle: b.rolle, partie, status: st.status, seit: st.status === 'aus' ? null : st.seit, baustelleId: st.baustelleId, pauseBis: st.pauseBis, code: abw ? DS.code(req.ctx, b.id, abw.code) : null,
        ...(mitPlan ? { geplant: geplant.has(b.id) } : {}) });
    }
    res.json(out);
  });

  api.post('/zeit/kolonne', brauche('kolonne'), (req, res) => {
    const ctx = req.ctx;
    const body = v.objekt(req.body);
    const typ = v.auswahl(body.typ, 'typ', TYPEN);
    const bsId = v.id(body.baustelleId, 'baustelleId');
    const gast = body.gast === undefined ? false : v.bool(body.gast, 'gast');
    const bs = ladeBaustelle(db, bsId);
    if (!bs) throw ungueltig('Baustelle nicht gefunden.');
    if (!baustelleImBereich(ctx.benutzer, bs)) throw keinZugriff('Diese Baustelle gehört nicht zu Ihrer Partie.');
    const ids = v.liste(body.benutzerIds, 'benutzerIds', { max: 60 });
    if (!ids.length) throw ungueltig('benutzerIds: mindestens eine Person auswählen.');
    ids.forEach((x, i) => v.id(x, `benutzerIds[${i}]`));
    if (new Set(ids).size !== ids.length) throw ungueltig('benutzerIds: doppelte Einträge.');
    if (body.zeit !== undefined && body.zeit !== null) zeitMitZone(body.zeit);
    PA.pruefeDauer(body.dauerMin, typ); // 15.22: Eingabefehler gelten für alle (400 vor der ersten Buchung)
    const m = bsMap();
    const klaeren = []; // Stempelung trotz eingetragener Abwesenheit → Büro/GF (nach der Antwort, API.md 15.2)
    const tag = wienDatum(body.zeit !== undefined && body.zeit !== null ? zeitMitZone(body.zeit) : bt.uhr());
    const ergebnisse = ids.map((id) => {
      const b = db.eins('SELECT id, name, rolle, baustelle_id, aktiv FROM benutzer WHERE id = ?', id);
      if (!b || !b.aktiv) return { benutzerId: id, ok: false, fehler: 'Mitarbeiter nicht gefunden oder inaktiv.' };
      if (!KOLONNEN_ROLLEN.includes(b.rolle)) return { benutzerId: id, ok: false, fehler: 'Über die Kolonne können nur Mitarbeiter und Poliere gestempelt werden.' };
      // B-02: nur eigene Partie bzw. Personen auf eigenen Baustellen
      const st = aktuellerStatus(db, id);
      const inPartie = id === ctx.benutzer.id || (b.baustelle_id != null && baustelleImBereich(ctx.benutzer, m.get(b.baustelle_id)));
      if (typ === 'kommen') {
        const eingeplant = typ === 'kommen' && require('./planer').geplantAufBaustelle(db, bsId, wienDatum(bt.uhr())).includes(id); // 12.8
        if (!inPartie && !gast && !eingeplant) return { benutzerId: id, ok: false, fehler: `${b.name} gehört nicht zu Ihrer Partie (als Gast stempeln: gast:true).` };
      } else if (st.status !== 'aus' && !baustelleImBereich(ctx.benutzer, m.get(st.baustelleId))) {
        return { benutzerId: id, ok: false, fehler: `${b.name} ist nicht auf einer Ihrer Baustellen eingestempelt.` };
      }
      try {
        const status = stempeln(bt, { benutzerId: id, typ, baustelleId: bsId, zeit: body.zeit, quelle: 'kolonne', erfasstVon: ctx.benutzer.id, dauerMin: body.dauerMin });
        // Für jede gebuchte fremde Person dieselbe Abfrage; das Ergebnis wirkt nur beim Büro, nie in der Antwort
        if (id !== ctx.benutzer.id && eingetrageneAbwesenheit(db, id, tag)) klaeren.push({ benutzerId: id, name: b.name, datum: tag, baustelleId: bsId });
        if (typ === 'kommen' && !inPartie) {
          db.protokolliere({ zeit: bt.uhr().toISOString(), benutzerId: ctx.benutzer.id, art: 'zeit', objekt: `benutzer:${id}`, text: `${b.name} als Gast auf ${bs.kst} eingestempelt (Kolonne)` });
        }
        return { benutzerId: id, ok: true, status };
      } catch (e) {
        if (e instanceof ApiFehler && e.status === 400) throw e; // Eingabefehler gelten für alle
        if (e instanceof ApiFehler) return { benutzerId: id, ok: false, fehler: e.message };
        throw e;
      }
    });
    res.json({ ergebnisse });
    // Erst nach der Antwort: Laufzeit und Antwort sind für Anwesende und Abwesende gleich
    if (klaeren.length) setImmediate(() => meldeStempelungTrotzAbwesenheit(bt, klaeren));
  });

  /* ---------- 15.22: Vordefinierte Pausen (angebotene Dauern) ---------- */
  // Lesen und ändern allein mit dem Recht stammdaten (Büro = Bauleiter = GF); Stempeluhr und Kolonne erhalten die Auswahl
  // über GET /zeit/status (`pausenAuswahl`)
  api.get('/einstellungen/pausen', brauche('stammdaten'), (req, res) => {
    res.json({ auswahl: PA.auswahl(db), offen: true, minDauer: PA.MIN_DAUER, maxDauer: PA.MAX_DAUER, maxEintraege: PA.MAX_EINTRAEGE });
  });
  api.put('/einstellungen/pausen', brauche('stammdaten'), (req, res) => {
    const body = v.objekt(req.body);
    const auswahl = PA.pruefeAuswahl(body.auswahl);
    const alt = PA.auswahl(db);
    db.setzeEinstellung('pausen', { auswahl });
    db.protokolliere({ zeit: bt.uhr().toISOString(), benutzerId: req.ctx.benutzer.id, art: 'einstellung', objekt: 'pausen', alt: { auswahl: alt }, neu: { auswahl }, text: `Vordefinierte Pausen: ${auswahl.length ? auswahl.map((x) => `${x} Min`).join(' · ') + ' · offen' : 'nur offen'}` });
    res.json({ auswahl: PA.auswahl(db), offen: true, minDauer: PA.MIN_DAUER, maxDauer: PA.MAX_DAUER, maxEintraege: PA.MAX_EINTRAEGE });
  });

  api.get('/zeit/woche', brauche('zeit_eigen'), (req, res) => {
    const datum = req.query.datum ? v.datum(String(req.query.datum), 'datum') : wienDatum(bt.uhr());
    res.json(woche(db, req.ctx.benutzer.id, datum, bt.uhr()));
  });

  /* ---------- Korrektur von Buchungen (Büro/GF, immer mit Grund) – B-05 ---------- */

  api.get('/zeit/buchungen', (req, res) => {
    const ctx = req.ctx;
    const heute = wienDatum(bt.uhr());
    const benutzerId = req.query.benutzerId === undefined ? ctx.benutzer.id : v.pfadId(String(req.query.benutzerId), 'benutzerId');
    if (benutzerId !== ctx.benutzer.id && !ctx.hat('stammdaten')) throw keinZugriff('Buchungen anderer sieht nur das Büro.');
    const von = req.query.von === undefined ? plusTage(heute, -14) : v.datum(String(req.query.von), 'von');
    const bis = req.query.bis === undefined ? heute : v.datum(String(req.query.bis), 'bis');
    if (bis < von) throw ungueltig('bis liegt vor von.');
    if (plusTage(von, 93) < bis) throw ungueltig('Zeitraum höchstens 93 Tage.');
    const z = db.alle('SELECT * FROM buchung WHERE benutzer_id = ? AND zeit >= ? AND zeit < ? ORDER BY zeit, id',
      benutzerId, wienZuDate(von).toISOString(), wienZuDate(plusTage(bis, 1)).toISOString());
    res.json(z.map(buchungJson));
  });

  /** Prüft nach der Änderung die Stempelfolge (darf nicht schlechter werden) – innerhalb der Transaktion */
  function pruefeFolge(benutzerId, vorher) {
    const nachher = ungueltigeUebergaenge(db.alle('SELECT typ FROM buchung WHERE benutzer_id = ? ORDER BY zeit, id', benutzerId));
    if (nachher > vorher) throw konflikt('Die Korrektur ergibt eine ungültige Stempelfolge (z. B. zweimal „kommen“ oder „gehen“ ohne „kommen“).');
  }
  const fehlerVorher = (benutzerId) => ungueltigeUebergaenge(db.alle('SELECT typ FROM buchung WHERE benutzer_id = ? ORDER BY zeit, id', benutzerId));
  /**
   * Vier-Augen-Prinzip: eigene Stempelzeiten korrigiert eine andere Person. Ausnahme (API.md 15.29, Inhaber 19.11.2026):
   * die Geschäftsführung darf ihre eigenen Zeiten selbst korrigieren – die Korrektur wird dann im Protokoll markiert.
   * Vorbehalt der GF wie „Archiv aufheben“ und die Bericht-Selbstfreigabe (15.4): kein Recht der Matrix drückt „nur die GF
   * persönlich“ aus („benutzer“ ist die Benutzerverwaltung), und über Matrix/Ausnahmen darf es niemand sonst bekommen.
   * @returns {string} '' (fremde Zeiten) oder der Zusatz für den Protokolltext (Selbstkorrektur der GF)
   */
  const SELBSTKORREKTUR = ' (Selbstkorrektur durch GF – Vier-Augen-Prinzip nicht eingehalten)';
  const selbstPruefen = (ctx, benutzerId) => {
    if (benutzerId !== ctx.benutzer.id) return '';
    if (ctx.benutzer.rolle !== 'gf') throw keinZugriff('Eigene Stempelzeiten korrigiert eine andere Person (Vier-Augen-Prinzip).'); // rolle-ok: Vorbehalt der GF (15.29) wie Archiv aufheben und Selbstfreigabe
    return SELBSTKORREKTUR;
  };
  /** Kennzeichen im Protokoll-„neu“ (zusätzlich zum Text), damit Listen die Selbstkorrektur ohne Textvergleich erkennen */
  const mitKennzeichen = (neu, zusatz) => (zusatz ? { ...(neu || {}), selbstkorrektur: true } : neu);
  const grundAus = (body) => v.text(body.grund, 'grund', { max: 300, min: 3 });
  function korrekturZeit(wert, feld = 'zeit') {
    const z = zeitMitZone(wert, feld);
    const jetzt = bt.uhr().getTime();
    if (z.getTime() > jetzt + MAX_VOR_MS) throw ungueltig(`${feld} liegt in der Zukunft.`);
    if (z.getTime() < jetzt - 400 * 86400000) throw ungueltig(`${feld} liegt zu weit zurück.`);
    return z;
  }
  function korrekturBaustelle(wert) {
    const id = v.id(wert, 'baustelleId');
    if (!ladeBaustelle(db, id)) throw ungueltig('Baustelle nicht gefunden.');
    return id;
  }

  api.post('/zeit/buchungen', brauche('stammdaten'), (req, res) => {
    const body = v.objekt(req.body);
    const benutzerId = v.id(body.benutzerId, 'benutzerId');
    const zusatz = selbstPruefen(req.ctx, benutzerId);
    if (!db.eins('SELECT id FROM benutzer WHERE id = ?', benutzerId)) throw ungueltig('Mitarbeiter nicht gefunden.');
    const typ = v.auswahl(body.typ, 'typ', TYPEN);
    const zeit = korrekturZeit(body.zeit);
    const bsId = typ === 'kommen' || typ === 'wechsel' ? korrekturBaustelle(body.baustelleId) : null;
    const grund = grundAus(body);
    const jetzt = bt.uhr().toISOString();
    const id = db.transaktion(() => {
      const vorher = fehlerVorher(benutzerId);
      const r = db.lauf(`INSERT INTO buchung (benutzer_id, typ, zeit, baustelle_id, quelle, erfasst_von, erfasst) VALUES (?, ?, ?, ?, 'buero', ?, ?)`,
        benutzerId, typ, zeit.toISOString(), bsId, req.ctx.benutzer.id, jetzt);
      pruefeFolge(benutzerId, vorher);
      db.protokolliere({ zeit: jetzt, benutzerId: req.ctx.benutzer.id, art: 'zeitkorrektur', objekt: `buchung:${r.id}`, neu: mitKennzeichen({ benutzerId, typ, zeit: zeit.toISOString(), baustelleId: bsId }, zusatz), text: `Buchung nachgetragen: ${grund}${zusatz}` });
      return r.id;
    });
    res.status(201).json(buchungJson(db.eins('SELECT * FROM buchung WHERE id = ?', id)));
  });

  api.put('/zeit/buchungen/:id', brauche('stammdaten'), (req, res) => {
    const id = v.pfadId(req.params.id, 'Buchungs-ID');
    const alt = db.eins('SELECT * FROM buchung WHERE id = ?', id);
    if (!alt) throw nichtGefunden('Buchung nicht gefunden.');
    const zusatz = selbstPruefen(req.ctx, alt.benutzer_id);
    const body = v.objekt(req.body);
    const grund = grundAus(body);
    const f = {};
    if (body.zeit !== undefined) f.zeit = korrekturZeit(body.zeit).toISOString();
    if (body.baustelleId !== undefined) {
      if (alt.typ !== 'kommen' && alt.typ !== 'wechsel') throw ungueltig('Eine Baustelle haben nur „kommen“ und „wechsel“.');
      f.baustelle_id = korrekturBaustelle(body.baustelleId);
    }
    if (!Object.keys(f).length) throw ungueltig('Keine Änderungen angegeben (zeit, baustelleId).');
    const jetzt = bt.uhr().toISOString();
    db.transaktion(() => {
      const vorher = fehlerVorher(alt.benutzer_id);
      const k = Object.keys(f);
      // 15.22: Büro-Korrektur macht ein automatisches Pausenende zu einer gewöhnlichen Buchung; ein noch ausstehendes
      // geplantes Ende wandert mit dem korrigierten Pausenbeginn mit
      const bis = f.zeit && alt.pause_auto_bis && alt.pause_plan_min ? new Date(new Date(f.zeit).getTime() + alt.pause_plan_min * 60000).toISOString() : alt.pause_auto_bis;
      db.lauf(`UPDATE buchung SET ${k.map((x) => `${x} = ?`).join(', ')}, quelle = 'buero', erfasst_von = ?, erfasst = ?, automatisch = 0, nachgetragen = 0, pause_auto_bis = ? WHERE id = ?`, ...k.map((x) => f[x]), req.ctx.benutzer.id, jetzt, bis, id);
      pruefeFolge(alt.benutzer_id, vorher);
      db.protokolliere({ zeit: jetzt, benutzerId: req.ctx.benutzer.id, art: 'zeitkorrektur', objekt: `buchung:${id}`,
        alt: { zeit: alt.zeit, baustelleId: alt.baustelle_id, quelle: alt.quelle }, neu: mitKennzeichen({ zeit: f.zeit ?? alt.zeit, baustelleId: f.baustelle_id ?? alt.baustelle_id }, zusatz), text: `Buchung korrigiert: ${grund}${zusatz}` });
    });
    res.json(buchungJson(db.eins('SELECT * FROM buchung WHERE id = ?', id)));
  });

  api.delete('/zeit/buchungen/:id', brauche('stammdaten'), (req, res) => {
    const id = v.pfadId(req.params.id, 'Buchungs-ID');
    const alt = db.eins('SELECT * FROM buchung WHERE id = ?', id);
    if (!alt) throw nichtGefunden('Buchung nicht gefunden.');
    const zusatz = selbstPruefen(req.ctx, alt.benutzer_id);
    const grund = grundAus(v.objekt(req.body || {}));
    const jetzt = bt.uhr().toISOString();
    db.transaktion(() => {
      const vorher = fehlerVorher(alt.benutzer_id);
      db.lauf('DELETE FROM buchung WHERE id = ?', id);
      pruefeFolge(alt.benutzer_id, vorher);
      db.protokolliere({ zeit: jetzt, benutzerId: req.ctx.benutzer.id, art: 'zeitkorrektur', objekt: `buchung:${id}`,
        alt: { benutzerId: alt.benutzer_id, typ: alt.typ, zeit: alt.zeit, baustelleId: alt.baustelle_id, quelle: alt.quelle, erfasstVon: alt.erfasst_von }, neu: mitKennzeichen(undefined, zusatz), text: `Buchung gelöscht: ${grund}${zusatz}` });
    });
    res.json({ ok: true });
  });

  /* ---------- Ganze Schichten nachtragen / löschen (C-04) ---------- */

  function schichtJson(benutzerId, sch) {
    return {
      id: sch.buchungen[0].id, benutzerId, datum: sch.datum,
      beginn: new Date(sch.start).toISOString(), ende: sch.offen ? null : new Date(sch.ende).toISOString(),
      baustellen: [...new Set(sch.intervalle.map((i) => i.baustelleId).filter(Boolean))],
      arbeitMin: sch.arbeitMin, pauseMin: sch.pauseMin, offen: sch.offen, unplausibel: Boolean(sch.unplausibel),
      buchungIds: sch.buchungen.map((b) => b.id),
      ...(sch.buchungen.some((b) => istSelbstkorrektur({ ...b, benutzer_id: benutzerId })) ? { selbstkorrektur: true } : {})
    };
  }

  api.get('/zeit/schichten', (req, res) => {
    const ctx = req.ctx;
    const heute = wienDatum(bt.uhr());
    const benutzerId = req.query.benutzerId === undefined ? ctx.benutzer.id : v.pfadId(String(req.query.benutzerId), 'benutzerId');
    if (benutzerId !== ctx.benutzer.id && !ctx.hat('stammdaten')) throw keinZugriff('Schichten anderer sieht nur das Büro.');
    const von = req.query.von === undefined ? plusTage(heute, -14) : v.datum(String(req.query.von), 'von');
    const bis = req.query.bis === undefined ? heute : v.datum(String(req.query.bis), 'bis');
    if (bis < von) throw ungueltig('bis liegt vor von.');
    if (plusTage(von, 93) < bis) throw ungueltig('Zeitraum höchstens 93 Tage.');
    const b = db.alle('SELECT id, typ, zeit, baustelle_id AS baustelleId, quelle, erfasst_von, automatisch FROM buchung WHERE benutzer_id = ? AND zeit >= ? AND zeit < ? ORDER BY zeit, id',
      benutzerId, wienZuDate(plusTage(von, -1)).toISOString(), wienZuDate(plusTage(bis, 2)).toISOString());
    const jetzt = bt.uhr();
    res.json(plausibilisieren(schichten(b, jetzt), jetzt).filter((x) => x.datum >= von && x.datum <= bis).map((x) => schichtJson(benutzerId, x)));
  });

  api.post('/zeit/schichten', brauche('stammdaten'), (req, res) => {
    const body = v.objekt(req.body);
    const benutzerId = v.id(body.benutzerId, 'benutzerId');
    const zusatz = selbstPruefen(req.ctx, benutzerId);
    if (!db.eins('SELECT id FROM benutzer WHERE id = ?', benutzerId)) throw ungueltig('Mitarbeiter nicht gefunden.');
    const bsId = korrekturBaustelle(body.baustelleId);
    const datum = v.datum(body.datum, 'datum');
    const vonHm = v.uhrzeit(body.von, 'von');
    const bisHm = v.uhrzeit(body.bis, 'bis');
    if (!vonHm || !bisHm) throw ungueltig('von und bis (HH:MM) sind Pflicht.');
    const pauseMin = v.zahl(body.pauseMin ?? 0, 'pauseMin', { min: 0, max: 240, ganz: true });
    const grund = grundAus(body);
    const start = wienZuDate(datum, vonHm);
    let ende = wienZuDate(datum, bisHm);
    if (ende <= start) ende = wienZuDate(plusTage(datum, 1), bisHm); // über Mitternacht
    const dauerMin = Math.round((ende - start) / 60000);
    if (dauerMin <= 0 || dauerMin > 16 * 60) throw ungueltig('Eine Schicht muss zwischen 1 Minute und 16 Stunden dauern.');
    if (pauseMin >= dauerMin) throw ungueltig('Die Pause ist länger als die Schicht.');
    const jetzt = bt.uhr();
    if (ende.getTime() > jetzt.getTime() + MAX_VOR_MS) throw ungueltig('Die Schicht darf nicht in der Zukunft enden.');
    if (start.getTime() < jetzt.getTime() - 400 * 86400000) throw ungueltig('Die Schicht liegt zu weit zurück.');
    let pauseStart = null;
    if (pauseMin > 0) {
      if (body.pauseVon !== undefined && body.pauseVon !== null) {
        const pv = v.uhrzeit(body.pauseVon, 'pauseVon');
        pauseStart = wienZuDate(datum, pv);
        if (pauseStart < start) pauseStart = wienZuDate(plusTage(datum, 1), pv);
        if (pauseStart <= start || pauseStart.getTime() + pauseMin * 60000 >= ende.getTime()) throw ungueltig('Die Pause muss innerhalb der Schicht liegen.');
      } else {
        pauseStart = new Date(start.getTime() + Math.round((dauerMin - pauseMin) / 2) * 60000);
      }
    }
    // Überschneidung mit anderen Schichten der Person
    const umgebung = db.alle('SELECT id, typ, zeit, baustelle_id AS baustelleId FROM buchung WHERE benutzer_id = ? AND zeit >= ? AND zeit < ? ORDER BY zeit, id',
      benutzerId, new Date(start.getTime() - 3 * 86400000).toISOString(), new Date(ende.getTime() + 3 * 86400000).toISOString());
    for (const x of schichten(umgebung, jetzt)) {
      const xEnde = x.offen ? jetzt.getTime() : x.ende;
      if (x.start < ende.getTime() && xEnde > start.getTime()) {
        throw konflikt(`Die Schicht überschneidet sich mit einer bestehenden Schicht (${deDatum(x.datum)} ${wienZeit(new Date(x.start))}–${x.offen ? 'offen' : wienZeit(new Date(x.ende))}).`);
      }
    }
    const t = jetzt.toISOString();
    const kommenId = db.transaktion(() => {
      const vorher = fehlerVorher(benutzerId);
      const ins = (typ, zeit, bs) => db.lauf(`INSERT INTO buchung (benutzer_id, typ, zeit, baustelle_id, quelle, erfasst_von, erfasst) VALUES (?, ?, ?, ?, 'buero', ?, ?)`,
        benutzerId, typ, zeit.toISOString(), bs, req.ctx.benutzer.id, t).id;
      const id = ins('kommen', start, bsId);
      if (pauseStart) { ins('pause_start', pauseStart, null); ins('pause_ende', new Date(pauseStart.getTime() + pauseMin * 60000), null); }
      ins('gehen', ende, null);
      pruefeFolge(benutzerId, vorher);
      db.protokolliere({ zeit: t, benutzerId: req.ctx.benutzer.id, art: 'zeitkorrektur', objekt: `schicht:${id}`,
        neu: mitKennzeichen({ benutzerId, baustelleId: bsId, datum, von: vonHm, bis: bisHm, pauseMin }, zusatz), text: `Schicht nachgetragen: ${grund}${zusatz}` });
      return id;
    });
    const b = db.alle('SELECT id, typ, zeit, baustelle_id AS baustelleId, quelle, erfasst_von, automatisch FROM buchung WHERE benutzer_id = ? AND zeit >= ? AND zeit <= ? ORDER BY zeit, id', benutzerId, start.toISOString(), ende.toISOString());
    const sch = schichten(b, jetzt).find((x) => x.buchungen[0].id === kommenId);
    res.status(201).json(schichtJson(benutzerId, sch));
  });

  api.delete('/zeit/schichten/:id', brauche('stammdaten'), (req, res) => {
    const id = v.pfadId(req.params.id, 'Schicht-ID');
    const k = db.eins('SELECT * FROM buchung WHERE id = ?', id);
    if (!k || k.typ !== 'kommen') throw nichtGefunden('Schicht nicht gefunden (ID der „kommen“-Buchung angeben).');
    const zusatz = selbstPruefen(req.ctx, k.benutzer_id);
    const grund = grundAus(v.objekt(req.body || {}));
    const folgende = db.alle('SELECT * FROM buchung WHERE benutzer_id = ? AND (zeit > ? OR (zeit = ? AND id > ?)) ORDER BY zeit, id', k.benutzer_id, k.zeit, k.zeit, k.id);
    const teil = [k];
    for (const b of folgende) {
      if (b.typ === 'kommen') break;
      teil.push(b);
      if (b.typ === 'gehen') break;
    }
    const t = bt.uhr().toISOString();
    db.transaktion(() => {
      const vorher = fehlerVorher(k.benutzer_id);
      for (const b of teil) db.lauf('DELETE FROM buchung WHERE id = ?', b.id);
      pruefeFolge(k.benutzer_id, vorher);
      db.protokolliere({ zeit: t, benutzerId: req.ctx.benutzer.id, art: 'zeitkorrektur', objekt: `schicht:${id}`,
        alt: teil.map((b) => ({ id: b.id, typ: b.typ, zeit: b.zeit, baustelleId: b.baustelle_id, quelle: b.quelle })), neu: mitKennzeichen(undefined, zusatz), text: `Schicht gelöscht: ${grund}${zusatz}` });
    });
    res.json({ ok: true, geloescht: teil.length });
  });
};

module.exports.zeitStatus = zeitStatus;
module.exports.stempeln = stempeln;
module.exports.zeitMitZone = zeitMitZone;
