#!/usr/bin/env python3
"""Convert the Poly Haven service pistol glTF into compact runtime JSON."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import struct
from pathlib import Path
from typing import Any


SOURCE_NODES = [
    (0, "body"),
    (1, "slide"),
    (2, "magazine"),
    (5, "hammer"),
    (6, "trigger"),
]

TEXTURE_FILES = {
    "albedo": "textures/service_pistol_diff_1k.jpg",
    "normal": "textures/service_pistol_nor_gl_1k.jpg",
    "orm": "textures/service_pistol_arm_1k.jpg",
}

COMPONENTS = {
    5120: ("b", 1),
    5121: ("B", 1),
    5122: ("h", 2),
    5123: ("H", 2),
    5125: ("I", 4),
    5126: ("f", 4),
}

TYPE_COUNTS = {
    "SCALAR": 1,
    "VEC2": 2,
    "VEC3": 3,
    "VEC4": 4,
}

SCALE = 2.0
TARGET_Y_SHIFT = -0.07


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "assets/sources/service-pistol",
        help="Directory containing service_pistol.gltf, service_pistol.bin, and textures/",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/models/service-pistol"),
        help="Output package directory relative to the project root.",
    )
    return parser.parse_args()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


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


def read_accessor(gltf: dict[str, Any], blob: bytes, accessor_index: int) -> list[Any]:
    accessor = gltf["accessors"][accessor_index]
    view = gltf["bufferViews"][accessor["bufferView"]]
    fmt, byte_size = COMPONENTS[accessor["componentType"]]
    component_count = TYPE_COUNTS[accessor["type"]]
    count = accessor["count"]
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    stride = view.get("byteStride", component_count * byte_size)

    values: list[Any] = []
    for row_index in range(count):
        base = offset + row_index * stride
        row = [
            struct.unpack_from("<" + fmt, blob, base + component_index * byte_size)[0]
            for component_index in range(component_count)
        ]
        values.append(row[0] if component_count == 1 else row)
    return values


def source_with_translation(point: list[float], translation: list[float]) -> list[float]:
    return [point[i] + translation[i] for i in range(3)]


def to_target_position(point: list[float]) -> list[float]:
    return [
        round(point[2] * SCALE, 7),
        round(point[1] * SCALE + TARGET_Y_SHIFT, 7),
        round(point[0] * SCALE, 7),
    ]


def to_target_normal(normal: list[float]) -> list[float]:
    return [round(normal[2], 7), round(normal[1], 7), round(normal[0], 7)]


def flatten(rows: list[list[float]]) -> list[float]:
    return [value for row in rows for value in row]


def bounds(points: list[list[float]]) -> dict[str, list[float]]:
    return {
        "min": [round(min(point[i] for point in points), 7) for i in range(3)],
        "max": [round(max(point[i] for point in points), 7) for i in range(3)],
    }


def convert_part(
    gltf: dict[str, Any],
    blob: bytes,
    node_index: int,
    role: str,
) -> tuple[dict[str, Any], dict[str, Any], list[list[float]], list[list[float]]]:
    node = gltf["nodes"][node_index]
    mesh = gltf["meshes"][node["mesh"]]
    primitive = mesh["primitives"][0]
    translation = node.get("translation", [0.0, 0.0, 0.0])

    if role == "magazine":
        # Node 2 is authored with an x=-0.1 exhibition offset. The mesh's local
        # coordinates already place the loaded magazine inside the grip.
        translation = [0.0, 0.0, 0.0]

    source_positions = [
        source_with_translation(point, translation)
        for point in read_accessor(gltf, blob, primitive["attributes"]["POSITION"])
    ]
    source_normals = read_accessor(gltf, blob, primitive["attributes"]["NORMAL"])
    uvs = read_accessor(gltf, blob, primitive["attributes"]["TEXCOORD_0"])
    source_indices = read_accessor(gltf, blob, primitive["indices"])

    target_positions = [to_target_position(point) for point in source_positions]
    target_normals = [to_target_normal(normal) for normal in source_normals]

    target_indices: list[int] = []
    for i in range(0, len(source_indices), 3):
        target_indices.extend(
            [
                int(source_indices[i]),
                int(source_indices[i + 2]),
                int(source_indices[i + 1]),
            ]
        )

    part = {
        "name": node["name"],
        "role": role,
        "positions": flatten(target_positions),
        "normals": flatten(target_normals),
        "uvs": flatten([[round(uv[0], 7), round(uv[1], 7)] for uv in uvs]),
        "indices": target_indices,
    }
    report = {
        "node": node_index,
        "name": node["name"],
        "role": role,
        "mesh": mesh.get("name"),
        "sourceTranslationBaked": [round(float(value), 10) for value in translation],
        "vertexCount": len(target_positions),
        "triangleCount": len(target_indices) // 3,
        "sourceBounds": bounds(source_positions),
        "targetBounds": bounds(target_positions),
    }
    return part, report, target_positions, source_positions


def copy_textures(source: Path, output: Path) -> dict[str, str]:
    texture_dir = output / "textures"
    texture_dir.mkdir(parents=True, exist_ok=True)
    result: dict[str, str] = {}
    for slot, rel in TEXTURE_FILES.items():
        src = source / rel
        dest = texture_dir / src.name
        shutil.copy2(src, dest)
        result[slot] = str(Path("textures") / src.name)
    return result


def build_manifest(
    source: Path,
    output: Path,
    part_reports: list[dict[str, Any]],
    source_bounds: dict[str, list[float]],
    target_bounds: dict[str, list[float]],
) -> dict[str, Any]:
    source_files = [
        source / "service_pistol.gltf",
        source / "service_pistol.bin",
        *(source / rel for rel in TEXTURE_FILES.values()),
    ]
    output_files = sorted(
        path
        for path in output.rglob("*")
        if path.is_file() and path.name != "manifest.json"
    )
    return {
        "asset": "service-pistol",
        "schema": "breachline.compact-mesh.v1",
        "source": {
            "title": "Service Pistol",
            "author": "Mateusz Sadek / Poly Haven",
            "license": "CC0",
            "assetUrl": "https://polyhaven.com/a/service_pistol",
            "licenseUrl": "https://polyhaven.com/license",
            "stagingDirectory": source_label(source),
        },
        "conversion": {
            "script": "scripts/convert-service-pistol.py",
            "sourceForward": "+X barrel",
            "targetForward": "+Z barrel",
            "positionTransform": "target(x,y,z)=(source.z, source.y, source.x) * 2, then y += -0.07",
            "normalTransform": "target(nx,ny,nz)=(source.nz, source.ny, source.nx)",
            "triangleWinding": "reversed after X/Z axis swap",
            "magazineTransformChoice": {
                "sourceNode": 2,
                "authoredNodeTranslation": [-0.1000000015, 0.0, 0.0],
                "bakedTranslation": [0.0, 0.0, 0.0],
                "reason": "Node 2's x=-0.1 translation is an exhibition offset; its local mesh bounds already align with the grip.",
            },
            "sourceBounds": source_bounds,
            "targetBounds": target_bounds,
            "parts": part_reports,
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
                for path in output_files
            ],
        },
    }


def main() -> None:
    args = parse_args()
    source = args.source.resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)

    gltf = read_json(source / "service_pistol.gltf")
    blob = (source / "service_pistol.bin").read_bytes()

    parts: list[dict[str, Any]] = []
    part_reports: list[dict[str, Any]] = []
    all_target_positions: list[list[float]] = []
    all_source_positions: list[list[float]] = []

    for node_index, role in SOURCE_NODES:
        part, report, target_positions, source_positions = convert_part(
            gltf,
            blob,
            node_index,
            role,
        )
        parts.append(part)
        part_reports.append(report)
        all_target_positions.extend(target_positions)
        all_source_positions.extend(source_positions)

    textures = copy_textures(source, output)
    package = {
        "parts": parts,
        "textures": textures,
        "bounds": bounds(all_target_positions),
    }

    model_path = output / "service-pistol.json"
    model_path.write_text(json.dumps(package, separators=(",", ":")), encoding="utf-8")

    manifest = build_manifest(
        source,
        output,
        part_reports,
        bounds(all_source_positions),
        bounds(all_target_positions),
    )
    (output / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"Wrote {model_path}")
    print(f"Wrote {output / 'manifest.json'}")
    print(f"Target bounds: {json.dumps(package['bounds'])}")


if __name__ == "__main__":
    main()
