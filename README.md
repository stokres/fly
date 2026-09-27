# Fly

A small, calm browser game about flying: third person, a winged creature, open sky and the world below.

Currently at **milestone 2, soft pull**: a placeholder creature over an endless test plane, with the flight
model, follow camera, thermals to climb in, landmarks on the horizon and a live tuning panel. See [`CLAUDE.md`](CLAUDE.md) for the roadmap and
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

## Tuning

Every flight and camera constant is a slider in the panel (top right). Changes save automatically in your
browser. When something feels right, use **Save / load → Export JSON** and replace `src/tuning-defaults.json`
with the downloaded file to make it the new default for everyone.

## Deploy

Pushes to `main` build and deploy to GitHub Pages via `.github/workflows/deploy.yml`. One-time setup:
repository **Settings → Pages → Source: GitHub Actions**.
