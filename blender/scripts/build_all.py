"""Bangun semua aset secara headless dan ekspor GLB mentah + lightmap + panorama.

  $BLENDER_BIN -b --factory-startup -P blender/scripts/build_all.py -- --out blender/out/glb [--fast]

Idempoten: tiap aset dibangun dari scene kosong. Kompresi & penyalinan ke client dilakukan oleh
tools/export-assets.mjs."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402

import bake_lighting  # noqa: E402
import build_balls  # noqa: E402
import build_cameras  # noqa: E402
import build_cue  # noqa: E402
import build_room  # noqa: E402
import build_table  # noqa: E402
import common as C  # noqa: E402

out = os.path.abspath(C.arg_value("--out", os.path.join(C.OUT_DIR, "glb")))
fast = "--fast" in C.argv_after_dashes()
only = C.arg_value("--only")
want = lambda n: only is None or n in only.split(",")  # noqa: E731
os.makedirs(out, exist_ok=True)

if want("table"):
    C.reset_scene()
    objs = build_table.build()
    print(f"[table] {C.tri_count(objs)} tris")
    C.export_glb(os.path.join(out, "table.glb"), objs)

if want("balls"):
    C.reset_scene()
    objs = build_balls.build()
    print(f"[balls] {C.tri_count(objs)} tris")
    C.export_glb(os.path.join(out, "balls.glb"), objs)

if want("cue"):
    C.reset_scene()
    objs = build_cue.build()
    print(f"[cue] {C.tri_count(objs)} tris")
    C.export_glb(os.path.join(out, "cue.glb"), objs)

if want("cameras"):
    C.reset_scene()
    cams = build_cameras.build()
    C.export_glb(os.path.join(out, "cameras.glb"), cams, cameras=True, animations=True)

if want("room"):
    # ruangan + meja (sebagai penghalang/pemantul cahaya) → bake → ekspor
    C.reset_scene()
    build_table.build()
    room = build_room.build()
    spots = build_room.build_lights()
    world = bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0, 0, 0, 1)
    lm_objs = [room["room"], room["ceiling"]]
    scale = bake_lighting.bake_lightmap(lm_objs, spots, out, samples=96 if fast else 384)
    bake_lighting.render_env(out, room["lamp_glow"], samples=96 if fast else 384)
    bake_lighting.write_manifest(out, scale)
    objs = [room["room"], room["ceiling"], room["glow"], room["lamp"], room["lamp_glow"], *room["props"]]
    print(f"[room] {C.tri_count(objs)} tris")
    C.export_glb(os.path.join(out, "room.glb"), objs)
    C.save_blend("scene")

print("[build_all] selesai")
