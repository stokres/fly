# Fly

A small, calm browser game about flying: third person, a winged creature, open sky and the world below.

Currently at **milestone 5, atmosphere**: a long-winged seabird with procedurally animated wings, over a
hand-designed archipelago (a volcano, a long ridge, a caldera with a lagoon, a mesa, islets), under a sky
with time of day, haze and a cloud layer to fly through; thermals to climb in, landmarks to fly toward and
a live tuning panel. See [`CLAUDE.md`](CLAUDE.md) for the roadmap and
[`docs/design-starting-point.md`](docs/design-starting-point.md) for the design notes.

## Run

```sh
npm install
npm run dev
```

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Pitch (dive / climb) | W / S or ↑ / ↓ | left stick Y |
| Bank (turn) | A / D or ← / → | left stick X |
| Flap | Space (hold to keep flapping) | A or RT |
| Reset | R | |
| Show / hide tuning panel | G | |

W dives and S climbs, like a flight stick. Flip it with `input → invertPitch` in the panel.

**Thermals:** faint shimmering columns with motes drifting up and birds circling. Fly in and hold a turn to
climb without flapping. Large landmarks on the horizon each have one beside them.

**Time of day:** `atmosphere → timeOfDay` in the panel (default 17:00). Set `dayCycleMinutes` above 0 to let
the day run on its own.

**Start anywhere:** add `#x,y,z,heading` to the URL, e.g. `#-1900,700,2600,0` looks north at the volcano
from 700 m up. Heading is in degrees, 0 = north, 90 = east.

**Creature lab:** with `npm run dev`, open `/dev/creature.html` to see the creature on its own, orbit around
it and drive its speed, stick input and flaps with sliders.

## Tuning

Every flight and camera constant is a slider in the panel (top right). Changes save automatically in your
browser. When something feels right, use **Save / load → Export JSON** and replace `src/tuning-defaults.json`
with the downloaded file to make it the new default for everyone.

## Deploy

Pushes to `main` build and deploy to GitHub Pages via `.github/workflows/deploy.yml`. One-time setup:
repository **Settings → Pages → Source: GitHub Actions**.
