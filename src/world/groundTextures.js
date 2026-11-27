// Photographic ground textures (CC0, from Poly Haven: polyhaven.com) for the
// terrain: grass, earth, rock, sand and snow. Each is a colour photo and a
// normal map (the tiny bumps of soil, pebbles and cracks, for lighting).
//
// They are packed into two texture arrays (one layer per kind of ground), so
// the terrain shader blends all five with only two texture slots. The terrain
// keeps its own colours from the biomes: each photo only adds detail, its
// average colour taken out and replaced by the biome's (see terrain.js).
//
// Layers, in order (the shader relies on it): 0 grass, 1 earth, 2 rock, 3 sand, 4 snow.

import * as THREE from 'three';
import grass from './textures/grass.jpg';
import grassN from './textures/grass_n.jpg';
import earth from './textures/earth.jpg';
import earthN from './textures/earth_n.jpg';
import rock from './textures/rock.jpg';
import rockN from './textures/rock_n.jpg';
import sand from './textures/sand.jpg';
import sandN from './textures/sand_n.jpg';
import snow from './textures/snow.jpg';
import snowN from './textures/snow_n.jpg';

const SIZE = 1024;
const COLOURS = [grass, earth, rock, sand, snow];
const NORMALS = [grassN, earthN, rockN, sandN, snowN];

function loadPixels(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = SIZE;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      resolve(ctx.getImageData(0, 0, SIZE, SIZE).data);
    };
    img.onerror = reject;
    img.src = url;
  });
}

function toArray(layers, colorSpace) {
  const data = new Uint8Array(SIZE * SIZE * 4 * layers.length);
  layers.forEach((pixels, i) => data.set(pixels, i * SIZE * SIZE * 4));
  const texture = new THREE.DataArrayTexture(data, SIZE, SIZE, layers.length);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.colorSpace = colorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/** The average colour of each photo (linear), so the shader can swap it for the biome's. */
function meanColour(pixels) {
  let r = 0;
  let g = 0;
  let b = 0;
  const step = 4 * 7; // (every 7th pixel is plenty)
  let n = 0;
  for (let i = 0; i < pixels.length; i += step, n++) {
    r += pixels[i];
    g += pixels[i + 1];
    b += pixels[i + 2];
  }
  return new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace); // (stored linear)
}

/** Loads everything: { colour, normal, means } (means: one THREE.Color per layer). Null if loading fails. */
export async function loadGroundTextures() {
  try {
    const [colours, normals] = await Promise.all([Promise.all(COLOURS.map(loadPixels)), Promise.all(NORMALS.map(loadPixels))]);
    return { colour: toArray(colours, THREE.SRGBColorSpace), normal: toArray(normals, THREE.NoColorSpace), means: colours.map(meanColour) };
  } catch (error) {
    console.warn('[ground textures] could not load, using plain ground', error);
    return null;
  }
}
