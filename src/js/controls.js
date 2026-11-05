// Mirada con giroscopio (deviceorientation) + joystick analógico con inercia.
import * as THREE from 'three';

const ZEE = new THREE.Vector3(0, 0, 1);
const YAX = new THREE.Vector3(0, 1, 0);
const Q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90º en X
const DEG = Math.PI / 180;

export class GyroLook {
  constructor(canvas) {
    this.has = false;
    this.alpha = 0; this.beta = 90; this.gamma = 0;
    this.yawOffset = 0;
    this.dragYaw = 0;
    this.dragPitch = 0;
    this.needRecenter = true;
    this.devQ = new THREE.Quaternion();
    this.out = new THREE.Quaternion();
    this._euler = new THREE.Euler();
    this._q0 = new THREE.Quaternion();
    this._qy = new THREE.Quaternion();
    this._v = new THREE.Vector3();

    window.addEventListener('deviceorientation', (e) => {
      if (e.alpha === null && e.beta === null) return;
      this.alpha = e.alpha || 0;
      this.beta = e.beta || 0;
      this.gamma = e.gamma || 0;
      this.has = true;
    });

    // Arrastrar en pantalla: ajuste fino de giro (o mirada completa si no hay giroscopio)
    let id = null, lx = 0, ly = 0;
    canvas.addEventListener('pointerdown', (e) => { id = e.pointerId; lx = e.clientX; ly = e.clientY; });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      this.dragYaw -= (e.clientX - lx) * 0.006;
      this.dragPitch = Math.max(-1.3, Math.min(1.3, this.dragPitch - (e.clientY - ly) * 0.006));
      lx = e.clientX; ly = e.clientY;
    });
    const up = (e) => { if (e.pointerId === id) id = null; };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  _screenAngle() {
    const a = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
    return (a || 0) * DEG;
  }

  _device() {
    this._euler.set(this.beta * DEG, this.alpha * DEG, -this.gamma * DEG, 'YXZ');
    this.devQ.setFromEuler(this._euler);
    this.devQ.multiply(Q1);
    this.devQ.multiply(this._q0.setFromAxisAngle(ZEE, -this._screenAngle()));
    return this.devQ;
  }

  static yawOf(q, v = new THREE.Vector3()) {
    v.set(0, 0, -1).applyQuaternion(q);
    return Math.atan2(-v.x, -v.z);
  }

  recenter(targetYaw = 0) {
    this.dragYaw = 0;
    if (!this.has) { this.yawOffset = targetYaw; return; }
    const yaw = GyroLook.yawOf(this._device(), this._v);
    this.yawOffset = targetYaw - yaw;
    this.needRecenter = false;
  }

  update(cameraQuat, targetYaw) {
    if (this.has) {
      if (this.needRecenter) this.recenter(targetYaw);
      const d = this._device();
      this._qy.setFromAxisAngle(YAX, this.yawOffset + this.dragYaw);
      this.out.copy(this._qy).multiply(d);
    } else {
      this._euler.set(this.dragPitch, this.yawOffset + this.dragYaw, 0, 'YXZ');
      this.out.setFromEuler(this._euler);
    }
    cameraQuat.slerp(this.out, 0.55);
  }
}

export class Joystick {
  constructor(el, knob) {
    this.el = el;
    this.knob = knob;
    this.value = new THREE.Vector2();
    this.id = null;
    const R = 50;
    const setKnob = () => { knob.style.transform = `translate(${this.value.x * R}px, ${-this.value.y * R}px)`; };
    const move = (e) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let x = (e.clientX - cx) / R, y = -(e.clientY - cy) / R;
      const l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; }
      this.value.set(x, y);
      setKnob();
    };
    el.addEventListener('pointerdown', (e) => {
      this.id = e.pointerId;
      el.setPointerCapture(e.pointerId);
      move(e);
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === this.id) move(e); });
    const end = (e) => {
      if (e.pointerId !== this.id) return;
      this.id = null;
      this.value.set(0, 0);
      setKnob();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);

    // Teclado para probar en PC (WASD / flechas)
    this.keys = new Set();
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  read(out) {
    out.copy(this.value);
    if (this.keys.size) {
      const k = this.keys;
      const x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      const y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      if (x || y) out.set(x, y).normalize();
    }
    // zona muerta y curva suave
    const l = out.length();
    if (l < 0.12) out.set(0, 0);
    else out.multiplyScalar(((l - 0.12) / 0.88) ** 1.3 / l);
    return out;
  }
}

export class PlayerMotion {
  constructor() {
    this.vel = new THREE.Vector2();
    this.maxSpeed = 1.5;
    this._t = new THREE.Vector2();
    this._in = new THREE.Vector2();
    this.walked = 0;
  }

  // pos: Vector3 (x,z); yaw: radianes; collide(x,z)->bool
  update(dt, joystick, yaw, pos, collide, locked) {
    joystick.read(this._in);
    if (locked) this._in.set(0, 0);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    this._t.set(fx * this._in.y + rx * this._in.x, fz * this._in.y + rz * this._in.x).multiplyScalar(this.maxSpeed);
    const accel = this._in.lengthSq() > 0 ? 4.5 : 3.2; // inercia: arranque y frenado suaves
    this.vel.lerp(this._t, 1 - Math.exp(-dt * accel));
    if (this.vel.lengthSq() < 1e-5) this.vel.set(0, 0);

    const dx = this.vel.x * dt, dz = this.vel.y * dt;
    const ox = pos.x, oz = pos.z;
    pos.x += dx;
    if (collide(pos.x, pos.z)) { pos.x = ox; this.vel.x *= -0.1; }
    pos.z += dz;
    if (collide(pos.x, pos.z)) { pos.z = oz; this.vel.y *= -0.1; }
    const moved = Math.hypot(pos.x - ox, pos.z - oz);
    this.walked += moved;
    return moved / Math.max(dt, 1e-4);
  }
}
