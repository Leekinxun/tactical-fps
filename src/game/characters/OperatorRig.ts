import { createSkinnedOperator } from "./SkinnedOperator";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Mesh as BabylonMesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { getWeaponConfig, type WeaponClass, type WeaponId } from "../combat/WeaponCatalog";
import { buildAuthoredWeapon, getWeaponAsset, type WeaponAssetId } from "../render/viewmodel/WeaponAssets";
import { buildAuthoredOperator, type AuthoredOperatorVisual } from "./OperatorAssets";

export interface OperatorTeamColors {
  cloth?: string | Color3;
  vest?: string | Color3;
  marker?: string | Color3;
}

export interface OperatorRig {
  root: TransformNode;
  meshes: readonly Mesh[];
  muzzle: TransformNode;
  muzzleAttachment: TransformNode;
  muzzleLocalPosition: Vector3;
  readonly weaponId: WeaponId;
  setWeapon(weaponId: WeaponId): void;
  setTeam(team: boolean | OperatorTeamColors): void;
  update(deltaSeconds: number, movingSpeed: number, aimPitch?: number, shooting?: boolean, crouching?: boolean): void;
  dispose(): void;
}

interface OperatorMaterials {
  cloth: PBRMaterial;
  clothDark: PBRMaterial;
  vest: PBRMaterial;
  plate: PBRMaterial;
  rubber: PBRMaterial;
  metal: PBRMaterial;
  glass: PBRMaterial;
  marker: PBRMaterial;
}

interface OperatorParts {
  root: TransformNode;
  chest: TransformNode;
  pelvis: TransformNode;
  head: TransformNode;
  weaponRoot: TransformNode;
  muzzle: TransformNode;
  leftArm: ArmRig;
  rightArm: ArmRig;
  leftGrip: TransformNode;
  rightGrip: TransformNode;
  leftThigh: TransformNode;
  leftShin: TransformNode;
  rightThigh: TransformNode;
  rightShin: TransformNode;
  weaponClass: WeaponClass;
  meshes: Mesh[];
  markers: Mesh[];
  pistolMeshes: Mesh[];
  longGunMeshes: Mesh[];
  authoredWeapons: Partial<Record<WeaponId, AuthoredWeaponVisual>>;
  authoredOperator: AuthoredOperatorVisual | null;
  authoredMaterials: PBRMaterial[];
  bodyMeshes: Mesh[];
}

interface AuthoredWeaponVisual {
  root: TransformNode;
  meshes: Mesh[];
  gripRight: Vector3;
  gripLeft: Vector3;
  muzzle: Vector3;
}

interface ArmRig {
  upper: TransformNode;
  forearm: TransformNode;
  hand: TransformNode;
  side: -1 | 1;
}

const ALLY_COLORS: Required<OperatorTeamColors> = {
  cloth: "#4e5b52",
  vest: "#242c29",
  marker: "#4da58f",
};

const ENEMY_COLORS: Required<OperatorTeamColors> = {
  cloth: "#5d554a",
  vest: "#302b25",
  marker: "#b46d4d",
};

const WEAPON_READY_HEIGHT = 0.48;
const AUTHORED_WEAPON_SCALE = 0.85;
const OPERATOR_WEAPON_IDS = ["px9", "arc12", "vx7", "br4", "rift6", "needle50"] as const satisfies readonly WeaponId[];
const OPERATOR_WEAPON_ASSET_IDS: Record<WeaponId, WeaponAssetId> = {
  px9: "modernPistol",
  arc12: "pistol",
  vx7: "smg",
  br4: "rifle",
  rift6: "shotgun",
  needle50: "sniper",
};

const MUZZLE_BY_WEAPON_CLASS = {
  pistol: new Vector3(0, WEAPON_READY_HEIGHT + 0.34, 0.85),
  smg: new Vector3(0, WEAPON_READY_HEIGHT + 0.36, 1.55),
  rifle: new Vector3(0, WEAPON_READY_HEIGHT + 0.36, 1.55),
  shotgun: new Vector3(0, WEAPON_READY_HEIGHT + 0.36, 1.55),
  sniper: new Vector3(0, WEAPON_READY_HEIGHT + 0.36, 1.55),
} as const;
const FALLBACK_PISTOL_RIGHT_GRIP = new Vector3(0.1, WEAPON_READY_HEIGHT + 0.17, 0.32);
const FALLBACK_PISTOL_LEFT_GRIP = new Vector3(-0.1, WEAPON_READY_HEIGHT + 0.29, 0.55);
const FALLBACK_LONG_RIGHT_GRIP = new Vector3(0.14, WEAPON_READY_HEIGHT + 0.22, 0.43);
const FALLBACK_LONG_LEFT_GRIP = new Vector3(-0.16, WEAPON_READY_HEIGHT + 0.31, 0.91);
const UP = new Vector3(0, 1, 0);

export function createOperatorRig(scene: Scene, parent: TransformNode, name: string): OperatorRig {
  const skinned = createSkinnedOperator(scene, parent, name);
  if (skinned) return skinned;
  const root = new TransformNode(`${name}-operator-rig`, scene);
  root.parent = parent;
  root.position.set(0, 0, 0);

  const materials = createMaterials(scene, name);
  const parts = createParts(scene, root, name, materials);
  const state = {
    time: 0,
    walkPhase: 0,
    motion: 0,
    recoil: 0,
    weaponId: "px9" as WeaponId,
    disposed: false,
  };

  const rig: OperatorRig = {
    root,
    meshes: parts.meshes,
    muzzle: parts.muzzle,
    muzzleAttachment: parts.muzzle,
    muzzleLocalPosition: MUZZLE_BY_WEAPON_CLASS.pistol.clone(),
    get weaponId() {
      return state.weaponId;
    },
    setWeapon(weaponId: WeaponId) {
      state.weaponId = weaponId;
      const weaponClass = getWeaponConfig(weaponId).weaponClass;
      parts.weaponClass = weaponClass;
      const usePistol = weaponClass === "pistol";
      const authored = parts.authoredWeapons[weaponId] ?? null;
      for (const visual of Object.values(parts.authoredWeapons)) setAuthoredEnabled(visual ?? null, visual === authored);
      for (const mesh of parts.pistolMeshes) mesh.setEnabled(usePistol && !authored);
      for (const mesh of parts.longGunMeshes) mesh.setEnabled(!usePistol && !authored);
      if (authored) {
        placeAuthoredWeapon(authored, usePistol ? FALLBACK_PISTOL_RIGHT_GRIP : FALLBACK_LONG_RIGHT_GRIP);
        parts.leftGrip.position.copyFrom(authored.root.position.add(authored.gripLeft.scale(AUTHORED_WEAPON_SCALE)));
        parts.rightGrip.position.copyFrom(authored.root.position.add(authored.gripRight.scale(AUTHORED_WEAPON_SCALE)));
        const muzzle = authored.root.position.add(authored.muzzle.scale(AUTHORED_WEAPON_SCALE));
        rig.muzzleLocalPosition.copyFrom(muzzle);
        rig.muzzleAttachment.position.copyFrom(muzzle);
      } else {
        const local = MUZZLE_BY_WEAPON_CLASS[weaponClass].clone();
        rig.muzzleLocalPosition.copyFrom(local);
        rig.muzzleAttachment.position.copyFrom(local);
        parts.leftGrip.position.copyFrom(usePistol ? FALLBACK_PISTOL_LEFT_GRIP : FALLBACK_LONG_LEFT_GRIP);
        parts.rightGrip.position.copyFrom(usePistol ? FALLBACK_PISTOL_RIGHT_GRIP : FALLBACK_LONG_RIGHT_GRIP);
      }
      parts.weaponRoot.rotation.x = weaponClass === "sniper" ? -0.02 : 0;
      parts.weaponRoot.scaling.z = !authored && weaponClass === "smg" ? 0.9 : !authored && weaponClass === "sniper" ? 1.08 : 1;
      animate(parts, state.time, state.walkPhase, state.motion, 0, state.recoil);
    },
    setTeam(team: boolean | OperatorTeamColors) {
      const colors = typeof team === "boolean" ? (team ? ALLY_COLORS : ENEMY_COLORS) : team;
      if (colors.cloth) materials.cloth.albedoColor = color(colors.cloth);
      if (colors.vest) materials.vest.albedoColor = color(colors.vest);
      if (colors.marker) {
        materials.marker.albedoColor = color(colors.marker);
        materials.marker.emissiveColor = color(colors.marker).scale(0.055);
      }
      parts.authoredOperator?.applyTeam(colors);
    },
    update(deltaSeconds: number, movingSpeed: number, aimPitch = 0, shooting = false) {
      if (state.disposed) return;
      const dt = Math.max(0, Math.min(deltaSeconds, 0.1));
      const targetMotion = clamp01(movingSpeed);
      state.time += dt;
      state.motion = approach(state.motion, targetMotion, targetMotion > state.motion ? 10 : 12, dt);
      if (state.motion > 0.004) state.walkPhase += dt * (5.2 + state.motion * 2.4) * (0.35 + state.motion * 0.65);
      if (shooting) state.recoil = Math.min(1, Math.max(state.recoil, 0.58) + 0.22);
      animate(parts, state.time, state.walkPhase, state.motion, clamp(aimPitch, -0.85, 0.85), state.recoil);
      state.recoil = approach(state.recoil, 0, 14, dt);
    },
    dispose() {
      if (state.disposed) return;
      state.disposed = true;
      parts.authoredOperator?.dispose();
      root.dispose(false, false);
      for (const material of parts.authoredMaterials) material.dispose(true, true);
      for (const material of Object.values(materials)) material.dispose(true, true);
    },
  };

  rig.setTeam(true);
  rig.setWeapon(state.weaponId);
  return rig;
}

function createParts(scene: Scene, root: TransformNode, name: string, materials: OperatorMaterials): OperatorParts {
  const meshes: Mesh[] = [];
  const markers: Mesh[] = [];
  const pistolMeshes: Mesh[] = [];
  const longGunMeshes: Mesh[] = [];
  const add = (mesh: Mesh, material: PBRMaterial, parent: TransformNode = root): Mesh => {
    mesh.parent = parent;
    mesh.material = material;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.receiveShadows = true;
    mesh.metadata = null;
    meshes.push(mesh);
    return mesh;
  };
  const node = (id: string, parent: TransformNode = root, position?: [number, number, number]): TransformNode => {
    const result = new TransformNode(`${name}-${id}`, scene);
    result.parent = parent;
    if (position) result.position.set(...position);
    return result;
  };

  const pelvis = node("pelvis", root, [0, 0.18, 0]);
  const chest = node("chest", root, [0, 0.58, 0]);
  const head = node("head", root, [0, 1.12, 0]);

  const hips = add(capsule(scene, `${name}-hips`, 0.38, 0.24), materials.clothDark, pelvis);
  hips.scaling.x = 1.38;
  hips.scaling.z = 0.85;
  bevelBox(scene, `${name}-belt`, [0.64, 0.09, 0.38], [0, 0.05, 0.02], 0.018, materials.rubber, pelvis, add);
  bevelBox(scene, `${name}-belt-buckle`, [0.12, 0.07, 0.035], [0, 0.06, 0.23], 0.012, materials.metal, pelvis, add);

  const torso = add(capsule(scene, `${name}-torso-cloth`, 0.78, 0.28), materials.cloth, chest);
  torso.scaling.x = 1.18;
  torso.scaling.z = 0.75;
  torso.rotation.x = -0.04;
  bevelBox(scene, `${name}-plate-carrier`, [0.58, 0.57, 0.36], [0, 0.02, 0.02], 0.035, materials.vest, chest, add);
  bevelBox(scene, `${name}-front-plate`, [0.46, 0.39, 0.075], [0, 0.03, 0.235], 0.025, materials.plate, chest, add);
  bevelBox(scene, `${name}-rear-pack`, [0.48, 0.5, 0.19], [0, 0.02, -0.27], 0.028, materials.vest, chest, add);
  bevelBox(scene, `${name}-neck-gaiter`, [0.25, 0.16, 0.22], [0, 0.48, 0.02], 0.025, materials.rubber, chest, add);
  for (const x of [-0.18, 0, 0.18]) {
    bevelBox(scene, `${name}-mag-pouch-${x}`, [0.13, 0.19, 0.1], [x, -0.21, 0.27], 0.018, materials.vest, chest, add);
  }
  for (const x of [-0.24, 0.24]) {
    bevelBox(scene, `${name}-vest-strap-${x}`, [0.06, 0.61, 0.045], [x, 0.05, 0.25], 0.014, materials.rubber, chest, add);
  }

  const balaclava = add(sphere(scene, `${name}-balaclava`, 0.39), materials.rubber, head);
  balaclava.scaling.y = 1.08;
  const helmet = add(sphere(scene, `${name}-helmet-shell`, 0.56), materials.plate, head);
  helmet.position.y = 0.08;
  helmet.scaling.set(1.08, 0.62, 1);
  bevelBox(scene, `${name}-helmet-brim`, [0.42, 0.045, 0.34], [0, 0.03, 0.17], 0.015, materials.plate, head, add);
  bevelBox(scene, `${name}-goggles`, [0.34, 0.11, 0.06], [0, -0.045, 0.215], 0.018, materials.glass, head, add);
  bevelBox(scene, `${name}-lower-mask`, [0.28, 0.15, 0.07], [0, -0.18, 0.18], 0.018, materials.vest, head, add);
  for (const side of [-1, 1]) {
    bevelBox(scene, `${name}-ear-pro-${side}`, [0.07, 0.17, 0.16], [side * 0.23, -0.03, 0.01], 0.018, materials.rubber, head, add);
  }

  const leftArm = armRig(scene, root, name, "left", -1, materials, add);
  const rightArm = armRig(scene, root, name, "right", 1, materials, add);

  const leftThigh = legNode(scene, root, name, "left-thigh", [-0.12, -0.03, 0], 0.75, 0.13, materials.cloth, add);
  const leftShin = legNode(scene, leftThigh, name, "left-shin", [0, -0.43, 0.02], 0.5, 0.115, materials.clothDark, add);
  const rightThigh = legNode(scene, root, name, "right-thigh", [0.12, -0.03, 0], 0.75, 0.13, materials.cloth, add);
  const rightShin = legNode(scene, rightThigh, name, "right-shin", [0, -0.43, 0.02], 0.5, 0.115, materials.clothDark, add);
  for (const [sideName, side, shin] of [["left", -1, leftShin], ["right", 1, rightShin]] as const) {
    bevelBox(scene, `${name}-${sideName}-knee-pad`, [0.22, 0.14, 0.08], [0, 0.17, 0.13], 0.02, materials.plate, shin, add);
    bevelBox(scene, `${name}-${sideName}-boot`, [0.25, 0.15, 0.38], [0, -0.49, 0.08], 0.025, materials.rubber, shin, add);
    const band = bevelBox(scene, `${name}-${sideName}-armband`, [0.19, 0.08, 0.2], [side * 0.01, -0.1, 0.01], 0.014, materials.marker, side < 0 ? leftArm.upper : rightArm.upper, add);
    markers.push(band);
  }
  markers.push(bevelBox(scene, `${name}-chest-team-patch`, [0.16, 0.07, 0.025], [0.13, 0.21, 0.285], 0.01, materials.marker, chest, add));
  markers.push(bevelBox(scene, `${name}-back-team-patch`, [0.24, 0.1, 0.025], [0, 0.18, -0.38], 0.012, materials.marker, chest, add));
  const bodyMeshes = meshes.slice();

  const weaponRoot = node("weapon-root", root, [0, 0, 0]);
  const grips = createWeapon(scene, name, weaponRoot, materials, add, pistolMeshes, longGunMeshes);
  const authoredMaterials: PBRMaterial[] = [];
  const authoredWeapons: Partial<Record<WeaponId, AuthoredWeaponVisual>> = {};
  for (const weaponId of OPERATOR_WEAPON_IDS) {
    const visual = createAuthoredWeapon(scene, weaponRoot, name, weaponId, meshes, authoredMaterials);
    if (visual) authoredWeapons[weaponId] = visual;
  }
  const muzzle = node("muzzle-attachment", weaponRoot, [0, 0.34, 0.74]);
  const authoredOperator = buildAuthoredOperator(scene, name, {
    root,
    pelvis,
    chest,
    head,
    leftUpper: leftArm.upper,
    leftForearm: leftArm.forearm,
    leftHand: leftArm.hand,
    rightUpper: rightArm.upper,
    rightForearm: rightArm.forearm,
    rightHand: rightArm.hand,
    leftThigh,
    leftShin,
    rightThigh,
    rightShin,
  });
  if (authoredOperator) {
    for (const mesh of bodyMeshes) mesh.setEnabled(false);
    meshes.push(...authoredOperator.meshes);
  }

  leftThigh.rotation.x = -0.05;
  rightThigh.rotation.x = -0.05;

  return {
    root,
    chest,
    pelvis,
    head,
    weaponRoot,
    muzzle,
    leftArm,
    rightArm,
    leftGrip: grips.left,
    rightGrip: grips.right,
    leftThigh,
    leftShin,
    rightThigh,
    rightShin,
    weaponClass: "pistol",
    meshes,
    markers,
    pistolMeshes,
    longGunMeshes,
    authoredWeapons,
    authoredOperator,
    authoredMaterials,
    bodyMeshes,
  };
}

function createWeapon(
  scene: Scene,
  name: string,
  root: TransformNode,
  materials: OperatorMaterials,
  add: (mesh: Mesh, material: PBRMaterial, parent?: TransformNode) => Mesh,
  pistolMeshes: Mesh[],
  longGunMeshes: Mesh[],
): { left: TransformNode; right: TransformNode } {
  const leftGrip = new TransformNode(`${name}-left-weapon-grip`, scene);
  leftGrip.parent = root;
  leftGrip.position.set(-0.1, WEAPON_READY_HEIGHT + 0.29, 0.55);
  const rightGrip = new TransformNode(`${name}-right-weapon-grip`, scene);
  rightGrip.parent = root;
  rightGrip.position.set(0.1, WEAPON_READY_HEIGHT + 0.17, 0.32);

  const pistol = [
    bevelBox(scene, `${name}-pistol-slide`, [0.16, 0.12, 0.4], [0, WEAPON_READY_HEIGHT + 0.32, 0.48], 0.018, materials.metal, root, add),
    bevelBox(scene, `${name}-pistol-grip`, [0.13, 0.25, 0.12], [0, WEAPON_READY_HEIGHT + 0.16, 0.31], 0.018, materials.rubber, root, add),
    cylinder(scene, `${name}-pistol-barrel`, 0.04, 0.24, [0, WEAPON_READY_HEIGHT + 0.34, 0.73], materials.metal, root, add),
  ];
  pistolMeshes.push(...pistol);

  const longGun = [
    bevelBox(scene, `${name}-rifle-receiver`, [0.19, 0.17, 0.62], [0, WEAPON_READY_HEIGHT + 0.34, 0.54], 0.02, materials.metal, root, add),
    bevelBox(scene, `${name}-rifle-stock`, [0.19, 0.14, 0.34], [0, WEAPON_READY_HEIGHT + 0.34, 0.08], 0.024, materials.rubber, root, add),
    bevelBox(scene, `${name}-rifle-magazine`, [0.14, 0.28, 0.14], [0, WEAPON_READY_HEIGHT + 0.14, 0.45], 0.018, materials.rubber, root, add),
    bevelBox(scene, `${name}-rifle-handguard`, [0.16, 0.13, 0.5], [0, WEAPON_READY_HEIGHT + 0.35, 0.93], 0.02, materials.plate, root, add),
    bevelBox(scene, `${name}-rifle-optic`, [0.15, 0.09, 0.22], [0, WEAPON_READY_HEIGHT + 0.48, 0.57], 0.018, materials.glass, root, add),
    cylinder(scene, `${name}-rifle-barrel`, 0.045, 0.62, [0, WEAPON_READY_HEIGHT + 0.36, 1.24], materials.metal, root, add),
  ];
  longGunMeshes.push(...longGun);
  return { left: leftGrip, right: rightGrip };
}

function createAuthoredWeapon(
  scene: Scene,
  parent: TransformNode,
  name: string,
  weaponId: WeaponId,
  meshes: Mesh[],
  materials: PBRMaterial[],
): AuthoredWeaponVisual | null {
  const assetId = OPERATOR_WEAPON_ASSET_IDS[weaponId];
  const asset = getWeaponAsset(assetId);
  const weaponClass = getWeaponConfig(weaponId).weaponClass;
  const gripRight = Vector3.FromArray(asset?.gripRight ?? (weaponClass === "pistol" ? [0.1, -0.12, 0.02] : [0.14, -0.08, -0.08]));
  const gripLeft = Vector3.FromArray(asset?.gripLeft ?? (weaponClass === "pistol" ? [-0.08, -0.02, 0.19] : [-0.16, 0.02, 0.27]));
  const muzzle = Vector3.FromArray(asset?.muzzle ?? (weaponClass === "pistol" ? [0, 0.03, 0.347] : [0, 0.07, 0.589]));
  const root = new TransformNode(`${name}-authored-${weaponId}-root`, scene);
  root.parent = parent;
  root.scaling.setAll(AUTHORED_WEAPON_SCALE);
  const authored = buildAuthoredWeapon(scene, root, assetId, `${name}-authored-${weaponId}`);
  if (!authored) {
    root.dispose();
    return null;
  }
  const authoredMeshes = [...authored.values()];
  const materialSet = new Set<PBRMaterial>();
  for (const mesh of authoredMeshes) {
    mesh.renderingGroupId = 0;
    mesh.alwaysSelectAsActiveMesh = false;
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.metadata = null;
    meshes.push(mesh);
    if (mesh.material instanceof PBRMaterial) materialSet.add(mesh.material);
  }
  materials.push(...materialSet);
  setAuthoredEnabled({ root, meshes: authoredMeshes, gripRight, gripLeft, muzzle }, false);
  return { root, meshes: authoredMeshes, gripRight, gripLeft, muzzle };
}

function setAuthoredEnabled(visual: AuthoredWeaponVisual | null, enabled: boolean): void {
  if (!visual) return;
  visual.root.setEnabled(enabled);
  for (const mesh of visual.meshes) mesh.setEnabled(enabled);
}

function placeAuthoredWeapon(visual: AuthoredWeaponVisual, rightGrip: Vector3): void {
  visual.root.position.copyFrom(rightGrip.subtract(visual.gripRight.scale(AUTHORED_WEAPON_SCALE)));
}

function animate(parts: OperatorParts, time: number, walkPhase: number, movingSpeed: number, aimPitch: number, recoil: number): void {
  const stride = Math.sin(walkPhase) * movingSpeed;
  const counter = Math.cos(walkPhase) * movingSpeed;
  const stepLift = Math.max(0, Math.sin(walkPhase + Math.PI * 0.5)) * movingSpeed;
  const oppositeStepLift = Math.max(0, Math.sin(walkPhase - Math.PI * 0.5)) * movingSpeed;
  const breath = Math.sin(time * 1.35) * (1 - movingSpeed * 0.65);
  const recoilKick = recoil * recoil;

  parts.pelvis.position.y = 0.18 + Math.abs(counter) * 0.014;
  parts.pelvis.rotation.y = stride * 0.022;
  parts.chest.position.y = 0.58 + breath * 0.006 + Math.abs(counter) * 0.007;
  parts.chest.rotation.x = -0.035 + aimPitch * 0.16 - recoilKick * 0.026;
  parts.chest.rotation.z = -stride * 0.01;
  parts.head.rotation.x = aimPitch * 0.42 - recoilKick * 0.018;
  parts.head.rotation.y = -stride * 0.01;

  parts.leftThigh.rotation.x = -0.035 - stride * 0.19;
  parts.leftShin.rotation.x = 0.08 + Math.max(0, stride) * 0.22 + stepLift * 0.08;
  parts.rightThigh.rotation.x = -0.035 + stride * 0.19;
  parts.rightShin.rotation.x = 0.08 + Math.max(0, -stride) * 0.22 + oppositeStepLift * 0.08;
  parts.leftThigh.rotation.z = -0.03 + counter * 0.018;
  parts.rightThigh.rotation.z = 0.03 + counter * 0.018;

  parts.weaponRoot.position.y = breath * 0.004 + Math.abs(counter) * 0.004 - recoilKick * 0.018;
  parts.weaponRoot.position.z = 0.02 - recoilKick * 0.04;
  parts.weaponRoot.rotation.x = aimPitch * 0.6 - recoilKick * 0.065;
  parts.weaponRoot.rotation.z = -stride * 0.006;
  poseArm(parts, parts.leftArm, parts.leftGrip, stride, recoilKick);
  poseArm(parts, parts.rightArm, parts.rightGrip, stride, recoilKick);

  for (const marker of parts.markers) marker.scaling.y = 1 + recoilKick * 0.025;
}

function armRig(
  scene: Scene,
  parent: TransformNode,
  name: string,
  sideName: "left" | "right",
  side: -1 | 1,
  materials: OperatorMaterials,
  add: (mesh: Mesh, material: PBRMaterial, parent?: TransformNode) => Mesh,
): ArmRig {
  const upper = segment(scene, parent, `${name}-${sideName}-upper-arm`, 0.12, materials.cloth, add);
  const forearm = segment(scene, parent, `${name}-${sideName}-forearm`, 0.095, materials.cloth, add);
  const hand = new TransformNode(`${name}-${sideName}-hand`, scene);
  hand.parent = parent;
  bevelBox(scene, `${name}-${sideName}-glove`, [0.16, 0.13, 0.16], [0, 0, 0], 0.03, materials.rubber, hand, add);
  return { upper, forearm, hand, side };
}

function legNode(
  scene: Scene,
  parent: TransformNode,
  name: string,
  id: string,
  position: [number, number, number],
  height: number,
  radius: number,
  material: PBRMaterial,
  add: (mesh: Mesh, material: PBRMaterial, parent?: TransformNode) => Mesh,
): TransformNode {
  const pivot = new TransformNode(`${name}-${id}-pivot`, scene);
  pivot.parent = parent;
  pivot.position.set(...position);
  const mesh = add(capsule(scene, `${name}-${id}`, height, radius), material, pivot);
  mesh.position.y = -height * 0.42;
  return pivot;
}

function createMaterials(scene: Scene, name: string): OperatorMaterials {
  return {
    cloth: pbr(scene, `${name}-operator-cloth`, "#4e5b52", 0.92, 0.02, fabricTexture(scene, `${name}-cloth-finish`, "#4e5b52", "#202620")),
    clothDark: pbr(scene, `${name}-operator-cloth-dark`, "#343c37", 0.94, 0.01, fabricTexture(scene, `${name}-cloth-dark-finish`, "#343c37", "#171b18")),
    vest: pbr(scene, `${name}-operator-vest`, "#242c29", 0.86, 0.03, fabricTexture(scene, `${name}-vest-finish`, "#242c29", "#111513")),
    plate: pbr(scene, `${name}-operator-plate`, "#343b39", 0.58, 0.18),
    rubber: pbr(scene, `${name}-operator-rubber`, "#111615", 0.96, 0.01),
    metal: pbr(scene, `${name}-operator-metal`, "#565f5c", 0.42, 0.72),
    glass: pbr(scene, `${name}-operator-glass`, "#0d1c1e", 0.24, 0.08),
    marker: pbr(scene, `${name}-operator-marker`, "#4da58f", 0.7, 0.04),
  };
}

function pbr(scene: Scene, name: string, hex: string, roughness: number, metallic: number, texture?: DynamicTexture): PBRMaterial {
  const material = new PBRMaterial(name, scene);
  material.albedoColor = linearColor(hex);
  if (texture) material.albedoTexture = texture;
  material.roughness = roughness;
  material.metallic = metallic;
  material.environmentIntensity = 0.55;
  material.specularIntensity = metallic > 0 ? 0.56 : 0.22;
  material.emissiveColor = linearColor(hex).scale(metallic > 0 ? 0.018 : 0.008);
  material.maxSimultaneousLights = 6;
  return material;
}

function bevelBox(
  scene: Scene,
  name: string,
  size: [number, number, number],
  position: [number, number, number],
  bevel: number,
  material: PBRMaterial,
  parent: TransformNode,
  add: (mesh: Mesh, material: PBRMaterial, parent?: TransformNode) => Mesh,
): Mesh {
  const mesh = new BabylonMesh(name, scene);
  const vertexData = createChamferedBoxVertexData({ width: size[0], height: size[1], depth: size[2] }, bevel);
  vertexData.applyToMesh(mesh, true);
  mesh.position.set(...position);
  return add(mesh, material, parent);
}

function capsule(scene: Scene, name: string, height: number, radius: number): Mesh {
  return MeshBuilder.CreateCapsule(name, { height, radius, tessellation: 14 }, scene);
}

function sphere(scene: Scene, name: string, diameter: number): Mesh {
  return MeshBuilder.CreateSphere(name, { diameter, segments: 14 }, scene);
}

function cylinder(
  scene: Scene,
  name: string,
  diameter: number,
  length: number,
  position: [number, number, number],
  material: PBRMaterial,
  parent: TransformNode,
  add: (mesh: Mesh, material: PBRMaterial, parent?: TransformNode) => Mesh,
): Mesh {
  const mesh = MeshBuilder.CreateCylinder(name, { diameter, height: length, tessellation: 12 }, scene);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(...position);
  return add(mesh, material, parent);
}

function color(value: string | Color3): Color3 {
  return typeof value === "string" ? linearColor(value) : value.clone();
}

function linearColor(hex: string): Color3 {
  return Color3.FromHexString(hex).toLinearSpace();
}

function fabricTexture(scene: Scene, name: string, baseHex: string, darkHex: string): DynamicTexture {
  const texture = new DynamicTexture(name, { width: 128, height: 128 }, scene, false);
  const ctx = texture.getContext();
  ctx.fillStyle = "#e4e8df";
  ctx.fillRect(0, 0, 128, 128);
  ctx.globalAlpha = 0.11;
  ctx.strokeStyle = baseHex;
  ctx.lineWidth = 1;
  for (let index = 0; index < 128; index += 4) {
    ctx.beginPath();
    ctx.moveTo(index, 0);
    ctx.lineTo(index + 16, 128);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.075;
  for (let index = 0; index < 128; index += 6) {
    ctx.fillStyle = index % 12 === 0 ? "#f4f6ef" : darkHex;
    ctx.fillRect(0, index, 128, 1);
  }
  ctx.globalAlpha = 1;
  texture.update(false);
  return texture;
}

function createChamferedBoxVertexData(
  dimensions: { width: number; height: number; depth: number },
  bevel: number,
): VertexData {
  const halfX = dimensions.width / 2;
  const halfY = dimensions.height / 2;
  const halfZ = dimensions.depth / 2;
  const radius = Math.min(bevel, halfX * 0.48, halfY * 0.48, halfZ * 0.48);
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

function segment(
  scene: Scene,
  parent: TransformNode,
  name: string,
  radius: number,
  material: PBRMaterial,
  add: (mesh: Mesh, material: PBRMaterial, parent?: TransformNode) => Mesh,
): TransformNode {
  const pivot = new TransformNode(`${name}-pivot`, scene);
  pivot.parent = parent;
  pivot.rotationQuaternion = Quaternion.Identity();
  add(capsule(scene, name, 1, radius), material, pivot);
  return pivot;
}

function poseArm(parts: OperatorParts, arm: ArmRig, grip: TransformNode, stride: number, recoilKick: number): void {
  const shoulder = new Vector3(arm.side * 0.29, 0.87, 0.04 + stride * 0.018);
  const hand = gripInRootSpace(parts, grip);
  const elbow = Vector3.Lerp(shoulder, hand, 0.52)
    .add(new Vector3(arm.side * 0.06, -0.12 - recoilKick * 0.018, -0.08));
  placeSegment(arm.upper, shoulder, elbow);
  placeSegment(arm.forearm, elbow, hand);
  arm.hand.position.copyFrom(hand);
  arm.hand.rotation.copyFrom(parts.weaponRoot.rotation);
  arm.hand.rotation.z += arm.side * 0.06;
}

function gripInRootSpace(parts: OperatorParts, grip: TransformNode): Vector3 {
  parts.root.computeWorldMatrix(true);
  grip.computeWorldMatrix(true);
  const inverseRoot = Matrix.Invert(parts.root.getWorldMatrix());
  return Vector3.TransformCoordinates(grip.getAbsolutePosition(), inverseRoot);
}

function placeSegment(segmentNode: TransformNode, from: Vector3, to: Vector3): void {
  const delta = to.subtract(from);
  const length = Math.max(0.001, delta.length());
  const direction = delta.scale(1 / length);
  segmentNode.position.copyFrom(from.add(to).scale(0.5));
  segmentNode.scaling.set(1, length, 1);
  segmentNode.rotationQuaternion ??= Quaternion.Identity();
  Quaternion.FromUnitVectorsToRef(UP, direction, segmentNode.rotationQuaternion);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function approach(current: number, target: number, rate: number, deltaSeconds: number): number {
  if (deltaSeconds <= 0) return current;
  const blend = 1 - Math.exp(-rate * deltaSeconds);
  return current + (target - current) * blend;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
