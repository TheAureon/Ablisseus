# Terra Ablisseus

A peaceful walking simulator. No goals, no enemies — an island, a slow day/night
cycle, wind, and somewhere to wander.

Built with [three.js](https://threejs.org) and [Vite](https://vite.dev). All 3D
models are currently placeholders.

## Play

Open `index.html`. It is a single self-contained file (code and engine are
bundled inside it), so it works by double-clicking it, offline, or from any
static host such as GitHub Pages.

`index.html` is **generated** — don't edit it by hand. After changing anything
in `src/` or `dev.html`, regenerate it:

```bash
npm install
```

```bash
npm run build
```

## Develop

```bash
npm run dev
```

This serves `dev.html` (the source page) with live reload while you tweak.

## Controls

| | |
|---|---|
| Walk | `WASD` / arrow keys |
| Look | mouse (click to capture, `Esc` to release) |
| Hurry | `Shift` |
| Tweak panel | `G` (press `Esc` first to free the mouse) |
| Touch | drag left half of screen to walk, right half to look |

## Where to change things

| I want to… | Edit |
|---|---|
| Change any number: speeds, island size/shape, colours, prop counts, sky colours, fog, day length, bloom | `src/config.js` |
| Swap a placeholder for a real model | `src/assets.js` |
| Change a placeholder shape | `src/placeholders.js` |
| Add ambient music | `CONFIG.audio.music` in `src/config.js` |

### Adding your models

1. Put the `.glb` / `.gltf` file in `models/`.
2. In `src/assets.js`, set the entry's `model`, e.g.
   `pine: { model: 'models/pine.glb', scale: 1, ... }`.
3. Use `scale`, `yOffset` and `rotation` on that entry to fit it to the world
   (1 unit = 1 metre, origin at ground level, Y up).

Model files are loaded at runtime and are not embedded in `index.html`, so
once you use real models the game must be served over http (`npm run dev`, or
any static host) — browsers block file loading for pages opened by
double-click.

New asset names can be added to `assets.js` and then referenced from
`CONFIG.scatter` (many copies spread over the island) or `CONFIG.landmarks`
(single hand-placed objects) in `config.js`.

## Code map

```
index.html         generated standalone game (npm run build)
dev.html           source page: title screen markup and styles
models/            your .glb files
src/
  config.js        every tunable value
  assets.js        asset registry: model path or placeholder
  placeholders.js  stand-in shapes
  main.js          renderer, post-processing, frame loop, tweak panel
  player.js        first-person movement and input
  body.js          your own body, seen when looking down
  audio.js         procedural wind + optional music
  world/
    terrain.js     island height function, terrain mesh, water
    scatter.js     instanced props + landmarks
    sky.js         sky dome, sun/moon, fog, stars, time-of-day blending
    motes.js       drifting pollen / fireflies
```
