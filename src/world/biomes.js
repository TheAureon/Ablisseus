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
import { ISLANDS, islandIndexAt, landAt } from './islands.js';

const cfg = CONFIG.biomes;

export const BIOME_NAMES = Object.keys(cfg.types);
const types = BIOME_NAMES.map((name) => cfg.types[name]);
const colorCache = new Map(); // key -> [THREE.Color per biome]
const spawnIndex = BIOME_NAMES.indexOf(cfg.spawn);
const scratch = new Float32Array(types.length);

export const biomeIndex = (name) => BIOME_NAMES.indexOf(name);
export const biomeLabel = (index) => types[index].label ?? BIOME_NAMES[index];

// Which biomes each island allows.
const allowed = ISLANDS.map((island) => types.map((_, i) => island.biomes.includes(BIOME_NAMES[i])));
for (const island of ISLANDS) {
  for (const name of island.biomes) if (!BIOME_NAMES.includes(name)) console.warn(`[islands] "${island.name}" lists unknown biome "${name}"`);
}
const [offsetX, offsetZ] = CONFIG.terrain.noiseOffset;

/**
 * How much each biome is present at (x, z). The weights add up to 1, and only
 * biomes allowed on the island the point belongs to can be present.
 */
export function biomeWeights(x, z, out = scratch) {
  const [sx, sz] = CONFIG.player.spawn;
  const nearSpawn = spawnIndex < 0 ? 0 : 1 - smoothstep(cfg.spawnRadius * 0.5, cfg.spawnRadius, Math.hypot(x - sx, z - sz));
  const here = allowed[islandIndexAt(x, z)];
  const nx = (x + offsetX) * cfg.scale;
  const nz = (z + offsetZ) * cfg.scale;
  let sum = 0;
  for (let i = 0; i < types.length; i++) {
    if (!here[i]) {
      out[i] = 0;
      continue;
    }
    let field = biomeNoise.noise(nx + i * 137.1, nz - i * 71.7) + (types[i].bias ?? 0);
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

// A coarse picture of which biome is where, for quick "roughly how much of
// biome X is here?" questions. Scattering plants asks that millions of times,
// and working it out from scratch each time is what used to make loading slow.
const GRID_CELL = 5; // metres
let weightGrid = null;

function buildWeightGrid() {
  const size = CONFIG.terrain.size;
  const n = Math.ceil(size / GRID_CELL);
  const data = new Uint8Array(n * n * types.length);
  const w = new Float32Array(types.length);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * GRID_CELL - size / 2;
      const z = (j + 0.5) * GRID_CELL - size / 2;
      if (landAt(x, z) <= 0) continue; // open sea
      biomeWeights(x, z, w);
      const o = (j * n + i) * types.length;
      for (let b = 0; b < types.length; b++) data[o + b] = Math.round(w[b] * 255);
    }
  }
  return { data, n };
}

/** Roughly how much of one biome (by index) is present at (x, z), 0..1. Fast. */
export function approxBiomeWeight(x, z, index) {
  weightGrid ??= buildWeightGrid();
  const size = CONFIG.terrain.size;
  const i = Math.floor((x + size / 2) / GRID_CELL);
  const j = Math.floor((z + size / 2) / GRID_CELL);
  if (i < 0 || j < 0 || i >= weightGrid.n || j >= weightGrid.n) return 0;
  return weightGrid.data[(j * weightGrid.n + i) * types.length + index] / 255;
}
