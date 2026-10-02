import { Bone } from "@babylonjs/core/Bones/bone";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { BoundingInfo } from "@babylonjs/core/Culling/boundingInfo";
import { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { OperatorRig, OperatorTeamColors } from "./OperatorRig";
import type { WeaponId } from "../combat/WeaponCatalog";
import { buildAuthoredWeapon, getWeaponAsset, type WeaponAssetId } from "../render/viewmodel/WeaponAssets";

export interface SkinBone {
  name: string;
  parent: number;
  head: number[];
  tail: number[];
}
export interface SkinPart {
  name: string;
  material: string;
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  boneIndices: number[];
  boneWeights: number[];
}
export interface SkinnedOperatorAsset {
  schema: "breachline.skinned-operator.v1";
  bones: SkinBone[];
  parts: SkinPart[];
  materials: Record<string, { albedo: string; roughness: number; metallic: number; texture?: string; normal?: string }>;
}
const BASE = "/models/skinned-operator/";
let asset: SkinnedOperatorAsset | undefined;
let loading: Promise<void> | undefined;
export function preloadSkinnedOperator(): Promise<void> {
  return loading ??= fetch(`${BASE}operator.json`).then(async (response) => {
    if (!response.ok) throw new Error(`操作员蒙皮模型加载失败 (${response.status})`);
    asset = await response.json() as SkinnedOperatorAsset;
  }).catch((error) => { loading = undefined; throw error; });
}

const weaponAssets: Record<WeaponId, WeaponAssetId> = {
  px9: "modernPistol", arc12: "pistol", br4: "rifle", vx7: "smg", rift6: "shotgun", needle50: "sniper",
};
interface FootState {
  anchor: Vector3;
  origin: Vector3;
  landing: Vector3;
  local: Vector3;
  swinging: boolean;
  orientation: Quaternion;
}
interface BonePose { position: Vector3; rotation: Quaternion }

/** Native GPU skinning with world-space stance anchors and two-bone limb targets. */
export function createSkinnedOperator(scene: Scene, parent: TransformNode, name: string): OperatorRig | null {
  if (!asset) return null;
  const data = asset;
  const root = new TransformNode(`${name}-operator-rig`, scene);
  root.parent = parent;
  const skeleton = new Skeleton(`${name}-skeleton`, `${name}-skeleton`, scene);
  skeleton.useTextureToStoreBoneMatrices = false;
  const bones: Bone[] = [];
  const rest = new Map(data.bones.map((bone) => [bone.name, bone]));
  for (const [index, source] of data.bones.entries()) {
    const parentHead = source.parent >= 0 ? Vector3.FromArray(data.bones[source.parent].head) : Vector3.Zero();
    const local = Vector3.FromArray(source.head).subtract(parentHead);
    const matrix = Matrix.Translation(local.x, local.y, local.z);
    bones.push(new Bone(`${name}:${source.name}`, skeleton, source.parent >= 0 ? bones[source.parent] : null, matrix, matrix.clone(), matrix.clone(), index));
  }
  const materials = new Map<string, PBRMaterial>();
  for (const [id, source] of Object.entries(data.materials)) {
    const material = new PBRMaterial(`${name}-skin-${id}`, scene);
    material.albedoColor = Color3.FromHexString(source.albedo).toLinearSpace();
    material.metallic = source.metallic;
    material.roughness = source.roughness;
    material.sideOrientation = Material.ClockWiseSideOrientation;
    material.maxSimultaneousLights = 6;
    material.environmentIntensity = 0.7;
    if (source.texture) material.albedoTexture = new Texture(BASE + source.texture, scene, false, false);
    if (source.normal) {
      material.bumpTexture = new Texture(BASE + source.normal, scene, false, false);
      material.invertNormalMapX = true;
      material.invertNormalMapY = true;
    }
    materials.set(id, material);
  }
  const meshes: Mesh[] = [];
  for (const part of data.parts) {
    const mesh = new Mesh(`${name}-skin-${part.name}`, scene);
    const vertices = new VertexData();
    vertices.positions = part.positions;
    vertices.normals = part.normals;
    vertices.uvs = part.uvs;
    vertices.indices = part.indices;
    vertices.matricesIndices = part.boneIndices;
    vertices.matricesWeights = part.boneWeights;
    vertices.applyToMesh(mesh);
    mesh.parent = root;
    mesh.material = materials.get(part.material) ?? null;
    mesh.skeleton = skeleton;
    mesh.numBoneInfluencers = 4;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.receiveShadows = true;
    mesh.metadata = null;
    mesh.setBoundingInfo(new BoundingInfo(new Vector3(-1.2, -1.15, -1.2), new Vector3(1.2, 1.5, 1.5)));
    meshes.push(mesh);
  }

  const weaponRoot = new TransformNode(`${name}-weapon-root`, scene);
  weaponRoot.parent = root;
  const muzzle = new TransformNode(`${name}-muzzle-anchor`, scene);
  muzzle.parent = weaponRoot;
  const leftGrip = new TransformNode(`${name}-left-weapon-grip`, scene);
  leftGrip.parent = weaponRoot;
  const rightGrip = new TransformNode(`${name}-right-weapon-grip`, scene);
  rightGrip.parent = weaponRoot;
  const weapons = new Map<WeaponId, TransformNode>();
  for (const id of Object.keys(weaponAssets) as WeaponId[]) {
    const group = new TransformNode(`${name}-authored-${id}-root`, scene);
    group.parent = weaponRoot;
    const built = buildAuthoredWeapon(scene, group, weaponAssets[id], `${name}-authored-${id}`);
    if (!built) { group.dispose(); continue; }
    for (const mesh of built.values()) {
      mesh.renderingGroupId = 0;
      mesh.alwaysSelectAsActiveMesh = false;
      mesh.receiveShadows = true;
      mesh.metadata = null;
      meshes.push(mesh);
    }
    group.setEnabled(false);
    weapons.set(id, group);
  }

  let currentWeapon: WeaponId = "px9";
  let elapsed = 0, phase = 0, weight = 0, recoil = 0, crouch = 0, disposed = false;
  let finishingStep = false;
  root.computeWorldMatrix(true);
  const previousPosition = root.getAbsolutePosition().clone();
  const previousForward = root.getDirection(Vector3.Forward());
  const previousScale = new Vector3();
  root.getWorldMatrix().decompose(previousScale);
  const feet: FootState[] = ([-1, 1] as const).map((side) => {
    const foot = rest.get(`foot.${side < 0 ? "L" : "R"}`)!;
    // Anatomical source uses L=positive X; runtime stance uses matching sides below.
    const local = new Vector3(side * 0.17, foot.head[1], 0.01);
    const anchor = Vector3.TransformCoordinates(local, root.getWorldMatrix());
    const orientation = Quaternion.Identity();
    root.getWorldMatrix().decompose(undefined, orientation);
    return { anchor, origin: anchor.clone(), landing: anchor.clone(), local, swinging: false, orientation };
  });
  const pose = new Map<string, BonePose>();
  const restHead = (key: string) => Vector3.FromArray(rest.get(key)!.head);
  const worldFeet = new Map<string, TransformNode>();
  for (const side of ["L", "R"]) {
    const debug = new TransformNode(`${name}-foot-contact-${side}`, scene);
    debug.parent = root;
    worldFeet.set(side, debug);
  }

  function setBone(key: string, position: Vector3, rotation = Quaternion.Identity()) {
    pose.set(key, { position, rotation });
  }
  function orient(key: string, from: Vector3, to: Vector3) {
    const source = rest.get(key)!;
    const direction = Vector3.FromArray(source.tail).subtract(Vector3.FromArray(source.head)).normalize();
    const rotation = Quaternion.Identity();
    Quaternion.FromUnitVectorsToRef(direction, to.subtract(from).normalize(), rotation);
    setBone(key, from, rotation);
  }
  function updateFoot(index: number, distance: number, velocity: Vector3, dt: number, teleport: boolean): Vector3 {
    const foot = feet[index];
    const side = index === 0 ? -1 : 1;
    const matrix = root.getWorldMatrix();
    const inverse = Matrix.Invert(matrix);
    const fraction = ((phase / (Math.PI * 2) + index * 0.5) % 1 + 1) % 1;
    const swing = fraction >= 0.62 && (weight > 0.08 || finishingStep);
    if (teleport) {
      foot.anchor.copyFrom(Vector3.TransformCoordinates(foot.local, matrix));
      foot.swinging = false;
      matrix.decompose(undefined, foot.orientation);
    }
    const localAnchor = Vector3.TransformCoordinates(foot.anchor, inverse);
    if (!swing && !foot.swinging && (Math.abs(localAnchor.z) > 0.58 || Math.abs(localAnchor.x - side * 0.17) > 0.42)) {
      foot.anchor.copyFrom(Vector3.TransformCoordinates(foot.local, matrix));
      matrix.decompose(undefined, foot.orientation);
    }
    if (swing && !foot.swinging) {
      foot.origin.copyFrom(foot.anchor);
      const scale = root.getWorldMatrix().getRow(0)!.toVector3().length();
      const prediction = velocity.scale(Math.min(0.12, 0.32 * scale / Math.max(1, velocity.length())));
      foot.landing.copyFrom(Vector3.TransformCoordinates(foot.local, matrix).add(prediction));
    }
    if (swing) {
      const t = Math.min(1, (fraction - 0.62) / 0.38);
      const blend = t * t * (3 - 2 * t);
      Vector3.LerpToRef(foot.origin, foot.landing, blend, foot.anchor);
      const local = Vector3.TransformCoordinates(foot.anchor, inverse);
      local.y += Math.sin(Math.PI * t) * 0.13 * Math.max(finishingStep ? 0.35 : 0, weight);
      const facing = Quaternion.Identity();
      matrix.decompose(undefined, facing);
      Quaternion.SlerpToRef(foot.orientation, facing, Math.min(1, t * 0.35 + dt * 10), foot.orientation);
      foot.swinging = true;
      return local;
    }
    if (foot.swinging) foot.anchor.copyFrom(foot.landing);
    foot.swinging = false;
    // At rest, settle the last lifted foot gently rather than oscillating the stance.
    if (distance < 0.0001 && weight < 0.03 && dt > 0) {
      const stance = Vector3.TransformCoordinates(foot.local, matrix);
      foot.anchor.y += (stance.y - foot.anchor.y) * (1 - Math.exp(-dt * 12));
    }
    return Vector3.TransformCoordinates(foot.anchor, inverse);
  }

  const rig: OperatorRig = {
    root, meshes, muzzle, muzzleAttachment: muzzle, muzzleLocalPosition: new Vector3(),
    get weaponId() { return currentWeapon; },
    setWeapon(id) {
      currentWeapon = id;
      for (const [key, model] of weapons) model.setEnabled(key === id);
      const source = getWeaponAsset(weaponAssets[id]);
      const pistol = id === "px9" || id === "arc12";
      const gun = weapons.get(id);
      if (gun && source) {
        gun.scaling.setAll(pistol ? 0.64 : 0.85);
        const scale = gun.scaling.x;
        const grip = Vector3.FromArray(source.gripRight ?? (pistol ? [0.035, -0.10, -0.02] : [0.035, -0.06, -0.045]));
        const anchor = new Vector3(0.13, pistol ? 0.63 : 0.58, pistol ? 0.40 : id === "needle50" ? 0.16 : 0.21);
        gun.position.copyFrom(anchor.subtract(grip.scale(scale)));
        rightGrip.position.copyFrom(anchor);
        const support = source.gripLeft ?? (pistol ? [-0.028, -0.10, 0.018] : [-0.025, 0.02, 0.29]);
        leftGrip.position.copyFrom(gun.position.add(Vector3.FromArray(support).scale(scale)));
        muzzle.position.copyFrom(gun.position.add(Vector3.FromArray(source.muzzle ?? [0, 0.07, source.bounds.max[2]]).scale(scale)));
        rig.muzzleLocalPosition.copyFrom(muzzle.position);
      }
      rig.update(0, weight, 0, false);
    },
    setTeam(team) {
      const colors: OperatorTeamColors = typeof team === "boolean"
        ? { cloth: team ? "#7a8983" : "#968777", vest: team ? "#47564d" : "#665e4b", marker: team ? "#7db5ab" : "#c78e68" }
        : team;
      for (const [id, material] of materials) {
        const target = id.toLowerCase();
        const tint = target.includes("marker") || target.includes("patch") ? colors.marker
          : target.includes("cloth") || target.includes("fabric") || target.includes("uniform") || target.includes("pants") || target.includes("trouser") ? colors.cloth
            : target.includes("vest") || target.includes("carrier") || target.includes("pouch") ? colors.vest : undefined;
        if (tint) material.albedoColor = typeof tint === "string" ? Color3.FromHexString(tint).toLinearSpace() : tint.clone();
      }
    },
    update(deltaSeconds, movingSpeed, aimPitch = 0, shooting = false, crouching = false) {
      if (disposed) return;
      const dt = Math.max(0, Math.min(deltaSeconds, 0.1));
      root.computeWorldMatrix(true);
      const current = root.getAbsolutePosition().clone();
      const delta = current.subtract(previousPosition);
      const planar = Math.hypot(delta.x, delta.z);
      const scale = new Vector3();
      root.getWorldMatrix().decompose(scale);
      const teleport = planar > 2 || Vector3.DistanceSquared(scale, previousScale) > 1e-6;
      const distance = teleport || dt === 0 ? 0 : planar;
      const forward = root.getDirection(Vector3.Forward()).normalize();
      const turning = Math.abs(Math.atan2(Vector3.Cross(previousForward, forward).y, Vector3.Dot(previousForward, forward)));
      const actualSpeed = dt > 0 ? distance / dt : 0;
      const targetWeight = Math.min(1, Math.max(actualSpeed / 3.2, movingSpeed, dt > 0 ? turning / dt * 0.18 : 0));
      weight += (targetWeight - weight) * (1 - Math.exp(-dt * 10));
      // Finish a lifted foot when stopping; otherwise cadence follows real displacement.
      const inverse = Matrix.Invert(root.getWorldMatrix());
      finishingStep = actualSpeed < 0.05 && movingSpeed < 0.03 && feet.some((foot) => {
        const local = Vector3.TransformCoordinates(foot.anchor, inverse);
        return foot.swinging || Math.abs(local.z) > 0.32 || Math.abs(local.x - foot.local.x) > 0.3;
      });
      if (dt > 0) phase += finishingStep ? dt * Math.PI * 3.6
        : (distance + (distance < 0.0001 ? turning * 0.65 : 0)) / (0.85 + weight * 0.58) * Math.PI * 2;
      elapsed += dt;
      crouch += ((crouching ? 0.60 : 0) - crouch) * (1 - Math.exp(-dt * 12));
      if (dt > 0 && !teleport && Math.abs(delta.y) > 0.0001) {
        for (const foot of feet) { foot.anchor.y += delta.y; foot.origin.y += delta.y; foot.landing.y += delta.y; }
      }
      if (shooting) recoil = Math.min(1, recoil + 0.72);
      const kick = recoil;
      const breathe = Math.sin(elapsed * 1.8) * 0.002;
      const pitch = Math.max(-0.8, Math.min(0.8, aimPitch)) * 0.8 - kick * 0.055;
      weaponRoot.rotation.set(pitch, 0, 0);
      const pivot = new Vector3(0, 0.62, 0.08);
      const rotatedPivot = Vector3.TransformCoordinates(pivot, Matrix.RotationX(pitch));
      weaponRoot.position.copyFrom(pivot.subtract(rotatedPivot).add(new Vector3(0, breathe - crouch, -crouch * 0.12 - kick * 0.025)));
      weaponRoot.computeWorldMatrix(true);
      const inverseRoot = Matrix.Invert(root.getWorldMatrix());
      const handR = Vector3.TransformCoordinates(rightGrip.getAbsolutePosition(), inverseRoot);
      const handL = Vector3.TransformCoordinates(leftGrip.getAbsolutePosition(), inverseRoot);
      // Transform children after the weapon root was moved for the current pose.
      rightGrip.computeWorldMatrix(true); leftGrip.computeWorldMatrix(true);
      handR.copyFrom(Vector3.TransformCoordinates(rightGrip.getAbsolutePosition(), inverseRoot));
      handL.copyFrom(Vector3.TransformCoordinates(leftGrip.getAbsolutePosition(), inverseRoot));
      pose.clear();
      for (const source of data.bones) setBone(source.name, Vector3.FromArray(source.head));
      const hipOffset = new Vector3(0, -0.075 - 0.075 * weight - crouch - Math.sin(phase * 2) ** 2 * 0.018 * weight, -crouch * 0.12);
      for (const key of ["pelvis", "spine", "chest", "neck", "head"]) {
        const head = restHead(key).add(hipOffset);
        setBone(key, head, Quaternion.RotationYawPitchRoll(0, aimPitch * (key === "head" ? 0.48 : 0.08), 0));
      }
      const velocity = dt > 0 ? delta.scale(1 / dt) : Vector3.Zero();
      // L in the source is +X; pair it with the +X stance foot.
      for (const [side, index] of [["L", 1], ["R", 0]] as const) {
        const hip = restHead(`thigh.${side}`).add(hipOffset);
        const foot = updateFoot(index, distance, velocity, dt, teleport);
        const upperLength = Vector3.Distance(restHead(`thigh.${side}`), restHead(`shin.${side}`));
        const lowerLength = Vector3.Distance(restHead(`shin.${side}`), restHead(`foot.${side}`));
        const knee = solveLimb(hip, foot, upperLength, lowerLength, new Vector3(0, 0, 1));
        orient(`thigh.${side}`, hip, knee);
        orient(`shin.${side}`, knee, foot);
        const footRotation = Quaternion.Identity();
        Matrix.Compose(Vector3.One(), feet[index].orientation, Vector3.Zero()).multiply(inverseRoot).decompose(undefined, footRotation);
        setBone(`foot.${side}`, foot, footRotation);
        worldFeet.get(side)!.position.copyFrom(foot);
      }
      for (const [side, hand] of [["L", handR], ["R", handL]] as const) {
        const shoulder = restHead(`upper_arm.${side}`).add(hipOffset);
        const upperLength = Vector3.Distance(restHead(`upper_arm.${side}`), restHead(`forearm.${side}`));
        const lowerLength = Vector3.Distance(restHead(`forearm.${side}`), restHead(`hand.${side}`));
        const pole = new Vector3(side === "L" ? 0.35 : -0.35, -1, -0.2);
        const elbow = solveLimb(shoulder, hand, upperLength, lowerLength, pole);
        orient(`upper_arm.${side}`, shoulder, elbow);
        orient(`forearm.${side}`, elbow, hand);
        // Keep the palm facing the weapon; wrist roll follows the forearm smoothly.
        setBone(`hand.${side}`, hand, pose.get(`forearm.${side}`)!.rotation.clone());
      }
      const absolute: Matrix[] = [];
      for (const [index, source] of data.bones.entries()) {
        const target = pose.get(source.name)!;
        const world = Matrix.Compose(Vector3.One(), target.rotation, target.position);
        const local = source.parent < 0 ? world : world.multiply(Matrix.Invert(absolute[source.parent]));
        const scale = new Vector3(), rotation = new Quaternion(), position = new Vector3();
        local.decompose(scale, rotation, position);
        bones[index].setPosition(position);
        bones[index].setRotationQuaternion(rotation);
        bones[index].setScale(scale);
        absolute.push(world);
      }
      skeleton.prepare(true);
      if (dt > 0 || teleport) {
        previousPosition.copyFrom(current);
        previousForward.copyFrom(forward);
        previousScale.copyFrom(scale);
      }
      recoil *= Math.exp(-dt * 18);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      skeleton.dispose();
      root.dispose(false, true);
      for (const material of materials.values()) material.dispose(true, true);
    },
  };
  rig.setTeam(false);
  rig.setWeapon("px9");
  return rig;
}

/** Two-bone IK in model space, with a stable pole and a small extension margin. */
export function solveLimb(start: Vector3, end: Vector3, upper: number, lower: number, pole: Vector3): Vector3 {
  const direction = end.subtract(start);
  const distance = Math.max(0.001, Math.min(direction.length(), upper + lower - 0.002));
  direction.normalize();
  let bend = pole.subtract(direction.scale(Vector3.Dot(pole, direction)));
  if (bend.lengthSquared() < 1e-6) bend = Vector3.Cross(direction, Vector3.Right());
  bend.normalize();
  const along = (upper * upper + distance * distance - lower * lower) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upper * upper - along * along));
  return start.add(direction.scale(along)).add(bend.scale(height));
}
