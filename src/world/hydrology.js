// The water system: rivers, lakes, waterfalls and plunge pools.
//
// Nothing is placed by hand. Rain is imagined falling on every island and
// followed downhill on a coarse grid:
//
//   1. Basins are filled up to the point where they would spill over, the
//      "priority flood". Where a basin fills deep enough, it is a lake.
//   2. Every cell then has one way down, and counting how much ground drains
//      through each cell tells us where the streams gather into rivers.
//   3. Rivers are traced from their sources to a lake or the sea. Where one
//      drops sharply (over a cliff) it becomes a waterfall with a pool below.
//   4. The channels are cut into the land (terrain.js asks `carve` for every
//      height), and the water surfaces are built as meshes.
//
// Settings are in CONFIG.rivers. Everything else asks this module two things:
// how high inland water stands at a point (`inlandWaterAt`), and roughly how
// far the nearest river or lake is (`distanceToWater`).

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { baseHeightAt, setCarver, setWaterDistance } from './terrain.js';
import { ISLANDS, islandIndexAt } from './islands.js';
import { cliffNoise, noise2, smoothstep } from './noise.js';
import { applyAtmosphere, NOISE_GLSL } from '../atmosphere.js';

const R = CONFIG.rivers;
const SEA = CONFIG.water.level;
const size = CONFIG.terrain.size;
const half = size / 2;

// What the build produces; read through the functions below.
export const water = {
  rivers: [], // runs of river: { points: [{ x, z, s (surface), hw (half width), depth, gorge, foam }] }
  falls: [], // { x0, z0, s0, x1, z1, s1, hw }
  lakes: [], // { level, cells: [index…], x, z (centre), area }
  pools: [], // plunge pools: { x, z, r, level, depth }
  built: false,
};

// ── Small helpers ──────────────────────────────────────────────────────────
class MinHeap {
  constructor() {
    this.keys = [];
    this.values = [];
  }
  get size() {
    return this.keys.length;
  }
  push(key, value) {
    const { keys, values } = this;
    let i = keys.length;
    keys.push(key);
    values.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= keys[i]) break;
      [keys[parent], keys[i]] = [keys[i], keys[parent]];
      [values[parent], values[i]] = [values[i], values[parent]];
      i = parent;
    }
  }
  pop() {
    const { keys, values } = this;
    const top = values[0];
    const lastK = keys.pop();
    const lastV = values.pop();
    if (keys.length) {
      keys[0] = lastK;
      values[0] = lastV;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < keys.length && keys[l] < keys[m]) m = l;
        if (r < keys.length && keys[r] < keys[m]) m = r;
        if (m === i) break;
        [keys[m], keys[i]] = [keys[i], keys[m]];
        [values[m], values[i]] = [values[i], values[m]];
        i = m;
      }
    }
    return top;
  }
}

function chaikin(points, iterations, keys) {
  // Rounds the corners of a polyline of objects; numeric `keys` are blended too. Ends stay put.
  for (let it = 0; it < iterations; it++) {
    const out = [points[0]];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const q = {};
      const r = {};
      for (const k of keys) {
        q[k] = a[k] * 0.75 + b[k] * 0.25;
        r[k] = a[k] * 0.25 + b[k] * 0.75;
      }
      out.push(q, r);
    }
    out.push(points[points.length - 1]);
    points = out;
  }
  return points;
}

// ── Spatial index of everything that carves or holds water ────────────────
const INDEX_CELL = 16;
const index = new Map(); // cell key → [segment ids]
const segs = []; // { ax, az, bx, bz, sa, sb, hwa, hwb, da, db, gorge, chute }
const indexKey = (cx, cz) => cx * 8192 + cz;
const BANK_MAX = 14;

function addSegment(seg) {
  const id = segs.length;
  segs.push(seg);
  const reach = Math.max(seg.hwa, seg.hwb) + BANK_MAX;
  const x0 = Math.floor((Math.min(seg.ax, seg.bx) - reach) / INDEX_CELL);
  const x1 = Math.floor((Math.max(seg.ax, seg.bx) + reach) / INDEX_CELL);
  const z0 = Math.floor((Math.min(seg.az, seg.bz) - reach) / INDEX_CELL);
  const z1 = Math.floor((Math.max(seg.az, seg.bz) + reach) / INDEX_CELL);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cz = z0; cz <= z1; cz++) {
      const key = indexKey(cx, cz);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(id);
    }
  }
}

/** The nearest river (or plunge pool) to a point, measured from its edge. */
const near = { seg: null, d: 0, t: 0, s: 0, hw: 0, depth: 0, gorge: 0, edge: Infinity, score: Infinity };
function nearestWater(x, z) {
  near.seg = null;
  near.edge = Infinity;
  near.score = Infinity;
  const list = index.get(indexKey(Math.floor(x / INDEX_CELL), Math.floor(z / INDEX_CELL)));
  if (!list) return near;
  for (const id of list) {
    const g = segs[id];
    let t = 0;
    let d;
    if (g.pool) {
      d = Math.hypot(x - g.ax, z - g.az);
    } else {
      const ex = g.bx - g.ax;
      const ez = g.bz - g.az;
      const len2 = ex * ex + ez * ez || 1e-9;
      t = Math.min(1, Math.max(0, ((x - g.ax) * ex + (z - g.az) * ez) / len2));
      d = Math.hypot(x - (g.ax + ex * t), z - (g.az + ez * t));
    }
    const hw = g.hwa + (g.hwb - g.hwa) * t;
    // A plunge pool owns the ground around it (a little past its rim), so the
    // rim stays whole and holds the water in, even where the river leaves.
    const score = g.pool && d < hw * 1.35 ? d - hw - 100 : d - hw;
    if (score < near.score) {
      near.score = score;
      near.edge = d - hw;
      near.seg = g;
      near.d = d;
      near.t = t;
      near.hw = hw;
      near.s = g.sa + (g.sb - g.sa) * t;
      near.depth = g.da + (g.db - g.da) * t;
      near.gorge = g.gorge;
    }
  }
  return near;
}

/** Cuts channels and pools into the land. `h` is the base height at (x, z). */
function carve(x, z, h) {
  const n = nearestWater(x, z);
  if (!n.seg) return h;
  const { d, hw, s, depth } = n;
  if (d < hw) {
    // The channel: a rounded bed below the surface.
    const bed = s - depth * (1 - 0.7 * (d / hw) ** 2);
    return Math.min(h, bed);
  }
  // The banks: from just above the water, easing back into the land. Gorges and
  // waterfall chutes keep their walls steep; elsewhere the higher the land, the
  // wider the valley.
  const edge = s + 0.25;
  const bank = n.seg.chute ? 1.2 : n.gorge > 0.5 ? Math.max(0.8, (h - s) * 0.12) : Math.min(BANK_MAX, Math.max(2.5, (h - s) * 1.3));
  if (d > hw + bank) return h;
  return edge + (h - edge) * smoothstep(hw, hw + bank, d);
}

// ── Lakes, on the coarse grid ───────────────────────────────────────────────
let grid = null; // { N, C, lakeLevel: Float32Array (dilated), wetDistance: Float32Array, riverDistance }

function cellOf(x, z) {
  const i = Math.round((x + half) / grid.C);
  const j = Math.round((z + half) / grid.C);
  if (i < 0 || j < 0 || i >= grid.N || j >= grid.N) return -1;
  return j * grid.N + i;
}

/**
 * The height inland water stands at here — a lake, river or pool — or
 * -Infinity if there is none. (The sea is separate: see the tide in main.js.)
 * Compare with the ground to know whether a point is under water.
 */
export function inlandWaterAt(x, z) {
  if (!water.built) return -Infinity;
  let level = -Infinity;
  const k = cellOf(x, z);
  if (k >= 0) level = grid.lakeLevel[k];
  const n = nearestWater(x, z);
  if (n.seg && !n.seg.chute && n.d < n.hw * 1.12) level = Math.max(level, n.s);
  return level;
}

/** River details at a point, if it lies within a channel: { s, hw, depth, gorge, dirX, dirZ } or null. */
export function riverAt(x, z, margin = 0) {
  if (!water.built) return null;
  const n = nearestWater(x, z);
  if (!n.seg || n.seg.pool || n.seg.chute || n.d > n.hw + margin) return null;
  const g = n.seg;
  const len = Math.hypot(g.bx - g.ax, g.bz - g.az) || 1;
  return { s: n.s, hw: n.hw, depth: n.depth, gorge: n.gorge, dirX: (g.bx - g.ax) / len, dirZ: (g.bz - g.az) / len };
}

/** Roughly how far (metres) the nearest river, lake or pool is. */
export function distanceToWater(x, z) {
  if (!water.built) return Infinity;
  const k = cellOf(x, z);
  return k < 0 ? Infinity : grid.wetDistance[k];
}

/** Roughly how far (metres) the nearest river is, and how big it is there: { distance, size 0..1 }. */
export function nearestRiver(x, z) {
  if (!water.built) return { distance: Infinity, size: 0 };
  const k = cellOf(x, z);
  return k < 0 ? { distance: Infinity, size: 0 } : { distance: grid.riverDistance[k], size: grid.riverSize[k] };
}

// ── The build ───────────────────────────────────────────────────────────────
export function buildHydrology() {
  if (!R.enabled) {
    water.built = true;
    grid = { N: 1, C: size, lakeLevel: new Float32Array([-Infinity]), wetDistance: new Float32Array([Infinity]), riverDistance: new Float32Array([Infinity]), riverSize: new Float32Array(1) };
    return water;
  }
  const C = R.cell;
  const N = Math.floor(size / C) + 1;
  const count = N * N;
  const xOf = (k) => -half + (k % N) * C;
  const zOf = (k) => -half + ((k / N) | 0) * C;

  // 1. The land, and which island each cell belongs to.
  const base = new Float32Array(count);
  const island = new Int8Array(count);
  for (let k = 0; k < count; k++) {
    base[k] = baseHeightAt(xOf(k), zOf(k));
    island[k] = base[k] > SEA ? islandIndexAt(xOf(k), zOf(k)) : -1;
  }

  // 2. Priority flood: spread inland from the sea, always taking the lowest
  //    cell next. Each cell's water level is never below the level of the cell
  //    it was reached from, so basins fill up to their spill point, and each
  //    cell drains toward the one it was reached from.
  const filled = new Float32Array(count);
  const receiver = new Int32Array(count).fill(-1);
  const done = new Uint8Array(count);
  const order = new Int32Array(count);
  let ordered = 0;
  const heap = new MinHeap();
  for (let k = 0; k < count; k++) {
    const i = k % N;
    const j = (k / N) | 0;
    if (base[k] <= SEA || i === 0 || j === 0 || i === N - 1 || j === N - 1) {
      filled[k] = base[k];
      done[k] = 1;
      heap.push(base[k], k);
    }
  }
  const EPS = 0.01;
  while (heap.size) {
    const c = heap.pop();
    order[ordered++] = c;
    const ci = c % N;
    const cj = (c / N) | 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const n = nj * N + ni;
        if (done[n]) continue;
        done[n] = 1;
        filled[n] = Math.max(base[n], filled[c] + EPS * (di && dj ? 1.414 : 1));
        receiver[n] = c;
        heap.push(filled[n], n);
      }
    }
  }

  // 3. How much land drains through each cell.
  const area = new Float32Array(count);
  for (let k = 0; k < count; k++) if (island[k] >= 0) area[k] = C * C;
  for (let o = ordered - 1; o >= 0; o--) {
    const k = order[o];
    if (receiver[k] >= 0) area[receiver[k]] += area[k];
  }

  // 4. Lakes: basins filled deep enough and wide enough.
  const lakeOf = new Int32Array(count).fill(-1);
  {
    const seen = new Uint8Array(count);
    for (let k = 0; k < count; k++) {
      if (seen[k] || island[k] < 0 || filled[k] - base[k] < 0.4) continue;
      const cells = [];
      const stack = [k];
      seen[k] = 1;
      let deepest = 0;
      let level = -Infinity;
      while (stack.length) {
        const c = stack.pop();
        cells.push(c);
        deepest = Math.max(deepest, filled[c] - base[c]);
        level = Math.max(level, filled[c]);
        const ci = c % N;
        const cj = (c / N) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          const n = nj * N + ni;
          if (!seen[n] && island[n] >= 0 && filled[n] - base[n] >= 0.4) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
      if (cells.length * C * C < R.lakeMinArea || deepest < R.lakeMinDepth) continue;
      const id = water.lakes.length;
      let cx = 0;
      let cz = 0;
      for (const c of cells) {
        lakeOf[c] = id;
        cx += xOf(c);
        cz += zOf(c);
      }
      water.lakes.push({ level: level - 0.05, cells, x: cx / cells.length, z: cz / cells.length, area: cells.length * C * C });
    }
  }

  // 5. Rivers: cells draining more than the island's threshold. Small islands
  //    need less, and every island gets at least a stream.
  const threshold = ISLANDS.map((isl) => Math.max(R.minCatchment * (isl.radius / 380) ** 2, 10 * C * C));
  const biggest = ISLANDS.map(() => 0);
  for (let k = 0; k < count; k++) if (island[k] >= 0 && lakeOf[k] < 0) biggest[island[k]] = Math.max(biggest[island[k]], area[k]);
  ISLANDS.forEach((_, i) => {
    if (biggest[i] < threshold[i] && biggest[i] >= 6 * C * C) threshold[i] = biggest[i] * 0.55;
  });
  const isRiver = new Uint8Array(count);
  for (let k = 0; k < count; k++) if (island[k] >= 0 && area[k] >= threshold[island[k]]) isRiver[k] = 1;
  const fedBy = new Uint16Array(count); // upstream river cells
  for (let k = 0; k < count; k++) if (isRiver[k] && receiver[k] >= 0) fedBy[receiver[k]]++;

  const halfWidth = (a) => Math.min(R.maxHalfWidth, R.minHalfWidth + Math.sqrt(a) * R.widthScale);
  const depthFor = (hw) => Math.min(1.4, 0.35 + hw * 0.2);
  const surfaceOf = (k) => (lakeOf[k] >= 0 ? water.lakes[lakeOf[k]].level : island[k] < 0 ? SEA + 0.05 : filled[k] - R.sink);
  const gorgeAt = (x, z) => smoothstep(1 - R.gorges, 1 - R.gorges + 0.08, cliffNoise.noise(x * 0.011 + 7, z * 0.011 - 3) * 0.5 + 0.5);

  // Trace every source down to where it joins a river already traced, a lake or the sea.
  const traced = new Uint8Array(count);
  const heads = [];
  for (let k = 0; k < count; k++) if (isRiver[k] && fedBy[k] === 0) heads.push(k);
  heads.sort((a, b) => filled[b] - filled[a]); // highest sources first
  const chains = [];
  for (const head of heads) {
    const chain = [];
    let k = head;
    for (;;) {
      chain.push(k);
      if (traced[k] || receiver[k] < 0 || island[k] < 0) break; // joined a river, or reached the sea
      traced[k] = 1;
      k = receiver[k];
    }
    if (chain.length >= 3) chains.push(chain);
  }

  // Turn each chain into smooth runs of river, broken at lakes and waterfalls.
  for (const chain of chains) {
    let s = Infinity;
    const raw = chain.map((k) => {
      s = Math.min(s, surfaceOf(k)); // water never flows uphill
      const hw = halfWidth(area[k]);
      return { k, x: xOf(k), z: zOf(k), s, hw, depth: depthFor(hw), lake: lakeOf[k] >= 0, sea: island[k] < 0 };
    });
    // A little meander so rivers don't run in straight grid lines.
    for (let i = 1; i < raw.length - 1; i++) {
      const p = raw[i];
      const dx = raw[i + 1].x - raw[i - 1].x;
      const dz = raw[i + 1].z - raw[i - 1].z;
      const len = Math.hypot(dx, dz) || 1;
      const wobble = noise2(p.x * 0.03, p.z * 0.03) * C * 0.45;
      p.x += (-dz / len) * wobble;
      p.z += (dx / len) * wobble;
    }

    let run = [];
    const finish = () => {
      if (run.length >= 2) {
        let pts = chaikin(run, 3, ['x', 'z', 's', 'hw', 'depth']);
        let floor = Infinity;
        for (const p of pts) {
          floor = Math.min(floor, p.s);
          p.s = floor; // smoothing must not make water climb
          p.gorge = gorgeAt(p.x, p.z);
        }
        water.rivers.push({ points: pts });
      }
      run = [];
    };
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i];
      if (p.lake) {
        // Into a lake: the run ends at its shore and the next starts where the water leaves.
        if (run.length) run.push({ ...p, s: Math.min(run[run.length - 1].s, p.s) });
        finish();
        continue;
      }
      const prev = raw[i - 1];
      if (prev && !prev.lake && prev.s - p.s > R.fallStep) {
        // A sudden drop. Take in any steep steps straight after it, so a tall
        // cliff makes one tall waterfall rather than a staircase of small ones.
        let end = i;
        while (end + 1 < raw.length && !raw[end + 1].lake && raw[end].s - raw[end + 1].s > R.fallStep && !raw[end].sea) end++;
        const bottom = raw[end];
        if (prev.s - bottom.s >= R.fallMin) {
          finish();
          water.falls.push({ x0: prev.x, z0: prev.z, s0: prev.s, x1: bottom.x, z1: bottom.z, s1: bottom.s, hw: (prev.hw + bottom.hw) / 2, sea: bottom.sea });
          if (!bottom.sea) water.pools.push({ x: bottom.x, z: bottom.z, r: Math.max(R.poolRadius, bottom.hw * 1.6), level: bottom.s, depth: R.poolDepth });
          i = end; // carry on from the foot of the fall
          run.push(bottom);
          if (bottom.sea) break;
          continue;
        }
      }
      if (prev && prev.lake && !run.length) run.push({ ...prev, s: Math.max(p.s, prev.s), lake: false });
      run.push(p);
      if (p.sea) break;
    }
    finish();
  }

  // 6. Hand the channels to the terrain.
  for (const river of water.rivers) {
    const pts = river.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      addSegment({ ax: a.x, az: a.z, bx: b.x, bz: b.z, sa: a.s, sb: b.s, hwa: a.hw, hwb: b.hw, da: a.depth, db: b.depth, gorge: (a.gorge + b.gorge) / 2 });
      // Rapids: where the water hurries downhill, it breaks white.
      a.foam = Math.min(1, Math.max(0, (a.s - b.s) / (Math.hypot(b.x - a.x, b.z - a.z) || 1) - 0.04) * 6);
    }
    pts[pts.length - 1].foam = pts[Math.max(0, pts.length - 2)].foam ?? 0;
  }
  for (const f of water.falls) {
    // The rock the water pours over is cut into a narrow chute.
    addSegment({ ax: f.x0, az: f.z0, bx: f.x1, bz: f.z1, sa: f.s0, sb: f.s1, hwa: f.hw, hwb: f.hw, da: 0.4, db: 0.4, gorge: 1, chute: true });
  }
  for (const p of water.pools) {
    addSegment({ pool: true, ax: p.x, az: p.z, bx: p.x, bz: p.z, sa: p.level, sb: p.level, hwa: p.r, hwb: p.r, da: p.depth, db: p.depth, gorge: 0 });
  }
  setCarver(carve);

  // 7. Quick look-ups on the coarse grid: lake levels (one cell wider than the
  //    lake, so the water meets the shore), and distances to water.
  const lakeLevel = new Float32Array(count).fill(-Infinity);
  for (const lake of water.lakes) {
    for (const c of lake.cells) {
      const ci = c % N;
      const cj = (c / N) | 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          const n = nj * N + ni;
          // Reach out to the shore, but not down the outlet, where the land falls away below the lake.
          if (lakeOf[n] >= 0 || base[n] >= lake.level - 0.15) lakeLevel[n] = Math.max(lakeLevel[n], lake.level);
        }
      }
    }
  }
  const wetDistance = new Float32Array(count).fill(Infinity);
  const riverDistance = new Float32Array(count).fill(Infinity);
  const riverSize = new Float32Array(count);
  const spread = (dist, seeds) => {
    // Breadth-first outward from the seeds, in metres.
    let frontier = seeds;
    for (const k of frontier) dist[k] = 0;
    for (let step = 1; frontier.length && step < 40; step++) {
      const next = [];
      for (const c of frontier) {
        const ci = c % N;
        const cj = (c / N) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          const n = nj * N + ni;
          if (dist[n] !== Infinity) continue;
          dist[n] = step * C;
          if (dist === riverDistance) riverSize[n] = riverSize[c];
          next.push(n);
        }
      }
      frontier = next;
    }
  };
  const riverSeeds = [];
  for (const river of water.rivers) {
    for (const p of river.points) {
      const k = Math.round((p.z + half) / C) * N + Math.round((p.x + half) / C);
      if (riverDistance[k] !== 0) riverSeeds.push(k);
      riverDistance[k] = 0;
      riverSize[k] = Math.max(riverSize[k], Math.min(1, p.hw / R.maxHalfWidth));
    }
  }
  const wetSeeds = [...riverSeeds];
  for (const lake of water.lakes) wetSeeds.push(...lake.cells);
  for (const p of water.pools) wetSeeds.push(Math.round((p.z + half) / C) * N + Math.round((p.x + half) / C));
  for (const k of riverSeeds) riverDistance[k] = Infinity;
  spread(riverDistance, riverSeeds);
  spread(wetDistance, wetSeeds);

  grid = { N, C, lakeLevel, wetDistance, riverDistance, riverSize };
  water.built = true;
  setWaterDistance(distanceToWater);
  return water;
}

// ── Rendering ───────────────────────────────────────────────────────────────

/** The material shared by rivers, lakes and pools: clear in the shallows, rippling with the flow. */
function waterMaterial(heightTexture, uniforms) {
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
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aFlow;\nattribute float aFoam;\nvarying vec3 vWet;\nvarying vec2 vFlow;\nvarying float vFoam;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWet = (modelMatrix * vec4(position, 1.0)).xyz;\nvFlow = aFlow;\nvFoam = aFoam;');
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
        vec2 groundUv = vWet.xz / uTerrainSize + 0.5;
        float ground = texture2D(uHeightMap, (groundUv * (uHeightTexels - 1.0) + 0.5) / uHeightTexels).r;
        float depth = vWet.y - ground;
        float shallow = 1.0 - smoothstep(0.0, 1.4, depth);
        diffuseColor.rgb = mix(diffuseColor.rgb, uShallowColor, shallow * 0.75);
        diffuseColor.a *= mix(0.25, 1.0, smoothstep(0.0, 0.9, depth)) * smoothstep(-0.05, 0.03, depth);
        // Foam: a thin line at the water's edge, and white water over rapids, streaming with the flow.
        vec2 along = length(vFlow) > 0.01 ? normalize(vFlow) : vec2(1.0, 0.0);
        vec2 q = vec2(dot(vWet.xz, along), dot(vWet.xz, vec2(-along.y, along.x)));
        float streaks = aNoise(vec2(q.x * 0.5 - uTime * length(vFlow) * 1.4, q.y * 2.2)) * 0.6 + aNoise(vec2(q.x * 1.4 - uTime * length(vFlow) * 2.2, q.y * 5.0)) * 0.4;
        float edgeFoam = (1.0 - smoothstep(0.0, 0.07, depth)) * 0.7;
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

function buildRiverGeometry() {
  const positions = [];
  const flows = [];
  const foams = [];
  const indices = [];
  for (const river of water.rivers) {
    const pts = river.points;
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
      const w = p.hw * 1.12; // a little wider than the channel, so its edges tuck into the banks
      const speed = 0.4 + Math.min(1.6, (p.foam ?? 0) * 2 + p.hw * 0.05);
      for (const side of [-1, 1]) {
        positions.push(p.x - dz * w * side, p.s + 0.02, p.z + dx * w * side);
        flows.push(dx * speed, dz * speed);
        foams.push(p.foam ?? 0);
      }
      if (i < pts.length - 1) {
        const v = base + i * 2;
        indices.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flows, 2));
  geo.setAttribute('aFoam', new THREE.Float32BufferAttribute(foams, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildLakeGeometry() {
  // One flat quad per (dilated) lake cell, plus a disc for each plunge pool.
  const positions = [];
  const C = grid.C;
  const N = grid.N;
  for (let k = 0; k < grid.lakeLevel.length; k++) {
    const level = grid.lakeLevel[k];
    if (level === -Infinity) continue;
    const x = -half + (k % N) * C;
    const z = -half + ((k / N) | 0) * C;
    const h = C / 2 + 0.05;
    const y = level + 0.02;
    positions.push(x - h, y, z - h, x - h, y, z + h, x + h, y, z + h, x - h, y, z - h, x + h, y, z + h, x + h, y, z - h);
  }
  for (const p of water.pools) {
    const r = p.r * 1.15;
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2;
      const a1 = ((i + 1) / 16) * Math.PI * 2;
      positions.push(p.x, p.level + 0.03, p.z, p.x + Math.cos(a1) * r, p.level + 0.03, p.z + Math.sin(a1) * r, p.x + Math.cos(a0) * r, p.level + 0.03, p.z + Math.sin(a0) * r);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  geo.setAttribute('aFoam', new THREE.Float32BufferAttribute(new Float32Array(positions.length / 3), 1));
  geo.computeVertexNormals();
  return geo;
}

function buildFalls(uniforms) {
  // Each waterfall is a curved sheet leaping out from the lip and falling to
  // the pool, streaked with white water that races downward.
  const positions = [];
  const uvs = [];
  const indices = [];
  const ROWS = 10;
  for (const f of water.falls) {
    const dx = f.x1 - f.x0;
    const dz = f.z1 - f.z0;
    const len = Math.hypot(dx, dz) || 1;
    const px = -dz / len;
    const pz = dx / len;
    const drop = f.s0 - f.s1;
    const base = positions.length / 3;
    for (let r = 0; r <= ROWS; r++) {
      const t = r / ROWS;
      const out = Math.sqrt(t); // shoots out, then drops
      const x = f.x0 + dx * out;
      const z = f.z0 + dz * out;
      // Leaping out from the lip, but kept close to the rock it pours down (a
      // little above the uncut cliff, never below the cut channel), so it
      // neither hangs in the air on a sloping cascade nor sinks out of sight.
      const cliff = baseHeightAt(x, z);
      const channel = carve(x, z, cliff);
      const y = Math.max(Math.min(f.s0 + 0.03 - drop * t ** 1.4, cliff + 0.6), channel + 0.3, f.s1 + 0.03);
      const w = f.hw * (1 + t * 0.25);
      positions.push(x - px * w, y, z - pz * w, x + px * w, y, z + pz * w);
      uvs.push(0, t * drop * 0.25, w * 0.6, t * drop * 0.25); // u: metres across (×0.3 per side), v: metres fallen
      if (r < ROWS) {
        const v = base + r * 2;
        indices.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: '#e8f2f4', transparent: true, side: THREE.DoubleSide, roughness: 0.4, depthWrite: false, emissive: '#405058', emissiveIntensity: 0.3 });
  material.onBeforeCompile = (shader) => {
    applyAtmosphere(shader);
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vFallUv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvFallUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nvarying vec2 vFallUv;\n${NOISE_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float fall = aNoise(vec2(vFallUv.x * 9.0, vFallUv.y * 1.2 - uTime * 2.6)) * 0.6 + aNoise(vec2(vFallUv.x * 23.0, vFallUv.y * 2.5 - uTime * 4.1)) * 0.4;
        diffuseColor.a = mix(0.45, 0.95, smoothstep(0.3, 0.75, fall));
        diffuseColor.rgb *= mix(0.82, 1.08, fall);`,
      );
  };
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}

function buildMist(uniforms) {
  // Spray rising and drifting where each waterfall lands.
  const PER = 70;
  const origins = [];
  const seeds = [];
  for (const f of water.falls) {
    const strength = Math.min(1, (f.s0 - f.s1) / 10);
    for (let i = 0; i < PER; i++) {
      origins.push(f.x1, f.s1, f.z1);
      seeds.push(Math.random(), Math.random(), Math.random(), strength * f.hw);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(origins, 3));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 4));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: uniforms.uTime, uColor: { value: new THREE.Color('#ffffff') } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute vec4 aSeed;
      varying float vAlpha;
      void main() {
        float life = fract(uTime * (0.12 + aSeed.x * 0.1) + aSeed.y);
        float a = aSeed.z * 6.2831;
        float spread = (0.4 + life * 2.2) * (0.6 + aSeed.w * 0.5);
        vec3 p = position + vec3(cos(a) * spread, life * (1.0 + aSeed.w * 1.6), sin(a) * spread);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (50.0 + aSeed.w * 30.0) * (0.5 + life) / max(-mv.z, 1.0);
        vAlpha = (1.0 - life) * smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(60.0, 160.0, -mv.z));
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(uColor, smoothstep(0.5, 0.0, d) * vAlpha * 0.16);
      }`,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  return { points, material };
}

/** Builds the meshes for all inland water. Returns { object, update(time, light) }. */
export function createInlandWater(heightTexture) {
  const group = new THREE.Group();
  group.name = 'inland water';
  const uniforms = { uTime: { value: 0 } };
  if (!water.rivers.length && !water.lakes.length) return { object: group, update() {} };
  const material = waterMaterial(heightTexture, uniforms);
  const rivers = new THREE.Mesh(buildRiverGeometry(), material);
  const lakes = new THREE.Mesh(buildLakeGeometry(), material);
  for (const m of [rivers, lakes]) {
    m.frustumCulled = false;
    m.renderOrder = 1;
    m.receiveShadow = true;
    group.add(m);
  }
  if (water.falls.length) group.add(buildFalls(uniforms));
  const mist = water.falls.length ? buildMist(uniforms) : null;
  if (mist) group.add(mist.points);
  return {
    object: group,
    /** @param light the colour of the light on the spray (sky ambient + sun) */
    update(time, light) {
      uniforms.uTime.value = time;
      if (mist && light) mist.material.uniforms.uColor.value.copy(light);
    },
  };
}

// ── Walk surfaces: bridges and stepping stones ──────────────────────────────
// Things you can stand on above the ground. The player asks `walkHeightAt`
// instead of the bare ground height.
const walkSurfaces = [];

/**
 * A bridge deck from (ax, az) to (bx, bz): heights ha and hb at the ends,
 * rising by `arch` in the middle; halfWidth across.
 */
export function addBridgeSurface(bridge) {
  walkSurfaces.push({ kind: 'bridge', ...bridge });
}
/** A flat-topped stone: centre, radius, top height. */
export function addStoneSurface(stone) {
  walkSurfaces.push({ kind: 'stone', ...stone });
}
/** Height of the deck of bridge `b` at fraction t along it. */
export function deckHeight(b, t) {
  return b.ha + (b.hb - b.ha) * t + b.arch * Math.sin(Math.PI * t);
}

/** The height you stand at here: the ground, or a bridge or stone above it. */
export function walkHeightAt(x, z, ground) {
  let h = ground;
  for (const w of walkSurfaces) {
    if (w.kind === 'stone') {
      if (Math.hypot(x - w.x, z - w.z) < w.r) h = Math.max(h, w.top);
      continue;
    }
    const ex = w.bx - w.ax;
    const ez = w.bz - w.az;
    const len2 = ex * ex + ez * ez;
    const t = ((x - w.ax) * ex + (z - w.az) * ez) / len2;
    if (t < 0 || t > 1) continue;
    const across = Math.abs((x - w.ax) * ez - (z - w.az) * ex) / Math.sqrt(len2);
    if (across < w.halfWidth) h = Math.max(h, deckHeight(w, t));
  }
  return h;
}


/**
 * The waterfalls worth walking to: the tallest on each large island (falls into the
 * sea are seen from the sea, so they are left out). Returned in the same shape
 * as landmarks, so paths lead to them and the map names them.
 */
export function waterfallSights() {
  const names = CONFIG.rivers.fallNames;
  const picked = [];
  const perIsland = new Map();
  const falls = water.falls.filter((f) => !f.sea && f.s0 - f.s1 >= CONFIG.rivers.sightMinDrop).sort((a, b) => b.s0 - b.s1 - (a.s0 - a.s1));
  for (const f of falls) {
    const island = islandIndexAt(f.x1, f.z1);
    if (ISLANDS[island].radius < 200) continue; // small islands have their own landmark to visit
    if ((perIsland.get(island) ?? 0) >= CONFIG.rivers.sightsPerIsland) continue;
    perIsland.set(island, (perIsland.get(island) ?? 0) + 1);
    const pool = water.pools.find((p) => p.x === f.x1 && p.z === f.z1);
    picked.push({ asset: null, label: names[picked.length % names.length], x: f.x1, z: f.z1, scale: 1, rotation: 0, radius: (pool?.r ?? 4) + 6, island, waterfall: true });
  }
  return picked;
}
