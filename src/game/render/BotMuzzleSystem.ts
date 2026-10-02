import { Ray } from "@babylonjs/core/Culling/ray";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { getWeaponConfig, type WeaponClass, type WeaponId } from "../combat/WeaponCatalog";

interface BurstMaterials {
  flash: StandardMaterial;
  smoke: StandardMaterial;
  tracer: StandardMaterial;
  impact: StandardMaterial;
}

interface BotMuzzleBurst {
  flash: Mesh;
  smoke: Mesh;
  tracer: Mesh;
  impact: Mesh;
  light: PointLight;
  materials: BurstMaterials;
  age: number;
  flashSeconds: number;
  smokeSeconds: number;
  tracerSeconds: number;
  impactSeconds: number;
  lightIntensity: number;
  impactHit: boolean;
  active: boolean;
}

interface MuzzleProfile {
  flashSeconds: number;
  smokeSeconds: number;
  tracerSeconds: number;
  impactSeconds: number;
  flashScale: number;
  smokeScale: number;
  lightIntensity: number;
  lightRange: number;
  tracerLength: number;
  tracerRadius: number;
}

const UP = new Vector3(0, 1, 0);
const RIGHT = new Vector3(1, 0, 0);
const MUZZLE_HEIGHT = 0.58;
const MUZZLE_FORWARD = 0.5;
const MUZZLE_SIDE = 0.14;
const MAX_RAY_LENGTH = 24;

export class BotMuzzleSystem {
  private readonly bursts = new Map<number, BotMuzzleBurst>();

  constructor(private readonly scene: Scene) {}

  flash(index: number, actorPosition: Vector3, targetPosition: Vector3, weaponId: WeaponId, muzzlePosition?: Vector3): boolean {
    const aim = targetPosition.subtract(actorPosition);
    if (aim.lengthSquared() < 0.0001) return false;

    const actorDirection = aim.normalize();
    const side = rightVector(actorDirection);
    const muzzle = muzzlePosition?.clone() ?? actorPosition
      .add(new Vector3(0, MUZZLE_HEIGHT, 0))
      .add(actorDirection.scale(MUZZLE_FORWARD))
      .add(side.scale(MUZZLE_SIDE));
    const direction = targetPosition.subtract(muzzle).normalize();
    const profile = muzzleProfile(getWeaponConfig(weaponId).weaponClass);
    const { point: impact, hit: impactHit } = this.pickImpact(muzzle, targetPosition, direction);
    const tracerDistance = Math.max(0.35, Vector3.Distance(muzzle, impact));
    const tracerEnd = muzzle.add(direction.scale(Math.min(tracerDistance, profile.tracerLength)));
    const burst = this.getBurst(index);

    burst.age = 0;
    burst.active = true;
    burst.flashSeconds = profile.flashSeconds;
    burst.smokeSeconds = profile.smokeSeconds;
    burst.tracerSeconds = profile.tracerSeconds;
    burst.impactSeconds = profile.impactSeconds;
    burst.lightIntensity = profile.lightIntensity;
    burst.impactHit = impactHit;

    placeAlongDirection(burst.flash, muzzle.add(direction.scale(0.08)), direction, profile.flashScale * 0.9, profile.flashScale * 0.34);
    burst.flash.rotation.z = ((index * 47) % 360) * (Math.PI / 180);
    burst.flash.setEnabled(true);

    burst.smoke.position.copyFrom(muzzle.add(direction.scale(0.2)));
    burst.smoke.scaling.setAll(profile.smokeScale * 0.34);
    burst.smoke.setEnabled(true);

    placeBetween(burst.tracer, muzzle, tracerEnd, profile.tracerRadius);
    burst.tracer.setEnabled(true);

    burst.impact.position.copyFrom(impact);
    burst.impact.scaling.setAll(profile.flashScale * 0.34);
    burst.impact.setEnabled(impactHit);

    burst.light.position.copyFrom(muzzle);
    burst.light.range = profile.lightRange;
    burst.light.intensity = profile.lightIntensity;
    burst.light.setEnabled(true);
    setMaterialAlpha(burst.materials, 1);
    return true;
  }

  update(deltaSeconds: number): void {
    const delta = Math.max(0, deltaSeconds);
    for (const burst of this.bursts.values()) {
      if (!burst.active) continue;
      burst.age += delta;
      const flashFade = fade(burst.age, burst.flashSeconds);
      const smokeFade = fade(burst.age, burst.smokeSeconds);
      const tracerFade = fade(burst.age, burst.tracerSeconds);
      const impactFade = fade(burst.age, burst.impactSeconds);

      burst.flash.setEnabled(flashFade > 0);
      burst.tracer.setEnabled(tracerFade > 0);
      burst.impact.setEnabled(burst.impactHit && impactFade > 0);
      burst.smoke.setEnabled(smokeFade > 0);
      burst.light.intensity = burst.lightIntensity * flashFade;
      if (flashFade <= 0) burst.light.setEnabled(false);
      burst.materials.flash.alpha = 0.95 * flashFade;
      burst.materials.tracer.alpha = 0.82 * tracerFade;
      burst.materials.impact.alpha = 0.86 * impactFade;
      burst.materials.smoke.alpha = 0.24 * smokeFade;

      if (smokeFade > 0) {
        const smokeGrowth = 1 + (1 - smokeFade) * 1.4;
        burst.smoke.scaling.x *= 1 + delta * 0.8;
        burst.smoke.scaling.y *= 1 + delta * 0.6 * smokeGrowth;
        burst.smoke.scaling.z *= 1 + delta * 0.9;
      }
      if (flashFade <= 0 && smokeFade <= 0 && tracerFade <= 0 && impactFade <= 0) burst.active = false;
    }
  }

  clear(): void {
    for (const burst of this.bursts.values()) disposeBurst(burst);
    this.bursts.clear();
  }

  private getBurst(index: number): BotMuzzleBurst {
    const existing = this.bursts.get(index);
    if (existing) return existing;
    const burst = createBurst(this.scene, index);
    this.bursts.set(index, burst);
    return burst;
  }

  private pickImpact(muzzle: Vector3, targetPosition: Vector3, direction: Vector3): { point: Vector3; hit: boolean } {
    const rayLength = Math.min(MAX_RAY_LENGTH, Math.max(4, Vector3.Distance(muzzle, targetPosition) + 0.8));
    const pick = this.scene.pickWithRay(new Ray(muzzle, direction, rayLength), (mesh) => mesh.checkCollisions === true);
    if (pick?.hit && pick.pickedPoint) return { point: pick.pickedPoint.clone(), hit: true };
    return { point: muzzle.add(direction.scale(rayLength)), hit: false };
  }
}

function createBurst(scene: Scene, index: number): BotMuzzleBurst {
  const materials = createMaterials(scene, index);
  const flash = MeshBuilder.CreateCylinder(`bot-${index}-muzzle-flash`, { height: 1, diameterTop: 0.03, diameterBottom: 0.28, tessellation: 7 }, scene);
  const smoke = MeshBuilder.CreateSphere(`bot-${index}-muzzle-smoke`, { diameter: 1, segments: 8 }, scene);
  const tracer = MeshBuilder.CreateCylinder(`bot-${index}-muzzle-tracer`, { height: 1, diameter: 1, tessellation: 6 }, scene);
  const impact = MeshBuilder.CreateSphere(`bot-${index}-impact-spark`, { diameter: 1, segments: 6 }, scene);
  const light = new PointLight(`bot-${index}-muzzle-light`, Vector3.Zero(), scene);

  flash.material = materials.flash;
  smoke.material = materials.smoke;
  tracer.material = materials.tracer;
  impact.material = materials.impact;
  light.diffuse = Color3.FromHexString("#ffb05a");
  light.specular = Color3.FromHexString("#ffd8a5");
  light.intensity = 0;
  light.range = 4.6;
  light.setEnabled(false);

  for (const mesh of [flash, smoke, tracer, impact]) {
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.rotationQuaternion = Quaternion.Identity();
    mesh.setEnabled(false);
  }

  return {
    flash,
    smoke,
    tracer,
    impact,
    light,
    materials,
    age: 0,
    flashSeconds: 0,
    smokeSeconds: 0,
    tracerSeconds: 0,
    impactSeconds: 0,
    lightIntensity: 0,
    impactHit: false,
    active: false,
  };
}

function createMaterials(scene: Scene, index: number): BurstMaterials {
  const flash = new StandardMaterial(`bot-${index}-muzzle-flash-material`, scene);
  flash.diffuseColor = Color3.FromHexString("#ffd36f");
  flash.emissiveColor = Color3.FromHexString("#ff8f35");
  flash.alpha = 0.95;

  const smoke = new StandardMaterial(`bot-${index}-muzzle-smoke-material`, scene);
  smoke.diffuseColor = Color3.FromHexString("#928d84");
  smoke.emissiveColor = Color3.FromHexString("#2d2a26").scale(0.05);
  smoke.alpha = 0.24;

  const tracer = new StandardMaterial(`bot-${index}-muzzle-tracer-material`, scene);
  tracer.diffuseColor = Color3.FromHexString("#ffe7a2");
  tracer.emissiveColor = Color3.FromHexString("#ffbf57").scale(1.35);
  tracer.alpha = 0.82;

  const impact = new StandardMaterial(`bot-${index}-impact-spark-material`, scene);
  impact.diffuseColor = Color3.FromHexString("#fff2c0");
  impact.emissiveColor = Color3.FromHexString("#ff9a36");
  impact.alpha = 0.86;

  return { flash, smoke, tracer, impact };
}

function muzzleProfile(weaponClass: WeaponClass): MuzzleProfile {
  if (weaponClass === "sniper") return profile(0.064, 0.28, 0.09, 0.13, 1.24, 1.22, 2.7, 5.9, 17.5, 0.017);
  if (weaponClass === "shotgun") return profile(0.06, 0.32, 0.08, 0.14, 1.3, 1.45, 2.55, 5.6, 11, 0.019);
  if (weaponClass === "pistol") return profile(0.043, 0.16, 0.055, 0.09, 0.72, 0.76, 1.35, 4.2, 8.5, 0.011);
  if (weaponClass === "smg") return profile(0.044, 0.18, 0.06, 0.1, 0.82, 0.86, 1.55, 4.4, 10.5, 0.012);
  return profile(0.052, 0.22, 0.072, 0.12, 1, 1, 2.15, 5.1, 13.5, 0.014);
}

function profile(
  flashSeconds: number,
  smokeSeconds: number,
  tracerSeconds: number,
  impactSeconds: number,
  flashScale: number,
  smokeScale: number,
  lightIntensity: number,
  lightRange: number,
  tracerLength: number,
  tracerRadius: number,
): MuzzleProfile {
  return { flashSeconds, smokeSeconds, tracerSeconds, impactSeconds, flashScale, smokeScale, lightIntensity, lightRange, tracerLength, tracerRadius };
}

function placeAlongDirection(mesh: Mesh, position: Vector3, direction: Vector3, length: number, radius: number): void {
  mesh.position.copyFrom(position);
  Quaternion.FromUnitVectorsToRef(UP, direction, mesh.rotationQuaternion!);
  mesh.scaling.set(radius, length, radius);
}

function placeBetween(mesh: Mesh, from: Vector3, to: Vector3, radius: number): void {
  const delta = to.subtract(from);
  const length = Math.max(0.001, delta.length());
  const direction = delta.scale(1 / length);
  mesh.position.copyFrom(from.add(to).scale(0.5));
  Quaternion.FromUnitVectorsToRef(UP, direction, mesh.rotationQuaternion!);
  mesh.scaling.set(radius, length, radius);
}

function rightVector(direction: Vector3): Vector3 {
  const side = Vector3.Cross(UP, direction);
  if (side.lengthSquared() < 0.0001) return RIGHT.clone();
  return side.normalize();
}

function fade(age: number, duration: number): number {
  if (duration <= 0 || age >= duration) return 0;
  return Math.max(0, 1 - age / duration);
}

function setMaterialAlpha(materials: BurstMaterials, alpha: number): void {
  materials.flash.alpha = 0.95 * alpha;
  materials.smoke.alpha = 0.24 * alpha;
  materials.tracer.alpha = 0.82 * alpha;
  materials.impact.alpha = 0.86 * alpha;
}

function disposeBurst(burst: BotMuzzleBurst): void {
  burst.light.dispose();
  for (const mesh of [burst.flash, burst.smoke, burst.tracer, burst.impact]) mesh.dispose();
  for (const material of Object.values(burst.materials)) material.dispose();
}
