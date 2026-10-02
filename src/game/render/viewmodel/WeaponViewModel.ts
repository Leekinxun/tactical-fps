import { buildTacticalHands } from "./TacticalHands";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { WeaponId } from "../../combat/WeaponCatalog";
import { buildAuthoredWeapon, getWeaponAsset, type WeaponAssetId } from "./WeaponAssets";
import {
  block,
  capsule,
  copyVector,
  createViewMaterials,
  cyl,
  markViewLight,
  markViewMesh,
  roundedBlock,
  type ViewMaterials,
} from "./primitives";

export interface ViewModelAnimationState {
  kick: number;
  reloadPose: number;
  reloadPhase: number;
  switchPose: number;
  moving: boolean;
  now: number;
}

interface AnimatedPart {
  mesh: AbstractMesh | TransformNode;
  basePosition: Vector3;
  baseRotation: Vector3;
}

interface HandControl {
  gripContact?: Vector3;
  setGrip?: (amount: number) => void;
}

export class WeaponViewModel {
  readonly root: TransformNode;
  readonly muzzle: TransformNode;
  readonly flash: TransformNode;
  readonly smoke: AbstractMesh;
  readonly muzzleLight: PointLight;
  private readonly meshes: AbstractMesh[] = [];
  private readonly materials: ViewMaterials;
  private readonly supportHand: AnimatedPart;
  private readonly firingPart: AnimatedPart | null;
  private readonly magazine: AnimatedPart | null;
  private readonly pump: AnimatedPart | null;
  private readonly cartridge: AnimatedPart | null;
  private flashScale = 1;
  private readonly updateHands?: () => void;
  private readonly supportHandControl: HandControl;
  private pumpStartedAt = -Infinity;
  private boltStartedAt = -Infinity;
  private lastKick = 0;

  constructor(scene: Scene, private readonly weaponId: WeaponId) {
    this.materials = createViewMaterials(scene);
    this.root = new TransformNode(`viewmodel-${weaponId}-root`, scene);
    this.muzzle = new TransformNode(`viewmodel-${weaponId}-muzzle-anchor`, scene);
    this.muzzle.parent = this.root;

    const built = buildWeapon(scene, this.root, weaponId, this.materials);
    this.meshes.push(...built.meshes);
    this.supportHand = capture(built.supportHand);
    this.supportHandControl = built.handControl ?? handControlFor(built.supportHand);
    this.updateHands = built.updateHands;
    this.firingPart = built.firingPart ? capture(built.firingPart) : null;
    this.magazine = built.magazine ? capture(built.magazine) : null;
    this.pump = built.pump ? capture(built.pump) : null;
    this.cartridge = built.cartridge ? capture(built.cartridge) : null;
    this.muzzle.position.copyFrom(built.muzzlePosition);

    this.flash = new TransformNode(`viewmodel-${weaponId}-muzzle-flash`, scene);
    this.flash.parent = this.muzzle;
    this.flash.setEnabled(false);
    const flashA = createTaperedFlash(scene, this.flash, `viewmodel-${weaponId}-muzzle-flash-blade-a`, this.materials.flash, 0);
    const flashB = createTaperedFlash(scene, this.flash, `viewmodel-${weaponId}-muzzle-flash-blade-b`, this.materials.flash, Math.PI / 2);

    this.smoke = MeshBuilder.CreatePlane(`viewmodel-${weaponId}-muzzle-smoke`, { width: 0.24, height: 0.18 }, scene);
    this.smoke.parent = this.muzzle;
    this.smoke.material = this.materials.smoke;
    this.smoke.position.z = 0.1;
    this.smoke.rotation.y = Math.PI;
    this.smoke.scaling.set(0.8, 0.8, 0.8);
    this.smoke.setEnabled(false);
    markViewMesh(this.smoke);
    this.meshes.push(flashA, flashB, this.smoke);

    this.muzzleLight = markViewLight(new PointLight(`viewmodel-${weaponId}-muzzle-light`, Vector3.Zero(), scene));
    this.muzzleLight.parent = this.muzzle;
    this.muzzleLight.diffuse = Color3.FromHexString("#ff9a3d").toLinearSpace();
    this.muzzleLight.specular = Color3.FromHexString("#ffe8b2").toLinearSpace();
    this.muzzleLight.range = 4.5;
    this.muzzleLight.intensity = 0;
    this.muzzleLight.setEnabled(false);
    this.muzzleLight.includedOnlyMeshes = this.getAllMeshes();
  }

  setFlash(active: boolean, smokeActive: boolean, strength: number): void {
    this.flash.setEnabled(active);
    this.smoke.setEnabled(smokeActive);
    this.muzzleLight.setEnabled(active);
    this.muzzleLight.intensity = active ? 2.5 * strength : 0;
    this.flashScale = 0.85 + strength * 0.55;
  }

  update(state: ViewModelAnimationState): void {
    const bob = state.moving ? Math.sin(state.now * 0.009) : Math.sin(state.now * 0.002) * 0.22;
    const breathing = Math.sin(state.now * 0.0017);
    const lower = (1 - state.switchPose) * 0.36;
    const reload = ease(state.reloadPose);
    const pistol = this.weaponId === "px9" || this.weaponId === "arc12";
    const reloadLean = reloadTilt(state.reloadPhase) * reload;
    const recoil = recoilProfile(this.weaponId);
    const newShot = state.kick > 0.82 && this.lastKick < 0.35;
    if (newShot && this.weaponId === "rift6") this.pumpStartedAt = state.now;
    if (newShot && this.weaponId === "needle50") this.boltStartedAt = state.now;
    this.lastKick = state.kick;

    this.root.position.set(0.36 + bob * 0.008 - reloadLean * 0.035, (pistol ? -0.17 : -0.28) + reloadLean * (pistol ? 0.08 : 0.16) - lower - state.kick * recoil.rootY, (pistol ? 0.63 : 0.68) - state.kick * recoil.rootZ);
    this.root.rotation.set(
      -0.035 - state.kick * recoil.pitch + breathing * 0.0025 + reloadLean * 0.11,
      (pistol ? -0.27 : -0.19) + bob * 0.008 + reloadLean * 0.15,
      -0.035 + bob * 0.012 - reloadLean * 0.36,
    );
    this.root.scaling.setAll(pistol ? 0.85 : 0.84);

    applyPart(this.supportHand);

    if (this.firingPart) {
      applyPart(this.firingPart);
      const finishRack = reload * smoothPulse(state.reloadPhase, 0.8, 0.9);
      const boltCycle = this.weaponId === "needle50" ? delayedCycle(state.now, this.boltStartedAt, 110, 390) : 0;
      this.firingPart.mesh.position.z -= state.kick * recoil.partZ + finishRack * recoil.rackZ + boltTravel(boltCycle) * 0.13;
      this.firingPart.mesh.rotation.x += state.kick * 0.022;
      if (this.weaponId === "needle50") {
        this.firingPart.mesh.rotation.z += boltUnlock(boltCycle) * 0.72;
        this.firingPart.mesh.position.x += boltTravel(boltCycle) * 0.018;
      }
    }
    if (this.magazine) {
      applyPart(this.magazine);
      animateMagazine(this.magazine, state.reloadPhase, reload, this.weaponId);
    }
    if (this.pump) {
      applyPart(this.pump);
      const pumpCycle = delayedCycle(state.now, this.pumpStartedAt, 80, 360);
      this.pump.mesh.position.z -= pumpTravel(pumpCycle) * 0.16;
      this.supportHand.mesh.position.z -= pumpTravel(pumpCycle) * 0.12;
    }
    if (this.cartridge) {
      applyPart(this.cartridge);
      animateShell(this.cartridge, state.reloadPhase, reload);
    }

    this.animateSupportHand(state, reload, pistol);
    this.updateHands?.();

    this.flash.scaling.set(this.flashScale, this.flashScale, this.flashScale);
    this.flash.rotation.z = Math.sin(state.now * 0.033) * 0.5;
    this.smoke.position.z = 0.04 + (1 - state.kick) * 0.08;
    this.smoke.rotation.z = Math.sin(state.now * 0.01) * 0.18;
    this.smoke.scaling.setAll(0.92 + Math.sin(state.now * 0.011) * 0.08);
  }

  dispose(): void {
    this.muzzleLight.dispose();
    this.root.dispose(false, true);
    for (const material of Object.values(this.materials)) material.dispose(true, true);
  }

  getAllMeshes(): AbstractMesh[] {
    return this.root.getChildMeshes(false);
  }

  private animateSupportHand(state: ViewModelAnimationState, reload: number, pistol: boolean): void {
    const phase = state.reloadPhase;
    if (reload <= 0.002 || phase <= 0.002) {
      this.supportHandControl.setGrip?.(1);
      return;
    }

    let reach = 0;
    let contactTarget: Vector3 | null = null;
    let grip = 1;
    if (this.magazine) {
      const contact = magazineContactTarget(this.root, this.magazine, this.weaponId);
      contactTarget = contact;
      if (phase < 0.18) {
        reach = ease(phase / 0.18);
        grip = 1 - smoothStepRange(phase, 0, 0.07) + smoothStepRange(phase, 0.07, 0.18);
      } else if (phase < 0.8) {
        reach = 1;
      } else if (phase < 0.9) {
        reach = 1;
        const confirm = confirmTarget(this.firingPart, this.supportHand.basePosition, this.weaponId);
        contactTarget = confirm ? Vector3.Lerp(contact, confirm, smoothStepRange(phase, 0.8, 0.85)) : contact;
        grip = 1 - 0.8 * smoothStepRange(phase, 0.82, 0.89);
      } else {
        reach = 1 - ease((phase - 0.9) / 0.1);
        contactTarget = confirmTarget(this.firingPart, this.supportHand.basePosition, this.weaponId) ?? contact;
        grip = 0.2 + 0.8 * smoothStepRange(phase, 0.94, 1);
      }
    } else if (this.cartridge) {
      const loadingPort = new Vector3(-0.065, -0.105, 0.35);
      if (phase < 0.18) {
        reach = ease(phase / 0.18);
        grip = reach;
        contactTarget = loadingPort;
      } else if (phase < 0.8) {
        reach = 1;
        grip = 1;
        contactTarget = shellHandTarget(phase);
      } else if (phase < 0.9) {
        reach = 1;
        grip = 0.75;
        contactTarget = new Vector3(-0.04, -0.11, 0.41);
      } else {
        reach = 1 - ease((phase - 0.9) / 0.1);
        grip = reach;
        contactTarget = null;
      }
    }

    this.supportHand.mesh.rotation.copyFrom(this.supportHand.baseRotation);
    this.supportHand.mesh.rotation.x += reload * reach * (pistol ? -0.18 : -0.52);
    this.supportHand.mesh.rotation.y += reload * reach * (pistol ? 0.08 : 0.14);
    const confirmRoll = smoothStepRange(phase, 0.8, 0.85) * (1 - smoothStepRange(phase, 0.9, 1));
    this.supportHand.mesh.rotation.z += reload * reach * (-0.44 + confirmRoll * 0.24);
    const target = contactTarget
      ? handRootPositionForContact(this.supportHand, this.supportHandControl, contactTarget)
      : this.supportHand.basePosition;
    Vector3.LerpToRef(this.supportHand.basePosition, target, reload * reach, this.supportHand.mesh.position);
    this.supportHandControl.setGrip?.(clamp01(grip));
  }
}

interface BuiltWeapon {
  meshes: AbstractMesh[];
  muzzlePosition: Vector3;
  supportHand: TransformNode;
  updateHands?: () => void;
  handControl?: HandControl;
  firingPart?: AbstractMesh;
  magazine?: AbstractMesh;
  pump?: AbstractMesh;
  cartridge?: AbstractMesh;
}

function buildWeapon(scene: Scene, root: TransformNode, weaponId: WeaponId, materials: ViewMaterials): BuiltWeapon {
  const pistol = weaponId === "px9" || weaponId === "arc12";
  const assetIds: Record<WeaponId, WeaponAssetId> = {
    px9: "modernPistol", arc12: "pistol", br4: "rifle", vx7: "smg", rift6: "shotgun", needle50: "sniper",
  };
  const assetId = assetIds[weaponId];
  const authored = buildAuthoredWeapon(scene, root, assetId, `viewmodel-${weaponId}`);
  const asset = getWeaponAsset(assetId);
  if (authored && asset) {
    const hands = buildTacticalHands(scene, root, `viewmodel-${weaponId}`, materials, {
      style: pistol ? "pistol" : "rifle",
      gripLeft: asset.gripLeft,
      gripRight: asset.gripRight,
    });
    return {
      meshes: [...authored.values(), ...hands.meshes],
      muzzlePosition: asset.muzzle ? Vector3.FromArray(asset.muzzle)
        : pistol ? new Vector3(0, 0.048, 0.351) : new Vector3(0, 0.071, 0.591),
      supportHand: hands.supportHand,
      handControl: handControlFor(hands),
      updateHands: hands.update,
      firingPart: authored.get(pistol ? "slide" : "bolt"),
      magazine: authored.get("magazine"),
      pump: authored.get("pump"),
      cartridge: authored.get("cartridge"),
    };
  }
  switch (weaponId) {
    case "px9":
      return buildPistol(scene, root, weaponId, materials, false);
    case "arc12":
      return buildPistol(scene, root, weaponId, materials, true);
    case "vx7":
      return buildSmg(scene, root, materials);
    case "rift6":
      return buildShotgun(scene, root, materials);
    case "br4":
      return buildRifle(scene, root, materials);
    case "needle50":
      return buildSniper(scene, root, materials);
  }
}

function buildPistol(scene: Scene, root: TransformNode, weaponId: "px9" | "arc12", materials: ViewMaterials, heavy: boolean): BuiltWeapon {
  const meshes: AbstractMesh[] = [];
  const slide = roundedBlock(scene, root, `viewmodel-${weaponId}-slide`, { width: heavy ? 0.19 : 0.15, height: 0.105, depth: heavy ? 0.5 : 0.42 }, materials.parkerized, [0, 0.04, 0.16])[0];
  meshes.push(slide);
  meshes.push(...roundedBlock(scene, root, `viewmodel-${weaponId}-frame`, { width: heavy ? 0.18 : 0.15, height: 0.1, depth: heavy ? 0.38 : 0.33 }, materials.polymer, [0, -0.055, 0.1]));
  const grip = block(scene, root, `viewmodel-${weaponId}-grip`, { width: 0.14, height: 0.31, depth: 0.15 }, materials.polymer, [0, -0.23, 0], [-0.2, 0, 0]);
  const magazine = block(scene, root, `viewmodel-${weaponId}-magazine`, { width: 0.12, height: 0.29, depth: 0.11 }, materials.darkMetal, [0, -0.28, 0.02], [-0.2, 0, 0]);
  const barrel = cyl(scene, root, `viewmodel-${weaponId}-barrel-crown`, { height: 0.05, diameter: heavy ? 0.09 : 0.07 }, materials.darkMetal, [0, 0.04, heavy ? 0.43 : 0.36]);
  const guard = MeshBuilder.CreateTorus(`viewmodel-${weaponId}-trigger-guard`, { diameter: 0.16, thickness: 0.018, tessellation: 18 }, scene);
  guard.parent = root;
  guard.material = materials.darkMetal;
  guard.position.set(0, -0.14, 0.14);
  guard.rotation.y = Math.PI / 2;
  markViewMesh(guard);
  meshes.push(grip, magazine, barrel, guard);
  for (const side of [-1, 1]) {
    for (let index = 0; index < 6; index += 1) {
      const rib = block(scene, root, `viewmodel-${weaponId}-rear-serration-${side}-${index}`, { width: 0.005, height: 0.072, depth: 0.009 }, materials.darkMetal, [side * (heavy ? 0.096 : 0.076), 0.037, -0.025 + index * 0.021]);
      rib.setParent(slide);
      meshes.push(rib);
    }
    const sight = block(scene, root, `viewmodel-${weaponId}-rear-sight-${side}`, { width: 0.028, height: 0.035, depth: 0.045 }, materials.darkMetal, [side * 0.043, 0.11, -0.018]);
    sight.setParent(slide);
    meshes.push(sight);
  }
  const frontSight = block(scene, root, `viewmodel-${weaponId}-front-sight`, { width: 0.019, height: 0.027, depth: 0.028 }, materials.darkMetal, [0, 0.106, heavy ? 0.367 : 0.315]);
  frontSight.setParent(slide);
  meshes.push(frontSight);
  const port = block(scene, root, `viewmodel-${weaponId}-ejection-port`, { width: 0.085, height: 0.008, depth: 0.11 }, materials.darkMetal, [0, 0.095, 0.14]);
  port.setParent(slide);
  meshes.push(port);
  const breech = block(scene, root, `viewmodel-${weaponId}-barrel-chamber`, { width: 0.058, height: 0.006, depth: 0.09 }, materials.brass, [0.008, 0.10, 0.148]);
  breech.setParent(slide);
  meshes.push(breech);
  const backplate = block(scene, root, `viewmodel-${weaponId}-slide-backplate`, { width: 0.076, height: 0.065, depth: 0.006 }, materials.darkMetal, [0, 0.025, heavy ? -0.093 : -0.053]);
  backplate.setParent(slide);
  meshes.push(backplate);
  const supportHand = addSupportHand(scene, root, weaponId, materials, meshes, [-0.12, -0.2, heavy ? 0.3 : 0.22], [0.55, 0.08, -0.55], heavy ? 0.34 : 0.28);
  addTriggerHand(scene, root, weaponId, materials, meshes, [0.08, -0.23, 0.015]);
  return { meshes, muzzlePosition: new Vector3(0, 0.04, heavy ? 0.47 : 0.4), supportHand, firingPart: meshes[0], magazine };
}

function buildSmg(scene: Scene, root: TransformNode, materials: ViewMaterials): BuiltWeapon {
  const meshes: AbstractMesh[] = [];
  meshes.push(...roundedBlock(scene, root, "viewmodel-vx7-monolithic-upper", { width: 0.2, height: 0.17, depth: 0.58 }, materials.darkMetal, [0, 0.06, 0.29]));
  const lower = block(scene, root, "viewmodel-vx7-polymer-lower", { width: 0.16, height: 0.12, depth: 0.3 }, materials.polymer, [0, -0.055, 0.18]);
  const barrel = cyl(scene, root, "viewmodel-vx7-short-barrel", { height: 0.32, diameter: 0.052 }, materials.parkerized, [0, 0.05, 0.72]);
  const muzzle = cyl(scene, root, "viewmodel-vx7-compensator", { height: 0.12, diameter: 0.075 }, materials.darkMetal, [0, 0.05, 0.92]);
  const magazine = block(scene, root, "viewmodel-vx7-curved-magazine", { width: 0.13, height: 0.38, depth: 0.16 }, materials.darkMetal, [0, -0.25, 0.25], [0.16, 0, 0]);
  const foregrip = capsule(scene, root, "viewmodel-vx7-angled-foregrip", { height: 0.26, radius: 0.04 }, materials.polymer, [-0.02, -0.17, 0.54], [0.48, 0, 0.05]);
  meshes.push(lower, barrel, muzzle, magazine, foregrip);
  addRail(scene, root, "vx7", materials, meshes, 0.2, 0.55, 5);
  const supportHand = addSupportHand(scene, root, "vx7", materials, meshes, [-0.13, -0.17, 0.55], [1.15, -0.18, -0.38], 0.38);
  addTriggerHand(scene, root, "vx7", materials, meshes, [0.11, -0.31, 0.02]);
  return { meshes, muzzlePosition: new Vector3(0, 0.05, 0.99), supportHand, firingPart: meshes[0], magazine };
}

function buildRifle(scene: Scene, root: TransformNode, materials: ViewMaterials): BuiltWeapon {
  const meshes: AbstractMesh[] = [];
  meshes.push(...roundedBlock(scene, root, "viewmodel-br4-forged-receiver", { width: 0.2, height: 0.16, depth: 0.46 }, materials.parkerized, [0, 0.05, 0.23]));
  const handguard = roundedBlock(scene, root, "viewmodel-br4-mlok-handguard", { width: 0.19, height: 0.14, depth: 0.45 }, materials.darkMetal, [0, 0.03, 0.63]);
  const barrel = cyl(scene, root, "viewmodel-br4-freefloat-barrel", { height: 0.58, diameter: 0.052 }, materials.parkerized, [0, 0.03, 0.92]);
  const muzzle = cyl(scene, root, "viewmodel-br4-flash-hider", { height: 0.14, diameter: 0.08 }, materials.darkMetal, [0, 0.03, 1.18]);
  const stockTube = cyl(scene, root, "viewmodel-br4-buffer-tube", { height: 0.32, diameter: 0.055 }, materials.parkerized, [0, 0.025, -0.16]);
  const stock = block(scene, root, "viewmodel-br4-adjustable-stock", { width: 0.18, height: 0.18, depth: 0.26 }, materials.polymer, [0, -0.01, -0.38]);
  const magazine = block(scene, root, "viewmodel-br4-ribbed-magazine", { width: 0.14, height: 0.34, depth: 0.18 }, materials.polymer, [0, -0.25, 0.28], [0.1, 0, 0]);
  meshes.push(...handguard, barrel, muzzle, stockTube, stock, magazine);
  addRail(scene, root, "br4", materials, meshes, 0.18, 0.79, 8);
  addSight(scene, root, "br4", materials, meshes, 0.32, false);
  const supportHand = addSupportHand(scene, root, "br4", materials, meshes, [-0.14, -0.16, 0.67], [1.28, -0.08, -0.35], 0.4);
  addTriggerHand(scene, root, "br4", materials, meshes, [0.11, -0.31, 0.01]);
  return { meshes, muzzlePosition: new Vector3(0, 0.03, 1.26), supportHand, firingPart: meshes[0], magazine };
}

function buildShotgun(scene: Scene, root: TransformNode, materials: ViewMaterials): BuiltWeapon {
  const meshes: AbstractMesh[] = [];
  meshes.push(...roundedBlock(scene, root, "viewmodel-rift6-receiver", { width: 0.22, height: 0.17, depth: 0.44 }, materials.parkerized, [0, 0.05, 0.22]));
  const barrel = cyl(scene, root, "viewmodel-rift6-heavy-barrel", { height: 0.82, diameter: 0.072 }, materials.darkMetal, [0, 0.06, 0.86]);
  const tube = cyl(scene, root, "viewmodel-rift6-magazine-tube", { height: 0.72, diameter: 0.072 }, materials.parkerized, [0, -0.055, 0.78]);
  const pump = block(scene, root, "viewmodel-rift6-pump-foreend", { width: 0.19, height: 0.12, depth: 0.32 }, materials.polymer, [0, -0.08, 0.65]);
  const stock = block(scene, root, "viewmodel-rift6-short-stock", { width: 0.19, height: 0.18, depth: 0.32 }, materials.polymer, [0, -0.03, -0.28], [0.05, 0, 0]);
  const shell = cyl(scene, root, "viewmodel-rift6-shell", { height: 0.16, diameter: 0.05 }, materials.brass, [-0.08, -0.18, 0.38], "z");
  shell.setEnabled(false);
  meshes.push(barrel, tube, pump, stock, shell);
  for (let index = 0; index < 5; index += 1) {
    meshes.push(block(scene, root, `viewmodel-rift6-pump-rib-${index}`, { width: 0.205, height: 0.014, depth: 0.02 }, materials.rubber, [0, -0.012, 0.52 + index * 0.055]));
  }
  for (let index = 0; index < 4; index += 1) {
    meshes.push(cyl(scene, root, `viewmodel-rift6-side-saddle-shell-${index}`, { height: 0.12, diameter: 0.038 }, materials.brass, [-0.13, 0.01, 0.06 + index * 0.075], "z", [0, 0.18, 0]));
  }
  meshes.push(block(scene, root, "viewmodel-rift6-front-bead-sight", { width: 0.035, height: 0.035, depth: 0.025 }, materials.tanPolymer, [0, 0.13, 1.16]));
  const supportHand = addSupportHand(scene, root, "rift6", materials, meshes, [-0.14, -0.19, 0.63], [1.25, -0.12, -0.36], 0.42);
  addTriggerHand(scene, root, "rift6", materials, meshes, [0.12, -0.31, 0]);
  return { meshes, muzzlePosition: new Vector3(0, 0.06, 1.28), supportHand, firingPart: meshes[0], pump, cartridge: shell };
}

function buildSniper(scene: Scene, root: TransformNode, materials: ViewMaterials): BuiltWeapon {
  const meshes: AbstractMesh[] = [];
  meshes.push(...roundedBlock(scene, root, "viewmodel-needle50-long-action", { width: 0.2, height: 0.16, depth: 0.54 }, materials.parkerized, [0, 0.045, 0.2]));
  const barrel = cyl(scene, root, "viewmodel-needle50-fluted-barrel", { height: 0.98, diameter: 0.058 }, materials.darkMetal, [0, 0.055, 0.95]);
  const brake = cyl(scene, root, "viewmodel-needle50-muzzle-brake", { height: 0.18, diameter: 0.1 }, materials.darkMetal, [0, 0.055, 1.47]);
  const magazine = block(scene, root, "viewmodel-needle50-box-magazine", { width: 0.15, height: 0.3, depth: 0.16 }, materials.darkMetal, [0, -0.24, 0.22]);
  const bolt = cyl(scene, root, "viewmodel-needle50-bolt-handle", { height: 0.18, diameter: 0.035 }, materials.parkerized, [0.13, 0.05, 0.1], "x", [0, 0, -0.3]);
  meshes.push(barrel, brake, magazine, bolt);
  addRail(scene, root, "needle50", materials, meshes, 0.2, 0.54, 6);
  addSight(scene, root, "needle50", materials, meshes, 0.34, true);
  const supportHand = addSupportHand(scene, root, "needle50", materials, meshes, [-0.14, -0.17, 0.58], [1.2, -0.08, -0.34], 0.42);
  addTriggerHand(scene, root, "needle50", materials, meshes, [0.12, -0.32, -0.02]);
  return { meshes, muzzlePosition: new Vector3(0, 0.055, 1.58), supportHand, firingPart: bolt, magazine };
}

function addRail(scene: Scene, root: TransformNode, weapon: string, materials: ViewMaterials, meshes: AbstractMesh[], startZ: number, endZ: number, teeth: number): void {
  meshes.push(block(scene, root, `viewmodel-${weapon}-top-rail`, { width: 0.085, height: 0.034, depth: endZ - startZ }, materials.darkMetal, [0, 0.155, (startZ + endZ) / 2]));
  for (let index = 0; index < teeth; index += 1) {
    meshes.push(block(scene, root, `viewmodel-${weapon}-rail-tooth-${index}`, { width: 0.105, height: 0.022, depth: 0.028 }, materials.parkerized, [0, 0.183, startZ + index * ((endZ - startZ) / Math.max(1, teeth - 1))]));
  }
}

function addSight(scene: Scene, root: TransformNode, weapon: string, materials: ViewMaterials, meshes: AbstractMesh[], z: number, scope: boolean): void {
  if (scope) {
    const tube = cyl(scene, root, `viewmodel-${weapon}-scope-tube`, { height: 0.42, diameter: 0.1 }, materials.darkMetal, [0, 0.29, z], "z");
    const front = cyl(scene, root, `viewmodel-${weapon}-scope-objective`, { height: 0.065, diameter: 0.15 }, materials.glass, [0, 0.29, z + 0.24], "z");
    const rear = cyl(scene, root, `viewmodel-${weapon}-scope-eyepiece`, { height: 0.06, diameter: 0.13 }, materials.glass, [0, 0.29, z - 0.23], "z");
    meshes.push(tube, front, rear);
    return;
  }
  meshes.push(block(scene, root, `viewmodel-${weapon}-rear-sight`, { width: 0.075, height: 0.075, depth: 0.06 }, materials.polymer, [0, 0.22, z]));
  meshes.push(block(scene, root, `viewmodel-${weapon}-front-sight`, { width: 0.058, height: 0.07, depth: 0.045 }, materials.polymer, [0, 0.19, 1.05]));
}

function addTriggerHand(scene: Scene, root: TransformNode, weapon: string, materials: ViewMaterials, meshes: AbstractMesh[], handPosition: [number, number, number]): void {
  meshes.push(capsule(scene, root, `viewmodel-${weapon}-trigger-glove`, { height: 0.36, radius: 0.085 }, materials.glove, handPosition, [0.26, 0, -0.28]));
  meshes.push(capsule(scene, root, `viewmodel-${weapon}-trigger-sleeve`, { height: 0.56, radius: 0.115 }, materials.sleeve, [handPosition[0] + 0.07, handPosition[1] - 0.26, handPosition[2] - 0.1], [-0.22, 0, 0.22]));
  for (let index = 0; index < 4; index += 1) {
    meshes.push(capsule(scene, root, `viewmodel-${weapon}-trigger-finger-${index}`, { height: 0.16, radius: 0.018 }, materials.glove, [handPosition[0] - 0.055 + index * 0.028, handPosition[1] + 0.035, handPosition[2] + 0.11], [1.12, 0.08, -0.1]));
  }
}

function addSupportHand(
  scene: Scene,
  root: TransformNode,
  weapon: string,
  materials: ViewMaterials,
  meshes: AbstractMesh[],
  position: [number, number, number],
  rotation: [number, number, number],
  height: number,
): TransformNode {
  const handRoot = new TransformNode(`viewmodel-${weapon}-support-hand-root`, scene);
  handRoot.parent = root;
  handRoot.position.set(...position);
  handRoot.rotation.set(...rotation);
  const palm = capsule(scene, handRoot, `viewmodel-${weapon}-support-glove`, { height, radius: 0.08 }, materials.glove, [0, 0, 0], [0, 0, 0]);
  const sleeve = capsule(scene, handRoot, `viewmodel-${weapon}-support-sleeve`, { height: 0.48, radius: 0.105 }, materials.sleeve, [-0.05, -0.23, -0.16], [-0.25, 0.08, 0.18]);
  const thumb = capsule(scene, handRoot, `viewmodel-${weapon}-support-thumb`, { height: 0.16, radius: 0.023 }, materials.glove, [0.082, 0.02, 0.035], [0.75, -0.35, 0.42]);
  meshes.push(palm, sleeve, thumb);
  for (let index = 0; index < 4; index += 1) {
    const finger = capsule(
      scene,
      handRoot,
      `viewmodel-${weapon}-support-finger-${index}`,
      { height: 0.18, radius: 0.018 },
      materials.glove,
      [-0.052 + index * 0.032, 0.034, 0.095],
      [1.18, -0.04 + index * 0.03, -0.18],
    );
    meshes.push(finger);
  }
  return handRoot;
}

function createTaperedFlash(scene: Scene, parent: TransformNode, name: string, material: ViewMaterials["flash"], roll: number): AbstractMesh {
  const mesh = new Mesh(name, scene);
  mesh.parent = parent;
  mesh.material = material;
  mesh.rotation.z = roll;
  const vertexData = new VertexData();
  vertexData.positions = [
    0, 0, 0,
    -0.055, -0.028, 0.055,
    -0.018, -0.018, 0.22,
    0, 0, 0.3,
    0.018, 0.018, 0.22,
    0.055, 0.028, 0.055,
  ];
  vertexData.indices = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5];
  vertexData.uvs = [0, 0.5, 0.18, 0, 0.73, 0.33, 1, 0.5, 0.73, 0.67, 0.18, 1];
  vertexData.normals = [
    0, 0, -1,
    0, 0, -1,
    0, 0, -1,
    0, 0, -1,
    0, 0, -1,
    0, 0, -1,
  ];
  vertexData.applyToMesh(mesh, true);
  return markViewMesh(mesh);
}

function capture(mesh: AbstractMesh | TransformNode): AnimatedPart {
  return { mesh, basePosition: copyVector(mesh.position), baseRotation: copyVector(mesh.rotation) };
}

function applyPart(part: AnimatedPart): void {
  part.mesh.position.copyFrom(part.basePosition);
  part.mesh.rotation.copyFrom(part.baseRotation);
}

function ease(value: number): number {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function handControlFor(value: TransformNode | { supportHand: TransformNode } & Partial<HandControl>): HandControl {
  const hand = "supportHand" in value ? value.supportHand : value as TransformNode & Partial<HandControl>;
  const source = "supportHand" in value ? value as Partial<HandControl> : hand as Partial<HandControl>;
  const gripContact = source.gripContact?.clone?.() ?? new Vector3(0, -0.018, 0.07);
  hand.metadata = { ...(hand.metadata ?? {}), gripContact };
  return {
    gripContact,
    setGrip: source.setGrip,
  };
}

function animateMagazine(part: AnimatedPart, phase: number, reload: number, weaponId: WeaponId): void {
  const detachable = reload > 0.002 && phase > 0.002;
  part.mesh.setEnabled(!detachable || phase <= 0.48 || phase >= 0.58);
  const out = magazineOutOffset(weaponId);
  const insertion = magazineInsertionOffset(weaponId);
  const seatTap = smoothPulse(phase, 0.8, 0.9) * 0.035;
  let offset = Vector3.Zero();
  if (phase < 0.18) {
    offset = Vector3.Zero();
  } else if (phase < 0.4) {
    offset = out.scale(ease((phase - 0.18) / 0.22));
  } else if (phase < 0.48) {
    offset = Vector3.Lerp(out, insertion, ease((phase - 0.4) / 0.08));
  } else if (phase < 0.58) {
    offset = insertion;
  } else if (phase < 0.8) {
    offset = Vector3.Lerp(insertion, Vector3.Zero(), ease((phase - 0.58) / 0.22));
  }
  part.mesh.position.addInPlace(offset.scale(reload));
  part.mesh.position.y -= seatTap * reload;
  part.mesh.rotation.x += reload * (smoothStepRange(phase, 0.18, 0.4) - smoothStepRange(phase, 0.58, 0.8)) * 0.22;
  part.mesh.rotation.z -= reload * smoothPulse(phase, 0.18, 0.8) * 0.18;
}

function animateShell(part: AnimatedPart, phase: number, reload: number): void {
  part.mesh.setEnabled(reload > 0.002 && phase >= 0.4 && phase <= 0.84);
  const shell = shellHandTarget(phase);
  part.mesh.position.copyFrom(shell);
  part.mesh.position.x += 0.018;
  part.mesh.position.y += 0.015;
  part.mesh.rotation.x = Math.PI / 2;
  part.mesh.rotation.z += reload * (1.15 - smoothStepRange(phase, 0.58, 0.8) * 1.0);
}

function magazineContactTarget(root: TransformNode, magazine: AnimatedPart, weaponId: WeaponId): Vector3 {
  const extents = meshExtents(magazine.mesh);
  const side = weaponId === "px9" || weaponId === "arc12" ? -0.62 : -0.7;
  return localPointInRoot(root, magazine.mesh, new Vector3(extents.x * side, -extents.y * 0.12, -extents.z * 0.16));
}

function confirmTarget(part: AnimatedPart | null, fallback: Vector3, weaponId: WeaponId): Vector3 | null {
  if (!part) return null;
  if (weaponId === "needle50") return part.mesh.position.add(new Vector3(-0.06, 0.01, -0.02));
  return fallback.add(new Vector3(0.02, -0.02, -0.06));
}

function handRootPositionForContact(hand: AnimatedPart, control: HandControl, target: Vector3): Vector3 {
  const contact = control.gripContact ?? Vector3.Zero();
  const rotation = Quaternion.FromEulerVector(hand.mesh.rotation);
  const matrix = Matrix.Compose(hand.mesh.scaling, rotation, Vector3.Zero());
  const palmOffset = Vector3.TransformCoordinates(contact, matrix);
  return target.subtract(palmOffset);
}

function localPointInRoot(root: TransformNode, node: AbstractMesh | TransformNode, point: Vector3): Vector3 {
  const world = Vector3.TransformCoordinates(point, node.computeWorldMatrix(true));
  const rootInverse = root.computeWorldMatrix(true).clone().invert();
  return Vector3.TransformCoordinates(world, rootInverse);
}

function meshExtents(node: AbstractMesh | TransformNode): Vector3 {
  if (node instanceof Mesh) return node.getBoundingInfo().boundingBox.extendSize.clone();
  return new Vector3(0.06, 0.18, 0.08);
}

function magazineOutOffset(weaponId: WeaponId): Vector3 {
  if (weaponId === "px9" || weaponId === "arc12") return new Vector3(-0.06, -0.36, -0.1);
  if (weaponId === "needle50") return new Vector3(-0.12, -0.34, -0.1);
  return new Vector3(-0.13, -0.42, -0.14);
}

function magazineInsertionOffset(weaponId: WeaponId): Vector3 {
  if (weaponId === "px9" || weaponId === "arc12") return new Vector3(-0.12, -0.46, -0.18);
  if (weaponId === "needle50") return new Vector3(-0.18, -0.44, -0.14);
  return new Vector3(-0.22, -0.58, -0.22);
}

function shellHandTarget(phase: number): Vector3 {
  const loadingPort = new Vector3(-0.065, -0.105, 0.35);
  const offscreen = new Vector3(-0.24, -0.42, 0.12);
  if (phase < 0.4) return loadingPort;
  if (phase < 0.58) return Vector3.Lerp(loadingPort, offscreen, ease((phase - 0.4) / 0.18));
  if (phase < 0.8) return Vector3.Lerp(offscreen, loadingPort, ease((phase - 0.58) / 0.22));
  return loadingPort;
}

function recoilProfile(weaponId: WeaponId): { rootY: number; rootZ: number; pitch: number; partZ: number; rackZ: number } {
  if (weaponId === "rift6") return { rootY: 0.03, rootZ: 0.105, pitch: 0.09, partZ: 0.018, rackZ: 0.035 };
  if (weaponId === "needle50") return { rootY: 0.034, rootZ: 0.115, pitch: 0.105, partZ: 0.012, rackZ: 0.06 };
  if (weaponId === "px9" || weaponId === "arc12") return { rootY: 0.02, rootZ: 0.068, pitch: 0.068, partZ: 0.05, rackZ: 0.048 };
  return { rootY: 0.022, rootZ: 0.075, pitch: 0.074, partZ: 0.026, rackZ: 0.048 };
}

function reloadTilt(phase: number): number {
  return smoothStepRange(phase, 0, 0.18) * (1 - smoothStepRange(phase, 0.9, 1));
}

function delayedCycle(now: number, startedAt: number, delayMs: number, durationMs: number): number {
  return clamp01((now - startedAt - delayMs) / durationMs);
}

function pumpTravel(cycle: number): number {
  if (cycle <= 0 || cycle >= 1) return 0;
  if (cycle < 0.45) return ease(cycle / 0.45);
  return 1 - ease((cycle - 0.45) / 0.55);
}

function boltTravel(cycle: number): number {
  if (cycle <= 0 || cycle >= 1) return 0;
  if (cycle < 0.18) return 0;
  if (cycle < 0.45) return ease((cycle - 0.18) / 0.27);
  return 1 - ease((cycle - 0.45) / 0.36);
}

function boltUnlock(cycle: number): number {
  if (cycle <= 0 || cycle >= 1) return 0;
  if (cycle < 0.18) return ease(cycle / 0.18);
  if (cycle < 0.72) return 1;
  return 1 - ease((cycle - 0.72) / 0.28);
}

function smoothPulse(value: number, start: number, end: number): number {
  const mid = (start + end) / 2;
  if (value < start || value > end) return 0;
  if (value < mid) return ease((value - start) / (mid - start));
  return 1 - ease((value - mid) / (end - mid));
}

function smoothStepRange(value: number, start: number, end: number): number {
  return ease((value - start) / (end - start));
}
