// Trails: footpaths that lead from the starting camp to every landmark and
// loop between them, plus the furniture along the way (lanterns, benches,
// signposts, camps). Everything here is planned automatically from the
// terrain, so it adapts when the island, biomes or landmarks change.
//
// How it works
//   1. Routes are found with A* over a coarse grid: they avoid water, prefer
//      gentle slopes, and are cheaper along existing trail so they merge.
//   2. The routes are painted into a texture. The terrain shader tints the
//      ground with it (see terrain.js) — no extra geometry, no seams.
//   3. The same image is read back on the CPU so plants keep off the path.

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { heightAt, spawnPoint } from './terrain.js';

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
  const [hubX, hubZ] = spawnPoint();
  const empty = { texture: null, pathAt: () => 0, clearanceAt: () => 0, props: {}, campfires: [], routes: [] };
  if (!T.enabled) return empty;

  // ── 1. Route finding ──
  const cell = T.gridCell;
  const N = Math.floor(size / cell) + 1;
  const heights = new Float32Array(N * N);
  for (let gz = 0; gz < N; gz++) for (let gx = 0; gx < N; gx++) heights[gz * N + gx] = heightAt(-half + gx * cell, -half + gz * cell);
  const dry = (i) => heights[i] > CONFIG.water.level + 0.7;
  const onTrail = new Uint8Array(N * N);
  const cost = new Float32Array(N * N);
  const from = new Int32Array(N * N);

  const nearestNode = (x, z) => {
    const gx = Math.round((x + half) / cell);
    const gz = Math.round((z + half) / cell);
    for (let r = 0; r < 12; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = gx + dx;
          const nz = gz + dz;
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          if (dry(nz * N + nx)) return nz * N + nx;
        }
      }
    }
    return -1;
  };

  function findRoute(ax, az, bx, bz, reuse = T.reuseDiscount) {
    const start = nearestNode(ax, az);
    const goal = nearestNode(bx, bz);
    if (start < 0 || goal < 0) return null;
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
          if (!dry(next)) continue;
          const dist = cell * (dx && dz ? 1.414 : 1);
          const grade = Math.abs(heights[next] - heights[current]) / dist;
          let step = dist * (1 + (grade * T.slopeAvoidance) ** 2);
          if (heights[next] < CONFIG.water.level + 1.6) step *= 1.6; // keep back from the waterline
          if (onTrail[next]) step *= reuse; // merge into existing trail
          const total = cost[current] + step;
          if (total < cost[next]) {
            cost[next] = total;
            from[next] = current;
            open.push(total + Math.hypot(nx - goalX, nz - goalZ) * cell * reuse, next);
          }
        }
      }
    }
    if (cost[goal] === Infinity) return null; // no dry way across

    const nodes = [];
    for (let i = goal; i !== -1; i = from[i]) nodes.push(i);
    nodes.reverse();
    nodes.forEach((i) => (onTrail[i] = 1));

    // Grid nodes → world points; drop every other node, then round the corners.
    let points = nodes.filter((_, i) => i % 2 === 0 || i === nodes.length - 1).map((i) => [-half + (i % N) * cell, -half + ((i / N) | 0) * cell]);
    points[0] = [ax, az];
    points[points.length - 1] = [bx, bz];
    return smooth(points, 3);
  }

  // Each landmark is approached from the side facing the camp.
  const stops = landmarks.map((lm) => {
    const d = Math.hypot(hubX - lm.x, hubZ - lm.z) || 1;
    const gap = lm.radius + 2;
    return { lm, x: lm.x + ((hubX - lm.x) / d) * gap, z: lm.z + ((hubZ - lm.z) / d) * gap, distance: d };
  });

  const routes = [];
  const spokes = []; // camp → landmark routes, used for placing wayside camps
  for (const stop of [...stops].sort((a, b) => a.distance - b.distance)) {
    const route = findRoute(hubX, hubZ, stop.x, stop.z);
    if (route) {
      routes.push(route);
      spokes.push(route);
    }
  }
  if (T.loop && stops.length > 2) {
    const ring = [...stops].sort((a, b) => Math.atan2(a.z - hubZ, a.x - hubX) - Math.atan2(b.z - hubZ, b.x - hubX));
    ring.forEach((stop, i) => {
      const next = ring[(i + 1) % ring.length];
      // Barely discounted, so these cut across country instead of going back via the camp.
      const route = findRoute(stop.x, stop.z, next.x, next.z, T.loopReuseDiscount);
      if (route) routes.push(route);
    });
  }

  // ── 2. Furniture ──
  const props = { lantern: [], bench: [], signpost: [], logSeat: [], tent: [] };
  const campfires = [];

  /** Point and unit direction at a given distance along a route. */
  const along = (route, distance) => {
    for (let i = 0; i < route.length - 1; i++) {
      const [ax, az] = route[i];
      const [bx, bz] = route[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (distance <= len || i === route.length - 2) {
        const t = Math.min(1, distance / (len || 1));
        return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: (bx - ax) / (len || 1), dz: (bz - az) / (len || 1) };
      }
      distance -= len;
    }
    return { x: route[0][0], z: route[0][1], dx: 1, dz: 0 };
  };
  const lengthOf = (route) => route.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - route[i - 1][0], p[1] - route[i - 1][1]) : 0), 0);
  const isDry = (x, z) => heightAt(x, z) > CONFIG.water.level + 0.8;

  function addCamp(x, z, withTent) {
    if (!isDry(x, z)) return;
    campfires.push({ x, z });
    const seats = withTent ? 3 : 2;
    for (let i = 0; i < seats; i++) {
      const a = (i / seats) * Math.PI * 1.5 + x; // spread round the fire, different at each camp
      props.logSeat.push({ x: x + Math.cos(a) * 2.1, z: z + Math.sin(a) * 2.1, rotation: -a - Math.PI / 2 });
    }
    if (withTent) {
      const a = x + 4;
      const tx = x + Math.cos(a) * 5.5;
      const tz = z + Math.sin(a) * 5.5;
      if (isDry(tx, tz)) props.tent.push({ x: tx, z: tz, rotation: -a });
    }
  }

  // The starting camp sits just ahead of where you begin, in view.
  const yaw = CONFIG.player.startYaw;
  addCamp(hubX - Math.sin(yaw) * 5, hubZ - Math.cos(yaw) * 5, true);
  props.signpost.push({ x: hubX + Math.cos(yaw) * 3.5, z: hubZ - Math.sin(yaw) * 3.5, rotation: yaw });

  // Wayside camps part-way along some of the routes out from the start.
  spokes.forEach((route, i) => {
    const length = lengthOf(route);
    if (i % T.campEvery !== 0 || length < 160) return;
    const p = along(route, length * 0.55);
    addCamp(p.x - p.dz * 7, p.z + p.dx * 7, i % (T.campEvery * 2) === 0);
  });

  // A bench and a signpost where each trail reaches its landmark.
  for (const stop of stops) {
    const dx = (stop.lm.x - stop.x) / (stop.lm.radius + 2);
    const dz = (stop.lm.z - stop.z) / (stop.lm.radius + 2);
    props.bench.push({ x: stop.x - dz * 3.2, z: stop.z + dx * 3.2, rotation: Math.atan2(dx, dz) });
    props.signpost.push({ x: stop.x + dz * 2.6, z: stop.z - dx * 2.6, rotation: Math.atan2(dx, dz) });
  }

  // Lanterns at intervals, alternating sides, skipping stretches already lit.
  let side = 1;
  for (const route of routes) {
    const length = lengthOf(route);
    for (let d = T.lanternSpacing * 0.5; d < length - 10; d += T.lanternSpacing) {
      const p = along(route, d);
      const x = p.x - p.dz * 2.3 * side;
      const z = p.z + p.dx * 2.3 * side;
      if (!isDry(x, z)) continue;
      if (props.lantern.some((l) => Math.hypot(l.x - x, l.z - z) < T.lanternSpacing * 0.6)) continue;
      if (campfires.some((c) => Math.hypot(c.x - x, c.z - z) < 14)) continue;
      // The lantern's arm (local +X) reaches out over the path.
      props.lantern.push({ x, z, rotation: Math.atan2(-p.dx * side, p.dz * side) });
      side = -side;
    }
  }

  // ── 3. Paint the mask: red = trodden path, green = "keep trees clear" ──
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = MASK_SIZE;
  const ctx = canvas.getContext('2d');
  const px = MASK_SIZE / size;
  const toPx = (v) => (v + half) * px;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, MASK_SIZE, MASK_SIZE);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = ctx.lineJoin = 'round';

  const disc = (x, z, radius, style) => {
    ctx.fillStyle = style;
    ctx.beginPath();
    ctx.arc(toPx(x), toPx(z), radius * px, 0, Math.PI * 2);
    ctx.fill();
  };

  // Clearance first (green), then the path itself (red). Painting each route on
  // its own layer stops overlapping routes from adding up into a wider path.
  const layer = document.createElement('canvas');
  layer.width = layer.height = MASK_SIZE;
  const paintLayer = (draw) => {
    const lctx = layer.getContext('2d');
    lctx.globalCompositeOperation = 'source-over';
    lctx.fillStyle = '#000';
    lctx.fillRect(0, 0, MASK_SIZE, MASK_SIZE);
    lctx.lineCap = lctx.lineJoin = 'round';
    draw(lctx);
    ctx.drawImage(layer, 0, 0); // added onto the mask ("lighter")
  };
  const strokeOn = (c, route, width, style) => {
    c.strokeStyle = style;
    c.lineWidth = width * px;
    c.beginPath();
    route.forEach(([x, z], i) => (i ? c.lineTo(toPx(x), toPx(z)) : c.moveTo(toPx(x), toPx(z))));
    c.stroke();
  };
  // All routes share one layer per stroke width, drawn opaque ("source-over"),
  // so crossings and merges stay the same strength as a single path.
  paintLayer((c) => routes.forEach((r) => strokeOn(c, r, T.clearWidth, 'rgb(0,255,0)')));
  for (const [widthScale, value] of [[1.9, 60], [1.35, 80], [0.9, 115]]) {
    paintLayer((c) => routes.forEach((r) => strokeOn(c, r, T.width * widthScale, `rgb(${value},0,0)`)));
  }

  for (const lm of landmarks) disc(lm.x, lm.z, lm.radius + 3, 'rgb(0,255,0)');
  for (const camp of campfires) {
    disc(camp.x, camp.z, 8, 'rgb(0,255,0)');
    disc(camp.x, camp.z, 4.6, 'rgb(110,0,0)');
    disc(camp.x, camp.z, 3.2, 'rgb(110,0,0)');
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
