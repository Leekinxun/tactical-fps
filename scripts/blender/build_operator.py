#!/usr/bin/env python3
"""Build a compact tactical-operator mesh package with local Blender."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "assets" / "blender" / "operator"
OUTPUT_DIR = ROOT / "public" / "models" / "operator"
HUMAN_SOURCE = SOURCE_DIR / "reference" / "base.obj"
HUMAN_LICENSE = SOURCE_DIR / "reference" / "LICENSE.ASSETS.md"
MAKEHUMAN_SOURCE_URL = "https://github.com/makehumancommunity/makehuman/blob/master/makehuman/data/3dobjs/base.obj"
MAKEHUMAN_LICENSE_URL = "https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.md"
MATERIALS = {
    "cloth": {"albedo": "#46564b", "roughness": 0.94, "metallic": 0.0, "texture": "textures/operator-cloth.png"},
    "clothDark": {"albedo": "#2e3934", "roughness": 0.95, "metallic": 0.0, "texture": "textures/operator-cloth-dark.png"},
    "vest": {"albedo": "#26342b", "roughness": 0.9, "metallic": 0.01, "texture": "textures/operator-vest.png"},
    "plate": {"albedo": "#3b4240", "roughness": 0.58, "metallic": 0.16},
    "rubber": {"albedo": "#101514", "roughness": 0.96, "metallic": 0.0, "texture": "textures/operator-rubber.png"},
    "glass": {"albedo": "#0d1b1e", "roughness": 0.22, "metallic": 0.05, "alpha": 0.82},
    "marker": {"albedo": "#4da58f", "roughness": 0.72, "metallic": 0.04, "emissive": "#153b33"},
    "stitch": {"albedo": "#151a18", "roughness": 0.96, "metallic": 0.0},
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=SOURCE_DIR)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--render", type=Path, default=SOURCE_DIR / "operator-preview.png")
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return parser.parse_args(argv)


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.render.engine = "CYCLES"
    bpy.context.scene.cycles.samples = 40
    bpy.context.scene.view_settings.view_transform = "Filmic"
    bpy.context.scene.view_settings.look = "Medium High Contrast"
    bpy.context.scene.render.resolution_x = 1400
    bpy.context.scene.render.resolution_y = 1800


def material(name: str) -> bpy.types.Material:
    source = MATERIALS[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        base = tuple(int(source["albedo"][i : i + 2], 16) / 255 for i in (1, 3, 5))
        bsdf.inputs["Base Color"].default_value = (*base, source.get("alpha", 1.0))
        bsdf.inputs["Roughness"].default_value = source["roughness"]
        bsdf.inputs["Metallic"].default_value = source["metallic"]
        if "Alpha" in bsdf.inputs:
            bsdf.inputs["Alpha"].default_value = source.get("alpha", 1.0)
    mat.diffuse_color = (*tuple(int(source["albedo"][i : i + 2], 16) / 255 for i in (1, 3, 5)), source.get("alpha", 1.0))
    if source.get("alpha", 1.0) < 1:
        mat.blend_method = "BLEND"
    return mat


def write_operator_textures(output_dir: Path) -> dict[str, str]:
    texture_specs = {
        "textures/operator-cloth.png": ("#f4f4f4", "#b8b8b8", 0.45),
        "textures/operator-cloth-dark.png": ("#f0f0f0", "#b4b4b4", 0.43),
        "textures/operator-vest.png": ("#eeeeee", "#a9a9a9", 0.46),
        "textures/operator-rubber.png": ("#f0f0f0", "#cecece", 0.18),
    }
    texture_dir = output_dir / "textures"
    texture_dir.mkdir(parents=True, exist_ok=True)
    hashes: dict[str, str] = {}
    for rel, (base_hex, dark_hex, contrast) in texture_specs.items():
        image = bpy.data.images.new(Path(rel).stem, 512, 512, alpha=False)
        base = hex_rgb(base_hex)
        dark = hex_rgb(dark_hex)
        pixels: list[float] = []
        for y in range(512):
            for x in range(512):
                weave = 0.5 + 0.5 * math.sin(x * 0.46) * math.sin(y * 0.21)
                diagonal = 1.0 if ((x + y * 2) // 43) % 7 == 0 else 0.0
                grain = pseudo_noise(x, y)
                amount = min(0.9, contrast * (0.38 * weave + 0.42 * grain + 0.2 * diagonal))
                color = tuple(base[index] * (1 - amount) + dark[index] * amount for index in range(3))
                pixels.extend([color[0], color[1], color[2], 1.0])
        image.pixels[:] = pixels
        path = output_dir / rel
        image.filepath_raw = str(path)
        image.file_format = "PNG"
        image.save()
        hashes[rel] = sha256(path)
    return hashes


def hex_rgb(value: str) -> tuple[float, float, float]:
    return tuple(int(value[index : index + 2], 16) / 255 for index in (1, 3, 5))


def pseudo_noise(x: int, y: int) -> float:
    seed = (x * 374761393 + y * 668265263) & 0xFFFFFFFF
    seed = ((seed ^ (seed >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((seed ^ (seed >> 16)) & 0xFFFF) / 0xFFFF


def project_uv(x: float, y: float, z: float) -> list[float]:
    return [round(x * 1.85 + z * 0.22, 6), round(y * 2.35 + z * 0.18, 6)]


def smooth(obj: bpy.types.Object, bevel: float = 0.0) -> bpy.types.Object:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.shade_smooth()
    if bevel > 0:
        mod = obj.modifiers.new("small bevels", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.affect = "EDGES"
    weighted = obj.modifiers.new("weighted normals", "WEIGHTED_NORMAL")
    weighted.keep_sharp = True
    obj.select_set(False)
    return obj


def ellipsoid(name: str, parent: str, mat: bpy.types.Material, loc: tuple[float, float, float], scale: tuple[float, float, float], segments: int = 32) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=max(12, segments // 2), radius=1, location=loc)
    obj = bpy.context.object
    obj.name = f"{parent}__{name}"
    obj.scale = scale
    obj.data.materials.append(mat)
    smooth(obj)
    return obj


def box(name: str, parent: str, mat: bpy.types.Material, loc: tuple[float, float, float], scale: tuple[float, float, float], bevel: float = 0.025) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.name = f"{parent}__{name}"
    obj.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    smooth(obj, bevel)
    return obj


def cylinder(name: str, parent: str, mat: bpy.types.Material, loc: tuple[float, float, float], radius: float, depth: float, axis: str = "z", vertices: int = 24) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    obj = bpy.context.object
    obj.name = f"{parent}__{name}"
    if axis == "x":
        obj.rotation_euler[1] = math.pi / 2
    elif axis == "y":
        obj.rotation_euler[0] = math.pi / 2
    obj.data.materials.append(mat)
    smooth(obj, radius * 0.12)
    return obj


def add_pair(factory, side_names=("left", "right")) -> None:
    for side in (-1, 1):
        factory(side_names[0] if side < 0 else side_names[1], side)


def build_operator(mats: dict[str, bpy.types.Material]) -> list[bpy.types.Object]:
    objects: list[bpy.types.Object] = []
    add = objects.append

    add(box("soft-duty-belt", "pelvis", mats["rubber"], (0, 0.02, 0.23), (0.62, 0.34, 0.07), 0.02))
    add(box("metal-buckle", "pelvis", mats["plate"], (0, 0.235, 0.24), (0.13, 0.035, 0.07), 0.01))
    for i, x in enumerate((-0.25, 0.25)):
        add(box(f"sidearm-pouch-{i}", "pelvis", mats["vest"], (x, 0.08, 0.08), (0.09, 0.12, 0.16), 0.014))

    add(box("plate-carrier-shell", "chest", mats["vest"], (0, 0.035, 0.025), (0.50, 0.24, 0.50), 0.032))
    add(box("front-ballistic-plate", "chest", mats["plate"], (0, 0.185, 0.015), (0.39, 0.055, 0.36), 0.02))
    add(box("rear-hydration-pack", "chest", mats["vest"], (0, -0.175, 0.00), (0.34, 0.09, 0.39), 0.02))
    for x in (-0.20, 0.20):
        add(box(f"shoulder-strap-{x:+.2f}", "chest", mats["rubber"], (x, 0.19, 0.10), (0.052, 0.04, 0.60), 0.01))
    for row, z in enumerate((-0.17, -0.06, 0.05)):
        for x in (-0.145, 0, 0.145):
            add(box(f"pals-webbing-{row}-{x:+.2f}", "chest", mats["stitch"], (x, 0.227, z), (0.108, 0.012, 0.015), 0.003))
    for x in (-0.145, 0, 0.145):
        add(box(f"rifle-mag-pouch-{x:+.2f}", "chest", mats["vest"], (x, 0.245, -0.22), (0.11, 0.075, 0.19), 0.014))
        add(box(f"pouch-flap-stitch-{x:+.2f}", "chest", mats["stitch"], (x, 0.287, -0.125), (0.105, 0.01, 0.014), 0.003))
    add(box("front-team-patch", "chest", mats["marker"], (0.14, 0.26, 0.18), (0.13, 0.014, 0.058), 0.005))
    add(box("rear-team-patch", "chest", mats["marker"], (0, -0.235, 0.16), (0.20, 0.014, 0.078), 0.006))
    add(ellipsoid("neck-gaiter", "chest", mats["rubber"], (0, 0.03, 0.51), (0.17, 0.14, 0.095), 24))

    add(ellipsoid("masked-head", "head", mats["rubber"], (0, 0.0, -0.02), (0.185, 0.145, 0.255), 32))
    add(ellipsoid("high-cut-helmet", "head", mats["plate"], (0, -0.015, 0.08), (0.245, 0.205, 0.17), 32))
    add(box("helmet-front-lip", "head", mats["plate"], (0, 0.16, 0.065), (0.34, 0.075, 0.045), 0.012))
    add(box("helmet-rail-left", "head", mats["rubber"], (-0.19, 0.01, 0.065), (0.035, 0.20, 0.045), 0.01))
    add(box("helmet-rail-right", "head", mats["rubber"], (0.19, 0.01, 0.065), (0.035, 0.20, 0.045), 0.01))
    add(box("ballistic-goggles", "head", mats["glass"], (0, 0.18, -0.035), (0.32, 0.055, 0.10), 0.017))
    add(box("respirator-mask", "head", mats["vest"], (0, 0.165, -0.19), (0.24, 0.07, 0.14), 0.018))
    for x in (-0.23, 0.23):
        add(box(f"ear-pro-{x:+.2f}", "head", mats["rubber"], (x, -0.005, -0.03), (0.075, 0.12, 0.17), 0.018))

    def arm(side_name: str, side: int) -> None:
        add(ellipsoid("sleeve-upper", f"{side_name}Upper", mats["cloth"], (0, 0, 0), (0.085, 0.082, 0.53), 24))
        add(box("deltoid-pad", f"{side_name}Upper", mats["plate"], (side * 0.018, 0.055, 0.12), (0.13, 0.042, 0.16), 0.014))
        add(box("team-armband", f"{side_name}Upper", mats["marker"], (side * 0.014, 0.065, -0.10), (0.12, 0.028, 0.055), 0.008))
        add(ellipsoid("rolled-forearm", f"{side_name}Forearm", mats["clothDark"], (0, 0, 0), (0.070, 0.072, 0.53), 24))
        add(box("elbow-pad", f"{side_name}Forearm", mats["plate"], (0, 0.06, 0.04), (0.12, 0.038, 0.11), 0.012))
        add(ellipsoid("tactical-glove-palm", f"{side_name}Hand", mats["rubber"], (0, 0.012, 0.0), (0.060, 0.045, 0.058), 18))
        for finger in range(4):
            x = (finger - 1.5) * 0.028
            add(box(f"glove-finger-{finger}", f"{side_name}Hand", mats["rubber"], (x, 0.045, -0.036), (0.017, 0.038, 0.055), 0.006))

    add_pair(arm)

    def leg(side_name: str, side: int) -> None:
        add(box("cargo-pocket", f"{side_name}Thigh", mats["clothDark"], (side * 0.085, 0.02, -0.27), (0.075, 0.04, 0.16), 0.01))
        add(box("knee-pad", f"{side_name}Shin", mats["plate"], (0, 0.06, 0.10), (0.17, 0.045, 0.13), 0.012))
        add(box("boot-shaft", f"{side_name}Shin", mats["rubber"], (0, 0.005, -0.18), (0.145, 0.125, 0.28), 0.022))
        add(box("boot-toe-cap", f"{side_name}Shin", mats["rubber"], (0, 0.105, -0.30), (0.18, 0.23, 0.08), 0.018))
        add(box("boot-sole", f"{side_name}Shin", mats["stitch"], (0, 0.09, -0.35), (0.19, 0.24, 0.035), 0.008))

    add_pair(leg)
    for obj in objects:
        if "Shin__boot" in obj.name:
            obj.location.z -= 0.20
        elif "Shin__knee-pad" in obj.name:
            obj.location.z = -0.01
    for obj in objects:
        if obj.name.startswith("head__"):
            obj.scale *= 0.76
            obj.location *= 0.76
    return objects


def triangulate_object(obj: bpy.types.Object) -> bpy.types.Object:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    tri = obj.modifiers.new("triangulate", "TRIANGULATE")
    bpy.ops.object.modifier_apply(modifier=tri.name)
    return obj


def export_runtime_json(objects: list[bpy.types.Object], output_dir: Path) -> dict[str, Any]:
    parts: list[dict[str, Any]] = []
    all_positions: list[Vector] = []
    total_triangles = 0
    for obj in objects:
        triangulate_object(obj)
        parent, name = obj.name.split("__", 1)
        mesh = obj.data
        mesh.calc_loop_triangles()
        positions: list[float] = []
        normals: list[float] = []
        uvs: list[float] = []
        indices: list[int] = []
        vertex_map: dict[tuple[int, int], int] = {}
        for triangle in mesh.loop_triangles:
            tri_indices: list[int] = []
            for loop_index in triangle.loops:
                loop = mesh.loops[loop_index]
                vert = mesh.vertices[loop.vertex_index]
                key = (loop.vertex_index, loop_index)
                if key not in vertex_map:
                    vertex_map[key] = len(positions) // 3
                    co = obj.matrix_world @ vert.co
                    normal = (obj.matrix_world.to_3x3() @ loop.normal).normalized()
                    positions.extend([round(co.x, 6), round(co.z, 6), round(co.y, 6)])
                    normals.extend([round(normal.x, 6), round(normal.z, 6), round(normal.y, 6)])
                    uvs.extend(project_uv(co.x, co.z, co.y))
                    all_positions.append(Vector((co.x, co.z, co.y)))
                tri_indices.append(vertex_map[key])
            indices.extend([tri_indices[0], tri_indices[2], tri_indices[1]])
        material_name = obj.data.materials[0].name if obj.data.materials else "cloth"
        parts.append({
            "name": name,
            "parent": parent,
            "material": material_name,
            "positions": positions,
            "normals": normals,
            "uvs": uvs,
            "indices": indices,
        })
        total_triangles += len(indices) // 3

    human_parts = load_makehuman_body_parts()
    for part in human_parts:
        parts.append(part)
        total_triangles += len(part["indices"]) // 3
        for index in range(0, len(part["positions"]), 3):
            all_positions.append(Vector((part["positions"][index], part["positions"][index + 1], part["positions"][index + 2])))

    bounds = {
        "min": [round(min(v[i] for v in all_positions), 6) for i in range(3)],
        "max": [round(max(v[i] for v in all_positions), 6) for i in range(3)],
    }
    output = {
        "schema": "breachline.operator-mesh.v1",
        "asset": "industrial-tactical-operator",
        "license": "MakeHuman CC0-1.0 body derivative with project-authored equipment and garments.",
        "humanReference": {
            "title": "MakeHuman base mesh",
            "author": "MakeHuman Community",
            "license": "CC0-1.0",
            "sourceUrl": MAKEHUMAN_SOURCE_URL,
            "licenseUrl": MAKEHUMAN_LICENSE_URL,
            "sourcePath": str(HUMAN_SOURCE.relative_to(ROOT)),
            "sourceSha256": sha256(HUMAN_SOURCE),
            "licensePath": str(HUMAN_LICENSE.relative_to(ROOT)),
            "licenseSha256": sha256(HUMAN_LICENSE),
            "usedFor": "Runtime inner body proportions for head, torso, pelvis and legs.",
        },
        "coordinateSystem": "Runtime is Babylon left-handed: X right, Y up, Z forward. Blender source uses X right, Y forward, Z up.",
        "budget": {
            "triangleCount": total_triangles,
            "partCount": len(parts),
            "targetMaxTrianglesPerActor": 45000,
        },
        "materials": MATERIALS,
        "bounds": bounds,
        "parts": parts,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "operator.json").write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")
    return output


def load_makehuman_body_parts() -> list[dict[str, Any]]:
    if not HUMAN_SOURCE.exists() or not HUMAN_LICENSE.exists():
        return []
    vertices: list[tuple[float, float, float]] = []
    body_faces: list[list[int]] = []
    current_group = ""
    joint_vertices: dict[str, set[int]] = {}
    for raw in HUMAN_SOURCE.read_text(encoding="utf-8", errors="ignore").splitlines():
        if raw.startswith("v "):
            _, x, y, z, *_ = raw.split()
            vertices.append((float(x), float(y), float(z)))
        elif raw.startswith(("g ", "o ")):
            fields = raw.split(maxsplit=1)
            current_group = fields[1] if len(fields) > 1 else ""
        elif raw.startswith("f ") and current_group.startswith("joint-"):
            joint_vertices.setdefault(current_group, set()).update(int(token.split("/", 1)[0]) - 1 for token in raw.split()[1:])
        elif raw.startswith("f ") and current_group == "body":
            face = []
            for token in raw.split()[1:]:
                face.append(int(token.split("/", 1)[0]) - 1)
            if len(face) >= 3:
                for i in range(1, len(face) - 1):
                    body_faces.append([face[0], face[i], face[i + 1]])
    if not vertices or not body_faces:
        return []

    body_indices = {index for face in body_faces for index in face}
    min_y = min(vertices[index][1] for index in body_indices)
    max_y = max(vertices[index][1] for index in body_indices)
    def joint(name: str) -> Vector:
        values = joint_vertices[name]
        return sum((Vector(vertices[index]) for index in values), Vector()) / len(values)
    center_z = joint("joint-pelvis").z
    scale = 2.08 / (max_y - min_y)
    knee = joint("joint-r-knee")
    ankle = joint("joint-r-ankle")
    knee_y = (knee.y - min_y) * scale - 1
    ankle_y = (ankle.y - min_y) * scale - 1

    parent_offsets = {
        "pelvis": (0.0, 0.18, 0.0),
        "chest": (0.0, 0.58, 0.0),
        "head": (0.0, 1.12, 0.0),
        "leftThigh": (-0.12, -0.03, 0.0),
        "rightThigh": (0.12, -0.03, 0.0),
        "leftShin": (-0.12, -0.46, 0.02),
        "rightShin": (0.12, -0.46, 0.02),
    }
    bucket_specs = {
        "pelvis": ("pelvis", "clothDark", 0.032),
        "chest": ("chest", "clothDark", 0.032),
        "head": ("head", "rubber", 0.012),
        "leftThigh": ("leftThigh", "cloth", 0.032),
        "rightThigh": ("rightThigh", "cloth", 0.032),
        "leftShin": ("leftShin", "clothDark", 0.032),
        "rightShin": ("rightShin", "clothDark", 0.032),
    }
    buckets: dict[str, list[list[tuple[float, float, float]]]] = {key: [] for key in bucket_specs}

    def target(v: tuple[float, float, float]) -> tuple[float, float, float]:
        y = (v[1] - min_y) * scale - 1.0
        lower = max(0, min(1, (knee_y - y) / (knee_y - ankle_y)))
        natural_axis = (abs(knee.x) * (1-lower) + abs(ankle.x) * lower) * scale
        stance = max(0, min(1, (-y - 0.06) / 0.30))
        stance = stance * stance * (3 - 2 * stance)
        x = v[0] * scale - math.copysign(max(0, natural_axis - 0.12) * stance, v[0])
        return (x, y, (v[2] - center_z) * scale - 0.03)

    # Area-weighted normals are shared by every triangle touching a vertex.
    # Per-face inflation tears an otherwise connected garment into strips.
    vertex_normals = [Vector((0, 0, 0)) for _ in vertices]
    for face in body_faces:
        a, b, c = [Vector(target(vertices[index])) for index in face]
        normal = (b - a).cross(c - a)
        for index in face:
            vertex_normals[index] += normal
    normal_by_point = {target(vertices[index]): normal.normalized() for index, normal in enumerate(vertex_normals) if normal.length > 1e-8}

    for face in body_faces:
        tri = [target(vertices[index]) for index in face]
        cx = sum(v[0] for v in tri) / 3
        cy = sum(v[1] for v in tri) / 3
        if cy > 0.9:
            continue
        elif cy > 0.28:
            if abs(cx) >= 0.24: continue
            bucket = "chest"
        elif cy > -0.08:
            if abs(cx) >= 0.28: continue
            bucket = "pelvis"
        elif cy > -0.42 and abs(cx) < 0.30:
            bucket = "leftThigh" if cx < 0 else "rightThigh"
        elif cy <= -0.28 and cy > -0.82 and abs(cx) < 0.30:
            bucket = "leftShin" if cx < 0 else "rightShin"
        else:
            continue
        buckets[bucket].append(tri)

    parts: list[dict[str, Any]] = []
    for bucket_name, triangles in buckets.items():
        parent, material_name, inflate = bucket_specs[bucket_name]
        positions: list[float] = []
        normals: list[float] = []
        uvs: list[float] = []
        indices: list[int] = []
        offset = parent_offsets[parent]
        vertex_map: dict[tuple[float, float, float], int] = {}
        for tri in triangles:
            tri_indices: list[int] = []
            a = Vector(tri[0])
            b = Vector(tri[1])
            c = Vector(tri[2])
            face_normal = (b - a).cross(c - a).normalized()
            for point in tri:
                smooth_normal = normal_by_point.get(point, face_normal)
                inflated = Vector(point) + smooth_normal * inflate
                key = (round(inflated.x, 5), round(inflated.y, 5), round(inflated.z, 5))
                if key not in vertex_map:
                    vertex_map[key] = len(positions) // 3
                    positions.extend([
                        round(inflated.x - offset[0], 6),
                        round(inflated.y - offset[1], 6),
                        round(inflated.z - offset[2], 6),
                    ])
                    normals.extend([round(smooth_normal.x, 6), round(smooth_normal.y, 6), round(smooth_normal.z, 6)])
                    uvs.extend(project_uv(inflated.x, inflated.y, inflated.z))
                tri_indices.append(vertex_map[key])
            indices.extend(tri_indices)
        if positions:
            parts.append({
                "name": f"human-{bucket_name}",
                "parent": parent,
                "material": material_name,
                "positions": positions,
                "normals": normals,
                "uvs": uvs,
                "indices": indices,
            })
    return parts


def setup_preview() -> None:
    bpy.ops.object.light_add(type="AREA", location=(-3.0, -4.0, 4.5))
    bpy.context.object.name = "large-softbox-left"
    bpy.context.object.data.energy = 550
    bpy.context.object.data.size = 4.0
    bpy.ops.object.light_add(type="AREA", location=(2.0, 3.0, 3.0))
    bpy.context.object.name = "warm-rim-light"
    bpy.context.object.data.energy = 120
    bpy.context.object.data.size = 3.0
    bpy.ops.mesh.primitive_plane_add(size=4.5, location=(0, 0, -0.99))
    floor = bpy.context.object
    floor.name = "matte-review-floor"
    floor.data.materials.append(material("vest"))
    bpy.ops.object.camera_add(location=(1.35, 3.1, 1.05))
    camera = bpy.context.object
    camera.name = "operator-review-camera"
    look_at(camera, Vector((0.0, 0.03, 0.35)))
    bpy.context.scene.camera = camera


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    direction = target - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def assemble_for_preview(objects: list[bpy.types.Object]) -> None:
    offsets = {
        "pelvis": (0, 0, .18), "chest": (0, 0, .58), "head": (0, 0, 1.12),
        "leftThigh": (-.12, 0, -.03), "rightThigh": (.12, 0, -.03),
        "leftShin": (-.12, .02, -.46), "rightShin": (.12, .02, -.46),
    }
    frames = {}
    for side, name in [(-1, "left"), (1, "right")]:
        shoulder = Vector((side * .29, .04, .87))
        hand = Vector((.045 if side < 0 else .10, .35 if side < 0 else .32, .65))
        elbow = shoulder.lerp(hand, .52) + Vector((side * .06, -.08, -.12))
        for segment, a, b in [("Upper", shoulder, elbow), ("Forearm", elbow, hand)]:
            delta = b - a
            rotation = delta.to_track_quat("Z", "Y").to_matrix().to_4x4()
            frames[name + segment] = Matrix.Translation((a+b)/2) @ rotation @ Matrix.Diagonal(Vector((1, 1, delta.length, 1)))
        frames[name + "Hand"] = Matrix.Translation(hand)
    bpy.context.view_layer.update()
    for obj in objects:
        parent = obj.name.split("__", 1)[0]
        transform = frames.get(parent, Matrix.Translation(Vector(offsets.get(parent, (0,0,0)))))
        obj.matrix_world = transform @ obj.matrix_world


def add_runtime_human_preview(runtime: dict[str, Any], mats: dict[str, bpy.types.Material]) -> list[bpy.types.Object]:
    parent_offsets = {
        "pelvis": (0.0, 0.18, 0.0),
        "chest": (0.0, 0.58, 0.0),
        "head": (0.0, 1.12, 0.0),
        "leftThigh": (-0.12, -0.03, 0.0),
        "rightThigh": (0.12, -0.03, 0.0),
        "leftShin": (-0.12, -0.46, 0.02),
        "rightShin": (0.12, -0.46, 0.02),
    }
    objects: list[bpy.types.Object] = []
    for part in runtime["parts"]:
        if not part["name"].startswith("human-"):
            continue
        offset = parent_offsets[part["parent"]]
        raw_vertices = []
        for index in range(0, len(part["positions"]), 3):
            x = part["positions"][index] + offset[0]
            y = part["positions"][index + 1] + offset[1]
            z = part["positions"][index + 2] + offset[2]
            raw_vertices.append((x, z, y))
        vertices = []
        remap = {}
        old_to_new = []
        for vertex in raw_vertices:
            key = tuple(round(value, 5) for value in vertex)
            if key not in remap:
                remap[key] = len(vertices)
                vertices.append(vertex)
            old_to_new.append(remap[key])
        faces = [tuple(old_to_new[i] for i in reversed(part["indices"][index : index + 3])) for index in range(0, len(part["indices"]), 3)]
        mesh = bpy.data.meshes.new(f"preview-{part['name']}-mesh")
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        obj = bpy.data.objects.new(f"preview-{part['name']}", mesh)
        bpy.context.collection.objects.link(obj)
        obj.data.materials.append(mats.get(part["material"], mats["clothDark"]))
        smooth(obj)
        objects.append(obj)
    return objects


def standing_world_bounds(objects: list[bpy.types.Object]) -> dict[str, list[float]]:
    coords: list[Vector] = []
    bpy.context.view_layer.update()
    for obj in objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            coords.append(obj.matrix_world @ Vector(corner))
    return {
        "min": [round(min(v[i] for v in coords), 6) for i in range(3)],
        "max": [round(max(v[i] for v in coords), 6) for i in range(3)],
    }


def select_for_glb(objects: list[bpy.types.Object]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    args = parse_args()
    args.source_dir.mkdir(parents=True, exist_ok=True)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    reset_scene()
    mats = {name: material(name) for name in MATERIALS}
    objects = build_operator(mats)
    texture_hashes = write_operator_textures(args.output_dir)
    runtime = export_runtime_json(objects, args.output_dir)
    assemble_for_preview(objects)
    preview_human_objects = add_runtime_human_preview(runtime, mats)
    export_objects = objects + preview_human_objects
    standing_bounds = standing_world_bounds(export_objects)
    blend_path = args.source_dir / "industrial-tactical-operator.blend"
    glb_path = args.output_dir / "operator.glb"
    select_for_glb(export_objects)
    bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format="GLB", use_selection=True)
    setup_preview()
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    bpy.context.scene.render.filepath = str(args.render)
    bpy.ops.render.render(write_still=True)
    manifest = {
        "asset": runtime["asset"],
        "schema": runtime["schema"],
        "source": {
            "type": "local-original-blender-procedural-model",
            "script": "scripts/blender/build_operator.py",
            "blend": str(blend_path.relative_to(ROOT)),
            "preview": str(args.render.relative_to(ROOT)),
            "license": runtime["license"],
            "humanReference": runtime["humanReference"],
        },
        "conversion": {
            "sourceCoordinateSystem": "Blender X right, Y forward, Z up.",
            "targetCoordinateSystem": runtime["coordinateSystem"],
            "positionTransform": "target(x,y,z)=(source.x, source.z, source.y)",
            "normalTransform": "Procedural Blender parts use target(nx,ny,nz)=(source.nx, source.nz, source.ny) with reversed winding after axis swap; MakeHuman-derived runtime parts are emitted directly in Babylon coordinates with CCW winding.",
            "bounds": runtime["bounds"],
            "standingWorldBounds": standing_bounds,
            "triangleCount": runtime["budget"]["triangleCount"],
            "partCount": runtime["budget"]["partCount"],
        },
        "files": {
            "operatorJson": {"path": "public/models/operator/operator.json", "sha256": sha256(args.output_dir / "operator.json")},
            "operatorGlb": {"path": "public/models/operator/operator.glb", "sha256": sha256(glb_path)},
            "sourceBlend": {"path": str(blend_path.relative_to(ROOT)), "sha256": sha256(blend_path)},
            "previewPng": {"path": str(args.render.relative_to(ROOT)), "sha256": sha256(args.render)},
            "textures": {
                rel: {"path": str((args.output_dir / rel).relative_to(ROOT)), "sha256": digest}
                for rel, digest in sorted(texture_hashes.items())
            },
        },
    }
    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({
        "operatorJson": str(args.output_dir / "operator.json"),
        "operatorGlb": str(glb_path),
        "blend": str(blend_path),
        "preview": str(args.render),
        "triangles": runtime["budget"]["triangleCount"],
        "parts": runtime["budget"]["partCount"],
        "bounds": runtime["bounds"],
        "standingWorldBounds": standing_bounds,
    }, indent=2))


if __name__ == "__main__":
    main()
