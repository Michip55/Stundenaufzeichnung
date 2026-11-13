// BauTag – „Zum Startbildschirm hinzufügen“ (Ausbaustufe 2, Schritt 1).
// Android/Chrome/Edge: der Browser meldet `beforeinstallprompt` – wir merken ihn und zeigen eine eigene Schaltfläche.
// iPhone/iPad (Safari): es gibt keinen Dialog – wir erklären die drei Handgriffe.
let merker = null;
const melde = () => window.dispatchEvent(new CustomEvent('bt:install'));

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); merker = e; melde(); });
window.addEventListener('appinstalled', () => { merker = null; try { localStorage.setItem('bt_installiert', '1'); } catch (x) { /* egal */ } melde(); });

export function installStatus() {
  const ua = navigator.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const installiert = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  return {
    installiert,
    kannFragen: !!merker,                       // Browser bietet den Installations-Dialog an
    ios,
    android: /Android/.test(ua),
    art: installiert ? 'installiert' : merker ? 'dialog' : ios ? 'ios' : 'anleitung',
  };
}
// Öffnet den Installations-Dialog des Browsers. Rückgabe: 'accepted' | 'dismissed' | 'nicht-moeglich'
export async function installieren() {
  if (!merker) return 'nicht-moeglich';
  const e = merker;
  try { await e.prompt(); const wahl = await e.userChoice; merker = null; melde(); return (wahl && wahl.outcome) || 'dismissed'; }
  catch (x) { merker = null; melde(); return 'nicht-moeglich'; }
}
