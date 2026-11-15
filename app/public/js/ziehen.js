// Ziehen & Ablegen mit Zeigerereignissen – funktioniert mit Maus, Stift und Finger (Tablet).
// Maus/Stift: Ziehen beginnt nach wenigen Pixeln. Finger: kurz halten (damit Wischen weiter scrollt), dann ziehen.
// Die Tastatur-Alternative (auswählen → Ziel wählen) liegt bei der jeweiligen Ansicht.
export function ziehbar(root, { quelle, ziel, darf = () => true, ablegen, start, ende }) {
  let z = null; // {el, id, x, y, aktiv, geist, timer, zielEl}
  let klickSperre = 0;
  const zielBei = (x, y) => { const e = document.elementFromPoint(x, y); const t = e && e.closest ? e.closest(ziel) : null; return t && root.contains(t) && darf(z.el, t) ? t : null; };
  function beginne() {
    if (!z || z.aktiv) return;
    z.aktiv = true;
    const r = z.el.getBoundingClientRect();
    const g = z.el.cloneNode(true);
    g.classList.add('zieh-geist'); g.removeAttribute('id'); g.setAttribute('aria-hidden', 'true');
    g.style.cssText = `position:fixed;left:0;top:0;width:${Math.min(r.width, 260)}px;pointer-events:none;z-index:9999;`;
    document.body.appendChild(g); z.geist = g; z.dx = Math.min(z.x - r.left, 240); z.dy = z.y - r.top;
    z.el.classList.add('wird-gezogen'); root.classList.add('zieht'); document.body.classList.add('zieht-global');
    if (start) start(z.el);
    bewege(z.x, z.y);
  }
  function bewege(x, y) {
    z.geist.style.transform = `translate(${x - z.dx}px, ${y - z.dy}px)`;
    const t = zielBei(x, y);
    if (t !== z.zielEl) { if (z.zielEl) z.zielEl.classList.remove('zieh-ziel'); if (t) t.classList.add('zieh-ziel'); z.zielEl = t; }
    // am Rand eines waagrecht scrollbaren Bereichs mitscrollen
    const sc = root.querySelector('[data-zieh-scroll]');
    if (sc) { const b = sc.getBoundingClientRect(); if (x > b.right - 36) sc.scrollLeft += 14; else if (x < b.left + 36) sc.scrollLeft -= 14; }
  }
  function schluss(ablage) {
    if (!z) return;
    clearTimeout(z.timer);
    const alt = z; z = null;
    if (!alt.aktiv) return;
    if (alt.geist) alt.geist.remove();
    alt.el.classList.remove('wird-gezogen'); root.classList.remove('zieht'); document.body.classList.remove('zieht-global');
    if (alt.zielEl) alt.zielEl.classList.remove('zieh-ziel');
    klickSperre = Date.now() + 350;
    if (ende) ende(alt.el);
    if (ablage && alt.zielEl) ablegen(alt.el, alt.zielEl);
  }
  const runter = (e) => {
    if (e.button != null && e.button !== 0) return;
    const q = e.target.closest && e.target.closest(quelle);
    if (!q || !root.contains(q) || q.hasAttribute('data-zieh-aus')) return;
    z = { el: q, id: e.pointerId, x: e.clientX, y: e.clientY, aktiv: false, art: e.pointerType };
    if (e.pointerType === 'touch') z.timer = setTimeout(beginne, 280);
  };
  const beweg = (e) => {
    if (!z || e.pointerId !== z.id) return;
    const weit = Math.hypot(e.clientX - z.x, e.clientY - z.y);
    if (!z.aktiv) {
      if (z.art === 'touch') { if (weit > 10) { clearTimeout(z.timer); z = null; } return; } // Wischen = Scrollen
      if (weit < 6) return;
      beginne();
    }
    z.x = e.clientX; z.y = e.clientY; bewege(e.clientX, e.clientY);
  };
  const hoch = (e) => { if (z && e.pointerId === z.id) schluss(true); };
  const abbruch = (e) => { if (z && (!e.pointerId || e.pointerId === z.id)) schluss(false); };
  const taste = (e) => { if (e.key === 'Escape' && z) schluss(false); };
  const wisch = (e) => { if (z && z.aktiv) e.preventDefault(); }; // während des Ziehens nicht scrollen
  const klick = (e) => { if (Date.now() < klickSperre) { e.stopPropagation(); e.preventDefault(); klickSperre = 0; } };
  const menue = (e) => { if (z && z.art === 'touch') e.preventDefault(); };
  const keinNativ = (e) => { if (e.target.closest && e.target.closest(quelle)) e.preventDefault(); };
  root.addEventListener('pointerdown', runter);
  root.addEventListener('dragstart', keinNativ);
  root.addEventListener('click', klick, true);
  root.addEventListener('contextmenu', menue);
  document.addEventListener('pointermove', beweg);
  document.addEventListener('pointerup', hoch);
  document.addEventListener('pointercancel', abbruch);
  document.addEventListener('keydown', taste);
  document.addEventListener('touchmove', wisch, { passive: false });
  return () => {
    schluss(false);
    document.removeEventListener('pointermove', beweg); document.removeEventListener('pointerup', hoch);
    document.removeEventListener('pointercancel', abbruch); document.removeEventListener('keydown', taste);
    document.removeEventListener('touchmove', wisch);
  };
}
