'use strict';
/**
 * Prüfbericht 7 – Umgehungsversuche („Hier darf es auch kein Bug oder eine Umgehung geben“).
 * Jeder Versuch ist ein dauerhafter Test. Befund-IDs (R-xx) siehe PRUEFBERICHT_7_RECHTE.md.
 *
 * - Pfad-Varianten (Groß/Klein, Schrägstriche, Kodierung, Endungen, HEAD/OPTIONS, Method-Override)
 * - Parameter-Tricks (doppelte Parameter, Listen statt Zahl, fremde IDs in Pfad/Body, Mass Assignment,
 *   Prototype Pollution, Content-Type-Verwechslung)
 * - Sitzung und Anmeldung (deaktiviert, Rechteentzug, Abmelden, Session Fixation, Cookie-Flags,
 *   PIN-Raten mit X-Forwarded-For, 2FA, Fernunterschrift-Link, Test-Schnittstellen)
 * - Indirekte Lecks (Fehlermeldungen/409, Vorschau-Antworten, Suche)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const H = require('./rechte-matrix-hilfe');
const { starte, U, BS } = require('./hilfe');
const T = require('../../server/totp');

const { ANDERER_MA, FREMDER_MA, TOKEN } = H;

/** Rohe HTTP-Anfrage (Pfad wird NICHT normalisiert, anders als fetch) */
function roh(basis, methode, pfad, { cookie, kopf = {}, body } = {}) {
  const u = new URL(basis);
  return new Promise((ok, nok) => {
    const r = http.request({ host: u.hostname, port: u.port, method: methode, path: pfad, headers: { ...(cookie ? { cookie } : {}), ...kopf, ...(body !== undefined ? { 'content-length': Buffer.byteLength(body) } : {}) } }, (res) => {
      const teile = [];
      res.on('data', (d) => teile.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(teile);
        const ct = res.headers['content-type'] || '';
        let daten = buf.toString('utf8');
        if (ct.includes('application/json')) { try { daten = JSON.parse(daten); } catch (_) { /* roh */ } }
        ok({ status: res.statusCode, daten, headers: { get: (k) => res.headers[k.toLowerCase()] }, ct });
      });
    });
    r.on('error', nok);
    if (body !== undefined) r.write(body);
    r.end();
  });
}

test('Umgehungsversuche gegen die Rechteprüfung (Prüfbericht 7)', { timeout: 10 * 60 * 1000 }, async (t) => {
  const basis = await H.erstelleBasis();
  t.after(() => fs.rmSync(basis.ordner, { recursive: true, force: true }));
  const F = basis.F;
  let s = await H.starteKopie(basis);
  t.after(() => s.stop());
  const c = {};
  for (const r of H.ROLLEN) c[r] = await s.login(H.ID[r]);

  /** Antwort darf keine Nutzdaten enthalten (kein JSON-2xx) und nichts Verbotenes */
  async function keinLeck(rolle, r, wo) {
    const v = await H.scanne(rolle, r, { route: 'UMGEHUNG', url: wo });
    const json2xx = r.status >= 200 && r.status < 300 && /json|csv|pdf|spreadsheet/.test(r.ct || (r.headers.get && r.headers.get('content-type')) || '');
    if (json2xx) v.push(`${wo}: ${r.status} mit Daten (${String(r.ct || r.headers.get('content-type'))})`);
    return v;
  }

  await t.test('Pfad-Varianten auf geschützten Routen: Groß/Klein, Schrägstriche, Kodierung, Endungen, HEAD/OPTIONS, Method-Override', async () => {
    const v = [];
    const ziele = ['/api/preise', '/api/rechte', '/api/monat', '/api/monat/export.csv', '/api/kalkulation', `/api/kalkulation/${BS.pitten}`, '/api/rechnungen', `/api/rechnungen/${F.rechnung.bs1}`, '/api/benutzer', '/api/offene-posten', '/api/einstellungen/email', '/api/positionen/katalog', '/api/system/sicherung', '/api/test/ausgang'];
    const varianten = (p) => {
      const rest = p.slice(5);
      return [p.toUpperCase(), '/API/' + rest, '/Api/' + rest[0].toUpperCase() + rest.slice(1), p + '/', p + '//', '/api//' + rest, '//api/' + rest, '/api/./' + rest, '/./api/' + rest, '/api/x/../' + rest,
        '/api/%2e/' + rest, '/api/%2E%2E/api/' + rest, '/api%2f' + rest, '/api/' + rest.replace(/\//g, '%2f'), '/api/' + rest.replace(/^(.)/, (m) => '%' + m.charCodeAt(0).toString(16)),
        p + '.json', p + ';x', p + '%00', p + '%20', p + '?_method=GET', p + '#x', p + '/.', p + '/..', p + '\\', p + '%5c', p + '.', p + '~'];
    };
    for (const rolle of ['mitarbeiter', 'polier']) {
      for (const ziel of ziele) {
        for (const pfad of varianten(ziel)) {
          for (const m of ['GET', 'HEAD', 'OPTIONS']) {
            const r = await roh(s.basis, m, pfad, { cookie: c[rolle].cookie });
            if (m === 'GET') v.push(...await keinLeck(rolle, r, `${rolle} ${m} ${pfad}`));
            else if (r.status >= 200 && r.status < 300 && m === 'HEAD' && /json|csv|pdf/.test(r.ct)) v.push(`${rolle} HEAD ${pfad}: ${r.status} ${r.ct} (Route antwortet trotz fehlendem Recht)`);
            else if (m === 'OPTIONS') v.push(...await keinLeck(rolle, r, `${rolle} OPTIONS ${pfad}`));
          }
        }
        // Method-Override-Köpfe und _method dürfen nichts bewirken
        for (const kopf of [{ 'x-http-method-override': 'GET' }, { 'x-http-method': 'GET' }, { 'x-method-override': 'GET' }]) {
          const r = await roh(s.basis, 'POST', ziel, { cookie: c[rolle].cookie, kopf: { ...kopf, 'content-type': 'application/json' }, body: '{}' });
          v.push(...await keinLeck(rolle, r, `${rolle} POST ${ziel} ${JSON.stringify(kopf)}`));
        }
      }
    }
    // Fremde Baustelle 3 in allen Schreibweisen der ID – Polier (Baustellen-Scoping). Der Bauleiter sieht seit der
    // Inhaber-Entscheidung 13.11.2026 wie das Büro alle Baustellen; für ihn gibt es keine „fremde“ Baustelle mehr.
    for (const id of ['3', '03', '003', '3.0', '+3', '3%20', '%33', '3,1', '1,3', '3;1', '0x3', '3e0', '-3', '9999999999999', '3?baustelleId=1', '3%3Fx', '3/']) {
      for (const p of [`/api/kalkulation/${id}`, `/api/baustellen/${id}/positionen`, `/api/baustellen/${id}/fremdleistungen`, `/api/baustellen/${id}/lv`, `/api/baustellen/${id}/positionen/export.xlsx`, `/api/baustellen/${id}/dokumente`]) {
        const r = await roh(s.basis, 'GET', p, { cookie: c.polier.cookie });
        v.push(...(await H.scanne('polier', r, { route: 'UMGEHUNG', variante: 'fremd', url: p })));
        if (r.status === 200) {
          const daten = typeof r.daten === 'object' ? r.daten : {};
          if ((daten.baustelleId || (daten.baustelle && daten.baustelle.id)) === 3) v.push(`polier GET ${p}: Daten der fremden Baustelle 3`);
        }
      }
    }
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  await t.test('Parameter-Tricks: doppelte Parameter, Listen statt Zahl, fremde Person im Body', async () => {
    const v = [];
    const ma = c.mitarbeiter;
    for (const q of [`benutzerId=${U.mitarbeiter}&benutzerId=${ANDERER_MA}`, `benutzerId=${ANDERER_MA}&benutzerId=${U.mitarbeiter}`, `benutzerId[]=${ANDERER_MA}`, `benutzerId=${ANDERER_MA}%00`, `benutzerId=+${ANDERER_MA}`, `benutzerId=0${ANDERER_MA}`]) {
      for (const p of ['/zeit/buchungen', '/zeit/schichten', '/abwesenheiten', '/abwesenheiten/antraege', '/urlaub/konto', '/urlaub/kalender']) {
        const r = await ma.get(`${p}?${q}`);
        const liste = Array.isArray(r.daten) ? r.daten : (r.daten && r.daten.personen) || [];
        if (r.status === 200 && liste.some((x) => x.benutzerId === ANDERER_MA)) v.push(`mitarbeiter GET ${p}?${q}: Daten von Person ${ANDERER_MA}`);
        v.push(...await H.scanne('mitarbeiter', r, { route: 'UMGEHUNG', url: `${p}?${q}` }));
      }
    }
    const vorher = H.dbHash(s.db);
    for (const body of [{ benutzerId: [U.mitarbeiter, ANDERER_MA], datum: '2026-12-21', code: 'U' }, { benutzerId: String(ANDERER_MA), datum: '2026-12-21', code: 'U' }, { benutzerId: ANDERER_MA + 0.0000001, datum: '2026-12-21', code: 'U' }, { benutzerId: { id: ANDERER_MA }, datum: '2026-12-21', code: 'U' }]) {
      const r = await ma.post('/abwesenheiten', body);
      if (![400, 403].includes(r.status)) v.push(`mitarbeiter POST /abwesenheiten ${JSON.stringify(body)} → ${r.status}`);
    }
    const diff = H.dbUnterschied(vorher, H.dbHash(s.db));
    if (diff.length) v.push(`Abwesenheiten für andere: DB geändert (${diff.join(', ')})`);
    // Stempeln mit fremder benutzerId im Body bucht nur für sich selbst
    const n3 = s.db.eins('SELECT COUNT(*) AS n FROM buchung WHERE benutzer_id = ?', ANDERER_MA).n;
    await ma.post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.pitten, benutzerId: ANDERER_MA, benutzerIds: [ANDERER_MA] });
    if (s.db.eins('SELECT COUNT(*) AS n FROM buchung WHERE benutzer_id = ?', ANDERER_MA).n !== n3) v.push('POST /zeit/stempeln mit benutzerId eines anderen bucht für den anderen');
    // Kolonne: fremde Person ohne gast → ok:false
    const k = await c.polier.post('/zeit/kolonne', { baustelleId: BS.pitten, benutzerIds: [FREMDER_MA], typ: 'kommen' });
    if (k.status === 200 && k.daten.ergebnisse.some((e) => e.ok)) v.push('Polier stempelt fremde Person (Partie Baustelle 3) ohne gast:true');
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  await t.test('IDOR: eigene Baustelle im Pfad, fremdes Objekt (Baustelle 3) als Kind-ID oder im Body', async () => {
    const v = [];
    const bl = c.bauleiter, pol = c.polier;
    const fall = async (wer, m, p, body, erlaubt = [400, 403, 404, 409, 422]) => {
      const vorher = H.dbHash(s.db);
      const r = await c[wer].anfrage(m, p, body);
      const diff = H.dbUnterschied(vorher, H.dbHash(s.db));
      if (!erlaubt.includes(r.status)) v.push(`${wer} ${m} ${p} ${body ? JSON.stringify(body).slice(0, 80) : ''} → ${r.status} ${JSON.stringify(r.daten).slice(0, 160)}`);
      if (diff.length && m !== 'GET') v.push(`${wer} ${m} ${p}: DB geändert (${diff.join(', ')})`);
      v.push(...await H.scanne(wer, r, { route: 'IDOR', variante: 'fremd', url: p }));
      return r;
    };
    // Kind-ID einer anderen Baustelle unter der eigenen Baustelle: Pfad-Konsistenz gilt für jede Rolle, auch Büro-Rollen
    for (const wer of ['polier', 'bauleiter']) {
      const ok = wer === 'bauleiter' ? [400, 404, 409, 422] : [400, 403, 404, 409, 422];
      await fall(wer, 'GET', `/baustellen/${BS.pitten}/positionen/${F.pos.bs3}/verlauf`, undefined, ok);
      await fall(wer, 'POST', `/baustellen/${BS.pitten}/positionen/${F.pos.bs3}/mengen`, { datum: '2026-11-11', menge: 1 }, ok);
      await fall(wer, 'DELETE', `/baustellen/${BS.pitten}/positionen/${F.pos.bs1}/mengen/${F.pos.bs3MengePos}`, undefined, ok);
      await fall(wer, 'DELETE', `/baustellen/${BS.pitten}/positionen/${F.pos.bs3}/mengen/${F.pos.bs3MengePos}`, undefined, ok);
      await fall(wer, 'DELETE', `/baustellen/${BS.pitten}/leistungen/${F.leistung.bs3}`, undefined, ok);
      await fall(wer, 'PUT', `/baustellen/${BS.pitten}/abschnitte/${F.abschnitt.bs3}`, { version: 1, name: 'X' }, ok);
      await fall(wer, 'DELETE', `/baustellen/${BS.pitten}/abschnitte/${F.abschnitt.bs3}`, undefined, ok);
    }
    for (const wer of ['polier']) { // Bauleiter = Büro (13.11.2026): Dokumente/Berichte aller Baustellen erlaubt
      await fall(wer, 'GET', `/baustellen/${BS.pitten}/dokumente/${F.dok.planBs3}`);
      await fall(wer, 'GET', `/baustellen/${BS.pitten}/dokumente/${F.dok.planBs3}/datei`);
      await fall(wer, 'GET', `/baustellen/${BS.pitten}/dokumente/${F.dok.finBs3}`);
      await fall(wer, 'GET', `/berichte/${F.bericht.bs1}/fotos/${F.bericht.bs3Foto}`);
      await fall(wer, 'DELETE', `/berichte/${F.bericht.bs1}/unterschrift-links/${F.bericht.bs3Link}`);
      await fall(wer, 'POST', '/bericht-assistent/text', { berichtId: F.bericht.bs3, text: 'zwei Stunden Bagger' });
    }
    // Polier: finanzielle und nicht freigegebene Kategorien der EIGENEN Baustelle
    await fall('polier', 'GET', `/baustellen/${BS.pitten}/dokumente/${F.dok.finBs1}`);
    await fall('polier', 'GET', `/baustellen/${BS.pitten}/dokumente/${F.dok.finBs1}/datei`);
    await fall('polier', 'GET', `/baustellen/${BS.pitten}/dokumente/${F.dok.svBs1}`);
    await fall('polier', 'GET', `/baustellen/${BS.pitten}/dokumente/${F.dok.eingangBs1}/datei?version=1`);
    for (const q of ['Angebot', 'Eingangsrechnungen', 'angebot', 'KANARIE', 'DOKFIN', 'Schriftverkehr']) {
      const r = await pol.get(`/dokumente/suche?q=${encodeURIComponent(q)}`);
      if (r.status === 200 && r.daten.some((d) => ['angebot', 'auftrag', 'lv', 'ausgangsrechnungen', 'eingangsrechnungen', 'schriftverkehr'].includes(d.kategorie) || d.baustelleId !== BS.pitten)) v.push(`polier /dokumente/suche?q=${q}: Dokument aus nicht erlaubter Kategorie/Baustelle`);
      for (const kat of ['angebot', 'eingangsrechnungen', 'schriftverkehr']) {
        const r2 = await pol.get(`/dokumente/suche?q=${encodeURIComponent(q)}&kategorie=${kat}`);
        if (r2.status === 200 && r2.daten.length) v.push(`polier /dokumente/suche?kategorie=${kat}: ${r2.daten.length} Treffer`);
      }
    }
    // Planer: Verschieben aus einem fremden Einsatz, Fuhre auf fremde Baustelle umbiegen, fremde Fuhre kopieren –
    // nur Planer (Büro, Bauleiter, GF) planen; der Polier wird abgewiesen und ändert nichts
    await fall('polier', 'POST', `/plan/einsaetze/${F.einsatz.bs1}/personen`, { benutzerIds: [FREMDER_MA], verschiebenVon: F.einsatz.bs3 });
    if (!s.db.eins('SELECT 1 AS x FROM plan_person WHERE einsatz_id = ? AND benutzer_id = ?', F.einsatz.bs3, FREMDER_MA)) v.push('Polier entfernt per verschiebenVon eine Person aus dem Einsatz einer fremden Baustelle');
    await fall('polier', 'POST', `/plan/einsaetze/${F.einsatz.bs1}/anlagen`, { anlageIds: [5], verschiebenVon: F.einsatz.bs3 });
    if (!s.db.eins('SELECT 1 AS x FROM plan_anlage WHERE einsatz_id = ? AND anlage_id = 5', F.einsatz.bs3)) v.push('Polier entfernt per verschiebenVon eine Anlage aus dem Einsatz einer fremden Baustelle');
    const fu = (await bl.get(`/plan/fuhren?von=${F.datumMorgen}`)).daten.find((x) => x.id === F.fuhre.bs1);
    await fall('polier', 'PUT', `/plan/fuhren/${F.fuhre.bs1}`, { version: fu.version, nach: { art: 'baustelle', baustelleId: BS.reisinger } });
    await fall('polier', 'POST', '/plan/fuhren/kopieren', { id: F.fuhre.bs3, tage: ['2026-11-18'] });
    await fall('polier', 'POST', '/plan/fuhren', { datum: '2026-11-16', anlageId: 4, materialId: 4, menge: 5, einheit: 't', von: { art: 'baustelle', baustelleId: BS.reisinger }, nach: { art: 'baustelle', baustelleId: BS.reisinger } });
    const e1 = (await bl.get(`/plan/woche?von=${F.datumMorgen}`)).daten.einsaetze.find((x) => x.id === F.einsatz.bs1);
    const r = await pol.put(`/plan/einsaetze/${F.einsatz.bs1}`, { version: e1.version, baustelleId: BS.reisinger, datum: '2026-11-16' });
    if (s.db.eins('SELECT baustelle_id FROM plan_einsatz WHERE id = ?', F.einsatz.bs1).baustelle_id !== BS.pitten) v.push(`Polier verschiebt einen Einsatz per PUT auf fremde Baustelle (${r.status})`);
    // Bericht: fremde Fuhre übernehmen
    const fr = await pol.post(`/berichte/${F.bericht.bs1}/fuhren-uebernehmen`, { fuhreIds: [F.fuhre.bs3] });
    if (fr.status === 200 && fr.daten.uebernommen) v.push('Polier übernimmt eine Fuhre einer fremden Baustelle in seinen Bericht');
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  await t.test('Mass Assignment: zusätzliche Felder ändern weder Rolle, Rechte, Lohngruppe noch Status', async () => {
    const v = [];
    const ma = c.mitarbeiter;
    const ich = () => s.db.eins('SELECT * FROM benutzer WHERE id = ?', U.mitarbeiter);
    const alt = ich();
    const extra = { rolle: 'gf', rechte: ['benutzer', 'preise_sehen'], ausnahmen: [{ recht: 'preise_sehen' }], lohngruppe: 'pol', lohngruppe_id: 'pol', aktiv: 1, pnr: 1, id: U.gf, baustelleId: BS.reisinger, muss_pin_aendern: 0, version: 1, pin_hash: 'x' };
    await ma.put('/auth/telefon', { telefon: '+43 660 1111111', ...extra });
    await ma.post('/auth/pin', { alt: '9999', neu: '583920', benutzerId: ANDERER_MA, ...extra });
    await ma.get('/auth/ich?rolle=gf');
    const neu = ich();
    for (const f of ['rolle', 'lohngruppe_id', 'aktiv', 'pnr', 'baustelle_id', 'pin_hash']) if (neu[f] !== alt[f]) v.push(`Mitarbeiter ändert eigenes Feld ${f} über /auth/*: ${alt[f]} → ${neu[f]}`);
    if (s.db.eins('SELECT COUNT(*) AS n FROM benutzer_recht WHERE benutzer_id = ?', U.mitarbeiter).n) v.push('Mitarbeiter hat sich Ausnahmen gegeben');
    if ((await ma.get('/preise')).status !== 403) v.push('Mitarbeiter sieht nach Mass Assignment /preise');
    // Büro: Rollen- und Rechte-Eskalation über PUT/POST /benutzer
    const b = c.buero;
    for (const [m, p, body] of [
      ['PUT', `/benutzer/${U.mitarbeiter}`, { rolle: 'gf' }], ['PUT', `/benutzer/${U.mitarbeiter}`, { rolle: 'buero' }], ['PUT', `/benutzer/${U.mitarbeiter}`, { rolle: 'bauleiter' }],
      ['PUT', `/benutzer/${U.buero}`, { name: 'Ich selbst' }], ['PUT', `/benutzer/${U.buero}`, { rolle: 'gf' }], ['PUT', `/benutzer/${U.gf}`, { pin: '582913' }],
      ['POST', '/benutzer', { name: 'Neu GF', rolle: 'gf', pin: '582913' }], ['POST', '/benutzer', { name: 'Neu BL', rolle: 'bauleiter', pin: '582913' }],
      ['DELETE', `/benutzer/${U.mitarbeiter}/2fa`], ['PUT', '/rechte/ausnahme', { benutzerId: U.buero, recht: 'benutzer', wert: true }], ['PUT', '/rechte/matrix', { rolle: 'buero', recht: 'benutzer', wert: true }]
    ]) {
      const r = await b.anfrage(m, p, body);
      if (![400, 403].includes(r.status)) v.push(`Büro ${m} ${p} ${JSON.stringify(body || {})} → ${r.status} (Eskalation)`);
    }
    const r1 = await b.put(`/benutzer/${U.mitarbeiter}`, { name: alt.name, rechte: ['benutzer'], ausnahmen: ['preise_sehen'], benutzer_recht: [{ recht: 'preise_sehen' }], muss_pin_aendern: 0, pin_hash: 'x', id: U.gf, rolle: 'mitarbeiter' });
    if (r1.status !== 200) v.push(`Büro PUT /benutzer mit Zusatzfeldern → ${r1.status}`);
    if (s.db.eins('SELECT COUNT(*) AS n FROM benutzer_recht WHERE benutzer_id = ?', U.mitarbeiter).n) v.push('Zusatzfelder in PUT /benutzer erteilen Ausnahmen');
    if (s.db.eins('SELECT pin_hash FROM benutzer WHERE id = ?', U.mitarbeiter).pin_hash !== alt.pin_hash) v.push('PUT /benutzer übernimmt pin_hash aus dem Body');
    const r2 = await b.post('/benutzer', { name: 'Mass Assign', rolle: 'mitarbeiter', pin: '582913', rechte: ['preise_sehen'], ausnahmen: ['preise_sehen'], id: 7777 });
    if (r2.status === 201 && (r2.daten.id === 7777 || s.db.eins('SELECT COUNT(*) AS n FROM benutzer_recht WHERE benutzer_id = ?', r2.daten.id).n)) v.push('POST /benutzer übernimmt id/rechte aus dem Body');
    // Status-Felder in Anträgen, Berichten, Meldungen
    const a = await ma.post('/abwesenheiten', { benutzerId: U.mitarbeiter, datum: '2026-12-28', code: 'U', status: 'genehmigt', entschieden: '2026-11-12', entschiedenVon: U.gf });
    if (a.status < 300 && s.db.eins('SELECT status FROM abwesenheit WHERE id = ?', a.daten.id).status !== 'beantragt') v.push('Mitarbeiter genehmigt eigenen Urlaub per status im Body');
    const z = await ma.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: '2026-12-29', bis: '2026-12-30', code: 'U', status: 'genehmigt' });
    if (z.status < 300 && z.daten.status !== 'beantragt') v.push('Mitarbeiter genehmigt eigenen Zeitraum-Antrag per status im Body');
    const be = (await c.polier.get(`/berichte/${F.bericht.bs1}`)).daten;
    await c.polier.put(`/berichte/${F.bericht.bs1}`, { version: be.version, arbeitsleistung: 'x', status: 'freigegeben', freigabe: { benutzerId: U.gf }, kostenTag: 1, baustelleId: BS.reisinger, datum: '2026-11-01' });
    const b2 = s.db.eins('SELECT * FROM bericht WHERE id = ?', F.bericht.bs1);
    if (b2.status !== 'entwurf' || b2.baustelle_id !== BS.pitten || b2.datum !== '2026-11-12') v.push(`Polier ändert Status/Baustelle/Datum des Berichts per PUT (${b2.status}, ${b2.baustelle_id}, ${b2.datum})`);
    const sch = await ma.post('/fuhrpark/schaeden', { anlageId: 4, art: 'defekt', ursache: 'Probe Mass Assignment Schaden', einsatzfaehig: 'ja', status: 'behoben', gemeldetVon: ANDERER_MA, gemeldet_von: ANDERER_MA, kommentar: 'x' });
    if (sch.status === 201) { const m = s.db.eins('SELECT * FROM mangel WHERE id = ?', sch.daten.id); if (m.status !== 'offen' || m.gemeldet_von !== U.mitarbeiter) v.push(`Schaden per Body: status=${m.status}, gemeldet_von=${m.gemeldet_von}`); }
    const mg = await ma.post('/fuhrpark/maengel', { anlageId: 4, text: 'Probe Mangel', dringlichkeit: 'hinweis', status: 'erledigt', gemeldetVon: ANDERER_MA });
    if (mg.status === 201) { const m = s.db.eins('SELECT * FROM mangel WHERE id = ?', mg.daten.id); if (m.status !== 'offen' || m.gemeldet_von !== U.mitarbeiter) v.push(`Mangel per Body: status=${m.status}, gemeldet_von=${m.gemeldet_von}`); }
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  await t.test('Prototype Pollution über JSON (__proto__, constructor.prototype) ändert keine Rechte', async () => {
    const v = [];
    const gift = '{"__proto__":{"rolle":"gf","rechte":["preise_sehen"],"preise_sehen":true,"isAdmin":true},"constructor":{"prototype":{"rolle":"gf","isAdmin":true}}';
    const ziele = [
      ['mitarbeiter', 'PUT', '/api/auth/telefon', `${gift},"telefon":"+43 660 2222222"}`],
      ['mitarbeiter', 'POST', '/api/zeit/stempeln', `${gift},"typ":"pause_start"}`],
      ['mitarbeiter', 'PUT', '/api/push/einstellungen', `{"typen":${gift},"plan":true}}`],
      ['mitarbeiter', 'POST', '/api/abwesenheiten', `${gift},"benutzerId":${U.mitarbeiter},"datum":"2026-12-31","code":"U"}`],
      ['polier', 'PUT', `/api/berichte/${F.bericht.bs1}`, `${gift},"version":1}`],
      ['bauleiter', 'POST', '/api/plan/einsaetze', `{"datum":"2026-11-19","baustelleId":1,"notizen":${gift},"1":"x"},"fahrer":${gift}}}`],
      ['bauleiter', 'PUT', `/api/baustellen/${BS.pitten}/auftrag`, `{"empfaenger":${gift}},"version":1}`],
      ['gf', 'PUT', '/api/einstellungen/sicherheit', `{"zweiFaktorPflicht":${gift}}}`],
      ['gf', 'PUT', `/api/baustellen/${BS.pitten}/auftrag`, `{"empfaenger":${gift}},"version":1}`]
    ];
    for (const [rolle, m, p, body] of ziele) {
      const r = await roh(s.basis, m, p, { cookie: c[rolle].cookie, kopf: { 'content-type': 'application/json' }, body });
      if (r.status >= 500) v.push(`${rolle} ${m} ${p}: ${r.status} (Absturz durch __proto__)`);
    }
    const leer = {};
    for (const k of ['rolle', 'rechte', 'preise_sehen', 'isAdmin']) if (leer[k] !== undefined) v.push(`Object.prototype verseucht: ${k}=${JSON.stringify(leer[k])}`);
    for (const [rolle, p] of [['mitarbeiter', '/preise'], ['mitarbeiter', '/rechte'], ['polier', '/kalkulation'], ['bauleiter', '/rechte'], ['polier', `/kalkulation/${BS.reisinger}`], ['bauleiter', '/einstellungen/sicherheit']]) {
      const r = await c[rolle].get(p);
      if (r.status !== 403) v.push(`${rolle} GET ${p} nach __proto__-Anfragen → ${r.status}`);
    }
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  await t.test('Content-Type-Verwechslung: Schreiben nur mit application/json (CSRF)', async () => {
    const v = [];
    const body = JSON.stringify({ telefon: '+43 660 3333333' });
    for (const ct of ['text/plain', 'text/plain;charset=UTF-8', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/xml', 'text/json', 'json', undefined]) {
      const r = await roh(s.basis, 'PUT', '/api/auth/telefon', { cookie: c.mitarbeiter.cookie, kopf: ct ? { 'content-type': ct } : {}, body });
      if (r.status !== 415) v.push(`PUT /auth/telefon mit Content-Type ${ct} → ${r.status} (erwartet 415)`);
    }
    if (s.db.eins('SELECT telefon FROM benutzer WHERE id = ?', U.mitarbeiter).telefon === '+43 660 3333333') v.push('Telefon über Nicht-JSON-Anfrage geändert');
    // Formular-POST (Login-CSRF) und Login per text/plain
    const r = await roh(s.basis, 'POST', '/api/auth/login', { kopf: { 'content-type': 'application/x-www-form-urlencoded' }, body: `benutzerId=${U.gf}&pin=1234` });
    if (r.status !== 415) v.push(`Formular-Login → ${r.status}`);
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  await t.test('Sitzung: deaktiviert, Rollen-/Rechteänderung, Abmelden, Session Fixation, Cookie-Flags', async () => {
    const v = [];
    // deaktivierter Benutzer mit laufender Sitzung (über API und direkt in der DB)
    const m3 = await s.login(ANDERER_MA);
    await c.gf.put(`/benutzer/${ANDERER_MA}`, { aktiv: false });
    if ((await m3.get('/auth/ich')).status !== 401) v.push('deaktivierter Benutzer (API) behält die Sitzung');
    await c.gf.put(`/benutzer/${ANDERER_MA}`, { aktiv: true });
    const m3b = await s.login(ANDERER_MA);
    s.db.lauf('UPDATE benutzer SET aktiv = 0 WHERE id = ?', ANDERER_MA);
    if ((await m3b.get('/auth/ich')).status !== 401) v.push('deaktivierter Benutzer (DB) behält die Sitzung');
    s.db.lauf('UPDATE benutzer SET aktiv = 1 WHERE id = ?', ANDERER_MA);
    // Ausnahme entziehen → nächste Anfrage schon eingeschränkt
    const pol = await s.login(U.polier);
    await c.gf.put('/rechte/ausnahme', { benutzerId: U.polier, recht: 'fuhrpark', wert: true });
    if ((await pol.get('/fuhrpark/uebersicht')).status !== 200) v.push('Ausnahme fuhrpark wirkt nicht sofort');
    await c.gf.put('/rechte/ausnahme', { benutzerId: U.polier, recht: 'fuhrpark', wert: false });
    if ((await pol.get('/fuhrpark/uebersicht')).status !== 403) v.push('Entzug der Ausnahme wirkt nicht sofort');
    // Matrix ändern → sofort
    const bl = await s.login(U.bauleiter);
    await c.gf.put('/rechte/matrix', { rolle: 'bauleiter', recht: 'kalk_sehen', wert: false });
    if ((await bl.get('/kalkulation')).status !== 403) v.push('Entzug kalk_sehen in der Matrix wirkt nicht sofort');
    const bs = (await bl.get(`/baustellen/${BS.pitten}`)).daten;
    if (bs.budgetVerbrauchProzent !== undefined) v.push('ohne kalk_sehen trotzdem budgetVerbrauchProzent');
    await c.gf.put('/rechte/matrix', { rolle: 'bauleiter', recht: 'kalk_sehen', wert: true });
    // Rollenwechsel durch das Büro → alte Sitzung weg
    const pol2 = await s.login(8);
    await c.buero.put('/benutzer/8', { rolle: 'mitarbeiter' });
    if ((await pol2.get('/berichte')).status !== 401) v.push('Rollenwechsel Polier→Mitarbeiter: alte Sitzung bleibt gültig');
    const neu = await s.login(8);
    if ((await neu.get('/berichte')).status !== 403) v.push('nach Rollenwechsel zu Mitarbeiter weiter Zugriff auf Berichte');
    // Abmelden beendet die Sitzung am Server
    const x = await s.login(U.mitarbeiter);
    const alt = x.cookie;
    const lo = await x.post('/auth/logout');
    if (!/Max-Age=0/.test(lo.headers.get('set-cookie') || '')) v.push('Logout löscht das Cookie nicht');
    const y = s.client(alt);
    if ((await y.get('/auth/ich')).status !== 401) v.push('alte Sitzung nach Logout noch gültig');
    // Session Fixation: vorhandenes (fremdes) Cookie beim Anmelden wird ersetzt und beendet
    const angreifer = await s.login(U.mitarbeiter);
    const fixiert = s.client(angreifer.cookie);
    const r = await fixiert.post('/auth/login', { benutzerId: U.gf, pin: '1234' });
    if (r.status !== 200 || fixiert.cookie === angreifer.cookie) v.push('Anmeldung übernimmt das mitgebrachte Sitzungs-Cookie (Session Fixation)');
    const a2 = s.client(angreifer.cookie);
    const ich = await a2.get('/auth/ich');
    if (ich.status === 200 && ich.daten.benutzer.id === U.gf) v.push('Session Fixation: Angreifer-Cookie gehört jetzt der GF');
    // Cookie-Flags
    const sc = r.headers.get('set-cookie') || '';
    for (const f of ['HttpOnly', 'SameSite=Strict', 'Path=/']) if (!sc.includes(f)) v.push(`Sitzungs-Cookie ohne ${f}: ${sc}`);
    if (!/bt_session=[0-9a-f]{64}/.test(sc)) v.push(`Sitzungs-Token nicht 32 Byte zufällig (hex): ${sc.slice(0, 40)}`);
    // ungültige/zu kurze Tokens, Cookie-Tricks
    for (const ck of ['bt_session=' + '0'.repeat(64), 'bt_session=abc', `bt_session=${alt.split('=')[1]}`, `bt_session=; bt_session=${fixiert.cookie.split('=')[1]}`, `__proto__=x; bt_session=${'1'.repeat(64)}`]) {
      const q = await roh(s.basis, 'GET', '/api/preise', { cookie: ck });
      if (q.status !== 401) v.push(`Cookie „${ck.slice(0, 40)}“ → ${q.status}`);
    }
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  await t.test('PIN raten: Sperre je Benutzer/IP, X-Forwarded-For ohne TRUST_PROXY wirkungslos, Kontosperre über alle IPs', async () => {
    const v = [];
    const a = s.client();
    let letzte;
    for (let i = 1; i <= 6; i++) letzte = await a.anfrage('POST', '/auth/login', { benutzerId: FREMDER_MA, pin: String(100000 + i) }, { 'x-forwarded-for': `203.0.113.${i}` });
    if (letzte.status !== 429) v.push(`ohne TRUST_PROXY: 6 Fehlversuche mit wechselndem X-Forwarded-For → ${letzte.status} (erwartet 429)`);
    if ((await a.post('/auth/login', { benutzerId: FREMDER_MA, pin: '1234' })).status !== 429) v.push('richtige PIN während der Sperre angenommen');
    // auch über /auth/pin (alte PIN raten) zählt
    const m = await s.login(15);
    for (let i = 0; i < 5; i++) letzte = await m.post('/auth/pin', { alt: String(200000 + i), neu: '583920' });
    if (letzte.status !== 429) v.push(`PIN raten über /auth/pin → ${letzte.status} (erwartet 429)`);
    // mit TRUST_PROXY: wechselnde IPs umgehen die IP-Sperre, aber nicht die Kontosperre (20 in 24 h)
    const p = await starte({ trustProxy: true });
    try {
      const b = p.client();
      let st = [];
      for (let i = 1; i <= 21; i++) st.push((await b.anfrage('POST', '/auth/login', { benutzerId: 16, pin: String(300000 + i) }, { 'x-forwarded-for': `198.51.100.${i}` })).status);
      if (!st.includes(423)) v.push(`TRUST_PROXY + 21 IPs: keine Kontosperre (Status ${[...new Set(st)].join(',')})`);
      const ok = await b.anfrage('POST', '/auth/login', { benutzerId: 16, pin: '1234' }, { 'x-forwarded-for': '198.51.100.99' });
      if (ok.status !== 423) v.push(`gesperrtes Konto mit richtiger PIN → ${ok.status}`);
      // Secure-Flag hinter dem Proxy
      const g = await b.anfrage('POST', '/auth/login', { benutzerId: U.gf, pin: '1234' }, { 'x-forwarded-for': '198.51.100.200', 'x-forwarded-proto': 'https' });
      if (!/;\s*Secure/.test(g.headers.get('set-cookie') || '')) v.push('hinter HTTPS-Proxy fehlt Secure am Cookie');
    } finally { await p.stop(); }
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  await t.test('Zwei-Faktor: keine Sitzung nach PIN allein, Code und Wiederherstellungscode nur einmal, Vorgang personengebunden', async () => {
    const v = [];
    const bl = await s.login(U.bauleiter);
    const e = await bl.post('/auth/2fa/einrichten', { pin: '1234' });
    const geheim = T.base32Dekodieren(e.daten.geheimnis);
    const code = (vers = 0) => T.totp(geheim, s.uhr().getTime() + vers);
    const best = await bl.post('/auth/2fa/bestaetigen', { code: code() });
    const rcodes = best.daten.wiederherstellungscodes;
    s.uhr.plus(1);
    const a = s.client();
    const l1 = await a.post('/auth/login', { benutzerId: U.bauleiter, pin: '1234' });
    if (!l1.daten.zweiterFaktor) v.push('Login mit aktiver 2FA ohne zweiten Faktor');
    if (/bt_session=[0-9a-f]/.test(l1.headers.get('set-cookie') || '')) v.push('Sitzungs-Cookie schon nach der PIN');
    for (const p of ['/preise', '/kalkulation', '/auth/ich', '/einstellungen/sicherheit']) if ((await a.get(p)).status !== 401) v.push(`nach PIN, vor 2FA: GET ${p} nicht 401`);
    // Vorgang einer anderen Person: Code des Bauleiters mit Vorgang der GF? (GF hat keine 2FA → kein Vorgang). Vorgang raten:
    if ((await a.post('/auth/login/2fa', { vorgang: 'x'.repeat(43), code: code() })).status !== 401) v.push('geratener Vorgang angenommen');
    const k = code();
    const l2 = await a.post('/auth/login/2fa', { vorgang: l1.daten.vorgang, code: k });
    if (l2.status !== 200) v.push(`2FA mit gültigem Code → ${l2.status}`);
    // gleicher Code / gleicher Vorgang erneut
    const a2 = s.client();
    const l3 = await a2.post('/auth/login', { benutzerId: U.bauleiter, pin: '1234' });
    if ((await a2.post('/auth/login/2fa', { vorgang: l3.daten.vorgang, code: k })).status === 200) v.push('TOTP-Code zweimal verwendbar (Replay)');
    if ((await a2.post('/auth/login/2fa', { vorgang: l1.daten.vorgang, code: code(30000) })).status === 200) v.push('verbrauchter Vorgang erneut verwendbar');
    // Wiederherstellungscode genau einmal
    const a3 = s.client();
    const l4 = await a3.post('/auth/login', { benutzerId: U.bauleiter, pin: '1234' });
    if ((await a3.post('/auth/login/2fa', { vorgang: l4.daten.vorgang, code: rcodes[0] })).status !== 200) v.push('Wiederherstellungscode nicht angenommen');
    const a4 = s.client();
    const l5 = await a4.post('/auth/login', { benutzerId: U.bauleiter, pin: '1234' });
    if ((await a4.post('/auth/login/2fa', { vorgang: l5.daten.vorgang, code: rcodes[0] })).status === 200) v.push('Wiederherstellungscode zweimal verwendbar');
    // Vorgang: höchstens 5 Versuche
    const a5 = s.client();
    const l6 = await a5.post('/auth/login', { benutzerId: U.bauleiter, pin: '1234' });
    let st;
    for (let i = 0; i < 6; i++) st = (await a5.post('/auth/login/2fa', { vorgang: l6.daten.vorgang, code: String(100000 + i) })).status;
    if ((await a5.post('/auth/login/2fa', { vorgang: l6.daten.vorgang, code: code() })).status === 200) v.push(`nach 6 Fehlversuchen im selben Vorgang noch Anmeldung möglich (${st})`);
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  await t.test('Sperren „PIN ändern“ und „2FA einrichten“ gelten für ALLE Routen außer /auth/* und /gesundheit (API.md 7, 12.7)', async () => {
    const v = [];
    const k = await H.starteKopie(basis);
    try {
      const gf = await k.login(U.gf);
      // GF muss die PIN ändern (z. B. nach Zurücksetzen) – Sitzung mit gesetztem Kennzeichen
      k.db.lauf('UPDATE benutzer SET muss_pin_aendern = 1 WHERE id = ?', U.gf);
      for (const [m, p, b] of [['GET', '/preise'], ['GET', '/einstellungen/sicherheit'], ['PUT', '/einstellungen/sicherheit', { zweiFaktorPflicht: { gf: false } }], ['DELETE', `/benutzer/${U.bauleiter}/2fa`], ['GET', '/rechte']]) {
        const r = await gf.anfrage(m, p, b);
        if (r.status !== 403 || r.daten.code !== 'PIN_AENDERN') v.push(`GF mit „PIN ändern“: ${m} ${p} → ${r.status} ${r.daten.code || ''} (erwartet 403 PIN_AENDERN)`);
      }
      k.db.lauf('UPDATE benutzer SET muss_pin_aendern = 0 WHERE id = ?', U.gf);
      // 2FA-Pflicht für die GF, noch nicht eingerichtet
      k.db.setzeEinstellung('zwei_faktor_pflicht', { bauleiter: false, buero: false, gf: true });
      for (const [m, p, b] of [['GET', '/preise'], ['GET', '/einstellungen/sicherheit'], ['PUT', '/einstellungen/sicherheit', { zweiFaktorPflicht: { gf: false } }], ['DELETE', `/benutzer/${U.bauleiter}/2fa`]]) {
        const r = await gf.anfrage(m, p, b);
        if (r.status !== 403 || r.daten.code !== '2FA_EINRICHTEN') v.push(`GF mit 2FA-Pflicht ohne 2FA: ${m} ${p} → ${r.status} ${r.daten.code || ''} (erwartet 403 2FA_EINRICHTEN)`);
      }
    } finally { await k.stop(); }
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  await t.test('Fernunterschrift: Link nur einmal, geratene Tokens, AG-Fassung ohne € und ohne Krankenstand', async () => {
    const v = [];
    const a = s.client();
    for (const tok of ['A'.repeat(43), F.bericht.bs1Token.slice(0, -1) + (F.bericht.bs1Token.endsWith('A') ? 'B' : 'A'), F.bericht.bs1Token.toLowerCase(), '../berichte/1', '%2e%2e%2fberichte']) {
      const r = await a.get(`/fern/${tok}`);
      if (![404, 410, 400, 401].includes(r.status)) v.push(`Fern-Token „${tok.slice(0, 12)}…“ → ${r.status}`);
    }
    for (const tok of [F.bericht.bs1Token, F.bericht.bs3Token]) {
      for (const p of [`/fern/${tok}`, `/fern/${tok}/pdf`]) {
        const r = await a.get(p);
        v.push(...await H.scanne('mitarbeiter', r, { route: 'FERN', url: `${p} (öffentlich)` }));
        if (r.status === 200 && typeof r.daten === 'object') {
          const s2 = JSON.stringify(r.daten);
          for (const f of ['kostenTag', 'emailVersand', 'erstelltVon', 'pnr', 'telefon', 'lohngruppe']) if (s2.includes(`"${f}"`)) v.push(`${p}: internes Feld ${f} in der öffentlichen AG-Fassung`);
        }
      }
    }
    const png = require('../../server/png').demoUnterschrift ? require('../../server/png').demoUnterschrift('Fern Test') : null;
    if (png) {
      const r1 = await a.post(`/fern/${F.bericht.bs1Token}`, { name: 'DI Bauherr', bildPng: png, bestaetigt: true });
      const r2 = await a.post(`/fern/${F.bericht.bs1Token}`, { name: 'DI Bauherr', bildPng: png, bestaetigt: true });
      if (r1.status === 200 && r2.status !== 410) v.push(`Fern-Link zweimal verwendbar (${r2.status})`);
      if ((await a.get(`/fern/${F.bericht.bs1Token}`)).status !== 410) v.push('verwendeter Fern-Link weiter lesbar');
    }
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  await t.test('Test-Schnittstellen: ohne/mit falschem Token 403, ohne BAUTAG_TEST nicht vorhanden, nie im Echtbetrieb', async () => {
    const v = [];
    for (const kopf of [{ 'x-bautag-test-token': '' }, { 'x-bautag-test-token': TOKEN.slice(0, -1) + 'X' }, { 'x-bautag-test-token': TOKEN + 'x' }, { 'x-bautag-test-token': TOKEN.toUpperCase() }]) {
      for (const [m, p] of [['GET', '/test/ausgang'], ['POST', '/test/uhr'], ['POST', '/test/stuendlich'], ['GET', '/TEST/ausgang'], ['GET', '/test//ausgang']]) {
        const r = await c.gf.anfrage(m, p, m === 'POST' ? { iso: '2027-01-01T00:00:00Z' } : undefined, kopf);
        if (r.status !== 403 && r.status !== 404) v.push(`${m} ${p} mit Kopf ${JSON.stringify(kopf).slice(0, 50)} → ${r.status}`);
      }
    }
    const o = await starte({ test: false });
    try {
      const r = await o.client().anfrage('GET', '/test/ausgang', undefined, { 'x-bautag-test-token': TOKEN });
      if (r.status !== 401) v.push(`ohne BAUTAG_TEST: /api/test/ausgang → ${r.status}`);
      const g = await o.login(U.gf);
      if ((await g.anfrage('GET', '/test/ausgang', undefined, { 'x-bautag-test-token': TOKEN })).status !== 404) v.push('ohne BAUTAG_TEST: Test-Schnittstelle vorhanden');
    } finally { await o.stop(); }
    assert.throws(() => require('../../server/index').createApp({ dbPath: ':memory:', test: true, nodeEnv: 'production', schluessel: 'x'.repeat(40) }), /BAUTAG_TEST/);
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  await t.test('Indirekte Lecks: Krankenstand über 409-Fehlertexte und Vorschau-Antworten', async () => {
    const v = [];
    // Polier meldet Schlechtwetter für seine Partie an einem Tag, an dem die Person krank gemeldet ist
    const pol = c.polier;
    const r1 = await pol.post('/abwesenheiten', { benutzerId: ANDERER_MA, datum: '2026-11-16', code: 'SW' });
    v.push(...await H.scanne('polier', r1, { route: 'POST /api/abwesenheiten', url: '/abwesenheiten (SW an Krankentag)' }));
    if (/„K“/.test(JSON.stringify(r1.daten))) v.push(`polier POST /abwesenheiten (SW für Person ${ANDERER_MA} am 16.11.) → ${r1.status}: Fehlertext nennt den Code K: ${r1.daten.fehler}`);
    const r2 = await pol.post('/abwesenheiten/zeitraum', { benutzerId: ANDERER_MA, von: '2026-11-16', bis: '2026-11-17', code: 'SW', vorschau: true });
    if (/schon K/.test(JSON.stringify(r2.daten))) v.push(`polier POST /abwesenheiten/zeitraum (Vorschau, SW) → ${r2.status}: ${JSON.stringify(r2.daten.uebersprungen)}`);
    v.push(...await H.scanne('polier', r2, { route: 'POST /api/abwesenheiten/zeitraum', url: '/abwesenheiten/zeitraum (Vorschau)' }));
    // Mitarbeiter: Antrag für andere wird VOR jeder Auskunft abgelehnt
    const r3 = await c.mitarbeiter.post('/abwesenheiten', { benutzerId: ANDERER_MA, datum: '2026-11-16', code: 'U' });
    if (r3.status !== 403 || /„K“/.test(JSON.stringify(r3.daten))) v.push(`mitarbeiter POST /abwesenheiten für Person ${ANDERER_MA} → ${r3.status} ${JSON.stringify(r3.daten)}`);
    // Planer-Konflikttexte: „Krank“ nur mit stammdaten/lohn
    // Inhaber 13.11.2026: die SW-Meldung des Poliers ist immer gleich aufgebaut – 201 „gemeldet“, nichts über bestehende Abwesenheiten
    const NEUTRAL = ['arbeitstage', 'benutzerId', 'bis', 'code', 'meldungId', 'status', 'text', 'von'];
    if (r1.status !== 201 || r1.daten.status !== 'gemeldet' || JSON.stringify(Object.keys(r1.daten).sort()) !== JSON.stringify(NEUTRAL)) v.push(`polier SW an Krankentag → ${r1.status} ${JSON.stringify(r1.daten)} (erwartet neutrale Meldung)`);
    const r1b = await pol.post('/abwesenheiten', { benutzerId: ANDERER_MA, datum: '2026-11-13', code: 'SW' }); // Tag ohne Abwesenheit
    if (JSON.stringify(Object.keys(r1b.daten).sort()) !== JSON.stringify(NEUTRAL) || r1b.daten.text !== r1.daten.text || r1b.status !== r1.status) v.push('polier: SW-Antwort an einem freien Tag unterscheidet sich von der am Krankentag');
    if (r2.status !== 200 || 'uebersprungen' in r2.daten || JSON.stringify(Object.keys(r2.daten).sort()) !== JSON.stringify(['arbeitstage', 'benutzerId', 'bis', 'code', 'text', 'von', 'vorschau'])) v.push(`polier SW-Vorschau → ${r2.status} ${JSON.stringify(r2.daten)} (erwartet neutrale Vorschau)`);
    // Planer-Konflikttexte: „Krank“ nur mit stammdaten/lohn (Bauleiter = Büro); Polier: Meine Partie ohne Abwesenheiten
    const w = await c.polier.get('/plan/partie?datum=2026-11-16');
    v.push(...await H.scanne('polier', w, { route: 'GET /api/plan/partie', url: '/plan/partie?datum=2026-11-16' }));
    if (/abwesend|Krank|Urlaub/.test(JSON.stringify(w.daten))) v.push('polier /plan/partie nennt Abwesenheiten');
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  await t.test('Indirekte Lecks: Abwesenheits-Orakel im Bautagesbericht – Antworten für abwesende und anwesende Person identisch (API.md 15.1)', async () => {
    // Eigene Kopie: die Proben speichern den Entwurf (machen u. a. Fern-Links ungültig)
    const k = await H.starteKopie(basis);
    const v = [];
    try {
      const gf = await k.login(U.gf);
      for (const recht of ['bericht_erstellen', 'bericht_freigeben']) await gf.put('/rechte/ausnahme', { benutzerId: U.mitarbeiter, recht, wert: true });
      const wer = { polier: [await k.login(U.polier), U.polier], mitarbeiter: [await k.login(U.mitarbeiter), U.mitarbeiter] };
      const BID = F.bericht.bs1; // Pitten 12.11.: Daniel Schwarz (3) genehmigter Urlaub, Zeile für Polier/Mitarbeiter verborgen
      const name = (id) => k.db.eins('SELECT name FROM benutzer WHERE id = ?', id).name;
      const ZUSTAND = k.db.alle('SELECT * FROM bericht_personal WHERE bericht_id = ?', BID);
      const VERSION = k.db.eins('SELECT version, geaendert FROM bericht WHERE id = ?', BID);
      const zurueck = () => {
        k.db.lauf('DELETE FROM bericht_personal WHERE bericht_id = ?', BID);
        for (const z of ZUSTAND) { const ks = Object.keys(z).filter((x) => x !== 'id'); k.db.lauf(`INSERT INTO bericht_personal (${ks.join(', ')}) VALUES (${ks.map(() => '?').join(', ')})`, ...ks.map((x) => z[x])); }
        k.db.lauf('UPDATE bericht SET version = ?, geaendert = ? WHERE id = ?', VERSION.version, VERSION.geaendert, BID);
      };
      // Paare (abwesend, anwesend) in gleicher Stellung: Partie Pitten (Daniel U / Karl), Gäste von BS 7 (Erwin U / Johann) und BS 6/4 (Elias K / Patrick, beide heute nicht gestempelt)
      const paare = [[ANDERER_MA, 7], [28, 29], [24, 16]];
      for (const [abw] of paare) if (!k.db.eins("SELECT 1 AS x FROM abwesenheit WHERE benutzer_id = ? AND datum = '2026-11-12' AND status = 'genehmigt'", abw)) v.push(`Vorbereitung: ${abw} ohne Abwesenheit am 12.11. – Orakel-Probe wirkungslos`);
      if (!ZUSTAND.some((z) => z.benutzer_id === ANDERER_MA && z.code === 'U')) v.push('Vorbereitung: verborgene U-Zeile fehlt im Entwurf');
      const winAnsi = require('../../server/pdf').winAnsi;
      const normal = (o, id) => JSON.stringify(o).split(name(id)).join('NAME').split(`"benutzerId":${id},`).join('"benutzerId":"X",').split(`"benutzerId":${id}}`).join('"benutzerId":"X"}');
      for (const [rolle, [cl, ich]] of Object.entries(wer)) {
        for (const [abw, anw] of paare) {
          for (const code of ['abwesend', 'K', 'U', 'ZA', 'SW', null, '–', 'X']) {
            for (const zeiten of [{}, { von1: '07:00', bis1: '12:00' }]) {
              const erg = {};
              for (const id of [abw, anw]) {
                zurueck();
                const b = (await cl.get(`/berichte/${BID}`)).daten;
                const personal = [...b.personal.filter((p) => p.benutzerId !== id).map((p) => ({ benutzerId: p.benutzerId, von1: p.von1, bis1: p.bis1, von2: p.von2, bis2: p.bis2, pauseMin: p.pauseMin, code: p.code, segStunden: p.segStunden, ...(p.gast ? { gast: true } : {}) })), { benutzerId: id, code, gast: true, ...zeiten }];
                const r = await cl.put(`/berichte/${BID}`, { version: b.version, personal });
                const liste = (await cl.get(`/berichte?baustelleId=${BS.pitten}`)).daten.find((z) => z.id === BID);
                const d = (await cl.get(`/berichte/${BID}`)).daten;
                const pdf = await cl.get(`/berichte/${BID}/pdf?fassung=intern`);
                erg[id] = { status: r.status, antwort: normal({ ...r.daten, geaendert: null }, id), liste: normal(liste, id), detail: normal({ ...d, geaendert: null }, id), pdf: pdf.status === 200 ? H.pdfText(pdf.daten).split(winAnsi(name(id))).join('NAME') : pdf.status };
                const wo = `${rolle} PUT /berichte/${BID} (Orakel ${id}, code ${JSON.stringify(code)})`;
                v.push(...await H.scanne(rolle, r, { route: 'PUT /api/berichte/:id', url: wo, mitAusnahmen: true }));
                v.push(...H.berichtJsonAbwesenheitVerstoesse(k.db, ich, [r.daten, d], wo));
                if (pdf.status === 200) v.push(...H.berichtPdfAbwesenheitVerstoesse(k.db, BID, ich, winAnsi(H.pdfText(pdf.daten)), `${wo} PDF`));
              }
              for (const teil of ['status', 'antwort', 'liste', 'detail', 'pdf']) {
                if (erg[abw][teil] !== erg[anw][teil]) v.push(`${rolle}: Orakel – ${teil} für abwesende ${abw} ≠ anwesende ${anw} (code ${JSON.stringify(code)}, Zeiten ${JSON.stringify(zeiten)}): ${String(erg[abw][teil]).slice(0, 200)} ≠ ${String(erg[anw][teil]).slice(0, 200)}`);
              }
            }
          }
        }
      }
    } finally { await k.stop(); }
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });

  await t.test('Indirekte Lecks: Zahlungsstand der Ausgangsrechnungen über phaseVorschlag der Baustelle', async () => {
    const v = [];
    const k = await H.starteKopie(basis);
    try {
      const gf = await k.login(U.gf);
      const ver = async () => (await gf.get(`/baustellen/${BS.pitten}`)).daten.version;
      await gf.post(`/baustellen/${BS.pitten}/phase`, { phase: 'fertiggestellt', version: await ver() });
      await gf.post(`/baustellen/${BS.pitten}/phase`, { phase: 'abgenommen', abnahmeDatum: '2026-11-12', version: await ver() });
      const sr = await gf.post(`/baustellen/${BS.pitten}/rechnungen`, { nr: 'SR-KANARIE', typ: 'schluss', datum: '2026-11-12', netto: 1000 });
      const pruefe = async (wann) => {
        for (const [rolle, id] of [['mitarbeiter', U.mitarbeiter], ['polier', U.polier]]) {
          const c2 = await k.login(id);
          for (const p of [`/baustellen/${BS.pitten}`, '/baustellen?alle=1']) {
            const r = await c2.get(p);
            const liste = Array.isArray(r.daten) ? r.daten : [r.daten];
            const b = liste.find((x) => x && x.id === BS.pitten);
            if (b && b.phaseVorschlag) v.push(`${rolle} GET ${p} (${wann}): phaseVorschlag ${JSON.stringify(b.phaseVorschlag)} verrät den Rechnungsstand`);
          }
        }
      };
      await pruefe('Schlussrechnung erfasst');
      await gf.post(`/baustellen/${BS.pitten}/phase`, { phase: 'schlussrechnung', version: await ver() });
      for (const id of [F.rechnung.bs1, sr.daten.id]) {
        const r = (await gf.get(`/rechnungen/${id}`)).daten;
        if (r.offen > 0) await gf.post(`/rechnungen/${id}/zahlungen`, { datum: '2026-11-12', betrag: r.offen });
      }
      await pruefe('alle Rechnungen bezahlt');
    } finally { await k.stop(); }
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
  });
});
