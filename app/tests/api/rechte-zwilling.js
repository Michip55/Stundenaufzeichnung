'use strict';
/**
 * Zwilling für die Parität Büro = Bauleiter (API.md 15.4, 15.17): rechte-matrix-paritaet.test.js (API) und
 * tests/e2e/rechte-ui.js (Bedienelemente je Seite, H-T6).
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const H = require('./rechte-matrix-hilfe');
const { starte, BS } = require('./hilfe');

const Z = 900001;
const ZNAME = 'Zwilling Probe';

/**
 * Basis + Zwilling (eigene Datei je Seite): dieselbe Person 900001 „Zwilling“ mit denselben eigenen Daten (Urlaubsantrag,
 * Push-Abo, Benachrichtigung – in derselben Reihenfolge angelegt, daher dieselben IDs). Unterschied allein: die Rolle und
 * – nur auf der Bauleiter-Seite – `bauleiterId` von BS 1 (Pitten, Variante „eigen“) und BS 2 (auf der Büro-Seite bleibt
 * dort der Seed-Bauleiter 103).
 */
async function zwillingsBasis(basis, rolle) {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), `bautag-paritaet-${rolle}-`));
  const datei = path.join(ordner, 'basis.db');
  fs.copyFileSync(basis.datei, datei);
  const up = path.join(basis.ordner, 'uploads');
  if (fs.existsSync(up)) fs.cpSync(up, path.join(ordner, 'uploads'), { recursive: true });
  const s = await starte({ dbPath: datei, seed: false, test: true, testToken: H.TOKEN });
  let zw;
  try {
    const spalten = s.db.alle('PRAGMA table_info(benutzer)').map((x) => x.name).filter((n) => !['id', 'name', 'pnr', 'rolle'].includes(n));
    // gleiche Ausgangsdaten für beide Seiten: Vorlage ist immer das Seed-Büro 101 (PIN, Sitzung, Einstellungen)
    s.db.lauf(`INSERT INTO benutzer (id, name, pnr, rolle, ${spalten.join(', ')}) SELECT ?, ?, ?, ?, ${spalten.join(', ')} FROM benutzer WHERE id = ?`, Z, ZNAME, Z, rolle, H.ID.buero);
    s.db.lauf('UPDATE benutzer SET telefon = NULL, baustelle_id = NULL, standard_kostenstelle_id = NULL WHERE id = ?', Z);
    // 13.1: bauleiterId bestimmt nur Empfänger – auf der Bauleiter-Seite ist der Zwilling Bauleiter von Pitten und Kogler
    if (rolle === 'bauleiter') s.db.lauf('UPDATE baustelle SET bauleiter_id = ? WHERE id IN (?, ?)', Z, BS.pitten, BS.kogler);
    const c = await s.login(Z);
    const a = await c.post('/abwesenheiten/zeitraum', { benutzerId: Z, von: '2026-12-21', bis: '2026-12-21', code: 'U' });
    assert.equal(a.status, 201, `Urlaub Zwilling ${rolle}: ${JSON.stringify(a.daten)}`);
    assert.ok([200, 201].includes((await c.post('/push/abo', { endpoint: 'https://push.example.invalid/abo/zwilling', keys: { p256dh: 'BPx1-abc_DEF', auth: 'aBc-12_x' }, geraet: 'Gerät Zwilling' })).status));
    require('../../server/benachrichtigung').benachrichtige(s.db, { benutzerId: Z, typ: 'plan', titel: 'Zwilling', text: 'Probe für die Parität', zeit: s.uhr().toISOString(), schluessel: 'zwilling' });
    zw = {
      antrag: a.daten.antragId, tag: s.db.eins('SELECT id FROM abwesenheit WHERE benutzer_id = ? AND datum = ?', Z, '2026-12-21').id,
      push: s.db.eins('SELECT id FROM push_abo WHERE benutzer_id = ? ORDER BY id DESC', Z).id,
      benachrichtigung: s.db.eins('SELECT id FROM benachrichtigung WHERE benutzer_id = ? ORDER BY id DESC', Z).id
    };
    await c.post('/auth/logout', {});
    assert.equal(s.db.eins('SELECT COUNT(*) AS n FROM benutzer_recht WHERE benutzer_id = ?', Z).n, 0);
  } finally {
    await s.stop();
  }
  return { ordner, datei, F: basis.F, zw };
}

module.exports = { Z, ZNAME, zwillingsBasis };
