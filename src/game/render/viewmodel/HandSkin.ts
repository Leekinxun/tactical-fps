import { Bone } from "@babylonjs/core/Bones/bone";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Material } from "@babylonjs/core/Materials/material";
import { markViewMesh } from "./primitives";

export interface HandGeometry {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}
export interface WeightedHand extends HandGeometry {
  matricesIndices: number[];
  matricesWeights: number[];
  bones: { name: string; parent: number; bind: number[]; open: number[]; grip: number[] }[];
  wrist: [number, number, number];
  contact: [number, number, number];
  wristDirection: [number, number, number];
  wristAcross: [number, number, number];
  details?: (HandGeometry & { matricesIndices: number[]; matricesWeights: number[] })[];
}

function pose(matrix: number[]) {
  const scale = Vector3.One(), rotation = Quaternion.Identity(), position = Vector3.Zero();
  Matrix.FromArray(matrix).decompose(scale, rotation, position);
  return { scale, rotation, position };
}

/** Preserve source topology and bind matrices; deform the connected glove on the GPU. */
export function buildHandSkin(scene: Scene, parent: TransformNode, name: string, data: WeightedHand, material: Material, detailMaterial: Material) {
  const skeleton = new Skeleton(`${name}-skin`, `${name}-skin`, scene);
  skeleton.useTextureToStoreBoneMatrices = false;
  const bones: Bone[] = [];
  for (let index = 0; index < data.bones.length; index += 1) {
    const spec = data.bones[index];
    const bind = Matrix.FromArray(spec.bind);
    bones.push(new Bone(`${name}-${spec.name}`, skeleton, bones[spec.parent] ?? null, bind, bind, bind, index));
  }
  const mesh = makeMesh(scene, parent, `${name}-glove`, data, material);
  mesh.skeleton = skeleton;
  mesh.metadata = { tacticalHandPart: "glove", materialRole: "glove", weightedSkin: true };
  const meshes = [mesh];
  for (const [index, detail] of (data.details ?? []).entries()) {
    const detailMesh = makeMesh(scene, parent, `${name}-stitched-protection-${index}`, detail, detailMaterial);
    detailMesh.skeleton = skeleton;
    detailMesh.metadata = { tacticalHandPart: "protection", materialRole: "rubber", weightedSkin: true };
    meshes.push(detailMesh);
  }
  const poses = data.bones.map((spec) => ({ open: pose(spec.open), grip: pose(spec.grip) }));
  const scale = Vector3.One(), rotation = Quaternion.Identity(), position = Vector3.Zero();
  let previous = Number.NaN;
  const setGrip = (amount: number) => {
    const value = Math.max(0, Math.min(1, amount));
    if (!Number.isFinite(value) || Math.abs(value - previous) < 0.00001) return;
    previous = value;
    for (let index = 0; index < bones.length; index += 1) {
      const { open, grip } = poses[index];
      Vector3.LerpToRef(open.position, grip.position, value, position);
      Vector3.LerpToRef(open.scale, grip.scale, value, scale);
      Quaternion.SlerpToRef(open.rotation, grip.rotation, value, rotation);
      bones[index].position = position;
      bones[index].rotationQuaternion = rotation;
      bones[index].scaling = scale;
    }
  };
  setGrip(1);
  // Skeleton ownership follows the main glove, independent of shared view materials.
  mesh.onDisposeObservable.addOnce(() => skeleton.dispose());
  return { meshes, setGrip, skeleton };
}

function makeMesh(scene: Scene, parent: TransformNode, name: string, geometry: HandGeometry & { matricesIndices?: number[]; matricesWeights?: number[] }, material: Material) {
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = geometry.positions;
  data.normals = geometry.normals;
  data.uvs = geometry.uvs;
  data.indices = geometry.indices;
  data.matricesIndices = geometry.matricesIndices ?? null;
  data.matricesWeights = geometry.matricesWeights ?? null;
  data.applyToMesh(mesh);
  mesh.parent = parent;
  mesh.material = material;
  mesh.numBoneInfluencers = 4;
  // Skinning can move fingers outside the bind AABB during release.
  mesh.alwaysSelectAsActiveMesh = true;
  return markViewMesh(mesh);
}
