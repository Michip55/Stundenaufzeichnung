// Reine Regeln des Baustellenplaners und der Fuhren (ohne DOM, ohne Netz) – in Node unter tests/unit/plan-regeln.test.js geprüft.
// Korrekturen Nachprüfung (API.md 14.1). Keine Preise.

const WTK = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const dt = (iso) => new Date(`${iso}T12:00:00`);
const plusTage = (iso, n) => { const d = dt(iso); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const kurz = (iso) => `${WTK[dt(iso).getDay()]} ${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
const istWochenende = (iso) => [0, 6].includes(dt(iso).getDay());

/**
 * Fuhren-Warteschlange (N-017): vorläufig = später erneut senden. Wie die Stempel-Warteschlange (M-04) bleiben
 * auch 401/403 (Sitzung abgelaufen, PIN ändern) gemerkt – nach der Anmeldung wird nachgesendet.
 */
// 15.5 (F-030): 409 ERSTELLER_ANDERS = inzwischen ist eine andere Person angemeldet → Meldung bleibt gemerkt
export const fuhreVorlaeufig = (x) => !!x && (x.netz || x.status >= 500 || x.status === 429 || x.status === 408 || x.status === 401 || x.status === 403 || x.code === 'ERSTELLER_ANDERS');
/** Anmeldung nötig → Nachsenden abbrechen (nicht weiter probieren) */
export const fuhreAnmeldungNoetig = (x) => !!x && (x.status === 401 || x.status === 403);

/** Zuletzt gemerkte Meldung je Fuhre (N-039: „Losgefahren“ und danach „Abgeladen“ ohne Netz → es zählt „Abgeladen“) */
export const letzteMeldung = (warten, fuhreId) => { let w = null; for (const x of warten || []) if (Number(x.fuhreId) === Number(fuhreId)) w = x; return w; };

/** LKW-Auswahl der Fuhren (N-102): nur Klasse LKW (Sattel-/Zugmaschinen sind Klasse lkw), keine PKW, Busse, Baumaschinen, Anhänger */
export const istLkw = (a) => !!a && /^lkw$/i.test(String(a.klasse || '')) && a.status !== 'ausgeschieden' && !a.ausgeschieden;
export const lkwText = (a) => `${a.bezeichnung || a.nummer || 'LKW'}${a.kennzeichen ? ` · ${a.kennzeichen}` : ''}${a.gesperrt || a.status === 'gesperrt' ? ' – gesperrt' : ''}`;

/** Die nächsten n Arbeitstage nach iso (ohne Sa/So und Feiertage, N-092) */
export function kopieTage(iso, n, frei) {
  const l = []; let t = iso;
  for (let i = 0; l.length < n && i < 60; i += 1) { t = plusTage(t, 1); if (!istWochenende(t) && !(frei && frei.has(t))) l.push(t); }
  return l;
}

/** Zahl für „Plan veröffentlichen“ oben (N-049): geänderte Einsätze/Fuhren plus noch nicht gespeicherte Vorschau-Einsätze */
export function pubAnzahl(d, darfBs = () => true) {
  const vorschau = ((d && d.einsaetze) || []).filter((e) => e.vorschau && darfBs(e.baustelleId)).length;
  return ((d && d.unveroeffentlicht) || 0) + vorschau;
}

/** Beschriftung „Notizen von … übernehmen“ (N-098) – die Quelle ist der Tag, aus dem die Vorschau stammt */
export const vortagNotizenText = (quelleDatum, heute) => `Notizen von ${!quelleDatum ? 'gestern' : quelleDatum === plusTage(heute, -1) ? 'gestern' : quelleDatum === heute ? 'heute' : kurz(quelleDatum)} übernehmen`;
export const vortagNotizenToast = (quelleDatum, heute) => `${vortagNotizenText(quelleDatum, heute).replace(/ übernehmen$/, '')} übernommen.`;

/** Rückmeldung nach dem Veröffentlichen (N-094): Personen und – wenn mehr – Nachrichten getrennt nennen */
export function pubToast(r) {
  const n = (r && r.benachrichtigt) || 0;
  const p = r && r.personen != null ? r.personen : n;
  return `Veröffentlicht – ${p} Person${p === 1 ? '' : 'en'} benachrichtigt${n > p ? ` (${n} Nachrichten)` : ''}.`;
}

/** Leerzeile in „Mein Einsatz – Diese Woche“ (N-097): Wochenende/Feiertag statt „noch nicht eingeteilt“ */
export function wochenLeerText(iso, frei) {
  const name = frei && frei.namen && frei.namen.get(iso);
  if (frei && frei.has(iso)) return name ? `Feiertag: ${name}` : 'Feiertag';
  if (istWochenende(iso)) return 'frei (Wochenende)';
  return 'noch nicht eingeteilt';
}
/** Leertext der Karte „Mein Einsatz“ (N-097): nennt den nächsten Arbeitstag statt „morgen“, wenn das nicht der Kalender-Morgen ist */
export const einsatzLeerText = (heute, naechster) => (naechster === plusTage(heute, 1)
  ? 'Für heute und morgen ist noch kein Einsatz veröffentlicht.'
  : `Für heute und den nächsten Arbeitstag (${kurz(naechster)}) ist noch kein Einsatz veröffentlicht.`);

/** Reiter „Meine Partie“ (N-058): heute, ein früherer Einsatztag (Sa/So/Feiertag) und der nächste Arbeitstag */
export function partieReiter(heute, einsatztag, naechster) {
  const l = [heute];
  if (einsatztag && einsatztag !== heute && einsatztag < naechster) l.push(einsatztag);
  if (naechster !== heute) l.push(naechster);
  return l;
}
