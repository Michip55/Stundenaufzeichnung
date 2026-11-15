// "Regie"-Hilfsfunktionen: bewegen den sichtbaren Cursor auf der Bühne zu Elementen in den Geräte-iframes,
// tippen/klicken, schreiben, scrollen und heben Bereiche hervor.
class Director {
  constructor(page) {
    this.page = page;
    this.F = {
      phone: page.frameLocator('#f-phone'),
      tablet: page.frameLocator('#f-tablet'),
      desktop: page.frameLocator('#f-desktop'),
    };
  }

  S(fn, arg) { return this.page.evaluate(fn, arg); }
  wait(ms) { return this.page.waitForTimeout(ms); }
  frame(dev) { return this.page.frame({ name: dev }); }
  loc(dev, sel) { return typeof sel === 'string' ? this.F[dev].locator(sel).first() : sel; }

  async rect(dev, sel) {
    const l = this.loc(dev, sel);
    await l.waitFor({ state: 'visible', timeout: 15000 });
    return l.boundingBox();
  }

  async scrollTo(dev, sel, block = 'center', ms = 750) {
    const l = this.loc(dev, sel);
    await l.waitFor({ state: 'attached', timeout: 15000 });
    // bewusst kein scrollIntoView: das würde auch die Bühne (Elterndokument) mitscrollen
    await l.evaluate((el, b) => {
      let p = el.parentElement;
      const scrollable = (n) => n.clientHeight > 250 && n.scrollHeight > n.clientHeight + 40 && /(auto|scroll)/.test(getComputedStyle(n).overflowY);
      while (p && p !== document.body && !scrollable(p)) p = p.parentElement;
      const doc = !p || p === document.body;
      const sc = doc ? document.scrollingElement : p;
      const er = el.getBoundingClientRect();
      const pr = doc ? { top: 0, height: window.innerHeight } : sc.getBoundingClientRect();
      const target = b === 'start' ? sc.scrollTop + (er.top - pr.top) - 16 : sc.scrollTop + (er.top - pr.top) - (pr.height - er.height) / 2;
      sc.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
      // warten, bis die Bewegung zur Ruhe kommt
      return new Promise((res) => {
        let last = -1, same = 0, t = 0;
        const iv = setInterval(() => {
          t += 80;
          if (sc.scrollTop === last) same++; else { same = 0; last = sc.scrollTop; }
          if (same >= 3 || t > 2500) { clearInterval(iv); res(); }
        }, 80);
      });
    }, block);
    await this.wait(Math.min(ms, 250));
  }

  // Elementinhalt (z.B. scrollender Container) sanft um dy Pixel scrollen
  async scrollBy(dev, sel, dy, ms = 800) {
    const l = this.loc(dev, sel);
    await l.evaluate((el, d) => new Promise((res) => {
      el.scrollBy({ top: d, behavior: 'smooth' });
      let last = -1, same = 0, t = 0;
      const iv = setInterval(() => {
        t += 80;
        if (el.scrollTop === last) same++; else { same = 0; last = el.scrollTop; }
        if (same >= 3 || t > 2500) { clearInterval(iv); res(); }
      }, 80);
    }), dy);
    await this.wait(Math.max(0, ms - 500));
  }

  async ensureVisible(dev, sel) {
    const l = this.loc(dev, sel);
    await l.waitFor({ state: 'visible', timeout: 15000 });
    const inView = await l.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      if (r.height > vh * 0.7) return r.top > -vh * 0.5 && r.top < vh * 0.5; // hohe Elemente: sichtbar genug
      return r.top >= 0 && r.bottom <= vh - 8;
    });
    if (!inView) await this.scrollTo(dev, sel);
  }

  async moveTo(dev, sel, { dx = 0, dy = 0, dur } = {}) {
    await this.ensureVisible(dev, sel);
    const b = await this.rect(dev, sel);
    const x = b.x + b.width / 2 + dx, y = b.y + b.height / 2 + dy;
    await this.S(([x, y, d]) => S.cursorMove(x, y, d), [x, y, dur]);
    return b;
  }

  async tap(dev, sel, { after = 550, dx = 0, dy = 0, dur } = {}) {
    await this.moveTo(dev, sel, { dx, dy, dur });
    await this.S(() => S.press());
    await this.loc(dev, sel).click({ timeout: 10000 });
    await this.wait(after);
  }

  async type(dev, sel, text, { delay = 55, after = 400, clear = false } = {}) {
    await this.tap(dev, sel, { after: 250 });
    const l = this.loc(dev, sel);
    if (clear) { await l.press('Control+A'); await l.press('Backspace'); await this.wait(150); }
    await l.pressSequentially(text, { delay });
    await this.wait(after);
  }

  async ring(dev, sel, pad = 8) {
    if (!sel) return this.S(() => S.ring(null));
    await this.ensureVisible(dev, sel);
    const b = await this.rect(dev, sel);
    // Rahmen auf den sichtbaren Bildschirm des Geräts begrenzen
    const f = await this.page.locator('#f-' + dev).boundingBox();
    const m = pad + 3;
    const x1 = Math.max(b.x, f.x + m), y1 = Math.max(b.y, f.y + m);
    const x2 = Math.min(b.x + b.width, f.x + f.width - m), y2 = Math.min(b.y + b.height, f.y + f.height - m);
    const r = { x: x1, y: y1, width: Math.max(10, x2 - x1), height: Math.max(10, y2 - y1) };
    await this.S(([r, p]) => S.ring(r, p), [r, pad]);
    return b;
  }

  // Unterschrift: Pfad aus normierten Punkten (0..1) innerhalb des Elements nachzeichnen
  async sign(dev, sel, strokes, { steps = 3, speed = 9 } = {}) {
    await this.ensureVisible(dev, sel);
    const b = await this.rect(dev, sel);
    const P = ([u, v]) => [b.x + u * b.width, b.y + v * b.height];
    for (const stroke of strokes) {
      const [x0, y0] = P(stroke[0]);
      await this.S(([x, y]) => S.cursorMove(x, y, 350), [x0, y0]);
      await this.page.mouse.move(x0, y0);
      await this.page.mouse.down();
      for (let i = 1; i < stroke.length; i++) {
        const [x, y] = P(stroke[i]);
        await this.page.mouse.move(x, y, { steps });
        await this.S(([x, y]) => S.cursorSet(x, y), [x, y]);
        await this.wait(speed);
      }
      await this.page.mouse.up();
      await this.wait(90);
    }
  }
}

// Handschrift-ähnliche Unterschrift („H. Auer“ mit Schwung), normiert auf 0..1, per Catmull-Rom geglättet
function catmull(pts, seg = 7) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < seg; k++) {
      const t = k / seg, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((j) => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
function signature() {
  // H
  const h1 = [[0.10, 0.30], [0.105, 0.50], [0.11, 0.72]];
  const h2 = [[0.17, 0.26], [0.165, 0.50], [0.16, 0.74]];
  const h3 = [[0.07, 0.52], [0.13, 0.49], [0.21, 0.47]];
  // Auer mit Abschluss-Schwung
  const auer = [[0.24, 0.74], [0.29, 0.40], [0.33, 0.18], [0.36, 0.42], [0.39, 0.74], [0.35, 0.56], [0.28, 0.58], [0.40, 0.55],
    [0.43, 0.70], [0.46, 0.73], [0.49, 0.56], [0.50, 0.70], [0.53, 0.73], [0.57, 0.62], [0.60, 0.53], [0.58, 0.50], [0.555, 0.58],
    [0.57, 0.71], [0.62, 0.72], [0.66, 0.57], [0.67, 0.71], [0.70, 0.58], [0.74, 0.56], [0.80, 0.62], [0.87, 0.58], [0.92, 0.46]];
  const swash = [[0.20, 0.86], [0.40, 0.83], [0.62, 0.82], [0.80, 0.84], [0.90, 0.80]];
  return [catmull(h1, 5), catmull(h2, 5), catmull(h3, 5), catmull(auer, 6), catmull(swash, 6)];
}

module.exports = { Director, signature };
