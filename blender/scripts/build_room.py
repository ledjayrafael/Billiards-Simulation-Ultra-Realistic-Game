"""Ruang biliar: lantai parket, dinding + wainscot, plafon, lampu gantung 3 shade, sconce, rak stik,
bangku kulit, lukisan abstrak (prosedural), kapur. Origin = tengah permukaan kain meja."""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402

import build_cue  # noqa: E402
import common as C  # noqa: E402
import render_util as RU  # noqa: E402
from common import T  # noqa: E402

RX, RY = 4.3, 3.4          # setengah ukuran ruangan
FLOOR_Z = -T["surfaceHeight"]
CEIL_Z = 2.15
LAMP_X = (-0.8, 0.0, 0.8)
LAMP_Z = 0.86              # tinggi sumber cahaya di atas kain
LAMP_POWER = 42.0          # watt Blender per lampu
SPOT_SIZE_DEG = 126.0
SPOT_BLEND = 0.4
SCONCE_STRENGTH = 40.0


def box(name, x0, x1, y0, y1, z0, z1, bevel=0.0):
    ob = C.prism(name, [(x1, y1), (x0, y1), (x0, y0), (x1, y0)], z0, z1)
    if bevel > 0:
        C.bevel(ob, bevel, 2, 50)
    return ob


def quad(name, pts):
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(p) for p in pts])
    return C.obj_from_bmesh(name, bm)


def art_image(seed):
    """Lukisan abstrak geometris (orisinal, prosedural)."""
    rng = np.random.default_rng(seed)
    n = 384
    y, x = np.mgrid[0:n, 0:n].astype(np.float32) / n
    palette = np.array([[0.93, 0.89, 0.80], [0.05, 0.22, 0.38], [0.78, 0.52, 0.16], [0.55, 0.10, 0.08], [0.06, 0.07, 0.08], [0.12, 0.36, 0.30]], np.float32)
    img = np.empty((n, n, 3), np.float32)
    img[:] = palette[0]
    for _ in range(7):
        col = palette[rng.integers(1, len(palette))]
        kind = rng.integers(0, 3)
        cx, cy, r = rng.uniform(0.15, 0.85), rng.uniform(0.15, 0.85), rng.uniform(0.08, 0.3)
        if kind == 0:
            m = (x - cx) ** 2 + (y - cy) ** 2 < r * r
        elif kind == 1:
            a = rng.uniform(0, np.pi)
            m = np.abs((x - cx) * np.cos(a) + (y - cy) * np.sin(a)) < r * 0.25
        else:
            m = (np.abs(x - cx) < r) & (np.abs(y - cy) < r * rng.uniform(0.3, 1))
        img[m] = col
    img *= 1 + 0.04 * rng.standard_normal((n, n, 1)).astype(np.float32)
    return C.save_image(f"art_{seed}", np.clip(img, 0, 1))


def materials():
    m = {}
    fd = C.load_image("herringbone_parquet_diff.jpg")
    fn = C.load_image("herringbone_parquet_nor.jpg", "Non-Color")
    fr = C.load_image("herringbone_parquet_rough.jpg", "Non-Color")
    m["floor"] = C.make_material("Floor", diff=fd, nor=fn, rough_img=fr, tint=(0.62, 0.5, 0.42))
    pd = C.load_image("plastered_wall_04_diff.jpg")
    pn = C.load_image("plastered_wall_04_nor.jpg", "Non-Color")
    m["wall"] = C.make_material("Wall", diff=pd, nor=pn, rough=0.9, tint=(0.36, 0.52, 0.52))
    m["ceiling"] = C.make_material("Ceiling", color=(0.2, 0.2, 0.2), rough=0.95)
    wd = C.load_image("walnut_veneer_02_diff.jpg")
    wn = C.load_image("walnut_veneer_02_nor.jpg", "Non-Color")
    m["panel"] = C.make_material("Panel", diff=wd, nor=wn, rough=0.45, tint=(0.42, 0.27, 0.18))
    ld = C.load_image("brown_leather_diff.jpg")
    ln = C.load_image("brown_leather_nor.jpg", "Non-Color")
    m["leather"] = C.make_material("BenchLeather", diff=ld, nor=ln, rough=0.5, tint=(0.75, 0.5, 0.4), uv_scale=(2, 2))
    m["brass"] = C.make_material("LampBrass", color=(0.78, 0.6, 0.3), rough=0.3, metallic=1.0)
    m["shade"] = C.make_material("LampShade", color=(0.02, 0.1, 0.08), rough=0.25, coat=1.0, coat_rough=0.08)
    m["shade_in"] = C.make_material("LampShadeInner", color=(0.85, 0.83, 0.78), rough=0.6)
    m["bulb"] = C.make_material("LampDiffuser", color=(1, 1, 1), rough=0.5, emission=(1.0, 0.93, 0.82), emission_strength=28.0)
    m["sconce"] = C.make_material("SconceGlow", color=(1, 1, 1), rough=0.5, emission=(1.0, 0.72, 0.42), emission_strength=SCONCE_STRENGTH)
    m["black"] = C.make_material("BlackMetal", color=(0.02, 0.02, 0.022), rough=0.45, metallic=1.0)
    m["chalk"] = C.make_material("Chalk", color=(0.08, 0.3, 0.55), rough=0.95)
    m["frame"] = C.make_material("FrameWood", color=(0.03, 0.025, 0.02), rough=0.4)
    return m


def build_lamp(M):
    """Lampu gantung: batang kuningan + 3 shade kerucut. Dipisah agar client bisa menyembunyikannya di top view."""
    parts = []

    def cone(name, x, z0, r0, z1, r1, mat, inward=False, seg=40):
        bm = bmesh.new()
        a = [bm.verts.new((x + r0 * math.cos(2 * math.pi * i / seg), r0 * math.sin(2 * math.pi * i / seg), z0)) for i in range(seg)]
        b = [bm.verts.new((x + r1 * math.cos(2 * math.pi * i / seg), r1 * math.sin(2 * math.pi * i / seg), z1)) for i in range(seg)]
        for i in range(seg):
            j = (i + 1) % seg
            f = (a[i], a[j], b[j], b[i]) if not inward else (a[j], a[i], b[i], b[j])
            bm.faces.new(f)
        ob = C.obj_from_bmesh(name, bm)
        C.shade_smooth(ob, 60)
        C.box_uv(ob, 1.0)
        C.assign(ob, mat)
        return ob

    bar_z = 1.22
    bar = box("bar", -1.05, 1.05, -0.016, 0.016, bar_z - 0.016, bar_z + 0.016, 0.006)
    C.box_uv(bar, 1.0)
    C.assign(bar, M["brass"])
    parts.append(bar)
    for x in (-0.55, 0.55):
        rod = box("rod", x - 0.006, x + 0.006, -0.006, 0.006, bar_z, CEIL_Z)
        C.box_uv(rod, 1.0)
        C.assign(rod, M["brass"])
        parts.append(rod)
    for x in LAMP_X:
        rim_z, top_z = 0.80, 1.02
        parts.append(cone("shade_out", x, rim_z, 0.215, top_z, 0.055, M["shade"]))
        parts.append(cone("shade_in", x, rim_z + 0.001, 0.212, top_z - 0.002, 0.052, M["shade_in"], inward=True))
        parts.append(cone("neck", x, top_z, 0.055, bar_z - 0.016, 0.014, M["brass"]))
        # diffuser emisif (hanya visual: pantulan di bola; pencahayaan dari spot light)
        bm = bmesh.new()
        seg = 32
        vs = [bm.verts.new((x + 0.105 * math.cos(2 * math.pi * i / seg), 0.105 * math.sin(2 * math.pi * i / seg), LAMP_Z + 0.02)) for i in range(seg)]
        bm.faces.new(list(reversed(vs)))
        d = C.obj_from_bmesh("diffuser", bm)
        C.box_uv(d, 1.0)
        C.assign(d, M["bulb"])
        parts.append(d)
    glow = [p for p in parts if p.name.startswith("diffuser")]
    solid = [p for p in parts if not p.name.startswith("diffuser")]
    lamp = C.join(solid, "Lamp")
    lamp_glow = C.join(glow, "Lamp_Glow")
    for vis in ("visible_diffuse", "visible_glossy", "visible_transmission", "visible_volume_scatter"):
        setattr(lamp_glow, vis, vis == "visible_glossy")
    return lamp, lamp_glow


def build_lights():
    return [RU.add_spot(f"TableSpot_{i}", (x, 0, LAMP_Z), LAMP_POWER, SPOT_SIZE_DEG, SPOT_BLEND, 0.07) for i, x in enumerate(LAMP_X)]


def build():
    """Mengembalikan dict: room (objek statis ber-lightmap), ceiling, lamp, lamp_glow, glow (sconce emisif), props."""
    M = materials()
    static = []

    # lantai, dinding, plafon
    floor = quad("floor", [(-RX, -RY, FLOOR_Z), (RX, -RY, FLOOR_Z), (RX, RY, FLOOR_Z), (-RX, RY, FLOOR_Z)])
    C.box_uv(floor, 1 / 2.4)
    C.assign(floor, M["floor"])
    static.append(floor)
    wain = FLOOR_Z + 0.95
    walls = []
    for i, (p0, p1) in enumerate((((-RX, RY), (RX, RY)), ((RX, RY), (RX, -RY)), ((RX, -RY), (-RX, -RY)), ((-RX, -RY), (-RX, RY)))):
        w = quad(f"wall{i}", [(p0[0], p0[1], wain), (p1[0], p1[1], wain), (p1[0], p1[1], CEIL_Z), (p0[0], p0[1], CEIL_Z)])
        walls.append(w)
    wall = C.join(walls, "walls")
    C.box_uv(wall, 1 / 2.0)
    C.assign(wall, M["wall"])
    static.append(wall)
    # wainscot (panel kayu) + list
    th = 0.03
    panels = [
        box("p0", -RX, RX, RY - th, RY, FLOOR_Z, wain), box("p1", -RX, RX, -RY, -RY + th, FLOOR_Z, wain),
        box("p2", RX - th, RX, -RY, RY, FLOOR_Z, wain), box("p3", -RX, -RX + th, -RY, RY, FLOOR_Z, wain),
        box("c0", -RX, RX, RY - th - 0.025, RY, wain, wain + 0.04, 0.008), box("c1", -RX, RX, -RY, -RY + th + 0.025, wain, wain + 0.04, 0.008),
        box("c2", RX - th - 0.025, RX, -RY, RY, wain, wain + 0.04, 0.008), box("c3", -RX, -RX + th + 0.025, -RY, RY, wain, wain + 0.04, 0.008),
        box("b0", -RX, RX, RY - th - 0.015, RY, FLOOR_Z, FLOOR_Z + 0.12, 0.006), box("b1", -RX, RX, -RY, -RY + th + 0.015, FLOOR_Z, FLOOR_Z + 0.12, 0.006),
        box("b2", RX - th - 0.015, RX, -RY, RY, FLOOR_Z, FLOOR_Z + 0.12, 0.006), box("b3", -RX, -RX + th + 0.015, -RY, RY, FLOOR_Z, FLOOR_Z + 0.12, 0.006),
    ]
    # bilah vertikal wainscot
    for k in range(-8, 9):
        x = k * 0.5
        panels.append(box("s", x - 0.03, x + 0.03, RY - th - 0.012, RY, FLOOR_Z + 0.12, wain, 0.004))
        panels.append(box("s", x - 0.03, x + 0.03, -RY, -RY + th + 0.012, FLOOR_Z + 0.12, wain, 0.004))
    for k in range(-6, 7):
        y = k * 0.5
        panels.append(box("s", RX - th - 0.012, RX, y - 0.03, y + 0.03, FLOOR_Z + 0.12, wain, 0.004))
        panels.append(box("s", -RX, -RX + th + 0.012, y - 0.03, y + 0.03, FLOOR_Z + 0.12, wain, 0.004))
    panel = C.join(panels, "panels")
    C.shade_smooth(panel, 40)
    C.box_uv(panel, 1 / 0.9, lambda c, n: abs(n.z) < 0.5)
    C.assign(panel, M["panel"])
    static.append(panel)

    # rak stik di dinding +y
    rack_parts = [box("rb", -0.45, 0.45, RY - th - 0.03, RY - th, FLOOR_Z + 1.0, FLOOR_Z + 2.0, 0.008),
                  box("rs", -0.45, 0.45, RY - th - 0.11, RY - th - 0.03, FLOOR_Z + 1.02, FLOOR_Z + 1.06, 0.006),
                  box("rt", -0.45, 0.45, RY - th - 0.075, RY - th - 0.03, FLOOR_Z + 1.72, FLOOR_Z + 1.75, 0.006)]
    rack = C.join(rack_parts, "rack")
    C.shade_smooth(rack, 40)
    C.box_uv(rack, 1 / 0.9)
    C.assign(rack, M["panel"])
    static.append(rack)
    for k in range(5):
        cue = build_cue.build()[0]
        cue.name = f"rack_cue_{k}"
        cue.rotation_euler = (0, math.radians(-90 + 1.2), 0)  # tip ke atas, sedikit bersandar
        cue.location = (-0.32 + k * 0.16, RY - th - 0.07, FLOOR_Z + 1.06 + 1.47)
        static.append(cue)

    # bangku kulit di dinding −y
    bx0, bx1 = -1.3, 1.3
    by = -RY + th
    bench = [box("seat", bx0, bx1, by, by + 0.52, FLOOR_Z + 0.30, FLOOR_Z + 0.46, 0.035),
             box("back", bx0, bx1, by, by + 0.12, FLOOR_Z + 0.46, FLOOR_Z + 0.92, 0.035)]
    seat = C.join(bench, "bench")
    C.shade_smooth(seat, 50)
    C.box_uv(seat, 1.0)
    C.assign(seat, M["leather"])
    static.append(seat)
    legs = C.join([box("bl", x - 0.02, x + 0.02, by + yy - 0.02, by + yy + 0.02, FLOOR_Z, FLOOR_Z + 0.30) for x in (bx0 + 0.1, 0, bx1 - 0.1) for yy in (0.08, 0.44)], "bench_legs")
    C.box_uv(legs, 1.0)
    C.assign(legs, M["black"])
    static.append(legs)

    # lukisan
    art_specs = [(-RX + 0.012, -1.4, 0.8, 1.0, 0, 11), (-RX + 0.012, 1.4, 0.8, 1.0, 0, 23),
                 (2.1, RY - 0.012, 1.1, 0.8, 1, 37), (-2.1, RY - 0.012, 1.1, 0.8, 1, 41),
                 (RX - 0.012, 0.0, 1.5, 0.95, 2, 59)]
    frames = []
    for i, (x, y, w, h, wall_i, seed) in enumerate(art_specs):
        zc = FLOOR_Z + 1.7
        if wall_i == 0:      # dinding −x, menghadap +x
            pts = [(x + 0.03, y + w / 2, zc - h / 2), (x + 0.03, y - w / 2, zc - h / 2), (x + 0.03, y - w / 2, zc + h / 2), (x + 0.03, y + w / 2, zc + h / 2)]
            fr = box("fr", x, x + 0.028, y - w / 2 - 0.035, y + w / 2 + 0.035, zc - h / 2 - 0.035, zc + h / 2 + 0.035, 0.006)
        elif wall_i == 2:    # dinding +x, menghadap −x
            pts = [(x - 0.03, y - w / 2, zc - h / 2), (x - 0.03, y + w / 2, zc - h / 2), (x - 0.03, y + w / 2, zc + h / 2), (x - 0.03, y - w / 2, zc + h / 2)]
            fr = box("fr", x - 0.028, x, y - w / 2 - 0.035, y + w / 2 + 0.035, zc - h / 2 - 0.035, zc + h / 2 + 0.035, 0.006)
        else:                # dinding +y, menghadap −y
            pts = [(x + w / 2, y - 0.03, zc - h / 2), (x - w / 2, y - 0.03, zc - h / 2), (x - w / 2, y - 0.03, zc + h / 2), (x + w / 2, y - 0.03, zc + h / 2)]
            fr = box("fr", x - w / 2 - 0.035, x + w / 2 + 0.035, y - 0.028, y, zc - h / 2 - 0.035, zc + h / 2 + 0.035, 0.006)
        canvas = quad(f"art{i}", pts)
        uv = canvas.data.uv_layers.new(name="UVMap")
        for li, st in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))):
            uv.data[li].uv = st
        C.assign(canvas, C.make_material(f"Art{i}", rough=0.8, diff=art_image(seed)))
        static.append(canvas)
        frames.append(fr)
    frame = C.join(frames, "frames")
    C.box_uv(frame, 1.0)
    C.assign(frame, M["frame"])
    static.append(frame)

    # sconce: dudukan logam + kap emisif
    glow_parts, holders = [], []
    sconce_pos = [(-2.6, RY, 0), (0.0, RY, 0), (2.6, RY, 0), (-2.6, -RY, 1), (2.6, -RY, 1), (RX, -1.7, 2), (RX, 1.7, 2), (-RX, 0.0, 3)]
    for x, y, side in sconce_pos:
        z = FLOOR_Z + 1.55
        if side == 0:
            g = box("g", x - 0.05, x + 0.05, y - 0.13, y - 0.06, z, z + 0.16, 0.012)
            hld = box("h", x - 0.035, x + 0.035, y - 0.06, y - 0.03, z + 0.04, z + 0.12)
        elif side == 1:
            g = box("g", x - 0.05, x + 0.05, y + 0.06, y + 0.13, z, z + 0.16, 0.012)
            hld = box("h", x - 0.035, x + 0.035, y + 0.03, y + 0.06, z + 0.04, z + 0.12)
        elif side == 2:
            g = box("g", x - 0.13, x - 0.06, y - 0.05, y + 0.05, z, z + 0.16, 0.012)
            hld = box("h", x - 0.06, x - 0.03, y - 0.035, y + 0.035, z + 0.04, z + 0.12)
        else:
            g = box("g", x + 0.06, x + 0.13, y - 0.05, y + 0.05, z, z + 0.16, 0.012)
            hld = box("h", x + 0.03, x + 0.06, y - 0.035, y + 0.035, z + 0.04, z + 0.12)
        glow_parts.append(g)
        holders.append(hld)
    glow = C.join(glow_parts, "Room_Glow")
    C.shade_smooth(glow, 50)
    C.box_uv(glow, 1.0)
    C.assign(glow, M["sconce"])
    hold = C.join(holders, "sconce_holders")
    C.box_uv(hold, 1.0)
    C.assign(hold, M["black"])
    static.append(hold)

    room = C.join(static, "Room")

    ceiling = quad("Room_Ceiling", [(-RX, RY, CEIL_Z), (RX, RY, CEIL_Z), (RX, -RY, CEIL_Z), (-RX, -RY, CEIL_Z)])
    C.box_uv(ceiling, 1.0)
    C.assign(ceiling, M["ceiling"])

    lamp, lamp_glow = build_lamp(M)

    # kapur di atas rail
    hw = T["width"] / 2
    chalk = box("Chalk", 0.5, 0.522, -hw - 0.12, -hw - 0.098, T["railHeight"], T["railHeight"] + 0.022, 0.0015)
    C.box_uv(chalk, 1.0)
    C.assign(chalk, M["chalk"])
    return dict(room=room, ceiling=ceiling, lamp=lamp, lamp_glow=lamp_glow, glow=glow, props=[chalk])
