// The far horizon: colossal mountain ranges standing in the sea, kilometres
// beyond the island. You can never reach them — they exist for scale.
//
// Each range is a ring of jagged peaks around the island, drawn in layers.
// Further layers are taller and paler (aerial perspective), and every range
// dissolves into haze at its base so the peaks seem to float above the sea.

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { seededRandom } from './noise.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';

export function createHorizon() {
  const H = CONFIG.horizon;
  const group = new THREE.Group();
  group.name = 'horizon';
  if (!H.enabled) return { object: group, update() {} };

  const noise = new SimplexNoise({ random: seededRandom(CONFIG.seed + 404) });
  const uniforms = {
    uHorizon: { value: new THREE.Color() },
    uLight: { value: new THREE.Color() },
    uAmbient: { value: new THREE.Color() },
    uLightDir: { value: new THREE.Vector3(0, 1, 0) },
  };

  H.ranges.forEach((range, layer) => {
    // A real band of mountains (not a backdrop): a ring of land around the island,
    // as wide as the range is far away, rising to ridges and peaks in the middle and
    // falling away to the sea at both edges. Heights from ridged noise in 2D, so
    // peaks, cols, spurs and valleys all have depth and catch the light.
    const around = 900;
    const across = 34;
    const width = range.distance * 0.42;
    const scale = range.height * 2.6; // size of the largest features (m)
    const ridged = (x, z) => {
      let sum = 0;
      let amp = 1;
      let freq = 1 / scale;
      let norm = 0;
      let prev = 1;
      for (let o = 0; o < 6; o++) {
        let v = 1 - Math.abs(noise.noise(x * freq + layer * 17.3, z * freq - o * 3.1));
        v *= v;
        sum += v * amp * prev; // (finer ridges only where the coarse ones stand: eroded, not bumpy)
        prev = Math.min(1, v * 1.6);
        norm += amp;
        amp *= 0.5;
        freq *= 2.03;
      }
      return sum / norm;
    };
    const positions = [];
    for (let j = 0; j <= across; j++) {
      const u = j / across; // 0 near edge … 1 far edge
      const r = range.distance - width / 2 + width * u;
      const cross = Math.pow(Math.sin(Math.PI * u), 0.7); // (highest along the middle of the band)
      for (let i = 0; i <= around; i++) {
        const a = (i / around) * Math.PI * 2;
        const wobble = noise.noise(Math.cos(a) * 3 + layer * 9, Math.sin(a) * 3) * width * 0.18; // (the band wanders)
        const x = Math.cos(a) * (r + wobble);
        const z = Math.sin(a) * (r + wobble);
        const massif = noise.noise(Math.cos(a) * 2.2 * 0.45 + layer * 4.1 + 31, Math.sin(a) * 2.2 * 0.45) * 0.5 + 0.5; // where ranges exist at all
        const presence = THREE.MathUtils.smoothstep(massif, range.gaps, range.gaps + 0.25);
        const h = range.height * presence * cross * (0.25 + 0.95 * ridged(x, z));
        positions.push(x, h * 1.15 - 45 * (1 - cross), z);
      }
    }
    const index = [];
    for (let j = 0; j < across; j++) {
      for (let i = 0; i < around; i++) {
        const a = j * (around + 1) + i;
        const b = a + around + 1;
        index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();

    // Each range has its own size and rock colour; the light is shared.
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...uniforms,
        uRock: { value: new THREE.Color(range.color) },
        uSnow: { value: new THREE.Color(H.snowColor) },
        uHeight: { value: range.height },
        uSnowLine: { value: H.snowLine },
        uSeed: { value: layer * 13.7 },
        uDetail: { value: H.detail },
        uBaseHaze: { value: range.haze },
      },
      side: THREE.FrontSide,
      fog: false,
      vertexShader: /* glsl */ `
        uniform float uHeight;
        uniform float uBaseHaze;
        varying vec3 vPos;
        varying vec3 vNormal;
        varying float vHaze;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vPos = world.xyz;
          vNormal = normal;
          // Haze: total at sea level, thinning toward the summits, thicker for far ranges.
          vHaze = mix(0.85, uBaseHaze, smoothstep(0.0, uHeight * 0.35, position.y));
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uHorizon;
        uniform vec3 uLight;
        uniform vec3 uAmbient;
        uniform vec3 uLightDir;
        uniform vec3 uRock;
        uniform vec3 uSnow;
        uniform float uHeight;
        uniform float uSnowLine;
        uniform float uSeed;
        uniform float uDetail;
        varying vec3 vPos;
        varying vec3 vNormal;
        varying float vHaze;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float fbm(vec2 p) {
          float v = 0.0; float a = 0.5;
          for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.07 + 13.1; a *= 0.5; }
          return v;
        }

        void main() {
          float t = clamp(vPos.y / uHeight, 0.0, 1.0);   // 0 at the sea … 1 at the highest peaks
          float around = atan(vPos.z, vPos.x) * length(vPos.xz);   // metres along the ring

          // Erosion: gullies and spurs running down the face, stretched vertically.
          vec2 q = vec2(around * 1.5, vPos.y * 0.42) / uHeight * 7.0 + uSeed;
          float n = fbm(q);
          float nSide = fbm(q + vec2(0.035, 0.0));
          float nUp = fbm(q + vec2(0.0, 0.035));

          // Light the face as if it were carved: tilt the normal by the slope of the gullies.
          vec3 across = normalize(vec3(-vPos.z, 0.0, vPos.x));
          vec3 N = normalize(vNormal);
          float lit = max(dot(N, uLightDir), 0.0);

          // Snow settles above a ragged line, deeper in the gullies than on the spurs.
          float line = uSnowLine + (n - 0.5) * 0.45;
          float snow = smoothstep(line, line + 0.06, t) * smoothstep(0.45, 0.7, normalize(vNormal).y); // (it can't cling to steep rock)
          vec3 rock = uRock * (0.8 + 0.35 * n);
          vec3 surface = mix(rock, uSnow, snow);
          vec3 col = surface * (uAmbient * (0.55 + 0.45 * N.y) + uLight * lit);

          // Aerial perspective: distance and low altitude dissolve the range into
          // the sky, and the haze glows on the side facing the sun.
          vec3 toward = normalize(vPos - cameraPosition);
          float sunSide = pow(max(dot(toward, uLightDir), 0.0), 4.0);
          vec3 haze = uHorizon + uLight * 0.12 * sunSide;
          col = mix(col, haze, clamp(vHaze, 0.0, 1.0));

          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1 + layer * -0.01; // far ranges first, all before the island
    group.add(mesh);
  });

  /** @param state the sky's blended keyframe  @param lightDir direction toward the sun or moon */
  function update(state, lightDir) {
    uniforms.uHorizon.value.copy(state.skyHorizon);
    uniforms.uLight.value.copy(state.lightColor).multiplyScalar(Math.min(state.lightIntensity, 3) * 0.33);
    uniforms.uAmbient.value.copy(state.ambientSky).multiplyScalar(state.ambientIntensity * 0.45);
    uniforms.uLightDir.value.copy(lightDir);
  }

  return { object: group, update };
}
