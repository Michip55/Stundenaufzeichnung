'use strict';
/**
 * Nachprüfung – Bereich „betrieb“ (API.md 14.5): N-011 (Fotos als Spiegel statt täglichem Vollarchiv, Füllstand,
 * Wiederherstellungstest nur mit Datenbanken), N-030/N-031 (update.sh), N-046 (Abhängigkeiten vor der Migration),
 * N-065 (Größentabelle), N-066 (Caddy-Fehlerprotokoll ohne Token), N-067 (cron-PATH für sendmail),
 * N-068 (Anzeige in wiederherstellen.sh). Die Shell-Skripte laufen mit Attrappen für docker/restic.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const APP = path.join(__dirname, '..', '..');
const SERVER = path.join(APP, 'server');
const DEPLOY = path.join(APP, '..', 'deploy');
const REPO = path.join(APP, '..');
const S = require('../../server/sicherung');
const { oeffneDatenbank } = require('../../server/db');
const lies = (f) => fs.readFileSync(path.join(DEPLOY, f), 'utf8');
const istRoot = !process.getuid || process.getuid() === 0;

function tempOrdner(t, praefix = 'bautag-betrieb-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), praefix));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
function testDb(ordner) {
  const datei = path.join(ordner, 'daten', 'bautag.db');
  const db = oeffneDatenbank(datei);
  db.lauf("INSERT INTO benutzer (name, rolle, pin_hash, erstellt) VALUES ('GF Test', 'gf', 'x', '2026-01-01')");
  db.schliessen();
  return datei;
}
const tag = (i) => new Date(Date.UTC(2026, 0, 1, 1, 30) + i * 864e5);
const viel = { blocks: 1000 * 1024, bsize: 1024 ** 2, bavail: 900 * 1024 }; // 1000 GB, 10 % belegt

// ---------------------------------------------------------------- N-011

test('N-011: sichern legt Fotos als EINEN inkrementellen Spiegel ab – kein Archiv je Tag', async (t) => {
  const o = tempOrdner(t);
  const datei = testDb(o);
  const uploads = path.join(o, 'daten', 'uploads');
  fs.mkdirSync(path.join(uploads, 'berichte', '7'), { recursive: true });
  fs.writeFileSync(path.join(uploads, 'berichte', '7', 'a.jpg'), Buffer.alloc(200 * 1024, 1));
  fs.writeFileSync(path.join(uploads, 'berichte', '7', 'b.jpg'), Buffer.alloc(100 * 1024, 2));
  const ziel = path.join(o, 'sicherung');
  fs.mkdirSync(ziel);
  // ältere tägliche Vollarchive (früheres Format) werden durch den Spiegel ersetzt
  fs.writeFileSync(path.join(ziel, 'uploads-2025-12-30.tar.gz'), 'alt');
  fs.writeFileSync(path.join(ziel, 'uploads-2025-12-31.tar.gz'), 'alt');

  const r1 = await S.sichern(datei, ziel, { uploads, jetzt: tag(0), statfs: () => viel });
  assert.equal(r1.uploads, path.join(ziel, S.SPIEGEL));
  assert.deepEqual({ dateien: r1.spiegel.dateien, kopiert: r1.spiegel.kopiert }, { dateien: 2, kopiert: 2 });
  assert.ok(r1.geloescht.includes('uploads-2025-12-30.tar.gz') && r1.geloescht.includes('uploads-2025-12-31.tar.gz'));

  // zweiter Tag: unveränderte Datei wird nicht neu kopiert, gelöschte verschwindet aus dem Spiegel, neue kommt dazu
  fs.rmSync(path.join(uploads, 'berichte', '7', 'b.jpg'));
  fs.writeFileSync(path.join(uploads, 'berichte', '7', 'c.jpg'), 'neu');
  const r2 = await S.sichern(datei, ziel, { uploads, jetzt: tag(1), statfs: () => viel });
  assert.equal(r2.spiegel.kopiert, 1);
  assert.equal(r2.spiegel.entfernt, 1);
  assert.deepEqual(fs.readdirSync(path.join(ziel, S.SPIEGEL, 'berichte', '7')).sort(), ['a.jpg', 'c.jpg']);

  // viele Tage: Fotos belegen im Sicherungsordner nur einmal Platz (früher: bis zu 31 Vollkopien)
  for (let i = 2; i < 45; i++) await S.sichern(datei, ziel, { uploads, jetzt: tag(i), statfs: () => viel });
  const dateien = fs.readdirSync(ziel);
  assert.ok(!dateien.some((f) => /\.tar\.gz$/.test(f)), dateien.join(','));
  assert.deepEqual(dateien.filter((f) => !f.endsWith('.db')), [S.SPIEGEL]);
  const fotoBytes = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? fotoBytes(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
  assert.ok(fotoBytes(path.join(ziel, S.SPIEGEL)) <= fotoBytes(uploads));
  assert.ok(dateien.filter((f) => f.endsWith('.db')).length <= 34);
});

test('N-011: Füllstandswarnung → Status „lokal“ mit Warnung → Alarm in der App', async (t) => {
  const o = tempOrdner(t);
  const datei = testDb(o);
  const knapp = { blocks: 40 * 1024, bsize: 1024 ** 2, bavail: 2 * 1024 }; // 40 GB, 2 GB frei
  const p = S.platzPruefen(o, { statfs: () => knapp });
  assert.equal(p.belegtProzent, 95);
  assert.match(p.warnung, /Speicherplatz knapp: 95 % belegt/);
  assert.equal(S.platzPruefen(o, { statfs: () => viel }).warnung, null);
  const r = await S.sichern(datei, path.join(o, 'sicherung'), { jetzt: tag(0), statfs: () => knapp });
  assert.match(r.platz.warnung, /Speicherplatz knapp/);
  // CLI meldet die Warnung mit; die App-Überwachung macht daraus einen Alarm
  S.statusMelden(datei, 'lokal', true, 'bautag-2026-01-01.db', tag(0), { warnung: r.platz.warnung });
  const { sicherungsStatus } = require('../../server/sicherung-pruefung');
  const db = oeffneDatenbank(datei);
  t.after(() => db.schliessen());
  const st = sicherungsStatus({ db, sicherungPruefen: true, uhr: () => tag(0) }, tag(0));
  assert.ok(st.warnungen.some((w) => w.art === 'lokal' && /Speicherplatz knapp/.test(w.text)), JSON.stringify(st.warnungen));
  // nächste Sicherung ohne Warnung → Warnung verschwindet
  S.statusMelden(datei, 'lokal', true, 'bautag-2026-01-02.db', tag(0));
  assert.ok(!sicherungsStatus({ db, sicherungPruefen: true }, tag(0)).warnungen.some((w) => /Speicherplatz/.test(w.text)));
});

/** backup.sh-Umgebung mit Attrappen; der Prüfbefehl protokolliert den Inhalt des Probeordners */
function backupUmgebung(o, { restic = false } = {}) {
  const datei = testDb(o);
  const ziel = path.join(o, 'sicherung');
  const bin = path.join(o, 'bin');
  fs.mkdirSync(bin);
  const probe = path.join(o, 'probe-inhalt.txt');
  fs.writeFileSync(path.join(bin, 'pruef'), `#!/bin/bash
find "$(dirname "$1")" -type f >> "${probe}"
exec node ${SERVER}/sicherung.js pruefen "$1"
`, { mode: 0o755 });
  // restic-Attrappe: „restore … --include MUSTER“ kopiert nur passende Dateien, sonst den ganzen Ordner
  fs.writeFileSync(path.join(bin, 'restic'), `#!/bin/bash
echo "$@" >> "${o}/restic-aufrufe.txt"
if [[ "$1" == restore ]]; then
  INC=""
  while [[ $# -gt 0 ]]; do [[ "$1" == --target ]] && T="$2"; [[ "$1" == --include ]] && INC="$2"; shift; done
  mkdir -p "$T${ziel}"
  while IFS= read -r f; do
    if [[ -z "$INC" || "$f" == $INC ]]; then mkdir -p "$T$(dirname "$f")"; cp -a "$f" "$T$f"; fi
  done < <(find "${ziel}" -type f)
fi
exit 0
`, { mode: 0o755 });
  const resticEnv = path.join(o, restic ? 'restic.env' : 'fehlt.env');
  if (restic) fs.writeFileSync(resticEnv, `RESTIC_REPOSITORY=sftp:test@example.invalid:/bautag\nRESTIC_PASSWORD_FILE=${o}/pw\n`);
  return {
    datei, ziel, probe,
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, BAUTAG_DB: datei, BAUTAG_LOG: path.join(o, 'log.txt'), TMPDIR: o,
      BAUTAG_SICHERUNG: ziel, BAUTAG_SICHERUNG_APP: ziel, BAUTAG_UPLOADS_APP: path.join(o, 'daten', 'uploads'),
      BAUTAG_RESTIC_ENV: resticEnv, BAUTAG_SICHERUNG_CMD: `node ${SERVER}/sicherung.js`, BAUTAG_PRUEF_CMD: path.join(bin, 'pruef'),
      NODE_OPTIONS: '--disable-warning=ExperimentalWarning'
    }
  };
}

for (const restic of [false, true]) {
  test(`N-011: Wiederherstellungstest (${restic ? 'extern' : 'lokal'}) holt nur Datenbanken, keine Fotos`, (t) => {
    const o = tempOrdner(t);
    const u = backupUmgebung(o, { restic });
    const fotos = path.join(o, 'daten', 'uploads', 'berichte');
    fs.mkdirSync(fotos, { recursive: true });
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(fotos, `f${i}.jpg`), Buffer.alloc(64 * 1024, i));
    // zwei ältere Datenbank-Stände
    fs.mkdirSync(u.ziel, { recursive: true });
    for (const d of ['2026-01-01', '2026-01-02']) fs.copyFileSync(u.datei, path.join(u.ziel, `bautag-${d}.db`));
    assert.equal(spawnSync('bash', [path.join(DEPLOY, 'backup.sh'), '--lokal'], { env: u.env, encoding: 'utf8' }).status, 0);
    assert.ok(fs.existsSync(path.join(u.ziel, 'uploads-spiegel', 'berichte', 'f4.jpg')));
    const r = spawnSync('bash', [path.join(DEPLOY, 'backup.sh'), '--test'], { env: u.env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + fs.readFileSync(u.env.BAUTAG_LOG, 'utf8'));
    const inhalt = fs.readFileSync(u.probe, 'utf8').trim().split('\n');
    assert.ok(inhalt.length > 0 && inhalt.every((f) => /bautag-\d{4}-\d{2}-\d{2}\.db$/.test(f)), inhalt.join('\n'));
    if (!restic) assert.equal(inhalt.length, 1, 'lokal nur die neueste Datenbank');
    const st = JSON.parse(spawnSync('node', [`${SERVER}/sicherung.js`, 'anzeigen'], { env: u.env, encoding: 'utf8' }).stdout).sicherung;
    assert.equal(st.test.ok, true);
  });
}

// ---------------------------------------------------------------- N-011 / N-068: wiederherstellen.sh

/** docker-Attrappe: „run … pruefen“ prüft die Datei wirklich, compose stop/up/exec gelingen */
function dockerAttrappe(bin, logDatei) {
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/bash
echo "$*" >> "${logDatei}"
if [[ "$1" == run ]]; then
  for a in "$@"; do [[ "$a" == *:/pruefung:ro ]] && SRC="\${a%:/pruefung:ro}"; done
  last="\${@: -1}"
  exec node ${SERVER}/sicherung.js pruefen "$SRC\${last#/pruefung}"
fi
exit 0
`, { mode: 0o755 });
}

test('N-068/N-011: wiederherstellen.sh zeigt Fotos ohne angeklebten Pfad; --datei behält den Foto-Ordner bzw. nimmt den Spiegel', { skip: istRoot ? false : 'nur als root (Skript verlangt sudo)' }, (t) => {
  const o = tempOrdner(t);
  const datei = testDb(o);
  const bin = path.join(o, 'bin');
  fs.mkdirSync(bin);
  dockerAttrappe(bin, path.join(o, 'docker.txt'));
  const sicherung = path.join(o, 'sicherung');
  fs.mkdirSync(path.join(sicherung, 'uploads-spiegel', 'berichte'), { recursive: true });
  fs.copyFileSync(datei, path.join(sicherung, 'bautag-2026-11-13.db'));
  fs.writeFileSync(path.join(sicherung, 'uploads-spiegel', 'berichte', 's.jpg'), 'spiegel');
  const daten = path.join(o, 'srv');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, BAUTAG_DATEN: daten, BAUTAG_SICHERUNG: sicherung, BAUTAG_RESTIC_ENV: path.join(o, 'fehlt.env'), NODE_OPTIONS: '--disable-warning=ExperimentalWarning' };
  const lauf = () => spawnSync('bash', [path.join(DEPLOY, 'wiederherstellen.sh'), '--datei', path.join(sicherung, 'bautag-2026-11-13.db'), '--ja'], { env, encoding: 'utf8' });
  const fotoZeile = (r) => (/Fotos: (.*)$/m.exec(r.stdout) || [])[1];

  // a) Foto-Ordner vorhanden → bleibt unverändert (enthält alle Fotos bis heute)
  fs.mkdirSync(path.join(daten, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(daten, 'uploads', 'heute.jpg'), 'heute');
  let r = lauf();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fotoZeile(r), 'bleiben unverändert (aktueller Foto-Ordner)');
  assert.equal(fs.readFileSync(path.join(daten, 'uploads', 'heute.jpg'), 'utf8'), 'heute');
  assert.ok(fs.existsSync(path.join(daten, 'bautag.db')));

  // b) Foto-Ordner fehlt → lokaler Spiegel wird eingespielt
  fs.rmSync(path.join(daten, 'uploads'), { recursive: true });
  r = lauf();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fotoZeile(r), 'Spiegel uploads-spiegel');
  assert.equal(fs.readFileSync(path.join(daten, 'uploads', 'berichte', 's.jpg'), 'utf8'), 'spiegel');
  assert.ok(fs.existsSync(path.join(sicherung, 'uploads-spiegel', 'berichte', 's.jpg')), 'Spiegel bleibt erhalten');

  // c) älteres Format: Archiv des Tages → nur der Dateiname, nicht Name + voller Pfad (N-068)
  const quelle = path.join(o, 'alt');
  fs.mkdirSync(path.join(quelle, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(quelle, 'uploads', 'alt.jpg'), 'alt');
  assert.equal(spawnSync('tar', ['-czf', path.join(sicherung, 'uploads-2026-11-13.tar.gz'), '-C', quelle, 'uploads']).status, 0);
  r = lauf();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fotoZeile(r), 'uploads-2026-11-13.tar.gz');
  assert.ok(!r.stdout.includes(`uploads-2026-11-13.tar.gz${os.tmpdir()}`) && !/tar\.gz\//.test(fotoZeile(r)));
  assert.equal(fs.readFileSync(path.join(daten, 'uploads', 'alt.jpg'), 'utf8'), 'alt');
});

// ---------------------------------------------------------------- N-030 / N-031: update.sh

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/**
 * Zustand des Image/Caddy in Dateien; „compose build“ scheitert, solange zustand/build_fehler existiert.
 * image-<tag> enthält die Revision (Label) und dient zugleich als Image-ID; „laufend“ ist die Image-ID des laufenden
 * Containers (fehlt: Container läuft nicht). „up -d“ bricht update.sh hart ab (kill -9), solange zustand/abbruch existiert;
 * die Gesundheitsprüfung scheitert, solange zustand/ungesund existiert.
 */
function updateUmgebung(o) {
  const zustand = path.join(o, 'zustand');
  const bin = path.join(o, 'bin');
  fs.mkdirSync(zustand);
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/bash
Z="${zustand}"
echo "$*" >> "$Z/aufrufe.txt"
if [[ "$1" == image && "$2" == inspect ]]; then
  [[ -f "$Z/image-\${3#bautag:}" ]] || exit 1
  [[ "$*" == *--format* ]] && cat "$Z/image-\${3#bautag:}"
  exit 0
fi
if [[ "$1" == tag ]]; then
  if [[ "$2" == bautag:* ]]; then cp "$Z/image-\${2#bautag:}" "$Z/image-\${3#bautag:}"; else printf '%s' "$2" > "$Z/image-\${3#bautag:}"; fi
  exit 0
fi
if [[ "$1" == inspect && "$2" == --format && "$4" == app-container ]]; then cat "$Z/laufend"; exit 0; fi
if [[ "$1" == compose ]]; then
  D="$(dirname "$3")"; shift 3
  case "$*" in
    "ps -q app") [[ -f "$Z/laufend" ]] && echo app-container ;;
    "build app") [[ -f "$Z/build_fehler" ]] && { echo "Bau fehlgeschlagen" >&2; exit 1; }; printf '%s' "$BAUTAG_REVISION" > "$Z/image-aktuell"; echo "$BAUTAG_REVISION" >> "$Z/gebaut.txt" ;;
    "up -d --no-deps --force-recreate caddy") cp "$D/Caddyfile" "$Z/caddy-laufend"; echo neu >> "$Z/caddy-neu.txt" ;;
    "up -d"|"up -d --no-build") [[ -f "$Z/abbruch" ]] && { kill -9 "$PPID"; exit 137; }; cp "$Z/image-aktuell" "$Z/laufend"; echo "$*" >> "$Z/gestartet.txt"; [[ -f "$Z/caddy-laufend" ]] || cp "$D/Caddyfile" "$Z/caddy-laufend" ;;
    "exec -T caddy cat /etc/caddy/Caddyfile") cat "$Z/caddy-laufend" || exit 1 ;;
    "exec -T app"*) [[ -f "$Z/ungesund" ]] && exit 1; exit 0 ;;
  esac
  exit 0
fi
exit 0
`, { mode: 0o755 });
  // „origin“ mit deploy/ (update.sh, backup.sh, Caddyfile) und einem App-Stand
  const arbeit = path.join(o, 'arbeit');
  fs.mkdirSync(path.join(arbeit, 'deploy'), { recursive: true });
  fs.mkdirSync(path.join(arbeit, 'app'));
  for (const f of ['update.sh', 'backup.sh', 'Caddyfile', 'docker-compose.yml']) fs.copyFileSync(path.join(DEPLOY, f), path.join(arbeit, 'deploy', f));
  fs.writeFileSync(path.join(arbeit, 'app', 'version.txt'), '1');
  git(arbeit, 'init', '-q');
  git(arbeit, 'add', '-A');
  git(arbeit, 'commit', '-qm', 'v1');
  const server = path.join(o, 'server');
  git(o, 'clone', '-q', arbeit, server);
  // laufender Stand: Image aus v1, Caddy mit der v1-Caddyfile
  fs.writeFileSync(path.join(zustand, 'image-aktuell'), git(server, 'rev-parse', 'HEAD'));
  fs.copyFileSync(path.join(zustand, 'image-aktuell'), path.join(zustand, 'laufend'));
  fs.copyFileSync(path.join(server, 'deploy', 'Caddyfile'), path.join(zustand, 'caddy-laufend'));
  const env = {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    BAUTAG_LOG: path.join(o, 'log.txt'), BAUTAG_SICHERUNG_CMD: 'true', BAUTAG_GESUND_VERSUCHE: '1'
  };
  const lauf = () => spawnSync('bash', [path.join(server, 'deploy', 'update.sh')], { env, encoding: 'utf8' });
  const neuerStand = (datei, inhalt, msg) => { fs.writeFileSync(path.join(arbeit, datei), inhalt); git(arbeit, 'commit', '-qam', msg); return git(arbeit, 'rev-parse', 'HEAD'); };
  const z = (f) => (fs.existsSync(path.join(zustand, f)) ? fs.readFileSync(path.join(zustand, f), 'utf8') : '');
  return { arbeit, server, zustand, lauf, neuerStand, z };
}

test('N-030: update.sh baut nach einem gescheiterten Bau beim nächsten Lauf wieder (Vergleich mit der Image-Revision)', { skip: istRoot ? false : 'nur als root (Skript verlangt sudo)' }, (t) => {
  const o = tempOrdner(t);
  const u = updateUmgebung(o);
  const v1 = u.z('image-aktuell');
  const v2 = u.neuerStand('app/version.txt', '2', 'v2');
  fs.writeFileSync(path.join(u.zustand, 'build_fehler'), '');
  let r = u.lauf();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /ließ sich nicht bauen/);
  assert.equal(u.z('image-aktuell'), v1, 'laufender Container unverändert');
  assert.equal(git(u.server, 'rev-parse', 'HEAD'), v1, 'Programmstand zurückgesetzt');
  // Bau geht wieder → der nächste Lauf baut v2 (früher: „Bereits aktuell“, kein Bau)
  fs.rmSync(path.join(u.zustand, 'build_fehler'));
  r = u.lauf();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /Bereits aktuell/);
  assert.equal(u.z('image-aktuell'), v2);
  assert.match(r.stdout, /Update erfolgreich/);
  // jetzt wirklich aktuell → kein weiterer Bau
  r = u.lauf();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Bereits aktuell/);
  assert.equal(u.z('gebaut.txt').trim().split('\n').length, 1);
  // Stand per Hand geholt (git pull ohne update.sh), Image noch alt → update.sh baut trotzdem
  const v3 = u.neuerStand('app/version.txt', '3', 'v3');
  git(u.server, 'pull', '-q', '--ff-only');
  r = u.lauf();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /noch nicht gebaut/);
  assert.equal(u.z('image-aktuell'), v3);
  // Image-Label und Bau-Argument sind verdrahtet
  assert.match(lies('Dockerfile'), /ARG BAUTAG_REVISION=unbekannt\nLABEL org\.opencontainers\.image\.revision=\$BAUTAG_REVISION/);
  assert.match(lies('docker-compose.yml'), /args:\n(\s+#.*\n)?\s+BAUTAG_REVISION: \$\{BAUTAG_REVISION:-unbekannt\}/);
  assert.match(lies('installieren.sh'), /export BAUTAG_REVISION\ndocker compose build app/);
});

test('N-030 Rest: Abbruch nach dem Bau und vor „up -d“ – der nächste Lauf startet das gebaute Image (Vergleich mit dem laufenden Container)', { skip: istRoot ? false : 'nur als root (Skript verlangt sudo)' }, (t) => {
  const o = tempOrdner(t);
  const u = updateUmgebung(o);
  const v1 = u.z('image-aktuell');
  const v2 = u.neuerStand('app/version.txt', '2', 'v2');
  // Lauf wird nach dem Bau beim Starten hart abgebrochen (Stromausfall, SSH-Verbindung weg …)
  fs.writeFileSync(path.join(u.zustand, 'abbruch'), '');
  let r = u.lauf();
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  fs.rmSync(path.join(u.zustand, 'abbruch'));
  assert.equal(u.z('image-aktuell'), v2, 'gebaut');
  assert.equal(u.z('laufend'), v1, 'läuft noch mit v1');
  assert.equal(git(u.server, 'rev-parse', 'HEAD'), v2);
  // nächster Lauf: Image-Label = HEAD, aber der Container läuft mit v1 → kein „Bereits aktuell“, kein neuer Bau, up -d
  r = u.lauf();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /Bereits aktuell/);
  assert.match(r.stdout, /gebaut, läuft aber noch nicht/);
  assert.equal(u.z('laufend'), v2, 'Container läuft jetzt mit dem gebauten Image');
  assert.equal(u.z('gebaut.txt').trim().split('\n').length, 1, 'nicht erneut gebaut');
  assert.match(r.stdout, /Update erfolgreich/);
  r = u.lauf();
  assert.match(r.stdout, /Bereits aktuell/);
  // Container gestoppt (läuft nicht) → wird gestartet statt „Bereits aktuell“
  fs.rmSync(path.join(u.zustand, 'laufend'));
  r = u.lauf();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /Bereits aktuell/);
  assert.equal(u.z('laufend'), v2);
  // abgebrochen und die neue Version ist ungesund → zurück auf das Image, mit dem der Container lief (v2), nicht auf v3
  const v3 = u.neuerStand('app/version.txt', '3', 'v3');
  fs.writeFileSync(path.join(u.zustand, 'abbruch'), '');
  u.lauf();
  fs.rmSync(path.join(u.zustand, 'abbruch'));
  assert.equal(u.z('image-aktuell'), v3);
  assert.equal(u.z('laufend'), v2);
  fs.writeFileSync(path.join(u.zustand, 'ungesund'), '');
  r = u.lauf();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /schalte zurück/);
  assert.equal(u.z('image-vorher'), v2);
  assert.equal(u.z('laufend'), v2, 'vorige Version läuft wieder');
  // Skript vergleicht die Image-ID des laufenden Containers mit bautag:aktuell
  const upd = lies('update.sh');
  assert.match(upd, /ps -q app/);
  assert.match(upd, /docker inspect --format '\{\{\.Image\}\}'/);
  assert.match(upd, /docker image inspect bautag:aktuell --format '\{\{\.Id\}\}'/);
});

test('N-031: update.sh erstellt Caddy neu, wenn sich die Caddyfile geändert hat – sonst nicht', { skip: istRoot ? false : 'nur als root (Skript verlangt sudo)' }, (t) => {
  const o = tempOrdner(t);
  const u = updateUmgebung(o);
  // App-Änderung ohne Caddyfile → Caddy bleibt
  u.neuerStand('app/version.txt', '2', 'v2');
  let r = u.lauf();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(u.z('caddy-neu.txt'), '');
  // neue Caddyfile → nach dem Update läuft Caddy mit der neuen Datei
  const neu = fs.readFileSync(path.join(u.arbeit, 'deploy', 'Caddyfile'), 'utf8').replace('max_size 40MB', 'max_size 41MB');
  u.neuerStand('deploy/Caddyfile', neu, 'v3 Caddy');
  r = u.lauf();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Caddyfile geändert/);
  assert.equal(u.z('caddy-laufend'), neu);
  assert.equal(u.z('caddy-neu.txt').trim().split('\n').length, 1);
  // Server, der vor der Korrektur aktualisiert wurde: Programm aktuell, Caddy läuft noch mit alter Datei
  fs.writeFileSync(path.join(u.zustand, 'caddy-laufend'), 'alt');
  r = u.lauf();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Bereits aktuell/);
  assert.equal(u.z('caddy-laufend'), neu);
});

// ---------------------------------------------------------------- N-046

test('N-046: abhaengigkeiten.js erkennt fehlende und veraltete Pakete (Startskripte rufen npm install auf)', (t) => {
  const { pruefeAbhaengigkeiten, meldung } = require('../../server/abhaengigkeiten');
  assert.deepEqual(pruefeAbhaengigkeiten(), { ok: true, fehlen: [], veraltet: [] }, 'aktuelle Installation vollständig');
  const o = tempOrdner(t);
  fs.writeFileSync(path.join(o, 'package.json'), JSON.stringify({ dependencies: { alt: '^1.0.0', da: '^2.0.0', fehlt: '^1.0.0', '@firma/paket': '^1.0.0' } }));
  fs.writeFileSync(path.join(o, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/alt': { version: '1.2.0' }, 'node_modules/da': { version: '2.0.0' }, 'node_modules/@firma/paket': { version: '1.0.0' } } }));
  for (const [n, v] of [['alt', '1.0.0'], ['da', '2.0.0'], ['@firma/paket', '1.0.0']]) {
    fs.mkdirSync(path.join(o, 'node_modules', n), { recursive: true });
    fs.writeFileSync(path.join(o, 'node_modules', n, 'package.json'), JSON.stringify({ name: n, version: v }));
  }
  const r = pruefeAbhaengigkeiten(o);
  assert.deepEqual(r, { ok: false, fehlen: ['fehlt'], veraltet: [{ name: 'alt', ist: '1.0.0', soll: '1.2.0' }] });
  assert.match(meldung(r), /npm install/);
  const cli = spawnSync(process.execPath, [path.join(SERVER, 'abhaengigkeiten.js'), o], { encoding: 'utf8' });
  assert.equal(cli.status, 1);
  assert.equal(spawnSync(process.execPath, [path.join(SERVER, 'abhaengigkeiten.js')], { encoding: 'utf8' }).status, 0);
  // Startskripte: npm install nicht nur, wenn node_modules fehlt, sondern immer, wenn die Prüfung scheitert
  const mac = fs.readFileSync(path.join(REPO, 'BauTag-starten-Mac.command'), 'utf8');
  assert.match(mac, /if ! node server\/abhaengigkeiten\.js >\/dev\/null 2>&1; then\n\s+echo [^\n]*; npm install /);
  assert.doesNotMatch(mac, /\[ -d node_modules \]/);
  const win = fs.readFileSync(path.join(REPO, 'BauTag-starten-Windows.bat'), 'utf8');
  assert.match(win, /node server\\abhaengigkeiten\.js >nul 2>nul\r?\nif errorlevel 1 \(\r?\n[^\r\n]*\r?\n\s+call npm install /);
  assert.doesNotMatch(win, /if not exist node_modules/);
  assert.ok(mac.indexOf('abhaengigkeiten') < mac.indexOf('npm run seed') && win.indexOf('abhaengigkeiten') < win.indexOf('npm run seed'));
  for (const f of ['README.md', path.join('app', 'server', 'README.md')]) assert.match(fs.readFileSync(path.join(REPO, f), 'utf8'), /Testversion aktualisieren/);
});

test('N-046: server/index.js startet bei fehlendem Paket nicht und lässt die Datenbank unverändert', (t) => {
  const o = tempOrdner(t);
  // Kopie der App mit einer zusätzlichen (nicht installierten) Abhängigkeit – wie ein neuer Stand über altem node_modules
  const app = path.join(o, 'app');
  fs.mkdirSync(app);
  fs.cpSync(SERVER, path.join(app, 'server'), { recursive: true });
  fs.symlinkSync(path.join(APP, 'node_modules'), path.join(app, 'node_modules'));
  fs.symlinkSync(path.join(APP, 'public'), path.join(app, 'public'));
  const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  pkg.dependencies['bautag-neues-paket'] = '^1.0.0';
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify(pkg));
  fs.copyFileSync(path.join(APP, 'package-lock.json'), path.join(app, 'package-lock.json'));
  // bestehende Datenbank eines älteren Stands (Schema-Version 1 vorgetäuscht)
  const dbDatei = path.join(o, 'daten', 'bautag.db');
  const db = oeffneDatenbank(dbDatei);
  const vorher = db.eins('SELECT MAX(version) AS v FROM schema_version').v;
  db.lauf('DELETE FROM schema_version WHERE version > 1');
  db.schliessen();
  const groesse = fs.statSync(dbDatei).size;
  const r = spawnSync(process.execPath, [path.join(app, 'server', 'index.js')], {
    env: { ...process.env, BAUTAG_DB: dbDatei, BAUTAG_DEMO: '1', PORT: '0', BAUTAG_TEST: '', NODE_ENV: '' }, encoding: 'utf8', timeout: 20000
  });
  assert.equal(r.status, 1, `Server darf nicht starten: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /START VERWEIGERT: Programmteile sind nicht vollständig installiert \(es fehlen: bautag-neues-paket\)/);
  assert.match(r.stderr, /npm install/);
  const { DatabaseSync } = require('node:sqlite');
  const roh = new DatabaseSync(dbDatei, { readOnly: true });
  t.after(() => roh.close());
  assert.equal(roh.prepare('SELECT MAX(version) AS v FROM schema_version').get().v, 1, 'keine Migration');
  assert.ok(vorher > 1);
  assert.equal(fs.statSync(dbDatei).size, groesse);
});

// ---------------------------------------------------------------- N-065

test('N-065: Größentabelle in ANLEITUNG.md trennt Dokumente (25 MB) und LV/BMD/Stammdaten-Import (5 MB) wie der Code', () => {
  const anl = lies('ANLEITUNG.md');
  const zeile = (wort) => anl.split('\n').find((z) => z.startsWith('|') && z.includes(wort)) || '';
  const mb = (b) => `${b / 1024 / 1024} MB`;
  const dok = require(path.join(SERVER, 'dokument-pruefung')).MAX_BYTES;
  const importeMax = eval(/const MAX = ([\d\s*]+);/.exec(fs.readFileSync(path.join(SERVER, 'routes', 'importe.js'), 'utf8'))[1]); // eslint-disable-line no-eval
  const stamm = require(path.join(SERVER, 'katalog-excel')).IMPORT_GRENZEN.dateiBytes;
  assert.equal(importeMax, stamm, 'LV/BMD und Stammdaten haben dieselbe Grenze');
  const dz = zeile('Projektdokumente');
  assert.ok(dz.includes(`| ${mb(dok)} |`) && !/Import/.test(dz), dz);
  const iz = zeile('LV-');
  assert.ok(/BMD/.test(iz) && /Stammdaten/.test(iz) && iz.includes(`| ${mb(importeMax)} |`), iz);
});

// ---------------------------------------------------------------- N-066

test('N-066: Fernunterschrift-Token auch im Caddy-Standard-/Fehlerprotokoll maskiert, ohne Anker und ohne Groß-/Kleinschreibung', () => {
  const c = lies('Caddyfile');
  const global = c.slice(0, c.indexOf('{$BAUTAG_DOMAIN}'));
  assert.match(global, /log default \{\s*output stderr\s*format filter \{\s*wrap json\s*fields \{/);
  for (const teil of [global, c.slice(c.indexOf('{$BAUTAG_DOMAIN}'))]) {
    const m = /request>uri regexp (\S+) (\S+)/.exec(teil);
    assert.ok(m, 'Filter für request>uri');
    assert.match(teil, /request>headers>Referer delete/);
    assert.match(teil, /request>headers>Cookie delete/);
    // Go-Regexp → JavaScript: (?i) als Flag, ReplaceAllString = global
    const quelle = m[1].startsWith('(?i)') ? m[1].slice(4) : m[1];
    const re = new RegExp(quelle, m[1].startsWith('(?i)') ? 'gi' : 'g');
    const ersetze = (u) => u.replace(re, m[2]);
    const tok = 'AbC_dEf-0123456789abcdefghijklmnopqrstuvwxy';
    for (const [u, soll] of [
      [`/api/fern/${tok}`, '/api/fern/***'], [`/api/fern/${tok}/pdf`, '/api/fern/***/pdf'], [`/unterschrift/${tok}?x=1`, '/unterschrift/***?x=1'],
      [`//api/fern/${tok}`, '//api/fern/***'], [`/API/FERN/${tok}`, '/API/FERN/***'], [`/api/./fern/${tok}`, '/api/./fern/***'],
      [`/api//fern//${tok}`, '/api//fern//***'], [`/Unterschrift/${tok}`, '/Unterschrift/***'], ['/api/berichte/5', '/api/berichte/5']
    ]) assert.equal(ersetze(u), soll, u);
  }
});

// ---------------------------------------------------------------- N-067

test('N-067 Rest: Testbefehl für die Notfall-E-Mail ist ein Codeblock; kein Inline-Code über Zeilen in deploy/*.md', () => {
  for (const f of fs.readdirSync(DEPLOY).filter((x) => x.endsWith('.md'))) {
    let block = false;
    lies(f).split('\n').forEach((z, i) => {
      if (/^\s*```/.test(z)) { block = !block; return; }
      if (!block) assert.equal((z.match(/`/g) || []).length % 2, 0, `${f}:${i + 1} Inline-Code nicht in derselben Zeile geschlossen: ${z}`);
    });
    assert.equal(block, false, `${f}: Codeblock nicht geschlossen`);
  }
  const anl = lies('ANLEITUNG.md');
  const notfall = anl.slice(anl.indexOf('## Notfall-E-Mail'), anl.indexOf('\n## ', anl.indexOf('## Notfall-E-Mail') + 5));
  assert.match(notfall, /\n```\nprintf 'Subject: BauTag Test\\n\\nTest\\n' \| sudo sendmail ihre@adresse\.at\n```\n/);
});

test('N-067: cron für backup.sh mit PATH inkl. /usr/sbin; backup.sh findet sendmail auch unter cron; Hinweis in ANLEITUNG.md', (t) => {
  const inst = lies('installieren.sh');
  const cron = /cat > \/etc\/cron\.d\/bautag <<EOF\n([\s\S]*?)\nEOF/.exec(inst)[1];
  const pfad = /^PATH=(.*)$/m.exec(cron);
  assert.ok(pfad, 'PATH in /etc/cron.d/bautag');
  assert.ok(pfad[1].split(':').includes('/usr/sbin') && pfad[1].split(':').includes('/usr/bin'), pfad[1]);
  assert.ok(cron.indexOf('PATH=') < cron.indexOf('backup.sh'));
  assert.match(lies('backup.sh'), /^PATH="\$\{PATH:-\/usr\/bin:\/bin\}:\/usr\/local\/sbin:\/usr\/sbin:\/sbin"$/m);
  assert.match(lies('ANLEITUNG.md'), /## Notfall-E-Mail[\s\S]*msmtp-mta/);
  assert.match(inst, /command -v sendmail[\s\S]*Notfall-E-Mail/);
  // App nicht erreichbar → Notfall-Mail über sendmail
  const o = tempOrdner(t);
  const bin = path.join(o, 'bin');
  fs.mkdirSync(bin);
  const post = path.join(o, 'post.txt');
  fs.writeFileSync(path.join(bin, 'sendmail'), `#!/bin/bash\ncat > "${post}"\n`, { mode: 0o755 });
  fs.mkdirSync(path.join(o, 'deploy'));
  fs.copyFileSync(path.join(DEPLOY, 'backup.sh'), path.join(o, 'deploy', 'backup.sh'));
  fs.writeFileSync(path.join(o, 'deploy', '.env'), 'ALARM_EMAIL=alarm@example.invalid\n');
  const r = spawnSync('bash', [path.join(o, 'deploy', 'backup.sh'), '--lokal'], {
    env: { PATH: `${bin}:/usr/bin:/bin`, BAUTAG_LOG: path.join(o, 'log.txt'), BAUTAG_SICHERUNG_CMD: 'false', HOME: o }, encoding: 'utf8'
  });
  assert.equal(r.status, 1);
  assert.match(fs.readFileSync(post, 'utf8'), /^To: alarm@example\.invalid\nSubject: BauTag: Sicherung \(lokal\) fehlgeschlagen/);
});
