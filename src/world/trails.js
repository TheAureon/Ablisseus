// Trails: footpaths that lead from the starting camp to every landmark and
// loop between them, plus the furniture along the way (lanterns, signposts,
// camps). Everything here is planned automatically from the
// terrain, so it adapts when the island, biomes or landmarks change.
//
// How it works
//   1. Routes are found with A* over a coarse grid: they never cross water or
//      steep ground, prefer gentle slopes, and are cheaper along existing
//      trail so they join it rather than run beside it.
//   2. All routes are merged into one network of unique stretches between
//      junctions, so a shared stretch is one path, not several overlapping.
//   3. The network is painted into a texture. The terrain shader tints the
//      ground with it (see terrain.js) — no extra geometry, no seams.
//   4. The same image is read back on the CPU so plants keep off the path.

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { heightAt, slopeAt, spawnPoint, addPad, addRoadBed } from './terrain.js';

const MASK_SIZE = 2048;

/** Tiny binary heap of (priority, value) pairs for A*. */
class Heap {
  constructor() {
    this.p = [];
    this.v = [];
  }
  get size() {
    return this.p.length;
  }
  push(priority, value) {
    const { p, v } = this;
    let i = p.length;
    p.push(priority);
    v.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (p[parent] <= p[i]) break;
      [p[parent], p[i]] = [p[i], p[parent]];
      [v[parent], v[i]] = [v[i], v[parent]];
      i = parent;
    }
  }
  pop() {
    const { p, v } = this;
    const top = v[0];
    const lastP = p.pop();
    const lastV = v.pop();
    if (p.length) {
      p[0] = lastP;
      v[0] = lastV;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < p.length && p[l] < p[m]) m = l;
        if (r < p.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [p[m], p[i]] = [p[i], p[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Rounds the corners of a polyline (Chaikin's algorithm), keeping its ends. */
function smooth(points, iterations) {
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

export function createTrails(landmarks) {
  const T = CONFIG.trails;
  const size = CONFIG.terrain.size;
  const half = size / 2;
  const water = CONFIG.water.level;
  const [hubX, hubZ] = spawnPoint();
  const empty = { texture: null, pathAt: () => 0, clearanceAt: () => 0, props: {}, campfires: [], routes: [] };
  if (!T.enabled) return empty;

  // ── 1. Route finding ──────────────────────────────────────────────────────
  const cell = T.gridCell;
  const N = Math.floor(size / cell) + 1;
  const heights = new Float32Array(N * N);
  const slopes = new Float32Array(N * N);
  const nodeX = (i) => -half + (i % N) * cell;
  const nodeZ = (i) => -half + ((i / N) | 0) * cell;
  for (let i = 0; i < N * N; i++) heights[i] = heightAt(nodeX(i), nodeZ(i));
  for (let i = 0; i < N * N; i++) slopes[i] = slopeAt(nodeX(i), nodeZ(i)); // true steepness, including across the path
  const dry = (i) => heights[i] > water + 0.7;

  const onTrail = new Uint8Array(N * N); // cells a path already uses
  const beside = new Uint8Array(N * N); // cells right next to a path
  const cost = new Float32Array(N * N);
  const from = new Int32Array(N * N);

  const nearestNode = (x, z, maxSlope) => {
    const gx = Math.round((x + half) / cell);
    const gz = Math.round((z + half) / cell);
    for (let r = 0; r < 14; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = gx + dx;
          const nz = gz + dz;
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          const i = nz * N + nx;
          if (dry(i) && slopes[i] <= maxSlope) return i;
        }
      }
    }
    return -1;
  };

  /** A* from node to node. Returns the list of grid nodes, or null if there is no way. */
  function search(start, goal, reuse, maxSlope, maxClimb) {
    cost.fill(Infinity);
    cost[start] = 0;
    from[start] = -1;
    const open = new Heap();
    open.push(0, start);
    const goalX = goal % N;
    const goalZ = (goal / N) | 0;

    while (open.size) {
      const current = open.pop();
      if (current === goal) break;
      const cx = current % N;
      const cz = (current / N) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          const next = nz * N + nx;
          if (!dry(next) || slopes[next] > maxSlope) continue; // never through water or over steep ground
          const dist = cell * (dx && dz ? 1.414 : 1);
          const climb = Math.abs(heights[next] - heights[current]) / dist;
          if (climb > maxClimb) continue; // too steep to walk up: go round, in zigzags if need be
          let step = dist * (1 + (climb * T.slopeAvoidance) ** 2 + (slopes[next] * T.slopeAvoidance * 0.6) ** 2);
          if (heights[next] < water + 1.6) step *= 1.6; // keep back from the waterline
          if (onTrail[next]) step *= reuse; // walking an existing path is cheap…
          else if (beside[next]) step *= T.parallelPenalty; // …running alongside one is not: join it or keep away
          const total = cost[current] + step;
          if (total < cost[next]) {
            cost[next] = total;
            from[next] = current;
            open.push(total + Math.hypot(nx - goalX, nz - goalZ) * cell * reuse, next);
          }
        }
      }
    }
    if (cost[goal] === Infinity) return null;
    const nodes = [];
    for (let i = goal; i !== -1; i = from[i]) nodes.push(i);
    return nodes.reverse();
  }

  const exact = new Map(); // grid node → the precise point it stands for (camp, landmark approach)
  const nodeRoutes = [];

  function findRoute(ax, az, bx, bz, reuse = T.reuseDiscount) {
    // Hold to the slope limit if at all possible; relax it only when a place cannot be reached otherwise.
    // (The hillside limit is the slope *across* the path, which is cut level
    // anyway; the climb limit is how steeply the path itself may rise.)
    for (const [maxSlope, maxClimb] of [[T.maxSlope, T.maxClimb], [T.maxSlope * 2, T.maxClimb], [T.maxSlope * 4, T.maxClimb * 1.2], [Infinity, T.maxClimb * 1.5], [Infinity, Infinity]]) {
      const start = nearestNode(ax, az, maxSlope);
      const goal = nearestNode(bx, bz, maxSlope);
      if (start < 0 || goal < 0 || start === goal) continue;
      const nodes = search(start, goal, reuse, maxSlope, maxClimb);
      if (!nodes) continue;
      if (!exact.has(start)) exact.set(start, [ax, az]);
      if (!exact.has(goal)) exact.set(goal, [bx, bz]);
      for (const i of nodes) onTrail[i] = 1;
      for (const i of nodes) {
        const cx = i % N;
        const cz = (i / N) | 0;
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = cx + dx;
            const nz = cz + dz;
            if (nx >= 0 && nz >= 0 && nx < N && nz < N) beside[nz * N + nx] = 1;
          }
        }
      }
      nodeRoutes.push(nodes);
      return nodes;
    }
    return null;
  }

  // Each landmark is approached from the side facing the camp, at the edge of its clearing.
  const stops = landmarks.map((lm) => {
    const d = Math.hypot(hubX - lm.x, hubZ - lm.z) || 1;
    const gap = lm.radius + 2;
    return { lm, x: lm.x + ((hubX - lm.x) / d) * gap, z: lm.z + ((hubZ - lm.z) / d) * gap, distance: d };
  });

  const spokes = []; // camp → landmark routes, used for placing wayside camps
  for (const stop of [...stops].sort((a, b) => a.distance - b.distance)) {
    const nodes = findRoute(hubX, hubZ, stop.x, stop.z);
    if (nodes) spokes.push(nodes);
  }
  if (T.loop && stops.length > 2) {
    const ring = [...stops].sort((a, b) => Math.atan2(a.z - hubZ, a.x - hubX) - Math.atan2(b.z - hubZ, b.x - hubX));
    ring.forEach((stop, i) => {
      const next = ring[(i + 1) % ring.length];
      findRoute(stop.x, stop.z, next.x, next.z, T.loopReuseDiscount);
    });
  }

  // ── 2. Merge every route into one network ─────────────────────────────────
  // Collect the grid edges used by any route, then walk them out as stretches
  // running from junction to junction. A stretch shared by five routes is
  // still one stretch, smoothed and drawn once.
  const pointOf = (i) => exact.get(i) ?? [nodeX(i), nodeZ(i)];
  const lengthOfNodes = (chain) => chain.reduce((sum, n, i) => (i ? sum + Math.hypot(nodeX(n) - nodeX(chain[i - 1]), nodeZ(n) - nodeZ(chain[i - 1])) : 0), 0);

  /** Splits a set of node paths into stretches that run from junction to junction. */
  function toStretches(nodePaths) {
    const neighbours = new Map();
    const link = (a, b) => {
      if (!neighbours.has(a)) neighbours.set(a, new Set());
      neighbours.get(a).add(b);
    };
    for (const nodes of nodePaths) {
      for (let i = 0; i < nodes.length - 1; i++) {
        link(nodes[i], nodes[i + 1]);
        link(nodes[i + 1], nodes[i]);
      }
    }
    const isJunction = (i) => neighbours.get(i).size !== 2 || exact.has(i);
    const walked = new Set();
    const stretches = [];
    for (const start of neighbours.keys()) {
      if (!isJunction(start)) continue;
      for (const first of neighbours.get(start)) {
        if (walked.has(start + ':' + first)) continue;
        const chain = [start];
        let previous = start;
        let current = first;
        for (;;) {
          walked.add(previous + ':' + current);
          walked.add(current + ':' + previous);
          chain.push(current);
          if (isJunction(current)) break;
          const [a, b] = [...neighbours.get(current)];
          const next = a === previous ? b : a;
          previous = current;
          current = next;
        }
        stretches.push(chain);
      }
    }
    return stretches;
  }

  /** Shortest way between two junctions over the given stretches, ignoring one of them. */
  function detour(stretches, skip, from, to, limit) {
    const best = new Map([[from, 0]]);
    const queue = [from];
    while (queue.length) {
      const node = queue.shift();
      for (const chain of stretches) {
        if (chain === skip) continue;
        const a = chain[0];
        const b = chain[chain.length - 1];
        const other = a === node ? b : b === node ? a : -1;
        if (other < 0) continue;
        const d = best.get(node) + lengthOfNodes(chain);
        if (d < limit && d < (best.get(other) ?? Infinity)) {
          best.set(other, d);
          queue.push(other);
        }
      }
    }
    return best.get(to) ?? Infinity;
  }

  // Tidy the network: where a path splits and rejoins a few steps later (a
  // little triangle or sliver between two near-parallel paths), drop the short
  // side and let everything use the other. Repeat until nothing changes.
  let stretches = toStretches(nodeRoutes);
  for (let changed = true; changed; ) {
    changed = false;
    for (const chain of [...stretches].sort((a, b) => lengthOfNodes(a) - lengthOfNodes(b))) {
      const length = lengthOfNodes(chain);
      if (length > T.mergeWithin) break;
      const a = chain[0];
      const b = chain[chain.length - 1];
      if (a === b || detour(stretches, chain, a, b, length * 2.5 + 30) < length * 2.5 + 30) {
        stretches = toStretches(stretches.filter((c) => c !== chain));
        changed = true;
        break;
      }
    }
  }

  // Thin out the grid's stair-steps (ends stay put), then round the corners.
  const routes = stretches.map((chain) => smooth(chain.filter((_, i) => i === 0 || i === chain.length - 1 || i % 2 === 0).map(pointOf), 3));

  // Cut a level bed under every stretch so paths hold to hillsides as ledges.
  // The bed follows the natural ground along the path, gently evened out.
  if (T.bed.enabled) {
    const samples = [];
    for (const route of routes) {
      const total = route.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - route[i - 1][0], p[1] - route[i - 1][1]) : 0), 0);
      const count = Math.max(2, Math.ceil(total / 2.5));
      const line = [];
      let segment = 0;
      let walked = 0;
      for (let k = 0; k <= count; k++) {
        const target = (k / count) * total;
        while (segment < route.length - 2 && walked + Math.hypot(route[segment + 1][0] - route[segment][0], route[segment + 1][1] - route[segment][1]) < target) {
          walked += Math.hypot(route[segment + 1][0] - route[segment][0], route[segment + 1][1] - route[segment][1]);
          segment++;
        }
        const [ax, az] = route[segment];
        const [bx, bz] = route[segment + 1];
        const t = Math.min(1, (target - walked) / (Math.hypot(bx - ax, bz - az) || 1e-6));
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        line.push([x, z, heightAt(x, z)]);
      }
      // Even out bumps along the path (ends stay fixed so stretches meet cleanly).
      for (let pass = 0; pass < T.bed.smoothing; pass++) {
        const before = line.map((p) => p[2]);
        for (let i = 1; i < line.length - 1; i++) line[i][2] = (before[i - 1] + before[i] * 2 + before[i + 1]) / 4;
      }
      // Then hold the path to a walkable grade, cutting or building up the bed
      // where the hillside is steeper: sweep out from each fixed end.
      const spacing = total / count;
      const rise = T.bed.maxGrade * spacing;
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 1; i < line.length - 1; i++) line[i][2] = Math.min(Math.max(line[i][2], line[i - 1][2] - rise), line[i - 1][2] + rise);
        for (let i = line.length - 2; i > 0; i--) line[i][2] = Math.min(Math.max(line[i][2], line[i + 1][2] - rise), line[i + 1][2] + rise);
      }
      samples.push(...line);
    }
    addRoadBed(samples, T.width * 0.5 + T.bed.shoulder, T.bed.blend);
  }

  // ── 3. Furniture ──────────────────────────────────────────────────────────
  const props = { lantern: [], signpost: [], logSeat: [], tent: [] };
  const campfires = [];
  const spurs = []; // short side paths from the trail to a camp

  const lengthOf = (route) => route.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - route[i - 1][0], p[1] - route[i - 1][1]) : 0), 0);
  /** Point and unit direction at a given distance along a route. */
  const along = (route, distance) => {
    for (let i = 0; i < route.length - 1; i++) {
      const [ax, az] = route[i];
      const [bx, bz] = route[i + 1];
      const len = Math.hypot(bx - ax, bz - az) || 1e-6;
      if (distance <= len || i === route.length - 2) {
        const t = Math.min(1, distance / len);
        return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: (bx - ax) / len, dz: (bz - az) / len };
      }
      distance -= len;
    }
    return { x: route[0][0], z: route[0][1], dx: 1, dz: 0 };
  };
  /** Distance from a point to the nearest trail. */
  const distanceToTrail = (x, z) => {
    let best = Infinity;
    for (const route of routes) for (const [px, pz] of route) best = Math.min(best, Math.hypot(px - x, pz - z));
    return best;
  };
  /** True where a camp could sit: level, dry, with dry ground all round. */
  const campable = (x, z) => {
    if (heightAt(x, z) < water + 1.8 || slopeAt(x, z) > 0.22) return false;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) if (heightAt(x + Math.cos(a) * 8, z + Math.sin(a) * 8) < water + 1) return false;
    return true;
  };

  /**
   * A camp: fire in the middle, log seats round three sides, the fourth side
   * open toward (fromX, fromZ) — the path, or the player at the start.
   */
  function addCamp(x, z, fromX, fromZ, withTent) {
    addPad(x, z, 6.5, 9); // level the ground first
    campfires.push({ x, z });
    const open = Math.atan2(fromZ - z, fromX - x); // direction of the open side
    for (const turn of [Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const a = open + turn;
      // A log lies across the line to the fire, so you sit facing the flames.
      props.logSeat.push({ x: x + Math.cos(a) * 2.2, z: z + Math.sin(a) * 2.2, rotation: -a - Math.PI / 2 });
    }
    if (withTent) {
      const a = open + Math.PI * 0.78; // behind the seats, off to one side
      props.tent.push({ x: x + Math.cos(a) * 5.2, z: z + Math.sin(a) * 5.2, rotation: Math.PI - a }); // opening faces the fire
    }
  }

  /** Best campable spot near (x, z) that keeps `clear` metres from the trail, or null. */
  function findCampSpot(x, z, clear) {
    let best = null;
    let bestScore = Infinity;
    for (let r = 0; r <= 26; r += 3) {
      for (let a = 0; a < Math.PI * 2; a += r ? Math.PI / 6 : 7) {
        const cx = x + Math.cos(a) * r;
        const cz = z + Math.sin(a) * r;
        if (!campable(cx, cz)) continue;
        const d = distanceToTrail(cx, cz);
        if (d < clear) continue;
        const score = slopeAt(cx, cz) * 60 + r + Math.max(0, d - clear - 4) * 2; // flat, near, not far off the path
        if (score < bestScore) {
          bestScore = score;
          best = [cx, cz];
        }
      }
    }
    return best;
  }

  // The starting camp: just ahead of where you begin, open side toward you.
  const yaw = CONFIG.player.startYaw;
  const homeFire = [hubX - Math.sin(yaw) * 5.5, hubZ - Math.cos(yaw) * 5.5];
  addCamp(homeFire[0], homeFire[1], hubX, hubZ, true);
  props.signpost.push({ x: hubX + Math.cos(yaw) * 4, z: hubZ - Math.sin(yaw) * 4, rotation: yaw });

  // Wayside camps part-way along some of the routes out from the start, set
  // back from the path on level ground and joined to it by a short spur.
  spokes.forEach((nodes, i) => {
    if (i % T.campEvery !== 0 || nodes.length * cell < 170) return;
    const mid = nodes[Math.floor(nodes.length * 0.55)];
    const spot = findCampSpot(nodeX(mid), nodeZ(mid), 7);
    if (!spot || campfires.some((c) => Math.hypot(c.x - spot[0], c.z - spot[1]) < 80)) return;
    // The nearest point of the trail is where the spur joins, and where the camp opens toward.
    let join = null;
    let joinDistance = Infinity;
    for (const route of routes) {
      for (const p of route) {
        const d = Math.hypot(p[0] - spot[0], p[1] - spot[1]);
        if (d < joinDistance) {
          joinDistance = d;
          join = p;
        }
      }
    }
    addCamp(spot[0], spot[1], join[0], join[1], i % (T.campEvery * 2) === 0);
    spurs.push([join, [(join[0] + spot[0]) / 2, (join[1] + spot[1]) / 2], spot]);
  });

  // A signpost where each trail reaches its landmark.
  for (const stop of stops) {
    const dx = (stop.lm.x - stop.x) / (stop.lm.radius + 2);
    const dz = (stop.lm.z - stop.z) / (stop.lm.radius + 2);
    props.signpost.push({ x: stop.x + dz * 2.8, z: stop.z - dx * 2.8, rotation: Math.atan2(dx, dz) });
  }

  // Lamp posts at intervals beside the path, alternating sides.
  let side = 1;
  for (const route of routes) {
    const length = lengthOf(route);
    for (let d = T.lanternSpacing * 0.5; d < length - 8; d += T.lanternSpacing) {
      const p = along(route, d);
      const x = p.x - p.dz * 2.1 * side;
      const z = p.z + p.dx * 2.1 * side;
      if (heightAt(x, z) < water + 0.8) continue;
      if (props.lantern.some((l) => Math.hypot(l.x - x, l.z - z) < T.lanternSpacing * 0.55)) continue;
      if (campfires.some((c) => Math.hypot(c.x - x, c.z - z) < 14)) continue;
      if (stops.some((s) => Math.hypot(s.lm.x - x, s.lm.z - z) < s.lm.radius + 6)) continue;
      props.lantern.push({ x, z, rotation: 0 });
      side = -side;
    }
  }

  // ── 4. Paint the mask: red = trodden path, green = "keep trees clear" ─────
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = MASK_SIZE;
  const ctx = canvas.getContext('2d');
  const px = MASK_SIZE / size;
  const toPx = (v) => (v + half) * px;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, MASK_SIZE, MASK_SIZE);
  ctx.globalCompositeOperation = 'lighter';

  const disc = (x, z, radius, style) => {
    ctx.fillStyle = style;
    ctx.beginPath();
    ctx.arc(toPx(x), toPx(z), radius * px, 0, Math.PI * 2);
    ctx.fill();
  };

  // Every stretch of a given width is drawn opaque on one layer, and the layer
  // is then added to the mask. Junctions and crossings therefore come out the
  // same strength as a plain stretch of path instead of piling up into a blot.
  const layer = document.createElement('canvas');
  layer.width = layer.height = MASK_SIZE;
  const lctx = layer.getContext('2d');
  const paint = (lines, width, style) => {
    lctx.globalCompositeOperation = 'source-over';
    lctx.fillStyle = '#000';
    lctx.fillRect(0, 0, MASK_SIZE, MASK_SIZE);
    lctx.lineCap = lctx.lineJoin = 'round';
    lctx.strokeStyle = style;
    lctx.lineWidth = width * px;
    for (const line of lines) {
      lctx.beginPath();
      line.forEach(([x, z], i) => (i ? lctx.lineTo(toPx(x), toPx(z)) : lctx.moveTo(toPx(x), toPx(z))));
      lctx.stroke();
    }
    ctx.drawImage(layer, 0, 0);
  };

  paint(routes, T.clearWidth, 'rgb(0,255,0)');
  // Three passes, widest and faintest first, give the path a soft worn edge.
  for (const [widthScale, value] of [[1.9, 60], [1.35, 80], [0.9, 115]]) {
    paint(routes, T.width * widthScale, `rgb(${value},0,0)`);
    paint(spurs, T.width * widthScale * 0.7, `rgb(${value},0,0)`);
  }

  for (const lm of landmarks) disc(lm.x, lm.z, lm.radius + 9, 'rgb(0,255,0)'); // room to see it
  for (const camp of campfires) {
    disc(camp.x, camp.z, 9, 'rgb(0,255,0)');
    disc(camp.x, camp.z, 4.8, 'rgb(110,0,0)');
    disc(camp.x, camp.z, 3.4, 'rgb(110,0,0)');
  }

  const data = ctx.getImageData(0, 0, MASK_SIZE, MASK_SIZE).data;
  const sample = (x, z, channel) => {
    const ix = Math.round(toPx(x));
    const iz = Math.round(toPx(z));
    if (ix < 0 || iz < 0 || ix >= MASK_SIZE || iz >= MASK_SIZE) return 0;
    return data[(iz * MASK_SIZE + ix) * 4 + channel] / 255;
  };

  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false; // so texture v runs along world +z, matching the lookup above
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 8;

  return {
    texture,
    /** 0..1 — how much trodden path is here. */
    pathAt: (x, z) => sample(x, z, 0),
    /** 0..1 — inside the strip beside paths / around camps and landmarks kept free of trees. */
    clearanceAt: (x, z) => sample(x, z, 1),
    props,
    campfires,
    routes,
  };
}
