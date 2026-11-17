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
    const segments = 420;
    const positions = [];
    const normals = [];
    const hazes = [];

    // Height profile around the ring: ridged noise, with stretches of open sea.
    const profile = [];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const x = Math.cos(a) * 2.2 + layer * 9.1;
      const z = Math.sin(a) * 2.2;
      let ridged = 0;
      let amp = 1;
      let freq = 1;
      let norm = 0;
      for (let o = 0; o < 4; o++) {
        ridged += (1 - Math.abs(noise.noise(x * freq, z * freq))) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2.0;
      }
      ridged /= norm;
      const massif = noise.noise(x * 0.45 + 31, z * 0.45) * 0.5 + 0.5; // where ranges exist at all
      const presence = THREE.MathUtils.smoothstep(massif, range.gaps, range.gaps + 0.25);
      profile.push(Math.max(0, Math.pow(ridged, 1.6) * presence) * range.height);
    }

    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const h0 = profile[i];
      const h1 = profile[i + 1];
      if (h0 < 2 && h1 < 2) continue; // open sea
      // The ridge wanders nearer and further so its faces catch the light differently.
      const r0 = range.distance * (1 + noise.noise(i * 0.31 + layer * 50, 7.7) * 0.06);
      const r1 = range.distance * (1 + noise.noise((i + 1) * 0.31 + layer * 50, 7.7) * 0.06);
      const p = (a, r, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
      const base = -40;
      const quad = [p(a0, r0, base), p(a1, r1, base), p(a1, r1, h1), p(a0, r0, base), p(a1, r1, h1), p(a0, r0, h0)];
      const heights = [0, 0, h1, 0, h1, h0];

      // Face normal, pointing back toward the island.
      const e1 = new THREE.Vector3(...quad[1]).sub(new THREE.Vector3(...quad[0]));
      const e2 = new THREE.Vector3(...quad[5]).sub(new THREE.Vector3(...quad[0]));
      const n = e1.cross(e2).normalize();
      if (n.x * quad[0][0] + n.z * quad[0][2] > 0) n.negate();
      n.y += 0.35; // lean the faces back like real slopes
      n.normalize();

      quad.forEach((v, k) => {
        positions.push(...v);
        normals.push(n.x, n.y, n.z);
        // Haze: total at sea level, thinning toward the summits, thicker for far ranges.
        hazes.push(THREE.MathUtils.lerp(1, range.haze, THREE.MathUtils.smoothstep(heights[k], 0, range.height * 0.45)));
      });
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('aHaze', new THREE.Float32BufferAttribute(hazes, 1));

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
      },
      side: THREE.DoubleSide,
      fog: false,
      vertexShader: /* glsl */ `
        attribute float aHaze;
        varying vec3 vPos;
        varying vec3 vNormal;
        varying float vHaze;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vPos = world.xyz;
          vNormal = normal;
          vHaze = aHaze;
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
          vec3 N = normalize(normalize(vNormal) + (across * (nSide - n) + vec3(0.0, nUp - n, 0.0) * 0.6) / 0.035 * 0.55 * uDetail);
          float lit = max(dot(N, uLightDir), 0.0);

          // Snow settles above a ragged line, deeper in the gullies than on the spurs.
          float line = uSnowLine + (n - 0.5) * 0.45;
          float snow = smoothstep(line, line + 0.06, t);
          vec3 rock = uRock * (0.82 + 0.3 * n) * (0.94 + 0.06 * sin(vPos.y * 0.035 + n * 5.0));   // faint strata
          vec3 surface = mix(rock, uSnow, snow);
          vec3 col = surface * (uAmbient * (0.75 + 0.5 * n) + uLight * lit);

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
