"""Stik biliar. Origin di pusat ujung tip; stik memanjang ke −X (tip menghadap +X).

- Cue_local  : stik lokal (tip kulit, ferrule, shaft maple, joint baja, forearm walnut, wrap kulit, butt).
- Cue_ikon45 : "Predator Ikon4 5 - Cue Play" — shaft maple premium low deflection, collar krem,
               forearm birdseye abu-abu dengan inlay ujung tombak krem/hitam + batu turquoise,
               ring berlian turquoise, wrap kulit hitam bertekstur, butt sleeve ber-inlay, butt cap krem.
               Inlay dilukis prosedural (numpy) ke tekstur per bagian; tanpa logo/teks merek.

Panjang & id model dari blender/specs.json → cues."""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
import numpy as np  # noqa: E402

import common as C  # noqa: E402

CUE = C.SPECS["cue"]
CUES = {c["id"]: c for c in C.SPECS["cues"]}


def lathe(name, profile, seg=28, uvrange=None):
    """profile: [(jarak dari tip, radius)]. Putar mengelilingi sumbu X.
    uvrange=None: UV silinder global (u = 2 × jarak, v = keliling × 0.25) — untuk tekstur kayu berulang.
    uvrange=(d0, d1): u = 0..1 sepanjang bagian [d0, d1], v = 0..1 keliling — untuk tekstur inlay."""
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
            if uvrange is None:
                uv.data[li].uv = (-co.x * 2.0, a / (2 * math.pi) * 0.25)
            else:
                d0, d1 = uvrange
                uv.data[li].uv = ((-co.x - d0) / (d1 - d0), a / (2 * math.pi) + 0.5)
    return ob


def make_taper(L, rt, r_joint=0.0105, r_butt=0.0148, joint_d=0.737):
    def taper(d):  # radius kayu pada jarak d dari tip
        if d <= 0.30:
            return rt + 0.0001 * d  # pro taper: hampir silindris 30 cm pertama
        if d <= joint_d:
            return rt + (r_joint - rt) * ((d - 0.30) / (joint_d - 0.30)) ** 1.15
        return r_joint + (r_butt - r_joint) * (d - joint_d) / (L - joint_d - 0.02)

    return taper


def build_parts(name, parts, mats, seg):
    objs = []
    for i, p in enumerate(parts):
        mat, prof = p[0], p[1]
        uvr = p[2] if len(p) > 2 else None
        ob = lathe(f"{name}_part_{i}", prof, seg=seg, uvrange=uvr)
        C.assign(ob, mats[mat])
        objs.append(ob)
    return C.join(objs, name)


# ───────────────────────── stik lokal ─────────────────────────

def build_local():
    L = CUES["local"]["length"]
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
    taper = make_taper(L, rt)

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
        ("rubber", [(L - 0.02, 0.0148), (L - 0.006, 0.0148 * 0.97), (L - 0.001, 0.0148 * 0.8), (L, 0.0148 * 0.5)]),
    ]
    return build_parts(CUES["local"]["model"], parts, mats, 28)


# ───────────────────────── tekstur prosedural Ikon4 5 ─────────────────────────
# Warna dalam sRGB (bpy image byte menyimpan nilai tampilan). Array (H, W): baris = keliling (v),
# kolom = sepanjang bagian (u, 0 = sisi ke arah tip).

BLACK = np.array([0.025, 0.025, 0.03])
CREAM = np.array([0.93, 0.89, 0.79])
TURQ = np.array([0.13, 0.74, 0.78])
TURQ_DARK = np.array([0.03, 0.33, 0.37])
GREY_DARK = np.array([0.16, 0.17, 0.20])
GREY_LIGHT = np.array([0.46, 0.48, 0.53])


def pnoise(h, w, sv, su, rng):
    """Noise halus periodik (tiling di kedua sumbu) via filter Gauss di domain frekuensi; ~[-1, 1]."""
    n = rng.standard_normal((h, w))
    fv = np.fft.fftfreq(h)[:, None]
    fu = np.fft.fftfreq(w)[None, :]
    g = np.exp(-2 * (math.pi ** 2) * ((fv * sv) ** 2 + (fu * su) ** 2))
    out = np.real(np.fft.ifft2(np.fft.fft2(n) * g))
    return out / (np.abs(out).max() + 1e-9)


def birdseye(h, w, rng):
    """Maple birdseye/curly diwarnai abu-abu: belang lebar, figur bergelombang, mata burung kecil."""
    blotch = pnoise(h, w, 22, 40, rng)
    streak = pnoise(h, w, 3, 30, rng)
    curl = np.sin(np.arange(w)[None, :] * 0.11 + 4 * pnoise(h, w, 30, 30, rng)) * 0.5
    eyes = pnoise(h, w, 2.2, 2.2, rng)
    val = 0.5 + 0.30 * blotch + 0.16 * streak + 0.10 * curl
    val -= 0.35 * np.clip((eyes - 0.45) / 0.3, 0, 1)  # mata burung: bintik gelap kecil
    val = np.clip(val, 0, 1)[..., None]
    return GREY_DARK + (GREY_LIGHT - GREY_DARK) * val


def turquoise(h, w, rng):
    """Batu turquoise ber-urat (matrix gelap)."""
    vein = np.abs(pnoise(h, w, 5, 5, rng)) + 0.4 * np.abs(pnoise(h, w, 2, 2, rng))
    mott = pnoise(h, w, 6, 6, rng)
    t = np.clip(0.75 + 0.25 * mott, 0, 1)[..., None]
    col = TURQ * (0.85 + 0.25 * t)
    v = np.clip(1 - vein / 0.09, 0, 1)[..., None]
    return np.clip(col * (1 - v) + TURQ_DARK * v, 0, 1)


def paint(img, mask, color):
    """mask (H, W) 0..1 (anti-alias) — tumpuk warna (array (H,W,3) atau (3,))."""
    m = np.clip(mask, 0, 1)[..., None]
    img *= 1 - m
    img += m * color
    return img


def sdf_mask(d, aa=1.0):
    """d < 0 di dalam (px) → coverage halus."""
    return np.clip(0.5 - d / aa, 0, 1)


def wrapdv(V, vc, H):
    d = V - vc
    return (d + H / 2) % H - H / 2


def spear_hw(x, x_tip, x_base, w_base, power):
    s = np.clip((x - x_tip) / (x_base - x_tip), 0, 1)
    return np.where(x > x_tip, w_base * s ** power, -1.0)


def forearm_texture(rng, W=2048, H=512):
    """Forearm: u=0 di joint, u=1 di ring atas wrap. 4 ujung tombak bertumpu di wrap mengarah ke joint."""
    U, V = np.meshgrid(np.arange(W, dtype=np.float64), np.arange(H, dtype=np.float64))
    img = birdseye(H, W, rng)
    stone = turquoise(H, W, rng)
    n = 4
    pitch = H / n
    for k in range(n):
        dv = np.abs(wrapdv(V, (k + 0.5) * pitch, H))
        # tombak panjang: garis hitam – krem – hitam yang menyatu jauh di dekat joint
        hw = spear_hw(U, 140, W - 1, 0.46 * pitch, 1.6)
        edge = np.abs(dv - hw)
        inside = hw > 0
        paint(img, sdf_mask(edge - 4.5) * inside, BLACK)
        hw2 = hw - 10
        paint(img, sdf_mask(np.abs(dv - hw2) - 2.5) * (hw2 > 0), CREAM)
        hw3 = hw - 16
        paint(img, sdf_mask(np.abs(dv - hw3) - 2.0) * (hw3 > 0), BLACK)
        # badan krem (lebar di wrap) dengan garis hitam, berisi batu turquoise berbentuk lensa
        hb = spear_hw(U, 1000, W - 1, 0.40 * pitch, 0.7)
        paint(img, sdf_mask(dv - hb) * (hb > 0), BLACK)
        paint(img, sdf_mask(dv - (hb - 6.0)) * (hb > 6), CREAM)
        # garis hitam tengah memisah dua lobus krem
        hl = spear_hw(U, 1150, W - 1, 0.03 * pitch, 0.9)
        paint(img, sdf_mask(dv - hl) * (hl > 0), BLACK)
        x0, x1 = 1420.0, 1990.0
        s = np.clip((U - x0) / (x1 - x0), 0, 1)
        ht = 0.12 * pitch * np.sin(math.pi * s) ** 0.75
        lens = (U > x0) & (U < x1)
        paint(img, sdf_mask(dv - ht) * lens, BLACK)
        paint(img, sdf_mask(dv - (ht - 5.0)) * lens * (ht > 5.0), stone)
        # di antara tombak: anak panah hitam dengan berlian turquoise di ujungnya
        da = np.abs(wrapdv(V, k * pitch, H))
        shaft_line = (U > 470) & (U < 1500)
        paint(img, sdf_mask(da - 2.2) * shaft_line, BLACK)
        for xc, sx, sy in ((450.0, 26.0, 11.0), (1050.0, 15.0, 7.0)):
            dd = np.abs(U - xc) / sx + da / sy
            paint(img, sdf_mask((dd - 1.0) * min(sx, sy) - 0.0), BLACK)
            paint(img, sdf_mask((dd - 1.0) * min(sx, sy) + 3.5), stone)
    return np.clip(img, 0, 1)


def sleeve_texture(rng, W=416, H=608):
    """Butt sleeve: u=0 di ring bawah wrap, u=1 di butt cap. Tetesan krem + lensa turquoise
    (bulat di sisi wrap, runcing ke butt cap), anak panah berlian di antaranya."""
    U, V = np.meshgrid(np.arange(W, dtype=np.float64), np.arange(H, dtype=np.float64))
    img = birdseye(H, W, rng)
    stone = turquoise(H, W, rng)
    n = 4
    pitch = H / n
    for k in range(n):
        dv = np.abs(wrapdv(V, (k + 0.5) * pitch, H))
        # tetesan: lebar di u≈0.25, runcing ke butt cap
        s = U / (W - 1)
        hw = np.where(s < 0.92, 0.36 * pitch * np.sin(math.pi * np.clip(s / 0.92, 0, 1)) ** 0.55 * (1 - 0.55 * s), -1)
        paint(img, sdf_mask(dv - hw), BLACK)
        paint(img, sdf_mask(dv - (hw - 6.0)) * (hw > 6.0), CREAM)
        hi = hw * 0.62 - 4
        paint(img, sdf_mask(dv - hi) * (hi > 0), BLACK)
        paint(img, sdf_mask(dv - (hi - 5.0)) * (hi > 5.0), stone)
        da = np.abs(wrapdv(V, k * pitch, H))
        paint(img, sdf_mask(da - 1.3) * ((U > 60) & (U < 330)), BLACK)
        dd = np.abs(U - 330) / 22 + da / 10
        paint(img, sdf_mask((dd - 1.0) * 10), BLACK)
        paint(img, sdf_mask((dd - 1.0) * 10 + 2.0), stone)
    return np.clip(img, 0, 1)


def ring_texture(rng, W=112, H=576, count=12):
    """Ring krem: dua garis hitam tipis di tepi + deretan berlian turquoise."""
    U, V = np.meshgrid(np.arange(W, dtype=np.float64), np.arange(H, dtype=np.float64))
    img = np.broadcast_to(CREAM, (H, W, 3)).copy()
    img *= 1 + 0.03 * pnoise(H, W, 6, 6, rng)[..., None]
    stone = turquoise(H, W, rng)
    for x in (10.0, W - 11.0):
        paint(img, sdf_mask(np.abs(U - x) - 2.0), BLACK)
    pitch = H / count
    da = np.abs(wrapdv(V % pitch, pitch / 2, pitch))
    dd = np.abs(U - W / 2) / 26 + da / 17
    paint(img, sdf_mask((dd - 1.0) * 17), BLACK)
    paint(img, sdf_mask((dd - 1.0) * 17 + 2.2), stone)
    return np.clip(img, 0, 1)


# ───────────────────────── Ikon4 5 ─────────────────────────

def build_ikon45():
    spec = CUES["ikon45"]
    L = spec["length"]
    rt = CUE["tipDiameter"] / 2
    rng = np.random.default_rng(45)
    md = C.load_image("white_maple_veneer_diff.jpg")
    mn = C.load_image("white_maple_veneer_nor.jpg", "Non-Color")
    ld = C.load_image("brown_leather_diff.jpg")
    ln = C.load_image("brown_leather_nor.jpg", "Non-Color")
    fore = C.save_image("ikon45_forearm", forearm_texture(rng))
    sleeve = C.save_image("ikon45_sleeve", sleeve_texture(rng))
    ring = C.save_image("ikon45_ring", ring_texture(rng))
    mats = {
        "tip": C.make_material("IkonTip", color=(0.012, 0.014, 0.02), rough=0.9),
        "ivory": C.make_material("IkonIvory", color=(0.80, 0.74, 0.60), rough=0.28, coat=0.6, coat_rough=0.08),
        # maple premium: lebih terang & bersih dari stik lokal, clear coat tipis
        "shaft": C.make_material("IkonShaft", diff=md, nor=mn, rough=0.28, tint=(1.0, 0.95, 0.84), coat=0.6, coat_rough=0.07, normal_strength=0.6),
        "black": C.make_material("IkonBlack", color=(0.01, 0.01, 0.012), rough=0.25, coat=1.0, coat_rough=0.05),
        "steel": C.make_material("IkonSteel", color=(0.7, 0.71, 0.73), rough=0.25, metallic=1.0),
        "forearm": C.make_material("IkonForearm", diff=fore, rough=0.22, coat=1.0, coat_rough=0.04),
        "sleeve": C.make_material("IkonSleeve", diff=sleeve, rough=0.22, coat=1.0, coat_rough=0.04),
        "ring": C.make_material("IkonRing", diff=ring, rough=0.25, coat=1.0, coat_rough=0.05),
        # kulit hitam bertekstur (lizard/elephant ear): butiran kecil, normal kuat
        "wrap": C.make_material("IkonWrap", diff=ld, nor=ln, rough=0.62, tint=(0.018, 0.018, 0.02), uv_scale=(22, 22), normal_strength=3.5),
        "rubber": C.make_material("IkonBumper", color=(0.012, 0.012, 0.013), rough=0.8),
    }
    taper = make_taper(L, rt)

    def seg(a, b, n=6):
        return [(a + (b - a) * i / n, taper(a + (b - a) * i / n)) for i in range(n + 1)]

    def bands(d0, spec_list, lift=0.0):
        """Rangkaian pita silindris pendek berurutan: [(panjang, material)] mulai dari d0."""
        out, d = [], d0
        for length, mat in spec_list:
            out.append((mat, [(d, taper(d) + lift), (d + length, taper(d + length) + lift)]))
            d += length
        return out, d

    parts = [
        ("tip", [(0.0, rt * 0.55), (0.0012, rt * 0.86), (0.0035, rt * 0.99), (0.008, rt)]),
        ("ivory", [(0.008, rt), (0.020, rt)]),  # ferrule pendek (shaft low deflection: ujung ringan)
        ("shaft", seg(0.020, 0.700, 16)),
    ]
    # collar shaft: garis hitam tipis + krem; joint radial (baja hanya di permukaan sambungan)
    b, d = bands(0.700, [(0.0015, "black"), (0.0015, "ivory"), (0.0010, "black"), (0.0195, "ivory"), (0.0010, "black")])
    parts += b
    parts.append(("steel", [(d, taper(d) - 0.0004), (d + 0.0008, taper(d + 0.0008) - 0.0004)]))
    b, d = bands(d + 0.0008, [(0.0010, "black"), (0.0035, "ivory"), (0.0008, "black"), (0.0110, "ivory"), (0.0008, "black"),
                              (0.0035, "ivory"), (0.0015, "black")])
    parts += b
    f0, f1 = d, 1.058
    parts.append(("forearm", seg(f0, f1, 14), (f0, f1)))
    parts.append(("ring", [(f1, taper(f1)), (f1 + 0.014, taper(f1 + 0.014))], (f1, f1 + 0.014)))
    w0, w1 = f1 + 0.014, 1.356
    parts.append(("wrap", seg(w0, w1, 8)))
    parts.append(("ring", [(w1, taper(w1)), (w1 + 0.014, taper(w1 + 0.014))], (w1, w1 + 0.014)))
    s0, s1 = w1 + 0.014, 1.428
    parts.append(("sleeve", seg(s0, s1, 4), (s0, s1)))
    b, d = bands(s1, [(0.0015, "black"), (0.0040, "ivory"), (0.0008, "black"), (0.0015, "ivory"), (0.0008, "black"), (0.0164, "ivory")])
    parts += b
    rb = taper(d)
    parts.append(("rubber", [(d, rb), (L - 0.006, rb * 0.97), (L - 0.001, rb * 0.8), (L, rb * 0.5)]))
    return build_parts(spec["model"], parts, mats, 40)


def build():
    return [build_local(), build_ikon45()]


def studio_preview(obj, out_dir, samples=64):
    """Render studio latar putih (mirip foto produk) → cue_<id>_full.png & cue_<id>_butt.png."""
    import bpy

    import render_util as RU

    world = bpy.data.worlds.new("Studio")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (1, 1, 1, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.35
    for loc, power in (((-0.7, -0.6, 0.8), 25), ((-0.7, 0.6, 0.5), 8)):
        ld = bpy.data.lights.new("Key", "AREA")
        ld.energy = power
        ld.size = 1.2
        ob = bpy.data.objects.new("Key", ld)
        bpy.context.scene.collection.objects.link(ob)
        ob.location = loc
        RU.look_at(ob, (-0.75, 0, 0))
    RU.setup_cycles(samples=samples, res=(1600, 900))
    name = obj.name.replace("Cue_", "")
    RU.render(os.path.join(out_dir, f"cue_{name}_full.png"), RU.add_camera("full", (-0.73, -1.45, 0.28), (-0.73, 0, 0), 50))
    RU.render(os.path.join(out_dir, f"cue_{name}_fore.png"), RU.add_camera("fore", (-0.92, -0.55, 0.12), (-0.92, 0, 0), 55))
    RU.render(os.path.join(out_dir, f"cue_{name}_butt.png"), RU.add_camera("butt", (-1.36, -0.30, 0.09), (-1.40, 0, 0), 60))
    RU.render(os.path.join(out_dir, f"cue_{name}_joint.png"), RU.add_camera("joint", (-0.70, -0.24, 0.07), (-0.74, 0, 0), 60))


if __name__ == "__main__":
    C.reset_scene()
    objs = build()
    print(f"[cue] {C.tri_count(objs)} tris")
    if "--preview" in C.argv_after_dashes():
        objs[0].hide_render = True
        studio_preview(objs[1], os.path.join(C.OUT_DIR, "preview"), samples=int(C.arg_value("--samples", "64")))
    else:
        out = C.arg_value("--out", os.path.join(C.OUT_DIR, "glb"))
        C.export_glb(os.path.join(out, "cue.glb"), objs)
