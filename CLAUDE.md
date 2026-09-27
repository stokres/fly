# Fly: working rules

A small, calm browser game: third-person flight as a winged creature over a beautiful world.
No objectives, no score. **Feel is the whole game, and it lives in the flight model and the camera.**
Full design rationale: `docs/design-starting-point.md` (a starting point, not a spec).

## Stack (pinned, do not drift)

- **three 0.184.0 (r184)**, `WebGLRenderer` (WebGL 2). Modern API only: `BufferGeometry`, no `THREE.Geometry`,
  nothing deprecated, named imports from `'three'` (no `import * as THREE`). Addons from `three/addons/...`.
- TypeScript (strict), Vite. `lil-gui` for the tuning panel.
- Do not bump versions or add dependencies without asking. WebGPU is a later option, not now.

## Commands

- `npm run dev`: dev server with HMR
- `npm run build`: typecheck + production build (must pass before every commit)
- `npm run typecheck`: `tsc --noEmit` only

## Architecture: one system per file

| File | Owns |
| --- | --- |
| `src/main.ts` | bootstrap, renderer, fixed-timestep loop (120 Hz sim, interpolated render), readouts |
| `src/flight.ts` | arcade flight model: pitch/bank/yaw, speed, sink, flap, energy |
| `src/camera.ts` | follow camera: per-axis springs, look-ahead, dynamic FOV, partial roll |
| `src/input.ts` | keyboard + gamepad → `FlightInput` |
| `src/creature.ts` | creature visuals (currently a placeholder box with wings) |
| `src/world.ts` | scene, lights, fog, ground, seeded test pillars |
| `src/landmarks.ts` | large horizon landmarks (arch, spire, ring, stack) with reduced fog |
| `src/thermals.ts` | rising air columns: lift query, motes, circling birds, faint column |
| `src/tiling.ts` | repeating-tile world helpers (`WORLD_TILE`, `wrapDelta`, 3x3 `TileGrid`) |
| `src/random.ts` | seeded PRNG (`mulberry32`, `seeded(seed, salt)`) |
| `src/palette.ts` | the limited color palette; all colors come from here |
| `src/tuning.ts` | tuning panel, slider ranges, persistence, JSON export/import |
| `src/tuning-defaults.json` | default values of every tunable constant |

Keep files focused and small. A new system gets a new file (`sky.ts`, `terrain.ts`, `audio.ts`, ...), not a
new section in an existing one.

## Conventions

- Units: meters, seconds, radians internally (tuning values may be in degrees; suffix them `Deg`).
- Forward is **-Z**. `yaw > 0` turns left, `pitch > 0` is nose up, `bank > 0` is right wing down.
  Object rotation order `'YXZ'`, `rotation.set(pitch, yaw, -bank)`.
- **Every feel constant goes in `tuning-defaults.json`** with a slider range in `tuning.ts`. No magic numbers for
  anything the player can feel. New tunables are read from the `tuning` object every frame (live edits must work).
- Frame-rate independent smoothing: `x += (target - x) * (1 - Math.exp(-rate * dt))`.
- No per-frame allocations in hot paths: reuse scratch `Vector3`s.
- Anything procedural uses `seeded(tuning.world.seed, '<system>')` from `random.ts` (never `Math.random()`),
  so a good world can be reproduced and one system's settings don't reshuffle another's.
- Colors come from `palette.ts`. Add a color there only with a reason.
- Systems don't import each other's internals; `main.ts` wires them (e.g. it passes thermal lift into
  `flight.step`).
- Code comments explain *why*, briefly.

## Workflow

- **Vertical slices.** Each slice ends playable. Do not start the next one until the current one feels right.
- **Tune with sliders, not prompts.** When something feels right in the panel: *Export JSON*, replace
  `src/tuning-defaults.json`, commit.
- Commit every time something feels right. A visual pass must never silently change flight or camera feel:
  if a change touches `flight.ts`, `camera.ts` or tuning defaults, say so explicitly.
- Tasks should come with acceptance criteria (e.g. "FOV 60→85 with speed, roll 40%, all in tuning panel").
- Budget: 16 ms/frame on an average laptop. `cpuMs` and `fps` are in the panel's Readout; measure, don't assume.

## Roadmap (vertical slices)

1. ~~Feel prototype~~: placeholder creature, endless grid plane with pillars, flight model + camera,
   tuning panel. Done: feel approved as good enough, to be refined later.
2. **Soft pull** ← *current*: thermals (lift + motes, birds, faint column) and horizon landmarks with a
   thermal beside each. Flying through things has no collision yet (decide with terrain).
3. Terrain: curated, finite world (archipelago / valley), chunked with LOD.
4. Creature: real model, rim light, procedural wings driven by speed and input.
5. Atmosphere: gradient sky shader + sun, distance/sun-tinted fog, cloud layers, time of day.
6. Audio: speed-driven wind, flaps, ambient pad, spatial sounds from below.
7. Polish: subtle bloom + LUT, comfort options (camera roll, FOV), performance pass.

## Open decisions (current defaults in bold)

- World: **curated** vs procedural.
- Platform: **desktop only** for now; mobile/touch is a separate design problem.
- Structure: **pure sandbox** for now; light structure (places to find, day cycle) later maybe.
- Input: **keyboard + gamepad**; mouse steering not yet.
- Scope/horizon: not decided.

## Out of scope

Multiplayer, dynamic weather systems, infinite procedural world, combat, scores.
