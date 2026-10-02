# Runtime 3D assets

| Package | Author | Primary source | License |
| --- | --- | --- | --- |
| service-pistol | Mateusz Sadek / Poly Haven | https://polyhaven.com/a/service_pistol | CC0: https://polyhaven.com/license |
| m4a1 | nisu / 3DModelsCC0 | https://opengameart.org/content/m4a1-assault-rifle | CC0-1.0: https://creativecommons.org/publicdomain/zero/1.0/ |
| operator | Local Blender build plus MakeHuman body reference | `scripts/blender/build_operator.py`, MakeHuman base mesh | Project-authored mesh; MakeHuman body reference is CC0-1.0 |
| tactical-hands | Local Blender build | `public/models/tactical-hands/manifest.json` | Project-authored |
| tactical-weapons | Local Blender build | `public/models/tactical-weapons/manifest.json` | Project-authored |

Each package includes a manifest with source/package SHA256 hashes, source geometry transforms and texture provenance. Textures are copied unchanged. `scripts/convert-service-pistol.py` reads the official glTF buffer; `scripts/convert-m4a1.py` reads the original binary FBX with Python's standard library. Conversion produces static vertex data plus separate slide/bolt/magazine parts, with Y up and barrel forward +Z.

The native Babylon loader uses the authored normals and CCW triangle convention with an explicit clockwise material orientation. The source meshes supply geometry and textures; in-game pose, gloved hands and animation are original runtime code. PX-9 uses a local modern pistol, ARC-12 uses the Poly Haven pistol, BR-4 uses the M4A1, and VX-7/RIFT-6/Needle .50 use local authored weapon meshes. Weapon stats remain the project's original fictional catalog.

`public/models/operator/operator.json` is the compact runtime mesh for enemy and ally operators. It keeps the existing hit proxies and animation API while replacing the visible capsule body with a Blender-authored tactical operator. The package manifest records the MakeHuman CC0 reference used for body proportions.

## Local Blender packages

`tactical-weapons/` contains original PX-9, VX-7, RIFT-6 and Needle .50 meshes. `operator/` and `tactical-hands/` use the MakeHuman hm08 base mesh (CC0-1.0) with project-authored garments, equipment and pose processing. Source files, MakeHuman license copies and reconstruction scripts live under `assets/blender/` and `scripts/blender/`. Each manifest records package hashes. The Blender scenes are editable authoring sources; runtime JSON contains the named animation parts and contact points used by Babylon.

MakeHuman asset license: https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.md (section C). Only graphical assets are included; no MakeHuman application code is used.
