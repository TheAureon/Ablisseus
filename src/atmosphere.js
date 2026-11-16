// Shared shading: things every material in the world should agree on.
//
//   • Fog that behaves like air: it gathers in low ground, thins as you
//     climb, and glows warm when you look toward the sun.
//   • Cloud shadows: the light of the sun dims and brightens as clouds drift
//     over, in slow patches that cross the land.
//   • A soft rim of sky light on the edges of everything, which rounds out
//     simple shapes and separates them from what is behind.
//   • A handful of "what is the light doing right now" values that any shader
//     can read (sun direction and colour, sky colour, time).
//
// three.js builds its materials from shared chunks of shader code, so the fog
// is upgraded once here, for everything, by replacing those chunks. Import
// this file before any material is created (main.js does so first).

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { CONFIG } from './config.js';

/** Live values for shaders. main.js updates them every frame. */
export const atmosphere = {
  uFogSunDir: { value: new THREE.Vector3(0, 1, 0) }, // toward the sun or moon, world space
  uFogSunColor: { value: new THREE.Color(0, 0, 0) }, // its glow in the haze
  uFogFalloff: { value: 1 / CONFIG.atmosphere.mistHeight }, // how quickly mist thins with height
  uFogFloor: { value: CONFIG.atmosphere.highAirFog }, // share of the fog that remains high up
  uSkyColor: { value: new THREE.Color() }, // what water and wet things reflect
  uTime: { value: 0 },
  uAtmoTime: { value: 0 }, // (the same clock, under a name no other shader uses)
  uAtmoSky: { value: new THREE.Color() }, // the colour of the rim light
  uAtmoRim: { value: CONFIG.atmosphere.rimLight },
  uAtmoCloudCover: { value: CONFIG.sky.clouds.cover },
  uAtmoCloudShadow: { value: CONFIG.atmosphere.cloudShadows },
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

  uniform float uAtmoTime;
  uniform vec3 uAtmoSky;
  uniform float uAtmoRim;
  uniform float uAtmoCloudCover;
  uniform float uAtmoCloudShadow;
  float atmoHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float atmoNoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(mix(atmoHash(i), atmoHash(i + vec2(1.0, 0.0)), f.x), mix(atmoHash(i + vec2(0.0, 1.0)), atmoHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  // How much direct light reaches this point through the drifting clouds (1 = full sun).
  float atmoCloudLight() {
    if (uAtmoCloudShadow <= 0.0) return 1.0;
    vec3 world = cameraPosition + transpose(mat3(viewMatrix)) * vFogView;
    // The same slow drift as the clouds in the sky, laid over the ground.
    vec2 uv = world.xz * 0.0022 + vec2(uAtmoTime * 0.004, uAtmoTime * 0.0016);
    float density = atmoNoise(uv) * 0.5 + atmoNoise(uv * 2.03 + 17.0) * 0.3 + atmoNoise(uv * 4.1 + 31.0) * 0.2;
    float shade = smoothstep(1.0 - uAtmoCloudCover - 0.08, 1.0 - uAtmoCloudCover + 0.22, density * 1.15);
    return 1.0 - shade * uAtmoCloudShadow;
  }
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

// Cloud shadows: dim each directional light (the sun, or the moon) by the clouds above the point being lit.
{
  const call = 'getDirectionalLightInfo( directionalLight, directLight );';
  if (!THREE.ShaderChunk.lights_fragment_begin.includes(call)) console.warn('[atmosphere] cloud shadows: three.js lighting code has changed; skipping');
  THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.replace(
    call,
    `${call}
    #ifdef USE_FOG
      directLight.color *= atmoCloudLight();
    #endif`,
  );
}

// Rim light: surfaces seen edge-on pick up the colour of the sky, most of all where they face upward.
THREE.ShaderChunk.lights_fragment_end += /* glsl */ `
#ifdef USE_FOG
  {
    float atmoEdge = pow(1.0 - clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0), 3.0);
    float atmoUp = dot(geometryNormal, (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz) * 0.5 + 0.5;
    reflectedLight.indirectDiffuse += material.diffuseColor * uAtmoSky * atmoEdge * (0.35 + 0.65 * atmoUp) * uAtmoRim;
  }
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

/**
 * Light shafts: where the sun is in view, its brightness is smeared outward
 * along lines from the sun, so anything in front of it — trees, hills, rocks —
 * cuts visible shafts of light and shadow through the haze.
 * Worked out at half resolution, then laid over the picture.
 */
export class GodRaysPass extends Pass {
  constructor() {
    super();
    const G = CONFIG.render.godRays;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.quad = new FullScreenQuad();
    const vertexShader = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
    this.rays = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 1 } },
      defines: { SAMPLES: G.samples },
      vertexShader,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform vec2 uSun;
        uniform float uAspect;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec2 step = (uSun - vUv) / float(SAMPLES) * 0.92;
          vec2 uv = vUv + step * hash(vUv * 917.0) * 0.2;   // a very little jitter softens the separate samples without adding grain
          vec3 sum = vec3(0.0);
          float weight = 1.0;
          for (int i = 0; i < SAMPLES; i++) {
            uv += step;
            vec3 c = texture2D(tDiffuse, uv).rgb;
            // Only the bright sky close around the sun gives off shafts; everything else blocks them.
            vec2 away = (uv - uSun) * vec2(uAspect, 1.0);
            float nearSun = 1.0 - smoothstep(0.05, 0.42, length(away));
            float bright = smoothstep(0.75, 1.9, dot(c, vec3(0.2126, 0.7152, 0.0722)));
            sum += min(c, vec3(6.0)) * bright * nearSun * weight;
            weight *= 0.965;
          }
          gl_FragColor = vec4(sum / float(SAMPLES), 1.0);
        }`,
    });
    this.blend = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tRays: { value: null }, uStrength: { value: 0 } },
      vertexShader,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tRays;
        uniform float uStrength;
        varying vec2 vUv;
        void main() {
          vec4 scene = texture2D(tDiffuse, vUv);
          gl_FragColor = vec4(scene.rgb + texture2D(tRays, vUv).rgb * uStrength, scene.a);
        }`,
    });
    this.strength = 0; // set every frame by main.js; 0 switches the pass off
  }

  /** Aims the shafts. `sun` is the sun's position on screen (0..1 each way); `strength` 0 turns them off. */
  aim(sunX, sunY, strength, aspect) {
    this.rays.uniforms.uSun.value.set(sunX, sunY);
    this.rays.uniforms.uAspect.value = aspect;
    this.strength = strength;
    this.enabled = strength > 0.003;
  }

  setSize(width, height) {
    this.target.setSize(Math.max(1, Math.ceil(width / 2)), Math.max(1, Math.ceil(height / 2)));
  }

  render(renderer, writeBuffer, readBuffer) {
    this.rays.uniforms.tDiffuse.value = readBuffer.texture;
    this.quad.material = this.rays;
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);

    this.blend.uniforms.tDiffuse.value = readBuffer.texture;
    this.blend.uniforms.tRays.value = this.target.texture;
    this.blend.uniforms.uStrength.value = this.strength;
    this.quad.material = this.blend;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}
