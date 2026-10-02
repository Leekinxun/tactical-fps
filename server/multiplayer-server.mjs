import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { PROTOCOL_VERSION, WEAPON_CATALOG } from "../src/shared/game-data.mjs";
import { RoomState } from "./room-state.mjs";

const MAX_MESSAGES_PER_SECOND = 180;
const MAX_CONNECTIONS_PER_MINUTE = 60;
const MAX_BUFFERED_BYTES = 256 * 1024;

export async function createMultiplayerServer({ port = 8787, host = "0.0.0.0" } = {}) {
  const rooms = new Map();
  const connectionAttempts = new Map();
  const httpServer = createServer((request, response) => {
    if (request.url === "/healthz") {
      response.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
      response.end(JSON.stringify({ ok: true, rooms: rooms.size, clients: wss.clients.size, protocolVersion: PROTOCOL_VERSION }));
      return;
    }
    response.writeHead(404).end();
  });
  const wss = new WebSocketServer({ server: httpServer, maxPayload: 16 * 1024 });

  wss.on("connection", (socket, request) => {
    const remoteAddress = request.socket.remoteAddress ?? "unknown";
    if (!allowConnection(connectionAttempts, remoteAddress, Date.now())) {
      socket.close(1008, "Too many connections");
      return;
    }
    const session = { room: null, playerId: null, initialized: false, messageWindowAt: Date.now(), messageCount: 0 };
    socket.on("message", (raw) => {
      if (!consumeMessageBudget(session, Date.now())) {
        send(socket, { type: "error", code: "RATE_LIMIT", message: "消息频率过高" });
        socket.close(1008, "Rate limit exceeded");
        return;
      }
      const parsed = parseClientMessage(raw.toString(), session.initialized);
      if (!parsed.ok) {
        send(socket, { type: "error", code: parsed.code, message: parsed.message });
        return;
      }
      if (!session.initialized) handleHello(socket, session, parsed.message, rooms);
      else handleMessage(socket, session, parsed.message);
    });
    socket.on("error", () => undefined);
    socket.on("close", () => {
      if (!session.room || !session.playerId) return;
      const player = session.room.players.get(session.playerId);
      session.room.sockets?.delete(socket);
      if (!player || !session.room.markDisconnected(session.playerId)) return;
      broadcastRoom(session.room, { type: "event", kind: "leave", message: `${player.name} 连接中断，保留席位 15 秒` });
    });
  });

  let lastTick = Date.now();
  const loop = setInterval(() => {
    const now = Date.now();
    const delta = Math.min(0.1, (now - lastTick) / 1000);
    lastTick = now;
    for (const [code, room] of rooms) {
      const expiredNames = room.expireDisconnected(now);
      for (const name of expiredNames) broadcastRoom(room, { type: "event", kind: "leave", message: `${name} 已离开房间` });
      room.tick(delta, now);
      broadcastRoom(room, { type: "snapshot", snapshot: room.snapshot(now) }, true);
      if (room.isAbandoned(now)) rooms.delete(code);
    }
    expireConnectionAttempts(connectionAttempts, now);
  }, 50);

  await new Promise((resolve) => httpServer.listen(port, host, resolve));
  const address = httpServer.address();
  return {
    port: typeof address === "object" && address ? address.port : port,
    rooms,
    close: async () => {
      clearInterval(loop);
      for (const client of wss.clients) client.terminate();
      await new Promise((resolve) => wss.close(() => httpServer.close(resolve)));
    },
  };
}

function handleHello(socket, session, message, rooms) {
  let room;
  let player;
  let resumed = false;
  if (message.action === "create") {
    const code = createRoomCode(rooms);
    room = new RoomState(code);
    rooms.set(code, room);
    player = room.addPlayer(message.name);
  } else {
    room = rooms.get(message.roomCode);
    if (!room) {
      send(socket, { type: "error", code: "ROOM_NOT_FOUND", message: "房间不存在" });
      return;
    }
    if (message.resumeToken) {
      player = room.resumePlayer(message.resumeToken);
      resumed = Boolean(player);
      if (!player) {
        send(socket, { type: "error", code: "RESUME_EXPIRED", message: "重连凭证已过期，请重新加入房间" });
        return;
      }
    } else player = room.addPlayer(message.name);
  }
  if (!player) {
    send(socket, { type: "error", code: "ROOM_FULL", message: "房间已满" });
    return;
  }
  session.room = room;
  session.playerId = player.id;
  session.initialized = true;
  room.sockets ??= new Set();
  room.sockets.add(socket);
  send(socket, { type: "welcome", protocolVersion: PROTOCOL_VERSION, playerId: player.id, roomCode: room.code, resumeToken: player.resumeToken, resumed, team: player.team });
  send(socket, { type: "snapshot", snapshot: room.snapshot() });
  const teamLabel = player.team.toUpperCase();
  const joinMessage = resumed
    ? `${player.name} 已恢复连接 · ${teamLabel}`
    : player.alive ? `${player.name} 已加入 ${teamLabel}` : `${player.name} 已加入 ${teamLabel} · 下一回合入场`;
  broadcastRoom(room, { type: "event", kind: "join", message: joinMessage });
}

function handleMessage(socket, session, message) {
  const room = session.room;
  const playerId = session.playerId;
  if (message.type === "input") room.applyInput(playerId, message);
  else if (message.type === "fire") {
    const result = room.fire(playerId, message);
    if (result.ok) broadcastRoom(room, { type: "shot", shooterId: playerId, weaponId: message.weaponId }, true);
    if (result.hit) send(socket, { type: "event", kind: "hit", message: result.killed ? result.headshot ? "精准击破 · 目标清除" : "目标清除" : result.headshot ? "头部命中" : "命中确认" });
  } else if (message.type === "ready") room.setReady(playerId);
  else if (message.type === "leave") {
    const player = room.players.get(playerId);
    if (player && room.removePlayer(playerId)) {
      room.sockets?.delete(socket);
      broadcastRoom(room, { type: "event", kind: "leave", message: `${player.name} 已退出房间` });
    }
    session.room = null;
    session.playerId = null;
    session.initialized = false;
    socket.close(1000, "Left match");
  }
  else if (message.type === "reload") sendResult(socket, "reload", room.reload(playerId));
  else if (message.type === "drop") sendResult(socket, "drop", message.item === "bomb" ? room.dropCarriedBomb(playerId) : room.dropWeapon(playerId));
  else if (message.type === "pickup") sendResult(socket, "pickup", room.pickupWeapon(playerId, message.dropId));
  else if (message.type === "buy") sendResult(socket, "purchase", room.purchase(playerId, message.itemId));
  else if (message.type === "interact") sendResult(socket, "objective", room.interact(playerId, message.active));
  else if (message.type === "switch_weapon") sendResult(socket, "objective", room.switchWeapon(playerId, message.slot));
  else if (message.type === "rematch") {
    const result = room.voteRematch(playerId);
    broadcastRoom(room, { type: "event", kind: "rematch", message: result.message });
  } else if (message.type === "ping") send(socket, { type: "pong", clientTime: message.clientTime, serverTime: Date.now() });
}

function sendResult(socket, kind, result) {
  send(socket, { type: "event", kind, message: result.message });
}

function parseClientMessage(raw, initialized) {
  let message;
  try { message = JSON.parse(raw); } catch { return invalid("BAD_JSON", "消息格式无效"); }
  if (!isObject(message) || typeof message.type !== "string") return invalid("BAD_MESSAGE", "消息结构无效");
  if (!initialized) {
    if (message.type !== "hello") return invalid("HELLO_REQUIRED", "请先创建或加入房间");
    if (message.protocolVersion !== PROTOCOL_VERSION) return invalid("PROTOCOL_MISMATCH", "客户端与服务器版本不兼容");
    if (!['create', 'join'].includes(message.action) || typeof message.name !== "string" || message.name.length > 64) return invalid("BAD_HELLO", "房间请求无效");
    const roomCode = typeof message.roomCode === "string" ? message.roomCode.toUpperCase() : undefined;
    if (message.action === "join" && !/^[A-Z2-9]{5}$/.test(roomCode ?? "")) return invalid("BAD_ROOM_CODE", "房间码无效");
    if (message.resumeToken !== undefined && (typeof message.resumeToken !== "string" || message.resumeToken.length > 64)) return invalid("BAD_RESUME_TOKEN", "重连凭证无效");
    return valid({ type: "hello", action: message.action, name: message.name, roomCode, resumeToken: message.resumeToken });
  }
  if (message.type === "input") {
    if (!Number.isSafeInteger(message.sequence) || !isFiniteVector(message.position) || !Number.isFinite(message.yaw) || !Number.isFinite(message.pitch)) return invalid("BAD_INPUT", "移动消息无效");
    return valid(message);
  }
  if (message.type === "fire") {
    if (typeof message.shotId !== "string" || message.shotId.length < 1 || message.shotId.length > 96 || !isFiniteVector(message.origin) || !isFiniteVector(message.direction) || !WEAPON_CATALOG[message.weaponId]) return invalid("BAD_FIRE", "射击消息无效");
    return valid(message);
  }
  if (["reload", "ready", "leave", "rematch"].includes(message.type)) return valid({ type: message.type });
  if (message.type === "drop") return message.item === undefined || ["weapon", "bomb"].includes(message.item)
    ? valid({ type: "drop", item: message.item }) : invalid("BAD_DROP", "丢弃消息无效");
  if (message.type === "interact") return typeof message.active === "boolean" ? valid({ type: "interact", active: message.active }) : invalid("BAD_INTERACT", "交互消息无效");
  if (message.type === "switch_weapon") return ["primary", "secondary"].includes(message.slot) ? valid({ type: "switch_weapon", slot: message.slot }) : invalid("BAD_SWITCH", "武器切换消息无效");
  if (message.type === "pickup") return typeof message.dropId === "string" && /^drop-\d+$/.test(message.dropId) ? valid({ type: "pickup", dropId: message.dropId }) : invalid("BAD_PICKUP", "拾取消息无效");
  if (message.type === "buy") return [...Object.keys(WEAPON_CATALOG), "armor", "helmet", "defuse-kit"].includes(message.itemId) ? valid({ type: "buy", itemId: message.itemId }) : invalid("BAD_PURCHASE", "购买消息无效");
  if (message.type === "ping") return Number.isFinite(message.clientTime) ? valid({ type: "ping", clientTime: message.clientTime }) : invalid("BAD_PING", "延迟消息无效");
  return invalid("UNKNOWN_MESSAGE", "未知消息类型");
}

function valid(message) { return { ok: true, message }; }
function invalid(code, message) { return { ok: false, code, message }; }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isFiniteVector(value) { return isObject(value) && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z); }

function consumeMessageBudget(session, now) {
  if (now - session.messageWindowAt >= 1000) {
    session.messageWindowAt = now;
    session.messageCount = 0;
  }
  session.messageCount += 1;
  return session.messageCount <= MAX_MESSAGES_PER_SECOND;
}

function allowConnection(attempts, address, now) {
  const entry = attempts.get(address);
  if (!entry || now - entry.startedAt >= 60_000) {
    attempts.set(address, { startedAt: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_CONNECTIONS_PER_MINUTE;
}

function expireConnectionAttempts(attempts, now) {
  for (const [address, entry] of attempts) if (now - entry.startedAt >= 60_000) attempts.delete(address);
}

function broadcastRoom(room, message, droppable = false) {
  const payload = JSON.stringify(message);
  for (const client of room.sockets ?? []) sendPayload(client, payload, droppable);
}

function send(socket, message) {
  sendPayload(socket, JSON.stringify(message), false);
}

function sendPayload(socket, payload, droppable) {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
    if (!droppable) socket.close(1013, "Client too slow");
    return;
  }
  socket.send(payload);
}

function createRoomCode(rooms) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    let code = "";
    for (let index = 0; index < 5; index += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error("Unable to allocate a room code.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.BREACHLINE_HOST ?? "0.0.0.0";
  const server = await createMultiplayerServer({ port: Number(process.env.BREACHLINE_PORT ?? 8787), host });
  console.log(`BREACHLINE multiplayer server listening on ws://${host}:${server.port}`);
}
