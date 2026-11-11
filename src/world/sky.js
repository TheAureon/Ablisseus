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
  varying vec3 vDir;
  void main() {
    vec3 dir = normalize(vDir);
    float h = max(dir.y, 0.0);
    vec3 col = mix(uHorizon, uTop, pow(h, 0.55));

    float s = max(dot(dir, uSunDir), 0.0);
    col += uSunColor * uSunStrength * (smoothstep(0.9993, 0.9996, s) * 6.0 + pow(s, 400.0) * 0.8 + pow(s, 12.0) * 0.25);

    float m = max(dot(dir, -uSunDir), 0.0);
    col += vec3(0.75, 0.82, 1.0) * uMoonStrength * (smoothstep(0.9996, 0.9998, m) * 2.5 + pow(m, 300.0) * 0.25);

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
  function update(t, focus, fogMultiplier = 1) {
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

  return { update, state };
}
