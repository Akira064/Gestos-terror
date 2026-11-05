// Filtrado de landmarks, estimación de profundidad, posición en cámara y detección de gestos.
import * as THREE from 'three';

const DEG = Math.PI / 180;
const TH_KEY = 'gt_thresholds_v3';

export const DEFAULT_TH = {
  pinch: 0.36,      // distancia pulgar-índice / tamaño palma para "pinza"
  fist: 1.2,        // apertura media de dedos por debajo = puño
  open: 1.7,        // apertura por encima = mano abierta
  pull: 0.06,       // metros que hay que bajar la pinza (cuerda)
  lever: 0.08,      // metros que hay que bajar el puño (palanca)
  punch: 0.7,       // m/s del puño para romper de un golpe (la mitad agrieta)
  grabWin: 0.9,     // s entre mano abierta y puño para agarrar
  twist: 60,        // grados de giro de muñeca (llave)
  camFov: 66,       // FOV real de la cámara trasera a lo largo de la altura de la imagen (vertical)
  depthScale: 1.0,  // ganancia de profundidad real -> juego
  depthOffset: 0.1, // desplazamiento de profundidad
  handScale: 1.25,  // tamaño de la mano 3D
  reach: 1.15,      // alcance lateral (para llegar a los bordes)
  hover: 0.1,       // distancia para considerar la mano "encima" de un objeto
};

export const TH_SPEC = [
  ['pinch', 'Pinza', 0.15, 0.7, 0.01],
  ['fist', 'Puño', 0.8, 1.6, 0.01],
  ['open', 'Abierta', 1.3, 2.3, 0.01],
  ['pull', 'Bajar cuerda', 0.02, 0.2, 0.005],
  ['lever', 'Bajar palanca', 0.02, 0.2, 0.005],
  ['punch', 'Golpe m/s', 0.3, 3, 0.05],
  ['grabWin', 'Agarre s', 0.3, 2, 0.05],
  ['twist', 'Giro º', 20, 140, 1],
  ['camFov', 'FOV cámara', 40, 90, 1],
  ['depthScale', 'Prof. ganancia', 0.3, 2.5, 0.05],
  ['depthOffset', 'Prof. offset', -0.3, 0.5, 0.01],
  ['handScale', 'Tamaño mano', 0.6, 2, 0.05],
  ['reach', 'Alcance', 0.8, 1.6, 0.01],
  ['hover', 'Distancia obj.', 0.03, 0.25, 0.005],
];

export function loadThresholds() {
  const th = { ...DEFAULT_TH };
  try {
    const s = JSON.parse(localStorage.getItem(TH_KEY) || '{}');
    for (const k of Object.keys(th)) if (typeof s[k] === 'number') th[k] = s[k];
  } catch (e) { /* sin almacenamiento */ }
  return th;
}
export function saveThresholds(th) {
  try { localStorage.setItem(TH_KEY, JSON.stringify(th)); } catch (e) { /* nada */ }
}

class OneEuro {
  constructor(minCutoff, beta, dCutoff = 1.0) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.x = null; this.dx = 0;
  }
  static a(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  reset() { this.x = null; this.dx = 0; }
  f(x, dt) {
    if (this.x === null || dt <= 0) { this.x = x; this.dx = 0; return x; }
    const dx = (x - this.x) / dt;
    this.dx += OneEuro.a(this.dCutoff, dt) * (dx - this.dx);
    const c = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.a(c, dt) * (x - this.x);
    return this.x;
  }
}

const PALM = [0, 5, 9, 13, 17];
const TIPS = [8, 12, 16, 20];
const DEPTH_PAIRS = [[0, 5], [0, 17], [5, 17], [0, 9], [5, 9], [9, 13], [13, 17]];

export class HandGestures {
  constructor(th) {
    this.th = th;
    this.fImg = Array.from({ length: 42 }, () => new OneEuro(1.6, 6));
    this.fW = Array.from({ length: 63 }, () => new OneEuro(1.6, 25));
    this.fDepth = new OneEuro(2.0, 6);
    this.hist = []; // historial de posiciones para medir golpes
    this.peak = 0;
    this.img = Array.from({ length: 21 }, () => new THREE.Vector2());
    this.W = Array.from({ length: 21 }, () => new THREE.Vector3());
    this.palmCam = new THREE.Vector3();   // posición objetivo (sin colisiones) en espacio cámara del juego
    this.pointsCam = Array.from({ length: 21 }, () => new THREE.Vector3());
    this.prevPalm = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this._v = new THREE.Vector3(); this._a = new THREE.Vector3(); this._p = new THREE.Vector3();
    this.prevVp = null;
    this.v = {}; // valores para el debug
    this.reset();
  }

  reset() {
    this.fImg.forEach((f) => f.reset());
    this.fW.forEach((f) => f.reset());
    this.fDepth.reset();
    this.hasPrev = false;
    this.pose = 'none';
    this.pinchActive = false;
    this.fistActive = false;
    this.pullFired = false;
    this.leverFired = false;
    this.pinchStartY = 0;
    this.fistStartY = 0;
    this.lastOpenT = -1e9;
    this.lastPunchT = -1e9;
    this.lastFistT = -1e9;
    this.hist = [];
    this.swing = 0;
    this.twistAcc = 0;
    this.prevVp = null;
    this.hoverId = null;
    this.vel.set(0, 0, 0);
    this.pinchDrop = 0;
    this.fistDrop = 0;
  }

  // r: resultado del tracker; view: { tanV, aspect } de la cámara del juego
  ingest(r, camAspect, dt, nowS, view, hoverId) {
    const th = this.th;
    const events = [];
    dt = Math.min(Math.max(dt, 1 / 120), 0.25);

    for (let i = 0; i < 21; i++) {
      this.img[i].set(this.fImg[i * 2].f(r.image[i].x, dt), this.fImg[i * 2 + 1].f(r.image[i].y, dt));
      this.W[i].set(
        this.fW[i * 3].f(r.world[i].x, dt),
        this.fW[i * 3 + 1].f(r.world[i].y, dt),
        this.fW[i * 3 + 2].f(r.world[i].z, dt)
      );
    }
    const W = this.W, I = this.img;

    // --- Profundidad real: f * longitud_real / longitud_en_imagen (el par menos escorzado) ---
    const f = 1 / (2 * Math.tan((th.camFov * DEG) / 2));
    let depth = Infinity;
    for (const [a, b] of DEPTH_PAIRS) {
      const di = Math.hypot((I[a].x - I[b].x) * camAspect, I[a].y - I[b].y);
      const dw = W[a].distanceTo(W[b]);
      if (di > 1e-4) depth = Math.min(depth, (f * dw) / di);
    }
    if (!isFinite(depth)) depth = 0.45;
    depth = this.fDepth.f(Math.min(1.5, Math.max(0.1, depth)), dt);
    const gameDepth = Math.min(1.3, Math.max(0.22, depth * th.depthScale + th.depthOffset));

    // --- Centro de la palma en pantalla (cámara trasera: sin espejo) ---
    let px = 0, py = 0;
    for (const k of PALM) { px += I[k].x; py += I[k].y; }
    px /= PALM.length; py /= PALM.length;
    const nx = Math.max(-1.1, Math.min(1.1, (px * 2 - 1) * th.reach));
    const ny = Math.max(-1.1, Math.min(1.1, -(py * 2 - 1) * th.reach));
    this.palmCam.set(nx * view.tanV * view.aspect * gameDepth, ny * view.tanV * gameDepth, -gameDepth);

    // --- Puntos de la mano en espacio cámara: (x, -y, -z) de MediaPipe ---
    const wp = this._p.set(0, 0, 0);
    for (const k of PALM) wp.add(W[k]);
    wp.multiplyScalar(1 / PALM.length);
    for (let i = 0; i < 21; i++) {
      const d = this._v.copy(W[i]).sub(wp);
      this.pointsCam[i].set(d.x, -d.y, -d.z).multiplyScalar(th.handScale).add(this.palmCam);
    }

    // --- Medidas ---
    const palmSize = Math.max(0.03, W[0].distanceTo(W[9]));
    const pinch = W[4].distanceTo(W[8]) / palmSize;
    let open = 0;
    for (const t of TIPS) open += W[t].distanceTo(W[0]);
    open /= TIPS.length * palmSize;

    if (this.hasPrev) {
      const raw = this._v.copy(this.palmCam).sub(this.prevPalm).divideScalar(dt);
      this.vel.lerp(raw, 0.6);
    } else this.vel.set(0, 0, 0);
    this.prevPalm.copy(this.palmCam);
    this.hasPrev = true;
    // Velocidad de golpe: el mayor desplazamiento en los últimos 0,25 s (no se pierde por el suavizado)
    this.hist.push({ t: nowS, p: this.palmCam.clone() });
    while (this.hist.length && nowS - this.hist[0].t > 0.25) this.hist.shift();
    let speed = 0;
    for (const h of this.hist) {
      const ht = nowS - h.t;
      if (ht >= 0.05) speed = Math.max(speed, h.p.distanceTo(this.palmCam) / ht);
    }
    this.peak = Math.max(speed, this.peak * Math.pow(0.5, dt));

    // Giro de muñeca: ángulo acumulado de la línea de nudillos alrededor del eje del antebrazo
    if (hoverId !== this.hoverId) { this.twistAcc = 0; this.prevVp = null; this.hoverId = hoverId; }
    const axis = this._a.copy(W[9]).sub(W[0]).normalize();
    const vp = new THREE.Vector3().copy(W[5]).sub(W[17]);
    vp.addScaledVector(axis, -vp.dot(axis));
    if (vp.lengthSq() > 1e-8) {
      vp.normalize();
      if (this.prevVp) {
        const dot = Math.max(-1, Math.min(1, this.prevVp.dot(vp)));
        const sign = Math.sign(axis.dot(new THREE.Vector3().crossVectors(this.prevVp, vp))) || 1;
        const ang = Math.acos(dot);
        if (ang < 0.6) this.twistAcc += sign * ang; // ignora saltos de tracking
      }
      this.prevVp = vp;
    }

    // --- Poses con histéresis ---
    const wasFist = this.fistActive, wasPinch = this.pinchActive;
    this.fistActive = wasFist ? open < th.fist + 0.15 : open < th.fist;
    this.pinchActive = !this.fistActive && (wasPinch ? pinch < th.pinch + 0.12 : pinch < th.pinch);
    const isOpen = !this.fistActive && !this.pinchActive && open > th.open;
    this.pose = this.fistActive ? 'PUÑO' : this.pinchActive ? 'PINZA' : isOpen ? 'ABIERTA' : 'media';
    if (isOpen) this.lastOpenT = nowS;
    if (this.fistActive) this.lastFistT = nowS;

    // Pinza y bajar
    if (this.pinchActive && !wasPinch) { this.pinchStartY = this.palmCam.y; this.pullFired = false; }
    this.pinchDrop = this.pinchActive ? Math.max(0, this.pinchStartY - this.palmCam.y) : 0;
    if (this.pinchActive && !this.pullFired && this.pinchDrop > th.pull) { events.push('pull'); this.pullFired = true; }

    // Puño: palanca, golpe, agarre
    if (this.fistActive && !wasFist) {
      this.fistStartY = this.palmCam.y;
      this.leverFired = false;
      if (nowS - this.lastOpenT < th.grabWin) events.push('grab');
    }
    this.fistDrop = this.fistActive ? Math.max(0, this.fistStartY - this.palmCam.y) : 0;
    if (this.fistActive && !this.leverFired && this.fistDrop > th.lever) { events.push('lever'); this.leverFired = true; }
    // Golpe: puño ahora o hace muy poco (la imagen movida puede romper la detección del puño)
    const fistRecent = this.fistActive || nowS - this.lastFistT < 0.3;
    const knockTh = th.punch * 0.5;
    if (fistRecent && nowS - this.lastPunchT > 0.45) {
      if (speed > th.punch) { events.push('punch'); this.lastPunchT = nowS; this.swing = 0; }
      else if (speed > knockTh) this.swing = Math.max(this.swing || 0, speed);
    }
    // El golpe flojo se decide al terminar el movimiento (si no llegó a fuerte)
    if (this.swing && speed < knockTh * 0.6) {
      if (nowS - this.lastPunchT > 0.45) { events.push('knock'); this.lastPunchT = nowS; }
      this.swing = 0;
    }

    // Girar llave
    if (Math.abs(this.twistAcc) > th.twist * DEG) { events.push('twist'); this.twistAcc = 0; }

    this.v = {
      pose: this.pose, pinch, open, speed, peak: this.peak, depth, gameDepth,
      pinchDrop: this.pinchDrop, fistDrop: this.fistDrop,
      twist: this.twistAcc / DEG, vy: this.vel.y,
    };
    if (events.length) this.v.lastEvents = events.join(',');
    return events;
  }
}
