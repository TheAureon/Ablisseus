// Seeded randomness and noise shared by the terrain, biomes and prop scatter.

import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { CONFIG } from '../config.js';

/** Small deterministic random generator so a seed always gives the same world. */
export function seededRandom(seed) {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const makeNoise = (offset) => new SimplexNoise({ random: seededRandom(CONFIG.seed + offset) });

export const heightNoise = makeNoise(0);
export const detailNoise = makeNoise(101);
export const biomeNoise = makeNoise(202);

/** General-purpose 2D noise in [-1, 1] (colour variation, prop clustering). */
export const noise2 = (x, z) => detailNoise.noise(x, z);

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
