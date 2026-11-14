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
    for (const id of [U.mitarbeiter, U.polier, U.bauleiter, U.buero]) {
      // PIN/Name/Telefon des eigenen Kontos über die Verwaltung: würde die alte PIN umgehen (nur /auth/pin, /auth/telefon)
      await nein(id, 'PUT', `/benutzer/${id}`, { pin: '583920' }, 'eigene PIN nur über /auth/pin (mit alter PIN)');
      await nein(id, 'PUT', `/benutzer/${id}`, { name: 'Selbst umbenannt' }, 'eigenes Konto verwaltet eine andere Person (Bauleiter = Büro)');
      for (const recht of ['benutzer', 'preise_sehen', 'kolonne']) await nein(id, 'PUT', '/rechte/ausnahme', { benutzerId: id, recht, wert: true }, 'Rechte/Ausnahmen vergibt nur die GF');
      await nein(id, 'PUT', '/rechte/matrix', { rolle: k.db.eins('SELECT rolle FROM benutzer WHERE id = ?', id).rolle, recht: 'benutzer', wert: true }, 'Rollen-Matrix nur GF');
    }
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
      const nurSicherheit = wer === U.buero && ziel === U.bauleiter; // Büro → Bauleiter: Stammdaten (Telefon) bleiben erlaubt (API.md 9)
      await nein(wer, 'PUT', `/benutzer/${ziel}`, { pin: '864213' }, `PIN-Reset: ${grund}`);
      await nein(wer, 'PUT', `/benutzer/${ziel}`, { aktiv: false }, `Deaktivieren: ${grund}`);
      await nein(wer, 'PUT', `/benutzer/${ziel}`, { rolle: 'mitarbeiter' }, `Rollenwechsel: ${grund}`);
      if (!nurSicherheit) await nein(wer, 'PUT', `/benutzer/${ziel}`, { telefon: '+43 660 9999999' }, `Stammdaten: ${grund}`);
      await nein(wer, 'DELETE', `/benutzer/${ziel}/2fa`, undefined, `2FA-Rücksetzung: ${grund}`);
      await nein(wer, 'PUT', '/rechte/ausnahme', { benutzerId: ziel, recht: 'benutzer', wert: true }, `Ausnahmen: ${grund}`);
      await nein(wer, 'PUT', '/rechte/ausnahme', { benutzerId: ziel, recht: 'stammdaten', wert: false }, `Rechte entziehen: ${grund}`);
    }
    // F-051: Fehlversuchs-Sperren des GF-Kontos hebt nur die GF auf (sonst unbegrenztes PIN-Raten gegen die GF)
    for (let i = 0; i < 5; i++) await k.client().post('/auth/login', { benutzerId: U.gf, pin: String(700000 + i) });
    for (const wer of [U.buero, U.bauleiter, B2, BL2]) await nein(wer, 'POST', `/benutzer/${U.gf}/entsperren`, {}, 'Sperren des GF-Kontos hebt nur die GF auf (F-051)');
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
});
