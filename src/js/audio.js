// Sonido 100% procedural con WebAudio (sin archivos, sin internet).
export class Sfx {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this._ambient();
    this._scrape();
    this._hum();
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  _noise(loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = loop;
    return s;
  }

  _ambient() {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0.11;
    g.connect(this.master);
    [41, 43.7, 61.5].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'triangle' : 'sine';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = i === 2 ? 0.25 : 0.6;
      o.connect(og).connect(g);
      o.start();
    });
    const n = this._noise();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const ng = ctx.createGain();
    ng.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.35;
    lfo.connect(lfoG).connect(ng.gain);
    n.connect(lp).connect(ng).connect(g);
    n.start();
    lfo.start();
    this.ambientGain = g;
  }

  _scrape() {
    const ctx = this.ctx;
    const n = this._noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.value = 0;
    n.connect(bp).connect(g).connect(this.master);
    n.start();
    this.scrapeGain = g;
    this.scrapeFilter = bp;
  }

  _hum() {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(this.master);
    [50, 100, 150].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = [0.4, 0.2, 0.08][i];
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 400;
      o.connect(lp).connect(og).connect(g);
      o.start();
    });
    this.humGain = g;
  }

  setScrape(level, pitch = 1) {
    if (!this.ctx) return;
    const v = Math.min(0.5, Math.max(0, level));
    this.scrapeGain.gain.setTargetAtTime(v, this.t, 0.04);
    this.scrapeFilter.frequency.setTargetAtTime(900 + 1600 * pitch, this.t, 0.05);
  }

  setHum(v) {
    if (!this.ctx) return;
    this.humGain.gain.setTargetAtTime(v, this.t, 0.15);
  }

  setAmbient(v) {
    if (!this.ctx) return;
    this.ambientGain.gain.setTargetAtTime(v, this.t, 0.3);
  }

  tone(type, f0, f1, dur, vol, delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.t + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  burst(dur, vol, type, f0, f1, q = 1, delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.t + delay;
    const n = this._noise(false);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g).connect(this.master);
    n.start(t, Math.random());
    n.stop(t + dur + 0.05);
  }

  play(name) {
    if (!this.ctx) return;
    switch (name) {
      case 'click':
        this.burst(0.05, 0.5, 'highpass', 2500, 2000, 1);
        this.tone('square', 180, 90, 0.06, 0.15);
        break;
      case 'bulb':
        this.tone('sine', 1200, 1180, 0.4, 0.05);
        this.burst(0.15, 0.2, 'bandpass', 3000, 1500, 3);
        break;
      case 'glass':
        this.burst(0.5, 0.9, 'highpass', 3000, 6000, 0.7);
        for (let i = 0; i < 7; i++) this.tone('sine', 2500 + Math.random() * 3500, 1800, 0.3 + Math.random() * 0.4, 0.08, Math.random() * 0.4);
        this.burst(0.2, 0.6, 'lowpass', 400, 100, 1);
        break;
      case 'whisper':
        // varios susurros de ruido filtrado, como voces sin palabras
        for (let i = 0; i < 4; i++) {
          const f = 2200 + Math.random() * 2500;
          this.burst(0.25 + Math.random() * 0.35, 0.12, 'bandpass', f, f * 0.7, 6, i * (0.12 + Math.random() * 0.15));
        }
        break;
      case 'ghost':
        this.tone('sine', 110, 104, 3.5, 0.18);
        this.tone('sine', 116.5, 110, 3.5, 0.14);
        this.tone('triangle', 233, 220, 3.0, 0.05, 0.3);
        this.burst(3.0, 0.12, 'bandpass', 600, 1400, 3);
        break;
      case 'whoosh':
        this.burst(0.5, 0.7, 'bandpass', 400, 3000, 1.5);
        break;
      case 'hit':
        this.burst(0.4, 1.0, 'lowpass', 1800, 100, 0.8);
        this.tone('sine', 90, 30, 0.5, 0.8);
        this.play('shatter');
        break;
      case 'shatter':
        this.burst(0.35, 0.8, 'highpass', 3500, 6000, 0.8);
        for (let i = 0; i < 6; i++) this.tone('sine', 3000 + Math.random() * 3000, 2200, 0.2 + Math.random() * 0.3, 0.06, Math.random() * 0.25);
        break;
      case 'puff':
        this.burst(0.25, 0.35, 'lowpass', 900, 200, 0.7);
        break;
      case 'bell':
        [196, 247, 294].forEach((f, i) => this.tone('sine', f, f * 0.995, 2.2, 0.08 - i * 0.02));
        break;
      case 'heartbeat':
        this.tone('sine', 62, 40, 0.16, 0.6);
        this.tone('sine', 58, 38, 0.14, 0.45, 0.22);
        break;
      case 'gunshot':
        this.burst(0.35, 1.0, 'lowpass', 5000, 300, 0.7);
        this.burst(0.05, 0.9, 'highpass', 2000, 2000, 0.7);
        this.tone('sine', 110, 35, 0.45, 0.9);
        this.tone('square', 70, 30, 0.2, 0.25);
        this.burst(1.6, 0.22, 'lowpass', 900, 120, 0.7, 0.12); // eco en la habitación
        break;
      case 'dryfire':
        this.burst(0.03, 0.5, 'highpass', 3000, 3000, 2);
        this.tone('square', 1200, 900, 0.03, 0.06);
        break;
      case 'reload':
        for (let i = 0; i < 6; i++) this.burst(0.025, 0.35, 'bandpass', 2600, 2400, 4, i * 0.06);
        this.burst(0.06, 0.6, 'bandpass', 1200, 800, 3, 0.42);
        break;
      case 'ricochet':
        this.tone('sine', 2600, 900, 0.35, 0.05);
        this.burst(0.08, 0.4, 'bandpass', 1500, 700, 2);
        break;
      case 'clunk':
        this.burst(0.12, 0.6, 'lowpass', 900, 200, 1);
        this.tone('triangle', 400, 250, 0.1, 0.08);
        break;
      case 'bounce':
        this.tone('sine', 300 + Math.random() * 120, 180, 0.08, 0.1);
        this.burst(0.05, 0.25, 'lowpass', 800, 300, 1);
        break;
      case 'clack':
        this.tone('triangle', 700 + Math.random() * 300, 500, 0.05, 0.06);
        break;
      case 'squish':
        this.burst(0.14, 0.35, 'lowpass', 500, 150, 1);
        this.tone('sine', 200, 140, 0.12, 0.05);
        break;
      case 'squeak':
        this.tone('sine', 900, 1500, 0.12, 0.09);
        this.tone('sine', 1500, 1100, 0.14, 0.07, 0.12);
        break;
      case 'plop':
        this.burst(0.18, 0.45, 'lowpass', 350, 90, 1);
        break;
      case 'wind':
        this.burst(2.8, 0.35, 'bandpass', 500, 250, 0.8);
        this.burst(2.2, 0.2, 'bandpass', 1400, 700, 2, 0.3);
        break;
      case 'crack':
        this.burst(0.08, 0.7, 'highpass', 2500, 4500, 1);
        this.tone('sine', 3200 + Math.random() * 1500, 2500, 0.15, 0.06);
        this.burst(0.12, 0.4, 'lowpass', 500, 150, 1);
        break;
      case 'grab':
        this.burst(0.12, 0.3, 'bandpass', 600, 300, 2);
        this.tone('triangle', 900, 1300, 0.15, 0.06, 0.08);
        break;
      case 'key':
        this.tone('triangle', 2200, 2100, 0.1, 0.1);
        this.tone('triangle', 3000, 2900, 0.12, 0.08, 0.08);
        break;
      case 'lever':
        this.burst(0.25, 0.8, 'lowpass', 900, 120, 1);
        this.tone('square', 90, 40, 0.3, 0.3);
        this.tone('sawtooth', 300, 30, 1.2, 0.12, 0.1);
        break;
      case 'shock':
        this.tone('sawtooth', 120, 60, 0.6, 0.35);
        this.tone('square', 2400, 1200, 0.4, 0.06);
        for (let i = 0; i < 8; i++) this.burst(0.04, 0.6, 'highpass', 3000, 3000, 1, i * 0.05);
        break;
      case 'spark':
        this.burst(0.03 + Math.random() * 0.05, 0.25, 'highpass', 2500, 4000, 1);
        break;
      case 'denied':
        this.tone('square', 160, 150, 0.12, 0.08);
        this.tone('square', 120, 110, 0.15, 0.08, 0.13);
        break;
      case 'unlock':
        this.burst(0.08, 0.7, 'bandpass', 1500, 900, 3);
        this.tone('square', 400, 200, 0.08, 0.15, 0.1);
        break;
      case 'creak':
        for (let i = 0; i < 3; i++) this.tone('sawtooth', 140 + i * 37, 70 + i * 20, 1.4, 0.06, i * 0.15);
        this.burst(1.6, 0.15, 'bandpass', 700, 300, 8);
        break;
      case 'step':
        this.burst(0.09, 0.22, 'lowpass', 300 + Math.random() * 120, 80, 1);
        break;
      case 'stinger':
        [220, 233, 311, 466, 622].forEach((f) => this.tone('sawtooth', f, f * 0.94, 2.2, 0.12));
        this.burst(1.8, 0.8, 'bandpass', 2000, 400, 0.6);
        this.tone('sine', 55, 30, 2.5, 0.6);
        break;
      case 'flicker':
        this.burst(0.06, 0.2, 'bandpass', 4000, 3000, 2);
        break;
      case 'thud':
        this.burst(0.35, 0.9, 'lowpass', 200, 40, 1);
        this.tone('sine', 70, 35, 0.4, 0.5);
        break;
      case 'win':
        [262, 330, 392, 523].forEach((f, i) => this.tone('triangle', f, f, 0.6, 0.12, i * 0.12));
        break;
    }
  }
}

// ---------- Vibración (Capacitor Haptics nativo, con respaldo navigator.vibrate) ----------
export function vibrate(ms) {
  const C = window.Capacitor;
  try {
    if (C && C.isNativePlatform && C.isNativePlatform()) {
      if (C.Plugins && C.Plugins.Haptics && C.Plugins.Haptics.vibrate) {
        C.Plugins.Haptics.vibrate({ duration: ms });
        return;
      }
      if (C.nativePromise) {
        C.nativePromise('Haptics', 'vibrate', { duration: ms }).catch(() => {});
        return;
      }
    }
  } catch (e) { /* sigue al respaldo */ }
  try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* sin vibración */ }
}

export function vibratePattern(arr) {
  let t = 0;
  for (let i = 0; i < arr.length; i++) {
    if (i % 2 === 0) setTimeout(() => vibrate(arr[i]), t);
    t += arr[i];
  }
}
