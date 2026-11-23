// The shoreline's special places: rock shelves holding tide pools.
//
// A handful of spots are picked around the sea coast. At each, the ground is
// levelled into a slab of stone sitting between low and high tide, and a few
// pools are set on it. At low tide the shelf is bare with the pools left
// standing; at high tide the sea washes over it.

import { CONFIG } from '../config.js';
import { naturalHeightAt, addRockShelf } from './terrain.js';
import { seededRandom } from './noise.js';
import { ISLANDS } from './islands.js';
import { distanceToRiver } from './river.js';

/** Chooses the shelves and returns where each pool goes: [{ x, z, rotation, scale }]. */
export function placeTidePools() {
  const P = CONFIG.tidePools;
  if (!P.enabled) return [];
  const rand = seededRandom(CONFIG.seed + 808);
  const water = CONFIG.water.level;

  const sites = [];
  for (const island of ISLANDS) {
    // Walk in from the open sea along many bearings to find where the coast is.
    const coast = [];
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 90) {
      for (let r = island.radius * 1.1; r > island.radius * 0.4; r -= 2) {
        const x = island.x + Math.cos(a) * r;
        const z = island.z + Math.sin(a) * r;
        if (naturalHeightAt(x, z) > water) {
          // Step a little further in so the shelf straddles the waterline.
          coast.push([island.x + Math.cos(a) * (r - 3), island.z + Math.sin(a) * (r - 3), rand()]);
          break;
        }
      }
    }
    coast.sort((p, q) => p[2] - q[2]); // a fixed shuffle

    const wanted = Math.round((P.count * island.radius) / 380); // bigger islands have more coast
    let found = 0;
    for (const [x, z] of coast) {
      if (found >= wanted) break;
      if (sites.some((s) => Math.hypot(s[0] - x, s[1] - z) < P.spacing)) continue;
      // No tide-pool shelves at the foot of a cliff coast or a headland: a shelf would level the cliff.
      if ((CONFIG.terrain.cliffCoasts ?? []).some((cc) => Math.hypot(cc.x - x, cc.z - z) < cc.radius + 15)) continue;
      if ((CONFIG.terrain.headlands ?? []).some((hd) => Math.hypot(hd.to[0] - x, hd.to[1] - z) < Math.max(...hd.width) + 25)) continue;
      if (distanceToRiver(x, z) < 30) continue; // nor in a river mouth
      sites.push([x, z]);
      found++;
    }
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
