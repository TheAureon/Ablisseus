// Where a footpath meets a river: a wooden footbridge over wide or deep water,
// stepping stones across narrow, shallow water. Found along the finished
// paths (see trails.js); this file decides which, and builds the bridges.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { heightAt } from './terrain.js';
import { riverAt, addBridgeSurface, addStoneSurface, deckHeight } from './hydrology.js';

/**
 * Walks every path and finds where it crosses a river.
 * @returns { bridges: [...], stones: [{ x, z, y, scaleY, rotation }] } — stone props sit on the river bed
 */
export function findCrossings(routes) {
  const T = CONFIG.trails;
  const bridges = [];
  const stones = [];

  for (const route of routes) {
    // Sample the path every half metre and note each stretch inside a river channel.
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
        cross(samples, start, i - 1);
        start = -1;
      }
    }
  }

  function cross(samples, first, last) {
    const [ax, az] = samples[first];
    const [bx, bz] = samples[last];
    const mid = samples[(first + last) >> 1];
    const river = riverAt(mid[0], mid[1]);
    if (!river) return;
    let dx = bx - ax;
    let dz = bz - az;
    let len = Math.hypot(dx, dz);
    if (len < 0.3) {
      // Barely clipped the edge: cross straight over instead.
      dx = -river.dirZ;
      dz = river.dirX;
      len = 1;
    }
    dx /= len;
    dz /= len;
    const width = river.hw * 2;

    if (width <= T.fordMaxWidth && river.depth <= T.fordMaxDepth) {
      // Stepping stones, a long stride apart, straight across the channel.
      const span = river.hw * 2.2;
      const n = Math.max(2, Math.round(span / 0.85));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n - 0.5;
        const x = mid[0] + (-river.dirZ) * span * t + (Math.random() - 0.5) * 0.12;
        const z = mid[1] + river.dirX * span * t + (Math.random() - 0.5) * 0.12;
        const bed = heightAt(x, z);
        const top = river.s + 0.12;
        if (top - bed < 0.05) continue; // on the bank already
        stones.push({ x, z, y: bed - 0.05, scaleY: top - bed + 0.05, rotation: Math.random() * Math.PI * 2, scale: 0.9 + Math.random() * 0.25 });
        addStoneSurface({ x, z, r: 0.42, top });
      }
      return;
    }

    // A footbridge from bank to bank, with a gentle arch to clear the water.
    const reach = river.hw + 2;
    const cx = (ax + bx) / 2;
    const cz = (az + bz) / 2;
    const b = { ax: cx - dx * reach, az: cz - dz * reach, bx: cx + dx * reach, bz: cz + dz * reach, halfWidth: 0.95 };
    b.ha = heightAt(b.ax, b.az);
    b.hb = heightAt(b.bx, b.bz);
    b.arch = Math.max(0.25, river.s + 0.6 - (b.ha + b.hb) / 2);
    bridges.push(b);
    addBridgeSurface(b);
  }

  return { bridges, stones };
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
