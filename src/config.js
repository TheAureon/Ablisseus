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
    jumpHeight: 0.8, // metres when the key is held (0 = no jumping)
    gravity: 14, // on the way up; lower = floatier
    fallGravity: 1.5, // ×gravity on the way down, so you don't hang in the air
    jumpCutGravity: 2.4, // ×gravity if you let go early — tap for a small hop
    jumpWindup: 0.09, // seconds of knee-bend before leaving the ground (0 = instant)
    jumpCrouch: 0.22, // how hard the knees pull down during the windup
    jumpRecovery: 0.12, // seconds after landing before you can jump again
    airControl: 0.3, // how much you can steer mid-air (0..1)
    landingDip: 0.18, // how much the knees give on landing
    landingSlowdown: 0.3, // momentum lost on a hard landing (0..1)

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
    size: 1000, // mesh width in metres
    segments: 340, // mesh resolution
    islandRadius: 380, // land fades into the sea at this distance
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
      // (grass/ground colours are per biome, below)
      sand: '#cdbb8e',
      rock: '#77736d', // steep slopes
      seabed: '#4b5a55',
    },
    sandHeight: 1.0, // sand below this height (above water level)
    rockSlope: 0.28, // 0 = flat, 1 = vertical
  },

  water: {
    level: 0,
    color: '#2f6f86',
    opacity: 0.82,
    skyTint: 0.2, // how much the water picks up the horizon colour
  },

  // ── Biomes ────────────────────────────────────────────────────────────────
  // Regions of the island, each with its own look. Add, remove or edit entries
  // freely; props are assigned to a biome with `biome: 'name'` in `scatter` below.
  //   ground / groundAlt – the two ground colours noise-blended together
  //   heightScale        – hilliness (1 = normal, <1 flatter, >1 more rugged)
  //   heightOffset       – raises or lowers the whole region (metres)
  //   fog                – fog multiplier while you are inside it
  //   motes              – colour of the drifting specks in the air
  //   bias               – makes the biome more (+) or less (−) common, e.g. 0.2
  biomes: {
    scale: 0.0032, // lower = larger regions
    sharpness: 9, // higher = harder borders between biomes
    spawn: 'meadow', // biome you start in
    spawnRadius: 90, // how much of it is guaranteed around the spawn point
    types: {
      meadow:  { label: 'The Meadow',      ground: '#5f8f4a', groundAlt: '#7da052', heightScale: 0.8,  heightOffset: 0,   fog: 1.0,  motes: '#ffe9a8' },
      pines:   { label: 'Pinewood',        ground: '#3f6a44', groundAlt: '#557a4a', heightScale: 1.15, heightOffset: 2,   fog: 1.35, motes: '#d8f0c0' },
      autumn:  { label: 'Emberwood',       ground: '#9a7b3c', groundAlt: '#b08a45', heightScale: 1.0,  heightOffset: 1,   fog: 1.15, motes: '#ffb870' },
      desert:  { label: 'The Pale Dunes',  ground: '#d9c08a', groundAlt: '#cdaa72', heightScale: 0.45, heightOffset: 2.5, fog: 0.6,  motes: '#f5dfb0', bias: 0.08 },
      snow:    { label: 'Whitereach',      ground: '#e8eef2', groundAlt: '#cfdbe4', heightScale: 1.7,  heightOffset: 7,   fog: 1.6,  motes: '#ffffff', bias: -0.08 },
      blossom: { label: 'Blossom Hollow',  ground: '#7fae72', groundAlt: '#9cc48a', heightScale: 0.65, heightOffset: 0.5, fog: 0.9,  motes: '#ffc4dd' },
    },
  },

  // ── Scattered props ───────────────────────────────────────────────────────
  // Each layer scatters one asset (see assets.js) over the island.
  //   biome: which biome it grows in (omit to scatter everywhere)
  //   height: [min, max] allowed ground height   maxSlope: 0..1
  //   cluster: { scale, threshold } — noise mask; higher threshold = sparser groves
  //   sway: wind bend amount   colorJitter: per-instance tint variation
  //   drawDistance: metres beyond which it is not drawn (big performance lever for grass)
  scatter: [
    // Meadow — open grass, flowers, the odd tree
    { biome: 'meadow',  asset: 'grass',       count: 20000, height: [1.2, 30], maxSlope: 0.4,  scale: [1.0, 2.2], cluster: { scale: 0.03, threshold: -0.35 }, sway: 0.25, colorJitter: 0.3, drawDistance: 150 },
    { biome: 'meadow',  asset: 'flower',      count: 1800,  height: [1.5, 20], maxSlope: 0.3,  scale: [0.7, 1.3], cluster: { scale: 0.02, threshold: 0.2 }, sway: 0.12, colorJitter: 0.1, drawDistance: 130 },
    { biome: 'meadow',  asset: 'tree',        count: 150,   height: [1.5, 20], maxSlope: 0.35, scale: [0.8, 1.5], cluster: { scale: 0.010, threshold: 0.1 }, sway: 0.015, colorJitter: 0.25, castShadow: true },
    { biome: 'meadow',  asset: 'rock',        count: 70,    height: [-1, 60],  maxSlope: 1.0,  scale: [0.4, 1.8], colorJitter: 0.2, castShadow: true, sink: 0.15, drawDistance: 420 },

    // Pinewood — dense dark conifers
    { biome: 'pines',   asset: 'pine',        count: 1300,  height: [2, 60],   maxSlope: 0.5,  scale: [0.8, 1.9], sway: 0.012, colorJitter: 0.25, castShadow: true },
    { biome: 'pines',   asset: 'grassDark',   count: 9000,  height: [1.2, 40], maxSlope: 0.45, scale: [0.9, 1.8], cluster: { scale: 0.03, threshold: -0.2 }, sway: 0.2, colorJitter: 0.3, drawDistance: 150 },
    { biome: 'pines',   asset: 'rock',        count: 160,   height: [-1, 60],  maxSlope: 1.0,  scale: [0.5, 2.4], colorJitter: 0.2, castShadow: true, sink: 0.15, drawDistance: 420 },

    // Emberwood — orange and gold broadleaf woods
    { biome: 'autumn',  asset: 'treeAutumn',  count: 420,   height: [1.5, 40], maxSlope: 0.4,  scale: [0.8, 1.6], sway: 0.015, colorJitter: 0.3, castShadow: true },
    { biome: 'autumn',  asset: 'treeGold',    count: 260,   height: [1.5, 40], maxSlope: 0.4,  scale: [0.8, 1.6], sway: 0.015, colorJitter: 0.2, castShadow: true },
    { biome: 'autumn',  asset: 'grassDry',    count: 11000, height: [1.2, 40], maxSlope: 0.4,  scale: [0.9, 2.0], cluster: { scale: 0.03, threshold: -0.3 }, sway: 0.25, colorJitter: 0.25, drawDistance: 150 },
    { biome: 'autumn',  asset: 'rock',        count: 80,    height: [-1, 60],  maxSlope: 1.0,  scale: [0.4, 2.0], colorJitter: 0.2, castShadow: true, sink: 0.15, drawDistance: 420 },

    // The Pale Dunes — sand, cacti, scrub
    { biome: 'desert',  asset: 'cactus',      count: 200,   height: [1.5, 30], maxSlope: 0.3,  scale: [0.7, 1.6], colorJitter: 0.2, castShadow: true },
    { biome: 'desert',  asset: 'bush',        count: 600,   height: [1.2, 30], maxSlope: 0.4,  scale: [0.6, 1.5], cluster: { scale: 0.02, threshold: -0.1 }, colorJitter: 0.3, castShadow: true, drawDistance: 320 },
    { biome: 'desert',  asset: 'rockSand',    count: 320,   height: [-1, 60],  maxSlope: 1.0,  scale: [0.4, 3.0], colorJitter: 0.2, castShadow: true, sink: 0.15, drawDistance: 420 },
    { biome: 'desert',  asset: 'grassDry',    count: 2500,  height: [1.2, 30], maxSlope: 0.4,  scale: [0.8, 1.6], cluster: { scale: 0.04, threshold: 0.3 }, sway: 0.25, colorJitter: 0.25, drawDistance: 150 },

    // Whitereach — snowy heights
    { biome: 'snow',    asset: 'pineSnow',    count: 520,   height: [2, 80],   maxSlope: 0.5,  scale: [0.8, 1.8], cluster: { scale: 0.012, threshold: -0.1 }, sway: 0.01, colorJitter: 0.1, castShadow: true },
    { biome: 'snow',    asset: 'rockSnow',    count: 300,   height: [-1, 90],  maxSlope: 1.2,  scale: [0.5, 3.0], colorJitter: 0.15, castShadow: true, sink: 0.15, drawDistance: 420 },

    // Blossom Hollow — pink trees over soft pale grass
    { biome: 'blossom', asset: 'treeBlossom', count: 420,   height: [1.5, 30], maxSlope: 0.4,  scale: [0.8, 1.6], sway: 0.02, colorJitter: 0.15, castShadow: true },
    { biome: 'blossom', asset: 'grassPale',   count: 15000, height: [1.2, 30], maxSlope: 0.4,  scale: [1.0, 2.0], cluster: { scale: 0.03, threshold: -0.35 }, sway: 0.25, colorJitter: 0.2, drawDistance: 150 },
    { biome: 'blossom', asset: 'flowerPink',  count: 2200,  height: [1.2, 30], maxSlope: 0.35, scale: [0.7, 1.4], cluster: { scale: 0.02, threshold: -0.1 }, sway: 0.12, colorJitter: 0.1, drawDistance: 130 },
  ],

  // Unique hand-placed objects. position is [x, z]; y snaps to the ground.
  landmarks: [
    { asset: 'beacon', position: [40, -55], scale: 1, rotation: 0 },
    { asset: 'beacon', position: [-170, 90], scale: 1.3, rotation: 1 },
    { asset: 'beacon', position: [160, 170], scale: 1.1, rotation: 2 },
    { asset: 'beacon', position: [220, -120], scale: 1.2, rotation: 3 },
    { asset: 'beacon', position: [-90, -230], scale: 1.2, rotation: 4 },
    { asset: 'beacon', position: [-250, -60], scale: 1.4, rotation: 5 },
    { asset: 'arch',   position: [-30, -140], scale: 1, rotation: 0.4 },
    { asset: 'arch',   position: [120, 40], scale: 1.2, rotation: 1.3 },
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
maxPixelRatio: 1.5, // sharpness cap on high-density screens (2 = sharper, 1 = faster)
    antialias: 4, // MSAA samples: 0, 2 or 4
    // Automatically lowers the rendering resolution when the frame rate drops,
    // and raises it again when there is headroom.
    adaptive: { enabled: true, targetFps: 55, minScale: 0.55 },
    chunkSize: 110, // props are culled in square chunks this many metres wide
    drawDistanceScale: 1, // multiplies every scatter layer's drawDistance
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
    biomeLabel: true, // show a region's name for a moment as you enter it
  },

  debug: {
    gui: true, // press G in-game for a live tweak panel
  },
};
