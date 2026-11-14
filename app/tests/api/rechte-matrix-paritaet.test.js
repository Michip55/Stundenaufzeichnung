'use strict';
/**
 * API.md 15.4 – Parität Büro = Bauleiter bei JEDER Matrix (Befunde F-008, F-012, F-016, F-017, F-019, F-020, F-021, F-035).
 *
 * 13.1: „Bauleiter = Büro in allem“; `bauleiterId` einer Baustelle bestimmt nur Empfänger, nie Rechte. Eine Änderung der
 * GF an der Rechte-Matrix wirkt sofort und für jeden Inhaber des Rechts gleich.
 *
 * Aufbau: zwei DB-Kopien der Basis von rechte-matrix-hilfe.erstelleBasis mit demselben „Zwilling“ 900001 (gleiche eigene
 * Daten: Urlaubsantrag, Push-Abo, Benachrichtigung; keine Ausnahmen) – einmal mit Rolle `buero`, einmal mit Rolle
 * `bauleiter` und als `bauleiterId` von BS 1 (Pitten = Variante „eigen“) und BS 2. BS 3 (Reisinger) ist „fremd“.
 *
 * Je Matrix-Zustand (Standard; ohne stammdaten | lohn | stammdaten+lohn | preise_bearbeiten | kalk_sehen | preise_sehen |
 * alle fünf – jeweils für Büro UND Bauleiter über PUT /rechte/matrix; danach alles wieder erteilt):
 *  - Lesen: jede GET-Route der Matrix × Variante – Status und Inhalt (JSON, CSV, PDF-Text, XLSX) identisch, nachdem die
 *    eigene ID, der eigene Name und die eigene Rolle neutralisiert wurden. Büro und Bauleiter laufen auf je einer eigenen,
 *    identischen DB-Kopie mit derselben Anfragefolge.
 *  - Schreiben: jede schreibende Route der Matrix × Variante nacheinander auf je einer frischen Kopie – Status und
 *    (neutralisierte) Antwort identisch.
 * Ausgenommen: `spezial`-Routen (Anmeldung, Fernunterschrift), Test-Schnittstellen und die eigene Konto-Pflege unter
 * /auth und /zwei-faktor (beendet bzw. verändert die eigene Sitzung; rollenunabhängig, eigene Tests).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const H = require('./rechte-matrix-hilfe');
const { erwartung, brauchtVarianten, anfrage } = require('./rechte-matrix-proben');
const { starte, BS } = require('./hilfe');

const MATRIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'rechte-matrix.json'), 'utf8')).routen;
const Z = 900001;
const ZNAME = 'Zwilling Probe';
const RECHTE = ['stammdaten', 'lohn', 'preise_bearbeiten', 'kalk_sehen', 'preise_sehen'];
const ZUSTAENDE = [
  { name: 'Standard', ohne: [] },
  ...RECHTE.map((r) => ({ name: `ohne ${r}`, ohne: [r] })),
  { name: 'ohne stammdaten+lohn', ohne: ['stammdaten', 'lohn'] },
  { name: 'ohne alle fünf', ohne: RECHTE }
];
const AUSGENOMMEN = (k, e) => e.spezial || erwartung(e, 'buero') === 'T' || /^\w+ \/api\/(auth|zwei-faktor)\//.test(k) || /^\w+ \/api\/zwei-faktor$/.test(k);

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

/** Platzhalter des Zwillings: eigene Objekte statt der des Seed-Büros (fremd bleibt fremd) */
const ueberFuer = (zb) => (variante) => (variante === 'fremd' ? {} : {
  ichOderAnderer: Z, abwEigen: zb.zw.tag, antragEigen: zb.zw.antrag, benachrichtigung: zb.zw.benachrichtigung, pushAbo: zb.zw.push
});

/** Antwort vergleichbar machen: eigene Rolle, bauleiterId der Baustellen und Zufallswerte neutralisieren */
async function neutral(r) {
  // Zufallswerte: Antrags-IDs, Link-Token, Port des jeweiligen Testservers, zufällige Schlüssel (z. B. Lohn-Vorlagen)
  const text = (s) => s.replace(/\ba[0-9a-f]{12}\b/g, '<ANTRAG>').replace(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g, '<TOKEN>').replace(/http:\/\/127\.0\.0\.1:\d+/g, '<HOST>');
  const lauf = (w) => {
    if (Array.isArray(w)) return w.map(lauf);
    if (w && typeof w === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(w)) {
        if (/^bauleiter_?[iI]d$/.test(k) && [Z, H.ID.bauleiter].includes(x)) o[k] = '<BAULEITER>'; // Routing-Daten, verschieden gewollt
        else if (k === 'id' && typeof x === 'string' && /^[a-z0-9]{10,16}$/.test(x)) o[k] = '<ZUFALL>';
        else o[k] = lauf(x);
      }
      if ((o.id === Z || o.benutzerId === Z) && typeof o.rolle === 'string') o.rolle = '<ROLLE>';
      return o;
    }
    if (typeof w === 'string') return text(w);
    return w;
  };
  if (Buffer.isBuffer(r.daten)) return { status: r.status, text: text(await H.antwortText(r, { ohneKopf: true })) };
  return { status: r.status, daten: lauf(r.daten) };
}

/** Matrix-Zustand auf einem Server setzen (als GF über die offizielle API), beide Zeilen identisch */
async function setzeZustand(gf, ohne) {
  for (const rolle of ['buero', 'bauleiter']) for (const recht of RECHTE) {
    const r = await gf.put('/rechte/matrix', { rolle, recht, wert: !ohne.includes(recht) });
    assert.equal(r.status, 200, `Matrix ${rolle}.${recht}: ${r.status}`);
  }
}

const kurz = (x) => JSON.stringify(x).slice(0, 400);

test('15.4 Parität: Büro und Bauleiter (auch als bauleiterId) erhalten bei jeder Matrix dieselben Antworten', { timeout: 30 * 60 * 1000 }, async (t) => {
  const basis = await H.erstelleBasis();
  t.after(() => fs.rmSync(basis.ordner, { recursive: true, force: true }));
  const zb = { buero: await zwillingsBasis(basis, 'buero'), bauleiter: await zwillingsBasis(basis, 'bauleiter') };
  t.after(() => { for (const x of Object.values(zb)) fs.rmSync(x.ordner, { recursive: true, force: true }); });
  assert.deepEqual({ ...zb.bauleiter.zw, antrag: 0 }, { ...zb.buero.zw, antrag: 0 }, 'Ausgangsdaten der Zwillinge verschieden (antragId ist zufällig)');
  const F = basis.F;
  const lesen = Object.entries(MATRIX).filter(([k, e]) => k.startsWith('GET ') && !AUSGENOMMEN(k, e));
  const schreiben = Object.entries(MATRIX).filter(([k, e]) => !k.startsWith('GET ') && !AUSGENOMMEN(k, e));
  assert.ok(lesen.length > 90 && schreiben.length > 150, `zu wenige Routen (${lesen.length}/${schreiben.length}) – Matrix defekt?`);

  /** Server je Zwilling auf einer eigenen Kopie */
  const paar = async () => {
    const out = {};
    for (const rolle of ['buero', 'bauleiter']) {
      const s = await H.starteKopie(zb[rolle]);
      out[rolle] = { s, ich: await s.login(Z), gf: await s.login(H.ID.gf) };
    }
    return out;
  };
  /** Statistik je Zustand: erlaubt (2xx) / verweigert (403) – Selbsttest gegen eine wirkungslose Prüfung */
  const zaehle = (st, name, status) => { st[name] = st[name] || { ok: 0, nein: 0 }; if (status < 300) st[name].ok++; else if (status === 403) st[name].nein++; };
  const pruefeWirkung = (st, art, t) => {
    assert.ok(st.Standard.ok > (art === 'lesen' ? 80 : 100), `${art}: nur ${st.Standard.ok} erlaubte Proben im Standard – Prüfung wirkungslos?`);
    // preise_bearbeiten ist ein reines Schreibrecht – beim Lesen ändert sein Entzug nichts
    for (const z of ZUSTAENDE.slice(1).filter((x) => art !== 'lesen' || x.name !== 'ohne preise_bearbeiten')) assert.ok(st[z.name].nein > st.Standard.nein, `${art}: Entzug „${z.name}“ ändert nichts (${st[z.name].nein} ≤ ${st.Standard.nein} Ablehnungen)`);
    t.diagnostic(`${art}: ${Object.entries(st).map(([n, x]) => `${n} ${x.ok} erlaubt/${x.nein} abgelehnt`).join('; ')}`);
    if (st['wieder erteilt']) assert.deepEqual(st['wieder erteilt'], st.Standard, `${art}: nach dem Wiedererteilen nicht wie Standard`);
  };
  const probe = async (seite, rolle, k, e, variante) => {
    const a = anfrage(k, e, F, 'buero', variante, ueberFuer(zb[rolle]));
    let r = await seite.ich.anfrage(a.methode, a.pfad, a.methode === 'GET' ? undefined : (a.body === undefined ? {} : a.body));
    if (r.status === 401) { seite.ich = await seite.s.login(Z); r = await seite.ich.anfrage(a.methode, a.pfad, a.methode === 'GET' ? undefined : (a.body === undefined ? {} : a.body)); }
    return { a, n: await neutral(r) };
  };

  // ---------- Lesen: ein Serverpaar für alle Zustände (danach „wieder erteilt“ = Wirkung sofort zurück)
  await t.test('Lesen: jede GET-Route × Variante × Matrix-Zustand', async (tt) => {
    const v = [];
    const st = {};
    const p = await paar();
    try {
      for (const z of [...ZUSTAENDE, { name: 'wieder erteilt', ohne: [] }]) {
        for (const rolle of ['buero', 'bauleiter']) await setzeZustand(p[rolle].gf, z.ohne);
        const ich = await Promise.all(['buero', 'bauleiter'].map(async (r) => (await p[r].ich.get('/auth/ich')).daten.rechte.slice().sort()));
        assert.deepEqual(ich[1], ich[0], `${z.name}: effektive Rechte verschieden`);
        for (const [k, e] of lesen) {
          for (const variante of brauchtVarianten(e) ? ['eigen', 'fremd'] : ['ohne']) {
            const b = await probe(p.buero, 'buero', k, e, variante);
            const bl = await probe(p.bauleiter, 'bauleiter', k, e, variante);
            zaehle(st, z.name, b.n.status);
            try { assert.deepEqual(bl.n, b.n); } catch (_) {
              v.push(`[${z.name}] ${k} [${variante}] ${b.a.pfad}: Bauleiter ${bl.n.status} ${kurz(bl.n.daten ?? bl.n.text)}\n      ≠ Büro ${b.n.status} ${kurz(b.n.daten ?? b.n.text)}`);
            }
          }
        }
      }
    } finally {
      for (const r of ['buero', 'bauleiter']) await p[r].s.stop();
    }
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
    pruefeWirkung(st, 'lesen', tt);
  });

  // ---------- Schreiben: je Zustand ein frisches Serverpaar, dieselbe Folge von Schreibproben
  await t.test('Schreiben: jede schreibende Route × Variante × Matrix-Zustand', async (tt) => {
    const v = [];
    const st = {};
    for (const z of ZUSTAENDE) {
      const p = await paar();
      try {
        for (const rolle of ['buero', 'bauleiter']) await setzeZustand(p[rolle].gf, z.ohne);
        for (const [k, e] of schreiben) {
          for (const variante of brauchtVarianten(e) ? ['eigen', 'fremd'] : ['ohne']) {
            const b = await probe(p.buero, 'buero', k, e, variante);
            const bl = await probe(p.bauleiter, 'bauleiter', k, e, variante);
            zaehle(st, z.name, b.n.status);
            try { assert.deepEqual(bl.n, b.n); } catch (_) {
              v.push(`[${z.name}] ${k} [${variante}] ${b.a.pfad}: Bauleiter ${bl.n.status} ${kurz(bl.n.daten ?? bl.n.text)}\n      ≠ Büro ${b.n.status} ${kurz(b.n.daten ?? b.n.text)}`);
            }
          }
        }
      } finally {
        for (const r of ['buero', 'bauleiter']) await p[r].s.stop();
      }
    }
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
    pruefeWirkung(st, 'schreiben', tt);
  });
});
