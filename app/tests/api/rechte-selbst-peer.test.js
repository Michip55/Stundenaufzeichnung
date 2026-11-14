'use strict';
/**
 * F-053: Selbst- und Peer-Varianten der Verwaltungsrouten (Regel 1: Rechte gelten zu 100 %, keine Umgehung;
 * Regel 4: Bauleiter = Büro allein über die Rechte).
 *  - Selbst: eigene Rolle/Aktiv/PIN über die Verwaltung (statt /auth/pin mit alter PIN), eigene Rechte/Ausnahmen, eigene
 *    Zwei-Faktor-Rücksetzung, eigenes Entsperren, eigenes Urlaubskonto, eigener Antrag/eigene genehmigte Abwesenheit,
 *    Betriebsurlaub für sich selbst (bleibt beantragt – Vier-Augen-Prinzip).
 *  - Gleichrangig: Büro → anderes Büro, Bauleiter → anderer Bauleiter, Büro ↔ Bauleiter (Bauleiter = Büro: Konten mit
 *    Büro-gleichen Rechten verwaltet nur die GF, F-050).
 *  - Auf die GF: niemand außer der GF selbst ändert das GF-Konto, setzt ihre 2FA zurück oder hebt ihre Sperren auf (F-051).
 * Jede abgelehnte Probe: 400/401/403/404 UND nichts verändert (Datenbank inkl. Sitzungen, Dateien, Ausgang).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const H = require('./rechte-matrix-hilfe');
const { U } = require('./hilfe');
const { testJpeg, testWebp } = require('./fuhrpark-bilder');

const ABGELEHNT = [400, 401, 403, 404];

test('Selbst-/Peer-Varianten der Verwaltungsrouten (F-053)', { timeout: 10 * 60 * 1000 }, async (t) => {
  const basis = await H.erstelleBasis();
  t.after(() => fs.rmSync(basis.ordner, { recursive: true, force: true }));
  const F = basis.F;
  const B2 = F.peer.buero, BL2 = F.peer.bauleiter;
  // Ausgangsstand: eigene genehmigte Abwesenheit und eigener offener Antrag je Rolle (über die API), als eigene Basis
  const vk = await H.starteKopie(basis);
  const eigen = {};
  for (const [id, wer] of [[U.mitarbeiter, 'buero'], [U.polier, 'buero'], [U.bauleiter, 'buero'], [U.buero, 'gf'], [U.gf, 'buero']]) {
    const r = await vk.als(wer).post('/abwesenheiten/zeitraum', { benutzerId: id, von: '2026-12-29', bis: '2026-12-29', code: 'U' });
    assert.equal(r.status, 201, `Vorbereitung genehmigte Abwesenheit ${id}: ${JSON.stringify(r.daten)}`);
    const zeile = vk.db.eins("SELECT id, status FROM abwesenheit WHERE benutzer_id = ? AND datum = '2026-12-29'", id);
    assert.equal(zeile.status, 'genehmigt');
    const a = await vk.als(id).post('/abwesenheiten/zeitraum', { benutzerId: id, von: '2027-01-12', bis: '2027-01-13', code: 'U' });
    assert.equal(a.status, 201, `Vorbereitung eigener Antrag ${id}: ${JSON.stringify(a.daten)}`);
    eigen[id] = { abw: zeile.id, antrag: a.daten.antragId };
  }
  await vk.ruhe();
  await vk.stopOhneAufraeumen();
  const sb = { ordner: vk.ordner, datei: require('node:path').join(vk.ordner, 'basis.db'), F };
  t.after(() => vk.aufraeumen());
  // nach jeder Probe, die (fälschlich) etwas verändert hat, frisch beginnen – sonst verfälscht sie die folgenden
  let k = await H.starteKopie(sb);
  t.after(() => k.stop());
  const frisch = async () => { await k.stop(); k = await H.starteKopie(sb); };

  const v = [];
  /** Probe, die abgelehnt werden muss: Status UND unveränderter Zustand */
  const nein = async (wer, m, p, body, grund, darfAendern = []) => {
    await k.ruhe();
    const vorher = H.dbHash(k);
    const r = await k.als(wer).anfrage(m, p, body);
    await k.ruhe();
    const diff = H.dbUnterschied(vorher, H.dbHash(k)).filter((x) => !darfAendern.includes(x));
    const wo = `${wer} ${m} /api${p} ${body ? JSON.stringify(body).slice(0, 60) : ''}`;
    if (!ABGELEHNT.includes(r.status)) v.push(`${wo} → ${r.status} (erwartet Ablehnung: ${grund}) ${JSON.stringify(r.daten).slice(0, 140)}`);
    if (diff.length) v.push(`${wo}: Zustand geändert (${diff.join(', ')}) – ${grund}`);
    if (diff.length || !ABGELEHNT.includes(r.status) || darfAendern.length) await frisch();
  };

  await t.test('Selbst: eigene Rolle, Aktiv, PIN über die Verwaltung, eigene Rechte/2FA/Sperre', async () => {
    v.length = 0;
    for (const id of [U.mitarbeiter, U.polier, U.bauleiter, U.buero, U.gf]) {
      await nein(id, 'PUT', `/benutzer/${id}`, { rolle: id === U.gf ? 'buero' : 'gf' }, 'eigene Rolle ändert niemand selbst');
      await nein(id, 'PUT', `/benutzer/${id}`, { aktiv: false }, 'niemand deaktiviert sich selbst');
      await nein(id, 'POST', `/benutzer/${id}/entsperren`, {}, 'das eigene Konto entsperrt eine andere Person');
      await nein(id, 'DELETE', `/benutzer/${id}/2fa`, undefined, 'die eigene 2FA setzt eine andere Person zurück');
      // der Fehlversuch selbst wird gezählt (Anmeldebremse) – sonst ändert sich nichts
      await nein(id, 'POST', '/auth/pin', { alt: '999999', neu: '583920' }, 'PIN-Wechsel nur mit richtiger alter PIN', ['login_versuch', 'login_konto']);
    }
    // 15.9: für JEDE Rolle, auch die GF – PIN/Name/Telefon/Lohngruppe/Rechte des eigenen Kontos über die Verwaltung würden
    // die alte PIN bzw. das Vier-Augen-Prinzip umgehen (eigene PIN nur /auth/pin, eigenes Telefon nur /auth/telefon)
    for (const id of [U.mitarbeiter, U.polier, U.bauleiter, U.buero, U.gf]) {
      await nein(id, 'PUT', `/benutzer/${id}`, { pin: '583920' }, 'eigene PIN nur über /auth/pin (mit alter PIN)');
      await nein(id, 'PUT', `/benutzer/${id}`, { name: 'Selbst umbenannt' }, 'eigenes Konto verwaltet eine andere Person (Bauleiter = Büro)');
      await nein(id, 'PUT', `/benutzer/${id}`, { telefon: '+43 660 5555555' }, 'eigenes Telefon nur über /auth/telefon');
      await nein(id, 'PUT', `/benutzer/${id}`, { lohngruppe: 'hi' }, 'eigene Lohngruppe setzt eine andere Person');
      await nein(id, 'PUT', `/benutzer/${id}`, { aktiv: true, name: 'Selbst', rolle: k.db.eins('SELECT rolle FROM benutzer WHERE id = ?', id).rolle }, 'eigenes Konto verwaltet eine andere Person');
      for (const recht of ['benutzer', 'preise_sehen', 'kolonne']) await nein(id, 'PUT', '/rechte/ausnahme', { benutzerId: id, recht, wert: true }, 'eigene Rechte/Ausnahmen vergibt eine andere Person mit Benutzerrecht');
      await nein(id, 'PUT', '/rechte/ausnahme', { benutzerId: id, recht: 'fuhrpark', wert: false }, 'eigene Rechte entzieht eine andere Person mit Benutzerrecht');
      if (id !== U.gf) await nein(id, 'PUT', '/rechte/matrix', { rolle: k.db.eins('SELECT rolle FROM benutzer WHERE id = ?', id).rolle, recht: 'benutzer', wert: true }, 'Rollen-Matrix nur GF');
    }
    // eigenes Telefon bleibt über /auth/telefon möglich (Gegenprobe)
    for (const id of [U.polier, U.gf]) {
      const r = await k.als(id).put('/auth/telefon', { telefon: '+43 660 4444444' });
      if (r.status !== 200) v.push(`${id} PUT /auth/telefon → ${r.status} – eigenes Telefon muss über /auth/telefon gehen`);
    }
    await frisch();
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  await t.test('Selbst: eigenes Urlaubskonto, eigener Antrag, eigene genehmigte Abwesenheit, Betriebsurlaub für sich (Vier-Augen-Prinzip)', async () => {
    v.length = 0;
    for (const id of [U.mitarbeiter, U.polier, U.bauleiter, U.buero, U.gf]) {
      await nein(id, 'PUT', `/urlaub/konto/${id}/2026`, { anspruch: 99 }, 'eigenes Urlaubskonto pflegt eine andere Person');
      await nein(id, 'PUT', `/abwesenheiten/antraege/${eigen[id].antrag}`, { status: 'genehmigt' }, 'eigene Anträge entscheidet eine andere Person');
      await nein(id, 'PUT', `/abwesenheiten/${eigen[id].abw}`, { status: 'abgelehnt' }, 'eigene Abwesenheit entscheidet eine andere Person');
      await nein(id, 'DELETE', `/abwesenheiten/${eigen[id].abw}`, undefined, 'eigene genehmigte Abwesenheit löscht nur eine andere Person');
    }
    // Betriebsurlaub mit eigener Person: eigene Tage nur beantragt, eigener offener Antrag bleibt offen
    for (const id of [U.bauleiter, U.buero, U.gf]) {
      const r = await k.als(id).post('/urlaub/betriebsurlaub', { von: '2027-01-12', bis: '2027-01-13', benutzerIds: [id], code: 'U', vorschau: false });
      const st = k.db.alle("SELECT status FROM abwesenheit WHERE benutzer_id = ? AND datum IN ('2027-01-12','2027-01-13')", id).map((x) => x.status);
      if (st.some((x) => x !== 'beantragt')) v.push(`${id} POST /urlaub/betriebsurlaub für sich selbst → ${r.status}: eigene Tage ${st.join(',')} (Vier-Augen-Prinzip verlangt beantragt)`);
      const r2 = await k.als(id).post('/urlaub/betriebsurlaub', { von: '2026-12-30', bis: '2026-12-30', benutzerIds: [id], code: 'BU', vorschau: false });
      const z = k.db.eins("SELECT status, entschieden_von FROM abwesenheit WHERE benutzer_id = ? AND datum = '2026-12-30'", id);
      if (z && (z.status === 'genehmigt' && z.entschieden_von === id)) v.push(`${id} Betriebsurlaub für sich selbst → ${r2.status}: selbst genehmigt`);
    }
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  await t.test('Gleichrangig: Büro → Büro, Bauleiter → Bauleiter, Büro ↔ Bauleiter; auf die GF: niemand außer der GF', async () => {
    v.length = 0;
    const paare = [[U.buero, B2, 'Büro verwaltet kein anderes Büro'], [U.bauleiter, BL2, 'Bauleiter (= Büro) verwaltet keinen anderen Bauleiter (F-050)'],
      [U.buero, U.bauleiter, 'Konten mit Büro-gleichen Rechten (Bauleiter) verwaltet nur die GF (F-050)'], [U.bauleiter, U.buero, 'Bauleiter verwaltet kein Büro'],
      [U.buero, U.gf, 'das GF-Konto verwaltet nur die GF'], [U.bauleiter, U.gf, 'das GF-Konto verwaltet nur die GF'], [B2, U.gf, 'das GF-Konto verwaltet nur die GF']];
    for (const [wer, ziel, grund] of paare) {
      // 15.9 (F-050): auch Stammdaten (Name, Telefon, Lohngruppe) – Konten gleicher oder höherer Stufe verwaltet nur die GF
      await nein(wer, 'PUT', `/benutzer/${ziel}`, { pin: '864213' }, `PIN-Reset: ${grund}`);
      await nein(wer, 'PUT', `/benutzer/${ziel}`, { aktiv: false }, `Deaktivieren: ${grund}`);
      await nein(wer, 'PUT', `/benutzer/${ziel}`, { rolle: 'mitarbeiter' }, `Rollenwechsel: ${grund}`);
      await nein(wer, 'PUT', `/benutzer/${ziel}`, { telefon: '+43 660 9999999' }, `Telefon: ${grund}`);
      await nein(wer, 'PUT', `/benutzer/${ziel}`, { name: 'Peer umbenannt' }, `Name: ${grund}`);
      await nein(wer, 'PUT', `/benutzer/${ziel}`, { lohngruppe: 'hi' }, `Lohngruppe: ${grund}`);
      await nein(wer, 'DELETE', `/benutzer/${ziel}/2fa`, undefined, `2FA-Rücksetzung: ${grund}`);
      await nein(wer, 'PUT', '/rechte/ausnahme', { benutzerId: ziel, recht: 'benutzer', wert: true }, `Ausnahmen: ${grund}`);
      await nein(wer, 'PUT', '/rechte/ausnahme', { benutzerId: ziel, recht: 'stammdaten', wert: false }, `Rechte entziehen: ${grund}`);
    }
    // F-051: Fehlversuchs-Sperren des GF-Kontos hebt nur die GF auf (sonst unbegrenztes PIN-Raten gegen die GF)
    for (let i = 0; i < 5; i++) await k.client().post('/auth/login', { benutzerId: U.gf, pin: String(700000 + i) });
    // 15.9 (F-051): über die API für NIEMANDEN – auch nicht die GF selbst oder eine andere GF; nur node server/entsperren.js
    for (const wer of [U.buero, U.bauleiter, B2, BL2, U.gf]) await nein(wer, 'POST', `/benutzer/${U.gf}/entsperren`, {}, 'Sperren des GF-Kontos hebt nur der Notfall-Befehl am Server auf (F-051)');
    // Kontosperre direkt setzen (wie nach zu vielen Fehlversuchen von verschiedenen Adressen) – so verändert ein
    // fälschliches Entsperren sichtbar den Zustand (login_konto)
    const sperreKonto = (id) => {
      const jetzt = k.app.bt.uhr();
      const bis = new Date(jetzt.getTime() + 86400e3).toISOString();
      k.db.lauf(`INSERT INTO login_konto (benutzer_id, fehlversuche, erster, gesperrt, gesperrt_seit, sperren, gesperrt_bis) VALUES (?, 10, ?, 1, ?, 1, ?)
        ON CONFLICT(benutzer_id) DO UPDATE SET gesperrt = 1, gesperrt_seit = excluded.gesperrt_seit, gesperrt_bis = excluded.gesperrt_bis`, id, jetzt.toISOString(), jetzt.toISOString(), bis);
    };
    const gesperrt = (id) => Boolean(k.db.eins('SELECT 1 AS x FROM login_konto WHERE benutzer_id = ? AND gesperrt = 1', id));
    sperreKonto(U.gf);
    for (const wer of [U.buero, U.bauleiter, B2, BL2, U.gf]) await nein(wer, 'POST', `/benutzer/${U.gf}/entsperren`, {}, 'gesperrtes GF-Konto entsperrt nur der Notfall-Befehl am Server (F-051)');
    const gf2 = await k.als('gf').post('/benutzer', { name: 'Zweite GF', rolle: 'gf', pin: '739154' });
    if (gf2.status !== 201) v.push(`Vorbereitung zweite GF → ${gf2.status}`);
    else {
      sperreKonto(gf2.daten.id);
      await nein(U.gf, 'POST', `/benutzer/${gf2.daten.id}/entsperren`, {}, 'eine GF entsperrt keine andere GF (gleiche Stufe, nur entsperren.js)');
      await nein(U.gf, 'PUT', `/benutzer/${gf2.daten.id}`, { pin: '864213' }, 'eine GF setzt die PIN einer anderen GF nicht zurück (nur entsperren.js)');
      if (!gesperrt(gf2.daten.id)) v.push('Vorbereitung: zweite GF nicht gesperrt – Probe wirkungslos');
      require('../../server/entsperren').entsperren(k.db, gf2.daten.pnr); // Gegenprobe: der Notfall-Befehl am Server
      if (gesperrt(gf2.daten.id)) v.push('server/entsperren.js hebt die Sperre der GF nicht auf');
      await frisch();
    }
    // gleichrangige Sperren: Büro ↔ Büro, Bauleiter ↔ Bauleiter, Büro ↔ Bauleiter heben einander nicht auf; die GF schon
    for (const [ziel, wer] of [[B2, U.buero], [BL2, U.bauleiter], [U.bauleiter, U.buero], [U.buero, U.bauleiter], [U.buero, BL2]]) {
      sperreKonto(ziel);
      await nein(wer, 'POST', `/benutzer/${ziel}/entsperren`, {}, 'gleichrangige Konten entsperrt nur eine höhere Stufe (F-051)');
      if (!gesperrt(ziel)) v.push(`Vorbereitung: ${ziel} nicht gesperrt – Probe wirkungslos`);
    }
    sperreKonto(B2);
    const ge = await k.als('gf').post(`/benutzer/${B2}/entsperren`, {});
    if (ge.status !== 200 || gesperrt(B2)) v.push(`GF entsperrt das Büro nicht (${ge.status}) – Gegenprobe gescheitert`);
    sperreKonto(H.ANDERER_MA);
    const be = await k.als(U.bauleiter).post(`/benutzer/${H.ANDERER_MA}/entsperren`, {});
    if (be.status !== 200 || gesperrt(H.ANDERER_MA)) v.push(`Bauleiter entsperrt einen Mitarbeiter nicht (${be.status}) – Gegenprobe gescheitert`);
    // Gegenprobe: die GF darf ein Büro und einen Bauleiter verwalten (die Proben oben sind nicht nur „alles verboten“)
    const g1 = await k.als('gf').put(`/benutzer/${B2}`, { telefon: '+43 660 7777777' });
    const g2 = await k.als('gf').put(`/benutzer/${BL2}`, { telefon: '+43 660 7777778' });
    if (g1.status !== 200 || g2.status !== 200) v.push(`GF verwaltet Büro/Bauleiter nicht (${g1.status}, ${g2.status}) – Gegenprobe gescheitert`);
    // und das Büro verwaltet weiter Mitarbeiter/Poliere
    const b1 = await k.als(U.buero).put(`/benutzer/${H.ANDERER_MA}`, { telefon: '+43 660 7777779' });
    const b2 = await k.als(U.bauleiter).put(`/benutzer/${H.ANDERER_MA}`, { telefon: '+43 660 7777780' });
    if (b1.status !== 200 || b2.status !== 200) v.push(`Büro/Bauleiter verwalten Mitarbeiter nicht (${b1.status}, ${b2.status}) – Gegenprobe gescheitert`);
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  await t.test('N-112: eigener Lieferschein – nur die/der Hochladende sieht Text und Preise; kein anderer Polier/Mitarbeiter, keine Fernansicht, kein Auftraggeber, keine Mail', async () => {
    v.length = 0;
    await frisch();
    const bid = F.bericht.bs1;
    const gf = k.als('gf');
    const PREIS = H.zahlFormen(H.GELD.global.lieferscheinOcr); // Geld-Kanarie in jeder Schreibweise
    const PREIS_TEXT = `${PREIS[2]} EUR`;
    const rolleVon = (id) => k.db.eins('SELECT rolle FROM benutzer WHERE id = ?', id).rolle;
    // Mitarbeiter mit Ausnahme bericht_erstellen lädt ebenfalls einen eigenen Lieferschein hoch (gleiche Regel)
    if ((await gf.put('/rechte/ausnahme', { benutzerId: U.mitarbeiter, recht: 'bericht_erstellen', wert: true })).status !== 200) v.push('Vorbereitung: Ausnahme bericht_erstellen für den Mitarbeiter');
    const bild = (n) => { const b = Buffer.from(testJpeg()); b[b.indexOf(Buffer.from([0x12, 0xff, 0x00, 0x34]))] = 0x12 + n; return b.toString('base64'); };
    const hoch = async (wer, marke, bildB64) => {
      await gf.post('/test/ocr', { text: `${marke}\nKieswerk Probe GmbH\nKies 16/32 12 t Einzelpreis ${PREIS_TEXT}` });
      const r = await k.als(wer).post(`/berichte/${bid}/lieferschein`, { bildBase64: bildB64, dateiname: 'ls.jpg', beschreibung: `${marke}-FOTO` });
      await gf.post('/test/ocr', { text: null });
      // die/der Hochladende bekommt den erkannten Text mit Preis zurück (N-112) – sonst nichts Verbotenes
      if (r.status !== 201 || typeof r.daten.text !== 'string' || !r.daten.text.includes(marke) || !r.daten.text.includes(PREIS[2])) v.push(`${wer} POST /berichte/${bid}/lieferschein → ${r.status}: eigener OCR-Text fehlt (${JSON.stringify(r.daten).slice(0, 160)})`);
      v.push(...await H.scanne(rolleVon(wer), r, { route: 'POST /api/berichte/:id/lieferschein', url: `/berichte/${bid}/lieferschein (eigener Upload)`, ich: wer }));
      return r.daten && r.daten.foto ? r.daten.foto.id : null;
    };
    const lsPolier = await hoch(U.polier, 'LS-OCR-EIGEN-POLIER', testWebp().toString('base64'));
    const lsMa = await hoch(U.mitarbeiter, 'LS-OCR-EIGEN-MA', bild(7));
    const marke = { [U.polier]: 'LS-OCR-EIGEN-POLIER', [U.mitarbeiter]: 'LS-OCR-EIGEN-MA' };
    const fremdeMarken = (ich) => Object.entries(marke).filter(([id]) => Number(id) !== ich).map(([, m]) => m);
    const pruefeText = (ich, text, wo) => {
      for (const m of fremdeMarken(ich)) if (text.includes(m)) v.push(`${wo}: fremder Lieferschein (${m}) sichtbar`);
      for (const f of PREIS.slice(0, 3)) if (text.includes(f)) { v.push(`${wo}: Lieferschein-Preis ${f} außerhalb der eigenen Upload-Antwort`); break; }
      if (text.includes('Kieswerk Probe')) v.push(`${wo}: OCR-Text eines Lieferscheins außerhalb der eigenen Upload-Antwort`);
    };
    // andere Poliere/Mitarbeiter (und die Hochladenden selbst beim späteren Lesen): Bericht-JSON, Liste, PDFs, Bilddatei
    let gesehen = 0;
    for (const ich of [U.polier, U.mitarbeiter, H.ANDERER_MA, U.polier2]) {
      const rolle = rolleVon(ich);
      let cl;
      try { cl = k.als(ich); } catch (_) { cl = await k.login(ich); }
      const liste = await cl.get('/berichte');
      pruefeText(ich, await H.antwortText(liste), `${ich} GET /berichte`);
      const d = await cl.get(`/berichte/${bid}`);
      pruefeText(ich, await H.antwortText(d), `${ich} GET /berichte/${bid}`);
      v.push(...await H.scanne(rolle, d, { route: 'GET /api/berichte/:id', url: `/berichte/${bid} (N-112)`, ich }));
      if (d.status === 200) {
        gesehen++;
        const ls = (d.daten.fotos || []).filter((f) => f.art === 'lieferschein');
        for (const f of ls) if (!f.erstelltVon || f.erstelltVon.id !== ich) v.push(`${ich} GET /berichte/${bid}: fremder Lieferschein ${f.id} (${f.beschreibung}) in fotos[]`);
        const eigenesFoto = ich === U.polier ? lsPolier : ich === U.mitarbeiter ? lsMa : null;
        if (eigenesFoto && !ls.some((f) => f.id === eigenesFoto)) v.push(`${ich} GET /berichte/${bid}: eigener Lieferschein fehlt (Gegenprobe)`);
        for (const pdfUrl of [`/berichte/${bid}/pdf?fassung=ag&fotos=1`, `/berichte/${bid}/pdf?fassung=intern&fotos=1`]) {
          const pr = await cl.get(pdfUrl);
          if (pr.status === 200) pruefeText(ich, await H.antwortText(pr), `${ich} GET ${pdfUrl}`);
        }
      }
      for (const [uploader, fid] of [[U.polier, lsPolier], [U.mitarbeiter, lsMa]]) {
        if (uploader === ich || !fid) continue;
        const f = await cl.get(`/berichte/${bid}/fotos/${fid}`);
        if (f.status !== 404 && f.status !== 403) v.push(`${ich} GET /berichte/${bid}/fotos/${fid} (Lieferschein von ${uploader}) → ${f.status}`);
        for (const [m, body] of [['PUT', { beschreibung: 'x' }], ['DELETE', undefined]]) {
          const r = await cl.anfrage(m, `/berichte/${bid}/fotos/${fid}`, body);
          if (!ABGELEHNT.includes(r.status) || !k.db.eins('SELECT 1 AS x FROM bericht_foto WHERE id = ? AND beschreibung LIKE ?', fid, '%-FOTO')) v.push(`${ich} ${m} /berichte/${bid}/fotos/${fid} (Lieferschein von ${uploader}) → ${r.status}: fremden Lieferschein weder ändern noch löschen (N-112)`);
        }
      }
    }
    if (gesehen < 2) v.push(`nur ${gesehen} Poliere/Mitarbeiter sehen den Bericht – N-112-Probe wirkungslos`);
    // Büro, Bauleiter, GF sehen alle Lieferscheine (Gegenprobe)
    for (const wer of ['buero', 'bauleiter', 'gf']) {
      const ls = ((await k.als(wer).get(`/berichte/${bid}`)).daten.fotos || []).filter((f) => f.art === 'lieferschein').map((f) => f.id);
      if (!ls.includes(lsPolier) || !ls.includes(lsMa)) v.push(`${wer} sieht nicht alle Lieferscheine (${ls.join(',')})`);
    }
    // Fernansicht (neuer Link nach den Uploads), AG-PDF der E-Mail, E-Mail an den Auftraggeber
    const link = await k.als(U.polier).post(`/berichte/${bid}/unterschrift-link`, { rolle: 'bh', name: 'Bauherr' });
    if (link.status !== 201) v.push(`Vorbereitung Fern-Link → ${link.status}`);
    else {
      const token = link.daten.url.split('/').pop();
      const anonym = k.client();
      for (const u of [`/fern/${token}`, `/fern/${token}/pdf`]) {
        const r = await anonym.get(u);
        if (r.status !== 200) v.push(`GET ${u} → ${r.status} (Gegenprobe)`);
        const tx = await H.antwortText(r);
        for (const m of Object.values(marke)) if (tx.includes(m)) v.push(`GET ${u}: Lieferschein ${m} in der Fernansicht`);
        if (/Kieswerk Probe/.test(tx) || PREIS.slice(0, 3).some((f) => tx.includes(f))) v.push(`GET ${u}: Lieferschein-Text/-Preis in der Fernansicht`);
      }
    }
    const ag = H.pdfText(await require('../../server/routes/berichte').agPdf(k.app.bt, bid));
    for (const m of Object.values(marke)) if (ag.includes(m)) v.push(`AG-PDF der E-Mail: Lieferschein ${m}`);
    require('../../server/mail').berichtVersenden(k.app.bt, bid, 'ag-probe@example.test', U.gf);
    await k.ruhe();
    for (const m of k.app.bt.testAusgang.mails) {
      const tx = JSON.stringify({ betreff: m.betreff, text: m.text, anhaenge: m.anhaenge });
      for (const mk of Object.values(marke)) if (tx.includes(mk)) v.push(`Mail an ${m.an}: Lieferschein ${mk}`);
    }
    // Benachrichtigungen (jede Person) und Push ohne Lieferschein-Inhalt; Ausgänge an Polier/Mitarbeiter ohne €
    for (const n of k.db.alle('SELECT * FROM benachrichtigung')) if (/LS-OCR-EIGEN|Kieswerk Probe/.test(`${n.titel} ${n.text}`)) v.push(`Benachrichtigung an ${n.benutzer_id}: Lieferschein-Inhalt`);
    for (const p of k.app.bt.testAusgang.push) if (/LS-OCR-EIGEN|Kieswerk Probe/.test(JSON.stringify(p))) v.push(`Push an ${p.benutzerId}: Lieferschein-Inhalt`);
    v.push(...await H.pruefeAusgaenge(k, 'nach N-112-Probe'));
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });
});
