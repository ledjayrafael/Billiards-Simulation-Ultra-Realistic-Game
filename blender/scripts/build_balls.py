"""10 bola (cue + 1–9): satu mesh sphere per bola, atlas tekstur 4096×2048 dibuat lewat script.
Angka dirasterisasi dari font bawaan Blender (objek teks → mesh → numpy)."""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import numpy as np  # noqa: E402

import common as C  # noqa: E402

COLORS = {
    0: (0.965, 0.955, 0.90),
    1: (0.97, 0.76, 0.04),
    2: (0.035, 0.17, 0.60),
    3: (0.83, 0.07, 0.05),
    4: (0.30, 0.09, 0.47),
    5: (0.96, 0.40, 0.03),
    6: (0.03, 0.38, 0.19),
    7: (0.40, 0.055, 0.06),
    8: (0.022, 0.022, 0.024),
    9: (0.97, 0.76, 0.04),
}
WHITE = (0.965, 0.955, 0.90)
INK = (0.03, 0.03, 0.035)
RED_DOT = (0.80, 0.05, 0.04)
COLS, ROWS = 4, 3
TILE_W, TILE_H = 1024, 682
DISC_ANGLE = math.radians(17.0)
STRIPE_ANGLE = math.radians(33.0)


def glyph_bitmap(text, size=256, underline=False):
    """Rasterisasi teks → bitmap coverage (size×size, 0..1), y ke atas."""
    cu = bpy.data.curves.new("glyph", "FONT")
    cu.body = text
    cu.align_x = "CENTER"
    cu.offset = 0.012  # sedikit ditebalkan
    ob = bpy.data.objects.new("glyph", cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    me = ob.evaluated_get(dg).to_mesh()
    me.calc_loop_triangles()
    verts = np.array([(v.co.x, v.co.y) for v in me.vertices], np.float64)
    tris = np.array([t.vertices[:] for t in me.loop_triangles], np.int32)
    ob.evaluated_get(dg).to_mesh_clear()
    bpy.data.objects.remove(ob, do_unlink=True)
    mn, mx = verts.min(0), verts.max(0)
    ctr = (mn + mx) / 2
    h = mx[1] - mn[1]
    ss = 3
    n = size * ss
    scale = n * 0.74 / h  # tinggi glyph = 74% bitmap
    pts = (verts - ctr) * scale + n / 2
    cov = np.zeros((n, n), np.float32)
    for a, b, c in tris:
        p0, p1, p2 = pts[a], pts[b], pts[c]
        x0, x1 = int(max(0, math.floor(min(p0[0], p1[0], p2[0])))), int(min(n - 1, math.ceil(max(p0[0], p1[0], p2[0]))))
        y0, y1 = int(max(0, math.floor(min(p0[1], p1[1], p2[1])))), int(min(n - 1, math.ceil(max(p0[1], p1[1], p2[1]))))
        if x1 < x0 or y1 < y0:
            continue
        ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1]
        px, py = xs + 0.5, ys + 0.5
        d = (p1[1] - p2[1]) * (p0[0] - p2[0]) + (p2[0] - p1[0]) * (p0[1] - p2[1])
        if abs(d) < 1e-12:
            continue
        w0 = ((p1[1] - p2[1]) * (px - p2[0]) + (p2[0] - p1[0]) * (py - p2[1])) / d
        w1 = ((p2[1] - p0[1]) * (px - p2[0]) + (p0[0] - p2[0]) * (py - p2[1])) / d
        inside = (w0 >= 0) & (w1 >= 0) & (w0 + w1 <= 1)
        cov[y0:y1 + 1, x0:x1 + 1][inside] = 1.0
    if underline:
        w = (mx[0] - mn[0]) * scale
        yb = int(n / 2 - 0.37 * n - 0.075 * n)
        cov[yb:yb + int(0.035 * n), int(n / 2 - w * 0.42):int(n / 2 + w * 0.42)] = 1.0
    return cov.reshape(size, ss, size, ss).mean((1, 3))


def sample_bitmap(bmp, u, v):
    """Bilinear; u,v ∈ [0,1] (v ke atas); di luar → 0."""
    n = bmp.shape[0]
    x = u * n - 0.5
    y = v * n - 0.5
    x0 = np.floor(x).astype(np.int32)
    y0 = np.floor(y).astype(np.int32)
    fx, fy = x - x0, y - y0
    out = np.zeros_like(u, np.float32)
    for dy in (0, 1):
        for dx in (0, 1):
            xi, yi = x0 + dx, y0 + dy
            ok = (xi >= 0) & (xi < n) & (yi >= 0) & (yi < n)
            w = (fx if dx else 1 - fx) * (fy if dy else 1 - fy)
            out[ok] += (bmp[yi[ok], xi[ok]] * w[ok]).astype(np.float32)
    return out


def ball_tile(num):
    ss = 2
    w, h = TILE_W * ss, TILE_H * ss
    v, u = np.mgrid[0:h, 0:w].astype(np.float32)
    lon = (u + 0.5) / w * 2 * np.pi
    lat = (0.5 - (v + 0.5) / h) * np.pi  # baris 0 = kutub utara
    d = np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], axis=2)
    col = np.empty((h, w, 3), np.float32)

    def smooth(edge, x, aa):
        return np.clip((edge - x) / aa + 0.5, 0, 1)

    aa = 1.6 * np.pi / h
    if num == 0:
        col[:] = WHITE
        dot = math.radians(2.7)
        for axis in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)):
            ang = np.arccos(np.clip(d @ np.array(axis, np.float32), -1, 1))
            m = smooth(dot, ang, aa)[..., None]
            col[:] = col * (1 - m) + np.array(RED_DOT, np.float32) * m
    else:
        base = np.array(COLORS[num], np.float32)
        if num >= 9:
            m = smooth(STRIPE_ANGLE, np.abs(lat), aa)[..., None]
            col[:] = np.array(WHITE, np.float32) * (1 - m) + base * m
        else:
            col[:] = base
        bmp = glyph_bitmap(str(num), 256, underline=num in (6, 9))
        for lon_c in (np.pi / 2, 3 * np.pi / 2):
            c = np.array([math.cos(lon_c), math.sin(lon_c), 0], np.float32)
            e = np.array([-math.sin(lon_c), math.cos(lon_c), 0], np.float32)
            cosang = np.clip(d @ c, -1, 1)
            ang = np.arccos(cosang)
            m = smooth(DISC_ANGLE, ang, aa)[..., None]
            col[:] = col * (1 - m) + np.array(WHITE, np.float32) * m
            # koordinat lokal pada cakram (proyeksi azimutal sama-jarak)
            k = np.where(ang > 1e-6, ang / np.maximum(np.sin(ang), 1e-6), 1.0)
            px = (d @ e) * k / DISC_ANGLE
            py = d[..., 2] * k / DISC_ANGLE
            g = sample_bitmap(bmp, px * 0.5 + 0.5, py * 0.5 + 0.5) * (ang < DISC_ANGLE)
            col[:] = col * (1 - g[..., None]) + np.array(INK, np.float32) * g[..., None]
    return col.reshape(TILE_H, ss, TILE_W, ss, 3).mean((1, 3))


def build_atlas():
    atlas = np.zeros((ROWS * TILE_H + 2, COLS * TILE_W, 3), np.float32)
    for n in range(10):
        r, c = divmod(n, COLS)
        atlas[r * TILE_H:(r + 1) * TILE_H, c * TILE_W:(c + 1) * TILE_W] = ball_tile(n)
    # tinggi 2048 (2 baris sisa di bawah)
    return C.save_image("balls_atlas", atlas)


def build(positions=None):
    """Bangun 10 bola di origin (atau di positions[id] = (x, y)). Mengembalikan list objek."""
    img = build_atlas()
    mat = C.make_material("BallResin", rough=0.07, diff=img, coat=1.0, coat_rough=0.025, ior=1.55)
    atlas_h = ROWS * TILE_H + 2
    objs = []
    for n in range(10):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=C.BALL_R, location=(0, 0, 0))
        ob = bpy.context.active_object
        ob.name = f"Ball_{n}"
        ob.data.name = f"Ball_{n}"
        for p in ob.data.polygons:
            p.use_smooth = True
        r, c = divmod(n, COLS)
        # UV equirect dihitung dari posisi vertex (u = bujur, v = lintang), aman di seam & kutub
        me = ob.data
        uv = me.uv_layers.active.data
        iu, iv = 0.5 / TILE_W, 0.5 / TILE_H  # inset setengah texel agar tidak bleeding antar tile
        for poly in me.polygons:
            cu = (math.atan2(poly.center.y, poly.center.x) / (2 * math.pi)) % 1.0
            for li in poly.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                if abs(co.x) < 1e-7 and abs(co.y) < 1e-7:
                    u = cu
                else:
                    u = (math.atan2(co.y, co.x) / (2 * math.pi)) % 1.0
                    if u - cu > 0.5:
                        u -= 1.0
                    elif cu - u > 0.5:
                        u += 1.0
                u = min(1.0, max(0.0, u))
                v = math.asin(max(-1.0, min(1.0, co.z / C.BALL_R))) / math.pi + 0.5
                u = iu + u * (1 - 2 * iu)
                v = iv + v * (1 - 2 * iv)
                uv[li].uv = ((c + u) / COLS, 1 - ((r + (1 - v)) * TILE_H) / atlas_h)
        C.assign(ob, mat)
        if positions and n in positions:
            ob.location = (positions[n][0], positions[n][1], C.BALL_R)
        objs.append(ob)
    return objs


if __name__ == "__main__":
    C.reset_scene()
    objs = build()
    print(f"[balls] {C.tri_count(objs)} tris")
    out = C.arg_value("--out", os.path.join(C.OUT_DIR, "glb"))
    C.export_glb(os.path.join(out, "balls.glb"), objs)
