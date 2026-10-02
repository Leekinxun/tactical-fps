import { Constants } from "@babylonjs/core/Engines/constants";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

export const VIEWMODEL_RENDER_GROUP = 2;

export interface ViewMaterials {
  parkerized: PBRMaterial;
  darkMetal: PBRMaterial;
  polymer: PBRMaterial;
  tanPolymer: PBRMaterial;
  rubber: PBRMaterial;
  glove: PBRMaterial;
  sleeve: PBRMaterial;
  glass: PBRMaterial;
  brass: PBRMaterial;
  flash: StandardMaterial;
  smoke: StandardMaterial;
}

export function createViewMaterials(scene: Scene): ViewMaterials {
  const parkerized = pbr(scene, "viewmodel-parkerized-metal", "#555b57", 0.58, 0.34);
  const darkMetal = pbr(scene, "viewmodel-oiled-dark-metal", "#252a28", 0.46, 0.55);
  const polymer = pbr(scene, "viewmodel-black-polymer", "#242926", 0.9, 0.02);
  const tanPolymer = pbr(scene, "viewmodel-field-tan-polymer", "#6f6757", 0.86, 0.04);
  const rubber = pbr(scene, "viewmodel-matte-rubber", "#141716", 0.98, 0);
  const glove = pbr(scene, "viewmodel-armored-glove", "#20251f", 0.96, 0);
  const sleeve = pbr(scene, "viewmodel-combat-sleeve", "#3c433b", 0.93, 0);
  const glass = pbr(scene, "viewmodel-smoked-glass", "#142323", 0.2, 0.08);
  glass.alpha = 0.68;
  const brass = pbr(scene, "viewmodel-cartridge-brass", "#a9803b", 0.42, 0.55);

  const flash = new StandardMaterial("viewmodel-muzzle-flash-material", scene);
  flash.backFaceCulling = false;
  flash.disableLighting = true;
  flash.diffuseColor = Color3.FromHexString("#ffd989");
  flash.emissiveColor = new Color3(1, 1, 1);
  flash.alphaMode = Constants.ALPHA_ADD;
  flash.useAlphaFromDiffuseTexture = true;
  flash.diffuseTexture = createFlameTexture(scene);
  flash.specularColor = Color3.FromHexString("#fff5c6");

  const smoke = new StandardMaterial("viewmodel-muzzle-smoke-material", scene);
  smoke.diffuseColor = Color3.FromHexString("#a5aca6");
  smoke.emissiveColor = Color3.FromHexString("#202322");
  smoke.alpha = 0.5;
  smoke.useAlphaFromDiffuseTexture = true;
  smoke.opacityTexture = createSmokeTexture(scene);

  return { parkerized, darkMetal, polymer, tanPolymer, rubber, glove, sleeve, glass, brass, flash, smoke };
}

export function markViewMesh(mesh: AbstractMesh): AbstractMesh {
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  mesh.renderingGroupId = VIEWMODEL_RENDER_GROUP;
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
}

export function markViewLight(light: PointLight): PointLight {
  light.renderPriority = 20;
  return light;
}

export function pbr(scene: Scene, name: string, hex: string, roughness: number, metallic: number): PBRMaterial {
  const material = new PBRMaterial(name, scene);
  const color = Color3.FromHexString(hex).toLinearSpace();
  material.albedoColor = color;
  material.roughness = roughness;
  material.metallic = metallic;
  material.environmentIntensity = 0.72;
  material.specularIntensity = metallic > 0 ? 0.64 : 0.24;
  material.emissiveColor = color.scale(metallic > 0 ? 0.025 : 0.01);
  material.maxSimultaneousLights = 6;
  const data = new Uint8Array(64 * 64 * 4);
  let seed = 9143;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const weave = name.includes("sleeve") || name.includes("glove") ? ((x + y) % 4 === 0 ? -20 : 0) : 0;
    const tone = 229 + (seed / 0xffffffff - 0.5) * 24 + weave;
    const index = (y * 64 + x) * 4;
    data[index] = data[index + 1] = data[index + 2] = tone;
    data[index + 3] = 255;
  }
  material.albedoTexture = RawTexture.CreateRGBATexture(data, 64, 64, scene, true, false);
  return material;
}

export function block(
  scene: Scene,
  parent: TransformNode,
  name: string,
  dimensions: { width: number; height: number; depth: number },
  material: PBRMaterial | StandardMaterial,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
): AbstractMesh {
  const mesh = MeshBuilder.CreateBox(name, dimensions, scene);
  mesh.parent = parent;
  mesh.material = material;
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  return markViewMesh(mesh);
}

export function roundedBlock(
  scene: Scene,
  parent: TransformNode,
  name: string,
  dimensions: { width: number; height: number; depth: number },
  material: PBRMaterial | StandardMaterial,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
): AbstractMesh[] {
  const mesh = new Mesh(name, scene);
  mesh.parent = parent;
  mesh.material = material;
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  const vertexData = createChamferedBoxVertexData(dimensions);
  vertexData.applyToMesh(mesh, true);
  return [markViewMesh(mesh)];
}

export function cyl(
  scene: Scene,
  parent: TransformNode,
  name: string,
  size: { height: number; diameter: number; tessellation?: number },
  material: PBRMaterial | StandardMaterial,
  position: [number, number, number],
  axis: "x" | "y" | "z" = "z",
  rotation: [number, number, number] = [0, 0, 0],
): AbstractMesh {
  const mesh = MeshBuilder.CreateCylinder(name, { tessellation: size.tessellation ?? 18, ...size }, scene);
  mesh.parent = parent;
  mesh.material = material;
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  if (axis === "z") mesh.rotation.x += Math.PI / 2;
  if (axis === "x") mesh.rotation.z += Math.PI / 2;
  return markViewMesh(mesh);
}

export function capsule(
  scene: Scene,
  parent: TransformNode,
  name: string,
  size: { height: number; radius: number; tessellation?: number },
  material: PBRMaterial | StandardMaterial,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
): AbstractMesh {
  const mesh = MeshBuilder.CreateCapsule(name, { tessellation: size.tessellation ?? 12, ...size }, scene);
  mesh.parent = parent;
  mesh.material = material;
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  return markViewMesh(mesh);
}

export function setEnabled(meshes: readonly AbstractMesh[], enabled: boolean): void {
  for (const mesh of meshes) mesh.setEnabled(enabled);
}

export function copyVector(vector: Vector3): Vector3 {
  return new Vector3(vector.x, vector.y, vector.z);
}

function createChamferedBoxVertexData(dimensions: { width: number; height: number; depth: number }): VertexData {
  const halfX = dimensions.width / 2;
  const halfY = dimensions.height / 2;
  const halfZ = dimensions.depth / 2;
  const radius = Math.min(halfX, halfY, halfZ) * 0.12;
  const innerX = halfX - radius;
  const innerY = halfY - radius;
  const innerZ = halfZ - radius;
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];

  const pushFace = (axis: 0 | 1 | 2, sign: -1 | 1): void => {
    const baseIndex = positions.length / 3;
    const values = (half: number, inner: number) => [-half, -inner, inner, half];
    const horizontal = axis === 0 ? values(halfY, innerY) : values(halfX, innerX);
    const vertical = axis === 2 ? values(halfY, innerY) : values(halfZ, innerZ);
    for (const b of vertical) {
      for (const a of horizontal) {
        const point = axis === 0 ? [sign * halfX, a, b]
          : axis === 1 ? [a, sign * halfY, b] : [a, b, sign * halfZ];
        const inner = [clamp(point[0], -innerX, innerX), clamp(point[1], -innerY, innerY), clamp(point[2], -innerZ, innerZ)];
        const normal = Vector3.FromArray([point[0] - inner[0], point[1] - inner[1], point[2] - inner[2]]).normalize();
        positions.push(inner[0] + normal.x * radius, inner[1] + normal.y * radius, inner[2] + normal.z * radius);
        normals.push(normal.x, normal.y, normal.z);
      }
    }
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 3; x += 1) {
        const a = baseIndex + y * 4 + x;
        const b = a + 1;
        const c = a + 4;
        const d = c + 1;
        // Babylon's left-handed front winding is clockwise when viewed from outside.
        if ((sign > 0) === (axis === 1)) indices.push(a, b, d, a, d, c);
        else indices.push(a, d, b, a, c, d);
      }
    }
  };

  pushFace(0, 1);
  pushFace(0, -1);
  pushFace(1, 1);
  pushFace(1, -1);
  pushFace(2, 1);
  pushFace(2, -1);

  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  return vertexData;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createSmokeTexture(scene: Scene): DynamicTexture {
  const texture = new DynamicTexture("viewmodel-muzzle-smoke-alpha", { width: 128, height: 128 }, scene, false);
  const context = texture.getContext();
  const gradient = context.createRadialGradient(64, 64, 8, 64, 64, 62);
  gradient.addColorStop(0, "rgba(210,218,212,0.48)");
  gradient.addColorStop(0.38, "rgba(166,174,168,0.24)");
  gradient.addColorStop(1, "rgba(166,174,168,0)");
  context.clearRect(0, 0, 128, 128);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  texture.hasAlpha = true;
  texture.update(false);
  return texture;
}

function createFlameTexture(scene: Scene): DynamicTexture {
  const texture = new DynamicTexture("viewmodel-flame-falloff", { width: 256, height: 128 }, scene, false);
  const ctx = texture.getContext();
  ctx.clearRect(0, 0, 256, 128);
  const glow = ctx.createRadialGradient(26, 64, 1, 64, 64, 108);
  glow.addColorStop(0, "rgba(255,255,238,1)");
  glow.addColorStop(0.15, "rgba(255,245,179,.95)");
  glow.addColorStop(0.4, "rgba(255,157,47,.65)");
  glow.addColorStop(0.72, "rgba(225,78,19,.22)");
  glow.addColorStop(1, "rgba(200,49,9,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 256, 128);
  texture.hasAlpha = true;
  texture.update();
  return texture;
}
