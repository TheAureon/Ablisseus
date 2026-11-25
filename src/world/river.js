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
import { groundBeforeRivers, heightAt, setCarver, groundColorAt, terrainMaterial, setGroundTint, setLocalWater } from './terrain.js';
import { noise2, smoothstep, seededRandom } from './noise.js';

/** The built rivers: [{ label, points: [{ x, z, s (water level), hw (half width), depth, foam }] }] */
export const rivers = [];

// ── Spatial index of channel segments ──────────────────────────────────────
const CELL = 16;
const index = new Map();
const segs = [];
const key = (cx, cz) => cx * 8192 + cz;
const BANK_MAX = 45;
const MESH_CELL = CONFIG.terrain.size / CONFIG.terrain.segments; // spacing of the ground mesh's points
const LEDGE = 1.6; // dry ledge beside the water inside a tunnel (m)
/** How big the river's bob is, as a share of the sea's swell (the player rides the same). */
export const RIVER_SWELL = 0.5;
/** Where a river's water stands this far above the sea or less, the sea is shown (the river fading out into it). */
const SEA_SHOWS = CONFIG.water.tide.range / 2 + 0.25;
const SLOT_SPARE = 3; // the slot is cut this much wider than the tunnel, hidden inside its walls
const SHELL = 8; // how far beyond the arch the tunnel's rock roof reaches either side

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

const near = { seg: null, d: 0, t: 0, s: 0, hw: 0, depth: 0, side: 1 };
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
      near.side = Math.sign(ex * (z - g.az) - ez * (x - g.ax)) || 1; // which bank: +1 on the left looking from a to b
      near.t = t;
      near.hw = hw;
      near.s = g.sa + (g.sb - g.sa) * t;
      near.depth = g.depth;
    }
  }
  return near;
}

/** Low banks that keep a river in its bed where the land beside it is lower than the water (none once it's down at the sea). */
function levee(h, edge, out, level) {
  const keep = smoothstep(CONFIG.water.level + 0.3, CONFIG.water.level + 1.2, level);
  const top = edge - Math.max(0, out - MESH_CELL * 1.6) * 0.25; // level for a mesh cell or so, then sloping away
  return Math.max(h, h + (top - h) * keep);
}

/** Cuts the channel, and a valley or gorge for it, into the land. `h` is the ground before. */
function carve(x, z, h) {
  const n = nearest(x, z);
  if (!n.seg) return h;
  const { d, s, depth } = n;
  const hw = Math.max(n.hw, MESH_CELL * 1.1); // (never narrower than the ground mesh can show)
  if (d < hw) {
    // A rounded bed. (It may go below sea level: the sea is hidden inside river channels, see seaMask.)
    return Math.min(h, s - depth * (1 - 0.7 * (d / hw) ** 2));
  }
  const edge = s + 0.3;
  if (n.seg.tunnel) {
    // A slot with a level ledge either side of the water and sheer walls (roofed over where it's a tunnel).
    const flat = hw + LEDGE + SLOT_SPARE;
    if (h < edge) return levee(h, edge, d - hw, s);
    return edge + (h - edge) * smoothstep(flat, flat + 2, d);
  }
  if (h >= edge) {
    // Banks as a river wears them: on the outside of a bend the current cuts a
    // steep bank; on the inside it drops gravel in a low, shelving bar. Along
    // straighter runs, something in between, never quite the same twice.
    const inside = smoothstep(-0.02, 0.1, n.seg.bend * n.side); // 1 on the inside of a bend, 0 outside
    const vary = noise2(x * 0.045 + 31, z * 0.045 - 17); // slow changes along the banks
    const rough = noise2(x * 0.21, z * 0.21) * 0.9 + noise2(x * 0.55 + 4, z * 0.55) * 0.35; // ragged edges
    const bar = Math.max(0.4, hw * (0.15 + 1.1 * inside) * (1 + 0.5 * vary) + n.seg.plain * 0.3 * inside);
    const dd = d + rough * (0.5 + 0.8 * inside); // (so the bank line wanders)
    const shore = edge + 0.55 * smoothstep(hw, hw + bar, dd) + 0.25 * (1 - inside) * smoothstep(hw, hw + 0.8, dd);
    if (h <= shore) return h;
    const bank = Math.min(BANK_MAX, Math.max(MESH_CELL, (h - shore) * n.seg.valley * (0.5 + 0.9 * inside) * (1 + 0.35 * vary)));
    if (dd > hw + bar + bank) return h;
    const k = smoothstep(hw + bar, hw + bar + bank, dd);
    const cut = (1 - inside) * smoothstep(2.5, 4, hw); // (a cut bank rises steeply straight from the water; not on a stream too narrow to show it)
    const shape = k + (Math.sqrt(k) - k) * cut;
    return shore + (h - shore) * shape;
  }
  // Land lower than the water beside the river: low banks keep it in its bed.
  return levee(h, edge, d - hw, s);
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
    // (a tunnel runs fairly straight: little wander before the tunnel's far waypoint)
    const [sx, sz] = def.points[def.tunnel ? def.tunnel[1] : 0];
    const straightTo = def.tunnel ? course.reduce((b, c, i) => (Math.hypot(c[0] - sx, c[1] - sz) < Math.hypot(course[b][0] - sx, course[b][1] - sz) ? i : b), 0) : -1;
    let along = 0;
    let straightAlong = 0;
    const pts = course.map(([x, z], i) => {
      const a = course[Math.max(0, i - 1)];
      const b = course[Math.min(course.length - 1, i + 1)];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1;
      if (i) along += Math.hypot(x - course[i - 1][0], z - course[i - 1][1]);
      if (i === straightTo) straightAlong = along;
      // Loops of every size, like a real river's: a long slow swing with smaller wiggles on it.
      const swing = noise2(along * 0.009 + 50, 3) + 0.35 * noise2(along * 0.021 + 11, 7);
      const settle = i <= straightTo ? 0.15 : smoothstep(0, 40, along - straightAlong);
      const wander = swing * def.meander * settle * smoothstep(0, 40, along); // (none right at the first end)
      return { x: x - (dz / len) * wander, z: z + (dx / len) * wander, along };
    });
    const closest = ([x, z]) => pts.reduce((best, p, i) => (Math.hypot(p.x - x, p.z - z) < Math.hypot(pts[best].x - x, pts[best].z - z) ? i : best), 0);

    // 2. Where it rises: the waypoint `source` (by default the first). From there the water runs
    //    away in both directions, never rising and never above the ground (less `sink`).
    const top = closest(def.points[def.source ?? 0]);
    const env = new Array(pts.length);
    for (const p of pts) p.g = groundBeforeRivers(p.x, p.z);
    env[top] = Math.max(sea + 0.05, Math.min(def.maxLevel ?? Infinity, pts[top].g - def.sink));
    for (let i = top + 1; i < pts.length; i++) env[i] = Math.max(sea + 0.05, Math.min(env[i - 1], pts[i].g - def.sink));
    for (let i = top - 1; i >= 0; i--) env[i] = Math.max(sea + 0.05, Math.min(env[i + 1], pts[i].g - def.sink));
    // Then even it out so it falls in smooth runs, never in steps: the lowest level nearby,
    // averaged (which keeps it under the ground and still only falling away from the source).
    let K = 8;
    const window = (arr, i, f) => {
      const out = [];
      for (let k = Math.max(0, i - K); k <= Math.min(arr.length - 1, i + K); k++) out.push(arr[k]);
      return f(out);
    };
    // (each side of the source on its own, so the source stays the highest point)
    const ease = (side) => {
      const lows = side.map((_, i) => window(side, i, (v) => Math.min(...v)));
      return side.map((_, i) => window(lows, i, (v) => v.reduce((a, b) => a + b, 0) / v.length));
    };
    const [backK, downK] = Array.isArray(def.smoothing) ? def.smoothing : [def.smoothing ?? 8, def.smoothing ?? 8];
    K = downK;
    const down = ease(env.slice(top)); // source → last waypoint
    K = backK;
    const back = ease(env.slice(0, top + 1).reverse()); // source → first waypoint
    K = 8;
    const peak = Math.min(down[0], back[0]); // (both sides start level with each other: no step at the source)
    pts.forEach((p, i) => (p.s = Math.min(peak, i > top ? down[i - top] : i < top ? back[top - i] : peak)));

    // 3. Width (narrow at the source, widening downstream), depth, which way it flows, and white water.
    const span = Math.max(pts[top].along, pts[pts.length - 1].along - pts[top].along) || 1;
    const drops = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const t = Math.abs(p.along - pts[top].along) / span;
      // Never the same width for long: pools and narrows.
      p.hw = (def.halfWidth[0] + (def.halfWidth[1] - def.halfWidth[0]) * t) * Math.max(0.8, 1 + 0.3 * noise2(p.along * 0.017, 9) + 0.08 * noise2(p.along * 0.045, 29));
      p.depth = def.depth;
      // A spring with no pool seeps out as a trickle and only widens as it goes.
      const fromSource = Math.abs(p.along - pts[top].along);
      p.head = def.spring ? 1 : smoothstep(0, 30, fromSource);
      p.hw *= 0.45 + 0.55 * p.head;
      p.flow = i < top ? -1 : 1; // +1: toward the last waypoint, -1: toward the first
      const q = pts[Math.min(pts.length - 1, Math.max(0, i + p.flow))];
      drops.push(Math.max(0, p.s - q.s) / (Math.hypot(q.x - p.x, q.z - p.z) || 1));
    }
    // How sharply it bends here (signed: which side is the outside), for the shape of its banks.
    const turn = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 3)];
      const c = pts[Math.min(pts.length - 1, i + 3)];
      const ux = p.x - a.x, uz = p.z - a.z, vx = c.x - p.x, vz = c.z - p.z;
      const lu = Math.hypot(ux, uz) || 1, lv = Math.hypot(vx, vz) || 1;
      return ((ux * vz - uz * vx) / (lu * lv)) * p.flow; // (in the downstream direction of travel… then made side-fixed below)
    });
    pts.forEach((p, i) => (p.bend = window(turn, i, (v) => v.reduce((a, b) => a + b, 0) / v.length) * p.flow));
    pts.forEach((p, i) => (p.foam = Math.min(1, Math.max(0, window(drops, i, (v) => v.reduce((a, b) => a + b, 0) / v.length) - 0.1) * 5)));

    // A tunnel along part of it (`tunnel: [from, to]` waypoints): roofed over wherever the land stands well above the water.
    const [ta, tb] = def.tunnel ? [closest(def.points[def.tunnel[0]]), closest(def.points[def.tunnel[1]])].sort((a, b) => a - b) : [-1, -1];
    pts.forEach((p, i) => {
      p.tunnel = i >= ta && i <= tb;
      p.roof = p.tunnel && p.g > p.s + 6;
    });
    const spring = def.spring ?? 0;
    const src = pts[top];
    rivers.push({ label: def.label, points: pts, source: top, spring: spring ? { x: src.x, z: src.z, s: src.s, r: spring } : null });
    // The spring it rises from: a round pool (a segment of no length is a disc).
    if (spring) addSegment({ ax: src.x, az: src.z, bx: src.x, bz: src.z, sa: src.s, sb: src.s, hwa: spring, hwb: spring, depth: def.depth * 1.3, valley: def.valley, plain: def.plain ?? 4 });

    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const tunnel = a.tunnel && b.tunnel;
      addSegment({ ax: a.x, az: a.z, bx: b.x, bz: b.z, sa: a.s, sb: b.s, hwa: a.hw, hwb: b.hw, depth: a.depth, valley: def.valley, plain: tunnel ? 0 : def.plain ?? 4, bend: (a.bend + b.bend) / 2, tunnel, roof: a.roof && b.roof ? archOf(a) : null });
    }
  }
  setCarver(carve);
  setGroundTint(tintBanks);
  setLocalWater((x, z) => {
    const n = nearest(x, z);
    return n.seg && n.d < n.hw + MESH_CELL * 1.5 ? n.s : -100;
  });
  return rivers;
}

// ── Banks: colour and boulders ──────────────────────────────────────────────
const WET = new THREE.Color('#5d5649'); // damp earth at the water's edge
const GRAVEL = new THREE.Color('#8d8576'); // a gravel bar
const BED = new THREE.Color('#6f6656'); // the riverbed, seen through the water
const tintColor = new THREE.Color();
function tintBanks(x, z, y, out) {
  const n = nearest(x, z);
  if (!n.seg || n.seg.roof) return;
  const { d, hw, s } = n;
  if (d < hw) {
    out.lerp(BED, 0.75);
    return;
  }
  const inside = smoothstep(-0.02, 0.1, n.seg.bend * n.side);
  const reach = 1.2 + hw * (0.2 + 1.1 * inside);
  const k = 1 - smoothstep(hw, hw + reach, d + noise2(x * 0.3, z * 0.3) * 0.8);
  if (k <= 0 || y > s + 2.5) return;
  tintColor.copy(WET).lerp(GRAVEL, inside * smoothstep(0.3, 0.6, noise2(x * 0.5 + 9, z * 0.5) * 0.5 + 0.5));
  out.lerp(tintColor, k * 0.85);
}

/** Boulders: scattered through the rapids, half out of the water, and strewn along the banks. */
export function riverRocks(avoid = []) {
  const rand = seededRandom(7177);
  const rocks = [];
  for (const river of rivers) {
    const pts = river.points;
    // A spring wells up among a heap of boulders.
    if (!river.spring) {
      const src = pts[river.source];
      const next = pts[Math.min(pts.length - 1, river.source + 2)];
      const back = Math.atan2(src.z - next.z, src.x - next.x); // (uphill, away from where it runs)
      for (let k = 0; k < 9; k++) {
        const a = back + (rand() - 0.5) * 2.6;
        const r = 1.5 + rand() * 3.5;
        const x = src.x + Math.cos(a) * r;
        const z = src.z + Math.sin(a) * r;
        const scale = 0.6 + rand() * 1.3;
        rocks.push({ x, z, y: heightAt(x, z) - 0.25 * scale, scale, rotation: rand() * 6.28, tilt: (rand() - 0.5) * 0.6 });
      }
    }
    for (let i = 2; i < pts.length - 2; i += 2) {
      const p = pts[i];
      if (p.tunnel || p.s <= CONFIG.water.level + 0.3) continue;
      const q = pts[i + 1];
      const len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
      const nx = -(q.z - p.z) / len;
      const nz = (q.x - p.x) / len;
      const near = (x, z) => avoid.some((b) => Math.hypot(x - b.x, z - b.z) < 7);
      // In the stream: mostly where it runs fast.
      if (rand() < 0.04 + p.foam * 0.5) {
        const u = (rand() * 2 - 1) * p.hw * 0.85;
        const x = p.x + nx * u;
        const z = p.z + nz * u;
        const scale = 0.7 + rand() * (1 + p.foam);
        if (!near(x, z)) rocks.push({ x, z, y: p.s - 0.35 * scale, scale, rotation: rand() * 6.28, tilt: (rand() - 0.5) * 0.5 });
      }
      // On the banks: in ones and twos at the water's edge.
      for (const side of [-1, 1]) {
        if (rand() > 0.22) continue;
        const u = side * (p.hw * (0.85 + rand() * 0.4) + rand() * 1.5);
        const x = p.x + nx * u;
        const z = p.z + nz * u;
        const scale = 0.35 + rand() * 0.8;
        if (!near(x, z)) rocks.push({ x, z, y: Math.max(heightAt(x, z), p.s - 0.6 * scale) - 0.15 * scale, scale, rotation: rand() * 6.28, tilt: (rand() - 0.5) * 0.6 });
      }
    }
  }
  return rocks;
}

/**
 * Where the sea's surface must not be drawn: inside river channels above sea level, whose beds
 * dip below it (or the flat sea would show through the river). One value per ground-mesh point.
 */
export function createSeaMask() {
  const cells = CONFIG.terrain.segments;
  const res = cells + 1;
  const size = CONFIG.terrain.size;
  const raw = new Uint8Array(res * res);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const n = nearest((i / cells - 0.5) * size, (j / cells - 0.5) * size);
      if (n.seg && n.s > CONFIG.water.level + SEA_SHOWS && n.d < n.hw + MESH_CELL * 2.5) raw[j * res + i] = 255;
    }
  }
  const data = raw;
  const texture = new THREE.DataTexture(data, res, res, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
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

/**
 * The rock over every tunnel, drawn with the ground's own material so it
 * matches the hill: the hill's surface on top, the arch inside, and a rock
 * face round each end of the tunnel.
 */
export function createTunnels() {
  const group = new THREE.Group();
  group.name = 'tunnels';
  const parts = [];
  const color = new THREE.Color();
  const rock = new THREE.Color(CONFIG.terrain.colors.rock);
  const ARCH = 16; // points round the arch
  const ACROSS = 24; // points across the hill's surface
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
    // Each section across the tunnel, as [u (across), y] outlines.
    const sections = run.map((p, k) => {
      const a = run[Math.max(0, k - 1)];
      const b = run[Math.min(run.length - 1, k + 1)];
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const nx = -(b.z - a.z) / len; // across the river
      const nz = (b.x - a.x) / len;
      const { half, rise } = archOf(p);
      const floor = p.s + 0.3;
      const W = half + SHELL;
      const topLine = [];
      for (let q = 0; q <= ACROSS; q++) {
        const u = -W + (2 * W * q) / ACROSS;
        topLine.push([u, roofTopAt(p.x + nx * u, p.z + nz * u, Math.abs(u), half)]);
      }
      const arch = [];
      for (let q = 0; q <= ARCH; q++) {
        const th = (q / ARCH) * Math.PI;
        // a rough-hewn arch: its outline wavers a little
        const rough = 1 + 0.08 * noise2(p.along * 0.15 + q * 0.7, 21);
        arch.push([half * Math.cos(th) * rough, floor - 0.4 + (rise + 0.4) * Math.sin(th) ** 0.8 * rough]);
      }
      return { p, nx, nz, half, floor, W, topLine, arch };
    });
    const at = (sec, [u, y]) => [sec.p.x + sec.nx * u, y, sec.p.z + sec.nz * u];

    // A strip joining the same outline on neighbouring sections.
    const strip = (key, shade, occlusion, flip) => {
      const positions = [];
      const colors = [];
      const occ = [];
      const index = [];
      const count = sections[0][key].length;
      sections.forEach((sec) => {
        for (const point of sec[key]) {
          const [x, y, z] = at(sec, point);
          positions.push(x, y, z);
          shade(x, y, z);
          colors.push(color.r, color.g, color.b);
          occ.push(occlusion);
        }
      });
      for (let k = 0; k < sections.length - 1; k++) {
        for (let v = 0; v < count - 1; v++) {
          const a = k * count + v;
          const b = a + count;
          if (flip) index.push(a, a + 1, b, a + 1, b + 1, b);
          else index.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
      parts.push(piece(positions, colors, occ, index));
    };
    strip('topLine', (x, y, z) => groundColorAt(x, z, y, 0.1, color), 1, false);
    strip('arch', (x, y, z) => color.copy(rock).multiplyScalar(0.8 + 0.2 * noise2(x * 0.4, y * 0.4 + z * 0.4)), 0.35, true);

    // A rock face round each end, from the hill's surface down to the arch: not a flat
    // wall but rough, jutting rock, in bands like the strata of a cliff.
    const resample = (line, count) => {
      const lengths = [0];
      for (let k = 1; k < line.length; k++) lengths.push(lengths[k - 1] + Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]));
      const total = lengths[lengths.length - 1];
      const out = [];
      for (let k = 0, seg = 0; k < count; k++) {
        const want = (total * k) / (count - 1);
        while (seg < line.length - 2 && lengths[seg + 1] < want) seg++;
        const f = (want - lengths[seg]) / (lengths[seg + 1] - lengths[seg] || 1);
        out.push([line[seg][0] + (line[seg + 1][0] - line[seg][0]) * f, line[seg][1] + (line[seg + 1][1] - line[seg][1]) * f]);
      }
      return out;
    };
    const ROUND = 56; // points round the face
    const LAYERS = 7; // rings from the arch out to the face's edge
    for (const [sec, outward] of [[sections[0], -1], [sections[sections.length - 1], 1]]) {
      const outer = resample([[-sec.W, sec.floor - 0.6], ...sec.topLine, [sec.W, sec.floor - 0.6]], ROUND);
      const inner = resample([[-sec.half, sec.floor - 0.6], ...[...sec.arch].reverse(), [sec.half, sec.floor - 0.6]], ROUND);
      const fx = sec.nz; // along the tunnel
      const fz = -sec.nx;
      const positions = [];
      const colors = [];
      const occ = [];
      for (let l = 0; l <= LAYERS; l++) {
        const t = l / LAYERS;
        for (let k = 0; k < ROUND; k++) {
          const u = inner[k][0] + (outer[k][0] - inner[k][0]) * t;
          const y = inner[k][1] + (outer[k][1] - inner[k][1]) * t;
          const [x, , z] = at(sec, [u, y]);
          // Juts and hollows, strongest mid-face, nothing at the edges (where it meets the arch and the hill).
          const strata = noise2(u * 0.12 + 40, y * 0.55) * 1.6 + noise2(u * 0.4 - 7, y * 1.1 + 3) * 0.7 + noise2(u * 1.1, y * 1.6) * 0.3;
          const o = (strata + 0.6) * Math.sin(Math.PI * t) * 1.5 * outward;
          positions.push(x + fx * o, y, z + fz * o);
          const band = 0.82 + 0.12 * noise2(y * 0.9 + 5, u * 0.05) + 0.1 * noise2(x * 0.5, y * 0.5 + z * 0.5);
          color.copy(rock).multiplyScalar(band);
          colors.push(color.r, color.g, color.b);
          occ.push(0.55 + 0.4 * t);
        }
      }
      const index = [];
      for (let l = 0; l < LAYERS; l++) {
        for (let k = 0; k < ROUND - 1; k++) {
          const a = l * ROUND + k;
          const b = a + ROUND;
          if (outward > 0) index.push(a, a + 1, b, a + 1, b + 1, b);
          else index.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
      parts.push(piece(positions, colors, occ, index));
    }
  }

  function piece(positions, colors, occ, index) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('aOcclusion', new THREE.Float32BufferAttribute(occ, 1));
    geo.setAttribute('aWaterLevel', new THREE.Float32BufferAttribute(new Array(occ.length).fill(-100), 1));
    geo.setIndex(index);
    geo.computeVertexNormals(); // (each piece on its own, so the edges between them stay crisp)
    return geo;
  }

  if (!parts.length) return group;
  const material = terrainMaterial().clone();
  material.side = THREE.DoubleSide; // (seen from inside the tunnel as well as from the hill)
  material.onBeforeCompile = terrainMaterial().onBeforeCompile;
  const mesh = new THREE.Mesh(mergeGeometries(parts), material);
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
/**
 * The river's water: the sea's own water (its colours, clarity, ripples, sun
 * glitter, sky reflection and lace of foam at the edge), only small, calm and
 * carried along by the current, with white water where it runs steep.
 */
function waterMaterial(heightTexture, uniforms) {
  const w = CONFIG.water;
  Object.assign(uniforms, {
    uHeightMap: { value: heightTexture },
    uTerrainSize: { value: CONFIG.terrain.size },
    uHeightTexels: { value: heightTexture.image.width },
    uShallowColor: { value: new THREE.Color(w.shallowColor) },
    uShallowDepth: { value: w.shallowDepth },
    uFoam: { value: w.foam },
    uReflection: { value: w.reflection },
    uGlitter: { value: w.glitter },
    uRipple: { value: w.waves.ripple },
    uWaveHeight: { value: w.waves.height },
    uWaveLength: { value: w.waves.length },
    uWaveSpeed: { value: w.waves.speed },
    uDepth: { value: CONFIG.rivers[0]?.depth ?? 2 },
  });
  const material = new THREE.MeshStandardMaterial({ color: w.color, transparent: true, opacity: w.opacity, roughness: 0.16, metalness: 0.1, depthWrite: false });
  // The sea's swell, kept small on a river (a bob, not waves).
  const swell = /* glsl */ `
    uniform float uTime;
    uniform float uWaveLength;
    uniform float uWaveSpeed;
    float swell(vec2 p) {
      float k = 6.2831 / uWaveLength;
      float t = uTime * uWaveSpeed;
      return sin(dot(p, vec2(0.80, 0.60)) * k + t * 1.00) * 0.50
           + sin(dot(p, vec2(-0.45, 0.89)) * k * 1.7 + t * 1.31) * 0.30
           + sin(dot(p, vec2(0.95, -0.31)) * k * 2.9 + t * 1.83) * 0.20;
    }`;
  material.onBeforeCompile = (shader) => {
    applyAtmosphere(shader);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        ${swell}
        uniform float uWaveHeight;
        attribute vec2 aFlow;
        attribute vec2 aRiver;
        attribute float aAcross;
        varying float vAcross;
        attribute float aFoam;
        attribute float aFade;
        varying vec3 vWet;
        varying vec2 vFlow;
        varying vec2 vRiver;
        varying float vFoam;
        varying float vFade;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 wetWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        transformed.y += swell(wetWorld.xz) * uWaveHeight * ${RIVER_SWELL.toFixed(2)};
        vWet = vec3(wetWorld.x, wetWorld.y + transformed.y - position.y, wetWorld.z);
        vFlow = aFlow;
        vRiver = aRiver;
        vAcross = aAcross;
        vFoam = aFoam;
        vFade = aFade;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        ${swell}
        uniform sampler2D uHeightMap;
        uniform float uTerrainSize;
        uniform float uHeightTexels;
        uniform vec3 uShallowColor;
        uniform float uShallowDepth;
        uniform float uFoam;
        uniform vec3 uSkyColor;
        uniform float uReflection;
        uniform float uGlitter;
        uniform float uRipple;
        varying vec3 vWet;
        varying vec2 vFlow;
        varying vec2 vRiver; // metres along the river (increasing downstream) and across it
        varying float vAcross; // across the channel: 0 mid-stream, 1 at its edge
        uniform float uDepth;
        varying float vFoam;
        varying float vFade;
        float waterFoam = 0.0;
        ${NOISE_GLSL}
        // The sea's surface detail (its swell, small here, and two layers of drifting ripples),
        // drawn in the river's own along/across metres so the ripples ride downstream with the current.
        float surface(vec2 world, vec2 q) {
          return swell(world) * 0.35 * ${RIVER_SWELL.toFixed(2)}
               + (aNoise(q * 0.55 - vec2(uTime * 0.9, uTime * 0.05)) + aNoise(q * 1.7 - vec2(uTime * 1.4, -uTime * 0.1)) * 0.5) * 0.4;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // How deep is the water here? (over the ground as it is drawn)
        vec2 groundUv = vWet.xz / uTerrainSize + 0.5;
        float ground = texture2D(uHeightMap, (groundUv * (uHeightTexels - 1.0) + 0.5) / uHeightTexels).r;
        float depth = vWet.y - ground;
        // (the ground mesh is too coarse to show a narrow channel's depth: use the channel's own shape for its colour)
        float a = abs(vAcross);
        float channel = a < 1.0 ? uDepth * (1.0 - 0.7 * a * a) : 0.0;
        // Shallows: pale and clear enough to see the bed through (just as the sea's).
        // (a river's few metres look as deep as the open sea's: its shallows are only the margins)
        float shallow = 1.0 - smoothstep(0.0, uShallowDepth * 0.35, max(depth, channel));
        diffuseColor.rgb = mix(diffuseColor.rgb, uShallowColor, shallow * 0.8);
        diffuseColor.a = mix(0.12, diffuseColor.a, smoothstep(0.0, uShallowDepth * 0.3, max(depth, channel))) * smoothstep(-0.08, 0.0, depth);
        // Foam: the sea's broken lace right at the edge, and white water where the river runs steep.
        float lace = aNoise(vWet.xz * 1.6 + uTime * 0.25) * 0.6 + aNoise(vWet.xz * 4.3 - uTime * 0.4) * 0.4;
        float edge = (1.0 - smoothstep(0.0, 0.03 + lace * 0.1, depth)) * smoothstep(0.4, 0.7, lace) * 0.7; // (broken: a bank isn't a beach)
        vec2 q = vRiver;
        float streak = aNoise(vec2(q.x * 0.45 - uTime * 2.4, q.y * 2.6)) * 0.65 + aNoise(vec2(q.x * 1.1 - uTime * 3.6, q.y * 5.5)) * 0.35;
        float rapids = smoothstep(0.6, 0.85, streak) * vFoam * 0.8;
        float foam = clamp(edge * 0.9 + rapids, 0.0, 1.0) * uFoam * smoothstep(-0.08, -0.02, depth);
        waterFoam = foam;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), foam);
        diffuseColor.a = max(diffuseColor.a, foam * 0.92);
        diffuseColor.a *= vFade;`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        // Light the surface as if it were rippled (as the sea does), the detail fading with distance.
        vec2 along = length(vFlow) > 0.01 ? normalize(vFlow) : vec2(1.0, 0.0);
        vec2 across = vec2(-along.y, along.x);
        float rippleFade = uRipple * (1.0 - smoothstep(60.0, 700.0, distance(vWet.xz, cameraPosition.xz)));
        float s0 = surface(vWet.xz, vRiver);
        float sa = surface(vWet.xz + along * 0.4, vRiver + vec2(0.4, 0.0));
        float sc = surface(vWet.xz + across * 0.4, vRiver + vec2(0.0, 0.4));
        vec2 slope = (along * (sa - s0) + across * (sc - s0)) / 0.4 * rippleFade;
        vec3 rippled = normalize(vec3(-slope.x, 1.0, -slope.y));
        normal = normalize((viewMatrix * vec4(rippled, 0.0)).xyz);`,
      )
      .replace(
        '#include <opaque_fragment>',
        `float glance = pow(1.0 - max(dot(normal, normalize(vViewPosition)), 0.0), 4.0) * uReflection * (1.0 - waterFoam);
        outgoingLight = mix(outgoingLight, uSkyColor, glance);
        diffuseColor.a = max(diffuseColor.a, glance * vFade);
        // Glitter: here and there a ripple throws the sun straight back at you.
        vec3 sunView = (viewMatrix * vec4(uFogSunDir, 0.0)).xyz;
        float mirror = pow(max(dot(reflect(-normalize(vViewPosition), normal), sunView), 0.0), 18.0);
        float spark = 0.6 * smoothstep(0.84, 0.97, aNoise(vWet.xz * 7.0 + vec2(uTime * 1.7, -uTime * 1.1)) * 0.6 + aNoise(vWet.xz * 19.0 - uTime * 2.3) * 0.4);
        outgoingLight += uFogSunColor * mirror * spark * 40.0 * uGlitter * (1.0 - waterFoam) * atmoCloudLight();
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
  const fades = [];
  const coords = [];
  const indices = [];
  for (const river of rivers) {
    // Once it is down to sea level the sea itself fills the channel, so the river's own surface
    // stops there (at either end), fading out as it meets the sea.
    const all = river.points;
    const atSea = (p) => p.s <= CONFIG.water.level + 0.1;
    let lo = river.source;
    while (lo > 0 && !atSea(all[lo])) lo--;
    let hi = river.source;
    while (hi < all.length - 1 && !atSea(all[hi])) hi++;
    const pts = all.slice(lo, hi + 1);
    const FADE = 22;
    // (only where it's down near the sea's level: a waterfall into the sea stays in full view)
    const fadeAt = (p) =>
      smoothstep(0, 0.45, p.head) * // (water welling up out of the ground at a spring)
      Math.max(
        // (fading out just where the sea starts to show beneath it: see createSeaMask)
        smoothstep(0.1, SEA_SHOWS, p.s - CONFIG.water.level),
        (atSea(all[lo]) ? smoothstep(0, FADE, p.along - all[lo].along) : 1) * (atSea(all[hi]) ? smoothstep(0, FADE, all[hi].along - p.along) : 1),
      );
    const base = positions.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      dx *= p.flow / len; // (the way the water runs: away from the source)
      dz *= p.flow / len;
      // Wider than the channel by more than one ground-mesh cell, so the water's edge always runs
      // under the bank as drawn (the mesh is too coarse to show a narrow channel's exact shape).
      const w = p.hw + MESH_CELL * 1.3 * (0.35 + 0.65 * p.head); // (narrow where a spring seeps out)
      const speed = 0.5 + Math.min(1.6, p.foam * 2 + p.hw * 0.05);
      for (const side of [-1, 1]) {
        positions.push(p.x - dz * w * side * p.flow, p.s + 0.02, p.z + dx * w * side * p.flow);
        flows.push(dx * speed, dz * speed);
        coords.push(Math.abs(p.along - river.points[river.source].along), w * side); // (metres from the source: increasing downstream, whichever way it runs)
        foams.push(p.foam);
        across.push((side * w) / Math.max(p.hw, MESH_CELL * 1.1));
        fades.push(fadeAt(p));
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
    coords.push(sp.x, sp.z);
    flows.push(0, 0);
    foams.push(0);
    across.push(0);
    fades.push(1);
    const n = 24;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      positions.push(sp.x + Math.cos(a) * sp.r * 1.15, sp.s + 0.02, sp.z + Math.sin(a) * sp.r * 1.15);
      coords.push(sp.x + Math.cos(a) * sp.r * 1.15, sp.z + Math.sin(a) * sp.r * 1.15);
      flows.push(0, 0);
      foams.push(0);
      across.push(1);
      fades.push(1);
      if (k < n) indices.push(base, base + 2 + k, base + 1 + k);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flows, 2));
  geo.setAttribute('aRiver', new THREE.Float32BufferAttribute(coords, 2));
  geo.setAttribute('aFoam', new THREE.Float32BufferAttribute(foams, 1));
  geo.setAttribute('aAcross', new THREE.Float32BufferAttribute(across, 1));
  geo.setAttribute('aFade', new THREE.Float32BufferAttribute(fades, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, waterMaterial(heightTexture, uniforms));
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.receiveShadow = true;
  group.add(mesh);
  return {
    object: group,
    /** Each frame: the time, and the sea's colour (so the river matches it at every hour). */
    update(time, seaColor) {
      uniforms.uTime.value = time;
      uniforms.uWaveHeight.value = CONFIG.water.waves.height;
      if (seaColor) mesh.material.color.copy(seaColor);
    },
  };
}
