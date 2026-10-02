import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Game } from "../../src/game/Game";
import { MatchState } from "../../src/game/core/MatchState";
import { EconomySystem } from "../../src/game/economy/EconomySystem";
import { WeaponStateMachine } from "../../src/game/combat/WeaponStateMachine";
import { getWeaponConfig } from "../../src/game/combat/WeaponCatalog";
import { BotEconomy } from "../../src/game/economy/BotEconomy";
import { NetworkClient } from "../../src/network/NetworkClient";
import { BotController } from "../../src/game/ai/BotController";
import { NavigationService } from "../../src/game/ai/navigation/NavigationService";
import { ARENA_BOUNDS, BOMB_SITES, BOT_SPAWNS, TEAM_SPAWNS } from "../../src/shared/game-data.mjs";
import { App } from "../../src/app/App";
import type { GameSnapshot } from "../../src/game/Game";
import type { BombState } from "../../src/shared/protocol";

type SoloHarness = {
  beginInteraction(): void;
  dropCurrentWeapon(): void;
  dropBomb(): void;
  fire(): void;
  handleTransition(transition: { from: "ROUND_END"; to: "BUY"; round: number }): void;
  receiveBotFire(damage: number, botIndex: number): void;
  switchWeapon(slot: "primary" | "secondary"): void;
  buyItems(): Array<{ id: string; owned: boolean }>;
  purchase(itemId: "armor"): void;
  resetActors(): void;
  updateSoloBomb(deltaSeconds: number): void;
};

function cameraAt(position: { x: number; z: number }): Vector3 {
  return new Vector3(position.x, 1.72, position.z);
}

function bombAt(position: { x: number; z: number }): BombState["position"] {
  return { x: position.x, y: 0, z: position.z };
}

function createHarness(attacking: boolean, bomb: BombState, position: Vector3) {
  const game = Object.create(Game.prototype) as SoloHarness;
  const match = new MatchState();
  if (!attacking) match.round = 13;
  match.ready();
  const economy = new EconomySystem();
  const outcomes: Array<[boolean, string]> = [];
  Reflect.set(game, "match", match);
  Reflect.set(game, "economy", economy);
  Reflect.set(game, "soloBomb", bomb);
  Reflect.set(game, "player", { camera: { position, rotation: { y: 0 } } });
  Reflect.set(game, "bots", []);
  Reflect.set(game, "network", null);
  Reflect.set(game, "networkSnapshot", null);
  Reflect.set(game, "drops", {});
  Reflect.set(game, "currentWeaponId", "px9");
  Reflect.set(game, "weapon", new WeaponStateMachine(getWeaponConfig("px9")));
  Reflect.set(game, "health", 100);
  Reflect.set(game, "latestMotion", { moving: false, crouching: false });
  Reflect.set(game, "interactionHeld", false);
  Reflect.set(game, "syncBombMarker", () => undefined);
  Reflect.set(game, "emitSnapshot", () => undefined);
  Reflect.set(game, "finishRound", (won: boolean, reason: string) => outcomes.push([won, reason]));
  return { game, match, economy, outcomes };
}

describe("solo competitive defusal", () => {
  it("hides the dropped bomb on a defender radar until it is planted", () => {
    const app = Object.create(App.prototype) as { bombVisibleOnRadar(snapshot: Pick<GameSnapshot, "attacking" | "bomb">): boolean };
    const bomb: BombState = { status: "dropped", carrierId: null, planterId: null, defuserId: null, site: null, position: { x: -3, y: 0, z: 2 }, progress: 0, remainingSeconds: 40 };
    expect(app.bombVisibleOnRadar({ attacking: false, bomb })).toBe(false);
    expect(app.bombVisibleOnRadar({ attacking: true, bomb })).toBe(true);
    bomb.status = "planting";
    expect(app.bombVisibleOnRadar({ attacking: false, bomb })).toBe(false);
    bomb.status = "planted";
    expect(app.bombVisibleOnRadar({ attacking: false, bomb })).toBe(true);
  });

  it("uses Shift+G for C4 while G keeps the equipped weapon", () => {
    const bomb: BombState = { status: "carried", carrierId: "solo-player", planterId: null, defuserId: null, site: null, position: bombAt(TEAM_SPAWNS.alpha[0]), progress: 0, remainingSeconds: 40 };
    const { game } = createHarness(true, bomb, cameraAt(TEAM_SPAWNS.alpha[0]));
    game.dropCurrentWeapon();
    expect(bomb.status).toBe("carried");
    game.dropBomb();
    expect(bomb.status).toBe("dropped");
    expect(bomb.carrierId).toBeNull();
    game.beginInteraction();
    expect(bomb.status).toBe("carried");
    expect(bomb.carrierId).toBe("solo-player");
  });

  it("sends an explicit bomb drop to the multiplayer server", () => {
    const client = Object.create(NetworkClient.prototype) as NetworkClient;
    const sent: unknown[] = [];
    Reflect.set(client, "send", (message: unknown) => sent.push(message));
    client.sendDrop("bomb");
    client.sendDrop("weapon");
    expect(sent).toEqual([{ type: "drop", item: "bomb" }, { type: "drop", item: "weapon" }]);
  });

  it("plants after holding E at A and starts a full 40-second bomb clock", () => {
    const bomb: BombState = { status: "carried", carrierId: "solo-player", planterId: null, defuserId: null, site: null, position: bombAt(BOMB_SITES.A), progress: 0, remainingSeconds: 40 };
    const { game, match, economy } = createHarness(true, bomb, cameraAt(BOMB_SITES.A));
    game.beginInteraction();
    expect(bomb.status).toBe("planting");
    game.updateSoloBomb(3.2);
    expect(bomb.status).toBe("planted");
    expect(bomb.site).toBe("A");
    expect(bomb.remainingSeconds).toBe(40);
    expect(match.bombPlanted).toBe(true);
    expect(economy.balance).toBe(1_100);
  });

  it("cancels an unfinished plant when the carrier moves", () => {
    const bomb: BombState = { status: "carried", carrierId: "solo-player", planterId: null, defuserId: null, site: null, position: bombAt(BOMB_SITES.A), progress: 0, remainingSeconds: 40 };
    const { game, match, economy } = createHarness(true, bomb, cameraAt(BOMB_SITES.A));
    game.beginInteraction();
    Reflect.set(game, "latestMotion", { moving: true, crouching: false });
    game.updateSoloBomb(3.2);
    expect(bomb.status).toBe("carried");
    expect(bomb.planterId).toBeNull();
    expect(match.bombPlanted).toBe(false);
    expect(economy.balance).toBe(800);
  });

  it("cancels a pending reload when planting starts", () => {
    const bomb: BombState = { status: "carried", carrierId: "solo-player", planterId: null, defuserId: null, site: null, position: bombAt(BOMB_SITES.A), progress: 0, remainingSeconds: 40 };
    const { game } = createHarness(true, bomb, cameraAt(BOMB_SITES.A));
    const weapon = Reflect.get(game, "weapon") as WeaponStateMachine;
    weapon.magazine = 5;
    expect(weapon.beginReload(0)).toBe(true);
    let reloadIndicator: boolean | null = null;
    Reflect.set(game, "viewWeapon", { setReloading: (value: boolean) => { reloadIndicator = value; } });
    game.beginInteraction();
    expect(bomb.status).toBe("planting");
    expect(weapon.isReloading).toBe(false);
    expect(reloadIndicator).toBe(false);
  });

  it("cancels planting when switching weapon or dropping the equipped gun", () => {
    const bomb: BombState = { status: "carried", carrierId: "solo-player", planterId: null, defuserId: null, site: null, position: bombAt(BOMB_SITES.A), progress: 0, remainingSeconds: 40 };
    const { game } = createHarness(true, bomb, cameraAt(BOMB_SITES.A));
    const pistol = new WeaponStateMachine(getWeaponConfig("arc12"));
    const rifle = new WeaponStateMachine(getWeaponConfig("br4"));
    Reflect.set(game, "secondaryWeapon", pistol);
    Reflect.set(game, "secondaryWeaponId", "arc12");
    Reflect.set(game, "primaryWeapon", rifle);
    Reflect.set(game, "primaryWeaponId", "br4");
    Reflect.set(game, "weapon", pistol);
    Reflect.set(game, "currentWeaponId", "arc12");
    Reflect.set(game, "activeSlot", "secondary");
    Reflect.set(game, "drops", { drop: () => undefined });
    game.beginInteraction();
    game.switchWeapon("primary");
    expect(bomb.status).toBe("carried");
    expect(bomb.planterId).toBeNull();
    game.beginInteraction();
    game.dropCurrentWeapon();
    expect(bomb.status).toBe("carried");
    expect(bomb.planterId).toBeNull();
  });

  it("lets a defender with a kit defuse in five seconds", () => {
    const bomb: BombState = { status: "planted", carrierId: null, planterId: "bot-1", defuserId: null, site: "B", position: bombAt(BOMB_SITES.B), progress: 0, remainingSeconds: 40 };
    const { game, economy, outcomes } = createHarness(false, bomb, cameraAt(BOMB_SITES.B));
    economy.inventory.add("defuse-kit");
    game.beginInteraction();
    expect(bomb.status).toBe("defusing");
    game.updateSoloBomb(5);
    expect(bomb.status).toBe("defused");
    expect(outcomes).toEqual([[true, "defuse"]]);
    expect(economy.balance).toBe(1_100);
  });

  it("spawns solo attackers south and defenders north with both large-map sites usable", () => {
    expect(ARENA_BOUNDS.maxX - ARENA_BOUNDS.minX).toBeGreaterThan(70);
    expect(ARENA_BOUNDS.maxZ - ARENA_BOUNDS.minZ).toBeGreaterThan(90);
    expect(TEAM_SPAWNS.alpha[0].z).toBeLessThan(BOMB_SITES.A.z);
    expect(TEAM_SPAWNS.bravo[0].z).toBeGreaterThan(BOMB_SITES.B.z);

    const attackBomb: BombState = { status: "carried", carrierId: "solo-player", planterId: null, defuserId: null, site: null, position: bombAt(TEAM_SPAWNS.alpha[0]), progress: 0, remainingSeconds: 40 };
    const { game: attacker } = createHarness(true, attackBomb, cameraAt(TEAM_SPAWNS.bravo[0]));
    Reflect.set(attacker, "targets", []);
    attacker.resetActors();
    const attackerPosition = Reflect.get(attacker, "player").camera.position as Vector3;
    expect(attackerPosition.x).toBe(TEAM_SPAWNS.alpha[0].x);
    expect(attackerPosition.z).toBe(TEAM_SPAWNS.alpha[0].z);
    attackerPosition.copyFrom(cameraAt(BOMB_SITES.A));
    attacker.beginInteraction();
    attacker.updateSoloBomb(3.2);
    expect(attackBomb.status).toBe("planted");
    expect(attackBomb.site).toBe("A");

    const defendBomb: BombState = { status: "planted", carrierId: null, planterId: "bot-1", defuserId: null, site: "B", position: bombAt(BOMB_SITES.B), progress: 0, remainingSeconds: 40 };
    const { game: defender, outcomes } = createHarness(false, defendBomb, cameraAt(TEAM_SPAWNS.alpha[0]));
    Reflect.set(defender, "targets", []);
    defender.resetActors();
    const defenderPosition = Reflect.get(defender, "player").camera.position as Vector3;
    expect(defenderPosition.x).toBe(TEAM_SPAWNS.bravo[0].x);
    expect(defenderPosition.z).toBe(TEAM_SPAWNS.bravo[0].z);
    defenderPosition.copyFrom(cameraAt(BOMB_SITES.B));
    defender.beginInteraction();
    defender.updateSoloBomb(10);
    expect(defendBomb.status).toBe("defused");
    expect(outcomes).toEqual([[true, "defuse"]]);
  });

  it("awards the attacker an explosion when the bomb clock expires", () => {
    const bomb: BombState = { status: "planted", carrierId: null, planterId: "solo-player", defuserId: null, site: "A", position: bombAt(BOMB_SITES.A), progress: 0, remainingSeconds: 0.1 };
    const { game, outcomes } = createHarness(true, bomb, cameraAt(TEAM_SPAWNS.alpha[0]));
    game.updateSoloBomb(0.2);
    expect(bomb.status).toBe("exploded");
    expect(outcomes).toEqual([[true, "explosion"]]);
  });

  it("keeps a defusing bomb live after the attacking player dies", () => {
    const bomb: BombState = { status: "defusing", carrierId: null, planterId: "solo-player", defuserId: "bot-0", site: "A", position: bombAt(BOMB_SITES.A), progress: 0.2, remainingSeconds: 0.2 };
    const { game, outcomes } = createHarness(true, bomb, cameraAt(TEAM_SPAWNS.alpha[0]));
    Reflect.set(game, "running", true);
    Reflect.set(game, "health", 10);
    Reflect.set(game, "armor", 0);
    Reflect.set(game, "botEconomy", new BotEconomy());
    Reflect.set(game, "player", { camera: { position: cameraAt(TEAM_SPAWNS.alpha[0]) }, setEnabled: () => undefined });
    game.receiveBotFire(20, 0);
    expect(outcomes).toEqual([]);
    expect(bomb.status).toBe("defusing");
    game.updateSoloBomb(0.3);
    expect(outcomes).toEqual([[true, "explosion"]]);
  });

  it("routes the second-half bomb carrier from attack spawn to B with tactical fallback", () => {
    const origin = new Vector3(TEAM_SPAWNS.alpha[2].x, 1, TEAM_SPAWNS.alpha[2].z);
    const actor = { root: { position: origin.clone() }, origin, alive: true, health: 100, phase: 0 };
    const bot = new BotController({
      index: 1,
      actor: actor as unknown as ConstructorParameters<typeof BotController>[0]["actor"],
      scene: {} as ConstructorParameters<typeof BotController>[0]["scene"],
      navigation: new NavigationService(),
      onFire: () => undefined,
    });
    bot.setObjective(new Vector3(BOMB_SITES.B.x, 1, BOMB_SITES.B.z), "advance");
    let enteredAfterSeconds = 0;
    for (let frame = 0; frame < 1_000; frame += 1) {
      bot.update(0.05, frame * 50, cameraAt(TEAM_SPAWNS.bravo[2]), false);
      if (Math.hypot(actor.root.position.x - BOMB_SITES.B.x, actor.root.position.z - BOMB_SITES.B.z) < BOMB_SITES.B.radius) {
        enteredAfterSeconds = frame * 0.05;
        break;
      }
    }
    expect(enteredAfterSeconds).toBeGreaterThan(5);
    expect(enteredAfterSeconds).toBeLessThan(50);
  });

  it("includes solid cover in the hit ray before applying bot damage", () => {
    const bomb: BombState = { status: "carried", carrierId: "solo-player", planterId: null, defuserId: null, site: null, position: bombAt(TEAM_SPAWNS.alpha[0]), progress: 0, remainingSeconds: 40 };
    const { game } = createHarness(true, bomb, cameraAt(TEAM_SPAWNS.alpha[0]));
    const weapon = new WeaponStateMachine(getWeaponConfig("px9"));
    const target = { alive: true, health: 100 };
    let coverIncluded = false;
    Reflect.set(game, "weapon", weapon);
    Reflect.set(game, "targets", [target]);
    Reflect.set(game, "scene", {
      pickWithRay: (_ray: unknown, predicate: (mesh: { checkCollisions: boolean; metadata: Record<string, unknown> }) => boolean) => {
        coverIncluded = predicate({ checkCollisions: true, metadata: {} });
        return { hit: true, pickedMesh: { metadata: {} } };
      },
    });
    Reflect.set(game, "player", { camera: { position: cameraAt(TEAM_SPAWNS.alpha[0]), getForwardRay: () => ({ direction: new Vector3(0, 0, 1) }), getDirection: (axis: Vector3) => axis } });
    game.fire();
    expect(coverIncluded).toBe(true);
    expect(target.health).toBe(100);
    expect(weapon.magazine).toBe(11);
  });

  it("resets money, equipment, and spawn when sides switch for round 13", () => {
    const bomb: BombState = { status: "carried", carrierId: "solo-player", planterId: null, defuserId: null, site: null, position: bombAt(TEAM_SPAWNS.alpha[0]), progress: 0, remainingSeconds: 40 };
    const { game, match, economy } = createHarness(true, bomb, cameraAt(TEAM_SPAWNS.alpha[0]));
    const botEconomy = new BotEconomy();
    match.round = 13;
    match.phase = "BUY";
    economy.balance = 5_000;
    economy.inventory.add("br4");
    economy.inventory.add("defuse-kit");
    botEconomy.balance = 4_000;
    Reflect.set(game, "botEconomy", botEconomy);
    Reflect.set(game, "primaryWeaponId", "br4");
    Reflect.set(game, "secondaryWeaponId", "arc12");
    Reflect.set(game, "activeSlot", "primary");
    Reflect.set(game, "armor", 100);
    Reflect.set(game, "helmet", true);
    const targets = BOT_SPAWNS.map((spawn) => ({
      origin: new Vector3(spawn.x, spawn.y, spawn.z),
      root: { position: new Vector3(spawn.x, spawn.y, spawn.z), setEnabled: () => undefined },
      alive: true,
      health: 100,
    }));
    Reflect.set(game, "targets", targets);
    Reflect.set(game, "drops", { clear: () => undefined });
    game.handleTransition({ from: "ROUND_END", to: "BUY", round: 13 });
    expect(economy.balance).toBe(800);
    expect(economy.inventory.has("br4")).toBe(false);
    expect(economy.inventory.has("defuse-kit")).toBe(false);
    expect(botEconomy.balance).toBe(800);
    expect(Reflect.get(game, "currentWeaponId")).toBe("px9");
    expect(Reflect.get(game, "armor")).toBe(0);
    expect(Reflect.get(game, "helmet")).toBe(false);
    expect(Reflect.get(game, "player").camera.position.z).toBe(TEAM_SPAWNS.bravo[0].z);
    expect(targets[1].origin.z).toBe(TEAM_SPAWNS.alpha[2].z);
    expect(Math.hypot(targets[1].origin.x - BOMB_SITES.B.x, targets[1].origin.z - BOMB_SITES.B.z)).toBeGreaterThan(BOMB_SITES.B.radius);
  });

  it("offers armor repair in buy phase when armor is below 100", () => {
    const bomb: BombState = { status: "carried", carrierId: "bot-1", planterId: null, defuserId: null, site: null, position: bombAt(TEAM_SPAWNS.alpha[1]), progress: 0, remainingSeconds: 40 };
    const { game, match, economy } = createHarness(false, bomb, cameraAt(TEAM_SPAWNS.bravo[0]));
    match.phase = "BUY";
    economy.inventory.add("armor");
    Reflect.set(game, "armor", 45);
    Reflect.set(game, "purchaseSequence", 0);
    expect(game.buyItems().find((item) => item.id === "armor")?.owned).toBe(false);
    game.purchase("armor");
    expect(Reflect.get(game, "armor")).toBe(100);
    expect(economy.balance).toBe(150);
  });
});
