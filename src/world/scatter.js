// Scatters instanced props over the terrain (CONFIG.scatter) and places
// one-off landmarks (CONFIG.landmarks). Works the same for placeholders and
// loaded models: every mesh inside an asset becomes one InstancedMesh.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { heightAt, slopeAt, findDryLand } from './terrain.js';
import { noise2, seededRandom, smoothstep } from './noise.js';
import { biomeWeights, biomeIndex } from './biomes.js';

/** Shared wind clock — main.js advances `uTime.value` every frame. */
export const windUniforms = { uTime: { value: 0 } };

function addSway(material, amount) {
  const m = material.clone();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uSway = { value: amount };
    shader.uniforms.uWindSpeed = { value: CONFIG.wind.speed };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uSway;\nuniform float uWindSpeed;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float swayPhase = instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.27;
        #else
          float swayPhase = 0.0;
        #endif
        float swayBend = max(transformed.y, 0.0) * uSway;
        transformed.x += sin(uTime * uWindSpeed + swayPhase) * swayBend;
        transformed.z += cos(uTime * uWindSpeed * 0.7 + swayPhase * 1.3) * swayBend * 0.6;`,
      );
  };
  m.customProgramCacheKey = () => 'sway';
  return m;
}

/** Picks instance transforms for one scatter layer. */
function placeLayer(layer, index) {
  const rand = seededRandom(CONFIG.seed * 31 + index * 977 + 5);
  const radius = CONFIG.terrain.islandRadius;
  const [minH, maxH] = layer.height ?? [-Infinity, Infinity];
  const [minS, maxS] = layer.scale ?? [1, 1];
  const items = []; // { matrix, tint, x, z }
  const dummy = new THREE.Object3D();
  const biome = layer.biome ? biomeIndex(layer.biome) : -1;
  if (layer.biome && biome < 0) console.warn(`[scatter] Unknown biome "${layer.biome}"`);

  for (let tries = 0; items.length < layer.count && tries < layer.count * 120; tries++) {
    const r = Math.sqrt(rand()) * radius;
    const a = rand() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;

    // Stay inside the layer's biome, thinning out toward its borders.
    if (biome >= 0 && rand() > smoothstep(0.3, 0.65, biomeWeights(x, z)[biome])) continue;

    const y = heightAt(x, z);
    if (y < minH || y > maxH) continue;
    if (slopeAt(x, z) > (layer.maxSlope ?? 1)) continue;
    if (layer.cluster) {
      const n = noise2(x * layer.cluster.scale + index * 50, z * layer.cluster.scale);
      if (layer.cluster.invert ? n > layer.cluster.threshold : n < layer.cluster.threshold) continue;
    }

    dummy.position.set(x, y - (layer.sink ?? 0), z);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.setScalar(minS + rand() * (maxS - minS));
    dummy.updateMatrix();
    items.push({ matrix: dummy.matrix.clone(), tint: 1 - rand() * (layer.colorJitter ?? 0), x, z });
  }
  return items;
}

/**
 * Flattens a template into as few { geometry, material } parts as possible:
 * meshes that share a material are welded into one geometry, so a tree made
 * of five shapes costs two draw calls instead of five.
 */
function flattenTemplate(template, layer) {
  template.updateMatrixWorld(true);
  const byMaterial = new Map();
  template.traverse((child) => {
    if (!child.isMesh) return;
    const geometry = (child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone()).applyMatrix4(child.matrixWorld);
    if (!byMaterial.has(child.material)) byMaterial.set(child.material, []);
    byMaterial.get(child.material).push(geometry);
  });

  const parts = [];
  for (const [source, geometries] of byMaterial) {
    const material = layer.sway ? addSway(source, layer.sway) : source;
    const merged = geometries.length > 1 ? mergeGeometries(geometries) : geometries[0];
    // Geometries with mismatched attributes can't be welded; keep them separate.
    for (const geometry of merged ? [merged] : geometries) parts.push({ geometry, material });
  }
  return parts;
}

/** One InstancedMesh per part, holding the given items. */
function buildInstances(parts, layer, items) {
  const group = new THREE.Group();
  const tint = new THREE.Color();

  for (const part of parts) {
    const inst = new THREE.InstancedMesh(part.geometry, part.material, items.length);
    items.forEach((item, i) => {
      inst.setMatrixAt(i, item.matrix);
      if (layer.colorJitter) inst.setColorAt(i, tint.setScalar(item.tint));
    });
    inst.castShadow = !!layer.castShadow;
    inst.receiveShadow = true;
    group.add(inst);
  }
  return group;
}

// Props are grouped into square chunks of land. A chunk is skipped entirely
// when it is off-screen or further away than its layer's drawDistance, which
// is what keeps the frame rate up with tens of thousands of grass tufts.
const chunks = [];

export function createScatter(templates) {
  const group = new THREE.Group();
  const size = CONFIG.render.chunkSize;

  CONFIG.scatter.forEach((layer, index) => {
    const template = templates[layer.asset];
    if (!template) return console.warn(`[scatter] Unknown asset "${layer.asset}"`);
    const parts = flattenTemplate(template, layer); // shared by every chunk of the layer

    const cells = new Map();
    for (const item of placeLayer(layer, index)) {
      const key = Math.floor(item.x / size) + ',' + Math.floor(item.z / size);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(item);
    }

    for (const [key, items] of cells) {
      const [cx, cz] = key.split(',').map(Number);
      const chunk = buildInstances(parts, layer, items);
      chunk.name = `scatter:${layer.asset}`;
      chunk.userData = { x: (cx + 0.5) * size, z: (cz + 0.5) * size, count: items.length, drawDistance: layer.drawDistance ?? Infinity };
      chunks.push(chunk);
      group.add(chunk);
    }
  });
  return group;
}

/** Hides chunks beyond their draw distance. Call once per frame. */
export function updateScatter(cameraPosition) {
  const reach = CONFIG.render.chunkSize * 0.71; // half a chunk's diagonal
  const scale = CONFIG.render.drawDistanceScale;
  for (const chunk of chunks) {
    const d = chunk.userData;
    chunk.visible = Math.hypot(d.x - cameraPosition.x, d.z - cameraPosition.z) - reach < d.drawDistance * scale;
  }
}

export function createLandmarks(templates) {
  const group = new THREE.Group();
  for (const lm of CONFIG.landmarks) {
    const template = templates[lm.asset];
    if (!template) {
      console.warn(`[landmarks] Unknown asset "${lm.asset}"`);
      continue;
    }
    const [x, z] = findDryLand(lm.position[0], lm.position[1]);
    const obj = template.clone();
    obj.position.set(x, heightAt(x, z), z);
    obj.rotation.y = lm.rotation ?? 0;
    obj.scale.setScalar(lm.scale ?? 1);
    obj.traverse((c) => {
      if (c.isMesh) c.castShadow = c.receiveShadow = true;
    });
    group.add(obj);
  }
  return group;
}
