// The map: a hand-drawn-style chart of the island, opened with M.
//
// It is painted once, the first time it is opened, straight from the same
// data the world is built from — heights, biomes, trails, camps, landmarks —
// so it always matches the island, whatever the seed or settings.
// The "you are here" arrow is a separate element moved every frame.

import { CONFIG } from './config.js';
import { heightAt } from './world/terrain.js';
import { biomeWeights, dominant, biomeLabel, BIOME_NAMES } from './world/biomes.js';

const INK = '#4a3a28';
const PAPER = [233, 221, 194];

export function createMap({ landmarks, trails }) {
  const M = CONFIG.ui.map;
  const root = document.getElementById('map');
  const canvas = document.getElementById('map-canvas');
  const marker = document.getElementById('map-marker');
  const SIZE = M.resolution; // canvas pixels
  const extent = CONFIG.terrain.islandRadius * 2.3; // metres shown across the map
  const toMap = (v) => (v / extent + 0.5) * SIZE;
  let painted = false;
  let open = false;

  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const types = BIOME_NAMES.map((name) => CONFIG.biomes.types[name]);
  const ground = types.map((t) => hex(t.ground));
  // Deterministic speckle so the paper grain and tree symbols never change between openings.
  const speck = (x, y) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };

  function paint() {
    painted = true;
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    const water = CONFIG.water.level;

    // ── 1. Sample the island ──
    const S = SIZE / 2; // sample grid; drawn at double size
    const step = extent / S;
    const heights = new Float32Array(S * S);
    const biome = new Uint8Array(S * S);
    const strength = new Float32Array(S * S);
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const x = (i / S - 0.5) * extent;
        const z = (j / S - 0.5) * extent;
        const k = j * S + i;
        heights[k] = heightAt(x, z);
        const w = biomeWeights(x, z);
        biome[k] = dominant(w);
        strength[k] = w[biome[k]];
      }
    }

    // ── 2. Paper, sea and land ──
    const image = ctx.createImageData(S, S);
    const px = image.data;
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const k = j * S + i;
        const h = heights[k];
        const grain = (speck(i, j) - 0.5) * 10 + (speck(Math.floor(i / 9), Math.floor(j / 9)) - 0.5) * 8;
        let r;
        let g;
        let b;
        if (h > water) {
          // Land: the biome's colour washed onto the paper, shaded as if lit from the north-west.
          const c = ground[biome[k]];
          const left = heights[k - 1] ?? h;
          const up = heights[k - S] ?? h;
          const shade = Math.max(-0.28, Math.min(0.22, ((h - left) + (h - up)) / step * 0.16));
          const wash = 0.5;
          r = (PAPER[0] * (1 - wash) + c[0] * wash) * (1 + shade);
          g = (PAPER[1] * (1 - wash) + c[1] * wash) * (1 + shade);
          b = (PAPER[2] * (1 - wash) + c[2] * wash) * (1 + shade);
          // Contour lines
          const band = Math.floor(h / M.contourEvery);
          if (band !== Math.floor(left / M.contourEvery) || band !== Math.floor(up / M.contourEvery)) {
            r *= 0.86;
            g *= 0.84;
            b *= 0.8;
          }
        } else {
          // Sea: pale blue-grey, with fine lines echoing the coast.
          const depth = water - h;
          r = 190;
          g = 207;
          b = 204;
          const ring = depth < 4.5 && (depth % 1.5) < 0.24 + depth * 0.02;
          if (ring) {
            r -= 34;
            g -= 30;
            b -= 24;
          }
        }
        // Coastline in ink
        const right = heights[k + 1] ?? h;
        const down = heights[k + S] ?? h;
        if ((h > water) !== (right > water) || (h > water) !== (down > water)) {
          r = 74;
          g = 58;
          b = 40;
        }
        const o = k * 4;
        px[o] = r + grain;
        px[o + 1] = g + grain;
        px[o + 2] = b + grain;
        px[o + 3] = 255;
      }
    }
    const small = document.createElement('canvas');
    small.width = small.height = S;
    small.getContext('2d').putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(small, 0, 0, SIZE, SIZE);

    const at = (x, z) => {
      const i = Math.floor((x / extent + 0.5) * S);
      const j = Math.floor((z / extent + 0.5) * S);
      return i < 0 || j < 0 || i >= S || j >= S ? -1 : j * S + i;
    };

    // ── 3. Little symbols for what grows where ──
    const spacing = extent / 62;
    ctx.lineWidth = SIZE / 900;
    for (let gz = -31; gz < 31; gz++) {
      for (let gx = -31; gx < 31; gx++) {
        const x = (gx + speck(gx, gz) * 0.8) * spacing;
        const z = (gz + speck(gz + 40, gx) * 0.8) * spacing;
        const k = at(x, z);
        if (k < 0 || heights[k] < water + 1.5 || strength[k] < 0.62) continue;
        if (trails.clearanceAt(x, z) > 0.2) continue;
        const symbol = types[biome[k]].mapSymbol;
        if (!symbol || speck(gx * 3, gz * 7) > (types[biome[k]].mapDensity ?? 0.6)) continue;
        const cx = toMap(x);
        const cy = toMap(z);
        const u = SIZE / 190;
        const c = ground[biome[k]];
        ctx.fillStyle = `rgb(${c[0] * 0.55},${c[1] * 0.55},${c[2] * 0.55})`;
        ctx.strokeStyle = INK;
        ctx.beginPath();
        if (symbol === 'pine') {
          ctx.moveTo(cx, cy - u * 1.5);
          ctx.lineTo(cx + u * 0.75, cy + u * 0.5);
          ctx.lineTo(cx - u * 0.75, cy + u * 0.5);
          ctx.closePath();
          ctx.fill();
        } else if (symbol === 'tree') {
          ctx.arc(cx, cy - u * 0.4, u * 0.75, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(cx, cy + u * 0.3);
          ctx.lineTo(cx, cy + u);
          ctx.stroke();
        } else if (symbol === 'dots') {
          ctx.fillStyle = 'rgba(74,58,40,0.55)';
          for (let d = 0; d < 3; d++) ctx.rect(cx + (speck(gx + d, gz) - 0.5) * u * 4, cy + (speck(gz, gx + d) - 0.5) * u * 4, u * 0.35, u * 0.35);
          ctx.fill();
        } else if (symbol === 'peak') {
          ctx.moveTo(cx - u, cy + u * 0.6);
          ctx.lineTo(cx, cy - u);
          ctx.lineTo(cx + u, cy + u * 0.6);
          ctx.stroke();
        } else if (symbol === 'tuft') {
          ctx.moveTo(cx - u * 0.6, cy);
          ctx.lineTo(cx - u * 0.3, cy - u * 0.7);
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx, cy - u * 0.9);
          ctx.moveTo(cx + u * 0.6, cy);
          ctx.lineTo(cx + u * 0.3, cy - u * 0.7);
          ctx.globalAlpha = 0.5;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }

    // ── 4. Trails: dashed ink lines ──
    ctx.strokeStyle = '#6b3f24';
    ctx.lineWidth = SIZE / 380;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([SIZE / 130, SIZE / 170]);
    for (const route of trails.routes) {
      ctx.beginPath();
      route.forEach(([x, z], i) => (i ? ctx.lineTo(toMap(x), toMap(z)) : ctx.moveTo(toMap(x), toMap(z))));
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // ── 5. Lettering ──
    const label = (text, x, y, size, { italic = false, spaced = 0, color = INK, align = 'center' } = {}) => {
      ctx.font = `${italic ? 'italic ' : ''}${size}px Georgia, 'Times New Roman', serif`;
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${spaced}px`;
      ctx.lineWidth = size * 0.28;
      ctx.strokeStyle = 'rgba(233,221,194,0.85)'; // a halo of paper so text stays readable over detail
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    };

    // Biome names, set where each region is widest and clear of its landmark.
    const taken = landmarks.map((lm) => [lm.x, lm.z]);
    types.forEach((type, index) => {
      let best = null;
      let bestScore = 0;
      for (let z = -extent / 2; z < extent / 2; z += extent / 40) {
        for (let x = -extent / 2; x < extent / 2; x += extent / 40) {
          const k = at(x, z);
          if (k < 0 || biome[k] !== index || heights[k] < water + 1) continue;
          if (taken.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < extent * 0.1)) continue;
          // How much of this biome surrounds the spot?
          let score = 0;
          for (let dz = -3; dz <= 3; dz++) {
            for (let dx = -3; dx <= 3; dx++) {
              const n = at(x + dx * extent / 40, z + dz * extent / 40);
              if (n >= 0 && biome[n] === index && heights[n] > water) score += strength[n];
            }
          }
          if (score > bestScore) {
            bestScore = score;
            best = [x, z];
          }
        }
      }
      if (best && bestScore > 8) {
        taken.push(best);
        label(biomeLabel(index).toUpperCase(), toMap(best[0]), toMap(best[1]), SIZE / 62, { spaced: SIZE / 260, color: 'rgba(74,58,40,0.75)' });
      }
    });

    // Camps: a small tent mark
    for (const camp of trails.campfires) {
      const cx = toMap(camp.x);
      const cy = toMap(camp.z);
      const u = SIZE / 130;
      ctx.fillStyle = '#b4532a';
      ctx.strokeStyle = INK;
      ctx.lineWidth = SIZE / 800;
      ctx.beginPath();
      ctx.moveTo(cx, cy - u);
      ctx.lineTo(cx + u, cy + u * 0.7);
      ctx.lineTo(cx - u, cy + u * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Landmarks: a star and a name
    for (const lm of landmarks) {
      const cx = toMap(lm.x);
      const cy = toMap(lm.z);
      const u = SIZE / 95;
      ctx.fillStyle = '#8a2f1f';
      ctx.strokeStyle = INK;
      ctx.lineWidth = SIZE / 700;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 ? u * 0.45 : u;
        ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (lm.label) label(lm.label, cx, cy + u * 2.1, SIZE / 52, { italic: true });
    }

    // ── 6. Furniture of the map itself: border, title, compass, scale ──
    const edge = ctx.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.42, SIZE / 2, SIZE / 2, SIZE * 0.74);
    edge.addColorStop(0, 'rgba(90,60,30,0)');
    edge.addColorStop(1, 'rgba(90,60,30,0.38)'); // aged, darker toward the edges
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, SIZE, SIZE);

    ctx.strokeStyle = INK;
    ctx.lineWidth = SIZE / 260;
    ctx.strokeRect(SIZE * 0.022, SIZE * 0.022, SIZE * 0.956, SIZE * 0.956);
    ctx.lineWidth = SIZE / 900;
    ctx.strokeRect(SIZE * 0.032, SIZE * 0.032, SIZE * 0.936, SIZE * 0.936);

    label('TERRA ABLISSEUS', SIZE / 2, SIZE * 0.075, SIZE / 30, { spaced: SIZE / 85 });

    // Compass rose (north is up)
    const rx = SIZE * 0.9;
    const ry = SIZE * 0.875;
    const rr = SIZE * 0.045;
    ctx.lineWidth = SIZE / 800;
    ctx.beginPath();
    ctx.arc(rx, ry, rr * 0.72, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
      ctx.fillStyle = i === 0 ? '#8a2f1f' : INK;
      ctx.beginPath();
      ctx.moveTo(rx + Math.cos(a) * rr, ry + Math.sin(a) * rr);
      ctx.lineTo(rx + Math.cos(a + 1.35) * rr * 0.2, ry + Math.sin(a + 1.35) * rr * 0.2);
      ctx.lineTo(rx + Math.cos(a - 1.35) * rr * 0.2, ry + Math.sin(a - 1.35) * rr * 0.2);
      ctx.closePath();
      ctx.fill();
    }
    label('N', rx, ry - rr * 1.3, SIZE / 48);

    // Scale bar
    const metres = M.scaleBarMetres;
    const barLength = (metres / extent) * SIZE;
    const bx = SIZE * 0.07;
    const by = SIZE * 0.925;
    ctx.fillStyle = INK;
    ctx.fillRect(bx, by, barLength, SIZE / 300);
    ctx.fillRect(bx, by - SIZE / 150, SIZE / 600, SIZE / 85);
    ctx.fillRect(bx + barLength - SIZE / 600, by - SIZE / 150, SIZE / 600, SIZE / 85);
    label(`${metres} paces`, bx + barLength / 2, by - SIZE / 65, SIZE / 62, { italic: true });
  }

  function setOpen(value) {
    open = value;
    if (open && !painted) paint();
    root.classList.toggle('show', open);
  }

  /** Moves the "you are here" arrow. Call every frame. */
  function update(position, yaw) {
    if (!open) return;
    marker.style.left = `${(position.x / extent + 0.5) * 100}%`;
    marker.style.top = `${(position.z / extent + 0.5) * 100}%`;
    marker.style.transform = `translate(-50%, -50%) rotate(${-yaw}rad)`;
  }

  return { toggle: () => setOpen(!open), close: () => setOpen(false), update, get isOpen() { return open; } };
}
