import { describe, expect, it } from "vitest";
// @ts-expect-error Server module intentionally runs as native Node ESM.
import { RoomState } from "../../server/room-state.mjs";

describe("authoritative RoomState", () => {
  it("caps rooms at four players", () => {
    const room = new RoomState("ABCDE", 0);
    expect(room.addPlayer("One", 0)).not.toBeNull();
    expect(room.addPlayer("Two", 0)).not.toBeNull();
    expect(room.addPlayer("Three", 0)).not.toBeNull();
    expect(room.addPlayer("Four", 0)).not.toBeNull();
    expect(room.addPlayer("Five", 0)).toBeNull();
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
    expect(room.applyInput(player.id, { sequence: 2, position: { x: 0.2, y: 1.72, z: -14 }, yaw: 0.1, pitch: 0 }, 100)).toBe(true);
  });

  it("rejects movement through arena collision geometry", () => {
    const room = new RoomState("ABCDE", 0);
    const player = room.addPlayer("One", 0)!;
    room.beginLive();
    player.position = { x: -6.6, y: 1.72, z: -1 };
    expect(room.applyInput(player.id, { sequence: 1, position: { x: -7.2, y: 1.72, z: -1 }, yaw: 0, pitch: 0 }, 100)).toBe(false);
  });

  it("rejects swept movement that crosses a wall even when the endpoint is clear", () => {
    const room = new RoomState("ABCDE", 0);
    const player = room.addPlayer("One", 0)!;
    room.beginLive();
    player.position = { x: -8, y: 1.72, z: -1 };
    expect(room.applyInput(player.id, { sequence: 1, position: { x: -6.5, y: 1.72, z: -1 }, yaw: 0, pitch: 0 }, 250)).toBe(false);
  });

  it("blocks shots when cover is closer than the target", () => {
    const room = new RoomState("ABCDE", 0);
    const player = room.addPlayer("One", 0)!;
    room.beginLive();
    player.position = { x: -3.4, y: 1.72, z: -10 };
    room.bots[0].position = { x: -3.4, y: 1.72, z: 0 };
    const result = room.fire(player.id, {
      shotId: "wall-test",
      weaponId: "px9",
      origin: { ...player.position },
      direction: { x: 0, y: 0, z: 1 },
    }, 1_000);
    expect(result).toMatchObject({ ok: true, hit: false });
    expect(room.bots[0].health).toBe(100);
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
    const dropped = room.createDrop("vx7", 19, 70, { x: -1, y: 1.72, z: -14 });
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
    room.bots[0].position = { x: 0, y: 1.72, z: -9 };
    room.bots[0].health = 32;
    expect(room.fire(player.id, { shotId: "bot-kill", weaponId: "px9", origin: { ...player.position }, direction: { x: 0, y: 0, z: 1 } }, 100)).toMatchObject({ ok: true, killed: true });
    expect([...room.drops.values()]).toEqual([expect.objectContaining({ weaponId: "vx7" })]);
  });

  it("rejects replayed input and same-timestamp movement spam", () => {
    const room = new RoomState("ABCDE", 0);
    const player = room.addPlayer("One", 0)!;
    room.beginLive();
    expect(room.applyInput(player.id, { sequence: 1, position: { x: 0.3, y: 1.72, z: -14 }, yaw: 0, pitch: 0 }, 50)).toBe(true);
    expect(room.applyInput(player.id, { sequence: 1, position: { x: 0.4, y: 1.72, z: -14 }, yaw: 0, pitch: 0 }, 50)).toBe(false);
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
    player.position = { x: 0, y: 1.72, z: -1 };
    room.bots[0].position = { x: -8, y: 1, z: -1 };
    for (let tick = 0; tick < 5; tick += 1) room.updateBots(1, 10_000 + tick * 1_000);
    expect(room.bots[0].position.x).toBeLessThan(-7.55);
  });

  it("resolves headshots and shotgun pellets on the server", () => {
    const headshotRoom = new RoomState("HEADS", 0);
    const sniper = headshotRoom.addPlayer("One", 0)!;
    headshotRoom.beginLive();
    sniper.weaponId = "needle50";
    sniper.magazine = 5;
    headshotRoom.bots[0].position = { x: 0, y: 1, z: -9 };
    const headDirection = normalizeForTest({ x: 0, y: 2.12 - sniper.position.y, z: 5 });
    expect(headshotRoom.fire(sniper.id, { shotId: "headshot", weaponId: "needle50", origin: { ...sniper.position }, direction: headDirection }, 100)).toMatchObject({ hit: true, killed: true, headshot: true });

    const shotgunRoom = new RoomState("PELLE", 0);
    const breacher = shotgunRoom.addPlayer("Two", 0)!;
    shotgunRoom.beginLive();
    breacher.weaponId = "rift6";
    breacher.magazine = 6;
    shotgunRoom.bots[0].position = { x: 0, y: 1, z: -9 };
    const bodyDirection = normalizeForTest({ x: 0, y: 1.45 - breacher.position.y, z: 5 });
    expect(shotgunRoom.fire(breacher.id, { shotId: "pellets", weaponId: "rift6", origin: { ...breacher.position }, direction: bodyDirection }, 100)).toMatchObject({ hit: true, killed: true });
  });

  it("resets a completed match after all connected players vote", () => {
    const room = new RoomState("ABCDE", 0);
    const first = room.addPlayer("One", 0)!;
    const second = room.addPlayer("Two", 0)!;
    room.phase = "MATCH_END";
    room.playerRounds = 7;
    expect(room.voteRematch(first.id, 100)).toMatchObject({ ok: true, reset: false });
    expect(room.voteRematch(second.id, 100)).toMatchObject({ ok: true, reset: true });
    expect(room.snapshot(100)).toMatchObject({ phase: "BUY", round: 1, playerRounds: 0, botRounds: 0, rematchVotes: 0 });
  });
});

function normalizeForTest(vector: { x: number; y: number; z: number }) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}
