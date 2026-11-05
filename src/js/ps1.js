// Estética PS1/PS2: render a baja resolución, vértices "temblorosos" (snap),
// texturas pixeladas procedurales, cuantización de color con dithering y viñeta.
import * as THREE from 'three';

export const LOW_HEIGHT = 224;
export const snapUniform = { value: new THREE.Vector2(160, 112) };

// ---------- Materiales con vertex snapping ----------
export function ps1Mat(params = {}) {
  const m = new THREE.MeshLambertMaterial(params);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSnap = snapUniform;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform vec2 uSnap;\nvoid main() {')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 snapped = gl_Position;
        snapped.xy = floor(snapped.xy / snapped.w * uSnap + 0.5) / uSnap * snapped.w;
        gl_Position = snapped;`
      );
  };
  m.customProgramCacheKey = () => 'ps1lambert';
  return m;
}

// ---------- Geometría de caja con UV a escala real (texturas repetidas) ----------
export function boxGeo(w, h, d, texSize = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * dims[f][0]) / texSize, (uv.getY(k) * dims[f][1]) / texSize);
    }
  }
  return g;
}

// ---------- Texturas procedurales pixeladas ----------
function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return Math.abs(h) + 1;
}

function finishTex(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function noise(g, size, r, amount) {
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  g.putImageData(img, 0, 0);
}

function stains(g, size, r, count, color) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = color;
    const x = Math.floor(r() * size), y = Math.floor(r() * size);
    const s = 1 + Math.floor(r() * 4);
    g.fillRect(x, y, s, s + Math.floor(r() * 6));
  }
}

const cache = new Map();
export function makeTex(kind) {
  if (cache.has(kind)) return cache.get(kind);
  const size = 32;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = rng(hash(kind));

  switch (kind) {
    case 'wallpaper': {
      g.fillStyle = '#4b5440'; g.fillRect(0, 0, size, size);
      for (let x = 0; x < size; x += 8) { g.fillStyle = '#3d4535'; g.fillRect(x, 0, 2, size); }
      for (let y = 4; y < size; y += 8) for (let x = 3; x < size; x += 8) { g.fillStyle = '#5c6450'; g.fillRect(x, y, 2, 2); }
      stains(g, size, r, 10, 'rgba(40,30,20,0.5)');
      g.fillStyle = 'rgba(30,20,10,0.4)'; g.fillRect(0, 26, size, 6);
      noise(g, size, r, 30);
      break;
    }
    case 'brick': {
      g.fillStyle = '#3a3330'; g.fillRect(0, 0, size, size);
      for (let row = 0; row < 4; row++) {
        const off = row % 2 ? 8 : 0;
        for (let col = -1; col < 3; col++) {
          const v = 70 + Math.floor(r() * 30);
          g.fillStyle = `rgb(${v + 20},${v - 20},${v - 30})`;
          g.fillRect(col * 16 + off + 1, row * 8 + 1, 14, 6);
        }
      }
      noise(g, size, r, 34);
      break;
    }
    case 'concrete': {
      g.fillStyle = '#55524c'; g.fillRect(0, 0, size, size);
      stains(g, size, r, 14, 'rgba(30,28,24,0.45)');
      noise(g, size, r, 40);
      break;
    }
    case 'floor': {
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
        g.fillStyle = (x + y) % 2 ? '#3b3630' : '#4d473c';
        g.fillRect(x * 16, y * 16, 16, 16);
      }
      g.fillStyle = '#1c1a16'; g.fillRect(0, 0, size, 1); g.fillRect(0, 16, size, 1); g.fillRect(0, 0, 1, size); g.fillRect(16, 0, 1, size);
      stains(g, size, r, 12, 'rgba(20,10,5,0.5)');
      noise(g, size, r, 30);
      break;
    }
    case 'ceiling': {
      g.fillStyle = '#4a4740'; g.fillRect(0, 0, size, size);
      g.fillStyle = '#2e2c28'; g.fillRect(0, 0, size, 1); g.fillRect(0, 0, 1, size);
      stains(g, size, r, 8, 'rgba(60,40,10,0.35)');
      noise(g, size, r, 26);
      break;
    }
    case 'wood': {
      g.fillStyle = '#5a3a22'; g.fillRect(0, 0, size, size);
      for (let x = 0; x < size; x++) {
        if (r() < 0.3) { g.fillStyle = 'rgba(30,15,5,0.5)'; g.fillRect(x, 0, 1, size); }
      }
      g.fillStyle = '#2a170a'; g.fillRect(0, 15, size, 1);
      noise(g, size, r, 26);
      break;
    }
    case 'door': {
      g.fillStyle = '#4a2e1c'; g.fillRect(0, 0, size, size);
      g.fillStyle = '#3a2214'; g.fillRect(4, 3, 24, 11); g.fillRect(4, 18, 24, 11);
      g.fillStyle = '#5d3b24'; g.fillRect(5, 4, 22, 9); g.fillRect(5, 19, 22, 9);
      noise(g, size, r, 26);
      break;
    }
    case 'metal': {
      g.fillStyle = '#5d6064'; g.fillRect(0, 0, size, size);
      for (let i = 0; i < 10; i++) { g.fillStyle = 'rgba(200,200,210,0.25)'; g.fillRect(Math.floor(r() * size), Math.floor(r() * size), 1 + Math.floor(r() * 7), 1); }
      g.fillStyle = '#2b2c2e'; [[2, 2], [29, 2], [2, 29], [29, 29]].forEach(([x, y]) => g.fillRect(x, y, 2, 2));
      stains(g, size, r, 8, 'rgba(110,50,20,0.5)');
      noise(g, size, r, 22);
      break;
    }
    case 'hazard': {
      g.fillStyle = '#c8a020'; g.fillRect(0, 0, size, size);
      g.fillStyle = '#161410';
      for (let i = -size; i < size * 2; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 4, 0); g.lineTo(i + 4 - size, size); g.lineTo(i - size, size); g.fill(); }
      noise(g, size, r, 30);
      break;
    }
    case 'rust': {
      g.fillStyle = '#6e3a1e'; g.fillRect(0, 0, size, size);
      stains(g, size, r, 20, 'rgba(160,90,40,0.5)');
      g.fillStyle = '#2a140a'; g.fillRect(0, 10, size, 2);
      noise(g, size, r, 40);
      break;
    }
    case 'skin': {
      g.fillStyle = '#b89a80'; g.fillRect(0, 0, size, size);
      stains(g, size, r, 10, 'rgba(120,80,70,0.35)');
      noise(g, size, r, 22);
      break;
    }
    case 'cloth': {
      g.fillStyle = '#26283a'; g.fillRect(0, 0, size, size);
      for (let y = 0; y < size; y += 2) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, y, size, 1); }
      for (let x = 0; x < size; x += 4) { g.fillStyle = 'rgba(90,90,120,0.15)'; g.fillRect(x, 0, 1, size); }
      noise(g, size, r, 18);
      break;
    }
    case 'figure': {
      g.fillStyle = '#121010'; g.fillRect(0, 0, size, size);
      stains(g, size, r, 16, 'rgba(60,10,10,0.6)');
      noise(g, size, r, 16);
      break;
    }
    default: {
      g.fillStyle = '#808080'; g.fillRect(0, 0, size, size);
      noise(g, size, r, 30);
    }
  }
  const t = finishTex(c);
  cache.set(kind, t);
  return t;
}

export function makeTextTex(lines, { w = 128, h = 64, color = '#8a1a12', bg = null, font = 'bold 12px monospace' } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); } else g.clearRect(0, 0, w, h);
  g.fillStyle = color;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const arr = Array.isArray(lines) ? lines : [lines];
  const lh = h / (arr.length + 1);
  arr.forEach((s, i) => g.fillText(s, w / 2 + (Math.random() - 0.5) * 2, lh * (i + 1)));
  return finishTex(c);
}

// ---------- Post-proceso: baja resolución + dithering + viñeta + destellos ----------
export class PS1Renderer {
  constructor(renderer) {
    this.renderer = renderer;
    this.rt = new THREE.WebGLRenderTarget(4, 4, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
    this.flash = 0;
    this.flashColor = new THREE.Color(1, 1, 1);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        uRes: { value: new THREE.Vector2(4, 4) },
        uFlash: { value: 0 },
        uFlashColor: { value: new THREE.Vector3(1, 1, 1) },
        uTime: { value: 0 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uFlash; uniform vec3 uFlashColor; uniform float uTime;
        varying vec2 vUv;
        const float B[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
        void main(){
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          c = pow(max(c, vec3(0.0)), vec3(1.0/2.2));
          vec2 px = floor(vUv * uRes);
          int bi = int(mod(px.y, 4.0)) * 4 + int(mod(px.x, 4.0));
          float d = (B[bi] / 16.0 - 0.5) / 24.0;
          c = floor((c + d) * 24.0 + 0.5) / 24.0;
          float vig = smoothstep(0.85, 0.25, length((vUv - 0.5) * vec2(1.25, 1.0)));
          c *= mix(0.45, 1.0, vig);
          float grain = fract(sin(dot(px + uTime, vec2(12.9898, 78.233))) * 43758.5453);
          c += (grain - 0.5) * 0.035;
          c = mix(c, uFlashColor, clamp(uFlash, 0.0, 1.0));
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.postScene = new THREE.Scene();
    this.postScene.add(this.quad);
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  resize(w, h) {
    const lh = LOW_HEIGHT;
    const lw = Math.max(64, Math.round(lh * (w / h)));
    this.rt.setSize(lw, lh);
    this.mat.uniforms.uRes.value.set(lw, lh);
    snapUniform.value.set(lw / 2, lh / 2);
  }

  doFlash(color, amount) {
    this.flashColor.set(color);
    this.flash = Math.max(this.flash, amount);
  }

  render(scene, camera, dt, time) {
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.mat.uniforms.uFlash.value = this.flash;
    this.mat.uniforms.uFlashColor.value.set(this.flashColor.r, this.flashColor.g, this.flashColor.b);
    this.mat.uniforms.uTime.value = Math.floor(time * 24) % 100;
    const r = this.renderer;
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCam);
  }
}
