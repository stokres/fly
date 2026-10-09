"""Shared helpers for the asset scripts. Run inside Blender (bpy), headless.

Every asset is built as plain mesh data (vertices, faces, per-vertex normals and colors) from
"parts", then combined, ambient-occlusion baked into the vertex colors by ray casting, and
exported as glTF with no materials: the game shades everything with its own stylized material,
reading COLOR_0. Normals are custom (e.g. spherical on foliage, for soft blob shading).
"""
import math
import random

import bmesh
import bpy
from mathutils import Vector, noise
from mathutils.bvhtree import BVHTree


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


class Part:
    """Mesh data for one piece of an asset."""

    def __init__(self, verts, faces, normals, colors):
        self.verts = [Vector(v) for v in verts]
        self.faces = [tuple(f) for f in faces]
        self.normals = [Vector(n).normalized() for n in normals]
        self.colors = [tuple(c) for c in colors]


def _mesh_arrays(me):
    me.calc_loop_triangles()
    verts = [v.co.copy() for v in me.vertices]
    normals = [v.normal.copy() for v in me.vertices]
    faces = [tuple(p.vertices) for p in me.polygons]
    return verts, faces, normals


def metaball(balls, resolution=0.4, threshold=0.18):
    """Smooth union of spheres/ellipsoids. balls: (center, radius) or (center, radius, (sx,sy,sz)).

    Radii are visible radii: Blender's element radius is an influence radius whose surface, at
    this threshold, sits at about 0.77 of it, so radii are scaled up to compensate.
    """
    name = f"mb{random.random():.9f}".replace(".", "")  # unique: metaballs sharing a name merge
    mb = bpy.data.metaballs.new(name)
    mb.resolution = resolution
    mb.render_resolution = resolution
    mb.threshold = threshold
    for b in balls:
        e = mb.elements.new()
        e.co = Vector(b[0])
        e.radius = b[1] * 1.3
        if len(b) > 2:
            e.type = "ELLIPSOID"
            e.size_x, e.size_y, e.size_z = b[2]
    obj = bpy.data.objects.new(name, mb)
    bpy.context.scene.collection.objects.link(obj)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    bpy.data.objects.remove(obj)
    return me


def decimate(me, target_faces):
    """Collapse-decimate a mesh datablock to about target_faces faces."""
    if len(me.polygons) <= target_faces:
        return me
    obj = bpy.data.objects.new("dec", me)
    bpy.context.scene.collection.objects.link(obj)
    mod = obj.modifiers.new("d", "DECIMATE")
    mod.ratio = target_faces / len(me.polygons)
    mod.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    out = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    bpy.data.objects.remove(obj)
    return out


def displace(me, amp, freq, seed=0.0, along_normal=True):
    """Lumpy organic surface: push vertices along their normals by 3D noise."""
    me.update()
    off = Vector((seed * 13.1, seed * 7.7, seed * 3.3))
    for v in me.vertices:
        n = noise.noise(v.co * freq + off)
        n += 0.5 * noise.noise(v.co * freq * 2.3 + off)
        v.co += (v.normal if along_normal else Vector((0, 0, 1))) * n * amp
    me.update()


def from_mesh(me, color_fn, normal_fn=None):
    """Part from a mesh datablock. color_fn(co, normal) -> rgb; normal_fn(co, n) -> custom normal."""
    verts, faces, normals = _mesh_arrays(me)
    if normal_fn:
        normals = [normal_fn(v, n) for v, n in zip(verts, normals)]
    colors = [color_fn(v, n) for v, n in zip(verts, normals)]
    return Part(verts, faces, normals, colors)


def tube(points, radii, segments=6, color=(0.4, 0.3, 0.2), cap=True):
    """Tapered tube along a polyline (trunks, branches, columns)."""
    verts, faces, normals, colors = [], [], [], []
    rings = []
    for i, p in enumerate(points):
        p = Vector(p)
        d = (Vector(points[min(i + 1, len(points) - 1)]) - Vector(points[max(i - 1, 0)])).normalized()
        side = d.cross(Vector((0, 0, 1)) if abs(d.z) < 0.95 else Vector((1, 0, 0))).normalized()
        up = side.cross(d).normalized()
        ring = []
        for s in range(segments):
            a = 2 * math.pi * s / segments
            n = side * math.cos(a) + up * math.sin(a)
            ring.append(len(verts))
            verts.append(p + n * radii[i])
            normals.append(n)
            colors.append(color)
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        for s in range(segments):
            faces.append((r0[s], r0[(s + 1) % segments], r1[(s + 1) % segments], r1[s]))
    if cap:
        top = len(verts)
        verts.append(Vector(points[-1]))
        normals.append(Vector((0, 0, 1)))
        colors.append(color)
        r = rings[-1]
        for s in range(segments):
            faces.append((r[s], r[(s + 1) % segments], top))
    return Part(verts, faces, normals, colors)


def combine(parts):
    verts, faces, normals, colors = [], [], [], []
    for p in parts:
        base = len(verts)
        verts += p.verts
        normals += p.normals
        colors += p.colors
        faces += [tuple(i + base for i in f) for f in p.faces]
    return Part(verts, faces, normals, colors)


def bake_ao(part, samples=24, distance=6.0, strength=0.6, seed=1):
    """Ambient occlusion by ray casting against the part itself, multiplied into its colors."""
    bvh = BVHTree.FromPolygons(part.verts, part.faces, all_triangles=False)
    rnd = random.Random(seed)
    dirs = []
    for _ in range(samples):
        # cosine-weighted hemisphere around +Z, rotated per vertex below
        u, v = rnd.random(), rnd.random()
        r = math.sqrt(u)
        a = 2 * math.pi * v
        dirs.append(Vector((r * math.cos(a), r * math.sin(a), math.sqrt(max(0.0, 1 - u)))))
    out = []
    for co, n, c in zip(part.verts, part.normals, part.colors):
        t = n.cross(Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))).normalized()
        b = n.cross(t)
        hits = 0
        for d in dirs:
            w = t * d.x + b * d.y + n * d.z
            loc, _, _, _ = bvh.ray_cast(co + n * 0.03, w, distance)
            if loc is not None:
                hits += 1
        ao = 1.0 - hits / samples
        k = 1.0 - strength * (1.0 - ao)
        out.append((c[0] * k, c[1] * k, c[2] * k))
    part.colors = out
    return part


def to_object(name, part):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in part.verts], [], part.faces)
    me.update()
    attr = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    for i, c in enumerate(part.colors):
        attr.data[i].color = (c[0], c[1], c[2], 1.0)
    me.color_attributes.active_color = attr
    if hasattr(me, "use_auto_smooth"):
        me.use_auto_smooth = True  # needed for custom normals before Blender 4.1
    me.normals_split_custom_set_from_vertices([tuple(n) for n in part.normals])
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def export(path):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_colors=True,
        export_normals=True,
        export_materials="NONE",
        export_yup=True,
        export_apply=True,
    )


def hsv_jitter(rgb, rnd, amount=0.05):
    r, g, b = rgb
    k = 1 + (rnd.random() - 0.5) * 2 * amount
    return (r * k, g * k, b * k)


def srgb(hex_color):
    """'#rrggbb' to linear rgb tuple (glTF vertex colors are linear)."""
    h = hex_color.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(x + (y - x) * t for x, y in zip(a, b))


# ---------------------------------------------------------------------------------------------
# Hard-surface helpers (architecture): flat-shaded parts, every face with its own vertices.


def flat(polys, colors):
    """Part from polygons (lists of points), one color per polygon, flat normals."""
    verts, faces, normals, cols = [], [], [], []
    for poly, c in zip(polys, colors):
        pts = [Vector(p) for p in poly]
        n = Vector((0, 0, 0))
        for i in range(len(pts)):  # Newell's method: robust for any planar polygon
            a, b = pts[i], pts[(i + 1) % len(pts)]
            n.x += (a.y - b.y) * (a.z + b.z)
            n.y += (a.z - b.z) * (a.x + b.x)
            n.z += (a.x - b.x) * (a.y + b.y)
        n = n.normalized() if n.length > 1e-9 else Vector((0, 0, 1))
        base = len(verts)
        verts += pts
        normals += [n] * len(pts)
        cols += [c] * len(pts)
        faces.append(tuple(range(base, base + len(pts))))
    return Part(verts, faces, normals, cols)


def box(x0, y0, z0, x1, y1, z1, color, top=None, skip_bottom=True):
    """Axis-aligned box; `top` overrides the color of the top face."""
    p = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    faces = [
        ((0, 1, 5, 4), color),  # front (-y)
        ((1, 2, 6, 5), color),  # right (+x)
        ((2, 3, 7, 6), color),  # back (+y)
        ((3, 0, 4, 7), color),  # left (-x)
        ((4, 5, 6, 7), top or color),  # top
    ]
    if not skip_bottom:
        faces.append(((3, 2, 1, 0), color))
    return flat([[p[i] for i in f] for f, _ in faces], [c for _, c in faces])


def gable_roof(x0, y0, x1, y1, z0, h, over, roof, gable):
    """Gable roof with the ridge along x, overhanging the walls by `over`."""
    xa, xb, ya, yb = x0 - over, x1 + over, y0 - over, y1 + over
    ym = (y0 + y1) / 2
    zr = z0 + h
    drop = h * over / ((y1 - y0) / 2)  # keep the slope through the overhang
    polys = [
        [(xa, ya, z0 - drop), (xb, ya, z0 - drop), (xb, ym, zr), (xa, ym, zr)],
        [(xb, yb, z0 - drop), (xa, yb, z0 - drop), (xa, ym, zr), (xb, ym, zr)],
        [(x0, y0, z0), (x0, ym, zr - 0.02), (x0, y1, z0)],
        [(x1, y0, z0), (x1, ym, zr - 0.02), (x1, y1, z0)][::-1],
        # underside of the eaves, darker
        [(xa, ya, z0 - drop - 0.15), (xa, ym, zr - 0.15), (xb, ym, zr - 0.15), (xb, ya, z0 - drop - 0.15)],
        [(xb, yb, z0 - drop - 0.15), (xb, ym, zr - 0.15), (xa, ym, zr - 0.15), (xa, yb, z0 - drop - 0.15)],
    ]
    shade = tuple(c * 0.55 for c in roof)
    return flat(polys, [roof, roof, gable, gable, shade, shade])


def hip_roof(x0, y0, x1, y1, z0, h, over, roof):
    xa, xb, ya, yb = x0 - over, x1 + over, y0 - over, y1 + over
    inset = min(x1 - x0, y1 - y0) / 2
    xm0, xm1 = xa + inset + over, xb - inset - over
    ym = (y0 + y1) / 2
    zr = z0 + h
    if xm1 < xm0:
        xm0 = xm1 = (xa + xb) / 2
    polys = [
        [(xa, ya, z0), (xb, ya, z0), (xm1, ym, zr), (xm0, ym, zr)],
        [(xb, yb, z0), (xa, yb, z0), (xm0, ym, zr), (xm1, ym, zr)],
        [(xb, ya, z0), (xb, yb, z0), (xm1, ym, zr)],
        [(xa, yb, z0), (xa, ya, z0), (xm0, ym, zr)],
    ]
    return flat(polys, [roof] * 4)


def cylinder(cx, cy, z0, z1, r0, r1, segments, color_fn, cap=True):
    """Flat-shaded (faceted) cylinder/cone; color_fn(z_mid) -> rgb for each band."""
    polys, cols = [], []
    for s in range(segments):
        a0 = 2 * math.pi * s / segments
        a1 = 2 * math.pi * (s + 1) / segments
        p = [
            (cx + math.cos(a0) * r0, cy + math.sin(a0) * r0, z0),
            (cx + math.cos(a1) * r0, cy + math.sin(a1) * r0, z0),
            (cx + math.cos(a1) * r1, cy + math.sin(a1) * r1, z1),
            (cx + math.cos(a0) * r1, cy + math.sin(a0) * r1, z1),
        ]
        if r1 < 1e-4:
            p = p[:3]
        polys.append(p)
        cols.append(color_fn((z0 + z1) / 2))
    if cap and r1 > 1e-4:
        polys.append([(cx + math.cos(2 * math.pi * s / segments) * r1, cy + math.sin(2 * math.pi * s / segments) * r1, z1) for s in range(segments)])
        cols.append(color_fn(z1))
    return flat(polys, cols)


def banded_cylinder(cx, cy, z0, z1, r0, r1, segments, bands, color_fn):
    """Cylinder split into horizontal bands (for stripes, AO and tapering)."""
    parts = []
    for i in range(bands):
        za = z0 + (z1 - z0) * i / bands
        zb = z0 + (z1 - z0) * (i + 1) / bands
        ra = r0 + (r1 - r0) * i / bands
        rb = r0 + (r1 - r0) * (i + 1) / bands
        parts.append(cylinder(cx, cy, za, zb, ra, rb, segments, color_fn, cap=(i == bands - 1)))
    return combine(parts)


def transformed(part, matrix):
    """Copy of a part transformed by a mathutils Matrix (4x4)."""
    rot = matrix.to_3x3()
    return Part([matrix @ v for v in part.verts], part.faces, [rot @ n for n in part.normals], part.colors)
