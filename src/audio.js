// The soundscape. Everything is synthesised in the browser — no audio files —
// and mixed from where you are: biome, time of day, nearby water and fire.
//
//   wind      always there; stronger and brighter in open or cold places
//   leaves    rustling in wooded biomes
//   water     lapping near lakes and the shore
//   fire      a low roar and crackles near a campfire
//   birds     daytime song, busier in lush biomes
//   crickets  at night
//   owls      now and then at night in the woods
//   footsteps change with the ground: grass, sand, snow, path, water
//
// Volumes are in CONFIG.audio; how lively each biome is lives on the biome
// itself (wind / leaves / birds / crickets in CONFIG.biomes.types).
// Browsers only allow sound after a click, so startAudio() is called then.

import { CONFIG } from './config.js';

let ctx = null;
let master = null;
let noiseBuffer = null;
const layers = {};
const timers = { bird: 2, cricket: 1, owl: 20, crackle: 0.2 };

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** A looping noise source through a filter, with its own volume. */
function noiseLayer(type, frequency, Q = 0.7) {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  source.loop = true;
  source.loopStart = Math.random() * 2;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = Q;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(filter).connect(gain).connect(master);
  source.start(0, Math.random() * 3);
  return { filter, gain };
}

/** A slow wobble applied to an audio parameter (gusts, swells). */
function wobble(param, rate, depth) {
  const lfo = ctx.createOscillator();
  lfo.frequency.value = rate;
  const amount = ctx.createGain();
  amount.gain.value = depth;
  lfo.connect(amount).connect(param);
  lfo.start();
}

export function startAudio() {
  if (ctx) return;
  const c = CONFIG.audio;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0;
  master.gain.linearRampToValueAtTime(c.masterVolume, ctx.currentTime + 3); // fade in
  master.connect(ctx.destination);

  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  layers.wind = noiseLayer('lowpass', 400, 0.6);
  wobble(layers.wind.filter.frequency, 0.07, 180);
  wobble(layers.wind.filter.frequency, 0.19, 70);

  layers.leaves = noiseLayer('bandpass', 3400, 0.5);
  wobble(layers.leaves.filter.frequency, 0.11, 900);

  layers.water = noiseLayer('lowpass', 850, 0.4);
  wobble(layers.water.filter.frequency, 0.16, 380); // waves washing in and out

  layers.fire = noiseLayer('lowpass', 210, 0.5);

  if (c.music) {
    const music = new Audio(c.music);
    music.loop = true;
    music.volume = c.musicVolume;
    music.play().catch((err) => console.warn('[audio] Could not play music:', err));
  }
}

/** One short synthesised note: a sine gliding between pitches, at a place in the stereo field. */
function tone({ from, to = from, start, length, volume, pan = 0, attack = 0.01, type = 'sine' }) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, start);
  osc.frequency.exponentialRampToValueAtTime(to, start + length);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + Math.min(attack, length * 0.4));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  osc.connect(gain).connect(panner).connect(master);
  osc.start(start);
  osc.stop(start + length + 0.05);
}

// A few different birdsongs, each built from short gliding notes.
const BIRD_SONGS = [
  // two or three rising chirps
  (t, v, pan) => {
    const base = rand(2600, 3600);
    const notes = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < notes; i++) tone({ from: base, to: base * rand(1.2, 1.45), start: t + i * 0.16, length: 0.09, volume: v, pan });
  },
  // a quick even trill
  (t, v, pan) => {
    const pitch = rand(3600, 4800);
    const notes = 5 + Math.floor(Math.random() * 6);
    for (let i = 0; i < notes; i++) tone({ from: pitch, to: pitch * 0.94, start: t + i * 0.065, length: 0.04, volume: v * 0.8, pan });
  },
  // a long falling whistle, then an answer
  (t, v, pan) => {
    const base = rand(2400, 3100);
    tone({ from: base * 1.3, to: base, start: t, length: 0.32, volume: v, pan, attack: 0.04 });
    tone({ from: base * 0.9, to: base * 1.15, start: t + 0.42, length: 0.22, volume: v * 0.9, pan, attack: 0.03 });
  },
  // a low two-note call, like a dove or cuckoo
  (t, v, pan) => {
    const base = rand(620, 820);
    tone({ from: base * 1.25, to: base * 1.22, start: t, length: 0.24, volume: v * 1.3, pan, attack: 0.04 });
    tone({ from: base, to: base * 0.97, start: t + 0.34, length: 0.34, volume: v * 1.3, pan, attack: 0.04 });
  },
];

function cricketChirp(t, volume, pan, pitch) {
  for (let i = 0; i < 3; i++) tone({ from: pitch, start: t + i * 0.034, length: 0.022, volume, pan, attack: 0.004 });
}

function owlHoot(t, volume, pan) {
  const pitch = rand(300, 360);
  tone({ from: pitch, to: pitch * 0.93, start: t, length: 0.4, volume, pan, attack: 0.08 });
  tone({ from: pitch, to: pitch * 0.9, start: t + 0.62, length: 0.55, volume, pan, attack: 0.08 });
}

function fireCrackle(t, volume) {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = rand(1200, 3500);
  const gain = ctx.createGain();
  const length = rand(0.012, 0.05);
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  source.connect(filter).connect(gain).connect(master);
  source.start(t, Math.random() * 3, length + 0.02);
}

/**
 * Call every frame. `env` describes the surroundings, each value roughly 0..1:
 *   wind, leaves, birds, crickets — from the biome you are in
 *   night  — 0 by day, 1 at night
 *   water  — how close open water is
 *   fire   — how close a campfire is
 *   woods  — how wooded it is here (for owls)
 */
export function updateSoundscape(dt, env) {
  if (!ctx) return;
  const c = CONFIG.audio;
  const now = ctx.currentTime;
  const set = (layer, volume) => layer.gain.gain.setTargetAtTime(volume, now, 0.9);

  set(layers.wind, c.windVolume * env.wind);
  set(layers.leaves, c.leavesVolume * env.leaves);
  set(layers.water, c.waterVolume * env.water);
  set(layers.fire, c.fireVolume * env.fire * 0.7);

  // Birds by day
  const birds = env.birds * (1 - env.night);
  timers.bird -= dt;
  if (timers.bird <= 0) {
    if (birds > 0.03) pick(BIRD_SONGS)(now + 0.05, c.birdVolume * rand(0.25, 1), rand(-0.9, 0.9));
    timers.bird = rand(1.2, 5.5) / Math.max(birds, 0.1);
  }

  // Crickets by night
  const crickets = env.crickets * env.night;
  timers.cricket -= dt;
  if (timers.cricket <= 0) {
    if (crickets > 0.03) cricketChirp(now + 0.03, c.cricketVolume * rand(0.3, 1) * crickets, rand(-1, 1), pick([4100, 4350, 4600, 3900]));
    timers.cricket = rand(0.12, 0.5) / Math.max(crickets, 0.2);
  }

  // The occasional owl in the woods at night
  timers.owl -= dt;
  if (timers.owl <= 0) {
    if (env.night * env.woods > 0.4) owlHoot(now + 0.05, c.owlVolume * rand(0.5, 1), rand(-0.8, 0.8));
    timers.owl = rand(14, 38);
  }

  // Fire crackles
  timers.crackle -= dt;
  if (timers.crackle <= 0) {
    if (env.fire > 0.02) fireCrackle(now + 0.01, c.fireVolume * env.fire * rand(0.3, 1.2));
    timers.crackle = rand(0.03, 0.35);
  }
}

// Footsteps: a short burst of filtered noise, shaped by what is underfoot.
const SURFACES = {
  grass: { type: 'lowpass', frequency: 520, length: 0.13, volume: 1 },
  sand: { type: 'lowpass', frequency: 900, length: 0.2, volume: 0.7 },
  snow: { type: 'bandpass', frequency: 1900, length: 0.17, volume: 1.1 },
  path: { type: 'bandpass', frequency: 1300, length: 0.09, volume: 1.2 },
  water: { type: 'bandpass', frequency: 1400, length: 0.28, volume: 1 },
};

export function playFootstep(strength = 1, surface = 'grass') {
  const c = CONFIG.audio;
  if (!ctx || !c.footsteps) return;
  const s = SURFACES[surface] ?? SURFACES.grass;
  const now = ctx.currentTime;

  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = s.type;
  filter.frequency.value = s.frequency * rand(0.8, 1.2);
  filter.Q.value = 0.8;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(c.footstepVolume * s.volume * strength * rand(0.75, 1), now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + s.length);

  source.connect(filter).connect(gain).connect(master);
  source.start(now, Math.random() * 3, s.length + 0.05);
}
