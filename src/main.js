// Entry point: builds the world and runs the frame loop.
// Tunable values are in config.js; model assignments are in assets.js.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import GUI from 'lil-gui';

import { CONFIG, QUALITY_PRESETS } from './config.js';
import { atmosphere, GradeShader, GodRaysPass, HillShadowBaker } from './atmosphere.js'; // (first: it upgrades the fog for every material made after)
import { loadAssets } from './assets.js';
import { createTerrain, createWater, createHeightTexture, terrainUniforms, waterNearness, heightAt } from './world/terrain.js';
import { placeTidePools } from './world/shore.js';
import { biomeWeights, blend, blendColor, dominant, biomeLabel, biomeIndex, BIOME_NAMES } from './world/biomes.js';
import { createScatter, createPlacedProps, updateScatter, canopies } from './world/scatter.js';
import { placeLandmarks, createLandmarks } from './world/landmarks.js';
import { createTrails } from './world/trails.js';
import { buildRivers, rivers, createRiverWater, createBridges, distanceToRiver } from './world/river.js';
import { createCampfires } from './world/campfire.js';
import { createHorizon } from './world/horizon.js';
import { nightGlowMaterials } from './placeholders.js';
import { createSky } from './world/sky.js';
import { createMotes } from './world/motes.js';
import { createPlayer } from './player.js';
import { createBody } from './body.js';
import { createMap } from './map.js';
import { startAudio, playFootstep, updateSoundscape } from './audio.js';

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
// How bright light and colour roll off into white: 'neutral' keeps hues truest; 'aces' is punchier and warmer; 'agx' is softest.
renderer.toneMapping = { neutral: THREE.NeutralToneMapping, aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping }[CONFIG.render.toneMapping] ?? THREE.NeutralToneMapping;
renderer.shadowMap.enabled = CONFIG.render.shadows;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CONFIG.render.fov, innerWidth / innerHeight, 0.1, 12000);

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
const godRays = new GodRaysPass();
composer.addPass(godRays);
composer.addPass(bloom);
const grade = new ShaderPass(GradeShader);
grade.enabled = CONFIG.render.grade.enabled;
composer.addPass(grade);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ── World ───────────────────────────────────────────────────────────────────
const live = { time: CONFIG.title.time ?? CONFIG.time.start, fog: 1, tidePhase: -0.9 }; // values the tweak panel changes at runtime
const adaptive = { scale: 1, frames: 0, seconds: 0, goodSeconds: 0, patience: 4, warmup: 3, steppedUp: false }; // resolution auto-scaling state

const templates = await loadAssets();

// Landmarks choose their spots first, trails are planned between them, and
// only then is everything else grown around the paths.
buildRivers(); // (rivers cut their valleys into the land before anything else reads it)
const tidePools = placeTidePools(); // (these reshape the shore, so they go first)
const landmarks = placeLandmarks();
const trails = createTrails(landmarks);
const heightTexture = createHeightTexture();
const hillShadows = new HillShadowBaker(renderer, heightTexture);
const water = createWater(heightTexture);
const scatter = createScatter(templates, trails); // (before the terrain, which shades the ground under the trees)
scene.add(createTerrain(trails.texture, canopies), water, scatter, createLandmarks(templates, landmarks));
if (tidePools.length) scene.add(createPlacedProps(templates.rockPool, 'rockPool', tidePools, { castShadow: false, drawDistance: 220 }));
for (const [asset, placements] of Object.entries(trails.props)) {
  if (placements.length) scene.add(createPlacedProps(templates[asset], asset, placements, { drawDistance: 380 }));
}
const riverWater = createRiverWater(heightTexture);
scene.add(riverWater.object, createBridges(trails.bridges));
const campfires = createCampfires(templates.campfire, trails.campfires);
scene.add(campfires.object);


const sky = createSky(scene, renderer);
const horizon = createHorizon();
scene.add(horizon.object);
const motes = createMotes();
scene.add(motes.object);

const player = createPlayer(camera, canvas);

// Compile every shader up front so the first steps don't stutter.
updateScatter(camera.position);
await renderer.compileAsync(scene, camera);
// Footsteps sound like whatever is underfoot.
player.onStep = (strength, inWater) => {
  const { x, z } = player.position;
  const surface = inWater ? 'water' : trails.pathAt(x, z) > 0.4 ? 'path' : CONFIG.biomes.types[BIOME_NAMES[currentBiome]]?.footstep ?? 'grass';
  playFootstep(strength, surface);
};
const body = createBody(templates.body);
scene.add(body.object);

// ── Map ─────────────────────────────────────────────────────────────────────
const map = createMap({ landmarks, trails });
if (CONFIG.ui.map.enabled) {
  addEventListener('keydown', (e) => {
    if (e.code === CONFIG.ui.map.key && !e.repeat && overlay.classList.contains('hidden')) map.toggle();
    if (e.code === 'Escape') map.close();
  });
  document.getElementById('map-button').addEventListener('click', () => map.toggle());
  document.getElementById('map').addEventListener('click', () => map.close());
} else {
  document.getElementById('map-button').remove();
}

// ── Title view ──────────────────────────────────────────────────────────────
// Until you click, the camera hangs high over the island and drifts slowly.
// Then it glides down to your eyes, the fog and clouds easing back to normal.
const title = { active: true, leaving: false, progress: 0, cloudsWere: CONFIG.sky.clouds.cover };
const titleSpot = (() => {
  const T = CONFIG.title;
  const anchor = landmarks.find((lm) => lm.asset === T.around) ?? { x: CONFIG.player.spawn[0], z: CONFIG.player.spawn[1] };
  return {
    camera: new THREE.Vector3(anchor.x + T.camera[0], T.camera[1], anchor.z + T.camera[2]),
    target: new THREE.Vector3(anchor.x + T.lookAt[0], T.lookAt[1], anchor.z + T.lookAt[2]),
  };
})();
const titleCamera = new THREE.PerspectiveCamera(); // (a camera, so lookAt aims its view rather than its back)
const firstPerson = new THREE.Object3D();

function updateTitle(dt, elapsed) {
  if (!title.active) return;
  const T = CONFIG.title;
  // The drifting overhead view: a slow swing around the point it looks at.
  const swing = Math.sin(elapsed * 0.05) * T.drift;
  const offset = titleSpot.camera.clone().sub(titleSpot.target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, swing);
  titleCamera.position.copy(titleSpot.target).add(offset);
  titleCamera.lookAt(titleSpot.target);

  if (title.leaving) title.progress = Math.min(1, title.progress + dt / T.descentSeconds);
  const k = title.progress * title.progress * (3 - 2 * title.progress); // ease in and out
  // Blend from the title view to where the player's own camera is this frame.
  firstPerson.position.copy(camera.position);
  firstPerson.quaternion.copy(camera.quaternion);
  camera.position.lerpVectors(titleCamera.position, firstPerson.position, k);
  camera.quaternion.slerpQuaternions(titleCamera.quaternion, firstPerson.quaternion, k);
  if (k < 1) camera.position.y = Math.max(camera.position.y, heightAt(camera.position.x, camera.position.z) + 2.5); // never fly through a hill
  CONFIG.sky.clouds.cover = THREE.MathUtils.lerp(T.clouds, title.cloudsWere, k);
  titleFog = THREE.MathUtils.lerp(T.fog, 1, k);
  if (title.progress >= 1) {
    title.active = false;
    titleFog = 1;
  }
}
let titleFog = CONFIG.title.fog;

// ── Coordinates readout ─────────────────────────────────────────────────────
// x is east, z is south (north is up on the map), y is height above the sea.
const coordsText = document.getElementById('coords');
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
let coordsTimer = 0;
function updateCoords(dt) {
  if (!coordsText.classList.contains('show') || (coordsTimer -= dt) > 0) return;
  coordsTimer = 0.1; // ten times a second is plenty
  const { x, y, z } = player.position;
  const yaw = player.state.yaw;
  // Facing: the way you look, measured clockwise from north.
  const bearing = ((Math.atan2(-Math.sin(yaw), Math.cos(yaw)) * 180) / Math.PI + 360) % 360;
  coordsText.textContent = `X ${Math.round(x)}   Y ${Math.round(y)}   Z ${Math.round(z)}\n${COMPASS[Math.round(bearing / 45) % 8]} ${Math.round(bearing)}°`;
}
addEventListener('keydown', (e) => {
  if (e.code === 'KeyC' && !e.repeat && overlay.classList.contains('hidden')) {
    CONFIG.ui.coordinates = !CONFIG.ui.coordinates;
    coordsText.classList.toggle('show', CONFIG.ui.coordinates);
    coordsTimer = 0;
  }
});

// ── Start / pause ───────────────────────────────────────────────────────────
overlayStatus.textContent = isTouch ? 'tap to wander' : 'click to wander';
overlay.classList.remove('loading'); // the world is ready: let the view show through

function begin() {
  if (overlay.classList.contains('hidden')) return;
  overlay.classList.add('hidden');
  title.leaving = true;
  if (CONFIG.ui.crosshair) crosshair.style.opacity = CONFIG.ui.crosshairOpacity;
  coordsText.classList.toggle('show', CONFIG.ui.coordinates);
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
  // Quality: remembered by the browser, and needs a reload to take effect.
  const quality = { preset: CONFIG.render.quality };
  gui.add(quality, 'preset', [...Object.keys(QUALITY_PRESETS), 'custom']).name('quality (reloads)').onChange((value) => {
    try {
      localStorage.setItem('terra.quality', value);
    } catch {
      // (storage unavailable)
    }
    location.reload();
  });
  gui.add(live, 'time', 0, 1, 0.001).name('time of day').listen();
  gui.add(CONFIG.time, 'paused').name('freeze time');
  gui.add(CONFIG.time, 'dayLengthSeconds', 30, 3600, 10).name('day length (s)');
  gui.add(live, 'fog', 0, 4, 0.05).name('fog amount');
  gui.add(live, 'tidePhase', -Math.PI, Math.PI, 0.01).name('tide (shift)');
  gui.add(CONFIG.water.waves, 'height', 0, 0.6, 0.01).name('wave height');
  gui.add(CONFIG.player, 'walkSpeed', 1, 15, 0.1).name('walk speed');
  gui.add(CONFIG.player, 'sprintSpeed', 1, 40, 0.5).name('sprint speed');
  gui.add(CONFIG.body, 'enabled').name('show body');
  gui.add(bloomCfg, 'enabled').name('bloom');
  gui.add(bloomCfg, 'strength', 0, 2, 0.01).name('bloom strength');
  gui.add(grade, 'enabled').name('colour grade');
  gui.add(CONFIG.render.godRays, 'enabled').name('light shafts');
  gui.add(atmosphere.uAtmoCloudShadow, 'value', 0, 1, 0.01).name('cloud shadows');
  gui.add(atmosphere.uAtmoRim, 'value', 0, 1.5, 0.01).name('rim light');
  gui.add(atmosphere.uAtmoMist, 'value', 0, 1, 0.01).name('mist patches');
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
window.TERRA = { rivers, CONFIG, scene, camera, renderer, player, live, adaptive, trails, landmarks, map, heightAt, atmosphere, hillShadows, title };

// ── Frame loop ──────────────────────────────────────────────────────────────
const timer = new THREE.Timer();
const waterColor = new THREE.Color();
const sunOnScreen = new THREE.Vector3();

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

// Shows a place name for a few seconds: a biome as you walk well into it, a
// landmark as you reach it.
const placeText = document.getElementById('biome');
let currentBiome = -1;
let currentLandmark = null;
let placeTimer = null;
function announce(text) {
  if (!CONFIG.ui.biomeLabel || !text) return;
  placeText.textContent = text;
  placeText.classList.add('show');
  clearTimeout(placeTimer);
  placeTimer = setTimeout(() => placeText.classList.remove('show'), 4500);
}
function announceBiome(index, weights) {
  if (index === currentBiome || weights[index] < 0.7) return;
  const first = currentBiome < 0;
  currentBiome = index;
  if (!first) announce(biomeLabel(index)); // no announcement for where you start
}
function announceLandmark(position) {
  const near = landmarks.find((lm) => Math.hypot(lm.x - position.x, lm.z - position.z) < lm.radius + 22);
  if (near && near !== currentLandmark) announce(near.label);
  if (near || !currentLandmark || Math.hypot(currentLandmark.x - position.x, currentLandmark.z - position.z) > 90) currentLandmark = near ?? null;
}

// Surroundings that are a little costly to work out are refreshed a few times a second.
const woodedBiomes = ['pines', 'autumn', 'jungle', 'marsh', 'fungal', 'bamboo', 'birch'].map(biomeIndex).filter((i) => i >= 0);
const surroundings = { water: 0, timer: 0 };
const frameWeights = new Float32Array(BIOME_NAMES.length); // this frame's biome mix, kept separate from the shared scratch array

renderer.setAnimationLoop(() => {
  timer.update();
  const rawDt = timer.getDelta();
  const dt = Math.min(rawDt, 0.1);
  adaptResolution(rawDt);
  const elapsed = timer.getElapsed();

  if (!CONFIG.time.paused && !(title.active && !title.leaving)) live.time = (live.time + dt / CONFIG.time.dayLengthSeconds) % 1;

  player.update(dt);
  riverWater.update(elapsed);
  updateTitle(dt, elapsed);
  body.update(dt, player.state);
  map.update(player.position, player.state.yaw);
  updateCoords(dt);
  updateScatter(camera.position);
  // The biome you are standing in tints the air: fog thickness and mote colour.
  const weights = biomeWeights(player.position.x, player.position.z, frameWeights);
  biomeFog += (blend(weights, 'fog', 1) - biomeFog) * Math.min(1, dt * 0.8);
  moteColor.lerp(blendColor(weights, 'motes', moteTarget, CONFIG.motes.color), Math.min(1, dt * 0.8));
  announceBiome(dominant(weights), weights);
  announceLandmark(player.position);

  // Height above the sea: the air clears as you climb, and the view opens.
  const altitude = Math.max(0, camera.position.y - CONFIG.player.eyeHeight - CONFIG.water.level);
  const snowIndex = biomeIndex('snow');
  const aurora = THREE.MathUtils.lerp(CONFIG.sky.aurora.strength, CONFIG.sky.aurora.inSnow, snowIndex >= 0 ? weights[snowIndex] : 0);

  // Campfires, lanterns and the soundscape all follow where you are and the hour.
  const night = sky.state.stars ?? 0;
  const fireDistance = campfires.update(elapsed, player.position);
  for (const material of nightGlowMaterials) material.emissiveIntensity = THREE.MathUtils.lerp(CONFIG.lanterns.dayGlow, CONFIG.lanterns.nightGlow, night);
  surroundings.timer -= dt;
  if (surroundings.timer <= 0) {
    surroundings.timer = 0.25;
    surroundings.water = Math.max(waterNearness(player.position.x, player.position.z), 0.8 * (1 - Math.min(1, distanceToRiver(player.position.x, player.position.z) / 28)));
  }
  updateSoundscape(dt, {
    wind: blend(weights, 'wind', 1) + THREE.MathUtils.smoothstep(altitude, 25, 80) * CONFIG.audio.altitudeWind,
    leaves: blend(weights, 'leaves', 0),
    birds: blend(weights, 'birds', 0),
    crickets: blend(weights, 'crickets', 0),
    woods: woodedBiomes.reduce((sum, i) => sum + weights[i], 0),
    night,
    water: surroundings.water,
    fire: 1 - THREE.MathUtils.smoothstep(fireDistance, 2, 28),
    awe: Math.max(THREE.MathUtils.smoothstep(altitude, 22, 70), currentLandmark ? 0.8 : 0),
  });

  sky.update(live.time, camera.position, live.fog * biomeFog * titleFog, { time: elapsed, aurora, dt });
  horizon.update(sky.state, sky.lightDir);

  // Tell every shader what the light is doing.
  atmosphere.uTime.value = elapsed;
  atmosphere.uFogSunDir.value.copy(sky.lightDir);
  atmosphere.uFogSunColor.value.copy(sky.state.lightColor).multiplyScalar(Math.min(sky.state.lightIntensity, 3) * CONFIG.atmosphere.sunGlow);
  atmosphere.uSkyColor.value.copy(sky.state.skyHorizon).lerp(sky.state.skyTop, 0.35);
  atmosphere.uAtmoTime.value = elapsed;
  atmosphere.uAtmoSky.value.copy(sky.state.skyHorizon).lerp(sky.state.skyTop, 0.5).multiplyScalar(sky.state.ambientIntensity);
  atmosphere.uAtmoCloudCover.value = CONFIG.sky.clouds.cover;
  atmosphere.uAtmoSkyTop.value.copy(sky.state.skyTop);
  hillShadows.update(sky.lightDir);
  atmosphere.uAtmoSkyHorizon.value.copy(sky.state.skyHorizon);

  // Light shafts: find where the sun is on screen; fade them out as it leaves view, climbs high or sets.
  const G = CONFIG.render.godRays;
  let shafts = 0;
  if (G.enabled && sky.sunDir.y > -0.06) {
    sunOnScreen.copy(camera.position).addScaledVector(sky.sunDir, 1000).project(camera);
    const inFront = sunOnScreen.z < 1;
    const offScreen = Math.max(Math.abs(sunOnScreen.x), Math.abs(sunOnScreen.y));
    const low = 1 - THREE.MathUtils.smoothstep(sky.sunDir.y, 0.3, 0.85) * 0.75; // strongest when the sun is low
    shafts = inFront ? G.strength * low * (1 - THREE.MathUtils.smoothstep(offScreen, 0.85, 1.35)) * THREE.MathUtils.smoothstep(sky.sunDir.y, -0.06, 0.03) : 0;
  }
  godRays.aim(sunOnScreen.x * 0.5 + 0.5, sunOnScreen.y * 0.5 + 0.5, shafts, camera.aspect);
  motes.update(elapsed, camera.position, sky.state.motes, moteColor);

  waterColor.copy(water.userData.baseColor).lerp(sky.state.skyHorizon, CONFIG.water.skyTint);
  water.material.color.copy(waterColor);
  // The sheet of water follows you (in whole steps, so its mesh doesn't shimmer)
  // and rises and falls with the tide.
  const tide = CONFIG.water.tide;
  const seaLevel = CONFIG.water.level + (tide.range > 0 ? Math.sin((elapsed / tide.periodSeconds) * Math.PI * 2 + live.tidePhase) * tide.range * 0.5 : 0);
  water.position.set(Math.round(camera.position.x / 4) * 4, seaLevel, Math.round(camera.position.z / 4) * 4);
  water.userData.uniforms.uTime.value = elapsed;
  water.userData.uniforms.uWaveHeight.value = CONFIG.water.waves.height;
  terrainUniforms.uSeaLevel.value = seaLevel;

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
