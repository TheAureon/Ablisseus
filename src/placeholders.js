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

export function pine() {
  const g = new THREE.Group();
  const leaves = mat('#2f5d3a');
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.2, 1.6, 6), mat('#5b4332'), 0, 0.8, 0));
  g.add(mesh(new THREE.ConeGeometry(1.5, 2.6, 7), leaves, 0, 2.4, 0));
  g.add(mesh(new THREE.ConeGeometry(1.15, 2.2, 7), leaves, 0, 3.7, 0));
  g.add(mesh(new THREE.ConeGeometry(0.75, 1.9, 7), leaves, 0, 4.9, 0));
  return g;
}

export function tree() {
  const g = new THREE.Group();
  const leaves = mat('#6f9a45');
  g.add(mesh(new THREE.CylinderGeometry(0.14, 0.24, 2.4, 6), mat('#6a4f3a'), 0, 1.2, 0));
  g.add(mesh(new THREE.IcosahedronGeometry(1.6, 0), leaves, 0, 3.4, 0));
  g.add(mesh(new THREE.IcosahedronGeometry(1.1, 0), leaves, 0.9, 2.9, 0.4));
  g.add(mesh(new THREE.IcosahedronGeometry(1.0, 0), leaves, -0.8, 3.0, -0.5));
  return g;
}

export function rock() {
  const m = mesh(new THREE.DodecahedronGeometry(0.7, 0), mat('#807b74'), 0, 0.3, 0);
  m.scale.set(1.2, 0.7, 0.9);
  const g = new THREE.Group();
  g.add(m);
  return g;
}

/** A tuft of a few flat blades, built as one geometry so it instances cheaply. */
export function grass() {
  const blades = 6;
  const positions = [];
  const normals = [];
  const colors = [];
  const base = new THREE.Color('#4f7f3c');
  const tip = new THREE.Color('#a9c66a');

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

    positions.push(cx - dx, 0, cz - dz, cx + dx, 0, cz + dz, cx + Math.cos(angle) * lean, h, cz + Math.sin(angle) * lean);
    // Normals point straight up so tufts are lit evenly, like the ground.
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    colors.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide })));
  return g;
}

export function flower() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 4), mat('#5a8a3f'), 0, 0.2, 0));
  g.add(mesh(new THREE.IcosahedronGeometry(0.07, 0), mat('#f2e6ff', { emissive: '#b79cff', emissiveIntensity: 0.35 }), 0, 0.43, 0));
  return g;
}

/** A standing stone crowned with a soft light — something to walk toward. */
export function beacon() {
  const g = new THREE.Group();
  const stone = mat('#6d6a70');
  g.add(mesh(new THREE.CylinderGeometry(0.45, 0.8, 5, 5), stone, 0, 2.5, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.3, 1.5, 0.4, 7), stone, 0, 0.1, 0));
  const glow = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffd9a0', emissiveIntensity: 4 });
  g.add(mesh(new THREE.IcosahedronGeometry(0.35, 1), glow, 0, 5.7, 0));
  const light = new THREE.PointLight('#ffd9a0', 30, 30, 2);
  light.position.set(0, 5.7, 0);
  g.add(light);
  return g;
}

export function arch() {
  const g = new THREE.Group();
  const stone = mat('#8a857c');
  g.add(mesh(new THREE.BoxGeometry(1, 5, 1), stone, -2, 2.5, 0));
  g.add(mesh(new THREE.BoxGeometry(1, 5, 1), stone, 2, 2.5, 0));
  g.add(mesh(new THREE.BoxGeometry(6, 0.9, 1.2), stone, 0, 5.4, 0));
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
