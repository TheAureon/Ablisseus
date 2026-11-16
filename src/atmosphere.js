// Shared shading: things every material in the world should agree on.
//
//   • Fog that behaves like air: it gathers in low ground, thins as you
//     climb, and glows warm when you look toward the sun.
//   • A handful of "what is the light doing right now" values that any shader
//     can read (sun direction and colour, sky colour, time).
//
// three.js builds its materials from shared chunks of shader code, so the fog
// is upgraded once here, for everything, by replacing those chunks. Import
// this file before any material is created (main.js does so first).

import * as THREE from 'three';
import { CONFIG } from './config.js';

/** Live values for shaders. main.js updates them every frame. */
export const atmosphere = {
  uFogSunDir: { value: new THREE.Vector3(0, 1, 0) }, // toward the sun or moon, world space
  uFogSunColor: { value: new THREE.Color(0, 0, 0) }, // its glow in the haze
  uFogFalloff: { value: 1 / CONFIG.atmosphere.mistHeight }, // how quickly mist thins with height
  uFogFloor: { value: CONFIG.atmosphere.highAirFog }, // share of the fog that remains high up
  uSkyColor: { value: new THREE.Color() }, // what water and wet things reflect
  uTime: { value: 0 },
};
// The same sun, under names shaders can declare for themselves (the fog code already declares the two above).
atmosphere.uSunDir = atmosphere.uFogSunDir;
atmosphere.uSunColor = atmosphere.uFogSunColor;

/** Gives a shader access to the values above. Call from any onBeforeCompile. */
export function applyAtmosphere(shader) {
  for (const name in atmosphere) if (!(name in shader.uniforms)) shader.uniforms[name] = atmosphere[name];
}

// Every material without its own onBeforeCompile gets the values automatically.
THREE.Material.prototype.onBeforeCompile = applyAtmosphere;

THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogView;
#endif`;

THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogView = mvPosition.xyz;
#endif`;

THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogView;
  uniform vec3 uFogSunDir;
  uniform vec3 uFogSunColor;
  uniform float uFogFalloff;
  uniform float uFogFloor;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;

THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    // Mist lies low: judge the air by the average height of the line of sight.
    vec3 fogUp = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
    float fogMeanHeight = cameraPosition.y + dot(vFogView, fogUp) * 0.5;
    float fogAir = mix(uFogFloor, 1.0, exp(-max(fogMeanHeight, 0.0) * uFogFalloff));
    float fogAmount = fogDensity * fogAir * vFogDepth;
    float fogFactor = 1.0 - exp(-fogAmount * fogAmount);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  // Haze lights up toward the sun.
  vec3 fogSunView = (viewMatrix * vec4(uFogSunDir, 0.0)).xyz;
  float fogTowardSun = pow(max(dot(normalize(vFogView), fogSunView), 0.0), 5.0);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor + uFogSunColor * fogTowardSun, fogFactor);
#endif`;

/** Smooth 2D noise for use inside shaders (paste into a shader's header). */
export const NOISE_GLSL = /* glsl */ `
  float aHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float aNoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);   // quintic ease: no visible grid creases
    return mix(mix(aHash(i), aHash(i + vec2(1.0, 0.0)), f.x), mix(aHash(i + vec2(0.0, 1.0)), aHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }`;

/**
 * The finishing pass: a gentle colour grade and a soft darkening toward the
 * corners. Used by main.js after bloom.
 */
export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSaturation: { value: CONFIG.render.grade.saturation },
    uContrast: { value: CONFIG.render.grade.contrast },
    uVignette: { value: CONFIG.render.grade.vignette },
    uWarmth: { value: CONFIG.render.grade.warmth },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uVignette;
    uniform float uWarmth;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 c = texel.rgb;
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, uSaturation);
      c = max(vec3(0.0), (c - 0.18) * uContrast + 0.18);          // contrast about mid-grey
      c *= mix(vec3(1.0), vec3(1.04, 1.0, 0.95), uWarmth);       // a touch of warmth in the light…
      c += vec3(-0.004, 0.0, 0.008) * uWarmth * (1.0 - smoothstep(0.0, 0.3, luma));   // …and coolness in the shadows
      vec2 q = vUv - 0.5;
      c *= 1.0 - uVignette * smoothstep(0.25, 0.95, dot(q, q) * 2.2);
      gl_FragColor = vec4(c, texel.a);
    }`,
};
