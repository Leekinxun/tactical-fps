import { WEAPON_CATALOG as SHARED_WEAPON_CATALOG } from "../../shared/game-data.mjs";
import type { SharedWeaponConfig, WeaponClass, WeaponId, WeaponSlot } from "../../shared/game-data.mjs";

export type { WeaponClass, WeaponId, WeaponSlot };
export type WeaponConfig = SharedWeaponConfig;

export const WEAPON_CATALOG = SHARED_WEAPON_CATALOG;

export function getWeaponConfig(id: WeaponId): WeaponConfig {
  return WEAPON_CATALOG[id];
}
