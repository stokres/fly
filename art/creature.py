"""The spirit bird, as rigid parts with their own pivots. Usage: blender -b ... --python art/creature.py -- out.glb

The game assembles the parts into a skeleton (creature.ts) and animates it procedurally from the
flight state, so each part is modeled around its joint:
  bird_body     torso and neck; origin at the body center, head end toward Blender +Y (glTF -Z)
  bird_head     head, golden beak, eyes and crest; origin at the top of the neck
  bird_arm      inner wing; origin at the shoulder, spanning +X
  bird_forearm  middle wing; origin at the elbow, spanning +X
  bird_hand     outer wing root; origin at the wrist, spanning +X
  bird_primary  one long flight feather along +X (the game fans several)
  bird_plume    one long tail plume along Blender -Y (glTF +Z), with an eye at the tip
Pearl white with gold tips. Units: meters.
"""
import math
import random
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import lib  # noqa: E402
from mathutils import Vector  # noqa: E402

OUT = sys.argv[sys.argv.index("--") + 1]
C = lib.srgb
PEARL = C("#f7f5f0")
PEARL_COOL = C("#e6ebf3")
WARM = C("#f8eedc")
GOLD = C("#f2b84b")
CORAL = C("#ef7f4a")
INK = C("#1d2230")


def body():
    balls = []
    # Spine from tail base to chest: many overlapping blobs for a smooth spindle.
    for i in range(12):
        t = i / 11
        y = -0.64 + t * 0.82
        r = 0.08 + 0.17 * math.sin(math.pi * min(1.0, t * 0.85 + 0.1)) ** 0.8
        balls.append(((0, y, 0.02 - 0.03 * t), r, (1.0, 1.0, 0.88)))
    # Neck curving up to the head.
    for i in range(6):
        t = i / 5
        balls.append(((0, 0.24 + t * 0.38, 0.04 + t * t * 0.24), 0.135 - t * 0.04))
    me = lib.metaball(balls, resolution=0.03)
    lib.smooth(me, iterations=8, factor=0.6)
    me = lib.decimate(me, 1500)

    def color(co, n):
        c = lib.mix(WARM, PEARL_COOL, 0.5 + 0.5 * n.z)  # cool back, warm belly
        return lib.mix(c, PEARL, 0.4)

    part = lib.from_mesh(me, color)
    lib.bake_ao(part, samples=16, distance=0.3, strength=0.35)
    lib.to_object("bird_body", part)


def feather(length, width, base, tip, curve=0.12, eye=None, segs=10):
    """A curved feather blade along +X with a raised quill; two-sided. Returns a Part."""
    verts, faces, normals, colors = [], [], [], []
    rows = []
    for i in range(segs + 1):
        t = i / segs
        x = t * length
        w = width * (0.35 + 0.65 * math.sin(math.pi * min(1.0, t * 0.9 + 0.08)) ** 0.7)
        z = -curve * length * t * t  # droops toward the tip
        c = lib.mix(base, tip, max(0.0, (t - 0.35) / 0.65) ** 1.3)
        row = []
        for j, (off, lift) in enumerate(((-0.5, 0.0), (0.0, 0.012), (0.5, 0.0))):
            col = c
            if eye and t > 0.78:
                d = math.hypot((t - 0.89) * length / (width * 0.6), off)
                if d < 0.45:
                    col = eye[1] if d < 0.22 else eye[0]
            row.append(len(verts))
            verts.append(Vector((x, off * w, z + lift * width * 4)))
            normals.append(Vector((0, 0, 1)))
            colors.append(col)
        rows.append(row)
    for a, b in zip(rows, rows[1:]):
        faces.append((a[0], b[0], b[1], a[1]))
        faces.append((a[1], b[1], b[2], a[2]))
    top = lib.Part(verts, faces, normals, colors)
    # Underside: same blade, flipped winding and normals, so it lights from both sides.
    bottom = lib.Part([v + Vector((0, 0, -0.002)) for v in verts], [tuple(reversed(f)) for f in faces], [Vector((0, 0, -1))] * len(verts), colors)
    return lib.combine([top, bottom])


def wing_panel(name, length, root_chord, tip_chord, scallops, base, trailing, le_frac=0.35, thickness=0.05, sweep=0.0):
    """A cambered wing panel along +X with a scalloped (feathered) trailing edge."""
    nu, nv = 10, 6
    grid_top, grid_bot = [], []
    verts, faces, normals, colors = [], [], [], []
    for i in range(nu + 1):
        u = i / nu
        x = u * length
        chord = root_chord + (tip_chord - root_chord) * u
        y_le = chord * le_frac + sweep * u
        rt, rb = [], []
        for j in range(nv + 1):
            v = j / nv
            y = y_le - v * chord
            if j == nv:  # feathered trailing edge: points between the feather tips pulled in
                y -= 0.035 * (0.5 + 0.5 * math.cos(u * scallops * 2 * math.pi))
            camber = math.sin(math.pi * v) * thickness * (1 - 0.5 * u)
            lead = (1 - v) ** 3 * thickness * 0.6  # rounded, thicker leading edge
            c = lib.mix(base, trailing, max(0.0, (v - 0.55) / 0.45))
            rt.append(len(verts))
            verts.append(Vector((x, y, camber + lead)))
            normals.append(Vector((0, 0, 1)))
            colors.append(c)
            rb.append(len(verts))
            verts.append(Vector((x, y, camber * 0.2 - lead * 0.6)))
            normals.append(Vector((0, 0, -1)))
            colors.append(lib.mix(c, PEARL_COOL, 0.3))
        grid_top.append(rt)
        grid_bot.append(rb)
    for i in range(nu):
        for j in range(nv):
            a, b, c2, d = grid_top[i][j], grid_top[i + 1][j], grid_top[i + 1][j + 1], grid_top[i][j + 1]
            faces.append((a, d, c2, b))
            a, b, c2, d = grid_bot[i][j], grid_bot[i + 1][j], grid_bot[i + 1][j + 1], grid_bot[i][j + 1]
            faces.append((a, b, c2, d))
    part = lib.Part(verts, faces, normals, colors)
    # Smooth normals from the actual surface.
    import bpy
    me = bpy.data.meshes.new("tmp")
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    part.normals = [v.normal.copy() for v in me.vertices]
    bpy.data.meshes.remove(me)
    lib.bake_ao(part, samples=10, distance=0.15, strength=0.3)
    lib.to_object(name, part)


def head():
    balls = [((0, 0.06, 0.03), 0.155, (0.9, 1.25, 0.95)), ((0, -0.04, -0.02), 0.1)]
    me = lib.metaball(balls, resolution=0.02)
    lib.smooth(me, iterations=6, factor=0.6)
    me = lib.decimate(me, 800)
    skull = lib.from_mesh(me, lambda co, n: lib.mix(PEARL, PEARL_COOL, 0.5 + 0.5 * n.z))
    # Beak: a slim golden cone pointing forward (+Y).
    beak = lib.Part([], [], [], [])
    segs = 8
    tip = Vector((0, 0.46, -0.01))
    ring = [Vector((math.cos(a) * 0.04, 0.17, math.sin(a) * 0.032)) for a in (2 * math.pi * s / segs for s in range(segs))]
    beak = lib.Part(ring + [tip], [(s, (s + 1) % segs, segs) for s in range(segs)], [(r - Vector((0, 0.17, 0))).normalized() for r in ring] + [Vector((0, 1, 0))], [GOLD] * (segs + 1))
    eyes = []
    for side in (-1, 1):
        eyes.append(lib.box(side * 0.128 - 0.014, 0.09, 0.05, side * 0.128 + 0.014, 0.125, 0.085, INK))
    parts = [skull, beak] + eyes
    # Crest: three plumes sweeping back and up from the crown.
    for k, (ang, ln) in enumerate(((0.55, 0.5), (0.35, 0.62), (0.15, 0.46))):
        f = feather(ln, 0.075, PEARL, GOLD, curve=-0.25)
        from mathutils import Matrix
        m = Matrix.Translation((0, -0.02, 0.1)) @ Matrix.Rotation(math.pi / 2, 4, "Z") @ Matrix.Rotation(math.pi, 4, "Z") @ Matrix.Rotation(-ang, 4, "Y")
        m = Matrix.Translation(((k - 1) * 0.03, -0.02, 0.1)) @ Matrix.Rotation(-math.pi / 2, 4, "Z") @ Matrix.Rotation(ang, 4, "Y")
        parts.append(lib.transformed(f, m))
    part = lib.combine(parts)
    lib.to_object("bird_head", part)


lib.reset()
body()
head()
wing_panel("bird_arm", 0.7, 0.62, 0.58, 4, PEARL, PEARL, thickness=0.06)
wing_panel("bird_forearm", 0.8, 0.58, 0.46, 6, PEARL, WARM, thickness=0.045, sweep=-0.04)
wing_panel("bird_hand", 0.32, 0.46, 0.34, 2, PEARL, WARM, thickness=0.03)
lib.to_object("bird_primary", feather(1.0, 0.15, PEARL, GOLD, curve=0.08))
plume = feather(1.0, 0.13, PEARL, CORAL, curve=-0.06, eye=(GOLD, C("#2e8f9a")))
from mathutils import Matrix  # noqa: E402
# Plume points back: Blender -Y (glTF +Z).
lib.to_object("bird_plume", lib.transformed(plume, Matrix.Rotation(-math.pi / 2, 4, "Z")))
lib.export(OUT)
print("EXPORTED", OUT)
