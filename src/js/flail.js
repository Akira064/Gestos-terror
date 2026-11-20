// Mangual: mango de madera, cadena de eslabones y bola con pinchos.
// La cadena se simula punto a punto (Verlet): gravedad, inercia, choques con paredes, mesa y suelo.
// Se coge con la mano (abierta -> puño); se suelta con SOLTAR o lanzándolo. La bola rompe cristales,
// lanza pelotas y peluche, empuja puertas y cada golpe vibra en la mano.
import * as THREE from 'three';
import { ps1Mat, boxGeo, makeTex } from './ps1.js';

const LINKS = 8;          // eslabones de la cadena
const LINK_LEN = 0.045;   // 8 x 4,5 cm = 36 cm de cadena
const HANDLE_LEN = 0.36;
const BALL_R = 0.055;     // bola (sin pinchos)
const HIT_R = 0.075;      // radio de golpe (con pinchos)
const G = 9.8;
const UP = new THREE.Vector3(0, 1, 0);

export class Flail {
  constructor(world, { x, y, z }) {
    this.world = world;
    this.held = false;
    this.asleep = true;
    this.sleepT = 0;
    this._v = new THREE.Vector3(); this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._hitT = 0;
    this._rattleT = 0;
    this._whooshT = 0;

    // puntos: 0 = pomo del mango, 1 = punta del mango, 2..LINKS+1 = cadena, último = bola
    const n = LINKS + 3;
    this.p = Array.from({ length: n }, () => new THREE.Vector3());
    this.o = Array.from({ length: n }, () => new THREE.Vector3()); // posición anterior
    this.w = this.p.map((_, i) => (i === n - 1 ? 0.25 : 1));       // la bola pesa más
    this.rest = this.p.map((_, i) => (i === 0 ? 0 : i === 1 ? HANDLE_LEN : i === n - 1 ? LINK_LEN + BALL_R * 0.6 : LINK_LEN));
    this.rad = this.p.map((_, i) => (i < 2 ? 0.02 : i === n - 1 ? BALL_R : 0.01));
    // tumbado sobre la mesa a lo largo de X
    let px = x;
    for (let i = 0; i < n; i++) {
      if (i > 0) px += this.rest[i];
      this.p[i].set(px, y + this.rad[i], z);
      this.o[i].copy(this.p[i]);
    }

    // --- modelo ---
    const wood = ps1Mat({ map: makeTex('wood'), color: 0x8a5a34 });
    const iron = ps1Mat({ map: makeTex('gunmetal'), color: 0x9a9ca4 });
    const leather = ps1Mat({ map: makeTex('cloth'), color: 0x5a3a24 });
    this.handle = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.02, 1, 6), wood);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.14, 6), leather);
    grip.position.y = -0.5 + 0.1;  // en coordenadas del mango (alto 1, se escala)
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.024, 0.04, 6), iron);
    cap.position.y = 0.5;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.004, 3, 6), iron);
    ring.position.y = 0.53;
    this.handleParts = { shaft, grip, cap, ring };
    this.handle.add(shaft, grip, cap, ring);
    world.scene.add(this.handle);
    this.links = [];
    const linkGeo = new THREE.TorusGeometry(0.014, 0.0045, 3, 6);
    for (let i = 0; i < LINKS; i++) {
      const m = new THREE.Mesh(linkGeo, iron);
      m.scale.set(1, 1.6, 1);
      world.scene.add(m);
      this.links.push(m);
    }
    this.ball = new THREE.Group();
    this.ball.add(new THREE.Mesh(new THREE.IcosahedronGeometry(BALL_R, 1), iron));
    const spikeGeo = new THREE.ConeGeometry(0.012, 0.035, 4);
    const ico = new THREE.IcosahedronGeometry(1, 0).attributes.position;
    const seen = new Set();
    for (let i = 0; i < ico.count; i++) {
      const d = new THREE.Vector3().fromBufferAttribute(ico, i).normalize();
      const key = d.toArray().map((v) => v.toFixed(2)).join();
      if (seen.has(key)) continue;
      seen.add(key);
      const s = new THREE.Mesh(spikeGeo, iron);
      s.position.copy(d).multiplyScalar(BALL_R + 0.012);
      s.quaternion.setFromUnitVectors(UP, d);
      this.ball.add(s);
    }
    world.scene.add(this.ball);

    this.item = world.addItem({
      id: 'flail', gesture: 'grab', obj: this.handle, pad: 0.05,
      hint: () => 'MANGUAL · mano abierta y cierra el puño para cogerlo',
      act: () => this.grab(),
    });
    this.render();
  }

  grab() {
    const w = this.world;
    if (this.held || w.handBusy()) return;
    this.held = true;
    this.asleep = false;
    this.item.disabled = true;
    // colocar el mango en la mano sin que la cadena dé un latigazo
    if (w._handPalm && w._handPts) {
      const d = this._c.copy(this.p[1]);
      this.handlePose(w._handPalm, w._handPts);
      d.sub(this.p[1]).negate();
      for (let i = 2; i < this.p.length; i++) this.p[i].add(d);
    }
    for (let i = 0; i < this.p.length; i++) this.o[i].copy(this.p[i]);
    w.ctx.sfx.play('rattle');
    w.ctx.vibrate(30);
    w.ctx.msg('Muévelo para hacer girar la bola. SOLTAR o lánzalo para dejarlo.', 3);
  }

  release(vel = this.world._handVel) {
    if (!this.held) return;
    this.held = false;
    this.item.disabled = false;
    // el mango sale con la velocidad de la mano
    const v = this._v.copy(vel).clampLength(0, 6).multiplyScalar(1 / 60);
    this.o[0].copy(this.p[0]).sub(v);
    this.o[1].copy(this.p[1]).sub(v);
  }

  // dónde va el mango cuando lo sujetas: atraviesa el puño a lo largo de los nudillos (del meñique
  // al índice) y sale por el lado del pulgar, algo inclinado hacia arriba
  handlePose(palm, P) {
    const dir = this._a.copy(P[5]).sub(P[17]);
    if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
    dir.normalize().addScaledVector(UP, 0.45).normalize();
    this.p[0].copy(palm).addScaledVector(dir, -0.07);
    this.p[1].copy(palm).addScaledVector(dir, HANDLE_LEN - 0.07);
  }

  // empuja un punto fuera de una caja (AABB); devuelve la normal del choque o null
  pushOut(p, r, box, out) {
    const cx = Math.max(box.min.x, Math.min(p.x, box.max.x));
    const cy = Math.max(box.min.y, Math.min(p.y, box.max.y));
    const cz = Math.max(box.min.z, Math.min(p.z, box.max.z));
    out.set(p.x - cx, p.y - cy, p.z - cz);
    const d = out.length();
    if (d >= r) return null;
    if (d < 1e-6) out.set(0, 1, 0); else out.divideScalar(d);
    p.addScaledVector(out, r - d);
    return out;
  }

  step(dt) {
    const w = this.world;
    const n = this.p.length;
    const cam = w.ctx.camera;
    // mango: sujeto por la mano (o fijo respecto a la cámara si la mano no se ve)
    if (this.held) {
      this.o[0].copy(this.p[0]); this.o[1].copy(this.p[1]);
      if (w._handPalm && w._handPts) {
        this.handlePose(w._handPalm, w._handPts);
        this.camA = cam.worldToLocal((this.camA || new THREE.Vector3()).copy(this.p[0]));
        this.camB = cam.worldToLocal((this.camB || new THREE.Vector3()).copy(this.p[1]));
      } else if (this.camA) {
        cam.localToWorld(this.p[0].copy(this.camA));
        cam.localToWorld(this.p[1].copy(this.camB));
      }
    }
    // integración (Verlet) de los puntos libres
    for (let i = this.held ? 2 : 0; i < n; i++) {
      const p = this.p[i], o = this.o[i];
      const vx = (p.x - o.x) * 0.996, vy = (p.y - o.y) * 0.996, vz = (p.z - o.z) * 0.996;
      o.copy(p);
      p.x += vx; p.y += vy - G * dt * dt; p.z += vz;
    }
    // longitudes fijas (mango rígido, eslabones)
    for (let it = 0; it < 12; it++) {
      for (let i = 1; i < n; i++) {
        const a = this.p[i - 1], b = this.p[i];
        const wa = this.held && i - 1 < 2 ? 0 : this.w[i - 1];
        const wb = this.held && i < 2 ? 0 : this.w[i];
        if (wa + wb === 0) continue;
        const d = this._v.copy(b).sub(a);
        const len = d.length() || 1e-6;
        const k = (len - this.rest[i]) / (len * (wa + wb));
        a.addScaledVector(d, k * wa);
        b.addScaledVector(d, -k * wb);
      }
    }
    // choques con suelo, mesa, paredes y puertas
    for (let i = this.held ? 2 : 0; i < n; i++) {
      const p = this.p[i], r = this.rad[i];
      if (p.y < r) { p.y = r; const o = this.o[i]; o.x += (p.x - o.x) * 0.3; o.z += (p.z - o.z) * 0.3; }
      for (const bl of w.blockers) {
        if (!bl.on) continue;
        const nrm = this.pushOut(p, r, bl.box, this._c);
        if (nrm && i === n - 1) this.ballHit(nrm, bl);
        if (nrm && nrm.y > 0.6) { const o = this.o[i]; o.x += (p.x - o.x) * 0.25; o.z += (p.z - o.z) * 0.25; } // rozamiento al apoyarse
      }
    }
  }

  ballVel(out) {
    const n = this.p.length;
    return out.copy(this.p[n - 1]).sub(this.o[n - 1]).divideScalar(this._dt || 1 / 60);
  }

  ballHit(nrm, blocker) {
    if (this._hitT > 0) return;
    const v = this.ballVel(this._b);
    const sp = -v.dot(nrm);
    if (sp < 1.2) return;
    const w = this.world;
    this._hitT = 0.12;
    w.ctx.sfx.play(sp > 3.5 ? 'slam' : 'thud');
    if (this.held) w.ctx.vibrate(Math.min(90, 15 + sp * 14));
    if (sp > 3.5) w.ctx.shake && w.ctx.shake(Math.min(0.5, sp * 0.06));
    // ¿una puerta? la bola la empuja (si no tiene el pestillo echado)
    if (w.doors) for (const d of w.doors) {
      if (d.blocker === blocker && !(d.latched && d.theta < 0.03)) {
        const side = Math.sign(d.pivot.worldToLocal(this._a.copy(this.p[this.p.length - 1])).z) || 1;
        d.omega += -side * Math.min(4, sp * 0.8);
      }
    }
  }

  // la bola contra cristales, pelotas y peluche
  hitObjects() {
    const w = this.world;
    const bp = this.p[this.p.length - 1];
    const v = this.ballVel(this._b);
    const sp = v.length();
    if (sp > 1.5) {
      const panes = [...(w.windows || []), w.vitrina].filter((p) => p && !p.broken);
      for (const pane of panes) {
        const box = this._box || (this._box = new THREE.Box3());
        box.setFromObject(pane.mesh);
        if (box.distanceToPoint(bp) < HIT_R) {
          w.breakPane(pane);
          if (this.held) w.ctx.vibratePattern([60, 30, 40]);
        }
      }
    }
    if (w.balls) for (const b of w.balls.list) {
      if (b.held) continue;
      const d = this._a.copy(b.pos).sub(bp);
      const dist = d.length();
      if (dist < HIT_R + b.r && dist > 1e-5) {
        d.divideScalar(dist);
        w.balls.wake(b);
        b.pos.addScaledVector(d, HIT_R + b.r - dist);
        b.vel.addScaledVector(d, Math.max(1, sp * 1.3)).y += sp * 0.3;
        b.sv += 4; b.axis.copy(d);
        if (sp > 1.5 && this._hitT <= 0) { w.ctx.sfx.play('bounce'); if (this.held) w.ctx.vibrate(25); this._hitT = 0.08; }
      }
    }
    if (w.plush && !w.plushHeld && sp > 1) {
      const c = w.plushCenter(this._c);
      if (c.distanceTo(bp) < HIT_R + 0.1) {
        w.squashV += sp * 3;
        w.plushFalling = true;
        w.plushVel.copy(v).multiplyScalar(0.6).y += 1;
        if (this._hitT <= 0) { w.ctx.sfx.play('squeak'); if (this.held) w.ctx.vibrate(30); this._hitT = 0.15; }
      }
    }
  }

  update(dt) {
    if (this.asleep && !this.held) return;
    this._hitT -= dt;
    const sub = 3;
    this._dt = dt / sub;
    for (let s = 0; s < sub; s++) this.step(dt / sub);
    this.hitObjects();

    // sonidos de la cadena y de la bola cortando el aire
    const sp = this.ballVel(this._b).length();
    this._rattleT -= dt; this._whooshT -= dt;
    if (sp > 1.2 && this._rattleT <= 0) { this.world.ctx.sfx.play('rattle'); this._rattleT = 0.25 + Math.random() * 0.2; }
    if (sp > 4 && this._whooshT <= 0) { this.world.ctx.sfx.play('whoosh'); this._whooshT = 0.45; }

    // en reposo, deja de simularse
    if (!this.held) {
      let moving = false;
      for (let i = 0; i < this.p.length; i++) if (this.p[i].distanceToSquared(this.o[i]) > 1e-8) { moving = true; break; }
      this.sleepT = moving ? 0 : this.sleepT + dt;
      if (this.sleepT > 1) this.asleep = true;
    }
    this.render();
  }

  render() {
    const P = this.p, n = P.length;
    // mango
    this.place(this.handle, P[0], P[1]);
    // eslabones: cada uno entre dos puntos, alternando el giro 90º
    for (let i = 0; i < LINKS; i++) {
      const a = P[i + 1], b = P[i + 2], m = this.links[i];
      const d = this._v.copy(b).sub(a);
      const len = d.length() || 1e-6;
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(UP, d.divideScalar(len));
      m.quaternion.multiply(this._q.setFromAxisAngle(UP, (i % 2) * Math.PI / 2));
    }
    // bola: mira en la dirección del último eslabón
    this.ball.position.copy(P[n - 1]);
    this.ball.quaternion.setFromUnitVectors(UP, this._v.copy(P[n - 1]).sub(P[n - 2]).normalize());
    this.item.refresh();
  }

  place(group, a, b) {
    const d = this._v.copy(b).sub(a);
    const len = d.length() || 1e-6;
    group.position.copy(a).add(b).multiplyScalar(0.5);
    group.quaternion.setFromUnitVectors(UP, d.divideScalar(len));
    group.scale.set(1, len, 1);
    // las piezas no deben estirarse con el mango
    const s = 1 / len;
    for (const k of ['grip', 'cap', 'ring']) this.handleParts[k].scale.set(1, s, 1);
  }
}
