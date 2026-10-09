"""Buildings, landmarks and boats. Usage: blender -b --factory-startup --python art/architecture.py -- out.glb

Mediterranean-Ghibli village pieces (white walls, terracotta roofs, colored shutters), a windmill
and lighthouse, ruins, and the four big landmarks. Hard surfaces are flat-shaded; rock is built
from metaballs like the vegetation. Objects named "<name>_win" hold window glass and lamps the game
lights up at dusk; "<name>_lod1" is a simple far version; "windmill_sails" spins around glTF +Z.
Front of buildings faces Blender -Y (glTF +Z). Units: meters.
"""
import math
import random
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import lib  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1 :]
OUT, OUT_JSON = args[0], args[1]
# Collision spheres per model (Blender axes; converted to glTF axes when written).
COLLIDE = {}
C = lib.srgb
WALLS = {"white": C("#f3eee3"), "cream": C("#efe2c4"), "ochre": C("#ebcf98"), "pink": C("#efcdbd")}
ROOFS = [C("#c9573a"), C("#d46a40"), C("#b94b36")]
SHUTTERS = {"teal": C("#3e8f8e"), "blue": C("#3b6fb0"), "green": C("#5a9a4c")}
GLASS = C("#2a3a52")
WOOD = C("#7a5236")
STONE = C("#cfc4ad")
STONE_DARK = C("#9e9482")
MARBLE = C("#ece6d8")
MOSS = C("#7c9e48")


def emit(name, parts, ao=3.0, strength=0.5):
    part = lib.combine(parts)
    if ao:
        lib.bake_ao(part, samples=16, distance=ao, strength=strength)
    lib.to_object(name, part)


def facade_openings(w, d, floors, shutter, front_door=True):
    """Windows (glass, separate), shutters and door on the four walls of a w x d body."""
    solid, glass = [], []
    ww, wh = 1.0, 1.3
    for f in range(floors):
        z = 1.0 + f * 3.2
        for side, length in (("front", w), ("back", w), ("left", d), ("right", d)):
            n = max(1, int(length / 3.2))
            for i in range(n):
                t = (i + 0.5) / n - 0.5
                along = t * length
                if side == "front" and f == 0 and front_door and n > 1 and abs(along) < 1.6:
                    continue
                def rect(a0, a1, z0, z1, out, color):
                    if side == "front":
                        return lib.box(a0, -d / 2 - out, z0, a1, -d / 2, z1, color)
                    if side == "back":
                        return lib.box(-a1, d / 2, z0, -a0, d / 2 + out, z1, color)
                    if side == "left":
                        return lib.box(-w / 2 - out, -a1, z0, -w / 2, -a0, z1, color)
                    return lib.box(w / 2, a0, z0, w / 2 + out, a1, z1, color)
                glass.append(rect(along - ww / 2, along + ww / 2, z, z + wh, 0.06, GLASS))
                solid.append(rect(along - ww / 2 - 0.5, along - ww / 2 - 0.05, z - 0.05, z + wh + 0.05, 0.1, shutter))
                solid.append(rect(along + ww / 2 + 0.05, along + ww / 2 + 0.5, z - 0.05, z + wh + 0.05, 0.1, shutter))
    if front_door:
        solid.append(lib.box(-0.65, -d / 2 - 0.08, 0, 0.65, -d / 2, 2.3, WOOD))
    return solid, glass


def house(name, w, d, floors, roof_kind, wall, roof, shutter, chimney=True):
    h = floors * 3.2
    body = lib.box(-w / 2, -d / 2, -3.0, w / 2, d / 2, h, wall)  # sunk 3 m: houses sit on slopes
    plinth = lib.box(-w / 2 - 0.05, -d / 2 - 0.05, -3.0, w / 2 + 0.05, d / 2 + 0.05, 0.35, tuple(c * 0.86 for c in wall))
    rh = d * 0.32
    if roof_kind == "gable":
        r = lib.gable_roof(-w / 2, -d / 2, w / 2, d / 2, h, rh, 0.45, roof, wall)
    else:
        r = lib.hip_roof(-w / 2, -d / 2, w / 2, d / 2, h, rh, 0.45, roof)
    parts = [body, plinth, r]
    if chimney:
        parts.append(lib.box(w * 0.22, -0.4, h, w * 0.22 + 0.9, 0.5, h + rh + 1.0, wall, top=C("#5a4a44")))
    solid, glass = facade_openings(w, d, floors, shutter)
    emit(f"{name}_lod0", parts + solid)
    emit(f"{name}_win", glass, ao=0)
    emit(f"{name}_lod1", [body, r], ao=0)


def windmill():
    stone = WALLS["white"]
    tower = lib.banded_cylinder(0, 0, -3, 9, 3.3, 2.6, 12, 3, lambda z: stone)
    roof = lib.cylinder(0, 0, 9, 12.8, 3.0, 0.0, 12, lambda z: ROOFS[0])
    door = lib.box(-0.6, -3.3, 0, 0.6, -2.9, 2.2, WOOD)
    hub = lib.box(-0.4, -3.6, 9.7, 0.4, -2.6, 10.5, WOOD)
    solid, glass = [tower, roof, door, hub], []
    for z, a in ((4.5, 0.8), (6.8, 2.5), (4.0, 4.0)):
        m = Matrix.Rotation(a, 4, "Z")
        glass.append(lib.transformed(lib.box(-0.4, -3.1, z, 0.4, -2.7, z + 0.9, GLASS), m))
    emit("windmill_lod0", solid, ao=3.0)
    emit("windmill_win", glass, ao=0)
    emit("windmill_lod1", [tower, roof], ao=0)
    # Sails, built around the hub at the origin in the XZ plane (Blender), spinning about Y.
    sail = C("#f6f1e6")
    arms = []
    for k in range(4):
        m = Matrix.Rotation(k * math.pi / 2 + 0.3, 4, "Y")
        arms.append(lib.transformed(lib.box(-0.15, -0.15, 0.4, 0.15, 0.15, 7.5, WOOD), m))
        arms.append(lib.transformed(lib.flat([[(0.2, -0.05, 1.6), (1.6, -0.05, 1.8), (1.6, -0.05, 7.3), (0.2, -0.05, 7.3)]], [sail]), m))
        arms.append(lib.transformed(lib.flat([[(0.2, 0.05, 7.3), (1.6, 0.05, 7.3), (1.6, 0.05, 1.8), (0.2, 0.05, 1.6)]], [sail]), m))
    arms.append(lib.box(-0.5, -0.5, -0.5, 0.5, 0.5, 0.5, WOOD))
    emit("windmill_sails", arms, ao=0)


def lighthouse():
    red, white = C("#c8423a"), C("#f4f1ea")
    house_body = lib.box(-4, -1, -3, 4, 6, 3.6, white)
    house_roof = lib.hip_roof(-4, -1, 4, 6, 3.6, 2.2, 0.4, ROOFS[1])
    tower = lib.banded_cylinder(0, 0, -3, 24, 3.2, 2.2, 14, 9, lambda z: red if int((z + 3) / 3) % 2 else white)
    gallery = lib.cylinder(0, 0, 24, 24.5, 3.4, 3.4, 14, lambda z: C("#3c3f46"))
    rail = lib.cylinder(0, 0, 24.5, 25.4, 3.3, 3.3, 14, lambda z: C("#3c3f46"), cap=False)
    dome = lib.cylinder(0, 0, 27.4, 29.6, 2.0, 0.0, 14, lambda z: red)
    lantern = lib.cylinder(0, 0, 24.5, 27.4, 1.8, 1.8, 14, lambda z: C("#fff2c4"), cap=False)
    emit("lighthouse_lod0", [house_body, house_roof, tower, gallery, rail, dome], ao=4.0)
    emit("lighthouse_win", [lantern], ao=0)
    emit("lighthouse_lod1", [tower, dome, house_body], ao=0)


def mossy(c, n, rnd):
    if n.z > 0.7 and rnd.random() < 0.6:
        return lib.mix(c, MOSS, 0.5 + rnd.random() * 0.3)
    return lib.hsv_jitter(c, rnd, 0.05)


def recolor(part, fn):
    rnd = random.Random(7)
    part.colors = [fn(c, n, rnd) for c, n in zip(part.colors, part.normals)]
    return part


def temple():
    rnd = random.Random(3)
    parts = [
        lib.box(-16, -10, -3, 16, 10, 0.8, STONE),
        lib.box(-14.5, -8.5, 0.8, 14.5, 8.5, 1.6, MARBLE),
        lib.box(-13, -7, 1.6, 13, 7, 2.4, MARBLE),
    ]
    cols = [(x, y) for x in (-11, -6.6, -2.2, 2.2, 6.6, 11) for y in (-5, 5)] + [(-11, 0), (11, 0)]
    intact = []
    for i, (x, y) in enumerate(cols):
        broken = rnd.random() < 0.4
        h = rnd.uniform(2.5, 6.5) if broken else 9.0
        parts.append(lib.banded_cylinder(x, y, 2.4, 2.4 + h, 0.95, 0.85, 10, 2, lambda z: MARBLE))
        if not broken:
            parts.append(lib.box(x - 1.2, y - 1.2, 11.4, x + 1.2, y + 1.2, 12.0, MARBLE))
            intact.append((x, y))
    # Architrave over a run of intact columns on the front row.
    front = sorted([c for c in intact if c[1] < 0])
    if len(front) >= 2:
        parts.append(lib.box(front[0][0] - 1.3, -6.2, 12.0, front[-1][0] + 1.3, -3.8, 13.3, MARBLE))
    # Fallen drums lying on the steps.
    for k in range(4):
        m = Matrix.Translation((rnd.uniform(-12, 12), rnd.uniform(-9, 9), 2.4 + 0.9)) @ Matrix.Rotation(rnd.uniform(0, 3), 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X")
        parts.append(lib.transformed(lib.banded_cylinder(0, 0, -1.2, 1.2, 0.9, 0.9, 10, 1, lambda z: MARBLE), m))
    part = recolor(lib.combine(parts), mossy)
    lib.bake_ao(part, samples=16, distance=6, strength=0.55)
    lib.to_object("temple_lod0", part)
    emit("temple_lod1", parts[:3], ao=0)


def ruined_tower():
    rnd = random.Random(5)
    seg = 18
    r_out, r_in = 12.0, 9.5
    polys, colors = [], []
    tops = [rnd.uniform(36, 58) for _ in range(seg)]
    for s in range(seg):
        a0 = 2 * math.pi * s / seg
        a1 = 2 * math.pi * (s + 1) / seg
        top = tops[s]
        for r, sign in ((r_out, 1), (r_in, -1)):
            p = [(math.cos(a0) * r, math.sin(a0) * r, -4), (math.cos(a1) * r, math.sin(a1) * r, -4), (math.cos(a1) * r, math.sin(a1) * r, top), (math.cos(a0) * r, math.sin(a0) * r, top)]
            polys.append(p if sign > 0 else p[::-1])
            colors.append(STONE)
        polys.append([(math.cos(a0) * r_out, math.sin(a0) * r_out, top), (math.cos(a1) * r_out, math.sin(a1) * r_out, top), (math.cos(a1) * r_in, math.sin(a1) * r_in, top), (math.cos(a0) * r_in, math.sin(a0) * r_in, top)])
        colors.append(MOSS)
        # Side faces where neighbouring segments differ in height.
        nxt = tops[(s + 1) % seg]
        if nxt < top:
            polys.append([(math.cos(a1) * r_out, math.sin(a1) * r_out, nxt), (math.cos(a1) * r_in, math.sin(a1) * r_in, nxt), (math.cos(a1) * r_in, math.sin(a1) * r_in, top), (math.cos(a1) * r_out, math.sin(a1) * r_out, top)])
            colors.append(STONE_DARK)
        else:
            prv = tops[s]
            polys.append([(math.cos(a1) * r_in, math.sin(a1) * r_in, prv), (math.cos(a1) * r_out, math.sin(a1) * r_out, prv), (math.cos(a1) * r_out, math.sin(a1) * r_out, nxt), (math.cos(a1) * r_in, math.sin(a1) * r_in, nxt)])
            colors.append(STONE_DARK)
    tower = lib.flat(polys, colors)
    parts = [tower, lib.banded_cylinder(0, 0, -4, 6, 14.5, 13.0, seg, 1, lambda z: STONE_DARK)]
    # Dark slit windows.
    for k in range(10):
        a = rnd.uniform(0, 2 * math.pi)
        z = rnd.uniform(10, 30)
        m = Matrix.Rotation(a, 4, "Z")
        parts.append(lib.transformed(lib.box(-0.8, -r_out - 0.06, z, 0.8, -r_out + 0.3, z + 3.6, C("#3a3530")), m))
    part = recolor(lib.combine(parts), mossy)
    lib.bake_ao(part, samples=16, distance=10, strength=0.5)
    lib.to_object("tower_lod0", part)
    lib.to_object("tower_lod1", part)


def rock_color(cliff_light, cliff_mid, grass):
    def color(co, n):
        strata = 0.5 + 0.5 * math.sin(co.z * 0.22 + co.x * 0.02)
        c = lib.mix(cliff_mid, cliff_light, strata * 0.7)
        if n.z > 0.62:
            c = lib.mix(c, grass, min(1.0, (n.z - 0.62) * 3.0))
        return c
    return color


ROCK = rock_color(C("#e0d2b6"), C("#b69d82"), C("#6cb848"))


def sea_arch():
    rnd = random.Random(9)
    balls = []
    for side in (-1, 1):
        for i in range(9):
            z = -25 + i * 18
            balls.append(((side * (95 - i * 2) + rnd.uniform(-6, 6), rnd.uniform(-8, 8), z), 34 - i * 1.0))
    for i in range(13):
        t = i / 12
        x = -100 + t * 200
        z = 140 + math.sin(t * math.pi) * 22
        balls.append(((x, rnd.uniform(-6, 6), z), 30 + rnd.uniform(-4, 6)))
    COLLIDE["arch"] = [(b[0], b[1] * 0.9) for b in balls]
    me = lib.metaball(balls, resolution=6.0)
    lib.displace(me, 2.5, 0.02, seed=3)
    me = lib.decimate(me, 5000)
    part = lib.from_mesh(me, ROCK)
    lib.bake_ao(part, samples=14, distance=25, strength=0.3)
    lib.to_object("arch_lod0", part)


def needle():
    rnd = random.Random(4)
    balls = []
    for i in range(16):
        t = i / 15
        balls.append(((rnd.uniform(-5, 5), rnd.uniform(-5, 5), -20 + t * 250), 36 * (1 - t) ** 0.8 + 11))
    COLLIDE["needle"] = [(b[0], b[1] * 0.9) for b in balls]
    me = lib.metaball(balls, resolution=5.0)
    lib.displace(me, 5.0, 0.03, seed=8)
    top = max(v.co.z for v in me.vertices) - 12
    for v in me.vertices:  # a flat summit for the shrine
        if v.co.z > top:
            v.co.z = top + (v.co.z - top) * 0.1
    me.update()
    me = lib.decimate(me, 4000)
    rock = lib.from_mesh(me, ROCK)
    sz = top + 0.5
    shrine_parts = [
        lib.box(-3, -3, sz - 2, 3, 3, sz + 3.5, WALLS["white"]),
        lib.hip_roof(-3, -3, 3, 3, sz + 3.5, 2.4, 0.5, ROOFS[0]),
        lib.box(-0.7, -3.08, sz, 0.7, -3.0, sz + 2.2, WOOD),
    ]
    part = lib.combine([rock] + shrine_parts)
    lib.bake_ao(part, samples=14, distance=20, strength=0.3)
    lib.to_object("needle_lod0", part)
    emit("needle_win", [lib.box(-0.5, -3.1, sz + 2.4, 0.5, -3.0, sz + 3.0, GLASS)], ao=0)


def sky_ring():
    rnd = random.Random(12)
    R, n = 70.0, 18
    stone, rune = C("#e2d9c6"), C("#7fe8ff")
    blocks, glow = [], []
    for k in range(n):
        a = 2 * math.pi * k / n
        length = 2 * math.pi * R / n * 0.84
        m = Matrix.Rotation(a, 4, "Y") @ Matrix.Translation((0, 0, R))
        blocks.append(lib.transformed(lib.box(-length / 2, -8, -7, length / 2, 8, 7, stone, skip_bottom=False), m))
        for t in (-0.3, 0.3):
            COLLIDE.setdefault("ring", []).append((tuple(m @ Vector((t * length, 0, 0))), 9.0))
        for face in (-1, 1):
            glow.append(lib.transformed(lib.flat([[(-3.0, face * 8.08, -1.6), (3.0, face * 8.08, -1.6), (3.0, face * 8.08, 1.6), (-3.0, face * 8.08, 1.6)][:: face]], [rune]), m))
    shards = []
    import bmesh
    import bpy
    for s in range(6):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
        me = bpy.data.meshes.new("shard")
        bm.to_mesh(me)
        bm.free()
        k = rnd.uniform(5, 11)
        for v in me.vertices:
            v.co = Vector((v.co.x * k, v.co.y * k * 0.8, v.co.z * k * 1.5))
        me.update()
        lib.displace(me, 1.5, 0.15, seed=s)
        a = rnd.uniform(0, 2 * math.pi)
        r = R + rnd.uniform(18, 34)
        m = Matrix.Translation((math.cos(a) * r, rnd.uniform(-20, 20), math.sin(a) * r)) @ Matrix.Rotation(rnd.uniform(0, 3), 4, "X")
        shards.append(lib.transformed(lib.from_mesh(me, ROCK), m))
    part = recolor(lib.combine(blocks), mossy)
    part = lib.combine([part] + shards)
    lib.bake_ao(part, samples=12, distance=20, strength=0.25)
    lib.to_object("ring_lod0", part)
    emit("ring_win", glow, ao=0)


def sailboat():
    hull_c, stripe, deck = C("#2f5f8a"), C("#f2efe6"), C("#b08a62")
    sections = []
    for i in range(7):
        t = i / 6
        y = -4.5 + t * 9.0  # stern (-y) to bow (+y)
        w = 1.6 * math.sin(math.pi * min(1.0, t * 1.25 + 0.05)) ** 0.6 + 0.05
        sections.append([(-w, y, 1.2), (-w * 0.9, y, 0.3), (0, y, -0.6 * (1 - abs(t - 0.45))), (w * 0.9, y, 0.3), (w, y, 1.2)])
    polys, colors = [], []
    for a, b in zip(sections, sections[1:]):
        for j in range(4):
            polys.append([a[j], a[j + 1], b[j + 1], b[j]])
            colors.append(stripe if j in (0, 3) else hull_c)
    polys.append([s[0] for s in sections] + [s[4] for s in reversed(sections)])
    colors.append(deck)
    hull = lib.flat(polys, colors)
    mast = lib.cylinder(0, 0.5, 1.2, 11, 0.12, 0.09, 6, lambda z: WOOD)
    sail_w, sail_r = C("#f6f1e6"), C("#c84a3a")
    sail = lib.flat(
        [[(0.05, 0.6, 2.0), (0.05, -3.6, 2.2), (0.05, 0.6, 10.5)], [(-0.05, 0.6, 10.5), (-0.05, -3.6, 2.2), (-0.05, 0.6, 2.0)],
         [(0.06, 0.6, 3.0), (0.06, -2.9, 3.2), (0.06, -2.6, 4.0), (0.06, 0.6, 4.0)]],
        [sail_w, sail_w, sail_r],
    )
    emit("boat_lod0", [hull, mast, sail], ao=2.0)


def pier():
    parts = [lib.box(-1.6, -14, 0.9, 1.6, 14, 1.2, C("#a07a55"))]
    for y in range(-13, 15, 4):
        for x in (-1.4, 1.4):
            parts.append(lib.cylinder(x, y, -4, 1.0, 0.18, 0.18, 6, lambda z: C("#6a4a33")))
    emit("pier_lod0", parts, ao=2.0)


def shrine():
    stone = C("#d8cfbc")
    parts = [
        lib.box(-4.5, -4.5, -3, 4.5, 4.5, 0.6, STONE_DARK),
        lib.box(-3.6, -3.6, 0.6, 3.6, 3.6, 1.2, stone),
        lib.box(-3.2, -0.6, 1.2, -2.2, 0.6, 8.0, stone),
        lib.box(2.2, -0.6, 1.2, 3.2, 0.6, 8.0, stone),
        lib.box(-4.4, -0.9, 8.0, 4.4, 0.9, 8.9, stone),
        lib.box(-3.6, -0.7, 6.6, 3.6, 0.7, 7.1, stone),
        lib.cylinder(0, 0, 1.2, 2.6, 0.9, 0.6, 8, lambda z: stone),
    ]
    part = recolor(lib.combine(parts), mossy)
    lib.bake_ao(part, samples=16, distance=4, strength=0.5)
    lib.to_object("shrine_lod0", part)
    glow = lib.cylinder(0, 0, 2.6, 2.75, 0.75, 0.75, 12, lambda z: C("#7fe8ff"))
    emit("shrine_win", [glow], ao=0)


lib.reset()
house("house_a", 8, 6, 1, "gable", WALLS["white"], ROOFS[0], SHUTTERS["teal"])
house("house_b", 10, 7, 2, "hip", WALLS["cream"], ROOFS[1], SHUTTERS["blue"])
house("house_c", 6, 6, 2, "gable", WALLS["ochre"], ROOFS[2], SHUTTERS["green"])
house("house_d", 12, 8, 1, "hip", WALLS["pink"], ROOFS[0], SHUTTERS["blue"])
windmill()
lighthouse()
temple()
ruined_tower()
sea_arch()
needle()
sky_ring()
sailboat()
pier()
shrine()
COLLIDE["tower"] = [((0, 0, z), 13.0) for z in range(0, 56, 9)]
COLLIDE["lighthouse"] = [((0, 0, z), 3.6) for z in (2, 8, 14, 20, 26)] + [((0, 2.5, 1.5), 4.5)]
COLLIDE["windmill"] = [((0, 0, 2), 3.6), ((0, 0, 7), 3.2), ((0, 0, 11), 2.6)]
for name, (w, d) in {"house_a": (8, 6), "house_b": (10, 7), "house_c": (6, 6), "house_d": (12, 8)}.items():
    COLLIDE[name] = [((x, 0, 3), max(d, 6) * 0.55) for x in ((-w / 4, w / 4) if w > 7 else (0,))]
COLLIDE["temple"] = [((x, 0, 4), 6.5) for x in (-10, -3.5, 3.5, 10)]

lib.export(OUT)
import json
with open(OUT_JSON, "w") as f:
    json.dump({k: [[round(c[0], 2), round(c[2], 2), round(-c[1], 2), round(r, 2)] for c, r in v] for k, v in COLLIDE.items()}, f)
print("EXPORTED", OUT, OUT_JSON)
