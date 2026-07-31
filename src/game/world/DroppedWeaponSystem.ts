import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
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
    const mesh = MeshBuilder.CreateBox(`dropped-${weaponId}-${instanceId}`, { width: 0.22, height: 0.12, depth: 0.75 }, this.scene);
    mesh.position.copyFrom(position);
    const rotationSeed = typeof instanceId === "number" ? instanceId : hashId(instanceId);
    mesh.rotation.set(0.15, rotationSeed * 0.9, Math.PI / 2);
    mesh.metadata = { droppedWeapon: true };
    const material = new StandardMaterial(`dropped-${weaponId}-material-${instanceId}`, this.scene);
    material.diffuseColor = config.slot === "primary" ? Color3.FromHexString("#b88b31") : Color3.FromHexString("#82978c");
    material.emissiveColor = Color3.FromHexString("#29230d");
    mesh.material = material;
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
    item.mesh.material?.dispose();
    item.mesh.dispose();
    return { weaponId: item.weaponId, magazine: item.magazine, reserve: item.reserve };
  }

  clear(): void {
    for (const item of this.items) {
      item.mesh.material?.dispose();
      item.mesh.dispose();
    }
    this.items.length = 0;
  }

  private dispose(instanceId: number | string): void {
    const index = this.items.findIndex((item) => item.instanceId === instanceId);
    if (index < 0) return;
    const [item] = this.items.splice(index, 1);
    item.mesh.material?.dispose();
    item.mesh.dispose();
  }

  get count(): number {
    return this.items.length;
  }
}

function hashId(value: string): number {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % 360;
}
