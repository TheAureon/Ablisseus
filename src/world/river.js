// Rivers placed by hand (CONFIG.rivers): each follows a line of waypoints from
// its source to the sea. Nothing about the water is guessed: the river's level
// is worked out along its course so it only ever runs downhill (where the
// ground dips, the water stays at the lower level and cuts a valley or gorge
// through the next rise), the channel and its valley are carved into the land,
// a flowing water surface is laid along it, and paths cross it on bridges.
//
// A river with `tunnel: true` instead runs in a narrow slot, and wherever the
// land above it is high enough a rock roof closes over the slot: a tunnel
// through the hill, with the hill's own surface on top to walk over.
//
// Call buildRivers() before anything reads ground heights (main.js does).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { applyAtmosphere, NOISE_GLSL } from '../atmosphere.js';
import { groundBeforeRivers, heightAt, setCarver, groundColorAt } from './terrain.js';
import { noise2, smoothstep } from './noise.js';

/** The built rivers: [{ label, points: [{ x, z, s (water level), hw (half width), depth, foam }] }] */
export const rivers = [];

// ── Spatial index of channel segments ──────────────────────────────────────
const CELL = 16;
const index = new Map();
const segs = [];
const key = (cx, cz) => cx * 8192 + cz;
const BANK_MAX = 45;
const LEDGE = 1.6; // dry ledge beside the water inside a tunnel (m)
const SLOT_SPARE = 3; // the slot is cut this much wider than the tunnel, hidden inside its walls
const SHELL = 10; // how far beyond the arch the tunnel's rock roof reaches either side

function addSegment(seg) {
  const id = segs.length;
  segs.push(seg);
  const reach = Math.max(seg.hwa, seg.hwb) * 2 + seg.plain + BANK_MAX;
  for (let cx = Math.floor((Math.min(seg.ax, seg.bx) - reach) / CELL); cx <= Math.floor((Math.max(seg.ax, seg.bx) + reach) / CELL); cx++) {
    for (let cz = Math.floor((Math.min(seg.az, seg.bz) - reach) / CELL); cz <= Math.floor((Math.max(seg.az, seg.bz) + reach) / CELL); cz++) {
      const k = key(cx, cz);
      if (!index.has(k)) index.set(k, []);
      index.get(k).push(id);
    }
  }
}

const near = { seg: null, d: 0, t: 0, s: 0, hw: 0, depth: 0 };
/** The closest stretch of river to (x, z), measured from its edge. */
function nearest(x, z) {
  near.seg = null;
  const list = index.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!list) return near;
  let best = Infinity;
  for (const id of list) {
    const g = segs[id];
    const ex = g.bx - g.ax;
    const ez = g.bz - g.az;
    const t = Math.min(1, Math.max(0, ((x - g.ax) * ex + (z - g.az) * ez) / (ex * ex + ez * ez || 1e-9)));
    const d = Math.hypot(x - (g.ax + ex * t), z - (g.az + ez * t));
    const hw = g.hwa + (g.hwb - g.hwa) * t;
    if (d - hw < best) {
      best = d - hw;
      near.seg = g;
      near.d = d;
      near.t = t;
      near.hw = hw;
      near.s = g.sa + (g.sb - g.sa) * t;
      near.depth = g.depth;
    }
  }
  return near;
}

/** Cuts the channel, and a valley or gorge for it, into the land. `h` is the ground before. */
function carve(x, z, h) {
  const n = nearest(x, z);
  if (!n.seg) return h;
  const { d, hw, s, depth } = n;
  if (d < hw) return Math.min(h, s - depth * (1 - 0.7 * (d / hw) ** 2)); // a rounded bed
  const edge = s + 0.3;
  if (n.seg.tunnel) {
    // A slot with a level ledge either side of the water and sheer walls (roofed over where it's a tunnel).
    const flat = hw + LEDGE + SLOT_SPARE;
    if (h < edge) return Math.max(h, edge - (d - hw) * 0.25);
    return edge + (h - edge) * smoothstep(flat, flat + 2, d);
  }
  if (h >= edge) {
    // A strip of level meadow along the water, then the valley side: the higher
    // the land above the river, the wider the valley it has worn.
    const plain = n.seg.plain + hw * 0.6;
    const bank = Math.min(BANK_MAX, Math.max(3, (h - edge) * n.seg.valley));
    if (d > hw + plain + bank) return h;
    const k = smoothstep(hw + plain, hw + plain + bank, d);
    return edge + 0.25 * smoothstep(hw, hw + plain, d) + (h - edge) * k * k * (2 - k); // (eased, so the valley floor is wide and the sides steepen)
  }
  // Land lower than the water beside the river: low banks keep it in its bed.
  return Math.max(h, edge - (d - hw) * 0.25);
}

/** River details at (x, z) if inside a channel (plus `margin` metres): { s, hw, depth, dirX, dirZ } or null. */
export function riverAt(x, z, margin = 0) {
  const n = nearest(x, z);
  if (!n.seg || n.d > n.hw + margin) return null;
  const g = n.seg;
  const len = Math.hypot(g.bx - g.ax, g.bz - g.az) || 1;
  return { s: n.s, hw: n.hw, depth: n.depth, dirX: (g.bx - g.ax) / len, dirZ: (g.bz - g.az) / len };
}

/** The river's water level at (x, z), or -Infinity if not in a river. */
export function riverWaterAt(x, z) {
  const n = nearest(x, z);
  return n.seg && n.d < n.hw * 1.1 ? n.s : -Infinity;
}

/** How far (metres) the nearest river's edge is, up to about 40 m (Infinity beyond). */
export function distanceToRiver(x, z) {
  const n = nearest(x, z);
  return n.seg ? Math.max(0, n.d - n.hw) : Infinity;
}

// ── Building ────────────────────────────────────────────────────────────────
function chaikin(points, iterations) {
  for (let it = 0; it < iterations; it++) {
    const out = [points[0]];
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, az] = points[i];
      const [bx, bz] = points[i + 1];
      out.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    out.push(points[points.length - 1]);
    points = out;
  }
  return points;
}

export function buildRivers() {
  const sea = CONFIG.water.level;
  for (const def of CONFIG.rivers ?? []) {
    // 1. The course: rounded through the waypoints, then given a natural meander.
    const smooth = chaikin(def.points, 4);
    const course = [];
    for (let i = 0; i < smooth.length - 1; i++) {
      const [ax, az] = smooth[i];
      const [bx, bz] = smooth[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      for (let d = 0; d < len; d += 3) course.push([ax + ((bx - ax) * d) / len, az + ((bz - az) * d) / len]);
    }
    course.push(smooth[smooth.length - 1]);
    let along = 0;
    const pts = course.map(([x, z], i) => {
      const a = course[Math.max(0, i - 1)];
      const b = course[Math.min(course.length - 1, i + 1)];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1;
      if (i) along += Math.hypot(x - course[i - 1][0], z - course[i - 1][1]);
      const wander = noise2(along * 0.012 + 50, 3) * def.meander * smoothstep(0, 40, along); // (none at the source, where a branch may join)
      return { x: x - (dz / len) * wander, z: z + (dx / len) * wander, along };
    });
    const total = along || 1;

    // 2. The water level: never higher than the ground (less `sink`), never rising downstream.
    // (a branch starts at the level of the river it leaves)
    let s = def.branchOf !== undefined ? rivers[def.branchOf].points[0].s : def.maxLevel ?? Infinity;
    for (const p of pts) {
      p.g = groundBeforeRivers(p.x, p.z);
      s = Math.max(sea + 0.05, Math.min(s, p.g - def.sink));
      p.s = s;
    }
    // Ease the level a little so it falls in runs and rapids rather than jerks (still never rising).
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 1; i < pts.length - 1; i++) pts[i].s = Math.min(pts[i - 1].s, (pts[i - 1].s + pts[i].s * 2 + pts[i + 1].s) / 4);
    }

    // 3. Width, depth and white water.
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const t = p.along / total;
      p.hw = (def.halfWidth[0] + (def.halfWidth[1] - def.halfWidth[0]) * t) * (1 + 0.15 * noise2(p.along * 0.03, 9));
      p.depth = def.depth;
      const next = pts[Math.min(pts.length - 1, i + 1)];
      const drop = (p.s - next.s) / (Math.hypot(next.x - p.x, next.z - p.z) || 1);
      p.foam = Math.min(1, Math.max(0, drop - 0.04) * 6);
    }
    // Roofed over wherever the land stands well above the water.
    for (const p of pts) p.roof = !!def.tunnel && p.g > p.s + 6;
    const spring = def.spring ?? 0;
    rivers.push({ label: def.label, points: pts, spring: spring ? { x: pts[0].x, z: pts[0].z, s: pts[0].s, r: spring } : null });
    // The spring it rises from: a round pool (a segment of no length is a disc).
    if (spring) addSegment({ ax: pts[0].x, az: pts[0].z, bx: pts[0].x, bz: pts[0].z, sa: pts[0].s, sb: pts[0].s, hwa: spring, hwb: spring, depth: def.depth * 1.3, valley: def.valley, plain: def.plain ?? 4 });

    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      addSegment({ ax: a.x, az: a.z, bx: b.x, bz: b.z, sa: a.s, sb: b.s, hwa: a.hw, hwb: b.hw, depth: a.depth, valley: def.valley, plain: def.plain ?? 4, tunnel: !!def.tunnel, roof: a.roof && b.roof ? archOf(a) : null });
    }
  }
  setCarver(carve);
  return rivers;
}

// ── Tunnels ─────────────────────────────────────────────────────────────────
/** The tunnel's arch at river point p: half-width and height above the ledge. */
function archOf(p) {
  return { half: p.hw + LEDGE, rise: Math.min(p.g - p.s - 2.6, 3.2 + p.hw * 0.5) };
}
/** Height of the hill's surface over a tunnel (sinking just under the real ground at the roof's edges, so the seam is hidden). */
function roofTopAt(x, z, d, half) {
  return groundBeforeRivers(x, z) - 0.35 * smoothstep(half + SLOT_SPARE + 3, half + SHELL, d);
}
/** If (x, z) is under a tunnel roof: { d, half, rise, floor, top } (floor = the ledge's height), else null. */
export function tunnelAt(x, z) {
  const n = nearest(x, z);
  const roof = n.seg?.roof;
  if (!roof || n.d > roof.half + SHELL) return null;
  return { d: n.d, half: roof.half, rise: roof.rise, floor: n.s + 0.3 };
}
/** Ground for drawing the map: the hill over a tunnel, not the channel through it. */
export function surfaceAt(x, z) {
  const t = tunnelAt(x, z);
  return t ? Math.max(heightAt(x, z), roofTopAt(x, z, t.d, t.half)) : heightAt(x, z);
}
/** True where someone at height `feet` can't go: the rock either side of a tunnel's arch. */
export function tunnelBlocks(x, z, feet) {
  const t = tunnelAt(x, z);
  return !!t && t.d > t.half - 0.35 && feet < roofTopAt(x, z, t.d, t.half) - 1.5;
}

/** The rock shell of every tunnel: the arch inside, the hill's surface on top, and the portal faces. */
export function createTunnels() {
  const group = new THREE.Group();
  group.name = 'tunnels';
  const positions = [];
  const colors = [];
  const indices = [];
  const color = new THREE.Color();
  const rock = new THREE.Color(CONFIG.terrain.colors.rock);
  const ARCH = 14;
  for (const river of rivers) {
    const pts = river.points;
    let i = 0;
    while (i < pts.length) {
      if (!pts[i].roof) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < pts.length && pts[j + 1].roof) j++;
      if (j > i) buildRun(pts.slice(i, j + 1));
      i = j + 1;
    }
  }
  function buildRun(run) {
    // One cross-section per river point: a closed outline (sides and top of the shell, then the arch).
    const rings = [];
    run.forEach((p, k) => {
      const a = run[Math.max(0, k - 1)];
      const b = run[Math.min(run.length - 1, k + 1)];
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const nx = -(b.z - a.z) / len; // across the river
      const nz = (b.x - a.x) / len;
      const { half, rise } = archOf(p);
      const floor = p.s + 0.3;
      const base = floor - 0.5;
      const W = half + SHELL;
      const outline = []; // [u, y, isTop]
      outline.push([-W, base, 0]);
      for (let q = 0; q <= 14; q++) {
        const u = -W + (2 * W * q) / 14; // (the same number of points on every section, so they join up)
        outline.push([u, roofTopAt(p.x + nx * u, p.z + nz * u, Math.abs(u), half), 1]);
      }
      outline.push([W, base, 0]);
      outline.push([half, base, 0]);
      for (let q = 0; q <= ARCH; q++) {
        const th = (q / ARCH) * Math.PI;
        outline.push([half * Math.cos(th), floor + rise * Math.sin(th) ** 0.8, 0]);
      }
      outline.push([-half, base, 0]);
      const start = positions.length / 3;
      for (const [u, y, top] of outline) {
        const x = p.x + nx * u;
        const z = p.z + nz * u;
        positions.push(x, y, z);
        if (top) groundColorAt(x, z, y, 0.15, color);
        else color.copy(rock).multiplyScalar(0.75 + 0.25 * noise2(x * 0.3, y * 0.3 + z * 0.3));
        colors.push(color.r, color.g, color.b);
      }
      rings.push({ start, outline });
    });
    // Skin between neighbouring sections (wound so the outside faces out).
    const count = rings[0].outline.length;
    for (let k = 0; k < rings.length - 1; k++) {
      const a = rings[k].start;
      const b = rings[k + 1].start;
      for (let v = 0; v < count; v++) {
        const w = (v + 1) % count;
        indices.push(a + v, a + w, b + v, a + w, b + w, b + v);
      }
    }
    // Portal faces at both ends.
    for (const [ring, flip] of [[rings[0], true], [rings[rings.length - 1], false]]) {
      const contour = ring.outline.map(([u, y]) => new THREE.Vector2(u, y));
      for (const [p0, p1, p2] of THREE.ShapeUtils.triangulateShape(contour, [])) {
        if (flip) indices.push(ring.start + p0, ring.start + p1, ring.start + p2);
        else indices.push(ring.start + p0, ring.start + p2, ring.start + p1);
      }
    }
  }
  if (!indices.length) return group;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, side: THREE.DoubleSide });
  material.defines = { ATMO_RIM_SCALE: CONFIG.terrain.surface.rim.toFixed(3) };
  material.onBeforeCompile = (shader) => applyAtmosphere(shader);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

// ── Walking surfaces: bridges ───────────────────────────────────────────────
const bridges = [];
/** Height of bridge b's deck at fraction t along it. */
export function deckHeight(b, t) {
  return b.ha + (b.hb - b.ha) * t + b.arch * Math.sin(Math.PI * t);
}
/** The height you stand at here: the ground, or a bridge deck above it. */
export function walkHeightAt(x, z, ground, feet = Infinity) {
  let h = ground;
  // Over a tunnel: on the hill above it, unless you're down inside.
  const t = tunnelAt(x, z);
  if (t) {
    const inside = t.d < t.half ? t.floor + t.rise * Math.sqrt(1 - (t.d / t.half) ** 2) * 0.8 : -Infinity;
    if (feet > inside || t.d >= t.half) h = Math.max(h, roofTopAt(x, z, t.d, t.half));
  }
  for (const b of bridges) {
    const ex = b.bx - b.ax;
    const ez = b.bz - b.az;
    const len2 = ex * ex + ez * ez;
    const t = ((x - b.ax) * ex + (z - b.az) * ez) / len2;
    if (t < 0 || t > 1) continue;
    if (Math.abs((x - b.ax) * ez - (z - b.az) * ex) / Math.sqrt(len2) < b.halfWidth) h = Math.max(h, deckHeight(b, t));
  }
  return h;
}

/** Finds where the finished paths cross a river and puts a footbridge there. */
export function findBridges(routes) {
  for (const route of routes) {
    const samples = [];
    for (let i = 0; i < route.length - 1; i++) {
      const [ax, az] = route[i];
      const [bx, bz] = route[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      for (let d = 0; d < len; d += 0.5) samples.push([ax + ((bx - ax) * d) / len, az + ((bz - az) * d) / len]);
    }
    let start = -1;
    for (let i = 0; i <= samples.length; i++) {
      const inside = i < samples.length && riverAt(samples[i][0], samples[i][1]) !== null;
      if (inside && start < 0) start = i;
      if (!inside && start >= 0) {
        const mid = samples[(start + i - 1) >> 1];
        const river = riverAt(mid[0], mid[1]);
        if (river && !tunnelAt(mid[0], mid[1]) && !bridges.some((b) => Math.hypot((b.ax + b.bx) / 2 - mid[0], (b.az + b.bz) / 2 - mid[1]) < 10)) {
          // Straight across the current, from bank to bank.
          const dx = -river.dirZ;
          const dz = river.dirX;
          const reach = river.hw + 2.5;
          const b = { ax: mid[0] - dx * reach, az: mid[1] - dz * reach, bx: mid[0] + dx * reach, bz: mid[1] + dz * reach, halfWidth: 0.95 };
          b.ha = heightAt(b.ax, b.az);
          b.hb = heightAt(b.bx, b.bz);
          b.arch = Math.max(0.3, river.s + 0.7 - (b.ha + b.hb) / 2);
          bridges.push(b);
        }
        start = -1;
      }
    }
  }
  return bridges;
}

/** Wooden footbridges: plank deck on two beams, with posts and handrails. */
export function createBridges(bridges) {
  const group = new THREE.Group();
  if (!bridges.length) return group;
  const pieces = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const box = (w, h, d, x, y, z, yaw, pitch) => {
    const g = new THREE.BoxGeometry(w, h, d);
    e.set(pitch, yaw, 0);
    g.applyMatrix4(m.compose(v.set(x, y, z), q.setFromEuler(e), one));
    pieces.push(g);
  };

  for (const b of bridges) {
    const dx = b.bx - b.ax;
    const dz = b.bz - b.az;
    const len = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const at = (t) => [b.ax + dx * t, deckHeight(b, t), b.az + dz * t];
    const slope = (t) => Math.atan2(deckHeight(b, Math.min(1, t + 0.01)) - deckHeight(b, Math.max(0, t - 0.01)), len * 0.02);
    // Planks across the deck.
    const planks = Math.ceil(len / 0.3);
    for (let i = 0; i < planks; i++) {
      const t = (i + 0.5) / planks;
      const [x, y, z] = at(t);
      box(b.halfWidth * 2, 0.07, 0.27, x, y - 0.035, z, yaw, -slope(t));
    }
    // Beams beneath, and posts and rails along both sides.
    const posts = Math.max(2, Math.round(len / 1.6) + 1);
    for (const side of [-1, 1]) {
      const ox = (dz / len) * side;
      const oz = (-dx / len) * side;
      for (let i = 0; i < posts - 1; i++) {
        const t0 = i / (posts - 1);
        const t1 = (i + 1) / (posts - 1);
        const [x0, y0, z0] = at(t0);
        const [x1, y1, z1] = at(t1);
        const segLen = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
        const pitch = -Math.atan2(y1 - y0, Math.hypot(x1 - x0, z1 - z0));
        const w = b.halfWidth - 0.15;
        box(0.12, 0.16, segLen, (x0 + x1) / 2 + ox * w, (y0 + y1) / 2 - 0.15, (z0 + z1) / 2 + oz * w, yaw, pitch); // beam
        box(0.07, 0.07, segLen, (x0 + x1) / 2 + ox * (b.halfWidth - 0.04), (y0 + y1) / 2 + 0.9, (z0 + z1) / 2 + oz * (b.halfWidth - 0.04), yaw, pitch); // rail
      }
      for (let i = 0; i < posts; i++) {
        const [x, y, z] = at(i / (posts - 1));
        box(0.1, 1.0, 0.1, x + ox * (b.halfWidth - 0.04), y + 0.45, z + oz * (b.halfWidth - 0.04), yaw, 0);
      }
    }
  }
  const mesh = new THREE.Mesh(mergeGeometries(pieces), new THREE.MeshStandardMaterial({ color: '#7a5a3e', roughness: 0.9, flatShading: true }));
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = 'bridges';
  group.add(mesh);
  return group;
}


// ── The water ───────────────────────────────────────────────────────────────
/** The material for the river: clear in the shallows, rippling and foaming with the flow. */
function waterMaterial(heightTexture, uniforms, R) {
  const w = CONFIG.water;
  const material = new THREE.MeshStandardMaterial({ color: R.color, transparent: true, opacity: 0.88, roughness: 0.12, metalness: 0.1, depthWrite: false });
  material.onBeforeCompile = (shader) => {
    applyAtmosphere(shader);
    Object.assign(shader.uniforms, uniforms, {
      uHeightMap: { value: heightTexture },
      uTerrainSize: { value: CONFIG.terrain.size },
      uHeightTexels: { value: heightTexture.image.width },
      uShallowColor: { value: new THREE.Color(R.shallowColor) },
      uReflection: { value: w.reflection * 0.8 },
      uDepth: { value: R.depth },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aFlow;\nattribute float aFoam;\nattribute float aAcross;\nvarying float vAcross;\nvarying vec3 vWet;\nvarying vec2 vFlow;\nvarying float vFoam;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWet = (modelMatrix * vec4(position, 1.0)).xyz;\nvFlow = aFlow;\nvFoam = aFoam;\nvAcross = aAcross;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform sampler2D uHeightMap;
        uniform float uTerrainSize;
        uniform float uHeightTexels;
        uniform vec3 uShallowColor;
        uniform vec3 uSkyColor;
        uniform float uReflection;
        varying vec3 vWet;
        varying vec2 vFlow;
        varying float vFoam;
        varying float vAcross;
        uniform float uDepth;
        float wetFoam = 0.0;
        ${NOISE_GLSL}
        // Ripples carried along by the current (vFlow is its direction × speed).
        float flowRipples(vec2 p) {
          vec2 drift = vFlow * uTime;
          return aNoise(p * 0.9 - drift * 0.9) * 0.6 + aNoise(p * 2.3 - drift * 1.6 + 9.0) * 0.4;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Depth from the channel's own shape (deepest mid-stream), which is finer than the height map.
        float a = abs(vAcross) * 1.15;
        float depth = uDepth * (1.0 - 0.7 * a * a) - 0.3 * smoothstep(0.9, 1.15, a);
        float shallow = 1.0 - smoothstep(0.0, 1.4, depth);
        diffuseColor.rgb = mix(diffuseColor.rgb, uShallowColor, shallow * 0.75);
        diffuseColor.a *= mix(0.25, 1.0, smoothstep(0.0, 0.9, depth)) * smoothstep(-0.05, 0.03, depth);
        // Foam: a thin line at the water's edge, and white water over rapids, streaming with the flow.
        vec2 along = length(vFlow) > 0.01 ? normalize(vFlow) : vec2(1.0, 0.0);
        vec2 q = vec2(dot(vWet.xz, along), dot(vWet.xz, vec2(-along.y, along.x)));
        float streaks = aNoise(vec2(q.x * 0.5 - uTime * length(vFlow) * 1.4, q.y * 2.2)) * 0.6 + aNoise(vec2(q.x * 1.4 - uTime * length(vFlow) * 2.2, q.y * 5.0)) * 0.4;
        float edgeFoam = (1.0 - smoothstep(-0.1, 0.25, depth)) * smoothstep(0.35, 0.7, aNoise(vWet.xz * 0.6 + vec2(uTime * 0.05, 0.0))) * 0.35;
        float rapids = smoothstep(0.45, 0.75, streaks) * vFoam;
        wetFoam = clamp(edgeFoam + rapids, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95), wetFoam);
        diffuseColor.a = max(diffuseColor.a, wetFoam * 0.9);`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        float fade = 1.0 - smoothstep(30.0, 300.0, length(vViewPosition));
        float r0 = flowRipples(vWet.xz);
        float rx = flowRipples(vWet.xz + vec2(0.3, 0.0));
        float rz = flowRipples(vWet.xz + vec2(0.0, 0.3));
        vec3 rippled = normalize(vec3(-(rx - r0) / 0.3 * 0.35 * fade, 1.0, -(rz - r0) / 0.3 * 0.35 * fade));
        normal = normalize((viewMatrix * vec4(rippled, 0.0)).xyz);`,
      )
      .replace(
        '#include <opaque_fragment>',
        `float glance = pow(1.0 - max(dot(normal, normalize(vViewPosition)), 0.0), 4.0) * uReflection * (1.0 - wetFoam);
        outgoingLight = mix(outgoingLight, uSkyColor, glance);
        diffuseColor.a = max(diffuseColor.a, glance);
        #include <opaque_fragment>`,
      );
  };
  return material;
}


/** The flowing water surface along every river. Returns { object, update(time) }. */
export function createRiverWater(heightTexture) {
  const group = new THREE.Group();
  group.name = 'rivers';
  const uniforms = { uTime: { value: 0 } };
  if (!rivers.length) return { object: group, update() {} };
  const positions = [];
  const flows = [];
  const foams = [];
  const across = [];
  const indices = [];
  for (const river of rivers) {
    // Once it is down to sea level the sea itself fills the channel, so the river's own surface stops there.
    const atSea = river.points.findIndex((p) => p.s <= CONFIG.water.level + 0.1);
    const pts = atSea > 1 ? river.points.slice(0, atSea + 1) : river.points;
    const base = positions.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const w = p.hw * 1.15; // a little wider than the channel, tucking under the banks
      const speed = 0.5 + Math.min(1.6, p.foam * 2 + p.hw * 0.05);
      for (const side of [-1, 1]) {
        positions.push(p.x - dz * w * side, p.s + 0.02, p.z + dx * w * side);
        flows.push(dx * speed, dz * speed);
        foams.push(p.foam);
        across.push(side);
      }
      if (i < pts.length - 1) {
        const v = base + i * 2;
        indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); // (wound to face up)
      }
    }
  }
  // Spring pools: a disc of water, deepest in the middle.
  for (const river of rivers) {
    const sp = river.spring;
    if (!sp) continue;
    const base = positions.length / 3;
    positions.push(sp.x, sp.s + 0.02, sp.z);
    flows.push(0, 0);
    foams.push(0);
    across.push(0);
    const n = 24;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      positions.push(sp.x + Math.cos(a) * sp.r * 1.15, sp.s + 0.02, sp.z + Math.sin(a) * sp.r * 1.15);
      flows.push(0, 0);
      foams.push(0);
      across.push(1);
      if (k < n) indices.push(base, base + 2 + k, base + 1 + k);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flows, 2));
  geo.setAttribute('aFoam', new THREE.Float32BufferAttribute(foams, 1));
  geo.setAttribute('aAcross', new THREE.Float32BufferAttribute(across, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, waterMaterial(heightTexture, uniforms, { ...CONFIG.riverLook, depth: CONFIG.rivers[0]?.depth ?? 1.3 }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.receiveShadow = true;
  group.add(mesh);
  return { object: group, update: (time) => (uniforms.uTime.value = time) };
}
