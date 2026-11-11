// Drifting specks of light around the player (pollen by day, fireflies by
// night). They live in a box that wraps around the camera, so they are
// everywhere without needing many of them.

import * as THREE from 'three';
import { CONFIG } from '../config.js';

export function createMotes() {
  const c = CONFIG.motes;
  const positions = new Float32Array(c.count * 3);
  const phases = new Float32Array(c.count);
  for (let i = 0; i < c.count; i++) {
    positions[i * 3] = Math.random() * c.box[0];
    positions[i * 3 + 1] = Math.random() * c.box[1];
    positions[i * 3 + 2] = Math.random() * c.box[2];
    phases[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(...c.box) },
      uSize: { value: c.size },
      uColor: { value: new THREE.Color(c.color) },
      uIntensity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uCam;
      uniform vec3 uBox;
      uniform float uSize;
      attribute float aPhase;
      varying float vAlpha;
      void main() {
        float p = aPhase * 6.2831;
        vec3 drift = vec3(sin(uTime * 0.31 + p * 3.0), sin(uTime * 0.23 + p * 5.0) * 0.6, cos(uTime * 0.27 + p * 2.0)) * 1.8;
        vec3 world = mod(position + drift - uCam, uBox) - uBox * 0.5 + uCam;
        vec4 mv = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(uSize * 30.0 / max(-mv.z, 1.0), uSize * 2.5);
        float edge = 1.0 - smoothstep(0.35, 0.5, length((world - uCam) / uBox));
        vAlpha = edge * max(0.45 + 0.55 * sin(uTime * 1.7 + p * 9.0), 0.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vAlpha * uIntensity;
        gl_FragColor = vec4(uColor * 1.6, a);
      }`,
  });

  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  points.name = 'motes';

  function update(time, cameraPosition, intensity) {
    material.uniforms.uTime.value = time;
    material.uniforms.uCam.value.copy(cameraPosition);
    material.uniforms.uIntensity.value = intensity;
  }

  return { object: points, update };
}
