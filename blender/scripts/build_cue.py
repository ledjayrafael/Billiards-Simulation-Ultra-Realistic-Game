"""Stik: tip kulit, ferrule, shaft maple, joint, forearm, wrap, butt, bumper. Panjang 1.47 m.
Origin di pusat ujung tip; stik memanjang ke −X (tip menghadap +X)."""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402

import common as C  # noqa: E402

CUE = C.SPECS["cue"]


def lathe(name, profile, seg=28):
    """profile: [(jarak dari tip, radius)]. Putar mengelilingi sumbu X."""
    bm = bmesh.new()
    rings = []
    for d, r in profile:
        rings.append([bm.verts.new((-d, r * math.cos(2 * math.pi * i / seg), r * math.sin(2 * math.pi * i / seg))) for i in range(seg)])
    for k in range(len(rings) - 1):
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((rings[k][i], rings[k + 1][i], rings[k + 1][j], rings[k][j]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = C.obj_from_bmesh(name, bm)
    C.shade_smooth(ob, 50)
    # UV silinder: u sepanjang stik, v keliling
    me = ob.data
    uv = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        ca = math.atan2(poly.center.z, poly.center.y)
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            a = math.atan2(co.z, co.y)
            if a - ca > math.pi:
                a -= 2 * math.pi
            elif ca - a > math.pi:
                a += 2 * math.pi
            uv.data[li].uv = (-co.x * 2.0, a / (2 * math.pi) * 0.25)
    return ob


def build():
    L = CUE["length"]
    rt = CUE["tipDiameter"] / 2
    md = C.load_image("white_maple_veneer_diff.jpg")
    mn = C.load_image("white_maple_veneer_nor.jpg", "Non-Color")
    wd = C.load_image("walnut_veneer_02_diff.jpg")
    wn = C.load_image("walnut_veneer_02_nor.jpg", "Non-Color")
    ld = C.load_image("brown_leather_diff.jpg")
    ln = C.load_image("brown_leather_nor.jpg", "Non-Color")
    mats = {
        "tip": C.make_material("CueTip", color=(0.07, 0.19, 0.33), rough=0.95),
        "ferrule": C.make_material("CueFerrule", color=(0.93, 0.91, 0.85), rough=0.3),
        "shaft": C.make_material("CueShaft", diff=md, nor=mn, rough=0.32, tint=(1.0, 0.9, 0.74), coat=0.5, coat_rough=0.1),
        "steel": C.make_material("CueSteel", color=(0.75, 0.76, 0.78), rough=0.22, metallic=1.0),
        "butt": C.make_material("CueButt", diff=wd, nor=wn, rough=0.25, tint=(0.16, 0.07, 0.045), coat=1.0, coat_rough=0.05),
        "wrap": C.make_material("CueWrap", diff=ld, nor=ln, rough=0.7, tint=(0.05, 0.05, 0.055), uv_scale=(8, 8), normal_strength=1.5),
        "accent": C.make_material("CueAccent", color=(0.78, 0.6, 0.3), rough=0.3, metallic=1.0),
        "rubber": C.make_material("CueBumper", color=(0.015, 0.015, 0.016), rough=0.85),
    }
    r_joint, r_butt = 0.0105, 0.0148

    def taper(d):  # radius kayu pada jarak d dari tip
        if d <= 0.30:
            return rt + (0.0001) * d  # pro taper: hampir silindris 30 cm pertama
        if d <= 0.737:
            return rt + (r_joint - rt) * ((d - 0.30) / 0.437) ** 1.15
        return r_joint + (r_butt - r_joint) * (d - 0.737) / (L - 0.737 - 0.02)

    def seg(a, b, n=6):
        return [(a + (b - a) * i / n, taper(a + (b - a) * i / n)) for i in range(n + 1)]

    parts = [
        ("tip", [(0.0, rt * 0.55), (0.0012, rt * 0.86), (0.0035, rt * 0.99), (0.008, rt)]),
        ("ferrule", [(0.008, rt), (0.033, rt)]),
        ("shaft", seg(0.033, 0.724, 14)),
        ("steel", [(0.724, taper(0.724)), (0.727, taper(0.727) + 0.0003), (0.747, taper(0.747) + 0.0003), (0.750, taper(0.750))]),
        ("butt", seg(0.750, 0.795, 2)),
        ("accent", [(0.795, taper(0.795) + 0.0002), (0.801, taper(0.801) + 0.0002)]),
        ("butt", seg(0.801, 1.06, 6)),
        ("accent", [(1.06, taper(1.06) + 0.0002), (1.066, taper(1.066) + 0.0002)]),
        ("wrap", seg(1.066, 1.36, 6)),
        ("accent", [(1.36, taper(1.36) + 0.0002), (1.366, taper(1.366) + 0.0002)]),
        ("butt", seg(1.366, L - 0.02, 3)),
        ("rubber", [(L - 0.02, r_butt), (L - 0.006, r_butt * 0.97), (L - 0.001, r_butt * 0.8), (L, r_butt * 0.5)]),
    ]
    objs = []
    for i, (mat, prof) in enumerate(parts):
        ob = lathe(f"cue_part_{i}", prof)
        C.assign(ob, mats[mat])
        objs.append(ob)
    cue = C.join(objs, "Cue")
    return [cue]


if __name__ == "__main__":
    C.reset_scene()
    objs = build()
    print(f"[cue] {C.tri_count(objs)} tris")
    out = C.arg_value("--out", os.path.join(C.OUT_DIR, "glb"))
    C.export_glb(os.path.join(out, "cue.glb"), objs)
