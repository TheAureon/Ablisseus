// ─────────────────────────────────────────────────────────────────────────────
//  TERRA ABLISSEUS — every tweakable number lives in this file.
//  Change a value, save, and the dev server reloads the world.
//  (3D models are assigned in assets.js.)
// ─────────────────────────────────────────────────────────────────────────────

export const CONFIG = {
  seed: 7, // change for a completely different island

  // ── Islands ───────────────────────────────────────────────────────────────
  // The world is a handful of islands in one sea. Each has a centre, a radius
  // (land fades into the sea toward the rim) and the biomes that may appear on
  // it, by name from `biomes.types` below. Add an entry to add an island; keep
  // every island inside `terrain.size`. You can swim between them.
  islands: [
    { name: 'home',  label: 'The Home Isle',      x: -500, z: 0,  radius: 380, biomes: ['meadow', 'pines', 'autumn', 'desert', 'snow', 'blossom'] },
    { name: 'stone', label: 'The Stepping Stone', x: -95,  z: 25, radius: 85,  biomes: ['meadow'] },
    { name: 'far',   label: 'The Far Isle',       x: 420,  z: 40, radius: 520, biomes: ['jungle', 'lavender', 'ash', 'marsh', 'meadow', 'pines', 'autumn', 'desert', 'snow', 'blossom'] },
  ],

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

    // Water: wading slows you with depth; where it is deep enough you float and swim.
    swimFloatDepth: 1.4, // metres of water you float in — the waterline sits at about your shoulders
    swimSpeed: 1.7, // metres / second
    swimSprintSpeed: 2.8, // with Shift
    strokeRate: 0.75, // strokes per second
    jumpMaxDepth: 0.7, // no jumping in water deeper than this
    spawn: [-500, 0], // x, z — snaps to the nearest level, dry ground (this is the middle of the home island)
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
    shoulderHeight: 1.3, // metres from feet to shoulders (the body pivots here when swimming)
    swimPitch: 1.15, // how far the body tips forward when swimming (radians; 1.57 = flat)
  },

  // ── Terrain ───────────────────────────────────────────────────────────────
  terrain: {
    size: 2000, // width of the whole world in metres (must hold every island, with sea to spare)
    segments: 560, // ground mesh resolution across that width
    tiles: 10, // the ground is cut into tiles × tiles pieces so off-screen and open-sea pieces cost nothing
    noiseOffset: [500, 0], // shifts the terrain pattern (set so the home island kept its shape when the world grew)
    islandFalloffStart: 0.55, // fraction of radius where the fade begins
    baseHeight: 5, // average land height above sea level
    amplitude: 20, // hill height
    frequency: 0.006, // lower = broader hills
    octaves: 5,
    persistence: 0.45,
    lacunarity: 2.1,
    seabedDepth: 8,
    flatShading: false, // true = faceted low-poly look
    detail: 0.5, // fine unevenness in how the ground catches light, close up (0 = perfectly smooth)
    // Soft shading in hollows and valleys, and under trees (0 = off for each).
    occlusion: { strength: 0.85, underTrees: 0.45 },
    colors: {
      // (grass/ground colours are per biome, below)
      sand: '#cdbb8e',
      rock: '#77736d', // steep slopes
      seabed: '#4b5a55',
      shelf: '#6a6966', // the stone shelves that hold tide pools
    },
    sandHeight: 1.3, // sand below this height (above water level)
    // Beaches: the slope is eased around the waterline to make a broad strand.
    beach: {
      flatten: 0.3, // slope right at the waterline, as a fraction of the natural slope (1 = no change)
      height: 3.5, // metres above/below water over which that eases back to normal
      wetReach: 0.45, // how far above the water the sand stays dark and wet (metres of height)
    },
    rockSlope: 0.28, // 0 = flat, 1 = vertical
  },

  water: {
    level: 0,
    color: '#2f6f86', // deep water
    shallowColor: '#7fd0c4', // over sand near the shore
    shallowDepth: 2.2, // metres over which shallow fades to deep
    opacity: 0.86,
    skyTint: 0.2, // how much the water picks up the horizon colour
    foam: 1, // 0 = no foam … 1 = full
    reflection: 0.7, // how strongly the surface mirrors the sky at a glancing angle
    caustics: 0.5, // dancing light on the bottom in the shallows (0 = off)
    glitter: 1, // sparkles of sun on the ripples (0 = off)
    waves: {
      height: 0.16, // metres the swell rises and falls (0 = flat calm)
      length: 34, // metres between crests
      speed: 0.9,
      ripple: 0.5, // strength of the small glinting ripples
    },
    // The sea slowly rises and falls. Low tide bares the rock shelves and their pools.
    tide: {
      range: 0.8, // metres between low and high water (0 = no tide)
      periodSeconds: 360, // real seconds from one high tide to the next
    },
  },

  // Tide pools: stone shelves at the waterline, each holding a few pools.
  tidePools: {
    enabled: true,
    count: 12, // shelves around the coast of an island the size of the home isle (others get more or fewer by size)
    spacing: 110, // at least this far apart (metres)
    shelfRadius: 8,
    shelfHeight: 0.1, // above mean water: bare at low tide, awash at high
    poolsPerShelf: [2, 4],
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
  //   rockiness          – below 1, steep slopes keep their ground colour instead of turning to bare rock
  //   wind/leaves/birds/crickets – how much of each sound you hear there (0 = none)
  //   footstep           – what the ground sounds like: 'grass', 'sand' or 'snow'
  //   mapSymbol/mapDensity – how it is drawn on the map: 'pine', 'tree', 'tuft', 'dots', 'peak'; 0..1 how many
  biomes: {
    scale: 0.0032, // lower = larger regions
    sharpness: 9, // higher = harder borders between biomes
    spawn: 'meadow', // biome you start in
    spawnRadius: 90, // how much of it is guaranteed around the spawn point
    types: {
      meadow:  { label: 'The Meadow',      ground: '#5f8f4a', groundAlt: '#7da052', heightScale: 0.8,  heightOffset: 0,   fog: 1.0,  motes: '#ffe9a8', wind: 0.8, leaves: 0.35, birds: 1.0, crickets: 1.0, footstep: 'grass', mapSymbol: 'tuft', mapDensity: 0.25 },
      pines:   { label: 'Pinewood',        ground: '#3f6a44', groundAlt: '#557a4a', heightScale: 1.15, heightOffset: 2,   fog: 1.35, motes: '#d8f0c0', wind: 0.7, leaves: 1.0, birds: 0.6, crickets: 0.5, footstep: 'grass', mapSymbol: 'pine', mapDensity: 0.75 },
      autumn:  { label: 'Emberwood',       ground: '#9a7b3c', groundAlt: '#b08a45', heightScale: 1.0,  heightOffset: 1,   fog: 1.15, motes: '#ffb870', wind: 0.8, leaves: 0.9, birds: 0.7, crickets: 0.7, footstep: 'grass', mapSymbol: 'tree', mapDensity: 0.6 },
      desert:  { label: 'The Pale Dunes',  ground: '#d9c08a', groundAlt: '#cdaa72', heightScale: 0.45, heightOffset: 2.5, fog: 0.6,  motes: '#f5dfb0', bias: 0.08, wind: 1.2, leaves: 0.0, birds: 0.12, crickets: 0.5, footstep: 'sand', mapSymbol: 'dots', mapDensity: 0.5 },
      snow:    { label: 'Whitereach',      ground: '#e8eef2', groundAlt: '#cfdbe4', heightScale: 2.3,  heightOffset: 44,  fog: 1.6,  motes: '#ffffff', bias: -0.08, rockiness: 0.5, wind: 1.7, leaves: 0.1, birds: 0.08, crickets: 0.0, footstep: 'snow', mapSymbol: 'peak', mapDensity: 0.4 },
      blossom: { label: 'Blossom Hollow',  ground: '#7fae72', groundAlt: '#9cc48a', heightScale: 0.65, heightOffset: 0.5, fog: 0.9,  motes: '#ffc4dd', wind: 0.6, leaves: 0.6, birds: 1.2, crickets: 0.9, footstep: 'grass', mapSymbol: 'tree', mapDensity: 0.5 },
      // The Far Isle's own
      jungle:   { label: 'The Green Deep',  ground: '#2f6b3a', groundAlt: '#3f8046', heightScale: 1.05, heightOffset: 2,    fog: 1.7,  motes: '#c8ffb0', wind: 0.5, leaves: 1.1, birds: 1.5, crickets: 1.3, footstep: 'grass', mapSymbol: 'tree', mapDensity: 0.85 },
      lavender: { label: 'Violet Downs',    ground: '#7f8f5a', groundAlt: '#8e84a8', heightScale: 0.7,  heightOffset: 3,    fog: 0.85, motes: '#e3c8ff', wind: 0.9, leaves: 0.3, birds: 0.9, crickets: 0.9, footstep: 'grass', mapSymbol: 'tuft', mapDensity: 0.5 },
      ash:      { label: 'The Cinderlands', ground: '#3b3736', groundAlt: '#4d4542', heightScale: 1.5,  heightOffset: 12,   fog: 1.3,  motes: '#ff9a5a', rockiness: 0.35, wind: 1.3, leaves: 0.0, birds: 0.05, crickets: 0.1, footstep: 'sand', mapSymbol: 'peak', mapDensity: 0.3 },
      marsh:    { label: 'The Still Fens',  ground: '#5d7a4e', groundAlt: '#4f6b55', heightScale: 0.22, heightOffset: -3.4, fog: 1.9,  motes: '#b8ffe6', wind: 0.4, leaves: 0.5, birds: 0.8, crickets: 1.6, footstep: 'grass', mapSymbol: 'tuft', mapDensity: 0.7 },
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
    // The shore — along every beach, whatever the biome (heights are metres above the water)
    { asset: 'driftwood', count: 420,  height: [0.5, 1.7],  maxSlope: 0.2,  scale: [0.6, 1.5], colorJitter: 0.15, castShadow: true, drawDistance: 260 },
    { asset: 'pebble',    count: 3800, height: [-0.2, 1.4], maxSlope: 0.5,  scale: [0.1, 0.4], cluster: { scale: 0.05, threshold: 0.1 }, colorJitter: 0.35, sink: 0.03, drawDistance: 110 },
    { asset: 'starfish',  count: 850,  height: [-0.25, 0.5], maxSlope: 0.25, scale: [0.8, 1.6], colorJitter: 0.25, drawDistance: 45 },
    { asset: 'grassDry',  count: 18000, height: [1.5, 2.9],  maxSlope: 0.35, scale: [0.9, 1.9], cluster: { scale: 0.045, threshold: 0.0 }, sway: 0.3, colorJitter: 0.25, drawDistance: 150 },

    // Meadow — open grass, flowers, the odd tree
    { biome: 'meadow',  asset: 'grass',       count: 40000, height: [1.2, 30], maxSlope: 0.4,  scale: [1.0, 2.2], cluster: { scale: 0.03, threshold: -0.35 }, sway: 0.25, colorJitter: 0.3, drawDistance: 150 },
    { biome: 'meadow',  asset: 'flower',      count: 3600,  height: [1.5, 20], maxSlope: 0.3,  scale: [0.7, 1.3], cluster: { scale: 0.02, threshold: 0.2 }, sway: 0.12, colorJitter: 0.1, drawDistance: 130 },
    { biome: 'meadow',  asset: 'tree',        count: 300,   height: [1.5, 20], maxSlope: 0.35, scale: [0.8, 1.5], cluster: { scale: 0.010, threshold: 0.1 }, sway: 0.015, colorJitter: 0.25, castShadow: true },
    { biome: 'meadow',  asset: 'rock',        count: 140,    height: [-1, 60],  maxSlope: 1.0,  scale: [0.4, 1.8], colorJitter: 0.2, castShadow: true, sink: 0.15, drawDistance: 420 },

    // Pinewood — dense dark conifers
    { biome: 'pines',   asset: 'pine',        count: 2600,  height: [2, 60],   maxSlope: 0.5,  scale: [0.8, 1.9], sway: 0.012, colorJitter: 0.25, castShadow: true },
    { biome: 'pines',   asset: 'grassDark',   count: 18000,  height: [1.2, 40], maxSlope: 0.45, scale: [0.9, 1.8], cluster: { scale: 0.03, threshold: -0.2 }, sway: 0.2, colorJitter: 0.3, drawDistance: 150 },
    { biome: 'pines',   asset: 'rock',        count: 320,   height: [-1, 60],  maxSlope: 1.0,  scale: [0.5, 2.4], colorJitter: 0.2, castShadow: true, sink: 0.15, drawDistance: 420 },

    // Emberwood — orange and gold broadleaf woods
    { biome: 'autumn',  asset: 'treeAutumn',  count: 840,   height: [1.5, 40], maxSlope: 0.4,  scale: [0.8, 1.6], sway: 0.015, colorJitter: 0.3, castShadow: true },
    { biome: 'autumn',  asset: 'treeGold',    count: 520,   height: [1.5, 40], maxSlope: 0.4,  scale: [0.8, 1.6], sway: 0.015, colorJitter: 0.2, castShadow: true },
    { biome: 'autumn',  asset: 'grassDry',    count: 22000, height: [1.2, 40], maxSlope: 0.4,  scale: [0.9, 2.0], cluster: { scale: 0.03, threshold: -0.3 }, sway: 0.25, colorJitter: 0.25, drawDistance: 150 },
    { biome: 'autumn',  asset: 'rock',        count: 160,    height: [-1, 60],  maxSlope: 1.0,  scale: [0.4, 2.0], colorJitter: 0.2, castShadow: true, sink: 0.15, drawDistance: 420 },

    // The Pale Dunes — sand, cacti, scrub
    { biome: 'desert',  asset: 'cactus',      count: 400,   height: [1.5, 30], maxSlope: 0.3,  scale: [0.7, 1.6], colorJitter: 0.2, castShadow: true },
    { biome: 'desert',  asset: 'bush',        count: 1200,   height: [1.2, 30], maxSlope: 0.4,  scale: [0.6, 1.5], cluster: { scale: 0.02, threshold: -0.1 }, colorJitter: 0.3, castShadow: true, drawDistance: 320 },
    { biome: 'desert',  asset: 'rockSand',    count: 640,   height: [-1, 60],  maxSlope: 1.0,  scale: [0.4, 3.0], colorJitter: 0.2, castShadow: true, sink: 0.15, drawDistance: 420 },
    { biome: 'desert',  asset: 'grassDry',    count: 5000,  height: [1.2, 30], maxSlope: 0.4,  scale: [0.8, 1.6], cluster: { scale: 0.04, threshold: 0.3 }, sway: 0.25, colorJitter: 0.25, drawDistance: 150 },

    // Whitereach — snowy heights
    { biome: 'snow',    asset: 'pineSnow',    count: 1040,   height: [2, 80],   maxSlope: 0.5,  scale: [0.8, 1.8], cluster: { scale: 0.012, threshold: -0.1 }, sway: 0.01, colorJitter: 0.1, castShadow: true },
    { biome: 'snow',    asset: 'rockSnow',    count: 600,   height: [-1, 90],  maxSlope: 1.2,  scale: [0.5, 3.0], colorJitter: 0.15, castShadow: true, sink: 0.15, drawDistance: 420 },

    // Blossom Hollow — pink trees over soft pale grass
    { biome: 'blossom', asset: 'treeBlossom', count: 840,   height: [1.5, 30], maxSlope: 0.4,  scale: [0.8, 1.6], sway: 0.02, colorJitter: 0.15, castShadow: true },
    { biome: 'blossom', asset: 'grassPale',   count: 30000, height: [1.2, 30], maxSlope: 0.4,  scale: [1.0, 2.0], cluster: { scale: 0.03, threshold: -0.35 }, sway: 0.25, colorJitter: 0.2, drawDistance: 150 },
    { biome: 'blossom', asset: 'flowerPink',  count: 4400,  height: [1.2, 30], maxSlope: 0.35, scale: [0.7, 1.4], cluster: { scale: 0.02, threshold: -0.1 }, sway: 0.12, colorJitter: 0.1, drawDistance: 130 },

    // ── The Far Isle's own biomes ──
    // The Green Deep — dense jungle: palms, broadleaf giants, ferns underfoot
    { biome: 'jungle',   asset: 'palm',        count: 520,   height: [1.2, 40], maxSlope: 0.45, scale: [0.8, 1.6], sway: 0.02,  colorJitter: 0.2, castShadow: true },
    { biome: 'jungle',   asset: 'treeJungle',  count: 620,   height: [1.5, 45], maxSlope: 0.45, scale: [1.0, 2.1], sway: 0.012, colorJitter: 0.25, castShadow: true },
    { biome: 'jungle',   asset: 'fern',        count: 5500,  height: [1.2, 45], maxSlope: 0.5,  scale: [0.8, 1.9], sway: 0.12, colorJitter: 0.3, drawDistance: 110 },
    { biome: 'jungle',   asset: 'grassDark',   count: 4000,  height: [1.2, 45], maxSlope: 0.45, scale: [1.0, 2.0], cluster: { scale: 0.03, threshold: -0.2 }, sway: 0.2, colorJitter: 0.3, drawDistance: 150 },
    { biome: 'jungle',   asset: 'rock',        count: 90,    height: [-1, 60],  maxSlope: 1.0,  scale: [0.5, 2.2], colorJitter: 0.2, castShadow: true, sink: 0.15, drawDistance: 420 },

    // Violet Downs — rolling heath of lavender and heather
    { biome: 'lavender', asset: 'lavender',    count: 15000, height: [1.3, 40], maxSlope: 0.45, scale: [1.0, 2.0], cluster: { scale: 0.025, threshold: -0.45 }, sway: 0.22, colorJitter: 0.2, drawDistance: 170 },
    { biome: 'lavender', asset: 'heather',     count: 1100,  height: [1.3, 40], maxSlope: 0.45, scale: [0.6, 1.4], cluster: { scale: 0.02, threshold: 0.0 }, colorJitter: 0.25, castShadow: true, drawDistance: 320 },
    { biome: 'lavender', asset: 'tree',        count: 45,    height: [1.5, 30], maxSlope: 0.3,  scale: [0.9, 1.5], sway: 0.015, colorJitter: 0.2, castShadow: true },
    { biome: 'lavender', asset: 'rock',        count: 70,    height: [-1, 60],  maxSlope: 1.0,  scale: [0.4, 1.8], colorJitter: 0.2, castShadow: true, sink: 0.15, drawDistance: 420 },

    // The Cinderlands — black volcanic upland, almost bare
    { biome: 'ash',      asset: 'basalt',      count: 260,   height: [2, 90],   maxSlope: 0.6,  scale: [0.6, 1.8], cluster: { scale: 0.015, threshold: 0.05 }, colorJitter: 0.15, castShadow: true },
    { biome: 'ash',      asset: 'rockAsh',     count: 520,   height: [-1, 90],  maxSlope: 1.2,  scale: [0.4, 3.2], colorJitter: 0.2, castShadow: true, sink: 0.15, drawDistance: 420 },
    { biome: 'ash',      asset: 'emberBush',   count: 380,   height: [2, 90],   maxSlope: 0.5,  scale: [0.6, 1.3], cluster: { scale: 0.02, threshold: 0.2 }, colorJitter: 0.2, castShadow: true, drawDistance: 320 },

    // The Still Fens — low, wet ground: reeds, willows, glowing caps at night
    { biome: 'marsh',    asset: 'reed',        count: 11000, height: [-0.2, 6], maxSlope: 0.4,  scale: [0.8, 1.7], cluster: { scale: 0.035, threshold: -0.3 }, sway: 0.16, colorJitter: 0.25, drawDistance: 170 },
    { biome: 'marsh',    asset: 'willow',      count: 190,   height: [0.8, 10], maxSlope: 0.3,  scale: [0.9, 1.7], sway: 0.02, colorJitter: 0.2, castShadow: true },
    { biome: 'marsh',    asset: 'glowcap',     count: 900,   height: [0.4, 8],  maxSlope: 0.4,  scale: [0.7, 1.6], cluster: { scale: 0.05, threshold: 0.15 }, colorJitter: 0.1, drawDistance: 120 },
    { biome: 'marsh',    asset: 'grassDark',   count: 5000,  height: [0.6, 10], maxSlope: 0.4,  scale: [0.9, 1.8], cluster: { scale: 0.03, threshold: -0.2 }, sway: 0.2, colorJitter: 0.3, drawDistance: 150 },
  ],

  // ── Natural landmarks ─────────────────────────────────────────────────────
  // Large one-off features; the trails lead to them. With `island` and `biome`,
  // the landmark finds its own spot deep inside that biome on that island. Use `position: [x, z]`
  // instead to place one by hand. `radius` is its rough footprint in metres
  // (plants and the path keep clear of it); `label` shows as you arrive.
  // `prefer: 'summit'` puts it as high up as it can find; `prefer: 'low'` down by the water.
  landmarks: [
    { island: 'home', asset: 'elderTree',     biome: 'meadow',   label: 'The Elder Tree',     radius: 6,  scale: 1.6 },
    { island: 'home', asset: 'rockSpire',     biome: 'pines',    label: "The Giant's Tooth",  radius: 7,  scale: 1.9 },
    { island: 'home', asset: 'stoneCircle',   biome: 'autumn',   label: 'The Old Stones',     radius: 10, scale: 1.3 },
    { island: 'home', asset: 'rockArch',      biome: 'desert',   label: 'The Sandgate',       radius: 11, scale: 1.5 },
    { island: 'home', asset: 'iceCrown',      biome: 'snow',     label: 'The Frost Crown',    radius: 8,  scale: 1.6, prefer: 'summit' },
    { island: 'home', asset: 'motherBlossom', biome: 'blossom',  label: 'The Mother Blossom', radius: 6,  scale: 1.5 },
    { island: 'far',  asset: 'greatBanyan',   biome: 'jungle',   label: 'The Great Banyan',   radius: 7,  scale: 1.9 },
    { island: 'far',  asset: 'basaltOrgan',   biome: 'lavender', label: 'The Organ Pipes',    radius: 9,  scale: 1.4 },
    { island: 'far',  asset: 'cinderCone',    biome: 'ash',      label: 'The Cinder Cone',    radius: 26, scale: 1.2, prefer: 'summit' },
    { island: 'far',  asset: 'drownedStones', biome: 'marsh',    label: 'The Drowned Stones', radius: 10, scale: 1.2, prefer: 'low' },
  ],

  // ── The far horizon ───────────────────────────────────────────────────────
  // Colossal mountain ranges out at sea, purely for scale. Each range is a ring
  // around the island: distance and height in metres, `gaps` 0..1 = how much of
  // the ring is open sea, `haze` 0..1 = how far it fades into the sky colour.
  horizon: {
    enabled: true,
    snowColor: '#eef2f6',
    snowLine: 0.55, // fraction of a range's height where snow begins
    detail: 1, // how deeply the faces are carved by gullies (0 = flat)
    ranges: [
      { distance: 2400, height: 700,  gaps: 0.5,  haze: 0.22, color: '#56606e' },
      { distance: 4200, height: 1500, gaps: 0.42, haze: 0.42, color: '#5d6878' },
      { distance: 6800, height: 2700, gaps: 0.36, haze: 0.6,  color: '#667284' },
    ],
  },

  // Fog behaves like air: it lies low, thins as you climb, and glows toward the sun.
  atmosphere: {
    mistHeight: 38, // metres of height over which the mist thins out
    highAirFog: 0.3, // share of the fog still present far above the mist (0..1)
    sunGlow: 0.16, // how much the haze brightens when you look toward the sun
    cloudShadows: 0.5, // how much passing clouds dim the sunlight on the ground (0 = off)
    mistPatches: 0.6, // how patchy and drifting the mist is (0 = even haze)
    // Long shadows cast by hills when the sun is low, far beyond ordinary shadows.
    // `steps` = quality (0 = off), `reach` = how far away a hill can shade you (metres).
    hillShadows: { steps: 40, reach: 360, softness: 0.04 },
    // Soft light from the whole sky (captured from the sky itself every few seconds).
    //   share: how much of the soft light comes from it rather than a plain sky/ground blend
    //   strength: its brightness; groundBounce: light reflected up from the ground
    skyLight: { enabled: true, share: 0.65, strength: 1.1, groundBounce: 0.95, size: 128, refreshSeconds: 2 },
    rimLight: 0.55, // sky-coloured light on the edges of things (0 = off)
  },

  // ── Trails ────────────────────────────────────────────────────────────────
  // Footpaths from the starting camp to every landmark, planned automatically
  // around water and steep ground, with lanterns, signposts and camps.
  trails: {
    enabled: true,
    loop: true, // also link the landmarks to each other, making round walks
    width: 2.4, // metres
    color: '#8c7350', // trodden earth
    strength: 0.8, // how strongly the path shows over the ground colour (0..1)
    clearWidth: 9, // trees and rocks keep this far apart across the path
    maxSlope: 0.32, // paths avoid hillsides steeper than this (0.32 ≈ 18°) unless there is no other way
    maxClimb: 0.3, // and never rise more steeply than this along their own length (0.3 ≈ 17°)
    // The ground under a path is cut level, like a real hillside track.
    bed: { enabled: true, shoulder: 1, blend: 5, smoothing: 12, maxGrade: 0.3 }, // metres of level verge / of easing back into the slope; steepest rise along the path
    slopeAvoidance: 7, // higher = paths wind further to stay on gentle ground
    parallelPenalty: 3, // discourages a new path from running alongside an existing one instead of joining it
    mergeWithin: 70, // a side path shorter than this that just rejoins the main one is removed (metres)
    reuseDiscount: 0.35, // lower = routes merge into shared trunk paths more eagerly
    loopReuseDiscount: 0.6, // same, for the landmark-to-landmark loop routes
    gridCell: 8, // planning resolution in metres
    lanternSpacing: 75, // metres between lanterns (make huge to remove them)
    campEvery: 2, // a wayside camp on every Nth route out from the start
  },

  campfire: {
    lightColor: '#ff9a4a',
    lightIntensity: 26,
    lightRange: 24, // metres the firelight reaches
    lightFadeDistance: 90, // beyond this the nearest fire's light and embers are off
    embers: 28,
  },

  lanterns: { dayGlow: 0.5, nightGlow: 5 }, // how bright the lantern panes are

  wind: {
    speed: 1.4,
    direction: [0.8, 0.6], // which way gusts travel (x, z)
    gustLength: 38, // metres between gusts rolling across the grass
    fieldVariation: 0.7, // patches of drier and lusher colour across fields of plants (0 = uniform)
  },

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
      { t: 0.00, skyTop: '#04050d', skyHorizon: '#141c3a', lightColor: '#8fa8ff', lightIntensity: 1.1, ambientSky: '#4a5c9c', ambientGround: '#1d2440', ambientIntensity: 1.7, fogDensity: 0.0028, stars: 1.0, motes: 1.0, exposure: 1.35},
      { t: 0.21, skyTop: '#0a0d24', skyHorizon: '#2a2c55', lightColor: '#8fa8ff', lightIntensity: 1.1, ambientSky: '#4a5c9c', ambientGround: '#1d2440', ambientIntensity: 1.7, fogDensity: 0.0033, stars: 0.8, motes: 0.9, exposure: 1.35},
      { t: 0.25, skyTop: '#2a3a78', skyHorizon: '#e58d6e', lightColor: '#ff9e6b', lightIntensity: 0.0,  ambientSky: '#6f6a9a', ambientGround: '#2a2230', ambientIntensity: 1.6,  fogDensity: 0.0041, stars: 0.15, motes: 0.4, exposure: 1.15},
      { t: 0.30, skyTop: '#3d6cb8', skyHorizon: '#ffc79a', lightColor: '#ffc592', lightIntensity: 1.8,  ambientSky: '#9bb3d9', ambientGround: '#4a4034', ambientIntensity: 0.8,  fogDensity: 0.0036, stars: 0.0, motes: 0.25, exposure: 1.0 },
      { t: 0.40, skyTop: '#3a82d4', skyHorizon: '#c4e2f2', lightColor: '#fff3dd', lightIntensity: 3.0,  ambientSky: '#b5d3f0', ambientGround: '#5a5a44', ambientIntensity: 0.9,  fogDensity: 0.0019, stars: 0.0, motes: 0.15, exposure: 1.0 },
      { t: 0.60, skyTop: '#3a7fcf', skyHorizon: '#cfe3ea', lightColor: '#fff0d2', lightIntensity: 3.0,  ambientSky: '#b5d0ea', ambientGround: '#5a5a44', ambientIntensity: 0.9,  fogDensity: 0.0019, stars: 0.0, motes: 0.15, exposure: 1.0 },
      { t: 0.70, skyTop: '#3f66b0', skyHorizon: '#ffcf9c', lightColor: '#ffbf85', lightIntensity: 2.2,  ambientSky: '#a7b4d6', ambientGround: '#4f4234', ambientIntensity: 0.8,  fogDensity: 0.0030, stars: 0.0, motes: 0.3, exposure: 1.0 },
      { t: 0.75, skyTop: '#2b2f6e', skyHorizon: '#f07a52', lightColor: '#ff8a55', lightIntensity: 0.0,  ambientSky: '#77669a', ambientGround: '#2c2030', ambientIntensity: 1.6,  fogDensity: 0.0041, stars: 0.15, motes: 0.6, exposure: 1.15},
      { t: 0.80, skyTop: '#0c0f2c', skyHorizon: '#3a2f5c', lightColor: '#8fa8ff', lightIntensity: 1.1, ambientSky: '#4a5c9c', ambientGround: '#1d2440', ambientIntensity: 1.7, fogDensity: 0.0033, stars: 0.8, motes: 1.0, exposure: 1.35},
      { t: 1.00, skyTop: '#04050d', skyHorizon: '#141c3a', lightColor: '#8fa8ff', lightIntensity: 1.1, ambientSky: '#4a5c9c', ambientGround: '#1d2440', ambientIntensity: 1.7, fogDensity: 0.0028, stars: 1.0, motes: 1.0, exposure: 1.35},
    ],
    starCount: 4500,
    milkyWay: 0.6, // brightness of the band of stars across the night sky (0 = off)
    clouds: { cover: 0.42 }, // 0 = clear sky … 1 = overcast
    aurora: { strength: 0.12, inSnow: 0.7 }, // night aurora everywhere / while in the snow biome
    // An immense pale world low in the sky, visible day and night.
    planet: { enabled: true, direction: [-0.55, 0.3, -0.78], sizeDegrees: 11, colorA: '#c9b79c', colorB: '#8fa3c7' },
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
    // One switch for the expensive settings: 'low', 'medium', 'high', 'ultra', or
    // 'custom' to use the values below exactly as written. (Each preset is listed
    // in QUALITY_PRESETS at the bottom of this file.) Changeable in the G panel.
    quality: 'high',
    toneMapping: 'neutral', // 'neutral' (truest colours), 'aces' (punchier, warmer) or 'agx' (softest)
    fov: 65,
maxPixelRatio: 1.5, // sharpness cap on high-density screens (2 = sharper, 1 = faster)
    antialias: 4, // MSAA samples: 0, 2 or 4
    // Automatically lowers the rendering resolution when the frame rate drops,
    // and raises it again when there is headroom.
    adaptive: { enabled: true, targetFps: 55, minScale: 0.55 },
    chunkSize: 110, // props are culled in square chunks this many metres wide
    farDrawDistance: 520, // trees and other props without their own drawDistance stop being drawn beyond this
    drawDistanceScale: 1, // multiplies every scatter layer's drawDistance
    shadows: true,
    shadowMapSize: 2048,
    shadowDistance: 70, // radius around the player that receives shadows
    // Finishing touches applied to the whole picture (1 = unchanged for saturation/contrast, 0 = off for the rest).
    grade: { enabled: true, saturation: 1.08, contrast: 1.03, vignette: 0.22, warmth: 0.6 },
    // Shafts of light from the sun, cut by whatever stands in front of it. Strongest when the sun is low.
    godRays: { enabled: true, strength: 0.55, samples: 44 },
    bloom: { enabled: true, strength: 0.35, radius: 0.7, threshold: 0.9 },
  },

  // ── Audio ─────────────────────────────────────────────────────────────────
  // All sound is synthesised; see audio.js. Set any volume to 0 to remove it.
  audio: {
    masterVolume: 1,
    softness: 5200, // everything is rolled off above this pitch (Hz); lower = mellower, higher = crisper
    windVolume: 0.09,
    leavesVolume: 0.022,
    waterVolume: 0.1,
    fireVolume: 0.14,
    birdVolume: 0.035,
    cricketVolume: 0.007,
    owlVolume: 0.03,
    aweVolume: 0.05, // a deep, slow tone that swells on high ground and at landmarks
    altitudeWind: 1.2, // extra wind at the top of the mountains
    footsteps: true, // soft synthesised footfalls
    footstepVolume: 0.085,
    music: null, // e.g. 'audio/ambient.mp3' (put the file in /audio)
    musicVolume: 0.5,
  },

  ui: {
    crosshair: true, // small dot in the centre of the screen
    crosshairSize: 4, // pixels
    crosshairOpacity: 0.55,
    biomeLabel: true, // show a region's or landmark's name for a moment as you arrive
    // The map, opened with M. It is drawn from the world itself, so it follows any change to the island.
    map: {
      enabled: true,
      key: 'KeyM',
      resolution: 1800, // pixels across; lower if opening the map stutters
      contourEvery: 8, // metres of height between contour lines
      scaleBarMetres: 200,
    },
  },

  debug: {
    gui: true, // press G in-game for a live tweak panel
  },
};

// ── Quality presets ─────────────────────────────────────────────────────────
// Each preset overrides just these settings. The choice in the G panel is
// remembered by the browser and wins over `render.quality` above.
export const QUALITY_PRESETS = {
  low: {
    render: { maxPixelRatio: 1, antialias: 0, shadowMapSize: 1024, shadowDistance: 45, drawDistanceScale: 0.65, farDrawDistance: 380, godRays: { enabled: false }, adaptive: { minScale: 0.5 } },
    atmosphere: { hillShadows: { steps: 0 }, skyLight: { enabled: false } },
  },
  medium: {
    render: { maxPixelRatio: 1.25, antialias: 2, shadowMapSize: 2048, shadowDistance: 60, drawDistanceScale: 0.85, farDrawDistance: 450, godRays: { enabled: true, samples: 28 } },
    atmosphere: { hillShadows: { steps: 24 }, skyLight: { enabled: true, size: 64 } },
  },
  high: {
    render: { maxPixelRatio: 1.5, antialias: 4, shadowMapSize: 2048, shadowDistance: 70, drawDistanceScale: 1, farDrawDistance: 520, godRays: { enabled: true, samples: 44 } },
    atmosphere: { hillShadows: { steps: 40 }, skyLight: { enabled: true, size: 128 } },
  },
  ultra: {
    render: { maxPixelRatio: 2, antialias: 4, shadowMapSize: 4096, shadowDistance: 110, drawDistanceScale: 1.35, farDrawDistance: 700, godRays: { enabled: true, samples: 60 } },
    atmosphere: { hillShadows: { steps: 64, reach: 480 }, skyLight: { enabled: true, size: 256 } },
  },
};

(function applyQualityPreset() {
  let chosen = CONFIG.render.quality;
  try {
    chosen = localStorage.getItem('terra.quality') || chosen;
  } catch {
    // (storage unavailable: use the setting above)
  }
  CONFIG.render.quality = chosen;
  const preset = QUALITY_PRESETS[chosen];
  if (!preset) return; // 'custom': the values above, as written
  const merge = (target, source) => {
    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) merge((target[key] ??= {}), value);
      else target[key] = value;
    }
  };
  merge(CONFIG, preset);
})();
