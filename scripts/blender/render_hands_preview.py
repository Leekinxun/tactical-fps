#!/usr/bin/env python3
"""Render an offline close-up grip preview for the tactical hands asset."""

from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
ASSET_PATH = ROOT / "public" / "models" / "tactical-hands" / "tactical-hands.json"
OUTPUT_PATH = ROOT / ".omx" / "visual-review" / "tactical-hands-blender-rifle-grip.png"


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def material(name: str, color: tuple[float, float, float, float], roughness: float = 0.82) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Alpha"].default_value = color[3]
    if color[3] < 1:
        mat.blend_method = "BLEND"
    return mat


def create_mesh(part: dict, mat: bpy.types.Material, parent: bpy.types.Object) -> bpy.types.Object:
    verts = [tuple(part["positions"][i:i + 3]) for i in range(0, len(part["positions"]), 3)]
    faces = [tuple(part["indices"][i:i + 3]) for i in range(0, len(part["indices"]), 3)]
    mesh = bpy.data.meshes.new(part["name"])
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(part["name"], mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    obj.parent = parent
    return obj


def add_box(name: str, location: tuple[float, float, float], scale: tuple[float, float, float], mat: bpy.types.Material, parent: bpy.types.Object) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    obj.parent = parent
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    bevel = obj.modifiers.new("soft-bevel", "BEVEL")
    bevel.width = min(scale) * 0.12
    bevel.segments = 2
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    bpy.ops.object.shade_smooth()
    return obj


def add_cylinder(name: str, location: tuple[float, float, float], radius: float, depth: float, mat: bpy.types.Material, parent: bpy.types.Object) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=radius, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    obj.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return obj


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    direction = target - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_hand_panel(
    variant: dict,
    hand: str,
    root_name: str,
    location: tuple[float, float, float],
    rotation: tuple[float, float, float],
    mats: dict[str, bpy.types.Material],
    proxy: bpy.types.Material,
) -> None:
    root = bpy.data.objects.new(root_name, None)
    bpy.context.collection.objects.link(root)
    root.location = location
    root.rotation_euler = rotation
    for part in variant["parts"]:
        if part["name"].startswith(f"{hand}-") and part["role"] in {"glove", "cuff"}:
            create_mesh(part, mats[part["materialRole"]], root)
    if hand == "trigger":
        add_box("right-hand-pistol-grip-reference", (0.029, -0.010, 0.060), (0.042, 0.045, 0.130), proxy, root)
        add_box("right-hand-trigger-reference", (0.044, -0.030, 0.095), (0.014, 0.018, 0.040), proxy, root)
    else:
        add_cylinder("left-hand-handguard-reference", (0.022, -0.010, 0.078), 0.026, 0.210, proxy, root)


def main() -> None:
    clear_scene()
    asset = json.loads(ASSET_PATH.read_text(encoding="utf-8"))
    variant = asset["variants"]["rifle"]

    glove = material("preview-glove-olive", (0.030, 0.115, 0.040, 1))
    rubber = material("preview-rubber", (0.018, 0.022, 0.020, 1))
    sleeve = material("preview-sleeve", (0.06, 0.105, 0.075, 1))
    proxy = material("preview-gun-reference", (0.035, 0.038, 0.036, 0.58), 0.70)
    mats = {"glove": glove, "rubber": rubber, "sleeve": sleeve}

    add_hand_panel(variant, "trigger", "right-trigger-hand-inspection", (-0.145, 0.0, 0.0), (0.10, -0.16, -0.08), mats, proxy)
    add_hand_panel(variant, "support", "left-support-hand-inspection", (0.125, 0.0, 0.0), (0.12, 0.15, 0.14), mats, proxy)

    bpy.ops.object.light_add(type="AREA", location=(0.0, -0.38, 0.42))
    light = bpy.context.object
    light.name = "softbox"
    light.data.energy = 120
    light.data.size = 0.7

    bpy.ops.object.camera_add(location=(0.0, -0.42, 0.185))
    camera = bpy.context.object
    look_at(camera, Vector((0.0, -0.005, 0.072)))
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 0.430
    bpy.context.scene.camera = camera

    bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT"
    bpy.context.scene.render.resolution_x = 1280
    bpy.context.scene.render.resolution_y = 900
    bpy.context.scene.eevee.taa_render_samples = 64
    bpy.context.scene.view_settings.view_transform = "Standard"
    bpy.context.scene.view_settings.look = "Medium High Contrast"
    bpy.context.scene.view_settings.exposure = -2.3
    bpy.context.scene.view_settings.gamma = 1
    bpy.context.scene.world.color = (0.04, 0.045, 0.045)
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.filepath = str(OUTPUT_PATH)
    bpy.ops.render.render(write_still=True)
    print(str(OUTPUT_PATH))


if __name__ == "__main__":
    main()
