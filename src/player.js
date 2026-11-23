// First-person walker. Keyboard + mouse on desktop, drag controls on touch
// (left half of the screen = walk, right half = look).

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { heightAt, spawnPoint, terrainUniforms, swellAt } from './world/terrain.js';
import { atmosphere } from './atmosphere.js';
import { walkHeightAt, riverWaterAt, riverAt, tunnelBlocks } from './world/river.js';

/** Where your feet rest: the ground, a bridge deck, or the hill over a tunnel (judged from where your feet were). */
let feet = Infinity;
const standAt = (x, z) => walkHeightAt(x, z, heightAt(x, z), feet);

const KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  // Spectator flying
  fly: ['KeyF'],
  up: ['Space', 'KeyE'],
  down: ['KeyQ'],
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
    if (enabled && !e.repeat && KEYS.fly.includes(e.code) && CONFIG.spectator.enabled) setFlying(!flying);
    if (enabled && !e.repeat && KEYS.jump.includes(e.code) && !flying) {
      jumpBuffer = 0.15; // remembered briefly so a press just before landing still counts
      e.preventDefault();
    }
  });
  addEventListener('keyup', (e) => down.delete(e.code));
  addEventListener('blur', () => down.clear());
  // When the mouse is first captured, browsers can report one bogus jump (the
  // cursor's distance from the screen centre), sometimes even before announcing
  // the capture. So the first movement after each capture is ignored, as is any
  // single jump too large to be a real hand movement.
  let freshLock = true;
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) {
      freshLock = true;
      return;
    }
    if (freshLock) {
      freshLock = false;
      return;
    }
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
    look(e.movementX, e.movementY);
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
  let swim = 0; // eased 0 on your feet … 1 swimming
  let stroke = 0; // swimming stroke phase
  let lastStroke = 0;
  const MAX_STEP = 1 / 90;

  const ease = (rate, dt) => 1 - Math.exp(-rate * dt);

  /** Advances the player. Long frames are split up so the motion stays stable at any frame rate. */
  function update(dt) {
    feet = position.y;
    const steps = Math.max(1, Math.ceil(dt / MAX_STEP));
    for (let i = 0; i < steps; i++) step(dt / steps);
  }

  function step(dt) {
    time += dt;

    // ── Look: ease toward where the mouse has pointed ──
    const lookEase = c.lookSmoothing > 0 ? ease(1 / c.lookSmoothing, dt) : 1;
    euler.y += (lookTarget.yaw - euler.y) * lookEase;
    euler.x += (lookTarget.pitch - euler.x) * lookEase;

    if (flying) {
      flyStep(dt);
      return;
    }

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

    const backwards = target.z > 0;
    target.applyAxisAngle(THREE.Object3D.DEFAULT_UP, euler.y);

    // ── Water ──
    // Wading slows you more the deeper you go. Once the water is deep enough
    // to float in, your feet leave the bottom and you swim.
    const ground = standAt(position.x, position.z);
    const seaLevel = terrainUniforms.uSeaLevel.value; // includes the tide
    const riverLevel = riverWaterAt(position.x, position.z); // (a river's surface is calm, and above the sea)
    const inRiver = riverLevel > seaLevel;
    const depth = Math.max(0, (inRiver ? riverLevel : seaLevel) - ground); // metres of water here
    const surface = inRiver ? riverLevel : seaLevel + swellAt(position.x, position.z, atmosphere.uTime.value) * 0.7; // you ride the swell
    const floatY = surface - c.swimFloatDepth; // where your feet hang when floating
    const swimming = !airborne && floatY > ground;
    const swimSpeed = c.walkSpeed * c.swimFactor; // (read each frame, so the G panel's speed sliders apply)
    swim += ((swimming ? 1 : 0) - swim) * ease(4, dt);

    if (swimming) {
      pace = held('sprint') ? c.sprintSpeed * c.swimSprintFactor : swimSpeed;
      if (backwards) pace *= 0.6; // backwards is awkward
    } else {
      // Knee-deep barely matters; chest-deep is slow going.
      const wade = Math.min(1, depth / c.swimFloatDepth);
      pace = THREE.MathUtils.lerp(pace, Math.min(pace, swimSpeed), wade * wade);
    }

    // Slopes: slower uphill, a touch quicker downhill (not while afloat).
    if (!swimming && target.lengthSq() > 0.001) {
      const ahead = standAt(position.x + target.x * 0.6, position.z + target.z * 0.6);
      const grade = (ahead - ground) / 0.6;
      pace *= THREE.MathUtils.clamp(1 - grade * c.slopeEffect, 0.45, 1.15);
    }
    target.multiplyScalar(pace);

    // A swimming stroke: a pull, then a glide.
    if (swimming && target.lengthSq() > 0.001) {
      stroke += dt * c.strokeRate * Math.PI * 2 * (held('sprint') ? 1.35 : 1);
      target.multiplyScalar((0.72 + 0.56 * Math.max(0, Math.sin(stroke)) ** 2) / 0.86); // averages out to the set swim speed
    }

    // Speeding up is gentler than slowing down; water is slower still to respond.
    const speedingUp = target.lengthSq() > velocity.lengthSq();
    velocity.lerp(target, ease((speedingUp ? c.acceleration : c.deceleration) * (airborne ? c.airControl : 1) * (swimming ? 0.45 : 1), dt));

    // The world has an edge far out to sea: a current eases you back toward land.
    const edge = CONFIG.terrain.size / 2 - 60;
    if (Math.abs(position.x) > edge) velocity.x -= Math.sign(position.x) * (Math.abs(position.x) - edge) * 0.08 * dt * 60 * 0.05;
    if (Math.abs(position.z) > edge) velocity.z -= Math.sign(position.z) * (Math.abs(position.z) - edge) * 0.08 * dt * 60 * 0.05;

    feet = position.y;
    const wasX = position.x;
    const wasZ = position.z;
    position.x += velocity.x * dt;
    position.z += velocity.z * dt;
    // A tunnel's walls are solid: slide along them rather than through.
    if (tunnelBlocks(position.x, position.z, feet)) {
      if (!tunnelBlocks(position.x, wasZ, feet)) position.z = wasZ;
      else if (!tunnelBlocks(wasX, position.z, feet)) position.x = wasX;
      else {
        position.x = wasX;
        position.z = wasZ;
      }
    }
    // A river's current carries you gently downstream while you're in it.
    const current = depth > 0.25 && inRiver ? riverAt(position.x, position.z) : null;
    if (current) {
      const pull = (swimming ? 0.6 : 0.25) * dt;
      position.x += current.dirX * pull;
      position.z += current.dirZ * pull;
    }

    // ── Vertical: follow the ground, or fly through a jump ──
    const floor = Math.max(standAt(position.x, position.z), floatY); // solid ground, or the depth you float at
    const jumpHeld = held('jump') || touchJump;
    let crouch = 0;

    const launch = () => {
      verticalSpeed = Math.sqrt(2 * c.gravity * c.jumpHeight);
      airborne = true;
      onStep?.(0.7, depth > 0.12);
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
        onStep?.(0.6 + impact * 0.4, depth > 0.12);
      }
    } else {
      position.y += (floor - position.y) * ease(swimming ? 5 : c.groundFollow, dt);

      if (windup > 0) {
        // Bend the knees for a moment, then push off.
        crouch = c.jumpCrouch;
        windup -= dt;
        if (windup <= 0) launch();
      } else if (jumpBuffer > 0 && recover <= 0 && c.jumpHeight > 0 && depth < c.jumpMaxDepth && !swimming) {
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
    moveAmount += ((airborne || swimming ? 0 : Math.min(1, speed / c.walkSpeed)) - moveAmount) * ease(6, dt);

    const previousStride = stride;
    if (!airborne && !swimming) stride += ((speed * dt) / (c.strideLength * (1 + hurry * 0.35))) * Math.PI * 2;
    // A foot lands twice per stride, at the bottom of each bob.
    if (!airborne && !swimming && speed > 0.6 && Math.floor(stride / Math.PI) !== Math.floor(previousStride / Math.PI)) {
      onStep?.(0.6 + hurry * 0.4, depth > 0.12);
    }
    // Each swimming stroke makes a soft splash.
    if (swimming && speed > 0.4 && Math.floor(stroke / (Math.PI * 2)) !== lastStroke) {
      lastStroke = Math.floor(stroke / (Math.PI * 2));
      onStep?.(0.45, true);
    }

    const bobScale = moveAmount * (1 + hurry * 0.5);
    const bob = -(1 - Math.abs(Math.sin(stride))) * c.bobAmount * bobScale; // dips sharply as each foot lands
    const sway = Math.sin(stride) * c.swayAmount * bobScale;
    const breathe = Math.sin(time * 1.5) * c.breatheAmount * (1 - moveAmount * 0.7);

    right.set(Math.cos(euler.y), 0, -Math.sin(euler.y));
    const sideSpeed = velocity.dot(right);
    lean += ((-sideSpeed / c.walkSpeed) * c.strafeLean - lean) * ease(5, dt);
    const strokeBob = swim * Math.min(1, speed / (c.walkSpeed * c.swimFactor));
    euler.z = lean + Math.sin(stride) * c.bobRoll * bobScale + Math.sin(stroke * 0.5) * 0.012 * strokeBob;

    fovOffset += (hurry * c.sprintFov - fovOffset) * ease(3, dt);

    camera.position.set(position.x, position.y + c.eyeHeight + bob + breathe + dip * (1 - swim) + Math.sin(stroke) * 0.035 * strokeBob, position.z);
    camera.position.addScaledVector(right, sway);
    // Crane forward when looking down so you see your feet, not your chest.
    const crane = Math.max(0, -euler.x) * CONFIG.body.lookDownLean;
    camera.position.x -= Math.sin(euler.y) * crane;
    camera.position.z -= Math.cos(euler.y) * crane;
    camera.position.y = Math.max(camera.position.y, standAt(position.x, position.z) + 0.3); // never sink into the ground
    if (depth > 0.5) camera.position.y = Math.max(camera.position.y, surface + 0.12); // keep your eyes above the water
    camera.quaternion.setFromEuler(euler);

    Object.assign(state, { yaw: euler.y, stride, moveAmount, hurry, speed, bob: bob + dip, air, swim, stroke });
  }

  // ── Spectator: fly freely, straight where you look ──
  // Forward/back follow your gaze (look up to climb); Space or E rises, Q
  // sinks; Shift is faster; the scroll wheel sets the speed. You can't go
  // below the ground. Press F again to drop to the ground where you are.
  let flying = false;
  let flySpeedScale = 1;
  const flyVelocity = new THREE.Vector3();
  const flyWish = new THREE.Vector3();
  const gaze = new THREE.Vector3();
  const side = new THREE.Vector3();

  function setFlying(on) {
    flying = on;
    flyVelocity.set(0, 0, 0);
    velocity.set(0, 0, 0);
    if (on) {
      airborne = false;
      swim = 0;
      euler.z = 0;
    } else {
      // Back on your feet on the ground below (or in the water there).
      airborne = false;
      verticalSpeed = 0;
      position.y = standAt(position.x, position.z);
    }
    state.flying = on;
  }

  addEventListener(
    'wheel',
    (e) => {
      if (!flying) return;
      flySpeedScale = THREE.MathUtils.clamp(flySpeedScale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.1, 20);
    },
    { passive: true },
  );

  function flyStep(dt) {
    const S = CONFIG.spectator;
    let fx = touchMove.x;
    let fz = touchMove.y;
    let fy = 0;
    if (enabled) {
      fx += (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
      fz += (held('back') ? 1 : 0) - (held('forward') ? 1 : 0);
      fy += (held('up') ? 1 : 0) - (held('down') ? 1 : 0);
    }
    gaze.set(0, 0, -1).applyEuler(euler);
    side.set(1, 0, 0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, euler.y);
    flyWish.set(0, 0, 0).addScaledVector(gaze, -fz).addScaledVector(side, fx);
    flyWish.y += fy;
    if (flyWish.lengthSq() > 1) flyWish.normalize();
    flyWish.multiplyScalar(S.speed * flySpeedScale * (held('sprint') ? S.fastMultiplier : 1));
    flyVelocity.lerp(flyWish, ease(flyWish.lengthSq() > flyVelocity.lengthSq() ? S.acceleration : S.deceleration, dt));

    position.addScaledVector(flyVelocity, dt);
    const half = CONFIG.terrain.size / 2;
    position.x = THREE.MathUtils.clamp(position.x, -half, half);
    position.z = THREE.MathUtils.clamp(position.z, -half, half);
    position.y = THREE.MathUtils.clamp(position.y, standAt(position.x, position.z) + S.minHeight - c.eyeHeight, S.maxHeight);

    euler.z = 0;
    fovOffset += (0 - fovOffset) * ease(3, dt);
    camera.position.set(position.x, position.y + c.eyeHeight, position.z);
    camera.quaternion.setFromEuler(euler);
    Object.assign(state, { yaw: euler.y, stride, moveAmount: 0, hurry: 0, speed: flyVelocity.length(), bob: 0, air: 0, swim: 0, stroke });
  }

  /** Motion state for anything that follows the player (the body, for now). */
  const state = { position, yaw: c.startYaw, stride: 0, moveAmount: 0, hurry: 0, speed: 0, bob: 0, air: 0, swim: 0, stroke: 0, flying: false };

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
    get flying() {
      return flying;
    },
    setFlying,
    setEnabled: (v) => {
      enabled = v;
      if (!v) down.clear();
    },
  };
}
