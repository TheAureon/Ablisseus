// Natural landmarks: one large feature per biome (CONFIG.landmarks).
// A landmark with `biome` finds its own spot — the calmest, most central
// piece of that biome — so it survives changes to the seed or island shape.
// A landmark with `position: [x, z]` is placed exactly there instead.

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { heightAt, slopeAt, findDryLand, spawnPoint, addPad } from './terrain.js';
import { biomeWeights, biomeIndex } from './biomes.js';
import { flattenTemplate } from './scatter.js';

/** Decides where every landmark goes. Returns [{ asset, label, x, z, scale, rotation, radius }]. */
export function placeLandmarks() {
  const placed = [];
  const [sx, sz] = spawnPoint();
  const reach = CONFIG.terrain.islandRadius * 0.82;

  for (const lm of CONFIG.landmarks) {
    let spot = null;
    if (lm.position) {
      spot = findDryLand(lm.position[0], lm.position[1]);
    } else {
      const biome = biomeIndex(lm.biome);
      if (biome < 0) {
        console.warn(`[landmarks] Unknown biome "${lm.biome}"`);
        continue;
      }
      // Try gentle ground first; in rugged biomes settle for steeper.
      for (const maxSlope of [0.3, 0.55, 0.9]) {
        let best = -Infinity;
        for (let x = -reach; x <= reach; x += 12) {
          for (let z = -reach; z <= reach; z += 12) {
            if (Math.hypot(x, z) > reach) continue;
            const weight = biomeWeights(x, z)[biome];
            if (weight < 0.6) continue;
            if (Math.hypot(x - sx, z - sz) < (lm.minSpawnDistance ?? 90)) continue;
            if (placed.some((p) => Math.hypot(x - p.x, z - p.z) < 130)) continue;
            const height = heightAt(x, z);
            if (height < CONFIG.water.level + 2.5) continue;
            const slope = slopeAt(x, z);
            if (slope > maxSlope) continue;
            // Deep inside the biome, on gentle ground, ideally a little raised
            // (or as high as possible for `prefer: 'summit'`).
            const lift = lm.prefer === 'summit' ? height * 0.05 : Math.min(height, 25) * 0.015;
            const score = weight * 2 - slope * 4 + lift;
            if (score > best) {
              best = score;
              spot = [x, z];
            }
          }
        }
        if (spot) break;
      }
      if (!spot) {
        console.warn(`[landmarks] No room for "${lm.asset}" in biome "${lm.biome}"`);
        continue;
      }
    }
    const radius = (lm.radius ?? 8) * (lm.scale ?? 1);
    addPad(spot[0], spot[1], radius + 4, 16); // a level clearing to stand in
    placed.push({
      asset: lm.asset,
      label: lm.label,
      x: spot[0],
      z: spot[1],
      scale: lm.scale ?? 1,
      rotation: lm.rotation ?? 0,
      radius,
    });
  }
  return placed;
}

export function createLandmarks(templates, placed) {
  const group = new THREE.Group();
  for (const lm of placed) {
    const template = templates[lm.asset];
    if (!template) {
      console.warn(`[landmarks] Unknown asset "${lm.asset}"`);
      continue;
    }
    // Sit on the lowest ground under the footprint so nothing floats on a slope.
    let y = heightAt(lm.x, lm.z);
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
      y = Math.min(y, heightAt(lm.x + Math.cos(a) * lm.radius * 0.7, lm.z + Math.sin(a) * lm.radius * 0.7));
    }
    // Weld the landmark's many pieces into one mesh per material: far fewer draw calls.
    const obj = new THREE.Group();
    for (const part of flattenTemplate(template)) {
      const mesh = new THREE.Mesh(part.geometry, part.material);
      mesh.castShadow = mesh.receiveShadow = true;
      obj.add(mesh);
    }
    obj.name = `landmark:${lm.asset}`;
    obj.position.set(lm.x, y - 0.15, lm.z);
    obj.rotation.y = lm.rotation;
    obj.scale.setScalar(lm.scale);
    group.add(obj);
  }
  return group;
}
