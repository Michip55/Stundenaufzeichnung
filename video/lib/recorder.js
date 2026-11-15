// Screencast-Recorder: nimmt die Bühne per Chrome-DevTools-Screencast auf (JPEG-Frames mit Zeitstempel)
// und baut daraus mit ffmpeg ein MP4 mit konstanten 30 fps.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

class Recorder {
  constructor(page, dir) {
    this.page = page;
    this.dir = dir;
    this.frames = [];
    this.n = 0;
  }

  async start() {
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on('Page.screencastFrame', async (f) => {
      const file = path.join(this.dir, `f${String(this.n++).padStart(6, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
      this.frames.push({ file, t: f.metadata.timestamp });
      try { await this.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (_) { /* beendet */ }
    });
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 93, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  }

  async stop() {
    this.tEnd = Date.now() / 1000;
    await this.cdp.send('Page.stopScreencast');
    await new Promise((r) => setTimeout(r, 300));
  }

  stats() {
    const f = this.frames;
    if (f.length < 2) return { frames: f.length };
    const dur = f[f.length - 1].t - f[0].t;
    return { frames: f.length, seconds: +dur.toFixed(1), avgFps: +(f.length / dur).toFixed(1) };
  }

  assemble(out, { crf = 17, preset = 'slow' } = {}) {
    const f = this.frames;
    const list = path.join(this.dir, 'list.txt');
    let s = '';
    for (let i = 0; i < f.length; i++) {
      const next = i + 1 < f.length ? f[i + 1].t : Math.max(this.tEnd, f[i].t + 0.5);
      const d = Math.max(0.001, next - f[i].t);
      s += `file '${f[i].file}'\nduration ${d.toFixed(4)}\n`;
    }
    s += `file '${f[f.length - 1].file}'\n`;
    fs.writeFileSync(list, s);
    execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
      '-vf', 'fps=30,scale=1920:1080:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', preset, '-crf', String(crf),
      '-tune', 'animation', '-movflags', '+faststart', out], { stdio: 'inherit' });
    return out;
  }
}

// Sprecher-Clips ({file, offset in s}) an ihren Zeitpunkten unter das Video legen
function muxAudio(videoIn, clips, out) {
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', videoIn];
  clips.forEach((c) => args.push('-i', c.file));
  const parts = clips.map((c, i) => `[${i + 1}:a]aresample=48000,adelay=${Math.round(c.offset * 1000)}:all=1[a${i}]`);
  const mix = `${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11,apad[aout]`;
  args.push('-filter_complex', [...parts, mix].join(';'), '-map', '0:v', '-map', '[aout]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-shortest', '-movflags', '+faststart', out);
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  return out;
}

module.exports = { Recorder, muxAudio };
