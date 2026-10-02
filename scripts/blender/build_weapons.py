#!/usr/bin/env python3
"""Build original tactical weapon meshes with Blender.

The runtime reads the compact JSON files directly; the GLB and .blend files are
kept as inspectable source and interchange artifacts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[2]
ASSET_DIR = ROOT / "assets" / "blender" / "weapons"
PUBLIC_DIR = ROOT / "public" / "models" / "tactical-weapons"
RENDER_DIR = ROOT / "assets" / "blender" / "weapons"


@dataclass(frozen=True)
class MaterialSpec:
    color: str
    metallic: float
    roughness: float


MATERIALS = {
    "blackened_steel": MaterialSpec("#343a40", 0.65, 0.38),
    "matte_steel": MaterialSpec("#51585e", 0.65, 0.50),
    "worn_edges": MaterialSpec("#585f64", 0.78, 0.30),
    "polymer_black": MaterialSpec("#30342f", 0.02, 0.85),
    "polymer_od": MaterialSpec("#424937", 0.02, 0.68),
    "rubber": MaterialSpec("#171c19", 0.0, 0.94),
    "glass": MaterialSpec("#101d25", 0.0, 0.12),
    "brass": MaterialSpec("#b6904a", 0.8, 0.28),
    "dark_recess": MaterialSpec("#040506", 0.1, 0.85),
}


def srgb_channel_to_linear(value: float) -> float:
    if value <= 0.04045:
        return value / 12.92
    return ((value + 0.055) / 1.055) ** 2.4


def hex_to_linear_rgba(hex_color: str) -> tuple[float, float, float, float]:
    hex_color = hex_color.lstrip("#")
    srgb = [int(hex_color[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(srgb_channel_to_linear(c) for c in srgb) + (1.0,)


def make_materials() -> dict[str, bpy.types.Material]:
    mats: dict[str, bpy.types.Material] = {}
    for name, spec in MATERIALS.items():
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = hex_to_linear_rgba(spec.color)
            bsdf.inputs["Metallic"].default_value = spec.metallic
            bsdf.inputs["Roughness"].default_value = spec.roughness
        mats[name] = mat
    return mats


def reset_scene() -> dict[str, bpy.types.Material]:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for material in list(bpy.data.materials):
        bpy.data.materials.remove(material)
    bpy.context.scene.render.engine = "CYCLES"
    bpy.context.scene.cycles.samples = 40
    bpy.context.scene.view_settings.view_transform = "Filmic"
    bpy.context.scene.view_settings.look = "Medium High Contrast"
    bpy.context.scene.view_settings.exposure = 0.8
    bpy.context.scene.world = bpy.data.worlds.new("studio_world")
    bpy.context.scene.world.color = (0.12, 0.125, 0.13)
    return make_materials()


def role_object(obj: bpy.types.Object, role: str, material: str) -> bpy.types.Object:
    obj["role"] = role
    obj["materialName"] = material
    return obj


def box(
    name: str,
    role: str,
    mat: bpy.types.Material,
    loc: tuple[float, float, float],
    scale: tuple[float, float, float],
    rot: tuple[float, float, float] = (0, 0, 0),
    bevel: float = 0.008,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel > 0:
        mod = obj.modifiers.new("machined bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.affect = "EDGES"
        obj.modifiers.new("weighted normals", "WEIGHTED_NORMAL")
    return role_object(obj, role, mat.name)


def cyl(
    name: str,
    role: str,
    mat: bpy.types.Material,
    loc: tuple[float, float, float],
    radius: float,
    depth: float,
    rot: tuple[float, float, float] = (0, 0, 0),
    vertices: int = 32,
    bevel: float = 0.003,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    if bevel > 0:
        mod = obj.modifiers.new("crown bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.affect = "EDGES"
        obj.modifiers.new("weighted normals", "WEIGHTED_NORMAL")
    return role_object(obj, role, mat.name)


def trapezoid_prism(
    name: str,
    role: str,
    mat: bpy.types.Material,
    loc: tuple[float, float, float],
    width_bottom: float,
    width_top: float,
    height: float,
    depth: float,
    bevel: float = 0.006,
) -> bpy.types.Object:
    xb = width_bottom / 2
    xt = width_top / 2
    y0 = -height / 2
    y1 = height / 2
    z0 = -depth / 2
    z1 = depth / 2
    verts = [(-xb, y0, z0), (xb, y0, z0), (xt, y1, z0), (-xt, y1, z0), (-xb, y0, z1), (xb, y0, z1), (xt, y1, z1), (-xt, y1, z1)]
    faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (3, 2, 6, 7), (1, 5, 6, 2), (0, 3, 7, 4)]
    mesh = bpy.data.meshes.new(name + "_mesh")
    mesh.from_pydata(verts, [], faces)
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    obj.data.materials.append(mat)
    if bevel > 0:
        mod = obj.modifiers.new("receiver bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        obj.modifiers.new("weighted normals", "WEIGHTED_NORMAL")
    return role_object(obj, role, mat.name)


def slot_set(prefix: str, mats: dict[str, bpy.types.Material], z0: float, count: int, x: float, y: float, side: int, span: float, height: float = 0.024) -> list[bpy.types.Object]:
    parts = []
    for i in range(count):
        z = z0 + i * span
        parts.append(box(f"{prefix}_cooling_slot_{side}_{i}", f"{prefix}_slot_{side}_{i}", mats["dark_recess"], (side * x, y, z), (0.006, height, span * 0.48), bevel=0.001))
    return parts


def rail_teeth(prefix: str, mats: dict[str, bpy.types.Material], start: float, count: int, y: float, z_step: float = 0.038) -> list[bpy.types.Object]:
    return [
        box(f"{prefix}_rail_tooth_{i}", f"{prefix}_rail_tooth_{i}", mats["worn_edges"], (0, y, start + i * z_step), (0.12, 0.012, 0.018), bevel=0.002)
        for i in range(count)
    ]


def build_px9(mats: dict[str, bpy.types.Material]) -> tuple[list[bpy.types.Object], dict[str, list[float]]]:
    objs: list[bpy.types.Object] = []
    objs.append(trapezoid_prism("px9_slide", "slide", mats["blackened_steel"], (0, 0.055, 0.18), 0.172, 0.142, 0.092, 0.44, 0.006))
    objs.append(trapezoid_prism("px9_frame", "frame", mats["polymer_black"], (0, -0.025, 0.13), 0.16, 0.134, 0.072, 0.34, 0.007))
    objs.append(box("px9_dust_cover_rail", "dust_cover_rail", mats["matte_steel"], (0, -0.065, 0.245), (0.13, 0.03, 0.17), bevel=0.004))
    objs.append(box("px9_grip", "grip", mats["polymer_black"], (0, -0.205, -0.015), (0.13, 0.31, 0.115), rot=(-0.17, 0, 0), bevel=0.012))
    objs.append(box("px9_backstrap", "backstrap", mats["rubber"], (0, -0.188, -0.079), (0.115, 0.29, 0.018), rot=(-0.17, 0, 0), bevel=0.006))
    objs.append(box("px9_magazine", "magazine", mats["matte_steel"], (0, -0.275, 0.005), (0.105, 0.26, 0.085), rot=(-0.17, 0, 0), bevel=0.006))
    objs.append(box("px9_mag_baseplate", "mag_baseplate", mats["rubber"], (0, -0.407, -0.018), (0.125, 0.028, 0.115), rot=(-0.17, 0, 0), bevel=0.006))
    objs.append(cyl("px9_barrel", "barrel", mats["matte_steel"], (0, 0.055, 0.41), 0.034, 0.046, vertices=36))
    objs.append(cyl("px9_muzzle_crown", "muzzle_crown", mats["dark_recess"], (0, 0.055, 0.436), 0.021, 0.006, vertices=36, bevel=0.001))
    objs.append(box("px9_ejection_port", "ejection_port", mats["dark_recess"], (0.028, 0.106, 0.19), (0.082, 0.006, 0.102), bevel=0.001))
    objs.append(box("px9_chamber_flash", "chamber", mats["worn_edges"], (0.026, 0.111, 0.19), (0.055, 0.005, 0.074), bevel=0.001))
    objs.append(box("px9_trigger_guard_front", "trigger_guard_front", mats["polymer_black"], (0, -0.096, 0.158), (0.12, 0.022, 0.022), bevel=0.005))
    objs.append(box("px9_trigger_guard_bottom", "trigger_guard_bottom", mats["polymer_black"], (0, -0.145, 0.105), (0.118, 0.02, 0.09), bevel=0.005))
    objs.append(box("px9_trigger", "trigger", mats["matte_steel"], (0, -0.122, 0.078), (0.035, 0.074, 0.022), rot=(-0.26, 0, 0), bevel=0.004))
    for side in (-1, 1):
        for i in range(7):
            objs.append(box(f"px9_rear_serration_{side}_{i}", f"rear_serration_{side}_{i}", mats["worn_edges"], (side * 0.077, 0.056, 0.0 + i * 0.018), (0.006, 0.068, 0.006), rot=(0, 0, side * 0.34), bevel=0.001))
        for i in range(5):
            objs.append(box(f"px9_front_serration_{side}_{i}", f"front_serration_{side}_{i}", mats["worn_edges"], (side * 0.077, 0.058, 0.315 + i * 0.015), (0.006, 0.058, 0.005), rot=(0, 0, side * 0.34), bevel=0.001))
        for i in range(4):
            objs.append(box(f"px9_grip_texture_{side}_{i}", f"grip_texture_{side}_{i}", mats["rubber"], (side * 0.067, -0.225 + i * 0.035, -0.026 + i * 0.006), (0.004, 0.018, 0.082), rot=(-0.17, 0, 0), bevel=0.001))
    objs.append(box("px9_rear_sight", "rear_sight", mats["matte_steel"], (0, 0.112, 0.006), (0.096, 0.026, 0.032), bevel=0.003))
    objs.append(box("px9_front_sight", "front_sight", mats["matte_steel"], (0, 0.111, 0.363), (0.038, 0.022, 0.025), bevel=0.002))
    return objs, {"muzzle": [0, 0.055, 0.445], "gripRight": [0.085, -0.21, -0.03], "gripLeft": [-0.0595, -0.202, 0.0059]}


def build_vx7(mats: dict[str, bpy.types.Material]) -> tuple[list[bpy.types.Object], dict[str, list[float]]]:
    objs: list[bpy.types.Object] = []
    objs.append(trapezoid_prism("vx7_upper_receiver", "upper_receiver", mats["blackened_steel"], (0, 0.03, 0.16), 0.16, 0.13, 0.116, 0.36, 0.008))
    objs.append(box("vx7_lower_receiver", "lower_receiver", mats["polymer_black"], (0, -0.045, 0.08), (0.142, 0.074, 0.25), bevel=0.008))
    objs.append(box("vx7_stock_tube", "stock_tube", mats["matte_steel"], (0, -0.002, -0.17), (0.05, 0.05, 0.28), bevel=0.008))
    objs.append(box("vx7_collapsed_stock", "stock", mats["polymer_od"], (0, -0.035, -0.34), (0.17, 0.14, 0.12), bevel=0.012))
    objs.append(box("vx7_barrel", "barrel", mats["matte_steel"], (0, 0.026, 0.44), (0.042, 0.042, 0.25), bevel=0.006))
    objs.append(cyl("vx7_muzzle_device", "muzzle_device", mats["blackened_steel"], (0, 0.026, 0.595), 0.035, 0.065, vertices=32, bevel=0.002))
    objs.append(cyl("vx7_muzzle_crown", "muzzle_crown", mats["dark_recess"], (0, 0.026, 0.632), 0.021, 0.006, vertices=32, bevel=0.001))
    objs.append(box("vx7_handguard_top", "handguard_top", mats["polymer_black"], (0, 0.075, 0.395), (0.158, 0.032, 0.265), bevel=0.006))
    objs.append(box("vx7_handguard_bottom", "handguard_bottom", mats["polymer_black"], (0, -0.027, 0.395), (0.148, 0.032, 0.265), bevel=0.006))
    for side in (-1, 1):
        for i in range(6):
            # Separate bridge ribs leave actual see-through M-LOK style gaps along the fore-end.
            objs.append(box(f"vx7_handguard_side_bridge_{side}_{i}", f"handguard_side_bridge_{side}_{i}", mats["polymer_black"], (side * 0.074, 0.024, 0.275 + i * 0.045), (0.018, 0.085, 0.018), bevel=0.004))
    objs.extend(rail_teeth("vx7", mats, 0.02, 14, 0.101, 0.035))
    objs.append(box("vx7_magazine", "magazine", mats["matte_steel"], (0, -0.208, 0.093), (0.105, 0.315, 0.07), rot=(-0.2, 0, 0), bevel=0.008))
    for i in range(5):
        objs.append(box(f"vx7_mag_rib_{i}", f"mag_rib_{i}", mats["worn_edges"], (0, -0.105 - i * 0.043, 0.08 + i * 0.009), (0.108, 0.008, 0.076), rot=(-0.2, 0, 0), bevel=0.001))
    objs.append(box("vx7_pistol_grip", "pistol_grip", mats["polymer_black"], (0, -0.20, -0.055), (0.112, 0.245, 0.09), rot=(-0.30, 0, 0), bevel=0.01))
    objs.append(box("vx7_trigger_guard", "trigger_guard", mats["polymer_black"], (0, -0.12, 0.03), (0.12, 0.024, 0.09), bevel=0.006))
    objs.append(box("vx7_trigger", "trigger", mats["matte_steel"], (0, -0.112, 0.013), (0.033, 0.07, 0.018), rot=(-0.28, 0, 0), bevel=0.003))
    objs.append(box("vx7_bolt", "bolt", mats["worn_edges"], (0.071, 0.029, 0.155), (0.012, 0.052, 0.115), bevel=0.002))
    objs.append(box("vx7_charging_handle", "charging_handle", mats["matte_steel"], (0.094, 0.073, 0.045), (0.064, 0.016, 0.04), bevel=0.003))
    return objs, {"muzzle": [0, 0.026, 0.635], "gripRight": [0.08, -0.20, -0.055], "gripLeft": [-0.095, 0.01, 0.43]}


def build_rift6(mats: dict[str, bpy.types.Material]) -> tuple[list[bpy.types.Object], dict[str, list[float]]]:
    objs: list[bpy.types.Object] = []
    objs.append(trapezoid_prism("rift6_receiver", "receiver", mats["blackened_steel"], (0, 0.02, 0.06), 0.19, 0.155, 0.13, 0.31, 0.009))
    objs.append(cyl("rift6_barrel", "barrel", mats["matte_steel"], (0, 0.05, 0.51), 0.032, 0.82, vertices=36, bevel=0.002))
    objs.append(cyl("rift6_mag_tube", "mag_tube", mats["blackened_steel"], (0, -0.027, 0.48), 0.027, 0.68, vertices=32, bevel=0.002))
    objs.append(cyl("rift6_muzzle_crown", "muzzle_crown", mats["dark_recess"], (0, 0.05, 0.93), 0.022, 0.008, vertices=32, bevel=0.001))
    objs.append(box("rift6_pump", "pump", mats["polymer_od"], (0, -0.048, 0.36), (0.18, 0.082, 0.255), bevel=0.012))
    for side in (-1, 1):
        for i in range(7):
            objs.append(box(f"rift6_pump_groove_{side}_{i}", f"pump_groove_{side}_{i}", mats["rubber"], (side * 0.092, -0.047, 0.265 + i * 0.03), (0.005, 0.07, 0.012), bevel=0.001))
    objs.append(box("rift6_stock_neck", "stock_neck", mats["polymer_black"], (0, -0.045, -0.16), (0.12, 0.09, 0.22), bevel=0.01))
    objs.append(box("rift6_stock", "stock", mats["polymer_black"], (0, -0.06, -0.44), (0.19, 0.17, 0.34), rot=(-0.05, 0, 0), bevel=0.014))
    objs.append(box("rift6_recoil_pad", "recoil_pad", mats["rubber"], (0, -0.055, -0.635), (0.205, 0.18, 0.034), bevel=0.009))
    objs.append(box("rift6_pistol_grip", "pistol_grip", mats["polymer_black"], (0, -0.215, -0.03), (0.125, 0.235, 0.094), rot=(-0.38, 0, 0), bevel=0.012))
    objs.append(box("rift6_trigger_guard", "trigger_guard", mats["blackened_steel"], (0, -0.118, -0.002), (0.13, 0.026, 0.092), bevel=0.006))
    objs.append(box("rift6_trigger", "trigger", mats["matte_steel"], (0, -0.13, -0.012), (0.035, 0.075, 0.022), rot=(-0.22, 0, 0), bevel=0.003))
    objs.append(box("rift6_loading_port", "loading_port", mats["dark_recess"], (0, -0.048, 0.095), (0.126, 0.012, 0.11), bevel=0.002))
    objs.append(box("rift6_ejection_port", "ejection_port", mats["dark_recess"], (0.079, 0.037, 0.065), (0.008, 0.065, 0.125), bevel=0.001))
    objs.append(box("rift6_shell_lifter", "shell_lifter", mats["worn_edges"], (0, -0.056, 0.088), (0.098, 0.006, 0.086), bevel=0.002))
    objs.append(box("rift6_front_sight", "front_sight", mats["worn_edges"], (0, 0.094, 0.87), (0.038, 0.026, 0.018), bevel=0.002))
    return objs, {"muzzle": [0, 0.05, 0.938], "gripRight": [0.085, -0.21, -0.045], "gripLeft": [-0.11, -0.052, 0.36]}


def build_needle50(mats: dict[str, bpy.types.Material]) -> tuple[list[bpy.types.Object], dict[str, list[float]]]:
    objs: list[bpy.types.Object] = []
    objs.append(trapezoid_prism("needle50_chassis", "chassis", mats["polymer_od"], (0, -0.035, 0.05), 0.19, 0.145, 0.115, 0.52, 0.01))
    objs.append(box("needle50_receiver", "receiver", mats["blackened_steel"], (0, 0.04, 0.12), (0.154, 0.115, 0.35), bevel=0.009))
    objs.append(cyl("needle50_heavy_barrel", "barrel", mats["matte_steel"], (0, 0.054, 0.61), 0.034, 0.91, vertices=42, bevel=0.002))
    objs.append(cyl("needle50_muzzle_brake", "muzzle_brake", mats["blackened_steel"], (0, 0.054, 1.075), 0.047, 0.095, vertices=36, bevel=0.003))
    for side in (-1, 1):
        for i in range(3):
            objs.append(box(f"needle50_brake_port_{side}_{i}", f"brake_port_{side}_{i}", mats["dark_recess"], (side * 0.047, 0.054, 1.045 + i * 0.023), (0.008, 0.052, 0.012), bevel=0.001))
    objs.append(cyl("needle50_muzzle_crown", "muzzle_crown", mats["dark_recess"], (0, 0.054, 1.128), 0.024, 0.008, vertices=32, bevel=0.001))
    objs.append(box("needle50_freefloat_rail", "freefloat_rail", mats["blackened_steel"], (0, 0.1, 0.53), (0.15, 0.034, 0.42), bevel=0.005))
    objs.extend(rail_teeth("needle50", mats, 0.19, 18, 0.126, 0.035))
    objs.append(box("needle50_magazine", "magazine", mats["matte_steel"], (0, -0.20, 0.02), (0.125, 0.285, 0.095), rot=(-0.07, 0, 0), bevel=0.008))
    for i in range(4):
        objs.append(box(f"needle50_mag_panel_{i}", f"mag_panel_{i}", mats["worn_edges"], (0, -0.12 - i * 0.044, 0.014 + i * 0.003), (0.128, 0.008, 0.082), rot=(-0.07, 0, 0), bevel=0.001))
    objs.append(box("needle50_pistol_grip", "pistol_grip", mats["polymer_black"], (0, -0.235, -0.15), (0.13, 0.27, 0.095), rot=(-0.32, 0, 0), bevel=0.012))
    objs.append(box("needle50_trigger_guard", "trigger_guard", mats["polymer_black"], (0, -0.13, -0.082), (0.134, 0.024, 0.095), bevel=0.006))
    objs.append(box("needle50_trigger", "trigger", mats["matte_steel"], (0, -0.135, -0.102), (0.032, 0.078, 0.02), rot=(-0.23, 0, 0), bevel=0.003))
    objs.append(box("needle50_adjustable_stock", "stock", mats["polymer_black"], (0, -0.055, -0.49), (0.19, 0.14, 0.29), bevel=0.013))
    objs.append(box("needle50_cheek_riser", "cheek_riser", mats["rubber"], (0, 0.05, -0.42), (0.17, 0.045, 0.2), bevel=0.008))
    objs.append(box("needle50_recoil_pad", "recoil_pad", mats["rubber"], (0, -0.055, -0.665), (0.205, 0.17, 0.035), bevel=0.009))
    objs.append(box("needle50_bolt", "bolt", mats["worn_edges"], (0.088, 0.04, 0.036), (0.02, 0.032, 0.17), bevel=0.003))
    objs.append(cyl("needle50_bolt_knob", "bolt_knob", mats["matte_steel"], (0.143, 0.006, -0.025), 0.026, 0.072, rot=(0, math.pi / 2, 0), vertices=24, bevel=0.002))
    objs.append(cyl("needle50_scope_tube", "scope_tube", mats["blackened_steel"], (0, 0.222, 0.14), 0.043, 0.42, vertices=32, bevel=0.003))
    objs.append(cyl("needle50_scope_front", "scope_front", mats["blackened_steel"], (0, 0.222, 0.38), 0.062, 0.078, vertices=32, bevel=0.003))
    objs.append(cyl("needle50_scope_rear", "scope_rear", mats["blackened_steel"], (0, 0.222, -0.09), 0.055, 0.07, vertices=32, bevel=0.003))
    objs.append(cyl("needle50_scope_glass_front", "scope_glass_front", mats["glass"], (0, 0.222, 0.424), 0.048, 0.006, vertices=32, bevel=0.001))
    objs.append(cyl("needle50_scope_glass_rear", "scope_glass_rear", mats["glass"], (0, 0.222, -0.13), 0.043, 0.006, vertices=32, bevel=0.001))
    objs.append(cyl("needle50_scope_elevation", "scope_elevation", mats["matte_steel"], (0, 0.275, 0.12), 0.026, 0.042, rot=(0, 0, 0), vertices=24, bevel=0.002))
    objs.append(cyl("needle50_scope_windage", "scope_windage", mats["matte_steel"], (0.057, 0.222, 0.11), 0.022, 0.038, rot=(0, math.pi / 2, 0), vertices=24, bevel=0.002))
    objs.append(box("needle50_scope_mount_front", "scope_mount_front", mats["matte_steel"], (0, 0.154, 0.285), (0.115, 0.07, 0.028), bevel=0.004))
    objs.append(box("needle50_scope_mount_rear", "scope_mount_rear", mats["matte_steel"], (0, 0.154, -0.005), (0.115, 0.07, 0.028), bevel=0.004))
    return objs, {"muzzle": [0, 0.054, 1.133], "gripRight": [0.09, -0.24, -0.15], "gripLeft": [-0.11, 0.0, 0.48]}


BUILDERS = {
    "px9": build_px9,
    "vx7": build_vx7,
    "rift6": build_rift6,
    "needle50": build_needle50,
}

TARGET_LENGTHS = {
    "px9": 0.47,
    "vx7": 0.68,
    "rift6": 1.0,
    "needle50": 1.15,
}

CROSS_SECTION_SCALE = {
    "px9": (0.42, 0.52),
    "vx7": (0.34, 0.53),
    "rift6": (0.32, 0.43),
    "needle50": (0.30, 0.44),
}


def ensure_out() -> None:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    RENDER_DIR.mkdir(parents=True, exist_ok=True)


def normalize_length(objects: Iterable[bpy.types.Object], metadata: dict[str, list[float]], target_length: float) -> None:
    objects = list(objects)
    z_values = []
    for obj in objects:
        corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
        z_values.extend(corner.z for corner in corners)
    current = max(z_values) - min(z_values)
    if current <= 0:
        return
    factor = target_length / current
    for obj in objects:
        obj.location.z *= factor
        obj.scale.z *= factor
    for key in ("muzzle", "gripRight", "gripLeft"):
        metadata[key][2] = round(metadata[key][2] * factor, 6)


def normalize_cross_section(asset_id: str, objects: Iterable[bpy.types.Object], metadata: dict[str, list[float]]) -> None:
    if asset_id not in CROSS_SECTION_SCALE:
        return
    sx, sy = CROSS_SECTION_SCALE[asset_id]
    for obj in objects:
        obj.location.x *= sx
        obj.location.y *= sy
        obj.scale.x *= sx
        obj.scale.y *= sy
    for key in ("muzzle", "gripRight", "gripLeft"):
        metadata[key][0] = round(metadata[key][0] * sx, 6)
        metadata[key][1] = round(metadata[key][1] * sy, 6)


def triangulated_mesh(obj: bpy.types.Object) -> bpy.types.Mesh:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_obj = obj.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(eval_obj, depsgraph=depsgraph)
    tri = mesh.copy()
    mesh.free_tangents()
    bm_mod = tri
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(bm_mod)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(bm_mod)
    bm.free()
    bm_mod.update(calc_edges=True)
    return bm_mod


def semantic_json_part(obj: bpy.types.Object) -> tuple[str, str, str | None]:
    name = obj.name
    material = str(obj.get("materialName", "blackened_steel"))
    if name.startswith("px9_"):
        if "mag" in name:
            return "magazine", "matte_steel", None
        if any(token in name for token in ("slide", "serration", "sight", "ejection")):
            return "slide", "blackened_steel", None
        if any(token in name for token in ("barrel", "muzzle", "chamber")):
            return "barrel", "matte_steel", "slide"
    if name.startswith("vx7_"):
        if "mag" in name:
            return "magazine", "matte_steel", None
        if any(token in name for token in ("bolt", "charging_handle")):
            return "bolt", "worn_edges", None
    if name.startswith("rift6_"):
        if any(token in name for token in ("pump", "groove")):
            return "pump", "polymer_od", None
    if name.startswith("needle50_"):
        if "mag" in name:
            return "magazine", "matte_steel", None
        if "bolt" in name:
            return "bolt", "worn_edges", None
    if material in {"polymer_black", "polymer_od", "rubber"}:
        return f"body_{material}", material, None
    if material == "glass":
        return "optic_glass", material, None
    return f"body_{material}", material, None


def export_json(objects: Iterable[bpy.types.Object], metadata: dict[str, list[float]], output: Path) -> dict:
    groups: dict[tuple[str, str, str | None], dict] = {}
    all_positions: list[Vector] = []
    for obj in objects:
        if obj.type != "MESH":
            continue
        role, material, animation_parent = semantic_json_part(obj)
        group_key = (role, material, animation_parent)
        group = groups.setdefault(group_key, {
            "name": role,
            "role": role,
            "material": material,
            "animationParent": animation_parent,
            "positions": [],
            "normals": [],
            "uvs": [],
            "indices": [],
            "sourceObjects": [],
        })
        vertex_offset = len(group["positions"]) // 3
        mesh = triangulated_mesh(obj)
        mesh.calc_loop_triangles()
        matrix = obj.matrix_world.copy()
        normal_matrix = matrix.inverted().transposed().to_3x3()
        vertices: list[float] = []
        normals: list[float] = []
        uvs: list[float] = []
        indices: list[int] = []
        index_map: dict[tuple[int, int], int] = {}
        uv_layer = mesh.uv_layers.active.data if mesh.uv_layers.active else None
        for tri in mesh.loop_triangles:
            for loop_index in tri.loops:
                loop = mesh.loops[loop_index]
                key = (loop.vertex_index, loop_index)
                if key not in index_map:
                    v = matrix @ mesh.vertices[loop.vertex_index].co
                    n = (normal_matrix @ loop.normal).normalized()
                    uv = uv_layer[loop_index].uv if uv_layer else (v.x * 2.0, v.z * 2.0)
                    index_map[key] = len(vertices) // 3
                    vertices.extend([round(v.x, 6), round(v.y, 6), round(v.z, 6)])
                    normals.extend([round(n.x, 6), round(n.y, 6), round(n.z, 6)])
                    uvs.extend([round(float(uv[0]), 6), round(float(uv[1]), 6)])
                    all_positions.append(v)
                indices.append(vertex_offset + index_map[key])
        group["positions"].extend(vertices)
        group["normals"].extend(normals)
        group["uvs"].extend(uvs)
        group["indices"].extend(indices)
        group["sourceObjects"].append(obj.name)
        bpy.data.meshes.remove(mesh)
    parts = []
    for group in groups.values():
        part = {
            "name": group["name"],
            "role": group["role"],
            "material": group["material"],
            "positions": group["positions"],
            "normals": group["normals"],
            "uvs": group["uvs"],
            "indices": group["indices"],
            "sourceObjects": group["sourceObjects"],
        }
        if group["animationParent"]:
            part["animationParent"] = group["animationParent"]
        parts.append(part)
    min_v = [round(min(getattr(v, axis) for v in all_positions), 6) for axis in ("x", "y", "z")]
    max_v = [round(max(getattr(v, axis) for v in all_positions), 6) for axis in ("x", "y", "z")]
    data = {
        "parts": parts,
        "textures": {},
        "materials": {name: spec.__dict__ for name, spec in MATERIALS.items()},
        "bounds": {"min": min_v, "max": max_v},
        **metadata,
    }
    output.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))
    return data


def unwrap_objects(objects: Iterable[bpy.types.Object]) -> None:
    for obj in objects:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        try:
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
            bpy.ops.object.mode_set(mode="OBJECT")
        except Exception:
            bpy.ops.object.mode_set(mode="OBJECT")
        obj.select_set(False)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def export_weapon(asset_id: str) -> dict:
    mats = reset_scene()
    objects, metadata = BUILDERS[asset_id](mats)
    normalize_cross_section(asset_id, objects, metadata)
    normalize_length(objects, metadata, TARGET_LENGTHS[asset_id])
    unwrap_objects(objects)
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    glb_path = PUBLIC_DIR / f"{asset_id}.glb"
    json_path = PUBLIC_DIR / f"{asset_id}.json"
    blend_path = ASSET_DIR / f"{asset_id}.blend"
    bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format="GLB", use_selection=True, export_apply=True)
    data = export_json(objects, metadata, json_path)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    tris = sum(len(part["indices"]) // 3 for part in data["parts"])
    return {
        "assetId": asset_id,
        "blend": str(blend_path.relative_to(ROOT)),
        "glb": str(glb_path.relative_to(ROOT)),
        "json": str(json_path.relative_to(ROOT)),
        "triangles": tris,
        "parts": len(data["parts"]),
        "bounds": data["bounds"],
        "muzzle": data["muzzle"],
        "gripRight": data["gripRight"],
        "gripLeft": data["gripLeft"],
        "sha256": {"blend": sha256(blend_path), "glb": sha256(glb_path), "json": sha256(json_path)},
        "license": "Original procedural model created locally in Blender for this project.",
    }


def append_for_render(asset_id: str, offset_x: float, label: str) -> None:
    mats = make_materials()
    objects, metadata = BUILDERS[asset_id](mats)
    normalize_cross_section(asset_id, objects, metadata)
    normalize_length(objects, metadata, TARGET_LENGTHS[asset_id])
    group_matrix = Matrix.Translation(Vector((offset_x, 0, 0))) @ Matrix.Rotation(math.radians(-58), 4, "Y")
    for obj in objects:
        obj.matrix_world = group_matrix @ obj.matrix_world
    font_curve = bpy.data.curves.new(label, "FONT")
    font_curve.body = label
    font_curve.size = 0.06
    font_curve.align_x = "CENTER"
    text = bpy.data.objects.new(f"{asset_id}_label", font_curve)
    text.location = (offset_x, -0.62, -0.78)
    text.rotation_euler = (math.radians(76), 0, 0)
    bpy.context.collection.objects.link(text)


def render_showcase() -> Path:
    reset_scene()
    append_for_render("px9", -1.25, "PX-9")
    append_for_render("vx7", -0.42, "VX-7")
    append_for_render("rift6", 0.50, "RIFT-6")
    append_for_render("needle50", 1.35, "Needle .50")
    bpy.ops.mesh.primitive_plane_add(size=5.5, location=(0.15, -0.68, 0.21), rotation=(math.pi / 2, 0, 0))
    floor = bpy.context.object
    floor.name = "charcoal_studio_floor"
    floor.data.materials.append(make_materials()["dark_recess"])
    bpy.ops.object.light_add(type="AREA", location=(0.0, 2.35, -1.2))
    key = bpy.context.object
    key.name = "large_softbox"
    key.data.energy = 5200
    key.data.size = 4.2
    bpy.ops.object.light_add(type="POINT", location=(-2.4, 1.25, 1.2))
    rim = bpy.context.object
    rim.name = "cool_rim"
    rim.data.energy = 480
    bpy.ops.object.camera_add(location=(0.05, 2.45, -2.45))
    camera = bpy.context.object
    direction = Vector((0.05, -0.04, 0.04)) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 4.2
    bpy.context.scene.camera = camera
    bpy.context.scene.render.resolution_x = 1800
    bpy.context.scene.render.resolution_y = 950
    path = RENDER_DIR / "tactical-weapons-blender-showcase.png"
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    return path


def write_manifest(results: list[dict], preview: Path) -> None:
    manifest = {
        "name": "original-tactical-weapons",
        "createdBy": "scripts/blender/build_weapons.py",
        "source": "Original procedural Blender modeling; no paid provider or third-party mesh input.",
        "coordinateSystem": "Y-up, +Z barrel, trigger area near origin.",
        "jsonSchema": "{parts:[{name,role,material?,positions,normals,uvs,indices}],textures,materials,bounds,muzzle,gripRight,gripLeft}",
        "assets": results,
        "preview": str(preview.relative_to(ROOT)),
        "previewSha256": sha256(preview),
    }
    (PUBLIC_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--assets", nargs="*", default=list(BUILDERS))
    parser.add_argument("--skip-render", action="store_true")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = parser.parse_args(argv)
    ensure_out()
    results = [export_weapon(asset_id) for asset_id in args.assets]
    preview = render_showcase() if not args.skip_render else RENDER_DIR / "tactical-weapons-blender-showcase.png"
    write_manifest(results, preview)
    print(json.dumps({"assets": results, "preview": str(preview)}, indent=2))


if __name__ == "__main__":
    main()
