# Continuous skinned tactical operator

Project-authored derivative of the local **MakeHuman Community CC0** base mesh. The MakeHuman body provides real human proportions, surface anatomy and helper joint landmarks; its continuous tights helper forms the uninterrupted garment surface. No CS2 assets are included.

## Reproduce

From the repository root:

```sh
blender --background --factory-startup --threads 4 --python scripts/blender/build_skinned_operator.py
```

Requires only the existing local Blender installation. No paid services or added Python packages are used. The game-dev wrapper CLI was not present; native Blender and explicit JSON/GLB validation were used.

## Files and integration

- `operator.json`: 18 bones, global rest positions, translation-only bind frame contract, four weight slots per vertex; Y up, +Z forward, outward CCW triangle winding.
- `operator.glb`: one mesh, eight material primitives, one skin containing all 18 joints.
- `textures/fabric.png`: neutral woven modulation; multiply once by material albedo.
- `textures/fabric-normal.png`: OpenGL tangent-space normal map, subtle strength recommended (0.22).
- `LICENSE.CC0.md`: source asset license. `manifest.json` records source and result hashes.
- Blender rest source and crouched review source live in `assets/blender/skinned-operator/`.

Source helper name L is the positive X half of the rest mesh. Runtime can map either hand to a weapon grip by position; the names do not imply which hand must operate the trigger. The original wrist-to-middle-knuckle head/tail axes are retained; the relaxed finger curl is baked into the mesh. Clothing vertices are shared at joint regions, with blended arm/chest, thigh/pelvis, knee and ankle weights. Rigid protective items use their owning bone; boot shafts blend with shins and feet.

The result is a working continuous weighted character with simple original tactical equipment. Boots, goggles and fabric still have limited close-up detail. Blender preview inspection is distinct from game rendering and movement verification; see `validation.json` for the evidence boundary.

## Uniform detail revision

The helper garment originally occupied a tiny corner of its source UV atlas, causing nearly uniform fabric color in game. The outfit now uses physical-scale UVs with 512-pixel medium-scale dye variation and subtle fabric normals. Shirt cuffs and collar, sleeve pockets, elbow reinforcement, trouser seams, plate-pocket binding, helmet edging/retention hardware and boot sole welts provide visible construction detail. Hidden anatomy and garment feet under the boots were removed to keep the result at 45,170 runtime triangles. The uninterrupted garment topology and all 18 rest bones are preserved.

Knee protection is integrated into the continuous trouser surface and carries the same thigh/shin weights. Its material border shares 80 identically positioned and weighted vertices with the trouser fabric, preventing rigid pads from detaching in a deep crouch.
