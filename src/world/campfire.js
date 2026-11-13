// Campfires: flickering flames, rising embers and a warm light.
// Only the nearest fire gets a real light and embers — one moving light is
// cheap, a light per fire would slow the whole scene down.

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { heightAt } from './terrain.js';

export function createCampfires(template, positions) {
  const c = CONFIG.campfire;
  const group = new THREE.Group();
  const fires = positions.map(({ x, z }, index) => {
    const object = template.clone();
    object.position.set(x, heightAt(x, z), z);
    object.rotation.y = index * 1.3;
    const flames = [];
    object.traverse((o) => {
      if (o.name === 'flame') flames.push(o);
      if (o.isMesh) o.castShadow = o.name !== 'flame';
    });
    group.add(object);
    return { x, z, y: object.position.y, flames, phase: index * 2.7 };
  });

  const light = new THREE.PointLight(c.lightColor, 0, c.lightRange, 1.6);
  group.add(light);

  // Embers: a handful of sparks looping upward from the nearest fire.
  const count = c.embers;
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
  const emberMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uOrigin: { value: new THREE.Vector3() }, uFade: { value: 0 } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uOrigin;
      varying float vLife;
      void main() {
        float life = fract(uTime * (0.18 + position.x * 0.22) + position.y);   // 0 = just born, 1 = gone
        float angle = position.z * 6.2831 + life * 2.0;
        vec3 p = uOrigin + vec3(cos(angle) * (0.1 + life * 0.5), 0.5 + life * 3.2, sin(angle) * (0.1 + life * 0.5));
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (1.0 - life) * 60.0 / max(-mv.z, 1.0);
        vLife = life;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      varying float vLife;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(vec3(2.4, 1.1, 0.35), smoothstep(0.5, 0.0, d) * (1.0 - vLife) * uFade);
      }`,
  });
  const embers = new THREE.Points(emberGeo, emberMat);
  embers.frustumCulled = false;
  group.add(embers);

  /** @returns distance from the player to the nearest fire (Infinity if none) */
  function update(time, playerPosition) {
    let nearest = null;
    let nearestDistance = Infinity;
    for (const fire of fires) {
      const d = Math.hypot(fire.x - playerPosition.x, fire.z - playerPosition.z);
      if (d < nearestDistance) {
        nearestDistance = d;
        nearest = fire;
      }
      if (d > 150) continue; // too far to see the flicker
      fire.flames.forEach((flame, i) => {
        const t = time * (11 + i * 4) + fire.phase + i;
        const stretch = 1 + Math.sin(t) * 0.14 + Math.sin(t * 2.3) * 0.09;
        flame.scale.set(1 - (stretch - 1) * 0.5, stretch, 1 - (stretch - 1) * 0.5);
        flame.rotation.y = time * (1.5 + i);
      });
    }

    if (nearest) {
      // Fade the light and embers out with distance so switching fires is invisible.
      const fade = 1 - THREE.MathUtils.smoothstep(nearestDistance, c.lightFadeDistance * 0.5, c.lightFadeDistance);
      const flicker = 0.82 + Math.sin(time * 9 + nearest.phase) * 0.1 + Math.sin(time * 23.1) * 0.08;
      light.position.set(nearest.x, nearest.y + 0.9, nearest.z);
      light.intensity = c.lightIntensity * flicker * fade;
      light.visible = fade > 0.001;
      emberMat.uniforms.uTime.value = time;
      emberMat.uniforms.uOrigin.value.set(nearest.x, nearest.y, nearest.z);
      emberMat.uniforms.uFade.value = fade;
      embers.visible = fade > 0.001;
    }
    return nearestDistance;
  }

  return { object: group, update };
}
