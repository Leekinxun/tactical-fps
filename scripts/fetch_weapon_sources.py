#!/usr/bin/env python3
"""Restore immutable, hash-checked CC0 conversion inputs from their original hosts."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import json
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "assets" / "sources"


def download(url: str, destination: Path, expected: str) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and hashlib.sha256(destination.read_bytes()).hexdigest() == expected:
        return
    temporary = destination.with_suffix(destination.suffix + ".download")
    subprocess.run(["curl", "--max-time", "300", "--retry", "1", "-fsSL", url, "-o", str(temporary)], check=True)
    if hashlib.sha256(temporary.read_bytes()).hexdigest() != expected:
        temporary.unlink()
        raise ValueError(f"Source hash mismatch: {destination.name}")
    temporary.replace(destination)


def pistol() -> None:
    package = ROOT / "public/models/service-pistol"
    manifest = json.loads((package / "manifest.json").read_text())
    expected = {item["path"]: item["sha256"] for item in manifest["hashes"]["source"]}
    target = SOURCES / "service-pistol"
    urls = {
        "service_pistol.gltf": "https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/service_pistol/service_pistol_1k.gltf",
        "service_pistol.bin": "https://dl.polyhaven.org/file/ph-assets/Models/gltf/4k/service_pistol/service_pistol.bin",
    }
    for name, url in urls.items():
        download(url, target / name, expected[name])
    for name, digest in expected.items():
        if name.startswith("textures/"):
            origin = package / name
            if hashlib.sha256(origin.read_bytes()).hexdigest() != digest:
                raise ValueError(f"Packaged source texture hash mismatch: {name}")
            (target / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(origin, target / name)
    (target / "SOURCE.json").write_text(json.dumps({"author": "Mateusz Sadek / Poly Haven", "license": "CC0-1.0", "assetUrl": "https://polyhaven.com/a/service_pistol", "licenseUrl": "https://polyhaven.com/license", "downloads": urls}, indent=2))


def rifle() -> None:
    manifest = json.loads((ROOT / "public/models/m4a1/manifest.json").read_text())
    source = manifest["source"]
    download(source["downloadUrl"], SOURCES / "m4a1/m4a1_0.zip", source["archive"]["sha256"])
    (SOURCES / "m4a1/SOURCE.json").write_text(json.dumps({"author": source["author"], "license": source["license"], "assetUrl": source["assetUrl"], "licenseUrl": source["licenseUrl"], "downloadUrl": source["downloadUrl"]}, indent=2))


if __name__ == "__main__":
    with ThreadPoolExecutor(max_workers=2) as pool:
        for result in pool.map(lambda operation: operation(), [pistol, rifle]):
            pass
    print("CC0 sources restored and SHA256 verified under assets/sources/.")
