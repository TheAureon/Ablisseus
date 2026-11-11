// Entry point: builds the world and runs the frame loop.
// Tunable values are in config.js; model assignments are in assets.js.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import GUI from 'lil-gui';

import { CONFIG } from './config.js';
import { loadAssets } from './assets.js';
import { createTerrain, createWater } from './world/terrain.js';
import { biomeWeights, blend, blendColor, dominant, biomeLabel } from './world/biomes.js';
import { createScatter, createLandmarks, updateScatter, windUniforms } from './world/scatter.js';
import { createSky } from './world/sky.js';
import { createMotes } from './world/motes.js';
import { createPlayer } from './player.js';
import { createBody } from './body.js';
import { startAudio, playFootstep } from './audio.js';

const canvas = document.getElementById('scene');
const overlay = document.getElementById('overlay');
const overlayStatus = document.getElementById('overlay-status');
const hint = document.getElementById('hint');
const crosshair = document.getElementById('crosshair');
crosshair.style.width = crosshair.style.height = CONFIG.ui.crosshairSize + 'px';
const isTouch = matchMedia('(pointer: coarse)').matches;

// ── Renderer ────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const basePixelRatio = Math.min(devicePixelRatio, CONFIG.render.maxPixelRatio);
renderer.setPixelRatio(basePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = CONFIG.render.shadows;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CONFIG.render.fov, innerWidth / innerHeight, 0.1, 3000);

// ── Post-processing (bloom) ─────────────────────────────────────────────────
const bloomCfg = CONFIG.render.bloom;
const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: CONFIG.render.antialias }),
);
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(innerWidth, innerHeight);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), bloomCfg.strength, bloomCfg.radius, bloomCfg.threshold);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(bloom);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ── World ───────────────────────────────────────────────────────────────────
const live = { time: CONFIG.time.start, fog: 1 }; // values the tweak panel changes at runtime
const adaptive = { scale: 1, frames: 0, seconds: 0, goodSeconds: 0, patience: 4, warmup: 3, steppedUp: false }; // resolution auto-scaling state

const templates = await loadAssets();
const water = createWater();
scene.add(createTerrain(), water, createScatter(templates), createLandmarks(templates));

const sky = createSky(scene);
const motes = createMotes();
scene.add(motes.object);

const player = createPlayer(camera, canvas);

// Compile every shader up front so the first steps don't stutter.
updateScatter(camera.position);
await renderer.compileAsync(scene, camera);
player.onStep = playFootstep;
const body = createBody(templates.body);
scene.add(body.object);

// ── Start / pause ───────────────────────────────────────────────────────────
overlayStatus.textContent = isTouch ? 'tap to wander' : 'click to wander';

function begin() {
  overlay.classList.add('hidden');
  if (CONFIG.ui.crosshair) crosshair.style.opacity = CONFIG.ui.crosshairOpacity;
  startAudio();
  if (isTouch) player.setEnabled(true);
  else canvas.requestPointerLock();
}
overlay.addEventListener('click', begin);
canvas.addEventListener('click', () => {
  if (!isTouch && overlay.classList.contains('hidden')) canvas.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  player.setEnabled(locked);
  hint.classList.toggle('show', !locked && overlay.classList.contains('hidden'));
});

// ── Tweak panel (press G; Esc frees the mouse so you can use it) ─────────────
if (CONFIG.debug.gui) {
  const gui = new GUI({ title: 'Terra Ablisseus — tweaks' });
  gui.add(live, 'time', 0, 1, 0.001).name('time of day').listen();
  gui.add(CONFIG.time, 'paused').name('freeze time');
  gui.add(CONFIG.time, 'dayLengthSeconds', 30, 3600, 10).name('day length (s)');
  gui.add(live, 'fog', 0, 4, 0.05).name('fog amount');
  gui.add(CONFIG.player, 'walkSpeed', 1, 15, 0.1).name('walk speed');
  gui.add(CONFIG.player, 'sprintSpeed', 1, 40, 0.5).name('sprint speed');
  gui.add(CONFIG.body, 'enabled').name('show body');
  gui.add(bloomCfg, 'enabled').name('bloom');
  gui.add(bloomCfg, 'strength', 0, 2, 0.01).name('bloom strength');
  gui.add(CONFIG.render, 'fov', 40, 100, 1).name('field of view');
  gui.add(CONFIG.render, 'drawDistanceScale', 0.3, 3, 0.05).name('draw distance');
  gui.add(CONFIG.render.adaptive, 'enabled').name('auto resolution');
  gui.add(adaptive, 'scale').name('resolution scale').listen().disable();
  gui.hide();
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyG') gui.show(gui._hidden);
  });
}

// Handy for poking at things from the browser console.
window.TERRA = { CONFIG, scene, camera, renderer, player, live, adaptive };

// ── Frame loop ──────────────────────────────────────────────────────────────
const timer = new THREE.Timer();
const waterColor = new THREE.Color();

// ── Adaptive resolution ─────────────────────────────────────────────────────
// Once a second, compare the frame rate with the target. Too slow: render at a
// lower resolution. Comfortably fast for a while: step back up. Each failed
// step up makes the next attempt wait longer, so it settles instead of hunting.
function adaptResolution(rawDt) {
  const a = CONFIG.render.adaptive;
  if (!a.enabled || document.hidden || rawDt > 2) return; // ignore the pause after switching tabs
  if (adaptive.warmup > 0) return void (adaptive.warmup -= rawDt);
  adaptive.frames++;
  adaptive.seconds += rawDt;
  if (adaptive.seconds < 1) return;
  const fps = adaptive.frames / adaptive.seconds;
  adaptive.frames = adaptive.seconds = 0;

  let scale = adaptive.scale;
  if (fps < a.targetFps - 7 && scale > a.minScale) {
    scale = Math.max(a.minScale, scale - 0.15);
    if (adaptive.steppedUp) adaptive.patience = Math.min(60, adaptive.patience * 2);
    adaptive.steppedUp = false;
    adaptive.goodSeconds = 0;
  } else if (fps >= a.targetFps - 1 && scale < 1) {
    if (++adaptive.goodSeconds >= adaptive.patience) {
      scale = Math.min(1, scale + 0.15);
      adaptive.steppedUp = true;
      adaptive.goodSeconds = 0;
    }
  } else {
    adaptive.goodSeconds = 0;
    adaptive.steppedUp = false;
  }

  if (scale !== adaptive.scale) {
    adaptive.scale = scale;
    renderer.setPixelRatio(basePixelRatio * scale);
    composer.setPixelRatio(basePixelRatio * scale);
    composer.setSize(innerWidth, innerHeight);
  }
}
const moteColor = new THREE.Color(CONFIG.motes.color);
const moteTarget = new THREE.Color();
let biomeFog = 1;

// Shows a region's name for a few seconds when you walk well into it.
const biomeText = document.getElementById('biome');
let currentBiome = -1;
let biomeTimer = null;
function announceBiome(index, weights) {
  if (index === currentBiome || weights[index] < 0.7) return;
  const first = currentBiome < 0;
  currentBiome = index;
  if (first || !CONFIG.ui.biomeLabel) return; // no announcement for where you start
  biomeText.textContent = biomeLabel(index);
  biomeText.classList.add('show');
  clearTimeout(biomeTimer);
  biomeTimer = setTimeout(() => biomeText.classList.remove('show'), 4500);
}

renderer.setAnimationLoop(() => {
  timer.update();
  const rawDt = timer.getDelta();
  const dt = Math.min(rawDt, 0.1);
  adaptResolution(rawDt);
  const elapsed = timer.getElapsed();

  if (!CONFIG.time.paused) live.time = (live.time + dt / CONFIG.time.dayLengthSeconds) % 1;

  player.update(dt);
  body.update(dt, player.state);
  updateScatter(camera.position);
  // The biome you are standing in tints the air: fog thickness and mote colour.
  const weights = biomeWeights(player.position.x, player.position.z);
  biomeFog += (blend(weights, 'fog', 1) - biomeFog) * Math.min(1, dt * 0.8);
  moteColor.lerp(blendColor(weights, 'motes', moteTarget, CONFIG.motes.color), Math.min(1, dt * 0.8));
  announceBiome(dominant(weights), weights);

  sky.update(live.time, camera.position, live.fog * biomeFog);
  motes.update(elapsed, camera.position, sky.state.motes, moteColor);
  windUniforms.uTime.value = elapsed;

  waterColor.copy(water.userData.baseColor).lerp(sky.state.skyHorizon, CONFIG.water.skyTint);
  water.material.color.copy(waterColor);
  water.position.x = camera.position.x;
  water.position.z = camera.position.z;

  renderer.toneMappingExposure = sky.state.exposure;
  const fov = CONFIG.render.fov + player.fovOffset;
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  bloom.enabled = bloomCfg.enabled;
  bloom.strength = bloomCfg.strength;
  composer.render(dt);
});
