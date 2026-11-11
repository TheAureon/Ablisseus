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
  beacon: { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: placeholders.beacon },
  arch:   { model: null, scale: 1, yOffset: 0, rotation: [0, 0, 0], placeholder: placeholders.arch },
};

/** Loads every asset and returns { name: THREE.Object3D } templates. */
export async function loadAssets() {
  const loader = new GLTFLoader();
  const templates = {};

  await Promise.all(
    Object.entries(ASSETS).map(async ([name, def]) => {
      let object = null;
      if (def.model) {
        try {
          object = (await loader.loadAsync(def.model)).scene;
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
      wrapper.add(object);
      templates[name] = wrapper;
    }),
  );

  return templates;
}
