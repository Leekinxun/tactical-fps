import { describe, expect, it, vi } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Game } from "../../src/game/Game";
import { MatchState } from "../../src/game/core/MatchState";
import { WeaponStateMachine } from "../../src/game/combat/WeaponStateMachine";
import { getWeaponConfig, type WeaponId } from "../../src/game/combat/WeaponCatalog";
import { TEAM_SPAWNS } from "../../src/shared/game-data.mjs";
import type { RoomSnapshot, WeaponSlot } from "../../src/shared/protocol";

type NetworkSwitchHarness = {
  switchWeapon(slot: WeaponSlot): void;
  fire(): void;
  applyNetworkSnapshot(snapshot: RoomSnapshot): void;
};

function snapshot(weaponId: WeaponId, activeSlot: WeaponSlot, primaryWeaponId: WeaponId | null): RoomSnapshot {
  return {
    roomCode: "ABCDE",
    serverTime: 1_000,
    phase: "LIVE",
    phaseRemaining: 100,
    round: 2,
    attackingTeam: "alpha",
    defendingTeam: "bravo",
    bomb: { status: "carried", carrierId: "p1", planterId: null, defuserId: null, site: null, position: { x: TEAM_SPAWNS.alpha[0].x, y: 0, z: TEAM_SPAWNS.alpha[0].z }, progress: 0, remainingSeconds: 40 },
    lastRoundReason: null,
    alphaRounds: 0,
    bravoRounds: 0,
    alphaLossTier: 0,
    bravoLossTier: 0,
    rematchVotes: 0,
    players: [{
      id: "p1",
      name: "Player",
      team: "alpha",
      position: TEAM_SPAWNS.alpha[0],
      yaw: 0,
      pitch: 0,
      health: 100,
      armor: 0,
      helmet: false,
      hasDefuseKit: false,
      balance: 800,
      weaponId,
      primaryWeaponId,
      secondaryWeaponId: "px9",
      activeSlot,
      magazine: getWeaponConfig(weaponId).magazineSize,
      reserve: getWeaponConfig(weaponId).reserveAmmo,
      reloading: false,
      alive: true,
      ready: true,
      connected: true,
    }],
    bots: [],
    drops: [],
  };
}

function harness(initial: RoomSnapshot) {
  const game = Object.create(Game.prototype) as NetworkSwitchHarness;
  const switches: WeaponSlot[] = [];
  const fires: Array<{ weaponId: WeaponId }> = [];
  const camera = {
    position: new Vector3(TEAM_SPAWNS.alpha[0].x, TEAM_SPAWNS.alpha[0].y, TEAM_SPAWNS.alpha[0].z),
    rotation: { y: 0 },
    getForwardRay: () => ({ direction: Vector3.Forward() }),
    getDirection: (direction: Vector3) => direction.clone(),
  };
  Reflect.set(game, "scene", {});
  Reflect.set(game, "player", { camera, setEnabled: () => undefined });
  Reflect.set(game, "network", {
    playerId: "p1",
    roomCode: "ABCDE",
    sendSwitchWeapon: (slot: WeaponSlot) => switches.push(slot),
    sendFire: (_shotId: string, _origin: unknown, _direction: unknown, weaponId: WeaponId) => fires.push({ weaponId }),
  });
  Reflect.set(game, "networkSnapshot", initial);
  Reflect.set(game, "networkPhase", initial.phase);
  Reflect.set(game, "match", new MatchState());
  Reflect.set(game, "weapon", new WeaponStateMachine(getWeaponConfig(initial.players[0].weaponId)));
  Reflect.set(game, "currentWeaponId", initial.players[0].weaponId);
  Reflect.set(game, "latestMotion", { moving: false, crouching: false });
  Reflect.set(game, "interactionHeld", false);
  Reflect.set(game, "networkReloadRequested", false);
  Reflect.set(game, "pendingNetworkWeaponSlot", null);
  Reflect.set(game, "health", 100);
  Reflect.set(game, "armor", 0);
  Reflect.set(game, "helmet", false);
  Reflect.set(game, "running", true);
  Reflect.set(game, "promptedNetworkRound", initial.round);
  Reflect.set(game, "targets", []);
  Reflect.set(game, "networkTargets", []);
  Reflect.set(game, "networkBotShotMarkers", new Map<string, number>());
  Reflect.set(game, "viewWeapon", { fire: vi.fn(), setWeapon: vi.fn(), setReloading: vi.fn(), update: vi.fn() });
  Reflect.set(game, "remotePlayers", { apply: vi.fn(), update: vi.fn() });
  Reflect.set(game, "drops", { syncNetwork: vi.fn() });
  Reflect.set(game, "syncBombMarker", vi.fn());
  Reflect.set(game, "emitSnapshot", vi.fn());
  return { game, switches, fires };
}

describe("network weapon switch firing", () => {
  it("does not fire the old weapon while waiting for switch confirmation", () => {
    const { game, switches, fires } = harness(snapshot("px9", "secondary", "br4"));

    game.switchWeapon("primary");
    game.fire();

    expect(switches).toEqual(["primary"]);
    expect(fires).toEqual([]);

    const confirmed = snapshot("br4", "primary", "br4");
    confirmed.serverTime = 1_050;
    game.applyNetworkSnapshot(confirmed);
    game.fire();

    expect(fires).toEqual([{ weaponId: "br4" }]);
  });

  it("does not enter a pending switch for an empty network weapon slot", () => {
    const { game, switches, fires } = harness(snapshot("px9", "secondary", null));

    game.switchWeapon("primary");
    game.fire();

    expect(switches).toEqual([]);
    expect(fires).toEqual([{ weaponId: "px9" }]);
  });
});
