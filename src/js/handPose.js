// Mano estable: en vez de copiar los 21 puntos de MediaPipe (que se vuelven locos al girar la mano),
// se calcula una palma rígida (muñeca + nudillos) y, de cada dedo, solo cuánto está doblado.
// Con eso se reconstruye una mano sobre un esqueleto fijo que solo se dobla hacia la palma.
import * as THREE from 'three';

const DEG = Math.PI / 180;
// Plantilla en el sistema de la palma: s = hacia el índice, u = hacia los dedos, n = hacia la palma (m)
const PALM_LEN = 0.092;
const T = {
  1: [0.022, 0.024, 0.012],     // base del pulgar
  5: [0.026, 0.088, 0], 9: [0, 0.092, 0], 13: [-0.02, 0.087, 0], 17: [-0.037, 0.077, 0],
};
const FINGERS = [
  { mcp: 5, len: [0.042, 0.025, 0.021], spread: 0.1 },
  { mcp: 9, len: [0.046, 0.029, 0.023], spread: 0 },
  { mcp: 13, len: [0.043, 0.027, 0.022], spread: -0.08 },
  { mcp: 17, len: [0.033, 0.02, 0.018], spread: -0.18 },
];
const BEND = [80 * DEG, 100 * DEG, 70 * DEG]; // flexión máxima de cada articulación
const THUMB_LEN = [0.038, 0.031, 0.026];
const THUMB_OPEN = [[0.75, 0.62, 0.1], [0.6, 0.8, 0.04], [0.5, 0.86, 0]];
const THUMB_CLOSED = [[0.3, 0.7, 0.5], [-0.55, 0.6, 0.45], [-0.85, 0.2, 0.3]];

function norm3(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

// Modelo de dedo en coordenadas (s,u,n). Devuelve las 4 articulaciones.
function fingerModel(f, c, out) {
  const [mx, my, mz] = T[f.mcp];
  const phi = f.spread * (1 - c);
  const bs = Math.sin(phi), bu = Math.cos(phi);
  let x = mx, y = my, z = mz, th = 0;
  out[0] = [x, y, z];
  for (let k = 0; k < 3; k++) {
    th += c * BEND[k];
    const L = f.len[k];
    x += L * Math.cos(th) * bs;
    y += L * Math.cos(th) * bu;
    z += L * Math.sin(th);
    out[k + 1] = [x, y, z];
  }
  return out;
}

function thumbModel(c, out) {
  let [x, y, z] = T[1];
  out[0] = [x, y, z];
  for (let k = 0; k < 3; k++) {
    const o = THUMB_OPEN[k], cl = THUMB_CLOSED[k];
    const d = norm3([o[0] + (cl[0] - o[0]) * c, o[1] + (cl[1] - o[1]) * c, o[2] + (cl[2] - o[2]) * c]);
    x += d[0] * THUMB_LEN[k]; y += d[1] * THUMB_LEN[k]; z += d[2] * THUMB_LEN[k];
    out[k + 1] = [x, y, z];
  }
  return out;
}

// Tabla c -> medida, forzada a ser decreciente, para invertirla
function makeTable(fn) {
  const N = 41, tab = [];
  let prev = Infinity;
  for (let i = 0; i < N; i++) {
    const c = i / (N - 1);
    const v = Math.min(prev, fn(c));
    tab.push(v);
    prev = v;
  }
  return tab;
}
function invert(tab, v) {
  const N = tab.length;
  if (v >= tab[0]) return 0;
  if (v <= tab[N - 1]) return 1;
  for (let i = 1; i < N; i++) {
    if (v >= tab[i]) {
      const a = tab[i - 1], b = tab[i];
      const t = a === b ? 0 : (a - v) / (a - b);
      return (i - 1 + t) / (N - 1);
    }
  }
  return 1;
}

const tmp4 = [[], [], [], []];
const FINGER_TABLES = FINGERS.map((f) => makeTable((c) => {
  const j = fingerModel(f, c, tmp4);
  const chord = Math.hypot(j[3][0] - j[0][0], j[3][1] - j[0][1], j[3][2] - j[0][2]);
  return chord / (f.len[0] + f.len[1] + f.len[2]);
}));
const THUMB_TABLE = makeTable((c) => {
  const j = thumbModel(c, tmp4);
  const p = T[17];
  return Math.hypot(j[3][0] - p[0], j[3][1] - p[1], j[3][2] - p[2]) / PALM_LEN;
});

export class HandRetarget {
  constructor() {
    this.q = new THREE.Quaternion();
    this.hasQ = false;
    this.lastRaw = new THREE.Quaternion();
    this.cand = new THREE.Quaternion();
    this.hasCand = false;
    this.curl = [0, 0, 0, 0];
    this.thumb = 0.2;
    this.scale = 1;
    this.vote = 0;
    this.palmSign = 1;
    this.edge = false;
    this.out = Array.from({ length: 21 }, () => new THREE.Vector3());
    this._s = new THREE.Vector3(); this._u = new THREE.Vector3(); this._z = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._qn = new THREE.Quaternion();
    this._d = new THREE.Vector3();
    this.joints = [[], [], [], []];
  }

  reset() {
    this.hasQ = false;
    this.hasCand = false;
  }

  // W: 21 Vector3 (coordenadas de mundo de MediaPipe, ya filtradas). pinchW: 0..1
  update(W, pinchW) {
    // --- marco de la palma: solo muñeca y nudillos (los puntos más fiables) ---
    const u = this._u.copy(W[9]).sub(W[0]);
    const palmLen = u.length();
    if (palmLen < 1e-4) return this.out;
    u.divideScalar(palmLen);
    const s = this._s.copy(W[5]).sub(W[17]);
    s.addScaledVector(u, -s.dot(u));
    if (s.lengthSq() < 1e-8) return this.out;
    s.normalize();
    const z = this._z.crossVectors(s, u); // base (s,u,z) a derechas
    this._m.makeBasis(s, u, z);
    this._qn.setFromRotationMatrix(this._m);

    // suavizado de la orientación; los saltos grandes de un solo fotograma se ignoran
    if (!this.hasQ) { this.q.copy(this._qn); this.lastRaw.copy(this._qn); this.hasQ = true; }
    else {
      // Un salto enorme y aislado (MediaPipe confunde palma y dorso un fotograma) se ignora.
      // Si el fotograma siguiente lo confirma, es un giro real y se sigue.
      const jump = this.lastRaw.angleTo(this._qn);
      let accept = true;
      if (jump > 0.6) {
        accept = this.hasCand && this.cand.angleTo(this._qn) < 0.45;
        this.cand.copy(this._qn);
        this.hasCand = !accept;
      } else this.hasCand = false;
      if (accept) this.lastRaw.copy(this._qn);
      const ang = this.q.angleTo(this.lastRaw);
      this.q.slerp(this.lastRaw, Math.min(0.75, 0.3 + ang * 1.2));
    }
    this.scale += (Math.min(1.4, Math.max(0.7, palmLen / PALM_LEN)) - this.scale) * 0.05;

    // --- cuánto está doblado cada dedo (independiente de hacia dónde mire la mano) ---
    // de canto a la cámara los dedos se tapan: se actualiza muy despacio
    const qz = (this._qz || (this._qz = new THREE.Vector3())).set(0, 0, 1).applyQuaternion(this.q);
    this.edge = Math.abs(qz.z) < 0.3;
    const a = this.edge ? 0.06 : 0.45;
    let side = 0;
    FINGERS.forEach((f, i) => {
      const m = f.mcp;
      const segs = W[m].distanceTo(W[m + 1]) + W[m + 1].distanceTo(W[m + 2]) + W[m + 2].distanceTo(W[m + 3]);
      const chord = W[m].distanceTo(W[m + 3]);
      const c = invert(FINGER_TABLES[i], chord / Math.max(segs, 1e-4));
      this.curl[i] += (c - this.curl[i]) * a;
      if (c > 0.35) side += this._d.copy(W[m + 3]).sub(W[m]).dot(z) * c;
    });
    const tc = invert(THUMB_TABLE, W[4].distanceTo(W[17]) / palmLen);
    this.thumb += (tc - this.thumb) * a;

    // hacia qué lado está la palma: los dedos doblados apuntan a ella (votación con memoria)
    if (!this.edge && Math.abs(side) > 0.01) {
      this.vote = Math.max(-20, Math.min(20, this.vote + Math.sign(side) * Math.min(1, Math.abs(side) / 0.03)));
      if (this.vote > 4) this.palmSign = 1;
      else if (this.vote < -4) this.palmSign = -1;
    }

    // --- reconstrucción en el sistema de MediaPipe ---
    const S = this.scale;
    const n = this.palmSign;
    const qs = this._s.set(1, 0, 0).applyQuaternion(this.q);
    const qu = this._u.set(0, 1, 0).applyQuaternion(this.q);
    const out = this.out;
    const origin = W[0];
    const put = (i, p) => {
      out[i].copy(origin)
        .addScaledVector(qs, p[0] * S)
        .addScaledVector(qu, p[1] * S)
        .addScaledVector(qz, p[2] * S * n);
    };
    out[0].copy(origin);
    thumbModel(this.thumb, this.joints);
    for (let k = 0; k < 4; k++) put(1 + k, this.joints[k]);
    FINGERS.forEach((f, i) => {
      fingerModel(f, Math.min(1, Math.max(0, this.curl[i])), this.joints);
      for (let k = 0; k < 4; k++) put(f.mcp + k, this.joints[k]);
    });

    // pinza: que la yema del pulgar y la del índice se toquen de verdad
    if (pinchW > 0) {
      const mid = this._d.copy(out[4]).add(out[8]).multiplyScalar(0.5);
      const dT = mid.clone().sub(out[4]).multiplyScalar(pinchW);
      const dI = mid.clone().sub(out[8]).multiplyScalar(pinchW);
      out[4].add(dT); out[3].addScaledVector(dT, 0.5);
      out[8].add(dI); out[7].addScaledVector(dI, 0.5);
    }
    return out;
  }
}
