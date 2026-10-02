# Weighted tactical hands

Source: MakeHuman hm08 base mesh, CC0-1.0, retained in `assets/blender/hands/reference` with the upstream license and provenance. Skin, poses, glove protection, cuffs, and tailored sleeve surfaces are authored locally for this project.

Rebuild with the repository's `scripts/blender/build_weighted_hands.py` in Blender 4.5. The editable source is `assets/blender/weighted-hands/weighted-tactical-hands.blend`. No downloaded executable or paid generation service is involved.

## Runtime contract

- Coordinates: metres, local +Y up, +Z weapon forward. Bind vertex positions are shared anatomical topology.
- Each glove retains 16 bones, inverse-bind information through bind matrices, and four normalized skin weights per vertex. Blender bone heat distributes influences continuously; vertices are not assigned using a nearest-finger classifier.
- Bone matrices are column-major arrays consumed by Babylon. `open` and `grip` are local transforms relative to the bone parent. Runtime interpolation decomposes rotation/translation/scale and uses quaternion slerp.
- Each hand's origin is the central palm contact, not the wrist. `gripLeft` and `gripRight` are weapon surface contacts. `setGrip(0…1)` opens and closes the support fingers without moving that reference.
- Raised knuckle fabric panels retain the exact source topology and skin weights so they follow the glove. Sleeve ends stay below the view camera while the wrists move during reload.
- GPU geometry is fetched from JSON before the match; it is not bundled into the JavaScript entry point. Each glove owns one Skeleton; its disposal releases that Skeleton without disposing shared view materials.

Offline previews use the actual opaque project M4A1 and PX9 meshes. They validate source grip construction, not the production renderer's lighting. Live-game validation is performed separately.
