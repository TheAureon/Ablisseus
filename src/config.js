// ─────────────────────────────────────────────────────────────────────────────
//  TERRA ABLISSEUS — every tweakable number lives in this file.
//  Change a value, save, and the dev server reloads the world.
//  (3D models are assigned in assets.js.)
// ─────────────────────────────────────────────────────────────────────────────

export const CONFIG = {
  seed: 7, // change for a completely different island

  // ── Player ────────────────────────────────────────────────────────────────
  player: {
    eyeHeight: 1.7,

    // Pace
    walkSpeed: 2.6, // metres / second
    sprintSpeed: 5.2,
    backwardFactor: 0.7, // walking backwards is slower
    strafeFactor: 0.85, // so is sidestepping
    acceleration: 4.5, // how quickly you get up to speed (lower = heavier)
    deceleration: 6.5, // how quickly you come to rest
    slopeEffect: 0.7, // uphill slows you, downhill speeds you up a little (0 = off)
    wadeSlowdown: 0.45, // speed lost when knee-deep in water (0 = none)

    // Jumping
    jumpHeight: 0.85, // metres (0 = no jumping)
    gravity: 17, // higher = quicker, snappier hops
    airControl: 0.3, // how much you can steer mid-air (0..1)
    landingDip: 0.11, // how much the knees give on landing

    // Looking
    lookSensitivity: 0.002,
    lookSmoothing: 0.045, // seconds of easing on mouse look (0 = raw input)

    // Body motion — set any of these to 0 to switch it off
    strideLength: 1.55, // metres per two steps; longer = slower bob
    bobAmount: 0.032, // up/down per step
    swayAmount: 0.018, // side-to-side weight shift per stride
    bobRoll: 0.0035, // head tilt per stride (radians)
    strafeLean: 0.014, // lean into sidesteps (radians)
    breatheAmount: 0.006, // slow idle rise and fall
    sprintFov: 4, // extra field of view while hurrying (degrees)
    groundFollow: 10, // how tightly the eyes follow bumps (lower = floatier)

    wadeDepth: 0.6, // how deep into water you can walk
    spawn: [0, 0], // x, z — snaps to the nearest dry land
    startYaw: 0.6, // initial facing, radians
  },

  // Your own body, visible when you look down (model is set in assets.js).
  body: {
    enabled: true,
    backOffset: 0.1, // how far the body sits behind the eyes
    lookDownLean: 0.1, // eyes move forward as you look down, like craning your neck
    legSwing: 0.5, // radians
    kneeBend: 0.9,
    armSwing: 0.32,
    airTuck: 0.45, // how much the legs tuck up mid-jump
  },

  // ── Terrain ───────────────────────────────────────────────────────────────
  terrain: {
    size: 700, // mesh width in metres
    segments: 280, // mesh resolution
    islandRadius: 260, // land fades into the sea at this distance
    islandFalloffStart: 0.55, // fraction of radius where the fade begins
    baseHeight: 5, // average land height above sea level
    amplitude: 20, // hill height
    frequency: 0.006, // lower = broader hills
    octaves: 5,
    persistence: 0.45,
    lacunarity: 2.1,
    seabedDepth: 8,
    flatShading: false, // true = faceted low-poly look
    colors: {
      sand: '#cdbb8e',
      grass: '#5f8f4a',
      grassAlt: '#7da052', // noise-blended with `grass` for variation
      highland: '#93a06a', // above `highlandHeight`
      rock: '#77736d', // steep slopes
      seabed: '#4b5a55',
    },
    sandHeight: 1.0, // sand below this height (above water level)
    highlandHeight: 16,
    rockSlope: 0.28, // 0 = flat, 1 = vertical
  },

  water: {
    level: 0,
    color: '#2f6f86',
    opacity: 0.82,
    skyTint: 0.2, // how much the water picks up the horizon colour
  },

  // ── Scattered props ───────────────────────────────────────────────────────
  // Each layer scatters one asset (see assets.js) over the island.
  //   height: [min, max] allowed ground height   maxSlope: 0..1
  //   cluster: { scale, threshold } — noise mask; higher threshold = sparser groves
  //   sway: wind bend amount   colorJitter: per-instance tint variation
  scatter: [
    { asset: 'pine',   count: 1100,  height: [2.5, 40], maxSlope: 0.45, scale: [0.8, 1.7], cluster: { scale: 0.012, threshold: 0.05 }, sway: 0.012, colorJitter: 0.25, castShadow: true },
    { asset: 'tree',   count: 350,   height: [1.5, 14], maxSlope: 0.35, scale: [0.8, 1.5], cluster: { scale: 0.010, threshold: -0.25, invert: true }, sway: 0.015, colorJitter: 0.25, castShadow: true },
    { asset: 'rock',   count: 500,   height: [-1, 60],  maxSlope: 1.0,  scale: [0.4, 2.2], colorJitter: 0.2, castShadow: true, sink: 0.15 },
    { asset: 'grass',  count: 60000, height: [1.2, 22], maxSlope: 0.4,  scale: [1.0, 2.2], cluster: { scale: 0.03, threshold: -0.35 }, sway: 0.25, colorJitter: 0.3 },
    { asset: 'flower', count: 2500,  height: [1.5, 14], maxSlope: 0.3,  scale: [0.7, 1.3], cluster: { scale: 0.02, threshold: 0.35 }, sway: 0.12, colorJitter: 0.1 },
  ],

  // Unique hand-placed objects. position is [x, z]; y snaps to the ground.
  landmarks: [
    { asset: 'beacon', position: [40, -55], scale: 1, rotation: 0 },
    { asset: 'beacon', position: [-120, 60], scale: 1.3, rotation: 1 },
    { asset: 'beacon', position: [110, 120], scale: 1.1, rotation: 2 },
    { asset: 'arch',   position: [-30, -140], scale: 1, rotation: 0.4 },
  ],

  wind: { speed: 1.4 },

  // ── Time of day ───────────────────────────────────────────────────────────
  // t: 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset.
  time: {
    start: 0.69,
    dayLengthSeconds: 720, // real seconds for a full day; larger = slower
    paused: false,
  },

  // Everything in a keyframe is blended to the next one. Add/remove keyframes
  // freely (keep them sorted by t, keep t=0 and t=1 identical).
  // `light` is the sun by day and the moon by night.
  sky: {
    sunTilt: 0.35, // how far the sun's arc leans off vertical
    keyframes: [
      { t: 0.00, skyTop: '#04050d', skyHorizon: '#141c3a', lightColor: '#8fa8ff', lightIntensity: 1.1, ambientSky: '#4a5c9c', ambientGround: '#1d2440', ambientIntensity: 1.7, fogDensity: 0.0050, stars: 1.0, motes: 1.0, exposure: 1.35},
      { t: 0.21, skyTop: '#0a0d24', skyHorizon: '#2a2c55', lightColor: '#8fa8ff', lightIntensity: 1.1, ambientSky: '#4a5c9c', ambientGround: '#1d2440', ambientIntensity: 1.7, fogDensity: 0.0060, stars: 0.8, motes: 0.9, exposure: 1.35},
      { t: 0.25, skyTop: '#2a3a78', skyHorizon: '#e58d6e', lightColor: '#ff9e6b', lightIntensity: 0.0,  ambientSky: '#6f6a9a', ambientGround: '#2a2230', ambientIntensity: 1.6,  fogDensity: 0.0075, stars: 0.15, motes: 0.4, exposure: 1.15},
      { t: 0.30, skyTop: '#3d6cb8', skyHorizon: '#ffc79a', lightColor: '#ffc592', lightIntensity: 1.8,  ambientSky: '#9bb3d9', ambientGround: '#4a4034', ambientIntensity: 0.8,  fogDensity: 0.0065, stars: 0.0, motes: 0.25, exposure: 1.0 },
      { t: 0.40, skyTop: '#3a82d4', skyHorizon: '#c4e2f2', lightColor: '#fff3dd', lightIntensity: 3.0,  ambientSky: '#b5d3f0', ambientGround: '#5a5a44', ambientIntensity: 0.9,  fogDensity: 0.0035, stars: 0.0, motes: 0.15, exposure: 1.0 },
      { t: 0.60, skyTop: '#3a7fcf', skyHorizon: '#cfe3ea', lightColor: '#fff0d2', lightIntensity: 3.0,  ambientSky: '#b5d0ea', ambientGround: '#5a5a44', ambientIntensity: 0.9,  fogDensity: 0.0035, stars: 0.0, motes: 0.15, exposure: 1.0 },
      { t: 0.70, skyTop: '#3f66b0', skyHorizon: '#ffcf9c', lightColor: '#ffbf85', lightIntensity: 2.2,  ambientSky: '#a7b4d6', ambientGround: '#4f4234', ambientIntensity: 0.8,  fogDensity: 0.0055, stars: 0.0, motes: 0.3, exposure: 1.0 },
      { t: 0.75, skyTop: '#2b2f6e', skyHorizon: '#f07a52', lightColor: '#ff8a55', lightIntensity: 0.0,  ambientSky: '#77669a', ambientGround: '#2c2030', ambientIntensity: 1.6,  fogDensity: 0.0075, stars: 0.15, motes: 0.6, exposure: 1.15},
      { t: 0.80, skyTop: '#0c0f2c', skyHorizon: '#3a2f5c', lightColor: '#8fa8ff', lightIntensity: 1.1, ambientSky: '#4a5c9c', ambientGround: '#1d2440', ambientIntensity: 1.7, fogDensity: 0.0060, stars: 0.8, motes: 1.0, exposure: 1.35},
      { t: 1.00, skyTop: '#04050d', skyHorizon: '#141c3a', lightColor: '#8fa8ff', lightIntensity: 1.1, ambientSky: '#4a5c9c', ambientGround: '#1d2440', ambientIntensity: 1.7, fogDensity: 0.0050, stars: 1.0, motes: 1.0, exposure: 1.35},
    ],
    starCount: 1800,
  },

  // Drifting specks of light — pollen by day, fireflies by night.
  motes: {
    count: 500,
    box: [70, 14, 70], // volume around the player they live in
    size: 5,
    color: '#ffe9a8',
  },

  // ── Rendering ─────────────────────────────────────────────────────────────
  render: {
    fov: 65,
    maxPixelRatio: 2, // lower to 1 for more performance
    shadows: true,
    shadowMapSize: 2048,
    shadowDistance: 70, // radius around the player that receives shadows
    bloom: { enabled: true, strength: 0.35, radius: 0.7, threshold: 0.9 },
  },

  // ── Audio ─────────────────────────────────────────────────────────────────
  audio: {
    wind: true, // procedurally generated wind, no file needed
    windVolume: 0.12,
    footsteps: true, // soft synthesised footfalls
    footstepVolume: 0.1,
    music: null, // e.g. 'audio/ambient.mp3' (put the file in /audio)
    musicVolume: 0.5,
  },

  ui: {
    crosshair: true, // small dot in the centre of the screen
    crosshairSize: 4, // pixels
    crosshairOpacity: 0.55,
  },

  debug: {
    gui: true, // press G in-game for a live tweak panel
  },
};
