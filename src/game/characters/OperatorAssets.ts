import { preloadSkinnedOperator } from "./SkinnedOperator";
import { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Mesh as BabylonMesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

export type OperatorNodeKey =
  | "root"
  | "pelvis"
  | "chest"
  | "head"
  | "leftUpper"
  | "leftForearm"
  | "leftHand"
  | "rightUpper"
  | "rightForearm"
  | "rightHand"
  | "leftThigh"
  | "leftShin"
  | "rightThigh"
  | "rightShin";

export interface OperatorNodeMap {
  root: TransformNode;
  pelvis: TransformNode;
  chest: TransformNode;
  head: TransformNode;
  leftUpper: TransformNode;
  leftForearm: TransformNode;
  leftHand: TransformNode;
  rightUpper: TransformNode;
  rightForearm: TransformNode;
  rightHand: TransformNode;
  leftThigh: TransformNode;
  leftShin: TransformNode;
  rightThigh: TransformNode;
  rightShin: TransformNode;
}

export interface OperatorTeamPalette {
  cloth?: string | Color3;
  vest?: string | Color3;
  marker?: string | Color3;
}

interface OperatorAssetMaterial {
  albedo: string;
  roughness: number;
  metallic: number;
  alpha?: number;
  emissive?: string;
  texture?: string;
}

interface OperatorAssetPart {
  name: string;
  parent: OperatorNodeKey;
  material: string;
  positions: number[];
  normals: number[];
  uvs?: number[];
  indices: number[];
}

interface OperatorAsset {
  schema: "breachline.operator-mesh.v1";
  materials: Record<string, OperatorAssetMaterial>;
  parts: OperatorAssetPart[];
  bounds: { min: number[]; max: number[] };
}

export interface AuthoredOperatorVisual {
  meshes: readonly Mesh[];
  materials: readonly PBRMaterial[];
  applyTeam(colors: OperatorTeamPalette): void;
  dispose(): void;
}

const OPERATOR_ASSET_PATH = "/models/operator/operator.json";
let operatorAsset: OperatorAsset | null = null;
let loading: Promise<void> | undefined;

export function preloadOperatorAssets(): Promise<void> {
  return Promise.all([preloadSkinnedOperator(), loading ??= fetch(OPERATOR_ASSET_PATH)
    .then(async (response) => {
      if (!response.ok) throw new Error(`操作员模型加载失败: ${response.status}`);
      operatorAsset = await response.json() as OperatorAsset;
    })
    .catch((error) => {
      loading = undefined;
      throw error;
    })]).then(() => undefined);
}

export function buildAuthoredOperator(
  scene: Scene,
  name: string,
  nodes: OperatorNodeMap,
): AuthoredOperatorVisual | null {
  if (!operatorAsset) return null;
  const directory = OPERATOR_ASSET_PATH.slice(0, OPERATOR_ASSET_PATH.lastIndexOf("/") + 1);

  const materialEntries = Object.entries(operatorAsset.materials).map(([id, source]) => {
    const material = new PBRMaterial(`${name}-operator-authored-${id}`, scene);
    material.albedoColor = Color3.FromHexString(source.albedo).toLinearSpace();
    material.roughness = source.roughness;
    material.metallic = source.metallic;
    material.environmentIntensity = 0.62;
    material.specularIntensity = source.metallic > 0 ? 0.55 : 0.24;
    material.maxSimultaneousLights = 6;
    material.sideOrientation = Material.ClockWiseSideOrientation;
    if (source.texture) {
      const texture = new Texture(directory + source.texture, scene, false, false);
      texture.uScale = 1.25;
      texture.vScale = 1.25;
      material.albedoTexture = texture;
      material.albedoTexture.hasAlpha = false;
    }
    if (source.alpha !== undefined) {
      material.alpha = source.alpha;
      material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    }
    if (source.emissive) material.emissiveColor = Color3.FromHexString(source.emissive).toLinearSpace();
    return [id, material] as const;
  });
  const materials = new Map(materialEntries);
  const meshes: Mesh[] = [];

  for (const part of operatorAsset.parts) {
    const mesh = new BabylonMesh(`${name}-authored-operator-${part.name}`, scene);
    const data = new VertexData();
    data.positions = part.positions;
    data.normals = part.normals;
    data.indices = part.indices;
    data.uvs = part.uvs ?? new Array((part.positions.length / 3) * 2).fill(0);
    data.applyToMesh(mesh, true);
    mesh.parent = nodes[part.parent];
    mesh.material = materials.get(part.material) ?? materials.get("cloth") ?? null;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.receiveShadows = true;
    mesh.metadata = null;
    meshes.push(mesh);
  }

  const authoredMaterials = [...materials.values()];
  return {
    meshes,
    materials: authoredMaterials,
    applyTeam(colors) {
      if (colors.cloth) {
        setMaterialColor(materials.get("cloth"), colors.cloth);
        setMaterialColor(materials.get("clothDark"), darken(colors.cloth, 0.7));
      }
      if (colors.vest) {
        setMaterialColor(materials.get("vest"), colors.vest);
        setMaterialColor(materials.get("plate"), mix(colors.vest, "#747b74", 0.3));
      }
      if (colors.marker) {
        setMaterialColor(materials.get("marker"), colors.marker);
        const marker = materials.get("marker");
        if (marker) marker.emissiveColor = toColor(colors.marker).scale(0.045);
      }
    },
    dispose() {
      for (const mesh of meshes) mesh.dispose(false, false);
      for (const material of authoredMaterials) material.dispose(true, true);
    },
  };
}

function setMaterialColor(material: PBRMaterial | undefined, value: string | Color3): void {
  if (!material) return;
  material.albedoColor = toColor(value);
}

function toColor(value: string | Color3): Color3 {
  return typeof value === "string" ? Color3.FromHexString(value).toLinearSpace() : value.clone();
}

function darken(value: string | Color3, amount: number): Color3 {
  return toColor(value).scale(amount);
}

function mix(a: string | Color3, b: string, amount: number): Color3 {
  const left = toColor(a);
  const right = Color3.FromHexString(b).toLinearSpace();
  return left.scale(1 - amount).add(right.scale(amount));
}
