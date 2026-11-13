// Panel de depuración: esqueleto de la mano (sin imagen de cámara), valores y umbrales ajustables.
import { TH_SPEC, DEFAULT_TH, saveThresholds } from './gestures.js';

const CONN = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

export class DebugPanel {
  constructor(root, th) {
    this.root = root;
    this.th = th;
    this.on = false;
    this.canvas = root.querySelector('#dbgSkel');
    this.g = this.canvas.getContext('2d');
    this.pre = root.querySelector('#dbgVals');
    this.inputs = {};
    const box = root.querySelector('#dbgSliders');
    for (const [key, label, min, max, step] of TH_SPEC) {
      const row = document.createElement('label');
      row.className = 'sl';
      const name = document.createElement('span');
      name.textContent = label;
      const inp = document.createElement('input');
      inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = th[key];
      const val = document.createElement('span');
      val.textContent = (+th[key]).toFixed(step < 1 ? 2 : 0);
      inp.addEventListener('input', () => {
        th[key] = parseFloat(inp.value);
        val.textContent = th[key].toFixed(step < 1 ? 2 : 0);
        saveThresholds(th);
      });
      row.append(name, inp, val);
      box.appendChild(row);
      this.inputs[key] = { inp, val, step };
    }
    // Ver cámara: superpone la imagen real para comparar la mano 3D con tu mano
    root.querySelector('#dbgCam').addEventListener('click', (e) => {
      const v = document.getElementById('cam');
      const on = v.classList.toggle('overlay');
      v.style.transform = on ? `scale(${th.reach})` : '';
      e.target.textContent = on ? 'Ocultar cámara' : 'Ver cámara';
    });
    root.querySelector('#dbgReset').addEventListener('click', () => {
      Object.assign(th, DEFAULT_TH);
      saveThresholds(th);
      for (const k in this.inputs) {
        const { inp, val, step } = this.inputs[k];
        inp.value = th[k];
        val.textContent = (+th[k]).toFixed(step < 1 ? 2 : 0);
      }
    });
    this._lastEvt = '';
    this._lastEvtT = 0;
  }

  toggle() {
    this.on = !this.on;
    this.root.hidden = !this.on;
  }

  draw(info) {
    if (!this.on) return;
    const { g, canvas } = this;
    const W = canvas.width, H = canvas.height;
    g.fillStyle = '#050505';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#222';
    g.strokeRect(0.5, 0.5, W - 1, H - 1);
    const pts = info.present ? info.img : null;
    if (pts) {
      g.strokeStyle = info.pose === 'PUÑO' ? '#f55' : info.pose === 'PINZA' ? '#fd4' : info.pose === 'ABIERTA' ? '#5f5' : '#8cf';
      g.lineWidth = 2;
      g.beginPath();
      for (const [a, b] of CONN) {
        g.moveTo(pts[a].x * W, pts[a].y * H);
        g.lineTo(pts[b].x * W, pts[b].y * H);
      }
      g.stroke();
      g.fillStyle = '#fff';
      for (let i = 0; i < 21; i++) g.fillRect(pts[i].x * W - 1.5, pts[i].y * H - 1.5, 3, 3);
      g.fillStyle = '#f0f';
      g.fillRect(pts[4].x * W - 2.5, pts[4].y * H - 2.5, 5, 5);
      g.fillRect(pts[8].x * W - 2.5, pts[8].y * H - 2.5, 5, 5);
    } else {
      g.fillStyle = '#633';
      g.font = '12px monospace';
      g.fillText('sin mano', W / 2 - 28, H / 2);
    }

    const v = info.v || {};
    const th = this.th;
    if (v.lastEvents) { this._lastEvt = v.lastEvents; this._lastEvtT = info.now; v.lastEvents = null; }
    const f = (x, d = 2) => (typeof x === 'number' ? x.toFixed(d) : '-');
    const mark = (cond) => (cond ? '◄' : ' ');
    this.pre.textContent = [
      `mano ${info.present ? 'SÍ' : 'no'}  det ${info.detFps}fps ${f(info.detectMs, 0)}ms ${info.delegate}`,
      `flash ${info.torch ? 'ON' : 'no'}  render ${info.fps}fps`,
      `pose     ${v.pose || '-'}`,
      `pinza    ${f(v.pinch)} < ${f(th.pinch)} ${mark(v.pinch < th.pinch)}`,
      `apertura ${f(v.open)} (máx ${f(v.maxOpen)})  puño<${f(th.fist)} abierta>${f(th.open)}`,
      `golpe    ${f(v.speed)} pico ${f(v.peak)} m/s (grieta>${f(th.punch * 0.5)} rompe>${f(th.punch)})`,
      `bajada P ${f(v.pinchDrop, 3)} / ${f(th.pull, 3)}`,
      `bajada F ${f(v.fistDrop, 3)} / ${f(th.lever, 3)}`,
      `giro     ${f(v.twist, 0)}º / ${f(th.twist, 0)}º`,
      `dedos    ${(v.curls || []).map((c) => f(c, 1)).join(' ')} pulgar ${f(v.thumbC, 1)}${v.edge ? ' DE CANTO' : ''}`,
      `ves      ${v.palmVisible === undefined ? '-' : v.palmVisible ? 'PALMA' : 'DORSO'}${v.mirrored ? '  (profundidad corregida)' : ''}`,
      `gatillo  índice ${f(v.idx)} tirón ${f(v.idxPull)} / ${f(th.trigger)}`,
      `prof     real ${f(v.depth)} m (sin filtrar ${f(v.depthRaw)})  juego ${f(v.gameDepth)}`,
      `contacto ${info.contact ? 'SÍ' : 'no'}  objeto ${info.hover || '-'}`,
      `evento   ${info.now - this._lastEvtT < 1.5 ? this._lastEvt : ''}`,
    ].join('\n');
  }
}
