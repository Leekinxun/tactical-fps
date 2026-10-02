import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { getWeaponConfig, type WeaponId } from "../combat/WeaponCatalog";
import type { NetworkDroppedWeaponState } from "../../shared/protocol";

export interface DroppedWeapon {
  instanceId: number | string;
  weaponId: WeaponId;
  magazine: number;
  reserve: number;
  mesh: Mesh;
}

export interface PickupResult {
  weaponId: WeaponId;
  magazine: number;
  reserve: number;
}

export class DroppedWeaponSystem {
  private readonly scene: Scene;
  private readonly items: DroppedWeapon[] = [];
  private nextInstanceId = 1;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  drop(weaponId: WeaponId, magazine: number, reserve: number, position: Vector3): DroppedWeapon | null {
    if (weaponId === "px9") return null;
    return this.create(this.nextInstanceId++, weaponId, magazine, reserve, position.add(new Vector3(0, 0.16, 0)));
  }

  syncNetwork(states: NetworkDroppedWeaponState[]): void {
    const activeIds = new Set(states.map((state) => state.id));
    for (const item of [...this.items]) {
      if (typeof item.instanceId === "string" && !activeIds.has(item.instanceId)) this.dispose(item.instanceId);
    }
    for (const state of states) {
      const existing = this.items.find((item) => item.instanceId === state.id);
      if (existing) {
        existing.mesh.position.set(state.position.x, state.position.y, state.position.z);
        continue;
      }
      this.create(state.id, state.weaponId, state.magazine, state.reserve, new Vector3(state.position.x, state.position.y, state.position.z));
    }
  }

  private create(instanceId: number | string, weaponId: WeaponId, magazine: number, reserve: number, position: Vector3): DroppedWeapon {
    const config = getWeaponConfig(weaponId);
    const pistol = config.weaponClass === "pistol";
    const mesh = MeshBuilder.CreateBox(`dropped-${weaponId}-${instanceId}`, pistol
      ? { width: 0.15, height: 0.1, depth: 0.42 }
      : { width: 0.2, height: 0.14, depth: 0.44 }, this.scene);
    mesh.position.copyFrom(position);
    const rotationSeed = typeof instanceId === "number" ? instanceId : hashId(instanceId);
    mesh.rotation.set(0.07, rotationSeed * 0.9, Math.PI / 2);
    if (!pistol) mesh.scaling.z = config.weaponClass === "smg" ? 0.82 : config.weaponClass === "sniper" ? 1.18 : 1;
    mesh.metadata = { droppedWeapon: true };
    mesh.checkCollisions = false;
    mesh.isPickable = false;
    const prefix = mesh.name;
    const metal = pbr(this.scene, `${prefix}-metal`, "#353b3b", 0.48, 0.56);
    const polymer = pbr(this.scene, `${prefix}-polymer`, "#1d2321", 0.86, 0.04);
    const detail = pbr(this.scene, `${prefix}-detail`, "#726b5b", 0.62, 0.28);
    mesh.material = metal;
    if (pistol) {
      gunBox(this.scene, mesh, "frame", [0.13, 0.075, 0.31], [0, -0.08, -0.035], polymer);
      const grip = gunBox(this.scene, mesh, "grip", [0.115, 0.27, 0.13], [0, -0.22, -0.12], polymer);
      grip.rotation.x = -0.17;
      gunBox(this.scene, mesh, "ejection-port", [0.009, 0.035, 0.1], [0.08, 0.045, 0.015], detail);
      gunBox(this.scene, mesh, "rear-sight", [0.055, 0.025, 0.025], [0, 0.065, -0.16], metal);
      gunBox(this.scene, mesh, "front-sight", [0.045, 0.025, 0.025], [0, 0.065, 0.18], metal);
      gunCylinder(this.scene, mesh, "barrel", 0.12, 0.045, [0, 0.005, 0.24], metal);
    } else {
      gunBox(this.scene, mesh, "stock", [0.15, 0.12, 0.36], [0, -0.015, -0.38], polymer);
      gunBox(this.scene, mesh, "butt-pad", [0.17, 0.17, 0.04], [0, -0.015, -0.56], polymer);
      gunBox(this.scene, mesh, "handguard", [0.16, 0.12, 0.4], [0, 0, 0.38], polymer);
      gunBox(this.scene, mesh, "top-rail", [0.075, 0.035, 0.66], [0, 0.105, 0.16], metal);
      gunBox(this.scene, mesh, "sight", [0.075, 0.075, 0.1], [0, 0.17, 0.03], detail);
      const grip = gunBox(this.scene, mesh, "grip", [0.12, 0.27, 0.14], [0, -0.2, -0.1], polymer);
      grip.rotation.x = -0.18;
      gunBox(this.scene, mesh, "magazine", [0.13, 0.26, 0.15], [0, -0.2, 0.16], polymer);
      gunCylinder(this.scene, mesh, "barrel", 0.52, 0.048, [0, 0, 0.7], metal);
      gunCylinder(this.scene, mesh, "muzzle", 0.1, 0.075, [0, 0, 0.97], detail);
    }
    const item = {
      instanceId,
      weaponId,
      magazine: Math.max(0, Math.min(config.magazineSize, magazine)),
      reserve: Math.max(0, Math.min(config.reserveAmmo, reserve)),
      mesh,
    };
    this.items.push(item);
    return item;
  }

  nearest(position: Vector3, radius = 1.8): DroppedWeapon | null {
    let nearest: DroppedWeapon | null = null;
    let nearestDistance = radius * radius;
    for (const item of this.items) {
      const distance = Vector3.DistanceSquared(position, item.mesh.position);
      if (distance <= nearestDistance) {
        nearest = item;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  pickup(instanceId: number | string): PickupResult | null {
    const index = this.items.findIndex((item) => item.instanceId === instanceId);
    if (index < 0) return null;
    const [item] = this.items.splice(index, 1);
    disposeGun(item.mesh);
    return { weaponId: item.weaponId, magazine: item.magazine, reserve: item.reserve };
  }

  clear(): void {
    for (const item of this.items) disposeGun(item.mesh);
    this.items.length = 0;
  }

  private dispose(instanceId: number | string): void {
    const index = this.items.findIndex((item) => item.instanceId === instanceId);
    if (index < 0) return;
    const [item] = this.items.splice(index, 1);
    disposeGun(item.mesh);
  }

  get count(): number {
    return this.items.length;
  }
}

function pbr(scene: Scene, name: string, hex: string, roughness: number, metallic: number): PBRMaterial {
  const material = new PBRMaterial(name, scene);
  material.albedoColor = Color3.FromHexString(hex);
  material.roughness = roughness;
  material.metallic = metallic;
  material.environmentIntensity = 0.7;
  return material;
}

function gunBox(scene: Scene, root: Mesh, name: string, size: [number, number, number], position: [number, number, number], material: PBRMaterial): Mesh {
  const mesh = MeshBuilder.CreateBox(`${root.name}-${name}`, { width: size[0], height: size[1], depth: size[2] }, scene);
  mesh.parent = root;
  mesh.position.set(...position);
  mesh.material = material;
  mesh.checkCollisions = false;
  mesh.isPickable = false;
  return mesh;
}

function gunCylinder(scene: Scene, root: Mesh, name: string, height: number, diameter: number, position: [number, number, number], material: PBRMaterial): void {
  const mesh = MeshBuilder.CreateCylinder(`${root.name}-${name}`, { height, diameter, tessellation: 12 }, scene);
  mesh.parent = root;
  mesh.position.set(...position);
  mesh.rotation.x = Math.PI / 2;
  mesh.material = material;
  mesh.checkCollisions = false;
  mesh.isPickable = false;
}

function disposeGun(root: Mesh): void {
  const materials = new Set([root, ...root.getChildMeshes(false)].map((mesh) => mesh.material));
  root.dispose();
  for (const material of materials) material?.dispose();
}

function hashId(value: string): number {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % 360;
}
