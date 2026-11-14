'use strict';
/**
 * Baustellenplaner (API.md 12.8–12.8c): Einsätze je Tag × Baustelle, Konflikte, Vorschau (Fortschreiben),
 * Veröffentlichung mit Meldungen, „Mein Einsatz“. Fuhraufträge siehe fuhren.js. Keine €-Felder.
 */
const crypto = require('node:crypto');
const { wienDatum, plusTage, istArbeitstag, feiertag, wochentag } = require('./datum');
const { benachrichtige, empfaengerMitRecht } = require('./benachrichtigung');

const PLANBAR = ['geplant', 'in_arbeit', 'pausiert', 'fertiggestellt', 'abgenommen'];
const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const CODE_TEXT = { U: 'Urlaub', K: 'Krank', SW: 'Schlechtwetter', ZA: 'Zeitausgleich', BU: 'Betriebsurlaub' };

const hash = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 24);
const de = (d) => d.split('-').reverse().join('.');
const deKurz = (d) => `${WT[wochentag(d)]} ${d.slice(8, 10)}.${d.slice(5, 7)}.`;

function naechsterArbeitstag(d) { let x = plusTage(d, 1); while (!istArbeitstag(x)) x = plusTage(x, 1); return x; }
function vorigerArbeitstag(d) { let x = plusTage(d, -1); while (!istArbeitstag(x)) x = plusTage(x, -1); return x; }
function einstellungen(db) {
  return { planFortschreiben: true, planErinnerung: '17:00', grube: { text: 'Grube Breitenau', lat: null, lon: null }, ...(db.einstellung('plan', {}) || {}) };
}

/** Stammdaten für einen Zeitraum (Personen, Baustellen, Anlagenstatus, Abwesenheiten) */
function kontextDaten(db, heute, von, bis) {
  const personen = new Map(db.alle('SELECT id, name, rolle, aktiv, baustelle_id FROM benutzer').map((b) => [b.id, b]));
  const baustellen = new Map(db.alle('SELECT * FROM baustelle').map((b) => [b.id, b]));
  const { ladeStand } = require('./fuhrpark-daten');
  const S = ladeStand(db, heute);
  const abw = new Map();
  for (const a of db.alle("SELECT benutzer_id, datum, code, status FROM abwesenheit WHERE datum >= ? AND datum <= ? AND status IN ('genehmigt','beantragt')", von, bis)) {
    abw.set(`${a.benutzer_id}|${a.datum}`, a);
  }
  return { personen, baustellen, S, abw, heute };
}
function anlageStatus(K, id) {
  const A = K.S.anlagen.get(id);
  if (!A) return null;
  return { anlageId: id, nummer: A.row.nummer, bezeichnung: A.row.bezeichnung, kennzeichen: A.row.kennzeichen, klasse: A.row.klasse, status: A.row.ausgeschieden ? 'ausgeschieden' : A.status.status, gesperrt: Boolean(A.status.gesperrt), ausgeschieden: Boolean(A.row.ausgeschieden) };
}
/** Abwesenheitstext mit Datenschutz (Code nur für stammdaten/lohn) */
function abwText(a, voll) { return voll ? `${CODE_TEXT[a.code] || a.code}${a.status === 'beantragt' ? ' (beantragt)' : ''}` : 'abwesend'; }

/** Gespeicherte Einsätze eines Zeitraums (roh) */
function ladeEinsaetze(db, von, bis, { mitGeloeschten = false } = {}) {
  const e = db.alle(`SELECT * FROM plan_einsatz WHERE datum >= ? AND datum <= ? ${mitGeloeschten ? '' : 'AND geloescht = 0'} ORDER BY datum, baustelle_id`, von, bis);
  if (!e.length) return [];
  const ids = e.map((x) => x.id);
  const q = ids.map(() => '?').join(',');
  const p = db.alle(`SELECT * FROM plan_person WHERE einsatz_id IN (${q}) ORDER BY rowid`, ...ids);
  const a = db.alle(`SELECT * FROM plan_anlage WHERE einsatz_id IN (${q}) ORDER BY rowid`, ...ids);
  for (const x of e) {
    x.personen = p.filter((y) => y.einsatz_id === x.id).map((y) => ({ benutzer_id: y.benutzer_id, kolonne_polier_id: y.kolonne_polier_id, notiz: y.notiz }));
    x.anlagen = a.filter((y) => y.einsatz_id === x.id).map((y) => ({ anlage_id: y.anlage_id, notiz: y.notiz, fahrer_id: y.fahrer_id }));
  }
  return e;
}
function ladeEinsatz(db, id) {
  const e = db.eins('SELECT * FROM plan_einsatz WHERE id = ? AND geloescht = 0', id);
  if (!e) return null;
  return ladeEinsaetze(db, e.datum, e.datum).find((x) => x.id === id);
}

/** Letzter früherer Tag mit gespeicherten Einsätzen (höchstens 60 Tage zurück) */
function quelleTag(db, datum) {
  const z = db.eins('SELECT MAX(datum) AS d FROM plan_einsatz WHERE geloescht = 0 AND datum < ? AND datum >= ?', datum, plusTage(datum, -60));
  return z && z.d ? z.d : null;
}

/**
 * Vorschau-Tag (12.8c) oder null. Liefert Roh-Einsätze ohne id mit uebersprungen/vortagNotizen.
 */
function vorschauTag(db, datum, K, { voll = false } = {}) {
  const E = einstellungen(db);
  if (E.planFortschreiben === false || !istArbeitstag(datum)) return null;
  if (datum < K.heute || datum > plusTage(K.heute, 14)) return null;
  if (db.eins('SELECT 1 AS x FROM plan_einsatz WHERE datum = ? AND geloescht = 0 LIMIT 1', datum)) return null;
  // G-01: ein schon gespeicherter Tag (auch wenn inzwischen alle Einsätze gelöscht sind) ist nie wieder Vorschau
  if (db.eins('SELECT 1 AS x FROM plan_tag WHERE datum = ?', datum)) return null;
  const q = quelleTag(db, datum);
  if (!q) return null;
  const einsaetze = [];
  const tagUebersprungen = [];
  for (const s of ladeEinsaetze(db, q, q)) {
    const bs = K.baustellen.get(s.baustelle_id);
    if (!bs || !PLANBAR.includes(bs.phase)) {
      tagUebersprungen.push({ typ: 'baustelle', text: `${bs ? bs.kst : '?'}: Baustelle nicht mehr planbar (${bs ? bs.phase : 'fehlt'})`, baustelleId: s.baustelle_id });
      continue;
    }
    const uebersprungen = [];
    const personen = [];
    for (const p of s.personen) {
      const b = K.personen.get(p.benutzer_id);
      if (!b || !b.aktiv) { uebersprungen.push({ typ: 'inaktiv', text: `${b ? b.name : '?'}: nicht mehr aktiv`, benutzerId: p.benutzer_id }); continue; }
      if (!['mitarbeiter', 'polier'].includes(b.rolle)) { uebersprungen.push({ typ: 'rolle', text: `${b.name}: wird nicht eingeplant (${b.rolle === 'bauleiter' ? 'Bauleiter' : 'Büro'})`, benutzerId: p.benutzer_id }); continue; } // 12.25
      const a = K.abw.get(`${p.benutzer_id}|${datum}`);
      if (a) { uebersprungen.push({ typ: 'abwesenheit', text: `${b.name}: ${abwText(a, voll)}`, benutzerId: p.benutzer_id }); continue; }
      personen.push({ benutzer_id: p.benutzer_id, kolonne_polier_id: p.kolonne_polier_id, notiz: null });
    }
    const da = new Set(personen.map((p) => p.benutzer_id));
    const anlagen = [];
    for (const a of s.anlagen) {
      const st = anlageStatus(K, a.anlage_id);
      if (!st || st.gesperrt || st.ausgeschieden) { uebersprungen.push({ typ: 'anlage_gesperrt', text: `${st ? st.bezeichnung : '?'}: ${st && st.ausgeschieden ? 'ausgeschieden' : 'gesperrt'}`, anlageId: a.anlage_id }); continue; }
      anlagen.push({ anlage_id: a.anlage_id, notiz: null, fahrer_id: a.fahrer_id && da.has(a.fahrer_id) ? a.fahrer_id : null });
    }
    einsaetze.push({
      id: null, vorschau: true, quelleDatum: q, datum, baustelle_id: s.baustelle_id, beginn: s.beginn, treffpunkt: s.treffpunkt,
      fahrzeug_anlage_id: s.fahrzeug_anlage_id, fahrzeug_text: s.fahrzeug_text, arbeit: s.arbeit, notiz: null, benoetigt: null, personen, anlagen, uebersprungen,
      vortagNotizen: {
        notiz: s.notiz || null, benoetigt: s.benoetigt || null,
        personen: Object.fromEntries(s.personen.filter((p) => p.notiz).map((p) => [p.benutzer_id, p.notiz])),
        anlagen: Object.fromEntries(s.anlagen.filter((a) => a.notiz).map((a) => [a.anlage_id, a.notiz]))
      },
      version: 0
    });
  }
  return { quelleDatum: q, einsaetze, uebersprungen: [...tagUebersprungen, ...einsaetze.flatMap((e) => e.uebersprungen)] };
}

/** Tag aus der Vorschau speichern (idempotent) → Anzahl angelegter Einsätze */
function materialisieren(bt, datum, benutzerId) {
  const { db } = bt;
  const K = kontextDaten(db, wienDatum(bt.uhr()), datum, datum);
  const v = vorschauTag(db, datum, K);
  if (!v) return 0;
  const t = bt.uhr().toISOString();
  for (const e of v.einsaetze) {
    const id = db.lauf(`INSERT INTO plan_einsatz (datum, baustelle_id, beginn, treffpunkt, fahrzeug_anlage_id, fahrzeug_text, arbeit, notiz, benoetigt, uebernommen, erstellt, erstellt_von, geaendert)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 1, ?, ?, ?)`, datum, e.baustelle_id, e.beginn, e.treffpunkt, e.fahrzeug_anlage_id, e.fahrzeug_text, e.arbeit, t, benutzerId, t).id;
    for (const p of e.personen) db.lauf('INSERT INTO plan_person (einsatz_id, benutzer_id, kolonne_polier_id) VALUES (?, ?, ?)', id, p.benutzer_id, p.kolonne_polier_id);
    for (const a of e.anlagen) db.lauf('INSERT INTO plan_anlage (einsatz_id, anlage_id, fahrer_id) VALUES (?, ?, ?)', id, a.anlage_id, a.fahrer_id);
  }
  db.protokolliere({ zeit: t, benutzerId, art: 'plan', objekt: `plan:${datum}`, neu: { quelleDatum: v.quelleDatum, einsaetze: v.einsaetze.length }, text: `Einteilung ${de(datum)} aus ${de(v.quelleDatum)} übernommen (${v.einsaetze.length} Einsätze)` });
  return v.einsaetze.length;
}

/**
 * Einsatz als JSON (API.md 12.8/12.8a). `notizen`: alle Notizen sichtbar (Planer, Polier).
 */
function einsatzJson(e, K, { notizen = true, lesestand = null } = {}) {
  const bs = K.baustellen.get(e.baustelle_id) || {};
  const pers = (id) => K.personen.get(id) || { name: '?', rolle: null };
  const kol = new Map();
  for (const p of e.personen) if (p.kolonne_polier_id) kol.set(p.kolonne_polier_id, (kol.get(p.kolonne_polier_id) || 0) + 1);
  const fz = e.fahrzeug_anlage_id ? anlageStatus(K, e.fahrzeug_anlage_id) : null;
  const istVeroeffentlicht = Boolean(e.veroeffentlicht_zeit);
  const o = {
    id: e.id, datum: e.datum, baustelleId: e.baustelle_id,
    baustelle: { id: bs.id, kst: bs.kst, name: bs.name, kurz: bs.kurz, adresse: bs.adresse, lat: bs.lat, lng: bs.lng },
    beginn: e.beginn, treffpunkt: e.treffpunkt || '', arbeit: e.arbeit || '',
    fahrzeug: fz || e.fahrzeug_text ? { ...(fz ? { anlageId: fz.anlageId, bezeichnung: fz.bezeichnung, kennzeichen: fz.kennzeichen } : {}), ...(e.fahrzeug_text ? { text: e.fahrzeug_text } : {}) } : null,
    notiz: notizen ? e.notiz || '' : undefined, benoetigt: e.benoetigt || '',
    personen: e.personen.map((p) => {
      const b = pers(p.benutzer_id);
      const x = { benutzerId: p.benutzer_id, name: b.name, rolle: b.rolle, ...(p.kolonne_polier_id ? { kolonnePolierId: p.kolonne_polier_id } : {}) };
      if (notizen) x.notiz = p.notiz || '';
      if (lesestand) { const l = lesestand.get(p.benutzer_id); x.gelesen = Boolean(l && l.gelesen); x.bestaetigt = Boolean(l && l.bestaetigt); }
      return x;
    }),
    anlagen: e.anlagen.map((a) => {
      const st = anlageStatus(K, a.anlage_id) || { anlageId: a.anlage_id };
      const f = a.fahrer_id ? pers(a.fahrer_id) : null;
      return { anlageId: a.anlage_id, nummer: st.nummer, bezeichnung: st.bezeichnung, kennzeichen: st.kennzeichen, status: st.status, gesperrt: st.gesperrt, ...(notizen ? { notiz: a.notiz || '' } : {}), fahrer: f ? { benutzerId: a.fahrer_id, name: f.name } : null };
    }),
    kolonnen: [...kol].map(([polierId, anzahl]) => ({ polierId, name: pers(polierId).name, anzahl })),
    veroeffentlicht: istVeroeffentlicht,
    geaendertNachVeroeffentlichung: istVeroeffentlicht && e.veroeffentlicht_hash !== inhaltsHash(e),
    uebernommen: Boolean(e.uebernommen),
    veroeffentlichtUm: e.veroeffentlicht_zeit || null,
    version: e.version
  };
  if (!notizen) delete o.notiz;
  if (e.vorschau) Object.assign(o, { vorschau: true, quelleDatum: e.quelleDatum, uebersprungen: e.uebersprungen, vortagNotizen: e.vortagNotizen });
  return o;
}

/** Inhalt, der für Veröffentlichung/Änderung zählt */
function inhaltsHash(e) {
  return hash({
    b: e.baustelle_id, be: e.beginn, t: e.treffpunkt, fa: e.fahrzeug_anlage_id, ft: e.fahrzeug_text, ar: e.arbeit, n: e.notiz, bn: e.benoetigt,
    p: e.personen.map((p) => [p.benutzer_id, p.kolonne_polier_id, p.notiz || null]), a: e.anlagen.map((a) => [a.anlage_id, a.notiz || null, a.fahrer_id || null])
  });
}

/** Konflikte eines Tages über alle Einsätze (und Fuhren) */
function konflikteTag(datum, einsaetze, fuhren, K, { voll = false, wetter = new Map() } = {}) {
  const out = [];
  const jePerson = new Map(), jeAnlage = new Map();
  for (const e of einsaetze) {
    for (const p of e.personen) { if (!jePerson.has(p.benutzer_id)) jePerson.set(p.benutzer_id, []); jePerson.get(p.benutzer_id).push(e); }
    for (const a of e.anlagen) { if (!jeAnlage.has(a.anlage_id)) jeAnlage.set(a.anlage_id, []); jeAnlage.get(a.anlage_id).push(e); }
  }
  const ids = (l) => l.map((e) => e.id).filter((x) => x != null);
  const bsName = (e) => { const b = K.baustellen.get(e.baustelle_id); return b ? (b.kurz || b.name) : '?'; };
  for (const [pid, l] of jePerson) {
    const b = K.personen.get(pid) || { name: '?' };
    if (l.length > 1) out.push({ datum, typ: 'person_doppelt', text: `${b.name} ist mehrfach eingeteilt (${l.map(bsName).join(', ')}).`, einsatzIds: ids(l), benutzerId: pid });
    const a = K.abw.get(`${pid}|${datum}`);
    if (a) out.push({ datum, typ: 'abwesenheit', text: `${b.name} eingeteilt, aber ${abwText(a, voll)}.`, einsatzIds: ids(l), benutzerId: pid });
  }
  const anlageKonflikt = (aid, l, quelle) => {
    const st = anlageStatus(K, aid);
    if (!st) return;
    if (st.gesperrt || st.ausgeschieden) out.push({ datum, typ: 'anlage_gesperrt', text: `${st.bezeichnung}${st.kennzeichen ? ` (${st.kennzeichen})` : ''} ist ${st.ausgeschieden ? 'ausgeschieden' : 'gesperrt'}.`, einsatzIds: ids(l), anlageId: aid, ...(quelle ? { fuhreIds: quelle } : {}) });
    else if (st.status === 'faellig') out.push({ datum, typ: 'anlage_faellig', text: `${st.bezeichnung}: Prüfung/Service fällig (Servicebuch).`, einsatzIds: ids(l), anlageId: aid, ...(quelle ? { fuhreIds: quelle } : {}) });
  };
  for (const [aid, l] of jeAnlage) {
    if (l.length > 1) { const st = anlageStatus(K, aid); out.push({ datum, typ: 'anlage_doppelt', text: `${st ? st.bezeichnung : 'Gerät'} ist mehrfach eingeteilt (${l.map(bsName).join(', ')}).`, einsatzIds: ids(l), anlageId: aid }); }
    anlageKonflikt(aid, l, null);
  }
  // Fuhren: nur gesperrt/fällig und Abwesenheit des Fahrers – nie „doppelt“ (12.8b)
  const fuhrAnlagen = new Map();
  for (const f of fuhren || []) {
    if (f.status === 'storniert') continue;
    if (!jeAnlage.has(f.anlage_id)) { if (!fuhrAnlagen.has(f.anlage_id)) fuhrAnlagen.set(f.anlage_id, []); fuhrAnlagen.get(f.anlage_id).push(f.id); }
    if (f.fahrer_id) {
      const a = K.abw.get(`${f.fahrer_id}|${datum}`);
      if (a && !jePerson.has(f.fahrer_id)) out.push({ datum, typ: 'abwesenheit', text: `${(K.personen.get(f.fahrer_id) || {}).name} (Fahrer) ${abwText(a, voll)}.`, einsatzIds: [], fuhreIds: [f.id], benutzerId: f.fahrer_id });
    }
  }
  for (const [aid, fids] of fuhrAnlagen) anlageKonflikt(aid, [], fids);
  for (const e of einsaetze) {
    const w = wetter.get(`${e.baustelle_id}|${datum}`);
    if (w && w.vorschlag) out.push({ datum, typ: 'wetter', text: `${bsName(e)}: ${w.gruende[0] || 'Schlechtwetter möglich'} – Schlechtwetter prüfen.`, einsatzIds: ids([e]) });
  }
  return out;
}

/** Konflikte, die einen bestimmten Einsatz betreffen (anonymisiert für fremde Baustellen) */
function konflikteFuer(e, liste, sichtbar) {
  return liste.filter((k) => (e.id != null ? (k.einsatzIds || []).includes(e.id) : (k.benutzerId && e.personen.some((p) => p.benutzer_id === k.benutzerId)) || (k.anlageId && e.anlagen.some((a) => a.anlage_id === k.anlageId))))
    .map((k) => ({ typ: k.typ, text: sichtbar ? k.text : k.text.replace(/\(([^)]*)\)/, '(andere Baustelle)') }));
}

/* ---------------- Veröffentlichung ---------------- */

/** Inhalt für eine Person an einem Tag aus Einsatz-/Fuhren-Ständen */
function personInhalt(benutzerId, datum, staende, fuhrStaende) {
  const e = staende.find((s) => s.personen.some((p) => p.benutzerId === benutzerId));
  const fuhren = fuhrStaende.filter((f) => f.fahrer && f.fahrer.benutzerId === benutzerId && f.status !== 'storniert');
  if (!e && !fuhren.length) return null;
  let einsatz = null;
  if (e) {
    const ich = e.personen.find((p) => p.benutzerId === benutzerId);
    const fz = e.anlagen.find((a) => a.fahrer && a.fahrer.benutzerId === benutzerId);
    einsatz = {
      einsatzId: e.id, baustelle: { id: e.baustelle.id, kst: e.baustelle.kst, name: e.baustelle.kurz || e.baustelle.name, adresse: e.baustelle.adresse, lat: e.baustelle.lat, lng: e.baustelle.lng },
      beginn: e.beginn, treffpunkt: e.treffpunkt, polier: e.polier || null, fahrzeug: e.fahrzeug, arbeit: e.arbeit, notiz: e.notiz || '', benoetigt: e.benoetigt || '',
      anlagen: e.anlagen.map((a) => ({ bezeichnung: a.bezeichnung, kennzeichen: a.kennzeichen })),
      meineNotiz: (ich && ich.notiz) || '', meinFahrzeug: fz ? { bezeichnung: fz.bezeichnung, kennzeichen: fz.kennzeichen, notiz: fz.notiz || '' } : null
    };
  }
  return { datum, einsatz, fuhren: fuhren.map((f) => require('./fuhren').fuhreFuerFahrer(f)) };
}

/** Kurzbeschreibung einer (veröffentlichten) Fuhre: „Frostschutz 0/63, Grube Breitenau → WHA Pitten“ (G-14) */
function fuhreKurz(f) {
  const mat = (f.material && f.material.name) || f.materialText || 'Fuhre';
  return `${mat}, ${(f.von && f.von.text) || '?'} → ${(f.nach && f.nach.text) || '?'}`;
}

/** Relative Beschriftung (G-05): „heute“, „morgen“ (nur Kalender-Morgen), sonst „am Mo 16.11.“ */
function tagLabel(datum, heute) {
  return datum === heute ? 'heute' : datum === plusTage(heute, 1) ? 'morgen' : `am ${deKurz(datum)}`;
}
/** Für die Partie relevanter Inhalt eines veröffentlichten Stands (ohne Personen-Notizen) – G-12 */
function partieHash(st) {
  return hash([st.baustelleId, st.beginn || null, st.treffpunkt || '', st.arbeit || '', st.fahrzeug || null, st.notiz || '', st.benoetigt || '',
    st.personen.map((p) => p.benutzerId).sort((a, b) => a - b),
    st.anlagen.map((a) => [a.anlageId, a.fahrer ? a.fahrer.benutzerId : null, a.notiz || '']).sort((a, b) => a[0] - b[0])]);
}

function kurzText(inhalt, datum, heute) {
  const l = tagLabel(datum, heute);
  const tag = l.charAt(0).toUpperCase() + l.slice(1);
  const teile = [];
  const e = inhalt.einsatz;
  if (e) {
    let t = `${tag} ${e.beginn ? `${e.beginn} ` : ''}${e.baustelle.name}`;
    if (e.treffpunkt) t += `, Treffpunkt ${e.treffpunkt}`;
    teile.push(t);
    if (e.meinFahrzeug) teile.push(`Fahrzeug: ${e.meinFahrzeug.bezeichnung}`);
  }
  if (inhalt.fuhren.length) {
    const f = inhalt.fuhren[0];
    teile.push(`${e ? '' : `${tag} `}${inhalt.fuhren.length} Fuhre${inhalt.fuhren.length > 1 ? 'n' : ''} · erste ${f.beginn ? `${f.beginn} ` : ''}${f.von.text} → ${f.nach.text}`);
  }
  if (e && (e.meineNotiz || e.benoetigt || (e.meinFahrzeug && e.meinFahrzeug.notiz))) teile.push('Hinweis vorhanden');
  return { tag, text: teile.join(' · ') };
}

/**
 * Veröffentlichen (oder Vorschau ohne Versand) für Tage `von`…`bis`.
 * @param {{ctx, von, bis, trocken, baustellenFilter:(bsId)=>bool, fuhreFilter:(f)=>bool}} o
 */
function veroeffentlichen(bt, o) {
  const { db } = bt;
  const heute = wienDatum(bt.uhr());
  const zeit = bt.uhr().toISOString();
  const empfaenger = [];
  let einsaetzeAnzahl = 0;
  const F = require('./fuhren');
  for (let d = o.von; d <= o.bis; d = plusTage(d, 1)) {
    const K = kontextDaten(db, heute, d, d);
    if (!o.trocken) materialisieren(bt, d, o.ctx.benutzer.id);
    const vs = o.trocken ? vorschauTag(db, d, K) : null;
    const roh = vs ? vs.einsaetze : ladeEinsaetze(db, d, d, { mitGeloeschten: true });
    const imBereich = (e) => o.baustellenFilter(e.baustelle_id);
    // künftige Stände: im Bereich neu, sonst der bisher veröffentlichte Stand
    const staende = [];
    const neueStaende = [];
    for (const e of roh) {
      if (imBereich(e)) {
        if (e.geloescht) continue;
        const st = staendeJson(e, K);
        staende.push(st);
        neueStaende.push({ e, st });
      } else if (e.veroeffentlicht_stand && !e.geloescht) staende.push(JSON.parse(e.veroeffentlicht_stand));
      else if (e.veroeffentlicht_stand && e.geloescht) staende.push(JSON.parse(e.veroeffentlicht_stand)); // fremd gelöscht, noch nicht veröffentlicht
    }
    const fuhrenRoh = db.alle('SELECT * FROM plan_fuhre WHERE datum = ?', d);
    const fuhrStaende = [];
    const neueFuhren = [];
    for (const f of fuhrenRoh) {
      if (o.fuhreFilter(f)) { const st = F.fuhreJson(db, f, K); if (f.status !== 'storniert') fuhrStaende.push(st); neueFuhren.push({ f, st }); } else if (f.veroeffentlicht_stand) fuhrStaende.push(JSON.parse(f.veroeffentlicht_stand));
    }
    // G-14: veröffentlichte Fuhren, die inzwischen storniert (gelöscht) sind
    const stornoFuhren = neueFuhren.filter(({ f }) => f.status === 'storniert' && f.veroeffentlicht_stand).map(({ f }) => JSON.parse(f.veroeffentlicht_stand));
    // betroffene Personen
    const pids = new Set();
    for (const s of staende) for (const p of s.personen) pids.add(p.benutzerId);
    for (const f of fuhrStaende) if (f.fahrer) pids.add(f.fahrer.benutzerId);
    for (const m of db.alle('SELECT benutzer_id FROM plan_mitteilung WHERE datum = ? AND inhalt IS NOT NULL', d)) pids.add(m.benutzer_id);
    const meldungen = [];
    for (const pid of pids) {
      const neu = personInhalt(pid, d, staende, fuhrStaende);
      const alt = db.eins('SELECT * FROM plan_mitteilung WHERE benutzer_id = ? AND datum = ?', pid, d);
      const h = neu ? hash(neu) : null;
      if (alt && alt.hash === h) continue;
      if (!alt && !neu) continue;
      const art = !alt || !alt.inhalt ? 'neu' : neu ? 'geaendert' : 'entfaellt';
      if (!neu && art === 'neu') continue;
      // G-14: stornierte, schon veröffentlichte Fuhren dieser Person ausdrücklich nennen
      const weg = stornoFuhren.filter((f) => f.fahrer && f.fahrer.benutzerId === pid).map(fuhreKurz);
      const altInhalt = alt && alt.inhalt ? JSON.parse(alt.inhalt) : null;
      let titel, text;
      if (art === 'entfaellt') {
        if (weg.length && !(altInhalt && altInhalt.einsatz)) {
          titel = `Fuhre entfällt am ${deKurz(d)}`;
          text = weg.map((x) => `Fuhre entfällt am ${deKurz(d)} (${x})`).join(' · ');
        } else {
          titel = `Einsatz entfällt am ${deKurz(d)}`;
          text = `Ihr Einsatz am ${deKurz(d)} entfällt – bitte die neue Einteilung abwarten bzw. in BauTag nachsehen.${weg.length ? ` ${weg.map((x) => `Fuhre entfällt (${x}).`).join(' ')}` : ''}`;
        }
      } else {
        const k = kurzText(neu, d, heute);
        const ziel = neu.einsatz ? neu.einsatz.baustelle.name : `${neu.fuhren.length} Fuhre${neu.fuhren.length === 1 ? '' : 'n'}`;
        titel = `${art === 'geaendert' ? 'Geändert: ' : ''}Einsatz ${tagLabel(d, heute)}: ${ziel}`;
        text = `${weg.map((x) => `Fuhre ${x} entfällt`).join(' · ')}${weg.length ? ' · ' : ''}${k.text}`;
      }
      meldungen.push({ pid, neu, h, art, alt, titel, text });
      empfaenger.push({ benutzerId: pid, name: (K.personen.get(pid) || {}).name, art, datum: d, titel, text });
    }
    // Poliere: je Einsatz nur bei für die Partie relevanten Änderungen (G-12: reine Personen-Notizen nicht –
    // die betroffene Person bekommt ihre eigene Meldung); erscheinen auch in der Vorschau (art "partie")
    const polierMeldungen = [];
    for (const { e, st } of neueStaende) {
      const h = partieHash(st);
      const alt = e.veroeffentlicht_stand ? JSON.parse(e.veroeffentlicht_stand) : null;
      if (alt && partieHash(alt) === h) continue;
      const bs = K.baustellen.get(e.baustelle_id) || {};
      const poliere = new Set([...(bs.polier_id ? [bs.polier_id] : []), ...e.personen.filter((p) => p.kolonne_polier_id).map((p) => p.kolonne_polier_id)]);
      const titel = `Ihre Partie ${tagLabel(d, heute)}: ${st.baustelle.kurz || st.baustelle.name}`;
      const text = `${st.personen.length} Person${st.personen.length === 1 ? '' : 'en'}, ${st.anlagen.length} Gerät${st.anlagen.length === 1 ? '' : 'e'} – ${st.baustelle.kst} ${st.baustelle.kurz || st.baustelle.name}${st.beginn ? `, Beginn ${st.beginn}` : ''}.`;
      for (const pol of poliere) {
        polierMeldungen.push({ pol, e, st, h, titel, text });
        empfaenger.push({ benutzerId: pol, name: (K.personen.get(pol) || {}).name, art: 'partie', datum: d, baustelleId: e.baustelle_id, titel, text });
      }
    }
    if (o.trocken) continue;
    einsaetzeAnzahl += neueStaende.length;
    db.transaktion(() => {
      for (const { e, st } of neueStaende) db.lauf('UPDATE plan_einsatz SET veroeffentlicht_stand = ?, veroeffentlicht_hash = ?, veroeffentlicht_zeit = ? WHERE id = ?', JSON.stringify(st), inhaltsHash(e), zeit, e.id);
      for (const e of roh) if (e.geloescht && imBereich(e)) db.lauf('DELETE FROM plan_einsatz WHERE id = ?', e.id);
      for (const { f, st } of neueFuhren) db.lauf('UPDATE plan_fuhre SET veroeffentlicht_stand = ?, veroeffentlicht_hash = ?, veroeffentlicht_zeit = ? WHERE id = ?', f.status === 'storniert' ? null : JSON.stringify(st), f.status === 'storniert' ? null : F.fuhreHash(st), zeit, f.id);
      for (const m of meldungen) {
        db.lauf(`INSERT INTO plan_mitteilung (benutzer_id, datum, inhalt, hash, zeit, gelesen, bestaetigt) VALUES (?, ?, ?, ?, ?, NULL, NULL)
          ON CONFLICT(benutzer_id, datum) DO UPDATE SET inhalt = excluded.inhalt, hash = excluded.hash, zeit = excluded.zeit, gelesen = NULL, bestaetigt = NULL`, m.pid, d, m.neu ? JSON.stringify(m.neu) : null, m.h, zeit);
        // Titel/Text wie in der Vorschau (G-12/G-14: Vorschau = Versand)
        if (m.art === 'entfaellt') benachrichtige(db, { benutzerId: m.pid, typ: 'plan', titel: m.titel, text: m.text, zeit, schluessel: `plan:${d}:weg:${zeit}` });
        else benachrichtige(db, { benutzerId: m.pid, typ: 'plan', titel: m.titel, text: m.text, zeit, baustelleId: m.neu.einsatz ? m.neu.einsatz.baustelle.id : null, schluessel: `plan:${d}:${m.h}` });
      }
      for (const { pol, e, h, titel, text } of polierMeldungen) {
        benachrichtige(db, { benutzerId: pol, typ: 'plan', titel, text, zeit, baustelleId: e.baustelle_id, schluessel: `plan:polier:${e.id}:${h}` });
      }
      db.protokolliere({ zeit, benutzerId: o.ctx.benutzer.id, art: 'plan', objekt: `plan:${d}`, neu: { einsaetze: neueStaende.length, fuhren: neueFuhren.length, meldungen: meldungen.length }, text: `Einteilung ${de(d)} veröffentlicht (${meldungen.length} Personen benachrichtigt)` });
    });
  }
  return { empfaenger, anzahl: empfaenger.length, einsaetze: einsaetzeAnzahl };
}

/** Veröffentlichter Stand eines Einsatzes (mit Polier der Baustelle) */
function staendeJson(e, K) {
  const st = einsatzJson(e, K, { notizen: true });
  const bs = K.baustellen.get(e.baustelle_id) || {};
  const pol = bs.polier_id ? K.personen.get(bs.polier_id) : null;
  st.polier = pol ? { id: bs.polier_id, name: pol.name } : null;
  delete st.veroeffentlicht; delete st.geaendertNachVeroeffentlichung;
  return st;
}

/** Erinnerung an die Planer (12.8a, geändert 13.11.2026): einmal je Tag ab planErinnerung, veröffentlicht nichts */
function pruefeErinnerung(bt) {
  const { db } = bt;
  const E = einstellungen(db);
  if (!E.planErinnerung) return;
  const jetzt = bt.uhr();
  const heute = wienDatum(jetzt);
  const uhrzeit = require('./datum').wienZeit(jetzt);
  if (uhrzeit < E.planErinnerung || db.einstellung('plan_erinnerung_tag', null) === heute) return;
  db.setzeEinstellung('plan_erinnerung_tag', heute);
  const n = naechsterArbeitstag(heute);
  const K = kontextDaten(db, heute, n, n);
  const vs = vorschauTag(db, n, K);
  let offen = []; // [{baustelleId, text}]
  if (vs) {
    offen = vs.einsaetze.map((e) => ({ baustelleId: e.baustelle_id, text: '' }));
    if (!offen.length) return;
  } else {
    const roh = ladeEinsaetze(db, n, n, { mitGeloeschten: true });
    offen = roh.filter((e) => e.geloescht ? e.veroeffentlicht_stand : (!e.veroeffentlicht_zeit || e.veroeffentlicht_hash !== inhaltsHash(e))).map((e) => ({ baustelleId: e.baustelle_id }));
    if (!offen.length) return;
  }
  const abw = vs ? vs.uebersprungen.map((u) => u.text) : [];
  const text = vs
    ? `Die Einteilung für ${deKurz(n)} ist nur als Vorschau (wie ${de(vs.quelleDatum)}) vorhanden.${abw.length ? ` Abweichungen: ${abw.join('; ')}.` : ''} Bitte prüfen und veröffentlichen.`
    : `${offen.length} Einsatz/Einsätze für ${deKurz(n)} sind geändert, aber noch nicht veröffentlicht.`;
  const zeit = jetzt.toISOString();
  // G-05: Freitag/vor Feiertagen ist „morgen“ der nächste Arbeitstag – im Titel ausdrücklich benennen
  const WT_LANG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const fuer = n === plusTage(heute, 1) ? 'morgen' : `${WT_LANG[wochentag(n)]} ${n.slice(8, 10)}.${n.slice(5, 7)}.`;
  const titel = `Einteilung für ${fuer} noch nicht veröffentlicht`;
  // 15.3: an alle Planer über das Recht stammdaten (Bauleiter = Büro, gleicher Text); nie nach Rollennamen
  for (const b of empfaengerMitRecht(db, 'stammdaten')) {
    benachrichtige(db, { benutzerId: b.id, typ: 'plan', titel, text, zeit, schluessel: `plan:erinnerung:${heute}` });
  }
}

module.exports = {
  PLANBAR, CODE_TEXT, hash, de, deKurz, naechsterArbeitstag, vorigerArbeitstag, einstellungen, kontextDaten, anlageStatus, abwText,
  ladeEinsaetze, ladeEinsatz, vorschauTag, materialisieren, einsatzJson, inhaltsHash, konflikteTag, konflikteFuer, personInhalt, kurzText,
  veroeffentlichen, staendeJson, pruefeErinnerung, feiertag, tagLabel, partieHash
};
