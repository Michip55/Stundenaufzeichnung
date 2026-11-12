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
    await l.evaluate((el, b) => el.scrollIntoView({ behavior: 'smooth', block: b, inline: 'nearest' }), block);
    await this.wait(ms);
  }

  // Elementinhalt (z.B. scrollender Container) sanft um dy Pixel scrollen
  async scrollBy(dev, sel, dy, ms = 800) {
    const l = this.loc(dev, sel);
    await l.evaluate((el, d) => el.scrollBy({ top: d, behavior: 'smooth' }), dy);
    await this.wait(ms);
  }

  async ensureVisible(dev, sel) {
    const l = this.loc(dev, sel);
    await l.waitFor({ state: 'visible', timeout: 15000 });
    const inView = await l.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= (window.innerHeight || document.documentElement.clientHeight) - 8;
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
    await this.S(([b, p]) => S.ring(b, p), [b, pad]);
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

// Handschrift-ähnliche Unterschrift erzeugen (Schleifen + Schwung), normiert auf 0..1
function signature(seed = 1, { x0 = 0.12, x1 = 0.84, yMid = 0.55, amp = 0.2 } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const main = [];
  const n = 70;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t + 0.035 * Math.sin(t * Math.PI * 9 + 0.6);
    const loop = Math.sin(t * Math.PI * 9) * amp * (0.55 + 0.45 * Math.sin(t * 3.1 + rnd()));
    const y = yMid - loop - 0.12 * Math.exp(-((t - 0.08) ** 2) / 0.004);
    main.push([x, Math.min(0.92, Math.max(0.1, y))]);
  }
  const swash = [];
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    swash.push([x0 + 0.05 + (x1 - x0 + 0.04) * t, yMid + 0.2 - 0.06 * Math.sin(t * Math.PI)]);
  }
  return [main, swash];
}

module.exports = { Director, signature };
