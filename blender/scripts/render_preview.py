"""Render preview Cycles dari scene lengkap → blender/out/preview/*.png (untuk dicek visual).
Pakai: blender -b --factory-startup -P render_preview.py -- [--samples 96] [--only nama,nama]"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402

import build_balls  # noqa: E402
import build_cue  # noqa: E402
import build_room  # noqa: E402
import build_table  # noqa: E402
import common as C  # noqa: E402
import render_util as RU  # noqa: E402


def build_full_scene(with_balls=True):
    C.reset_scene()
    table = build_table.build()
    room = build_room.build()
    lights = build_room.build_lights()
    world = bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0, 0, 0, 1)
    balls, cue = [], None
    if with_balls:
        R = C.BALL_R
        d = 2 * R + 0.0001
        dx = d * math.sqrt(3) / 2
        fx = C.T["length"] / 4
        slots = [(fx, 0), (fx + dx, -d / 2), (fx + dx, d / 2), (fx + 2 * dx, -d), (fx + 2 * dx, 0), (fx + 2 * dx, d),
                 (fx + 3 * dx, -d / 2), (fx + 3 * dx, d / 2), (fx + 4 * dx, 0)]
        order = [1, 2, 3, 4, 9, 5, 6, 7, 8]
        pos = {n: slots[i] for i, n in enumerate(order)}
        pos[0] = (-C.T["length"] / 4 - 0.12, 0.0)
        balls = build_balls.build(pos)
        random.seed(3)
        for b in balls:
            b.rotation_euler = (random.uniform(-0.5, 0.5), random.uniform(-0.6, 0.6), random.uniform(1.0, 2.2))
        cue = build_cue.build()[0]
        cue.location = (pos[0][0] - R - 0.03, pos[0][1], R + 0.004)
        cue.rotation_euler = (0, math.radians(4.5), 0)
    return dict(table=table, room=room, lights=lights, balls=balls, cue=cue)


VIEWS = {
    "scene_wide": ((-3.6, -2.7, 0.95), (0.2, 0.1, -0.1), 24),
    "scene_break": ((-2.25, 0.0, 0.55), (0.6, 0, -0.05), 32),
    "scene_top": ((0.0, 0.0, 2.1), (0.0, 0.001, 0.0), 20),
    "table_corner": ((0.75, -0.25, 0.42), (1.27, -0.635, 0.0), 45),
    "table_side": ((0.25, -0.05, 0.3), (0, -0.66, 0.0), 45),
    "balls_rack": ((0.33, -0.44, 0.24), (0.72, 0, 0.02), 55),
    "cue_view": ((-1.35, -0.2, 0.2), (-0.75, 0.0, 0.03), 50),
    "room_back": ((3.4, 2.4, 0.7), (-0.5, -0.6, 0.1), 22),
}

if __name__ == "__main__":
    build_full_scene()
    RU.setup_cycles(samples=int(C.arg_value("--samples", "96")), res=(1280, 720))
    out = os.path.join(C.OUT_DIR, "preview")
    only = C.arg_value("--only")
    for name, (loc, tgt, lens) in VIEWS.items():
        if only and name not in only.split(","):
            continue
        RU.render(os.path.join(out, name + ".png"), RU.add_camera(name, loc, tgt, lens))
