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
  let enabled = false;

  const held = (action) => KEYS[action].some((code) => down.has(code));

  function look(dx, dy) {
    lookTarget.yaw -= dx * c.lookSensitivity;
    lookTarget.pitch = THREE.MathUtils.clamp(lookTarget.pitch - dy * c.lookSensitivity, -1.45, 1.45);
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

  const right = new THREE.Vector3();
  const lookTarget = { yaw: c.startYaw, pitch: 0 };
  let stride = 0; // walking cycle phase; one full turn = two steps
  let moveAmount = 0; // 0 standing … 1 walking, eased so the bob fades in and out
  let lean = 0;
  let time = 0;
  let fovOffset = 0;

  const ease = (rate, dt) => 1 - Math.exp(-rate * dt);

  function update(dt) {
    time += dt;

    // ── Look: ease toward where the mouse has pointed ──
    const lookEase = c.lookSmoothing > 0 ? ease(1 / c.lookSmoothing, dt) : 1;
    euler.y += (lookTarget.yaw - euler.y) * lookEase;
    euler.x += (lookTarget.pitch - euler.x) * lookEase;

    // ── Desired velocity ──
    let x = touchMove.x;
    let z = touchMove.y;
    if (enabled) {
      x += (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
      z += (held('back') ? 1 : 0) - (held('forward') ? 1 : 0);
    }
    target.set(x, 0, z).clampLength(0, 1);
    const sprinting = held('sprint') && target.z < -0.1;

    // Backwards and sideways are slower than forwards.
    let pace = sprinting ? c.sprintSpeed : c.walkSpeed;
    if (target.z > 0) pace *= c.backwardFactor;
    pace *= 1 - (1 - c.strafeFactor) * Math.abs(target.x);

    target.applyAxisAngle(THREE.Object3D.DEFAULT_UP, euler.y);

    // Slopes: slower uphill, a touch quicker downhill.
    const ground = heightAt(position.x, position.z);
    if (target.lengthSq() > 0.001) {
      const ahead = heightAt(position.x + target.x * 0.6, position.z + target.z * 0.6);
      const grade = (ahead - ground) / 0.6;
      pace *= THREE.MathUtils.clamp(1 - grade * c.slopeEffect, 0.45, 1.15);
    }
    // Wading
    const depth = THREE.MathUtils.clamp((CONFIG.water.level - ground) / c.wadeDepth, 0, 1);
    pace *= 1 - depth * c.wadeSlowdown;

    target.multiplyScalar(pace);

    // Speeding up is gentler than slowing down.
    const speedingUp = target.lengthSq() > velocity.lengthSq();
    velocity.lerp(target, ease(speedingUp ? c.acceleration : c.deceleration, dt));

    // Move each axis separately so we slide along shorelines instead of sticking.
    const nx = position.x + velocity.x * dt;
    const nz = position.z + velocity.z * dt;
    if (isWalkable(nx, position.z)) position.x = nx;
    else velocity.x = 0;
    if (isWalkable(position.x, nz)) position.z = nz;
    else velocity.z = 0;

    position.y += (heightAt(position.x, position.z) - position.y) * ease(c.groundFollow, dt);

    // ── Body motion ──
    const speed = velocity.length();
    const hurry = THREE.MathUtils.clamp((speed - c.walkSpeed) / (c.sprintSpeed - c.walkSpeed || 1), 0, 1);
    moveAmount += (Math.min(1, speed / c.walkSpeed) - moveAmount) * ease(6, dt);

    const previousStride = stride;
    stride += ((speed * dt) / (c.strideLength * (1 + hurry * 0.35))) * Math.PI * 2;
    // A foot lands twice per stride, at the bottom of each bob.
    if (speed > 0.6 && Math.floor(stride / Math.PI) !== Math.floor(previousStride / Math.PI)) {
      onStep?.(0.6 + hurry * 0.4, depth > 0.2);
    }

    const bobScale = moveAmount * (1 + hurry * 0.5);
    const bob = -(1 - Math.abs(Math.sin(stride))) * c.bobAmount * bobScale; // dips sharply as each foot lands
    const sway = Math.sin(stride) * c.swayAmount * bobScale;
    const breathe = Math.sin(time * 1.5) * c.breatheAmount * (1 - moveAmount * 0.7);

    right.set(Math.cos(euler.y), 0, -Math.sin(euler.y));
    const sideSpeed = velocity.dot(right);
    lean += ((-sideSpeed / c.walkSpeed) * c.strafeLean - lean) * ease(5, dt);
    euler.z = lean + Math.sin(stride) * c.bobRoll * bobScale;

    fovOffset += (hurry * c.sprintFov - fovOffset) * ease(3, dt);

    camera.position.set(position.x, position.y + c.eyeHeight + bob + breathe, position.z);
    camera.position.addScaledVector(right, sway);
    camera.quaternion.setFromEuler(euler);
  }

  let onStep = null;

  return {
    position,
    update,
    get fovOffset() {
      return fovOffset;
    },
    /** Called with (strength 0..1, inWater) each time a foot lands. */
    set onStep(fn) {
      onStep = fn;
    },
    setEnabled: (v) => {
      enabled = v;
      if (!v) down.clear();
    },
  };
}
