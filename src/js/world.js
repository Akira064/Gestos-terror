// Nivel: habitación + pasillo, objetos interactivos y lógica del puzzle.
import * as THREE from 'three';
import { ps1Mat, boxGeo, makeTex, makeTextTex } from './ps1.js';
import { Balls } from './balls.js';
import { Gun } from './gun.js';

const PLAYER_R = 0.24;

export class World {
  constructor(scene, ctx) {
    this.scene = scene;
    this.ctx = ctx; // { sfx, msg, flash, vibrate, vibratePattern, onWin, onShock }
    this.colliders = [];   // mallas que bloquean la mano (raycast)
    this.blockers = [];    // { box: Box3, on } bloquean al jugador
    this.items = [];       // objetos interactivos
    this.state = {
      lightOn: false, lightEver: false, glassBroken: false, hasKey: false,
      powerOn: true, doorOpen: false, scareDone: false, won: false,
    };
    this.flashFactor = 1;
    this.lockMove = false;
    this.time = 0;
    this._sparkT = 0;
    this.shards = [];
    this.anims = [];
    this.scare = null;
    this.build();
    this.buildWindows();
    this.buildPlush();
    this.mixers = [];
    this.defineModelSlots();
  }

  // ---------- modelos de Blender ----------
  // Cada hueco: dónde se cuelga el modelo y qué piezas procedurales se ocultan.
  // Las colisiones siguen usando las cajas invisibles originales.
  defineModelSlots() {
    const lever = this.leverPivot.children.slice();
    this.modelSlots = {
      peluche: { parent: this.plushInner, replace: true },
      caja: { parent: this.caja, hide: [this.caja] },
      llave: { parent: this.keyMesh, replace: true },
      mesa: { parent: this.tableAnchor, hide: this.tableMeshes },
      palanca: { parent: this.leverPivot, hide: lever },
      puerta: { parent: this.doorPivot, hide: [this.door] },
      monstruo: { parent: this.figure, replace: true, after: () => { this.figHead = new THREE.Object3D(); } },
      pedestal: { parent: this.scene, hide: [this.pedestal], at: this.pedestal.position.clone().setY(0) },
    };
  }

  hideProcedural(obj) {
    obj.traverse((o) => {
      if (o.isMesh || o.isLineSegments) {
        o.material = Array.isArray(o.material) ? o.material.map((m) => Object.assign(m.clone(), { visible: false })) : Object.assign(o.material.clone(), { visible: false });
      }
    });
  }

  attachModel(name, model, animations) {
    const slot = this.modelSlots[name];
    if (slot.replace) {
      for (const c of slot.parent.children.slice()) slot.parent.remove(c);
    }
    (slot.hide || []).forEach((o) => this.hideProcedural(o));
    if (slot.at) model.position.copy(slot.at);
    slot.parent.add(model);
    if (slot.after) slot.after();
    if (animations.length) {
      const mixer = new THREE.AnimationMixer(model);
      mixer.clipAction(animations[0]).play();
      this.mixers.push(mixer);
    }
    for (const it of this.items) it.refresh();
  }

  // ---------- mesa con peluche blando ----------
  buildPlush() {
    const wood = this.mat('wood', 0x8a6a50);
    const tx = 1.5, tz = 1.0, topY = 1.1;
    this.tableTop = topY;
    this.tableBox = { minX: tx - 0.45, maxX: tx + 0.45, minZ: tz - 0.3, maxZ: tz + 0.3 };
    this.tableMeshes = [this.box(0.9, 0.05, 0.6, tx, topY - 0.025, tz, wood)];
    for (const [lx, lz] of [[-0.4, -0.25], [0.4, -0.25], [-0.4, 0.25], [0.4, 0.25]]) {
      this.tableMeshes.push(this.box(0.05, topY - 0.05, 0.05, tx + lx, (topY - 0.05) / 2, tz + lz, wood, { hand: false, block: false }));
    }
    this.tableAnchor = new THREE.Group();
    this.tableAnchor.position.set(tx, 0, tz);
    this.scene.add(this.tableAnchor);

    // Peluche: raíz en los pies -> grupo de aplastado -> piezas
    const fur = this.mat('fur');
    const furLight = this.mat('fur', 0xe8c8a8);
    const black = new THREE.MeshBasicMaterial({ color: 0x050505 });
    this.plush = new THREE.Group();
    this.plushSquash = new THREE.Group();
    this.plushInner = new THREE.Group();
    this.plush.add(this.plushSquash);
    this.plushSquash.add(this.plushInner);
    const part = (r, x, y, z, m = fur, sx = 1, sy = 1, sz = 1) => {
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), m);
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      this.plushInner.add(mesh);
      return mesh;
    };
    part(0.085, 0, 0.1, 0, fur, 1, 1.15, 0.9);          // cuerpo
    part(0.05, 0, 0.1, 0.05, furLight, 1, 1.2, 0.5);     // barriga
    part(0.068, 0, 0.225, 0);                            // cabeza
    part(0.024, -0.05, 0.285, 0); part(0.024, 0.05, 0.285, 0); // orejas
    part(0.028, 0, 0.21, 0.058, furLight);               // hocico
    part(0.03, -0.085, 0.12, 0.02, fur, 0.8, 1.4, 0.8);  // brazos
    part(0.03, 0.085, 0.12, 0.02, fur, 0.8, 1.4, 0.8);
    part(0.034, -0.045, 0.025, 0.035);                   // piernas
    part(0.034, 0.045, 0.025, 0.035);
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.014, 0.01), black);
    eye.position.set(-0.026, 0.24, 0.063);
    this.plushInner.add(eye);
    const stitch = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.004, 0.01), new THREE.MeshBasicMaterial({ color: 0x5a1010 }));
    stitch.position.set(0.026, 0.24, 0.063); // le falta un ojo: solo un cosido
    stitch.rotation.z = 0.6;
    this.plushInner.add(stitch);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.01, 0.01), black);
    nose.position.set(0, 0.22, 0.085);
    this.plushInner.add(nose);

    this.plush.position.set(tx - 0.28, topY, tz);
    this.plush.rotation.y = -0.6;
    this.scene.add(this.plush);

    this.plushR = 0.14;              // radio blando
    this.squash = 0; this.squashV = 0; this.squashTarget = 0;
    this.squashAxis = new THREE.Vector3(0, 1, 0);
    this.plushHeld = false;
    this.plushVel = new THREE.Vector3();
    this.plushFalling = false;
    this._handPalm = null;
    this._prevHandPalm = new THREE.Vector3();
    this._handVel = new THREE.Vector3();
    this._softWas = false;
    this._squeakT = 0;

    // 10 pelotas en la mitad derecha de la mesa
    this.balls = new Balls(this, { x0: tx - 0.02, z0: tz - 0.08, topY });
    // revólver Magnum tumbado en el borde de la mesa más cercano a ti
    this.gun = new Gun(this, tx + 0.2, topY + 0.018, tz + 0.24);

    this.itPlush = this.addItem({
      id: 'plush', gesture: 'grab', obj: this.plush, pad: 0.05,
      hint: () => 'PELUCHE · apriétalo, o mano abierta y cierra el puño para cogerlo',
      act: () => this.grabPlush(),
    });
  }

  plushCenter(out) {
    return out.set(0, 0.13, 0).applyMatrix4(this.plush.matrixWorld);
  }

  // Contacto blando: devuelve cuánto hay que empujar la mano (o null). Aplasta el peluche.
  softTouch(palm, P) {
    this.squashTarget = this.plushHeld ? 0.25 : 0;
    if (this.plushHeld || !this.plush) return null;
    this.plush.updateWorldMatrix(true, false);
    const c = this.plushCenter(this._sc || (this._sc = new THREE.Vector3()));
    const R = this.plushR;
    let best = null, bd = R;
    for (const p of [palm, P[8], P[12], P[16], P[4]]) {
      const d = p.distanceTo(c);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) {
      if (this._softWas) this._softWas = false;
      return null;
    }
    const k = (R - bd) / R;                       // 0 en la superficie, 1 en el centro
    this.squashTarget = Math.min(0.6, k * 1.1);
    const dir = this._sd || (this._sd = new THREE.Vector3());
    dir.copy(c).sub(best);
    if (dir.lengthSq() < 1e-8) dir.set(0, -1, 0);
    dir.normalize();
    if (dir.y > 0) dir.negate();                  // eje de aplastado apuntando "hacia arriba"
    this.squashAxis.lerp(dir.negate(), 0.3).normalize();
    if (!this._softWas) { this._softWas = true; this.ctx.vibrate(10); this.ctx.sfx.play('squish'); }
    if (k > 0.45 && this._squeakT <= 0) { this.ctx.sfx.play('squeak'); this.ctx.vibrate(20); this._squeakT = 0.6; }
    // la mano entra hasta ~55% del radio y ahí se queda apoyada
    const minD = R * 0.45;
    if (bd < minD) {
      const push = new THREE.Vector3().copy(best).sub(c);
      if (push.lengthSq() < 1e-8) push.set(0, 1, 0);
      return push.normalize().multiplyScalar(minD - bd);
    }
    return null;
  }

  setHand(palm, open, P = null, squeeze = 0, normal = null) {
    this._handPts = P;
    this._squeeze = squeeze;
    this._palmNormal = normal;
    if (palm) {
      if (this._handPalm) this._handVel.lerp(this._v1 = (this._v1 || new THREE.Vector3()).copy(palm).sub(this._prevHandPalm).divideScalar(Math.max(this._dt || 0.016, 1e-3)), 0.4);
      this._prevHandPalm.copy(palm);
    }
    this._handPalm = palm;
    this._handOpen = open;
  }

  // Lanzar: abrir la mano mientras la mueves rápido
  isThrow() {
    return !!(this._handPalm && this._handOpen && this._handVel.length() > (this.throwSpeed || 1.0));
  }

  // Botón SOLTAR: deja caer lo que lleves, sin impulso
  dropHeld() {
    const zero = new THREE.Vector3();
    if (this.gun && this.gun.held) this.gun.release(zero);
    else if (this.balls && this.balls.held) this.balls.release(zero);
    else if (this.plushHeld) this.releasePlush(zero);
    else return false;
    this.ctx.sfx.play('grab');
    return true;
  }

  handBusy() {
    return !!(this.plushHeld || (this.balls && this.balls.held) || (this.gun && this.gun.held));
  }

  grabPlush() {
    if (this.handBusy()) return;
    this.plushHeld = true;
    this.plushFalling = false;
    this.itPlush.disabled = true;
    this.ctx.sfx.play('squish');
    this.ctx.sfx.play('squeak');
    this.ctx.vibrate(35);
  }

  releasePlush(vel = this._handVel) {
    this.plushHeld = false;
    this.plushFalling = true;
    this.plushVel.copy(vel).clampLength(0, 5);
    this.itPlush.disabled = false;
  }

  updatePlush(dt) {
    this._squeakT -= dt;
    // muelle amortiguado: se aplasta y rebota al soltar
    const a = (this.squashTarget - this.squash) * 220 - this.squashV * 14;
    this.squashV += a * dt;
    this.squash = Math.max(-0.25, Math.min(0.65, this.squash + this.squashV * dt));
    const q = this.plushSquash.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.squashAxis);
    this.plushInner.quaternion.copy(q).invert();
    const s = this.squash;
    this.plushSquash.scale.set(1 + s * 0.55, 1 - s, 1 + s * 0.55);

    if (this.plushHeld) {
      if (!this._handPalm) {
        // la mano salió de la cámara: el peluche se queda donde estaba respecto a la vista
        if (this._plushCam) this.ctx.camera.localToWorld(this.plush.position.copy(this._plushCam));
      } else if (this._handOpen) { this.releasePlush(); }
      else {
        // el peluche cuelga de la mano
        this.plush.position.copy(this._handPalm).add(this._po || (this._po = new THREE.Vector3(0, -0.15, 0)));
        this._plushCam = this.ctx.camera.worldToLocal((this._plushCam || new THREE.Vector3()).copy(this.plush.position));
        // que mire hacia ti (giro por el camino más corto)
        let dy = this.ctx.camYaw() + Math.PI - this.plush.rotation.y;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.plush.rotation.y += dy * Math.min(1, dt * 4);
      }
    } else if (this.plushFalling) {
      const p = this.plush.position, v = this.plushVel;
      v.y -= 9.8 * dt;
      p.addScaledVector(v, dt);
      // límites de la habitación / pasillo
      const inCorr = p.z < -2.45;
      const xm = inCorr ? 0.55 : 2.35;
      if (p.x < -xm) { p.x = -xm; v.x *= -0.3; }
      if (p.x > xm) { p.x = xm; v.x *= -0.3; }
      if (p.z > 2.35) { p.z = 2.35; v.z *= -0.3; }
      if (p.z < -12.5) { p.z = -12.5; v.z *= -0.3; }
      if (!inCorr && p.z < -2.35 && Math.abs(p.x) > 0.5) { p.z = -2.35; v.z *= -0.3; }
      const tb = this.tableBox;
      const overTable = p.x > tb.minX && p.x < tb.maxX && p.z > tb.minZ && p.z < tb.maxZ;
      const ground = overTable && p.y >= this.tableTop - 0.05 ? this.tableTop : 0;
      if (p.y <= ground) {
        p.y = ground;
        const impact = -v.y;
        if (impact > 0.6) { this.squashV += impact * 2.2; this.ctx.sfx.play('plop'); }
        v.y = impact > 1.2 ? impact * 0.25 : 0;
        v.x *= 0.5; v.z *= 0.5;
        if (v.y === 0 && v.lengthSq() < 0.01) { this.plushFalling = false; v.set(0, 0, 0); }
      }
    }
    this.itPlush.refresh();
  }

  // ---------- helpers ----------
  mat(tex, color = 0xffffff, extra = {}) {
    return ps1Mat({ map: makeTex(tex), color, ...extra });
  }

  box(w, h, d, x, y, z, material, { hand = true, block = true, ts = 1, parent = null } = {}) {
    const m = new THREE.Mesh(boxGeo(w, h, d, ts), material);
    m.position.set(x, y, z);
    (parent || this.scene).add(m);
    if (hand) this.colliders.push(m);
    if (block) {
      m.updateWorldMatrix(true, false);
      const b = { box: new THREE.Box3().setFromObject(m), on: true, mesh: m };
      this.blockers.push(b);
      m.userData.blocker = b;
    }
    return m;
  }

  removeCollider(mesh) {
    const i = this.colliders.indexOf(mesh);
    if (i >= 0) this.colliders.splice(i, 1);
    if (mesh.userData.blocker) mesh.userData.blocker.on = false;
  }

  addItem(it) {
    it.box = new THREE.Box3();
    it.refresh = () => { it.obj.updateWorldMatrix(true, true); it.box.setFromObject(it.obj); if (it.pad) it.box.expandByScalar(it.pad); };
    it.refresh();
    this.items.push(it);
    return it;
  }

  // ---------- construcción ----------
  build() {
    const S = this.scene;
    const wall = this.mat('wallpaper');
    const brick = this.mat('brick');
    const floor = this.mat('floor');
    const ceil = this.mat('ceiling');
    const wood = this.mat('wood');
    const metal = this.mat('metal');
    const concrete = this.mat('concrete');

    // Habitación 5x5, techo 2.6
    this.box(5, 0.1, 5, 0, -0.05, 0, floor, { block: false, ts: 0.8 });
    this.box(5, 0.1, 5, 0, 2.65, 0, ceil, { block: false, ts: 0.8 });
    this.box(5.4, 2.7, 0.2, 0, 1.35, 2.6, wall, { ts: 1.2 });
    this.box(0.2, 2.7, 5.4, -2.6, 1.35, 0, wall, { ts: 1.2 });
    this.box(0.2, 2.7, 5.4, 2.6, 1.35, 0, wall, { ts: 1.2 });
    this.box(2.15, 2.7, 0.2, -1.625, 1.35, -2.6, wall, { ts: 1.2 });
    this.box(2.15, 2.7, 0.2, 1.625, 1.35, -2.6, wall, { ts: 1.2 });
    this.box(1.1, 0.6, 0.2, 0, 2.4, -2.6, wall, { ts: 1.2 });
    // zócalo
    const skirting = this.mat('wood', 0x7a6050);
    this.box(4.98, 0.12, 0.03, 0, 0.06, 2.485, skirting, { hand: false, block: false });
    this.box(0.03, 0.12, 4.98, -2.485, 0.06, 0, skirting, { hand: false, block: false });
    this.box(0.03, 0.12, 4.98, 2.485, 0.06, 0, skirting, { hand: false, block: false });

    // Pasillo (x ±0.7, z -2.7 .. -12.7)
    this.box(1.4, 0.1, 10.2, 0, -0.05, -7.7, concrete, { block: false, ts: 0.8 });
    this.box(1.4, 0.1, 10.2, 0, 2.45, -7.7, concrete, { block: false, ts: 0.8 });
    this.box(0.2, 2.6, 10.2, -0.8, 1.25, -7.7, brick, { ts: 0.9 });
    this.box(0.2, 2.6, 10.2, 0.8, 1.25, -7.7, brick, { ts: 0.9 });
    this.box(1.8, 2.6, 0.2, 0, 1.25, -12.8, brick, { ts: 0.9 });
    // tuberías del pasillo
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 10, 5), this.mat('rust'));
    pipe.rotation.x = Math.PI / 2; pipe.position.set(0.6, 2.25, -7.7); S.add(pipe);

    // Puerta de salida del pasillo + cartel
    this.box(0.9, 2.0, 0.06, 0, 1.0, -12.68, this.mat('metal', 0x5a7060), { block: false });
    const exitTex = makeTextTex('SALIDA', { w: 64, h: 16, color: '#30ff60', bg: '#041008', font: 'bold 11px monospace' });
    this.exitSign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.13), new THREE.MeshBasicMaterial({ map: exitTex, color: 0x222222 }));
    this.exitSign.position.set(0, 2.15, -12.66);
    S.add(this.exitSign);

    // Nota en la pared
    const note = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 0.35),
      ps1Mat({ map: makeTextTex(['LUZ · CRISTAL · CAJA', 'CORRIENTE · PUERTA'], { w: 128, h: 64, color: '#7a140e' }), transparent: true })
    );
    note.position.set(-1.5, 1.55, -2.489);
    S.add(note);

    // ---------- Bombilla y cuerda ----------
    this.box(0.18, 0.05, 0.18, 0, 2.575, 0, metal, { block: false });
    this.bulbMat = new THREE.MeshBasicMaterial({ color: 0x222018 });
    this.bulb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), this.bulbMat);
    this.bulb.position.set(0, 2.47, 0);
    S.add(this.bulb);
    this.bulbLight = new THREE.PointLight(0xffd29a, 0, 8, 2);
    this.bulbLight.position.set(0, 2.35, 0);
    S.add(this.bulbLight);

    this.cordTop = 2.6;
    this.cordLen = 1.0;
    this.cord = new THREE.Mesh(new THREE.BoxGeometry(0.008, 1, 0.008), this.mat('cloth', 0xbbbbbb));
    this.cordHandle = new THREE.Mesh(boxGeo(0.025, 0.07, 0.025), this.mat('wood', 0xddccaa));
    S.add(this.cord, this.cordHandle);
    this.cordPos = new THREE.Vector3(0.22, 0, 0.25);
    this.setCord(0);

    // ---------- Vitrina con caja ----------
    this.pedestal = this.box(0.6, 1.05, 0.6, -2.0, 0.525, 0.6, wood);
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x9fd8e0, transparent: true, opacity: 0.22, depthWrite: false });
    this.glass = this.box(0.52, 0.46, 0.52, -2.0, 1.28, 0.6, glassMat, { block: false });
    this.glassEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(this.glass.geometry),
      new THREE.LineBasicMaterial({ color: 0x8fb8c0, transparent: true, opacity: 0.6 })
    );
    this.glass.add(this.glassEdges);
    this.caja = this.box(0.16, 0.11, 0.16, -2.0, 1.11, 0.6, this.mat('rust', 0xcc8866), { block: false });
    const lid = new THREE.Mesh(boxGeo(0.17, 0.025, 0.17), this.mat('metal', 0xaa7744));
    lid.position.y = 0.065;
    this.caja.add(lid);

    // ---------- Cuadro eléctrico y palanca (pared este) ----------
    this.box(0.06, 0.55, 0.42, 2.47, 1.3, -0.8, metal);
    this.box(0.01, 0.1, 0.42, 2.435, 1.62, -0.8, this.mat('hazard'), { block: false });
    this.leverPivot = new THREE.Group();
    this.leverPivot.position.set(2.42, 1.3, -0.8);
    S.add(this.leverPivot);
    const arm = new THREE.Mesh(boxGeo(0.035, 0.24, 0.035), this.mat('metal', 0xbbbbbb));
    arm.position.y = 0.12;
    const knob = new THREE.Mesh(boxGeo(0.06, 0.06, 0.1), this.mat('rust', 0xaa2222));
    knob.position.y = 0.25;
    this.leverPivot.add(arm, knob);
    this.leverUp = 0.35;
    this.leverDown = 2.55;
    this.leverPivot.rotation.z = this.leverUp;
    this.leverLamp = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.04), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
    this.leverLamp.position.set(2.435, 1.5, -0.95);
    S.add(this.leverLamp);

    // ---------- Puerta con cerradura ----------
    this.doorPivot = new THREE.Group();
    this.doorPivot.position.set(-0.5, 0, -2.6);
    S.add(this.doorPivot);
    this.door = this.box(1.0, 2.05, 0.08, 0.5, 1.025, 0, this.mat('door'), { block: false, parent: this.doorPivot });
    this.doorBlocker = { box: new THREE.Box3(new THREE.Vector3(-0.55, 0, -2.7), new THREE.Vector3(0.55, 2.1, -2.5)), on: true };
    this.blockers.push(this.doorBlocker);
    this.lock = this.box(0.08, 0.15, 0.04, 0.86, 1.15, 0.06, metal, { block: false, parent: this.doorPivot });
    const hole = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.035, 0.01), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    hole.position.set(0, -0.02, 0.021);
    this.lock.add(hole);
    const handle = new THREE.Mesh(boxGeo(0.1, 0.025, 0.04), metal);
    handle.position.set(0.82, 1.27, 0.08);
    this.doorPivot.add(handle);

    // llave (visible al acercarla a la cerradura)
    this.keyMesh = new THREE.Group();
    const keyMat = this.mat('metal', 0xd8b060);
    const shaft = new THREE.Mesh(boxGeo(0.012, 0.012, 0.07), keyMat);
    shaft.position.z = 0.035;
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.007, 3, 6), keyMat);
    bow.position.z = 0.08;
    this.keyMesh.add(shaft, bow);
    this.keyMesh.position.set(0, -0.02, 0.0);
    this.keyMesh.visible = false;
    this.lock.add(this.keyMesh);

    // chispas en la cerradura (corriente activa)
    const sp = new Float32Array(14 * 3);
    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.sparks = new THREE.Points(this.sparkGeo, new THREE.PointsMaterial({ color: 0x9fd0ff, size: 0.02, sizeAttenuation: true }));
    this.lock.add(this.sparks);

    // luz de emergencia (tras cortar la corriente)
    this.emergency = new THREE.PointLight(0xff2010, 0, 7, 2);
    this.emergency.position.set(2.2, 2.3, 2.2);
    S.add(this.emergency);
    const eBox = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: 0x300404 }));
    eBox.position.set(2.45, 2.35, 2.2);
    this.emergencyBox = eBox;
    S.add(eBox);

    // luces del pasillo
    this.corrLights = [-5.0, -9.0].map((z) => {
      const l = new THREE.PointLight(0xcfd6a8, 0, 5, 2);
      l.position.set(0, 2.2, z);
      S.add(l);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.1), new THREE.MeshBasicMaterial({ color: 0x222222 }));
      b.position.set(0, 2.39, z);
      S.add(b);
      l.userData.mesh = b;
      return l;
    });
    this.exitLight = new THREE.PointLight(0x30ff60, 0, 4, 2);
    this.exitLight.position.set(0, 1.9, -12.2);
    S.add(this.exitLight);

    // figura del susto
    this.figure = new THREE.Group();
    const fMat = this.mat('figure');
    const pale = this.mat('skin', 0x8a8c80);
    const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const body = new THREE.Mesh(boxGeo(0.42, 1.25, 0.22), fMat); body.position.y = 0.95;
    const head = new THREE.Mesh(boxGeo(0.24, 0.32, 0.24), pale); head.position.y = 1.8;
    const e1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.01), black); e1.position.set(-0.055, 1.84, 0.125);
    const e2 = e1.clone(); e2.position.x = 0.055;
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.01), black); mouth.position.set(0, 1.7, 0.125);
    const armL = new THREE.Mesh(boxGeo(0.07, 1.0, 0.07), pale); armL.position.set(-0.27, 0.95, 0.03); armL.rotation.z = 0.05;
    const armR = armL.clone(); armR.position.x = 0.27; armR.rotation.z = -0.05;
    this.figHead = head;
    this.figure.add(body, head, e1, e2, mouth, armL, armR);
    this.figure.position.set(0, 0, -10.5);
    this.figure.visible = false;
    S.add(this.figure);

    // ---------- Objetos interactivos (cada uno con su único gesto) ----------
    this.itCord = this.addItem({
      id: 'cord', gesture: 'pull', obj: this.cordHandle, pad: 0.06,
      hint: () => (this.state.powerOn ? 'CUERDA · pellizca y tira hacia abajo' : 'CUERDA · no hay corriente'),
      act: () => this.pullCord(),
    });
    this.itGlass = this.addItem({
      id: 'glass', gesture: 'punch', obj: this.glass, pad: 0.02,
      hint: () => 'VITRINA · puño y golpe rápido',
      act: () => this.breakGlass(),
      knock: () => this.knockGlass(), // golpe flojo: agrieta
    });
    this.vitrina = {
      mesh: this.glass, edges: this.glassEdges, cracks: 0, broken: false, item: this.itGlass,
      normal: new THREE.Vector3(1, 0, 0),
      onBreak: () => {
        this.state.glassBroken = true;
        this.itBox.disabled = false;
        this.ctx.msg('El cristal estalla. Hay una caja oxidada dentro.', 3);
      },
    };
    this.itBox = this.addItem({
      id: 'box', gesture: 'grab', obj: this.caja, pad: 0.04, disabled: true,
      hint: () => 'CAJA · mano abierta y cierra el puño',
      act: () => this.grabBox(),
    });
    this.itLever = this.addItem({
      id: 'lever', gesture: 'lever', obj: this.leverPivot, pad: 0.05,
      hint: () => (this.state.powerOn ? 'PALANCA · puño y tira hacia abajo' : 'PALANCA · corriente cortada'),
      act: () => this.pullLever(),
    });
    this.itLock = this.addItem({
      id: 'lock', gesture: 'twist', obj: this.lock, pad: 0.06,
      hint: () => (this.state.hasKey ? 'CERRADURA · gira la muñeca' : 'CERRADURA · necesitas una llave'),
      need: () => (this.state.hasKey ? null : 'Necesitas una llave.'),
      act: () => this.turnKey(),
    });
  }

  buildWindows() {
    this.windows = [
      this.addWindow(-1.1, 1.5, 2.49, Math.PI),        // pared sur (detrás del inicio)
      this.addWindow(-2.49, 1.5, -1.3, Math.PI / 2),   // pared oeste
      this.addWindow(2.49, 1.55, 1.3, -Math.PI / 2),   // pared este
      this.addWindow(0.69, 1.45, -8.2, -Math.PI / 2, 0.6, 0.55), // pasillo
    ];
  }

  setCord(pull) {
    const len = this.cordLen + pull;
    this.cord.scale.y = len;
    this.cord.position.set(this.cordPos.x, this.cordTop - len / 2, this.cordPos.z);
    this.cordHandle.position.set(this.cordPos.x, this.cordTop - len - 0.03, this.cordPos.z);
  }

  // ---------- acciones ----------
  pullCord() {
    const s = this.state;
    const { sfx, msg } = this.ctx;
    sfx.play('click');
    this.ctx.vibrate(30);
    if (!s.powerOn) { msg('Click… Nada. No hay corriente.'); return; }
    s.lightOn = !s.lightOn;
    if (s.lightOn) {
      sfx.play('bulb');
      if (!s.lightEver) msg('La bombilla parpadea… hay una vitrina al fondo.', 3.5);
      s.lightEver = true;
    }
    sfx.setHum(s.lightOn ? 0.04 : 0.025);
  }

  // ---------- cristales rompibles (vitrina y ventanas) ----------
  knockPane(p) {
    if (p.broken) return;
    p.cracks += 1;
    this.ctx.sfx.play('crack');
    this.ctx.vibrate(40);
    if (p.cracks >= 3) { this.breakPane(p); return; }
    p.mesh.material.opacity = 0.22 + p.cracks * 0.12;
    p.mesh.material.color.set(p.cracks === 1 ? 0xb8e4ea : 0xd8f0f2);
    p.edges.material.color.set(0xffffff);
    this.ctx.msg(p.cracks === 1 ? 'El cristal se agrieta…' : 'Está a punto de romperse…', 1.8);
  }

  breakPane(p) {
    if (p.broken) return;
    p.broken = true;
    const { sfx } = this.ctx;
    sfx.play('glass');
    this.ctx.vibratePattern([60, 30, 90]);
    this.ctx.flash('#ffffff', 0.25);
    p.mesh.visible = false;
    this.removeCollider(p.mesh);
    p.item.disabled = true;
    // trozos de cristal desde el centro del panel, saliendo hacia el jugador
    const box = new THREE.Box3().setFromObject(p.mesh);
    const c = box.getCenter(new THREE.Vector3());
    const sz = box.getSize(new THREE.Vector3());
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.05, 0.01, 0, 0.01, 0.06, 0], 3));
    const m = new THREE.MeshBasicMaterial({ color: 0xa8e0ea, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    for (let i = 0; i < 26; i++) {
      const sh = new THREE.Mesh(g, m);
      sh.position.set(c.x + (Math.random() - 0.5) * sz.x, c.y + (Math.random() - 0.5) * sz.y, c.z + (Math.random() - 0.5) * sz.z);
      sh.scale.setScalar(0.6 + Math.random() * 1.2);
      const v = new THREE.Vector3((Math.random() - 0.5) * 1.2, Math.random() * 1.0, (Math.random() - 0.5) * 1.2);
      if (p.normal) v.addScaledVector(p.normal, 1.2 + Math.random());
      sh.userData.v = v;
      sh.userData.w = new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9);
      this.scene.add(sh);
      this.shards.push(sh);
    }
    if (p.onBreak) p.onBreak();
  }

  knockGlass() { this.knockPane(this.vitrina); }
  breakGlass() { this.breakPane(this.vitrina); }

  addWindow(x, y, z, rotY, w = 0.8, h = 0.7) {
    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    grp.rotation.y = rotY;
    this.scene.add(grp);
    // noche detrás del cristal
    const night = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: makeTex('night'), color: 0x8090b0, fog: false }));
    night.position.z = 0.002;
    grp.add(night);
    const frame = this.mat('wood', 0x6a5040);
    const bars = [[w + 0.1, 0.05, 0, h / 2 + 0.025], [w + 0.1, 0.05, 0, -h / 2 - 0.025], [0.05, h, -w / 2 - 0.025, 0], [0.05, h, w / 2 + 0.025, 0], [0.025, h, 0, 0], [w, 0.025, 0, 0]];
    for (const [bw, bh, bx, by] of bars) {
      const b = new THREE.Mesh(boxGeo(bw, bh, 0.05), frame);
      b.position.set(bx, by, 0.025);
      grp.add(b);
    }
    const pane = new THREE.Mesh(boxGeo(w, h, 0.012), new THREE.MeshLambertMaterial({ color: 0x9fd8e0, transparent: true, opacity: 0.25, depthWrite: false }));
    pane.position.z = 0.03;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(pane.geometry), new THREE.LineBasicMaterial({ color: 0x8fb8c0, transparent: true, opacity: 0.6 }));
    pane.add(edges);
    grp.add(pane);
    grp.updateWorldMatrix(true, true);
    this.colliders.push(pane);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(grp.quaternion);
    const p = {
      mesh: pane, edges, cracks: 0, broken: false, normal,
      onBreak: () => { this.ctx.sfx.play('wind'); this.ctx.msg('Entra un aire helado por la ventana…', 2.5); },
    };
    p.item = this.addItem({
      id: 'window', gesture: 'punch', obj: pane, pad: 0.04,
      hint: () => 'VENTANA · puño y golpe rápido',
      act: () => this.breakPane(p),
      knock: () => this.knockPane(p),
    });
    return p;
  }

  grabBox() {
    const { sfx, msg } = this.ctx;
    this.state.hasKey = true;
    sfx.play('grab');
    sfx.play('key');
    this.ctx.vibrate(50);
    this.caja.visible = false;
    this.removeCollider(this.caja);
    this.itBox.disabled = true;
    this.ctx.inventory('[ LLAVE OXIDADA ]');
    msg('Dentro de la caja hay una llave.', 3);
  }

  pullLever() {
    const s = this.state;
    const { sfx, msg } = this.ctx;
    if (!s.powerOn) return;
    s.powerOn = false;
    sfx.play('lever');
    this.ctx.vibratePattern([90, 40, 60]);
    this.anims.push({ t: 0, dur: 0.25, fn: (k) => { this.leverPivot.rotation.z = this.leverUp + (this.leverDown - this.leverUp) * k; } });
    s.lightOn = false;
    sfx.setHum(0);
    this.leverLamp.material.color.set(0x113311);
    this.emergencyBox.material.color.set(0xff2a10);
    msg('Se corta la corriente. Solo queda la luz de emergencia.', 3.5);
  }

  turnKey() {
    const s = this.state;
    const { sfx, msg } = this.ctx;
    if (s.doorOpen) return;
    if (s.powerOn) {
      sfx.play('shock');
      this.ctx.vibratePattern([120, 50, 160, 50, 80]);
      this.ctx.flash('#bfe0ff', 0.85);
      this.ctx.onShock();
      msg('¡CALAMBRE! La cerradura está electrificada.', 3);
      return;
    }
    s.doorOpen = true;
    sfx.play('unlock');
    setTimeout(() => sfx.play('creak'), 350);
    this.ctx.vibrate(60);
    this.keyMesh.visible = false;
    this.itLock.disabled = true;
    this.doorBlocker.on = false;
    this.removeCollider(this.lock);
    this.anims.push({ t: -0.35, dur: 2.2, fn: (k) => { this.doorPivot.rotation.y = 1.55 * (1 - (1 - k) * (1 - k)); } });
    this.corrLights.forEach((l) => { l.userData.on = true; });
    this.ctx.inventory('');
    msg('La puerta cede…', 2.5);
  }

  // ---------- consultas ----------
  // P: puntos de la mano en mundo (palma + yemas)
  findHover(points, maxDist) {
    let best = null, bd = maxDist;
    for (const it of this.items) {
      if (it.disabled) continue;
      for (const p of points) {
        const d = it.box.distanceToPoint(p);
        if (d < bd) { bd = d; best = it; }
      }
    }
    return best;
  }

  handleEvent(evt, it) {
    if (!it || it.disabled) return false;
    // Un golpe flojo es el mismo gesto (puño + golpe), solo que con menos fuerza
    if (evt === 'knock' && it.knock) {
      const need = it.need && it.need();
      if (need) { this.ctx.msg(need, 2); this.ctx.sfx.play('denied'); return false; }
      it.knock();
      return true;
    }
    if (it.gesture !== evt) return false; // cada objeto solo acepta su gesto
    const need = it.need && it.need();
    if (need) { this.ctx.msg(need, 2); this.ctx.sfx.play('denied'); return false; }
    it.act();
    return true;
  }

  collide(x, z) {
    for (const b of this.blockers) {
      if (!b.on) continue;
      const bx = b.box;
      if (bx.max.y < 0.15 || bx.min.y > 1.7) continue;
      const cx = Math.max(bx.min.x, Math.min(x, bx.max.x));
      const cz = Math.max(bx.min.z, Math.min(z, bx.max.z));
      if ((x - cx) ** 2 + (z - cz) ** 2 < PLAYER_R * PLAYER_R) return true;
    }
    return false;
  }

  // ---------- actualización por frame ----------
  update(dt, player, hovered, g) {
    this.time += dt;
    this._dt = dt;
    if (this.plush) this.updatePlush(dt);
    for (const m of this.mixers) m.update(dt);
    if (this.balls) this.balls.update(dt);
    if (this.gun) this.gun.update(dt);
    const s = this.state;
    const t = this.time;
    const { sfx } = this.ctx;

    // animaciones
    this.anims = this.anims.filter((a) => {
      a.t += dt;
      const k = Math.min(1, Math.max(0, a.t / a.dur));
      a.fn(k);
      if (k >= 1 && a.done) a.done();
      return k < 1;
    });
    this.itLever.refresh();

    // bombilla
    if (s.lightOn) {
      const fl = Math.random() < 0.02 ? 0.3 : 1;
      this.bulbLight.intensity = 9 * fl * (0.95 + Math.sin(t * 50) * 0.03);
      this.bulbMat.color.set(fl < 1 ? 0x554420 : 0xfff0c0);
      if (fl < 1 && Math.random() < 0.3) sfx.play('flicker');
    } else {
      this.bulbLight.intensity = 0;
      this.bulbMat.color.set(0x222018);
    }

    // luz de emergencia
    this.emergency.intensity = s.powerOn ? 0 : 2.6 + Math.sin(t * 2.2) * 0.8;

    // cuerda: se estira mientras haces la pinza encima
    const cordPull = hovered === this.itCord && g && g.pinchActive ? Math.min(0.12, g.pinchDrop) : 0;
    this._cordPull = (this._cordPull || 0) + (cordPull - (this._cordPull || 0)) * Math.min(1, dt * 18);
    this.setCord(this._cordPull);
    this.itCord.refresh();

    // palanca: previsualiza el recorrido mientras bajas el puño
    if (s.powerOn && !this.anims.length) {
      const k = hovered === this.itLever && g && g.fistActive ? Math.min(0.6, g.fistDrop / Math.max(0.01, g.th.lever)) * 0.5 : 0;
      this.leverPivot.rotation.z += (this.leverUp + (this.leverDown - this.leverUp) * k - this.leverPivot.rotation.z) * Math.min(1, dt * 12);
    }

    // llave en la cerradura
    if (s.hasKey && !s.doorOpen && hovered === this.itLock) {
      this.keyMesh.visible = true;
      this.keyMesh.rotation.z = g ? THREE.MathUtils.clamp(g.twistAcc, -1.6, 1.6) : 0;
    } else this.keyMesh.visible = false;

    // chispas
    const sparkOn = s.powerOn && !s.doorOpen;
    this.sparks.visible = sparkOn && Math.random() < 0.55;
    if (this.sparks.visible) {
      const a = this.sparkGeo.attributes.position;
      for (let i = 0; i < a.count; i++) a.setXYZ(i, (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.2, 0.03 + Math.random() * 0.04);
      a.needsUpdate = true;
    }
    this._sparkT -= dt;
    if (sparkOn && this._sparkT <= 0) {
      this._sparkT = 0.15 + Math.random() * 0.6;
      const d = Math.hypot(player.x - 0.36, player.z + 2.55);
      if (d < 3.2) sfx.play('spark');
    }

    // cristales cayendo
    for (const sh of this.shards) {
      const v = sh.userData.v;
      if (sh.position.y > 0.01) {
        v.y -= 9.8 * dt;
        sh.position.addScaledVector(v, dt);
        sh.rotation.x += sh.userData.w.x * dt;
        sh.rotation.y += sh.userData.w.y * dt;
        if (sh.position.y <= 0.01) { sh.position.y = 0.01; sh.rotation.set(-Math.PI / 2, 0, Math.random() * 6); }
      }
    }

    // luces del pasillo (parpadeo)
    for (const l of this.corrLights) {
      let on = l.userData.on && !(this.scare && this.scare.t < 2.0);
      if (on && Math.random() < 0.05) on = false;
      l.intensity = on ? (this.state.scareDone ? 1.6 : 2.6) : 0;
      l.color.set(this.state.scareDone ? 0xff4030 : 0xcfd6a8);
      l.userData.mesh.material.color.set(on ? 0xd8dcb0 : 0x222222);
    }
    this.exitLight.intensity = s.scareDone ? 2.5 + Math.sin(t * 3) * 0.5 : 0;
    this.exitSign.material.color.set(s.scareDone ? 0xffffff : 0x333333);

    // susto en el pasillo
    if (s.doorOpen && !this.scare && player.z < -6.2) this.startScare();
    if (this.scare) this.updateScare(dt, player);

    // salida
    if (!s.won && s.scareDone && player.z < -12.1) {
      s.won = true;
      this.ctx.sfx.play('win');
      this.ctx.onWin();
    }
  }

  startScare() {
    const { sfx } = this.ctx;
    this.scare = { t: 0, stage: 0, startZ: -10.5 };
    this.figure.visible = true;
    this.figure.position.set(0, 0, -10.5);
    sfx.play('stinger');
    sfx.setAmbient(0.25);
    this.ctx.vibratePattern([250, 80, 350]);
    this.lockMove = true;
  }

  updateScare(dt, player) {
    const sc = this.scare;
    sc.t += dt;
    const t = sc.t;
    if (t < 0.3) {
      this.flashFactor = Math.random() < 0.5 ? 0.15 : 1;
    } else if (t < 0.95) {
      const k = (t - 0.3) / 0.65;
      this.figure.position.z = THREE.MathUtils.lerp(sc.startZ, player.z - 0.9, k * k);
      this.figure.position.x = Math.sin(t * 40) * 0.03;
      this.figHead.rotation.z = Math.sin(t * 25) * 0.4;
      this.flashFactor = Math.random() < 0.3 ? 0.2 : 1;
    } else if (sc.stage === 0) {
      sc.stage = 1;
      this.figure.visible = false;
      this.ctx.flash('#600000', 0.9);
      this.ctx.sfx.play('thud');
      this.ctx.vibrate(400);
      this.flashFactor = 0;
    } else if (t < 2.1) {
      this.flashFactor = 0;
    } else if (sc.stage === 1) {
      sc.stage = 2;
      this.flashFactor = 1;
      this.state.scareDone = true;
      this.lockMove = false;
      this.ctx.sfx.setAmbient(0.11);
      this.ctx.msg('CORRE. La salida está al fondo.', 3);
    }
  }
}
