// Pelotas con física propia: gravedad, rebote, rodadura con rozamiento, choques entre ellas,
// empujones de la mano y del peluche, y se pueden coger y apretar.
import * as THREE from 'three';
import { ps1Mat, makeTex } from './ps1.js';

const G = 9.8;
const STEP = 1 / 120;
const COLORS = [0xd03020, 0x2050c0, 0xe0c020, 0x30a040, 0xe8e8e0, 0xe07018, 0x8040b0, 0x30b0c0, 0xe070a0, 0x303030];
const UP = new THREE.Vector3(0, 1, 0);

export class Balls {
  constructor(world, { x0, z0, topY }) {
    this.world = world;
    this.list = [];
    this.held = null;
    this._v = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._cp = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._acc = 0;
    this._squeakT = 0;
    this.handSpheres = [];

    const tex = makeTex('ball');
    for (let i = 0; i < 10; i++) {
      const r = 0.03 + ((i * 7) % 4) * 0.005; // 3 a 4,5 cm
      const root = new THREE.Group();
      const squash = new THREE.Group();   // orientado al eje de aplastado
      const counter = new THREE.Group();  // deshace esa orientación para que la malla no gire
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), ps1Mat({ map: tex, color: COLORS[i] }));
      counter.add(mesh);
      squash.add(counter);
      root.add(squash);
      const col = i % 5, row = Math.floor(i / 5);
      root.position.set(x0 + col * 0.095, topY + r + 0.002, z0 + row * 0.16);
      mesh.rotation.set(Math.random() * 6, Math.random() * 6, 0);
      world.scene.add(root);
      const b = {
        root, squash, counter, mesh, r, ignoreHand: 0,
        pos: root.position, vel: new THREE.Vector3(),
        s: 0, sv: 0, sTarget: 0, axis: new THREE.Vector3(0, 1, 0),
        held: false, sleep: 0, asleep: true, grounded: false,
      };
      b.item = world.addItem({
        id: 'ball', gesture: 'grab', obj: root, pad: 0.05,
        hint: () => 'PELOTA · mano abierta y cierra el puño para cogerla',
        act: () => this.grab(b),
      });
      this.list.push(b);
    }
  }

  wake(b) { b.asleep = false; b.sleep = 0; }

  grab(b) {
    const w = this.world;
    if (w.handBusy()) return;
    this.held = b;
    b.held = true;
    b.vel.set(0, 0, 0);
    b.item.disabled = true;
    this.wake(b);
    w.ctx.sfx.play('grab');
    w.ctx.vibrate(25);
  }

  release(vel = this.world._handVel) {
    const b = this.held;
    if (!b) return;
    b.held = false;
    b.vel.copy(vel).clampLength(0, 6);
    b.item.disabled = false;
    b.ignoreHand = 0.3; // que la palma no la empuje al soltarla
    this.held = null;
    this.wake(b);
  }

  // colisión esfera-caja; devuelve true si hubo contacto
  collideBox(b, box) {
    const p = b.pos, r = b.r;
    const cp = this._cp.set(
      Math.max(box.min.x, Math.min(p.x, box.max.x)),
      Math.max(box.min.y, Math.min(p.y, box.max.y)),
      Math.max(box.min.z, Math.min(p.z, box.max.z))
    );
    const n = this._n.copy(p).sub(cp);
    let d = n.length();
    if (d >= r) return false;
    if (d < 1e-6) { n.set(0, 1, 0); d = 0; p.y = box.max.y; } else n.divideScalar(d);
    p.addScaledVector(n, r - d);
    this.bounce(b, n, 0.55);
    return true;
  }

  bounce(b, n, rest) {
    const vn = b.vel.dot(n);
    if (vn < 0) {
      b.vel.addScaledVector(n, -(1 + rest) * vn);
      if (-vn > 0.5) {
        b.sv += -vn * 6; // se aplasta al chocar
        b.axis.copy(n);
        if (-vn > 1.2) this.world.ctx.sfx.play('bounce');
      }
      if (n.y > 0.7) b.grounded = true;
    }
  }

  // la mano (y lo que lleva) empuja como esferas cinemáticas
  pushBy(b, c, rad, vel) {
    const n = this._n.copy(b.pos).sub(c);
    const d = n.length();
    const min = b.r + rad;
    if (d >= min) return;
    if (d < 1e-6) n.set(0, 1, 0); else n.divideScalar(d);
    b.pos.addScaledVector(n, min - d);
    const vn = b.vel.dot(n);
    const hn = vel ? vel.dot(n) : 0;
    if (vn < hn) b.vel.addScaledVector(n, hn - vn + 0.05);
    this.wake(b);
  }

  step(dt) {
    const w = this.world;
    const boxes = w.blockers;
    const hs = this.handSpheres;
    for (const b of this.list) {
      if (b.held) continue;
      // una pelota dormida se despierta si la toca la mano o el peluche
      if (b.asleep) {
        if (b.ignoreHand > 0) continue;
        let touched = false;
        for (const h of hs) if (b.pos.distanceTo(h.c) < b.r + h.r) { touched = true; break; }
        if (!touched) continue;
        this.wake(b);
      }
      b.vel.y -= G * dt;
      b.pos.addScaledVector(b.vel, dt);
      b.grounded = false;
      // suelo y techo
      if (b.pos.y < b.r) { b.pos.y = b.r; this.bounce(b, UP, 0.55); }
      if (b.pos.y > 2.6 - b.r) { b.pos.y = 2.6 - b.r; if (b.vel.y > 0) b.vel.y *= -0.5; }
      for (const bl of boxes) if (bl.on) this.collideBox(b, bl.box);
      if (b.ignoreHand <= 0) for (const h of hs) this.pushBy(b, h.c, h.r, h.v);
      else b.ignoreHand -= dt;
    }
    // choques entre pelotas
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      for (let j = i + 1; j < L.length; j++) {
        const a = L[i], c = L[j];
        const n = this._n.copy(c.pos).sub(a.pos);
        const d = n.length();
        const min = a.r + c.r;
        if (d >= min || d < 1e-6) continue;
        n.divideScalar(d);
        const pen = min - d;
        const ma = a.held ? 0 : 1, mc = c.held ? 0 : 1;
        if (ma + mc === 0) continue;
        a.pos.addScaledVector(n, (-pen * ma) / (ma + mc));
        c.pos.addScaledVector(n, (pen * mc) / (ma + mc));
        const rv = this._v.copy(c.vel).sub(a.vel).dot(n);
        if (rv < 0) {
          const jimp = (-(1 + 0.6) * rv) / (ma + mc);
          a.vel.addScaledVector(n, -jimp * ma);
          c.vel.addScaledVector(n, jimp * mc);
          if (-rv > 0.8) w.ctx.sfx.play('clack');
        }
        if (ma) this.wake(a);
        if (mc) this.wake(c);
      }
    }
    // rodadura, rozamiento y reposo
    for (const b of L) {
      if (b.held || b.asleep) continue;
      if (b.grounded) {
        const f = Math.exp(-1.6 * dt);
        b.vel.x *= f; b.vel.z *= f;
        // girar la malla según lo que rueda
        const hv = Math.hypot(b.vel.x, b.vel.z);
        if (hv > 1e-4) {
          const axis = this._v.set(b.vel.z, 0, -b.vel.x).normalize();
          this._q.setFromAxisAngle(axis, (hv * dt) / b.r);
          b.mesh.quaternion.premultiply(this._q);
        }
      }
      if (b.vel.lengthSq() < 0.0009 && b.grounded) {
        b.sleep += dt;
        if (b.sleep > 0.5) { b.asleep = true; b.vel.set(0, 0, 0); }
      } else b.sleep = 0;
    }
  }

  update(dt) {
    const w = this.world;
    const palm = w._handPalm;
    this._squeakT -= dt;

    // esferas de la mano para empujar
    this.handSpheres.length = 0;
    if (palm && w._handPts) {
      const v = w._handVel;
      this.handSpheres.push({ c: palm, r: 0.04, v });
      for (const k of [4, 8, 12, 16, 20]) this.handSpheres.push({ c: w._handPts[k], r: 0.012, v });
      if (this.held) this.handSpheres.push({ c: this.held.pos, r: this.held.r * (1 - this.held.s * 0.5), v });
    }
    if (w.plush && !w.plushHeld) {
      const c = w.plushCenter(this._pc || (this._pc = new THREE.Vector3()));
      this.handSpheres.push({ c, r: 0.1, v: w.plushVel });
    }

    // pelota en la mano: sigue a la palma y se aplasta según lo cerrado que esté el puño
    const b = this.held;
    if (b) {
      if (!palm) {
        // la mano salió de la cámara: la pelota sigue en su sitio respecto a la vista
        if (b.camLocal) w.ctx.camera.localToWorld(b.pos.copy(b.camLocal));
      } else if (w._handOpen) this.release();
      else {
        b.pos.copy(palm);
        b.camLocal = w.ctx.camera.worldToLocal((b.camLocal || new THREE.Vector3()).copy(palm));
        b.sTarget = w._squeeze * 0.5;
        b.axis.lerp(w._palmNormal || UP, 0.3).normalize();
        if (b.s > 0.3 && this._squeakT <= 0) { w.ctx.sfx.play('squeak'); this._squeakT = 0.5; }
      }
    }

    this._acc += Math.min(dt, 0.05);
    while (this._acc >= STEP) { this.step(STEP); this._acc -= STEP; }

    // muelle de aplastado (visual)
    for (const ball of this.list) {
      if (!ball.held) ball.sTarget = 0;
      const a = (ball.sTarget - ball.s) * 300 - ball.sv * 16;
      ball.sv += a * dt;
      ball.s = Math.max(-0.3, Math.min(0.6, ball.s + ball.sv * dt));
      ball.squash.quaternion.setFromUnitVectors(UP, ball.axis);
      ball.counter.quaternion.copy(ball.squash.quaternion).invert();
      ball.squash.scale.set(1 + ball.s * 0.6, 1 - ball.s, 1 + ball.s * 0.6);
      ball.item.refresh();
    }
  }
}
