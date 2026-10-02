import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Game } from "../../src/game/Game";
import { MatchState } from "../../src/game/core/MatchState";
import { WeaponStateMachine } from "../../src/game/combat/WeaponStateMachine";
import { getWeaponConfig } from "../../src/game/combat/WeaponCatalog";
import { TEAM_SPAWNS } from "../../src/shared/game-data.mjs";
import type { TargetActor } from "../../src/game/world/createArena";
import type { RoomSnapshot } from "../../src/shared/protocol";

type GameHarness = {
  applyNetworkSnapshot(snapshot: RoomSnapshot): void;
  startSolo(): void;
};

function visualActor(index: number): TargetActor {
  const origin = new Vector3(index, 1, 0);
  const root = {
    position: origin.clone(),
    enabled: false,
    setEnabled(enabled: boolean) { this.enabled = enabled; },
  };
  return { root, origin, alive: true, health: 100, phase: 0 } as unknown as TargetActor;
}

function snapshot(botCount: number): RoomSnapshot {
  return {
    roomCode: "ABCDE", serverTime: 0, phase: "LIVE", phaseRemaining: 100, round: 1,
    attackingTeam: "alpha", defendingTeam: "bravo",
    bomb: { status: "carried", carrierId: "p1", planterId: null, defuserId: null, site: null, position: { x: TEAM_SPAWNS.alpha[0].x, y: 0, z: TEAM_SPAWNS.alpha[0].z }, progress: 0, remainingSeconds: 40 },
    lastRoundReason: null, alphaRounds: 0, bravoRounds: 0, alphaLossTier: 0, bravoLossTier: 0, rematchVotes: 0,
    players: [{
      id: "p1", name: "Player", team: "alpha", position: TEAM_SPAWNS.alpha[0], yaw: 0, pitch: 0,
      health: 100, armor: 0, helmet: false, hasDefuseKit: false, balance: 800, weaponId: "px9",
      primaryWeaponId: null, secondaryWeaponId: "px9", activeSlot: "secondary", magazine: 12, reserve: 48,
      reloading: false, alive: true, ready: true, connected: true,
    }],
    bots: Array.from({ length: botCount }, (_, index) => ({
      id: `bot-${index}`, team: index < 4 ? "alpha" as const : "bravo" as const,
      position: { x: index, y: 1, z: index + 1 }, health: 100, alive: true, weaponId: "px9" as const,
    })),
    drops: [],
  };
}

describe("network bot visuals", () => {
  it("creates all nine 5v5 bot models and hides extras when returning to solo", () => {
    const game = Object.create(Game.prototype) as GameHarness;
    const localActors = Array.from({ length: 4 }, (_, index) => visualActor(index));
    const extraActors: TargetActor[] = [];
    const created: number[] = [];
    Reflect.set(game, "targets", localActors);
    Reflect.set(game, "networkTargets", extraActors);
    Reflect.set(game, "makeNetworkTargetActor", (index: number) => {
      created.push(index);
      return visualActor(index);
    });
    Reflect.set(game, "scene", {});
    Reflect.set(game, "player", { camera: { position: new Vector3(TEAM_SPAWNS.alpha[0].x, TEAM_SPAWNS.alpha[0].y, TEAM_SPAWNS.alpha[0].z), rotation: { y: 0 } }, setEnabled: () => undefined });
    Reflect.set(game, "network", { playerId: "p1", roomCode: "ABCDE", disconnect: () => undefined });
    Reflect.set(game, "networkSnapshot", null);
    Reflect.set(game, "networkPhase", null);
    Reflect.set(game, "weapon", new WeaponStateMachine(getWeaponConfig("px9")));
    Reflect.set(game, "currentWeaponId", "px9");
    Reflect.set(game, "health", 100);
    Reflect.set(game, "running", true);
    Reflect.set(game, "promptedNetworkRound", 1);
    Reflect.set(game, "match", new MatchState());
    Reflect.set(game, "bots", []);
    Reflect.set(game, "networkBotShotMarkers", new Map<string, number>());
    Reflect.set(game, "syncBombMarker", () => undefined);
    Reflect.set(game, "emitSnapshot", () => undefined);

    game.applyNetworkSnapshot(snapshot(9));
    expect(created).toEqual([4, 5, 6, 7, 8]);
    expect(extraActors).toHaveLength(5);
    expect(Reflect.get(extraActors[4].root, "enabled")).toBe(true);
    expect(extraActors[4].root.position.z).toBe(9);

    game.applyNetworkSnapshot(snapshot(4));
    expect(extraActors.every((actor) => Reflect.get(actor.root, "enabled") === false)).toBe(true);

    game.startSolo();
    expect(localActors.filter((actor) => actor.alive)).toHaveLength(4);
    expect(extraActors.every((actor) => Reflect.get(actor.root, "enabled") === false)).toBe(true);
  });

  it("plays a network bot shot visual once per shot marker", () => {
    const game = Object.create(Game.prototype) as GameHarness;
    const localActors = [visualActor(0)];
    const shots: Array<{ from: Vector3; to: Vector3 }> = [];
    Reflect.set(game, "targets", localActors);
    Reflect.set(game, "networkTargets", []);
    Reflect.set(game, "scene", {});
    Reflect.set(game, "player", { camera: { position: new Vector3(0, 1.72, 0), rotation: { y: 0 } }, setEnabled: () => undefined });
    Reflect.set(game, "network", { playerId: "p1", roomCode: "ABCDE", disconnect: () => undefined });
    Reflect.set(game, "networkSnapshot", null);
    Reflect.set(game, "networkPhase", null);
    Reflect.set(game, "weapon", new WeaponStateMachine(getWeaponConfig("px9")));
    Reflect.set(game, "currentWeaponId", "px9");
    Reflect.set(game, "health", 100);
    Reflect.set(game, "armor", 0);
    Reflect.set(game, "helmet", false);
    Reflect.set(game, "running", true);
    Reflect.set(game, "promptedNetworkRound", 1);
    Reflect.set(game, "match", new MatchState());
    Reflect.set(game, "bots", []);
    Reflect.set(game, "networkBotShotMarkers", new Map<string, number>());
    Reflect.set(game, "syncBombMarker", () => undefined);
    Reflect.set(game, "emitSnapshot", () => undefined);
    Reflect.set(game, "botMuzzle", { flash: (_index: number, from: Vector3, to: Vector3) => shots.push({ from: from.clone(), to: to.clone() }) });

    const firstShot = snapshot(1);
    firstShot.bots[0].team = "bravo";
    firstShot.bots[0].lastShotAt = 1000;
    firstShot.bots[0].lastShotTarget = { x: 0, y: 1.72, z: 0 };
    game.applyNetworkSnapshot(firstShot);
    expect(shots).toHaveLength(1);
    expect(shots[0].to.y).toBeCloseTo(1.72);

    game.applyNetworkSnapshot(firstShot);
    expect(shots).toHaveLength(1);

    const nextShot = snapshot(1);
    nextShot.bots[0].team = "bravo";
    nextShot.bots[0].lastShotAt = 1080;
    nextShot.bots[0].lastShotTarget = { x: 0.2, y: 1.6, z: -0.4 };
    game.applyNetworkSnapshot(nextShot);
    expect(shots).toHaveLength(2);
    expect(shots[1].to.x).toBeCloseTo(0.2);
  });
});
