// Puertas con física: bisagra, inercia, pestillo, portazo.
//  - Pomo: agárralo (mano abierta -> puño) y gira la muñeca para desbloquear.
//  - Maneta: agárrala y bájala.
//  - Con la manilla agarrada y desbloqueada, la puerta sigue tu mano (abrir despacio).
//  - Al soltar, sigue con su inercia. Con la mano abierta puedes empujarla; un empujón fuerte = portazo.
import * as THREE from 'three';
import { ps1Mat, boxGeo, makeTex } from './ps1.js';

const W = 0.9, H = 2.06, T = 0.05;        // hoja de la puerta
const MAX_OPEN = 1.75;                    // ~100º
const HANDLE_X = 0.79, HANDLE_Y = 1.0;    // posición de la manilla en la hoja
const LATCH_ZONE = 0.035;                 // por debajo de este ángulo el pestillo puede encajar

export class Door {
  constructor(world, { x, z, kind }) {
    this.world = world;
    this.kind = kind; // 'pomo' | 'maneta'
    this.theta = 0;
    this.omega = 0;
    this.latched = true;
    this.held = false;
    this.pushSide = 0;
    this.lever = 0;      // 0..1 maneta bajada
    this.knob = 0;       // giro del pomo (rad)
    this._v = new THREE.Vector3();
    this._l = new THREE.Vector3();
    this._creakT = 0;

    this.hinge = new THREE.Vector3(x, 0, z);
    this.pivot = new THREE.Group();
    this.pivot.position.copy(this.hinge);
    world.scene.add(this.pivot);
    const doorMat = ps1Mat({ map: makeTex('door'), color: kind === 'pomo' ? 0xb08870 : 0x8a9aa0 });
    this.leaf = new THREE.Mesh(boxGeo(W, H, T), doorMat);
    this.leaf.position.set(W / 2, H / 2, 0);
    this.pivot.add(this.leaf);
    world.colliders.push(this.leaf);
    this.blocker = { box: new THREE.Box3(), on: true };
    world.blockers.push(this.blocker);

    // manillas en las dos caras
    const brass = ps1Mat({ map: makeTex('metal'), color: 0xd8b060 });
    const steel = ps1Mat({ map: makeTex('metal'), color: 0xd0d4dc });
    this.handle = new THREE.Group();
    this.handle.position.set(HANDLE_X, HANDLE_Y, 0);
    this.pivot.add(this.handle);
    this.spinners = [];
    for (const side of [-1, 1]) {
      const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 8), kind === 'pomo' ? brass : steel);
      rose.rotation.x = Math.PI / 2;
      rose.position.z = side * (T / 2 + 0.006);
      this.handle.add(rose);
      const spin = new THREE.Group();            // lo que gira (pomo) o baja (maneta)
      spin.position.z = side * (T / 2 + 0.012);
      this.handle.add(spin);
      if (kind === 'pomo') {
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.035, 6), brass);
        stem.rotation.x = Math.PI / 2;
        stem.position.z = side * 0.017;
        const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 1), brass);
        ball.position.z = side * 0.052;
        ball.scale.set(1, 1, 0.8);
        spin.add(stem, ball);
      } else {
        const neck = new THREE.Mesh(boxGeo(0.018, 0.018, 0.045), steel);
        neck.position.z = side * 0.022;
        const bar = new THREE.Mesh(boxGeo(0.13, 0.02, 0.022), steel);
        bar.position.set(-0.06, 0, side * 0.045);   // la palanca apunta hacia la bisagra
        spin.add(neck, bar);
      }
      this.spinners.push(spin);
    }
    this.item = world.addItem({
      id: 'door-' + kind, gesture: 'grab', obj: this.handle, pad: 0.05,
      hint: () => this.held
        ? (this.latched ? (kind === 'pomo' ? 'POMO · gira la muñeca' : 'MANETA · bájala') : 'PUERTA · tira o empuja · abre la mano para soltar')
        : (kind === 'pomo' ? 'POMO · agárralo y gira la muñeca' : 'MANETA · agárrala y bájala'),
      act: () => this.grab(),
    });
    this.place();
  }

  handleWorld(out) { return this.handle.getWorldPosition(out); }

  grab() {
    const w = this.world;
    if (w.handBusy()) return;
    this.held = true;
    this.pushSide = 0;
    this.grabY = w._handPalm ? w._handPalm.y : HANDLE_Y;
    this.knob = 0;
    this.lastHeldT = w.time;
    w.ctx.sfx.play('rattle');
    w.ctx.vibrate(20);
  }

  release() {
    if (!this.held) return;
    this.held = false;
    this.pushSide = 0;
    this.world.ctx.sfx.play('latch');
  }

  twist() {
    if (!this.held || this.kind !== 'pomo') return;
    this.unlatch();
  }

  unlatch() {
    if (!this.latched) return;
    this.latched = false;
    this.world.ctx.sfx.play('latch');
    this.world.ctx.vibrate(25);
  }

  // ángulo (alrededor de la bisagra) de un punto del mundo
  angleOf(p) {
    return Math.atan2(p.z - this.hinge.z, p.x - this.hinge.x);
  }

  // Mano: agarrar (la puerta sigue a la mano) o empujar con la mano. Devuelve cuánto mover la mano
  // para dibujarla sobre la manilla (o null).
  touch(palmRaw, dt) {
    const w = this.world;
    const prev = this.theta;
    if (this.held) {
      // soltar: mano abierta, mano lejos de la manilla
      const hp = this.handleWorld(this._v);
      if (w._handOpen || palmRaw.distanceTo(hp) > 0.4) { this.release(); return null; }
      this.lastHeldT = w.time;
      if (this.kind === 'maneta') {
        const drop = Math.max(0, this.grabY - palmRaw.y);
        this.lever = Math.min(1, drop / 0.06);
        if (this.lever >= 0.85) this.unlatch();
      }
      if (!this.latched) {
        const r = Math.hypot(palmRaw.x - this.hinge.x, palmRaw.z - this.hinge.z);
        if (r > 0.25) {
          const target = Math.max(0, Math.min(MAX_OPEN, this.angleOf(palmRaw)));
          const d = target - this.theta;
          this.theta += Math.sign(d) * Math.min(Math.abs(d), 4 * dt);   // sigue a la mano (sin teletransportarse)
          this.omega = this.omega * 0.5 + ((this.theta - prev) / Math.max(dt, 1e-3)) * 0.5;
        }
      } else {
        // con el pestillo echado solo traquetea
        const pull = Math.abs(this.angleOf(palmRaw));
        this._rattleT = (this._rattleT || 0) - dt;
        if (pull > 0.08 && this._rattleT <= 0) { w.ctx.sfx.play('rattle'); w.ctx.vibrate(12); this._rattleT = 0.35; }
      }
      return this.handleWorld(this._l).sub(palmRaw);
    }

    // empujar con la mano (sin agarrar)
    const loc = this.pivot.worldToLocal(this._l.copy(palmRaw));
    const onLeaf = loc.x > 0.06 && loc.x < W + 0.02 && loc.y > 0.15 && loc.y < H;
    if (!onLeaf || Math.abs(loc.z) > 0.3) { this.pushSide = 0; return null; }
    const side = Math.sign(loc.z) || 1;
    if (Math.abs(loc.z) > T / 2 + 0.02) { this.pushSide = side; this.sideT = this.world.time; return null; }  // aún no toca
    if (!this.pushSide || this.world.time - this.sideT > 0.6) return null;   // hay que llegar desde un lado
    this.sideT = this.world.time;
    // la mano ha llegado a la hoja desde pushSide: la puerta cede hasta donde empujes
    if (this.latched && this.theta < LATCH_ZONE) {
      if (!this._bumped) { w.ctx.sfx.play('thud'); w.ctx.vibrate(18); this._bumped = true; }
      return null;
    }
    this._bumped = false;
    const r = Math.hypot(palmRaw.x - this.hinge.x, palmRaw.z - this.hinge.z);
    if (r < 0.1) return null;
    const a = this.angleOf(palmRaw) - this.pushSide * Math.asin(Math.min(1, (T / 2 + 0.02) / r));
    // pushSide -1 (cara de la habitación) abre; +1 (cara del pasillo) cierra
    if (this.pushSide < 0 && a > this.theta) this.theta = Math.min(MAX_OPEN, a);
    if (this.pushSide > 0 && a < this.theta) this.theta = Math.max(0, a);
    if (this.theta !== prev) {
      const v = (this.theta - prev) / Math.max(dt, 1e-3);
      this.omega = this.omega * 0.3 + v * 0.7;
      this.pushing = true;
    }
    return null;
  }

  update(dt) {
    const w = this.world;
    // movimiento libre con inercia (cuando nadie la sujeta ni la empuja ahora mismo)
    if (!this.held && !this.pushing) {
      this.theta += this.omega * dt;
      this.omega *= Math.exp(-1.6 * dt);           // rozamiento de las bisagras
      if (Math.abs(this.omega) < 0.02) this.omega = 0;
    }
    this.pushing = false;
    if (this.theta >= MAX_OPEN) {
      this.theta = MAX_OPEN;
      if (this.omega > 1) { w.ctx.sfx.play('thud'); w.ctx.vibrate(30); }
      this.omega = this.omega > 0 ? -this.omega * 0.25 : this.omega;
    }
    if (this.theta <= 0) {
      this.theta = 0;
      if (this.omega < -2.2) {
        // ¡portazo!
        w.ctx.sfx.play('slam');
        w.ctx.vibratePattern([90, 30, 50]);
        w.ctx.shake && w.ctx.shake(0.5);
        this.latched = true;
      } else if (this.omega < -0.15 || (!this.held && this.omega === 0 && !this.latched && prevNear(this))) {
        w.ctx.sfx.play('latch');
        this.latched = true;
      }
      this.omega = 0;
    }
    // el pestillo se vuelve a echar si la puerta queda cerrada sin sujetarla
    if (!this.held && this.theta < 0.005 && !this.latched) this.latched = true;

    // crujido según la velocidad (abrir despacio = crujido largo)
    const sp = Math.abs(this.omega);
    this.creak = sp > 0.05 ? Math.min(0.5, 0.12 + sp * 0.25) : 0;
    this.creakPitch = Math.min(1, sp * 0.6);
    if (this.held && !this.latched && sp > 0.08) {
      this._creakT -= dt;
      if (this._creakT <= 0) { w.ctx.vibrate(6); this._creakT = 0.15; }
    }

    // manillas
    if (!this.held || this.kind !== 'maneta') this.lever = Math.max(0, this.lever - dt * 6);
    if (this.kind === 'pomo') {
      const target = this.held ? (this.latched ? 0.15 : 1.0) : 0;
      this.knob += (target - this.knob) * Math.min(1, dt * 10);
    }
    for (const s of this.spinners) {
      if (this.kind === 'pomo') s.rotation.z = this.knob;
      else s.rotation.z = this.lever * 0.75 * Math.sign(s.position.z);
    }
    this.place();
  }

  place() {
    this.pivot.rotation.y = -this.theta;
    this.pivot.updateWorldMatrix(true, true);
    this.blocker.box.setFromObject(this.leaf);
    this.item.refresh();
  }
}

function prevNear(d) { return d.theta < LATCH_ZONE; }
