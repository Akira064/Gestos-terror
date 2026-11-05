// Carga de modelos hechos en Blender (.glb) que sustituyen a los modelos procedurales.
// Pon el archivo en src/models/<nombre>.glb (ver src/models/LEEME.md). Si no existe, se usa el de código.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ps1Mat } from './ps1.js';

// Convierte los materiales de Blender al estilo PS1 (iluminación simple, vértices temblorosos, texturas pixeladas)
function toPS1(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = !o.isSkinnedMesh;
    const conv = (m) => {
      if (!m) return m;
      if (m.map) {
        m.map.magFilter = THREE.NearestFilter;
        m.map.minFilter = THREE.NearestFilter;
        m.map.generateMipmaps = false;
        m.map.needsUpdate = true;
      }
      const n = ps1Mat({
        map: m.map || null,
        color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
        emissive: m.emissive ? m.emissive.clone() : new THREE.Color(0x000000),
        emissiveMap: m.emissiveMap || null,
        transparent: !!m.transparent,
        opacity: m.opacity ?? 1,
        alphaTest: m.alphaTest || 0,
        side: m.side,
        vertexColors: !!m.vertexColors,
      });
      n.name = m.name;
      return n;
    };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
  });
}

export async function loadModels(world, onStatus) {
  let names = [];
  try {
    const res = await fetch('./models/manifest.json');
    if (res.ok) names = await res.json();
  } catch (e) {
    return [];
  }
  if (!Array.isArray(names) || !names.length) return [];
  const loader = new GLTFLoader();
  const loaded = [];
  for (const name of names) {
    if (!world.modelSlots[name]) {
      console.warn(`[modelos] "${name}.glb" no corresponde a ningún objeto del juego`);
      continue;
    }
    try {
      onStatus && onStatus(`Cargando modelo ${name}…`);
      const gltf = await loader.loadAsync(`./models/${name}.glb`);
      const model = gltf.scene || gltf.scenes[0];
      toPS1(model);
      world.attachModel(name, model, gltf.animations || []);
      loaded.push(name);
    } catch (e) {
      console.warn(`[modelos] Error cargando ${name}.glb`, e);
    }
  }
  return loaded;
}
