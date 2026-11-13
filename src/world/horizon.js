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
    const colors = [];
    const normals = [];
    const hazes = [];
    const rock = new THREE.Color(range.color);
    const snow = new THREE.Color(H.snowColor);
    const c = new THREE.Color();

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
        const t = heights[k] / range.height;
        c.copy(rock).lerp(snow, THREE.MathUtils.smoothstep(t, H.snowLine - 0.12, H.snowLine + 0.12));
        colors.push(c.r, c.g, c.b);
        // Haze: total at sea level, thinning toward the summits, thicker for far ranges.
        hazes.push(THREE.MathUtils.lerp(1, range.haze, THREE.MathUtils.smoothstep(heights[k], 0, range.height * 0.45)));
      });
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('aHaze', new THREE.Float32BufferAttribute(hazes, 1));

    const material = new THREE.ShaderMaterial({
      uniforms,
      side: THREE.DoubleSide,
      fog: false,
      vertexShader: /* glsl */ `
        attribute vec3 color;
        attribute float aHaze;
        varying vec3 vColor;
        varying vec3 vNormal;
        varying float vHaze;
        void main() {
          vColor = color;
          vNormal = normal;
          vHaze = aHaze;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uHorizon;
        uniform vec3 uLight;
        uniform vec3 uAmbient;
        uniform vec3 uLightDir;
        varying vec3 vColor;
        varying vec3 vNormal;
        varying float vHaze;
        void main() {
          float lit = max(dot(normalize(vNormal), uLightDir), 0.0);
          vec3 col = vColor * (uAmbient + uLight * lit);
          col = mix(col, uHorizon, clamp(vHaze, 0.0, 1.0));
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
