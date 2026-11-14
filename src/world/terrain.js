// Terrain: a noise-based island. `heightAt(x, z)` is the single source of truth
// for ground height — the mesh, the props and the player all use it.

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { heightNoise, noise2, smoothstep } from './noise.js';
import { biomeWeights, blend, blendColor } from './biomes.js';

/** The natural, unmodified ground height. */
function naturalHeightAt(x, z) {
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
  const raw = land * height - (1 - land) * c.seabedDepth;

  // Beaches: ease the slope either side of the waterline so the shore is a
  // broad, gentle strand instead of a narrow bank.
  const above = raw - CONFIG.water.level;
  const b = c.beach;
  return CONFIG.water.level + above * (b.flatten + (1 - b.flatten) * smoothstep(0, b.height, Math.abs(above)));
}

// Pads: discs of levelled ground under camps and landmarks, so nothing sits
// half-buried on a hillside. Each blends smoothly back into the natural slope.
const pads = [];

/** Levels the ground around (x, z). Must be called before the terrain mesh is built. */
export function addPad(x, z, radius, blendWidth = 10, height = naturalHeightAt(x, z)) {
  pads.push({ x, z, radius, blendWidth, height });
}

// Rock shelves: flat slabs of stone at the waterline that hold the tide pools.
const shelves = [];

/** A level stone shelf at the given height. Call before the terrain mesh is built. */
export function addRockShelf(x, z, radius, height) {
  shelves.push({ x, z, radius });
  addPad(x, z, radius, radius * 0.9, height);
}

// Road beds: the ground under a path is cut level across its width, like a
// real hillside track, and eased back into the slope either side. Samples are
// kept in a coarse grid so looking one up costs almost nothing.
const ROAD_CELL = 8;
const roadCells = new Map();
let roadWidth = 0;
let roadReach = 0;
const roadKey = (cx, cz) => cx * 8192 + cz;

/**
 * Cuts a level bed along a path. Must be called before the terrain mesh is built.
 * @param samples [[x, z, height]] every couple of metres along the path
 * @param width half-width of the level part   @param blendWidth distance over which it eases back into the hillside
 */
export function addRoadBed(samples, width, blendWidth) {
  roadWidth = width;
  roadReach = width + blendWidth;
  for (const [x, z, h] of samples) {
    const sample = { x, z, h };
    for (let cx = Math.floor((x - roadReach) / ROAD_CELL); cx <= Math.floor((x + roadReach) / ROAD_CELL); cx++) {
      for (let cz = Math.floor((z - roadReach) / ROAD_CELL); cz <= Math.floor((z + roadReach) / ROAD_CELL); cz++) {
        const key = roadKey(cx, cz);
        if (!roadCells.has(key)) roadCells.set(key, []);
        roadCells.get(key).push(sample);
      }
    }
  }
}

export { naturalHeightAt };

/** Ground height — the single source of truth for the mesh, props and player. */
export function heightAt(x, z) {
  let height = naturalHeightAt(x, z);

  // Level clearings first, then path beds on top, so a path keeps its own grade right up to a clearing.
  for (const pad of pads) {
    const d = Math.hypot(x - pad.x, z - pad.z);
    if (d < pad.radius + pad.blendWidth) height = pad.height + (height - pad.height) * smoothstep(pad.radius, pad.radius + pad.blendWidth, d);
  }

  const nearby = roadCells.size ? roadCells.get(roadKey(Math.floor(x / ROAD_CELL), Math.floor(z / ROAD_CELL))) : null;
  if (nearby) {
    let strongest = 0;
    let weightSum = 0;
    let heightSum = 0;
    for (const s of nearby) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d >= roadReach) continue;
      const k = 1 - smoothstep(roadWidth, roadReach, d);
      strongest = Math.max(strongest, k);
      weightSum += k * k;
      heightSum += k * k * s.h;
    }
    if (strongest > 0) height += (heightSum / weightSum - height) * strongest;
  }
  return height;
}

/** Steepness at a point: 0 = flat, 1 = a 45° slope. */
export function slopeAt(x, z) {
  const dx = heightAt(x + 0.5, z) - heightAt(x - 0.5, z);
  const dz = heightAt(x, z + 0.5) - heightAt(x, z - 0.5);
  return Math.hypot(dx, dz);
}

/** Values the terrain shader reads every frame (main.js keeps the sea level current with the tide). */
export const terrainUniforms = { uSeaLevel: { value: CONFIG.water.level } };

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
    for (const shelf of shelves) {
      const d = Math.hypot(x - shelf.x, z - shelf.z);
      if (d < shelf.radius * 1.6) out.lerp(col.shelf, 1 - smoothstep(shelf.radius * 0.9, shelf.radius * 1.6, d));
    }

    colors[i * 3] = out.r;
    colors[i * 3 + 1] = out.g;
    colors[i * 3 + 2] = out.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: c.flatShading });
  // Without trails there is still a (blank) mask, so the shader is the same either way.
  const pathMap = pathTexture ?? new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  pathMap.needsUpdate = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPathMap = { value: pathMap };
    shader.uniforms.uPathColor = { value: new THREE.Color(CONFIG.trails.color) };
    shader.uniforms.uPathStrength = { value: CONFIG.trails.strength };
    shader.uniforms.uTerrainSize = { value: c.size };
    shader.uniforms.uSeaLevel = terrainUniforms.uSeaLevel;
    shader.uniforms.uWetReach = { value: c.beach.wetReach };
    shader.uniforms.uBeachTop = { value: CONFIG.water.level + c.sandHeight * 1.5 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTerrainSize;\nvarying vec2 vPathUv;\nvarying vec3 vGround;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = position;\nvPathUv = position.xz / uTerrainSize + 0.5;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uPathMap;
        uniform vec3 uPathColor;
        uniform float uPathStrength;
        uniform float uSeaLevel;
        uniform float uWetReach;
        uniform float uBeachTop;
        varying vec2 vPathUv;
        varying vec3 vGround;
        float groundWet = 0.0;
        float pathHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float pathNoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(pathHash(i), pathHash(i + vec2(1.0, 0.0)), f.x), mix(pathHash(i + vec2(0.0, 1.0)), pathHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 vGroundXZ = vGround.xz;
        // Footpaths: a worn, slightly ragged strip of earth over the biome's ground colour.
        float pathWear = texture2D(uPathMap, vPathUv).r;
        float ragged = pathNoise(vGroundXZ * 0.9) * 0.6 + pathNoise(vGroundXZ * 3.1) * 0.4;
        pathWear = smoothstep(0.3, 0.75, pathWear + (ragged - 0.5) * 0.45);
        diffuseColor.rgb = mix(diffuseColor.rgb, uPathColor * (0.85 + ragged * 0.3), pathWear * uPathStrength);

        // Beaches: fine speckle and faint ripple lines in the sand, and a dark
        // wet band that follows the tide up and down the shore.
        float beach = 1.0 - smoothstep(uBeachTop - 0.4, uBeachTop + 0.3, vGround.y);
        float grains = pathNoise(vGroundXZ * 9.0) * 0.6 + pathNoise(vGroundXZ * 23.0) * 0.4;
        float ripples = sin((vGround.y - uSeaLevel) * 26.0 + pathNoise(vGroundXZ * 0.7) * 5.0);
        diffuseColor.rgb *= 1.0 + beach * ((grains - 0.5) * 0.14 + ripples * 0.025);
        groundWet = 1.0 - smoothstep(uSeaLevel + uWetReach * 0.35, uSeaLevel + uWetReach + (ragged - 0.5) * 0.12, vGround.y);
        diffuseColor.rgb *= mix(1.0, 0.68, groundWet);`,
      )
      // Wet ground is glossy.
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.28, groundWet);');
  };
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

/**
 * A picture of the ground height over the whole terrain, for shaders that need
 * to know how deep the water is at a point. Build it after all paths and
 * clearings have been cut.
 */
export function createHeightTexture() {
  // One sample per terrain vertex, so the picture matches the drawn ground
  // exactly and the waterline in the shader lands where the mesh really is.
  const size = CONFIG.terrain.size;
  const cells = CONFIG.terrain.segments;
  const resolution = cells + 1;
  const grid = new Float32Array(resolution * resolution);
  const data = new Uint16Array(resolution * resolution);
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const k = j * resolution + i;
      grid[k] = heightAt((i / cells - 0.5) * size, (j / cells - 0.5) * size);
      data[k] = THREE.DataUtils.toHalfFloat(grid[k]);
    }
  }
  heightGrid = { grid, resolution };
  const texture = new THREE.DataTexture(data, resolution, resolution, THREE.RedFormat, THREE.HalfFloatType);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

let heightGrid = null;

/**
 * A quick, slightly blurred ground height read from the grid above (exact
 * heightAt() until that exists). Good for cheaply ruling places out when
 * scattering tens of thousands of props; use heightAt() for the final answer.
 */
export function approxHeightAt(x, z) {
  if (!heightGrid) return heightAt(x, z);
  const { grid, resolution } = heightGrid;
  const size = CONFIG.terrain.size;
  const fx = (x / size + 0.5) * (resolution - 1);
  const fz = (z / size + 0.5) * (resolution - 1);
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= resolution - 1 || j >= resolution - 1) return -CONFIG.terrain.seabedDepth;
  const tx = fx - i;
  const tz = fz - j;
  const k = j * resolution + i;
  return (grid[k] * (1 - tx) + grid[k + 1] * tx) * (1 - tz) + (grid[k + resolution] * (1 - tx) + grid[k + resolution + 1] * tx) * tz;
}

/** Quick steepness from the same grid (see approxHeightAt). */
export function approxSlopeAt(x, z) {
  return Math.hypot(approxHeightAt(x + 1, z) - approxHeightAt(x - 1, z), approxHeightAt(x, z + 1) - approxHeightAt(x, z - 1)) / 2;
}

/**
 * The sea (and the lakes — it is one sheet of water).
 *   - a slow swell moves the surface, so water really runs up and down beaches
 *   - smaller ripples catch the light
 *   - shallows are clear and pale; foam laces the edge and rolls in in sets
 * Its `userData.uniforms` are updated from main.js every frame.
 */
export function createWater(heightTexture) {
  const w = CONFIG.water;

  // One sheet centred on the camera: finely divided nearby, where the swell is
  // visible, and stretched out to the horizon beyond.
  const segments = 170;
  const geo = new THREE.PlaneGeometry(2, 2, segments, segments).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const ring = Math.max(Math.abs(x), Math.abs(z)); // 0 at the centre … 1 at the rim
    const reach = (150 * ring + 9850 * ring ** 4) / (ring || 1);
    pos.setXYZ(i, x * reach, 0, z * reach);
  }

  const uniforms = {
    uTime: { value: 0 },
    uHeightMap: { value: heightTexture },
    uTerrainSize: { value: CONFIG.terrain.size },
    uHeightTexels: { value: CONFIG.terrain.segments + 1 },
    uSeabed: { value: -CONFIG.terrain.seabedDepth },
    uWaveHeight: { value: w.waves.height },
    uWaveLength: { value: w.waves.length },
    uWaveSpeed: { value: w.waves.speed },
    uRipple: { value: w.waves.ripple },
    uShallowColor: { value: new THREE.Color(w.shallowColor) },
    uShallowDepth: { value: w.shallowDepth },
    uFoam: { value: w.foam },
  };

  const material = new THREE.MeshStandardMaterial({ color: w.color, transparent: true, opacity: w.opacity, roughness: 0.16, metalness: 0.1 });
  const waveFunction = /* glsl */ `
    uniform float uTime;
    uniform float uWaveLength;
    uniform float uWaveSpeed;
    // The swell: three trains of waves crossing at different angles and sizes.
    float swell(vec2 p) {
      float k = 6.2831 / uWaveLength;
      float t = uTime * uWaveSpeed;
      return sin(dot(p, vec2(0.80, 0.60)) * k + t * 1.00) * 0.50
           + sin(dot(p, vec2(-0.45, 0.89)) * k * 1.7 + t * 1.31) * 0.30
           + sin(dot(p, vec2(0.95, -0.31)) * k * 2.9 + t * 1.83) * 0.20;
    }`;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${waveFunction}\nuniform float uWaveHeight;\nvarying vec3 vWater;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 waterWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        // Only the nearby sea is fine enough to move; further out it stays level.
        float near = 1.0 - smoothstep(140.0, 420.0, distance(waterWorld.xz, cameraPosition.xz));
        transformed.y += swell(waterWorld.xz) * uWaveHeight * near;
        vWater = vec3(waterWorld.x, waterWorld.y + transformed.y, waterWorld.z);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        ${waveFunction}
        uniform sampler2D uHeightMap;
        uniform float uTerrainSize;
        uniform float uHeightTexels;
        uniform float uSeabed;
        uniform float uRipple;
        uniform vec3 uShallowColor;
        uniform float uShallowDepth;
        uniform float uFoam;
        varying vec3 vWater;
        float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float wNoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        // Surface detail used for lighting: the swell plus two layers of drifting ripples.
        float surface(vec2 p) {
          return swell(p) * 0.35
               + (wNoise(p * 0.55 + vec2(uTime * 0.35, uTime * 0.21)) + wNoise(p * 1.7 - vec2(uTime * 0.5, uTime * 0.28)) * 0.5) * 0.4;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // How deep is the water here?
        vec2 groundUv = vWater.xz / uTerrainSize + 0.5;
        float inside = step(0.0, groundUv.x) * step(groundUv.x, 1.0) * step(0.0, groundUv.y) * step(groundUv.y, 1.0);
        // (texel centres sit on the terrain's vertices)
        float ground = mix(uSeabed, texture2D(uHeightMap, (groundUv * (uHeightTexels - 1.0) + 0.5) / uHeightTexels).r, inside);
        float depth = vWater.y - ground;

        // Shallows: pale and clear enough to see the sand through.
        float shallow = 1.0 - smoothstep(0.0, uShallowDepth, depth);
        diffuseColor.rgb = mix(diffuseColor.rgb, uShallowColor, shallow * 0.8);
        diffuseColor.a = mix(0.12, diffuseColor.a, smoothstep(0.0, uShallowDepth * 0.7, depth)) * smoothstep(-0.08, 0.0, depth);

        // Foam: a broken lace right at the edge, and soft lines rolling in over the shallows.
        float lace = wNoise(vWater.xz * 1.6 + uTime * 0.25) * 0.6 + wNoise(vWater.xz * 4.3 - uTime * 0.4) * 0.4;
        float edge = 1.0 - smoothstep(0.0, 0.03 + lace * 0.1, depth);
        float sets = sin(depth * 6.5 + uTime * 1.3 + wNoise(vWater.xz * 0.12) * 6.0);
        float rollers = smoothstep(0.82, 1.0, sets) * smoothstep(0.03, 0.18, depth) * (1.0 - smoothstep(0.5, 1.5, depth)) * smoothstep(0.35, 0.7, lace);
        float foam = clamp(edge * 0.9 + rollers * 0.75, 0.0, 1.0) * uFoam * smoothstep(-0.08, -0.02, depth);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), foam);
        diffuseColor.a = max(diffuseColor.a, foam * 0.92);`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        // Light the surface as if it were rippled, fading the detail out with distance.
        float rippleFade = uRipple * (1.0 - smoothstep(60.0, 700.0, distance(vWater.xz, cameraPosition.xz)));
        float s0 = surface(vWater.xz);
        float sx = surface(vWater.xz + vec2(0.4, 0.0));
        float sz = surface(vWater.xz + vec2(0.0, 0.4));
        vec3 rippled = normalize(vec3(-(sx - s0) / 0.4 * rippleFade, 1.0, -(sz - s0) / 0.4 * rippleFade));
        normal = normalize((viewMatrix * vec4(rippled, 0.0)).xyz);`,
      );
  };

  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = w.level;
  mesh.name = 'water';
  mesh.frustumCulled = false;
  mesh.userData.baseColor = new THREE.Color(w.color);
  mesh.userData.uniforms = uniforms;

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

/**
 * Where the player starts: the nearest spot to CONFIG.player.spawn that is
 * level, comfortably above the water and not right on a shore.
 */
let spawn = null;
export function spawnPoint() {
  if (spawn) return spawn;
  const [sx, sz] = CONFIG.player.spawn;
  const water = CONFIG.water.level;
  for (let r = 0; r < CONFIG.terrain.islandRadius; r += 4) {
    for (let a = 0; a < Math.PI * 2; a += r ? Math.min(0.5, 6 / r) : 7) {
      const x = sx + Math.cos(a) * r;
      const z = sz + Math.sin(a) * r;
      if (heightAt(x, z) < water + 2.5 || slopeAt(x, z) > 0.12) continue;
      let open = true;
      for (let b = 0; b < Math.PI * 2 && open; b += Math.PI / 4) {
        const h = heightAt(x + Math.cos(b) * 16, z + Math.sin(b) * 16);
        if (h < water + 1.2 || Math.abs(h - heightAt(x, z)) > 4) open = false;
      }
      if (open) return (spawn = [x, z]);
    }
  }
  return (spawn = findDryLand(sx, sz));
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
