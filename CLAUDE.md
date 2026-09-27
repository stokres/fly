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

- `npm run dev`: dev server with HMR. `/dev/creature.html` is the creature lab (orbit view, drive sliders,
  URL params like `?view=0,6,0.01&speed=65`); dev-only, not in the production build.
- `npm run build`: typecheck + production build (must pass before every commit)
- `npm run typecheck`: `tsc --noEmit` only

## Architecture: one system per file

| File | Owns |
| --- | --- |
| `src/main.ts` | bootstrap, renderer, fixed-timestep loop (120 Hz sim, interpolated render), readouts |
| `src/flight.ts` | arcade flight model: pitch/bank/yaw, speed, sink, flap, energy |
| `src/camera.ts` | follow camera: per-axis springs, look-ahead, dynamic FOV, partial roll |
| `src/input.ts` | keyboard + gamepad → `FlightInput` |
| `src/creature.ts` | the creature: procedural body, jointed wings, tail, head; animation from flight state; rim light |
| `src/streamers.ts` | tail ribbon streamers, simulated as world-space chains |
| `src/map.ts` | **the curated world**: islands, landmark placements, key thermals, spawn |
| `src/heightfield.ts` | terrain height as a pure function (island profiles + noise), `surface()` for collision |
| `src/terrain.ts` | terrain chunk meshes: streaming, LOD, skirts, per-face colors |
| `src/world.ts` | scene, lights and fog (applied from the atmosphere), ocean surface and sea floor |
| `src/atmosphere.ts` | time of day: sun direction and all sky/fog/light colors, blended from `SKY_KEYS` |
| `src/fog.ts` | patches three's fog chunks: height falloff + sun tint; shared fog uniforms |
| `src/sky.ts` | sky dome: gradient, sun disc and glow, moon |
| `src/clouds.ts` | cloud layer (stacked noise slices) and `densityAt()` for the in-cloud whiteout |
| `src/landmarks.ts` | landmark meshes (arch, spire, ring, stack) with reduced fog |
| `src/thermals.ts` | rising air columns: lift query, motes, circling birds, faint column |
| `src/audio.ts` | Web Audio context and mix bus (master, reverb), wind from airspeed, wing flaps, listener |
| `src/music.ts` | ambient pad: four voices gliding between open chords in D |
| `src/soundscape.ts` | sounds from below: coastline surf, positioned seabird calls at thermals |
| `src/noise.ts` | seeded simplex noise, `fbm`, `ridged` |
| `src/random.ts` | seeded PRNG (`mulberry32`, `seeded(seed, salt)`) |
| `src/palette.ts` | the limited color palette; all colors come from here |
| `src/tuning.ts` | tuning panel, slider ranges, persistence, JSON export/import |
| `src/tuning-defaults.json` | default values of every tunable constant |

Keep files focused and small. A new system gets a new file (`sky.ts`, `terrain.ts`, `audio.ts`, ...), not a
new section in an existing one.

## Conventions

- Units: meters, seconds, radians internally (tuning values may be in degrees; suffix them `Deg`).
- World: sea level is y = 0, north is -Z. The archipelago fits in ±5 km (`WORLD_HALF_SIZE`); beyond is open sea.
- To place or reshape something in the world, edit `map.ts`. Noise only adds detail around authored shapes.
- Ground queries go through `heightfield.surface()` (matches the rendered mesh), never the raw `height()`.
- Dev: `#x,y,z,headingDeg` in the URL starts there (heading 0 = north, 90 = east); changing it respawns.
- Forward is **-Z**. `yaw > 0` turns left, `pitch > 0` is nose up, `bank > 0` is right wing down.
  Object rotation order `'YXZ'`, `rotation.set(pitch, yaw, -bank)`.
- **Every feel constant goes in `tuning-defaults.json`** with a slider range in `tuning.ts`. No magic numbers for
  anything the player can feel. New tunables are read from the `tuning` object every frame (live edits must work).
- Frame-rate independent smoothing: `x += (target - x) * (1 - Math.exp(-rate * dt))`.
- No per-frame allocations in hot paths: reuse scratch `Vector3`s.
- Anything procedural uses `seeded(tuning.world.seed, '<system>')` from `random.ts` (never `Math.random()`),
  so a good world can be reproduced and one system's settings don't reshuffle another's. (Audio noise and
  call timing are the exception: they are not world content.)
- Audio is synthesized (no sample files). It starts on the first key/click (browser policy); M mutes.
- Colors come from `palette.ts`. Add a color there only with a reason. Sky/light colors per time of day are
  the `SKY_KEYS` table there.
- Fog is global and custom (`fog.ts`): any built-in material gets it. A material can thin its own fog with
  `#define FOG_DENSITY_SCALE <expr>` before the fog chunks (see landmarks). Unlit materials (MeshBasic,
  Points) need tinting by the light themselves or they glow at night (see `Thermals.setLight`).
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
2. ~~Soft pull~~: thermals (lift + motes, birds, faint column) and horizon landmarks.
3. ~~Terrain~~: curated archipelago in `map.ts` with noise detail, chunked with LOD, ocean.
   Terrain collision is soft (skim, pay speed to be pushed up, slide off slopes when stalled).
   Landmarks have no collision yet.
4. ~~Creature~~: procedural seabird built in code (no asset pipeline), wings posed from speed,
   stick input and flaps; streamers; rim light. Wing poses live in `Creature.poseWing`.
5. ~~Atmosphere~~: sky dome, time of day (frozen at 17:00 by default, optional cycle),
   height + sun-tinted fog, cloud layer at ~480 m with in-cloud whiteout. Known: cloud slices cut hard
   lines where they intersect terrain (needs soft particles / depth fade).
6. **Audio** ← *current*: synthesized wind (speed, gusts, dive whistle, bank pan, muffled in cloud),
   flaps on the downstroke, ambient pad, coastline surf, 3D seabird calls at thermals.
7. Polish: subtle bloom + LUT, comfort options (camera roll, FOV), performance pass.

## Open decisions (current defaults in bold)

- World: **curated** vs procedural.
- Platform: **desktop only** for now; mobile/touch is a separate design problem.
- Structure: **pure sandbox** for now; light structure (places to find, day cycle) later maybe.
- Input: **keyboard + gamepad**; mouse steering not yet.
- Scope/horizon: not decided.

## Out of scope

Multiplayer, dynamic weather systems, infinite procedural world, combat, scores.
