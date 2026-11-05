// Revólver Magnum: se coge con la mano, dispara al apretar el gatillo con el índice,
// 6 balas, recarga girando la muñeca. Las balas rompen cristales, empujan pelotas y peluche
// y dejan agujeros en las paredes.
import * as THREE from 'three';
import { ps1Mat, boxGeo, makeTex } from './ps1.js';

const MAX_AMMO = 6;

export class Gun {
  constructor(world, x, y, z) {
    this.world = world;
    this.ammo = MAX_AMMO;
    this.held = false;
    this.falling = false;
    this.vel = new THREE.Vector3();
    this.kick = 0;
    this.kickV = 0;
    this.cylSpin = 0;
    this.flashT = 0;
    this.ray = new THREE.Raycaster();
    this._m = new THREE.Matrix4();
    this._x = new THREE.Vector3(); this._y = new THREE.Vector3(); this._z = new THREE.Vector3();
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
    this._q = new THREE.Quaternion();

    // ----- modelo low poly (el cañón apunta a -Z, arriba es +Y, origen en la empuñadura) -----
    const metal = ps1Mat({ map: makeTex('gunmetal'), color: 0xb0b4bc });
    const dark = ps1Mat({ map: makeTex('gunmetal'), color: 0x55585e });
    const grip = ps1Mat({ map: makeTex('wood'), color: 0x9a5a30 });
    const g = (this.root = new THREE.Group());
    this.model = new THREE.Group();
    g.add(this.model);
    const add = (geo, mat, x, y, z, rx = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      this.model.add(m);
      return m;
    };
    add(boxGeo(0.03, 0.1, 0.045), grip, 0, -0.035, 0.012, -0.28);        // empuñadura
    add(boxGeo(0.032, 0.045, 0.085), metal, 0, 0.035, -0.035);           // armazón
    this.cyl = add(new THREE.CylinderGeometry(0.022, 0.022, 0.045, 6), dark, 0, 0.035, -0.06, Math.PI / 2); // tambor
    add(new THREE.CylinderGeometry(0.009, 0.009, 0.17, 6), metal, 0, 0.046, -0.165, Math.PI / 2);          // cañón largo
    add(boxGeo(0.014, 0.012, 0.17), dark, 0, 0.031, -0.165);             // varilla bajo el cañón
    add(boxGeo(0.006, 0.01, 0.012), dark, 0, 0.058, -0.24);              // punto de mira
    add(boxGeo(0.01, 0.02, 0.012), dark, 0, 0.062, 0.006, -0.5);         // martillo
    add(boxGeo(0.006, 0.022, 0.006), dark, 0, 0.004, -0.03, 0.4);        // gatillo
    add(boxGeo(0.008, 0.006, 0.05), metal, 0, -0.012, -0.03);            // guardamonte
    this.muzzle = new THREE.Vector3(0, 0.046, -0.255);

    // fogonazo
    this.flashMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.09, 0.09),
      new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false })
    );
    this.flashMesh.position.copy(this.muzzle).add(new THREE.Vector3(0, 0, -0.03));
    this.model.add(this.flashMesh);
    this.flashLight = new THREE.PointLight(0xffc070, 0, 6, 2);
    this.flashLight.position.copy(this.muzzle);
    this.model.add(this.flashLight);

    g.position.set(x, y, z);
    g.rotation.set(0, Math.PI / 2, Math.PI / 2); // tumbado en la mesa
    world.scene.add(g);
    this.restY = y;

    // agujeros de bala (reutilizados)
    this.holes = [];
    this.holeIdx = 0;
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x050403, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (let i = 0; i < 30; i++) {
      const h = new THREE.Mesh(new THREE.CircleGeometry(0.012, 5), holeMat);
      h.visible = false;
      world.scene.add(h);
      this.holes.push(h);
    }
    // chispas del impacto
    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkPos = new Float32Array(16 * 3);
    this.sparkVel = Array.from({ length: 16 }, () => new THREE.Vector3());
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparks = new THREE.Points(this.sparkGeo, new THREE.PointsMaterial({ color: 0xffd080, size: 0.02, fog: false }));
    this.sparks.visible = false;
    this.sparks.frustumCulled = false;
    world.scene.add(this.sparks);
    this.sparkT = 0;

    this.item = world.addItem({
      id: 'gun', gesture: 'grab', obj: g, pad: 0.05,
      hint: () => 'MAGNUM · mano abierta y cierra el puño para cogerla',
      act: () => this.grab(),
    });
  }

  grab() {
    const w = this.world;
    if (this.held || w.handBusy()) return;
    this.held = true;
    this.falling = false;
    this.item.disabled = true;
    w.ctx.sfx.play('grab');
    w.ctx.vibrate(30);
    w.ctx.inventory(this.ammoText());
    w.ctx.msg('Aprieta el gatillo doblando el índice. Gira la muñeca para recargar.', 3.5);
  }

  release(vel = this.world._handVel) {
    this.held = false;
    this.falling = true;
    this.vel.copy(vel).clampLength(0, 5);
    this.item.disabled = false;
    this.world.ctx.inventory(this.world.state.hasKey && !this.world.state.doorOpen ? '[ LLAVE OXIDADA ]' : '');
  }

  ammoText() { return `MAGNUM ${'●'.repeat(this.ammo)}${'○'.repeat(MAX_AMMO - this.ammo)}`; }

  aim(out) {
    // dirección del cañón en el mundo
    return out.set(0, 0, -1).applyQuaternion(this.root.quaternion).normalize();
  }

  trigger() {
    if (!this.held) return;
    const w = this.world;
    if (this.ammo <= 0) {
      w.ctx.sfx.play('dryfire');
      w.ctx.msg('Sin balas. Gira la muñeca para recargar.', 1.8);
      return;
    }
    this.ammo--;
    w.ctx.inventory(this.ammoText());
    w.ctx.sfx.play('gunshot');
    w.ctx.vibrate(90);
    w.ctx.flash('#ffd090', 0.22);
    this.kickV += 22;
    this.cylSpin += Math.PI / 3;
    this.flashT = 0.07;
    this.shoot();
  }

  reload() {
    if (!this.held || this.ammo === MAX_AMMO) return;
    this.ammo = MAX_AMMO;
    this.cylSpin += Math.PI * 4;
    this.world.ctx.sfx.play('reload');
    this.world.ctx.vibrate(40);
    this.world.ctx.inventory(this.ammoText());
  }

  shoot() {
    const w = this.world;
    this.root.updateWorldMatrix(true, true);
    const origin = this.model.localToWorld(this._a.copy(this.muzzle));
    const dir = this.aim(this._b);
    this.ray.set(origin, dir);
    this.ray.far = 30;

    let best = null, bestD = 30;
    // pelotas y peluche (esferas)
    const sphereHit = (c, r) => {
      const oc = new THREE.Vector3().copy(c).sub(origin);
      const t = oc.dot(dir);
      if (t < 0) return Infinity;
      const d2 = oc.lengthSq() - t * t;
      if (d2 > r * r) return Infinity;
      return t - Math.sqrt(r * r - d2);
    };
    if (w.balls) for (const b of w.balls.list) {
      if (b.held) continue;
      const t = sphereHit(b.pos, b.r);
      if (t < bestD) { bestD = t; best = { type: 'ball', b }; }
    }
    if (w.plush && !w.plushHeld) {
      const t = sphereHit(w.plushCenter(new THREE.Vector3()), 0.11);
      if (t < bestD) { bestD = t; best = { type: 'plush' }; }
    }
    const hit = this.ray.intersectObjects(w.colliders, false)[0];
    if (hit && hit.distance < bestD) { bestD = hit.distance; best = { type: 'mesh', hit }; }
    if (!best) return;

    const point = new THREE.Vector3().copy(origin).addScaledVector(dir, bestD);
    if (best.type === 'ball') {
      const b = best.b;
      w.balls.wake(b);
      b.vel.addScaledVector(dir, 5).y += 1.5;
      b.sv += 6; b.axis.copy(dir);
      w.ctx.sfx.play('bounce');
    } else if (best.type === 'plush') {
      w.squashV += 14;
      w.plushFalling = true;
      w.plushVel.copy(dir).multiplyScalar(2.5).y += 1.5;
      w.ctx.sfx.play('squeak');
    } else {
      const m = best.hit.object;
      // ¿es un cristal? (vitrina o ventana)
      const pane = (w.windows || []).find((p) => p.mesh === m) || (w.vitrina && w.vitrina.mesh === m ? w.vitrina : null);
      if (pane) {
        w.breakPane(pane);
      } else {
        this.addHole(point, best.hit.face ? best.hit.face.normal.clone().transformDirection(m.matrixWorld) : dir.clone().negate());
        w.ctx.sfx.play('ricochet');
      }
    }
    this.spawnSparks(point, dir);
  }

  addHole(point, normal) {
    const h = this.holes[this.holeIdx++ % this.holes.length];
    h.position.copy(point).addScaledVector(normal, 0.003);
    h.lookAt(this._a.copy(h.position).add(normal));
    h.rotation.z = Math.random() * 6;
    h.visible = true;
  }

  spawnSparks(point, dir) {
    for (let i = 0; i < this.sparkVel.length; i++) {
      this.sparkPos[i * 3] = point.x; this.sparkPos[i * 3 + 1] = point.y; this.sparkPos[i * 3 + 2] = point.z;
      this.sparkVel[i].set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(2).addScaledVector(dir, -1.5);
    }
    this.sparkGeo.attributes.position.needsUpdate = true;
    this.sparks.visible = true;
    this.sparkT = 0.35;
  }

  update(dt) {
    const w = this.world;
    // retroceso: muelle que levanta el cañón
    this.kickV += (-this.kick * 260 - this.kickV * 18) * dt;
    this.kick += this.kickV * dt;
    // tambor girando
    this.cyl.rotation.y += Math.min(this.cylSpin, dt * 25);
    this.cylSpin = Math.max(0, this.cylSpin - dt * 25);
    // fogonazo
    this.flashT -= dt;
    const on = this.flashT > 0;
    this.flashMesh.material.opacity = on ? 0.95 : 0;
    this.flashMesh.rotation.z = Math.random() * 6;
    this.flashLight.intensity = on ? 9 : 0;
    // chispas
    if (this.sparkT > 0) {
      this.sparkT -= dt;
      for (let i = 0; i < this.sparkVel.length; i++) {
        const v = this.sparkVel[i];
        v.y -= 9.8 * dt;
        this.sparkPos[i * 3] += v.x * dt; this.sparkPos[i * 3 + 1] += v.y * dt; this.sparkPos[i * 3 + 2] += v.z * dt;
      }
      this.sparkGeo.attributes.position.needsUpdate = true;
      if (this.sparkT <= 0) this.sparks.visible = false;
    }

    const P = w._handPts;
    if (this.held) {
      const cam = w.ctx.camera;
      if (!w._handPalm || !P) {
        // la mano salió de la cámara: la pistola NO se cae, se queda fija respecto a la vista
        if (this.camPos) {
          cam.localToWorld(this.root.position.copy(this.camPos));
          this.root.quaternion.copy(cam.quaternion).multiply(this.camQuat);
        }
      } else if (w.isThrow()) {
        this.release(); // solo se suelta al lanzarla (o con el botón SOLTAR)
      } else {
        // orientación a partir de la mano: cañón hacia donde apunta el antebrazo, mezclado con la mirada
        const f = this._z.copy(P[9]).sub(P[0]).normalize();
        const camF = w.ctx.camForward(this._y);
        f.lerp(camF, 0.55).normalize();
        const up = this._x.copy(P[5]).sub(P[17]);
        up.addScaledVector(f, -up.dot(f));
        if (up.lengthSq() < 1e-6) up.set(0, 1, 0);
        up.normalize();
        if (up.y < -0.2) up.negate(); // que no quede boca abajo
        const zAxis = this._a.copy(f).negate();
        const xAxis = this._b.crossVectors(up, zAxis).normalize();
        this._m.makeBasis(xAxis, up, zAxis);
        this.root.quaternion.setFromRotationMatrix(this._m);
        this.root.quaternion.multiply(this._q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.kick * 0.06));
        this.root.position.copy(w._handPalm).addScaledVector(up, -0.01);
        // recordar la pose respecto a la cámara por si la mano sale de la imagen
        this.camPos = cam.worldToLocal((this.camPos || new THREE.Vector3()).copy(this.root.position));
        this.camQuat = (this.camQuat || new THREE.Quaternion()).copy(cam.quaternion).invert().multiply(this.root.quaternion);
      }
    } else if (this.falling) {
      const p = this.root.position, v = this.vel;
      v.y -= 9.8 * dt;
      p.addScaledVector(v, dt);
      p.x = Math.max(-2.4, Math.min(2.4, p.x));
      p.z = Math.max(-12.5, Math.min(2.4, p.z));
      const tb = w.tableBox;
      const over = tb && p.x > tb.minX && p.x < tb.maxX && p.z > tb.minZ && p.z < tb.maxZ && p.y >= w.tableTop - 0.05;
      const ground = (over ? w.tableTop : 0) + 0.02;
      if (p.y <= ground) {
        if (v.y < -1) w.ctx.sfx.play('clunk');
        p.y = ground;
        v.set(0, 0, 0);
        this.falling = false;
        this.root.rotation.set(0, this.root.rotation.y, Math.PI / 2); // queda tumbado
      }
    }
    this.item.refresh();
  }
}
