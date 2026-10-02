#!/usr/bin/env python3
"""Convert the OGA CC0 M4A1 binary FBX into compact runtime JSON."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import struct
import zipfile
import zlib
from pathlib import Path
from typing import Any


ASSET_URL = "https://opengameart.org/content/m4a1-assault-rifle"
DOWNLOAD_URL = "https://opengameart.org/sites/default/files/m4a1_0.zip"
LICENSE_URL = "https://creativecommons.org/publicdomain/zero/1.0/"
EXPECTED_ARCHIVE_SHA256 = "ed5779ec82718861964227e2aad2a900978ea087081154365d6d86246be62f0d"
TARGET_LENGTH = 0.9

MODEL_ROLES = {
    "Magazine": "magazine",
    "Charging_Handle": "bolt",
    "Ejector_Lid": "bolt",
    "Ejector_2": "bolt",
    "Base": "body",
    "Sight": "body",
    "Sight_2": "body",
    "Switch1": "body",
    "Switch2": "body",
    "Firemode_Selector": "body",
    "Trigger": "body",
    "Barrel": "body",
    "Stock": "body",
}

ROLE_ORDER = ["magazine", "bolt", "body"]
TEXTURE_NAME = "M4A1_Base_Color.png"

COMPONENTS = {
    "f": ("f", 4),
    "d": ("d", 8),
    "i": ("i", 4),
    "l": ("q", 8),
    "b": ("b", 1),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "assets/sources/m4a1/extracted/M4A1",
        help="Directory containing M4A1.fbx and M4A1_Base_Color.png.",
    )
    parser.add_argument(
        "--archive",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "assets/sources/m4a1/m4a1_0.zip",
        help="Optional original source archive, used for hash provenance.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/models/m4a1"),
        help="Output package directory relative to the project root.",
    )
    return parser.parse_args()


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def source_label(path: Path) -> str:
    try:
        return path.resolve().relative_to(Path(__file__).resolve().parents[1]).as_posix()
    except ValueError:
        return path.name


def ensure_source(source: Path, archive: Path) -> None:
    if (source / "M4A1.fbx").exists() and (source / TEXTURE_NAME).exists():
        return
    if not archive.exists():
        raise FileNotFoundError(
            f"Missing {source / 'M4A1.fbx'} and source archive {archive}."
        )
    source.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as z:
        for name in ["M4A1/M4A1.fbx", f"M4A1/{TEXTURE_NAME}"]:
            z.extract(name, source.parent)


def clean_fbx_name(value: str) -> str:
    return value.split("\x00", 1)[0]


class FbxParser:
    def __init__(self, path: Path):
        self.data = path.read_bytes()
        if not self.data.startswith(b"Kaydara FBX Binary  \x00\x1a\x00"):
            raise ValueError("Only binary FBX files are supported.")
        self.version = struct.unpack_from("<I", self.data, 23)[0]
        self.header_size = 25 if self.version >= 7500 else 13

    def parse(self) -> list[dict[str, Any]]:
        roots: list[dict[str, Any]] = []
        pos = 27
        while pos < len(self.data) - self.header_size:
            node, pos = self._read_node(pos, len(self.data))
            if node is None:
                break
            roots.append(node)
        return roots

    def _read_node(
        self,
        pos: int,
        limit: int,
    ) -> tuple[dict[str, Any] | None, int]:
        if pos + self.header_size > limit:
            return None, pos
        if self.header_size == 25:
            end_offset, prop_count, _prop_length = struct.unpack_from(
                "<QQQ",
                self.data,
                pos,
            )
            pos += 24
        else:
            end_offset, prop_count, _prop_length = struct.unpack_from(
                "<III",
                self.data,
                pos,
            )
            pos += 12
        name_length = self.data[pos]
        pos += 1
        if end_offset == 0 and prop_count == 0 and _prop_length == 0 and name_length == 0:
            return None, pos
        name = self.data[pos : pos + name_length].decode("utf-8", "replace")
        pos += name_length
        props = []
        for _ in range(prop_count):
            prop, pos = self._read_property(pos)
            props.append(prop)
        children = []
        while pos < end_offset - self.header_size:
            child, pos = self._read_node(pos, end_offset)
            if child is None:
                break
            children.append(child)
        return {"name": name, "props": props, "children": children}, end_offset

    def _read_property(self, pos: int) -> tuple[Any, int]:
        code = chr(self.data[pos])
        pos += 1
        if code == "Y":
            return struct.unpack_from("<h", self.data, pos)[0], pos + 2
        if code == "C":
            return bool(self.data[pos]), pos + 1
        if code == "I":
            return struct.unpack_from("<i", self.data, pos)[0], pos + 4
        if code == "F":
            return struct.unpack_from("<f", self.data, pos)[0], pos + 4
        if code == "D":
            return struct.unpack_from("<d", self.data, pos)[0], pos + 8
        if code == "L":
            return struct.unpack_from("<q", self.data, pos)[0], pos + 8
        if code in COMPONENTS:
            count, encoding, compressed_length = struct.unpack_from("<III", self.data, pos)
            pos += 12
            raw = self.data[pos : pos + compressed_length]
            pos += compressed_length
            if encoding:
                raw = zlib.decompress(raw)
            fmt, byte_size = COMPONENTS[code]
            return list(struct.unpack("<" + fmt * count, raw[: count * byte_size])), pos
        if code in ("S", "R"):
            length = struct.unpack_from("<I", self.data, pos)[0]
            pos += 4
            raw = self.data[pos : pos + length]
            pos += length
            if code == "S":
                return raw.decode("utf-8", "replace"), pos
            return raw, pos
        raise ValueError(f"Unsupported FBX property code {code!r} at {pos}")


def child(node: dict[str, Any], name: str) -> dict[str, Any] | None:
    return next((candidate for candidate in node["children"] if candidate["name"] == name), None)


def children(node: dict[str, Any], name: str) -> list[dict[str, Any]]:
    return [candidate for candidate in node["children"] if candidate["name"] == name]


def property_values(model: dict[str, Any]) -> dict[str, list[float]]:
    values: dict[str, list[float]] = {}
    props = child(model, "Properties70")
    if not props:
        return values
    for prop in children(props, "P"):
        fields = prop["props"]
        if fields and fields[0] in ("Lcl Translation", "Lcl Rotation", "Lcl Scaling"):
            values[fields[0]] = [float(fields[4]), float(fields[5]), float(fields[6])]
    return values


def identity() -> list[list[float]]:
    return [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]


def matmul(a: list[list[float]], b: list[list[float]]) -> list[list[float]]:
    return [
        [sum(a[row][k] * b[k][col] for k in range(4)) for col in range(4)]
        for row in range(4)
    ]


def translation_matrix(v: list[float]) -> list[list[float]]:
    m = identity()
    m[0][3], m[1][3], m[2][3] = v
    return m


def scale_matrix(v: list[float]) -> list[list[float]]:
    m = identity()
    m[0][0], m[1][1], m[2][2] = v
    return m


def rotation_matrix(degrees: list[float]) -> list[list[float]]:
    rx, ry, rz = [math.radians(v) for v in degrees]
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)
    mx = [[1, 0, 0, 0], [0, cx, -sx, 0], [0, sx, cx, 0], [0, 0, 0, 1]]
    my = [[cy, 0, sy, 0], [0, 1, 0, 0], [-sy, 0, cy, 0], [0, 0, 0, 1]]
    mz = [[cz, -sz, 0, 0], [sz, cz, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
    return matmul(mz, matmul(my, mx))


def local_matrix(props: dict[str, list[float]]) -> list[list[float]]:
    return matmul(
        translation_matrix(props.get("Lcl Translation", [0.0, 0.0, 0.0])),
        matmul(
            rotation_matrix(props.get("Lcl Rotation", [0.0, 0.0, 0.0])),
            scale_matrix(props.get("Lcl Scaling", [1.0, 1.0, 1.0])),
        ),
    )


def transform_point(m: list[list[float]], p: list[float]) -> list[float]:
    return [
        m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2] + m[0][3],
        m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2] + m[1][3],
        m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2] + m[2][3],
    ]


def transform_normal(m: list[list[float]], n: list[float]) -> list[float]:
    out = [
        m[0][0] * n[0] + m[0][1] * n[1] + m[0][2] * n[2],
        m[1][0] * n[0] + m[1][1] * n[1] + m[1][2] * n[2],
        m[2][0] * n[0] + m[2][1] * n[1] + m[2][2] * n[2],
    ]
    return normalize(out)


def normalize(v: list[float]) -> list[float]:
    length = math.sqrt(sum(component * component for component in v))
    if length <= 1e-12:
        return [0.0, 1.0, 0.0]
    return [component / length for component in v]


def flatten(rows: list[list[float]]) -> list[float]:
    return [value for row in rows for value in row]


def round_row(values: list[float], digits: int = 7) -> list[float]:
    return [round(value, digits) for value in values]


def bounds(points: list[list[float]]) -> dict[str, list[float]]:
    return {
        "min": [round(min(point[i] for point in points), 7) for i in range(3)],
        "max": [round(max(point[i] for point in points), 7) for i in range(3)],
    }


def parse_geometry(geometry: dict[str, Any]) -> dict[str, Any]:
    verts = child(geometry, "Vertices")["props"][0]
    polygon_indices = child(geometry, "PolygonVertexIndex")["props"][0]
    normal_layer = child(geometry, "LayerElementNormal")
    uv_layer = child(geometry, "LayerElementUV")

    normals = child(normal_layer, "Normals")["props"][0]
    normal_mapping = child(normal_layer, "MappingInformationType")["props"][0]
    normal_reference = child(normal_layer, "ReferenceInformationType")["props"][0]

    uv_values = child(uv_layer, "UV")["props"][0]
    uv_indices_node = child(uv_layer, "UVIndex")
    uv_indices = uv_indices_node["props"][0] if uv_indices_node else None
    uv_mapping = child(uv_layer, "MappingInformationType")["props"][0]
    uv_reference = child(uv_layer, "ReferenceInformationType")["props"][0]

    return {
        "vertices": [verts[i : i + 3] for i in range(0, len(verts), 3)],
        "polygonIndices": polygon_indices,
        "normals": [normals[i : i + 3] for i in range(0, len(normals), 3)],
        "normalMapping": normal_mapping,
        "normalReference": normal_reference,
        "uvs": [uv_values[i : i + 2] for i in range(0, len(uv_values), 2)],
        "uvIndices": uv_indices,
        "uvMapping": uv_mapping,
        "uvReference": uv_reference,
    }


def polygon_vertex_stream(indices: list[int]) -> list[list[int]]:
    polys: list[list[int]] = []
    current: list[int] = []
    for value in indices:
        if value < 0:
            current.append(~value)
            polys.append(current)
            current = []
        else:
            current.append(value)
    if current:
        polys.append(current)
    return polys


def get_normal(geom: dict[str, Any], vertex_index: int, polygon_vertex_index: int) -> list[float]:
    if geom["normalMapping"] == "ByPolygonVertex":
        index = polygon_vertex_index
    elif geom["normalMapping"] == "ByVertice":
        index = vertex_index
    else:
        index = 0
    if geom["normalReference"] == "IndexToDirect":
        raise ValueError("Indexed normals are not implemented for this M4A1 FBX.")
    return geom["normals"][index]


def get_uv(geom: dict[str, Any], vertex_index: int, polygon_vertex_index: int) -> list[float]:
    if geom["uvMapping"] == "ByPolygonVertex":
        index = polygon_vertex_index
    elif geom["uvMapping"] == "ByVertice":
        index = vertex_index
    else:
        index = 0
    if geom["uvReference"] == "IndexToDirect":
        index = geom["uvIndices"][index]
    return geom["uvs"][index]


def source_to_target(point: list[float]) -> list[float]:
    return [-point[0], point[1], -point[2]]


def target_normal(normal: list[float]) -> list[float]:
    return normalize([-normal[0], normal[1], -normal[2]])


def add_vertex(
    part: dict[str, Any],
    key_to_index: dict[tuple[float, ...], int],
    position: list[float],
    normal: list[float],
    uv: list[float],
) -> int:
    p = round_row(position)
    n = round_row(normal)
    t = [round(uv[0], 7), round(uv[1], 7)]
    key = tuple(p + n + t)
    if key in key_to_index:
        return key_to_index[key]
    index = len(part["positions"]) // 3
    key_to_index[key] = index
    part["positions"].extend(p)
    part["normals"].extend(n)
    part["uvs"].extend(t)
    return index


def collect_scene(roots: list[dict[str, Any]]) -> tuple[dict[str, Any], dict[str, Any]]:
    objects = next(node for node in roots if node["name"] == "Objects")
    connections = next(node for node in roots if node["name"] == "Connections")

    geometries = {
        geometry["props"][0]: parse_geometry(geometry)
        for geometry in children(objects, "Geometry")
    }
    models = {}
    for model in children(objects, "Model"):
        model_id = model["props"][0]
        models[model_id] = {
            "id": model_id,
            "name": clean_fbx_name(model["props"][1]),
            "type": model["props"][2],
            "props": property_values(model),
            "children": [],
            "geometry": None,
        }

    root_model_ids: list[int] = []
    for connection in children(connections, "C"):
        props = connection["props"]
        if props[0] != "OO":
            continue
        child_id, parent_id = props[1], props[2]
        if child_id in geometries and parent_id in models:
            models[parent_id]["geometry"] = child_id
        elif child_id in models and parent_id in models:
            models[parent_id]["children"].append(child_id)
        elif child_id in models and parent_id == 0:
            root_model_ids.append(child_id)

    world_matrices: dict[int, list[list[float]]] = {}

    def assign_world(model_id: int, parent: list[list[float]]) -> None:
        model = models[model_id]
        world = matmul(parent, local_matrix(model["props"]))
        world_matrices[model_id] = world
        for child_id in model["children"]:
            assign_world(child_id, world)

    for root_id in root_model_ids:
        assign_world(root_id, identity())

    return {"geometries": geometries, "models": models}, {"world": world_matrices}


def convert_scene(scene: dict[str, Any], transforms: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    models = scene["models"]
    geometries = scene["geometries"]
    world = transforms["world"]

    raw_by_model: dict[str, list[list[float]]] = {}
    for model in models.values():
        role = MODEL_ROLES.get(model["name"])
        geometry_id = model["geometry"]
        if not role or geometry_id is None:
            continue
        geom = geometries[geometry_id]
        matrix = world[model["id"]]
        raw_by_model[model["name"]] = [
            source_to_target(transform_point(matrix, point))
            for point in geom["vertices"]
        ]

    all_raw = [point for points in raw_by_model.values() for point in points]
    trigger_raw = raw_by_model["Trigger"]
    origin = [
        sum(point[i] for point in trigger_raw) / len(trigger_raw)
        for i in range(3)
    ]
    length = max(point[2] for point in all_raw) - min(point[2] for point in all_raw)
    scale = TARGET_LENGTH / length

    parts = {
        role: {
            "name": f"m4a1_{role}",
            "role": role,
            "positions": [],
            "normals": [],
            "uvs": [],
            "indices": [],
        }
        for role in ROLE_ORDER
    }
    key_maps = {role: {} for role in ROLE_ORDER}
    reports = []
    omitted_degenerate = 0
    normal_dot_positive = 0
    normal_dot_negative = 0

    for model in models.values():
        role = MODEL_ROLES.get(model["name"])
        geometry_id = model["geometry"]
        if not role or geometry_id is None:
            continue
        geom = geometries[geometry_id]
        matrix = world[model["id"]]
        polygons = polygon_vertex_stream(geom["polygonIndices"])
        polygon_vertex_cursor = 0
        model_triangles = 0
        model_points: list[list[float]] = []
        for polygon in polygons:
            polygon_entries = []
            for vertex_index in polygon:
                source_point = transform_point(matrix, geom["vertices"][vertex_index])
                raw_point = source_to_target(source_point)
                final_point = [
                    (raw_point[i] - origin[i]) * scale
                    for i in range(3)
                ]
                source_normal = transform_normal(
                    matrix,
                    get_normal(geom, vertex_index, polygon_vertex_cursor),
                )
                final_normal = target_normal(source_normal)
                uv = get_uv(geom, vertex_index, polygon_vertex_cursor)
                polygon_entries.append((final_point, final_normal, uv))
                model_points.append(final_point)
                polygon_vertex_cursor += 1
            for i in range(1, len(polygon_entries) - 1):
                tri = [polygon_entries[0], polygon_entries[i], polygon_entries[i + 1]]
                a, b, c = [entry[0] for entry in tri]
                ab = [b[j] - a[j] for j in range(3)]
                ac = [c[j] - a[j] for j in range(3)]
                cross = [
                    ab[1] * ac[2] - ab[2] * ac[1],
                    ab[2] * ac[0] - ab[0] * ac[2],
                    ab[0] * ac[1] - ab[1] * ac[0],
                ]
                if sum(value * value for value in cross) <= 1e-16:
                    omitted_degenerate += 1
                    continue
                average_normal = normalize(
                    [
                        sum(entry[1][axis] for entry in tri) / 3.0
                        for axis in range(3)
                    ]
                )
                dot = sum(cross[axis] * average_normal[axis] for axis in range(3))
                if dot >= 0:
                    normal_dot_positive += 1
                else:
                    normal_dot_negative += 1
                indices = [
                    add_vertex(parts[role], key_maps[role], position, normal, uv)
                    for position, normal, uv in tri
                ]
                parts[role]["indices"].extend(indices)
                model_triangles += 1
        reports.append(
            {
                "model": model["name"],
                "role": role,
                "geometryId": geometry_id,
                "triangles": model_triangles,
                "bounds": bounds(model_points),
            }
        )

    part_list = [parts[role] for role in ROLE_ORDER]
    all_final = [
        part["positions"][i : i + 3]
        for part in part_list
        for i in range(0, len(part["positions"]), 3)
    ]
    package = {
        "parts": part_list,
        "textures": {
            "albedo": f"textures/{TEXTURE_NAME}",
            "normal": "",
            "orm": "",
        },
        "bounds": bounds(all_final),
    }
    report = {
        "sourceCoordinateSystem": "After FBX Model transforms, source world space is Y-up with rifle barrel along -Z.",
        "targetCoordinateSystem": "Y-up with rifle front/barrel along +Z.",
        "positionTransform": "targetRaw(x,y,z)=(-source.x, source.y, -source.z), a 180 degree Y rotation; subtract Trigger center; scale to 0.90 total length.",
        "normalTransform": "targetNormal=normalize(-source.nx, source.ny, -source.nz).",
        "originAnchor": {
            "model": "Trigger",
            "targetRawCenter": round_row(origin),
        },
        "scale": scale,
        "targetLength": TARGET_LENGTH,
        "bounds": package["bounds"],
        "omittedDegenerateTriangles": omitted_degenerate,
        "windingVsNormals": {
            "positiveDotTriangles": normal_dot_positive,
            "negativeDotTriangles": normal_dot_negative,
            "interpretation": "Positive dot means triangle winding agrees with transformed vertex normals; no winding reversal applied.",
        },
        "models": reports,
        "parts": [
            {
                "name": part["name"],
                "role": part["role"],
                "vertices": len(part["positions"]) // 3,
                "triangles": len(part["indices"]) // 3,
            }
            for part in part_list
        ],
    }
    return package, report


def write_manifest(
    output: Path,
    source: Path,
    archive: Path,
    conversion: dict[str, Any],
) -> None:
    source_files = [source / "M4A1.fbx", source / TEXTURE_NAME]
    archive_hash = sha256(archive) if archive.exists() else None
    package_files = sorted(
        path
        for path in output.rglob("*")
        if path.is_file() and path.name != "manifest.json"
    )
    manifest = {
        "asset": "m4a1",
        "schema": "breachline.compact-mesh.v1",
        "source": {
            "title": "M4A1 Assault Rifle",
            "author": "nisu / 3DModelsCC0",
            "license": "CC0-1.0",
            "assetUrl": ASSET_URL,
            "downloadUrl": DOWNLOAD_URL,
            "licenseUrl": LICENSE_URL,
            "archive": {
                "path": source_label(archive),
                "sha256": archive_hash,
                "expectedSha256": EXPECTED_ARCHIVE_SHA256,
                "verified": archive_hash == EXPECTED_ARCHIVE_SHA256,
            },
        },
        "conversion": {
            "script": "scripts/convert-m4a1.py",
            **conversion,
        },
        "hashes": {
            "source": [
                {
                    "path": str(path.relative_to(source)),
                    "sha256": sha256(path),
                    "bytes": path.stat().st_size,
                }
                for path in source_files
            ],
            "package": [
                {
                    "path": str(path.relative_to(output)),
                    "sha256": sha256(path),
                    "bytes": path.stat().st_size,
                }
                for path in package_files
            ],
        },
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    args = parse_args()
    source = args.source.resolve()
    archive = args.archive.resolve()
    output = args.output.resolve()
    ensure_source(source, archive)
    output.mkdir(parents=True, exist_ok=True)
    (output / "textures").mkdir(parents=True, exist_ok=True)

    if archive.exists() and sha256(archive) != EXPECTED_ARCHIVE_SHA256:
        raise ValueError(f"Archive SHA256 mismatch for {archive}")

    roots = FbxParser(source / "M4A1.fbx").parse()
    scene, transforms = collect_scene(roots)
    package, conversion_report = convert_scene(scene, transforms)

    shutil.copy2(source / TEXTURE_NAME, output / "textures" / TEXTURE_NAME)
    (output / "m4a1.json").write_text(
        json.dumps(package, separators=(",", ":")),
        encoding="utf-8",
    )
    write_manifest(output, source, archive, conversion_report)

    print(f"Wrote {output / 'm4a1.json'}")
    print(f"Wrote {output / 'manifest.json'}")
    print(f"Bounds: {json.dumps(package['bounds'])}")
    print(f"Parts: {json.dumps(conversion_report['parts'])}")


if __name__ == "__main__":
    main()
