"""Arena turnamen orisinal (tanpa logo/teks): "red" (aula hotel bernuansa merah) dan "blue" (arena tribun bernuansa biru).
Origin = tengah permukaan kain meja. Struktur keluaran sama dengan build_room.build() agar pipeline bake/ekspor
dapat dipakai ulang. Gunakan `Arena(kind)`: atribut RX, RY, FLOOR_Z, CEIL_Z, LAMP_X, LAMP_Z, LAMP_POWER,
SPOT_SIZE_DEG, SPOT_BLEND, LAMP_COLOR, plus build() / build_lights() / build_bake_lights()."""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

import common as C  # noqa: E402
import render_util as RU  # noqa: E402
from common import T  # noqa: E402

FLOOR_Z = -T["surfaceHeight"]


# ───────────────────────── geometri dasar ─────────────────────────

def box(name, x0, x1, y0, y1, z0, z1, bevel=0.0):
    ob = C.prism(name, [(x1, y1), (x0, y1), (x0, y0), (x1, y0)], z0, z1)
    if bevel > 0:
        C.bevel(ob, bevel, 2, 50)
    return ob


def cbox(name, cx, cy, cz, sx, sy, sz, bevel=0.0):
    return box(name, cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2, cz - sz / 2, cz + sz / 2, bevel)


def quad(name, pts, uvs=((0, 0), (1, 0), (1, 1), (0, 1))):
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(p) for p in pts])
    ob = C.obj_from_bmesh(name, bm)
    uv = ob.data.uv_layers.new(name="UVMap")
    for li, st in enumerate(uvs):
        uv.data[li].uv = st
    return ob


def face_toward(ob, target):
    """Balik poligon yang membelakangi titik target (koordinat dunia = lokal, tanpa transform)."""
    tv = Vector(target)
    for p in ob.data.polygons:
        if p.normal.dot(tv - p.center) < 0:
            p.flip()
    ob.data.update()
    return ob


def bar(name, p0, p1, r):
    """Batang penampang persegi (sisi 2r) dari p0 ke p1."""
    p0, p1 = Vector(p0), Vector(p1)
    d = (p1 - p0).normalized()
    a = d.cross(Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))).normalized()
    b = d.cross(a).normalized()
    bm = bmesh.new()
    ring0 = [bm.verts.new(p0 + (a * sa + b * sb) * r) for sa, sb in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    ring1 = [bm.verts.new(p1 + (a * sa + b * sb) * r) for sa, sb in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((ring0[i], ring0[j], ring1[j], ring1[i]))
    bm.faces.new(list(reversed(ring0)))
    bm.faces.new(ring1)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return C.obj_from_bmesh(name, bm)


def truss(p0, p1, z, w=0.3, r=0.022):
    """Rangka truss kotak (4 chord + diagonal zig-zag di 4 sisi) sepanjang p0→p1 (2D) pada ketinggian pusat z."""
    p0, p1 = Vector((p0[0], p0[1], z)), Vector((p1[0], p1[1], z))
    d = (p1 - p0)
    ln = d.length
    d.normalize()
    side = d.cross(Vector((0, 0, 1))).normalized()
    up = Vector((0, 0, 1))
    h = w / 2
    corners = [side * h + up * h, -side * h + up * h, -side * h - up * h, side * h - up * h]
    parts = [bar("chord", p0 + c, p1 + c, r) for c in corners]
    n = max(2, int(ln / w))
    for k in range(n):
        t0, t1 = p0 + d * (ln * k / n), p0 + d * (ln * (k + 1) / n)
        for i in range(4):
            ca, cb = corners[i], corners[(i + 1) % 4]
            a, b = (ca, cb) if k % 2 == 0 else (cb, ca)
            parts.append(bar("diag", t0 + a, t1 + b, r * 0.45))
    return parts


def disk(name, center, normal, radius, seg=20):
    c, n = Vector(center), Vector(normal).normalized()
    a = n.cross(Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))).normalized()
    b = n.cross(a)
    bm = bmesh.new()
    vs = [bm.verts.new(c + (a * math.cos(2 * math.pi * i / seg) + b * math.sin(2 * math.pi * i / seg)) * radius) for i in range(seg)]
    f = bm.faces.new(vs)
    f.normal_update()
    if f.normal.dot(n) < 0:
        f.normal_flip()
    ob = C.obj_from_bmesh(name, bm)
    C.box_uv(ob, 1.0)
    return ob


def cylinder(name, center, normal, radius, length, seg=16):
    c, n = Vector(center), Vector(normal).normalized()
    a = n.cross(Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))).normalized()
    b = n.cross(a)
    bm = bmesh.new()
    r0 = [bm.verts.new(c + (a * math.cos(2 * math.pi * i / seg) + b * math.sin(2 * math.pi * i / seg)) * radius) for i in range(seg)]
    r1 = [bm.verts.new(v.co + n * length) for v in r0]
    for i in range(seg):
        j = (i + 1) % seg
        bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
    bm.faces.new(list(reversed(r0)))
    bm.faces.new(r1)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = C.obj_from_bmesh(name, bm)
    C.shade_smooth(ob, 50)
    return ob


# ───────────────────────── tekstur prosedural (orisinal, tanpa teks) ─────────────────────────

def tileable_noise(n, seed, octaves=24, kmax=9):
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    f = 2 * np.pi / n
    out = np.zeros((n, n), np.float32)
    for _ in range(octaves):
        kx, ky = rng.integers(1, kmax, 2)
        out += np.sin(f * (kx * x + ky * y) + rng.uniform(0, 6.28)) * rng.uniform(0.3, 1) / math.hypot(kx, ky)
    return out / np.abs(out).max()


def carpet_red():
    """Karpet aula: dasar cokelat-merah dengan motif bintang 8 sudut krem & ornamen merah (pola orisinal, tileable)."""
    n = 1024
    rng = np.random.default_rng(5)
    y, x = (np.mgrid[0:n, 0:n].astype(np.float32) + 0.5) / n
    base = np.array([0.30, 0.15, 0.13], np.float32)
    img = np.empty((n, n, 3), np.float32)
    img[:] = base
    low = tileable_noise(n, 3)
    img *= (1 + 0.12 * low)[..., None]

    def star(cx, cy, R, k=8, sharp=0.55):
        dx = (x - cx + 0.5) % 1 - 0.5
        dy = (y - cy + 0.5) % 1 - 0.5
        r = np.sqrt(dx * dx + dy * dy)
        th = np.arctan2(dy, dx)
        return r < R * (sharp + (1 - sharp) * np.abs(np.cos(th * k / 2)) ** 3)

    cream = np.array([0.80, 0.70, 0.60], np.float32)
    red = np.array([0.62, 0.12, 0.10], np.float32)
    dark = np.array([0.18, 0.08, 0.07], np.float32)
    # bintang besar di grid 2×2, ornamen kecil di antaranya
    for cx in (0.25, 0.75):
        for cy in (0.25, 0.75):
            img[star(cx, cy, 0.11, 8, 0.3)] = cream
            img[star(cx, cy, 0.05, 8, 0.45)] = red
            img[star(cx, cy, 0.018, 4, 0.6)] = cream
    for cx, cy in ((0.0, 0.0), (0.5, 0.5), (0.0, 0.5), (0.5, 0.0)):
        img[star(cx, cy, 0.075, 4, 0.25)] = red
        img[star(cx, cy, 0.03, 4, 0.5)] = dark
    # sebaran bunga kecil
    for _ in range(26):
        cx, cy = rng.uniform(0, 1, 2)
        img[star(cx, cy, rng.uniform(0.012, 0.022), 6, 0.35)] = cream * rng.uniform(0.8, 1.0)
    img *= 1 + 0.06 * rng.standard_normal((n, n, 1)).astype(np.float32)
    return C.save_image("carpet_red", np.clip(img, 0, 1))


def carpet_plain(name, rgb, seed):
    n = 512
    rng = np.random.default_rng(seed)
    low = tileable_noise(n, seed)
    img = np.empty((n, n, 3), np.float32)
    img[:] = np.array(rgb, np.float32)
    img *= (1 + 0.1 * low)[..., None]
    img *= 1 + 0.08 * rng.standard_normal((n, n, 1)).astype(np.float32)
    return C.save_image(name, np.clip(img, 0, 1))


def gradient_image(name, top, bottom, w=64, h=256, glow=None):
    """Gradien vertikal polos (opsional sorot lembut di tengah). Untuk papan LED / layar tanpa konten."""
    t = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    img = np.array(top, np.float32) * (1 - t) + np.array(bottom, np.float32) * t
    img = np.repeat(img, w, axis=1)
    if glow is not None:
        y, x = np.mgrid[0:h, 0:w].astype(np.float32)
        r = np.sqrt(((x / w) - 0.5) ** 2 * 2.2 + ((y / h) - 0.45) ** 2)
        img = img + np.array(glow, np.float32) * np.exp(-r * r * 9)[..., None]
    return C.save_image(name, np.clip(img, 0, 1))


def barrier_image():
    """Panel pembatas: pita biru tua di atas, putih, pita merah di bawah (polos)."""
    h, w = 256, 64
    img = np.empty((h, w, 3), np.float32)
    v = np.linspace(0, 1, h)[:, None]
    img[:] = (0.86, 0.87, 0.89)
    img[(v < 0.14).repeat(w, 1)] = (0.03, 0.06, 0.20)
    img[((v > 0.72) & (v < 0.80)).repeat(w, 1)] = (0.05, 0.12, 0.42)
    img[(v >= 0.80).repeat(w, 1)] = (0.55, 0.05, 0.07)
    return C.save_image("barrier_panel", img)


# ───────────────────────── arena ─────────────────────────

class Arena:
    def __init__(self, kind):
        assert kind in ("red", "blue")
        self.kind = kind
        self.FLOOR_Z = FLOOR_Z
        if kind == "red":
            self.RX, self.RY, self.CEIL_Z = 9.0, 7.0, 5.2
            self.LAMP_Z = 1.12
        else:
            self.RX, self.RY, self.CEIL_Z = 10.0, 8.0, 6.0
            self.LAMP_Z = 1.18
        self.LAMP_X = (-0.8, 0.0, 0.8)
        # light bank lebih tinggi dari lampu gantung privat → daya dinaikkan (iluminansi ∝ 1/d²)
        self.LAMP_POWER = 42.0 * (self.LAMP_Z / 0.86) ** 2
        self.SPOT_SIZE_DEG = 118.0
        self.SPOT_BLEND = 0.5
        self.LAMP_COLOR = (0.96, 0.98, 1.0)  # putih dingin ±5600K
        # warna kain (sRGB) saat bake, ≈ hasil tint client (apps/client/src/render/arenas.ts)
        self.CLOTH_BAKE_RGB = (0.22, 0.28, 0.38) if kind == "red" else (0.36, 0.34, 0.30)
        self._bake_lights = []

    # ── material ──
    def materials(self):
        m = {}
        red = self.kind == "red"
        if red:
            m["floor"] = C.make_material("Floor", diff=carpet_red(), rough=0.95)
            pd = C.load_image("plastered_wall_04_diff.jpg")
            pn = C.load_image("plastered_wall_04_nor.jpg", "Non-Color")
            m["wall"] = C.make_material("Wall", diff=pd, nor=pn, rough=0.85, tint=(0.46, 0.40, 0.34))
            m["pilaster"] = C.make_material("Pilaster", color=(0.16, 0.11, 0.08), rough=0.5)
            m["ceiling"] = C.make_material("Ceiling", color=(0.03, 0.025, 0.025), rough=0.95)
        else:
            m["floor"] = C.make_material("Floor", diff=carpet_plain("carpet_navy", (0.06, 0.08, 0.16), 7), rough=0.95)
            pd = C.load_image("plastered_wall_04_diff.jpg")
            pn = C.load_image("plastered_wall_04_nor.jpg", "Non-Color")
            m["wall"] = C.make_material("Wall", diff=pd, nor=pn, rough=0.9, tint=(0.07, 0.075, 0.09))
            m["pilaster"] = C.make_material("Pilaster", color=(0.03, 0.03, 0.035), rough=0.6)
            m["ceiling"] = C.make_material("Ceiling", color=(0.015, 0.015, 0.02), rough=0.95)
            m["seat"] = C.make_material("SeatFabric", color=(0.04, 0.05, 0.1), rough=0.85)
            m["armchair"] = C.make_material("ArmchairFabric", color=(0.16, 0.16, 0.17), rough=0.8)
            m["barrier"] = C.make_material("BarrierPanel", diff=barrier_image(), rough=0.6, tint=(0.72, 0.74, 0.8))
            m["riser"] = C.make_material("Riser", color=(0.025, 0.025, 0.03), rough=0.8)
        m["truss"] = C.make_material("TrussMetal", color=(0.7, 0.7, 0.72), rough=0.35, metallic=1.0)
        m["black"] = C.make_material("BlackMetal", color=(0.015, 0.015, 0.017), rough=0.45, metallic=0.6)
        m["matte"] = C.make_material("MatteBlack", color=(0.02, 0.02, 0.022), rough=0.8)
        m["frame"] = C.make_material("LightFrame", color=(0.02, 0.02, 0.022), rough=0.5, metallic=0.8)
        m["panel"] = C.make_material("LightPanel", color=(1, 1, 1), rough=0.5, emission=(0.96, 0.98, 1.0), emission_strength=22.0)
        m["lens"] = C.make_material("FixtureLens", color=(1, 1, 1), rough=0.3, emission=(0.9, 0.95, 1.0), emission_strength=14.0)
        m["chalk"] = C.make_material("Chalk", color=(0.08, 0.3, 0.55), rough=0.95)
        m["door"] = C.make_material("Door", color=(0.04, 0.035, 0.03), rough=0.6)
        m["proTop"] = C.make_material("PracticeCloth", color=(0.32, 0.36, 0.42), rough=0.9)
        return m

    def emissive(self, name, rgb, strength, img=None):
        return C.make_material(name, color=(0.0, 0.0, 0.0), rough=0.4, emission=rgb, emission_strength=strength, emission_img=img)

    # ── lampu meja (light bank) ──
    def build_lamp(self, M):
        z = self.LAMP_Z
        solid, glow = [], []
        if self.kind == "red":
            # satu kotak besar dengan 3 panel
            hx, hy, th = 1.45, 0.78, 0.14
            solid.append(box("frame", -hx, hx, -hy, hy, z + 0.02, z + 0.02 + th, 0.01))
            for x in self.LAMP_X:
                glow.append(quad("panel", [(x + 0.4, -0.64, z + 0.015), (x - 0.4, -0.64, z + 0.015), (x - 0.4, 0.64, z + 0.015), (x + 0.4, 0.64, z + 0.015)]))
            for sx in (-1, 1):
                for sy in (-1, 1):
                    solid.append(bar("cable", (sx * (hx - 0.1), sy * (hy - 0.1), z + 0.16), (sx * (hx - 0.1), sy * (hy - 0.1), 3.3), 0.004))
        else:
            # 6 kotak terpisah 2×3
            for x in (-0.85, 0.0, 0.85):
                for y in (-0.36, 0.36):
                    solid.append(box("unit", x - 0.38, x + 0.38, y - 0.3, y + 0.3, z + 0.005, z + 0.13, 0.008))
                    glow.append(quad("panel", [(x + 0.34, y - 0.26, z), (x - 0.34, y - 0.26, z), (x - 0.34, y + 0.26, z), (x + 0.34, y + 0.26, z)]))
            solid.append(box("spine", -1.3, 1.3, -0.04, 0.04, z + 0.13, z + 0.2))
            for x in (-1.1, 1.1):
                solid.append(bar("cable", (x, 0, z + 0.2), (x, 0, 4.0), 0.004))
        lamp = C.join(solid, "Lamp")
        C.shade_smooth(lamp, 40)
        C.box_uv(lamp, 1.0)
        C.assign(lamp, M["frame"])
        lamp_glow = C.join(glow, "Lamp_Glow")
        C.box_uv(lamp_glow, 1.0)
        C.assign(lamp_glow, M["panel"])
        for vis in ("visible_diffuse", "visible_glossy", "visible_transmission", "visible_volume_scatter"):
            setattr(lamp_glow, vis, vis == "visible_glossy")
        return lamp, lamp_glow

    def build_lights(self):
        return [RU.add_spot(f"TableSpot_{i}", (x, 0, self.LAMP_Z), self.LAMP_POWER, self.SPOT_SIZE_DEG, self.SPOT_BLEND, 0.25, self.LAMP_COLOR)
                for i, x in enumerate(self.LAMP_X)]

    def _bake_spot(self, name, loc, target, power, size_deg, color, blend=0.6, radius=0.15):
        ob = RU.add_spot(name, loc, power, size_deg, blend, radius, color)
        RU.look_at(ob, target)
        self._bake_lights.append(ob)
        return ob

    # ── ruang ──
    def _shell(self, M, static):
        RX, RY, CZ = self.RX, self.RY, self.CEIL_Z
        floor = quad("floor", [(-RX, -RY, FLOOR_Z), (RX, -RY, FLOOR_Z), (RX, RY, FLOOR_Z), (-RX, RY, FLOOR_Z)])
        C.box_uv(floor, 1 / (2.6 if self.kind == "red" else 2.0))
        C.assign(floor, M["floor"])
        static.append(floor)
        walls = []
        for p0, p1 in (((-RX, RY), (RX, RY)), ((RX, RY), (RX, -RY)), ((RX, -RY), (-RX, -RY)), ((-RX, -RY), (-RX, RY))):
            walls.append(quad("wall", [(p0[0], p0[1], FLOOR_Z), (p1[0], p1[1], FLOOR_Z), (p1[0], p1[1], CZ), (p0[0], p0[1], CZ)]))
        wall = C.join(walls, "walls")
        C.box_uv(wall, 1 / 2.4)
        C.assign(wall, M["wall"])
        static.append(wall)
        # pilaster/kolom tiap ~2.25 m
        pil = []
        for k in range(-3, 4):
            x = k * 2.5
            pil.append(box("p", x - 0.22, x + 0.22, RY - 0.18, RY, FLOOR_Z, CZ))
            pil.append(box("p", x - 0.22, x + 0.22, -RY, -RY + 0.18, FLOOR_Z, CZ))
        for k in range(-2, 3):
            y = k * 2.6
            pil.append(box("p", RX - 0.18, RX, y - 0.22, y + 0.22, FLOOR_Z, CZ))
            pil.append(box("p", -RX, -RX + 0.18, y - 0.22, y + 0.22, FLOOR_Z, CZ))
        pil.append(box("skirt", -RX, RX, RY - 0.04, RY, FLOOR_Z, FLOOR_Z + 0.12))
        pil.append(box("skirt", -RX, RX, -RY, -RY + 0.04, FLOOR_Z, FLOOR_Z + 0.12))
        pil.append(box("skirt", RX - 0.04, RX, -RY, RY, FLOOR_Z, FLOOR_Z + 0.12))
        pil.append(box("skirt", -RX, -RX + 0.04, -RY, RY, FLOOR_Z, FLOOR_Z + 0.12))
        p = C.join(pil, "pilasters")
        C.box_uv(p, 1.0)
        C.assign(p, M["pilaster"])
        static.append(p)

    def _truss_grid(self, M, static, glow, lines, z, led_rgb, led_strength, fixtures):
        parts = []
        for a, b in lines:
            parts += truss(a, b, z)
        t = C.join(parts, "truss")
        C.box_uv(t, 1.0)
        C.assign(t, M["truss"])
        self._detail.append(t)
        # strip LED di bawah chord bawah (memberi warna pada truss lewat bake)
        if led_rgb is not None:
            strips = []
            for a, b in lines:
                a3, b3 = Vector((a[0], a[1], 0)), Vector((b[0], b[1], 0))
                d = (b3 - a3).normalized()
                s = d.cross(Vector((0, 0, 1))) * 0.05
                zz = z - 0.17
                strips.append(quad("led", [(a3 + s).to_tuple()[:2] + (zz,), (a3 - s).to_tuple()[:2] + (zz,), (b3 - s).to_tuple()[:2] + (zz,), (b3 + s).to_tuple()[:2] + (zz,)]))
            led = C.join(strips, "truss_led")
            for f in led.data.polygons:
                f.flip() if f.normal.z > 0 else None
            C.box_uv(led, 1.0)
            C.assign(led, self.emissive("TrussLED", led_rgb, led_strength))
            glow.append(led)
        # kepala lampu gantung (moving head / PAR): bodi hitam + lensa emisif
        heads, lenses = [], []
        for x, y, aim, lens_mat in fixtures:
            heads.append(cbox("yoke", x, y, z - 0.2, 0.06, 0.32, 0.12))
            c = Vector((x, y, z - 0.42))
            n = (Vector(aim) - c).normalized()
            heads.append(cylinder("head", c - n * 0.18, n, 0.14, 0.3))
            ln = disk("lens", c + n * 0.125, n, 0.11)
            C.assign(ln, lens_mat)
            lenses.append(ln)
        if heads:
            h = C.join(heads, "fixtures")
            C.box_uv(h, 1.0)
            C.assign(h, M["black"])
            self._detail.append(h)
            glow += lenses

    def _red(self, M, static, glow):
        RX, RY = self.RX, self.RY
        # ── papan LED merah polos membentuk U (kiri, kanan, depan) ──
        led_img = gradient_image("led_red", (0.95, 0.10, 0.08), (0.72, 0.02, 0.03), glow=(0.25, 0.05, 0.03))
        led_mat = self.emissive("LEDBoard", (1, 1, 1), 1.3, led_img)
        bx, by0, by1, fy = 5.4, -4.2, 3.4, -4.2
        bh = 1.0
        frames, faces = [], []
        for sx in (-1, 1):
            x = sx * bx
            frames.append(box("b", min(x, x + sx * 0.16), max(x, x + sx * 0.16), by0, by1, FLOOR_Z, FLOOR_Z + bh))
            xf = x - sx * 0.002
            pts = [(xf, by0 + 0.06, FLOOR_Z + 0.06), (xf, by1 - 0.06, FLOOR_Z + 0.06), (xf, by1 - 0.06, FLOOR_Z + bh - 0.05), (xf, by0 + 0.06, FLOOR_Z + bh - 0.05)]
            if sx < 0:
                pts = [pts[1], pts[0], pts[3], pts[2]]
            faces.append(quad("ledf", pts, ((0, 0), (8, 0), (8, 1), (0, 1))))
        frames.append(box("bf", -bx - 0.16, bx + 0.16, fy - 0.16, fy, FLOOR_Z, FLOOR_Z + bh))
        faces.append(quad("ledf", [(-bx + 0.06, fy + 0.002, FLOOR_Z + 0.06), (bx - 0.06, fy + 0.002, FLOOR_Z + 0.06), (bx - 0.06, fy + 0.002, FLOOR_Z + bh - 0.05), (-bx + 0.06, fy + 0.002, FLOOR_Z + bh - 0.05)][::-1], ((0, 1), (0, 0), (10, 0), (10, 1))))
        # rail kaca gelap di atas papan
        for sx in (-1, 1):
            frames.append(box("g", sx * bx - 0.03, sx * bx + 0.03, by0, by1, FLOOR_Z + bh, FLOOR_Z + bh + 0.32))
        frames.append(box("g", -bx, bx, fy - 0.11, fy - 0.05, FLOOR_Z + bh, FLOOR_Z + bh + 0.32))
        fr = C.join(frames, "boards")
        C.box_uv(fr, 1.0)
        C.assign(fr, M["matte"])
        static.append(fr)
        lf = C.join(faces, "led_faces")
        face_toward(lf, (0, 0, FLOOR_Z + 0.5))
        C.assign(lf, led_mat)
        glow.append(lf)
        # garis LED tipis di bibir atas
        lines = []
        for sx in (-1, 1):
            x = sx * bx
            lines.append(box("l", x - 0.012, x + 0.012, by0, by1, FLOOR_Z + bh + 0.32, FLOOR_Z + bh + 0.34))
        lines.append(box("l", -bx, bx, fy - 0.09, fy - 0.07, FLOOR_Z + bh + 0.32, FLOOR_Z + bh + 0.34))
        ll = C.join(lines, "led_lines")
        C.box_uv(ll, 1.0)
        C.assign(ll, self.emissive("LEDLine", (1.0, 0.06, 0.05), 6.0))
        glow.append(ll)

        # ── dinding belakang: 2 layar besar polos + papan skor + pintu ──
        scr_img = gradient_image("screen_red", (0.20, 0.22, 0.28), (0.10, 0.06, 0.07), glow=(0.18, 0.12, 0.12))
        scr_mat = self.emissive("Screen", (1, 1, 1), 1.6, scr_img)
        yw = RY - 0.02
        scr_frames, scr = [], []
        for cx, w, h, zc in ((-4.6, 3.4, 1.9, 2.5), (4.6, 3.4, 1.9, 2.5)):
            scr_frames.append(box("sf", cx - w / 2 - 0.06, cx + w / 2 + 0.06, yw - 0.12, yw, zc - h / 2 - 0.06, zc + h / 2 + 0.06))
            scr.append(quad("scr", [(cx + w / 2, yw - 0.122, zc - h / 2), (cx - w / 2, yw - 0.122, zc - h / 2), (cx - w / 2, yw - 0.122, zc + h / 2), (cx + w / 2, yw - 0.122, zc + h / 2)]))
        # papan skor kecil (merah polos dengan blok gelap, tanpa angka)
        sb_img = gradient_image("score_red", (0.85, 0.08, 0.06), (0.6, 0.03, 0.03))
        scr_frames.append(box("sbf", -0.85, 0.85, yw - 0.1, yw, 2.6, 3.2))
        sb = quad("sb", [(0.8, yw - 0.102, 2.65), (-0.8, yw - 0.102, 2.65), (-0.8, yw - 0.102, 3.15), (0.8, yw - 0.102, 3.15)])
        face_toward(sb, (0, 0, 2.9))
        C.assign(sb, self.emissive("ScoreBoard", (1, 1, 1), 2.0, sb_img))
        glow.append(sb)
        sf = C.join(scr_frames, "screen_frames")
        C.box_uv(sf, 1.0)
        C.assign(sf, M["matte"])
        static.append(sf)
        s = C.join(scr, "screens")
        face_toward(s, (0, 0, 2.5))
        C.assign(s, scr_mat)
        glow.append(s)
        doors = []
        for cx in (-1.7, 1.7):
            doors.append(box("door", cx - 0.9, cx + 0.9, yw - 0.05, yw, FLOOR_Z, FLOOR_Z + 2.7))
        d = C.join(doors, "doors")
        C.box_uv(d, 1.0)
        C.assign(d, M["door"])
        static.append(d)

        # ── meja latihan & meja wasit di latar ──
        props = []
        tops = []
        for sx in (-1, 1):
            for cy in (-2.2, 2.2):
                cx = sx * 7.4
                props.append(box("pt", cx - 0.75, cx + 0.75, cy - 1.4, cy + 1.4, -0.22, -0.02))
                props.append(box("pl", cx - 0.55, cx + 0.55, cy - 1.1, cy + 1.1, FLOOR_Z, -0.22))
                tops.append(box("ptop", cx - 0.66, cx + 0.66, cy - 1.3, cy + 1.3, -0.02, 0.0))
        props.append(box("desk", 1.6, 3.6, 4.4, 5.0, FLOOR_Z, FLOOR_Z + 0.75))
        for cx in (2.0, 2.6, 3.2):
            props.append(box("chair", cx - 0.22, cx + 0.22, 5.1, 5.5, FLOOR_Z, FLOOR_Z + 0.45))
            props.append(box("chairb", cx - 0.22, cx + 0.22, 5.42, 5.5, FLOOR_Z + 0.45, FLOOR_Z + 0.95))
        # tripod kamera siaran
        for x, y in ((-4.4, 4.6), (4.2, -3.2)):
            for a in range(3):
                ang = a * 2 * math.pi / 3
                props.append(bar("leg", (x, y, FLOOR_Z + 1.35), (x + 0.35 * math.cos(ang), y + 0.35 * math.sin(ang), FLOOR_Z), 0.012))
            props.append(cbox("cam", x, y, FLOOR_Z + 1.5, 0.45, 0.2, 0.25))
        pr = C.join(props, "props_bg")
        C.box_uv(pr, 1.0)
        C.assign(pr, M["matte"])
        static.append(pr)
        tp = C.join(tops, "practice_tops")
        C.box_uv(tp, 1.0)
        C.assign(tp, M["proTop"])
        static.append(tp)

        # ── truss merah ──
        lens = M["lens"]
        lines = [((-5.6, -4.6), (5.6, -4.6)), ((-5.6, 4.6), (5.6, 4.6)), ((-5.6, -4.6), (-5.6, 4.6)), ((5.6, -4.6), (5.6, 4.6)),
                 ((-5.6, -1.6), (5.6, -1.6)), ((-5.6, 1.6), (5.6, 1.6)), ((-2.6, -4.6), (-2.6, 4.6)), ((2.6, -4.6), (2.6, 4.6))]
        fixtures = []
        for x in (-2.6, 2.6):
            for y in (-1.6, 1.6):
                fixtures.append((x, y, (x * 0.2, y * 0.2, 0), lens))
        for x in (-5.6, 0.0, 5.6):
            for y in (-4.6, 4.6):
                fixtures.append((x, y, (x * 0.6, -y * 0.3, FLOOR_Z), lens))
        self._truss_grid(M, static, glow, lines, 3.4, (1.0, 0.04, 0.03), 9.0, fixtures)
        # truss tingkat atas dekat dinding
        lines2 = [((-8.0, -6.2), (8.0, -6.2)), ((-8.0, 6.2), (8.0, 6.2)), ((-8.0, -6.2), (-8.0, 6.2)), ((8.0, -6.2), (8.0, 6.2))]
        red_par = self.emissive("RedPar", (1.0, 0.05, 0.04), 20.0)
        fixtures2 = [(x, y, (x * 0.7, y * 0.85, 2.0), red_par) for x in (-6, -2, 2, 6) for y in (-6.2, 6.2)]
        self._truss_grid(M, static, glow, lines2, 4.5, (1.0, 0.04, 0.03), 9.0, fixtures2)

        # ── cahaya warna untuk bake: kolam merah di karpet & cahaya merah di dinding ──
        for x in (-4.0, 0.0, 4.0):
            for y in (-3.0, 3.0):
                self._bake_spot("RedPool", (x, y, 3.2), (x * 1.05, y * 1.1, FLOOR_Z), 900.0, 38, (1.0, 0.12, 0.10))
        for x in (-6.0, -2.0, 2.0, 6.0):
            for y in (-6.0, 6.0):
                self._bake_spot("RedWash", (x, y * 0.95, 4.3), (x, y * 1.2, 1.2), 500.0, 50, (1.0, 0.06, 0.05))
        # pantulan putih dari kepala lampu di tengah
        for x in (-2.6, 2.6):
            for y in (-1.6, 1.6):
                self._bake_spot("WhiteBeam", (x, y, 2.9), (x * 1.6, y * 1.8, FLOOR_Z), 260.0, 24, (0.9, 0.93, 1.0))

    def _blue(self, M, static, glow):
        RX, RY = self.RX, self.RY
        # ── pembatas oval ──
        a, b = 4.7, 3.3
        seg = 96
        bh = 0.9
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.new("UVMap")
        per = 2 * math.pi * math.sqrt((a * a + b * b) / 2)
        inner, outer = [], []
        for i in range(seg + 1):
            t = 2 * math.pi * i / seg
            x, y = a * math.cos(t), b * math.sin(t)
            nx, ny = math.cos(t) / a, math.sin(t) / b
            ln = math.hypot(nx, ny)
            nx, ny = nx / ln, ny / ln
            inner.append((x, y))
            outer.append((x + nx * 0.1, y + ny * 0.1))
        u_acc = [0.0]
        for i in range(1, seg + 1):
            u_acc.append(u_acc[-1] + math.dist(inner[i], inner[i - 1]) / 2.4)
        z0, z1 = FLOOR_Z, FLOOR_Z + bh
        for i in range(seg):
            j = i + 1
            vs = [bm.verts.new((inner[j][0], inner[j][1], z0)), bm.verts.new((inner[i][0], inner[i][1], z0)),
                  bm.verts.new((inner[i][0], inner[i][1], z1)), bm.verts.new((inner[j][0], inner[j][1], z1))]
            f = bm.faces.new(vs)
            for lp, (u, v) in zip(f.loops, ((u_acc[j], 0), (u_acc[i], 0), (u_acc[i], 1), (u_acc[j], 1))):
                lp[uvl].uv = (u, v)
        panel = C.obj_from_bmesh("barrier_panel", bm)
        # orientasi: muka menghadap ke dalam (ke meja)
        for p in panel.data.polygons:
            c = p.center
            if p.normal.x * c.x + p.normal.y * c.y > 0:
                p.flip()
        C.assign(panel, M["barrier"])
        static.append(panel)
        _ = per
        bm = bmesh.new()
        for i in range(seg):
            j = i + 1
            o0, o1, i0, i1 = outer[i], outer[j], inner[i], inner[j]
            q = [bm.verts.new((p[0], p[1], z)) for p, z in ((i0, z1), (i1, z1), (o1, z1), (o0, z1))]
            bm.faces.new(q)
            q = [bm.verts.new((p[0], p[1], z)) for p, z in ((o0, z0), (o1, z0), (o1, z1), (o0, z1))]
            bm.faces.new(q)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        back = C.obj_from_bmesh("barrier_back", bm)
        C.box_uv(back, 1.0)
        C.assign(back, M["matte"])
        static.append(back)
        # strip LED di atas pembatas
        bm = bmesh.new()
        for i in range(seg):
            j = i + 1
            q = [bm.verts.new((p[0], p[1], z1 + 0.003)) for p in (inner[i], inner[j], ((inner[j][0] + outer[j][0]) / 2, (inner[j][1] + outer[j][1]) / 2), ((inner[i][0] + outer[i][0]) / 2, (inner[i][1] + outer[i][1]) / 2))]
            f = bm.faces.new(q)
            f.normal_update()
            if f.normal.z < 0:
                f.normal_flip()
        strip = C.obj_from_bmesh("barrier_led", bm)
        C.box_uv(strip, 1.0)
        C.assign(strip, self.emissive("BarrierLED", (0.25, 0.45, 1.0), 3.0))
        glow.append(strip)

        # ── kursi pemain ──
        chairs = []
        for sx in (-1, 1):
            cx, cy = sx * 2.7, 2.35
            chairs += [cbox("seat", cx, cy, FLOOR_Z + 0.3, 0.75, 0.7, 0.2, 0.03),
                       cbox("base", cx, cy, FLOOR_Z + 0.1, 0.65, 0.6, 0.2),
                       cbox("back", cx, cy + 0.3, FLOOR_Z + 0.6, 0.75, 0.16, 0.6, 0.04),
                       cbox("arm", cx - 0.36, cy, FLOOR_Z + 0.48, 0.14, 0.7, 0.3, 0.03),
                       cbox("arm", cx + 0.36, cy, FLOOR_Z + 0.48, 0.14, 0.7, 0.3, 0.03)]
        ch = C.join(chairs, "armchairs")
        C.shade_smooth(ch, 40)
        C.box_uv(ch, 1.0)
        C.assign(ch, M["armchair"])
        static.append(ch)
        small = [cbox("tbl", sx * 3.3, 2.35, FLOOR_Z + 0.3, 0.4, 0.4, 0.6) for sx in (-1, 1)]
        st = C.join(small, "side_tables")
        C.box_uv(st, 1.0)
        C.assign(st, M["matte"])
        static.append(st)

        # ── tribun bertingkat (belakang & samping) ──
        risers, seats = [], []
        rows, step, depth = 7, 0.3, 0.8
        y_start = 4.2
        for r in range(rows):
            zr = FLOOR_Z + step * (r + 1)
            y0 = y_start + r * depth
            risers.append(box("riser", -8.8, 8.8, y0, RY, FLOOR_Z, zr))
            for k in range(-15, 16):
                x = k * 0.56
                seats.append(box("s", x - 0.23, x + 0.23, y0 + 0.12, y0 + 0.55, zr, zr + 0.42))
                seats.append(box("b", x - 0.23, x + 0.23, y0 + 0.55, y0 + 0.62, zr + 0.2, zr + 0.85))
        x_start = 5.8
        for r in range(5):
            zr = FLOOR_Z + step * (r + 1)
            x0 = x_start + r * depth
            for sx in (-1, 1):
                xa, xb = (x0, RX) if sx > 0 else (-RX, -x0)
                risers.append(box("riser", xa, xb, -3.6, 3.9, FLOOR_Z, zr))
                for k in range(-6, 7):
                    y = k * 0.56
                    if sx > 0:
                        seats.append(box("s", x0 + 0.12, x0 + 0.55, y - 0.23, y + 0.23, zr, zr + 0.42))
                        seats.append(box("b", x0 + 0.55, x0 + 0.62, y - 0.23, y + 0.23, zr + 0.2, zr + 0.85))
                    else:
                        seats.append(box("s", -x0 - 0.55, -x0 - 0.12, y - 0.23, y + 0.23, zr, zr + 0.42))
                        seats.append(box("b", -x0 - 0.62, -x0 - 0.55, y - 0.23, y + 0.23, zr + 0.2, zr + 0.85))
        rs = C.join(risers, "risers")
        C.box_uv(rs, 1.0)
        C.assign(rs, M["riser"])
        static.append(rs)
        se = C.join(seats, "seats")
        C.box_uv(se, 1.0)
        C.assign(se, M["seat"])
        self._detail.append(se)

        # ── layar besar polos di dinding belakang + 2 layar vertikal ──
        yw = RY - 0.02
        big = gradient_image("screen_blue", (0.30, 0.40, 0.75), (0.08, 0.12, 0.32), glow=(0.45, 0.45, 0.5))
        side = gradient_image("screen_blue_side", (0.10, 0.16, 0.40), (0.03, 0.05, 0.14))
        frames, scr = [], []
        for cx, w, h, zc, img, strength, nm in ((0.0, 6.2, 3.3, 3.6, big, 1.8, "ScreenBig"), (-4.7, 1.1, 3.0, 3.5, side, 1.6, "ScreenSide"), (4.7, 1.1, 3.0, 3.5, side, 1.6, "ScreenSide")):
            frames.append(box("sf", cx - w / 2 - 0.08, cx + w / 2 + 0.08, yw - 0.12, yw, zc - h / 2 - 0.08, zc + h / 2 + 0.08))
            q = quad("scr", [(cx + w / 2, yw - 0.122, zc - h / 2), (cx - w / 2, yw - 0.122, zc - h / 2), (cx - w / 2, yw - 0.122, zc + h / 2), (cx + w / 2, yw - 0.122, zc + h / 2)])
            face_toward(q, (0, 0, zc))
            C.assign(q, self.emissive(nm, (1, 1, 1), strength, img))
            scr.append(q)
        sf = C.join(frames, "screen_frames")
        C.box_uv(sf, 1.0)
        C.assign(sf, M["matte"])
        static.append(sf)
        glow += scr

        # ── truss dengan PAR merah & biru ──
        lines = [((-6.4, -5.2), (6.4, -5.2)), ((-6.4, 5.2), (6.4, 5.2)), ((-6.4, -5.2), (-6.4, 5.2)), ((6.4, -5.2), (6.4, 5.2)),
                 ((-6.4, 0.0), (6.4, 0.0))]
        par_r = self.emissive("RedPar", (1.0, 0.06, 0.05), 26.0)
        par_b = self.emissive("BluePar", (0.10, 0.25, 1.0), 30.0)
        fixtures = []
        for i, x in enumerate((-5.6, -3.4, -1.2, 1.2, 3.4, 5.6)):
            for y in (-5.2, 5.2):
                fixtures.append((x, y, (x * 0.8, -y * 0.2, FLOOR_Z), par_b if i % 2 == 0 else par_r))
        for y in (-3.0, 3.0):
            for x in (-6.4, 6.4):
                fixtures.append((x, y, (x * 0.4, y, FLOOR_Z), par_b))
        self._truss_grid(M, static, glow, lines, 4.2, None, 0, fixtures)

        # ── cahaya bake: wash biru di lantai, aksen merah & biru di tribun ──
        for x in (-4.5, -1.5, 1.5, 4.5):
            for y in (-3.0, 0.0, 3.0):
                self._bake_spot("BlueWash", (x, y, 4.0), (x * 1.1, y * 1.15, FLOOR_Z), 2400.0, 46, (0.06, 0.22, 1.0))
        for i, x in enumerate((-6.0, -2.0, 2.0, 6.0)):
            col = (1.0, 0.08, 0.06) if i % 2 else (0.15, 0.3, 1.0)
            self._bake_spot("TribuneWash", (x, 4.8, 4.2), (x * 1.1, 7.0, FLOOR_Z + 1.4), 1500.0, 40, col)
        for sx in (-1, 1):
            self._bake_spot("SideWash", (sx * 6.0, 0.0, 4.2), (sx * 8.0, 0.0, FLOOR_Z + 0.8), 1800.0, 55, (0.08, 0.24, 1.0))

    def build(self):
        M = self.materials()
        static, glow = [], []
        self._bake_lights = []
        # detail kecil & banyak (truss, kepala lampu, kursi tribun): TIDAK di-lightmap agar atlas
        # lightmap tidak habis untuk ribuan pulau UV kecil; di client diterangi IBL difus.
        self._detail = []
        self._shell(M, static)
        if self.kind == "red":
            self._red(M, static, glow)
        else:
            self._blue(M, static, glow)
        room = C.join(static, "Room")
        RX, RY, CZ = self.RX, self.RY, self.CEIL_Z
        ceiling = quad("Room_Ceiling", [(-RX, RY, CZ), (RX, RY, CZ), (RX, -RY, CZ), (-RX, -RY, CZ)])
        C.box_uv(ceiling, 1.0)
        C.assign(ceiling, M["ceiling"])
        glow_obj = C.join(glow, "Room_Glow")
        lamp, lamp_glow = self.build_lamp(M)
        hw = T["width"] / 2
        chalk = box("Chalk", 0.5, 0.522, -hw - 0.12, -hw - 0.098, T["railHeight"], T["railHeight"] + 0.022, 0.0015)
        C.box_uv(chalk, 1.0)
        C.assign(chalk, M["chalk"])
        detail = C.join(self._detail, "Room_Detail")
        return dict(room=room, ceiling=ceiling, lamp=lamp, lamp_glow=lamp_glow, glow=glow_obj, props=[chalk, detail])

    def build_bake_lights(self):
        """Lampu tambahan yang hanya ada di bake (lightmap) — dibuat oleh build()."""
        return list(self._bake_lights)
