export const PROTOCOL_VERSION = 2;

export const WEAPON_CATALOG = Object.freeze({
  px9: { id: "px9", displayName: "PX-9 Service", weaponClass: "pistol", slot: "secondary", price: 0, killReward: 300, damage: 32, headMultiplier: 3.2, roundsPerMinute: 390, magazineSize: 12, reserveAmmo: 48, reloadMs: 1450, armorPenetration: 0.48, baseSpread: 0.006, movementSpread: 0.02 },
  arc12: { id: "arc12", displayName: "ARC-12", weaponClass: "pistol", slot: "secondary", price: 500, killReward: 300, damage: 38, headMultiplier: 3, roundsPerMinute: 330, magazineSize: 10, reserveAmmo: 40, reloadMs: 1600, armorPenetration: 0.56, baseSpread: 0.005, movementSpread: 0.018 },
  vx7: { id: "vx7", displayName: "VX-7 Compact", weaponClass: "smg", slot: "primary", price: 1250, killReward: 600, damage: 24, headMultiplier: 3.1, roundsPerMinute: 760, magazineSize: 30, reserveAmmo: 120, reloadMs: 2050, armorPenetration: 0.42, baseSpread: 0.012, movementSpread: 0.035 },
  rift6: { id: "rift6", displayName: "RIFT-6 Breacher", weaponClass: "shotgun", slot: "primary", price: 1600, killReward: 900, damage: 18, headMultiplier: 1.35, roundsPerMinute: 82, magazineSize: 6, reserveAmmo: 30, reloadMs: 2600, armorPenetration: 0.35, baseSpread: 0.055, movementSpread: 0.075, pellets: 8 },
  br4: { id: "br4", displayName: "BR-4 Carbine", weaponClass: "rifle", slot: "primary", price: 2700, killReward: 300, damage: 36, headMultiplier: 3.2, roundsPerMinute: 535, magazineSize: 24, reserveAmmo: 96, reloadMs: 1650, armorPenetration: 0.72, baseSpread: 0.007, movementSpread: 0.028 },
  needle50: { id: "needle50", displayName: "Needle .50", weaponClass: "sniper", slot: "primary", price: 4750, killReward: 100, damage: 112, headMultiplier: 2, roundsPerMinute: 42, magazineSize: 5, reserveAmmo: 20, reloadMs: 3100, armorPenetration: 0.96, baseSpread: 0.001, movementSpread: 0.09 },
});

export const PLAYER_SPAWNS = Object.freeze([
  Object.freeze({ x: 0, y: 1.72, z: -14 }),
  Object.freeze({ x: -2, y: 1.72, z: -14 }),
  Object.freeze({ x: 2, y: 1.72, z: -14 }),
  Object.freeze({ x: 0, y: 1.72, z: -16 }),
]);

export const BOT_SPAWNS = Object.freeze([
  Object.freeze({ x: -3.6, y: 1, z: 1 }),
  Object.freeze({ x: 12.5, y: 1, z: 4 }),
  Object.freeze({ x: -13.5, y: 1, z: 18 }),
  Object.freeze({ x: 2.5, y: 4.8, z: 17 }),
]);

export const ARENA_BOXES = Object.freeze([
  { name: "north-wall", dimensions: [42, 5, 1], position: [0, 2.5, 25.5], material: "dark" },
  { name: "south-wall", dimensions: [42, 5, 1], position: [0, 2.5, -25.5], material: "dark" },
  { name: "west-wall", dimensions: [1, 5, 52], position: [-20.5, 2.5, 0], material: "dark" },
  { name: "east-wall", dimensions: [1, 5, 52], position: [20.5, 2.5, 0], material: "dark" },
  { name: "left-lane", dimensions: [1, 4, 30], position: [-7.2, 2, -1], material: "dark" },
  { name: "right-lane", dimensions: [1, 4, 30], position: [7.2, 2, 3], material: "dark" },
  { name: "left-break", dimensions: [1.2, 4, 5], position: [-7.2, 2, 18], material: "rust" },
  { name: "right-break", dimensions: [1.2, 4, 6], position: [7.2, 2, -17], material: "rust" },
  { name: "cover-a", dimensions: [4.6, 1.8, 1.8], position: [-3.4, 0.9, -5], material: "rust" },
  { name: "cover-b", dimensions: [3, 2.4, 2.2], position: [3.8, 1.2, 6], material: "warning" },
  { name: "cover-c", dimensions: [4, 1.4, 2.4], position: [-13, 0.7, 11], material: "rust" },
  { name: "cover-d", dimensions: [3.8, 2, 1.8], position: [13, 1, -9], material: "warning" },
  { name: "bridge", dimensions: [12, 0.6, 4], position: [0, 3.8, 17], material: "dark" },
  { name: "bridge-left", dimensions: [1, 3.8, 4], position: [-5.5, 1.9, 17], material: "rust" },
  { name: "bridge-right", dimensions: [1, 3.8, 4], position: [5.5, 1.9, 17], material: "rust" },
]);
