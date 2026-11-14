// The shoreline's special places: rock shelves holding tide pools.
//
// A handful of spots are picked around the sea coast. At each, the ground is
// levelled into a slab of stone sitting between low and high tide, and a few
// pools are set on it. At low tide the shelf is bare with the pools left
// standing; at high tide the sea washes over it.

import { CONFIG } from '../config.js';
import { naturalHeightAt, addRockShelf } from './terrain.js';
import { seededRandom } from './noise.js';

/** Chooses the shelves and returns where each pool goes: [{ x, z, rotation, scale }]. */
export function placeTidePools() {
  const P = CONFIG.tidePools;
  if (!P.enabled) return [];
  const rand = seededRandom(CONFIG.seed + 808);
  const water = CONFIG.water.level;
  const radius = CONFIG.terrain.islandRadius;

  // Walk in from the open sea along many bearings to find where the coast is.
  const coast = [];
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 90) {
    for (let r = radius * 1.15; r > radius * 0.45; r -= 2) {
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (naturalHeightAt(x, z) > water) {
        // Step a little further in so the shelf straddles the waterline.
        coast.push([Math.cos(a) * (r - 3), Math.sin(a) * (r - 3), rand()]);
        break;
      }
    }
  }
  coast.sort((p, q) => p[2] - q[2]); // a fixed shuffle

  const sites = [];
  for (const [x, z] of coast) {
    if (sites.length >= P.count) break;
    if (sites.some((s) => Math.hypot(s[0] - x, s[1] - z) < P.spacing)) continue;
    sites.push([x, z]);
  }

  const pools = [];
  for (const [x, z] of sites) {
    addRockShelf(x, z, P.shelfRadius, water + P.shelfHeight);
    const count = P.poolsPerShelf[0] + Math.floor(rand() * (P.poolsPerShelf[1] - P.poolsPerShelf[0] + 1));
    for (let i = 0; i < count; i++) {
      // Spread evenly round the shelf, each sized to fit its share, so pools never overlap.
      const a = (i / count) * Math.PI * 2 + rand() * 0.5;
      const d = count === 1 ? 0 : P.shelfRadius * 0.52;
      const room = count === 1 ? 2.2 : Math.min(2.2, (Math.PI * d) / count / 1.9); // how big a pool fits here
      const scale = room * (0.7 + rand() * 0.3) / 1.75;
      pools.push({ x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, rotation: rand() * Math.PI * 2, scale });
    }
  }
  return pools;
}
