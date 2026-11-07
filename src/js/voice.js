// Voz del espíritu: síntesis de voz del propio Android (sin internet), grave y lenta,
// con subtítulos que aparecen letra a letra. Si el móvil no tiene voz, quedan los subtítulos.
export class Voice {
  constructor(el, sfx) {
    this.el = el;
    this.sfx = sfx;
    this.token = 0;
    this.typer = null;
    this.hideT = null;
    this.speaking = false;
  }

  _native(method, opts) {
    const C = window.Capacitor;
    if (!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
    try {
      if (C.Plugins && C.Plugins.TextToSpeech && C.Plugins.TextToSpeech[method]) return C.Plugins.TextToSpeech[method](opts);
      if (C.nativePromise) return C.nativePromise('TextToSpeech', method, opts);
    } catch (e) { /* sin voz nativa */ }
    return null;
  }

  stop() {
    this.token++;
    const p = this._native('stop', {});
    if (p && p.catch) p.catch(() => {});
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { /* nada */ }
  }

  _subtitle(text, tok) {
    clearInterval(this.typer);
    clearTimeout(this.hideT);
    const el = this.el;
    el.textContent = '';
    el.classList.add('show');
    let i = 0;
    this.typer = setInterval(() => {
      if (tok !== this.token) { clearInterval(this.typer); return; }
      el.textContent = text.slice(0, ++i);
      if (i >= text.length) clearInterval(this.typer);
    }, 45);
  }

  _hideLater(tok) {
    clearTimeout(this.hideT);
    this.hideT = setTimeout(() => { if (tok === this.token) this.el.classList.remove('show'); }, 1800);
  }

  speak(text, { pitch = 0.45, rate = 0.78 } = {}) {
    this.stop();
    const tok = this.token;
    this.speaking = true;
    this._subtitle(text, tok);
    this.sfx.play('whisper');
    const readMs = 1200 + text.length * 70;
    let p = this._native('speak', { text, lang: 'es-ES', rate, pitch, volume: 1.0, category: 'playback', queueStrategy: 0 });
    let hasVoice = !!p;
    if (!p && window.speechSynthesis && window.SpeechSynthesisUtterance) {
      hasVoice = true;
      p = new Promise((res) => {
        try {
          const u = new SpeechSynthesisUtterance(text);
          u.lang = 'es-ES'; u.pitch = pitch; u.rate = rate;
          const v = window.speechSynthesis.getVoices().find((x) => /^es/i.test(x.lang));
          if (v) u.voice = v;
          u.onend = res; u.onerror = res;
          window.speechSynthesis.speak(u);
        } catch (e) { res(); }
      });
    }
    const voiceDone = (p && p.then ? p.catch(() => {}) : Promise.resolve());
    const minWait = new Promise((r) => setTimeout(r, hasVoice ? Math.min(readMs, 2200) : readMs));
    const maxWait = new Promise((r) => setTimeout(r, readMs * 2 + 2000));
    return Promise.race([Promise.all([voiceDone, minWait]), maxWait]).then(() => {
      if (tok === this.token) { this.speaking = false; this._hideLater(tok); }
    });
  }
}
