// Simple stand-in shapes used until real models are assigned in assets.js.
// Each function returns an Object3D with its origin on the ground.

import * as THREE from 'three';

const mat = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true, ...extra });

function mesh(geometry, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  return m;
}

/** @param leaves foliage colour  @param top optional colour for the upper tiers (e.g. snow) */
export function pine(leaves = '#2f5d3a', top = null) {
  const g = new THREE.Group();
  const low = mat(leaves);
  const high = mat(top ?? leaves);
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.2, 1.6, 6), mat('#5b4332'), 0, 0.8, 0));
  g.add(mesh(new THREE.ConeGeometry(1.5, 2.6, 7), low, 0, 2.4, 0));
  g.add(mesh(new THREE.ConeGeometry(1.15, 2.2, 7), high, 0, 3.7, 0));
  g.add(mesh(new THREE.ConeGeometry(0.75, 1.9, 7), high, 0, 4.9, 0));
  return g;
}

export function tree(leaves = '#6f9a45', trunk = '#6a4f3a') {
  const g = new THREE.Group();
  const canopy = mat(leaves);
  g.add(mesh(new THREE.CylinderGeometry(0.14, 0.24, 2.4, 6), mat(trunk), 0, 1.2, 0));
  g.add(mesh(new THREE.IcosahedronGeometry(1.6, 0), canopy, 0, 3.4, 0));
  g.add(mesh(new THREE.IcosahedronGeometry(1.1, 0), canopy, 0.9, 2.9, 0.4));
  g.add(mesh(new THREE.IcosahedronGeometry(1.0, 0), canopy, -0.8, 3.0, -0.5));
  return g;
}

export function rock(color = '#807b74') {
  const m = mesh(new THREE.DodecahedronGeometry(0.7, 0), mat(color), 0, 0.3, 0);
  m.scale.set(1.2, 0.7, 0.9);
  const g = new THREE.Group();
  g.add(m);
  return g;
}

export function cactus() {
  const g = new THREE.Group();
  const green = mat('#5f8a55');
  g.add(mesh(new THREE.CylinderGeometry(0.22, 0.26, 2.6, 7), green, 0, 1.3, 0));
  g.add(mesh(new THREE.SphereGeometry(0.22, 7, 5), green, 0, 2.6, 0));
  for (const [side, y, h] of [[1, 1.2, 0.9], [-1, 1.6, 0.7]]) {
    const elbow = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.5, 6), green, side * 0.4, y, 0);
    elbow.rotation.z = Math.PI / 2;
    g.add(elbow);
    g.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, h, 6), green, side * 0.62, y + h / 2, 0));
    g.add(mesh(new THREE.SphereGeometry(0.13, 6, 4), green, side * 0.62, y + h, 0));
  }
  return g;
}

/** A low scrubby shrub. */
export function bush(color = '#8c8a52') {
  const g = new THREE.Group();
  const leaves = mat(color);
  g.add(mesh(new THREE.IcosahedronGeometry(0.45, 0), leaves, 0, 0.3, 0));
  g.add(mesh(new THREE.IcosahedronGeometry(0.32, 0), leaves, 0.35, 0.22, 0.1));
  g.add(mesh(new THREE.IcosahedronGeometry(0.28, 0), leaves, -0.3, 0.2, -0.15));
  return g;
}

/** A tuft of a few flat blades, built as one geometry so it instances cheaply. */
export function grass(baseColor = '#4f7f3c', tipColor = '#a9c66a') {
  const blades = 6;
  const positions = [];
  const normals = [];
  const colors = [];
  const base = new THREE.Color(baseColor);
  const tip = new THREE.Color(tipColor);

  for (let i = 0; i < blades; i++) {
    const angle = (i / blades) * Math.PI * 2 + i * 1.7;
    const dist = 0.05 + (i % 3) * 0.07;
    const cx = Math.cos(angle) * dist;
    const cz = Math.sin(angle) * dist;
    const facing = angle * 2.3;
    const w = 0.035;
    const h = 0.3 + ((i * 37) % 10) * 0.03;
    const lean = 0.12;
    const dx = Math.cos(facing) * w;
    const dz = Math.sin(facing) * w;

    const left = [cx - dx, 0, cz - dz];
    const right = [cx + dx, 0, cz + dz];
    const top = [cx + Math.cos(angle) * lean, h, cz + Math.sin(angle) * lean];
    // Each blade is added twice, once facing each way, and every normal points
    // straight up. That lights both sides evenly like the ground; a double-sided
    // material would flip the normal on the back and turn half the blades black.
    positions.push(...left, ...right, ...top, ...right, ...left, ...top);
    for (let side = 0; side < 2; side++) {
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
      colors.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })));
  return g;
}

export function flower(petals = '#f2e6ff', glow = '#b79cff') {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 4), mat('#5a8a3f'), 0, 0.2, 0));
  g.add(mesh(new THREE.IcosahedronGeometry(0.07, 0), mat(petals, { emissive: glow, emissiveIntensity: 0.35 }), 0, 0.43, 0));
  return g;
}

// ── Natural landmarks ────────────────────────────────────────────────────────
// Large one-off features, one per biome. All are rough stand-ins.

function blob(geometry, material, x, y, z, sx = 1, sy = sx, sz = sx, tilt = 0) {
  const m = mesh(geometry, material, x, y, z);
  m.scale.set(sx, sy, sz);
  m.rotation.set(tilt, x * 1.7 + z, tilt * 0.6);
  return m;
}

/** An enormous old tree. */
export function giantTree(leaves = '#557f3c', trunkColor = '#5a4433') {
  const g = new THREE.Group();
  const bark = mat(trunkColor);
  const canopy = mat(leaves);
  g.add(mesh(new THREE.CylinderGeometry(1.1, 2.1, 13, 9), bark, 0, 6.5, 0));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const root = mesh(new THREE.CylinderGeometry(0.25, 0.75, 4.2, 5), bark, Math.cos(a) * 2.2, 0.8, Math.sin(a) * 2.2);
    root.rotation.set(Math.sin(a) * 1.05, 0, -Math.cos(a) * 1.05);
    g.add(root);
    const branch = mesh(new THREE.CylinderGeometry(0.28, 0.55, 7, 5), bark, Math.cos(a + 0.5) * 2.8, 12.2, Math.sin(a + 0.5) * 2.8);
    branch.rotation.set(Math.sin(a + 0.5) * 0.9, 0, -Math.cos(a + 0.5) * 0.9);
    g.add(branch);
    g.add(blob(new THREE.IcosahedronGeometry(4.2, 0), canopy, Math.cos(a + 0.5) * 6, 14.5 + (i % 2) * 1.5, Math.sin(a + 0.5) * 6, 1, 0.75, 1));
  }
  g.add(blob(new THREE.IcosahedronGeometry(6.5, 0), canopy, 0, 17.5, 0, 1, 0.8, 1));
  return g;
}

/** A natural rock arch you can walk under. */
export function rockArch(color = '#b98f62') {
  const g = new THREE.Group();
  const stone = mat(color);
  const rock = () => new THREE.DodecahedronGeometry(1, 0);
  g.add(blob(rock(), stone, -6, 3.5, 0, 2.6, 4.6, 2.8, 0.1));
  g.add(blob(rock(), stone, -5.2, 8.2, 0.2, 2.4, 2.6, 2.4, 0.4));
  g.add(blob(rock(), stone, 6.2, 3.2, 0, 2.9, 4.3, 3.0, -0.15));
  g.add(blob(rock(), stone, 5.4, 7.9, -0.2, 2.5, 2.5, 2.5, 0.3));
  g.add(blob(rock(), stone, -2.4, 10.3, 0, 3.4, 1.7, 2.3, 0.2));
  g.add(blob(rock(), stone, 2.4, 10.4, 0.1, 3.5, 1.6, 2.2, -0.2));
  g.add(blob(rock(), stone, 0, 10.9, 0, 2.6, 1.3, 2.0, 0));
  g.add(blob(rock(), stone, -9.5, 0.9, 2.2, 1.6, 1.2, 1.4, 0.3));
  g.add(blob(rock(), stone, 9.8, 0.7, -1.8, 1.3, 1.0, 1.5, 0.5));
  return g;
}

/** A single towering spire of rock. */
export function rockSpire(color = '#6f6d6a') {
  const g = new THREE.Group();
  const stone = mat(color);
  g.add(mesh(new THREE.CylinderGeometry(2.4, 4.2, 7, 7), stone, 0, 3.5, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.5, 2.5, 8, 6), stone, 0.4, 10.5, 0.2));
  g.add(mesh(new THREE.CylinderGeometry(0.5, 1.6, 8, 5), stone, 0.9, 18, 0.3));
  g.add(blob(new THREE.DodecahedronGeometry(1, 0), stone, -4.4, 1.2, 1.5, 2.2, 1.7, 2.0, 0.3));
  g.add(blob(new THREE.DodecahedronGeometry(1, 0), stone, 3.8, 1.0, -2.6, 1.9, 1.4, 1.7, 0.6));
  g.add(mesh(new THREE.CylinderGeometry(0.4, 1.3, 6.5, 5), stone, -3.2, 3.2, -2.2));
  return g;
}

/** A ring of tall weathered stones. */
export function stoneCircle(color = '#8a8478', moss = '#6b7f4a') {
  const g = new THREE.Group();
  const stone = mat(color);
  const mossy = mat(moss);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const h = 3.2 + ((i * 7) % 5) * 0.55;
    const x = Math.cos(a) * 8;
    const z = Math.sin(a) * 8;
    const s = mesh(new THREE.CylinderGeometry(0.55, 0.95, h, 5), stone, x, h / 2 - 0.2, z);
    s.rotation.set(Math.sin(i * 3.1) * 0.12, a, Math.cos(i * 1.7) * 0.12);
    g.add(s);
    if (i % 2 === 0) g.add(blob(new THREE.IcosahedronGeometry(0.6, 0), mossy, x, h - 0.15, z, 1, 0.45, 1));
  }
  g.add(blob(new THREE.DodecahedronGeometry(1, 0), stone, 0, 0.5, 0, 2.2, 0.8, 1.6, 0));
  return g;
}

/** A crown of pale ice crystals with a faint inner light. */
export function iceCrown() {
  const g = new THREE.Group();
  const ice = new THREE.MeshStandardMaterial({ color: '#bfe3f5', roughness: 0.25, metalness: 0.1, flatShading: true, emissive: '#5fb6e8', emissiveIntensity: 0.45 });
  const shard = (x, z, h, r, tx, tz) => {
    const m = mesh(new THREE.ConeGeometry(r, h, 5), ice, x, h / 2 - 0.3, z);
    m.rotation.set(tx, x + z, tz);
    g.add(m);
  };
  shard(0, 0, 15, 2.1, 0, 0.04);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.3;
    const d = 3 + (i % 3) * 1.6;
    shard(Math.cos(a) * d, Math.sin(a) * d, 5 + ((i * 5) % 4) * 2.2, 0.9 + (i % 2) * 0.5, Math.sin(a) * 0.35, -Math.cos(a) * 0.35);
  }
  return g;
}

// ── Shoreline ────────────────────────────────────────────────────────────────

/** A five-armed starfish lying flat. */
export function starfish(color = '#e0703a') {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = i % 2 ? 0.055 : 0.16;
    shape[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false }).rotateX(-Math.PI / 2);
  const g = new THREE.Group();
  g.add(mesh(geo, mat(color), 0, 0.01, 0));
  return g;
}

/** A sun-bleached log washed up on the sand. */
export function driftwood() {
  const g = new THREE.Group();
  const wood = mat('#b9ad9a');
  const trunk = mesh(new THREE.CylinderGeometry(0.11, 0.16, 2.6, 6), wood, 0, 0.13, 0);
  trunk.rotation.z = Math.PI / 2 - 0.05;
  g.add(trunk);
  const branch = mesh(new THREE.CylinderGeometry(0.04, 0.07, 0.9, 5), wood, 0.5, 0.3, 0.25);
  branch.rotation.set(0.9, 0, 0.6);
  g.add(branch);
  const stub = mesh(new THREE.CylinderGeometry(0.03, 0.06, 0.5, 5), wood, -0.6, 0.25, -0.15);
  stub.rotation.set(-0.8, 0, -0.4);
  g.add(stub);
  return g;
}

/**
 * A tide pool: a ring of rocks holding still, clear water, with a few
 * creatures in it. Sits on a flat rock shelf (see shore.js).
 */
export function rockPool() {
  const g = new THREE.Group();
  const stone = mat('#8b8780');
  const dark = mat('#6f6c68');
  // The rim: low uneven rocks, with gaps between them
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + Math.sin(i * 2.1) * 0.25;
    const r = 1.55 + Math.sin(i * 1.7) * 0.2;
    const s = 0.16 + ((i * 5) % 4) * 0.045;
    g.add(blob(new THREE.DodecahedronGeometry(1, 0), i % 3 ? stone : dark, Math.cos(a) * r, s * 0.3, Math.sin(a) * r, s * 1.5, s * 0.7, s, 0.2));
  }
  // The floor of the pool, a darker damp ring round it, then the water
  g.add(mesh(new THREE.CircleGeometry(1.75, 16).rotateX(-Math.PI / 2), mat('#55534f'), 0, 0.012, 0));
  g.add(mesh(new THREE.CircleGeometry(1.4, 16).rotateX(-Math.PI / 2), mat('#3b4a47'), 0, 0.024, 0));
  const water = new THREE.MeshStandardMaterial({ color: '#4fa3a4', transparent: true, opacity: 0.5, roughness: 0.05, metalness: 0.15 });
  g.add(mesh(new THREE.CircleGeometry(1.36, 16).rotateX(-Math.PI / 2), water, 0, 0.1, 0));
  // Life: anemones, a starfish, a few pebbles
  const anemone = (color, x, z, s) => g.add(blob(new THREE.IcosahedronGeometry(0.11, 0), mat(color, { emissive: color, emissiveIntensity: 0.25 }), x, 0.06, z, s, s * 0.8, s));
  anemone('#c8405a', 0.5, 0.3, 1);
  anemone('#8a4fc0', -0.6, -0.2, 0.8);
  anemone('#e08a3a', 0.1, -0.75, 0.7);
  anemone('#c8405a', -0.25, 0.7, 0.6);
  const star = starfish('#e0703a');
  star.position.set(-0.1, 0.05, 0.1);
  star.scale.setScalar(1.4);
  g.add(star);
  for (let i = 0; i < 5; i++) g.add(blob(new THREE.DodecahedronGeometry(0.07, 0), dark, Math.cos(i * 2.4) * 0.9, 0.05, Math.sin(i * 2.4) * 0.9, 1, 0.6, 1, i));
  return g;
}

// ── Trail furniture ──────────────────────────────────────────────────────────

/** Materials whose glow should brighten at night (lanterns). main.js drives them. */
export const nightGlowMaterials = [];

/** Ring of stones, logs and a flame. Meshes named "flame" are flickered by campfire.js. */
export function campfire() {
  const g = new THREE.Group();
  const stone = mat('#6f6b66');
  const wood = mat('#4a3526');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.add(blob(new THREE.DodecahedronGeometry(0.17, 0), stone, Math.cos(a) * 0.62, 0.08, Math.sin(a) * 0.62, 1, 0.8, 1, i));
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const log = mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.8, 5), wood, Math.cos(a) * 0.17, 0.25, Math.sin(a) * 0.17);
    log.rotation.set(Math.sin(a) * 0.95, 0, -Math.cos(a) * 0.95);
    g.add(log);
  }
  const outer = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ff7a1c', emissiveIntensity: 3.2 });
  const inner = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffd27a', emissiveIntensity: 5 });
  for (const [geo, material, y] of [[new THREE.ConeGeometry(0.26, 0.75, 6), outer, 0.52], [new THREE.ConeGeometry(0.14, 0.5, 5), inner, 0.42]]) {
    const flame = mesh(geo, material, 0, y, 0);
    flame.name = 'flame';
    g.add(flame);
  }
  return g;
}

/** A log to sit on. */
export function logSeat() {
  const g = new THREE.Group();
  const log = mesh(new THREE.CylinderGeometry(0.2, 0.22, 1.5, 8), mat('#6b4d36'), 0, 0.2, 0);
  log.rotation.z = Math.PI / 2;
  g.add(log);
  return g;
}

/** A small ridge tent. */
export function tent(color = '#c9b58e') {
  const g = new THREE.Group();
  const cloth = mat(color, { side: THREE.DoubleSide });
  // A three-sided prism laid on its side, one flat face on the ground.
  const body = mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.2, 3, 1, false), cloth, 0, 0.55, 0);
  body.rotation.order = 'ZYX';
  body.rotation.set(0, Math.PI / 2, Math.PI / 2);
  g.add(body);
  return g;
}

/** A lamp post: the light sits on top, so it looks the same from every side. */
export function lantern() {
  const g = new THREE.Group();
  const wood = mat('#5d4532');
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.09, 2.3, 6), wood, 0, 1.15, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.17, 0.1, 0.08, 6), wood, 0, 2.32, 0));
  const glow = new THREE.MeshStandardMaterial({ color: '#3a2c18', emissive: '#ffc878', emissiveIntensity: 1 });
  nightGlowMaterials.push(glow);
  g.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.3, 6), glow, 0, 2.5, 0));
  g.add(mesh(new THREE.ConeGeometry(0.22, 0.16, 6), wood, 0, 2.73, 0));
  return g;
}

/** A trail signpost. */
export function signpost() {
  const g = new THREE.Group();
  const wood = mat('#7d6045');
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.07, 2.1, 6), wood, 0, 1.05, 0));
  const a = mesh(new THREE.BoxGeometry(0.85, 0.2, 0.05), wood, 0.3, 1.8, 0);
  const b = mesh(new THREE.BoxGeometry(0.75, 0.2, 0.05), wood, -0.25, 1.5, 0);
  b.rotation.y = 1.2;
  g.add(a, b);
  return g;
}

/**
 * The player's body: a plain grey block figure — cube head, wide torso with
 * block arms, block legs. Faces -Z, feet at the origin. The limbs are named
 * (legL, armL, …) so body.js can swing them.
 */
export function body() {
  const g = new THREE.Group();
  const grey = new THREE.MeshStandardMaterial({ color: '#969c9f', roughness: 1 });
  const depth = 0.3;
  const legHeight = 0.6;
  const torsoHeight = 0.71;
  const shoulder = legHeight + torsoHeight;

  // Torso
  g.add(mesh(new THREE.BoxGeometry(0.48, torsoHeight, depth), grey, 0, legHeight + torsoHeight / 2, 0));

  // Head: only casts a shadow, because the camera sits inside it.
  const shadowOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  g.add(mesh(new THREE.BoxGeometry(0.6, 0.57, 0.6), shadowOnly, 0, shoulder - 0.03 + 0.285, 0));

  for (const side of [-1, 1]) {
    const suffix = side < 0 ? 'L' : 'R';

    const leg = new THREE.Group(); // pivots at the hip
    leg.name = 'leg' + suffix;
    leg.position.set(side * 0.115, legHeight, 0);
    leg.add(mesh(new THREE.BoxGeometry(0.225, legHeight, depth), grey, 0, -legHeight / 2, 0));
    g.add(leg);

    const arm = new THREE.Group(); // pivots at the shoulder
    arm.name = 'arm' + suffix;
    arm.position.set(side * 0.38, shoulder - 0.06, 0);
    arm.add(mesh(new THREE.BoxGeometry(0.27, torsoHeight, depth), grey, 0, -torsoHeight / 2 + 0.06, 0));
    g.add(arm);
  }
  return g;
}
