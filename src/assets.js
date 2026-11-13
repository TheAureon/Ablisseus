// ─────────────────────────────────────────────────────────────────────────────
//  ASSET REGISTRY — swap placeholders for real models here.
//
//  To use your own model:
//    1. Put the .glb / .gltf file in  /models/
//    2. Set `model` below, e.g.   pine: { model: 'models/pine.glb', ... }
//
//  While `model` is null (or fails to load) the placeholder shape is used.
//  Models should have their origin at ground level, Y up.
//    scale    – uniform size multiplier applied to the model
//    yOffset  – raise/lower it (metres, after scaling)
//    rotation – [x, y, z] radians, to fix models exported lying down etc.
//
//  New entries can be added freely and referenced by name from
//  CONFIG.scatter / CONFIG.landmarks in config.js.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as placeholders from './placeholders.js';

export const ASSETS = {
  pine:   { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: placeholders.pine },
  tree:   { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: placeholders.tree },
  rock:   { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: placeholders.rock },
  grass:  { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: placeholders.grass },
  flower: { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: placeholders.flower },

  // Biome variants — until you give them their own models they are recoloured placeholders.
  pineSnow:    { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: () => placeholders.pine('#35604a', '#eef3f6') },
  treeAutumn:  { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: () => placeholders.tree('#d2742c') },
  treeGold:    { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: () => placeholders.tree('#e0b23c') },
  treeBlossom: { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: () => placeholders.tree('#f3b3cf', '#5a4038') },
  cactus:      { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: placeholders.cactus },
  bush:        { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: placeholders.bush },
  rockSand:    { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: () => placeholders.rock('#b99468') },
  rockSnow:    { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: () => placeholders.rock('#c9d2d8') },
  grassDark:   { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: () => placeholders.grass('#33583a', '#6f9a5a') },
  grassDry:    { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: () => placeholders.grass('#9a7f3a', '#e3c873') },
  grassPale:   { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: () => placeholders.grass('#6f9f6a', '#cfe6b0') },
  flowerPink:  { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: () => placeholders.flower('#ffd3e6', '#ff7fb5') },

  // Natural landmarks — one large feature per biome (placed via CONFIG.landmarks)
  elderTree:    { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: placeholders.giantTree },
  motherBlossom:{ model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: () => placeholders.giantTree('#f4a9cc', '#5a4038') },
  rockArch:     { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: placeholders.rockArch },
  rockSpire:    { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: placeholders.rockSpire },
  stoneCircle:  { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: placeholders.stoneCircle },
  iceCrown:     { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: placeholders.iceCrown },

  // Trail furniture (placed automatically along the paths, see CONFIG.trails)
  campfire:     { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: placeholders.campfire },
  logSeat:      { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: placeholders.logSeat },
  tent:         { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: placeholders.tent },
  bench:        { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: placeholders.bench },
  lantern:      { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: placeholders.lantern },
  signpost:     { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: placeholders.signpost },

  // Your own body, seen when looking down. See body.js for model requirements.
  body:   { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: placeholders.body },
};

/** Loads every asset and returns { name: THREE.Object3D } templates. */
export async function loadAssets() {
  const loader = new GLTFLoader();
  const templates = {};

  await Promise.all(
    Object.entries(ASSETS).map(async ([name, def]) => {
      let object = null;
      let animations = [];
      if (def.model) {
        try {
          const gltf = await loader.loadAsync(def.model);
          object = gltf.scene;
          animations = gltf.animations;
        } catch (err) {
          console.warn(`[assets] Could not load "${def.model}" for "${name}" — using placeholder.`, err);
        }
      }
      if (!object) object = def.placeholder();

      object.scale.multiplyScalar(def.scale ?? 1);
      object.rotation.set(...(def.rotation ?? [0, 0, 0]));
      object.position.y += def.yOffset ?? 0;

      const wrapper = new THREE.Group();
      wrapper.name = name;
      wrapper.userData.animations = animations;
      wrapper.add(object);
      templates[name] = wrapper;
    }),
  );

  return templates;
}
