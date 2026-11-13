// Terrain: a noise-based island. `heightAt(x, z)` is the single source of truth
// for ground height — the mesh, the props and the player all use it.

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { heightNoise, noise2, smoothstep } from './noise.js';
import { biomeWeights, blend, blendColor } from './biomes.js';

export function heightAt(x, z) {
  const c = CONFIG.terrain;
  let n = 0;
  let amp = 1;
  let freq = c.frequency;
  let norm = 0;
  for (let i = 0; i < c.octaves; i++) {
    n += amp * heightNoise.noise(x * freq, z * freq);
    norm += amp;
    amp *= c.persistence;
    freq *= c.lacunarity;
  }
  n /= norm;

  const land = 1 - smoothstep(c.islandRadius * c.islandFalloffStart, c.islandRadius, Math.hypot(x, z));
  // Each biome reshapes the land: flatter, hillier, higher or lower.
  const weights = biomeWeights(x, z);
  const height = c.baseHeight + blend(weights, 'heightOffset', 0) + n * c.amplitude * blend(weights, 'heightScale', 1);
  return land * height - (1 - land) * c.seabedDepth;
}

/** Steepness at a point: 0 = flat, 1 = a 45° slope. */
export function slopeAt(x, z) {
  const dx = heightAt(x + 0.5, z) - heightAt(x - 0.5, z);
  const dz = heightAt(x, z + 0.5) - heightAt(x, z - 0.5);
  return Math.hypot(dx, dz);
}

/** @param pathTexture optional trail mask from trails.js; its red channel tints the ground into footpath */
export function createTerrain(pathTexture = null) {
  const c = CONFIG.terrain;
  const geo = new THREE.PlaneGeometry(c.size, c.size, c.segments, c.segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();

  // Vertex colours from height and steepness.
  const col = Object.fromEntries(Object.entries(c.colors).map(([k, v]) => [k, new THREE.Color(v)]));
  const colors = new Float32Array(pos.count * 3);
  const normal = geo.attributes.normal;
  const out = new THREE.Color();
  const alt = new THREE.Color();
  const water = CONFIG.water.level;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const steep = 1 - normal.getY(i);

    // Ground colour comes from the biomes here, with a little noise variation.
    const weights = biomeWeights(x, z);
    blendColor(weights, 'ground', out);
    out.lerp(blendColor(weights, 'groundAlt', alt), noise2(x * 0.02, z * 0.02) * 0.5 + 0.5);
    out.lerp(col.sand, 1 - smoothstep(water + c.sandHeight * 0.5, water + c.sandHeight * 1.5, y));
    out.lerp(col.seabed, 1 - smoothstep(water - 3, water - 0.3, y));
    const rockSlope = c.rockSlope / blend(weights, 'rockiness', 1); // some biomes (snow) cling to steeper ground
    out.lerp(col.rock, smoothstep(rockSlope * 0.7, rockSlope * 1.3, steep));

    colors[i * 3] = out.r;
    colors[i * 3 + 1] = out.g;
    colors[i * 3 + 2] = out.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: c.flatShading });
  if (pathTexture) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uPathMap = { value: pathTexture };
      shader.uniforms.uPathColor = { value: new THREE.Color(CONFIG.trails.color) };
      shader.uniforms.uPathStrength = { value: CONFIG.trails.strength };
      shader.uniforms.uTerrainSize = { value: c.size };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTerrainSize;\nvarying vec2 vPathUv;\nvarying vec2 vGroundXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundXZ = position.xz;\nvPathUv = position.xz / uTerrainSize + 0.5;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D uPathMap;
          uniform vec3 uPathColor;
          uniform float uPathStrength;
          varying vec2 vPathUv;
          varying vec2 vGroundXZ;
          float pathHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float pathNoise(vec2 p) {
            vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(pathHash(i), pathHash(i + vec2(1.0, 0.0)), f.x), mix(pathHash(i + vec2(0.0, 1.0)), pathHash(i + vec2(1.0, 1.0)), f.x), f.y);
          }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          // Footpaths: a worn, slightly ragged strip of earth over the biome's ground colour.
          float pathWear = texture2D(uPathMap, vPathUv).r;
          float ragged = pathNoise(vGroundXZ * 0.9) * 0.6 + pathNoise(vGroundXZ * 3.1) * 0.4;
          pathWear = smoothstep(0.3, 0.75, pathWear + (ragged - 0.5) * 0.45);
          diffuseColor.rgb = mix(diffuseColor.rgb, uPathColor * (0.85 + ragged * 0.3), pathWear * uPathStrength);`,
        );
    };
  }
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

export function createWater() {
  const w = CONFIG.water;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(20000, 20000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: w.color,
      transparent: true,
      opacity: w.opacity,
      roughness: 0.25,
      metalness: 0.1,
    }),
  );
  mesh.position.y = w.level;
  mesh.name = 'water';
  mesh.userData.baseColor = new THREE.Color(w.color);

  // A seabed stretching to the horizon, so the sea is the same colour beyond the
  // island's own terrain as above it (otherwise the terrain's edge shows through).
  const seabed = new THREE.Mesh(
    new THREE.PlaneGeometry(20000, 20000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: CONFIG.terrain.colors.seabed, roughness: 1 }),
  );
  seabed.position.y = -CONFIG.terrain.seabedDepth - 0.05;
  mesh.add(seabed);
  return mesh;
}

/** True where the player is allowed to stand. */
export function isWalkable(x, z) {
  return heightAt(x, z) > CONFIG.water.level - CONFIG.player.wadeDepth;
}

/** Nearest walkable, dry point to (x, z), searched in an outward spiral. */
export function findDryLand(x, z) {
  for (let r = 0; r < CONFIG.terrain.islandRadius; r += 3) {
    for (let a = 0; a < Math.PI * 2; a += 0.4) {
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (heightAt(px, pz) > CONFIG.water.level + 1) return [px, pz];
    }
  }
  return [x, z];
}

/** Where the player starts: CONFIG.player.spawn moved onto dry land. */
let spawn = null;
export function spawnPoint() {
  return (spawn ??= findDryLand(CONFIG.player.spawn[0], CONFIG.player.spawn[1]));
}

/** 0..1 — how close open water is (1 = at the water's edge). Used for sound. */
export function waterNearness(x, z) {
  for (const radius of [0, 5, 11, 18, 26]) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
      if (heightAt(x + Math.cos(a) * radius, z + Math.sin(a) * radius) < CONFIG.water.level) return 1 - radius / 30;
      if (radius === 0) break;
    }
  }
  return 0;
}
