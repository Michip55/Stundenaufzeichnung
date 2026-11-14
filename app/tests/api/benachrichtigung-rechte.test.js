'use strict';
/**
 * API.md 15.3 – Korrekturen Rechte-Kontrolle: Benachrichtigungen (Befunde F-004, F-007, F-052, F-054, F-056).
 *
 * - Jede Benachrichtigung speichert `erfordert`; jede Leseroute und der Push-Versand prüfen die AKTUELLEN Rechte.
 * - Nach Herabstufung (Büro/Bauleiter → Polier) oder Rechteentzug ist nichts Geschütztes mehr sichtbar –
 *   weder über /benachrichtigungen (Liste, gelesen, alle-gelesen) noch über die Push-Warteschlange; ausgeblendet, nicht gelöscht.
 * - Empfänger über Rechte, nie über Rollennamen: der Bauleiter erhält, was das Büro erhält; ohne preise_sehen keine Rechnungsnummern.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { starte, U, BS } = require('./hilfe');
const { oeffneDatenbank } = require('../../server/db');
const N = require('../../server/benachrichtigung');
const P = require('../../server/push');

const KEYS = { p256dh: 'BPx', auth: 'aa' };
const ZEIT = '2026-11-12T09:30:00.000Z';

/** Benachrichtigungen jeder Art an `uid` (Kanarienvögel im Titel/Text); eigene tragen EIGEN */
function alleArten(db, uid) {
  const b = (typ, schluessel, titel, text, extra = {}) => N.benachrichtige(db, { benutzerId: uid, typ, titel, text, zeit: ZEIT, schluessel, ...extra });
  b('budget', 'budget:1:90:x', 'Budget-Alarm: KANARIE-BUDGET', 'KANARIE-BUDGET 90 % erreicht', { baustelleId: BS.pitten });
  b('rechnung', 're:999:faellig', 'Rechnung KANARIE-RE-1 fällig', 'Die Rechnung KANARIE-RE-1 war fällig.', { baustelleId: BS.pitten });
  b('rechnung', 're:999:mahn:1', 'Zahlungserinnerung vorschlagen: Rechnung KANARIE-RE-2', 'KANARIE-RE-2 überfällig');
  b('email', 'mail:999', 'E-Mail nicht zugestellt: KANARIE-MAIL', 'an KANARIE-MAIL@example.test: 550');
  b('urlaub', 'urlaub:antrag:aKANARIE', 'Antrag offen: KANARIE-URLAUB', 'Antrag von KANARIE-URLAUB seit über 3 Tagen');
  b('abwesenheit', 'abw:777:2026-11-12T09:30:00.000Z', 'Antrag: Krankenstand – KANARIE-ABW-1', 'KANARIE-ABW-1 beantragt Krankenstand');
  b('abwesenheit', 'abw:antrag:aKAN', 'Urlaubsantrag: KANARIE-ABW-2', 'KANARIE-ABW-2 – Hochzeit');
  b('abwesenheit', 'sw:777', 'Schlechtwetter gemeldet: KANARIE-SW', 'KANARIE-SW bitte bestätigen');
  b('azg', 'azg:26:2026-11-12:tag_12h', 'AZG-Hinweis: KANARIE-AZG', 'KANARIE-AZG 12,5 Std.');
  b('baustelle', 'bv:sr:1:2026-10-01', 'Schlussrechnung fehlt: KANARIE-SR', 'KANARIE-SR', { baustelleId: BS.pitten });
  b('baustelle', 'bv:bg:1:2026-12-01', 'Bankgarantie läuft ab: KANARIE-BG', 'KANARIE-BG', { baustelleId: BS.pitten });
  b('baustelle', 'bv:hr:1:2026-11-01', 'Haftrücklass freigeben lassen: KANARIE-HR', 'KANARIE-HR', { baustelleId: BS.pitten });
  b('baustelle', 'bv:gw:1:2027-01-01', 'Gewährleistung endet: KANARIE-GW', 'KANARIE-GW', { baustelleId: BS.pitten });
  b('baustelle', 'bv:fm:1:x', 'Fertigstellung gemeldet: KANARIE-FM', 'KANARIE-FM', { baustelleId: BS.pitten });
  b('bericht', 'bericht:999:unterschrieben', 'Bericht zur Freigabe: KANARIE-BER', 'KANARIE-BER');
  b('plan', 'plan:erinnerung:2026-11-12', 'Einteilung für morgen noch nicht veröffentlicht', 'Abweichungen: KANARIE-PLAN: abwesend.');
  b('plan', 'plan:anfrage:999', 'Änderung angefragt: KANARIE-ANFRAGE', 'KANARIE-ANFRAGE');
  b('plan', 'fuhre:pruefen:999', 'Fuhre prüfen: KANARIE-FUHRE', 'KANARIE-FUHRE');
  b('sicherheit', 'konto:777:x', 'Konto gesperrt: KANARIE-KONTO', 'KANARIE-KONTO');
  b('sicherheit', 'rolle:777:x', 'Rollenwechsel: KANARIE-ROLLE', 'KANARIE-ROLLE');
  b('sicherheit', 'sicherung:2026-11-12:alter', 'Datensicherung: KANARIE-SICH', 'KANARIE-SICH');
  b('fuhrpark', 'fp:woche:2026-46', 'Fuhrpark – Wochenübersicht KANARIE-FP-1', 'KANARIE-FP-1');
  b('fuhrpark', 'fp:unplausibel:999', 'Unplausibler Zählerstand: KANARIE-FP-2', 'KANARIE-FP-2');
  b('fuhrpark', 'fp:mangel:999', 'Schaden gemeldet: KANARIE-FP-3', 'KANARIE-FP-3 Ursache', { erfordert: ['fuhrpark|stammdaten'] });
  // eigene – bleiben sichtbar
  b('abwesenheit', 'abw:778:genehmigt:2026-11-12T09:30:00.000Z', 'Urlaub genehmigt', 'EIGEN-ABW Ihr Antrag wurde genehmigt.');
  b('azg', `azg:${uid}:2026-11-12:pause`, 'AZG-Hinweis', 'EIGEN-AZG Pause fehlt');
  b('sicherheit', `2fa-code:${uid}:x`, 'Wiederherstellungscode verwendet', 'EIGEN-2FA');
  b('plan', 'plan:2026-11-13:h1', 'Einsatz morgen', 'EIGEN-PLAN Morgen 06:30');
}

const verboten = (json, namen) => {
  const s = JSON.stringify(json);
  const v = [];
  if (/KANARIE/.test(s)) v.push(`Kanarie: ${s.match(/[^"]*KANARIE[^"]*/g).slice(0, 6).join(' | ')}`);
  for (const n of namen) if (s.includes(n)) v.push(`fremder Name/Nummer: ${n}`);
  if (/€|EUR\b/.test(s)) v.push('€');
  return v;
};

test('15.3 Benachrichtigungen nach Rechten (F-004, F-007, F-052, F-054, F-056)', { timeout: 5 * 60 * 1000 }, async (t) => {
  const s = await starte({ test: true });
  t.after(() => s.stop());
  const bt = s.app.bt;
  const c = {};
  for (const [r, id] of Object.entries(U)) c[r] = await s.login(id);
  const name = (id) => s.db.eins('SELECT name FROM benutzer WHERE id = ?', id).name;
  const FREMDE = [name(U.mitarbeiter), name(4), name(26)];
  const liste = async (cl) => { const r = await cl.get('/benachrichtigungen'); assert.equal(r.status, 200, JSON.stringify(r.daten)); return r.daten; };
  const pin = {};
  /** nach Uhrsprüngen alle Sitzungen neu */
  async function alleNeu() { for (const [r, id] of Object.entries(U)) c[r] = await s.login(id, pin[id] || '1234'); }
  const anmelden = (id) => s.login(id, pin[id] || '1234');
  /** GF stuft wieder hoch (setzt eine PIN ≥ 6, die der Benutzer gleich ändert) → angemeldeter Client */
  async function hochstufen(id, rolle) {
    const r = await c.gf.put(`/benutzer/${id}`, { rolle, pin: '135790' });
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    const cl = await s.login(id, '135790');
    assert.equal((await cl.post('/auth/pin', { alt: '135790', neu: '246802' })).status, 200);
    pin[id] = '246802';
    return cl;
  }

  await t.test('F-004/F-007 (dauerhaft): Büro → Polier – keine geschützte Benachrichtigung über irgendeine Route oder Push', async () => {
    bt.pushAus = true; // Warteschlange stehen lassen (push IS NULL), damit der Versand NACH der Herabstufung geprüft wird
    bt.testAusgang.push = [];
    assert.equal((await c.buero.post('/push/abo', { endpoint: 'https://push.example.test/b101', keys: KEYS })).status, 201);
    // echte Abläufe: Rechnung + Erinnerungen, Anträge, Schlechtwetter, AZG
    assert.equal((await c.gf.post(`/baustellen/${BS.pitten}/rechnungen`, { nr: 'AR-2026-4711', typ: 'teil', datum: '2026-09-01', netto: 12345.67, zahlungszielTage: 30 })).status, 201);
    bt.stuendlich();
    assert.equal((await c.mitarbeiter.post('/abwesenheiten', { benutzerId: U.mitarbeiter, datum: '2026-11-20', code: 'U' })).status, 201);
    assert.equal((await c.mitarbeiter.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: '2026-12-09', bis: '2026-12-10', code: 'U', notiz: 'Hochzeit' })).status, 201);
    assert.equal((await c.polier.post('/abwesenheiten/zeitraum', { benutzerId: 4, von: '2026-11-16', bis: '2026-11-16', code: 'SW' })).status, 201);
    const posch = await s.login(26);
    s.uhr.setze('2026-11-12T18:30:00.000Z');
    assert.equal((await posch.post('/zeit/stempeln', { typ: 'gehen' })).status, 200);
    s.uhr.setze('2026-11-12T09:30:00.000Z');
    alleArten(s.db, U.buero);

    // vorher: das Büro sieht alles (der Test erkennt Lecks)
    const vorher = await liste(c.buero);
    assert.ok(vorher.some((n) => /AR-2026-4711/.test(n.titel)), 'Rechnungserinnerung fehlt');
    assert.ok(vorher.some((n) => n.typ === 'abwesenheit' && n.titel.includes(FREMDE[0])), 'Antrag fehlt');
    assert.ok(vorher.some((n) => n.typ === 'azg' && n.titel.includes(FREMDE[2])), 'AZG fehlt');
    assert.ok(vorher.some((n) => /KANARIE-RE-1/.test(n.titel)));
    const zeilenVorher = s.db.eins('SELECT COUNT(*) AS n FROM benachrichtigung WHERE benutzer_id = ?', U.buero).n;
    const versteckt = s.db.alle('SELECT id FROM benachrichtigung WHERE benutzer_id = ? AND titel LIKE ?', U.buero, '%KANARIE-RE-1%')[0].id;

    // Herabstufung durch die GF
    const r = await c.gf.put(`/benutzer/${U.buero}`, { rolle: 'polier' });
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    const pol = await anmelden(U.buero);
    assert.equal((await pol.get('/auth/ich')).daten.benutzer.rolle, 'polier');

    const nach = await liste(pol);
    assert.deepEqual(verboten(nach, [...FREMDE, 'AR-2026-4711']), []);
    for (const e of ['EIGEN-ABW', 'EIGEN-AZG', 'EIGEN-2FA', 'EIGEN-PLAN']) assert.ok(nach.some((n) => n.text.includes(e)), `${e} fehlt`);
    // einzelne: ausgeblendet = nicht vorhanden (404), bleibt ungelesen
    assert.equal((await pol.post(`/benachrichtigungen/${versteckt}/gelesen`, {})).status, 404);
    const a = await pol.post('/benachrichtigungen/alle-gelesen', {});
    assert.equal(a.daten.anzahl, nach.filter((n) => !n.gelesen).length);
    assert.equal(s.db.eins('SELECT gelesen FROM benachrichtigung WHERE id = ?', versteckt).gelesen, 0);
    // nicht gelöscht
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM benachrichtigung WHERE benutzer_id = ?', U.buero).n, zeilenVorher);

    // Push-Warteschlange: nur Eigenes geht hinaus, Geschütztes wird verworfen ('aus')
    bt.pushAus = false;
    await P.verteilen(bt);
    const push = bt.testAusgang.push.filter((p) => p.benutzerId === U.buero);
    assert.deepEqual(verboten(push, [...FREMDE, 'AR-2026-4711']), []);
    assert.ok(push.some((p) => /EIGEN-ABW/.test(p.body)), 'eigene Meldung nicht gepusht');
    assert.equal(s.db.eins('SELECT push FROM benachrichtigung WHERE id = ?', versteckt).push, 'aus');
    assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM benachrichtigung WHERE benutzer_id = ? AND push IS NULL", U.buero).n, 0);
    // eine später erneut versuchte Zustellung prüft wieder die aktuellen Rechte
    assert.equal(await P.zustellen(bt, s.db.eins('SELECT * FROM benachrichtigung WHERE id = ?', versteckt)), 'aus');

    // Recht zurück → wieder sichtbar (ausgeblendet, nicht gelöscht)
    c.buero = await hochstufen(U.buero, 'buero');
    const wieder = await liste(c.buero);
    assert.ok(wieder.some((n) => n.id === versteckt));
    assert.ok(wieder.some((n) => /AR-2026-4711/.test(n.titel)));
  });

  await t.test('F-007: Bauleiter → Polier – Plan-Erinnerung mit Abwesenheiten, Rechnungen, AZG fremder Personen verschwinden', async () => {
    alleArten(s.db, U.bauleiter);
    assert.ok((await liste(c.bauleiter)).some((n) => /KANARIE-PLAN/.test(n.text)));
    assert.equal((await c.gf.put(`/benutzer/${U.bauleiter}`, { rolle: 'polier' })).status, 200);
    const pol = await anmelden(U.bauleiter);
    const nach = await liste(pol);
    assert.deepEqual(verboten(nach, [...FREMDE, 'AR-2026-4711']), []);
    assert.ok(nach.some((n) => /EIGEN-PLAN/.test(n.text)));
    c.bauleiter = await hochstufen(U.bauleiter, 'bauleiter');
  });

  await t.test('F-004/F-052 (Regel 4): Rechteentzug in der Matrix wirkt für Büro und Bauleiter gleich – und wieder zurück', async () => {
    const re = (l) => l.filter((n) => n.typ === 'rechnung');
    assert.ok(re(await liste(c.buero)).length > 0);
    assert.ok(re(await liste(c.bauleiter)).length > 0);
    for (const rolle of ['buero', 'bauleiter']) {
      assert.equal((await c.gf.put('/rechte/matrix', { rolle, recht: 'preise_sehen', wert: false })).status, 200);
    }
    assert.deepEqual(re(await liste(c.buero)), []);
    assert.deepEqual(re(await liste(c.bauleiter)), []);
    // F-052: neue Rechnungserinnerung erreicht ohne preise_sehen niemanden (Text entsteht gar nicht erst)
    assert.equal((await c.gf.post(`/baustellen/${BS.kogler}/rechnungen`, { nr: 'AR-OHNE-RECHT-1', typ: 'teil', datum: '2026-09-15', netto: 100, zahlungszielTage: 14 })).status, 201);
    bt.stuendlich();
    for (const uid of [U.buero, U.bauleiter]) {
      assert.equal(s.db.eins("SELECT COUNT(*) AS n FROM benachrichtigung WHERE benutzer_id = ? AND titel LIKE '%AR-OHNE-RECHT-1%'", uid).n, 0, `Rechnungsnummer an ${uid} ohne preise_sehen`);
    }
    assert.ok(s.db.eins("SELECT 1 AS x FROM benachrichtigung WHERE benutzer_id = ? AND titel LIKE '%AR-OHNE-RECHT-1%'", U.gf));
    for (const rolle of ['buero', 'bauleiter']) {
      assert.equal((await c.gf.put('/rechte/matrix', { rolle, recht: 'preise_sehen', wert: true })).status, 200);
    }
    assert.ok(re(await liste(c.buero)).length > 0, 'Rechnungen kommen mit dem Recht nicht zurück');
    assert.ok(re(await liste(c.bauleiter)).length > 0);
  });

  await t.test('F-052/F-054: Bauleiter erhält Büro-Meldungen (Antrag, Schlechtwetter, AZG, Rechnung, Plan-Anfrage, Fertigmeldung)', async () => {
    // Pitten ohne Bauleiter-Zuordnung: der Bauleiter erhält Meldungen über sein Recht, nicht über bauleiter_id
    s.db.lauf('UPDATE baustelle SET bauleiter_id = NULL WHERE id = ?', BS.pitten);
    s.db.lauf('DELETE FROM benachrichtigung');
    s.uhr.setze('2026-11-13T05:50:00.000Z');
    await alleNeu();
    assert.equal((await c.mitarbeiter.post('/abwesenheiten/zeitraum', { benutzerId: U.mitarbeiter, von: '2026-12-01', bis: '2026-12-02', code: 'ZA' })).status, 201);
    assert.equal((await c.polier.post('/abwesenheiten/zeitraum', { benutzerId: 4, von: '2026-11-17', bis: '2026-11-17', code: 'SW' })).status, 201);
    s.uhr.setze('2026-11-13T06:00:00.000Z');
    assert.equal((await (await s.login(26)).post('/zeit/stempeln', { typ: 'kommen', baustelleId: BS.neustadt })).status, 200);
    s.uhr.setze('2026-11-13T18:30:00.000Z');
    assert.equal((await (await s.login(26)).post('/zeit/stempeln', { typ: 'gehen' })).status, 200);
    s.uhr.setze('2026-11-13T09:30:00.000Z');
    assert.equal((await c.polier.post('/plan/anfragen', { datum: '2026-11-16', text: 'Bitte einen LKW mehr' })).status, 201);
    assert.equal((await c.polier.post(`/baustellen/${BS.pitten}/fertigmeldung`, { notiz: 'fertig' })).status, 201);
    bt.stuendlich(); // Rechnungserinnerungen
    const titel = (l) => l.map((n) => `${n.typ}|${n.titel}`).sort();
    const b = titel(await liste(c.buero)), bl = titel(await liste(c.bauleiter));
    for (const re of [/^abwesenheit\|Antrag Zeitausgleich: Lukas/, /^abwesenheit\|Schlechtwetter gemeldet/, /^azg\|AZG-Hinweis: Werner Posch/, /^rechnung\|Rechnung AR-2026-4711 fällig/, /^plan\|Änderung angefragt/, /^baustelle\|Fertigstellung gemeldet/]) {
      assert.ok(b.some((x) => re.test(x)), `Büro: ${re}`);
      assert.ok(bl.some((x) => re.test(x)), `Bauleiter: ${re} fehlt (${bl.join(', ')})`);
    }
    assert.deepEqual(bl.filter((x) => !/^budget\|/.test(x)), b.filter((x) => !/^budget\|/.test(x)), 'Bauleiter = Büro');
    // Polier/Mitarbeiter: keine dieser Meldungen
    for (const r of ['polier', 'mitarbeiter']) assert.deepEqual(verboten(await liste(c[r]), [FREMDE[2], 'AR-2026-4711']), []);
    s.db.lauf('UPDATE baustelle SET bauleiter_id = ? WHERE id = ?', U.bauleiter, BS.pitten);
  });

  await t.test('F-054: keine Empfänger-Abfrage nach Rollennamen im Server', () => {
    const wurzel = path.join(__dirname, '../../server');
    const dateien = [...fs.readdirSync(wurzel).map((f) => path.join(wurzel, f)), ...fs.readdirSync(path.join(wurzel, 'routes')).map((f) => path.join(wurzel, 'routes', f))].filter((f) => f.endsWith('.js'));
    // Erlaubt: keine Empfänger (letzte GF zählen, Erst-Einrichtung, Personenliste der Urlaubsübersicht, Entsperr-Konten)
    const ERLAUBT = [/SELECT COUNT\(\*\) AS n FROM benutzer WHERE rolle = 'gf'/, /SELECT id, name, pnr FROM benutzer WHERE rolle = 'gf'/, /rolle IN \('mitarbeiter','polier','bauleiter','buero'\) ORDER BY name/, /rolle IN \('gf','buero','bauleiter'\)"\)\s*$/];
    const funde = [];
    for (const f of dateien) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((z, i) => {
        if (/FROM benutzer\b[^`"]*\brolle\s*(?:=|IN)\s*\(?[^)`"]*'(?:buero|gf|bauleiter)'/.test(z) && !ERLAUBT.some((re) => re.test(z))) funde.push(`${path.relative(wurzel, f)}:${i + 1}: ${z.trim().slice(0, 140)}`);
      });
    }
    assert.deepEqual(funde, []);
  });

  await t.test('F-056: wartende Push-Meldung nach der Rolle beim Versand – herabgestuft → verworfen, auch zwischen zwei Abos', async () => {
    bt.pushAus = true;
    bt.testAusgang.push = [];
    s.db.lauf("UPDATE benachrichtigung SET push = 'alt' WHERE push IS NULL");
    await c.buero.post('/push/abo', { endpoint: 'https://push.example.test/b101-2', keys: KEYS });
    N.benachrichtige(s.db, { benutzerId: U.buero, typ: 'abwesenheit', titel: `Antrag: Krankenstand – ${FREMDE[1]}`, text: `${FREMDE[1]} beantragt Krankenstand.`, zeit: ZEIT, schluessel: 'abw:9001:2026-11-12T09:30:00.000Z' });
    // Herabstufung, bevor der Versand die Zeile bearbeitet
    assert.equal((await c.gf.put(`/benutzer/${U.buero}`, { rolle: 'polier' })).status, 200);
    bt.pushAus = false;
    await P.verteilen(bt);
    assert.deepEqual(verboten(bt.testAusgang.push, [FREMDE[1]]), []);
    assert.equal(s.db.eins("SELECT push FROM benachrichtigung WHERE schluessel = 'abw:9001:2026-11-12T09:30:00.000Z'").push, 'aus');
    c.buero = await hochstufen(U.buero, 'buero');

    // Herabstufung WÄHREND des Versands (nach dem ersten Abo): kein weiteres Abo erhält die Meldung
    bt.pushAus = true;
    bt.testAusgang.push = [];
    N.benachrichtige(s.db, { benutzerId: U.buero, typ: 'abwesenheit', titel: `Antrag: Urlaub – ${FREMDE[1]}`, text: `${FREMDE[1]} beantragt Urlaub.`, zeit: ZEIT, schluessel: 'abw:9002:2026-11-12T09:30:00.000Z' });
    const ausgang = bt.testAusgang.push;
    const orig = ausgang.push.bind(ausgang);
    ausgang.push = (...x) => { const r = orig(...x); s.db.lauf("UPDATE benutzer SET rolle = 'polier' WHERE id = ?", U.buero); return r; };
    bt.pushAus = false;
    try { await P.verteilen(bt); } finally { ausgang.push = orig; s.db.lauf("UPDATE benutzer SET rolle = 'buero' WHERE id = ?", U.buero); }
    assert.equal(ausgang.filter((p) => p.benutzerId === U.buero).length, 1, 'nach der Herabstufung weiter gepusht');
  });

  await t.test('Recht noch vorhanden → Push wird normal zugestellt', async () => {
    bt.testAusgang.push = [];
    N.benachrichtige(s.db, { benutzerId: U.buero, typ: 'rechnung', titel: 'Rechnung AR-OK-1 fällig', text: 'AR-OK-1', zeit: ZEIT, schluessel: 're:9003:faellig' });
    await P.verteilen(bt);
    assert.ok(bt.testAusgang.push.some((p) => p.benutzerId === U.buero && /AR-OK-1/.test(p.title)));
  });
});

test('15.3 Ableitung erfordert und Migration 39 (Rückfüllung) stimmen überein', () => {
  const FAELLE = [
    ['budget', 'budget:1:80:x', 101], ['rechnung', 're:1:faellig', 101], ['rechnung', 're:1:mahn:2', 101], ['email', 'mail:1', 101],
    ['urlaub', 'urlaub:antrag:a1', 101], ['urlaub', 'urlaub:antrag:5', 101],
    ['azg', 'azg:26:2026-11-12:tag_12h', 101], ['azg', 'azg:26:2026-11-12:tag_12h', 26], ['azg', 'azg:2:2026-11-12:pause', 26], ['azg', 'azg:266:x', 26],
    ['abwesenheit', 'abw:5:2026-11-12T09:24:00.000Z', 101], ['abwesenheit', 'abw:5:genehmigt:2026-11-12T09:24:00.000Z', 2],
    ['abwesenheit', 'abw:5:abgelehnt:2026-11-12T09:24:00.000Z', 2], ['abwesenheit', 'abw:5:weg', 2], ['abwesenheit', 'abw:antrag:a1f', 101],
    ['abwesenheit', 'abw:antrag:a1f:genehmigt:2026-11-12T09:24:00.000Z', 2], ['abwesenheit', 'abw:antrag:a1f:weg:2026-11-12T09:24:00.000Z', 2],
    ['abwesenheit', 'sw:3', 101], ['abwesenheit', 'sw:3:bestaetigt', 1], ['abwesenheit', 'sw:3:person', 4], ['abwesenheit', 'sw:3:x:person', 4], ['abwesenheit', 'sw::person', 4],
    ['abwesenheit', null, 101], ['abwesenheit', 'unbekannt', 101],
    ['baustelle', 'bv:sr:1:x', 101], ['baustelle', 'bv:bg:1:x', 101], ['baustelle', 'bv:hr:1:x', 101], ['baustelle', 'bv:gw:1:x', 101], ['baustelle', 'bv:fm:1:x', 101],
    ['bericht', 'bericht:1:unterschrieben', 101],
    ['plan', 'plan:erinnerung:2026-11-12', 101], ['plan', 'plan:anfrage:1', 101], ['plan', 'plan:anfrage-erledigt:1', 1], ['plan', 'fuhre:pruefen:1', 101],
    ['plan', 'plan:2026-11-13:abc', 2], ['plan', 'plan:polier:1:abc', 1], ['plan', null, 2],
    ['sicherheit', 'konto:2:x', 101], ['sicherheit', 'rolle:2:x', 102], ['sicherheit', 'sicherung:2026-11-12:alter', 102], ['sicherheit', '2fa-code:101:x', 101], ['sicherheit', '2fa-reset:101:x', 101],
    ['fuhrpark', 'fp:woche:2026-46', 101], ['fuhrpark', 'fp:unplausibel:1', 101], ['fuhrpark', 'fp:gesperrt-genutzt:1:2', 101], ['fuhrpark', 'fp:1:z:faellig', 101], ['fuhrpark', 'fp:mangel:1', 101], ['fuhrpark', 'fp:zaehler:1:2026-46', 2],
    ['unbekannt', 'x', 101]
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bautag-m39-'));
  const datei = path.join(dir, 'alt.db');
  try {
    const alt = oeffneDatenbank(datei, { bisVersion: 29 });
    assert.ok(!alt.alle('PRAGMA table_info(benachrichtigung)').some((x) => x.name === 'erfordert'));
    for (const id of new Set(FAELLE.map((f) => f[2]))) alt.lauf("INSERT INTO benutzer (id, pnr, name, rolle, pin_hash, aktiv, erstellt) VALUES (?, ?, ?, 'buero', 'x', 1, '2026-01-01T00:00:00.000Z')", id, id, `B${id}`);
    FAELLE.forEach(([typ, schluessel, uid]) => alt.lauf("INSERT INTO benachrichtigung (benutzer_id, typ, titel, text, zeit, schluessel, push) VALUES (?, ?, 't', 'x', '2026-11-12T09:00:00.000Z', ?, 'alt')", uid, typ, schluessel));
    alt.schliessen();
    const db = oeffneDatenbank(datei);
    const zeilen = db.alle('SELECT * FROM benachrichtigung ORDER BY id');
    assert.equal(zeilen.length, FAELLE.length);
    for (const z of zeilen) {
      const erwartet = N.erfordertFuer({ typ: z.typ, schluessel: z.schluessel, benutzerId: z.benutzer_id });
      assert.deepEqual(JSON.parse(z.erfordert), erwartet, `${z.typ} ${z.schluessel} → ${z.erfordert}`);
    }
    // Stichproben der Regeln
    const e = (typ, schluessel, benutzerId = 101) => N.erfordertFuer({ typ, schluessel, benutzerId });
    assert.deepEqual(e('rechnung', 're:1:faellig'), ['preise_sehen']);
    assert.deepEqual(e('abwesenheit', 'abw:5:2026-11-12T09:24:00.000Z'), ['lohn|stammdaten']);
    assert.deepEqual(e('abwesenheit', 'abw:5:genehmigt:2026-11-12T09:24:00.000Z', 2), []);
    assert.deepEqual(e('azg', 'azg:26:x', 26), []);
    assert.deepEqual(e('azg', 'azg:26:x', 101), ['lohn']);
    db.schliessen();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('15.3 Sichtbarkeit: unlesbares erfordert ist nie sichtbar; empfaengerMitRecht folgt den Rechten', async (t) => {
  const s = await starte();
  t.after(() => s.stop());
  const R = require('../../server/rechte');
  const ctx = R.kontext(s.db, s.db.eins('SELECT * FROM benutzer WHERE id = ?', U.gf));
  assert.equal(N.darfSehen(ctx, { benutzer_id: U.gf, typ: 'plan', erfordert: '{kaputt' }), false);
  assert.equal(N.darfSehen(ctx, { benutzer_id: U.gf, typ: 'plan', erfordert: '["gibtsnicht"]' }), false);
  assert.equal(N.darfSehen(ctx, { benutzer_id: U.buero, typ: 'plan', erfordert: '[]' }), false); // fremde Zeile
  assert.equal(N.darfSehen(ctx, { benutzer_id: U.gf, typ: 'rechnung', erfordert: null }), true); // NULL → abgeleitet
  assert.throws(() => N.benachrichtige(s.db, { benutzerId: U.gf, typ: 'plan', titel: 't', text: 'x', zeit: ZEIT, schluessel: 'q', erfordert: ['quatsch'] }));
  const ids = (r) => N.empfaengerMitRecht(s.db, r).map((b) => b.id);
  assert.ok(ids('preise_sehen').includes(U.bauleiter) && ids('preise_sehen').includes(U.buero) && !ids('preise_sehen').includes(U.polier));
  assert.deepEqual(ids('benutzer'), s.db.alle("SELECT id FROM benutzer WHERE aktiv = 1 AND rolle = 'gf' ORDER BY id").map((x) => x.id));
  assert.ok(!N.empfaengerMitRecht(s.db, 'stammdaten|lohn', { ohne: U.buero }).some((b) => b.id === U.buero));
});
