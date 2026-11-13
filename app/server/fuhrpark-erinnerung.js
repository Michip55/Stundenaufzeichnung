'use strict';
/**
 * Servicebuch – Erinnerungen (SERVICEBUCH_ENTWURF.md 6, API.md 11.2/11.3):
 * je Position, Zyklus und Stufe genau eine In-App-Benachrichtigung je Empfänger (nur die höchste erreichte Stufe),
 * Sperr-Meldungen, Wochen-Zusammenfassung und Zählerabfrage (montags ab 06:00 Wien). Texte nie mit €.
 */
const F = require('./fuhrpark');
const { ladeStand } = require('./fuhrpark-daten');
const { ladeRechteFuer } = require('./rechte');
const { wienDatum, wienMinuten, wochentag, plusTage, deDatum, tageZwischen } = require('./datum');

const STUFEN = ['bald', 'faellig', 'ueberfaellig'];
const STUFE_WORT = { bald: 'bald', faellig: 'fällig', ueberfaellig: 'überfällig' };
const ART_WORT = { gesetzlich: 'Prüfung', hersteller: 'Service', intern: 'Kontrolle', vertrag: 'Frist' };

function melde(db, { benutzerId, titel, text, zeit, anlageId = null, baustelleId = null, schluessel }) {
  return db.lauf(`INSERT INTO benachrichtigung (benutzer_id, typ, titel, text, zeit, gelesen, baustelle_id, schluessel, anlage_id)
    VALUES (?, 'fuhrpark', ?, ?, ?, 0, ?, ?, ?) ON CONFLICT(benutzer_id, schluessel) DO NOTHING`, benutzerId, titel, text, zeit, baustelleId, schluessel, anlageId).changes > 0;
}

/** Aktive Benutzer mit Recht fuhrpark */
function fuhrparkBenutzer(db) {
  return db.alle('SELECT * FROM benutzer WHERE aktiv = 1').filter((b) => ladeRechteFuer(db, b).has('fuhrpark')).map((b) => b.id);
}
const buroGf = (db) => db.alle("SELECT id FROM benutzer WHERE aktiv = 1 AND rolle IN ('buero','gf')").map((b) => b.id);
const aktiv = (db, id) => (id && db.eins('SELECT id FROM benutzer WHERE id = ? AND aktiv = 1', id) ? [id] : []);

/** Polier und Bauleiter des Standorts */
function standortLeute(db, A) {
  const bs = A.standortBaustelle;
  if (!bs) return [];
  return [...aktiv(db, bs.polier_id), ...aktiv(db, bs.bauleiter_id)];
}

const anlageName = (a) => `${a.bezeichnung}${a.kennzeichen ? ' ' + a.kennzeichen : ''}`;
const eindeutig = (l) => [...new Set(l)];

/** Text einer Fälligkeits-Erinnerung (ohne €) */
function erinnerungText(A, P, stufe) {
  const c = P.calc, a = A.row;
  const k = c.kriterien.find((x) => (c.grund === 'Datum' ? x.typ === 'datum' : x.typ === 'zaehler' && F.ZAEHLER_NAME[x.art] === c.grund)) || c.kriterien[0];
  if (k && k.typ === 'zaehler') {
    const e = F.EINHEIT[k.art];
    let t = `${P.row.titel} bei ${F.zahlDe(k.faelligBei, 0)} ${e} – Stand ≈ ${F.zahlDe(k.aktuell, 0)}${k.geschaetzt ? ' (geschätzt)' : ''}`;
    if (stufe === 'bald' && k.prognoseAm) t += `, voraussichtlich ${deDatum(k.prognoseAm)}`;
    else if (stufe !== 'bald') t += `, ${STUFE_WORT[stufe]} (Rest ${F.zahlDe(k.rest, 0)} ${e})`;
    return t;
  }
  let t = `${P.row.titel} ${anlageName(a)}: `;
  if (k && k.monatsgenau) t += `Begutachtungsmonat ${F.monatName(k.faelligAm.slice(0, 7))}`;
  else if (k) t += `fällig am ${deDatum(k.faelligAm)}`;
  if (stufe === 'bald' && k && k.fruehestens) t += ` – möglich ab ${deDatum(k.fruehestens)}`;
  if (stufe === 'faellig' && k) t += ` – spätestens ${deDatum(k.spaetestens)}`;
  if (stufe === 'ueberfaellig' && k) t += ` – überfällig seit ${deDatum(plusTage(k.spaetestens, 1))}${c.sperrt ? `, ${['pkw', 'bus', 'lkw', 'anhaenger'].includes(a.klasse) ? 'Fahrzeug' : 'Gerät'} gesperrt` : ''}`;
  return t;
}

/** ISO-Kalenderwoche → {jahr, kw} */
function isoWoche(datum) {
  const wt = wochentag(datum) || 7;
  const donnerstag = plusTage(datum, 4 - wt);
  const jahr = Number(donnerstag.slice(0, 4));
  return { jahr, kw: Math.floor(tageZwischen(`${jahr}-01-01`, donnerstag) / 7) + 1 };
}

/** Zählerabfrage für einen Benutzer (7.3): eigene Fahrzeuge mit km/bh-Stand älter als 7 Tage */
function zaehlerAbfrage(S, benutzerId) {
  const out = [];
  for (const A of S.liste) {
    if (A.row.ausgeschieden || A.row.verantwortlich_id !== benutzerId) continue;
    const z = A.zaehler.filter((x) => x.row.aktiv && ['km', 'bh'].includes(x.row.art) && tageZwischen(x.info.letzterStand.datum, S.H) > 7);
    if (!z.length) continue;
    out.push({
      anlageId: A.row.id, bezeichnung: A.row.bezeichnung, kennzeichen: A.row.kennzeichen,
      zaehler: z.map((x) => ({ id: x.row.id, art: x.row.art, einheit: F.EINHEIT[x.row.art], letzterStand: x.info.letzterStand.anzeige, letzterDatum: x.info.letzterStand.datum }))
    });
  }
  return out;
}

/**
 * Meldung „Anlage gesperrt“ (manuell, schwere Mängel, Mangel sofort, Schaden nicht einsatzfähig).
 * @param {{buero?: boolean}} opt  buero: zusätzlich Büro/GF (Schäden)
 */
function meldeSperre(db, A, { titel, text, zeit, schluessel, buero = false }) {
  const empf = eindeutig([...fuhrparkBenutzer(db), ...aktiv(db, A.row.verantwortlich_id), ...standortLeute(db, A), ...(buero ? buroGf(db) : [])])
;
  let n = 0;
  for (const id of empf) n += melde(db, { benutzerId: id, titel, text, zeit, anlageId: A.row.id, baustelleId: A.standortBaustelle ? A.standortBaustelle.id : null, schluessel }) ? 1 : 0;
  return n;
}

/**
 * Prüflauf.
 * @param {import('./db').Datenbank} db
 * @param {Date} jetzt
 * @returns {{neu:number}}
 */
function pruefeFuhrpark(db, jetzt) {
  const H = wienDatum(jetzt);
  const zeit = jetzt.toISOString();
  const S = ladeStand(db, H);
  const fp = fuhrparkBenutzer(db);
  let neu = 0;
  db.transaktion(() => {
    for (const A of S.liste) {
      if (A.row.ausgeschieden) continue;
      for (const P of A.positionen) {
        const stufe = P.calc.status;
        if (!P.row.aktiv || !STUFEN.includes(stufe) || !P.calc.zyklus) continue;
        const zyklus = P.calc.zyklus;
        const erreicht = db.alle('SELECT stufe FROM fuhrpark_erinnerung WHERE planposition_id = ? AND zyklus = ?', P.row.id, zyklus).map((x) => STUFEN.indexOf(x.stufe));
        const idx = STUFEN.indexOf(stufe);
        if (erreicht.some((i) => i >= idx)) continue;
        for (let i = 0; i <= idx; i++) db.lauf('INSERT OR IGNORE INTO fuhrpark_erinnerung (planposition_id, zyklus, stufe, zeit) VALUES (?, ?, ?, ?)', P.row.id, zyklus, STUFEN[i], zeit);
        const empf = [...fp, ...aktiv(db, A.row.verantwortlich_id)];
        if (stufe === 'ueberfaellig' && (P.calc.sperrt || A.status.gesperrt)) empf.push(...standortLeute(db, A));
        const titel = `${ART_WORT[P.row.art] || 'Termin'} ${STUFE_WORT[stufe]}: ${A.row.bezeichnung}`;
        const text = erinnerungText(A, P, stufe);
        for (const id of eindeutig(empf)) {
          neu += melde(db, { benutzerId: id, titel, text, zeit, anlageId: A.row.id, baustelleId: A.standortBaustelle ? A.standortBaustelle.id : null, schluessel: `fp:${P.row.id}:${zyklus}:${stufe}` }) ? 1 : 0;
        }
      }
    }
    // Montags ab 06:00: Wochen-Zusammenfassung und Zählerabfrage
    if (wochentag(H) === 1 && wienMinuten(jetzt) >= 360) {
      const { jahr, kw } = isoWoche(H);
      const kwTxt = `${jahr}-${String(kw).padStart(2, '0')}`;
      let ueber = 0, faellig = 0, bald = 0;
      const grenze = plusTage(H, 90);
      for (const A of S.liste) {
        if (A.row.ausgeschieden) continue;
        for (const P of A.positionen) {
          if (!P.row.aktiv) continue;
          if (P.calc.status === 'ueberfaellig') ueber++;
          else if (P.calc.status === 'faellig') faellig++;
          else if (P.calc.status === 'bald' || (P.calc.status === 'ok' && P.calc.naechstesDatum && P.calc.naechstesDatum <= grenze)) bald++;
        }
      }
      const gesperrt = S.liste.filter((A) => A.status.gesperrt).length;
      const text = `Fuhrpark KW ${kw}: ${ueber} überfällig, ${faellig ? faellig + ' fällig, ' : ''}${gesperrt} gesperrt, ${bald} in den nächsten 3 Monaten`;
      for (const id of fp) neu += melde(db, { benutzerId: id, titel: `Fuhrpark – Wochenübersicht KW ${kw}`, text, zeit, schluessel: `fp:woche:${kwTxt}` }) ? 1 : 0;
      const verantwortliche = eindeutig(S.liste.filter((A) => !A.row.ausgeschieden && A.row.verantwortlich_id).map((A) => A.row.verantwortlich_id));
      for (const uid of verantwortliche) {
        if (!aktiv(db, uid).length) continue;
        for (const z of zaehlerAbfrage(S, uid)) {
          const arten = z.zaehler.map((x) => x.art);
          const was = arten.includes('km') && arten.includes('bh') ? 'Kilometer- und Betriebsstundenstand' : arten.includes('km') ? 'Kilometerstand' : 'Betriebsstundenstand';
          const name = `${z.bezeichnung}${z.kennzeichen ? ' ' + z.kennzeichen : ''}`;
          neu += melde(db, { benutzerId: uid, titel: `Bitte ${was} eintragen: ${name}`, text: `Letzter Stand ${z.zaehler.map((x) => `${F.zahlDe(x.letzterStand, 0)} ${x.einheit} am ${deDatum(x.letzterDatum)}`).join(', ')}.`, zeit, anlageId: z.anlageId, schluessel: `fp:zaehler:${z.anlageId}:${kwTxt}` }) ? 1 : 0;
        }
      }
    }
  });
  return { neu, stand: S };
}

/** Prüflauf ohne Abbruch der Anfrage bei Fehlern (wird nach Änderungen aufgerufen) */
function pruefeFuhrparkSicher(bt) {
  try { return pruefeFuhrpark(bt.db, bt.uhr()); } catch (e) { console.error('[BauTag] Fuhrpark-Prüflauf fehlgeschlagen:', e); return null; }
}

module.exports = { pruefeFuhrpark, pruefeFuhrparkSicher, zaehlerAbfrage, meldeSperre, melde, fuhrparkBenutzer, buroGf, standortLeute, isoWoche, erinnerungText, anlageName };
