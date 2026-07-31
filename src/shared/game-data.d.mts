export const PROTOCOL_VERSION: 2;

export type WeaponId = "px9" | "arc12" | "vx7" | "rift6" | "br4" | "needle50";
export type WeaponSlot = "secondary" | "primary";
export type WeaponClass = "pistol" | "smg" | "shotgun" | "rifle" | "sniper";

export interface SharedWeaponConfig {
  id: WeaponId;
  displayName: string;
  weaponClass: WeaponClass;
  slot: WeaponSlot;
  price: number;
  killReward: number;
  damage: number;
  headMultiplier: number;
  roundsPerMinute: number;
  magazineSize: number;
  reserveAmmo: number;
  reloadMs: number;
  armorPenetration: number;
  baseSpread: number;
  movementSpread: number;
  pellets?: number;
}

export const WEAPON_CATALOG: Readonly<Record<WeaponId, Readonly<SharedWeaponConfig>>>;
export const PLAYER_SPAWNS: readonly Readonly<{ x: number; y: number; z: number }>[];
export const BOT_SPAWNS: readonly Readonly<{ x: number; y: number; z: number }>[];
export const ARENA_BOXES: readonly Readonly<{
  name: string;
  dimensions: readonly [number, number, number];
  position: readonly [number, number, number];
  material: "dark" | "rust" | "warning";
}>[];
