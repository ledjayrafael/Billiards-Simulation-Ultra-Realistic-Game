"""Bake lightmap ruangan (UV channel 2) + panorama refleksi (HDR) dari tengah meja.

Pembagian cahaya (agar konsisten dengan renderer real-time):
  • Cahaya LANGSUNG dari 3 lampu meja → real-time di client (SpotLight + shadow map).
  • Lightmap = cahaya TAK LANGSUNG dari semua sumber + cahaya langsung dari sconce (emisif).
  • env_reflect.hdr : panorama lengkap (diffuser lampu terlihat) → refleksi spekular.
  • env_diffuse.hdr : panorama tanpa diffuser lampu → iradiansi difus (tanpa hitung-ganda lampu).
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import numpy as np  # noqa: E402

import build_room  # noqa: E402
import common as C  # noqa: E402
import render_util as RU  # noqa: E402

LM_SIZE = 2048


def make_lightmap_uv(objs):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
        lm = o.data.uv_layers.new(name="Lightmap")
        o.data.uv_layers.active = lm
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0025, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def bake_pass(objs, img, pass_filter, samples):
    scene = bpy.context.scene
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    for i, o in enumerate(objs):
        for ob in bpy.context.scene.objects:
            ob.select_set(False)
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.bake(type="DIFFUSE", pass_filter=pass_filter, margin=6, use_clear=(i == 0))
    arr = np.empty(LM_SIZE * LM_SIZE * 4, np.float32)
    img.pixels.foreach_get(arr)
    return arr.reshape(LM_SIZE, LM_SIZE, 4)[:, :, :3].copy()


def srgb_encode(x):
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(np.maximum(x, 1e-9), 1 / 2.4) - 0.055)


def bake_lightmap(room_objs, spots, out_dir, samples=384):
    make_lightmap_uv(room_objs)
    img = bpy.data.images.new("lightmap_bake", LM_SIZE, LM_SIZE, alpha=False, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    for o in room_objs:
        for mat in o.data.materials:
            node = mat.node_tree.nodes.new("ShaderNodeTexImage")
            node.image = img
            node.name = "BAKE_TARGET"
            mat.node_tree.nodes.active = node
    RU.setup_cycles(samples=samples)
    indirect = bake_pass(room_objs, img, {"INDIRECT"}, samples)
    for s in spots:
        s.hide_render = True
    direct_other = bake_pass(room_objs, img, {"DIRECT"}, max(64, samples // 3))
    for s in spots:
        s.hide_render = False
    # iradiansi E = π × (radiance difus tanpa albedo)
    E = np.maximum(0.0, indirect + direct_other) * math.pi
    scale = float(np.percentile(E, 99.0)) * 1.5  # sorotan dekat sconce boleh ter-clamp
    rng = np.random.default_rng(1)
    enc = srgb_encode(np.clip(E / scale, 0, 1)) + (rng.random(E.shape, dtype=np.float32) - 0.5) / 255.0
    out = bpy.data.images.new("lightmap_out", LM_SIZE, LM_SIZE, alpha=False)
    rgba = np.concatenate([np.clip(enc, 0, 1), np.ones((LM_SIZE, LM_SIZE, 1), np.float32)], axis=2)
    out.pixels.foreach_set(rgba.astype(np.float32).ravel())
    out.filepath_raw = os.path.join(out_dir, "room_lightmap.png")
    out.file_format = "PNG"
    out.save()
    for o in room_objs:
        for mat in o.data.materials:
            n = mat.node_tree.nodes.get("BAKE_TARGET")
            if n:
                mat.node_tree.nodes.remove(n)
    print(f"[bake] lightmap {LM_SIZE}² skala iradiansi {scale:.4f}")
    return scale


def render_env(out_dir, lamp_glow, samples=256):
    scene = RU.setup_cycles(samples=samples, res=(1024, 512))
    cam = RU.add_camera("EnvProbe", (0, 0, 0.14), (1, 0, 0.14), 20)
    cam.rotation_euler = (math.radians(90), 0, math.radians(-90))  # menghadap +X, atas = +Z
    cam.data.type = "PANO"
    try:
        cam.data.panorama_type = "EQUIRECTANGULAR"
    except Exception:  # noqa: BLE001  (Blender lama)
        cam.data.cycles.panorama_type = "EQUIRECTANGULAR"
    scene.camera = cam
    scene.view_settings.view_transform = "Standard"
    scene.render.image_settings.file_format = "HDR"
    try:
        scene.cycles.sample_clamp_indirect = 8.0
    except Exception:  # noqa: BLE001
        pass
    for name, hide in (("env_reflect", False), ("env_diffuse", True)):
        lamp_glow.hide_render = hide
        scene.render.filepath = os.path.join(out_dir, name + ".hdr")
        bpy.ops.render.render(write_still=True)
        print(f"[env] {name}.hdr")
    lamp_glow.hide_render = False
    scene.render.image_settings.file_format = "PNG"
    bpy.data.objects.remove(cam, do_unlink=True)


def write_manifest(out_dir, lm_scale):
    """scene.json: data lampu & lightmap untuk client (satuan fisik yang sama dengan Blender)."""
    manifest = {
        "lightmap": {"file": "room_lightmap.png", "intensity": lm_scale, "objects": ["Room", "Room_Ceiling"]},
        "env": {"reflect": "env_reflect.hdr", "diffuse": "env_diffuse.hdr", "probe": [0, 0, 0.14]},
        "spots": [
            {
                "pos": [x, 0, build_room.LAMP_Z],
                # Blender watt → intensitas radian three.js: I = P / (4π)
                "intensity": build_room.LAMP_POWER / (4 * math.pi),
                "angle": math.radians(build_room.SPOT_SIZE_DEG) / 2,
                "penumbra": build_room.SPOT_BLEND,
                "color": [1.0, 0.93, 0.82],
            }
            for x in build_room.LAMP_X
        ],
        "room": {"halfX": build_room.RX, "halfY": build_room.RY, "floorZ": build_room.FLOOR_Z, "ceilingZ": build_room.CEIL_Z},
    }
    with open(os.path.join(out_dir, "scene.json"), "w") as f:
        json.dump(manifest, f, indent=2)
