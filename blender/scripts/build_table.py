"""Meja 9 ft: slate + kain, cushion profil K-66, rail kayu + diamond, pocket (liner + kantong), bodi & kaki.
Semua dimensi dari blender/specs.json; geometri cushion/pocket identik dengan mesin fisika."""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

import common as C  # noqa: E402
from common import T  # noqa: E402

CLOTH_TILE = 0.06  # meter per pengulangan tekstur kain
WOOD_TILE = 0.9
CLOTH_RGB = (0.045, 0.30, 0.54)  # biru petrol (sRGB)
CLOTH_NEUTRAL = (0.62, 0.62, 0.62)  # meja pro: diwarnai per arena di client


def cloth_textures(rgb=CLOTH_RGB, tag="cloth"):
    """Tekstur kain worsted prosedural: variasi serat halus + normal map tenunan twill."""
    n = 512
    rng = np.random.default_rng(9)
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    # tenunan twill diagonal (periodik → tileable)
    f = 2 * np.pi / n
    threads = 64
    weave = 0.5 * np.sin((x + y) * f * threads) + 0.35 * np.sin((x - 2 * y) * f * threads * 0.5)
    fiber = rng.standard_normal((n, n)).astype(np.float32)
    # noise frekuensi rendah tileable (jumlah sinus acak)
    low = np.zeros((n, n), np.float32)
    for _ in range(24):
        kx, ky = rng.integers(1, 7, 2)
        low += np.sin(f * (kx * x + ky * y) + rng.uniform(0, 6.28)) * rng.uniform(0.3, 1) / math.hypot(kx, ky)
    low /= np.abs(low).max()
    height = weave * 0.6 + fiber * 0.35
    gx = np.roll(height, -1, 1) - np.roll(height, 1, 1)
    gy = np.roll(height, -1, 0) - np.roll(height, 1, 0)
    s = 0.55
    nx, ny, nz = -gx * s, gy * s, np.ones_like(gx)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nor = np.stack([nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5, nz / ln * 0.5 + 0.5], axis=2)
    shade = 1.0 + 0.045 * weave + 0.05 * fiber + 0.035 * low
    diff = np.clip(np.stack([rgb[i] * shade for i in range(3)], axis=2), 0, 1)
    return C.save_image(f"{tag}_diff", diff), C.save_image(f"{tag}_nor", nor, "Non-Color")


def materials(style="classic", cloth_rgb=None):
    if cloth_rgb is not None:
        # hanya untuk bake arena: warna kain mendekati hasil akhir di client agar pantulan cahaya benar
        cd, cn = cloth_textures(cloth_rgb, "cloth_bake")
    elif style == "pro":
        # kain netral (abu terang): warna akhir per arena diberikan client lewat material.color
        cd, cn = cloth_textures(CLOTH_NEUTRAL, "cloth_neutral")
    else:
        cd, cn = cloth_textures()
    m = {}
    m["cloth"] = C.make_material("Cloth", rough=0.92, diff=cd, nor=cn, normal_strength=0.6, sheen=0.35, sheen_rough=0.45)
    wd = C.load_image("walnut_veneer_02_diff.jpg")
    wn = C.load_image("walnut_veneer_02_nor.jpg", "Non-Color")
    wr = C.load_image("walnut_veneer_02_rough.jpg", "Non-Color")
    m["wood"] = C.make_material("RailWood", diff=wd, nor=wn, rough_img=wr, tint=(0.42, 0.25, 0.16), coat=0.6, coat_rough=0.12)
    m["body"] = C.make_material("BodyLacquer", color=(0.018, 0.019, 0.022), rough=0.38, coat=0.3, coat_rough=0.2)
    m["pearl"] = C.make_material("Pearl", color=(0.86, 0.87, 0.82), rough=0.18, coat=1.0, coat_rough=0.05)
    ld = C.load_image("brown_leather_diff.jpg")
    ln = C.load_image("brown_leather_nor.jpg", "Non-Color")
    m["leather"] = C.make_material("PocketLeather", diff=ld, nor=ln, rough=0.55, tint=(0.07, 0.06, 0.055), uv_scale=(6, 6))
    m["metal"] = C.make_material("Brass", color=(0.78, 0.6, 0.3), rough=0.28, metallic=1.0)
    m["dark"] = C.make_material("PocketDark", color=(0.006, 0.006, 0.007), rough=0.9)
    if style == "pro":
        # meja turnamen: rail & bodi hitam satin, diamond putih, tanpa trim kuningan
        m["wood"] = C.make_material("RailBlack", color=(0.01, 0.01, 0.012), rough=0.55, coat=0.12, coat_rough=0.3)
        m["body"] = C.make_material("BodyLacquer", color=(0.014, 0.014, 0.016), rough=0.5, coat=0.15, coat_rough=0.3)
        m["pearl"] = C.make_material("Pearl", color=(0.9, 0.9, 0.88), rough=0.3)
        m["leather"] = C.make_material("PocketLeather", color=(0.02, 0.02, 0.022), rough=0.6)
    return m


def rect(hx, hy):
    return [(hx, hy), (-hx, hy), (-hx, -hy), (hx, -hy)]


def cushion_section():
    """Penampang cushion (d = jarak dari nose ke arah rail, z). Nose di d = 0, tinggi ≈ 0.0363."""
    cw, top = T["cushionWidth"], T["cushionTopHeight"]
    h = T["cushionNoseHeight"]
    return [
        (cw, 0.0), (0.034, 0.0), (0.020, 0.011), (0.0065, 0.027), (0.0012, h - 0.0032),
        (0.0, h - 0.0012), (0.0, h + 0.0012), (0.0015, h + 0.0027), (0.007, h + 0.0036), (cw, top),
    ]


def build_cushion(idx, cu):
    sec = cushion_section()
    ns = len(sec)
    bm = bmesh.new()
    ax, ay = cu["a"]
    bx, by = cu["b"]
    ring_a, ring_b = [], []
    for d, z in sec:
        sa, sb = d / cu["sinA"], d / cu["sinB"]
        ring_a.append(bm.verts.new((ax + cu["jA"][0] * sa, ay + cu["jA"][1] * sa, z)))
        ring_b.append(bm.verts.new((bx + cu["jB"][0] * sb, by + cu["jB"][1] * sb, z)))
    for i in range(ns):
        j = (i + 1) % ns
        bm.faces.new((ring_a[i], ring_a[j], ring_b[j], ring_b[i]))
    bm.faces.new(ring_a)
    bm.faces.new(list(reversed(ring_b)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    obj = C.obj_from_bmesh(f"Cushion_{idx}", bm)
    C.bevel(obj, 0.0016, 2, 50)
    C.shade_smooth(obj, 40)
    C.box_uv(obj, 1 / CLOTH_TILE)
    return obj


def liner(idx, pocket, r_cut, zt):
    """Kerah karet/kulit di tepi lubang pocket pada rail."""
    cx, cy, rp, corner = pocket
    hl, hw, cw = T["length"] / 2, T["width"] / 2, T["cushionWidth"]
    seg = 120

    def in_rail(a):
        x, y = cx + r_cut * math.cos(a), cy + r_cut * math.sin(a)
        if corner:
            return abs(x) > hl + cw + 0.004 or abs(y) > hw + cw + 0.004
        return abs(y) > hw + cw + 0.004

    flags = [in_rail(2 * math.pi * i / seg) for i in range(seg)]
    start = next(i for i in range(seg) if flags[i] and not flags[i - 1])
    angles = []
    i = start
    while flags[i % seg]:
        angles.append(2 * math.pi * i / seg)
        i += 1
    # penampang (r, z): dinding dalam → kubah atas → bibir luar di atas rail
    r0, r1 = rp - 0.0015, r_cut + 0.0075
    prof = [(r0, -0.04), (r0, zt - 0.001), (r0 + 0.0015, zt + 0.0022), (r0 + 0.005, zt + 0.0034),
            (r1 - 0.004, zt + 0.0034), (r1 - 0.001, zt + 0.0022), (r1, zt + 0.0002), (r1, zt - 0.004), (r_cut, zt - 0.004), (r_cut, -0.04)]
    bm = bmesh.new()
    rings = []
    for a in angles:
        rings.append([bm.verts.new((cx + r * math.cos(a), cy + r * math.sin(a), z)) for r, z in prof])
    np_ = len(prof)
    for k in range(len(rings) - 1):
        for i in range(np_):
            j = (i + 1) % np_
            bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    obj = C.obj_from_bmesh(f"Pocket_Liner_{idx}", bm)
    C.shade_smooth(obj, 50)
    C.box_uv(obj, 1.0)
    return obj


def cup(idx, pocket, r):
    """Kantong pocket: silinder terbuka di atas, normal menghadap ke dalam."""
    cx, cy = pocket[0], pocket[1]
    seg = 40
    z0, z1 = -0.19, -0.001
    bm = bmesh.new()
    top = [bm.verts.new((cx + r * math.cos(2 * math.pi * i / seg), cy + r * math.sin(2 * math.pi * i / seg), z1)) for i in range(seg)]
    bot = [bm.verts.new((cx + r * 0.8 * math.cos(2 * math.pi * i / seg), cy + r * 0.8 * math.sin(2 * math.pi * i / seg), z0)) for i in range(seg)]
    for i in range(seg):
        j = (i + 1) % seg
        bm.faces.new((top[i], top[j], bot[j], bot[i]))  # menghadap ke dalam
    bm.faces.new(bot)
    bm.normal_update()
    # pastikan normal dasar menghadap ke atas
    for f in bm.faces:
        if len(f.verts) > 4 and f.normal.z < 0:
            f.normal_flip()
    obj = C.obj_from_bmesh(f"Pocket_Cup_{idx}", bm)
    C.shade_smooth(obj, 60)
    C.box_uv(obj, 1.0)
    return obj


def diamond_positions():
    hl, hw = T["length"] / 2, T["width"] / 2
    off = T["cushionWidth"] + T["railWidth"] * 0.5
    pts = []
    nl, nsh = T["diamondsLong"], T["diamondsShort"]
    for i in range(1, nl + 1):
        x = -hl + i * T["length"] / (nl + 1)
        if abs(x) < 1e-6:
            continue  # posisi side pocket
        pts += [(x, hw + off, 0), (x, -hw - off, 0)]
    for i in range(1, nsh + 1):
        y = -hw + i * T["width"] / (nsh + 1)
        pts += [(hl + off, y, 90), (-hl - off, y, 90)]
    return pts


def build(style="classic", cloth_rgb=None):
    """Bangun meja di scene aktif. style: "classic" (rail kayu) | "pro" (meja turnamen hitam). Mengembalikan list objek."""
    hl, hw = T["length"] / 2, T["width"] / 2
    cw, rw, zt = T["cushionWidth"], T["railWidth"], T["railHeight"]
    slate = T["slateThickness"]
    cushions, pockets = C.table_geometry()
    M = materials(style, cloth_rgb)
    pro = style == "pro"
    objs = []

    def cutters(radius_extra, seg=72):
        out = []
        for cx, cy, r, _ in pockets:
            out.append(C.prism("cut", C.circle_pts(cx, cy, r + radius_extra, seg), -1, 1))
        return out

    def cut_all(obj, cs):
        for c in cs:
            C.boolean(obj, c)
            bpy.data.objects.remove(c, do_unlink=True)

    # 1. slate + kain
    bed = C.prism("Table_Cloth", rect(hl + cw + 0.004, hw + cw + 0.004), -slate, 0.0)
    cut_all(bed, cutters(0.0))
    C.bevel(bed, 0.0022, 3, 60)  # tepi lubang pocket membulat (kain melipat ke dalam)
    C.shade_smooth(bed, 45)
    C.box_uv(bed, 1 / CLOTH_TILE)
    C.assign(bed, M["cloth"])
    objs.append(bed)

    # 2. cushion
    for i, cu in enumerate(cushions):
        o = build_cushion(i, cu)
        C.assign(o, M["cloth"])
        objs.append(o)

    # 3. rail kayu
    hx, hy = hl + cw + rw, hw + cw + rw
    zb = -0.062
    rail = C.prism("Table_Rail", C.rounded_rect(hx, hy, 0.03 if pro else 0.085, 10), zb, zt)
    inner = C.prism("cut", rect(hl + cw, hw + cw), -1, 1)
    C.boolean(rail, inner)
    bpy.data.objects.remove(inner, do_unlink=True)
    r_extra = 0.004
    cut_all(rail, cutters(r_extra))
    # potong miter di sudut supaya arah serat kayu mengikuti tiap rail
    bm = bmesh.new()
    bm.from_mesh(rail.data)
    k = hl - hw
    for no, d in (((1, -1, 0), k), ((1, -1, 0), -k), ((1, 1, 0), k), ((1, 1, 0), -k)):
        nv = Vector(no).normalized()
        co = nv * (d / math.sqrt(2))
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=nv, clear_inner=False, clear_outer=False)
    bm.to_mesh(rail.data)
    bm.free()
    C.bevel(rail, 0.007, 4, 50)
    C.shade_smooth(rail, 40)
    C.box_uv(rail, 1 / WOOD_TILE, lambda c, n: (abs(c.x) - hl) > (abs(c.y) - hw))
    C.assign(rail, M["wood"])
    objs.append(rail)

    # 4. diamond (mother-of-pearl)
    bm = bmesh.new()
    for x, y, rot in diamond_positions():
        a, b = 0.0085, 0.0048  # setengah panjang (melintang rail), setengah lebar
        pts = [(0, a), (-b, 0), (0, -a), (b, 0)] if rot == 0 else [(a, 0), (0, b), (-a, 0), (0, -b)]
        bm.faces.new([bm.verts.new((x + px, y + py, zt + 0.0003)) for px, py in pts])
    sights = C.obj_from_bmesh("Table_Diamonds", bm)
    C.box_uv(sights, 1.0)
    C.assign(sights, M["pearl"])
    objs.append(sights)

    # 5. pocket: liner + kantong
    liners, cups = [], []
    for i, p in enumerate(pockets):
        liners.append(liner(i, p, p[2] + r_extra, zt))
        cups.append(cup(i, p, p[2] + r_extra + 0.001))
    for o in liners:
        C.assign(o, M["leather"])
    for o in cups:
        C.assign(o, M["dark"])
    objs.append(C.join(liners, "Pocket_Liners"))
    objs.append(C.join(cups, "Pocket_Cups"))

    # 6. bodi: apron, panel bawah, kaki
    body_parts = []
    if pro:
        # bodi kotak tebal + 4 kaki persegi (gaya meja turnamen)
        floor_z = -T["surfaceHeight"]
        ap = C.prism("apron", C.rounded_rect(hx - 0.012, hy - 0.012, 0.025, 4), -0.30, zb)
        cut_all(ap, cutters(0.008, 40))
        C.bevel(ap, 0.005, 2, 50)
        body_parts.append(ap)
        band = C.prism("band", C.rounded_rect(hx - 0.06, hy - 0.06, 0.02, 4), -0.36, -0.30)
        body_parts.append(band)
        lx, ly, ls = hx - 0.26, hy - 0.2, 0.085
        for sx in (-1, 1):
            for sy in (-1, 1):
                leg = C.prism("leg", C.rounded_rect(ls, ls, 0.012, 3), floor_z + 0.02, -0.36)
                leg.location = (sx * lx, sy * ly, 0)
                bpy.context.view_layer.update()
                C.bevel(leg, 0.004, 2, 50)
                body_parts.append(leg)
                foot = C.prism("foot", C.rounded_rect(ls + 0.01, ls + 0.01, 0.015, 3), floor_z, floor_z + 0.02)
                foot.location = (sx * lx, sy * ly, 0)
                bpy.context.view_layer.update()
                body_parts.append(foot)
    else:
        ap = C.prism("apron", C.rounded_rect(hx - 0.022, hy - 0.022, 0.07, 8), -0.235, zb)
        cut_all(ap, cutters(0.008, 40))  # ruang untuk kantong pocket
        C.bevel(ap, 0.006, 3, 50)
        body_parts.append(ap)
        floor_z = -T["surfaceHeight"]
        for sx in (-1, 1):
            # pedestal trapesium melintang
            x0 = sx * 0.78
            top_w, bot_w = hy - 0.12, hy - 0.26
            th_top, th_bot = 0.11, 0.075
            bm = bmesh.new()
            vt = [bm.verts.new((x0 + dx, dy, -0.235)) for dx, dy in ((th_top, top_w), (-th_top, top_w), (-th_top, -top_w), (th_top, -top_w))]
            vb = [bm.verts.new((x0 + dx, dy, floor_z + 0.045)) for dx, dy in ((th_bot, bot_w), (-th_bot, bot_w), (-th_bot, -bot_w), (th_bot, -bot_w))]
            bm.faces.new(vt)
            bm.faces.new(list(reversed(vb)))
            for i in range(4):
                j = (i + 1) % 4
                bm.faces.new((vb[i], vb[j], vt[j], vt[i]))
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
            leg = C.obj_from_bmesh("leg", bm)
            C.bevel(leg, 0.012, 3, 50)
            body_parts.append(leg)
            foot = C.prism("foot", C.rounded_rect(0.12, bot_w + 0.03, 0.03, 6), floor_z, floor_z + 0.045)
            foot.location.x = x0
            bpy.context.view_layer.update()
            C.bevel(foot, 0.006, 2, 50)
            body_parts.append(foot)
        beam = C.prism("beam", rect(0.78, 0.045), floor_z + 0.2, floor_z + 0.32)
        C.bevel(beam, 0.008, 2, 50)
        body_parts.append(beam)
    body = C.join(body_parts, "Table_Body")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    C.shade_smooth(body, 40)
    C.box_uv(body, 1.0)
    C.assign(body, M["body"])
    objs.append(body)

    if pro:
        return objs
    # garis kuningan tipis di bawah rail
    trim = C.prism("Table_Trim", C.rounded_rect(hx - 0.016, hy - 0.016, 0.075, 8), zb - 0.006, zb + 0.001)
    cut_all(trim, cutters(0.008, 40))
    C.box_uv(trim, 1.0)
    C.shade_smooth(trim, 40)
    C.assign(trim, M["metal"])
    objs.append(trim)
    return objs


if __name__ == "__main__":
    C.reset_scene()
    objs = build()
    print(f"[table] {C.tri_count(objs)} tris")
    out = C.arg_value("--out", os.path.join(C.OUT_DIR, "glb"))
    C.export_glb(os.path.join(out, "table.glb"), objs)
