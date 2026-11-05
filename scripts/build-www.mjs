// Copia el juego (src/) a www/ junto con three.js, MediaPipe (wasm) y el modelo de manos.
// Todo queda dentro del APK: el juego no usa internet en tiempo de ejecución.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = path.join(root, 'src');
const www = path.join(root, 'www');
const nm = path.join(root, 'node_modules');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';

function must(p, what) {
  if (!fs.existsSync(p)) {
    console.error(`[build] Falta ${what}: ${p}`);
    process.exit(1);
  }
  return p;
}

fs.rmSync(www, { recursive: true, force: true });
fs.cpSync(must(src, 'carpeta src'), www, { recursive: true });

// three.js (todos los .js del build: en versiones nuevas three.module.js importa three.core.js)
const threeBuild = must(path.join(nm, 'three', 'build'), 'three (npm install)');
fs.mkdirSync(path.join(www, 'lib'), { recursive: true });
for (const f of fs.readdirSync(threeBuild)) {
  if (f.endsWith('.js') && f.startsWith('three') && !f.includes('.cjs')) {
    fs.copyFileSync(path.join(threeBuild, f), path.join(www, 'lib', f));
  }
}
must(path.join(www, 'lib', 'three.module.js'), 'three.module.js');

// MediaPipe Tasks Vision
const mp = must(path.join(nm, '@mediapipe', 'tasks-vision'), '@mediapipe/tasks-vision');
const bundle = ['vision_bundle.mjs', 'vision_bundle.js'].map((f) => path.join(mp, f)).find((f) => fs.existsSync(f));
if (!bundle) {
  console.error('[build] No encuentro vision_bundle.mjs en @mediapipe/tasks-vision');
  process.exit(1);
}
fs.copyFileSync(bundle, path.join(www, 'lib', 'vision_bundle.js'));
fs.cpSync(must(path.join(mp, 'wasm'), 'wasm de MediaPipe'), path.join(www, 'mediapipe', 'wasm'), { recursive: true });

// Modelo hand_landmarker.task (se descarga UNA vez al compilar y se empaqueta)
const modelDir = path.join(root, 'models');
const modelFile = path.join(modelDir, 'hand_landmarker.task');
if (!fs.existsSync(modelFile)) {
  console.log('[build] Descargando modelo de manos…');
  fs.mkdirSync(modelDir, { recursive: true });
  const res = await fetch(MODEL_URL);
  if (!res.ok) {
    console.error(`[build] No se pudo descargar el modelo (${res.status}). Ponlo a mano en models/hand_landmarker.task`);
    process.exit(1);
  }
  fs.writeFileSync(modelFile, Buffer.from(await res.arrayBuffer()));
}
const size = fs.statSync(modelFile).size;
if (size < 1_000_000) {
  console.error(`[build] El modelo parece corrupto (${size} bytes)`);
  process.exit(1);
}
fs.copyFileSync(modelFile, path.join(www, 'mediapipe', 'hand_landmarker.task'));

console.log('[build] www/ listo:');
for (const f of ['index.html', 'lib/three.module.js', 'lib/vision_bundle.js', 'mediapipe/hand_landmarker.task']) {
  console.log('  ✓', f, fs.statSync(path.join(www, f)).size, 'bytes');
}
