import type { WeaponId } from "../game/combat/WeaponCatalog";
export { PROTOCOL_VERSION } from "./game-data.mjs";

export interface NetworkVector3 {
  x: number;
  y: number;
  z: number;
}

export type ClientMessage =
  | { type: "hello"; protocolVersion: number; action: "create" | "join"; name: string; roomCode?: string; resumeToken?: string }
  | { type: "input"; sequence: number; position: NetworkVector3; yaw: number; pitch: number }
  | { type: "fire"; shotId: string; origin: NetworkVector3; direction: NetworkVector3; weaponId: WeaponId }
  | { type: "reload" }
  | { type: "drop" }
  | { type: "pickup"; dropId: string }
  | { type: "buy"; itemId: WeaponId | "armor" | "helmet" }
  | { type: "ready" }
  | { type: "rematch" }
  | { type: "ping"; clientTime: number };

export interface NetworkPlayerState {
  id: string;
  name: string;
  position: NetworkVector3;
  yaw: number;
  pitch: number;
  health: number;
  armor: number;
  helmet: boolean;
  balance: number;
  weaponId: WeaponId;
  magazine: number;
  reserve: number;
  reloading: boolean;
  alive: boolean;
  ready: boolean;
  connected: boolean;
}

export interface NetworkBotState {
  id: string;
  position: NetworkVector3;
  health: number;
  alive: boolean;
  weaponId: WeaponId;
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
  playerRounds: number;
  botRounds: number;
  rematchVotes: number;
  players: NetworkPlayerState[];
  bots: NetworkBotState[];
  drops: NetworkDroppedWeaponState[];
}

export type ServerMessage =
  | { type: "welcome"; protocolVersion: number; playerId: string; roomCode: string; resumeToken: string; resumed: boolean }
  | { type: "snapshot"; snapshot: RoomSnapshot }
  | { type: "event"; kind: "join" | "leave" | "hit" | "round" | "purchase" | "reload" | "drop" | "pickup" | "rematch"; message: string }
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
