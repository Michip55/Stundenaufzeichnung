// „Morgen“ heißt im Planer: der nächste Arbeitstag (ohne Samstag, Sonntag und Feiertage – Feiertage kommen vom Server).
import { get } from './api.js';
import { fmt } from './ui.js';

// Menge der Feiertage (ISO-Datum) für das Jahr von `heute` und – rund um den Jahreswechsel – das Nachbarjahr
export async function feiertage(heute) {
  const jahr = Number(heute.slice(0, 4)), monat = Number(heute.slice(5, 7));
  const jahre = [jahr, ...(monat >= 11 ? [jahr + 1] : []), ...(monat <= 1 ? [jahr - 1] : [])];
  const listen = await Promise.all(jahre.map((j) => get(`/urlaub/feiertage?jahr=${j}`).catch(() => [])));
  const s = new Set(listen.flat().map((f) => f.datum));
  s.namen = new Map(listen.flat().map((f) => [f.datum, f.name])); // N-097: „Feiertag: Mariä Empfängnis“
  return s;
}
export const istArbeitstag = (iso, frei) => ![0, 6].includes(fmt.dt(iso).getDay()) && !(frei && frei.has(iso));
export function naechsterArbeitstag(iso, frei, schritt = 1) {
  let t = fmt.addTage(iso, schritt);
  for (let i = 0; i < 30 && !istArbeitstag(t, frei); i += 1) t = fmt.addTage(t, schritt);
  return t;
}
// „heute“ / „morgen“ nur für den echten Kalendertag, sonst Wochentag mit Datum („Mo 16.11.“)
export function tagName(iso, heute) {
  const d = fmt.dt(iso), kurz = `${fmt.WTK[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;
  return iso === heute ? 'heute' : iso === fmt.addTage(heute, 1) ? 'morgen' : kurz;
}
