// Scatters instanced props over the terrain (CONFIG.scatter) and places
// one-off landmarks (CONFIG.landmarks). Works the same for placeholders and
// loaded models: every mesh inside an asset becomes one InstancedMesh.

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { heightAt, slopeAt, noise2, seededRandom, findDryLand } from './terrain.js';

/** Shared wind clock — main.js advances `uTime.value` every frame. */
export const windUniforms = { uTime: { value: 0 } };

function addSway(material, amount) {
  const m = material.clone();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uSway = { value: amount };
    shader.uniforms.uWindSpeed = { value: CONFIG.wind.speed };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uSway;\nuniform float uWindSpeed;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float swayPhase = instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.27;
        #else
          float swayPhase = 0.0;
        #endif
        float swayBend = max(transformed.y, 0.0) * uSway;
        transformed.x += sin(uTime * uWindSpeed + swayPhase) * swayBend;
        transformed.z += cos(uTime * uWindSpeed * 0.7 + swayPhase * 1.3) * swayBend * 0.6;`,
      );
  };
  m.customProgramCacheKey = () => 'sway';
  return m;
}

/** Picks instance transforms for one scatter layer. */
function placeLayer(layer, index) {
  const rand = seededRandom(CONFIG.seed * 31 + index * 977 + 5);
  const radius = CONFIG.terrain.islandRadius;
  const [minH, maxH] = layer.height ?? [-Infinity, Infinity];
  const [minS, maxS] = layer.scale ?? [1, 1];
  const matrices = [];
  const dummy = new THREE.Object3D();

  for (let tries = 0; matrices.length < layer.count && tries < layer.count * 30; tries++) {
    const r = Math.sqrt(rand()) * radius;
    const a = rand() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;

    const y = heightAt(x, z);
    if (y < minH || y > maxH) continue;
    if (slopeAt(x, z) > (layer.maxSlope ?? 1)) continue;
    if (layer.cluster) {
      const n = noise2(x * layer.cluster.scale + index * 50, z * layer.cluster.scale);
      if (layer.cluster.invert ? n > layer.cluster.threshold : n < layer.cluster.threshold) continue;
    }

    dummy.position.set(x, y - (layer.sink ?? 0), z);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.setScalar(minS + rand() * (maxS - minS));
    dummy.updateMatrix();
    matrices.push(dummy.matrix.clone());
  }
  return { matrices, rand };
}

function buildInstances(template, layer, matrices, rand) {
  const group = new THREE.Group();
  group.name = `scatter:${layer.asset}`;
  template.updateMatrixWorld(true);

  const tint = new THREE.Color();
  const tints = matrices.map(() => 1 - rand() * (layer.colorJitter ?? 0));
  const m = new THREE.Matrix4();

  template.traverse((child) => {
    if (!child.isMesh) return;
    const material = layer.sway ? addSway(child.material, layer.sway) : child.material;
    const inst = new THREE.InstancedMesh(child.geometry, material, matrices.length);
    matrices.forEach((matrix, i) => {
      inst.setMatrixAt(i, m.multiplyMatrices(matrix, child.matrixWorld));
      if (layer.colorJitter) inst.setColorAt(i, tint.setScalar(tints[i]));
    });
    inst.castShadow = !!layer.castShadow;
    inst.receiveShadow = true;
    group.add(inst);
  });
  return group;
}

export function createScatter(templates) {
  const group = new THREE.Group();
  CONFIG.scatter.forEach((layer, index) => {
    const template = templates[layer.asset];
    if (!template) return console.warn(`[scatter] Unknown asset "${layer.asset}"`);
    const { matrices, rand } = placeLayer(layer, index);
    group.add(buildInstances(template, layer, matrices, rand));
  });
  return group;
}

export function createLandmarks(templates) {
  const group = new THREE.Group();
  for (const lm of CONFIG.landmarks) {
    const template = templates[lm.asset];
    if (!template) {
      console.warn(`[landmarks] Unknown asset "${lm.asset}"`);
      continue;
    }
    const [x, z] = findDryLand(lm.position[0], lm.position[1]);
    const obj = template.clone();
    obj.position.set(x, heightAt(x, z), z);
    obj.rotation.y = lm.rotation ?? 0;
    obj.scale.setScalar(lm.scale ?? 1);
    obj.traverse((c) => {
      if (c.isMesh) c.castShadow = c.receiveShadow = true;
    });
    group.add(obj);
  }
  return group;
}
