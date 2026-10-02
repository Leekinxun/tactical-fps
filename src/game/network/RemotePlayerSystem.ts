import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { NetworkPlayerState, TeamId } from "../../shared/protocol";
import { getWeaponConfig, type WeaponClass, type WeaponId } from "../combat/WeaponCatalog";
import { createOperatorRig, type OperatorRig } from "../characters/OperatorRig";

interface RemoteAvatar {
  root: Mesh;
  rig: OperatorRig;
  muzzleFlash: Mesh;
  muzzleSmoke: Mesh;
  muzzleLight: PointLight;
  targetPosition: Vector3;
  targetYaw: number;
  targetPitch: number;
  movementSpeed: number;
  crouching: boolean;
  weaponClass: WeaponClass;
  flashTime: number;
  smokeTime: number;
  lightStrength: number;
  shadow: ShadowGenerator | null;
}

export class RemotePlayerSystem {
  private readonly avatars = new Map<string, RemoteAvatar>();
  private readonly flashMaterial: StandardMaterial;
  private readonly smokeMaterial: StandardMaterial;

  constructor(private readonly scene: Scene) {
    this.flashMaterial = new StandardMaterial("remote-muzzle-flash", scene);
    this.flashMaterial.diffuseColor = Color3.FromHexString("#ffd36f");
    this.flashMaterial.emissiveColor = Color3.FromHexString("#ffab50");
    this.flashMaterial.disableLighting = true;
    this.flashMaterial.alpha = 0.95;
    this.smokeMaterial = new StandardMaterial("remote-muzzle-smoke", scene);
    this.smokeMaterial.diffuseColor = Color3.FromHexString("#9a958b");
    this.smokeMaterial.alpha = 0.2;
  }

  apply(players: NetworkPlayerState[], localPlayerId: string, localTeam: TeamId): void {
    const activeIds = new Set(players.filter((player) => player.id !== localPlayerId).map((player) => player.id));
    for (const player of players) {
      if (player.id === localPlayerId) continue;
      let avatar = this.avatars.get(player.id);
      if (!avatar) {
        avatar = this.createAvatar(player);
        this.avatars.set(player.id, avatar);
      }
      avatar.crouching = player.position.y < 1.45;
      avatar.targetPosition.set(player.position.x, Math.max(1, player.position.y - 0.72), player.position.z);
      avatar.targetYaw = player.yaw;
      avatar.targetPitch = player.pitch;
      avatar.weaponClass = getWeaponConfig(player.weaponId).weaponClass;
      if (avatar.rig.weaponId !== player.weaponId) avatar.rig.setWeapon(player.weaponId);
      avatar.rig.setTeam(player.team === localTeam);
      avatar.root.setEnabled(player.alive && player.connected);
      if (!player.alive || !player.connected) {
        avatar.flashTime = 0;
        avatar.smokeTime = 0;
        avatar.muzzleFlash.setEnabled(false);
        avatar.muzzleSmoke.setEnabled(false);
        avatar.muzzleLight.setEnabled(false);
      }
    }
    for (const [id, avatar] of this.avatars) {
      if (activeIds.has(id)) continue;
      disposeAvatar(avatar);
      this.avatars.delete(id);
    }
  }

  triggerMuzzleFlash(playerId: string, weaponId?: WeaponId): boolean {
    const avatar = this.avatars.get(playerId);
    if (!avatar || !avatar.root.isEnabled()) return false;
    if (weaponId) {
      avatar.weaponClass = getWeaponConfig(weaponId).weaponClass;
      avatar.rig.setWeapon(weaponId);
    }
    const profile = muzzleProfile(avatar.weaponClass);
    avatar.flashTime = profile.flash;
    avatar.smokeTime = profile.smoke;
    avatar.lightStrength = profile.light;
    avatar.muzzleFlash.scaling.setAll(profile.scale);
    avatar.muzzleFlash.setEnabled(true);
    avatar.muzzleSmoke.scaling.setAll(profile.scale * 0.6);
    avatar.muzzleSmoke.setEnabled(true);
    avatar.muzzleLight.intensity = profile.light;
    avatar.muzzleLight.setEnabled(true);
    avatar.rig.update(0, avatar.movementSpeed / 4.2, avatar.targetPitch, true, avatar.crouching);
    return true;
  }

  update(deltaSeconds: number): void {
    const dt = Math.max(0, deltaSeconds);
    const amount = Math.min(1, dt * 12);
    for (const avatar of this.avatars.values()) {
      const before = avatar.root.position.clone();
      Vector3.LerpToRef(avatar.root.position, avatar.targetPosition, amount, avatar.root.position);
      avatar.root.rotation.y += normalizeAngle(avatar.targetYaw - avatar.root.rotation.y) * amount;
      const speed = dt > 0 ? Math.min(7, Vector3.Distance(before, avatar.root.position) / dt) : 0;
      avatar.movementSpeed += (speed - avatar.movementSpeed) * amount;
      if (avatar.root.isEnabled()) avatar.rig.update(dt, avatar.movementSpeed / 4.2, avatar.targetPitch, false, avatar.crouching);
      avatar.flashTime = Math.max(0, avatar.flashTime - dt);
      avatar.smokeTime = Math.max(0, avatar.smokeTime - dt);
      const profile = muzzleProfile(avatar.weaponClass);
      avatar.muzzleFlash.setEnabled(avatar.flashTime > 0);
      avatar.muzzleSmoke.setEnabled(avatar.smokeTime > 0);
      avatar.muzzleLight.intensity = avatar.lightStrength * Math.min(1, avatar.flashTime / profile.flash);
      if (avatar.flashTime === 0) avatar.muzzleLight.setEnabled(false);
      if (avatar.smokeTime > 0) {
        const life = 1 - avatar.smokeTime / profile.smoke;
        avatar.muzzleSmoke.scaling.setAll(profile.scale * (0.6 + life));
        avatar.muzzleSmoke.position.y = life * 0.07;
      }
    }
  }

  clear(): void {
    for (const avatar of this.avatars.values()) disposeAvatar(avatar);
    this.avatars.clear();
  }

  private createAvatar(player: NetworkPlayerState): RemoteAvatar {
    const root = MeshBuilder.CreateCapsule(`remote-player-${player.id}`, { height: 1.8, radius: 0.42 }, this.scene);
    root.isVisible = false;
    root.isPickable = false;
    root.checkCollisions = false;
    root.position.set(player.position.x, Math.max(1, player.position.y - 0.72), player.position.z);
    root.rotation.y = player.yaw;
    const rig = createOperatorRig(this.scene, root, root.name);
    rig.root.scaling.setAll(0.8);
    rig.root.position.y = -0.2;
    rig.setWeapon(player.weaponId);
    const shadow = this.scene.getLightByName("service-door-daylight")?.getShadowGenerator() as ShadowGenerator | null;
    for (const mesh of rig.meshes) shadow?.addShadowCaster(mesh);
    const muzzleFlash = MeshBuilder.CreateCylinder(`${root.name}-muzzle-flash`, { height: 0.3, diameterTop: 0.02, diameterBottom: 0.19, tessellation: 7 }, this.scene);
    muzzleFlash.parent = rig.muzzle;
    muzzleFlash.rotation.x = Math.PI / 2;
    muzzleFlash.position.z = 0.13;
    muzzleFlash.material = this.flashMaterial;
    const muzzleSmoke = MeshBuilder.CreateSphere(`${root.name}-muzzle-smoke`, { diameter: 0.18, segments: 8 }, this.scene);
    muzzleSmoke.parent = rig.muzzle;
    muzzleSmoke.position.z = 0.24;
    muzzleSmoke.material = this.smokeMaterial;
    for (const mesh of [muzzleFlash, muzzleSmoke]) {
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      mesh.setEnabled(false);
    }
    const muzzleLight = new PointLight(`${root.name}-muzzle-light`, Vector3.Zero(), this.scene);
    muzzleLight.parent = rig.muzzle;
    muzzleLight.diffuse = Color3.FromHexString("#ffb25a");
    muzzleLight.range = 5.5;
    muzzleLight.intensity = 0;
    muzzleLight.setEnabled(false);
    return { root, rig, muzzleFlash, muzzleSmoke, muzzleLight, targetPosition: root.position.clone(), targetYaw: player.yaw, targetPitch: player.pitch,
      movementSpeed: 0,
      crouching: false, weaponClass: getWeaponConfig(player.weaponId).weaponClass, flashTime: 0, smokeTime: 0, lightStrength: 0, shadow };
  }
}

function muzzleProfile(weaponClass: WeaponClass): { flash: number; smoke: number; light: number; scale: number } {
  if (weaponClass === "sniper") return { flash: 0.064, smoke: 0.25, light: 2.6, scale: 1.26 };
  if (weaponClass === "shotgun") return { flash: 0.06, smoke: 0.28, light: 2.35, scale: 1.18 };
  if (weaponClass === "pistol") return { flash: 0.043, smoke: 0.14, light: 1.35, scale: 0.72 };
  if (weaponClass === "smg") return { flash: 0.044, smoke: 0.16, light: 1.6, scale: 0.82 };
  return { flash: 0.052, smoke: 0.18, light: 2.1, scale: 1 };
}

function disposeAvatar(avatar: RemoteAvatar): void {
  avatar.muzzleLight.dispose();
  for (const mesh of avatar.rig.meshes) avatar.shadow?.removeShadowCaster(mesh);
  avatar.rig.dispose();
  avatar.root.dispose(false, false);
}

function normalizeAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}
