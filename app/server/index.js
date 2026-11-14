'use strict';
/**
 * BauTag – Server. App-Fabrik `createApp({dbPath, uhr})` für Tests; Start mit `node server/index.js`.
 */
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { oeffneDatenbank } = require('./db');
const { erzeugeUhr } = require('./datum');
const { ApiFehler, nichtGefunden } = require('./fehler');
const { sitzungMiddleware, angemeldet, LoginBremse, sitzungsKonfig } = require('./auth');
const { entferneEuroFelder, schreibeStandardMatrix } = require('./rechte');

const VERSION = require('../package.json').version;
const PUBLIC = path.join(__dirname, '..', 'public');
// Oberfläche nutzt keine Inline-Skripte; style-Attribute kommen vor → 'unsafe-inline' nur für Styles
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "connect-src 'self'", "font-src 'self'", "manifest-src 'self'", "worker-src 'self'", "object-src 'none'",
  "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"
].join('; ');

/**
 * @param {object} [opt]
 * @param {string} [opt.dbPath]  Pfad der SQLite-Datei oder ':memory:' (Standard: BAUTAG_DB bzw. data/bautag.db)
 * @param {Function|string} [opt.uhr]  Uhr-Funktion () => Date oder ISO-Startzeit (Standard: BAUTAG_UHR)
 * @param {boolean} [opt.seed]  Testdaten einspielen (nur sinnvoll mit :memory:)
 * @param {boolean} [opt.euroSicherheitsnetz=true]  zusätzliches Entfernen von €-Feldern vor dem Senden
 * @param {string} [opt.publicDir]
 */
/** Start verweigern (G-06, G-11) – Fehler mit klarer Meldung statt Stacktrace */
class StartFehler extends Error {}
function startPruefen(opt) {
  // N-063: Schreibweise egal („Production“, „ production “)
  const produktion = String((opt.nodeEnv !== undefined ? opt.nodeEnv : process.env.NODE_ENV) || '').trim().toLowerCase() === 'production';
  const test = opt.test !== undefined ? Boolean(opt.test) : process.env.BAUTAG_TEST === '1';
  const demo = opt.demo !== undefined ? Boolean(opt.demo) : process.env.BAUTAG_DEMO === '1';
  if (produktion && test) throw new StartFehler('BAUTAG_TEST=1 ist im Echtbetrieb (NODE_ENV=production) verboten: Die Test-Schnittstellen dürfen dort nie aktiv sein. Bitte BAUTAG_TEST aus deploy/.env entfernen.');
  const schl = opt.schluessel || process.env.BAUTAG_SCHLUESSEL || '';
  if (produktion && !demo && !require('./geheim').schluesselGueltig(schl)) {
    throw new StartFehler(`BAUTAG_SCHLUESSEL fehlt oder ist zu kurz (mindestens ${require('./geheim').MIN_PRODUKTION} Zeichen). Ohne ihn lägen 2FA-Geheimnisse und Zugangsdaten im Klartext in der Datenbank und in jeder Sicherung. Erzeugen: openssl rand -hex 32 → in deploy/.env eintragen und auf dem Notfallblatt notieren.`);
  }
  let testToken = null;
  if (test) {
    testToken = opt.testToken || process.env.BAUTAG_TEST_TOKEN || (opt.test !== undefined ? require('node:crypto').randomBytes(24).toString('hex') : '');
    if (testToken.length < 16) throw new StartFehler('BAUTAG_TEST=1 verlangt BAUTAG_TEST_TOKEN (mindestens 16 Zeichen); die Test-Schnittstellen prüfen den Kopf X-BauTag-Test-Token.');
  }
  return { produktion, testToken };
}

function createApp(opt = {}) {
  const start = startPruefen(opt);
  const dbPath = opt.dbPath || process.env.BAUTAG_DB || path.join(__dirname, '..', 'data', 'bautag.db');
  const uhr = erzeugeUhr(opt.uhr !== undefined ? opt.uhr : process.env.BAUTAG_UHR);
  const db = opt.db || oeffneDatenbank(dbPath);
  db.uhr = uhr; // für Hilfsfunktionen ohne bt (z. B. Anlagenstatus im Bericht)
  const bt = { db, uhr, version: VERSION, pdfUnkomprimiert: Boolean(opt.pdfUnkomprimiert), sitzung: sitzungsKonfig(opt.sitzung || {}) };
  bt.demo = opt.demo !== undefined ? Boolean(opt.demo) : process.env.BAUTAG_DEMO === '1';
  bt.loginListe = opt.loginListe !== undefined ? Boolean(opt.loginListe) : process.env.BAUTAG_LOGIN_LISTE !== '0';
  bt.bremse = new LoginBremse(db, uhr);
  // Ausbaustufe 2: Dienste (API.md 12.3–12.5, 12.18)
  bt.test = opt.test !== undefined ? Boolean(opt.test) : process.env.BAUTAG_TEST === '1';
  bt.testToken = start.testToken; // G-06: Test-Schnittstellen nur mit Kopf X-BauTag-Test-Token
  bt.produktion = start.produktion;
  bt.testAusgang = require('./routes/test').leer();
  bt.testVorgaben = {};
  bt.url = opt.url || process.env.BAUTAG_URL || '';
  bt.schluessel = opt.schluessel || process.env.BAUTAG_SCHLUESSEL || '';
  bt.wetterAn = opt.wetter !== undefined ? Boolean(opt.wetter) : process.env.BAUTAG_WETTER !== '0';
  if (opt.wetterAbruf) bt.wetterAbruf = opt.wetterAbruf;
  if (opt.mailTransport) bt.mailTransport = opt.mailTransport;
  if (opt.kiClient) bt.kiClient = opt.kiClient; // Tests: Attrappe des Anthropic-SDK
  bt.pushAus = Boolean(opt.pushAus);
  bt.mail = { alarm: (betreff, text) => require('./mail').alarm(bt, betreff, text) };

  // Rechte-Matrix beim ersten Start anlegen
  if (!db.eins('SELECT 1 AS x FROM rolle_recht LIMIT 1')) db.transaktion(() => schreibeStandardMatrix(db));
  // Positionskatalog (Firmenvorlage, API.md 10) beim ersten Start anlegen
  require('./positionen').katalogAnlegen(db, uhr());
  require('./positionen').katalogAnpassungenAnwenden(db, uhr()); // versionierte Anpassungen (API.md 10d), einmalig
  require('./fuhrpark-vorlagen').vorlagenAnlegen(db); // Servicebuch-Vorlagen (API.md 11), einmalig
  // E-03: Bestands-Datenbanken – Positionen übernehmen, Budget-Alarme auf neuer Basis neu bewerten
  const bestand = require('./positionen').bestandUebernehmen(db, uhr());
  bt.bestand = bestand;
  if (bestand.kopiert.length || bestand.alarmeGeloescht) require('./budget').pruefeAlleBudgets(bt, { anlass: 'Umstellung auf Nachkalkulation nach Positionen' });
  if (opt.seed) require('./seed').seed(db, { uhr: uhr(), demo: bt.demo });
  require('./kostenstellen').bueroSicherstellen(db, uhr().toISOString()); // 12.25: interne Kostenstelle „Büro“ (KST 90-000)
  // Fotos der Schadensmeldungen: nicht öffentlicher Ordner (nie statisch ausgeliefert)
  bt.uploadsTemp = !opt.uploads && !process.env.BAUTAG_UPLOADS && db.pfad === ':memory:';
  bt.uploads = opt.uploads || process.env.BAUTAG_UPLOADS
    || (db.pfad === ':memory:' ? path.join(require('node:os').tmpdir(), `bautag-uploads-${process.pid}-${require('node:crypto').randomBytes(6).toString('hex')}`) : path.join(path.dirname(path.resolve(db.pfad)), 'uploads')); // F-14: neben der Datenbank
  // Servicebuch-Prüflauf: beim Start und stündlich (SERVICEBUCH_ENTWURF.md 6)
  const { pruefeFuhrparkSicher } = require('./fuhrpark-erinnerung');
  const { pruefeSicherungSicher } = require('./sicherung-pruefung');
  bt.sicherungPruefen = opt.sicherungPruefen !== undefined ? Boolean(opt.sicherungPruefen) : process.env.BAUTAG_SICHERUNG_PRUEFEN === '1';
  // API.md 12.2: Stammtabellen = heute gültige Preise; tritt ein Stand in Kraft → Budgets einmal am Tag prüfen
  const preiseTag = () => {
    try {
      const PV = require('./preise-verlauf');
      PV.abgleichen(db);
      const heute = require('./datum').wienDatum(uhr());
      const zuletzt = db.einstellung('preise_tag', null);
      if (zuletzt !== heute) {
        const neu = zuletzt && db.eins('SELECT 1 AS x FROM preis_stand WHERE gueltig_ab > ? AND gueltig_ab <= ? LIMIT 1', zuletzt, heute);
        db.setzeEinstellung('preise_tag', heute);
        if (neu) require('./budget').pruefeAlleBudgets(bt, { anlass: 'Preisänderung tritt in Kraft' });
      }
    } catch (e) { console.error('[BauTag] Preis-Abgleich:', e.message); }
  };
  const sicher = (name, f) => { try { f(bt); } catch (e) { console.error(`[BauTag] ${name}:`, e.message); } };
  bt.stuendlich = () => {
    preiseTag(); pruefeFuhrparkSicher(bt); pruefeSicherungSicher(bt);
    sicher('Lohngruppen', require('./lohngruppen').tagesLauf); // 12.22
    sicher('Bauvorhaben', require('./bauvorhaben').pruefeBauvorhaben);
    sicher('Rechnungen', require('./rechnungen').pruefeRechnungen);
    sicher('Urlaubsanträge', require('./routes/urlaub').pruefeAntraege);
    sicher('Plan-Erinnerung', require('./planer').pruefeErinnerung); // nie automatisch veröffentlichen (12.8c)
    require('./push').anstossen(bt);
  };
  try { require('./push').vapid(bt); } catch (e) { console.error('[BauTag] VAPID:', e.message); }
  bt.stuendlich();
  bt.fuhrparkTimer = setInterval(() => bt.stuendlich(), 60 * 60 * 1000);
  bt.fuhrparkTimer.unref();

  bt.warnungen = [];
  // N-063: ohne gültigen Schlüssel (außerhalb des Echtbetriebs, der dann gar nicht startet) deutlich warnen
  if (!require('./geheim').schluesselGueltig(bt.schluessel)) {
    bt.warnungen.push(`BAUTAG_SCHLUESSEL fehlt oder ist kürzer als ${require('./geheim').MIN_PRODUKTION} Zeichen – ${bt.demo || bt.test ? 'Vorführ-/Testbetrieb: Geheimnisse werden im Klartext gespeichert. ' : 'Zwei-Faktor-Anmeldung, SMTP-Passwort und KI-Schlüssel können nicht gespeichert werden, Push-Schlüssel gelten nur bis zum Neustart. '}Für den Echtbetrieb NODE_ENV=production und BAUTAG_SCHLUESSEL setzen (openssl rand -hex 32).`);
  }
  // G-11/G-03: „klar:“-Geheimnisse nachverschlüsseln, unlesbare melden (neuer/falscher BAUTAG_SCHLUESSEL)
  try {
    const g = require('./geheim').geheimnisseAbgleichen(bt);
    bt.geheimnisse = g;
    if (g.nachverschluesselt) {
      console.log(`[BauTag] ${g.nachverschluesselt} Geheimnis(se) mit BAUTAG_SCHLUESSEL nachverschlüsselt.`);
      db.protokolliere({ zeit: uhr().toISOString(), benutzerId: null, art: 'sicherheit', objekt: 'geheimnisse', neu: { nachverschluesselt: g.nachverschluesselt }, text: `${g.nachverschluesselt} Geheimnis(se) beim Start nachverschlüsselt` });
    }
    const u = g.unlesbar;
    if (u.zweiFaktor) bt.warnungen.push(`${u.zweiFaktor} Zwei-Faktor-Geheimnis(se) mit dem aktuellen BAUTAG_SCHLUESSEL nicht lesbar – Anmeldung nur mit Wiederherstellungscode; Zurücksetzen: GF (Benutzer → 2FA zurücksetzen) oder node server/entsperren.js <Pnr> --2fa bzw. --2fa-alle.`);
    if (u.smtp) bt.warnungen.push('SMTP-Passwort mit dem aktuellen BAUTAG_SCHLUESSEL nicht lesbar – unter Einstellungen → E-Mail neu eingeben.');
    if (u.ki) bt.warnungen.push('KI-API-Schlüssel mit dem aktuellen BAUTAG_SCHLUESSEL nicht lesbar – unter Einstellungen → KI neu eingeben.');
    if (u.vapid) {
      // Push-Schlüssel neu erzeugen; alte Abos passen nicht mehr und werden entfernt (Geräte melden sich beim nächsten Öffnen neu an)
      db.setzeEinstellung('vapid', null);
      db.lauf('DELETE FROM push_abo');
      bt.warnungen.push('Push-Schlüssel (VAPID) war mit dem aktuellen BAUTAG_SCHLUESSEL nicht lesbar – neu erzeugt; Geräte müssen Push neu einschalten.');
    }
  } catch (e) { console.error('[BauTag] Geheimnisse prüfen:', e.message); }
  bt.warnungen.push(...require('./kostenstellen').altCodesOffen(db)); // Migration 29: Ziel-KST belegt
  const verwalter = require('./rechte').entsperrKonten(db);
  if (verwalter.length < 2) {
    bt.warnungen.push(`Nur ${verwalter.length} aktives Verwaltungs-Konto (GF/Büro) kann gesperrte Konten entsperren – bitte mindestens zwei anlegen (Notfall: node server/entsperren.js <Personalnummer>).`);
  }

  const app = express();
  app.disable('x-powered-by');
  // Nur hinter einem Reverse-Proxy: dann gelten X-Forwarded-For/-Proto (Client-IP, HTTPS)
  const trustProxy = opt.trustProxy !== undefined ? opt.trustProxy : process.env.TRUST_PROXY === '1';
  app.set('trust proxy', trustProxy ? 1 : false);
  app.locals.bt = bt;

  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  const api = express.Router();

  // Schreibende Anfragen nur als JSON (CSRF-Schutz zusätzlich zu SameSite=Strict)
  api.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const ct = (req.headers['content-type'] || '').toLowerCase();
      const hatBody = Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'];
      if (ct ? !ct.startsWith('application/json') : hatBody) {
        return next(new ApiFehler(415, 'UNGUELTIG', 'Schreibende Anfragen müssen als JSON gesendet werden (Content-Type: application/json).'));
      }
    }
    next();
  });
  // JSON-Grenze 2 MB; Excel-Import (Datei ≤ 5 MB als Base64) bis 7 MB (E-02); Schadensfotos (max. 8 MB je Foto, Base64) bis 12 MB (API.md 11.9)
  const jsonKlein = express.json({ limit: '2mb', strict: true });
  const jsonImport = express.json({ limit: '7mb', strict: true });
  const jsonFotos = express.json({ limit: '12mb', strict: true });
  const jsonDokumente = express.json({ limit: '35mb', strict: true });
  const fotoPfad = /^\/(fuhrpark\/schaeden|berichte\/(\d+\/(fotos|lieferschein|papier)|papier)|plan\/fuhren\/\d+\/foto|fern\/)/i; // inkl. Lieferschein/Papier (12.11/12.12)
  // N-032: große Grenzen nur für die tatsächlichen Upload-Routen (POST) und nur mit gültiger Sitzung – die Sitzung wird
  // deshalb VOR dem Lesen des Bodys geprüft; Unangemeldete erhalten 413 statt 35 MB geparst zu bekommen. Ausnahme: die
  // öffentliche Fernunterschrift (12.9, ohne Anmeldung, Unterschriftsbild ≤ 12 MB).
  const dokumentPfad = /^\/(baustellen\/\d+\/(dokumente(\/\d+\/versionen)?|lv-import)|import\/bmd-op|stammdaten\/[a-z]+\/import)\/?$/i;
  api.use(sitzungMiddleware(bt));
  api.use((req, res, next) => {
    const gross = req.method === 'POST' && Boolean(req.ctx);
    const parser = gross && /^\/positionen\/katalog\/import\/?$/i.test(req.path) ? jsonImport
      : gross && dokumentPfad.test(req.path) ? jsonDokumente
        : fotoPfad.test(req.path) && (req.ctx || /^\/fern\//i.test(req.path)) ? jsonFotos : jsonKlein;
    parser(req, res, next);
  });
  api.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && (req.body === undefined || req.body === null)) req.body = {};
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && (typeof req.body !== 'object' || Array.isArray(req.body))) {
      return next(new ApiFehler(400, 'UNGUELTIG', 'Anfrage: JSON-Objekt erwartet.'));
    }
    next();
  });
  // Neue Benachrichtigungen nach jeder Anfrage per Push verteilen (API.md 12.3)
  api.use((req, res, next) => { res.on('finish', () => require('./push').anstossen(bt)); next(); });
  if (bt.test) require('./routes/test')(api, bt); // API.md 12.18 – nur Testbetrieb

  // Öffentlich (vor dem €-Sicherheitsnetz, damit 'db' nicht als €-Feld entfernt wird)
  api.get('/gesundheit', (req, res) => {
    let ok = 'ok';
    try { db.eins('SELECT 1 AS x'); } catch (_) { ok = 'fehler'; }
    res.json({ ok: ok === 'ok', version: VERSION, db: ok });
  });

  // Sicherheitsnetz: ohne preise_sehen verlassen keine €-Felder den Server
  if (opt.euroSicherheitsnetz !== false) {
    api.use((req, res, next) => {
      const ctx = req.ctx;
      if (ctx && !ctx.hat('preise_sehen')) {
        const orig = res.json.bind(res);
        res.json = (body) => orig(entferneEuroFelder(body, { kalk: ctx.hat('kalk_sehen') }));
      }
      next();
    });
  }

  // Sperren „PIN ändern“ und „2FA einrichten“ (API.md 7, 12.7) – R-06: VOR allen Routen außer /auth/*, /gesundheit
  // und der öffentlichen Fernunterschrift, damit auch später unter /auth registrierte Routen (z. B. Sicherheit) gesperrt sind
  const sperren = (req, res, next) => {
    if (!req.ctx) return next();
    const pfad = req.path.toLowerCase();
    if (pfad.startsWith('/auth/') || pfad === '/gesundheit' || pfad.startsWith('/fern/')) return next();
    if (req.ctx.benutzer.muss_pin_aendern) return next(new ApiFehler(403, 'PIN_AENDERN', 'Bitte zuerst die PIN ändern.'));
    const zf = require('./routes/zweifaktor').stand(db, req.ctx.benutzer);
    if (zf.pflicht && !zf.aktiv) return next(new ApiFehler(403, '2FA_EINRICHTEN', 'Bitte zuerst die Zwei-Faktor-Anmeldung einrichten (Einstellungen → Sicherheit).'));
    next();
  };
  api.use(sperren);
  require('./routes/auth')(api, bt);
  require('./routes/fernunterschrift').oeffentlich(api, bt); // 12.9: ohne Anmeldung

  // Ab hier nur angemeldet – und erst nach Änderung einer vorgegebenen PIN
  api.use(angemeldet);
  api.use(sperren);
  // Inhaber 13.11.2026: Sicherheitsnetz – Polier/Mitarbeiter erhalten nie Aggregate über fremde Abwesenheiten
  api.use((req, res, next) => {
    const DS = require('./datenschutz');
    if (!req.ctx || DS.aggregateErlaubt(req.ctx)) return next();
    const json = res.json.bind(res);
    res.json = (wert) => json(DS.ohneFremdeAggregate(req.ctx, wert));
    next();
  });
  // 12.25: interne Kostenstellen (Büro, Werkstatt, Grube) haben keine Baustellen-Fachfunktionen
  api.use((req, res, next) => {
    const m = /^\/(?:baustellen\/(\d+)\/(?:positionen|auftrag|rechnungen|phase|phasen|fertigmeldung|abschluss|dokumente|nachtraege|leistungen|fremdleistungen|lv|lv-import|abschnitte)\b|kalkulation\/(\d+)$)/i.exec(req.path);
    if (!m) return next();
    const bs = db.eins('SELECT id, kst, name, intern FROM baustelle WHERE id = ?', Number(m[1] || m[2]));
    try { if (bs) require('./kostenstellen').nurBaustelle(bs, 'diese Funktion'); } catch (e) { return next(e); }
    next();
  });
  require('./routes/stammdaten')(api, bt);
  require('./routes/preise')(api, bt);
  require('./routes/zeit')(api, bt);
  require('./routes/abwesenheiten')(api, bt);
  require('./routes/berichte')(api, bt);
  require('./routes/kalkulation')(api, bt);
  require('./routes/positionen')(api, bt);
  require('./routes/benachrichtigungen')(api, bt);
  require('./routes/monat')(api, bt);
  require('./routes/benutzer')(api, bt);
  require('./routes/integrationen')(api, bt);
  require('./routes/fuhrpark')(api, bt);
  require('./routes/system')(api, bt);
  require('./routes/dienste')(api, bt);
  require('./routes/berichtfotos')(api, bt);
  require('./routes/stammdatenverwaltung')(api, bt);
  require('./routes/planer')(api, bt);
  require('./routes/dokumente')(api, bt);
  require('./routes/rechnungen')(api, bt);
  require('./routes/urlaub')(api, bt);
  require('./routes/importe')(api, bt);
  require('./routes/fernunterschrift').intern(api, bt);
  require('./routes/assistent')(api, bt);

  api.use((req, res, next) => next(nichtGefunden('Unbekannte API-Adresse.')));
  app.use('/api', api);

  // Oberfläche (statisch) + SPA-Fallback
  const publicDir = opt.publicDir || PUBLIC;
  app.use(express.static(publicDir, { index: 'index.html', fallthrough: true }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    // Fehlende Dateien (Endung) oder Punkt-Pfade (/.git/…) → 404 statt index.html
    if (/\.[A-Za-z0-9]{1,8}$/.test(req.path) || /(^|\/)\./.test(req.path)) {
      return res.status(404).type('text/plain; charset=utf-8').send('Nicht gefunden.');
    }
    const index = path.join(publicDir, 'index.html');
    if (fs.existsSync(index)) return res.sendFile(index);
    res.status(404).type('text/plain; charset=utf-8').send('BauTag: Oberfläche (app/public) ist noch nicht vorhanden.');
  });

  // Fehlerbehandlung
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof ApiFehler) {
      if (err.retryAfter) res.setHeader('Retry-After', String(err.retryAfter));
      return res.status(err.status).json({ fehler: err.message, code: err.code, ...(err.extra || {}) });
    }
    if (err && /UNIQUE constraint failed/.test(String(err.message))) return res.status(409).json({ fehler: 'Der Eintrag ist bereits vorhanden (doppelter Wert).', code: 'KONFLIKT' });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ fehler: 'Ungültiges JSON.', code: 'UNGUELTIG' });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ fehler: 'Anfrage zu groß.', code: 'UNGUELTIG' });
    if (err && err.status >= 400 && err.status < 500) return res.status(err.status).json({ fehler: 'Ungültige Anfrage.', code: 'UNGUELTIG' });
    console.error('[BauTag] Fehler:', err);
    res.status(500).json({ fehler: 'Interner Fehler. Bitte später erneut versuchen.', code: 'SERVER' });
  });

  app.bt = bt;
  app.schliessen = () => {
    bt.pushAus = true;
    clearInterval(bt.fuhrparkTimer);
    require('./ocr').beenden();
    db.schliessen();
    if (bt.uploadsTemp) { try { fs.rmSync(bt.uploads, { recursive: true, force: true }); } catch (_) { /* egal */ } }
  };
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  let app;
  try { app = createApp(); } catch (e) {
    if (e instanceof StartFehler) { console.error(`[BauTag] START VERWEIGERT: ${e.message}`); process.exit(1); }
    throw e;
  }
  for (const w of app.bt.warnungen) console.warn('[BauTag] WARNUNG: ' + w);
  const server = app.listen(port, () => {
    console.log(`BauTag läuft auf http://localhost:${port} (DB: ${app.bt.db.pfad})`);
  });
  const stopp = () => { server.close(() => { app.schliessen(); process.exit(0); }); };
  process.on('SIGINT', stopp);
  process.on('SIGTERM', stopp);
}

module.exports = { createApp, StartFehler };
