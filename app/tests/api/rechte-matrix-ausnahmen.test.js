'use strict';
/**
 * Rechte-Matrix – Ausnahmen (Prüfbericht 7, F-026): Die GF erteilt Polier/Mitarbeiter/Bauleiter über die offizielle API
 * jedes vergebbare Recht als Ausnahme.
 *  - Gesperrte Rechte lassen sich weder als Ausnahme noch über die Rollen-Matrix vergeben.
 *  - Lesen: jede GET-Route × Variante × Query-Variante bleibt für Polier/Mitarbeiter frei von Beträgen, Kanarien und
 *    fremden Abwesenheiten (wie rechte-matrix.test.js); Bericht-JSON/PDF beider Fassungen gegen die DB.
 *  - Schreiben (F-026): jede schreibende Route × Variante für Polier/Mitarbeiter MIT allen Ausnahmen, je Route auf einer
 *    frischen Kopie: Antwort (Inhalt + Kopfzeilen) und ausgelöste Benachrichtigungen/Push/Mails ohne Leck; die
 *    Kern-Schreibwege, die erst durch die Ausnahmen möglich werden, müssen gelingen (2xx).
 *  - Bauleiter (= Büro) bleibt auch mit allen Ausnahmen ohne GF-Vorbehalte.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const H = require('./rechte-matrix-hilfe');
const { U } = require('./hilfe');
const { erwartung, brauchtVarianten, anfrage, leseProben } = require('./rechte-matrix-proben');
const { erfolgsAnfrage } = require('./rechte-matrix-schreiben');

const MATRIX_ALLE = JSON.parse(fs.readFileSync(path.join(__dirname, 'rechte-matrix.json'), 'utf8')).routen;
const NUR = process.env.BAUTAG_RECHTE_NUR ? new RegExp(process.env.BAUTAG_RECHTE_NUR) : null;
const MATRIX = Object.fromEntries(Object.entries(MATRIX_ALLE).filter(([k]) => !NUR || NUR.test(k)));
const { ID } = H;
const FELD = ['mitarbeiter', 'polier'];
const ERLAUBT = ['Text schadenFremd']; // Ausnahme `fuhrpark` (API.md 11.1) zeigt alle Schadensmeldungen
// F-026: Schreibwege, die erst eine Ausnahme öffnet – sie müssen mit Ausnahme gelingen, sonst prüft der Teil nichts
const MUSS_GELINGEN = [['mitarbeiter', 'POST /api/berichte'], ['mitarbeiter', 'PUT /api/berichte/:id'], ['mitarbeiter', 'POST /api/zeit/kolonne'], ['mitarbeiter', 'POST /api/berichte/:id/fotos'], ['mitarbeiter', 'POST /api/fuhrpark/anlagen/:id/sperre'], ['polier', 'PUT /api/berichte/:id'], ['polier', 'POST /api/fuhrpark/vorlagen/:id/anwenden']];

/** Basis + alle vergebbaren Ausnahmen für Mitarbeiter 2, Polier 1 und Bauleiter 103 (eigene Datei) */
async function ausnahmenBasis(basis, v) {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'bautag-rechte-ausnahmen-'));
  const datei = path.join(ordner, 'basis.db');
  fs.copyFileSync(basis.datei, datei);
  const up = path.join(basis.ordner, 'uploads');
  if (fs.existsSync(up)) fs.cpSync(up, path.join(ordner, 'uploads'), { recursive: true });
  const ab = { ordner, datei, F: basis.F };
  const k = await H.starteKopie({ ...ab, datei }, {});
  try {
    const gf = k.als('gf');
    const rechte = (await gf.get('/rechte')).daten;
    const alle = rechte.rechte.map((x) => x.schluessel);
    for (const [rolle, id] of [['mitarbeiter', U.mitarbeiter], ['polier', U.polier], ['bauleiter', U.bauleiter]]) {
      for (const recht of alle) {
        const r = await gf.put('/rechte/ausnahme', { benutzerId: id, recht, wert: true });
        const gesperrt = rechte.gesperrt[rolle].includes(recht);
        if (gesperrt && r.status !== 400) v.push(`Ausnahme ${recht} für ${rolle} → ${r.status} (gesperrt, erwartet 400)`);
        if (!gesperrt && r.status !== 200) v.push(`Ausnahme ${recht} für ${rolle} → ${r.status} (erwartet 200)`);
      }
      for (const recht of rechte.gesperrt[rolle]) {
        const r = await gf.put('/rechte/matrix', { rolle, recht, wert: true });
        if (r.status !== 400) v.push(`Matrix ${rolle}.${recht}=true → ${r.status} (gesperrt, erwartet 400)`);
      }
      const ich = (await k.als(rolle).get('/auth/ich')).daten.rechte;
      for (const g of rechte.gesperrt[rolle]) if (ich.includes(g)) v.push(`${rolle} hat trotz Sperre das Recht ${g}`);
    }
    await k.ruhe();
  } finally {
    // DB der Kopie als neue Basis übernehmen (Server schließen, dann Datei kopieren)
    const ziel = path.join(k.ordner, 'basis.db');
    await k.stopOhneAufraeumen();
    fs.copyFileSync(ziel, datei);
    const kup = path.join(path.dirname(ziel), 'uploads');
    if (fs.existsSync(kup)) { fs.rmSync(path.join(ordner, 'uploads'), { recursive: true, force: true }); fs.cpSync(kup, path.join(ordner, 'uploads'), { recursive: true }); }
    k.aufraeumen();
  }
  return ab;
}

test('Rechte-Matrix Ausnahmen: gesperrte Rechte nicht vergebbar; mit allen übrigen bleiben MA/Polier beim Lesen UND Schreiben ohne Leck, Bauleiter (= Büro) ohne GF-Vorbehalte', { timeout: 30 * 60 * 1000 }, async (t) => {
  const basis = await H.erstelleBasis();
  t.after(() => fs.rmSync(basis.ordner, { recursive: true, force: true }));
  const vorb = [];
  const ab = await ausnahmenBasis(basis, vorb);
  t.after(() => fs.rmSync(ab.ordner, { recursive: true, force: true }));

  await t.test('Vergabe: gesperrte Rechte → 400, übrige → 200', () => assert.deepEqual(vorb, [], `\n${vorb.join('\n')}`));

  await t.test('Lesen mit allen Ausnahmen: jede GET-Route × Variante × Query-Variante; Berichte gegen die DB', async () => {
    const v = [];
    const k = await H.starteKopie(ab);
    try {
      for (const [schluessel, e] of Object.entries(MATRIX)) {
        if (!schluessel.startsWith('GET ') || e.spezial || erwartung(e, 'gf') === 'T') continue;
        for (const rolle of ['mitarbeiter', 'polier', 'bauleiter']) {
          for (const variante of brauchtVarianten(e) ? ['eigen', 'fremd'] : ['ohne']) {
            for (const { a } of leseProben(schluessel, e, ab.F, rolle, variante)) {
              const r = await k.als(rolle).get(a.pfad);
              if (r.status >= 500) v.push(`${rolle} (alle Ausnahmen) GET ${a.pfad}: ${r.status}`);
              v.push(...(await H.scanne(rolle, r, { route: schluessel, variante, url: `${a.pfad} (mit allen Ausnahmen)`, mitAusnahmen: true, erlaubteKanarien: ERLAUBT })));
            }
          }
        }
      }
      // API.md 15.1: jeder Bericht, den Polier/Mitarbeiter mit allen Ausnahmen sehen – Liste = Detail, JSON und beide PDF-Fassungen
      for (const rolle of FELD) {
        const ich = ID[rolle];
        const cl = k.als(rolle);
        const liste = await cl.get('/berichte');
        if (liste.status !== 200 || !liste.daten.length) { v.push(`${rolle} (alle Ausnahmen) GET /berichte → ${liste.status} – Prüfung wirkungslos`); continue; }
        let pdfs = 0;
        for (const z of liste.daten) {
          const d = await cl.get(`/berichte/${z.id}`);
          if (z.personalAnzahl !== d.daten.personal.length) v.push(`${rolle} (alle Ausnahmen) GET /berichte: personalAnzahl ${z.personalAnzahl} ≠ Detail ${d.daten.personal.length} bei Bericht ${z.id}`);
          v.push(...H.berichtJsonAbwesenheitVerstoesse(k.db, ich, d.daten, `${rolle} (alle Ausnahmen) GET /berichte/${z.id}`));
          for (const fassung of ['intern', 'ag']) {
            const url = `/berichte/${z.id}/pdf?fassung=${fassung}`;
            const r = await cl.get(url);
            if (r.status !== 200) { v.push(`${rolle} (alle Ausnahmen) GET ${url} → ${r.status}`); continue; }
            pdfs++;
            v.push(...H.berichtPdfAbwesenheitVerstoesse(k.db, z.id, ich, await H.antwortText(r, { ohneKopf: true }), `${rolle} (alle Ausnahmen) GET ${url}`));
            // eigene Abwesenheit am Berichtstag: Legende/Kürzel der eigenen Zeile sind erlaubt – die genaue Prüfung gegen die DB steht oben
            const eigenAbw = Boolean(k.db.eins("SELECT 1 AS x FROM bericht_personal WHERE bericht_id = ? AND benutzer_id = ? AND code IN ('K','U','ZA','abwesend')", z.id, ich));
            v.push(...await H.scanne(rolle, r, { route: 'GET /api/berichte/:id/pdf', url: `${url} (mit allen Ausnahmen)`, mitAusnahmen: true, erlaubteKanarien: ERLAUBT, eigeneAbwesenheit: eigenAbw }));
          }
        }
        if (!pdfs) v.push(`${rolle} (alle Ausnahmen): kein Bericht-PDF geprüft`);
      }
      // Bauleiter (= Büro): GF-Vorbehalte bleiben aus, auch mit allen Ausnahmen
      for (const [m, p, b] of [['GET', '/rechte', undefined], ['PUT', '/rechte/matrix', { rolle: 'polier', recht: 'kolonne', wert: true }], ['PUT', '/rechte/ausnahme', { benutzerId: ID.mitarbeiter, recht: 'kolonne', wert: true }], ['PUT', `/benutzer/${ID.gf}`, { name: 'X' }], ['PUT', `/benutzer/${ID.buero}`, { name: 'X' }]]) {
        const r = await k.als('bauleiter').anfrage(m, p, b);
        if (r.status !== 403) v.push(`Bauleiter mit allen Ausnahmen ${m} ${p} → ${r.status} (erwartet 403)`);
      }
    } finally { await k.stop(); }
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  await t.test('Schreiben mit allen Ausnahmen (F-026): jede schreibende Route × Variante für Polier/Mitarbeiter, Antworten und Folgen ohne Leck', async () => {
    const v = [];
    const gelungen = new Set();
    for (const [schluessel, e] of Object.entries(MATRIX)) {
      if (schluessel.startsWith('GET ') || e.spezial || erwartung(e, 'gf') === 'T') continue;
      const k = await H.starteKopie(ab);
      try {
        for (const rolle of FELD) {
          for (const variante of brauchtVarianten(e) ? ['eigen', 'fremd'] : ['ohne']) {
            let a;
            try { a = await erfolgsAnfrage(k, schluessel, e, ab.F, rolle, variante); } catch (_) { a = anfrage(schluessel, e, ab.F, rolle, variante); }
            const r = await k.als(rolle).anfrage(a.methode, a.pfad, a.body === undefined ? {} : a.body);
            const wo = `${rolle} (alle Ausnahmen) ${a.methode} ${a.pfad} [${variante}]`;
            if (r.status >= 500 && !(e.erfolg && (e.erfolg.ok || []).includes(r.status))) v.push(`${wo}: ${r.status}`);
            if (r.status >= 200 && r.status < 300) gelungen.add(`${rolle} ${schluessel}`);
            if (process.env.BAUTAG_RECHTE_LOG) console.log(`${r.status} ${wo} ${r.status >= 300 ? JSON.stringify(r.daten).slice(0, 120) : ''}`);
            v.push(...await H.scanne(rolle, r, { route: schluessel, variante, url: `${a.pfad} (mit allen Ausnahmen)`, mitAusnahmen: true, erlaubteKanarien: ERLAUBT }));
            v.push(...H.berichtJsonAbwesenheitVerstoesse(k.db, ID[rolle], r.daten, wo));
            await k.ruhe();
            v.push(...(await H.pruefeAusgaenge(k, `nach ${wo}`)).filter((x) => !/Kanarienvogel Text schadenFremd/.test(x)));
          }
        }
      } finally { await k.stop(); }
    }
    if (!NUR) for (const [rolle, sch] of MUSS_GELINGEN) if (!gelungen.has(`${rolle} ${sch}`)) v.push(`${rolle} mit allen Ausnahmen: ${sch} gelingt nicht – Schreibantwort ungeprüft`);
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });
});
