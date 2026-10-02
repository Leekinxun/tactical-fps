import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector4 } from "@babylonjs/core/Maths/math.vector";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import type { Scene } from "@babylonjs/core/scene";
import { ARENA_BOUNDS, ARENA_BOXES, BOMB_SITES } from "../../shared/game-data.mjs";

type Triple = [number, number, number];

/** Architectural skins follow the shared collision volumes; roof scenery stays above play height. */
export function buildIndustrialDistrict(scene: Scene, shadow: ShadowGenerator): void {
  let serial = 0;
  const details: Mesh[] = [];
  const shadowDetails = new Set<Mesh>();
  const halfWidth = ARENA_BOUNDS.groundWidth / 2;
  const halfDepth = ARENA_BOUNDS.groundDepth / 2;
  const material = (name: string, color: string, roughness = 0.85, metal = 0): PBRMaterial => {
    const result = new PBRMaterial(`district-${name}`, scene);
    result.albedoColor = Color3.FromHexString(color).toLinearSpace();
    result.roughness = roughness;
    result.metallic = metal;
    return result;
  };
  const concrete = material("limestone-concrete", "#c7c7bb");
  const concreteMap = new Texture("/textures/materials/ivory-concrete-v2.png", scene);
  concreteMap.anisotropicFilteringLevel = 8;
  concrete.albedoTexture = concreteMap;
  const blue = material("blue-cladding", "#477585", 0.62, 0.18);
  const blueEdge = material("blue-folds", "#325564", 0.69, 0.16);
  const ivory = material("ivory-cladding", "#d0d0bf", 0.68, 0.12);
  blue.albedoTexture = concreteMap;
  ivory.albedoTexture = concreteMap;
  const trim = material("galvanized-trim", "#a2aaa7", 0.46, 0.6);
  const steel = material("dark-steel", "#323d41", 0.6, 0.55);
  const red = material("cargo-red", "#885447", 0.73, 0.15);
  red.albedoTexture = new Texture("/textures/painted-steel-albedo.png", scene);
  const ochre = material("safety-ochre", "#c69b43", 0.8);
  const white = material("road-paint", "#c8c9b9", 0.98);
  const glass = material("warehouse-glass", "#315667", 0.26, 0.12);
  glass.albedoTexture = new Texture("/textures/industrial-sky.png", scene);
  glass.emissiveColor = Color3.FromHexString("#789ca9").scale(0.06);
  const rubber = material("rubber", "#1d2425", 0.97);
  const asphalt = material("asphalt", "#b8b8b3", 0.98);
  const asphaltMap = new Texture("/textures/materials/yard-asphalt-v2.png", scene);
  asphaltMap.uScale = ARENA_BOUNDS.groundWidth / 3;
  asphaltMap.vScale = ARENA_BOUNDS.groundDepth / 3;
  asphaltMap.anisotropicFilteringLevel = 8;
  asphalt.albedoTexture = asphaltMap;
  const ground = scene.getMeshByName("ground");
  if (ground) ground.material = asphalt;
  const contactTexture = new DynamicTexture("district-contact-occlusion", { width: 128, height: 128 }, scene, false);
  const contactContext = contactTexture.getContext();
  const falloff = contactContext.createRadialGradient(64, 64, 28, 64, 64, 64);
  falloff.addColorStop(0, "rgba(0,0,0,.5)");
  falloff.addColorStop(0.78, "rgba(0,0,0,.25)");
  falloff.addColorStop(1, "rgba(0,0,0,0)");
  contactContext.fillStyle = falloff;
  contactContext.fillRect(0, 0, 128, 128);
  contactTexture.hasAlpha = true;
  contactTexture.update(false);
  const contactMaterial = new StandardMaterial("district-contact-occlusion", scene);
  contactMaterial.diffuseTexture = contactTexture;
  contactMaterial.useAlphaFromDiffuseTexture = true;
  contactMaterial.disableLighting = true;
  contactMaterial.diffuseColor = Color3.Black();
  for (const item of ARENA_BOXES.filter((b) => !b.name.endsWith("-wall"))) {
    const contact = MeshBuilder.CreateGround(`district-contact-${item.name}`, { width: item.dimensions[0] + 1.5, height: item.dimensions[2] + 1.5 }, scene);
    contact.position.set(item.position[0], 0.024, item.position[2]);
    contact.material = contactMaterial;
    contact.isPickable = false;
  }

  const box = (name: string, size: Triple, at: Triple, mat: PBRMaterial, cast = false): Mesh => {
    const [w, h, d] = size;
    const uv = (x: number, y: number) => new Vector4(0, 0, x / 3, y / 3);
    const mesh = MeshBuilder.CreateBox(`district-${name}-${serial++}`, {
      width: w, height: h, depth: d,
      faceUV: [uv(w, h), uv(w, h), uv(d, h), uv(d, h), uv(w, d), uv(w, d)],
    }, scene);
    mesh.position.set(...at);
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.receiveShadows = true;
    details.push(mesh);
    if (cast) { shadow.addShadowCaster(mesh); shadowDetails.add(mesh); }
    return mesh;
  };
  const cylinder = (name: string, radius: number, height: number, at: Triple, mat: PBRMaterial, axis: "x" | "y" | "z" = "y"): Mesh => {
    const mesh = MeshBuilder.CreateCylinder(`district-${name}-${serial++}`, { diameter: radius * 2, height, tessellation: 20 }, scene);
    mesh.position.set(...at);
    if (axis === "x") mesh.rotation.z = Math.PI / 2;
    if (axis === "z") mesh.rotation.x = Math.PI / 2;
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.receiveShadows = true;
    details.push(mesh);
    shadowDetails.add(mesh);
    shadow.addShadowCaster(mesh);
    return mesh;
  };
  const sign = (name: string, text: string, sub: string, size: [number, number], at: Triple, yaw = 0, color = "#426977"): void => {
    const texture = new DynamicTexture(`district-sign-${name}`, { width: 768, height: 256 }, scene, false);
    const ctx = texture.getContext();
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 768, 256);
    ctx.fillStyle = "#ecebdd";
    ctx.font = "bold 132px Arial";
    ctx.fillText(text, 34, 145);
    ctx.font = "26px Arial";
    ctx.fillText(sub, 39, 215);
    texture.update();
    const mat = new StandardMaterial(`district-sign-material-${name}`, scene);
    mat.diffuseTexture = texture;
    mat.emissiveColor = new Color3(0.23, 0.23, 0.23);
    mat.specularColor = Color3.Black();
    const mesh = MeshBuilder.CreatePlane(`district-sign-${name}`, { width: size[0], height: size[1] }, scene);
    mesh.position.set(...at);
    mesh.rotation.y = yaw;
    mesh.material = mat;
    mesh.isPickable = false;
  };
  const windowsFront = (name: string, x: number, y: number, z: number, width: number, count: number): void => {
    const pitch = width / count;
    for (let i = 0; i < count; i++) {
      const center = x - width / 2 + pitch * (i + 0.5);
      box(`${name}-window-frame`, [pitch - 0.12, 1.25, 0.14], [center, y, z], steel);
      box(`${name}-window-glass`, [pitch - 0.24, 1.08, 0.07], [center, y, z - 0.08], glass);
      box(`${name}-window-mullion`, [0.065, 1.1, 0.09], [center, y, z - 0.13], trim);
    }
  };
  const shutter = (name: string, x: number, z: number, width: number, height: number): void => {
    box(`${name}-door-frame`, [width + 0.24, height + 0.2, 0.16], [x, height / 2, z], steel);
    box(`${name}-door`, [width, height, 0.1], [x, height / 2, z - 0.1], trim);
    for (let y = 0.24; y < height; y += 0.22) box(`${name}-door-slat`, [width, 0.025, 0.035], [x, y, z - 0.17], steel);
    box(`${name}-canopy`, [width + 0.65, 0.12, 0.85], [x, height + 0.24, z - 0.28], blue, true);
  };

  for (const item of ARENA_BOXES) {
    const collider = scene.getMeshByName(item.name);
    if (collider) collider.material = item.name.startsWith("cover-") ? steel : concrete;
  }

  // The two former freestanding baffles are service buildings with doors, windows and roofs.
  for (const item of ARENA_BOXES.filter((b) => b.name.includes("baffle"))) {
    const [w, h, d] = item.dimensions;
    const [x, , z] = item.position;
    const face = z - d / 2;
    const collision = scene.getMeshByName(item.name);
    if (collision) collision.material = concrete;
    box("service-upper-storey", [w + 0.08, h - 2.8, d + 0.08], [x, (h + 2.8) / 2, z], blue);
    box("service-roof", [w + 0.55, 0.22, d + 0.55], [x, h + 0.11, z], steel, true);
    box("service-floor-band", [w + 0.12, 0.16, d + 0.12], [x, 2.8, z], trim);
    for (let panel = -w / 2 + 0.2; panel < w / 2; panel += 0.45) {
      box("service-corrugation", [0.045, h - 4.8, 0.055], [x + panel, h - (h - 4.8) / 2, face - 0.065], blueEdge);
    }
    windowsFront(item.name, x, 4.35, face - 0.1, w - 1.1, 6);
    shutter(item.name, x + 1.8, face - 0.12, 3.4, 2.65);
    box("service-personnel-door", [1.03, 2.18, 0.12], [x - 4.5, 1.1, face - 0.15], blueEdge);
    box("service-door-handle", [0.045, 0.3, 0.11], [x - 4.16, 1.1, face - 0.25], trim);
    box("service-fire-box", [0.38, 0.54, 0.16], [x - 3.65, 1.3, face - 0.22], red);
    sign(item.name, "K—7", "ENERGY SYSTEMS / SERVICE", [3.2, 1.06], [x - 3.3, 6.35, face - 0.14]);
    for (const offset of [-3.5, 1.7]) {
      box("roof-vent", [2, 0.85, 1.3], [x + offset, h + 0.65, z], trim, true);
      for (let louver = -0.8; louver < 0.9; louver += 0.2) box("roof-vent-louver", [0.07, 0.62, 0.08], [x + offset + louver, h + 0.65, z - 0.7], steel);
    }
    cylinder("downpipe", 0.055, h, [x + w / 2 - 0.2, h / 2, face - 0.16], trim);
    box("wall-junction-box", [0.45, 0.65, 0.22], [x - 1.9, 1.38, face - 0.16], steel, true);
    cylinder("wall-conduit", 0.025, 2.5, [x - 1.9, 2.95, face - 0.17], trim);
    box("door-luminaire", [1.4, 0.12, 0.21], [x + 1.8, 3.15, face - 0.25], steel, true);
    box("door-luminaire-diffuser", [1.2, 0.035, 0.15], [x + 1.8, 3.08, face - 0.27], ivory);
    box("door-apron", [w + 1, 0.018, 3], [x, 0.013, face - 1.5], concrete);
  }

  // Side wings have a heavy concrete base and a corrugated upper facade, not identical fence panels.
  for (const item of ARENA_BOXES.filter((b) => b.name.includes("divider"))) {
    const [w, h, d] = item.dimensions;
    const [x, , z] = item.position;
    const collision = scene.getMeshByName(item.name);
    if (collision) collision.material = concrete;
    const upper = x < 0 ? ivory : blue;
    box("wing-cladding", [w + 0.06, h - 2.6, d + 0.06], [x, (h + 2.6) / 2, z], upper);
    box("wing-roof", [w + 0.5, 0.2, d + 0.5], [x, h + 0.1, z], steel, true);
    for (const side of [-1, 1]) {
      const faceX = x + side * (w / 2 + 0.09);
      box("wing-plinth", [0.12, 0.42, d], [faceX, 0.21, z], steel);
      box("wing-cornice", [0.1, 0.14, d], [faceX, 2.6, z], trim);
      for (let dz = -d / 2 + 0.35; dz < d / 2; dz += 0.55) box("wing-sheet-rib", [0.04, h - 2.8, 0.03], [faceX, (h + 2.8) / 2, z + dz], x < 0 ? trim : blueEdge);
      for (let dz = -d / 2 + 2; dz < d / 2 - 1; dz += 5.2) {
        box("wing-window-frame", [0.14, 1.3, 3.25], [faceX, 4.5, z + dz], steel);
        box("wing-window", [0.07, 1.12, 3.07], [faceX + side * 0.09, 4.5, z + dz], glass);
        box("wing-window-bar", [0.12, 1.15, 0.07], [faceX + side * 0.14, 4.5, z + dz], trim);
      }
      cylinder("wing-drainpipe", 0.06, h, [faceX, h / 2, z + d / 2 - 0.25], trim);
    }
    const faceZ = z - d / 2 - 0.1;
    box("wing-end-door", [w - 0.4, 2.65, 0.12], [x, 1.33, faceZ], blueEdge);
    box("wing-end-lintel", [w + 0.4, 0.12, 0.8], [x, 2.9, faceZ - 0.2], trim, true);
  }

  // Larger factory volumes outside the playable boundary establish a grounded skyline.
  for (const side of [-1, 1]) {
    for (const [i, z] of [-halfDepth + 22, 4, halfDepth - 23].entries()) {
      const height = i === 1 ? 13 : i === 0 ? 9 : 10.5;
      const x = side * (halfWidth + 8);
      const facade = side * (halfWidth - 0.05);
      box("perimeter-factory", [16, height, 29], [x, height / 2, z], side < 0 ? ivory : blue, true);
      box("perimeter-base", [16.06, 2.8, 29.06], [x, 1.4, z], concrete);
      box("factory-roof", [16.7, 0.22, 29.7], [x, height + 0.11, z], steel, true);
      for (let dz = -13.5; dz <= 13.5; dz += 1.4) box("factory-seam", [0.04, height - 3, 0.05], [facade, (height + 3) / 2, z + dz], side < 0 ? trim : blueEdge);
      for (const dz of [-9, -3, 3, 9]) {
        box("factory-window-frame", [0.15, 1.6, 4.7], [facade, 6, z + dz], steel);
        box("factory-window", [0.08, 1.39, 4.5], [facade - side * 0.1, 6, z + dz], glass);
        for (const bar of [-1.5, 0, 1.5]) box("factory-window-mullion", [0.1, 1.4, 0.07], [facade - side * 0.16, 6, z + dz + bar], trim);
      }
      cylinder("factory-downpipe", 0.1, height, [facade - side * 0.22, height / 2, z + 13], trim);
      box("factory-rooftop-hvac", [4, 2, 3], [x, height + 1, z + 6], trim, true);
      for (const offset of [-4, 4]) cylinder("factory-roof-exhaust", 0.45, 2.3, [x + side * offset, height + 1.15, z - 7], steel);
    }
    box("factory-loading-canopy", [6, 0.22, 26], [side * (halfWidth - 2.7), 5.05, 16], trim, true);
    for (const z of [0, 12, 24]) box("canopy-tie", [5.4, 0.16, 0.16], [side * (halfWidth - 2.7), 4.86, z], steel);
  }

  for (const item of ARENA_BOXES.filter((b) => b.name.endsWith("-wall"))) {
    const mesh = scene.getMeshByName(item.name);
    if (mesh) mesh.material = concrete;
  }
  for (const z of [-halfDepth + 0.15, halfDepth - 0.15]) {
    box("end-wall-cap", [ARENA_BOUNDS.groundWidth - 0.5, 0.18, 0.25], [0, 5.1, z], trim);
    for (let x = -halfWidth + 4; x <= halfWidth - 4; x += 6) box("end-wall-pier", [0.32, 5, 0.2], [x, 2.5, z], concrete);
  }
  for (const side of [-1, 1]) {
    box("rear-warehouse", [ARENA_BOUNDS.groundWidth - 4, 10, 16], [0, 5, side * (halfDepth + 9)], ivory, true);
    box("rear-warehouse-roof", [ARENA_BOUNDS.groundWidth - 3, 0.25, 17], [0, 10.12, side * (halfDepth + 9)], steel, true);
    for (let x = -halfWidth + 6; x <= halfWidth - 6; x += 4) {
      box("rear-warehouse-frame", [3.45, 1.5, 0.16], [x, 6.6, side * (halfDepth + 0.9)], steel);
      box("rear-warehouse-window", [3.28, 1.33, 0.07], [x, 6.6, side * (halfDepth + 0.8)], glass);
      box("rear-warehouse-rib", [0.08, 4.8, 0.12], [x + 1.9, 7.5, side * (halfDepth + 0.88)], trim);
    }
    cylinder("rear-exhaust", 0.4, 4, [-22, 11, side * (halfDepth + 5)], steel);
  }

  // Process equipment: cylinders, rim welds, ladder rails and overhead utility trusses.
  for (const z of [4, 19]) {
    cylinder("silo", 3.4, 17, [-halfWidth - 14, 8.5, z], ivory);
    cylinder("silo-band", 3.44, 0.55, [-halfWidth - 14, 12.2, z], ochre);
    cylinder("silo-cap", 3.58, 0.22, [-halfWidth - 14, 17.05, z], trim);
    for (const height of [2.5, 7, 12, 16.5]) {
      const rim = MeshBuilder.CreateTorus(`district-silo-weld-${serial++}`, { diameter: 6.83, thickness: 0.065, tessellation: 32 }, scene);
      rim.position.set(-halfWidth - 14, height, z);
      rim.material = trim;
      rim.isPickable = false;
    }
    for (const dz of [-0.35, 0.35]) cylinder("silo-ladder-rail", 0.035, 16, [-halfWidth - 10.5, 8, z + dz], steel);
    for (let y = 0.6; y < 16; y += 0.45) cylinder("silo-ladder-rung", 0.023, 0.7, [-halfWidth - 10.5, y, z], steel, "z");
  }
  for (const z of [-16, 26]) {
    box("utility-bridge-beam", [44, 0.24, 0.7], [0, 7.2, z], steel, true);
    box("utility-bridge-top", [44, 0.14, 0.7], [0, 8.2, z], trim);
    for (let x = -21; x <= 21; x += 2) {
      const brace = box("utility-bridge-brace", [0.08, 1.8, 0.08], [x, 7.7, z - 0.3], trim);
      brace.rotation.z = Math.PI / 3;
    }
    for (const dz of [-0.3, 0.3]) cylinder("utility-pipe", 0.13, 48, [0, 8.5, z + dz], blueEdge, "x");
  }

  // Existing tactical cover becomes believable freight and switchgear.
  for (const item of ARENA_BOXES.filter((b) => b.name.startsWith("cover-"))) {
    const [w, h, d] = item.dimensions;
    const [x, y, z] = item.position;
    const surface = item.name.includes("mid") ? ivory : x > 0 ? blue : red;
    const collision = scene.getMeshByName(item.name);
    if (collision) collision.material = surface;
    for (const side of [-1, 1]) {
      for (let dz = -d / 2 + 0.18; dz < d / 2; dz += 0.35) box("freight-side-rib", [0.07, h - 0.24, 0.055], [x + side * (w / 2 + 0.025), y, z + dz], surface);
      box("freight-side-top", [0.11, 0.13, d], [x + side * w / 2, h - 0.08, z], steel);
      box("freight-side-bottom", [0.11, 0.13, d], [x + side * w / 2, 0.1, z], steel);
    }
    for (const face of [-1, 1]) {
      const front = z + face * (d / 2 + 0.035);
      for (let dx = -w / 2 + 0.15; dx < w / 2; dx += 0.35) box("freight-rib", [0.045, h - 0.25, 0.07], [x + dx, y, front], surface);
      box("freight-base-rail", [w + 0.08, 0.13, 0.09], [x, 0.13, front], steel);
      box("freight-top-rail", [w + 0.08, 0.13, 0.09], [x, h - 0.07, front], trim);
      for (const dx of [-w / 2 + 0.06, w / 2 - 0.06]) box("freight-corner", [0.14, h, 0.16], [x + dx, y, front], steel);
    }
    if (item.name.includes("mid")) {
      for (let y = 0.6; y < 2.3; y += 0.2) box("switchgear-vent", [2.6, 0.06, 0.08], [x, y, z - d / 2 - 0.08], steel);
      sign("high-voltage", "07", "HIGH VOLTAGE", [1.1, 0.37], [x, 2.65, z - d / 2 - 0.1], 0, "#8c6b27");
    } else {
      sign(item.name, x < 0 ? "K7  204" : "K7  608", "FREIGHT / MAX GROSS 30,480 KG", [1.8, 0.6], [x, h - 0.7, z - d / 2 - 0.13], 0, x < 0 ? "#774739" : "#345562");
    }
  }

  // Street-level material boundaries and restrained markings replace the giant black floor grid.
  for (const x of [-45, 46]) {
    for (const z of [-58, -50, -42, -28, -20, 42, 50, 58]) box("road-dash", [0.12, 0.006, 2.2], [x, 0.017, z], white);
  }
  for (const item of ARENA_BOXES.filter((b) => b.name.includes("divider"))) {
    for (const side of [-1, 1]) box("building-drain", [0.19, 0.012, item.dimensions[2]], [item.position[0] + side * (item.dimensions[0] / 2 + 0.15), 0.015, item.position[2]], steel);
  }
  for (const id of ["A", "B"] as const) {
    const site = BOMB_SITES[id];
    box("site-apron", [14, 0.015, 15], [site.x, 0.017, site.z], concrete);
    const siteBoundary = MeshBuilder.CreateTorus(`district-site-${id}-boundary`, { diameter: site.radius * 2, thickness: 0.09, tessellation: 72 }, scene);
    siteBoundary.position.set(site.x, 0.034, site.z);
    siteBoundary.scaling.y = 0.05;
    siteBoundary.material = ochre;
    siteBoundary.isPickable = false;
    siteBoundary.checkCollisions = false;
    details.push(siteBoundary);
    sign(`route-${id}`, id === "A" ? "← A" : "B →", id === "A" ? "REACTOR / COOLING" : "WAREHOUSE / LOADING", [2.2, 0.73], [id === "A" ? -24 : 22, 3.45, id === "A" ? -50.15 : -53.15], 0, id === "A" ? "#9c6438" : "#365f76");
    const paint = new DynamicTexture(`district-site-${id}`, { width: 256, height: 256 }, scene, false);
    const ctx = paint.getContext();
    ctx.clearRect(0, 0, 256, 256);
    ctx.fillStyle = "rgba(205,158,68,.85)";
    ctx.font = "bold 220px Arial";
    ctx.fillText(id, 48, 209);
    paint.hasAlpha = true;
    paint.update();
    const paintMaterial = new StandardMaterial(`district-site-${id}-paint`, scene);
    paintMaterial.diffuseTexture = paint;
    paintMaterial.useAlphaFromDiffuseTexture = true;
    paintMaterial.specularColor = Color3.Black();
    const marker = MeshBuilder.CreateGround(`district-site-${id}-marker`, { width: 4, height: 4 }, scene);
    marker.position.set(site.x, 0.041, site.z);
    marker.material = paintMaterial;
    marker.isPickable = false;
  }
  for (const [x, z] of [[-34, -36], [33, -29], [-33, 31], [24, 36]]) {
    box("road-repair", [2.5, 0.006, 5], [x, 0.01, z], rubber).visibility = 0.14;
  }
  cylinder("inspection-cover", 0.62, 0.018, [-2, 0.022, -36], steel);
  for (let i = -4; i <= 4; i++) box("inspection-grate", [0.045, 0.012, 0.8], [-2 + i * 0.11, 0.035, -36], rubber);
  for (const x of [-5, 5]) box("yard-stop-line", [3.2, 0.009, 0.1], [x, 0.023, -35], white);
  const hall = ARENA_BOXES.filter((item) => item.name.startsWith("warehouse-"));
  if (hall.length) {
    const minX = Math.min(...hall.map((b) => b.position[0] - b.dimensions[0] / 2));
    const maxX = Math.max(...hall.map((b) => b.position[0] + b.dimensions[0] / 2));
    const minZ = Math.min(...hall.map((b) => b.position[2] - b.dimensions[2] / 2));
    const maxZ = Math.max(...hall.map((b) => b.position[2] + b.dimensions[2] / 2));
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const width = maxX - minX, depth = maxZ - minZ;
    box("warehouse-floor", [width, 0.018, depth], [cx, 0.015, cz], concrete);
    for (const side of [-1, 1]) {
      box("warehouse-roof-wing", [width * 0.27, 0.2, depth + 0.6], [cx + side * width * 0.37, 6.4, cz], blue, true);
      box("warehouse-roof-end", [width * 0.5, 0.2, 4.5], [cx, 6.4, cz + side * (depth / 2 - 2)], blue, true);
    }
    for (let z = minZ + 1; z <= maxZ; z += 6) {
      box("warehouse-roof-truss", [width, 0.26, 0.16], [cx, 6.15, z], trim, true);
      box("warehouse-roof-tie", [width, 0.09, 0.1], [cx, 5.55, z], steel);
      for (let x = minX + 1; x < maxX; x += 2.5) {
        const brace = box("warehouse-truss-diagonal", [0.07, 1.1, 0.07], [x, 5.85, z], steel);
        brace.rotation.z = 0.95;
      }
    }
    for (const wall of hall) {
      const [w, h, d] = wall.dimensions, [x, y, z] = wall.position;
      const collider = scene.getMeshByName(wall.name);
      if (collider) collider.material = ivory;
      box("warehouse-wall-cap", [w + 0.1, 0.18, d + 0.1], [x, h + 0.1, z], blueEdge);
      box("warehouse-kickplate", [w + 0.04, 0.6, d + 0.04], [x, 0.3, z], blue);
      if (w > d) {
        for (let dx = -w / 2 + 0.4; dx < w / 2; dx += 1.2) box("warehouse-wall-rib", [0.07, h - 0.7, d + 0.1], [x + dx, y + 0.25, z], trim);
      } else {
        for (let dz = -d / 2 + 0.4; dz < d / 2; dz += 1.2) box("warehouse-wall-rib", [w + 0.1, h - 0.7, 0.07], [x, y + 0.25, z + dz], trim);
      }
    }
    sign("warehouse-entry", "B / 02", "FREIGHT HALL · KEEP CLEAR", [3.5, 1.1], [cx, 5.2, minZ - 0.2], 0, "#345b6a");
    for (const z of [minZ + 3, maxZ - 3]) for (let x = minX + 2; x < maxX - 1; x += 1) {
      const stripe = box("warehouse-threshold-stripe", [0.35, 0.008, 1.2], [x, 0.04, z], ochre);
      stripe.rotation.y = -0.45;
    }
  }

  // Distinct reactor-yard landmarks stay outside the walkable surface.
  const a = BOMB_SITES.A;
  const reactorX = -halfWidth - 5;
  for (const dz of [-6, 7]) {
    cylinder("reactor-column", 2.8, 14, [reactorX, 7, a.z + dz], ivory);
    cylinder("reactor-band", 2.86, 0.6, [reactorX, 10.8, a.z + dz], ochre);
    cylinder("reactor-exhaust", 0.6, 3, [reactorX, 15.5, a.z + dz], steel);
    cylinder("reactor-feed", 0.24, 9, [reactorX + 4, 8.2, a.z + dz], trim, "x");
  }
  sign("a-yard-identification", "A / 01", "COOLING & POWER", [4.2, 1.4], [-halfWidth + 0.7, 3.8, a.z], Math.PI / 2, "#99613b");
  // Batch opaque detail by material/caster role; collision volumes remain independent.
  const batches = new Map<string, Mesh[]>();
  for (const mesh of details) {
    const key = `${mesh.material?.uniqueId}:${shadowDetails.has(mesh)}`;
    const batch = batches.get(key) ?? [];
    batch.push(mesh);
    batches.set(key, batch);
  }
  for (const meshes of batches.values()) {
    if (meshes.length < 2) continue;
    const casts = shadowDetails.has(meshes[0]);
    if (casts) for (const mesh of meshes) shadow.removeShadowCaster(mesh);
    const merged = Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
    if (!merged) continue;
    merged.name = `district-batch-${merged.material?.name}-${casts ? "caster" : "detail"}`;
    merged.isPickable = false;
    merged.checkCollisions = false;
    merged.receiveShadows = true;
    merged.freezeWorldMatrix();
    if (casts) shadow.addShadowCaster(merged);
  }

}
