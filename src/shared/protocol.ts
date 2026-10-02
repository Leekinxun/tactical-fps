import type { WeaponId } from "../game/combat/WeaponCatalog";
export { PROTOCOL_VERSION } from "./game-data.mjs";

export interface NetworkVector3 {
  x: number;
  y: number;
  z: number;
}

export type TeamId = "alpha" | "bravo";
export type SiteId = "A" | "B";
export type WeaponSlot = "primary" | "secondary";

export interface BombState {
  status: "carried" | "dropped" | "planting" | "planted" | "defusing" | "defused" | "exploded";
  carrierId: string | null;
  planterId: string | null;
  defuserId: string | null;
  site: SiteId | null;
  position: NetworkVector3;
  progress: number;
  remainingSeconds: number;
}

export type ClientMessage =
  | { type: "hello"; protocolVersion: number; action: "create" | "join"; name: string; roomCode?: string; resumeToken?: string }
  | { type: "input"; sequence: number; position: NetworkVector3; yaw: number; pitch: number }
  | { type: "fire"; shotId: string; origin: NetworkVector3; direction: NetworkVector3; weaponId: WeaponId }
  | { type: "reload" }
  | { type: "drop"; item?: "weapon" | "bomb" }
  | { type: "pickup"; dropId: string }
  | { type: "buy"; itemId: WeaponId | "armor" | "helmet" | "defuse-kit" }
  | { type: "interact"; active: boolean }
  | { type: "switch_weapon"; slot: WeaponSlot }
  | { type: "ready" }
  | { type: "leave" }
  | { type: "rematch" }
  | { type: "ping"; clientTime: number };

export interface NetworkPlayerState {
  id: string;
  name: string;
  team: TeamId;
  position: NetworkVector3;
  yaw: number;
  pitch: number;
  health: number;
  armor: number;
  helmet: boolean;
  hasDefuseKit: boolean;
  balance: number;
  weaponId: WeaponId;
  primaryWeaponId: WeaponId | null;
  secondaryWeaponId: WeaponId;
  activeSlot: WeaponSlot;
  magazine: number;
  reserve: number;
  reloading: boolean;
  alive: boolean;
  ready: boolean;
  connected: boolean;
}

export interface NetworkBotState {
  id: string;
  team: TeamId;
  position: NetworkVector3;
  health: number;
  alive: boolean;
  weaponId: WeaponId;
  lastShotAt?: number;
  lastShotTarget?: NetworkVector3 | null;
}

export interface NetworkDroppedWeaponState {
  id: string;
  position: NetworkVector3;
  weaponId: WeaponId;
  magazine: number;
  reserve: number;
}

export interface RoomSnapshot {
  roomCode: string;
  serverTime: number;
  phase: "BUY" | "LIVE" | "ROUND_END" | "MATCH_END";
  phaseRemaining: number;
  round: number;
  attackingTeam: TeamId;
  defendingTeam: TeamId;
  bomb: BombState;
  lastRoundReason: string | null;
  alphaRounds: number;
  bravoRounds: number;
  alphaLossTier: number;
  bravoLossTier: number;
  rematchVotes: number;
  players: NetworkPlayerState[];
  bots: NetworkBotState[];
  drops: NetworkDroppedWeaponState[];
}

export type ServerMessage =
  | { type: "welcome"; protocolVersion: number; playerId: string; roomCode: string; resumeToken: string; resumed: boolean; team: TeamId }
  | { type: "snapshot"; snapshot: RoomSnapshot }
  | { type: "shot"; shooterId: string; weaponId: WeaponId }
  | { type: "event"; kind: "join" | "leave" | "hit" | "round" | "objective" | "purchase" | "reload" | "drop" | "pickup" | "rematch"; message: string }
  | { type: "pong"; clientTime: number; serverTime: number }
  | { type: "error"; code: string; message: string };

export function encodeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

export function parseServerMessage(data: string): ServerMessage | null {
  try {
    const value = JSON.parse(data) as { type?: unknown };
    if (!value || typeof value !== "object" || typeof value.type !== "string") return null;
    return value as ServerMessage;
  } catch {
    return null;
  }
}
