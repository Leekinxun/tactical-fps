export const PROTOCOL_VERSION = 5;

export const COMPETITIVE_RULES = Object.freeze({
  teamSize: 5,
  maxPlayers: 10,
  buySeconds: 15,
  roundSeconds: 115,
  roundEndSeconds: 6,
  bombSeconds: 40,
  plantSeconds: 3.2,
  defuseSeconds: 10,
  kitDefuseSeconds: 5,
  halfRounds: 12,
  roundsToWin: 13,
});

export const ARENA_BOUNDS = Object.freeze({
  minX: -64,
  maxX: 64,
  minZ: -72,
  maxZ: 72,
  playerPadding: 0.42,
  groundWidth: 128,
  groundDepth: 144,
});

export const BOMB_SITES = Object.freeze({
  A: Object.freeze({ x: -40, y: 0, z: 22, radius: 5.5 }),
  B: Object.freeze({ x: 38, y: 0, z: 18, radius: 5.5 }),
});

export const WEAPON_CATALOG = Object.freeze({
  px9: { id: "px9", displayName: "PX-9 Service", weaponClass: "pistol", slot: "secondary", price: 0, killReward: 300, damage: 32, headMultiplier: 3.2, roundsPerMinute: 390, magazineSize: 12, reserveAmmo: 48, reloadMs: 1450, armorPenetration: 0.48, baseSpread: 0.006, movementSpread: 0.02 },
  arc12: { id: "arc12", displayName: "ARC-12", weaponClass: "pistol", slot: "secondary", price: 500, killReward: 300, damage: 38, headMultiplier: 3, roundsPerMinute: 330, magazineSize: 10, reserveAmmo: 40, reloadMs: 1600, armorPenetration: 0.56, baseSpread: 0.005, movementSpread: 0.018 },
  vx7: { id: "vx7", displayName: "VX-7 Compact", weaponClass: "smg", slot: "primary", price: 1250, killReward: 600, damage: 24, headMultiplier: 3.1, roundsPerMinute: 760, magazineSize: 30, reserveAmmo: 120, reloadMs: 2050, armorPenetration: 0.42, baseSpread: 0.012, movementSpread: 0.035 },
  rift6: { id: "rift6", displayName: "RIFT-6 Breacher", weaponClass: "shotgun", slot: "primary", price: 1600, killReward: 900, damage: 18, headMultiplier: 1.35, roundsPerMinute: 82, magazineSize: 6, reserveAmmo: 30, reloadMs: 2600, armorPenetration: 0.35, baseSpread: 0.055, movementSpread: 0.075, pellets: 8 },
  br4: { id: "br4", displayName: "BR-4 Carbine", weaponClass: "rifle", slot: "primary", price: 2700, killReward: 300, damage: 36, headMultiplier: 3.2, roundsPerMinute: 535, magazineSize: 24, reserveAmmo: 96, reloadMs: 1650, armorPenetration: 0.72, baseSpread: 0.007, movementSpread: 0.028 },
  needle50: { id: "needle50", displayName: "Needle .50", weaponClass: "sniper", slot: "primary", price: 4750, killReward: 100, damage: 112, headMultiplier: 2, roundsPerMinute: 42, magazineSize: 5, reserveAmmo: 20, reloadMs: 3100, armorPenetration: 0.96, baseSpread: 0.001, movementSpread: 0.09 },
});

export const PLAYER_SPAWNS = Object.freeze([
  Object.freeze({ x: -8, y: 1.72, z: -61 }),
  Object.freeze({ x: -4, y: 1.72, z: -63 }),
  Object.freeze({ x: 0, y: 1.72, z: -61 }),
  Object.freeze({ x: 4, y: 1.72, z: -63 }),
  Object.freeze({ x: 8, y: 1.72, z: -61 }),
]);

export const TEAM_SPAWNS = Object.freeze({
  alpha: PLAYER_SPAWNS,
  bravo: Object.freeze([
    Object.freeze({ x: -8, y: 1.72, z: 57 }),
    Object.freeze({ x: -4, y: 1.72, z: 59 }),
    Object.freeze({ x: 0, y: 1.72, z: 57 }),
    Object.freeze({ x: 4, y: 1.72, z: 59 }),
    Object.freeze({ x: 8, y: 1.72, z: 57 }),
  ]),
});

export const BOT_SPAWNS = Object.freeze([
  Object.freeze({ x: -40, y: 1, z: 34 }),
  Object.freeze({ x: 38, y: 1, z: 30 }),
  Object.freeze({ x: -10, y: 1, z: 54 }),
  Object.freeze({ x: 11, y: 1, z: 54 }),
]);

export const ARENA_BOXES = Object.freeze([
  { name: "north-wall", dimensions: [130, 5, 1], position: [0, 2.5, 72.5], material: "dark" },
  { name: "south-wall", dimensions: [130, 5, 1], position: [0, 2.5, -72.5], material: "dark" },
  { name: "west-wall", dimensions: [1, 5, 146], position: [-64.5, 2.5, 0], material: "dark" },
  { name: "east-wall", dimensions: [1, 5, 146], position: [64.5, 2.5, 0], material: "dark" },
  { name: "west-south-divider", dimensions: [12, 7.2, 28], position: [-24, 3.6, -36], material: "dark" },
  { name: "west-center-divider", dimensions: [12, 7.2, 26], position: [-24, 3.6, 3], material: "dark" },
  { name: "west-north-divider", dimensions: [12, 7.2, 16], position: [-24, 3.6, 44], material: "dark" },
  { name: "east-south-divider", dimensions: [10, 7.2, 30], position: [22, 3.6, -38], material: "dark" },
  { name: "east-center-divider", dimensions: [10, 7.2, 24], position: [22, 3.6, 1], material: "dark" },
  { name: "east-north-divider", dimensions: [10, 7.2, 18], position: [22, 3.6, 45], material: "dark" },
  { name: "mid-south-baffle", dimensions: [18, 7.4, 10], position: [0, 3.7, -34], material: "rust" },
  { name: "mid-north-baffle", dimensions: [12, 7.4, 10], position: [1, 3.7, 44], material: "rust" },
  { name: "cover-mid-transformer", dimensions: [4, 3.2, 4], position: [0, 1.6, 2], material: "warning" },
  { name: "cover-a-reactor-west", dimensions: [4, 3.4, 8], position: [-52, 1.7, 22], material: "warning" },
  { name: "cover-a-reactor-south", dimensions: [6, 2.8, 3], position: [-56, 1.4, 13], material: "rust" },
  { name: "cover-a-reactor-east", dimensions: [4, 3.2, 5], position: [-31, 1.6, 30], material: "dark" },
  { name: "cover-west-container-south", dimensions: [5, 3.2, 10], position: [-55, 1.6, -42], material: "rust" },
  { name: "cover-west-equipment-mid", dimensions: [5, 3.2, 6], position: [-56, 1.6, -2], material: "dark" },
  { name: "cover-west-container-north", dimensions: [5, 3.2, 8], position: [-52, 1.6, 46], material: "warning" },
  { name: "cover-east-loader-south", dimensions: [5, 3.2, 8], position: [53, 1.6, -38], material: "rust" },
  { name: "cover-east-pipe-mid", dimensions: [5, 3.2, 6], position: [54, 1.6, 8], material: "dark" },
  { name: "cover-east-crate-north", dimensions: [5, 3.2, 8], position: [54, 1.6, 48], material: "warning" },
  { name: "warehouse-south-left", dimensions: [10, 6, 2], position: [36, 3, -4], material: "dark" },
  { name: "warehouse-south-right", dimensions: [5, 6, 2], position: [54.5, 3, -4], material: "dark" },
  { name: "warehouse-north-left", dimensions: [7, 6, 2], position: [34.5, 3, 32], material: "dark" },
  { name: "warehouse-north-right", dimensions: [11, 6, 2], position: [51.5, 3, 32], material: "dark" },
  { name: "warehouse-west-south", dimensions: [2, 6, 12], position: [31, 3, 2], material: "dark" },
  { name: "warehouse-west-north", dimensions: [2, 6, 8], position: [31, 3, 28], material: "dark" },
  { name: "warehouse-east", dimensions: [2, 6, 36], position: [57, 3, 14], material: "dark" },
  { name: "cover-b-forklift", dimensions: [4, 2.8, 6], position: [50, 1.4, 20], material: "warning" },
  { name: "cover-a-low-crate", dimensions: [3.5, 1.5, 2.5], position: [-39.5, 0.75, 14], material: "warning" },
  { name: "cover-b-low-crate", dimensions: [3, 1.5, 3], position: [43, 0.75, 24], material: "warning" },
  { name: "cover-b-pallets", dimensions: [5, 2.4, 4], position: [37, 1.2, 8], material: "rust" },
]);

const tacticalNodes = [
  ["T", 0, -61], ["TL", -22, -56], ["TR", 24, -56],
  ["W0", -43, -50], ["W1", -48, -32], ["W2", -34, -18], ["W3", -48, 8],
  ["A", -40, 22], ["W4", -42, 38], ["W5", -40, 54], ["CW", -24, 58],
  ["ML0", -10, -45], ["ML0B", -10, -28], ["ML1", -10, -16], ["ML2", -10, 8],
  ["ML3", -10, 26], ["ML4", -10, 38], ["ML5", -10, 54],
  ["MR0", 11, -45], ["MR0B", 11, -28], ["MR1", 11, -16], ["MR2", 11, 8],
  ["MR3", 11, 24], ["MR4", 11, 38], ["MR5", 11, 54],
  ["E0", 40, -46], ["E1", 48, -28], ["E2", 34, -17], ["E3", 48, 0],
  ["B", 38, 18], ["E4", 42, 36], ["E5", 40, 54], ["CE", 24, 58], ["CT", 0, 57],
];

const tacticalEdges = [
  ["T", "TL"], ["TL", "W0"], ["W0", "W1"], ["W1", "W2"], ["W2", "W3"],
  ["W3", "A"], ["A", "W4"], ["W4", "W5"], ["W5", "CW"], ["CW", "CT"],
  ["T", "TR"], ["TR", "E0"], ["E0", "E1"], ["E1", "E2"], ["E2", "E3"],
  ["E3", "B"], ["B", "E4"], ["E4", "E5"], ["E5", "CE"], ["CE", "CT"],
  ["T", "ML0"], ["ML0", "ML0B"], ["ML0B", "ML1"], ["ML1", "ML2"],
  ["ML2", "ML3"], ["ML3", "ML4"], ["ML4", "ML5"], ["ML5", "CT"],
  ["T", "MR0"], ["MR0", "MR0B"], ["MR0B", "MR1"], ["MR1", "MR2"],
  ["MR2", "MR3"], ["MR3", "MR4"], ["MR4", "MR5"], ["MR5", "CT"],
  ["W2", "ML1"], ["ML1", "MR1"], ["MR1", "E2"],
  ["A", "ML3"], ["W5", "ML5"], ["ML3", "MR3"], ["MR3", "B"], ["MR5", "CE"],
];

export const MAP_NAV_POINTS = Object.freeze(tacticalNodes.map(([id, x, z]) => Object.freeze({
  id,
  x,
  y: 0,
  z,
  neighbors: Object.freeze(tacticalEdges.flatMap(([a, b]) => a === id ? [b] : b === id ? [a] : [])),
})));

export const MAP_ZONES = Object.freeze([
  Object.freeze({ id: "a-reactor-yard", label: "A开放反应堆场", x: -40, z: 22, width: 28, depth: 28 }),
  Object.freeze({ id: "b-loading-hall", label: "B装卸大厅", x: 44, z: 16, width: 26, depth: 36 }),
  Object.freeze({ id: "b-warehouse-yard", label: "B仓库外场", x: 42, z: -16, width: 34, depth: 28 }),
  Object.freeze({ id: "a-long", label: "A长通", x: -48, z: -18, width: 24, depth: 72 }),
  Object.freeze({ id: "ab-connector", label: "A-B连接道", x: 0, z: 26, width: 32, depth: 30 }),
  Object.freeze({ id: "boiler-connector", label: "锅炉连廊", x: -14, z: 6, width: 20, depth: 70 }),
  Object.freeze({ id: "central-equipment", label: "中央设备区", x: 6, z: 4, width: 34, depth: 80 }),
  Object.freeze({ id: "attacker-staging", label: "进攻方集结区", x: 0, z: -60, width: 44, depth: 20 }),
  Object.freeze({ id: "defender-backfield", label: "防守方后场", x: 0, z: 58, width: 54, depth: 22 }),
]);
