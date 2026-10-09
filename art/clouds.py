"""Cumulus clouds. Usage: blender -b --factory-startup --python art/clouds.py -- out.glb out.json

Each cloud is a smooth union of blobs (metaballs): a flattened base row, towers of shrinking
puffs, and small cauliflower lumps over the top. Vertex colors hold baked ambient occlusion
(crevices between puffs darker); the game's cloud shader does the rest. The blob list is also
written as JSON (in glTF axes: y up) so the game can test whether the camera is inside a cloud.
Sizes are in meters.
"""
import json
import math
import random
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import lib  # noqa: E402
from mathutils import Vector  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1 :]
OUT, OUT_JSON = args[0], args[1]


def cumulus(seed, length, width, towers, tower_h, puff):
    rnd = random.Random(seed)
    balls = []
    # Base: a row of flattened blobs; the flat bottom is what makes it read as cumulus.
    n = max(3, int(length / (puff * 0.7)))
    for i in range(n):
        t = i / (n - 1) - 0.5
        for row in (-1, 1):
            x = t * length + rnd.uniform(-0.15, 0.15) * puff
            y = row * width * 0.22 + rnd.uniform(-0.1, 0.1) * width
            r = puff * (0.85 + rnd.random() * 0.35) * (1 - abs(t) * 0.45)
            balls.append(((x, y, r * 0.45), r))
    # Towers: stacks of puffs that shrink as they rise.
    for k in range(towers):
        cx = rnd.uniform(-0.32, 0.32) * length
        cy = rnd.uniform(-0.2, 0.2) * width
        h = tower_h * (0.6 + rnd.random() * 0.5)
        steps = max(2, int(h / (puff * 0.55)))
        for s in range(steps):
            t = s / steps
            r = puff * (1.05 - t * 0.55) * (0.85 + rnd.random() * 0.3)
            balls.append(((cx + rnd.uniform(-0.25, 0.25) * puff, cy + rnd.uniform(-0.2, 0.2) * puff, puff * 0.5 + t * h), r))
    # Cauliflower lumps on the upper surface.
    tops = [b for b in balls if b[0][2] > puff * 0.3]
    for _ in range(int(len(tops) * 1.6)):
        b = rnd.choice(tops)
        d = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), abs(rnd.gauss(0, 1)) + 0.4)).normalized()
        c = Vector(b[0]) + d * b[1] * 0.8
        balls.append((tuple(c), b[1] * rnd.uniform(0.3, 0.48)))
    return balls


VARIANTS = [
    ("cloud_a", cumulus(1, 320, 160, 3, 160, 55)),
    ("cloud_b", cumulus(2, 220, 150, 2, 240, 52)),
    ("cloud_c", cumulus(3, 150, 110, 1, 90, 40)),
    ("cloud_d", cumulus(4, 460, 200, 4, 110, 52)),
    ("cloud_e", cumulus(5, 260, 200, 3, 190, 58)),
    ("cloud_f", cumulus(6, 120, 90, 1, 70, 34)),
]

lib.reset()
meta = []
for name, balls in VARIANTS:
    me = lib.metaball(balls, resolution=7.0)
    lib.displace(me, 3.0, 0.03, seed=len(name))
    # Flat bottom: squash everything below the base line onto it.
    base = min(v.co.z for v in me.vertices) + 18.0
    for v in me.vertices:
        if v.co.z < base:
            v.co.z = base + (v.co.z - base) * 0.12
    me.update()
    me = lib.decimate(me, 2600)
    part = lib.from_mesh(me, lambda co, n: (1.0, 1.0, 1.0))
    lib.bake_ao(part, samples=14, distance=90.0, strength=0.8)
    lib.to_object(name, part)
    # Blobs for the inside test, in glTF axes (x, z, -y), with ellipsoid scales folded in.
    out = []
    for b in balls:
        c = b[0]
        s = b[2] if len(b) > 2 else (1.0, 1.0, 1.0)
        out.append([round(c[0], 2), round(c[2], 2), round(-c[1], 2), round(b[1], 2), s[0], s[2], s[1]])
    meta.append({"name": name, "balls": out})
lib.export(OUT)
with open(OUT_JSON, "w") as f:
    json.dump(meta, f)
print("EXPORTED", OUT, OUT_JSON)
