import { describe, expect, it } from "vitest";
import { ARENA_BOUNDS, ARENA_BOXES, BOMB_SITES, COMPETITIVE_RULES, TEAM_SPAWNS } from "../../src/shared/game-data.mjs";
// @ts-expect-error Server module intentionally runs as native Node ESM.
import { RoomState } from "../../server/room-state.mjs";

interface TestBot {
  id: string;
  slot: number;
  team: "alpha" | "bravo";
  weaponId: string;
  position: { x: number; y: number; z: number };
  health: number;
  alive: boolean;
  nextShotAt: number;
  lastShotAt?: number;
  lastShotTarget?: { x: number; y: number; z: number } | null;
}

describe("authoritative RoomState", () => {
  it("caps rooms at ten players with five on each team", () => {
    const room = new RoomState("ABCDE", 0);
    const players = Array.from({ length: 10 }, (_, index) => room.addPlayer(`Player ${index + 1}`, 0));
    expect(players.every(Boolean)).toBe(true);
    expect(players.filter((player) => player?.team === "alpha")).toHaveLength(5);
    expect(players.filter((player) => player?.team === "bravo")).toHaveLength(5);
    expect(room.addPlayer("Eleven", 0)).toBeNull();
  });

  it("balances players across mixed squads and keeps at least one bot per team", () => {
    const room = new RoomState("ABCDE", 0);
    const players = [room.addPlayer("One", 0)!, room.addPlayer("Two", 0)!, room.addPlayer("Three", 0)!, room.addPlayer("Four", 0)!];
    expect(players.map((player) => player.team)).toEqual(["alpha", "bravo", "alpha", "bravo"]);
    expect(room.bots.filter((bot: TestBot) => bot.team === "alpha")).toHaveLength(3);
    expect(room.bots.filter((bot: TestBot) => bot.team === "bravo")).toHaveLength(3);
    expect(room.snapshot(0).players.every((player: { team?: string }) => player.team === "alpha" || player.team === "bravo")).toBe(true);
  });

  it("starts a solo-created room with two five-member squads", () => {
    const room = new RoomState("ABCDE", 0);
    room.addPlayer("One", 0)!;
    expect(room.bots.filter((bot: TestBot) => bot.team === "alpha")).toHaveLength(4);
    expect(room.bots.filter((bot: TestBot) => bot.team === "bravo")).toHaveLength(5);
  });

  it("routes five attackers and five defenders from spawn to both bomb sites within a round", () => {
    // Keep the 115s simulated round deadline; allow CPU time for both ten-bot squads.
    for (const site of Object.values(BOMB_SITES)) {
      const room = new RoomState("ROUTE", 0);
      room.rebalanceBots(true);
      expect(room.bots).toHaveLength(10);
      expect(room.bots.filter((bot: TestBot) => bot.team === "alpha").map((bot: TestBot) => [bot.position.x, bot.position.z]))
        .toEqual(TEAM_SPAWNS.alpha.map((spawn) => [spawn.x, spawn.z]));
      expect(room.bots.filter((bot: TestBot) => bot.team === "bravo").map((bot: TestBot) => [bot.position.x, bot.position.z]))
        .toEqual(TEAM_SPAWNS.bravo.map((spawn) => [spawn.x, spawn.z]));
      room.phase = "LIVE";
      room.bomb.status = "defused";
      room.botObjective = () => site;
      for (const bot of room.bots) bot.nextShotAt = Infinity;
      for (let step = 1; step <= COMPETITIVE_RULES.roundSeconds * 5; step += 1) {
        room.updateBots(0.2, step * 200);
        if (room.bots.every((bot: TestBot) => Math.hypot(bot.position.x - site.x, bot.position.z - site.z) <= site.radius)) break;
      }
      const stuck = room.bots.filter((bot: TestBot) => Math.hypot(bot.position.x - site.x, bot.position.z - site.z) > site.radius)
        .map((bot: TestBot) => ({ id: bot.id, position: bot.position }));
      expect(stuck).toEqual([]);
    }
  }, 15_000);

  it("queues players who join a live round without replacing active bots", () => {
    const room = new RoomState("ABCDE", 0);
    room.addPlayer("One", 0)!;
    room.beginLive();
    const botIds = room.bots.map((bot: TestBot) => bot.id);
    const latePlayer = room.addPlayer("Late", 100)!;
    expect(latePlayer).toMatchObject({ alive: false, health: 0, team: "bravo" });
    expect(room.bots.map((bot: TestBot) => bot.id)).toEqual(botIds);
    room.phase = "ROUND_END";
    room.beginNextRound(1_000);
    expect(latePlayer).toMatchObject({ alive: true, health: 100 });
    expect(room.bots.filter((bot: TestBot) => bot.team === "alpha")).toHaveLength(4);
    expect(room.bots.filter((bot: TestBot) => bot.team === "bravo")).toHaveLength(4);
  });

  it("rejects primary weapons during round one without charging", () => {
    const room = new RoomState("ABCDE", 0);
    const player = room.addPlayer("One", 0)!;
    expect(room.purchase(player.id, "br4")).toMatchObject({ ok: false });
    expect(room.players.get(player.id).balance).toBe(800);
  });

  it("rejects impossible movement and accepts bounded input", () => {
    const room = new RoomState("ABCDE", 0);
    const player = room.addPlayer("One", 0)!;
    room.beginLive();
    expect(room.applyInput(player.id, { sequence: 1, position: { x: 18, y: 1.72, z: 18 }, yaw: 0, pitch: 0 }, 50)).toBe(false);
    expect(room.applyInput(player.id, { sequence: 2, position: { ...player.position, x: player.position.x + 0.2 }, yaw: 0.1, pitch: 0 }, 100)).toBe(true);
    player.position = { x: ARENA_BOUNDS.maxX - ARENA_BOUNDS.playerPadding - 0.1, y: 1.72, z: -40 };
    expect(room.applyInput(player.id, { sequence: 3, position: { ...player.position, x: ARENA_BOUNDS.maxX - ARENA_BOUNDS.playerPadding + 0.1 }, yaw: 0, pitch: 0 }, 150)).toBe(false);
  });

  it("marks rapid legal micro-moves as moving for authoritative shot spread", () => {
    const room = new RoomState("ABCDE", 0);
    const player = room.addPlayer("One", 0)!;
    room.beginLive();
    const startX = player.position.x;
    for (let sequence = 1; sequence <= 100; sequence += 1) {
      const now = sequence * 6;
      expect(room.applyInput(player.id, {
        sequence,
        position: { x: startX + sequence * 0.02, y: 1.72, z: player.position.z },
        yaw: 0,
        pitch: 0,
      }, now)).toBe(true);
      if (sequence === 2) expect(player.movingUntil).toBeGreaterThan(now);
    }
    expect(player.position.x).toBeCloseTo(startX + 2);
    expect(player.movingUntil).toBeGreaterThan(600);
    const movingUntil = player.movingUntil;
    expect(room.applyInput(player.id, { sequence: 101, position: { ...player.position }, yaw: 0, pitch: 0 }, 700)).toBe(true);
    expect(player.movingUntil).toBe(movingUntil);
  });

  it("rejects movement through arena collision geometry", () => {
    const room = new RoomState("ABCDE", 0);
    const player = room.addPlayer("One", 0)!;
    room.beginLive();
    const wall = wallFixture("west-center-divider");
    player.position = wall.west;
    expect(room.applyInput(player.id, { sequence: 1, position: wall.insideWestFace, yaw: 0, pitch: 0 }, 100)).toBe(false);
  });

  it("rejects swept movement that crosses a wall even when the endpoint is clear", () => {
    const room = new RoomState("ABCDE", 0);
    const player = room.addPlayer("One", 0)!;
    room.beginLive();
    const wall = wallFixture("west-center-divider");
    player.position = wall.west;
    expect(room.applyInput(player.id, { sequence: 1, position: wall.east, yaw: 0, pitch: 0 }, 250)).toBe(false);
  });

  it("blocks shots when cover is closer than the target", () => {
    const room = new RoomState("ABCDE", 0);
    const player = room.addPlayer("One", 0)!;
    room.beginLive();
    const wall = wallFixture("west-center-divider");
    const targetBot = room.bots.find((bot: TestBot) => bot.team !== player.team)!;
    player.position = wall.west;
    targetBot.position = { x: wall.east.x, y: 1, z: wall.east.z };
    const result = room.fire(player.id, {
      shotId: "wall-test",
      weaponId: "px9",
      origin: { ...player.position },
      direction: { x: 1, y: 0, z: 0 },
    }, 1_000);
    expect(result).toMatchObject({ ok: true, hit: false });
    expect(targetBot.health).toBe(100);
  });

  it("authoritatively preserves ammo when dropping and picking up", () => {
    const room = new RoomState("ABCDE", 0);
    const player = room.addPlayer("One", 0)!;
    room.beginLive();
    player.weaponId = "br4";
    player.magazine = 7;
    player.reserve = 41;
    expect(room.dropWeapon(player.id)).toMatchObject({ ok: true });
    const [dropped] = [...room.drops.values()];
    expect(dropped).toMatchObject({ weaponId: "br4", magazine: 7, reserve: 41 });
    expect(player).toMatchObject({ weaponId: "px9", magazine: 12, reserve: 48 });
    expect(room.pickupWeapon(player.id, dropped.id)).toMatchObject({ ok: true });
    expect(player).toMatchObject({ weaponId: "br4", magazine: 7, reserve: 41 });
    expect(room.drops.size).toBe(0);
  });

  it("allows only one player to win a simultaneous pickup", () => {
    const room = new RoomState("ABCDE", 0);
    const first = room.addPlayer("One", 0)!;
    const second = room.addPlayer("Two", 0)!;
    room.beginLive();
    const dropped = room.createDrop("vx7", 19, 70, { ...first.position });
    expect(room.pickupWeapon(first.id, dropped.id)).toMatchObject({ ok: true });
    expect(room.pickupWeapon(second.id, dropped.id)).toMatchObject({ ok: false });
    expect(first.weaponId).toBe("vx7");
    expect(second.weaponId).toBe("px9");
  });

  it("tracks magazine use and completes reloads on server time", () => {
    const room = new RoomState("ABCDE", 0);
    const player = room.addPlayer("One", 0)!;
    room.beginLive();
    player.magazine = 1;
    expect(room.fire(player.id, { shotId: "last-round", weaponId: "px9", origin: { ...player.position }, direction: { x: 0, y: 0, z: -1 } }, 100)).toMatchObject({ ok: true });
    expect(player.magazine).toBe(0);
    expect(room.fire(player.id, { shotId: "empty", weaponId: "px9", origin: { ...player.position }, direction: { x: 0, y: 0, z: -1 } }, 1_000)).toMatchObject({ ok: false });
    expect(room.reload(player.id, 1_000)).toMatchObject({ ok: true });
    expect(room.snapshot(1_000).players[0].reloading).toBe(true);
    expect(room.completeReload(player, 2_449)).toBe(false);
    expect(room.completeReload(player, 2_450)).toBe(true);
    expect(player).toMatchObject({ magazine: 12, reserve: 36 });
  });

  it("creates a server-owned drop when an armed bot is eliminated", () => {
    const room = new RoomState("ABCDE", 0);
    const player = room.addPlayer("One", 0)!;
    room.beginLive();
    const targetBot = room.bots.find((bot: TestBot) => bot.team !== player.team)!;
    targetBot.weaponId = "vx7";
    targetBot.position = { x: player.position.x, y: 1, z: player.position.z + 5 };
    targetBot.health = 32;
    expect(room.fire(player.id, { shotId: "bot-kill", weaponId: "px9", origin: { ...player.position }, direction: { x: 0, y: 0, z: 1 } }, 100)).toMatchObject({ ok: true, killed: true });
    expect([...room.drops.values()]).toEqual([expect.objectContaining({ weaponId: "vx7" })]);
  });

  it("rejects replayed input and same-timestamp movement spam", () => {
    const room = new RoomState("ABCDE", 0);
    const player = room.addPlayer("One", 0)!;
    room.beginLive();
    expect(room.applyInput(player.id, { sequence: 1, position: { ...player.position, x: player.position.x + 0.3 }, yaw: 0, pitch: 0 }, 50)).toBe(true);
    expect(room.applyInput(player.id, { sequence: 1, position: { ...player.position, x: player.position.x + 0.1 }, yaw: 0, pitch: 0 }, 50)).toBe(false);
    for (let sequence = 2; sequence < 20; sequence += 1) {
      expect(room.applyInput(player.id, { sequence, position: { x: player.position.x, y: player.position.y + 0.2, z: player.position.z }, yaw: 0, pitch: 0 }, 50)).toBe(false);
    }
    expect(player.position.y).toBe(1.72);
  });

  it("rejects sustained vertical flight even when updates respect speed limits", () => {
    const room = new RoomState("ABCDE", 0);
    const player = room.addPlayer("One", 0)!;
    room.beginLive();
    expect(room.applyInput(player.id, { sequence: 1, position: { ...player.position, y: 2.22 }, yaw: 0, pitch: 0 }, 100)).toBe(true);
    expect(room.applyInput(player.id, { sequence: 2, position: { ...player.position, y: 2.72 }, yaw: 0, pitch: 0 }, 200)).toBe(true);
    expect(room.applyInput(player.id, { sequence: 3, position: { ...player.position, y: 3.22 }, yaw: 0, pitch: 0 }, 300)).toBe(false);
    expect(player.position.y).toBe(2.72);
  });

  it("persists useful helmet state and makes purchases idempotent", () => {
    const room = new RoomState("ABCDE", 0);
    const player = room.addPlayer("One", 0)!;
    expect(room.purchase(player.id, "helmet")).toMatchObject({ ok: true });
    expect(room.purchase(player.id, "helmet")).toMatchObject({ ok: false });
    expect(player).toMatchObject({ helmet: true, balance: 450 });
    expect(room.snapshot().players[0].helmet).toBe(true);
  });

  it("retains player identity during grace and expires it afterwards", () => {
    const room = new RoomState("ABCDE", 0);
    const player = room.addPlayer("One", 0)!;
    room.markDisconnected(player.id, 1_000);
    expect(room.resumePlayer(player.resumeToken, 10_000)?.id).toBe(player.id);
    room.markDisconnected(player.id, 11_000);
    expect(room.expireDisconnected(26_001)).toEqual(["One"]);
    expect(room.players.size).toBe(0);
    expect(room.isAbandoned(72_000)).toBe(true);
  });

  it("keeps bots from stepping through static walls", () => {
    const room = new RoomState("ABCDE", 0);
    const player = room.addPlayer("One", 0)!;
    room.beginLive();
    player.position = { x: 0, y: 1.72, z: 0 };
    const pursuingBot = room.bots.find((bot: TestBot) => bot.team === "bravo")!;
    const wall = wallFixture("west-center-divider");
    pursuingBot.position = { x: wall.west.x, y: 1, z: wall.west.z };
    for (let tick = 0; tick < 5; tick += 1) room.updateBots(1, 10_000 + tick * 1_000);
    expect(pursuingBot.position.x).toBeLessThan(wall.minX - 0.35);
  });

  it("resolves headshots and shotgun pellets on the server", () => {
    const headshotRoom = new RoomState("HEADS", 0);
    const sniper = headshotRoom.addPlayer("One", 0)!;
    headshotRoom.beginLive();
    sniper.weaponId = "needle50";
    sniper.magazine = 5;
    headshotRoom.bots.find((bot: TestBot) => bot.team !== sniper.team)!.position = { x: sniper.position.x, y: 1, z: sniper.position.z + 5 };
    const headDirection = normalizeForTest({ x: 0, y: 2.12 - sniper.position.y, z: 5 });
    expect(headshotRoom.fire(sniper.id, { shotId: "headshot", weaponId: "needle50", origin: { ...sniper.position }, direction: headDirection }, 100)).toMatchObject({ hit: true, killed: true, headshot: true });

    const shotgunRoom = new RoomState("PELLE", 0);
    const breacher = shotgunRoom.addPlayer("Two", 0)!;
    shotgunRoom.beginLive();
    breacher.weaponId = "rift6";
    breacher.magazine = 6;
    shotgunRoom.bots.find((bot: TestBot) => bot.team !== breacher.team)!.position = { x: breacher.position.x, y: 1, z: breacher.position.z + 5 };
    const bodyDirection = normalizeForTest({ x: 0, y: 1.45 - breacher.position.y, z: 5 });
    expect(shotgunRoom.fire(breacher.id, { shotId: "pellets", weaponId: "rift6", origin: { ...breacher.position }, direction: bodyDirection }, 100)).toMatchObject({ hit: true, killed: true });
  });

  it("resets a completed match after all connected players vote", () => {
    const room = new RoomState("ABCDE", 0);
    const first = room.addPlayer("One", 0)!;
    const second = room.addPlayer("Two", 0)!;
    room.phase = "MATCH_END";
    room.alphaRounds = 7;
    expect(room.voteRematch(first.id, 100)).toMatchObject({ ok: true, reset: false });
    expect(room.voteRematch(second.id, 100)).toMatchObject({ ok: true, reset: true });
    expect(room.snapshot(100)).toMatchObject({ phase: "BUY", round: 1, alphaRounds: 0, bravoRounds: 0, rematchVotes: 0 });
  });

  it("blocks friendly fire while allowing authoritative PvP damage", () => {
    const room = new RoomState("ABCDE", 0);
    const alpha = room.addPlayer("Alpha", 0)!;
    const bravo = room.addPlayer("Bravo", 0)!;
    room.beginLive();
    const ally = room.bots.find((bot: TestBot) => bot.team === alpha.team)!;
    ally.position = { x: alpha.position.x, y: 1, z: alpha.position.z + 4 };
    bravo.position = { x: alpha.position.x, y: 1.72, z: alpha.position.z + 7 };
    expect(room.fire(alpha.id, { shotId: "friendly-block", weaponId: "px9", origin: { ...alpha.position }, direction: { x: 0, y: 0, z: 1 } }, 100)).toMatchObject({ hit: false });
    expect(ally.health).toBe(100);
    expect(bravo.health).toBe(100);

    ally.position = { x: alpha.position.x - 3, y: 1, z: alpha.position.z + 4 };
    expect(room.fire(alpha.id, { shotId: "pvp-hit", weaponId: "px9", origin: { ...alpha.position }, direction: { x: 0, y: 0, z: 1 } }, 1_000)).toMatchObject({ hit: true });
    expect(bravo.health).toBeLessThan(100);
  });

  it("settles rounds and economy for the surviving mixed squad", () => {
    const room = new RoomState("ABCDE", 0);
    const alpha = room.addPlayer("Alpha", 0)!;
    const bravo = room.addPlayer("Bravo", 0)!;
    room.beginLive();
    bravo.alive = false;
    bravo.health = 0;
    for (const bot of room.bots.filter((candidate: TestBot) => candidate.team === "bravo") as TestBot[]) {
      bot.alive = false;
      bot.health = 0;
    }
    room.evaluateElimination();
    expect(room.snapshot()).toMatchObject({ phase: "ROUND_END", alphaRounds: 1, bravoRounds: 0, bravoLossTier: 1 });
    expect(alpha.balance).toBe(4_050);
    expect(bravo.balance).toBe(2_700);
  });

  it("allows bots to acquire and damage enemy bots", () => {
    const room = new RoomState("ABCDE", 0);
    const alphaPlayer = room.addPlayer("Alpha", 0)!;
    const bravoPlayer = room.addPlayer("Bravo", 0)!;
    room.beginLive();
    alphaPlayer.position = { x: 36, y: 1.72, z: -40 };
    bravoPlayer.position = { x: 36, y: 1.72, z: 40 };
    const alphaBot = room.bots.find((bot: TestBot) => bot.team === "alpha")!;
    const bravoBot = room.bots.find((bot: TestBot) => bot.team === "bravo")!;
    const duel = openDuelFixture();
    alphaBot.position = { x: duel.target.x, y: 1, z: duel.target.z };
    bravoBot.position = { x: duel.shooter.x, y: 1, z: duel.shooter.z };
    for (let tick = 1; tick <= 30 && alphaBot.health === 100 && bravoBot.health === 100; tick += 1) room.updateBots(0, tick * 1_000);
    expect(Math.min(alphaBot.health, bravoBot.health)).toBeLessThan(100);
  });

  it("records bot trigger pulls in snapshots even when the shot misses", () => {
    const room = new RoomState("ABCDE", 0);
    const player = room.addPlayer("Alpha", 0)!;
    room.beginLive();
    for (const bot of room.bots as TestBot[]) bot.alive = false;
    const shooter = room.bots.find((bot: TestBot) => bot.team !== player.team)!;
    shooter.alive = true;
    const duel = openDuelFixture();
    shooter.position = { x: duel.shooter.x, y: 1, z: duel.shooter.z };
    shooter.nextShotAt = 0;
    player.position = duel.target;
    player.health = 100;

    room.updateBots(0, 0);
    room.updateBots(0, 700);

    expect(player.health).toBe(100);
    expect(room.snapshot(700).bots.find((bot: TestBot) => bot.id === shooter.id)).toMatchObject({
      lastShotAt: 700,
      lastShotTarget: duel.aimPoint,
    });
  });

  it("lets visible bots damage enemy players when the authoritative shot hits", () => {
    const room = new RoomState("ABCDE", 0);
    const player = room.addPlayer("Alpha", 0)!;
    room.beginLive();
    for (const bot of room.bots as TestBot[]) bot.alive = false;
    const shooter = room.bots.find((bot: TestBot) => bot.team !== player.team)!;
    shooter.alive = true;
    const duel = openDuelFixture();
    shooter.position = { x: duel.shooter.x, y: 1, z: duel.shooter.z };
    shooter.nextShotAt = 0;
    player.position = duel.target;
    player.health = 100;

    room.updateBots(0, 0);
    room.updateBots(0, 500);

    expect(player.health).toBeLessThan(100);
    expect(room.snapshot(500).bots.find((bot: TestBot) => bot.id === shooter.id)).toMatchObject({
      lastShotAt: 500,
      lastShotTarget: duel.aimPoint,
    });
  });

  it("does not track or shoot enemies hidden behind cover without prior sight", () => {
    const room = new RoomState("ABCDE", 0);
    const player = room.addPlayer("Alpha", 0)!;
    room.beginLive();
    for (const bot of room.bots as TestBot[]) bot.alive = false;
    const watcher = room.bots.find((bot: TestBot) => bot.team !== player.team)!;
    watcher.alive = true;
    const wall = wallFixture("west-center-divider");
    watcher.position = { x: wall.west.x, y: 1, z: wall.west.z };
    watcher.nextShotAt = 0;
    player.position = wall.east;
    const start = { ...watcher.position };

    room.updateBots(1, 1_000);

    expect(watcher.position).toEqual(start);
    expect(Number.isFinite(watcher.lastShotAt)).toBe(false);
    expect(player.health).toBe(100);
  });

  it("waits for a reaction window before firing at newly visible enemies", () => {
    const room = new RoomState("ABCDE", 0);
    const player = room.addPlayer("Alpha", 0)!;
    room.beginLive();
    for (const bot of room.bots as TestBot[]) bot.alive = false;
    const shooter = room.bots.find((bot: TestBot) => bot.team !== player.team)!;
    shooter.alive = true;
    const duel = openDuelFixture();
    shooter.position = { x: duel.shooter.x, y: 1, z: duel.shooter.z };
    shooter.nextShotAt = 0;
    player.position = duel.target;

    room.updateBots(0, 0);
    room.updateBots(0, 250);
    expect(Number.isFinite(shooter.lastShotAt)).toBe(false);

    room.updateBots(0, 500);
    expect(room.snapshot(500).bots.find((bot: TestBot) => bot.id === shooter.id)).toMatchObject({ lastShotAt: 500 });
  });

  it("briefly pursues the last known position, then stops after memory expires", () => {
    const room = new RoomState("ABCDE", 0);
    const player = room.addPlayer("Alpha", 0)!;
    room.beginLive();
    for (const bot of room.bots as TestBot[]) bot.alive = false;
    const pursuer = room.bots.find((bot: TestBot) => bot.team !== player.team)!;
    pursuer.alive = true;
    const duel = openDuelFixture();
    pursuer.position = { x: duel.shooter.x, y: 1, z: duel.shooter.z };
    pursuer.nextShotAt = Infinity;
    player.position = duel.target;

    room.updateBots(0, 0);
    player.position = wallFixture("west-center-divider").east;
    room.updateBots(1, 500);
    expect(pursuer.position.z).toBeLessThan(duel.shooter.z);
    const rememberedStep = { ...pursuer.position };

    room.updateBots(1, 3_500);
    expect(pursuer.position).toEqual(rememberedStep);
  });

  it("requires the attacking carrier to hold interact inside a bomb site", () => {
    const room = new RoomState("ABCDE", 0);
    const attacker = room.addPlayer("Attacker", 0)!;
    room.beginLive();
    expect(room.snapshot(0).bomb).toMatchObject({ status: "carried", carrierId: attacker.id });
    expect(room.interact(attacker.id, true, 0)).toMatchObject({ ok: false });
    attacker.position = sitePosition("A");
    expect(room.interact(attacker.id, true, 1_000)).toMatchObject({ ok: true });
    room.processBomb(2_600);
    expect(room.snapshot(2_600).bomb).toMatchObject({ status: "planting", site: "A", progress: 0.5 });
    room.interact(attacker.id, false, 2_600);
    expect(room.snapshot(2_600).bomb).toMatchObject({ status: "carried", progress: 0 });
    room.interact(attacker.id, true, 3_000);
    room.processBomb(6_200);
    expect(room.snapshot(6_200).bomb).toMatchObject({ status: "planted", site: "A", carrierId: null, remainingSeconds: 40 });
  });

  it("lets defenders buy a kit and defuse in five seconds", () => {
    const room = new RoomState("ABCDE", 0);
    const attacker = room.addPlayer("Attacker", 0)!;
    const defender = room.addPlayer("Defender", 0)!;
    expect(room.purchase(defender.id, "defuse-kit")).toMatchObject({ ok: true });
    expect(room.purchase(attacker.id, "defuse-kit")).toMatchObject({ ok: false });
    room.beginLive();
    attacker.position = sitePosition("A");
    room.interact(attacker.id, true, 0);
    room.processBomb(3_200);
    defender.position = sitePosition("A");
    expect(room.interact(defender.id, true, 4_000)).toMatchObject({ ok: true });
    room.processBomb(6_500);
    expect(room.snapshot(6_500).bomb).toMatchObject({ status: "defusing", progress: 0.5 });
    room.processBomb(9_000);
    expect(room.snapshot(9_000)).toMatchObject({ phase: "ROUND_END", bravoRounds: 1, lastRoundReason: "bomb_defused", bomb: { status: "defused" } });
  });

  it("cancels an unfinished reload when planting or defusing starts", () => {
    const room = new RoomState("ABCDE", 0);
    const attacker = room.addPlayer("Attacker", 0)!;
    const defender = room.addPlayer("Defender", 0)!;
    room.beginLive();
    attacker.position = sitePosition("A");
    attacker.magazine = 1;
    expect(room.reload(attacker.id, 0)).toMatchObject({ ok: true });
    expect(room.interact(attacker.id, true, 100)).toMatchObject({ ok: true });
    expect(attacker.reloadCompletesAt).toBeNull();
    expect(room.completeReload(attacker, 2_000)).toBe(false);
    expect(attacker.magazine).toBe(1);
    room.processBomb(3_300);
    expect(room.bomb.status).toBe("planted");

    defender.position = { ...attacker.position };
    defender.magazine = 1;
    expect(room.reload(defender.id, 4_000)).toMatchObject({ ok: true });
    expect(room.interact(defender.id, true, 4_100)).toMatchObject({ ok: true });
    expect(defender.reloadCompletesAt).toBeNull();
    expect(room.completeReload(defender, 6_000)).toBe(false);
    expect(defender.magazine).toBe(1);
    room.processBomb(14_100);
    expect(room.snapshot()).toMatchObject({ phase: "ROUND_END", lastRoundReason: "bomb_defused" });
  });

  it("requires ten seconds to defuse without a kit and cancels a moved planter", () => {
    const room = new RoomState("ABCDE", 0);
    const attacker = room.addPlayer("Attacker", 0)!;
    const defender = room.addPlayer("Defender", 0)!;
    room.beginLive();
    attacker.position = sitePosition("A");
    room.interact(attacker.id, true, 0);
    attacker.position = { x: BOMB_SITES.A.x + BOMB_SITES.A.radius + 1, y: 1.72, z: BOMB_SITES.A.z };
    room.processBomb(1_000);
    expect(room.bomb.status).toBe("carried");
    attacker.position = sitePosition("A");
    room.interact(attacker.id, true, 2_000);
    room.processBomb(5_200);
    defender.position = sitePosition("A");
    room.interact(defender.id, true, 6_000);
    room.processBomb(11_000);
    expect(room.snapshot(11_000).bomb).toMatchObject({ status: "defusing", progress: 0.5 });
    room.processBomb(16_000);
    expect(room.snapshot(16_000)).toMatchObject({ phase: "ROUND_END", lastRoundReason: "bomb_defused" });
  });

  it("resolves a completed defuse by its deadline even when a tick arrives late", () => {
    const room = new RoomState("ABCDE", 0);
    const attacker = room.addPlayer("Attacker", 0)!;
    const defender = room.addPlayer("Defender", 0)!;
    room.purchase(defender.id, "defuse-kit");
    room.beginLive();
    attacker.position = sitePosition("A");
    room.interact(attacker.id, true, 0);
    room.processBomb(3_200);
    defender.position = { ...attacker.position };
    room.interact(defender.id, true, 38_200);
    room.processBomb(43_250);
    expect(room.snapshot()).toMatchObject({ phase: "ROUND_END", lastRoundReason: "bomb_defused" });
  });

  it("drops the C4 on disconnect and allows only nearby attackers to retrieve it", () => {
    const room = new RoomState("ABCDE", 0);
    const carrier = room.addPlayer("Carrier", 0)!;
    const defender = room.addPlayer("Defender", 0)!;
    const rescuer = room.addPlayer("Rescuer", 0)!;
    room.beginLive();
    room.markDisconnected(carrier.id, 1_000);
    expect(room.snapshot(1_000).bomb).toMatchObject({ status: "dropped", carrierId: null });
    defender.position = { ...carrier.position };
    expect(room.interact(defender.id, true, 1_000)).toMatchObject({ ok: false });
    rescuer.position = { x: 10, y: 1.72, z: 10 };
    expect(room.interact(rescuer.id, true, 1_000)).toMatchObject({ ok: false });
    rescuer.position = { ...carrier.position };
    expect(room.interact(rescuer.id, true, 1_000)).toMatchObject({ ok: true });
    expect(room.snapshot(1_000).bomb).toMatchObject({ status: "carried", carrierId: rescuer.id });
  });

  it("keeps disconnected players hittable and preserves death on reconnect", () => {
    const room = new RoomState("ABCDE", 0);
    const attacker = room.addPlayer("Attacker", 0)!;
    const defender = room.addPlayer("Defender", 0)!;
    room.beginLive();
    for (const bot of room.bots) bot.position = { x: 36, y: 1, z: 40 };
    defender.position = { x: attacker.position.x, y: 1.72, z: attacker.position.z + 5 };
    room.markDisconnected(defender.id, 1_000);
    expect(room.teamStrength("bravo").alive).toBe(5);
    expect(room.fire(attacker.id, {
      shotId: "offline-headshot",
      weaponId: "px9",
      origin: { ...attacker.position },
      direction: { x: 0, y: 0, z: 1 },
    }, 2_000)).toMatchObject({ ok: true, hit: true, killed: true });
    expect(defender).toMatchObject({ connected: false, alive: false, health: 0 });
    expect(room.resumePlayer(defender.resumeToken, 3_000)).toMatchObject({ connected: true, alive: false, health: 0 });
  });

  it("keeps disconnected opponents in bot target selection during grace", () => {
    const room = new RoomState("ABCDE", 0);
    const attacker = room.addPlayer("Attacker", 0)!;
    room.addPlayer("Defender", 0)!;
    room.beginLive();
    for (const bot of room.bots) {
      bot.position = { x: 36, y: 1, z: 40 };
      bot.nextShotAt = Infinity;
    }
    const defenderBot = room.bots.find((bot: TestBot) => bot.team === "bravo")!;
    attacker.position = { x: -50, y: 1.72, z: -42 };
    defenderBot.position = { x: attacker.position.x, y: 1, z: attacker.position.z + 12 };
    room.markDisconnected(attacker.id, 1_000);
    room.updateBots(1, 10_000);
    expect(defenderBot.position.z).toBeLessThan(attacker.position.z + 12);
  });

  it("drops a carried C4 explicitly without changing the equipped weapon", () => {
    const room = new RoomState("ABCDE", 0);
    const carrier = room.addPlayer("Carrier", 0)!;
    const defender = room.addPlayer("Defender", 0)!;
    room.beginLive();
    carrier.weaponId = "br4";
    carrier.primaryWeaponId = "br4";
    carrier.activeSlot = "primary";
    carrier.magazine = 9;
    expect(room.dropCarriedBomb(defender.id)).toMatchObject({ ok: false });
    expect(room.dropCarriedBomb(carrier.id)).toMatchObject({ ok: true });
    expect(room.snapshot().bomb).toMatchObject({ status: "dropped", carrierId: null });
    expect(carrier).toMatchObject({ weaponId: "br4", magazine: 9, activeSlot: "primary" });
    expect(room.dropCarriedBomb(carrier.id)).toMatchObject({ ok: false });
    expect(room.drops.size).toBe(0);
  });

  it("cannot pick up a dropped C4 through the left-lane wall", () => {
    const room = new RoomState("ABCDE", 0);
    const attacker = room.addPlayer("Attacker", 0)!;
    room.beginLive();
    const wall = wallFixture("west-center-divider");
    room.dropBomb(wall.west);
    attacker.position = wall.east;
    expect(room.interact(attacker.id, true, 1_000)).toMatchObject({ ok: false });
    expect(room.snapshot().bomb).toMatchObject({ status: "dropped", carrierId: null });
    attacker.position = wall.sameSidePickup;
    expect(room.interact(attacker.id, true, 1_100)).toMatchObject({ ok: true });
    expect(room.bomb.carrierId).toBe(attacker.id);
  });

  it("cancels planting after many small moves accumulate beyond the start point", () => {
    const room = new RoomState("ABCDE", 0);
    const attacker = room.addPlayer("Attacker", 0)!;
    room.beginLive();
    attacker.position = sitePosition("A");
    expect(room.interact(attacker.id, true, 0)).toMatchObject({ ok: true });
    for (let sequence = 1; sequence <= 100; sequence += 1) {
      expect(room.applyInput(attacker.id, {
        sequence,
        position: { x: BOMB_SITES.A.x + sequence * 0.02, y: 1.72, z: BOMB_SITES.A.z },
        yaw: 0,
        pitch: 0,
      }, sequence * 20)).toBe(true);
    }
    room.processBomb(3_200);
    expect(room.snapshot().bomb).toMatchObject({ status: "carried", progress: 0, site: null });
  });

  it("uses objective rules for timeout, elimination, explosion, and halftime", () => {
    const room = new RoomState("ABCDE", 0);
    const attacker = room.addPlayer("Attacker", 0)!;
    room.addPlayer("Defender", 0)!;
    room.beginLive();
    room.tick(115, 115_000);
    expect(room.snapshot()).toMatchObject({ phase: "ROUND_END", bravoRounds: 1, lastRoundReason: "time_expired" });
    room.beginNextRound(116_000);
    room.beginLive();
    attacker.position = sitePosition("A");
    room.interact(attacker.id, true, 120_000);
    room.processBomb(123_200);
    for (const bot of room.bots.filter((item: TestBot) => item.team === "alpha")) bot.alive = false;
    attacker.alive = false;
    room.evaluateElimination();
    expect(room.phase).toBe("LIVE");
    room.processBomb(163_200);
    expect(room.snapshot()).toMatchObject({ phase: "ROUND_END", alphaRounds: 1, lastRoundReason: "bomb_exploded" });

    room.round = 12;
    room.alphaRounds = 7;
    room.bravoRounds = 5;
    room.beginNextRound(164_000);
    expect(room.snapshot()).toMatchObject({ round: 13, attackingTeam: "bravo", defendingTeam: "alpha", alphaRounds: 7, bravoRounds: 5 });
    expect(attacker).toMatchObject({ position: TEAM_SPAWNS.bravo[0], balance: 800, weaponId: "px9" });
    expect(room.bomb.carrierId).toBe([...room.players.values()].find((player: { team: string }) => player.team === "bravo")?.id);
    room.phase = "LIVE";
    room.alphaRounds = 12;
    room.endRound("alpha", "defenders_eliminated");
    expect(room.snapshot()).toMatchObject({ phase: "MATCH_END", alphaRounds: 13 });
  });

  it("keeps ammunition in each weapon slot when switching", () => {
    const room = new RoomState("ABCDE", 0);
    const player = room.addPlayer("Buyer", 0)!;
    room.round = 2;
    player.balance = 10_000;
    expect(room.purchase(player.id, "br4")).toMatchObject({ ok: true });
    expect(room.purchase(player.id, "arc12")).toMatchObject({ ok: true });
    room.beginLive();
    expect(player).toMatchObject({ primaryWeaponId: "br4", secondaryWeaponId: "arc12", activeSlot: "secondary" });
    player.magazine = 3;
    expect(room.switchWeapon(player.id, "primary")).toMatchObject({ ok: true });
    player.magazine = 7;
    room.switchWeapon(player.id, "secondary");
    expect(player).toMatchObject({ weaponId: "arc12", magazine: 3 });
    room.switchWeapon(player.id, "primary");
    expect(player).toMatchObject({ weaponId: "br4", magazine: 7 });
    expect(room.snapshot().players[0]).toMatchObject({ primaryWeaponId: "br4", secondaryWeaponId: "arc12", activeSlot: "primary" });
  });

  it("lets attack bots plant at A or B and defense bots retake before the timers expire", () => {
    for (const [site, carrierSlot] of [["A", 2], ["B", 1]] as const) {
      const room = new RoomState("ABCDE", 0);
      room.addPlayer("Attacker", 0)!;
      room.addPlayer("Defender", 0)!;
      room.beginLive();
      const carrier = room.bots.find((bot: TestBot) => bot.team === "alpha" && bot.slot === carrierSlot)!;
      room.bomb.carrierId = carrier.id;
      for (const bot of room.bots) bot.nextShotAt = Infinity;
      let plantedAt = 0;
      for (let step = 1; step <= (COMPETITIVE_RULES.roundSeconds + COMPETITIVE_RULES.bombSeconds) * 5 && room.phase === "LIVE"; step += 1) {
        room.tick(0.2, step * 200);
        if (!plantedAt && room.bomb.status === "planted") plantedAt = step * 200;
      }
      expect(plantedAt).toBeGreaterThan(0);
      expect(plantedAt).toBeLessThan(COMPETITIVE_RULES.roundSeconds * 1_000);
      expect(room.snapshot()).toMatchObject({ phase: "ROUND_END", lastRoundReason: "bomb_defused", bravoRounds: 1, bomb: { status: "defused", site } });
    }
  });
});

function sitePosition(site: keyof typeof BOMB_SITES) {
  return { x: BOMB_SITES[site].x, y: 1.72, z: BOMB_SITES[site].z };
}

function openDuelFixture() {
  const target = { x: -50, y: 1.72, z: -25 };
  return {
    shooter: { x: target.x, y: 1.72, z: target.z + 3 },
    target,
    aimPoint: { x: target.x, y: 1.5, z: target.z },
  };
}

function wallFixture(name: string) {
  const box = ARENA_BOXES.find((item) => item.name === name);
  if (!box) throw new Error(`Missing arena wall fixture: ${name}`);
  const [width, , depth] = box.dimensions;
  const [centerX, , centerZ] = box.position;
  const minX = centerX - width / 2;
  const maxX = centerX + width / 2;
  const z = Math.max(centerZ - depth / 2 + 1, Math.min(centerZ + depth / 2 - 1, centerZ));
  return {
    minX,
    west: { x: minX - 0.7, y: 1.72, z },
    east: { x: maxX + 0.7, y: 1.72, z },
    insideWestFace: { x: minX + 0.08, y: 1.72, z },
    sameSidePickup: { x: minX - 0.3, y: 1.72, z },
  };
}

function normalizeForTest(vector: { x: number; y: number; z: number }) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}
