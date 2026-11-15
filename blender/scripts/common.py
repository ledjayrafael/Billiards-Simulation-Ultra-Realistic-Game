"""Util bersama untuk semua script aset. Satuan meter; sumbu: x = panjang meja, y = lebar, z = atas."""
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
TEX_DIR = os.path.join(ROOT, "blender", "textures")
OUT_DIR = os.path.join(ROOT, "blender", "out")
GEN_DIR = os.path.join(OUT_DIR, "generated")
SPECS = json.load(open(os.path.join(ROOT, "blender", "specs.json")))
T = SPECS["table"]
BALL_R = SPECS["ball"]["radius"]


def argv_after_dashes():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg_value(name, default=None):
    a = argv_after_dashes()
    return a[a.index(name) + 1] if name in a else default


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    return scene


# ───────────────────────── geometri meja (identik dengan packages/physics/src/table.ts) ─────────────────────────

def table_geometry():
    hl, hw = T["length"] / 2, T["width"] / 2
    c = T["cornerMouth"] / math.sqrt(2)
    s = T["sideMouth"] / 2
    ca, sa = math.radians(T["cornerJawAngleDeg"]), math.radians(T["sideJawAngleDeg"])
    cw = T["cushionWidth"]
    defs = [
        (-hl + c, hw, -s, hw, 0, 1, ca, sa),
        (s, hw, hl - c, hw, 0, 1, sa, ca),
        (hl, hw - c, hl, -hw + c, 1, 0, ca, ca),
        (hl - c, -hw, s, -hw, 0, -1, ca, sa),
        (-s, -hw, -hl + c, -hw, 0, -1, sa, ca),
        (-hl, -hw + c, -hl, hw - c, -1, 0, ca, ca),
    ]
    cushions = []
    for ax, ay, bx, by, nx, ny, angA, angB in defs:
        ln = math.hypot(bx - ax, by - ay)
        dx, dy = (bx - ax) / ln, (by - ay) / ln
        bA, bB = math.pi - angA, math.pi - angB
        jA = (-dx * math.cos(bA) + nx * math.sin(bA), -dy * math.cos(bA) + ny * math.sin(bA))
        jB = (dx * math.cos(bB) + nx * math.sin(bB), dy * math.cos(bB) + ny * math.sin(bB))
        cushions.append(dict(a=(ax, ay), b=(bx, by), n=(nx, ny), d=(dx, dy), jA=jA, jB=jB,
                             sinA=math.sin(bA), sinB=math.sin(bB), cw=cw))
    co = (T["cornerShelf"] + T["cornerPocketRadius"]) / math.sqrt(2) - c / 2
    so = T["sideShelf"] + T["sidePocketRadius"]
    rc, rs = T["cornerPocketRadius"], T["sidePocketRadius"]
    pockets = [
        (-hl - co, hw + co, rc, True), (0, hw + so, rs, False), (hl + co, hw + co, rc, True),
        (hl + co, -hw - co, rc, True), (0, -hw - so, rs, False), (-hl - co, -hw - co, rc, True),
    ]
    return cushions, pockets


# ───────────────────────── mesh helper ─────────────────────────

def new_object(name, verts, faces, collection=None):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    (collection or bpy.context.scene.collection).objects.link(obj)
    return obj


def obj_from_bmesh(name, bm, collection=None):
    mesh = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    (collection or bpy.context.scene.collection).objects.link(obj)
    return obj


def shade_smooth(obj, angle_deg=35.0):
    """Smooth shading dengan tepi tajam di atas sudut tertentu (tanpa modifier)."""
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    lim = math.radians(angle_deg)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.calc_face_angle(0.0) <= lim
        else:
            e.smooth = False
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def apply_modifiers(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    new_mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    old = obj.data
    obj.modifiers.clear()
    obj.data = new_mesh
    new_mesh.name = obj.name
    bpy.data.meshes.remove(old)
    return obj


def boolean(obj, cutter, op="DIFFERENCE"):
    m = obj.modifiers.new("bool", "BOOLEAN")
    m.operation = op
    m.object = cutter
    try:
        m.solver = "EXACT"
    except Exception:
        pass
    apply_modifiers(obj)


def bevel(obj, width, segments=3, angle_deg=40):
    m = obj.modifiers.new("bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(angle_deg)
    apply_modifiers(obj)


def prism(name, outline, z0, z1):
    """Prisma dari poligon 2D (CCW) antara z0 dan z1."""
    bm = bmesh.new()
    bot = [bm.verts.new((x, y, z0)) for x, y in outline]
    top = [bm.verts.new((x, y, z1)) for x, y in outline]
    n = len(outline)
    bm.faces.new(top)
    bm.faces.new(list(reversed(bot)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bot[i], bot[j], top[j], top[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return obj_from_bmesh(name, bm)


def rounded_rect(hx, hy, r, seg=8):
    pts = []
    for cx, cy, a0 in ((hx - r, hy - r, 0), (-hx + r, hy - r, 90), (-hx + r, -hy + r, 180), (hx - r, -hy + r, 270)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def circle_pts(cx, cy, r, seg=48):
    return [(cx + r * math.cos(2 * math.pi * i / seg), cy + r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]


def box_uv(obj, scale=1.0, grain_fn=None, name="UVMap"):
    """UV box-projection per face. grain_fn(face_center, normal) → True bila serat diputar 90°."""
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    uv = bm.loops.layers.uv.get(name) or bm.loops.layers.uv.new(name)
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        c = f.calc_center_median()
        rot = grain_fn(c, n) if grain_fn else False
        for loop in f.loops:
            p = loop.vert.co
            if ax == 2:
                u, v = p.x, p.y
            elif ax == 0:
                u, v = p.y, p.z
            else:
                u, v = p.x, p.z
            if rot:
                u, v = v, -u
            loop[uv].uv = (u * scale, v * scale)
    bm.to_mesh(mesh)
    bm.free()


# ───────────────────────── gambar & material ─────────────────────────

def save_image(name, arr, colorspace="sRGB"):
    """arr: (h, w, 3|4) float 0..1, baris 0 = atas. Simpan PNG ke GEN_DIR dan kembalikan bpy image."""
    os.makedirs(GEN_DIR, exist_ok=True)
    h, w = arr.shape[:2]
    if arr.shape[2] == 3:
        arr = np.concatenate([arr, np.ones((h, w, 1), arr.dtype)], axis=2)
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.pixels.foreach_set(np.flipud(arr).astype(np.float32).ravel())
    img.filepath_raw = os.path.join(GEN_DIR, name + ".png")
    img.file_format = "PNG"
    img.save()
    img.colorspace_settings.name = colorspace
    return img


def load_image(filename, colorspace="sRGB"):
    img = bpy.data.images.load(os.path.join(TEX_DIR, filename), check_existing=True)
    img.colorspace_settings.name = colorspace
    return img


def make_material(name, color=(0.8, 0.8, 0.8), rough=0.5, metallic=0.0, diff=None, nor=None, rough_img=None,
                  tint=None, normal_strength=1.0, coat=0.0, coat_rough=0.03, sheen=0.0, sheen_rough=0.5,
                  emission=None, emission_strength=0.0, uv_scale=None, ior=1.5):
    """Material Principled yang kompatibel dengan eksportir glTF."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["IOR"].default_value = ior
    if coat > 0:
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = coat_rough
    if sheen > 0:
        bsdf.inputs["Sheen Weight"].default_value = sheen
        bsdf.inputs["Sheen Roughness"].default_value = sheen_rough
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    mapping = None
    if uv_scale is not None and (diff or nor or rough_img):
        tc = nt.nodes.new("ShaderNodeTexCoord")
        mapping = nt.nodes.new("ShaderNodeMapping")
        mapping.inputs["Scale"].default_value = (uv_scale[0], uv_scale[1], 1)
        nt.links.new(tc.outputs["UV"], mapping.inputs["Vector"])

    def tex(img):
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = img
        if mapping:
            nt.links.new(mapping.outputs["Vector"], node.inputs["Vector"])
        return node

    if diff:
        t = tex(diff)
        if tint is not None:
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1.0
            nt.links.new(t.outputs["Color"], mix.inputs["A"])
            mix.inputs["B"].default_value = (*tint, 1)
            nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
        else:
            nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    if rough_img:
        t = tex(rough_img)
        nt.links.new(t.outputs["Color"], bsdf.inputs["Roughness"])
    if nor:
        t = tex(nor)
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = normal_strength
        nt.links.new(t.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def join(objs, name):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    return o


def tri_count(objs):
    total = 0
    for o in objs:
        if o.type == "MESH":
            total += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return total


# ───────────────────────── ekspor ─────────────────────────

def export_glb(path, objs=None, cameras=False, animations=False, lights=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for o in bpy.context.scene.objects:
        o.select_set(False)
    if objs is not None:
        for o in objs:
            o.select_set(True)
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    kw = dict(
        filepath=path, export_format="GLB", use_selection=objs is not None, export_apply=True,
        export_yup=True, export_texcoords=True, export_normals=True, export_tangents=True,
        export_materials="EXPORT", export_image_format="AUTO", export_cameras=cameras,
        export_lights=lights, export_animations=animations, export_extras=True,
        export_attributes=False, export_skins=False, export_morph=False,
        export_force_sampling=True, export_frame_range=True, export_bake_animation=False,
        export_animation_mode="ACTIONS", export_optimize_animation_size=False,
    )
    kw = {k: v for k, v in kw.items() if k in props}
    bpy.ops.export_scene.gltf(**kw)
    print(f"[export] {os.path.relpath(path, ROOT)}  {os.path.getsize(path) / 1024:.0f} KB")


def save_blend(name):
    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, name + ".blend"), check_existing=False)
