// First-person walker. Keyboard + mouse on desktop, drag controls on touch
// (left half of the screen = walk, right half = look).

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { heightAt, isWalkable, findDryLand } from './world/terrain.js';

const KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
};

export function createPlayer(camera, canvas) {
  const c = CONFIG.player;
  const [sx, sz] = findDryLand(c.spawn[0], c.spawn[1]);

  const position = new THREE.Vector3(sx, heightAt(sx, sz), sz);
  const velocity = new THREE.Vector3();
  const target = new THREE.Vector3();
  const euler = new THREE.Euler(0, c.startYaw, 0, 'YXZ');
  const down = new Set();
  const touchMove = new THREE.Vector2();
  let bobPhase = 0;
  let enabled = false;

  const held = (action) => KEYS[action].some((code) => down.has(code));

  function look(dx, dy) {
    euler.y -= dx * c.lookSensitivity;
    euler.x = THREE.MathUtils.clamp(euler.x - dy * c.lookSensitivity, -1.45, 1.45);
  }

  // ── Keyboard & mouse ──
  addEventListener('keydown', (e) => down.add(e.code));
  addEventListener('keyup', (e) => down.delete(e.code));
  addEventListener('blur', () => down.clear());
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas) look(e.movementX, e.movementY);
  });

  // ── Touch ──
  const touches = new Map();
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    touches.set(e.pointerId, { startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, move: e.clientX < innerWidth / 2 });
  });
  canvas.addEventListener('pointermove', (e) => {
    const t = touches.get(e.pointerId);
    if (!t) return;
    if (t.move) {
      touchMove.set(e.clientX - t.startX, e.clientY - t.startY).divideScalar(60).clampLength(0, 1);
    } else {
      look((e.clientX - t.x) * 2.5, (e.clientY - t.y) * 2.5);
    }
    t.x = e.clientX;
    t.y = e.clientY;
  });
  const endTouch = (e) => {
    if (touches.get(e.pointerId)?.move) touchMove.set(0, 0);
    touches.delete(e.pointerId);
  };
  canvas.addEventListener('pointerup', endTouch);
  canvas.addEventListener('pointercancel', endTouch);

  function update(dt) {
    // Desired direction in the player's local space, then rotated by yaw.
    let x = touchMove.x;
    let z = touchMove.y;
    if (enabled) {
      x += (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
      z += (held('back') ? 1 : 0) - (held('forward') ? 1 : 0);
    }
    target.set(x, 0, z).clampLength(0, 1);
    target.applyAxisAngle(THREE.Object3D.DEFAULT_UP, euler.y);
    target.multiplyScalar(held('sprint') ? c.sprintSpeed : c.walkSpeed);

    velocity.lerp(target, 1 - Math.exp(-c.acceleration * dt));

    // Move each axis separately so we slide along shorelines instead of sticking.
    const nx = position.x + velocity.x * dt;
    const nz = position.z + velocity.z * dt;
    if (isWalkable(nx, position.z)) position.x = nx;
    else velocity.x = 0;
    if (isWalkable(position.x, nz)) position.z = nz;
    else velocity.z = 0;

    // Follow the ground smoothly.
    const ground = heightAt(position.x, position.z);
    position.y += (ground - position.y) * (1 - Math.exp(-14 * dt));

    const speed = velocity.length();
    bobPhase += speed * dt * c.bobFrequency * Math.PI;
    const bob = Math.sin(bobPhase) * c.bobAmount * Math.min(1, speed / c.walkSpeed);

    camera.position.set(position.x, position.y + c.eyeHeight + bob, position.z);
    camera.quaternion.setFromEuler(euler);
  }

  return {
    position,
    update,
    setEnabled: (v) => {
      enabled = v;
      if (!v) down.clear();
    },
  };
}
