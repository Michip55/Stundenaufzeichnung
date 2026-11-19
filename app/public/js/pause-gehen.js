// BauTag – Begrüßung und „Pause beim Gehen“ (Inhaber 19.11.2026, API.md 15.27).
// Reine Funktionen ohne Browser-Abhängigkeit (Uhrzeiten in der Ortszeit des Geräts wie fmt.uhr), damit sie auch unter
// Node getestet werden können. Der Dialog selbst steht in pausen.js, das Buchen in views/stempeln.js.

/**
 * Name für die Begrüßung: die meisten Personen sind als „Nachname Vorname“ angelegt („Pilz Thomas“) – deshalb das
 * ZWEITE Wort; bei nur einem Wort dieses. Leerzeichen am Rand und doppelte Leerzeichen zählen nicht.
 */
export function grussName(name) {
  const w = String(name == null ? '' : name).trim().split(/\s+/).filter(Boolean);
  return w.length >= 2 ? w[1] : w[0] || '';
}

const MS_MIN = 60000;
const VIERTEL = 15 * MS_MIN;
/** so viele Minuten Arbeit müssen neben der Pause in der Schicht liegen, sonst „passt nicht hinein“ */
export const MIN_ARBEIT_MIN = 5;

const p2 = (n) => String(n).padStart(2, '0');
/** HH:MM in Ortszeit */
export const hm = (ms) => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const ms = (z) => (typeof z === 'number' ? z : new Date(z).getTime());
const dauerText = (min) => (min < 60 ? `${min} Min` : `${Math.floor(min / 60)} Std.${min % 60 ? ` ${min % 60} Min` : ''}`);

/** Buchungen der Stempeluhr zeitlich sortiert (gleiche Zeit: Reihenfolge bleibt) */
const sortiert = (buch) => (buch || []).map((b, i) => ({ b, i, t: ms(b.zeit) })).filter((x) => Number.isFinite(x.t)).sort((a, b) => a.t - b.t || a.i - b.i).map((x) => x.b);

/** Beginn der laufenden Schicht (ms): letztes „Kommen“ in den heutigen Buchungen, sonst `schichtBeginn` des Servers */
export function schichtStart(st) {
  if (!st) return null;
  const k = sortiert(st.heute && st.heute.buchungen).filter((b) => b.typ === 'kommen').pop();
  if (k) return ms(k.zeit);
  return st.schichtBeginn ? ms(st.schichtBeginn) : null;
}

/** Ist in der laufenden Schicht schon eine Pause gebucht (auch offline, noch nicht gesendet)? */
export function pauseInSchicht(st) {
  if (!st) return false;
  if (st.pauseInSchicht === true) return true;
  const start = schichtStart(st);
  return (st.heute && st.heute.buchungen || []).some((b) => b.typ === 'pause_start' && (start == null || ms(b.zeit) >= start));
}

/** Soll „Gehen“ nach der Pause fragen? Nur bei laufender Arbeit ohne Pause in dieser Schicht (nicht während einer Pause). */
export const fragePauseBeimGehen = (st) => !!st && st.status === 'arbeit' && schichtStart(st) != null && !pauseInSchicht(st);

/** Zeitpunkt (ms) für eine Uhrzeit „HH:MM“: das letzte Auftreten bis `jetzt` (über Mitternacht: gestern) */
export function zeitpunktAus(hhmm, jetzt) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  const d = new Date(jetzt);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (d.getTime() > jetzt) d.setDate(d.getDate() - 1);
  return d.getTime();
}

/**
 * Vorschlag für „Beginn ca.“ (ms): 12:00, wenn eine Pause der Dauer `dauer` dort in die Schicht passt; sonst die Mitte der
 * Schicht, auf 15 Min gerundet und so verschoben, dass die Pause zwischen Kommen und jetzt liegt.
 */
export function vorschlagBeginn(start, jetzt, dauer = 30) {
  const d = dauer * MS_MIN;
  const mittag = zeitpunktAus('12:00', jetzt);
  if (mittag >= start && mittag + d <= jetzt) return mittag;
  let m = Math.round((start + (jetzt - start) / 2 - d / 2) / VIERTEL) * VIERTEL;
  if (m < start) m = Math.ceil(start / VIERTEL) * VIERTEL;
  if (m + d > jetzt) m = Math.floor((jetzt - d) / VIERTEL) * VIERTEL;
  if (m < start) m = start; // Schicht zu kurz – die Prüfung sagt es
  return m;
}

/**
 * Prüft die nachgetragene Pause wie der Server (Meldung auf Deutsch oder null).
 * `beginn` aus dem Feld hat volle Minuten: liegt es in derselben Minute wie das Kommen, gilt der Zeitpunkt des Kommens.
 * @returns {{fehler:string}|{beginn:number, ende:number}}
 */
export function pruefePause({ start, jetzt, beginn, dauer, buchungen }) {
  if (beginn == null || !Number.isFinite(beginn)) return { fehler: 'Bitte den Beginn der Pause als Uhrzeit eintragen (z. B. 12:00).' };
  const vergangen = Math.floor((jetzt - start) / MS_MIN);
  if (vergangen < dauer + MIN_ARBEIT_MIN) return { fehler: `Seit dem Kommen um ${hm(start)} Uhr sind erst ${dauerText(Math.max(0, vergangen))} vergangen – eine Pause von ${dauer} Min passt nicht hinein. Bitte eine kürzere Pause oder „Keine Pause“ wählen.` };
  if (beginn < start && start - beginn < MS_MIN) beginn = start;
  const ende = beginn + dauer * MS_MIN;
  if (beginn < start) return { fehler: `Die Pause kann frühestens um ${hm(start)} Uhr beginnen – da bist du gekommen.` };
  if (ende > jetzt) return { fehler: `Die Pause muss bis jetzt (${hm(jetzt)} Uhr) vorbei sein – bitte einen früheren Beginn wählen (spätestens ${hm(Math.floor((jetzt - dauer * MS_MIN) / MS_MIN) * MS_MIN)} Uhr).` };
  const dazwischen = sortiert(buchungen).find((b) => { const t = ms(b.zeit); return t > beginn && t <= ende; });
  if (dazwischen) {
    return { fehler: dazwischen.typ === 'wechsel'
      ? `Um ${hm(ms(dazwischen.zeit))} Uhr hast du die Baustelle gewechselt – die Pause muss davor enden oder danach beginnen.`
      : `Um ${hm(ms(dazwischen.zeit))} Uhr gibt es schon eine Buchung – die Pause darf sie nicht überschneiden.` };
  }
  return { beginn, ende };
}
