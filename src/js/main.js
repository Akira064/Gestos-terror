import * as THREE from 'three';
import { PS1Renderer } from './ps1.js';
import { Sfx, vibrate, vibratePattern } from './audio.js';
import { GyroLook, Joystick, PlayerMotion } from './controls.js';
import { Tracker } from './tracking.js';
import { HandGestures, loadThresholds } from './gestures.js';
import { HandModel } from './handModel.js';
import { World } from './world.js';
import { DebugPanel } from './debug.js';
import { loadModels } from './models.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');

// ---------- Render ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
const post = new PS1Renderer(renderer);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.Fog(0x000000, 1.2, 9);

const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.05, 40);
scene.add(camera);
scene.add(new THREE.AmbientLight(0x6a6078, 0.22));

// Linterna pegada a la cámara
const flashlight = new THREE.SpotLight(0xfff0d0, 7, 12, 0.5, 0.6, 1.6);
flashlight.position.set(0.1, -0.08, 0);
flashlight.target.position.set(0.03, -0.06, -1);
camera.add(flashlight, flashlight.target);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  post.resize(w, h);
  camera.aspect = w / h;
  // En vertical se abre el FOV para no ver "por un tubo"
  camera.fov = camera.aspect < 1 ? 82 : 62;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- Sistemas ----------
const sfx = new Sfx();
const th = loadThresholds();
const tracker = new Tracker($('cam'));
const gestures = new HandGestures(th);
const hand = new HandModel();
hand.group.visible = false;
scene.add(hand.group);
const gyro = new GyroLook(canvas);
const joystick = new Joystick($('joy'), $('joyKnob'));
const motion = new PlayerMotion();
const debug = new DebugPanel($('debug'), th);

// ---------- UI ----------
let msgTimer = null;
function msg(text, secs = 2.5) {
  const el = $('msg');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => el.classList.remove('show'), secs * 1000);
}
function fmt(t) {
  const m = Math.floor(t / 60), s = t % 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

let recoil = 0;
let running = false;
let startT = 0;
let elapsed = 0;

const world = new World(scene, {
  sfx,
  msg,
  vibrate,
  vibratePattern,
  flash: (c, a) => post.doFlash(c, a),
  inventory: (t) => { $('inv').textContent = t; },
  onShock: () => { recoil = 0.25; },
  camYaw: () => GyroLook.yawOf(camera.quaternion, new THREE.Vector3()),
  onWin: () => {
    running = false;
    const best = Math.min(elapsed, parseFloat(localStorage.getItem('gt_best') || 'Infinity'));
    try { localStorage.setItem('gt_best', String(best)); } catch (e) { /* nada */ }
    $('endTime').textContent = fmt(elapsed);
    $('endBest').textContent = 'Mejor tiempo: ' + fmt(best);
    $('end').hidden = false;
    ['hud', 'joy', 'btnCrouch', 'btnRecenter'].forEach((id) => ($(id).hidden = true));
    tracker.setTorch(false);
  },
});

const player = new THREE.Vector3(0, 0, 1.8);
// Agacharse: altura de los ojos de pie / agachado
const EYE_STAND = 1.6, EYE_CROUCH = 0.95;
let crouched = false;
let eye = EYE_STAND;
camera.position.set(player.x, 1.6, player.z);

// ---------- Mano: posición, colisión, contacto ----------
const PALM = [0, 5, 9, 13, 17];
const PROBES = [4, 8, 12, 16, 20];
const P = Array.from({ length: 21 }, () => new THREE.Vector3());
const palmW = new THREE.Vector3();
const camW = new THREE.Vector3();
const tmp = new THREE.Vector3();
const dir = new THREE.Vector3();
const prevPalm = new THREE.Vector3();
const ray = new THREE.Raycaster();
let hovered = null;
let recentHover = null;
let recentHoverT = -1e9;
let contact = false;
let lastDetMs = 0;
let wasPresent = false;
let vibeT = 0;

function avgPalm(out) {
  out.set(0, 0, 0);
  for (const k of PALM) out.add(P[k]);
  return out.multiplyScalar(1 / PALM.length);
}

function penetration(point) {
  dir.copy(point).sub(camW);
  const len = dir.length();
  if (len < 1e-4) return 0;
  dir.divideScalar(len);
  ray.set(camW, dir);
  ray.far = len + 0.05;
  const hit = ray.intersectObjects(world.colliders, false)[0];
  if (!hit) return 0;
  const margin = 0.025;
  return Math.max(0, len + margin - hit.distance);
}

function updateHand(nowMs, dt) {
  tracker.update(nowMs);
  const present = tracker.present(nowMs);

  if (tracker.newResult) {
    tracker.newResult = false;
    const dtDet = lastDetMs ? (nowMs - lastDetMs) / 1000 : 1 / 30;
    lastDetMs = nowMs;
    const view = { tanV: Math.tan((camera.fov * Math.PI) / 360), aspect: camera.aspect };
    const events = gestures.ingest(tracker.result, tracker.aspect, dtDet, nowMs / 1000, view, hovered ? hovered.id : null);
    for (const e of events) {
      // En un golpe rápido la mano puede salir un instante de la zona del objeto: vale el último tocado
      const target = hovered || ((e === 'punch' || e === 'knock' || e === 'grab') && nowMs - recentHoverT < 450 ? recentHover : null);
      world.handleEvent(e, target);
    }
  }

  if (!present) {
    if (wasPresent) { gestures.reset(); lastDetMs = 0; }
    wasPresent = false;
    hand.group.visible = false;
    hovered = null;
    contact = false;
    world.setHand(null, true);
    world.squashTarget = world.plushHeld ? 0.25 : 0;
    sfx.setScrape(0);
    $('handState').textContent = 'MANO —';
    $('handState').classList.remove('on');
    return;
  }
  wasPresent = true;
  $('handState').textContent = 'MANO ' + gestures.pose;
  $('handState').classList.add('on');

  // Puntos en mundo (la mano va "pegada" a la cámara del juego)
  recoil = Math.max(0, recoil - dt * 0.7);
  for (let i = 0; i < 21; i++) {
    P[i].copy(gestures.pointsCam[i]);
    P[i].z += recoil;
    camera.localToWorld(P[i]);
  }

  // No atraviesa paredes ni objetos: se empuja hacia la cámara hasta apoyarse
  camera.getWorldPosition(camW);
  avgPalm(palmW);
  let pen = penetration(palmW);
  for (const k of PROBES) pen = Math.max(pen, penetration(P[k]));
  const wasContact = contact;
  contact = pen > 0.002;
  if (contact) {
    tmp.copy(palmW).sub(camW);
    const dist = tmp.length();
    const push = Math.min(pen, Math.max(0, dist - 0.12));
    tmp.normalize().multiplyScalar(-push);
    for (let i = 0; i < 21; i++) P[i].add(tmp);
    palmW.add(tmp);
  }

  // Peluche: contacto blando (se aplasta, la mano entra un poco)
  const soft = world.softTouch(palmW, P);
  if (soft) { for (let i = 0; i < 21; i++) P[i].add(soft); palmW.add(soft); }

  // Vibración al tocar y roce al arrastrar
  const slide = prevPalm.distanceTo(palmW) / Math.max(dt, 1e-3);
  prevPalm.copy(palmW);
  if (contact && !wasContact) { vibrate(28); sfx.play('step'); }
  vibeT -= dt;
  if (contact && slide > 0.12) {
    sfx.setScrape(Math.min(0.45, slide * 0.35), Math.min(1, slide));
    if (vibeT <= 0) { vibrate(12); vibeT = 0.11; }
  } else sfx.setScrape(0);

  hand.update(P, th.handScale);
  hand.group.visible = true;

  world.setHand(palmW, gestures.pose === 'ABIERTA');
  hovered = world.findHover([palmW, P[4], P[8], P[12]], th.hover);
  if (hovered) { recentHover = hovered; recentHoverT = nowMs; }
}

// ---------- Bucle ----------
let last = performance.now();
let fps = 0, fpsN = 0, fpsT = 0;
let stepAcc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fpsN++;
  if (now - fpsT > 1000) { fps = fpsN; fpsN = 0; fpsT = now; }

  if (running) {
    elapsed = (now - startT) / 1000;
    gyro.update(camera.quaternion, 0);
    const yaw = GyroLook.yawOf(camera.quaternion, tmp);
    motion.maxSpeed = crouched ? 0.7 : 1.5;
    eye += ((crouched ? EYE_CROUCH : EYE_STAND) - eye) * Math.min(1, dt * 6);
    const speed = motion.update(dt, joystick, yaw, player, (x, z) => world.collide(x, z), world.lockMove);
    stepAcc += speed * dt;
    if (stepAcc > 0.65) { stepAcc = 0; sfx.play('step'); }
    const bob = Math.sin(motion.walked * 9) * 0.018 * Math.min(1, speed);
    camera.position.set(player.x, eye + bob, player.z);
    camera.updateMatrixWorld(true);

    updateHand(now, dt);
    world.update(dt, player, hovered, hand.group.visible ? gestures : null);

    const flick = Math.random() < 0.004 ? 0.4 : 1;
    flashlight.intensity = 7 * world.flashFactor * flick;

    $('timer').textContent = fmt(elapsed);
    $('hint').textContent = hovered ? hovered.hint() : '';
  }

  post.render(scene, camera, dt, now / 1000);

  debug.draw({
    now: now / 1000,
    present: hand.group.visible,
    img: gestures.img,
    pose: gestures.pose,
    v: gestures.v,
    detFps: tracker.detFps,
    detectMs: tracker.detectMs,
    delegate: tracker.delegate,
    torch: tracker.torchOn,
    fps,
    contact,
    hover: hovered ? hovered.id : null,
  });
}
requestAnimationFrame(frame);

// ---------- Inicio ----------
$('btnStart').addEventListener('click', async () => {
  const btn = $('btnStart');
  const status = $('status');
  btn.disabled = true;
  sfx.init();
  try {
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
      await DeviceOrientationEvent.requestPermission().catch(() => {});
    }
    status.style.color = '#a89c84';
    status.textContent = 'Activando cámara trasera y flash…';
    await tracker.startCamera();
    await tracker.loadModel((t) => (status.textContent = t));
    await loadModels(world, (t) => (status.textContent = t)).catch((e) => console.warn(e));
  } catch (e) {
    console.error(e);
    status.style.color = '#d06050';
    status.textContent = (e && e.message) || String(e);
    btn.disabled = false;
    btn.textContent = 'REINTENTAR';
    return;
  }
  $('menu').hidden = true;
  ['hud', 'joy', 'btnCrouch', 'btnDebug', 'btnRecenter'].forEach((id) => ($(id).hidden = false));
  gyro.needRecenter = true;
  running = true;
  startT = performance.now();
  if (!tracker.torchOn) setTimeout(() => !tracker.torchOn && msg('Tu móvil no deja encender el flash desde la app. Busca algo de luz.', 4), 1500);
  msg('Pon la mano detrás del móvil, delante de la cámara.', 4);
});

$('btnDebug').addEventListener('click', () => debug.toggle());
$('btnCrouch').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  crouched = !crouched;
  $('btnCrouch').textContent = crouched ? 'LEVANTAR' : 'AGACHAR';
  $('btnCrouch').classList.toggle('on', crouched);
  sfx.play('step');
  vibrate(15);
});
$('btnRecenter').addEventListener('click', () => gyro.recenter(0));
$('btnAgain').addEventListener('click', () => location.reload());
