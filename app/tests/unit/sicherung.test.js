'use strict';
/** Datensicherung (API.md 12.1): konsistente Kopie, Rotation, Prüfung, Status; deploy/backup.sh mit Attrappen */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const S = require('../../server/sicherung');
const { oeffneDatenbank } = require('../../server/db');

const SERVER = path.join(__dirname, '..', '..', 'server');
const DEPLOY = path.join(__dirname, '..', '..', '..', 'deploy');

function tempOrdner(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bautag-sich-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
function testDb(ordner) {
  const datei = path.join(ordner, 'daten', 'bautag.db');
  const db = oeffneDatenbank(datei);
  db.lauf("INSERT INTO benutzer (name, rolle, pin_hash, erstellt) VALUES ('GF Test', 'gf', 'x', '2026-01-01')");
  return { datei, db };
}

test('Rotation: 14 tägliche, 8 wöchentliche, 12 monatliche Stände', () => {
  const tage = [];
  for (let i = 0; i < 400; i++) tage.push(new Date(Date.UTC(2026, 10, 13) - i * 864e5).toISOString().slice(0, 10));
  const b = S.behalten(tage);
  const sortiert = [...b].sort().reverse();
  assert.ok(tage.slice(0, 14).every((t) => b.has(t)), 'die letzten 14 Tage');
  // höchstens 14 + 8 + 12 Stände, mindestens 12 verschiedene Monate
  assert.ok(b.size <= 34, String(b.size));
  assert.equal(new Set(sortiert.map((t) => t.slice(0, 7))).size, 12);
  assert.equal(sortiert[sortiert.length - 1], '2025-12-31', 'Monatsstände reichen 12 Monate zurück');
  // Wochen: 8 verschiedene ISO-Wochen innerhalb der ersten ~8 Wochen
  assert.ok(sortiert.filter((t) => t >= '2026-09-18').length >= 14 + 6);
});

test('sichern: konsistente Kopie bei laufendem Schreiben, Fotos, Prüfung, Rotation', async (t) => {
  const o = tempOrdner(t);
  const { datei, db } = testDb(o);
  // laufende Schreiblast (WAL) während der Sicherung
  for (let i = 0; i < 200; i++) db.lauf("INSERT INTO protokoll (zeit, art, text) VALUES ('2026-11-13T00:00:00Z', 'test', ?)", `Zeile ${i}`);
  const uploads = path.join(o, 'daten', 'uploads');
  fs.mkdirSync(path.join(uploads, 'schaeden'), { recursive: true });
  fs.writeFileSync(path.join(uploads, 'schaeden', 'a.jpg'), 'bild');
  const ziel = path.join(o, 'sicherung');
  // alte Stände, die wegrotiert werden
  fs.mkdirSync(ziel);
  for (let i = 1; i <= 20; i++) fs.writeFileSync(path.join(ziel, `bautag-2026-10-${String(i).padStart(2, '0')}.db`), 'alt');
  const r = await S.sichern(datei, ziel, { uploads, jetzt: new Date('2026-11-13T01:30:00Z') });
  db.lauf("INSERT INTO protokoll (zeit, art, text) VALUES ('2026-11-13T00:00:00Z', 'test', 'danach')");
  assert.equal(path.basename(r.datei), 'bautag-2026-11-13.db');
  assert.equal((fs.statSync(r.datei).mode & 0o777).toString(8), '600');
  const p = S.pruefen(r.datei);
  assert.equal(p.ok, true);
  assert.equal(p.integritaet, 'ok');
  assert.equal(p.tabellen.benutzer, 1);
  assert.equal(p.tabellen.protokoll, db.eins('SELECT COUNT(*) AS n FROM protokoll').n - 1); // Stand zum Sicherungszeitpunkt
  const liste = spawnSync('tar', ['-tzf', r.uploads], { encoding: 'utf8' }).stdout;
  assert.match(liste, /uploads\/schaeden\/a\.jpg/);
  // 14 tägliche: 13.11. + 13 alte; die ältesten Oktobertage fallen weg, der jüngste Oktoberstand bleibt (Monat)
  assert.ok(r.geloescht.includes('bautag-2026-10-01.db'));
  assert.ok(!r.geloescht.includes('bautag-2026-10-20.db'));
  db.schliessen();
});

test('pruefen: kaputte oder fremde Datei → ok:false', (t) => {
  const o = tempOrdner(t);
  const kaputt = path.join(o, 'bautag-2026-11-13.db');
  fs.writeFileSync(kaputt, Buffer.alloc(8192, 7));
  assert.equal(S.pruefen(kaputt).ok, false);
  assert.equal(S.pruefen(path.join(o, 'fehlt.db')).ok, false);
});

test('statusMelden: lokal/offsite/test mit letzteOk', (t) => {
  const o = tempOrdner(t);
  const { datei, db } = testDb(o);
  db.schliessen();
  S.statusMelden(datei, 'lokal', true, 'bautag-2026-11-13.db', new Date('2026-11-13T01:30:00Z'));
  const s = S.statusMelden(datei, 'lokal', false, 'Platte voll', new Date('2026-11-14T01:30:00Z'));
  assert.deepEqual(s.lokal, { zeit: '2026-11-14T01:30:00.000Z', ok: false, text: 'Platte voll', letzteOk: '2026-11-13T01:30:00.000Z' });
  assert.throws(() => S.statusMelden(datei, 'irgendwas', true), /Art/);
});

test('deploy/backup.sh mit Attrappen: lokal + restic + Wiederherstellungstest, Status in der DB', (t) => {
  const o = tempOrdner(t);
  const { datei, db } = testDb(o);
  db.schliessen();
  const ziel = path.join(o, 'sicherung');
  const bin = path.join(o, 'bin');
  fs.mkdirSync(bin);
  const aufrufe = path.join(o, 'restic-aufrufe.txt');
  // restic-Attrappe: protokolliert Aufrufe; „restore“ kopiert den lokalen Ordner in das Ziel
  fs.writeFileSync(path.join(bin, 'restic'), `#!/bin/bash
echo "$@" >> "${aufrufe}"
if [[ "$1" == restore ]]; then
  while [[ $# -gt 0 ]]; do [[ "$1" == --target ]] && T="$2"; shift; done
  mkdir -p "$T${ziel}" && cp -a "${ziel}/." "$T${ziel}/"
fi
[[ "$1" == backup ]] && echo "snapshot 1a2b3c4d saved"
exit 0
`, { mode: 0o755 });
  const resticEnv = path.join(o, 'restic.env');
  fs.writeFileSync(resticEnv, `RESTIC_REPOSITORY=sftp:test@example.invalid:/bautag\nRESTIC_PASSWORD_FILE=${o}/pw\n`);
  const env = {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, BAUTAG_DB: datei, BAUTAG_LOG: path.join(o, 'log.txt'),
    BAUTAG_SICHERUNG: ziel, BAUTAG_SICHERUNG_APP: ziel, BAUTAG_UPLOADS_APP: path.join(o, 'daten', 'uploads'),
    BAUTAG_RESTIC_ENV: resticEnv, BAUTAG_SICHERUNG_CMD: `node ${SERVER}/sicherung.js`, BAUTAG_PRUEF_CMD: `node ${SERVER}/sicherung.js pruefen`,
    BAUTAG_TEST_IMMER: '1', NODE_OPTIONS: '--disable-warning=ExperimentalWarning'
  };
  const r = spawnSync('bash', [path.join(DEPLOY, 'backup.sh')], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout + fs.readFileSync(path.join(o, 'log.txt'), 'utf8'));
  const st = JSON.parse(spawnSync('node', [`${SERVER}/sicherung.js`, 'anzeigen'], { env, encoding: 'utf8' }).stdout).sicherung;
  assert.equal(st.lokal.ok, true);
  assert.equal(st.offsite.ok, true);
  assert.match(st.offsite.text, /snapshot 1a2b3c4d saved/);
  assert.equal(st.test.ok, true);
  assert.match(st.test.text, /extern \(restic\), bautag-\d{4}-\d{2}-\d{2}\.db/);
  const a = fs.readFileSync(aufrufe, 'utf8');
  assert.match(a, /^backup .*sicherung --tag bautag/m);
  assert.match(a, /^forget --tag bautag --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune/m);
  assert.match(a, /^restore latest --tag bautag --target /m);

  // restic schlägt fehl → Status offsite fehler, Exit-Code 1
  fs.writeFileSync(path.join(bin, 'restic'), '#!/bin/bash\necho "Fatal: repository does not exist" >&2\nexit 1\n', { mode: 0o755 });
  const r2 = spawnSync('bash', [path.join(DEPLOY, 'backup.sh')], { env: { ...env, BAUTAG_TEST_IMMER: '' }, encoding: 'utf8' });
  assert.equal(r2.status, 1);
  const st2 = JSON.parse(spawnSync('node', [`${SERVER}/sicherung.js`, 'anzeigen'], { env, encoding: 'utf8' }).stdout).sicherung;
  assert.equal(st2.offsite.ok, false);
  assert.match(st2.offsite.text, /repository does not exist/);
  assert.equal(st2.offsite.letzteOk, st.offsite.letzteOk);

  // Wiederherstellungstest mit kaputter Sicherung → fehler
  for (const f of fs.readdirSync(ziel)) if (f.endsWith('.db')) fs.writeFileSync(path.join(ziel, f), Buffer.alloc(4096, 1));
  const r3 = spawnSync('bash', [path.join(DEPLOY, 'backup.sh'), '--test'], { env: { ...env, BAUTAG_RESTIC_ENV: path.join(o, 'fehlt.env') }, encoding: 'utf8' });
  assert.equal(r3.status, 1);
  const st3 = JSON.parse(spawnSync('node', [`${SERVER}/sicherung.js`, 'anzeigen'], { env, encoding: 'utf8' }).stdout).sicherung;
  assert.equal(st3.test.ok, false);
  assert.match(st3.test.text, /lokal/);
});

test('Shell-Skripte: Syntax (bash -n)', () => {
  for (const f of fs.readdirSync(DEPLOY).filter((x) => x.endsWith('.sh'))) {
    const r = spawnSync('bash', ['-n', path.join(DEPLOY, f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});
