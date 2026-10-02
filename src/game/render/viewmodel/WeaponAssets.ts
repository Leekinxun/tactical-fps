import { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { markViewMesh, pbr } from "./primitives";

interface AssetPart {
  name: string;
  role: string;
  material?: string;
  animationParent?: string;
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

export interface WeaponAsset {
  parts: AssetPart[];
  textures: { albedo?: string; normal?: string; orm?: string };
  materials?: Record<string, { color: string; metallic: number; roughness: number }>;
  bounds: { min: number[]; max: number[] };
  muzzle?: [number, number, number];
  gripRight?: [number, number, number];
  gripLeft?: [number, number, number];
}

const assetPaths = {
  pistol: "/models/service-pistol/service-pistol.json",
  rifle: "/models/m4a1/m4a1.json",
  modernPistol: "/models/tactical-weapons/px9.json",
  smg: "/models/tactical-weapons/vx7.json",
  shotgun: "/models/tactical-weapons/rift6.json",
  sniper: "/models/tactical-weapons/needle50.json",
};
export type WeaponAssetId = keyof typeof assetPaths;
const assets = new Map<WeaponAssetId, WeaponAsset>();
let loading: Promise<void> | undefined;

/** Load authored geometry before a match starts, so switching is synchronous. */
export function preloadWeaponAssets(): Promise<void> {
  return loading ??= Promise.all(Object.entries(assetPaths).map(async ([id, url]) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`武器模型加载失败: ${url} (${response.status})`);
    assets.set(id as WeaponAssetId, await response.json() as WeaponAsset);
  })).then(() => undefined).catch((error) => {
    loading = undefined;
    throw error;
  });
}

export function getWeaponAsset(id: WeaponAssetId): WeaponAsset | undefined {
  return assets.get(id);
}

export function buildAuthoredWeapon(scene: Scene, parent: TransformNode, id: WeaponAssetId, name: string): Map<string, Mesh> | null {
  const asset = assets.get(id);
  if (!asset) return null;
  const directory = assetPaths[id].slice(0, assetPaths[id].lastIndexOf("/") + 1);
  const materials = new Map<string, PBRMaterial>();
  const getMaterial = (key = "source") => {
    const existing = materials.get(key);
    if (existing) return existing;
    const spec = asset.materials?.[key];
    const material = spec
      ? pbr(scene, `${name}-authored-${key}-material`, spec.color, spec.roughness, spec.metallic)
      : new PBRMaterial(`${name}-authored-material`, scene);
    if (!spec) {
      material.albedoColor = Color3.White();
      if (asset.textures.albedo) material.albedoTexture = new Texture(directory + asset.textures.albedo, scene, false, false);
      material.metallic = asset.textures.orm ? 1 : 0.65;
      material.roughness = asset.textures.orm ? 1 : 0.56;
      if (asset.textures.normal) {
        material.bumpTexture = new Texture(directory + asset.textures.normal, scene, false, false);
        material.invertNormalMapX = true;
        material.invertNormalMapY = true;
      }
      if (asset.textures.orm) {
        const orm = new Texture(directory + asset.textures.orm, scene, false, false);
        orm.gammaSpace = false;
        material.metallicTexture = orm;
        material.useRoughnessFromMetallicTextureAlpha = false;
        material.useRoughnessFromMetallicTextureGreen = true;
        material.useMetallnessFromMetallicTextureBlue = true;
        material.useAmbientOcclusionFromMetallicTextureRed = true;
      }
    }
    material.maxSimultaneousLights = 6;
    material.environmentIntensity = 0.9;
    // Offline converters preserve source outward normals and CCW triangles.
    material.sideOrientation = Material.ClockWiseSideOrientation;
    materials.set(key, material);
    return material;
  };
  const meshes = new Map<string, Mesh>();
  for (const part of asset.parts) {
    const mesh = new Mesh(`${name}-${part.role}-${part.name}`, scene);
    const data = new VertexData();
    const moving = ["slide", "magazine", "bolt", "pump", "cartridge"].includes(part.role);
    const pivot = Vector3.Zero();
    if (moving) {
      const min = new Vector3(Infinity, Infinity, Infinity);
      const max = new Vector3(-Infinity, -Infinity, -Infinity);
      for (let i = 0; i < part.positions.length; i += 3) {
        const point = Vector3.FromArray(part.positions, i);
        min.minimizeInPlace(point);
        max.maximizeInPlace(point);
      }
      pivot.copyFrom(Vector3.Center(min, max));
    }
    const offset = pivot.asArray();
    data.positions = moving ? part.positions.map((value, index) => value - offset[index % 3]) : part.positions;
    data.normals = part.normals;
    data.uvs = part.uvs;
    data.indices = part.indices;
    data.applyToMesh(mesh);
    mesh.material = getMaterial(part.material);
    mesh.parent = parent;
    mesh.position.copyFrom(pivot);
    mesh.metadata = { weaponPart: part.role, authoredAsset: id };
    markViewMesh(mesh);
    meshes.set(part.role, mesh);
  }
  for (const part of asset.parts) {
    const child = meshes.get(part.role);
    const movingParent = part.animationParent ? meshes.get(part.animationParent) : undefined;
    if (child && movingParent) child.setParent(movingParent);
  }
  return meshes;
}
