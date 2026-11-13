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
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunStrength;
  uniform float uMoonStrength;
  uniform float uTime;
  uniform float uNight;        // 0 by day … 1 at night
  uniform float uCloudCover;   // 0 clear … 1 overcast
  uniform vec3 uCloudLit;
  uniform vec3 uCloudShade;
  uniform float uAurora;
  uniform float uMilkyWay;
  uniform vec3 uPlanetDir;
  uniform float uPlanetSize;   // angular radius in radians (0 = no planet)
  uniform vec3 uPlanetColorA;
  uniform vec3 uPlanetColorB;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + 17.0; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = max(dir.y, 0.0);
    vec3 col = mix(uHorizon, uTop, pow(h, 0.55));

    // ── Night sky: the Milky Way, a broad luminous band arching overhead ──
    if (uNight > 0.01 && uMilkyWay > 0.0) {
      vec3 axis = normalize(vec3(0.45, 0.35, 0.82));
      float band = pow(1.0 - abs(dot(dir, axis)), 7.0);
      float dust = fbm(dir.xz * 5.0 + dir.y * 3.0);
      col += vec3(0.5, 0.58, 0.95) * dust * dust * band * uNight * uMilkyWay * smoothstep(0.0, 0.25, dir.y) * 0.55;
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
        // By day it shows through the blue like a daytime moon; at night it glows.
        float presence = mix(0.34, 1.0, uNight);
        col = mix(col, col * (1.0 - 0.25 * presence) + surface * presence, edge);
      }
      // a faint halo of its atmosphere
      col += uPlanetColorB * pow(max(cosAngle, 0.0), 220.0 / max(uPlanetSize * 9.0, 0.2)) * 0.05 * mix(0.3, 1.0, uNight);
    }

    // ── Sun and moon ──
    float s = max(dot(dir, uSunDir), 0.0);
    col += uSunColor * uSunStrength * (smoothstep(0.9993, 0.9996, s) * 6.0 + pow(s, 400.0) * 0.8 + pow(s, 12.0) * 0.25);
    float m = max(dot(dir, -uSunDir), 0.0);
    col += vec3(0.75, 0.82, 1.0) * uMoonStrength * (smoothstep(0.9996, 0.9998, m) * 2.5 + pow(m, 300.0) * 0.25);

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

    // ── Clouds: a slow high layer, lit along its edges by the sun ──
    if (uCloudCover > 0.01 && dir.y > 0.0) {
      vec2 uv = dir.xz / (dir.y + 0.14) * 0.55 + vec2(uTime * 0.004, uTime * 0.0016);
      float density = fbm(uv) * 0.65 + fbm(uv * 2.7 + 40.0) * 0.35;
      float cover = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.3, density) * smoothstep(0.0, 0.2, dir.y);
      float thickness = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.55, density);
      vec3 cloud = mix(uCloudLit, uCloudShade, thickness * 0.75);
      cloud += uSunColor * uSunStrength * pow(s, 6.0) * (1.0 - thickness) * 0.9;   // silver lining toward the sun
      col = mix(col, cloud, cover * 0.9);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function createSky(scene) {
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
        uSunColor: { value: new THREE.Color() },
        uSunStrength: { value: 1 },
        uMoonStrength: { value: 0 },
        uTime: { value: 0 },
        uNight: { value: 0 },
        uCloudCover: { value: CONFIG.sky.clouds.cover },
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

  // Stars
  const starPositions = new Float32Array(CONFIG.sky.starCount * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < CONFIG.sky.starCount; i++) {
    v.randomDirection().multiplyScalar(1400);
    v.toArray(starPositions, i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false }),
  );
  stars.renderOrder = -1;
  stars.frustumCulled = false;

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
  scene.add(dome, stars, sun, sun.target, ambient);

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
    u.uSunColor.value.copy(day ? state.lightColor : keyframes[Math.floor(keyframes.length / 2)].lightColor);
    u.uSunStrength.value = THREE.MathUtils.smoothstep(sunDir.y, -0.12, 0.05);
    u.uMoonStrength.value = THREE.MathUtils.smoothstep(-sunDir.y, -0.05, 0.1);
    u.uTime.value = extra.time ?? 0;
    u.uNight.value = state.stars;
    u.uCloudCover.value = CONFIG.sky.clouds.cover;
    u.uAurora.value = state.stars * (extra.aurora ?? 0);
    // Clouds take their colour from the light of the hour.
    const sunShare = Math.min(state.lightIntensity, 3) * 0.22;
    u.uCloudLit.value.copy(state.ambientSky).multiplyScalar(0.55 * state.ambientIntensity);
    u.uCloudLit.value.r += state.lightColor.r * sunShare;
    u.uCloudLit.value.g += state.lightColor.g * sunShare;
    u.uCloudLit.value.b += state.lightColor.b * sunShare;
    u.uCloudShade.value.copy(state.skyTop).lerp(state.skyHorizon, 0.55).multiplyScalar(0.8);

    dome.position.copy(focus);
    stars.position.copy(focus);
    stars.rotation.z = angle * 0.5;
    stars.material.opacity = state.stars;
    stars.visible = state.stars > 0.01;

    sun.color.copy(state.lightColor);
    sun.intensity = state.lightIntensity;
    sun.position.copy(focus).addScaledVector(lightDir, 200);
    sun.target.position.copy(focus);

    ambient.color.copy(state.ambientSky);
    ambient.groundColor.copy(state.ambientGround);
    ambient.intensity = state.ambientIntensity;

    scene.fog.color.copy(state.skyHorizon);
    scene.fog.density = state.fogDensity * fogMultiplier;
  }

  return { update, state, lightDir };
}
