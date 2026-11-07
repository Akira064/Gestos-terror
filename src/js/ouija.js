// NOCHE 1 · LA OUIJA
// Sentado a la cabecera de una mesa, con el dedo sobre un vaso, contestas a un espíritu.
// Si fallas o lo enfadas: se abre el mueble, levita una taza, te la lanza. Tu cordura baja.
import * as THREE from 'three';
import { ps1Mat, boxGeo, makeTex } from './ps1.js';
import { posedHand } from './handPose.js';

const TABLE_Y = 0.76;                 // superficie de la mesa
const BOARD = { x: 0, z: -0.29, w: 0.54, d: 0.38 };  // pegado al borde de la mesa, delante de ti
const GLASS_H = 0.085;
const GLASS_TOP = TABLE_Y + 0.003 + GLASS_H;
const ZONE_R = 0.055;
// zonas relativas al centro del tablero (x, z); -z = lado lejano (arriba del tablero)
const ZONES = { si: [-0.17, -0.11], no: [0.17, -0.11], adios: [0, 0.13], centro: [0, 0.01] };
const DWELL = 1.3;                    // segundos quieto sobre una respuesta

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function boardTexture() {
  return canvasTex(256, 180, (g, W, H) => {
    g.fillStyle = '#3a2314'; g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 3) { g.fillStyle = `rgba(20,10,4,${0.15 + Math.random() * 0.25})`; g.fillRect(0, y, W, 1); }
    g.strokeStyle = '#b89558'; g.lineWidth = 2; g.strokeRect(6, 6, W - 12, H - 12);
    g.strokeStyle = '#6e5430'; g.lineWidth = 1; g.strokeRect(11, 11, W - 22, H - 22);
    g.fillStyle = '#e0c488'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const uz = (x, z) => [(0.5 + x / BOARD.w) * W, (0.5 + z / BOARD.d) * H];
    g.font = 'bold 26px serif';
    let [x, y] = uz(...ZONES.si); g.fillText('SÍ', x, y);
    [x, y] = uz(...ZONES.no); g.fillText('NO', x, y);
    g.font = 'bold 18px serif';
    [x, y] = uz(...ZONES.adios); g.fillText('ADIÓS', x, y);
    // sol en el centro
    [x, y] = uz(...ZONES.centro);
    g.strokeStyle = '#c8a868'; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath(); g.moveTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12); g.lineTo(x + Math.cos(a) * 17, y + Math.sin(a) * 17); g.stroke();
    }
    // letras en arco (decoración)
    g.font = 'bold 11px serif'; g.fillStyle = '#b89a62';
    const letters = 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';
    for (let i = 0; i < letters.length; i++) {
      const a = Math.PI * (1.08 + (i / (letters.length - 1)) * 0.84);
      g.fillText(letters[i], W / 2 + Math.cos(a) * 92, H * 0.83 + Math.sin(a) * 78);
    }
    g.font = 'bold 10px serif';
    for (let i = 0; i <= 9; i++) g.fillText(String(i), W / 2 - 54 + i * 12, H * 0.66);
    // luna y estrella
    g.fillStyle = '#c8a868';
    g.beginPath(); g.arc(W - 24, H - 22, 8, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3a2314'; g.beginPath(); g.arc(W - 20, H - 25, 7, 0, Math.PI * 2); g.fill();
  });
}

function portraitTexture(open) {
  return canvasTex(64, 80, (g, W, H) => {
    g.fillStyle = '#1c1612'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#2a1e18'; g.fillRect(8, 50, 48, 30);           // vestido
    g.fillStyle = '#0e0a08'; g.beginPath(); g.ellipse(32, 30, 17, 22, 0, 0, Math.PI * 2); g.fill(); // pelo
    g.fillStyle = '#b8a890'; g.beginPath(); g.ellipse(32, 33, 11, 15, 0, 0, Math.PI * 2); g.fill(); // cara
    g.fillStyle = '#9a8a74'; g.fillRect(24, 44, 16, 2);
    if (open) {
      g.fillStyle = '#f0e8d8'; g.fillRect(25, 29, 5, 3); g.fillRect(34, 29, 5, 3);
      g.fillStyle = '#000'; g.fillRect(27, 29, 2, 3); g.fillRect(36, 29, 2, 3);  // pupilas mirándote
      g.fillStyle = '#300'; g.fillRect(29, 41, 6, 3);                            // boca entreabierta
    } else {
      g.fillStyle = '#5a4a3c'; g.fillRect(25, 30, 5, 1); g.fillRect(34, 30, 5, 1);
      g.fillStyle = '#7a5a50'; g.fillRect(29, 42, 6, 1);
    }
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.25})`; g.fillRect(Math.random() * W, Math.random() * H, 1, 1); }
  });
}

export class OuijaScene {
  constructor(scene, ctx) {
    this.scene = scene;
    this.ctx = ctx;
    this.colliders = [];
    this.blockers = [];
    this.items = [];
    this.seated = true;
    this.eyeHeight = 1.17;
    this.start = new THREE.Vector3(0, 0, -0.02);
    this.lockMove = true;
    this.flashFactor = 0.13; // casi nada: solo lo justo para verte la mano a la luz de las velas
    this.time = 0;
    this.sanity = 100;
    this.anger = 0;
    this.over = false;
    this.ending = false;
    this.waiters = [];
    this.timers = [];
    this.objs = [];       // todo lo creado, para poder limpiar

    this.glass = new THREE.Vector2(BOARD.x + ZONES.centro[0], BOARD.z + ZONES.centro[1]);
    this.glassPrev = this.glass.clone();
    this.attached = false;
    this.detachT = 0;
    this.grabOff = new THREE.Vector2();
    this.pullOff = new THREE.Vector2();
    this.tip = new THREE.Vector2();
    this.drive = new THREE.Vector2();
    this.attachY = 0;
    this.blend = 0;
    this.answering = null;  // zonas válidas mientras se espera respuesta
    this.dwellZone = null;
    this.dwellT = 0;
    this.pull = null;
    this.relT = 0;
    this.warned = false;
    this.rulesOn = false;
    this.lev = null;
    this.heartT = 0;
    this.whisperT = 5;
    this.missing = 0;
    this._handPalm = null;
    this._handVel = new THREE.Vector3();
    this._prevPalm = new THREE.Vector3();
    this._v = new THREE.Vector3();

    this.build();
    this.ctx.setSanity(this.sanity);
    this.runScript();
  }

  // ---------------- construcción ----------------
  add(o) { this.scene.add(o); this.objs.push(o); return o; }

  box(w, h, d, x, y, z, mat, { hand = true, parent = null, ts = 1 } = {}) {
    const m = new THREE.Mesh(boxGeo(w, h, d, ts), mat);
    m.position.set(x, y, z);
    if (parent) parent.add(m); else this.add(m);
    if (hand) this.colliders.push(m);
    return m;
  }

  build() {
    const wall = ps1Mat({ map: makeTex('wallpaper'), color: 0x9a8070 });
    const floor = ps1Mat({ map: makeTex('wood'), color: 0x8a6a50 });
    const ceil = ps1Mat({ map: makeTex('ceiling'), color: 0x777070 });
    const tableMat = ps1Mat({ map: makeTex('wood'), color: 0x7a4a2a });
    const darkWood = ps1Mat({ map: makeTex('wood'), color: 0x5a3420 });

    // habitación 2,6 x 3,4
    this.box(2.6, 0.1, 3.4, 0, -0.05, -0.7, floor, { ts: 0.8 });
    this.box(2.6, 0.1, 3.4, 0, 2.45, -0.7, ceil, { ts: 0.8 });
    this.box(2.8, 2.5, 0.1, 0, 1.25, -2.45, wall, { ts: 1.2 });
    this.box(2.8, 2.5, 0.1, 0, 1.25, 1.05, wall, { ts: 1.2 });
    this.box(0.1, 2.5, 3.6, -1.35, 1.25, -0.7, wall, { ts: 1.2 });
    this.box(0.1, 2.5, 3.6, 1.35, 1.25, -0.7, wall, { ts: 1.2 });

    // mesa rectangular (te sientas en la cabecera)
    this.box(0.9, 0.05, 1.7, 0, TABLE_Y - 0.025, -0.95, tableMat);
    for (const [lx, lz] of [[-0.4, -0.15], [0.4, -0.15], [-0.4, -1.75], [0.4, -1.75]]) {
      this.box(0.06, TABLE_Y - 0.05, 0.06, lx, (TABLE_Y - 0.05) / 2, lz, darkWood, { hand: false });
    }
    // silla vacía al otro extremo, mirándote
    const chair = new THREE.Group();
    chair.position.set(0, 0, -2.05);
    this.add(chair);
    this.box(0.42, 0.04, 0.42, 0, 0.46, 0, darkWood, { parent: chair, hand: false });
    this.box(0.42, 0.62, 0.04, 0, 0.8, -0.19, darkWood, { parent: chair, hand: false });
    for (const [lx, lz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) this.box(0.035, 0.46, 0.035, lx, 0.23, lz, darkWood, { parent: chair, hand: false });

    // tablero
    this.boardGroup = new THREE.Group();
    this.boardGroup.position.set(BOARD.x, TABLE_Y + 0.002, BOARD.z);
    this.add(this.boardGroup);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(BOARD.w, BOARD.d), ps1Mat({ map: boardTexture(), color: 0xffffff }));
    board.rotation.x = -Math.PI / 2;
    this.boardGroup.add(board);
    // brillos de las zonas
    this.zoneGlow = {};
    for (const k of Object.keys(ZONES)) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(ZONE_R, 10), new THREE.MeshBasicMaterial({ color: k === 'adios' ? 0xff4020 : 0xffc060, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(ZONES[k][0], 0.002, ZONES[k][1]);
      this.boardGroup.add(m);
      this.zoneGlow[k] = m;
    }

    // vaso boca abajo
    this.glassGroup = new THREE.Group();
    this.add(this.glassGroup);
    const gm = new THREE.MeshLambertMaterial({ color: 0xcfe4e8, transparent: true, opacity: 0.45, depthWrite: false });
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, GLASS_H, 7, 1, true), gm);
    cup.position.y = GLASS_H / 2;
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.03, 7), gm);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = GLASS_H;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.004, 3, 7), new THREE.MeshBasicMaterial({ color: 0xa8c8d0 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.003;
    this.glassVisual = new THREE.Group();
    this.glassVisual.add(cup, bottom, rim);
    this.glassGroup.add(this.glassVisual);

    // velas: 3 encendidas y 1 apagada
    this.candles = [];
    const wax = ps1Mat({ map: makeTex('concrete'), color: 0xeae0c8 });
    const spots = [[-0.33, -0.95, 0.16, true], [0.33, -0.95, 0.12, true], [0.02, -1.55, 0.18, true], [0.4, -0.42, 0.1, false]];
    for (const [x, z, h, lit] of spots) {
      const g = new THREE.Group();
      g.position.set(x, TABLE_Y, z);
      this.add(g);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, h, 6), wax);
      body.position.y = h / 2;
      const wick = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.012, 0.003), new THREE.MeshBasicMaterial({ color: 0x111111 }));
      wick.position.y = h + 0.006;
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.035, 5), new THREE.MeshBasicMaterial({ color: 0xffb040, fog: false }));
      flame.position.y = h + 0.024;
      flame.visible = lit;
      g.add(body, wick, flame);
      this.candles.push({ g, flame, lit, h });
    }
    this.candleLights = [
      this.add(new THREE.PointLight(0xffa050, 0, 4.5, 1.6)),
      this.add(new THREE.PointLight(0xff9040, 0, 4, 1.6)),
    ];
    this.candleLights[0].position.set(0, TABLE_Y + 0.3, -0.95);
    this.candleLights[1].position.set(0.02, TABLE_Y + 0.35, -1.55);

    // mueble antiguo con puertas de cristal (pared derecha)
    this.cab = new THREE.Group();
    this.cab.position.set(1.08, 0, -0.95);
    this.add(this.cab);
    const cw = 0.84, ch = 1.75, cd = 0.4;
    this.box(cd, 0.04, cw, 0, 0.42, 0, darkWood, { parent: this.cab });
    this.box(cd, 0.04, cw, 0, ch, 0, darkWood, { parent: this.cab });
    this.box(0.03, ch - 0.42, cw, cd / 2 - 0.015, (ch + 0.42) / 2, 0, darkWood, { parent: this.cab });
    this.box(cd, ch - 0.42, 0.03, 0, (ch + 0.42) / 2, -cw / 2, darkWood, { parent: this.cab });
    this.box(cd, ch - 0.42, 0.03, 0, (ch + 0.42) / 2, cw / 2, darkWood, { parent: this.cab });
    this.box(cd, 0.42, cw, 0, 0.21, 0, darkWood, { parent: this.cab }); // cajonera baja
    for (const y of [0.92, 1.32]) this.box(cd - 0.04, 0.02, cw - 0.04, 0.01, y, 0, darkWood, { parent: this.cab, hand: false });
    this.box(cd + 0.04, 0.06, cw + 0.06, 0, ch + 0.03, 0, darkWood, { parent: this.cab, hand: false });
    // puertas de cristal (bisagras en los extremos, se abren hacia ti)
    this.doors = [];
    const glassMat = new THREE.MeshLambertMaterial({ color: 0xa8d0d8, transparent: true, opacity: 0.18, depthWrite: false });
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(-cd / 2, 0, side * cw / 2);
      this.cab.add(pivot);
      const pane = new THREE.Mesh(boxGeo(0.01, ch - 0.48, cw / 2 - 0.02), glassMat);
      pane.position.set(0, (ch + 0.44) / 2, -side * (cw / 4));
      const frameMat = darkWood;
      const fr = [[0.02, 0.03, cw / 2, 0, 0.45], [0.02, 0.03, cw / 2, 0, ch - 0.03]];
      pivot.add(pane);
      for (const [w, h, d, , y] of fr) {
        const f = new THREE.Mesh(boxGeo(w, h, d), frameMat);
        f.position.set(0, y, -side * (cw / 4));
        pivot.add(f);
      }
      const knob = new THREE.Mesh(boxGeo(0.02, 0.03, 0.02), ps1Mat({ map: makeTex('metal'), color: 0xc0a060 }));
      knob.position.set(-0.012, 1.1, -side * (cw / 2 - 0.05));
      pivot.add(knob);
      this.doors.push({ pivot, side, open: 0, target: 0 });
    }
    this.colliders.push(...this.doors.map((d) => d.pivot.children[0]));

    // tazas y platos en las baldas
    this.shelf = [];
    const porcelain = ps1Mat({ map: makeTex('porcelain'), color: 0xffffff });
    for (const z of [-0.24, 0, 0.24]) {
      const cupG = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.028, 0.06, 7, 1), porcelain);
      body.position.y = 0.03;
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.005, 3, 6, Math.PI), porcelain);
      handle.position.set(0, 0.032, 0.036);
      handle.rotation.set(0, Math.PI / 2, -Math.PI / 2);
      cupG.add(body, handle);
      cupG.position.set(0.02, 0.93, z);
      cupG.rotation.y = Math.random() * 6;
      this.cab.add(cupG);
      this.shelf.push({ g: cupG, type: 'taza', on: true });
    }
    for (const z of [-0.22, 0.02, 0.24]) {
      const plate = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.07, 0.012, 9, 1), porcelain);
      disc.rotation.z = Math.PI / 2 - 0.25;
      disc.position.y = 0.085;
      plate.add(disc);
      plate.position.set(0.1, 1.33, z);
      this.cab.add(plate);
      this.shelf.push({ g: plate, type: 'plato', on: true });
    }

    // retrato (pared izquierda)
    this.portraitTex = [portraitTexture(false), portraitTexture(true)];
    const pf = new THREE.Group();
    pf.position.set(-1.29, 1.5, -0.85);
    pf.rotation.y = Math.PI / 2;
    this.add(pf);
    this.box(0.5, 0.6, 0.03, 0, 0, 0, ps1Mat({ map: makeTex('wood'), color: 0x9a7030 }), { parent: pf });
    this.portrait = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.5), ps1Mat({ map: this.portraitTex[0], color: 0xffffff }));
    this.portrait.position.z = 0.017;
    pf.add(this.portrait);
    this.portraitOpen = false;

    this.cab.updateMatrixWorld(true);
    this.defineModelSlots();
  }

  // ---------------- modelos de Blender ----------------
  defineModelSlots() {
    this.modelSlots = {
      vaso: { groups: [this.glassVisual] },
      tablero: { groups: [this.boardGroup], keep: (o) => Object.values(this.zoneGlow).includes(o) },
      taza: { groups: this.shelf.filter((s) => s.type === 'taza').map((s) => s.g) },
      plato: { groups: this.shelf.filter((s) => s.type === 'plato').map((s) => s.g) },
      vela: { groups: this.candles.map((c) => c.g), keep: (o) => this.candles.some((c) => c.flame === o) },
    };
  }

  attachModel(name, model) {
    const slot = this.modelSlots[name];
    for (const g of slot.groups) {
      for (const c of g.children) if (!(slot.keep && slot.keep(c))) c.visible = false;
      g.add(model.clone());
    }
  }

  // ---------------- interfaz con main.js ----------------
  findHover() { return null; }
  handleEvent() { return false; }
  collide() { return false; }
  handBusy() { return false; }
  dropHeld() { return false; }
  isThrow() { return false; }

  setHand(palm, open, P) {
    if (palm) {
      if (this._handPalm) {
        this._v.copy(palm).sub(this._prevPalm).divideScalar(Math.max(this._dt || 0.016, 1e-3));
        this._handVel.lerp(this._v, 0.4);
      }
      this._prevPalm.copy(palm);
      this._handPalm = this._prevPalm;
      this.missing = 0;
    } else {
      this._handPalm = null;
    }
  }

  // El dedo sobre el vaso. El vaso lo mueve la PALMA (mucho más estable que la yema) y,
  // mientras lo tocas, la mano adopta una postura fija de "señalar" apoyada en el vaso.
  softTouch(palm, P, palmRaw = palm) {
    const dt = this._dt || 0.016;
    const tip = P[8];
    const g = this.glass;
    if (!this.attached) {
      const hdTip = Math.hypot(tip.x - g.x, tip.z - g.y);
      const hdPalm = Math.hypot(palmRaw.x - g.x, palmRaw.z - g.y);
      if (!this.over && ((hdTip < 0.065 && tip.y < GLASS_TOP + 0.06) || (hdPalm < 0.08 && palmRaw.y < GLASS_TOP + 0.1))) {
        this.attached = true;
        this.detachT = 0;
        this.drive.set(palmRaw.x, palmRaw.z);
        this.grabOff.set(g.x - palmRaw.x, g.y - palmRaw.z);
        this.attachY = palmRaw.y;
        this.ctx.sfx.play('clack');
        this.ctx.vibrate(15);
      }
    } else {
      // filtro con holgura: los temblores de menos de 5 mm no mueven el vaso
      const dx = palmRaw.x - this.drive.x, dz = palmRaw.z - this.drive.y;
      const d = Math.hypot(dx, dz), slack = 0.005;
      if (d > slack) { const k = (d - slack) / d; this.drive.x += dx * k; this.drive.y += dz * k; }
      const lifted = palmRaw.y > this.attachY + 0.13;
      this.detachT = lifted ? this.detachT + dt : 0;
      if (this.detachT > 0.3) this.attached = false;
    }
    this.tip.copy(this.drive);
    this.blend += ((this.attached ? 1 : 0) - this.blend) * Math.min(1, dt * 10);
    if (this.blend < 0.02) return null;

    // --- postura de señalar con el índice sobre el vaso ---
    const top = this._top || (this._top = new THREE.Vector3());
    top.set(g.x, GLASS_TOP + 0.004, g.y);
    // Como al señalar algo en la mesa: el brazo viene del hombro, el índice apunta hacia delante y
    // abajo, el dorso de la mano mira hacia arriba (hacia ti) y los demás dedos se recogen por debajo.
    const sh = this.ctx.shoulder(this._cp || (this._cp = new THREE.Vector3()));
    const fwd = this._fw || (this._fw = new THREE.Vector3());
    fwd.set(top.x - sh.x, 0, top.z - sh.z);
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    // índice en la línea del brazo (del hombro al vaso), solo un poco más inclinado hacia abajo
    const u = this._pu || (this._pu = new THREE.Vector3());
    u.copy(top).sub(sh).normalize().add(this._dn || (this._dn = new THREE.Vector3(0, -0.06, 0))).normalize();
    // lado del pulgar: a la izquierda del brazo si es la mano derecha
    const s = this._ps || (this._ps = new THREE.Vector3());
    s.set(0, 1, 0).cross(fwd);                 // izquierda de la dirección del brazo
    if (this.ctx.handLeft && this.ctx.handLeft()) s.negate();
    s.addScaledVector(u, -s.dot(u)).normalize();
    const n = this._pn || (this._pn = new THREE.Vector3());
    n.crossVectors(u, s);
    if (n.y > 0) n.negate();                   // la palma mira hacia abajo; ves el dorso
    const scale = Math.max(0.6, Math.min(2.2, P[0].distanceTo(P[9]) / 0.092));
    if (!this.pose) this.pose = posedHand([0.03, 0.5, 0.78, 0.85], 0.5); // índice estirado, corazón a medias
    const L = this.pose;
    const tipL = L[8];
    const out = this.posePts || (this.posePts = Array.from({ length: 21 }, () => new THREE.Vector3()));
    for (let i = 0; i < 21; i++) {
      const p = L[i];
      out[i].copy(top)
        .addScaledVector(s, (p[0] - tipL[0]) * scale)
        .addScaledVector(u, (p[1] - tipL[1]) * scale)
        .addScaledVector(n, (p[2] - tipL[2]) * scale);
    }
    return { points: out, blend: this.blend };
  }

  // ---------------- guion ----------------
  until(pred) { return new Promise((res) => this.waiters.push({ pred, res })); }
  wait(s) { const t = this.time + s; return this.until(() => this.time >= t); }
  after(s, fn) { this.timers.push({ t: this.time + s, fn }); }
  say(text, opts) { return this.over ? new Promise(() => {}) : this.ctx.voice.speak(text, opts); }

  zoneDist(k) {
    return Math.hypot(this.glass.x - (BOARD.x + ZONES[k][0]), this.glass.y - (BOARD.z + ZONES[k][1]));
  }
  inZone(k, r = ZONE_R) { return this.zoneDist(k) < r; }

  waitAnswer(zones) {
    this.answering = zones;
    this.dwellZone = null;
    this.dwellT = 0;
    return new Promise((res) => { this.answerRes = res; });
  }

  litCount() { return this.candles.filter((c) => c.lit).length; }
  cupsOnShelf() { return this.shelf.filter((s) => s.type === 'taza' && s.on).length; }

  async ask(q) {
    if (this.over) return;
    if (!this.inZone('centro', 0.07)) {
      await this.say('Vuelve al centro.');
      this.centerHint = true;
      await this.until(() => this.inZone('centro', 0.07));
      this.centerHint = false;
    }
    await this.say(q.text);
    this.pull = q.pull || null;
    const ans = await this.waitAnswer(['si', 'no']);
    this.pull = null;
    if (q.any) { await this.say(ans === 'si' ? q.si : q.no); return; }
    const correct = q.correct();
    if (ans === correct) {
      this.ctx.sfx.play('bell');
      await this.say(q.ok || 'Bien.');
    } else {
      this.ctx.sfx.play('denied');
      await this.say(q.bad || 'Mientes.');
      this.punish();
      await this.wait(1.5);
    }
  }

  async runScript() {
    await this.wait(2.5);
    await this.say('Pon tu dedo sobre el vaso.');
    this.centerHint = true;
    await this.until(() => this.attached);
    this.centerHint = false;
    await this.wait(0.8);
    await this.say('Bien. No lo sueltes… o me enfadaré.');
    this.rulesOn = true;
    await this.wait(0.6);

    const Q = [
      { text: '¿Me oyes?', any: true, si: 'Bien. Yo también te oigo.', no: 'Entonces… ¿quién está moviendo el vaso?' },
      { text: '¿Hay tres velas encendidas sobre la mesa?', correct: () => (this.litCount() === 3 ? 'si' : 'no'),
        ok: 'Las ves… bien.', bad: 'Cuéntalas otra vez.' },
      { text: '¿Me tienes miedo?', correct: () => 'si', ok: 'Haces bien.', bad: 'Mientes. Lo noto en tu mano.' },
      { text: 'La mujer del cuadro… ¿tiene los ojos abiertos?', correct: () => (this.portraitOpen ? 'si' : 'no'),
        ok: 'Por ahora…', bad: 'No has mirado bien.' },
      { text: '¿Quedan más de dos tazas en el mueble?', correct: () => (this.cupsOnShelf() > 2 ? 'si' : 'no'),
        ok: 'Las cuentas… como yo.', bad: 'Fíjate en el mueble.' },
      { text: '¿Quieres que salga de aquí?', pull: 'si', correct: () => 'no',
        ok: '…Por ahora.', bad: 'Gracias. Pronto.' },
    ];
    for (const q of Q) {
      if (this.over) return;
      await this.ask(q);
    }
    if (this.over) return;
    await this.say('Ahora… despídete.');
    this.adiosHint = true;
    await this.waitAnswer(['adios']);
    this.adiosHint = false;
    this.win();
  }

  // ---------------- castigos ----------------
  punish() {
    if (this.over || this.ending) return;
    this.anger++;
    this.addSanity(-10);
    this.ctx.vibratePattern([80, 40, 80]);
    if (this.anger === 1) {
      this.openCabinet();
      this.after(1.2, () => this.snuffCandle());
    } else if (this.anger === 2) {
      this.openCabinet();
      this.levitate();
      this.after(3, () => this.setPortrait(true));
    } else {
      this.openCabinet();
      if (this.lev && this.lev.phase === 'hover') this.throwLev();
      else { this.levitate(); this.after(2.2, () => this.throwLev()); }
    }
  }

  openCabinet() {
    if (this.doors[0].target > 0) return;
    this.doors.forEach((d) => (d.target = 1));
    this.ctx.sfx.play('creak');
  }

  snuffCandle() {
    const c = this.candles.find((x) => x.lit && x !== this.candles[2]);
    if (!c) return;
    c.lit = false;
    c.flame.visible = false;
    this.ctx.sfx.play('puff');
  }

  setPortrait(open) {
    this.portraitOpen = open;
    this.portrait.material.map = this.portraitTex[open ? 1 : 0];
    this.portrait.material.needsUpdate = true;
  }

  levitate() {
    if (this.lev) return;
    const it = this.shelf.find((s) => s.on && s.type === 'taza') || this.shelf.find((s) => s.on);
    if (!it) return;
    it.on = false;
    this.scene.attach(it.g);
    this.objs.push(it.g);
    this.lev = {
      it, g: it.g, phase: 'rise', t: 0,
      from: it.g.position.clone(),
      to: new THREE.Vector3(0.5, 1.28, -0.62),
      vel: new THREE.Vector3(),
    };
    this.ctx.sfx.play('ghost');
  }

  throwLev() {
    const L = this.lev;
    if (!L || this.over) return;
    if (L.phase === 'rise') { this.after(0.8, () => this.throwLev()); return; }
    if (L.phase !== 'hover') return;
    L.phase = 'thrown';
    const cam = this.ctx.camera.getWorldPosition(new THREE.Vector3());
    L.vel.copy(cam).sub(L.g.position).normalize().multiplyScalar(4.2);
    this.ctx.sfx.play('whoosh');
  }

  addSanity(d) {
    if (this.over) return;
    this.sanity = Math.max(0, Math.min(100, this.sanity + d));
    this.ctx.setSanity(this.sanity);
    if (this.sanity <= 0) this.lose();
  }

  // ---------------- final ----------------
  lose() {
    if (this.over) return;
    this.over = true;
    this.attached = false;
    this.ctx.voice.stop();
    this.ctx.sfx.play('stinger');
    this.ctx.flash('#600000', 1);
    this.ctx.vibratePattern([400, 100, 600]);
    this.candles.forEach((c) => { c.lit = false; c.flame.visible = false; });
    this.setPortrait(true);
    this.after(2.6, () => this.ctx.onEnd({
      win: false,
      title: 'LA MALDICIÓN<br><span>HA SALIDO</span>',
      line1: 'Tu cordura no ha resistido.',
      line2: 'Inténtalo otra vez… si te atreves.',
    }));
  }

  async win() {
    this.ending = true;
    this.rulesOn = false;
    this.ctx.sfx.play('bell');
    await this.say('Hasta mañana…', { pitch: 0.35, rate: 0.7 });
    for (const c of this.candles) {
      if (!c.lit) continue;
      await this.wait(0.7);
      c.lit = false; c.flame.visible = false;
      this.ctx.sfx.play('puff');
    }
    await this.wait(1.2);
    this.setPortrait(true);
    this.ctx.sfx.play('whisper');
    await this.wait(2);
    try { localStorage.setItem('gt_night', '2'); } catch (e) { /* nada */ }
    this.ctx.onEnd({
      win: true,
      title: 'NOCHE 1<br><span>SELLADA</span>',
      line1: `Cordura: ${Math.round(this.sanity)}%`,
      line2: 'Mañana… algo te espera en la cocina.',
    });
  }

  // ---------------- bucle ----------------
  update(dt) {
    this._dt = dt;
    this.time += dt;
    const t = this.time;

    // guion
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      if (this.waiters[i].pred()) { const w = this.waiters.splice(i, 1)[0]; w.res(); }
    }
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (t >= this.timers[i].t) { const tm = this.timers.splice(i, 1)[0]; tm.fn(); }
    }

    // mano perdida = dedo fuera del vaso
    if (!this._handPalm) {
      this.missing += dt;
      if (this.missing > 0.6) this.attached = false;
    }

    // --- vaso ---
    this.glassPrev.copy(this.glass);
    if (this.attached) {
      if (this.pull) {
        const zx = BOARD.x + ZONES[this.pull][0] - this.glass.x;
        const zz = BOARD.z + ZONES[this.pull][1] - this.glass.y;
        const l = Math.hypot(zx, zz);
        if (l > 0.01) this.pullOff.add(new THREE.Vector2(zx / l, zz / l).multiplyScalar(0.045 * dt));
        this._pullVib = (this._pullVib || 0) - dt;
        if (this._pullVib <= 0) { this.ctx.vibrate(18); this._pullVib = 0.3; }
      }
      const tx = this.tip.x + this.grabOff.x + this.pullOff.x;
      const tz = this.tip.y + this.grabOff.y + this.pullOff.y;
      const k = Math.min(1, dt * 14);
      let dx = (tx - this.glass.x) * k, dz = (tz - this.glass.y) * k;
      const step = Math.hypot(dx, dz), maxStep = 0.9 * dt;
      if (step > maxStep) { dx *= maxStep / step; dz *= maxStep / step; }
      this.glass.x += dx; this.glass.y += dz;
    } else {
      this.pullOff.multiplyScalar(Math.exp(-dt * 2));
    }
    const hx = BOARD.w / 2 - 0.04, hz = BOARD.d / 2 - 0.04;
    this.glass.x = Math.max(BOARD.x - hx, Math.min(BOARD.x + hx, this.glass.x));
    this.glass.y = Math.max(BOARD.z - hz, Math.min(BOARD.z + hz, this.glass.y));
    this.glassGroup.position.set(this.glass.x, TABLE_Y + 0.003, this.glass.y);
    const speed = this.glass.distanceTo(this.glassPrev) / Math.max(dt, 1e-3);
    if (speed > 0.02 || this._scraping) {
      this.ctx.sfx.setScrape(Math.min(0.35, speed * 1.1), 0.12);
      this._scraping = speed > 0.02;
      if (speed > 0.05) { this._scrVib = (this._scrVib || 0) - dt; if (this._scrVib <= 0) { this.ctx.vibrate(6); this._scrVib = 0.12; } }
    }

    // --- respuestas: quedarse quieto sobre una zona ---
    for (const k of Object.keys(ZONES)) this.zoneGlow[k].material.opacity = 0;
    if (this.answering && this.answerRes) {
      const z = this.answering.find((k) => this.inZone(k));
      if (z && z === this.dwellZone) this.dwellT += dt;
      else { this.dwellZone = z || null; this.dwellT = 0; }
      if (z) this.zoneGlow[z].material.opacity = 0.12 + 0.6 * Math.min(1, this.dwellT / DWELL);
      if (z && this.dwellT >= DWELL) {
        const res = this.answerRes;
        this.answerRes = null;
        this.answering = null;
        this.zoneGlow[z].material.opacity = 1;
        this.ctx.sfx.play('clack');
        this.ctx.vibrate(40);
        res(z);
      }
    }
    if (this.centerHint) this.zoneGlow.centro.material.opacity = 0.12 + 0.12 * Math.sin(t * 4);
    if (this.adiosHint && !(this.dwellZone === 'adios')) this.zoneGlow.adios.material.opacity = 0.1 + 0.1 * Math.sin(t * 3);

    // --- regla: no soltar el vaso ---
    if (this.rulesOn && !this.over && !this.ending) {
      if (this.attached) { this.relT = 0; this.warned = false; }
      else {
        this.relT += dt;
        if (this.relT > 2 && !this.warned) { this.warned = true; this.say('No sueltes el vaso.'); }
        if (this.relT > 6) { this.relT = 0; this.warned = false; this.say('Te lo advertí.'); this.punish(); }
      }
    }

    // --- velas ---
    const lit = this.litCount();
    const fl = 0.85 + Math.sin(t * 13) * 0.06 + Math.sin(t * 31) * 0.05 + (Math.random() - 0.5) * 0.08;
    const front = this.candles.slice(0, 2).filter((c) => c.lit).length;
    this.candleLights[0].intensity = front * 1.3 * fl;
    this.candleLights[1].intensity = (this.candles[2].lit ? 1.1 : 0) * fl;
    for (const c of this.candles) if (c.lit) { c.flame.scale.set(1, fl, 1); c.flame.rotation.z = Math.sin(t * 7 + c.h * 40) * 0.12; }
    this.candlesLit = lit;

    // --- puertas del mueble ---
    for (const d of this.doors) {
      d.open += (d.target - d.open) * Math.min(1, dt * 1.4);
      d.pivot.rotation.y = d.side * d.open * 1.7;
    }

    // --- objeto levitando ---
    const L = this.lev;
    if (L) {
      L.t += dt;
      const g = L.g;
      const palm = this._handPalm;
      const swat = palm && palm.distanceTo(g.position) < 0.15 && this._handVel.length() > 0.6;
      if (L.phase === 'rise') {
        const k = Math.min(1, L.t / 2.2);
        const e = k * k * (3 - 2 * k);
        g.position.lerpVectors(L.from, L.to, e);
        g.position.y += Math.sin(k * Math.PI) * 0.1;
        if (k >= 1) { L.phase = 'hover'; L.t = 0; }
      } else if (L.phase === 'hover') {
        g.position.set(L.to.x + Math.sin(t * 1.3) * 0.03 + (Math.random() - 0.5) * 0.006, L.to.y + Math.sin(t * 2.1) * 0.03, L.to.z + (Math.random() - 0.5) * 0.006);
        g.rotation.x += dt * 0.7; g.rotation.y += dt * 1.1;
        this.addSanity(-0.6 * dt);
      } else if (L.phase === 'thrown') {
        g.position.addScaledVector(L.vel, dt);
        g.rotation.x += dt * 14;
        const cam = this.ctx.camera.getWorldPosition(this._v);
        if (g.position.distanceTo(cam) < 0.28) {
          this.ctx.sfx.play('hit');
          this.ctx.flash('#a00000', 0.9);
          this.ctx.vibratePattern([250, 60, 120]);
          this.ctx.shake && this.ctx.shake(0.6);
          this.addSanity(-30);
          this.removeLev();
          return;
        }
      } else if (L.phase === 'fall') {
        L.vel.y -= 9.8 * dt;
        g.position.addScaledVector(L.vel, dt);
        g.rotation.z += dt * 8;
        if (g.position.y < 0.04) {
          this.ctx.sfx.play('shatter');
          this.ctx.vibrate(30);
          this.removeLev();
        }
      }
      if (this.lev && swat && (L.phase === 'hover' || L.phase === 'thrown' || L.phase === 'rise')) {
        L.phase = 'fall';
        L.vel.copy(this._handVel).multiplyScalar(1.3);
        L.vel.y = Math.max(L.vel.y, 0.6);
        this.ctx.sfx.play('clack');
        this.ctx.vibrate(35);
      }
    }

    // --- ambiente según la cordura ---
    const s = this.sanity;
    if (s < 60 && !this.over) {
      this.whisperT -= dt;
      if (this.whisperT <= 0) { this.ctx.sfx.play('whisper'); this.whisperT = 4 + Math.random() * 8 * (s / 60); }
    }
    if (s < 35 && !this.over) {
      this.heartT -= dt;
      if (this.heartT <= 0) { this.ctx.sfx.play('heartbeat'); this.heartT = 0.6 + s / 60; }
    }
  }

  removeLev() {
    if (!this.lev) return;
    this.scene.remove(this.lev.g);
    this.lev = null;
  }
}
