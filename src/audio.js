// Ambient sound. Wind is synthesised (filtered noise) so no files are needed;
// an optional music/ambience track can be set in CONFIG.audio.music.
// Browsers only allow audio after a user gesture, so call start() from a click.

import { CONFIG } from './config.js';

let started = false;

export function startAudio() {
  if (started) return;
  started = true;
  const c = CONFIG.audio;

  if (c.wind) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const seconds = 4;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
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
