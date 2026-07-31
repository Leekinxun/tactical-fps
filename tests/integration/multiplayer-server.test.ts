import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "../../src/shared/protocol";
// @ts-expect-error Server module intentionally runs as native Node ESM.
import { createMultiplayerServer } from "../../server/multiplayer-server.mjs";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("multiplayer room server", () => {
  it("creates a room, joins a second client and starts when both are ready", async () => {
    const server = await createMultiplayerServer({ port: 0, host: "127.0.0.1" });
    const sockets: WebSocket[] = [];
    cleanups.push(async () => {
      for (const socket of sockets) socket.close();
      await server.close();
    });

    const first = await openSocket(server.port);
    sockets.push(first);
    first.send(JSON.stringify({ type: "hello", protocolVersion: PROTOCOL_VERSION, action: "create", name: "Alpha" }));
    const firstWelcome = await waitForMessage(first, (message) => message.type === "welcome");
    expect(firstWelcome.roomCode).toMatch(/^[A-Z2-9]{5}$/);

    const second = await openSocket(server.port);
    sockets.push(second);
    second.send(JSON.stringify({ type: "hello", protocolVersion: PROTOCOL_VERSION, action: "join", roomCode: firstWelcome.roomCode, name: "Bravo" }));
    const secondWelcome = await waitForMessage(second, (message) => message.type === "welcome");
    expect(secondWelcome).toMatchObject({ roomCode: firstWelcome.roomCode, team: "bravo" });
    const joinedSnapshot = await waitForMessage(second, (message) => message.type === "snapshot" && message.snapshot.players.length === 2);
    expect(joinedSnapshot.snapshot.players.map((player: { name: string }) => player.name).sort()).toEqual(["Alpha", "Bravo"]);
    expect(joinedSnapshot.snapshot.players.map((player: { team: string }) => player.team).sort()).toEqual(["alpha", "bravo"]);
    expect(joinedSnapshot.snapshot.bots.filter((bot: { team: string }) => bot.team === "alpha")).toHaveLength(1);
    expect(joinedSnapshot.snapshot.bots.filter((bot: { team: string }) => bot.team === "bravo")).toHaveLength(1);

    first.send(JSON.stringify({ type: "ready" }));
    second.send(JSON.stringify({ type: "ready" }));
    const liveSnapshot = await waitForMessage(first, (message) => message.type === "snapshot" && message.snapshot.phase === "LIVE");
    expect(liveSnapshot.snapshot.phaseRemaining).toBeGreaterThan(100);

    const room = server.rooms.get(firstWelcome.roomCode);
    const alpha = [...room.players.values()].find((player: { name: string }) => player.name === "Alpha");
    const bravo = [...room.players.values()].find((player: { name: string }) => player.name === "Bravo");
    alpha.weaponId = "br4";
    alpha.magazine = 9;
    alpha.reserve = 33;
    bravo.position = { x: -1, y: 1.72, z: -14 };
    first.send(JSON.stringify({ type: "drop" }));
    const droppedSnapshot = await waitForMessage(second, (message) => message.type === "snapshot" && message.snapshot.drops.length === 1);
    expect(droppedSnapshot.snapshot.drops[0]).toMatchObject({ weaponId: "br4", magazine: 9, reserve: 33 });

    second.send(JSON.stringify({ type: "pickup", dropId: droppedSnapshot.snapshot.drops[0].id }));
    const pickedUpSnapshot = await waitForMessage(second, (message) => message.type === "snapshot"
      && message.snapshot.players.some((player: { name: string; weaponId: string }) => player.name === "Bravo" && player.weaponId === "br4"));
    expect(pickedUpSnapshot.snapshot.drops).toHaveLength(0);
  });

  it("rejects malformed frames without crashing the room server", async () => {
    const server = await createMultiplayerServer({ port: 0, host: "127.0.0.1" });
    const socket = await openSocket(server.port);
    cleanups.push(async () => {
      socket.close();
      await server.close();
    });
    socket.send(JSON.stringify({ type: "hello", protocolVersion: PROTOCOL_VERSION - 1, action: "create", name: "Guard" }));
    expect(await waitForMessage(socket, (message) => message.type === "error")).toMatchObject({ code: "PROTOCOL_MISMATCH" });
    socket.send(JSON.stringify({ type: "hello", protocolVersion: PROTOCOL_VERSION, action: "create", name: "Guard" }));
    await waitForMessage(socket, (message) => message.type === "welcome");
    socket.send("null");
    expect(await waitForMessage(socket, (message) => message.type === "error")).toMatchObject({ code: "BAD_MESSAGE" });
    socket.send(JSON.stringify({ type: "ping", clientTime: 42 }));
    expect(await waitForMessage(socket, (message) => message.type === "pong")).toMatchObject({ clientTime: 42 });
  });

  it("resumes the same authoritative player during the reconnect grace period", async () => {
    const server = await createMultiplayerServer({ port: 0, host: "127.0.0.1" });
    const sockets: WebSocket[] = [];
    cleanups.push(async () => {
      for (const socket of sockets) socket.close();
      await server.close();
    });
    const first = await openSocket(server.port);
    sockets.push(first);
    first.send(JSON.stringify({ type: "hello", protocolVersion: PROTOCOL_VERSION, action: "create", name: "Returner" }));
    const initial = await waitForMessage(first, (message) => message.type === "welcome");
    const room = server.rooms.get(initial.roomCode);
    room.players.get(initial.playerId).balance = 4_200;
    await closeSocket(first);

    const resumedSocket = await openSocket(server.port);
    sockets.push(resumedSocket);
    resumedSocket.send(JSON.stringify({ type: "hello", protocolVersion: PROTOCOL_VERSION, action: "join", roomCode: initial.roomCode, name: "Returner", resumeToken: initial.resumeToken }));
    const resumed = await waitForMessage(resumedSocket, (message) => message.type === "welcome");
    expect(resumed).toMatchObject({ playerId: initial.playerId, resumed: true });
    const snapshot = await waitForMessage(resumedSocket, (message) => message.type === "snapshot");
    expect(snapshot.snapshot.players.find((player: { id: string }) => player.id === initial.playerId)).toMatchObject({ balance: 4_200, connected: true });
  });

  it("disconnects clients that exceed the message budget", async () => {
    const server = await createMultiplayerServer({ port: 0, host: "127.0.0.1" });
    const socket = await openSocket(server.port);
    cleanups.push(async () => {
      socket.close();
      await server.close();
    });
    socket.send(JSON.stringify({ type: "hello", protocolVersion: PROTOCOL_VERSION, action: "create", name: "Flood" }));
    await waitForMessage(socket, (message) => message.type === "welcome");
    const closed = new Promise<number>((resolve) => socket.once("close", (code) => resolve(code)));
    for (let index = 0; index < 220; index += 1) socket.send(JSON.stringify({ type: "ping", clientTime: index }));
    await expect(closed).resolves.toBe(1008);
  });
});

function openSocket(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function waitForMessage(socket: WebSocket, predicate: (message: any) => boolean, timeoutMs = 3_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for WebSocket message"));
    }, timeoutMs);
    const onMessage = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString());
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

function closeSocket(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) return resolve();
    socket.once("close", () => resolve());
    socket.close();
  });
}
