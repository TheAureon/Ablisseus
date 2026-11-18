// Scatters instanced props over the terrain (CONFIG.scatter). Works the same for placeholders and
// loaded models: every mesh inside an asset becomes one InstancedMesh.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { applyAtmosphere } from '../atmosphere.js';
import { heightAt, approxHeightAt, approxSlopeAt } from './terrain.js';
import { noise2, seededRandom, smoothstep } from './noise.js';
import { approxBiomeWeight, biomeIndex } from './biomes.js';
import { randomIslandPoint } from './islands.js';
import { inlandWaterAt } from './hydrology.js';

function addSway(material, amount, height, thin) {
  const m = material.clone();
  m.onBeforeCompile = (shader) => {
    applyAtmosphere(shader);
    shader.uniforms.uSway = { value: amount };
    shader.uniforms.uWindSpeed = { value: CONFIG.wind.speed };
    shader.uniforms.uWindDir = { value: new THREE.Vector2(...CONFIG.wind.direction).normalize() };
    shader.uniforms.uGustLength = { value: CONFIG.wind.gustLength };
    shader.uniforms.uPlantHeight = { value: Math.max(height, 0.05) };
    shader.uniforms.uThin = { value: thin ? 1 : 0 };
    shader.uniforms.uFieldVariation = { value: CONFIG.wind.fieldVariation };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uSway;\nuniform float uWindSpeed;\nuniform vec2 uWindDir;\nuniform float uGustLength;\nuniform float uPlantHeight;\nvarying float vPlantHeight;\nvarying vec2 vField;\nfloat fieldHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat fieldNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(fieldHash(i), fieldHash(i + vec2(1.0, 0.0)), f.x), mix(fieldHash(i + vec2(0.0, 1.0)), fieldHash(i + vec2(1.0, 1.0)), f.x), f.y); }')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vPlantHeight = clamp(position.y / uPlantHeight, 0.0, 1.0);
        #ifdef USE_INSTANCING
          vec2 plantAt = instanceMatrix[3].xz;
          // Broad patches across a field: some sun-dried, some lush (x), some lighter or darker (y).
          vField = vec2(fieldNoise(plantAt * 0.021), fieldNoise(plantAt * 0.053 + 19.0));
          // The wind's direction, seen from this (randomly turned) plant's own point of view.
          vec3 windLocal = transpose(mat3(instanceMatrix)) * vec3(uWindDir.x, 0.0, uWindDir.y);
          windLocal /= max(dot(windLocal, windLocal), 1e-5);
          float plantScale = length(instanceMatrix[0].xyz);
        #else
          vec2 plantAt = vec2(0.0);
          vField = vec2(0.5);
          vec3 windLocal = vec3(uWindDir.x, 0.0, uWindDir.y);
          float plantScale = 1.0;
        #endif
        // Gusts roll across the land as broad waves, with a quicker flutter on top.
        float along = dot(plantAt, uWindDir);
        float across = dot(plantAt, vec2(-uWindDir.y, uWindDir.x));
        float t = uTime * uWindSpeed;
        float gust = sin(along * 6.2831 / uGustLength - t * 0.9 + sin(across * 0.05) * 2.0) * 0.5 + 0.5;
        gust = gust * gust;
        float flutter = sin(t * 3.3 + along * 1.1 + across * 0.7) * 0.22;
        float lean = (0.25 + gust * 0.9 + flutter) * uSway;
        float reach = max(transformed.y, 0.0);
        transformed += windLocal * lean * reach * plantScale;
        transformed.y -= lean * lean * reach * 0.35;   // a bent stem is a little shorter`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunDir;\nuniform vec3 uSunColor;\nuniform float uThin;\nuniform float uFieldVariation;\nvarying float vPlantHeight;\nvarying vec2 vField;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Darker where the plant meets the ground, brighter at the tips.
        diffuseColor.rgb *= mix(0.72, 1.08, smoothstep(0.0, 0.85, vPlantHeight));
        vec3 fieldTint = mix(vec3(1.07, 1.02, 0.8), vec3(0.86, 1.0, 0.95), smoothstep(0.25, 0.75, vField.x));
        diffuseColor.rgb *= mix(vec3(1.0), fieldTint * (0.9 + 0.2 * vField.y), uFieldVariation);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        // Thin leaves glow when the sun is behind them.
        vec3 sunView = (viewMatrix * vec4(uSunDir, 0.0)).xyz;
        float backlit = pow(max(dot(normalize(-vViewPosition), sunView), 0.0), 3.0);
        totalEmissiveRadiance += diffuseColor.rgb * uSunColor * backlit * vPlantHeight * uThin * 3.2;`,
      );
  };
  m.customProgramCacheKey = () => 'sway2';
  return m;
}

/** Picks instance transforms for one scatter layer. */
function placeLayer(layer, index, trails) {
  const rand = seededRandom(CONFIG.seed * 31 + index * 977 + 5);
  const [minH, maxH] = layer.height ?? [-Infinity, Infinity];
  const [minS, maxS] = layer.scale ?? [1, 1];
  const items = []; // { matrix, tint, x, z }
  const dummy = new THREE.Object3D();
  const biome = layer.biome ? biomeIndex(layer.biome) : -1;
  if (layer.biome && biome < 0) console.warn(`[scatter] Unknown biome "${layer.biome}"`);

  for (let tries = 0; items.length < layer.count && tries < layer.count * 120; tries++) {
    const [x, z] = randomIslandPoint(rand);

    // Stay inside the layer's biome, thinning out toward its borders.
    if (biome >= 0 && rand() > smoothstep(0.3, 0.65, approxBiomeWeight(x, z, biome))) continue;
    // Cheapest tests first: most candidates fail on height or slope, and those
    // are read from a prebuilt grid rather than worked out from scratch.
    const rough = approxHeightAt(x, z);
    if (rough < minH - 0.15 || rough > maxH + 0.15) continue;
    if (approxSlopeAt(x, z) > (layer.maxSlope ?? 1)) continue;

    if (layer.cluster) {
      const n = noise2(x * layer.cluster.scale + index * 50, z * layer.cluster.scale);
      if (layer.cluster.invert ? n > layer.cluster.threshold : n < layer.cluster.threshold) continue;
    }

    // Keep trails, camps and landmarks clear: nothing on the path itself, and
    // nothing tall close beside it.
    if (trails && (layer.castShadow ? trails.clearanceAt(x, z) : trails.pathAt(x, z)) > 0.25) continue;

    const y = heightAt(x, z); // the exact height, for the few that survive
    if (y < minH || y > maxH) continue;
    // Nothing grows in rivers or lakes (reeds and the like may stand in the shallows).
    if (inlandWaterAt(x, z) > y - (layer.wade ?? -0.05)) continue;

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
export function flattenTemplate(template, layer = {}) {
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
    const merged = geometries.length > 1 ? mergeGeometries(geometries) : geometries[0];
    let material = source;
    if (layer.sway) {
      (merged ?? geometries[0]).computeBoundingBox();
      // Small plants that don't cast shadows (grass, flowers) are treated as thin and let light through.
      material = addSway(source, layer.sway, (merged ?? geometries[0]).boundingBox.max.y, !layer.castShadow);
    }
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

/**
 * Where the trees stand: { x, z, r } with r the radius of the canopy. Filled
 * in by createScatter; the terrain darkens the ground beneath them.
 */
export const canopies = [];

export function createScatter(templates, trails) {
  const group = new THREE.Group();
  const size = CONFIG.render.chunkSize;

  CONFIG.scatter.forEach((layer, index) => {
    const template = templates[layer.asset];
    if (!template) return console.warn(`[scatter] Unknown asset "${layer.asset}"`);
    const parts = flattenTemplate(template, layer); // shared by every chunk of the layer

    // Tall shadow-casting props (trees) leave shade on the ground beneath them.
    const box = new THREE.Box3().setFromObject(template);
    const canopy = layer.castShadow && box.max.y > 2.5 ? Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5 : 0;

    const cells = new Map();
    for (const item of placeLayer(layer, index, trails)) {
      if (canopy) canopies.push({ x: item.x, z: item.z, r: canopy * Math.hypot(item.matrix.elements[0], item.matrix.elements[1], item.matrix.elements[2]) });
      const key = Math.floor(item.x / size) + ',' + Math.floor(item.z / size);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(item);
    }

    for (const [key, items] of cells) {
      const [cx, cz] = key.split(',').map(Number);
      const chunk = buildInstances(parts, layer, items);
      chunk.name = `scatter:${layer.asset}`;
      chunk.userData = { x: (cx + 0.5) * size, z: (cz + 0.5) * size, count: items.length, drawDistance: layer.drawDistance ?? CONFIG.render.farDrawDistance };
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

/**
 * Instances hand-placed props (trail furniture) through the same chunked,
 * culled path as the scatter layers.
 * @param placements [{ x, z, rotation, scale, y?, scaleY? }] — y snaps to the ground unless given
 */
export function createPlacedProps(template, name, placements, options = {}) {
  const group = new THREE.Group();
  const size = CONFIG.render.chunkSize;
  const layer = { castShadow: options.castShadow ?? true };
  const parts = flattenTemplate(template, layer);
  const dummy = new THREE.Object3D();

  const cells = new Map();
  for (const p of placements) {
    dummy.position.set(p.x, p.y ?? heightAt(p.x, p.z), p.z);
    dummy.rotation.set(0, p.rotation ?? 0, 0);
    dummy.scale.setScalar(p.scale ?? 1);
    if (p.scaleY) dummy.scale.y = p.scaleY; // (stepping stones: as tall as the water is deep)
    dummy.updateMatrix();
    const key = Math.floor(p.x / size) + ',' + Math.floor(p.z / size);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push({ matrix: dummy.matrix.clone(), tint: 1 });
  }
  for (const [key, items] of cells) {
    const [cx, cz] = key.split(',').map(Number);
    const chunk = buildInstances(parts, layer, items);
    chunk.name = `prop:${name}`;
    chunk.userData = { x: (cx + 0.5) * size, z: (cz + 0.5) * size, count: items.length, drawDistance: options.drawDistance ?? Infinity };
    chunks.push(chunk);
    group.add(chunk);
  }
  return group;
}
