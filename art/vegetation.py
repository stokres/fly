"""Trees, bushes and rocks. Usage: blender -b --factory-startup --python art/vegetation.py -- out.glb

Ghibli-style vegetation: puffy canopies from merged blobs (metaballs) with lumpy noise, foliage
normals bent toward the canopy center for soft blob shading, green gradients from shadowed
undersides to sunlit tops, baked ambient occlusion. Each asset comes in three LODs:
  lod0 (near, ~1k tris), lod1 (mid, ~200), lod2 (far, ~40).
"""
import math
import random
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import lib  # noqa: E402
from mathutils import Vector  # noqa: E402

OUT = sys.argv[sys.argv.index("--") + 1]

BARK = lib.srgb("#6b5442")
BARK_DARK = lib.srgb("#4a3a30")

# Canopy LOD settings: metaball resolution, target faces, noise amplitude.
CANOPY_LODS = [(0.3, 700, 0.3), (0.8, 160, 0.15), (2.2, 40, 0.0)]


def clumps(balls, rnd, count, size):
    """Small leaf clumps scattered over the outside of the crown, for a bumpy, leafy silhouette."""
    out = list(balls)
    for _ in range(count):
        b = balls[rnd.randrange(len(balls))]
        d = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), abs(rnd.gauss(0, 1)) * 0.8 + 0.1)).normalized()
        c = Vector(b[0]) + d * b[1] * 0.85
        out.append((tuple(c), size * (0.7 + rnd.random() * 0.5)))
    return out


def canopy(balls, center, dark, light, seed, lod, spherical=0.65, flower=None):
    res, faces, amp = CANOPY_LODS[lod]
    if lod == 2:
        # Far LOD: one ellipsoid hugging the whole crown.
        lo = Vector((min(b[0][0] - b[1] for b in balls), min(b[0][1] - b[1] for b in balls), min(b[0][2] - b[1] for b in balls)))
        hi = Vector((max(b[0][0] + b[1] for b in balls), max(b[0][1] + b[1] for b in balls), max(b[0][2] + b[1] for b in balls)))
        c = (lo + hi) / 2
        size = (hi - lo) / 2
        balls = [(tuple(c), 1.0, (size.x * 0.85, size.y * 0.85, size.z * 0.85))]
    me = lib.metaball(balls, resolution=res)
    if amp > 0:
        lib.displace(me, amp, 0.55, seed)
    me = lib.decimate(me, faces)
    me.update()
    zs = [v.co.z for v in me.vertices]
    z0, z1 = min(zs), max(zs)
    rnd = random.Random(seed)
    lump_tint = {}

    def color(co, n):
        t = (co.z - z0) / max(z1 - z0, 1e-3)
        up = max(0.0, n.z)
        out = max(0.0, (co - Vector(center)).normalized().dot(n))
        c = lib.mix(dark, light, 0.15 + 0.4 * t + 0.25 * up + 0.2 * out)
        # Slight per-region tint so the crown reads as clumps of leaves.
        key = (round(co.x / 1.6), round(co.y / 1.6), round(co.z / 1.6))
        if key not in lump_tint:
            lump_tint[key] = 0.9 + rnd.random() * 0.2
        k = lump_tint[key]
        c = (c[0] * k, c[1] * k, c[2] * k)
        if flower and rnd.random() < flower[1] and n.z > -0.2:
            c = flower[0]
        return c

    def normal(co, n):
        s = (co - Vector(center)).normalized()
        return (n * (1 - spherical) + s * spherical).normalized()

    return lib.from_mesh(me, color, normal)


def trunk_part(points, radii, lod):
    seg = [7, 5, 4][lod]
    return lib.tube(points, radii, segments=seg, color=BARK)


def finish(name, parts, lod, ao_dist):
    part = lib.combine(parts)
    lib.bake_ao(part, samples=[20, 12, 6][lod], distance=ao_dist, strength=0.55)
    lib.to_object(f"{name}_lod{lod}", part)


def broadleaf(name, seed, height, spread, dark, light):
    rnd = random.Random(seed)
    top = height * 0.62
    balls = [((0, 0, top), spread * 0.7)]
    for i in range(7):
        a = i / 7 * 2 * math.pi + rnd.random() * 0.6
        r = spread * (0.55 + rnd.random() * 0.35)
        z = top + (rnd.random() - 0.3) * height * 0.22
        balls.append(((math.cos(a) * r, math.sin(a) * r, z), spread * (0.42 + rnd.random() * 0.2)))
    balls.append(((0, 0, top + spread * 0.55), spread * 0.55))
    balls = clumps(balls, rnd, 26, spread * 0.26)
    center = (0, 0, top)
    lean = Vector((rnd.random() - 0.5, rnd.random() - 0.5, 0)) * 0.6
    trunk_pts = [(0, 0, -0.5), tuple(lean * 0.3 + Vector((0, 0, height * 0.25))), tuple(lean + Vector((0, 0, top - 0.5)))]
    for lod in range(3):
        parts = [canopy(balls, center, dark, light, seed, lod)]
        if lod < 2:  # far away the trunk is under a pixel
            parts.append(trunk_part(trunk_pts, [0.55, 0.42, 0.3], lod))
        if lod == 0:
            # Two branches reaching into the crown.
            for k in range(2):
                a = rnd.random() * 2 * math.pi
                p0 = lean * 0.5 + Vector((0, 0, height * 0.35))
                p1 = Vector((math.cos(a) * spread * 0.55, math.sin(a) * spread * 0.55, top - 0.3))
                parts.append(lib.tube([tuple(p0), tuple((p0 + p1) / 2 + Vector((0, 0, 0.6))), tuple(p1)], [0.22, 0.16, 0.1], 5, BARK_DARK))
        finish(name, parts, lod, spread * 1.6)


def cypress(name, seed, height):
    rnd = random.Random(seed)
    balls = []
    n = 9
    for i in range(n):
        t = i / (n - 1)
        z = 1.6 + t * (height - 2.4)
        r = 1.9 * (1 - t) ** 0.7 + 0.45
        balls.append(((rnd.random() * 0.3 - 0.15, rnd.random() * 0.3 - 0.15, z), r))
    balls = clumps(balls, rnd, 22, 0.75)
    dark = lib.srgb("#24502f")
    light = lib.srgb("#4f8d3e")
    for lod in range(3):
        parts = [canopy(balls, (0, 0, height * 0.45), dark, light, seed, lod, spherical=0.45)]
        if lod < 2:
            parts.append(trunk_part([(0, 0, -0.5), (0, 0, 2.2)], [0.35, 0.25], lod))
        finish(name, parts, lod, 3.0)


def umbrella_pine(name, seed, height):
    rnd = random.Random(seed)
    top = height
    balls = []
    for i in range(8):
        a = i / 8 * 2 * math.pi + rnd.random() * 0.5
        r = 3.2 + rnd.random() * 1.2
        balls.append(((math.cos(a) * r, math.sin(a) * r, top + rnd.random() * 0.6), 2.4, (1.3, 1.3, 0.6)))
    balls.append(((0, 0, top + 0.7), 3.4, (1.4, 1.4, 0.55)))
    for _ in range(18):
        a = rnd.random() * 2 * math.pi
        r = rnd.random() * 4.6
        balls.append(((math.cos(a) * r, math.sin(a) * r, top + 0.9 + rnd.random() * 0.8), 1.1 + rnd.random() * 0.5))
    bend = Vector((rnd.random() - 0.5, rnd.random() - 0.5, 0)).normalized() * 1.4
    pts = [(0, 0, -0.5), tuple(bend * 0.2 + Vector((0, 0, height * 0.4))), tuple(bend + Vector((0, 0, top - 0.3)))]
    dark = lib.srgb("#2f5e33")
    light = lib.srgb("#6ea446")
    for lod in range(3):
        crown = [((b[0][0] + bend.x, b[0][1] + bend.y, b[0][2]),) + tuple(b[1:]) for b in balls]
        parts = [canopy(crown, (bend.x, bend.y, top), dark, light, seed, lod, spherical=0.55)]
        if lod < 2:
            parts.append(trunk_part(pts, [0.5, 0.36, 0.26], lod))
        finish(name, parts, lod, 5.0)


def bush(name, seed, size, flower=None):
    rnd = random.Random(seed)
    balls = [((0, 0, size * 0.35), size * 0.55)]
    for i in range(5):
        a = i / 5 * 2 * math.pi + rnd.random()
        balls.append(((math.cos(a) * size * 0.45, math.sin(a) * size * 0.45, size * 0.25), size * 0.4))
    balls = clumps(balls, rnd, 10, size * 0.2)
    dark = lib.srgb("#356b34")
    light = lib.srgb("#86bd4c")
    for lod in range(3):
        parts = [canopy(balls, (0, 0, size * 0.2), dark, light, seed, lod, spherical=0.6, flower=flower)]
        finish(name, parts, lod, size)


def rock(name, seed, sx, sy, sz):
    import bmesh
    import bpy

    rnd = random.Random(seed)
    for lod in range(3):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=[3, 2, 1][lod], radius=1.0)
        me = bpy.data.meshes.new("rock")
        bm.to_mesh(me)
        bm.free()
        for v in me.vertices:
            v.co.x *= sx
            v.co.y *= sy
            v.co.z *= sz
        me.update()
        lib.displace(me, 0.22 * min(sx, sy, sz) * (1 if lod < 2 else 0.5), 0.7 / min(sx, sy, sz), seed)
        # Sit it in the ground: flatten the bottom.
        for v in me.vertices:
            if v.co.z < -sz * 0.35:
                v.co.z = -sz * 0.35 - (v.co.z + sz * 0.35) * 0.15
        me.update()
        stone = lib.srgb("#c2b6a0")
        stone_dark = lib.srgb("#8f8576")
        moss = lib.srgb("#7c9e48")

        def color(co, n):
            c = lib.mix(stone_dark, stone, 0.5 + 0.5 * n.z)
            c = lib.hsv_jitter(c, rnd, 0.06)
            if n.z > 0.55 and co.z > 0:
                c = lib.mix(c, moss, (n.z - 0.55) * 2.2)
            return c

        part = lib.from_mesh(me, color)
        lib.bake_ao(part, samples=[16, 10, 6][lod], distance=max(sx, sy, sz), strength=0.5)
        lib.to_object(f"{name}_lod{lod}", part)


lib.reset()
broadleaf("broadleaf_a", 11, 13, 4.6, lib.srgb("#2f6a35"), lib.srgb("#8cc657"))
broadleaf("broadleaf_b", 23, 15, 3.9, lib.srgb("#336f37"), lib.srgb("#9ccd5c"))
broadleaf("broadleaf_c", 37, 11, 5.6, lib.srgb("#3a7232"), lib.srgb("#b0cf58"))
cypress("cypress", 5, 16)
umbrella_pine("pine", 9, 12)
bush("bush", 3, 2.6)
bush("bush_flower", 4, 2.4, flower=(lib.srgb("#f4f0f8"), 0.18))
rock("rock_a", 7, 2.4, 2.0, 1.6)
rock("rock_b", 8, 3.2, 2.2, 1.0)
rock("rock_c", 9, 1.4, 1.3, 2.6)
lib.export(OUT)
print("EXPORTED", OUT)
