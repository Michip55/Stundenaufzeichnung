'use strict';
/**
 * Prüfbericht 7 – Rechte-Matrix: JEDE registrierte Route × JEDE Rolle, mechanisch statt Stichprobe.
 *
 * 1. Abdeckung: Die Routen werden aus dem Express-Router gelesen. Fehlt eine Route in
 *    rechte-matrix.json (oder steht dort eine, die es nicht gibt), scheitert der Test – keine neue
 *    Route ohne Rechte-Entscheidung.
 * 2. Lesen: jede GET-Route × Rolle × Variante (eigenes/fremdes Objekt) × Query-Variante (F-043) → Status wie in der
 *    Matrix, Inhalt (JSON, CSV, PDF inkl. Metadaten/Anhänge, XLSX, Kopfzeilen, Fehlertexte) ohne verbotene Schlüssel,
 *    Beträge (Geld-Kanarien in jeder Schreibweise), Kanarienvögel und fremde Abwesenheiten (wertbasiert).
 *    Jeder Query-Parameter, den eine Route liest (zur Laufzeit mitgeschnitten), braucht eine Probe.
 * 3. Schreiben: in rechte-matrix-schreiben-<n>.test.js (parallel), Ausnahmen in rechte-matrix-ausnahmen.test.js.
 * 4. Ohne Anmeldung: jede nicht öffentliche Route → 401. Test-Schnittstellen ohne Token → 403.
 * 5. Benachrichtigungen (DB) und Push-Ausgang für Mitarbeiter/Polier ohne € und ohne Kanarienvögel.
 * 6. Testdaten-Selbstprüfung (F-024, F-022): fremde Abwesenheiten aller Arten an den geprüften Planer-Tagen in
 *    veröffentlichten Einsätzen, Kanarien-Beträge in jeder Preis-Spalte.
 *
 * Läuft mit dem echten Server (Sicherheitsnetz für €-Felder AN, wie im Betrieb).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./rechte-matrix-hilfe');
const { BS, U } = require('./hilfe');
const { testJpeg } = require('./fuhrpark-bilder');

const MATRIX_ALLE = JSON.parse(fs.readFileSync(path.join(__dirname, 'rechte-matrix.json'), 'utf8')).routen;
// Nur zur Fehlersuche: BAUTAG_RECHTE_NUR=<RegExp> prüft nur passende Routen (Abdeckungstest bleibt vollständig)
const NUR = process.env.BAUTAG_RECHTE_NUR ? new RegExp(process.env.BAUTAG_RECHTE_NUR) : null;
const MATRIX = Object.fromEntries(Object.entries(MATRIX_ALLE).filter(([k]) => !NUR || NUR.test(k)));
const { ROLLEN, ID, ANDERER_MA, FREMDER_MA } = H;
const VERWEIGERT = [401, 403, 404];

// Proben je Route × Rolle × Variante (Platzhalter, Erwartung): gemeinsam mit rechte-matrix-paritaet.test.js (15.4)
const { erwartung, platzhalter, brauchtVarianten, anfrage, leseProben } = require('./rechte-matrix-proben');
const istSchreibend = (m) => m !== 'GET';

test('Rechte-Matrix: jede Route × jede Rolle (Prüfbericht 7)', { timeout: 30 * 60 * 1000 }, async (t) => {
  const basis = await H.erstelleBasis();
  t.after(() => fs.rmSync(basis.ordner, { recursive: true, force: true }));
  const F = basis.F;
  const s = await H.starteKopie(basis);
  t.after(() => s.stop());
  const c = {};
  for (const r of ROLLEN) c[r] = await s.login(ID[r]);
  const anonym = s.client();
  const routen = H.routenAusApp(s.app);
  const fehler = [];
  const melde = (x) => fehler.push(x);

  await t.test('Abdeckung: jede registrierte Route hat eine Rechte-Entscheidung (und umgekehrt)', () => {
    const ohne = routen.filter((r) => !MATRIX_ALLE[r]);
    const tot = Object.keys(MATRIX_ALLE).filter((r) => !routen.includes(r));
    assert.deepEqual(ohne, [], `Routen ohne Eintrag in rechte-matrix.json:\n${ohne.join('\n')}`);
    assert.deepEqual(tot, [], `Einträge in rechte-matrix.json ohne Route:\n${tot.join('\n')}`);
    assert.ok(routen.length >= 270, `nur ${routen.length} Routen gefunden – Routen-Ermittlung defekt?`);
    // keine doppelte Registrierung derselben Methode+Pfad (die zweite wäre toter Code mit eigener Rechteprüfung)
    const doppelt = routen.filter((r, i) => routen.indexOf(r) !== i);
    assert.deepEqual(doppelt, [], `doppelt registriert: ${doppelt.join(', ')}`);
    for (const [k, e] of Object.entries(MATRIX_ALLE)) for (const r of ROLLEN) assert.ok(['J', 'N', 'E', 'O', 'T'].includes(erwartung(e, r)), `${k}: ungültiger Wert für ${r}`);
    // F-025: jede Ausnahme vom Erfolgszwang für Polier/Mitarbeiter ist begründet
    for (const [k, e] of Object.entries(MATRIX_ALLE)) if (e.erfolg && e.erfolg.ok) assert.ok(e.erfolg.okGrund, `${k}: erfolg.ok ohne okGrund`);
  });

  await t.test('Testdaten: Kanarien-Beträge in jeder Preis-Spalte, fremde Abwesenheiten aller Arten an den geprüften Planer-Tagen (F-022, F-024)', async () => {
    const v = [];
    // jede REAL-Spalte ist als Preis (Kanarie) oder Nicht-Preis entschieden
    const offen = H.W.unentschiedeneSpalten(s.db);
    if (offen.length) v.push(`Zahl-Spalten ohne Entscheidung (Preis → Kanarie in rechte-werte.PREIS_SPALTEN, sonst KEINE_PREIS_SPALTEN): ${offen.join(', ')}`);
    for (const [tab, spalten] of Object.entries(H.W.PREIS_SPALTEN)) {
      for (const sp of spalten) {
        const ohne = s.db.alle(`SELECT "${sp}" AS w FROM "${tab}" WHERE "${sp}" IS NOT NULL`).filter((z) => !H.ZUSTAND.geld.has(`c:${Math.round(z.w * 100)}`));
        if (ohne.length) v.push(`${tab}.${sp}: ${ohne.length} Werte ohne Kanarie (z. B. ${ohne[0].w})`);
      }
    }
    if (s.db.eins('SELECT COUNT(*) AS n FROM projektposition').n < 10) v.push('Testdaten ohne Projektpositionen – Kanarien-Prüfung wirkungslos');
    // fremde Abwesenheiten je geprüftem Planer-Tag: veröffentlichter Einsatz Pitten mit Polier, darin je Art eine andere Person
    const ARTEN = [['K', 'genehmigt', 0], ['U', 'genehmigt', 0], ['U', 'beantragt', 0], ['ZA', 'genehmigt', 0], ['ZA', 'beantragt', 0], ['U', 'genehmigt', 1]];
    for (const tag of H.PLAN_TAGE) {
      const e = s.db.eins('SELECT id FROM plan_einsatz WHERE datum = ? AND baustelle_id = ? AND geloescht = 0 AND veroeffentlicht_stand IS NOT NULL', tag, BS.pitten);
      if (!e) { v.push(`${tag}: kein veröffentlichter Einsatz Pitten`); continue; }
      const personen = new Set(s.db.alle('SELECT benutzer_id FROM plan_person WHERE einsatz_id = ?', e.id).map((x) => x.benutzer_id));
      for (const id of [U.polier, U.mitarbeiter]) if (!personen.has(id)) v.push(`${tag}: ${id} nicht im Einsatz`);
      for (const [code, status, bu] of ARTEN) {
        const a = s.db.alle('SELECT benutzer_id FROM abwesenheit WHERE datum = ? AND code = ? AND status = ? AND betriebsurlaub = ? AND benutzer_id NOT IN (?, ?)', tag, code, status, bu, U.polier, U.mitarbeiter).filter((x) => personen.has(x.benutzer_id));
        if (!a.length) v.push(`${tag}: keine fremde Abwesenheit ${bu ? 'BU' : code} (${status}) einer Person im Einsatz`);
      }
      // und die Proben sehen den Tag wirklich (nicht leer)
      const pa = await c.polier.get(`/plan/partie?datum=${tag}`);
      const n = pa.status === 200 ? pa.daten.einsaetze.reduce((x, y) => x + y.personen.length, 0) : 0;
      if (n < 8) v.push(`${tag}: /plan/partie liefert dem Polier ${pa.status} mit ${n} Personen – Abwesenheits-Proben laufen ins Leere`);
      for (const pdf of [`/plan/tag.pdf?datum=${tag}`]) { const r = await c.polier.get(pdf); if (r.status !== 200) v.push(`${tag}: Polier ${pdf} → ${r.status}`); }
      const ich = await c.mitarbeiter.get('/plan/ich?von=2026-11-12&bis=2026-11-20');
      if (!(ich.daten.tage || []).some((x) => x.datum === tag && x.einsatz)) v.push(`${tag}: /plan/ich des Mitarbeiters ohne Einsatz`);
    }
    // Probe-Tage der Matrix liegen auf diesen Tagen
    for (const [k, tag] of [['GET /api/plan/partie', '2026-11-13'], ['GET /api/plan/tag.pdf', '2026-11-13'], ['GET /api/plan/woche.pdf', '2026-11-09']]) if (!(MATRIX_ALLE[k].query || '').includes(tag)) v.push(`${k}: Probe nicht auf ${tag}`);
    // heute (Kolonne): K, U genehmigt und U/ZA beantragt in der Partie Pitten
    for (const [code, status] of [['K', 'genehmigt'], ['U', 'genehmigt'], ['U', 'beantragt'], ['ZA', 'beantragt']]) {
      if (!s.db.eins("SELECT 1 AS x FROM abwesenheit a JOIN benutzer b ON b.id = a.benutzer_id WHERE a.datum = '2026-11-12' AND a.code = ? AND a.status = ? AND b.baustelle_id = ? AND a.benutzer_id NOT IN (?, ?)", code, status, BS.pitten, U.polier, U.mitarbeiter)) v.push(`12.11.: keine fremde Abwesenheit ${code} (${status}) in der Partie Pitten`);
    }
    v.forEach(melde);
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  await t.test('Lesen: jede GET-Route × Rolle × Variante × Query-Variante – Status und Inhalt; jeder gelesene Query-Parameter geprüft', async () => {
    const v = [];
    // F-043: welche Query-Parameter liest eine Route wirklich? (Mitschnitt am Request-Objekt der App)
    const gelesen = new Map();
    const basisReq = Object.getPrototypeOf(s.app.request);
    const orig = Object.getOwnPropertyDescriptor(basisReq, 'query') || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(basisReq), 'query');
    Object.defineProperty(s.app.request, 'query', { configurable: true, get() {
      const q = orig.get.call(this);
      const req = this;
      return new Proxy(q || {}, { get(z, k) { if (typeof k === 'string' && req.route) { const sch = `${req.method} ${req.baseUrl}${req.route.path}`; if (!gelesen.has(sch)) gelesen.set(sch, new Set()); gelesen.get(sch).add(k); } return z[k]; } });
    } });
    const geprueft = new Map();
    for (const [schluessel, e] of Object.entries(MATRIX)) {
      if (!schluessel.startsWith('GET ') || e.spezial) continue;
      for (const rolle of ROLLEN) {
        for (const variante of brauchtVarianten(e) ? ['eigen', 'fremd'] : ['ohne']) {
          for (const { a, eintrag, name } of leseProben(schluessel, e, F, rolle, variante)) {
            const erw = erwartung(eintrag, rolle);
            const kopf = erw === 'T' ? { 'x-bautag-test-token': '' } : undefined;
            const r = await c[rolle].anfrage('GET', a.pfad, undefined, kopf);
            const wo = `${rolle} GET ${a.pfad} [${variante}${name === 'Probe' ? '' : `, ${name}`}]`;
            const erlaubt = erw === 'J' || erw === 'O' || (erw === 'E' && variante !== 'fremd');
            if (erw === 'T') { if (r.status !== 403) v.push(`${wo}: Test-Schnittstelle ohne Token → ${r.status} (erwartet 403)`); }
            else if (erlaubt) { const ok = e.ok || [200]; if (!ok.includes(r.status)) v.push(`${wo}: erlaubt laut Matrix, aber ${r.status} ${JSON.stringify(r.daten).slice(0, 160)}`); }
            else if (!VERWEIGERT.includes(r.status)) v.push(`${wo}: LECK – verweigert laut Matrix (${e.grund}), aber ${r.status}`);
            v.push(...await H.scanne(rolle, r, { route: schluessel, variante, url: a.pfad }));
            const qs = new URLSearchParams(a.pfad.split('?')[1] || '');
            if (!geprueft.has(schluessel)) geprueft.set(schluessel, new Set());
            for (const k of qs.keys()) geprueft.get(schluessel).add(k);
          }
        }
      }
    }
    Object.defineProperty(s.app.request, 'query', orig);
    // Abdeckung der Query-Parameter (Parameter, die eine Route liest, aber keine Probe setzt)
    for (const [sch, keys] of gelesen) {
      if (!MATRIX[sch] || !sch.startsWith('GET ') || MATRIX[sch].spezial) continue;
      const fehlt = [...keys].filter((k) => !(geprueft.get(sch) || new Set()).has(k) && !(MATRIX[sch].queryOhneProbe || []).includes(k));
      if (fehlt.length) v.push(`${sch}: liest Query-Parameter ${fehlt.join(', ')} – keine Probe in der Matrix („varianten“ ergänzen, F-043)`);
    }
    v.forEach(melde);
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  await t.test('Ohne Anmeldung: jede nicht öffentliche Route → 401, Test-Schnittstellen ohne Token → 403', async () => {
    const v = [];
    for (const [schluessel, e] of Object.entries(MATRIX)) {
      const erw = erwartung(e, 'mitarbeiter');
      if (erw === 'O' || e.spezial) continue;
      const a = anfrage(schluessel, e, F, 'mitarbeiter', 'fremd');
      const r = await anonym.anfrage(a.methode, a.pfad, a.methode === 'GET' ? undefined : (a.body || {}), erw === 'T' ? { 'x-bautag-test-token': '' } : undefined);
      const soll = erw === 'T' ? 403 : 401;
      if (r.status !== soll && !(schluessel === 'POST /api/auth/logout' && r.status === 200)) v.push(`anonym ${a.methode} ${a.pfad}: ${r.status} statt ${soll}`);
      v.push(...await H.scanne('mitarbeiter', r, { route: schluessel, url: `${a.pfad} (anonym)` }));
    }
    v.forEach(melde);
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  await t.test('Benachrichtigungen (alle Mitarbeiter/Poliere in der DB) und Push-Ausgang ohne € und ohne Kanarienvögel', async () => {
    const v = [];
    const rollen = new Map(s.db.alle('SELECT id, rolle FROM benutzer').map((b) => [b.id, b.rolle]));
    for (const n of s.db.alle('SELECT * FROM benachrichtigung')) {
      const rolle = rollen.get(n.benutzer_id);
      if (!['mitarbeiter', 'polier'].includes(rolle)) continue;
      if (n.typ === 'budget') v.push(`Budget-Benachrichtigung an ${rolle} ${n.benutzer_id}: ${n.titel}`);
      const fuhrpark = H.hatRecht(s.db, n.benutzer_id, 'fuhrpark');
      v.push(...await H.scanne(rolle, { status: 200, daten: { titel: n.titel, text: n.text }, headers: new Map() }, { route: 'DB benachrichtigung', url: `benachrichtigung ${n.id} an ${n.benutzer_id}`, erlaubteKanarien: fuhrpark ? ['Text schadenFremd'] : [] }));
    }
    // Ereignisse auf diesem Server auslösen, damit Push und E-Mail hier entstehen (der Ausgang ist je Server im Speicher)
    const e1 = (await c.gf.get(`/plan/woche?von=${F.datumMorgen}`)).daten.einsaetze.find((x) => x.id === F.einsatz.bs1);
    await c.gf.put(`/plan/einsaetze/${F.einsatz.bs1}`, { version: e1.version, arbeit: 'Pflaster geändert' });
    await c.gf.post('/plan/veroeffentlichen', { von: F.datumMorgen });
    await c.buero.put(`/abwesenheiten/antraege/${F.urlaubEigen}`, { status: 'genehmigt', antwort: 'ok' });
    await c.gf.post(`/baustellen/${BS.pitten}/nachtraege`, { text: 'Push-Probe', betrag: -76000 });
    await c.gf.put(`/baustellen/${BS.pitten}/auftrag`, { version: (await c.gf.get(`/baustellen/${BS.pitten}`)).daten.version, auftragssumme: 1000 });
    await c.mitarbeiter.post('/fuhrpark/schaeden', { anlageId: 4, art: 'defekt', ursache: 'Push-Probe Schaden am Gerät', einsatzfaehig: 'nein' });
    const em = await c.gf.post(`/berichte/${F.bericht.bs1Alt}/email`, { an: 'ag@example.test' });
    if (em.status !== 202) v.push(`E-Mail-Versand für die Prüfung nicht ausgelöst (${em.status})`);
    await c.gf.post('/test/stuendlich', {});
    const aus = (await c.gf.get('/test/ausgang')).daten;
    if (!aus.push.length) v.push('kein Push im Ausgang – Prüfung der Push-Texte wirkungslos');
    for (const p of aus.push) {
      const rolle = rollen.get(p.benutzerId);
      if (rolle === 'buero' || rolle === 'gf') continue;
      v.push(...await H.scanne(rolle, { status: 200, daten: p, headers: new Map() }, { route: 'PUSH', url: `push an ${p.benutzerId}`, variante: rolle === 'bauleiter' ? 'fremd' : undefined }));
    }
    // E-Mails (Ausgang) samt Anhang-INHALT (F-039): gehen an Auftraggeber (extern) → strengste Prüfung wie Mitarbeiter
    s.__ausgang = { benachrichtigung: Number.MAX_SAFE_INTEGER, push: aus.push.length, mails: 0 };
    v.push(...await H.pruefeAusgaenge(s, 'Ausgang'));
    if (!aus.mails.some((m) => (m.anhaenge || []).length && H.ANHAENGE.has(m.anhaenge[0].groesse))) v.push('keine Mail mit mitgeschnittenem Anhang – Prüfung der Anhänge wirkungslos');
    v.forEach(melde);
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  await t.test('Rechteprüfung vor Zustandsprüfung: verweigerte Rollen mit veralteter version → 401/403/404 bzw. 400 ohne Fachauskunft, nie 409', async () => {
    const v = [];
    const k = await H.starteKopie(basis);
    try {
      const kc = Object.fromEntries(await Promise.all(ROLLEN.map(async (r) => [r, await k.login(ID[r])])));
      for (const [schluessel, e] of Object.entries(MATRIX)) {
        const methode = schluessel.split(' ')[0];
        if (!istSchreibend(methode) || e.spezial || e.nein400) continue;
        for (const rolle of ROLLEN) {
          const erw = erwartung(e, rolle);
          for (const variante of brauchtVarianten(e) ? ['eigen', 'fremd'] : ['ohne']) {
            const erlaubt = erw === 'J' || erw === 'O' || erw === 'T' || (erw === 'E' && variante !== 'fremd');
            if (erlaubt) continue;
            const a = anfrage(schluessel, e, F, rolle, variante);
            const vorher = H.dbHash(k);
            // Body der Matrix, aber veraltete version: ein 409 (mit aktueller version/Zustand) vor der Rechteprüfung wäre eine Auskunft an Unberechtigte.
            // 400 ist hingenommen, wenn das Ziel (z. B. baustelleId) erst aus dem Body kommt – der Scanner prüft den Fehlertext.
            const r = await kc[rolle].anfrage(methode, a.pfad, { ...(a.body && typeof a.body === 'object' ? a.body : {}), version: 999999 });
            if (![...VERWEIGERT, 400].includes(r.status)) v.push(`${rolle} ${methode} ${a.pfad} [${variante}] mit veralteter version → ${r.status} ${JSON.stringify(r.daten).slice(0, 140)} (Zustand vor Rechten geprüft)`);
            const diff = H.dbUnterschied(vorher, H.dbHash(k));
            if (diff.length) v.push(`${rolle} ${methode} ${a.pfad} [${variante}] mit veralteter version: DB geändert (${diff.join(', ')})`);
            v.push(...await H.scanne(rolle, r, { route: schluessel, variante, url: `${a.pfad} (veraltete version)` }));
          }
        }
      }
    } finally { await k.stop(); }
    v.forEach(melde);
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  await t.test('Rechteprüfung zuerst (15.7, F-036): verweigerte Rollen erhalten mit ungültigem Body dieselbe Antwort wie mit gültigem – keine 400/404-Auskunft', async () => {
    const v = [];
    const k = await H.starteKopie(basis);
    // ungültige Bodys: leer, jeder Wert mit falschem Typ, jede Zahl als nicht vorhandene ID
    const falsch = (b) => (b && typeof b === 'object' && !Array.isArray(b) ? Object.fromEntries(Object.keys(b).map((x) => [x, { ungueltig: true }])) : { ungueltig: true });
    const fremdId = (b) => (b && typeof b === 'object' && !Array.isArray(b) ? Object.fromEntries(Object.entries(b).map(([x, w]) => [x, typeof w === 'number' ? 999999 : Array.isArray(w) && w.length && w.every((y) => typeof y === 'number') ? w.map(() => 999999) : w])) : {});
    try {
      const kc = Object.fromEntries(await Promise.all(ROLLEN.map(async (r) => [r, await k.login(ID[r])])));
      let geprueft = 0;
      for (const [schluessel, e] of Object.entries(MATRIX)) {
        const methode = schluessel.split(' ')[0];
        if (!istSchreibend(methode) || e.spezial || e.nein400) continue;
        for (const rolle of ROLLEN) {
          // nur Rollen ganz ohne Recht auf die Route (N): bei E (eigener Bereich) kann das Ziel erst aus dem Body kommen
          if (erwartung(e, rolle) !== 'N') continue;
          for (const variante of brauchtVarianten(e) ? ['eigen', 'fremd'] : ['ohne']) {
            const a = anfrage(schluessel, e, F, rolle, variante);
            const gueltig = a.body === undefined ? {} : a.body;
            const vorher = H.dbHash(k.db);
            const soll = await kc[rolle].anfrage(methode, a.pfad, gueltig);
            // zusätzlich: nicht vorhandene ID im Pfad (gültiger Body) – ein 404 vor der Rechteprüfung wäre eine Existenzauskunft
            const pfadFremd = a.pfad.replace(/\/\d+(?=\/|\?|$)/g, '/999999');
            const proben = [['leer', {}, a.pfad], ['falscher Typ', falsch(gueltig), a.pfad], ['unbekannte ID', fremdId(gueltig), a.pfad], ...(pfadFremd !== a.pfad ? [['gültig, unbekannte Pfad-ID', gueltig, pfadFremd]] : [])];
            for (const [art, body, pfad] of proben) {
              const r = await kc[rolle].anfrage(methode, pfad, body);
              geprueft++;
              const wo = `${rolle} ${methode} ${pfad} [${variante}] Body ${art}`;
              if (!VERWEIGERT.includes(r.status)) v.push(`${wo} → ${r.status} ${JSON.stringify(r.daten).slice(0, 140)} (Prüfung vor den Rechten)`);
              else if (r.status !== soll.status) v.push(`${wo} → ${r.status}, mit gültigem Body ${soll.status} (Antwort hängt vom Body ab)`);
              v.push(...await H.scanne(rolle, r, { route: schluessel, variante, url: `${a.pfad} (Body ${art})` }));
            }
            const diff = H.dbUnterschied(vorher, H.dbHash(k.db));
            if (diff.length) v.push(`${rolle} ${methode} ${a.pfad} [${variante}] mit ungültigem Body: DB geändert (${diff.join(', ')})`);
          }
        }
      }
      if (!NUR && geprueft < 300) v.push(`nur ${geprueft} Proben mit ungültigem Body – Probe wirkungslos?`);
    } finally { await k.stop(); }
    v.forEach(melde);
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  t.after(() => {
    if (process.env.BAUTAG_RECHTE_BERICHT) fs.writeFileSync(process.env.BAUTAG_RECHTE_BERICHT, JSON.stringify({ routen: routen.length, fehler }, null, 1));
  });
});

module.exports = { MATRIX: MATRIX_ALLE, erwartung, platzhalter, anfrage, brauchtVarianten };
