// Ambient sound. Wind is synthesised (filtered noise) so no files are needed;
// an optional music/ambience track can be set in CONFIG.audio.music.
// Browsers only allow audio after a user gesture, so call start() from a click.

import { CONFIG } from './config.js';

let started = false;
let ctx = null;
let noiseBuffer = null;

export function startAudio() {
  if (started) return;
  started = true;
  const c = CONFIG.audio;

  ctx = new (window.AudioContext || window.webkitAudioContext)();
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  if (c.wind) {
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.Q.value = 0.6;

    // A slow LFO opens and closes the filter so the wind rises and falls.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 220;
    lfo.connect(lfoDepth).connect(filter.frequency);

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(c.windVolume, ctx.currentTime + 4);

    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start();
    lfo.start();
  }

  if (c.music) {
    const music = new Audio(c.music);
    music.loop = true;
    music.volume = c.musicVolume;
    music.play().catch((err) => console.warn('[audio] Could not play music:', err));
  }
}

/** A soft footfall: a short burst of filtered noise. Slightly different each time. */
export function playFootstep(strength = 1, inWater = false) {
  const c = CONFIG.audio;
  if (!ctx || !c.footsteps) return;
  const now = ctx.currentTime;
  const length = inWater ? 0.28 : 0.13;

  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;

  const filter = ctx.createBiquadFilter();
  filter.type = inWater ? 'bandpass' : 'lowpass';
  filter.frequency.value = (inWater ? 1400 : 520) * (0.8 + Math.random() * 0.4);
  filter.Q.value = 0.8;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(c.footstepVolume * strength * (0.75 + Math.random() * 0.25), now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + length);

  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(now, Math.random() * 3, length + 0.05);
}
