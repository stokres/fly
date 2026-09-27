# Winged Flight Game: Design Starting Point

## About this document

**Author:** Claude Opus 5, Extra reasoning mode.
**Date:** 27 September 2026.
**Status:** Starting point. Nothing here is closed.

This is a first pass, written to be argued with. Every recommendation below is a default, not a decision. Some of it will not survive contact with the first prototype, and that is the point: the goal is to give you something concrete to react to and to hand to Opus 5.5 as initial context, not to freeze the design.

Technical claims about versions and browser support were checked against public sources in September 2026 and are dated where it matters. Everything about feel, art direction and scope is judgment, not fact.

## Original request (translated from Spanish)

> I want to build a small feel-good game for the browser. No big goals. 3D, indie graphics, something that looks genuinely beautiful and evocative, where the player controls a winged creature. The mechanic is... flying, flying and watching the world below us. Third person. It should give a sense of freedom, of openness, of calm. I plan to build it with Opus 5.5. What should I keep in mind?

## 1. Feel is the whole game, and it lives in the camera

With no objectives, the only thing keeping a player around is that flying feels good. That feeling comes from two systems: the flight model and the camera. Everything else is decoration on top.

### Flight model (arcade, not simulation)

- **Altitude and speed trade against each other.** Diving accelerates, climbing bleeds speed. This one rule creates a natural rhythm of dive and glide, and it makes players play without being told to.
- **Turn by roll, not by yaw.** Bank the creature and the lift vector curves the path. Direct yaw control feels like steering a boat.
- **Lift scales with speed squared and angle of attack, minus drag.** Real physics is unnecessary. Readable behavior is the requirement.
- **Thermals** as invisible rising columns, marked visually by circling birds, dust or drifting leaves. They give players an implicit goal with no UI.
- **Flapping costs something** (energy or a cooldown) so gliding is the default state and flapping is a decision.

### Camera

This is where the magic lives. Budget real time here.

- Spring damped follow, with different stiffness per axis. Never rigid.
- Dynamic FOV tied to speed, for example 60 at a slow glide rising to 80 or 85 in a dive, interpolated smoothly.
- **Partial roll:** the camera copies 30 to 50 percent of the creature's bank. At 100 percent players get motion sick, at 0 percent the sense of flight disappears.
- Lag on acceleration, so a dive has weight and pull.
- Aim slightly at where the player will be, not where they are.

### The test that matters

The first playable milestone is a cube flying over an empty plane with the final camera attached. If the cube already feels good, the rest is decoration. If it does not, no amount of art will rescue it. Do not move past this milestone early.

## 2. Stack

**Recommendation: Three.js vanilla, TypeScript, Vite.**

Three.js is the default for web 3D by a wide margin, and (relevant here) it is by far the best documented option in any LLM's training data, which matters when Opus 5.5 is writing most of the code. React Three Fiber is a good library, but a React layer inside a 60fps game loop adds friction and there are fewer game-shaped examples to draw on.

Version context, checked September 2026:

- Three.js is at **r184** (released April 2026).
- React Three Fiber is at **9.8.x**. R3F v10, with first-class `WebGPURenderer` support, is in alpha.
- Swapping to WebGPU is a one line import change (`three/webgpu`), with automatic WebGL 2 fallback. caniuse put global WebGPU support near 87 percent in August 2026.
- The official Three.js manual still describes `WebGPURenderer` as experimental and notes that, depending on the scene, you may hit missing features or get better performance from `WebGLRenderer`.

**Start on WebGL 2.** It is better known territory for the model and for you, and the WebGPU door stays open if you hit a performance ceiling later.

Supporting libraries: `lil-gui` or `tweakpane` for live tuning, `howler` or the Web Audio API directly for sound, Blender for the creature, static hosting on Vercel or GitHub Pages.

## 3. World and scale

The sense of openness is an atmospheric trick. It has little to do with how large the map actually is.

- **Exponential squared fog**, with a color that shifts with distance and sun angle. This single effect does more for the feeling than anything else on the list.
- **Cloud layers:** two or three planes with scrolling noise, plus loose billboards. Punching through a cloud is one of the most satisfying moments this genre has.
- **Scale contrast.** Silence and emptiness above, tiny living detail below: flocks, boats, chimney smoke, lights that come on at dusk. Without that contrast a huge world still reads flat.
- **Build a finite, curated world** (an archipelago, a valley, a ruined city) instead of infinite procedural terrain. Infinite noise terrain goes monotonous within minutes and it is exactly where "beautiful and evocative" is hardest to reach. If you want procedural, use it as filler around handmade areas.
- Chunked terrain with LOD (quadtree or geometry clipmap) and distance based streaming.

## 4. Art direction

Indie beauty comes from stylization. Move away from realism rather than toward it.

- **Flat shading with vertex colors** and gradient shaders. Cheap, fast, and full of character.
- **Limited palette.** Pick 6 to 8 colors and stay inside them.
- **Sky as a gradient shader** with a sun disc, not a photographic cubemap. Time of day comes almost free.
- **Rim light on the creature** so it always reads against the sky.
- **Minimal post-processing:** subtle bloom and a color grading LUT. Nothing more. Heavy post chains eat frame budget and rarely add to the mood.
- **Silhouette above all.** The creature is small and backlit 90 percent of the time.

## 5. Audio

In a calm game, audio carries half the emotional weight and usually gets the least attention.

- Wind whose filter and volume track airspeed. If the wind does not change when you dive, the whole thing feels dead.
- Wing flaps with weight and a bit of low end.
- A slowly evolving ambient pad.
- Spatialized sounds rising from below (waves, bells, birds) to reinforce altitude.

## 6. Performance budget

- 16ms frame budget. Measure it, do not assume it.
- `InstancedMesh` for all vegetation and props.
- Frustum culling on, draw calls in the low hundreds.
- Draco or meshopt for geometry, KTX2 for textures.
- Test on an average laptop, not on your work machine.

## 7. Working with Opus 5.5

This section is likely to matter more than the rest.

- **Write a short design doc first** (mechanic, stack, file structure, conventions) and keep it as the fixed reference. With Claude Code it goes in `CLAUDE.md`. This document can be the first draft of it.
- **Pin the Three.js version in `package.json` and state it in the prompt.** This is the most common failure mode: models mix r120 APIs with r180 APIs and produce code that neither compiles nor reads as idiomatic. Say "three r184, nothing deprecated, no `THREE.Geometry`".
- **Vertical slices, not horizontal layers.** Cube plus camera plus plane. Then terrain. Then the creature. Then atmosphere. Then audio. Each slice playable.
- **One system per file:** `flight.ts`, `camera.ts`, `terrain.ts`, `sky.ts`, `audio.ts`, `tuning.ts`. Without an explicit rule you get 1500 line monoliths that are painful to iterate on.
- **Tuning panel from day one,** with every flight and camera constant exposed and exportable to JSON. Feel gets tuned with sliders in real time, not with prompts. This is the difference between 20 iterations an hour and 3.
- **Git from the first commit,** and commit every time something feels right. A "make it prettier" pass can quietly destroy the flight feel with no obvious cause.
- **Acceptance criteria per task.** "Implement the follow camera with spring damping, dynamic FOV from 60 to 85, partial roll at 40 percent, all parameters exposed in the tuning panel" works. "Build a beautiful flying game" does not.
- **Deterministic seeds** for anything procedural, so a good world can be reproduced.

## 8. Risks to watch

- **Motion sickness.** Real in third person flight games. Test with other people early and ship camera roll and FOV as options.
- **Emptiness.** With no objectives, players get bored fast. You need soft pull: landmarks visible on the horizon that invite approach, changing light, something that rewards exploring without being a score counter.
- **Scope creep.** Multiplayer, dynamic weather, infinite world. No.
- **The winged rig is the hardest asset.** Consider procedural wings driven by code (bones moved by speed and input) instead of baked animation clips. Less Blender work and it responds better to the flight model.

## 9. References worth playing first

*Journey*, *Flower*, *AER: Memories of Old* (close to your exact idea), *ABZÛ*, *The Pathless*.

## 10. Open decisions

These are the forks that change the rest of the document. They are open on purpose.

1. **Curated world or procedural?** The recommendation above is curated, but a procedural world is a different and legitimate project.
2. **Desktop only, or mobile too?** Touch controls for flight are a separate design problem, and mobile caps the art and performance budget.
3. **How far does "no objectives" go?** Pure sandbox, or light structure (places to find, a day cycle, something that changes as you explore)?
4. **Input:** keyboard and mouse, gamepad, or both?
5. **Scope and horizon.** A weekend prototype and a three month project lead to different decisions at almost every point above.
