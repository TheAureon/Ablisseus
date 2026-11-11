// Biomes: large regions with their own ground colour, terrain shape, plants
// and mood. They are defined in CONFIG.biomes.types — add an entry there and
// it appears in the world.
//
// Each biome has its own slow noise field; wherever a biome's field is the
// highest, that biome wins. Near borders the weights blend, so ground colour
// and terrain shape fade smoothly from one region to the next.

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { biomeNoise, smoothstep } from './noise.js';

const cfg = CONFIG.biomes;

export const BIOME_NAMES = Object.keys(cfg.types);
const types = BIOME_NAMES.map((name) => cfg.types[name]);
const colorCache = new Map(); // key -> [THREE.Color per biome]
const spawnIndex = BIOME_NAMES.indexOf(cfg.spawn);
const scratch = new Float32Array(types.length);

export const biomeIndex = (name) => BIOME_NAMES.indexOf(name);
export const biomeLabel = (index) => types[index].label ?? BIOME_NAMES[index];

/** How much each biome is present at (x, z). The weights add up to 1. */
export function biomeWeights(x, z, out = scratch) {
  const [sx, sz] = CONFIG.player.spawn;
  const nearSpawn = spawnIndex < 0 ? 0 : 1 - smoothstep(cfg.spawnRadius * 0.5, cfg.spawnRadius, Math.hypot(x - sx, z - sz));
  let sum = 0;
  for (let i = 0; i < types.length; i++) {
    let field = biomeNoise.noise(x * cfg.scale + i * 137.1, z * cfg.scale - i * 71.7) + (types[i].bias ?? 0);
    if (i === spawnIndex) field += nearSpawn * 2; // you always start in the spawn biome
    sum += out[i] = Math.exp(field * cfg.sharpness);
  }
  for (let i = 0; i < types.length; i++) out[i] /= sum;
  return out;
}

/** Weighted average of a numeric biome property, e.g. blend(weights, 'heightScale'). */
export function blend(weights, key, fallback = 1) {
  let value = 0;
  for (let i = 0; i < types.length; i++) value += weights[i] * (types[i][key] ?? fallback);
  return value;
}

/** Weighted average of a colour biome property into `out`. */
export function blendColor(weights, key, out, fallback = '#ffffff') {
  if (!colorCache.has(key)) colorCache.set(key, types.map((t) => new THREE.Color(t[key] ?? fallback)));
  const colors = colorCache.get(key);
  out.setRGB(0, 0, 0);
  for (let i = 0; i < types.length; i++) {
    out.r += colors[i].r * weights[i];
    out.g += colors[i].g * weights[i];
    out.b += colors[i].b * weights[i];
  }
  return out;
}

/** Index of the strongest biome. */
export function dominant(weights) {
  let best = 0;
  for (let i = 1; i < types.length; i++) if (weights[i] > weights[best]) best = i;
  return best;
}
