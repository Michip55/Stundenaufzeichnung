'use strict';
const v = require('../validierung');
const { ApiFehler, ungueltig, keinZugriff, nichtGefunden, konflikt } = require('../fehler');
const { baustelleImBereich, darfPreise, bereich } = require('../rechte');
const { ladeBaustelle, personalVorschlag, kostenTagFuer, parseJson, schichtenAmTag } = require('../daten');
const { stundenAusBloecken, blockZeitleiste, bloeckeAlsZeitpunkte } = require('../stempel');
const { wienDatum, wienZeit, plusTage } = require('../datum');
const { pruefeBudget, benachrichtige } = require('../budget');
const { erzeugeBerichtPdf } = require('../pdf');
const { bildHash } = require('../db');

const CODES = ['K', 'U', 'SW', 'ZA'];
const WETTER_SCHLUESSEL = ['text', 'temperatur', 'niederschlag', 'wind', 'quelle'];
/** Optimistische Sperre (C-08) */
function pruefeBerichtVersion(body, b, pflicht) {
  if (body.version === undefined && !pflicht) return;
  const version = v.zahl(body.version, 'version', { min: 1, max: 1e9, ganz: true });
  if (version !== b.version) throw konflikt('Der Bericht wurde inzwischen von jemand anderem geändert. Bitte neu laden – Ihre Änderung wurde nicht gespeichert.', { version: b.version });
}

const GESPERRT_TEXT = 'Der Bericht ist bereits unterschrieben (Auftragnehmer/Bauherr) – Inhalt gesperrt. Unterschrift zurückziehen, um zu ändern.';
const MAX_PNG_BYTES = 400 * 1024;

/* ---------- Laden ---------- */

function ladeBerichtRoh(db, id) {
  const b = db.eins('SELECT * FROM bericht WHERE id = ?', id);
  if (!b) return null;
  b.personal = db.alle(`SELECT bp.*, u.name FROM bericht_personal bp JOIN benutzer u ON u.id = bp.benutzer_id
    WHERE bp.bericht_id = ? ORDER BY bp.pos, bp.id`, id);
  b.geraete = db.alle(`SELECT bg.geraet_id, bg.stunden, bg.anlage_id, g.code, COALESCE(bg.name, g.name) AS name, g.sortierung FROM bericht_geraet bg JOIN geraet g ON g.id = bg.geraet_id
    WHERE bg.bericht_id = ? ORDER BY g.sortierung, g.id`, id);
  b.material = db.alle(`SELECT bm.material_id, bm.menge, m.code, COALESCE(bm.name, m.name) AS name, COALESCE(bm.einheit, m.einheit) AS einheit, m.vorlage, m.sortierung FROM bericht_material bm JOIN material m ON m.id = bm.material_id
    WHERE bm.bericht_id = ? ORDER BY m.sortierung, m.id`, id);
  b.regie = db.alle('SELECT text, stunden FROM bericht_regie WHERE bericht_id = ? ORDER BY pos, id', id);
  b.unterschriften = db.alle('SELECT u.*, b.name AS erfasst_von_name FROM unterschrift u LEFT JOIN benutzer b ON b.id = u.erfasst_von WHERE u.bericht_id = ?', id);
  b.baustelle = ladeBaustelle(db, b.baustelle_id);
  return b;
}

const r2 = (x) => Math.round(x * 100) / 100;

function berichtJson(db, ctx, b, { mitBild = true } = {}) {
  const bs = b.baustelle;
  const unterschriften = {};
  for (const u of b.unterschriften) {
    unterschriften[u.rolle] = { name: u.name, zeit: u.zeit, ...(mitBild && u.bild_png ? { bildPng: u.bild_png } : {}) };
  }
  const o = {
    id: b.id,
    baustelleId: bs.id,
    baustelle: {
      id: bs.id, kst: bs.kst, name: bs.name, kurz: bs.kurz, auftraggeber: bs.auftraggeber, agAdresse: bs.ag_adresse,
      bauvorhaben: bs.bauvorhaben, adresse: bs.adresse, bauherrVertreter: bs.bauherr_vertreter, polierId: bs.polier_id, bauleiterId: bs.bauleiter_id
    },
    datum: b.datum,
    status: b.status,
    // Datenschutz (server/datenschutz.js): Polier/Mitarbeiter sehen keine fremden Abwesenheiten, K nur mit Recht
    personal: require('../datenschutz').berichtPersonal(ctx, b.personal.map((p) => ({
      benutzerId: p.benutzer_id, name: p.name, von1: p.von1, bis1: p.bis1, von2: p.von2, bis2: p.bis2,
      pauseMin: p.pause_min, stunden: p.stunden, code: p.code, segStunden: p.seg_stunden, ...(p.hinweis ? { hinweis: p.hinweis } : {}), ...(p.gast ? { gast: true } : {})
    }))),
    gesamtstunden: r2(b.personal.reduce((a, p) => a + p.stunden, 0)),
    seg: { taetigkeit: b.seg_taetigkeit || '', stunden: b.seg_stunden },
    geraete: b.geraete.map((g) => ({ geraetId: g.geraet_id, code: g.code, name: g.name, stunden: g.stunden, ...(g.anlage_id ? { anlageId: g.anlage_id } : {}) })),
    material: b.material.map((m) => {
      // 12.8d: Anteil aus Fuhren
      const aus = Math.round((db.eins("SELECT COALESCE(SUM(bericht_menge), 0) AS s FROM plan_fuhre WHERE bericht_id = ? AND material_id = ? AND bericht_status = 'uebernommen'", b.id, m.material_id).s) * 1000) / 1000;
      const quelle = aus <= 0 ? null : aus >= m.menge - 0.0005 ? 'fuhre' : 'gemischt';
      return { materialId: m.material_id, code: m.code, name: m.name, menge: m.menge, einheit: m.einheit, ausFuhren: aus, quelle };
    }),
    arbeitsleistung: b.arbeitsleistung,
    materialbeistellung: { eigen: b.mb_eigen, fremd: b.mb_fremd },
    paletten: { euro: b.paletten_euro, weissenboeck: b.paletten_weissenboeck },
    regie: b.regie.map((r) => ({ text: r.text, stunden: r.stunden })),
    vorkommnisse: b.vorkommnisse,
    wetter: parseJson(b.wetter, null),
    unterschriften,
    freigabe: b.freigegeben_zeit ? { benutzerId: b.freigegeben_von, zeit: b.freigegeben_zeit } : null,
    erstellt: b.erstellt,
    geaendert: b.geaendert,
    version: b.version,
    geaendertNachUnterschrift: parseJson(b.geaendert_nach_unterschrift, null),
    selbstfreigabe: b.selbstfreigabe === 1,
    bearbeitbar: b.status === 'entwurf' && !b.unterschriften.length
  };
  if (darfPreise(ctx, bs)) o.kostenTag = kostenTagFuer(db, b.id);
  anlagenZumBericht(db, b, o);
  // API.md 12.4: Schlechtwetter-Vorschlag aus dem Wetter-Zwischenspeicher
  const w = require('../wetter').wetterAusCache(db, bs, b.datum);
  if (w) o.wetterVorschlag = w.schlechtwetter;
  // API.md 12.5: Versandstand der E-Mails an den Auftraggeber
  if (ctx.hat && (ctx.hat('bericht_freigeben') || ctx.hat('stammdaten'))) {
    o.emailVersand = db.alle("SELECT id, erstellt, gesendet, an, status, fehler FROM mail_ausgang WHERE bezug = ? ORDER BY id", `bericht:${b.id}`)
      .map((m) => ({ id: m.id, zeit: m.gesendet || m.erstellt, an: m.an, status: m.status, ...(m.fehler ? { fehler: m.fehler } : {}) }));
  }
  if (typeof module.exports.fotosJson === 'function') o.fotos = module.exports.fotosJson(db, b.id);
  if (typeof module.exports.fuhrenVorschlag === 'function') o.fuhrenVorschlag = module.exports.fuhrenVorschlag(db, b); // 12.8b
  return o;
}

/** Servicebuch (API.md 11.4): Anlage je Gerätezeile (manuell oder automatisch) und Vorschlag je Gerät */
function anlagenZumBericht(db, b, o, S) {
  const { ladeStand } = require('../fuhrpark-daten');
  S = S || ladeStand(db, wienDatum(db.uhr ? db.uhr() : new Date()));
  const aktivJeGeraet = new Map();
  for (const A of S.liste) if (!A.row.ausgeschieden && A.row.geraet_id) {
    if (!aktivJeGeraet.has(A.row.geraet_id)) aktivJeGeraet.set(A.row.geraet_id, []);
    aktivJeGeraet.get(A.row.geraet_id).push(A);
  }
  for (const g of o.geraete) {
    let A = g.anlageId ? S.anlagen.get(g.anlageId) : null, zuordnung = 'manuell';
    if (!A) { const k = aktivJeGeraet.get(g.geraetId) || []; if (k.length === 1) { A = k[0]; zuordnung = 'auto'; } }
    if (A) g.anlage = { id: A.row.id, bezeichnung: A.row.bezeichnung, kennzeichen: A.row.kennzeichen, status: A.status.status, gesperrt: A.status.gesperrt, zuordnung };
  }
  const vorschlag = {};
  for (const z of db.alle(`SELECT bg.geraet_id, bg.anlage_id FROM bericht_geraet bg JOIN bericht r ON r.id = bg.bericht_id
      WHERE r.baustelle_id = ? AND bg.anlage_id IS NOT NULL AND r.datum <= ? ORDER BY r.datum, r.id`, b.baustelle_id, b.datum)) {
    const A = S.anlagen.get(z.anlage_id);
    if (A && !A.row.ausgeschieden) vorschlag[z.geraet_id] = z.anlage_id;
  }
  o.anlagenVorschlag = vorschlag;
  return S;
}

/* ---------- Rechte ---------- */

function pruefeLesen(ctx, bs) {
  if (!ctx.hat('bericht_erstellen') && !ctx.hat('bericht_freigeben')) throw keinZugriff('Bautagesberichte sind für Ihre Rolle nicht freigeschaltet.');
  if (!baustelleImBereich(ctx.benutzer, bs)) throw keinZugriff('Dieser Bericht gehört zu einer Baustelle außerhalb Ihres Bereichs.');
}
function pruefeSchreiben(ctx, bs) {
  if (!ctx.hat('bericht_erstellen')) throw keinZugriff('Berichte erstellen ist für Ihre Rolle nicht freigeschaltet.');
  if (!baustelleImBereich(ctx.benutzer, bs)) throw keinZugriff('Dieser Bericht gehört zu einer Baustelle außerhalb Ihres Bereichs.');
}

/* ---------- Validierung Teil-Update ---------- */

function mehrzeilig(wert, feld, max = 5000) {
  if (wert === null || wert === undefined) return '';
  if (Array.isArray(wert)) {
    v.liste(wert, feld, { max: 50 });
    return wert.map((x, i) => v.text(x, `${feld}[${i}]`, { max: 500, pflicht: false }) || '').filter(Boolean).join('\n');
  }
  return v.text(wert, feld, { max, pflicht: false }) || '';
}

const PERSONAL_ROLLEN = ['mitarbeiter', 'polier'];
const iv = (a, b) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
const hmZ = (t) => wienZeit(new Date(t));

/**
 * Personalzeilen prüfen (C-01, C-02, C-10).
 * - nur Rollen mitarbeiter/polier; Partie der Baustelle, auf ihr gestempelt oder ausdrücklich gast:true
 * - Stunden rechnet immer der Server (echte Zeitpunkte Europe/Vienna); mitgesendete Stunden zählen nicht
 * - keine Überschneidung mit Stempelzeiten auf anderen Baustellen oder Zeilen anderer Berichte desselben Tages
 * @param {{baustelle:object, datum:string, berichtId:number|null, jetzt:Date}} kontext
 */
function pruefePersonal(db, liste, kontext) {
  const { baustelle: bs, datum, berichtId, jetzt } = kontext;
  v.liste(liste, 'personal', { max: 80 });
  const gesehen = new Set();
  const schichtenTag = schichtenAmTag(db, datum, jetzt);
  const vortag = schichtenAmTag(db, plusTage(datum, -1), jetzt);
  const folgetag = schichtenAmTag(db, plusTage(datum, 1), jetzt);
  return liste.map((p, i) => {
    const f = `personal[${i}]`;
    v.objekt(p, f);
    const benutzerId = v.id(p.benutzerId, `${f}.benutzerId`);
    if (gesehen.has(benutzerId)) throw ungueltig(`${f}: Person ist doppelt eingetragen.`);
    gesehen.add(benutzerId);
    const person = db.eins('SELECT id, name, rolle, baustelle_id FROM benutzer WHERE id = ?', benutzerId);
    if (!person) throw ungueltig(`${f}: Mitarbeiter nicht gefunden.`);
    if (!PERSONAL_ROLLEN.includes(person.rolle)) throw ungueltig(`${f}: ${person.name} (Bauleitung/Büro/Geschäftsführung) kann nicht als Personal in einen Bautagesbericht eingetragen werden.`);
    const gast = p.gast === undefined || p.gast === null ? false : v.bool(p.gast, `${f}.gast`);
    const eigene = [...(vortag.get(benutzerId) || []), ...(schichtenTag.get(benutzerId) || []), ...(folgetag.get(benutzerId) || [])];
    const gestempeltHier = (schichtenTag.get(benutzerId) || []).some((sch) => [...sch.intervalle, ...(sch.intervalleRoh || [])].some((x) => x.art === 'arbeit' && x.baustelleId === bs.id));
    const partie = person.baustelle_id === bs.id || bs.polier_id === benutzerId;
    if (!partie && !gestempeltHier && !gast) {
      throw ungueltig(`${f}: ${person.name} gehört nicht zur Partie dieser Baustelle und hat hier nicht gestempelt – nur als Gast eintragen (gast:true).`);
    }
    const z = {
      von1: v.uhrzeit(p.von1, `${f}.von1`), bis1: v.uhrzeit(p.bis1, `${f}.bis1`),
      von2: v.uhrzeit(p.von2, `${f}.von2`), bis2: v.uhrzeit(p.bis2, `${f}.bis2`)
    };
    for (const [a, b, n] of [['von1', 'bis1', '1'], ['von2', 'bis2', '2']]) {
      if (Boolean(z[a]) !== Boolean(z[b])) throw ungueltig(`${f}: Zeitblock ${n} braucht von und bis.`);
      if (z[a] && z[a] === z[b]) throw ungueltig(`${f}: Zeitblock ${n} – „von“ und „bis“ sind gleich.`);
    }
    if (z.von2 && !z.von1) throw ungueltig(`${f}: Zeitblock 2 ohne Zeitblock 1.`);
    // „bis“ vor „von“ = über Mitternacht (nächster Tag); gesamte Spanne höchstens 24 Std.
    if (blockZeitleiste(z, datum).spanneMin > 24 * 60) throw ungueltig(`${f}: Die Zeitblöcke umfassen mehr als 24 Stunden.`);
    const pauseMin = v.zahl(p.pauseMin ?? 0, `${f}.pauseMin`, { min: 0, max: 600, ganz: true });
    // R-01: „abwesend“ ist die maskierte Anzeige eines Krankenstands – beim Speichern bleibt der gespeicherte Code
    let code;
    if (p.code === 'abwesend') {
      const alt = berichtId ? db.eins('SELECT code FROM bericht_personal WHERE bericht_id = ? AND benutzer_id = ?', berichtId, benutzerId) : null;
      const abw = db.eins("SELECT code FROM abwesenheit WHERE benutzer_id = ? AND datum = ? AND status = 'genehmigt'", benutzerId, datum);
      code = alt && alt.code ? alt.code : abw ? abw.code : null;
      if (!code) throw ungueltig(`${f}.code: „abwesend“ ist nur für eingetragene Abwesenheiten möglich.`);
    } else code = p.code === '' || p.code === null || p.code === undefined ? null : v.auswahl(p.code, `${f}.code`, CODES);
    // C-02: Stunden immer aus Zeiten und Pause (echte Zeitpunkte, C-10); mitgesendete Stunden werden ignoriert
    const stunden = stundenAusBloecken({ ...z, pauseMin }, datum);
    if (z.von1 && pauseMin > 0 && stunden === 0) throw ungueltig(`${f}: Die Pause ist länger als die Arbeitszeit.`);
    const segStunden = v.zahl(p.segStunden ?? 0, `${f}.segStunden`, { min: 0, max: 24 });
    if (segStunden > stunden) throw ungueltig(`${f}: SEG-Stunden dürfen die Arbeitsstunden nicht übersteigen.`);
    // C-01: Überschneidungen
    const zeilenIv = bloeckeAlsZeitpunkte(datum, z);
    if (zeilenIv.length) {
      for (const sch of eigene) {
        for (const x of sch.intervalle) {
          // D-03: auch die eigene Baustelle, wenn die Schicht zu einem anderen Berichtstag gehört
          if (x.art !== 'arbeit' || (x.baustelleId === bs.id && sch.datum === datum)) continue;
          if (zeilenIv.some((r) => iv(r, [x.von, x.bis]) > 0)) {
            const kst = (db.eins('SELECT kst FROM baustelle WHERE id = ?', x.baustelleId) || {}).kst || '?';
            throw ungueltig(`${f}: ${person.name} ist von ${hmZ(x.von)} bis ${hmZ(x.bis)} auf Baustelle ${kst} gestempelt${sch.datum !== datum ? ` (Schicht vom ${sch.datum.split('-').reverse().join('.')})` : ''} – die Zeiten überschneiden sich.`);
          }
        }
      }
      for (const o of db.alle(`SELECT bp.von1, bp.bis1, bp.von2, bp.bis2, r.id, r.datum, b.kst FROM bericht_personal bp JOIN bericht r ON r.id = bp.bericht_id
          JOIN baustelle b ON b.id = r.baustelle_id WHERE bp.benutzer_id = ? AND r.datum BETWEEN ? AND ? AND r.id <> ?`, benutzerId, plusTage(datum, -1), plusTage(datum, 1), berichtId || -1)) {
        const oIv = bloeckeAlsZeitpunkte(o.datum, o); // D-03: echte Zeitpunkte des jeweiligen Berichtstags
        if (zeilenIv.some((r) => oIv.some((x) => iv(r, x) > 0))) {
          throw ungueltig(`${f}: ${person.name} steht zur selben Zeit bereits im Bericht von Baustelle ${o.kst} vom ${o.datum.split('-').reverse().join('.')} (${o.von1}–${o.bis2 || o.bis1}).`);
        }
      }
    }
    return { benutzerId, ...z, pauseMin, stunden: r2(stunden), code, segStunden, gast: gast && !partie && !gestempeltHier, name: person.name };
  });
}

function pruefeUpdate(db, body, kontext) {
  const u = {};
  if (body.personal !== undefined) u.personal = pruefePersonal(db, body.personal, kontext);
  if (body.seg !== undefined) {
    const s = body.seg === null ? {} : v.objekt(body.seg, 'seg');
    u.seg = { taetigkeit: v.text(s.taetigkeit ?? '', 'seg.taetigkeit', { max: 300, pflicht: false }) || '', stunden: v.zahl(s.stunden, 'seg.stunden', { min: 0, max: 1000, pflicht: false }) };
  }
  if (body.geraete !== undefined) {
    v.liste(body.geraete, 'geraete', { max: 100 });
    const gesehen = new Map();
    u.geraete = body.geraete.map((g, i) => {
      v.objekt(g, `geraete[${i}]`);
      const geraetId = v.id(g.geraetId, `geraete[${i}].geraetId`);
      const ge = db.eins('SELECT id, aktiv FROM geraet WHERE id = ?', geraetId);
      if (!ge) throw ungueltig(`geraete[${i}]: Gerät nicht gefunden.`);
      // 12.8d: deaktivierte Einträge nur, wenn sie schon im Bericht standen
      if (!ge.aktiv && !(kontext.berichtId && db.eins('SELECT 1 AS x FROM bericht_geraet WHERE bericht_id = ? AND geraet_id = ?', kontext.berichtId, geraetId))) throw new ApiFehler(422, 'UNGUELTIG', `geraete[${i}]: Eintrag ist deaktiviert.`);
      let anlageId = null;
      if (g.anlageId !== undefined && g.anlageId !== null) {
        anlageId = v.id(g.anlageId, `geraete[${i}].anlageId`);
        const a = db.eins('SELECT id, geraet_id, ausgeschieden, bezeichnung FROM anlage WHERE id = ?', anlageId);
        if (!a || a.geraet_id !== geraetId) throw ungueltig(`geraete[${i}]: Die Anlage gehört nicht zu diesem Gerät.`);
        if (a.ausgeschieden) throw ungueltig(`geraete[${i}]: ${a.bezeichnung} ist ausgeschieden.`);
      }
      // F-11: dasselbe Gerät mehrfach nur mit verschiedenen, gewählten Anlagen (z. B. zwei Radlader)
      if (gesehen.has(geraetId) && (!anlageId || gesehen.get(geraetId).has(null) || gesehen.get(geraetId).has(anlageId))) {
        throw ungueltig(`geraete[${i}]: Gerät ist doppelt eingetragen (mehrfach nur mit verschiedenen Anlagen).`);
      }
      if (!gesehen.has(geraetId)) gesehen.set(geraetId, new Set());
      gesehen.get(geraetId).add(anlageId);
      return { geraetId, anlageId, stunden: v.zahl(g.stunden, `geraete[${i}].stunden`, { min: 0, max: 24 }) };
    }).filter((g) => g.stunden > 0);
  }
  if (body.material !== undefined) {
    v.liste(body.material, 'material', { max: 100 });
    const gesehen = new Set();
    u.material = body.material.map((m, i) => {
      v.objekt(m, `material[${i}]`);
      const materialId = v.id(m.materialId, `material[${i}].materialId`);
      if (gesehen.has(materialId)) throw ungueltig(`material[${i}]: Material ist doppelt eingetragen.`);
      gesehen.add(materialId);
      const ma = db.eins('SELECT id, aktiv FROM material WHERE id = ?', materialId);
      if (!ma) throw ungueltig(`material[${i}]: Material nicht gefunden.`);
      if (!ma.aktiv && !(kontext.berichtId && db.eins('SELECT 1 AS x FROM bericht_material WHERE bericht_id = ? AND material_id = ?', kontext.berichtId, materialId))) throw new ApiFehler(422, 'UNGUELTIG', `material[${i}]: Eintrag ist deaktiviert.`);
      return { materialId, menge: v.zahl(m.menge, `material[${i}].menge`, { min: 0, max: 100000 }) };
    }).filter((m) => m.menge > 0);
  }
  if (body.regie !== undefined) {
    v.liste(body.regie, 'regie', { max: 50 });
    u.regie = body.regie.map((r, i) => {
      v.objekt(r, `regie[${i}]`);
      return { text: v.text(r.text, `regie[${i}].text`, { max: 500 }), stunden: v.zahl(r.stunden, `regie[${i}].stunden`, { min: 0, max: 500 }) };
    });
  }
  if (body.arbeitsleistung !== undefined) u.arbeitsleistung = mehrzeilig(body.arbeitsleistung, 'arbeitsleistung', 10000);
  if (body.vorkommnisse !== undefined) u.vorkommnisse = mehrzeilig(body.vorkommnisse, 'vorkommnisse', 10000);
  if (body.materialbeistellung !== undefined) {
    const m = body.materialbeistellung === null ? {} : v.objekt(body.materialbeistellung, 'materialbeistellung');
    u.materialbeistellung = { eigen: mehrzeilig(m.eigen, 'materialbeistellung.eigen'), fremd: mehrzeilig(m.fremd, 'materialbeistellung.fremd') };
  }
  if (body.paletten !== undefined) {
    const p = body.paletten === null ? {} : v.objekt(body.paletten, 'paletten');
    u.paletten = {
      euro: v.zahl(p.euro ?? 0, 'paletten.euro', { min: 0, max: 10000, ganz: true }),
      weissenboeck: v.zahl(p.weissenboeck ?? 0, 'paletten.weissenboeck', { min: 0, max: 10000, ganz: true })
    };
  }
  if (body.wetter !== undefined) {
    const w = body.wetter;
    if (w === null || w === '') u.wetter = null;
    else if (typeof w === 'string') u.wetter = v.text(w, 'wetter', { max: 200 });
    else {
      v.objekt(w, 'wetter');
      const keys = Object.keys(w);
      if (keys.length > 10) throw ungueltig('wetter: zu viele Angaben.');
      for (const k of keys) {
        if (!WETTER_SCHLUESSEL.includes(k)) throw ungueltig(`wetter.${k} ist unbekannt (erlaubt: ${WETTER_SCHLUESSEL.join(', ')}).`);
        const x = w[k];
        if (!(x === null || typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x)) || (typeof x === 'string' && x.length <= 200))) throw ungueltig(`wetter.${k} ist ungültig.`);
      }
      u.wetter = w;
    }
  }
  return u;
}

function speichereUpdate(db, berichtId, u, zeit) {
  if (u.personal) {
    db.lauf('DELETE FROM bericht_personal WHERE bericht_id = ?', berichtId);
    u.personal.forEach((p, i) => db.lauf(`INSERT INTO bericht_personal (bericht_id, benutzer_id, von1, bis1, von2, bis2, pause_min, stunden, seg_stunden, code, pos)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, berichtId, p.benutzerId, p.von1, p.bis1, p.von2, p.bis2, p.pauseMin, p.stunden, p.segStunden || 0, p.code, i));
    u.personal.forEach((p) => {
      if (p.hinweis) db.lauf('UPDATE bericht_personal SET hinweis = ? WHERE bericht_id = ? AND benutzer_id = ?', p.hinweis, berichtId, p.benutzerId);
      if (p.gast) db.lauf('UPDATE bericht_personal SET gast = 1 WHERE bericht_id = ? AND benutzer_id = ?', berichtId, p.benutzerId);
    });
  }
  if (u.geraete) {
    db.lauf('DELETE FROM bericht_geraet WHERE bericht_id = ?', berichtId);
    for (const g of u.geraete) db.lauf('INSERT INTO bericht_geraet (bericht_id, geraet_id, stunden, anlage_id) VALUES (?, ?, ?, ?)', berichtId, g.geraetId, g.stunden, g.anlageId || null);
  }
  if (u.material) {
    db.lauf('DELETE FROM bericht_material WHERE bericht_id = ?', berichtId);
    for (const m of u.material) db.lauf('INSERT INTO bericht_material (bericht_id, material_id, menge) VALUES (?, ?, ?)', berichtId, m.materialId, m.menge);
  }
  if (u.regie) {
    db.lauf('DELETE FROM bericht_regie WHERE bericht_id = ?', berichtId);
    u.regie.forEach((r, i) => db.lauf('INSERT INTO bericht_regie (bericht_id, text, stunden, pos) VALUES (?, ?, ?, ?)', berichtId, r.text, r.stunden, i));
  }
  const set = {};
  if (u.seg) { set.seg_taetigkeit = u.seg.taetigkeit; set.seg_stunden = u.seg.stunden; }
  if (u.arbeitsleistung !== undefined) set.arbeitsleistung = u.arbeitsleistung;
  if (u.vorkommnisse !== undefined) set.vorkommnisse = u.vorkommnisse;
  if (u.materialbeistellung) { set.mb_eigen = u.materialbeistellung.eigen; set.mb_fremd = u.materialbeistellung.fremd; }
  if (u.paletten) { set.paletten_euro = u.paletten.euro; set.paletten_weissenboeck = u.paletten.weissenboeck; }
  if (u.wetter !== undefined) set.wetter = u.wetter === null ? null : JSON.stringify(u.wetter);
  set.geaendert = zeit;
  const k = Object.keys(set);
  db.lauf(`UPDATE bericht SET ${k.map((x) => `${x} = ?`).join(', ')}, version = version + 1 WHERE id = ?`, ...k.map((x) => set[x]), berichtId);
}

function pruefePng(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) throw ungueltig('bildPng muss ein PNG als data-URL sein (data:image/png;base64,…).');
  const b64 = dataUrl.slice('data:image/png;base64,'.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw ungueltig('bildPng: ungültige Base64-Daten.');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > MAX_PNG_BYTES) throw ungueltig('bildPng ist zu groß (max. 400 KB).');
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) throw ungueltig('bildPng ist kein gültiges PNG.');
  return dataUrl;
}

module.exports = function berichtRouten(api, bt) {
  const { db } = bt;
  const jetzt = () => bt.uhr().toISOString();

  function ladeMitZugriff(req, schreiben) {
    const id = v.pfadId(req.params.id, 'Berichts-ID');
    const b = ladeBerichtRoh(db, id);
    if (!b) throw nichtGefunden('Bericht nicht gefunden.');
    if (schreiben) pruefeSchreiben(req.ctx, b.baustelle); else pruefeLesen(req.ctx, b.baustelle);
    return b;
  }

  api.get('/berichte', (req, res) => {
    const ctx = req.ctx;
    if (!ctx.hat('bericht_erstellen') && !ctx.hat('bericht_freigeben')) throw keinZugriff('Bautagesberichte sind für Ihre Rolle nicht freigeschaltet.');
    const q = req.query;
    const bedingungen = [];
    const p = [];
    // Bereich schon in SQL (vor LIMIT)
    const ber = bereich(ctx.benutzer);
    if (ber === 'bauleiter') { bedingungen.push('b.bauleiter_id = ?'); p.push(ctx.benutzer.id); }
    if (ber === 'partie') { bedingungen.push('(b.polier_id = ? OR b.id = ?)'); p.push(ctx.benutzer.id, ctx.benutzer.baustelle_id ?? -1); }
    if (q.baustelleId !== undefined) { bedingungen.push('r.baustelle_id = ?'); p.push(v.pfadId(String(q.baustelleId), 'baustelleId')); }
    if (q.von !== undefined) { bedingungen.push('r.datum >= ?'); p.push(v.datum(String(q.von), 'von')); }
    if (q.bis !== undefined) { bedingungen.push('r.datum <= ?'); p.push(v.datum(String(q.bis), 'bis')); }
    if (q.status !== undefined) { bedingungen.push('r.status = ?'); p.push(v.auswahl(String(q.status), 'status', ['entwurf', 'unterschrieben', 'freigegeben'])); }
    const zeilen = db.alle(`SELECT r.id, r.baustelle_id, r.datum, r.status, r.geaendert_nach_unterschrift, b.kst, b.name, b.kurz, b.polier_id, b.bauleiter_id,
        (SELECT COUNT(*) FROM bericht_personal bp WHERE bp.bericht_id = r.id) AS anzahl,
        (SELECT COALESCE(SUM(stunden), 0) FROM bericht_personal bp WHERE bp.bericht_id = r.id) AS stunden,
        (SELECT COUNT(*) FROM unterschrift u WHERE u.bericht_id = r.id AND u.rolle = 'an') AS an,
        (SELECT COUNT(*) FROM unterschrift u WHERE u.bericht_id = r.id AND u.rolle = 'bh') AS bh
      FROM bericht r JOIN baustelle b ON b.id = r.baustelle_id
      ${bedingungen.length ? 'WHERE ' + bedingungen.join(' AND ') : ''} ORDER BY r.datum DESC, b.kst LIMIT 1000`, ...p);
    res.json(zeilen
      .filter((z) => baustelleImBereich(ctx.benutzer, { id: z.baustelle_id, polier_id: z.polier_id, bauleiter_id: z.bauleiter_id }))
      .map((z) => ({
        id: z.id, baustelleId: z.baustelle_id, kst: z.kst, baustelle: z.kurz || z.name, datum: z.datum, status: z.status,
        personalAnzahl: z.anzahl, stunden: r2(z.stunden), unterschriften: { an: z.an > 0, bh: z.bh > 0 }, geaendertNachUnterschrift: Boolean(z.geaendert_nach_unterschrift)
      })));
  });

  api.post('/berichte', async (req, res) => {
    if (!req.ctx.hat('bericht_erstellen')) throw keinZugriff('Berichte erstellen ist für Ihre Rolle nicht freigeschaltet.');
    const body = v.objekt(req.body);
    const baustelleId = v.id(body.baustelleId, 'baustelleId');
    const datum = v.datum(body.datum, 'datum');
    const bs = ladeBaustelle(db, baustelleId);
    if (!bs) throw ungueltig('Baustelle nicht gefunden.');
    pruefeSchreiben(req.ctx, bs);
    require('../kostenstellen').nurBaustelle(bs, 'Bautagesberichte'); // 12.25
    const heute = wienDatum(bt.uhr());
    if (datum > heute) throw ungueltig('Ein Bericht kann nicht für ein zukünftiges Datum angelegt werden.');
    if (datum < plusTage(heute, -366)) throw ungueltig('Das Datum liegt mehr als ein Jahr zurück.');
    // API.md 12.15: nach Bauende/Archiv keine neuen Berichte (Tage bis zum Phasenwechsel bleiben möglich)
    if (bs.status === 'abgeschlossen' && (['archiviert', 'storniert'].includes(bs.phase) || !bs.phase_seit || datum > bs.phase_seit)) throw ungueltig(`Baustelle ${bs.kst} ist abgeschlossen (${require('../bauvorhaben').PHASE_NAMEN[bs.phase] || bs.phase}) – für Mängelbehebung zuerst wieder auf „In Arbeit“ setzen.`);
    const vorhanden = db.eins('SELECT id FROM bericht WHERE baustelle_id = ? AND datum = ?', baustelleId, datum);
    if (vorhanden) throw konflikt('Für diese Baustelle und diesen Tag gibt es bereits einen Bericht.', { id: vorhanden.id });
    const zeit = jetzt();
    const id = db.transaktion(() => {
      const r = db.lauf('INSERT INTO bericht (baustelle_id, datum, status, erstellt_von, erstellt, geaendert) VALUES (?, ?, ?, ?, ?, ?)', baustelleId, datum, 'entwurf', req.ctx.benutzer.id, zeit, zeit);
      speichereUpdate(db, r.id, { personal: personalVorschlag(db, baustelleId, datum, bt.uhr()) }, zeit);
      return r.id;
    });
    // API.md 12.4: Wetter automatisch (höchstens 4 s warten)
    if (bs.lat != null && bs.lng != null && bt.wetterAn) {
      try {
        const w = await Promise.race([require('../wetter').wetterFuer(bt, bs, datum), new Promise((r) => setTimeout(() => r(null), 4000).unref())]);
        if (w && w.verfuegbar) db.lauf('UPDATE bericht SET wetter = ? WHERE id = ? AND wetter IS NULL', JSON.stringify(require('../wetter').berichtWetter(w)), id);
      } catch (_) { /* Wetter ist optional */ }
    }
    res.status(201).json(berichtJson(db, req.ctx, ladeBerichtRoh(db, id)));
  });

  api.get('/berichte/:id', (req, res) => {
    res.json(berichtJson(db, req.ctx, ladeMitZugriff(req, false)));
  });

  api.put('/berichte/:id', (req, res) => {
    const b = ladeMitZugriff(req, true);
    if (b.status !== 'entwurf' || b.unterschriften.length) throw konflikt(GESPERRT_TEXT);
    const body = v.objekt(req.body);
    pruefeBerichtVersion(body, b, true);
    // Datenschutz: wer fremde Abwesenheiten nicht sieht (Polier), kann sie auch nicht löschen oder ändern –
    // ausgeblendete Zeilen und ausgeblendete Codes bleiben beim Speichern erhalten
    if (Array.isArray(body.personal) && require('../datenschutz').stufe(req.ctx) === 'keine') body.personal = abwesendeBehalten(req.ctx, b, body.personal);
    const u = pruefeUpdate(db, body, { baustelle: b.baustelle, datum: b.datum, berichtId: b.id, jetzt: bt.uhr() });
    if (!Object.keys(u).length) throw ungueltig('Keine bearbeitbaren Felder angegeben.');
    db.transaktion(() => {
      speichereUpdate(db, b.id, u, jetzt());
      linksUngueltig(db, b.id); // 12.9
      const warGast = new Set(b.personal.filter((p) => p.gast).map((p) => p.benutzer_id));
      for (const p of (u.personal || []).filter((x) => x.gast && !warGast.has(x.benutzerId))) {
        db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'bericht', objekt: `bericht:${b.id}`, text: `${p.name} als Gast (nicht Partie, nicht gestempelt) in Bericht ${b.baustelle.kst} ${b.datum} eingetragen` });
      }
      db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'bericht', objekt: `bericht:${b.id}`, text: `Bericht ${b.baustelle.kst} ${b.datum} bearbeitet: ${Object.keys(u).join(', ')}` });
    });
    const o = berichtJson(db, req.ctx, ladeBerichtRoh(db, b.id));
    // Servicebuch (API.md 11.4): Hinweis auf gesperrte Anlagen – Speichern wird nicht verhindert
    o.hinweise = [];
    const { ladeStand, sperrText } = require('../fuhrpark-daten');
    const { melde, fuhrparkBenutzer } = require('../fuhrpark-erinnerung');
    const S = ladeStand(db, wienDatum(bt.uhr()));
    for (const g of o.geraete) {
      const A = g.anlage ? S.anlagen.get(g.anlage.id) : null;
      if (!A || !A.status.gesperrt) continue;
      const text = sperrText(A);
      o.hinweise.push({ typ: 'anlage_gesperrt', anlageId: A.row.id, text });
      for (const uid of fuhrparkBenutzer(db)) {
        melde(db, { benutzerId: uid, titel: `Gesperrte Anlage im Bautagesbericht: ${A.row.bezeichnung}`, text: `${text} – eingetragen im Bericht ${b.baustelle.kst} vom ${b.datum.split('-').reverse().join('.')} von ${req.ctx.benutzer.name}.`, zeit: jetzt(), anlageId: A.row.id, baustelleId: b.baustelle_id, schluessel: `fp:gesperrt-genutzt:${A.row.id}:${b.id}` });
      }
    }
    res.json(o);
  });

  /** Zusatz: Personal erneut aus den Stempelungen übernehmen (nur Entwurf) */
  api.post('/berichte/:id/personal-aktualisieren', (req, res) => {
    const b = ladeMitZugriff(req, true);
    if (b.status !== 'entwurf' || b.unterschriften.length) throw konflikt(GESPERRT_TEXT);
    pruefeBerichtVersion(v.objekt(req.body || {}), b, true); // D-07
    const seg = new Map(b.personal.map((p) => [p.benutzer_id, p.seg_stunden]));
    const personal = personalVorschlag(db, b.baustelle_id, b.datum, bt.uhr()).map((p) => ({ ...p, segStunden: Math.min(seg.get(p.benutzerId) || 0, p.stunden) }));
    db.transaktion(() => { speichereUpdate(db, b.id, { personal }, jetzt()); linksUngueltig(db, b.id); });
    res.json(berichtJson(db, req.ctx, ladeBerichtRoh(db, b.id)));
  });

  api.post('/berichte/:id/unterschrift', (req, res) => {
    const b = ladeMitZugriff(req, true);
    if (b.status !== 'entwurf') throw konflikt('Der Bericht ist bereits unterschrieben.');
    const body = v.objekt(req.body);
    const rolle = v.auswahl(body.rolle, 'rolle', ['an', 'bh']);
    const name = v.text(body.name, 'name', { max: 120 });
    const bild = pruefePng(body.bildPng);
    pruefeBerichtVersion(body, b, true); // D-07: Unterschrift nur auf den gesehenen Stand
    // D-05: vorhandene Unterschrift nie überschreiben – nur über Zurückziehen
    if (b.unterschriften.some((u) => u.rolle === rolle)) {
      throw konflikt(`Die Unterschrift ${rolle === 'bh' ? 'des Bauherrn' : 'des Auftragnehmers'} liegt bereits vor. Ersetzen nur über „Unterschrift zurückziehen“.`);
    }
    unterschriftSpeichern(b, { rolle, name, bild, benutzerId: req.ctx.benutzer.id });
    res.json(berichtJson(db, req.ctx, ladeBerichtRoh(db, b.id)));
  });


  /**
   * Unterschrift speichern (Route und Fernunterschrift 12.9). Prüft Wiederverwendung, setzt Status, Folgeaktionen.
   * @returns {'entwurf'|'unterschrieben'}
   */
  function unterschriftSpeichern(b, { rolle, name, bild, benutzerId, protokollZusatz = '' }) {
    const req = { ctx: { benutzer: { id: benutzerId } } };
    const hash = bildHash(bild);
    // C-06: zurückgezogene oder anderswo verwendete Unterschriftsbilder nicht wiederverwenden
    if (db.eins('SELECT 1 AS x FROM unterschrift_widerruf WHERE bericht_id = ? AND bild_hash = ?', b.id, hash)
      || db.eins('SELECT 1 AS x FROM unterschrift WHERE bild_hash = ? AND bericht_id <> ?', hash, b.id)) {
      throw ungueltig('Diese Unterschrift wurde bereits verwendet bzw. zurückgezogen – bitte neu unterschreiben.');
    }
    const zeit = jetzt();
    let neuerStatus = 'entwurf';
    db.transaktion(() => {
      db.lauf(`INSERT INTO unterschrift (bericht_id, rolle, name, zeit, bild_png, erfasst_von, bild_hash) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(bericht_id, rolle) DO NOTHING`,
      b.id, rolle, name, zeit, bild, req.ctx.benutzer.id, hash);
      db.lauf('UPDATE bericht SET version = version + 1 WHERE id = ?', b.id);
      const n = db.eins('SELECT COUNT(*) AS n FROM unterschrift WHERE bericht_id = ?', b.id).n;
      if (n >= 2) {
        neuerStatus = 'unterschrieben';
        db.lauf("UPDATE bericht SET status = 'unterschrieben', geaendert = ?, version = version + 1 WHERE id = ?", zeit, b.id);
        db.protokolliere({ zeit, benutzerId: req.ctx.benutzer.id, art: 'bericht', objekt: `bericht:${b.id}`, alt: 'entwurf', neu: 'unterschrieben', text: `Bericht ${b.baustelle.kst} ${b.datum} unterschrieben${protokollZusatz}` });
        // Hinweis an alle, die freigeben dürfen (Bauleiter der Baustelle, Büro, GF)
        const empf = db.alle("SELECT id, rolle FROM benutzer WHERE aktiv = 1 AND (rolle IN ('buero','gf') OR id = ?)", b.baustelle.bauleiter_id || -1);
        for (const e of empf) {
          benachrichtige(db, {
            benutzerId: e.id, typ: 'bericht', titel: `Bericht zur Freigabe: ${b.baustelle.kurz || b.baustelle.name}`,
            text: `Bautagesbericht vom ${b.datum.split('-').reverse().join('.')} ist unterschrieben und wartet auf Freigabe.`,
            zeit, baustelleId: b.baustelle_id, schluessel: `bericht:${b.id}:unterschrieben`
          });
        }
      }
    });
    if (neuerStatus === 'unterschrieben') {
      pruefeBudget(bt, b.baustelle_id, { anlass: 'Unterschrift Bautagesbericht', benutzerId: req.ctx.benutzer.id });
      autoMail(b);
      if (b.geraete.length) require('../fuhrpark-erinnerung').pruefeFuhrparkSicher(bt); // Gerätestunden → Servicebuch
    }
    linksUngueltig(db, b.id, rolle);
    return neuerStatus;
  }
  module.exports.unterschriftSpeichern = unterschriftSpeichern;

  /** API.md 12.5: AG-PDF nach der zweiten Unterschrift automatisch an den Auftraggeber */
  function autoMail(b) {
    const bs = ladeBaustelle(db, b.baustelle_id);
    if (bs && bs.ag_email && bs.bericht_mail === 1 && require('../mail').eingerichtet(bt)) {
      require('../mail').berichtVersenden(bt, b.id, bs.ag_email, null);
    }
  }
  module.exports.autoMail = autoMail;

  /** Unterschrift zurückziehen (nur solange der Bericht noch Entwurf ist) – danach wieder bearbeitbar */
  api.delete('/berichte/:id/unterschrift/:rolle', (req, res) => {
    const b = ladeMitZugriff(req, true);
    const rolle = v.auswahl(req.params.rolle, 'rolle', ['an', 'bh']);
    if (rolle === 'bh' && !require('../rechte').BUERO_ROLLEN.includes(req.ctx.benutzer.rolle)) throw keinZugriff('Die Unterschrift des Bauherrn kann nur das Büro bzw. die Geschäftsführung zurückziehen.');
    if (b.status !== 'entwurf') throw konflikt('Der Bericht ist vollständig unterschrieben – Unterschriften können nicht mehr zurückgezogen werden.');
    const alt = b.unterschriften.find((u) => u.rolle === rolle);
    if (!alt) throw nichtGefunden('Diese Unterschrift gibt es nicht.');
    db.transaktion(() => {
      db.lauf('DELETE FROM unterschrift WHERE bericht_id = ? AND rolle = ?', b.id, rolle);
      db.lauf('INSERT INTO unterschrift_widerruf (bericht_id, rolle, name, bild_hash, unterschrieben, zeit, von) VALUES (?, ?, ?, ?, ?, ?, ?)',
        b.id, rolle, alt.name, alt.bild_hash || (alt.bild_png ? bildHash(alt.bild_png) : null), alt.zeit, jetzt(), req.ctx.benutzer.id);
      linksUngueltig(db, b.id);
      db.lauf('UPDATE bericht SET geaendert_nach_unterschrift = ?, version = version + 1 WHERE id = ?',
        JSON.stringify({ zeit: jetzt(), rolle, von: req.ctx.benutzer.name, unterschriebenAm: alt.zeit }), b.id);
    });
    db.protokolliere({ zeit: jetzt(), benutzerId: req.ctx.benutzer.id, art: 'bericht', objekt: `bericht:${b.id}`, text: `Unterschrift (${rolle === 'an' ? 'Auftragnehmer' : 'Bauherr'}) zurückgezogen: ${b.baustelle.kst} ${b.datum}` });
    res.json(berichtJson(db, req.ctx, ladeBerichtRoh(db, b.id)));
  });

  api.post('/berichte/:id/freigeben', (req, res) => {
    const id = v.pfadId(req.params.id, 'Berichts-ID');
    const b = ladeBerichtRoh(db, id);
    if (!b) throw nichtGefunden('Bericht nicht gefunden.');
    if (!req.ctx.hat('bericht_freigeben')) throw keinZugriff('Berichte freigeben ist für Ihre Rolle nicht freigeschaltet.');
    if (!baustelleImBereich(req.ctx.benutzer, b.baustelle)) throw keinZugriff('Freigeben dürfen Sie nur Berichte Ihrer eigenen Baustellen.');
    if (b.status === 'freigegeben') throw konflikt('Der Bericht ist bereits freigegeben.');
    if (b.status !== 'unterschrieben') throw konflikt('Freigabe erst nach beiden Unterschriften (Auftragnehmer und Bauherr) möglich.');
    // D-10: Vier-Augen-Prinzip – wer die AN-Unterschrift erfasst hat, gibt nicht selbst frei (außer GF, dann markiert)
    const an = b.unterschriften.find((u) => u.rolle === 'an');
    const selbst = Boolean(an && an.erfasst_von === req.ctx.benutzer.id);
    if (selbst && req.ctx.benutzer.rolle !== 'gf') {
      throw keinZugriff('Vier-Augen-Prinzip: Wer die Unterschrift des Auftragnehmers erfasst hat, gibt den Bericht nicht selbst frei.');
    }
    const zeit = jetzt();
    db.transaktion(() => {
      db.lauf("UPDATE bericht SET status = 'freigegeben', freigegeben_von = ?, freigegeben_zeit = ?, geaendert = ?, selbstfreigabe = ?, version = version + 1 WHERE id = ?", req.ctx.benutzer.id, zeit, zeit, selbst ? 1 : 0, b.id);
      db.protokolliere({ zeit, benutzerId: req.ctx.benutzer.id, art: 'freigabe', objekt: `bericht:${b.id}`, alt: 'unterschrieben', neu: 'freigegeben',
        text: `Bericht ${b.baustelle.kst} ${b.datum} freigegeben${selbst ? ' (Selbstfreigabe durch GF – Vier-Augen-Prinzip nicht eingehalten)' : ''}` });
    });
    pruefeBudget(bt, b.baustelle_id, { anlass: 'Freigabe Bautagesbericht', benutzerId: req.ctx.benutzer.id });
    if (b.geraete.length) require('../fuhrpark-erinnerung').pruefeFuhrparkSicher(bt); // Gerätestunden → Servicebuch
    res.json(berichtJson(db, req.ctx, ladeBerichtRoh(db, b.id)));
  });

  api.get('/berichte/:id/pdf', async (req, res) => {
    const b = ladeMitZugriff(req, false);
    const fassung = req.query.fassung === undefined ? 'ag' : v.auswahl(String(req.query.fassung), 'fassung', ['ag', 'intern']);
    if (fassung === 'intern' && !req.ctx.hat('bericht_freigeben') && !req.ctx.hat('stammdaten')) throw keinZugriff('Die interne Fassung ist Bauleitung und Büro vorbehalten.');
    const pdf = await berichtPdf(bt, b, { fassung, benutzer: req.ctx.benutzer, fotos: req.query.fotos === '1' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Bautagesbericht_${b.baustelle.kst}_${b.datum}${fassung === 'intern' ? '_intern' : ''}.pdf"`);
    res.send(pdf);
  });
};

/** Polier speichert Personal: verborgene Abwesenheits-Zeilen/-Codes anderer Personen unverändert übernehmen */
function abwesendeBehalten(ctx, b, liste) {
  const DS = require('../datenschutz');
  const verborgen = (p) => p.benutzer_id !== ctx.benutzer.id && DS.ABWESENHEIT_CODES.includes(p.code);
  const gespeichert = new Map(b.personal.map((p) => [p.benutzer_id, p]));
  const out = liste.map((x) => {
    const alt = x && gespeichert.get(Number(x.benutzerId));
    if (alt && verborgen(alt) && (x.code === null || x.code === undefined || x.code === '')) return { ...x, code: alt.code };
    return x;
  });
  const drin = new Set(out.map((x) => Number(x && x.benutzerId)));
  for (const p of b.personal) {
    if (verborgen(p) && !p.stunden && !p.von1 && !drin.has(p.benutzer_id)) {
      out.push({ benutzerId: p.benutzer_id, von1: null, bis1: null, von2: null, bis2: null, pauseMin: 0, code: p.code, segStunden: 0 });
    }
  }
  return out;
}

/** PDF eines Berichts (nie €): Fassung ag|intern, optional Fotoseiten (API.md 12.6) */
async function berichtPdf(bt, b, { fassung = 'ag', benutzer = null, fotos = false } = {}) {
  const { db } = bt;
  const firma = db.einstellung('firma', { name: 'Michael Pichler Ges.m.b.H.', ort: '2624 Breitenau' });
  // Bewusst ohne kostenTag: das PDF enthält nie €-Werte
  // R-01: PDFs (intern und AG) zeigen nie den Krankenstand – „abw.“ (ctx ohne Rechte und ohne Person maskiert K)
  const daten = berichtJson(db, { benutzer: { id: 0, rolle: 'buero' }, rechte: new Set(), hat: () => false }, b); // Stufe „maskiert“: K → abw., übrige Codes bleiben
  const anhang = fotos && typeof module.exports.fotoAnhang === 'function' ? module.exports.fotoAnhang(bt, b.id) : null;
  return erzeugeBerichtPdf(daten, { fassung, firma, unkomprimiert: Boolean(bt.pdfUnkomprimiert), fotos: anhang, geraete: db.alle('SELECT id, code, name FROM geraet WHERE vorlage = 1 ORDER BY sortierung, id'), materialien: db.alle('SELECT id, code, name, einheit FROM material WHERE vorlage = 1 ORDER BY sortierung, id') });
}

/** AG-Fassung für E-Mail/Fernunterschrift */
async function agPdf(bt, berichtId) {
  return berichtPdf(bt, ladeBerichtRoh(bt.db, berichtId), { fassung: 'ag' });
}

module.exports.berichtPdf = berichtPdf;
module.exports.agPdf = agPdf;
module.exports.ladeBerichtRoh = ladeBerichtRoh;
module.exports.berichtJson = berichtJson;
module.exports.speichereUpdate = speichereUpdate;
module.exports.pruefePersonal = pruefePersonal;
/** API.md 12.9: offene Fernunterschrift-Links ungültig machen (Inhalt geändert bzw. Rolle schon unterschrieben) */
function linksUngueltig(db, berichtId, nurRolle = null) {
  if (!db.eins("SELECT name FROM sqlite_master WHERE name = 'unterschrift_link'")) return;
  db.lauf(`UPDATE unterschrift_link SET status = 'ungueltig' WHERE bericht_id = ? AND status = 'offen' ${nurRolle ? 'AND rolle = ?' : ''}`, berichtId, ...(nurRolle ? [nurRolle] : []));
}
/**
 * Inhalt eines Berichts geändert (Fotos, Lieferschein, Fuhren …): Version +1 und offene Fern-Unterschrift-Links
 * ungültig (12.9, G-02). Alle Stellen außerhalb von PUT /berichte/:id nutzen diese Funktion.
 */
function berichtGeaendert(db, berichtId, zeit) {
  db.lauf('UPDATE bericht SET geaendert = ?, version = version + 1 WHERE id = ?', zeit, berichtId);
  linksUngueltig(db, berichtId);
  return db.eins('SELECT version FROM bericht WHERE id = ?', berichtId).version;
}
module.exports.linksUngueltig = linksUngueltig;
module.exports.berichtGeaendert = berichtGeaendert;
module.exports.pruefeLesen = pruefeLesen;
module.exports.pruefeSchreiben = pruefeSchreiben;
module.exports.GESPERRT_TEXT = GESPERRT_TEXT;
module.exports.pruefePng = pruefePng;
