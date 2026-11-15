'use strict';
/**
 * API.md 15.17 (H-T1, H-T4) – Differenz-Orakel für fremde Abwesenheiten (Inhaberregel 3, 13.2, 15.10).
 *
 * Die Korrelationsprüfungen des Scanners (rechte-werte-g2.js) erkennen bekannte Kodierungen (ID-Listen, Merker, Zählungen).
 * Dieses Orakel braucht keine Kodierung: Polier und Mitarbeiter dürfen aus KEINER Antwort etwas über Abwesenheiten
 * anderer erfahren – dann darf keine Antwort davon abhängen, ob es sie gibt. Zwei Server auf identischen Kopien der
 * Matrix-Basis (rechte-matrix-hilfe.erstelleBasis: fremde Abwesenheiten K/U/ZA/BU, genehmigt und beantragt, an den
 * Planer-Tagen 13.11./16.11. und heute in der Partie des Poliers), auf der zweiten sind alle Abwesenheiten ANDERER Personen
 * gelöscht (die eigenen bleiben, beim Polier auch seine eigenen Schlechtwetter-Meldungen). Dieselbe Anfragefolge an beide:
 *  - jede GET-Route der Matrix × Variante (eigen/fremd) × Query-/Pfad-Variante, die der Rolle erlaubt ist (und die übrigen:
 *    auch eine Ablehnung darf nicht davon abhängen),
 *  - danach jede schreibende Route, die der Rolle erlaubt ist, mit dem Erfolgs-Body der Matrix (wie rechte-matrix-schreiben),
 *  - zuletzt die dabei entstandenen Benachrichtigungen und Push-Meldungen an Poliere/Mitarbeiter.
 * Status, Kopfzeilen und Inhalt (JSON; PDF/XLSX als Text) müssen gleich sein. Ein Unterschied heißt: die Antwort verrät
 * fremde Abwesenheiten – gleich ob als Zahl („3 vor Ort“), Text-Merker („grau“), Reihenfolge, Länge oder Fehlertext.
 * Die Plan-Sicht des Poliers (15.10) und die Kollegen in „Mein Einsatz“ (15.14) sind der veröffentlichte Plan und hängen
 * nicht von Abwesenheiten ab – sie bleiben daher gleich und sind kein Befund.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./rechte-matrix-hilfe');
const { erwartung, brauchtVarianten, leseProben, anfrage } = require('./rechte-matrix-proben');
const { erfolgsAnfrage } = require('./rechte-matrix-schreiben');

const MATRIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'rechte-matrix.json'), 'utf8')).routen;
const NUR = process.env.BAUTAG_RECHTE_NUR ? new RegExp(process.env.BAUTAG_RECHTE_NUR) : null;
// wie die Parität (15.4): Anmeldung/Fernunterschrift, Test-Schnittstellen und die eigene Konto-Pflege (beendet bzw.
// verändert die eigene Sitzung) sind ausgenommen
const AUSGENOMMEN = (k, e) => e.spezial || erwartung(e, 'buero') === 'T' || /^\w+ \/api\/(auth|zwei-faktor)\//.test(k) || /^\w+ \/api\/zwei-faktor$/.test(k);

/**
 * Alle Abwesenheiten anderer Personen löschen (eigene bleiben; beim Polier auch die Tage seiner eigenen SW-Meldungen).
 * Damit neue Zeilen auf beiden Servern dieselbe ID bekommen, bleibt die höchste ID als Platzhalter (Rechte-Dummy, 1990).
 */
function ohneFremdeAbwesenheiten(db, ich, dummy) {
  const max = (db.eins('SELECT MAX(id) AS m FROM abwesenheit') || {}).m || 0;
  const eigeneSw = new Set(db.alle('SELECT antrag_id FROM sw_meldung WHERE polier_id = ?', ich).map((x) => x.antrag_id));
  const weg = db.alle('SELECT id, antrag_id FROM abwesenheit WHERE benutzer_id <> ?', ich).filter((z) => !eigeneSw.has(z.antrag_id));
  for (const z of weg) db.lauf('DELETE FROM abwesenheit WHERE id = ?', z.id);
  if (max && !db.eins('SELECT 1 AS x FROM abwesenheit WHERE id = ?', max)) db.lauf("INSERT INTO abwesenheit (id, benutzer_id, datum, code, status, erfasst_von, erfasst) VALUES (?, ?, '1990-01-01', 'SW', 'abgelehnt', ?, '1990-01-01T00:00:00.000Z')", max, dummy, dummy);
  return weg.length;
}

/** Antwort vergleichbar machen: Zufallswerte (Antrags-IDs, Tokens, Port) neutralisieren; PDF/XLSX als Text.
 *  Öffentliche Kennungen (p…/x… + 20 hex, 15.15 H-G1) sind je Zeile zufällig: je Antwort in der Reihenfolge des ersten
 *  Auftretens nummeriert – gleiche Kennung bleibt gleich, Anzahl und Reihenfolge werden weiter verglichen. */
async function vergleichbar(r) {
  const kennungen = new Map();
  const text = (s) => s.replace(/\b[px][0-9a-f]{20}\b/g, (k) => { if (!kennungen.has(k)) kennungen.set(k, `<KENNUNG${kennungen.size + 1}>`); return kennungen.get(k); }).replace(/\ba[0-9a-f]{12}\b/g, '<ANTRAG>').replace(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g, '<TOKEN>').replace(/http:\/\/127\.0\.0\.1:\d+/g, '<HOST>');
  const lauf = (w) => {
    if (Array.isArray(w)) return w.map(lauf);
    if (w && typeof w === 'object') return Object.fromEntries(Object.entries(w).map(([k, x]) => [k, k === 'id' && typeof x === 'string' && /^[a-z0-9]{10,16}$/.test(x) ? '<ZUFALL>' : lauf(x)]));
    return typeof w === 'string' ? text(w) : w;
  };
  const kopf = text(H.kopfText(r.headers)).split('\n').filter((z) => !/^(x-response-time|last-modified|age|vary|keep-alive):/i.test(z)).sort().join('\n');
  if (Buffer.isBuffer(r.daten)) return { status: r.status, kopf, text: text(await H.antwortText(r, { ohneKopf: true })) };
  return { status: r.status, kopf, daten: lauf(r.daten) };
}

const kurz = (x) => JSON.stringify(x).slice(0, 300);

/** erste Abweichung zweier vergleichbarer Antworten (Pfad) – für eine lesbare Meldung */
function abweichung(a, b, pfad = '$') {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    if (Array.isArray(a) && a.length !== b.length) return `${pfad}: Länge ${a.length} ≠ ${b.length}`;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const x = abweichung(a[k], b[k], `${pfad}.${k}`); if (x) return x; }
  }
  if (typeof a === 'string' && typeof b === 'string') { let i = 0; while (a[i] === b[i]) i++; return `${pfad}: „…${a.slice(Math.max(0, i - 60), i + 60)}…“ ≠ „…${b.slice(Math.max(0, i - 60), i + 60)}…“`; }
  return `${pfad}: ${kurz(a)} ≠ ${kurz(b)}`;
}

/** Benachrichtigungen (DB) und Push-Meldungen an Poliere/Mitarbeiter seit dem Start (für den Vergleich) */
function ausgang(s, start) {
  const feld = new Set(s.db.alle("SELECT id FROM benutzer WHERE rolle IN ('polier','mitarbeiter')").map((b) => b.id));
  return {
    benachrichtigungen: s.db.alle('SELECT * FROM benachrichtigung WHERE id > ? ORDER BY id', start.benachrichtigung).filter((n) => feld.has(n.benutzer_id)).map((n) => ({ ...n, id: undefined, zeit: undefined, erstellt: undefined })),
    push: s.app.bt.testAusgang.push.slice(start.push).filter((p) => feld.has(p.benutzerId)).map((p) => ({ ...p, zeit: undefined }))
  };
}

test('15.17 Orakel: Antworten an Polier und Mitarbeiter hängen nicht von fremden Abwesenheiten ab (H-T1, H-T4)', { timeout: 30 * 60 * 1000 }, async (t) => {
  const basis = await H.erstelleBasis();
  t.after(() => fs.rmSync(basis.ordner, { recursive: true, force: true }));
  const F = basis.F;
  const lesen = Object.entries(MATRIX).filter(([k, e]) => k.startsWith('GET ') && !AUSGENOMMEN(k, e) && (!NUR || NUR.test(k)));
  const schreiben = Object.entries(MATRIX).filter(([k, e]) => !k.startsWith('GET ') && !AUSGENOMMEN(k, e) && (!NUR || NUR.test(k)));

  for (const rolle of ['polier', 'mitarbeiter']) {
    await t.test(`${rolle}: Lesen, Schreiben und Ausgänge mit und ohne fremde Abwesenheiten`, async (tt) => {
      const v = [];
      const ich = H.ID[rolle];
      const mit = await H.starteKopie(basis);
      const ohne = await H.starteKopie(basis);
      try {
        const geloescht = ohneFremdeAbwesenheiten(ohne.db, ich, F.dummyBenutzer);
        // Selbstprüfung: das Orakel vergleicht wirklich einen Unterschied (fremde Abwesenheiten an den geprüften Tagen)
        const fremdePlanTage = mit.db.eins(`SELECT COUNT(*) AS n FROM abwesenheit WHERE benutzer_id <> ? AND datum IN ('2026-11-12', ${H.PLAN_TAGE.map(() => '?').join(', ')}) AND (code IN ('K','U','ZA') OR betriebsurlaub = 1)`, ich, ...H.PLAN_TAGE).n;
        if (geloescht < 20 || fremdePlanTage < 12) v.push(`Vorbereitung: nur ${geloescht} fremde Abwesenheiten gelöscht (${fremdePlanTage} an den Plan-Tagen) – Orakel wirkungslos`);
        if (ohne.db.eins('SELECT COUNT(*) AS n FROM abwesenheit WHERE benutzer_id <> ? AND benutzer_id <> ? AND datum > ?', ich, F.dummyBenutzer, '1990-01-01').n !== (rolle === 'polier' ? ohne.db.eins('SELECT COUNT(*) AS n FROM abwesenheit a JOIN sw_meldung m ON m.antrag_id = a.antrag_id WHERE m.polier_id = ?', ich).n : 0)) v.push('Vorbereitung: fremde Abwesenheiten auf der Vergleichskopie nicht vollständig gelöscht');
        const start = { benachrichtigung: (mit.db.eins('SELECT MAX(id) AS m FROM benachrichtigung') || {}).m || 0, push: mit.app.bt.testAusgang.push.length };
        const startB = { benachrichtigung: (ohne.db.eins('SELECT MAX(id) AS m FROM benachrichtigung') || {}).m || 0, push: ohne.app.bt.testAusgang.push.length };
        let n = 0, ok = 0;
        // 1) Lesen
        for (const [k, e] of lesen) {
          for (const variante of brauchtVarianten(e) ? ['eigen', 'fremd'] : ['ohne']) {
            for (const { a, name } of leseProben(k, e, F, rolle, variante)) {
              const ra = await vergleichbar(await mit.als(rolle).get(a.pfad));
              const rb = await vergleichbar(await ohne.als(rolle).get(a.pfad));
              n++; if (ra.status < 300) ok++;
              const d = abweichung(ra, rb);
              if (d) v.push(`${rolle} GET ${a.pfad} [${variante}${name === 'Probe' ? '' : `, ${name}`}]: Antwort hängt von fremden Abwesenheiten ab – ${d}`);
            }
          }
        }
        if (!NUR && ok < (rolle === 'polier' ? 100 : 60)) v.push(`${rolle}: nur ${ok} erfolgreiche Leseproben (von ${n}) – Orakel wirkungslos?`);
        // 2) Schreiben (erlaubte Routen, Erfolgs-Body; dieselbe Folge auf beiden Servern)
        let geschrieben = 0;
        for (const [k, e] of schreiben) {
          const erw = erwartung(e, rolle);
          if (!['J', 'E', 'O'].includes(erw)) continue;
          const variante = brauchtVarianten(e) ? 'eigen' : 'ohne';
          const r = {};
          for (const [seite, srv] of [['mit', mit], ['ohne', ohne]]) {
            let a;
            try { a = await erfolgsAnfrage(srv, k, e, F, rolle, variante); } catch (x) { r[seite] = { vorbereitung: x.message.replace(/http:\/\/127\.0\.0\.1:\d+/g, '<HOST>') }; continue; }
            r[seite] = await vergleichbar(await srv.als(rolle).anfrage(a.methode, a.pfad, a.body === undefined ? {} : a.body));
            r[`${seite}Pfad`] = a.pfad;
            await srv.ruhe();
          }
          if (r.mit && r.mit.status >= 200 && r.mit.status < 300) geschrieben++;
          const d = abweichung(r.mit, r.ohne);
          if (d) v.push(`${rolle} ${k} [${variante}] ${r.mitPfad || ''}: Antwort hängt von fremden Abwesenheiten ab – ${d}`);
        }
        if (!NUR && geschrieben < 10) v.push(`${rolle}: nur ${geschrieben} erfolgreiche Schreibproben – Orakel wirkungslos?`);
        tt.diagnostic(`${rolle}: ${n} Leseproben (${ok} erfolgreich), ${geschrieben} erfolgreiche Schreibproben, ${geloescht} fremde Abwesenheiten gelöscht`);
        // 3) Ausgänge (Benachrichtigungen, Push an Poliere/Mitarbeiter) aus Lesen und Schreiben
        await mit.ruhe(); await ohne.ruhe();
        const d = abweichung(ausgang(mit, start), ausgang(ohne, startB));
        if (d) v.push(`${rolle}: Benachrichtigungen/Push an Poliere/Mitarbeiter hängen von fremden Abwesenheiten ab – ${d}`);
        // und die Kontrolle für die Gegenrichtung: das Büro (stammdaten) sieht den Unterschied (sonst prüft das Orakel nichts)
        const pb = anfrage('GET /api/abwesenheiten', MATRIX['GET /api/abwesenheiten'], F, 'buero', 'ohne');
        const ba = await vergleichbar(await mit.als('buero').get(`${pb.pfad}?von=2026-11-12&bis=2026-11-16`));
        const bb = await vergleichbar(await ohne.als('buero').get(`${pb.pfad}?von=2026-11-12&bis=2026-11-16`));
        if (!abweichung(ba, bb)) v.push('Kontrolle: auch das Büro sieht keinen Unterschied – Vergleichskopie ohne Wirkung');
      } finally {
        await mit.stop(); await ohne.stop();
      }
      assert.deepEqual(v, [], `\n${v.join('\n')}`);
    });
  }
});
