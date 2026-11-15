"""Jalur kamera sinematik → animasi glTF pada objek kamera (Cam_Intro, Cam_BreakPrep, Cam_RackWin)."""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import common as C  # noqa: E402

FPS = 30


def animated_camera(name, keys, lens=32.0):
    """keys: [(detik, posisi kamera, titik yang dilihat)]. Interpolasi Bezier, rotasi di-bake per frame."""
    cam_data = bpy.data.cameras.new(name)
    cam_data.lens = lens
    cam_data.sensor_width = 36
    cam_data.clip_start = 0.02
    cam_data.clip_end = 60
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.scene.collection.objects.link(cam)
    # dua empty beranimasi (posisi & target) → sampel halus → keyframe kamera per frame
    pos = bpy.data.objects.new(name + "_pos", None)
    tgt = bpy.data.objects.new(name + "_tgt", None)
    for e in (pos, tgt):
        bpy.context.scene.collection.objects.link(e)
    for t, p, look in keys:
        f = round(t * FPS)
        pos.location = p
        pos.keyframe_insert("location", frame=f)
        tgt.location = look
        tgt.keyframe_insert("location", frame=f)
    scene = bpy.context.scene
    end = round(keys[-1][0] * FPS)
    cam.rotation_mode = "QUATERNION"
    prev = None
    samples = []
    for f in range(0, end + 1):
        scene.frame_set(f)
        p = pos.matrix_world.translation.copy()
        look = tgt.matrix_world.translation.copy()
        q = (look - p).to_track_quat("-Z", "Y")
        if prev is not None and prev.dot(q) < 0:
            q.negate()
        prev = q.copy()
        samples.append((f, p, q))
    for f, p, q in samples:
        cam.location = p
        cam.rotation_quaternion = q
        cam.keyframe_insert("location", frame=f)
        cam.keyframe_insert("rotation_quaternion", frame=f)
    cam.animation_data.action.name = name
    for e in (pos, tgt):
        bpy.data.objects.remove(e, do_unlink=True)
    return cam


def build():
    scene = bpy.context.scene
    scene.render.fps = FPS
    cams = []
    # Intro: sapuan mengelilingi meja, berakhir di belakang rail kepala
    cams.append(animated_camera("Cam_Intro", [
        (0.0, (3.3, -2.5, 1.55), (0.9, 0.0, 0.0)),
        (2.2, (2.6, 1.9, 0.85), (0.5, 0.0, 0.0)),
        (4.6, (-0.6, 2.3, 0.55), (0.0, 0.0, 0.0)),
        (7.0, (-2.75, 0.0, 0.72), (0.35, 0.0, 0.0)),
    ], lens=30))
    # Break prep: dari atas turun ke posisi break
    cams.append(animated_camera("Cam_BreakPrep", [
        (0.0, (0.25, -0.02, 2.0), (0.25, 0.0, 0.0)),
        (1.6, (-1.5, -0.3, 1.3), (0.3, 0.0, 0.0)),
        (3.2, (-2.75, 0.0, 0.72), (0.35, 0.0, 0.0)),
    ], lens=30))
    # Rack win: orbit pelan
    r, h = 2.9, 0.95
    keys = []
    for i in range(7):
        a = math.radians(-150 + i * 20)
        keys.append((i * 8.0 / 6, (r * math.cos(a), r * 0.8 * math.sin(a), h - 0.03 * i), (0.0, 0.0, 0.0)))
    cams.append(animated_camera("Cam_RackWin", keys, lens=36))
    scene.frame_start = 0
    scene.frame_end = max(int(c.animation_data.action.frame_range[1]) for c in cams)
    return cams


if __name__ == "__main__":
    C.reset_scene()
    cams = build()
    out = C.arg_value("--out", os.path.join(C.OUT_DIR, "glb"))
    C.export_glb(os.path.join(out, "cameras.glb"), cams, cameras=True, animations=True)
