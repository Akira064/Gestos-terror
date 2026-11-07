// Mano 3D low poly con manga, construida en cada frame a partir de los 21 puntos.
import * as THREE from 'three';
import { ps1Mat, makeTex } from './ps1.js';

const BONES = [
  [1, 2], [2, 3], [3, 4],
  [5, 6], [6, 7], [7, 8],
  [9, 10], [10, 11], [11, 12],
  [13, 14], [14, 15], [15, 16],
  [17, 18], [18, 19], [19, 20],
];
const PALM_RING = [0, 1, 5, 9, 13, 17];
const Y = new THREE.Vector3(0, 1, 0);

export class HandModel {
  constructor() {
    this.group = new THREE.Group();
    this.group.renderOrder = 2;
    const skin = ps1Mat({ map: makeTex('skin'), color: 0xd8c0b0 });
    const palmMat = ps1Mat({ map: makeTex('skin'), color: 0xd0b8a8, side: THREE.DoubleSide });
    const cloth = ps1Mat({ map: makeTex('cloth'), color: 0xd8ccc0 });
    const cuffMat = ps1Mat({ map: makeTex('cloth'), color: 0xc8b8a8 });

    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    this.bones = BONES.map(([a, b]) => {
      const m = new THREE.Mesh(unitBox, skin);
      m.userData = { a, b, w: a < 5 ? 0.021 : b > 16 ? 0.015 : 0.017 };
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    });

    // Palma: prisma hexagonal deformable
    this.palmGeo = new THREE.BufferGeometry();
    this.palmPos = new Float32Array(24 * 3 * 3);
    this.palmGeo.setAttribute('position', new THREE.BufferAttribute(this.palmPos, 3));
    const uv = new Float32Array(24 * 3 * 2);
    for (let i = 0; i < uv.length; i += 2) { uv[i] = (i % 6) / 6; uv[i + 1] = ((i * 7) % 10) / 10; }
    this.palmGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.palm = new THREE.Mesh(this.palmGeo, palmMat);
    this.palm.frustumCulled = false;
    this.group.add(this.palm);

    // Manga y puño de la manga
    // brazo con codo: antebrazo (codo -> muñeca) y brazo (hombro -> codo)
    this.sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.037, 1, 6, 1), cloth);
    this.upper = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.047, 1, 6, 1), cloth);
    this.cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.041, 0.04, 6, 1), cuffMat);
    this.sleeve.frustumCulled = this.cuff.frustumCulled = this.upper.frustumCulled = false;
    this.group.add(this.sleeve, this.upper, this.cuff);
    this._e = new THREE.Vector3(); this._d = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0);

    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3();
    this._x = new THREE.Vector3(); this._z = new THREE.Vector3(); this._n = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this.visible = 0;
  }

  setOpacityVisible(v) {
    this.group.visible = v;
  }

  // P: 21 Vector3 en mundo; scale: escala de la mano
  update(P, scale, shoulder = null, bendHint = null) {
    // normal de la palma
    const n = this._n.copy(P[5]).sub(P[0]).cross(this._c.copy(P[17]).sub(P[0])).normalize();
    if (n.lengthSq() < 0.5) n.set(0, 0, 1);

    for (const m of this.bones) {
      const { a, b, w } = m.userData;
      const A = P[a], B = P[b];
      const dir = this._a.copy(B).sub(A);
      const len = Math.max(0.005, dir.length());
      dir.divideScalar(len);
      const z = this._z.copy(n).addScaledVector(dir, -n.dot(dir));
      if (z.lengthSq() < 1e-6) z.set(1, 0, 0).cross(dir);
      z.normalize();
      const x = this._x.crossVectors(dir, z);
      this._m.makeBasis(x, dir, z);
      m.quaternion.setFromRotationMatrix(this._m);
      m.position.copy(A).add(B).multiplyScalar(0.5);
      m.scale.set(w * scale, len * 1.08, w * 0.8 * scale);
    }

    // palma
    const th = 0.013 * scale;
    const ring = PALM_RING.map((k) => P[k]);
    const c = this._c.set(0, 0, 0);
    ring.forEach((p) => c.add(p));
    c.multiplyScalar(1 / ring.length);
    const pos = this.palmPos;
    let o = 0;
    const put = (v, s) => { pos[o++] = v.x + n.x * th * s; pos[o++] = v.y + n.y * th * s; pos[o++] = v.z + n.z * th * s; };
    for (let i = 0; i < 6; i++) {
      const p = ring[i], q = ring[(i + 1) % 6];
      put(c, 1); put(p, 1); put(q, 1);          // cara frontal
      put(c, -1); put(q, -1); put(p, -1);       // cara trasera
      put(p, 1); put(p, -1); put(q, -1);        // laterales
      put(p, 1); put(q, -1); put(q, 1);
    }
    this.palmGeo.attributes.position.needsUpdate = true;
    this.palmGeo.computeVertexNormals();

    // brazo: hombro -> codo -> muñeca (el codo cae hacia abajo y hacia fuera, como un brazo de verdad)
    const W = P[0];
    if (shoulder) {
      const d = this._d.copy(W).sub(shoulder);
      const dist = Math.max(0.05, d.length());
      d.divideScalar(dist);
      const seg = Math.max(0.28, dist * 0.56);              // longitud de brazo y antebrazo
      const h = Math.sqrt(Math.max(0, seg * seg - (dist / 2) * (dist / 2)));
      // el codo cae hacia abajo y hacia tu cuerpo (así el antebrazo entra por la esquina inferior)
      const bend = bendHint ? this._e.copy(bendHint) : this._e.set(0.45, -0.6, 0.55);
      bend.addScaledVector(d, -bend.dot(d)).normalize();
      const elbow = this._c.copy(shoulder).addScaledVector(d, dist / 2).addScaledVector(bend, h);
      this.placeLimb(this.sleeve, W, elbow, 0.9);
      this.placeLimb(this.upper, elbow, shoulder, 0.9);
      this.upper.visible = true;
      this.cuff.quaternion.copy(this.sleeve.quaternion);
      this.cuff.scale.setScalar(0.85);
      this.cuff.position.copy(W).addScaledVector(this._a.copy(elbow).sub(W).normalize(), 0.012);
    } else {
      const back = this._a.copy(P[0]).sub(P[9]).normalize();
      this.placeLimb(this.sleeve, W, this._c.copy(W).addScaledVector(back, 0.5 * scale), 0.9);
      this.upper.visible = false;
      this.cuff.quaternion.copy(this.sleeve.quaternion);
      this.cuff.position.copy(W);
    }
  }

  // coloca un cilindro de altura 1 entre a y b
  placeLimb(mesh, a, b, thick) {
    const dir = this._x.copy(b).sub(a);
    const len = Math.max(0.01, dir.length());
    dir.divideScalar(len);
    mesh.quaternion.setFromUnitVectors(this._up, dir);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.scale.set(thick, len, thick);
  }
}
