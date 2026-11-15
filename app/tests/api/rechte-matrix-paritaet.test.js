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
 *  - Lesen: jede GET-Route der Matrix × Variante × Query-/Pfad-Variante (G2-012: `varianten` wie in rechte-matrix.test.js)
 *    – Status, Kopfzeilen (G2-012: Content-Disposition, Content-Type, Location, X-…) und Inhalt (JSON, CSV, PDF-Text, XLSX) identisch, nachdem die
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
const H = require('./rechte-matrix-hilfe');
const { erwartung, brauchtVarianten, anfrage, leseProben, platzhalter, ersetze } = require('./rechte-matrix-proben');
const { erfolgsAnfrage } = require('./rechte-matrix-schreiben');

const MATRIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'rechte-matrix.json'), 'utf8')).routen;
// Zwilling 900001 (gleiche eigene Daten, nur Rolle/bauleiterId verschieden) – gemeinsam mit tests/e2e/rechte-ui.js (15.17)
const { Z, zwillingsBasis } = require('./rechte-zwilling');
const RECHTE = ['stammdaten', 'lohn', 'preise_bearbeiten', 'kalk_sehen', 'preise_sehen'];
const ZUSTAENDE = [
  { name: 'Standard', ohne: [] },
  ...RECHTE.map((r) => ({ name: `ohne ${r}`, ohne: [r] })),
  { name: 'ohne stammdaten+lohn', ohne: ['stammdaten', 'lohn'] },
  { name: 'ohne alle fünf', ohne: RECHTE }
];
const AUSGENOMMEN = (k, e) => e.spezial || erwartung(e, 'buero') === 'T' || /^\w+ \/api\/(auth|zwei-faktor)\//.test(k) || /^\w+ \/api\/zwei-faktor$/.test(k);

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
  // G2-012: Kopfzeilen gehören zur Antwort (Dateiname, Typ, Weiterleitung, X-…) – ohne reine Protokollköpfe (H.kopfText)
  const kopf = text(H.kopfText(r.headers)).split('\n').filter((z) => !/^(x-response-time|last-modified|age|vary|keep-alive):/i.test(z)).sort().join('\n');
  if (Buffer.isBuffer(r.daten)) return { status: r.status, kopf, text: text(await H.antwortText(r, { ohneKopf: true })) };
  return { status: r.status, kopf, daten: lauf(r.daten) };
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
  const probe = async (seite, rolle, k, e, variante, a0) => {
    const a = a0 || anfrage(k, e, F, 'buero', variante, ueberFuer(zb[rolle]));
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
            // G2-012: Hauptprobe UND jede Query-/Pfad-Variante der Matrix (gleiche Anfrage für beide Seiten)
            const pb = leseProben(k, e, F, 'buero', variante, ueberFuer(zb.buero)).map((x) => x.a);
            const pbl = leseProben(k, e, F, 'buero', variante, ueberFuer(zb.bauleiter)).map((x) => x.a);
            for (let i = 0; i < pb.length; i++) {
              const b = await probe(p.buero, 'buero', k, e, variante, pb[i]);
              const bl = await probe(p.bauleiter, 'bauleiter', k, e, variante, pbl[i]);
              if (i === 0) zaehle(st, z.name, b.n.status);
              try { assert.deepEqual(bl.n, b.n); } catch (_) {
                v.push(`[${z.name}] ${k} [${variante}${i ? `, Variante ${i}` : ''}] ${b.a.pfad}: Bauleiter ${bl.n.status} ${bl.n.kopf === b.n.kopf ? '' : `[Kopf ${kurz(bl.n.kopf)}] `}${kurz(bl.n.daten ?? bl.n.text)}\n      ≠ Büro ${b.n.status} ${bl.n.kopf === b.n.kopf ? '' : `[Kopf ${kurz(b.n.kopf)}] `}${kurz(b.n.daten ?? b.n.text)}`);
              }
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

  // ---------- 15.17 (H-T3): versionierte Schreibrouten mit AKTUELLER version. Mit der veralteten version der Matrix endet
  // die Probe beim 409 vor jeder weiteren Prüfung – eine Rollenprüfung DANACH bliebe unsichtbar. Darum: Erfolgs-Body der
  // Matrix (rechte-matrix-schreiben.erfolgsAnfrage), die version aus der Ressource bzw. – wie ein Client nach „Bitte neu
  // laden“ – aus der 409-Antwort; im Standard müssen Büro und Bauleiter damit GELINGEN (2xx). Dazu im Standard jedes Feld
  // der zurückgegebenen Ressource einzeln mit ihrem eigenen Wert (z. B. bauleiterId, polierId, phase), damit auch
  // Rollenprüfungen an einzelnen Feldern sichtbar werden. Je Seite dieselbe Folge, verglichen wie oben (neutralisiert).
  const versioniert = schreiben.filter(([, e]) => /"version"/.test(JSON.stringify([e.body || null, e.erfolg || null])));
  /** version aus der Ressource (als GF): versionVon bzw. Pfad, sonst die übergeordneten Pfade (Objekt mit derselben id) */
  const versionAus = async (gf, quelle, id) => {
    let q = quelle;
    const suche = (x) => { if (Array.isArray(x)) { for (const y of x) { const f = suche(y); if (f !== undefined) return f; } } else if (x && typeof x === 'object') { if (x.id === id && Number.isInteger(x.version)) return x.version; for (const y of Object.values(x)) { const f = suche(y); if (f !== undefined) return f; } } return undefined; };
    while (q && q.includes('/')) {
      const g = await gf.get(q);
      if (g.status === 200 && g.daten && typeof g.daten === 'object') {
        if (q === quelle && Number.isInteger(g.daten.version)) return g.daten.version;
        const f = id === undefined ? undefined : suche(g.daten);
        if (f !== undefined) return f;
        if (Number.isInteger(g.daten.version) && id === undefined) return g.daten.version;
      }
      q = q.replace(/\/[^/]*$/, '');
    }
    return undefined;
  };
  /** Anfrage senden; 409 mit aktueller version → einmal mit dieser version wiederholen (wie ein Client nach dem Neuladen) */
  const sende = async (seite, a) => {
    const los = async (body) => {
      let r = await seite.ich.anfrage(a.methode, a.pfad, body === undefined ? {} : body);
      if (r.status === 401) { seite.ich = await seite.s.login(Z); r = await seite.ich.anfrage(a.methode, a.pfad, body === undefined ? {} : body); }
      return r;
    };
    let r = await los(a.body);
    if (r.status === 409 && r.daten && Number.isInteger(r.daten.version) && a.body && typeof a.body === 'object' && 'version' in a.body && a.body.version !== r.daten.version) r = await los({ ...a.body, version: r.daten.version });
    return { roh: r, n: await neutral(r) };
  };
  /** Erfolgs-Probe auf DIESER Seite: Body aus `erfolg` (ohne Vorbereitung, wenn diese schon erledigt ist), version aktuell */
  const erfolgsProbe = async (seite, rolle, k, e, variante) => {
    const P = platzhalter(F, 'buero', variante, ueberFuer(zb[rolle])(variante));
    let a;
    try { a = await erfolgsAnfrage({ als: (r) => (r === 'gf' ? seite.gf : seite.ich) }, k, e, F, 'buero', variante); } catch (x) {
      // Vorbereitung schon erledigt (z. B. die Unterschrift aus der Probe davor): dieselbe Route ohne Vorbereitung
      a = anfrage(k, e, F, 'buero', variante, ueberFuer(zb[rolle]));
      if (e.erfolg && e.erfolg.body) a.body = ersetze(e.erfolg.body, { ...P, version: 0 });
    }
    const body = a.body && typeof a.body === 'object' && !Array.isArray(a.body) ? { ...a.body } : a.body;
    // gleiche Unterschrift darf nicht zweimal verwendet werden: je Variante ein eigenes Bild (beide Seiten gleich)
    if (body && typeof body.bildPng === 'string' && variante === 'fremd') body.bildPng = require('../../server/png').demoUnterschrift('Probe Unterschrift fremd');
    if (body && typeof body === 'object' && 'version' in body) {
      const quelle = (e.erfolg && e.erfolg.versionVon ? ersetze(e.erfolg.versionVon, P) : `/api${a.pfad}`).replace(/^\/api/, '');
      const id = Number((/\/(\d+)$/.exec(quelle) || [])[1]) || undefined;
      const ver = await versionAus(seite.gf, quelle, id);
      if (ver !== undefined) body.version = ver;
    }
    return { ...a, body };
  };
  await t.test('15.17 (H-T3): versionierte Schreibrouten mit aktueller version und Erfolgs-Body, im Standard jedes Feld einzeln', async (tt) => {
    const v = [];
    const st3 = {};
    assert.ok(versioniert.length >= 17, `nur ${versioniert.length} versionierte Schreibrouten – Auswahl defekt?`);
    let felder = 0;
    for (const z of ZUSTAENDE) {
      const p = await paar();
      try {
        for (const rolle of ['buero', 'bauleiter']) await setzeZustand(p[rolle].gf, z.ohne);
        for (const [k, e] of versioniert) {
          for (const variante of brauchtVarianten(e) ? ['eigen', 'fremd'] : ['ohne']) {
            const a = { buero: await erfolgsProbe(p.buero, 'buero', k, e, variante), bauleiter: await erfolgsProbe(p.bauleiter, 'bauleiter', k, e, variante) };
            const b = await sende(p.buero, a.buero);
            const bl = await sende(p.bauleiter, a.bauleiter);
            zaehle(st3, z.name, b.n.status);
            if (z.name === 'Standard' && !(b.n.status >= 200 && b.n.status < 300)) v.push(`[${z.name}] ${k} [${variante}] ${a.buero.pfad}: Büro mit aktueller version → ${b.n.status} ${kurz(b.n.daten ?? b.n.text)} (Probe endet vor der Rechteprüfung)`);
            try { assert.deepEqual(bl.n, b.n); } catch (_) { v.push(`[${z.name}] ${k} [${variante}] ${a.buero.pfad} (aktuelle version): Bauleiter ${bl.n.status} ${kurz(bl.n.daten ?? bl.n.text)}\n      ≠ Büro ${b.n.status} ${kurz(b.n.daten ?? b.n.text)}`); }
            // jedes Feld der zurückgegebenen Ressource einzeln, mit dem eigenen Wert der jeweiligen Seite
            if (z.name !== 'Standard' || !/^PUT /.test(k) || b.n.status >= 300) continue;
            const stand = { buero: b.roh.daten, bauleiter: bl.roh.daten };
            if (!stand.buero || typeof stand.buero !== 'object' || !Number.isInteger(stand.buero.version)) { v.push(`[${z.name}] ${k} [${variante}]: Antwort ohne Ressource/version – Einzelfeld-Probe nicht möglich`); continue; }
            for (const f of Object.keys(stand.buero).filter((x) => !['id', 'version'].includes(x) && (stand.buero[x] === null || ['string', 'number', 'boolean'].includes(typeof stand.buero[x])))) {
              const r = {};
              for (const rolle of ['buero', 'bauleiter']) {
                const alt = stand[rolle] && typeof stand[rolle] === 'object' ? stand[rolle] : {};
                r[rolle] = await sende(p[rolle], { methode: a[rolle].methode, pfad: a[rolle].pfad, body: { version: alt.version, [f]: alt[f] } });
                if (r[rolle].roh.daten && Number.isInteger(r[rolle].roh.daten.version)) stand[rolle] = { ...alt, version: r[rolle].roh.daten.version };
              }
              felder++;
              try { assert.deepEqual(r.bauleiter.n, r.buero.n); } catch (_) { v.push(`[${z.name}] ${k} [${variante}] ${a.buero.pfad} Feld „${f}“: Bauleiter ${r.bauleiter.n.status} ${kurz(r.bauleiter.n.daten ?? r.bauleiter.n.text)}\n      ≠ Büro ${r.buero.n.status} ${kurz(r.buero.n.daten ?? r.buero.n.text)}`); }
            }
          }
        }
      } finally {
        for (const r of ['buero', 'bauleiter']) await p[r].s.stop();
      }
    }
    tt.diagnostic(`versionierte Schreibrouten: ${versioniert.length}, Einzelfeld-Proben ${felder}; ${Object.entries(st3).map(([n, x]) => `${n} ${x.ok} erlaubt/${x.nein} abgelehnt`).join('; ')}`);
    assert.deepEqual(v, [], `\n${v.join('\n')}`);
    assert.ok(felder >= 100, `nur ${felder} Einzelfeld-Proben – Prüfung wirkungslos?`);
    // Entzug wirkt auch hier (sonst endete die Probe weiterhin vor der Rechteprüfung)
    for (const z of ZUSTAENDE.slice(1)) assert.ok(st3[z.name].nein >= st3.Standard.nein, `Entzug „${z.name}“: weniger Ablehnungen als im Standard`);
    assert.ok(st3['ohne alle fünf'].nein > st3.Standard.nein, 'Entzug aller fünf Rechte ändert bei den versionierten Routen nichts – Prüfung wirkungslos?');
  });
});
