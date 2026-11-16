// The islands that make up the world (CONFIG.islands). Each is a disc of land
// with its own set of biomes; the sea lies between them.

import { CONFIG } from '../config.js';
import { smoothstep } from './noise.js';

export const ISLANDS = CONFIG.islands;

/** 0 in open sea … 1 well inside an island. Land fades to sea toward each island's rim. */
export function landAt(x, z) {
  const start = CONFIG.terrain.islandFalloffStart;
  let land = 0;
  for (const island of ISLANDS) {
    const d = Math.hypot(x - island.x, z - island.z);
    if (d < island.radius) land = Math.max(land, 1 - smoothstep(island.radius * start, island.radius, d));
  }
  return land;
}

/** Index of the island a point belongs to: the one whose rim it is nearest to being inside. */
export function islandIndexAt(x, z) {
  let best = 0;
  let bestScore = Infinity;
  for (let i = 0; i < ISLANDS.length; i++) {
    const score = Math.hypot(x - ISLANDS[i].x, z - ISLANDS[i].z) / ISLANDS[i].radius;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

export const islandByName = (name) => ISLANDS.find((island) => island.name === name);

const totalArea = ISLANDS.reduce((sum, island) => sum + island.radius ** 2, 0);

/** A random point on some island, with every square metre of island equally likely. */
export function randomIslandPoint(rand) {
  let pick = rand() * totalArea;
  let island = ISLANDS[0];
  for (const candidate of ISLANDS) {
    island = candidate;
    pick -= candidate.radius ** 2;
    if (pick <= 0) break;
  }
  const r = Math.sqrt(rand()) * island.radius;
  const a = rand() * Math.PI * 2;
  return [island.x + Math.cos(a) * r, island.z + Math.sin(a) * r];
}

/** The box that holds every island: { cx, cz, spanX, spanZ }. Used to frame the map. */
export function worldBounds() {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const island of ISLANDS) {
    minX = Math.min(minX, island.x - island.radius);
    maxX = Math.max(maxX, island.x + island.radius);
    minZ = Math.min(minZ, island.z - island.radius);
    maxZ = Math.max(maxZ, island.z + island.radius);
  }
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, spanX: maxX - minX, spanZ: maxZ - minZ };
}
