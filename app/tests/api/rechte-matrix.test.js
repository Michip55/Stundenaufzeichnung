'use strict';
/**
 * Prüfbericht 7 – Rechte-Matrix: JEDE registrierte Route × JEDE Rolle, mechanisch statt Stichprobe.
 *
 * 1. Abdeckung: Die Routen werden aus dem Express-Router gelesen. Fehlt eine Route in
 *    rechte-matrix.json (oder steht dort eine, die es nicht gibt), scheitert der Test – keine neue
 *    Route ohne Rechte-Entscheidung.
 * 2. Lesen: jede GET-Route × Rolle × Variante (eigenes/fremdes Objekt) → Status wie in der Matrix,
 *    Inhalt (JSON, CSV, PDF, XLSX, auch Fehlertexte) ohne verbotene Schlüssel, €-Beträge und Kanarienvögel.
 * 3. Schreiben: jede schreibende Route × verweigerte Rolle → 401/403/404 UND Datenbank unverändert;
 *    erlaubte Rollen werden nicht abgewiesen (eigene DB-Kopie je Probe).
 * 4. Ohne Anmeldung: jede nicht öffentliche Route → 401. Test-Schnittstellen ohne Token → 403.
 * 5. Benachrichtigungen (DB) und Push-Ausgang für Mitarbeiter/Polier ohne € und ohne Kanarienvögel.
 * 6. Ausnahmen: GF erteilt Polier/Mitarbeiter/Bauleiter alle Rechte als Ausnahme über die offizielle API –
 *    gesperrte Rechte werden abgelehnt, und alle Lese-Routen bleiben für sie €-frei.
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

/** Erwartung je Rolle aus dem Matrix-Eintrag */
function erwartung(eintrag, rolle) {
  const teile = eintrag.r.split(/\s+/);
  if (teile.length !== 5) throw new Error(`Matrix-Eintrag mit ${teile.length} statt 5 Rollen: ${eintrag.r}`);
  return teile[ROLLEN.indexOf(rolle)];
}

/** Platzhalter je Rolle und Variante (eigen = Objekt im eigenen Bereich, fremd = außerhalb) */
const BEREICHS_PLATZHALTER = new Set(['bs', 'bericht', 'berichtAlt', 'berichtFoto', 'berichtLink', 'rechnung', 'zahlung', 'pos', 'posStand', 'posMenge', 'leistung', 'nachtrag', 'fremd', 'lv',
  'dok', 'einsatz', 'einsatzPerson', 'einsatzAnlage', 'fuhre', 'fuhreFoto', 'abschnitt', 'anfrage', 'schaden', 'schadenFoto', 'ichOderAnderer', 'person', 'abwEigen', 'antragEigen', 'abwAnderer', 'antragAnderer',
  'benachrichtigung', 'pushAbo', 'bsVersion']);
function platzhalter(F, rolle, variante) {
  const e = variante !== 'fremd';
  const anderRolle = rolle === 'gf' ? 'buero' : 'gf';
  return {
    bs: e ? BS.pitten : BS.reisinger,
    bericht: e ? F.bericht.bs1 : F.bericht.bs3,
    berichtAlt: e ? F.bericht.bs1Alt : F.bericht.bs3Alt,
    berichtFoto: e ? F.bericht.bs1Foto : F.bericht.bs3Foto,
    berichtLink: e ? F.bericht.bs1Link : F.bericht.bs3Link,
    rechnung: e ? F.rechnung.bs1 : F.rechnung.bs3,
    zahlung: e ? F.rechnung.bs1Zahlung : F.rechnung.bs3Zahlung,
    pos: e ? F.pos.bs1 : F.pos.bs3,
    posStand: e ? F.pos.bs1Stand : F.pos.bs3Stand,
    posMenge: e ? F.pos.bs1MengeBl : F.pos.bs3MengePos,
    bsVersion: e ? F.bsVersion.bs1 : F.bsVersion.bs3,
    leistung: e ? F.leistung.bs1 : F.leistung.bs3,
    nachtrag: e ? F.nachtrag.bs1 : F.nachtrag.bs3,
    fremd: e ? F.fremd.bs1 : F.fremd.bs3,
    lv: e ? F.lv.bs1 : F.lv.bs3,
    dok: e ? F.dok.planBs1 : F.dok.planBs3,
    einsatz: e ? F.einsatz.bs1 : F.einsatz.bs3,
    einsatzPerson: e ? ANDERER_MA : FREMDER_MA,
    einsatzAnlage: e ? 4 : 5,
    fuhre: e ? F.fuhre.bs1 : F.fuhre.bs3,
    fuhreFoto: e ? F.fuhreFoto.bs1 : F.fuhreFoto.bs3,
    abschnitt: e ? F.abschnitt.bs1 : F.abschnitt.bs3,
    anfrage: e ? F.anfrage.bs1 : F.anfrage.bs3,
    schaden: e ? F.schaden.eigen : F.schaden.fremd,
    schadenFoto: e ? F.schaden.eigenFoto : F.schaden.fremdFoto,
    ichOderAnderer: e ? ID[rolle] : ANDERER_MA,
    person: e ? ANDERER_MA : FREMDER_MA,
    abwEigen: e ? F.urlaubEigenRolle[rolle].tag : F.urlaubAndererTag,
    antragEigen: e ? F.urlaubEigenRolle[rolle].antrag : F.urlaubAnderer,
    abwAnderer: e ? F.urlaubAnderer1Tag : F.urlaubFremdTag,
    antragAnderer: e ? F.urlaubAnderer : F.urlaubFremd,
    benachrichtigung: e ? F.benachrichtigung[rolle] : F.benachrichtigung[anderRolle],
    pushAbo: e ? F.pushAbo[rolle] : F.pushAbo[anderRolle],
    // ohne Bereich
    anlage: F.anlage, zaehler: F.zaehler, zaehlerstand: F.zaehlerstand, planposition: F.planposition, vorlage: F.vorlage, mangel: F.mangel, eintrag: F.eintrag,
    katalogPos: F.katalogPos, katalogStand: F.katalogStand, preisStand: F.preisStand, kategorie: F.kategorie, lohnVorlage: F.lohnVorlage, lohngruppeVerlauf: F.lohngruppeVerlauf,
    dummy: F.dummyBenutzer, buchungAnderer: F.buchung.anderer, schichtAnderer: F.schicht.anderer, token: F.bericht.bs1Token,
    jpeg: testJpeg().toString('base64'), pdf: H.kleinesPdf('Probe').toString('base64')
  };
}
function brauchtVarianten(eintrag) {
  const s = JSON.stringify([eintrag.pfad || '', eintrag.query || '', eintrag.body || null]);
  return [...s.matchAll(/\{([a-zA-Z]+)\}/g)].some((m) => BEREICHS_PLATZHALTER.has(m[1]));
}
function ersetze(wert, P) {
  if (typeof wert === 'string') {
    const ganz = /^\{([a-zA-Z]+)\}$/.exec(wert);
    if (ganz) { if (!(ganz[1] in P)) throw new Error(`Platzhalter {${ganz[1]}} unbekannt`); return P[ganz[1]]; }
    return wert.replace(/\{([a-zA-Z]+)\}/g, (_, k) => { if (!(k in P)) throw new Error(`Platzhalter {${k}} unbekannt`); return String(P[k]); });
  }
  if (Array.isArray(wert)) return wert.map((x) => ersetze(x, P));
  if (wert && typeof wert === 'object') return Object.fromEntries(Object.entries(wert).map(([k, x]) => [k, ersetze(x, P)]));
  return wert;
}
/** Konkrete Anfrage (Pfad ohne /api, Body) für Route × Rolle × Variante */
function anfrage(schluessel, eintrag, F, rolle, variante) {
  const [methode, routePfad] = schluessel.split(' ');
  const P = platzhalter(F, rolle, variante);
  let pfad = eintrag.pfad || routePfad;
  if (/:[a-zA-Z]|\*/.test(pfad)) throw new Error(`${schluessel}: Pfad mit Parametern braucht "pfad" in der Matrix`);
  pfad = ersetze(pfad, P) + (eintrag.query ? ersetze(eintrag.query, P) : '');
  const body = eintrag.body === undefined ? undefined : ersetze(eintrag.body, P);
  return { methode, pfad: pfad.replace(/^\/api/, ''), body };
}
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
  });

  await t.test('Lesen: jede GET-Route × Rolle × Variante – Status und Inhalt', async () => {
    const v = [];
    for (const [schluessel, e] of Object.entries(MATRIX)) {
      if (!schluessel.startsWith('GET ') || e.spezial) continue;
      for (const rolle of ROLLEN) {
        const erw = erwartung(e, rolle);
        for (const variante of brauchtVarianten(e) ? ['eigen', 'fremd'] : ['ohne']) {
          const a = anfrage(schluessel, e, F, rolle, variante);
          const kopf = erw === 'T' ? { 'x-bautag-test-token': '' } : undefined;
          const r = await c[rolle].anfrage('GET', a.pfad, undefined, kopf);
          const wo = `${rolle} GET ${a.pfad} [${variante}]`;
          const erlaubt = erw === 'J' || erw === 'O' || (erw === 'E' && variante !== 'fremd');
          if (erw === 'T') { if (r.status !== 403) v.push(`${wo}: Test-Schnittstelle ohne Token → ${r.status} (erwartet 403)`); }
          else if (erlaubt) { const ok = e.ok || [200]; if (!ok.includes(r.status)) v.push(`${wo}: erlaubt laut Matrix, aber ${r.status} ${JSON.stringify(r.daten).slice(0, 160)}`); }
          else if (!VERWEIGERT.includes(r.status)) v.push(`${wo}: LECK – verweigert laut Matrix (${e.grund}), aber ${r.status}`);
          v.push(...await H.scanne(rolle, r, { route: schluessel, variante, url: a.pfad }));
        }
      }
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
    // E-Mails (Ausgang): gehen an Auftraggeber (extern) → strengste Prüfung wie Mitarbeiter
    for (const m of aus.mails) v.push(...await H.scanne('mitarbeiter', { status: 200, daten: { an: m.an, betreff: m.betreff, text: m.text, anhaenge: m.anhaenge }, headers: new Map() }, { route: 'MAIL', url: `Mail an ${m.an}` }));
    v.forEach(melde);
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  await t.test('Schreiben: verweigerte Rollen werden abgewiesen und ändern nichts; erlaubte werden nicht abgewiesen', async () => {
    const v = [];
    const schreib = Object.entries(MATRIX).filter(([k, e]) => istSchreibend(k.split(' ')[0]) && !e.spezial);
    for (const [schluessel, e] of schreib) {
      const varianten = brauchtVarianten(e) ? ['eigen', 'fremd'] : ['ohne'];
      const proben = [];
      for (const rolle of ROLLEN) for (const variante of varianten) {
        const erw = erwartung(e, rolle);
        const erlaubt = erw === 'J' || erw === 'O' || (erw === 'E' && variante !== 'fremd');
        proben.push({ rolle, variante, erw, erlaubt });
      }
      // 1) alle verweigerten Proben auf einer Kopie, DB-Fingerabdruck vor/nach jeder Probe
      let k = await H.starteKopie(basis);
      let kc = Object.fromEntries(await Promise.all(ROLLEN.map(async (r) => [r, await k.login(ID[r])])));
      for (const p of proben.filter((x) => !x.erlaubt)) {
        const a = anfrage(schluessel, e, F, p.rolle, p.variante);
        const vorher = H.dbHash(k.db);
        const r = await kc[p.rolle].anfrage(a.methode, a.pfad, a.body === undefined ? {} : a.body, p.erw === 'T' ? { 'x-bautag-test-token': '' } : undefined);
        const nachher = H.dbHash(k.db);
        const wo = `${p.rolle} ${a.methode} ${a.pfad} [${p.variante}]`;
        const ok = p.erw === 'T' ? [403] : e.nein400 ? [...VERWEIGERT, 400] : VERWEIGERT;
        if (!ok.includes(r.status)) v.push(`${wo}: LECK – verweigert laut Matrix (${e.grund}), aber ${r.status} ${JSON.stringify(r.daten).slice(0, 200)}`);
        const diff = H.dbUnterschied(vorher, nachher);
        if (diff.length) v.push(`${wo}: Datenbank geändert trotz Ablehnung (${r.status}): Tabellen ${diff.join(', ')}`);
        v.push(...await H.scanne(p.rolle, r, { route: schluessel, variante: p.variante, url: a.pfad }));
      }
      // 2) erlaubte Proben: je Probe eine frische Kopie (die erste nutzt die unveränderte Kopie von oben)
      let erste = true;
      for (const p of proben.filter((x) => x.erlaubt)) {
        if (!erste) { await k.stop(); k = await H.starteKopie(basis); kc = Object.fromEntries(await Promise.all(ROLLEN.map(async (r) => [r, await k.login(ID[r])]))); }
        erste = false;
        const a = anfrage(schluessel, e, F, p.rolle, p.variante);
        const r = await kc[p.rolle].anfrage(a.methode, a.pfad, a.body === undefined ? {} : a.body);
        const wo = `${p.rolle} ${a.methode} ${a.pfad} [${p.variante}]`;
        const ok = e.ok ? e.ok.includes(r.status) : !VERWEIGERT.includes(r.status) && r.status < 500;
        if (!ok) v.push(`${wo}: erlaubt laut Matrix, aber ${r.status} ${JSON.stringify(r.daten).slice(0, 200)}`);
        v.push(...await H.scanne(p.rolle, r, { route: schluessel, variante: p.variante, url: a.pfad }));
      }
      await k.stop();
    }
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
            const vorher = H.dbHash(k.db);
            // Body der Matrix, aber veraltete version: ein 409 (mit aktueller version/Zustand) vor der Rechteprüfung wäre eine Auskunft an Unberechtigte.
            // 400 ist hingenommen, wenn das Ziel (z. B. baustelleId) erst aus dem Body kommt – der Scanner prüft den Fehlertext.
            const r = await kc[rolle].anfrage(methode, a.pfad, { ...(a.body && typeof a.body === 'object' ? a.body : {}), version: 999999 });
            if (![...VERWEIGERT, 400].includes(r.status)) v.push(`${rolle} ${methode} ${a.pfad} [${variante}] mit veralteter version → ${r.status} ${JSON.stringify(r.daten).slice(0, 140)} (Zustand vor Rechten geprüft)`);
            const diff = H.dbUnterschied(vorher, H.dbHash(k.db));
            if (diff.length) v.push(`${rolle} ${methode} ${a.pfad} [${variante}] mit veralteter version: DB geändert (${diff.join(', ')})`);
            v.push(...await H.scanne(rolle, r, { route: schluessel, variante, url: `${a.pfad} (veraltete version)` }));
          }
        }
      }
    } finally { await k.stop(); }
    v.forEach(melde);
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  await t.test('Ausnahmen: gesperrte Rechte lassen sich nicht vergeben; mit allen übrigen Ausnahmen bleiben MA/Polier €-frei und der Bauleiter ohne Preis-/Lohnbearbeitung', async () => {
    const v = [];
    const k = await H.starteKopie(basis);
    try {
      const gf = await k.login(U.gf);
      const rechte = (await gf.get('/rechte')).daten;
      const alle = rechte.rechte.map((x) => x.schluessel);
      for (const [rolle, id] of [['mitarbeiter', U.mitarbeiter], ['polier', U.polier], ['bauleiter', U.bauleiter]]) {
        for (const recht of alle) {
          const r = await gf.put('/rechte/ausnahme', { benutzerId: id, recht, wert: true });
          const gesperrt = rechte.gesperrt[rolle].includes(recht);
          if (gesperrt && r.status !== 400) v.push(`Ausnahme ${recht} für ${rolle} → ${r.status} (gesperrt, erwartet 400)`);
          if (!gesperrt && r.status !== 200) v.push(`Ausnahme ${recht} für ${rolle} → ${r.status} (erwartet 200)`);
        }
        // auch über die Rollen-Matrix nicht
        for (const recht of rechte.gesperrt[rolle]) {
          const r = await gf.put('/rechte/matrix', { rolle, recht, wert: true });
          if (r.status !== 400) v.push(`Matrix ${rolle}.${recht}=true → ${r.status} (gesperrt, erwartet 400)`);
        }
        const ich = (await (await k.login(id)).get('/auth/ich')).daten.rechte;
        for (const g of rechte.gesperrt[rolle]) if (ich.includes(g)) v.push(`${rolle} hat trotz Sperre das Recht ${g}`);
      }
      // alle GET-Routen erneut mit maximalen Ausnahmen: Inhalt prüfen (Status darf jetzt 200 sein)
      const kc = {};
      for (const r of ['mitarbeiter', 'polier', 'bauleiter']) kc[r] = await k.login(ID[r]);
      for (const [schluessel, e] of Object.entries(MATRIX)) {
        if (!schluessel.startsWith('GET ') || e.spezial || erwartung(e, 'gf') === 'T') continue;
        for (const rolle of ['mitarbeiter', 'polier', 'bauleiter']) {
          for (const variante of brauchtVarianten(e) ? ['eigen', 'fremd'] : ['ohne']) {
            const a = anfrage(schluessel, e, F, rolle, variante);
            const r = await kc[rolle].get(a.pfad);
            if (r.status >= 500) v.push(`${rolle} (alle Ausnahmen) GET ${a.pfad}: ${r.status}`);
            // Ausnahme `fuhrpark` (für alle Rollen vergebbar, API.md 11.1) zeigt alle Schadensmeldungen – nur dieser Kanarienvogel ist dann erlaubt
            v.push(...(await H.scanne(rolle, r, { route: schluessel, variante, url: `${a.pfad} (mit allen Ausnahmen)`, mitAusnahmen: true, erlaubteKanarien: ['Text schadenFremd'] })));
          }
        }
      }
      // Bauleiter: preise_bearbeiten/lohn bleiben aus, auch mit allen Ausnahmen
      for (const [m, p, b] of [['PUT', '/preise/leistungen/3', { feld: 'ep', wert: 1 }], ['GET', '/monat', undefined], ['GET', '/monat/export.csv', undefined], ['POST', `/baustellen/${BS.pitten}/nachtraege`, { text: 'x', betrag: 1 }], ['POST', `/baustellen/${BS.pitten}/rechnungen`, { nr: 'X-1', typ: 'teil', datum: '2026-11-01', netto: 1 }]]) {
        const r = await kc.bauleiter.anfrage(m, p, b);
        if (r.status !== 403) v.push(`Bauleiter mit allen Ausnahmen ${m} ${p} → ${r.status} (erwartet 403)`);
      }
    } finally { await k.stop(); }
    v.forEach(melde);
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  t.after(() => {
    if (process.env.BAUTAG_RECHTE_BERICHT) fs.writeFileSync(process.env.BAUTAG_RECHTE_BERICHT, JSON.stringify({ routen: routen.length, fehler }, null, 1));
  });
});

module.exports = { MATRIX: MATRIX_ALLE, erwartung, platzhalter, anfrage, brauchtVarianten };
