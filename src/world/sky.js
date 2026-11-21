// Sky dome, sun/moon light, ambient light, fog and stars — all driven by the
// time-of-day keyframes in CONFIG.sky.

import * as THREE from 'three';
import { CONFIG } from '../config.js';

// Pre-parse keyframes: colour strings become THREE.Color, numbers stay numbers.
const keyframes = CONFIG.sky.keyframes.map((k) =>
  Object.fromEntries(Object.entries(k).map(([key, v]) => [key, typeof v === 'string' ? new THREE.Color(v) : v])),
);

/** Blends the two keyframes surrounding time `t` into `out`. */
function sampleKeyframes(t, out) {
  let i = keyframes.findIndex((k) => k.t > t);
  if (i <= 0) i = keyframes.length - 1;
  const a = keyframes[i - 1];
  const b = keyframes[i];
  const f = THREE.MathUtils.clamp((t - a.t) / (b.t - a.t || 1), 0, 1);
  for (const key in a) {
    if (a[key].isColor) (out[key] ??= new THREE.Color()).copy(a[key]).lerp(b[key], f);
    else out[key] = a[key] + (b[key] - a[key]) * f;
  }
  return out;
}

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const skyFragment = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;        // toward the sun (may be below the horizon)
  uniform vec3 uLightDir;      // toward whichever of sun or moon is up: what lights the clouds
  uniform vec3 uSunColor;
  uniform float uSunStrength;
  uniform float uMoonStrength;
  uniform float uTime;
  uniform float uNight;        // 0 by day … 1 at night
  uniform float uCloudCover;   // 0 clear … 1 overcast
  uniform float uCirrus;       // amount of high wispy cloud
  uniform vec3 uCloudLit;
  uniform vec3 uCloudShade;
  uniform float uAurora;
  uniform float uMilkyWay;
  uniform float uStarDensity;
  uniform float uStarBrightness;
  uniform float uTwinkle;
  uniform float uStarTurn;     // the stars wheel slowly through the night
  uniform vec3 uPlanetDir;
  uniform float uPlanetSize;   // angular radius in radians (0 = no planet)
  uniform vec3 uPlanetColorA;
  uniform vec3 uPlanetColorB;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec3 hash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.0; a *= 0.5; }
    return v;
  }
  float fbm3(vec2 p) {   // fewer octaves, for the lighting samples
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.0; a *= 0.5; }
    return v / 0.875;
  }

  // One layer of stars: a star sits somewhere in some of the cells of a grid
  // wrapped around the sky. Each is drawn about a pixel wide whatever the
  // screen, with its own brightness, colour and twinkle.
  vec3 starLayer(vec3 dir, float cells, float density, float brightness) {
    vec3 p = dir * cells;
    vec3 cell = floor(p);
    vec3 h = hash3(cell);
    if (h.x > density) return vec3(0.0);
    vec3 star = normalize(cell + 0.3 + hash3(cell + 7.1) * 0.4);
    float angle = length(cross(dir, star));
    float pixel = max(length(fwidth(dir)), 1e-5);
    float glow = exp(-pow(angle / (pixel * 0.9), 2.0));
    float twinkle = 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * (1.7 + h.y * 4.0) + h.z * 60.0)) * smoothstep(0.35, 0.0, dir.y);
    vec3 tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.86, 0.66), h.z);   // blue-white to warm
    return tint * glow * (0.15 + 0.85 * pow(h.y, 4.0)) * brightness * 2.2 * twinkle;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = max(dir.y, 0.0);
    float day = smoothstep(-0.12, 0.08, uSunDir.y);
    float lowSun = 1.0 - smoothstep(0.0, 0.42, uSunDir.y);
    float s = max(dot(dir, uSunDir), 0.0);   // closeness to the sun
    vec3 flatSun = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-5);
    float sunSide = dot(normalize(vec3(dir.x, 0.0, dir.z) + 1e-5), flatSun) * 0.5 + 0.5;   // 1 under the sun … 0 opposite

    // ── The air itself ──
    // Zenith to horizon, with a soft pale haze band just above the horizon.
    vec3 col = mix(uHorizon, uTop, pow(h, 0.42));
    col = mix(col, uHorizon * 1.06 + 0.02, exp(-h * 11.0) * 0.45);
    // Light scattered by the air piles up around the sun: a broad warm glow and a tight bright aureole.
    col += uSunColor * uSunStrength * (pow(s, 4.0) * 0.12 + pow(s, 24.0) * 0.22 + pow(s, 260.0) * 0.55);
    // A low sun floods its side of the sky with colour, most of all near the horizon…
    float sunBand = lowSun * pow(sunSide, 3.0) * exp(-h * 3.2);
    col = mix(col, uSunColor * (0.85 + 0.4 * day), sunBand * 0.55 * smoothstep(-0.2, 0.0, uSunDir.y));
    // …while the far side stays cool, deepening toward violet overhead.
    col *= mix(vec3(1.0), vec3(0.9, 0.93, 1.06), (1.0 - sunSide) * lowSun * day * 0.6);
    col = mix(col, col * vec3(0.92, 0.82, 1.08), lowSun * day * smoothstep(0.3, 0.9, h) * 0.35);

    // Twilight, opposite the sun: the earth's own shadow rises as a blue-grey
    // band along the horizon, with a pink glow (the belt of Venus) above it.
    float opposite = 1.0 - sunSide;
    float twilight = smoothstep(-0.24, -0.03, uSunDir.y) * (1.0 - smoothstep(0.03, 0.22, uSunDir.y));
    col = mix(col, col * vec3(0.6, 0.66, 0.88), twilight * pow(opposite, 2.0) * (1.0 - smoothstep(0.0, 0.07, h)) * 0.7);
    col += vec3(0.5, 0.22, 0.3) * twilight * pow(opposite, 2.0) * smoothstep(0.03, 0.09, h) * (1.0 - smoothstep(0.11, 0.3, h)) * 0.5;
    // Night: a faint green airglow hugging the horizon.
    col += vec3(0.03, 0.08, 0.05) * uNight * exp(-h * 14.0);

    // ── Stars and the Milky Way, wheeling slowly ──
    float sc = cos(uStarTurn), ss = sin(uStarTurn);
    vec3 sky = vec3(dir.x * sc - dir.y * ss, dir.x * ss + dir.y * sc, dir.z);
    vec3 stars = vec3(0.0);
    float band = 0.0;
    if (uNight > 0.01) {
      vec3 axis = normalize(vec3(0.45, 0.35, 0.82));
      band = pow(1.0 - abs(dot(sky, axis)), 6.0);
      float core = pow(max(dot(sky, normalize(vec3(0.75, 0.2, -0.6))), 0.0), 3.0);   // brighter toward the galaxy's centre
      float dust = fbm(sky.xz * 6.0 + sky.y * 4.0);
      float lanes = smoothstep(0.42, 0.68, fbm(sky.xz * 11.0 - sky.y * 7.0 + 3.0));   // dark rifts of dust
      vec3 glow = mix(vec3(0.45, 0.52, 0.85), vec3(0.85, 0.75, 0.62), core) * dust * dust * (1.0 + core * 1.5) * (1.0 - lanes * 0.7);
      col += glow * band * uNight * uMilkyWay * smoothstep(0.0, 0.25, dir.y) * 0.6;

      float above = smoothstep(-0.02, 0.18, dir.y);
      // (A grid of n cells around has about 12·n² cells, so these fractions give ~9000 faint stars and ~700 bright ones.)
      stars += starLayer(sky, 170.0, (0.025 + band * 0.05) * uStarDensity, 0.7);   // many faint, thickest along the Milky Way
      stars += starLayer(sky, 62.0, 0.016 * uStarDensity, 1.4);                       // a few bright
      stars *= smoothstep(0.35, 0.9, uNight) * uStarBrightness * above;   // only once the sky is truly dark
    }

    // ── A vast pale world hanging low in the sky, lit by the same sun ──
    if (uPlanetSize > 0.0) {
      float cosAngle = dot(dir, uPlanetDir);
      float sinSize = sin(uPlanetSize);
      vec3 right = normalize(cross(uPlanetDir, vec3(0.0, 1.0, 0.0)));
      vec3 up = cross(right, uPlanetDir);
      vec2 disc = vec2(dot(dir, right), dot(dir, up)) / sinSize;
      float r2 = dot(disc, disc);
      if (cosAngle > 0.0 && r2 < 1.0) {
        vec3 n = normalize(disc.x * right + disc.y * up - sqrt(1.0 - r2) * uPlanetDir);
        float lit = smoothstep(-0.08, 0.35, dot(n, uSunDir));
        float bands = fbm(vec2(disc.y * 7.0 + fbm(disc * 3.0) * 0.8, disc.x * 1.3));
        vec3 surface = mix(uPlanetColorA, uPlanetColorB, bands) * lit;
        float edge = smoothstep(1.0, 0.92, r2);
        // By day it shows through the blue like a daytime moon; at night it glows, and hides the stars behind it.
        float presence = mix(0.34, 1.0, uNight);
        col = mix(col, col * (1.0 - 0.25 * presence) + surface * presence, edge);
        stars *= 1.0 - edge;
      }
      col += uPlanetColorB * pow(max(cosAngle, 0.0), 220.0 / max(uPlanetSize * 9.0, 0.2)) * 0.05 * mix(0.3, 1.0, uNight);
    }

    // ── The sun: a bright disc, darker toward its rim ──
    float sunAngle = acos(clamp(dot(dir, uSunDir), -1.0, 1.0));
    float sunR = 0.016;
    float sunDisc = 1.0 - smoothstep(sunR * 0.9, sunR * 1.05, sunAngle);
    float limb = sqrt(max(0.0, 1.0 - pow(sunAngle / sunR, 2.0)));
    col += uSunColor * uSunStrength * sunDisc * (0.55 + 0.45 * limb) * 9.0 * smoothstep(-0.01, 0.01, dir.y);

    // ── The moon, opposite the sun: grey seas on a pale face, and a soft halo ──
    vec3 moonDir = -uSunDir;
    float moonAngle = acos(clamp(dot(dir, moonDir), -1.0, 1.0));
    float moonR = 0.022;
    if (uMoonStrength > 0.0) {
      float face = 1.0 - smoothstep(moonR * 0.92, moonR, moonAngle);
      vec3 mr = normalize(cross(moonDir, vec3(0.0, 1.0, 0.0)));
      vec3 mu = cross(mr, moonDir);
      vec2 mp = vec2(dot(dir, mr), dot(dir, mu)) / moonR;
      float seas = smoothstep(0.45, 0.65, fbm(mp * 1.6 + 4.0));
      vec3 moon = vec3(0.92, 0.94, 1.0) * (1.0 - seas * 0.35) * (0.75 + 0.25 * sqrt(max(0.0, 1.0 - dot(mp, mp))));
      col = mix(col, moon * 1.6, face * uMoonStrength);
      col += vec3(0.6, 0.7, 1.0) * uMoonStrength * (pow(max(dot(dir, moonDir), 0.0), 900.0) * 0.5 + pow(max(dot(dir, moonDir), 0.0), 40.0) * 0.06);
      stars *= 1.0 - face;
    }

    // ── Aurora: slow curtains of light across the northern sky ──
    if (uAurora > 0.01 && dir.y > 0.03) {
      vec2 p = dir.xz / (dir.y + 0.35);
      float curtain = fbm(vec2(p.x * 1.6 + uTime * 0.02, p.y * 0.35 - uTime * 0.008));
      float ribbon = pow(1.0 - abs(curtain * 2.0 - 1.0), 11.0);
      float rays = 0.6 + 0.4 * vnoise(vec2(p.x * 26.0 + uTime * 0.15, uTime * 0.05));
      float where = smoothstep(0.03, 0.2, dir.y) * (1.0 - smoothstep(0.3, 0.75, dir.y)) * smoothstep(-0.2, 0.7, dir.z);
      vec3 hue = mix(vec3(0.15, 1.0, 0.55), vec3(0.6, 0.3, 1.0), smoothstep(0.15, 0.7, dir.y));
      col += hue * ribbon * rays * where * uAurora * 0.9;
    }

    // ── High cirrus: thin streaks combed out by the wind, first to catch the sunset ──
    float cloudShadowOnStars = 0.0;
    if (uCirrus > 0.01 && dir.y > 0.0) {
      vec2 cp = dir.xz / (dir.y + 0.32);
      vec2 streak = mat2(0.94, 0.34, -0.34, 0.94) * cp;
      float wisp = fbm(vec2(streak.x * 0.9, streak.y * 6.5) + vec2(uTime * 0.006, 0.0));
      wisp *= fbm(cp * 1.3 + 9.0 + uTime * 0.003);
      float amount = smoothstep(0.3, 0.52, wisp) * uCirrus * smoothstep(0.02, 0.25, dir.y);
      vec3 cirrus = mix(uCloudLit * 1.15, uSunColor * 1.5 + 0.1, lowSun * day * 0.75);
      cirrus += uSunColor * uSunStrength * pow(s, 6.0) * 0.8;
      col = mix(col, cirrus, amount * 0.42);
      cloudShadowOnStars = max(cloudShadowOnStars, amount);
    }

    // ── Cumulus: soft heaped clouds, lit on the side facing the light ──
    if (uCloudCover > 0.01 && dir.y > 0.0) {
      vec2 uv = dir.xz / (dir.y + 0.1) * 0.85 + vec2(uTime * 0.008, uTime * 0.003);
      float shape = fbm(uv) * 0.72 + fbm(uv * 2.6 + 40.0) * 0.28;
      float threshold = mix(0.72, 0.3, uCloudCover);   // more cover, lower threshold, more cloud
      float density = smoothstep(threshold, threshold + 0.16, shape);
      if (density > 0.001) {
        // Look a little toward the light: thinner there means this is the bright, sunward edge.
        vec2 toLight = normalize(uLightDir.xz + 1e-4) * 0.06;
        float towardLight = smoothstep(threshold, threshold + 0.16, fbm3(uv + toLight) * 0.72 + fbm3(uv * 2.6 + 40.0 + toLight * 2.6) * 0.28);
        float lit = clamp(0.55 + (density - towardLight) * 3.0, 0.0, 1.0);
        lit *= mix(1.0, 0.5, smoothstep(0.35, 1.0, density));   // thick cores and bellies are darker
        vec3 cloud = mix(uCloudShade * 0.82, uCloudLit * 1.08, lit);
        // Sunset: the sun shines up under the clouds, gilding them from below.
        cloud += uSunColor * (0.9 + 0.6 * day) * lowSun * smoothstep(-0.18, 0.02, uSunDir.y) * pow(sunSide, 1.5) * (0.35 + 0.65 * lit) * 0.8;
        // Silver lining: thin edges glow when the light is behind them.
        float lightBehind = pow(max(dot(dir, uLightDir), 0.0), 7.0);
        cloud += uSunColor * mix(1.0, 0.35, uNight) * (uSunStrength + uMoonStrength * 0.4) * lightBehind * (1.0 - density) * 1.6;
        // Far clouds fade into the haze along the horizon.
        cloud = mix(cloud, col, exp(-h * 9.0) * 0.6);
        float alpha = density * smoothstep(0.0, 0.14, dir.y) * 0.92;
        col = mix(col, cloud, alpha);
        cloudShadowOnStars = max(cloudShadowOnStars, alpha);
      }
    }

    col += stars * (1.0 - cloudShadowOnStars);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** @param renderer needed to capture the sky as light for the world (see skyLight below) */
export function createSky(scene, renderer) {
  const r = CONFIG.render;

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1500, 32, 16),
    new THREE.ShaderMaterial({
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uLightDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color() },
        uSunStrength: { value: 1 },
        uMoonStrength: { value: 0 },
        uTime: { value: 0 },
        uNight: { value: 0 },
        uCloudCover: { value: CONFIG.sky.clouds.cover },
        uCirrus: { value: CONFIG.sky.clouds.cirrus },
        uStarDensity: { value: CONFIG.sky.stars.density },
        uStarBrightness: { value: CONFIG.sky.stars.brightness },
        uTwinkle: { value: CONFIG.sky.stars.twinkle },
        uStarTurn: { value: 0 },
        uCloudLit: { value: new THREE.Color() },
        uCloudShade: { value: new THREE.Color() },
        uAurora: { value: 0 },
        uMilkyWay: { value: CONFIG.sky.milkyWay },
        uPlanetDir: { value: new THREE.Vector3(...CONFIG.sky.planet.direction).normalize() },
        uPlanetSize: { value: CONFIG.sky.planet.enabled ? THREE.MathUtils.degToRad(CONFIG.sky.planet.sizeDegrees) : 0 },
        uPlanetColorA: { value: new THREE.Color(CONFIG.sky.planet.colorA) },
        uPlanetColorB: { value: new THREE.Color(CONFIG.sky.planet.colorB) },
      },
    }),
  );
  dome.renderOrder = -2;
  dome.frustumCulled = false;

  // (Stars are drawn by the sky shader itself, so clouds, the moon and the planet hide them.)

  // Lights
  const sun = new THREE.DirectionalLight('#ffffff', 1);
  sun.castShadow = r.shadows;
  sun.shadow.mapSize.setScalar(r.shadowMapSize);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -r.shadowDistance;
  sc.right = sc.top = r.shadowDistance;
  sc.near = 1;
  sc.far = 400;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.06;

  const ambient = new THREE.HemisphereLight('#ffffff', '#444444', 1);

  scene.fog = new THREE.FogExp2('#ffffff', 0.004);
  scene.add(dome, sun, sun.target, ambient);

  // ── Sky light ──
  // Every so often the sky is captured into a soft, blurred image that lights
  // the world from every direction (scene.environment): blue from above, warm
  // on the sun's side, a little bounce from the ground below. Shaded sides of
  // things pick up the colour of the sky instead of going flat and dark, and
  // shiny surfaces such as water reflect it.
  const SL = CONFIG.atmosphere.skyLight;
  const skyLight = { target: null, timer: 0, generator: null, capturedAt: -1 };
  const envScene = new THREE.Scene();
  const envGround = new THREE.Mesh(new THREE.CircleGeometry(1400, 24).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#000000', fog: false, side: THREE.DoubleSide }));
  if (SL.enabled && renderer) {
    skyLight.generator = new THREE.PMREMGenerator(renderer);
    envScene.add(new THREE.Mesh(dome.geometry, dome.material)); // the same sky, at the origin
    envGround.position.y = -40;
    envScene.add(envGround);
  }
  function refreshSkyLight() {
    envGround.material.color.copy(state.ambientGround).multiplyScalar(SL.groundBounce * state.ambientIntensity);
    const target = skyLight.generator.fromScene(envScene, 0, 1, 3000, { size: SL.size });
    scene.environment = target.texture;
    skyLight.target?.dispose();
    skyLight.target = target;
  }

  const state = {}; // current blended keyframe, readable by other systems
  const sunDir = new THREE.Vector3();
  const lightDir = new THREE.Vector3();

  /** @param t time of day 0..1   @param focus Vector3 the sky/shadows centre on (the camera) */
  /** @param extra { time, aurora } — seconds elapsed, and 0..1 aurora strength for where you stand */
  function update(t, focus, fogMultiplier = 1, extra = {}) {
    sampleKeyframes(t, state);

    const angle = (t - 0.25) * Math.PI * 2;
    sunDir.set(Math.cos(angle), Math.sin(angle), CONFIG.sky.sunTilt).normalize();
    const day = sunDir.y > 0;
    lightDir.copy(sunDir).multiplyScalar(day ? 1 : -1); // moon sits opposite the sun

    const u = dome.material.uniforms;
    u.uTop.value.copy(state.skyTop);
    u.uHorizon.value.copy(state.skyHorizon);
    u.uSunDir.value.copy(sunDir);
    u.uLightDir.value.copy(lightDir);
    u.uSunColor.value.copy(day ? state.lightColor : keyframes[Math.floor(keyframes.length / 2)].lightColor);
    u.uSunStrength.value = THREE.MathUtils.smoothstep(sunDir.y, -0.12, 0.05);
    u.uMoonStrength.value = THREE.MathUtils.smoothstep(-sunDir.y, -0.05, 0.1);
    u.uTime.value = extra.time ?? 0;
    u.uNight.value = state.stars;
    u.uCloudCover.value = CONFIG.sky.clouds.cover;
    u.uCirrus.value = CONFIG.sky.clouds.cirrus;
    u.uAurora.value = state.stars * (extra.aurora ?? 0);
    // Clouds take their colour from the light of the hour.
    const sunShare = Math.min(state.lightIntensity, 3) * 0.22;
    u.uCloudLit.value.copy(state.ambientSky).multiplyScalar(0.55 * state.ambientIntensity);
    u.uCloudLit.value.r += state.lightColor.r * sunShare;
    u.uCloudLit.value.g += state.lightColor.g * sunShare;
    u.uCloudLit.value.b += state.lightColor.b * sunShare;
    u.uCloudShade.value.copy(state.skyTop).lerp(state.skyHorizon, 0.55).multiplyScalar(0.8);

    dome.position.copy(focus);
    u.uStarTurn.value = angle * 0.5;

    sun.color.copy(state.lightColor);
    sun.intensity = state.lightIntensity;
    sun.position.copy(focus).addScaledVector(lightDir, 200);
    sun.target.position.copy(focus);

    ambient.color.copy(state.ambientSky);
    ambient.groundColor.copy(state.ambientGround);
    ambient.intensity = state.ambientIntensity;

    if (skyLight.generator) {
      // The sky light takes over most of the soft light; the simple ambient keeps a little.
      ambient.intensity = state.ambientIntensity * (1 - SL.share);
      scene.environmentIntensity = state.ambientIntensity * SL.share * SL.strength;
      skyLight.timer -= extra.dt ?? 0;
      // Recapture every few seconds, and at once if the time of day has jumped (the G panel slider).
      const jumped = Math.abs(t - skyLight.capturedAt) > 0.004 && Math.abs(t - skyLight.capturedAt) < 0.996;
      if (skyLight.timer <= 0 || !skyLight.target || jumped) {
        skyLight.timer = SL.refreshSeconds;
        skyLight.capturedAt = t;
        refreshSkyLight();
      }
    }

    scene.fog.color.copy(state.skyHorizon);
    scene.fog.density = state.fogDensity * fogMultiplier;
  }

  return { update, state, lightDir, sunDir };
}
