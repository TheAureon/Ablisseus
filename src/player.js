// First-person walker. Keyboard + mouse on desktop, drag controls on touch
// (left half of the screen = walk, right half = look).

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { heightAt, isWalkable, spawnPoint } from './world/terrain.js';

const KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
};

export function createPlayer(camera, canvas) {
  const c = CONFIG.player;
  const [sx, sz] = spawnPoint();

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
  addEventListener('keydown', (e) => {
    down.add(e.code);
    if (enabled && !e.repeat && KEYS.jump.includes(e.code)) {
      jumpBuffer = 0.15; // remembered briefly so a press just before landing still counts
      e.preventDefault();
    }
  });
  addEventListener('keyup', (e) => down.delete(e.code));
  addEventListener('blur', () => down.clear());
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas) look(e.movementX, e.movementY);
  });

  // ── Touch ──
  const touches = new Map();
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    touches.set(e.pointerId, { startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, time: performance.now(), move: e.clientX < innerWidth / 2 });
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
    const t = touches.get(e.pointerId);
    if (t?.move) touchMove.set(0, 0);
    // A quick tap on the look side of the screen is a jump.
    else if (t && performance.now() - t.time < 250 && Math.hypot(e.clientX - t.startX, e.clientY - t.startY) < 12) {
      jumpBuffer = 0.15;
      touchJump = true; // taps always get the full-height jump
    }
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
  let jumpBuffer = 0;
  let airborne = false;
  let verticalSpeed = 0;
  let air = 0; // eased 0 on the ground … 1 mid-air, for the body pose
  let dip = 0; // landing knee-bend, a small damped spring
  let dipSpeed = 0;
  let windup = 0; // time left in the pre-jump crouch
  let recover = 0; // time after landing before you can jump again
  let touchJump = false;
  const MAX_STEP = 1 / 90;

  const ease = (rate, dt) => 1 - Math.exp(-rate * dt);

  /** Advances the player. Long frames are split up so the motion stays stable at any frame rate. */
  function update(dt) {
    const steps = Math.max(1, Math.ceil(dt / MAX_STEP));
    for (let i = 0; i < steps; i++) step(dt / steps);
  }

  function step(dt) {
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
    velocity.lerp(target, ease((speedingUp ? c.acceleration : c.deceleration) * (airborne ? c.airControl : 1), dt));

    // Move each axis separately so we slide along shorelines instead of sticking.
    const nx = position.x + velocity.x * dt;
    const nz = position.z + velocity.z * dt;
    if (isWalkable(nx, position.z)) position.x = nx;
    else velocity.x = 0;
    if (isWalkable(position.x, nz)) position.z = nz;
    else velocity.z = 0;

    // ── Vertical: follow the ground, or fly through a jump ──
    const floor = heightAt(position.x, position.z);
    const jumpHeld = held('jump') || touchJump;
    let crouch = 0;

    const launch = () => {
      verticalSpeed = Math.sqrt(2 * c.gravity * c.jumpHeight);
      airborne = true;
      onStep?.(0.7, depth > 0.2);
    };

    if (airborne) {
      // Rising is floaty, falling is quicker, and letting go early cuts the hop short.
      let gravity = c.gravity;
      if (verticalSpeed < 0) gravity *= c.fallGravity;
      else if (!jumpHeld) gravity *= c.jumpCutGravity;
      verticalSpeed -= gravity * dt;
      position.y += verticalSpeed * dt;

      if (position.y <= floor) {
        const impact = Math.min(1, -verticalSpeed / 8);
        position.y = floor;
        airborne = false;
        touchJump = false;
        dipSpeed += verticalSpeed * c.landingDip; // harder landings dip further
        velocity.multiplyScalar(1 - c.landingSlowdown * impact); // and cost a little momentum
        recover = c.jumpRecovery;
        onStep?.(0.6 + impact * 0.4, depth > 0.2);
      }
    } else {
      position.y += (floor - position.y) * ease(c.groundFollow, dt);

      if (windup > 0) {
        // Bend the knees for a moment, then push off.
        crouch = c.jumpCrouch;
        windup -= dt;
        if (windup <= 0) launch();
      } else if (jumpBuffer > 0 && recover <= 0 && c.jumpHeight > 0) {
        jumpBuffer = 0;
        windup = c.jumpWindup;
        if (windup <= 0) launch();
      }
    }
    jumpBuffer -= dt;
    recover -= dt;
    air += ((airborne ? 1 : 0) - air) * ease(airborne ? 9 : 14, dt);

    // Knee spring: pulled down while crouching, kicked by landings, then settles.
    dipSpeed += (-140 * (dip + crouch) - 17 * dipSpeed) * dt;
    dip = THREE.MathUtils.clamp(dip + dipSpeed * dt, -0.35, 0.15);

    // ── Body motion ──
    const speed = velocity.length();
    const hurry = THREE.MathUtils.clamp((speed - c.walkSpeed) / (c.sprintSpeed - c.walkSpeed || 1), 0, 1);
    moveAmount += ((airborne ? 0 : Math.min(1, speed / c.walkSpeed)) - moveAmount) * ease(6, dt);

    const previousStride = stride;
    if (!airborne) stride += ((speed * dt) / (c.strideLength * (1 + hurry * 0.35))) * Math.PI * 2;
    // A foot lands twice per stride, at the bottom of each bob.
    if (!airborne && speed > 0.6 && Math.floor(stride / Math.PI) !== Math.floor(previousStride / Math.PI)) {
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

    camera.position.set(position.x, position.y + c.eyeHeight + bob + breathe + dip, position.z);
    camera.position.addScaledVector(right, sway);
    // Crane forward when looking down so you see your feet, not your chest.
    const crane = Math.max(0, -euler.x) * CONFIG.body.lookDownLean;
    camera.position.x -= Math.sin(euler.y) * crane;
    camera.position.z -= Math.cos(euler.y) * crane;
    camera.position.y = Math.max(camera.position.y, floor + 0.3); // never sink into the ground
    camera.quaternion.setFromEuler(euler);

    Object.assign(state, { yaw: euler.y, stride, moveAmount, hurry, speed, bob: bob + dip, air });
  }

  /** Motion state for anything that follows the player (the body, for now). */
  const state = { position, yaw: c.startYaw, stride: 0, moveAmount: 0, hurry: 0, speed: 0, bob: 0, air: 0 };

  let onStep = null;

  return {
    position,
    state,
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
