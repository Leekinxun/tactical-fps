export const PROTOCOL_VERSION: 5;
export const COMPETITIVE_RULES: Readonly<{
  teamSize: 5;
  maxPlayers: 10;
  buySeconds: 15;
  roundSeconds: 115;
  roundEndSeconds: 6;
  bombSeconds: 40;
  plantSeconds: 3.2;
  defuseSeconds: 10;
  kitDefuseSeconds: 5;
  halfRounds: 12;
  roundsToWin: 13;
}>;
export const ARENA_BOUNDS: Readonly<{
  minX: -64;
  maxX: 64;
  minZ: -72;
  maxZ: 72;
  playerPadding: 0.42;
  groundWidth: 128;
  groundDepth: 144;
}>;
export const BOMB_SITES: Readonly<Record<"A" | "B", Readonly<{ x: number; y: number; z: number; radius: number }>>>;
export const MAP_NAV_POINTS: readonly Readonly<{
  id: string;
  x: number;
  y: number;
  z: number;
  neighbors: readonly string[];
}>[];
export const MAP_ZONES: readonly Readonly<{
  id: string;
  label: string;
  x: number;
  z: number;
  width: number;
  depth: number;
}>[];

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
export const TEAM_SPAWNS: Readonly<Record<"alpha" | "bravo", readonly Readonly<{ x: number; y: number; z: number }>[]>>;
export const BOT_SPAWNS: readonly Readonly<{ x: number; y: number; z: number }>[];
export const ARENA_BOXES: readonly Readonly<{
  name: string;
  dimensions: readonly [number, number, number];
  position: readonly [number, number, number];
  material: "dark" | "rust" | "warning";
}>[];
