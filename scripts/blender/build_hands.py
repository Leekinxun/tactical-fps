#!/usr/bin/env python3
"""Build first-person tactical hand meshes for Breachline.

The script is intentionally self contained so it can run in a factory-started
Blender process without touching a user's open scene.
"""

from __future__ import annotations

import hashlib
import json
import math
import shutil
from pathlib import Path
from typing import Iterable

import bmesh
import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[2]
PUBLIC_DIR = ROOT / "public" / "models" / "tactical-hands"
BLEND_DIR = ROOT / "assets" / "blender" / "hands"
REFERENCE_DIR = BLEND_DIR / "reference"
MAKEHUMAN_OBJ = REFERENCE_DIR / "base.obj"
MAKEHUMAN_LICENSE = REFERENCE_DIR / "LICENSE.ASSETS.md"

HUMAN_HAND_SCALE = 0.10
HUMAN_HAND_Z_SHIFT = 0.010

MATERIALS = {
    "glove": (0.025, 0.034, 0.028, 1),
    "rubber": (0.004, 0.005, 0.005, 1),
    "sleeve": (0.105, 0.128, 0.106, 1),
}


def ensure_dirs() -> None:
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    BLEND_DIR.mkdir(parents=True, exist_ok=True)
    REFERENCE_DIR.mkdir(parents=True, exist_ok=True)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def make_materials() -> dict[str, bpy.types.Material]:
    materials: dict[str, bpy.types.Material] = {}
    for name, color in MATERIALS.items():
        material = bpy.data.materials.new(f"hands-{name}")
        material.diffuse_color = color
        materials[name] = material
    return materials


def add_meta_element(mb: bpy.types.MetaBall, co: tuple[float, float, float], radius: float, scale: tuple[float, float, float]) -> None:
    element = mb.elements.new(type="ELLIPSOID")
    element.co = co
    element.radius = radius
    element.size_x = scale[0]
    element.size_y = scale[1]
    element.size_z = scale[2]
    element.stiffness = 2.4


def add_meta_chain(
    mb: bpy.types.MetaBall,
    points: list[tuple[float, float, float]],
    start_radius: float,
    end_radius: float,
    scale: tuple[float, float, float] = (1, 1, 1),
) -> None:
    if len(points) == 1:
        add_meta_element(mb, points[0], start_radius, scale)
        return
    for index, point in enumerate(points):
        t = index / (len(points) - 1)
        radius = start_radius * (1 - t) + end_radius * t
        add_meta_element(mb, point, radius, scale)


def add_hand_metaball(style: str, hand: str, materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    mb = bpy.data.metaballs.new(f"{style}-{hand}-glove-meta")
    mb.resolution = 0.006
    mb.render_resolution = 0.005
    mb.threshold = 0.57
    obj = bpy.data.objects.new(f"{style}-{hand}-glove-meta", mb)
    bpy.context.collection.objects.link(obj)

    support = hand == "support"
    pistol = style == "pistol"
    palm_depth = 0.038 if pistol else 0.041
    add_meta_element(mb, (0.0, -0.006, 0.002), 0.040 if pistol else 0.043, (1.08, 1.36, 0.78))
    add_meta_element(mb, (0.0, -0.038, -0.018), 0.034 if pistol else 0.036, (1.0, 0.92, 0.82))
    add_meta_chain(mb, [(0, -0.053, -0.025), (0, -0.074, -0.037)], 0.029, 0.023, (1.02, 0.88, 0.8))

    if support and not pistol:
        curl = 0.72
        z_bias = 0.030
    elif support:
        curl = 0.88
        z_bias = 0.016
    else:
        curl = 0.94
        z_bias = 0.026

    fingers = [
        ("index", 0.030, 0.039, 0.050 + z_bias, 0.0092, 0.0070, 0.061, curl * (0.74 if not support else 0.9)),
        ("middle", 0.010, 0.042, 0.030 + z_bias, 0.0100, 0.0074, 0.069, curl),
        ("ring", -0.011, 0.034, 0.013 + z_bias, 0.0095, 0.0070, 0.064, curl * 0.96),
        ("little", -0.030, 0.021, -0.002 + z_bias, 0.0083, 0.0062, 0.055, curl * 0.88),
    ]
    for _, x, y, z, r0, r1, length, local_curl in fingers:
        points: list[tuple[float, float, float]] = []
        for step in range(6):
            t = step / 5
            down = -length * (0.16 + t * (0.70 + local_curl * 0.22))
            forward = length * (0.12 + math.sin(t * math.pi * 0.92) * 0.54 * local_curl)
            side = x * (1 + t * 0.10)
            points.append((side, y + down, z + forward))
        add_meta_chain(mb, points, r0, r1, (0.88, 1.0, 0.82))

    thumb_side = 1.0
    thumb_base = (0.043 * thumb_side, -0.011, -0.016)
    thumb_points = [
        thumb_base,
        (0.052 * thumb_side, -0.026, 0.002),
        (0.045 * thumb_side, -0.040, 0.029),
        (0.030 * thumb_side, -0.047, 0.052),
    ]
    if support:
        thumb_points = [
            (0.043 * thumb_side, -0.005, -0.012),
            (0.052 * thumb_side, -0.020, 0.010),
            (0.044 * thumb_side, -0.030, 0.040),
            (0.024 * thumb_side, -0.034, 0.064),
        ]
    add_meta_chain(mb, thumb_points, 0.0125, 0.0085, (0.90, 1.0, 0.82))

    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    mesh_obj = bpy.context.object
    mesh_obj.name = f"{style}-{hand}-glove"
    mesh_obj.data.name = f"{style}-{hand}-glove-mesh"
    mesh_obj.data.materials.append(materials["glove"])
    remove_small_islands(mesh_obj, 60)
    bpy.ops.object.shade_smooth()
    decimate = mesh_obj.modifiers.new("glove-budget", "DECIMATE")
    decimate.ratio = 0.73
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    weighted = mesh_obj.modifiers.new("glove-weighted-normals", "WEIGHTED_NORMAL")
    weighted.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier=weighted.name)
    mesh_obj["style"] = style
    mesh_obj["hand"] = hand
    mesh_obj["role"] = "glove"
    mesh_obj["materialRole"] = "glove"
    return mesh_obj


def remove_small_islands(obj: bpy.types.Object, min_vertices: int) -> None:
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    visited: set[bmesh.types.BMVert] = set()
    remove: list[bmesh.types.BMVert] = []
    for vert in bm.verts:
        if vert in visited:
            continue
        stack = [vert]
        component: list[bmesh.types.BMVert] = []
        visited.add(vert)
        while stack:
            current = stack.pop()
            component.append(current)
            for edge in current.link_edges:
                other = edge.other_vert(current)
                if other not in visited:
                    visited.add(other)
                    stack.append(other)
        if len(component) < min_vertices:
            remove.extend(component)
    if remove:
        bmesh.ops.delete(bm, geom=remove, context="VERTS")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def add_rounded_box(
    name: str,
    role: str,
    material_role: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    rotation: tuple[float, float, float],
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel = obj.modifiers.new("soft-bevel", "BEVEL")
    bevel.width = min(scale) * 0.18
    bevel.segments = 3
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    weighted = obj.modifiers.new("weighted-normals", "WEIGHTED_NORMAL")
    bpy.ops.object.modifier_apply(modifier=weighted.name)
    obj.data.materials.append(materials[material_role])
    obj["role"] = role
    obj["materialRole"] = material_role
    return obj


def add_detail_parts(style: str, hand: str, materials: dict[str, bpy.types.Material]) -> list[bpy.types.Object]:
    parts: list[bpy.types.Object] = []
    support = hand == "support"
    pistol = style == "pistol"
    y = 0.035 if hand == "support" else 0.038
    z0 = 0.042 if style == "rifle" and hand == "support" else 0.030
    for index, x in enumerate([-0.029, -0.010, 0.010, 0.030]):
        parts.append(add_rounded_box(
            f"{style}-{hand}-knuckle-{index}",
            "knuckle",
            "rubber",
            (x, y - 0.004, z0 + index * 0.009),
            (0.0004, 0.0004, 0.0004),
            (0, 0, 0),
            materials,
        ))
    # Keep these names stable for tests and for visual auditing.
    parts.append(add_rounded_box(
        f"{style}-{hand}-thumb",
        "thumb",
        "rubber",
        (0.030, -0.036, 0.040),
        (0.0004, 0.0004, 0.0004),
        (0, 0, 0),
        materials,
    ))
    if support and not pistol:
        curl = 0.72
        z_bias = 0.030
    elif support:
        curl = 0.88
        z_bias = 0.016
    else:
        curl = 0.94
        z_bias = 0.026
    finger_specs = [
        (0.030, 0.039, 0.050 + z_bias, 0.061, curl * (0.74 if not support else 0.9)),
        (0.010, 0.042, 0.030 + z_bias, 0.069, curl),
        (-0.011, 0.034, 0.013 + z_bias, 0.064, curl * 0.96),
        (-0.030, 0.021, -0.002 + z_bias, 0.055, curl * 0.88),
    ]
    for index, (x, base_y, base_z, length, local_curl) in enumerate(finger_specs):
        t = 0.58
        down = -length * (0.16 + t * (0.70 + local_curl * 0.22))
        forward = length * (0.12 + math.sin(t * math.pi * 0.92) * 0.54 * local_curl)
        side = x * (1 + t * 0.10)
        parts.append(add_rounded_box(
            f"{style}-{hand}-finger-{index}",
            f"finger-{index}",
            "rubber",
            (side, base_y + down - 0.006, base_z + forward - 0.004),
            (0.0004, 0.0004, 0.0004),
            (0, 0, 0),
            materials,
        ))
    parts.append(add_rounded_box(
        f"{style}-{hand}-palm-pad",
        "palm-pad",
        "rubber",
        (0.000, -0.045, -0.012),
        (0.0004, 0.0004, 0.0004),
        (0, 0, 0),
        materials,
    ))
    return parts


def ring_basis(direction: Vector) -> tuple[Vector, Vector]:
    up = Vector((0, 1, 0))
    tangent = direction.normalized()
    side = up.cross(tangent)
    if side.length < 0.001:
        side = Vector((1, 0, 0))
    side.normalize()
    normal = tangent.cross(side)
    normal.normalize()
    return side, normal


def add_sleeve_mesh(name: str, materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    segments = 24
    rings = 18
    positions: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int, int]] = []
    for ring in range(rings):
        t = ring / (rings - 1)
        y = -0.5 + t
        radius = 0.034 + t * 0.020
        wrinkle = math.sin(t * math.pi * 7) * 0.003 + math.sin(t * math.pi * 13) * 0.0016
        for seg in range(segments):
            a = 2 * math.pi * seg / segments
            radial = radius + wrinkle + math.sin(a * 4 + t * 9) * 0.0014
            x = math.cos(a) * radial * (1.08 + t * 0.10)
            z = math.sin(a) * radial * (0.82 + t * 0.08)
            positions.append((x, y, z))
    for ring in range(rings - 1):
        for seg in range(segments):
            a = ring * segments + seg
            b = ring * segments + (seg + 1) % segments
            c = (ring + 1) * segments + (seg + 1) % segments
            d = (ring + 1) * segments + seg
            faces.append((a, b, c, d))
    mesh = bpy.data.meshes.new(f"{name}-mesh")
    mesh.from_pydata(positions, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(materials["sleeve"])
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.shade_smooth()
    obj.select_set(False)
    obj["role"] = "sleeve"
    obj["materialRole"] = "sleeve"
    return obj


def add_cuff_mesh(name: str, materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(major_radius=0.037, minor_radius=0.006, major_segments=28, minor_segments=6)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler[0] = math.pi / 2
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.data.materials.append(materials["rubber"])
    obj["role"] = "cuff"
    obj["materialRole"] = "rubber"
    return obj


_human_cache: dict | None = None


def human_source() -> dict:
    global _human_cache
    if _human_cache is not None:
        return _human_cache
    verts: list[Vector] = [Vector((0, 0, 0))]
    groups: dict[str, list[list[int]]] = {}
    current: list[str] = []
    with MAKEHUMAN_OBJ.open(encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if line.startswith("v "):
                _, x, y, z = line.split()[:4]
                verts.append(Vector((float(x), float(y), float(z))))
            elif line.startswith("g "):
                current = line.split()[1:]
                for group in current:
                    groups.setdefault(group, [])
            elif line.startswith("f "):
                face = [int(part.split("/")[0]) for part in line.split()[1:]]
                for group in current:
                    groups.setdefault(group, []).append(face)
    joints = {}
    for name, faces in groups.items():
        if not name.startswith("joint-"):
            continue
        used = {index for face in faces for index in face}
        if used:
            joints[name] = sum((verts[index] for index in used), Vector()) / len(used)
    _human_cache = {"verts": verts, "groups": groups, "joints": joints}
    return _human_cache


def basis_for_side(side: str) -> tuple[Vector, Vector, Vector, Vector]:
    source = human_source()
    joints = source["joints"]
    wrist = joints[f"joint-{side}-hand"]
    bases = [joints[f"joint-{side}-finger-{index}-1"] for index in range(2, 6)]
    finger_center = sum(bases, Vector()) / len(bases)
    forward = (finger_center - wrist).normalized()
    across = (joints[f"joint-{side}-finger-2-1"] - joints[f"joint-{side}-finger-5-1"]).normalized()
    across = (across - forward * across.dot(forward)).normalized()
    up = across.cross(forward).normalized()
    if up.z < 0:
        up.negate()
    return wrist, across, up, forward


def source_to_local(point: Vector, side: str, scale: float) -> Vector:
    wrist, across, up, forward = basis_for_side(side)
    diff = point - wrist
    return Vector((diff.dot(across) * scale, diff.dot(up) * scale, diff.dot(forward) * scale))


def curl_point(point: Vector, side: str, style: str, hand: str) -> Vector:
    # A continuous bend field preserves the shared palm/finger topology.
    # Hard nearest-finger switches produce spikes across knuckles and webs.
    start = 0.035
    distance = max(0.0, point.z - start)
    radius = 0.034 if hand == "trigger" else 0.043
    angle = min(2.5, distance / radius)
    if distance <= 0:
        return point.copy()
    if hand == "support" and style == "rifle":
        return Vector((point.x, radius - (radius - point.y) * math.cos(angle), start + (radius - point.y) * math.sin(angle)))
    return Vector((point.x, -radius + (radius + point.y) * math.cos(angle), start + (radius + point.y) * math.sin(angle)))


def rotate_around(point: Vector, pivot: Vector, axis: Vector, angle: float) -> Vector:
    matrix = Matrix.Rotation(angle, 4, axis.normalized())
    return pivot + (matrix @ (point - pivot))


def build_human_glove_part(style: str, hand: str) -> dict:
    side = "r" if hand == "trigger" else "l"
    source = human_source()
    verts: list[Vector] = source["verts"]
    body_faces = source["groups"]["body"]
    scale = HUMAN_HAND_SCALE
    wrist, _, _, _ = basis_for_side(side)
    raw: dict[int, Vector] = {}
    for face in body_faces:
        points = [verts[index] for index in face]
        locals_ = [source_to_local(point, side, scale) for point in points]
        center = sum(locals_, Vector()) / len(locals_)
        if -0.035 <= center.x <= 0.105 and -0.030 <= center.y <= 0.035 and -0.006 <= center.z <= 0.178:
            for index, local in zip(face, locals_):
                raw[index] = local

    index_map: dict[int, int] = {}
    positions: list[float] = []
    indices: list[int] = []
    for face in body_faces:
        if not all(index in raw for index in face):
            continue
        tri = []
        for source_index in face:
            if source_index not in index_map:
                local = raw[source_index].copy()
                local.z -= HUMAN_HAND_Z_SHIFT
                if local.z > 0.030:
                    local = curl_point(local, side, style, hand)
                local.y -= 0.004
                index_map[source_index] = len(positions) // 3
                positions.extend([round(local.x, 6), round(local.y, 6), round(local.z, 6)])
            tri.append(index_map[source_index])
        if len(tri) == 3:
            indices.extend(tri)
        elif len(tri) == 4:
            indices.extend([tri[0], tri[1], tri[2], tri[0], tri[2], tri[3]])

    _, across, up, forward = basis_for_side(side)
    if across.cross(up).dot(forward) < 0:
        indices = [index for start in range(0, len(indices), 3) for index in (indices[start], indices[start + 2], indices[start + 1])]
    normals = compute_normals(positions, indices)
    uvs = []
    for index in range(0, len(positions), 3):
        uvs.extend([round(positions[index] * 7 + 0.5, 6), round(positions[index + 2] * 5 + 0.5, 6)])
    return {
        "name": f"{hand}-glove",
        "role": "glove",
        "materialRole": "glove",
        "positions": positions,
        "normals": normals,
        "uvs": uvs,
        "indices": indices,
    }


def compute_normals(positions: list[float], indices: list[int]) -> list[float]:
    normals = [Vector((0, 0, 0)) for _ in range(len(positions) // 3)]
    points = [Vector((positions[i], positions[i + 1], positions[i + 2])) for i in range(0, len(positions), 3)]
    for i in range(0, len(indices), 3):
        a, b, c = indices[i:i + 3]
        normal = (points[b] - points[a]).cross(points[c] - points[a])
        if normal.length > 0:
            normal.normalize()
            normals[a] += normal
            normals[b] += normal
            normals[c] += normal
    flat: list[float] = []
    for normal in normals:
        if normal.length == 0:
            normal = Vector((0, 1, 0))
        else:
            normal.normalize()
        flat.extend([round(normal.x, 6), round(normal.y, 6), round(normal.z, 6)])
    return flat


def mesh_payload(obj: bpy.types.Object, part_name: str, role: str, material_role: str) -> dict:
    deps = bpy.context.evaluated_depsgraph_get()
    eval_obj = obj.evaluated_get(deps)
    mesh = eval_obj.to_mesh()
    mesh.calc_loop_triangles()
    world = eval_obj.matrix_world.copy()
    normal_matrix = world.inverted_safe().transposed().to_3x3()
    positions: list[float] = []
    normals: list[float] = []
    uvs: list[float] = []
    indices: list[int] = []
    index_map: dict[tuple[int, int], int] = {}
    uv_layer = mesh.uv_layers.active.data if mesh.uv_layers.active else None
    for triangle in mesh.loop_triangles:
        for loop_index in triangle.loops:
            loop = mesh.loops[loop_index]
            key = (loop.vertex_index, loop_index)
            if key not in index_map:
                vertex = mesh.vertices[loop.vertex_index]
                co = world @ vertex.co
                no = (normal_matrix @ loop.normal).normalized()
                index_map[key] = len(positions) // 3
                positions.extend([round(co.x, 6), round(co.y, 6), round(co.z, 6)])
                normals.extend([round(no.x, 6), round(no.y, 6), round(no.z, 6)])
                if uv_layer:
                    uv = uv_layer[loop_index].uv
                    uvs.extend([round(uv.x, 6), round(uv.y, 6)])
                else:
                    uvs.extend([round(co.x * 4 + 0.5, 6), round(co.y * 4 + co.z * 2 + 0.5, 6)])
            indices.append(index_map[key])
    eval_obj.to_mesh_clear()
    return {
        "name": part_name,
        "role": role,
        "materialRole": material_role,
        "positions": positions,
        "normals": normals,
        "uvs": uvs,
        "indices": indices,
    }


def hand_bounds(parts: Iterable[dict]) -> dict[str, list[float]]:
    mins = [float("inf"), float("inf"), float("inf")]
    maxs = [float("-inf"), float("-inf"), float("-inf")]
    for part in parts:
        data = part["positions"]
        for index in range(0, len(data), 3):
            for axis in range(3):
                value = data[index + axis]
                mins[axis] = min(mins[axis], value)
                maxs[axis] = max(maxs[axis], value)
    return {"min": [round(v, 6) for v in mins], "max": [round(v, 6) for v in maxs]}


def build_variant(style: str, materials: dict[str, bpy.types.Material]) -> dict:
    parts: list[dict] = []
    for hand in ("trigger", "support"):
        glove_part = build_human_glove_part(style, hand)
        parts.append(glove_part)
        add_payload_object(f"{style}-{hand}-glove", glove_part, materials["glove"])
        sleeve = add_sleeve_mesh(f"{style}-{hand}-sleeve", materials)
        cuff = add_cuff_mesh(f"{style}-{hand}-cuff", materials)
        parts.append(mesh_payload(sleeve, f"{hand}-sleeve", "sleeve", "sleeve"))
        parts.append(mesh_payload(cuff, f"{hand}-cuff", "cuff", "rubber"))

    defaults = {
        "pistol": {
            "gripRight": [0.045, -0.108, -0.020],
            "gripLeft": [-0.025, -0.105, 0.005],
            "supportRotation": [0, math.pi / 2, -math.pi / 2],
            "triggerRotation": [0, -math.pi / 2, math.pi / 2],
        },
        "rifle": {
            "gripRight": [0.035, -0.060, -0.045],
            "gripLeft": [-0.025, 0.020, 0.290],
            "supportRotation": [0, math.pi / 2, 0],
            "triggerRotation": [0, -math.pi / 2, math.pi / 2],
        },
    }[style]
    triangles = sum(len(part["indices"]) // 3 for part in parts)
    return {
        "style": style,
        "schemaVersion": 1,
        "defaults": defaults,
        "sleeve": {
            "startPoint": [0, -0.065, -0.010],
            "triggerEnd": [0.190, -0.780, -0.300],
            "supportEnd": [-0.170, -0.780, -0.300],
        },
        "parts": parts,
        "bounds": hand_bounds(parts),
        "triangles": triangles,
    }


def add_payload_object(name: str, payload: dict, material: bpy.types.Material) -> bpy.types.Object:
    verts = [tuple(payload["positions"][i:i + 3]) for i in range(0, len(payload["positions"]), 3)]
    faces = [tuple(payload["indices"][i:i + 3]) for i in range(0, len(payload["indices"]), 3)]
    mesh = bpy.data.meshes.new(f"{name}-mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.shade_smooth()
    obj.select_set(False)
    return obj


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def export_runtime_assets(variants: dict[str, dict]) -> None:
    payload = {
        "schemaVersion": 1,
        "generatedBy": "scripts/blender/build_hands.py",
        "coordinateSystem": "Babylon viewmodel local, +Y up, +Z forward",
        "license": "Hands derived from MakeHuman basemesh hm08 (CC0-1.0); sleeves and pose processing are project-authored.",
        "variants": variants,
    }
    write_json(PUBLIC_DIR / "tactical-hands.json", payload)
    manifest = {
        "name": "tactical-hands",
        "version": 1,
        "license": "MakeHuman basemesh hm08 CC0-1.0 derivative plus project-authored sleeves and pose processing",
        "files": {},
        "triangles": {name: variant["triangles"] for name, variant in variants.items()},
    }
    write_json(PUBLIC_DIR / "manifest.json", manifest)


def save_sources() -> None:
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_DIR / "tactical-hands.blend"))
    bpy.ops.export_scene.gltf(filepath=str(PUBLIC_DIR / "tactical-hands.glb"), export_format="GLB")


def main() -> None:
    ensure_dirs()
    bpy.context.preferences.filepaths.save_version = 0


    clear_scene()
    materials = make_materials()
    variants = {style: build_variant(style, materials) for style in ("pistol", "rifle")}
    save_sources()
    export_runtime_assets(variants)
    manifest_path = PUBLIC_DIR / "manifest.json"
    provenance = {
        "source": "MakeHuman basemesh hm08",
        "usage": "Glove hand surfaces are derived from the CC0 basemesh; sleeves and weapon grip pose processing are project-authored.",
        "authors": ["Data Collection AB", "Joel Palmius", "Jonas Hauquier"],
        "license": "CC0-1.0",
        "officialUrls": [
            "http://www.makehumancommunity.org",
            "https://static.makehumancommunity.org/assets/creatingassets/license.html",
        ],
        "files": {
            "base.obj": {"sha256": sha256(REFERENCE_DIR / "base.obj"), "bytes": (REFERENCE_DIR / "base.obj").stat().st_size},
            "LICENSE.ASSETS.md": {"sha256": sha256(REFERENCE_DIR / "LICENSE.ASSETS.md"), "bytes": (REFERENCE_DIR / "LICENSE.ASSETS.md").stat().st_size},
        },
    }
    write_json(REFERENCE_DIR / "PROVENANCE.json", provenance)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for path in sorted(PUBLIC_DIR.iterdir()):
        if path.is_file() and path.name != "manifest.json":
            manifest["files"][path.name] = {"sha256": sha256(path), "bytes": path.stat().st_size}
    manifest["sourceAssets"] = {
        "makeHumanBasemeshHm08": provenance,
        "referenceFiles": {
            "assets/blender/hands/reference/base.obj": provenance["files"]["base.obj"],
            "assets/blender/hands/reference/LICENSE.ASSETS.md": provenance["files"]["LICENSE.ASSETS.md"],
            "assets/blender/hands/reference/PROVENANCE.json": {
                "sha256": sha256(REFERENCE_DIR / "PROVENANCE.json"),
                "bytes": (REFERENCE_DIR / "PROVENANCE.json").stat().st_size,
            },
        },
    }
    write_json(manifest_path, manifest)
    print(json.dumps({"public": str(PUBLIC_DIR), "triangles": manifest["triangles"]}, indent=2))


if __name__ == "__main__":
    main()
