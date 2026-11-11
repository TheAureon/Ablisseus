// The player's own body, visible when you look down (and as a shadow).
//
// The placeholder is a simple jointed figure animated from the walking stride.
// A real model can be assigned to `body` in assets.js: it should face -Z with
// its feet at the origin and have NO head (or the camera will sit inside it).
// If the model contains an animation clip it is played at walking pace;
// if it has nodes named legL/legR/kneeL/kneeR/armL/armR they are swung
// procedurally just like the placeholder.

import * as THREE from 'three';
import { CONFIG } from './config.js';

export function createBody(template) {
  const c = CONFIG.body;
  const body = template.clone();
  body.name = 'player-body';
  body.visible = c.enabled;
  body.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });

  const part = (name) => body.getObjectByName(name);
  const legL = part('legL');
  const legR = part('legR');
  const kneeL = part('kneeL');
  const kneeR = part('kneeR');
  const armL = part('armL');
  const armR = part('armR');

  // Optional baked walk cycle from a loaded model.
  const clips = template.userData.animations ?? [];
  const mixer = clips.length ? new THREE.AnimationMixer(body) : null;
  if (mixer) mixer.clipAction(clips.find((clip) => /walk/i.test(clip.name)) ?? clips[0]).play();

  /** @param state the player's motion state (see player.js) */
  function update(dt, state) {
    body.visible = c.enabled;
    body.position.set(state.position.x, state.position.y + state.bob, state.position.z);
    body.rotation.y = state.yaw;
    body.translateZ(c.backOffset); // sit slightly behind the eyes

    const amount = state.moveAmount * (1 + state.hurry * 0.4);
    const swing = Math.cos(state.stride) * amount;
    const lift = Math.sin(state.stride) * amount;

    // Mid-jump the legs tuck up and the arms lift a little.
    const tuck = state.air * c.airTuck;

    if (legL) legL.rotation.x = swing * c.legSwing + tuck;
    if (legR) legR.rotation.x = -swing * c.legSwing + tuck * 0.6;
    // A knee bends while its leg is swinging forward.
    if (kneeL) kneeL.rotation.x = -Math.max(0, -lift) * c.kneeBend - tuck * 1.6;
    if (kneeR) kneeR.rotation.x = -Math.max(0, lift) * c.kneeBend - tuck * 1.3;
    // Arms swing opposite to the leg on the same side.
    if (armL) armL.rotation.x = -swing * c.armSwing + tuck * 0.5;
    if (armR) armR.rotation.x = swing * c.armSwing + tuck * 0.5;

    if (mixer) mixer.update(dt * (state.speed / CONFIG.player.walkSpeed));
  }

  return { object: body, update };
}
