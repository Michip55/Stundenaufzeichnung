// Entwurfsvideo "BauTag" – Drehbuch und Aufnahme.
// Voraussetzung: statischer Server im Repo-Wurzelverzeichnis, z. B.  python3 -m http.server 8765
// Aufruf:  node video/record.js [--out video/BauTag_Entwurfsvideo.mp4] [--dry]
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { Recorder } = require('./lib/recorder');
const { Director, signature } = require('./lib/director');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(__dirname, 'BauTag_Entwurfsvideo.mp4');
const BASE = process.env.BASE || 'http://localhost:8765';
const FRAMES = process.env.FRAMES || path.join(__dirname, 'frames');

const q = (id) => `[data-demo="${id}"]`;
let n = 0;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
  await page.goto(`${BASE}/video/stage.html`);
  const D = new Director(page);
  const S = (fn, a) => page.evaluate(fn, a);
  const wait = (ms) => page.waitForTimeout(ms);
  const demo = (dev, code) => D.frame(dev).evaluate(code);
  const t0 = Date.now();
  const mark = (label) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${label}`);

  // Gerät (neu) laden – verdeckt durch eine kurze Blende, damit kein weißer Blitz zu sehen ist
  async function load(dev, query, hash, { cover = true } = {}) {
    if (cover) { await S((d) => S.cover(d, true), dev); await wait(300); }
    await S(([d, qu, h]) => S.load(d, qu, h), [dev, `${query}&v=${++n}`, hash]);
    await wait(700);
    if (cover) { await S((d) => S.cover(d, false), dev); await wait(350); }
  }
  const url = (p) => S((p) => S.url('app.pichler-breitenau.at' + p), p);
  const caption = (c) => S((c) => S.caption(c), c);
  const bullets = async (k, gap = 450) => { for (let i = 0; i < k; i++) { await S((i) => S.bullet(i), i); await wait(gap); } };
  const card = (id, c) => S(([id, c]) => S.card(id, c), [id, c]);
  const cardsOff = () => S(() => S.cardsOff());
  const ringOff = () => S(() => S.ring(null));

  // ---------- Vorbereitung: alle drei Geräte mit Startzustand laden ----------
  await load('phone', 'rolle=mitarbeiter', '#/stempeluhr', { cover: false });
  await load('tablet', 'rolle=polier&szenario=abend', '#/bericht/uebersicht', { cover: false });
  await load('desktop', 'rolle=buero', '#/dashboard', { cover: false });
  await url('/dashboard');
  await S(() => { S.ui({ brand: false, chapters: false, caption: false }); S.cursorMode('hidden'); S.cursorJump(1700, 1000); });
  await wait(800);

  const rec = new Recorder(page, FRAMES);
  if (!DRY) await rec.start();

  // =====================================================================
  // INTRO
  // =====================================================================
  mark('Intro');
  await S(() => S.titleIn());
  await wait(4600);
  await S(() => { S.titleOut(); S.layout('trio'); S.headline({ k: 'Eine Plattform für den ganzen Betrieb', t: 'Handy, Tablet und PC – ein System', p: 'Die Partie stempelt am Handy, der Polier schließt den Bericht am Tablet ab,<br>das Büro rechnet am PC nach.' }); });
  await wait(6200);

  // =====================================================================
  // 1 EINSTEMPELN (Handy)
  // =====================================================================
  mark('1 Einstempeln');
  await S(() => { S.headline(null); S.layout('phone'); S.ui({ brand: true, chapters: true, caption: true }); S.chapter(0); });
  await caption({ kicker: 'Handy · Mitarbeiter', title: 'Einstempeln mit einem Tipp', body: 'Das Handy erkennt die Ankunft auf der Baustelle und schlägt das Einstempeln vor. Die Baustelle kommt aus dem Einsatzplan.', bullets: ['Standort nur beim Stempeln – kein Tracking', 'Gerätestunden per NFC-Aufkleber', 'Funktioniert auch ohne Empfang'] });
  await wait(1300);
  await bullets(3);
  await S(() => { S.cursorMode('touch'); S.cursorJump(1560, 900); });
  await demo('phone', () => demo.ankunft());
  await wait(1700);
  await D.ring('phone', q('hinweis-banner'), 6);
  await wait(1300);
  await ringOff();
  await D.tap('phone', q('ankunft-einstempeln'), { after: 1200 });
  await D.ring('phone', q('standort-badge'), 6);
  await card('live', { x: 1540, y: 330, w: 330, icon: 'live', title: 'Sofort im Büro sichtbar', text: 'Das Dashboard zeigt live, wer auf welcher Baustelle ist.' });
  await wait(2600);
  await ringOff();
  await D.tap('phone', q('geraet-scannen'), { after: 300 });
  await D.F.phone.locator('[data-demo="geraet-scan-overlay"][data-state="fertig"]').waitFor({ timeout: 8000 });
  await wait(900);
  await card('nfc', { x: 1540, y: 500, w: 330, icon: 'auto', title: 'Bagger 9 to. läuft auf KST 26-041', text: 'Handy an den NFC-Aufkleber halten – Gerätestunden landen im Bautagesbericht.' });
  await D.tap('phone', q('geraet-scan-fertig'), { after: 1500 });
  await D.ring('phone', q('geraet-laeuft'), 6);
  await wait(1500);
  await ringOff(); await cardsOff();

  // Sprachen + Baustellen-Modus
  await caption({ kicker: 'Handy · Für alle verständlich', title: 'Fünf Sprachen, extra große Tasten', body: 'Deutsch, Bosnisch/Kroatisch/Serbisch, Ungarisch, Rumänisch und Türkisch – mit einem Tipp umgeschaltet. Der Baustellen-Modus ist gemacht für Handschuhe und pralle Sonne.' });
  await wait(600);
  await D.tap('phone', q('sprache'), { after: 700 });
  await D.tap('phone', q('sprache-bks'), { after: 1900 });
  await D.tap('phone', q('sprache'), { after: 700 });
  await D.tap('phone', q('sprache-hu'), { after: 1900 });
  await D.tap('phone', q('sprache'), { after: 700 });
  await D.tap('phone', q('sprache-de'), { after: 900 });
  await D.tap('phone', q('baustellen-modus'), { after: 2600 });
  await D.tap('phone', q('baustellen-modus'), { after: 600 });

  // Polier: Kolonne
  await caption({ kicker: 'Handy · Polier', title: 'Die ganze Partie auf einmal', body: 'Der Polier stempelt seine Kolonne gesammelt ein – ideal für Mitarbeiter ohne eigenes Smartphone.' });
  await load('phone', 'rolle=polier', '#/kolonne');
  await wait(900);
  await D.tap('phone', q('kolonne-einstempeln'), { after: 1300 });
  await card('kol', { x: 1540, y: 400, w: 330, tone: 'green', icon: 'users', title: '6 Mitarbeiter eingestempelt', text: 'Urlaub und Krankenstand werden automatisch berücksichtigt.' });
  await wait(2800);
  await cardsOff();

  // =====================================================================
  // 2 BERICHT PER SPRACHE (Handy)
  // =====================================================================
  mark('2 Bericht');
  await S(() => S.chapter(1));
  await caption({ kicker: 'Handy · Polier · Bautagesbericht', title: 'Den Bericht einfach diktieren', body: 'Kopf, Personal und Wetter sind schon ausgefüllt. Den Rest spricht der Polier ein – die KI füllt die Felder, er prüft nur noch.', bullets: ['Personal & Stunden aus den Stempelzeiten', 'Wetter automatisch, Schlechtwetter-Vorschlag', 'Lieferschein fotografieren statt abtippen'] });
  await load('phone', 'rolle=polier&szenario=abend&bericht=leer', '#/bericht/1');
  await bullets(3);
  await D.ring('phone', q('wetter-karte'), 6);
  await wait(1200);
  await ringOff();
  await D.tap('phone', q('wetter-demo-regen'), { after: 900 });
  await D.ring('phone', q('sw-vorschlag'), 6);
  await card('sw', { x: 1540, y: 380, w: 330, icon: 'cloud', title: 'Starkregen gemeldet', text: 'BauTag schlägt vor, Schlechtwetter (SW) für die Partie einzutragen.' });
  await wait(2600);
  await ringOff(); await cardsOff();
  await D.tap('phone', q('wetter-demo-regen'), { after: 700 });

  await D.tap('phone', q('bericht-diktieren'), { after: 400 });
  await card('mic', { x: 1540, y: 300, w: 330, icon: 'auto', title: 'Einfach sprechen', text: '„Heute Frostschutz eingebaut, 42 Tonnen, Bagger 9 Tonnen 8 Stunden …“' });
  await D.F.phone.locator('[data-demo="diktat-overlay"][data-state="fertig"]').waitFor({ timeout: 15000 });
  await cardsOff();
  await card('ki', { x: 1540, y: 420, w: 330, tone: 'green', icon: 'auto', title: '7 Felder automatisch ausgefüllt', text: 'Geräte, Material und Arbeitsleistung aus einem Satz – der Polier prüft nur noch.' });
  await wait(2400);
  await D.tap('phone', q('diktat-uebernehmen'), { after: 1100 });
  await cardsOff();
  await D.ring('phone', q('ki-chip'), 6);
  await wait(1800);
  await ringOff();
  await D.tap('phone', q('ki-bestaetigen'), { after: 700 });
  await D.tap('phone', q('wizard-weiter'), { after: 1200 });

  await D.tap('phone', q('lieferschein-scannen'), { after: 300 });
  await D.F.phone.locator('[data-demo="lieferschein-overlay"][data-state="fertig"]').waitFor({ timeout: 10000 });
  await wait(1200);
  await card('ls', { x: 1540, y: 400, w: 330, icon: 'doc', title: 'Lieferschein erkannt', text: 'Lieferant, Material und Mengen werden übernommen – kein Abtippen.' });
  await D.tap('phone', q('lieferschein-uebernehmen'), { after: 1400 });
  await D.ring('phone', q('lieferschein-angehaengt'), 6);
  await wait(1800);
  await ringOff(); await cardsOff();

  // =====================================================================
  // 3 UNTERSCHRIFT & PDF (Tablet)
  // =====================================================================
  mark('3 Tablet');
  await S(() => { S.chapter(2); S.layout('tablet'); });
  await caption({ kicker: 'Tablet · Bei der Bauherrschaft', title: 'Unterschrift direkt am Tablet', body: 'Der Bericht sieht aus wie die gewohnte Vorlage. Der Bauherr unterschreibt vor Ort – das PDF geht sofort an den Auftraggeber.', bullets: ['Gleiche Felder wie der Papier-Bericht', 'Alternativ Unterschrift per SMS-Link', 'Kein Zettel geht mehr verloren'] });
  await wait(1300);
  await bullets(3);
  await D.ring('tablet', q('bericht-formular'), 4);
  await wait(1200);
  await ringOff();
  await D.scrollBy('tablet', '#view', 420, 1300);
  await D.scrollBy('tablet', '#view', 420, 1300);
  await D.tap('tablet', q('signatur-auftragnehmer-hinterlegt'), { after: 900 });
  await D.sign('tablet', q('signatur-bauherr'), signature(), { steps: 2, speed: 6 });
  await wait(700);
  await D.tap('tablet', q('bericht-senden'), { after: 1900 });
  await card('mail', { x: 1490, y: 70, w: 360, tone: 'green', icon: 'mail', title: 'PDF an Auftraggeber gesendet', text: 'Ohne interne Preise – das Büro hat den Bericht sofort.' });
  await wait(2200);
  await D.tap('tablet', q('senden-fertig'), { after: 900 });
  await cardsOff();

  // =====================================================================
  // 4 LIVE-ÜBERBLICK (PC)
  // =====================================================================
  mark('4 Dashboard');
  await S(() => { S.chapter(3); S.layout('desktop'); S.cursorMode('arrow'); S.cursorJump(1500, 980); });
  await caption({ kicker: 'PC · Büro', title: 'Alles live im Überblick', body: 'Wer ist wo, welche Berichte warten auf Freigabe, wo droht eine Überschreitung der Arbeitszeit.', bullets: ['24 von 30 eingestempelt – live', 'Warnungen nach Arbeitszeitgesetz', 'Fragen in Alltagssprache stellen'] });
  await wait(1300);
  await bullets(1, 200);
  await D.ring('desktop', q('kpi-eingestempelt'), 6);
  await wait(1700);
  await S(() => S.bullet(1));
  await D.ring('desktop', q('warnung-offen'), 6);
  await wait(1900);
  await ringOff();
  await S(() => S.bullet(2));
  await D.type('desktop', q('frage-input'), 'Wie viel Frostschutz auf KST 26-041?', { delay: 38, after: 300 });
  await D.loc('desktop', q('frage-input')).press('Enter');
  await wait(900);
  await D.ring('desktop', q('frage-antwort'), 6);
  await wait(3000);
  await ringOff();
  await D.tap('desktop', q('frage-schliessen'), { after: 500 });

  // Bericht als PDF
  await caption({ kicker: 'PC · Bautagesberichte', title: 'Wie gewohnt – nur digital', body: 'Die PDF-Ansicht folgt 1:1 der bestehenden Vorlage. Das Büro prüft und gibt mit einem Klick frei.' });
  await D.tap('desktop', q('nav-berichte'), { after: 900 });
  await url('/berichte');
  await D.tap('desktop', q('bericht-zeile-26-041_2026-11-11'), { after: 1200 });
  await url('/berichte/26-041_2026-11-11');
  await D.ring('desktop', q('pdf-seite'), 4);
  await wait(2200);
  await ringOff();
  await D.scrollBy('desktop', '#view', 380, 1400);
  await D.tap('desktop', q('bericht-freigeben'), { after: 1500 });

  // =====================================================================
  // 5 PREISE (PC)
  // =====================================================================
  mark('5 Preise');
  await S(() => S.chapter(4));
  await caption({ kicker: 'PC · Stammdaten', title: 'Preise einmal hinterlegen', body: 'Lohngruppen, Geräte, Material und Leistungspositionen – jeweils mit internen Kosten und Verrechnungssätzen.', bullets: ['Änderungen wirken sofort', 'Auswirkung je Baustelle sichtbar'] });
  await D.tap('desktop', q('nav-preise'), { after: 900 });
  await url('/preise/lohn');
  await bullets(1, 0);
  await D.tap('desktop', q('preise-tab-geraete'), { after: 900 });
  await url('/preise/geraete');
  await D.type('desktop', q('preis-geraete-b9-kosten'), '42,00', { delay: 110, after: 250, clear: true });
  await D.loc('desktop', q('preis-geraete-b9-kosten')).press('Enter');
  await wait(900);
  await S(() => S.bullet(1));
  await D.ring('desktop', q('preise-auswirkung'), 6);
  await card('preis', { x: 1500, y: 60, w: 360, icon: 'euro', title: 'Bagger 9 to.: € 34 → € 42 / Std.', text: 'Die Auswirkung auf den Deckungsbeitrag jeder Baustelle wird sofort berechnet.' });
  await wait(3000);
  await ringOff(); await cardsOff();

  // =====================================================================
  // 6 NACHKALKULATION (PC)
  // =====================================================================
  mark('6 Nachkalkulation');
  await S(() => S.chapter(5));
  await caption({ kicker: 'PC · Büro & Geschäftsführung', title: 'Nachkalkulation je Baustelle – automatisch', body: 'Jeder Bautagesbericht fließt mit den hinterlegten Preisen sofort ein – nicht erst nach der Schlussrechnung.', bullets: ['Erlös, Kosten und Deckungsbeitrag tagesaktuell', 'Hochrechnung bis Bauende', 'Automatische Hinweise, z. B. offene Regie'] });
  await D.tap('desktop', q('auswirkung-26-041'), { after: 1300 });
  await url('/nachkalkulation/26-041');
  await bullets(1, 0);
  await D.ring('desktop', q('kpi-db-prozent'), 6);
  await wait(2200);
  await S(() => S.bullet(1));
  await D.ring('desktop', q('kalk-prognose'), 6);
  await card('prog', { x: 1500, y: 60, w: 360, icon: 'chart', title: 'Prognose bis Bauende', text: 'Bei aktuellem Verlauf DB 15,8 % statt kalkuliert 22,5 % – rechtzeitig gegensteuern.' });
  await wait(3200);
  await cardsOff();
  await S(() => S.bullet(2));
  await D.ring('desktop', q('insight-1'), 6);
  await wait(2600);
  await ringOff();
  await D.scrollBy('desktop', '#view', 520, 1500);
  await wait(1800);
  await D.scrollBy('desktop', '#view', -520, 900);

  // =====================================================================
  // 7 ROLLEN & BERECHTIGUNGEN (PC)
  // =====================================================================
  mark('7 Rollen');
  await S(() => S.chapter(6));
  await caption({ kicker: 'PC · Geschäftsführung', title: 'Wer sieht was – klar geregelt', body: 'Preise und Nachkalkulation sehen nur Büro, Geschäftsführung und Bauleitung. Für Polier und Mitarbeiter ist das fix gesperrt.', bullets: ['Rechte-Matrix mit Änderungsprotokoll', '„Ansicht testen als …“ mit einem Klick', 'Gesperrte Daten erreichen das Handy gar nicht'] });
  await load('desktop', 'rolle=gf', '#/benutzer');
  await url('/benutzer');
  await bullets(1, 0);
  await D.ring('desktop', q('rechte-matrix'), 4);
  await wait(1800);
  await D.scrollTo('desktop', q('recht-zeile-kalk'), 'center', 900);
  await D.ring('desktop', q('recht-zeile-kalk'), 4);
  await D.moveTo('desktop', q('recht-kalk-polier'));
  await wait(2200);
  await ringOff();
  await S(() => S.bullet(1));
  await D.scrollTo('desktop', q('vorschau-polier'), 'center', 700);
  await D.tap('desktop', q('vorschau-polier'), { after: 1400 });
  await card('vor', { x: 1500, y: 60, w: 360, icon: 'users', title: 'Ansicht als Polier', text: 'Keine Preise, keine €-Werte, keine Nachkalkulation im Menü.' });
  await wait(2600);
  await demo('desktop', () => demo.go('/nachkalkulation/26-041'));
  await url('/nachkalkulation/26-041');
  await wait(900);
  await S(() => S.bullet(2));
  await D.ring('desktop', q('kein-zugriff'), 6);
  await wait(2600);
  await ringOff(); await cardsOff();
  await D.tap('desktop', q('vorschau-beenden'), { after: 1000 });

  // =====================================================================
  // 8 LOHN-AUSWERTUNG (PC)
  // =====================================================================
  mark('8 Lohn');
  await S(() => S.chapter(7));
  await caption({ kicker: 'PC · Lohnverrechnung', title: 'Monatsabschluss auf Knopfdruck', body: 'Stunden, Überstunden, Schlechtwetter, Krankenstand, Urlaub und SEG-Zulagen – geprüft und fertig für die Lohnverrechnung.', bullets: ['Export für die Lohnverrechnung (z. B. BMD)', 'Grundlage für die BUAK-Meldung'] });
  await D.tap('desktop', q('nav-monat'), { after: 1200 });
  await url('/monat');
  await D.ring('desktop', q('monat-matrix'), 4);
  await wait(2000);
  await ringOff();
  await S(() => S.bullet(0));
  await D.tap('desktop', q('export-lohn'), { after: 2200 });
  await D.tap('desktop', q('export-fertig'), { after: 700 });
  await S(() => S.bullet(1));
  await D.tap('desktop', q('export-buak'), { after: 2000 });
  await D.tap('desktop', q('export-fertig'), { after: 900 });

  // =====================================================================
  // OUTRO
  // =====================================================================
  mark('Outro');
  await S(() => { S.cursorMode('hidden'); S.ui({ chapters: false, caption: false }); S.chapter(8); S.layout('hidden');
    S.headline({ k: 'Entwurf zur Besprechung', t: 'BauTag – Zeit, Bericht, Kalkulation', p: 'Nächste Schritte: Konzept besprechen · Prototyp mit zwei Polieren testen · Pilot mit einer Partie ab Saisonstart 2027' }); });
  await wait(1100);
  await Promise.all([
    load('phone', 'rolle=polier&szenario=tag', '#/stempeluhr', { cover: false }),
    load('desktop', 'rolle=buero', '#/nachkalkulation/26-041', { cover: false }),
  ]);
  await url('/nachkalkulation/26-041');
  await D.scrollBy('tablet', '#view', -2000, 300);
  await S(() => S.layout('trio'));
  await wait(7500);
  await S(() => S.fade(true));
  await wait(1200);

  if (!DRY) {
    await rec.stop();
    console.log('Frames:', rec.stats());
    rec.assemble(OUT);
    console.log('Video:', OUT, (fs.statSync(OUT).size / 1e6).toFixed(1), 'MB');
  }
  mark('Ende');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
