import { randomUUID } from "node:crypto";
import { ARENA_BOXES, TEAM_SPAWNS, WEAPON_CATALOG } from "../src/shared/game-data.mjs";

export const RECONNECT_GRACE_MS = 15_000;
export const EMPTY_ROOM_TTL_MS = 60_000;

const MAX_PLAYER_SPEED = 7;
const MAX_INPUT_GAP_SECONDS = 0.25;
const PLAYER_RADIUS = 0.35;
const TEAMS = ["alpha", "bravo"];
const ARENA_COLLIDERS = ARENA_BOXES.map((item) => collider(item.dimensions, item.position));

export class RoomState {
  constructor(code, now = Date.now()) {
    this.code = code;
    this.createdAt = now;
    this.lastActivityAt = now;
    this.lastPlayerLeftAt = null;
    this.players = new Map();
    this.phase = "BUY";
    this.phaseRemaining = 20;
    this.round = 1;
    this.alphaRounds = 0;
    this.bravoRounds = 0;
    this.lossTiers = { alpha: 0, bravo: 0 };
    this.bots = [];
    this.drops = new Map();
    this.nextDropId = 1;
    this.rematchVotes = new Set();
  }

  addPlayer(name, now = Date.now()) {
    if (this.players.size >= 4) return null;
    const id = randomUUID();
    const team = this.chooseTeam();
    const spawnIndex = firstAvailableSpawnIndex(this.players, team);
    const spawn = TEAM_SPAWNS[team][spawnIndex] ?? TEAM_SPAWNS[team][0];
    const weapon = WEAPON_CATALOG.px9;
    const player = {
      id,
      resumeToken: randomUUID(),
      spawnIndex,
      team,
      name: sanitizeName(name),
      position: { ...spawn },
      yaw: team === "alpha" ? 0 : Math.PI,
      pitch: 0,
      health: this.phase === "LIVE" ? 0 : 100,
      armor: 0,
      helmet: false,
      balance: 800,
      weaponId: "px9",
      magazine: weapon.magazineSize,
      reserve: weapon.reserveAmmo,
      alive: this.phase !== "LIVE",
      ready: false,
      connected: true,
      disconnectedAt: null,
      lastInputAt: now,
      lastSequence: -1,
      movementCredit: 0,
      movingUntil: 0,
      lastShotAt: -Infinity,
      reloadCompletesAt: null,
      processedShots: new Set(),
    };
    this.players.set(id, player);
    if (this.phase !== "LIVE") this.rebalanceBots();
    this.lastActivityAt = now;
    this.lastPlayerLeftAt = null;
    return player;
  }

  resumePlayer(resumeToken, now = Date.now()) {
    const player = [...this.players.values()].find((candidate) => candidate.resumeToken === resumeToken);
    if (!player || player.connected || player.disconnectedAt === null || now - player.disconnectedAt > RECONNECT_GRACE_MS) return null;
    player.connected = true;
    player.disconnectedAt = null;
    player.lastInputAt = now;
    player.movementCredit = 0;
    this.lastPlayerLeftAt = null;
    this.lastActivityAt = now;
    return player;
  }

  markDisconnected(playerId, now = Date.now()) {
    const player = this.players.get(playerId);
    if (!player || !player.connected) return false;
    player.connected = false;
    player.disconnectedAt = now;
    player.ready = false;
    this.rematchVotes.delete(playerId);
    if (![...this.players.values()].some((candidate) => candidate.connected)) this.lastPlayerLeftAt = now;
    return true;
  }

  removePlayer(playerId, now = Date.now()) {
    const player = this.players.get(playerId);
    if (!player) return false;
    if (this.phase === "LIVE") this.dropPlayerWeapon(player);
    this.rematchVotes.delete(playerId);
    this.players.delete(playerId);
    if (this.phase !== "LIVE") this.rebalanceBots();
    this.lastActivityAt = now;
    if (![...this.players.values()].some((candidate) => candidate.connected)) this.lastPlayerLeftAt ??= now;
    return true;
  }

  expireDisconnected(now = Date.now()) {
    const expiredNames = [];
    for (const player of [...this.players.values()]) {
      if (player.connected || player.disconnectedAt === null || now - player.disconnectedAt <= RECONNECT_GRACE_MS) continue;
      expiredNames.push(player.name);
      this.removePlayer(player.id, now);
    }
    return expiredNames;
  }

  isAbandoned(now = Date.now()) {
    return ![...this.players.values()].some((player) => player.connected)
      && this.lastPlayerLeftAt !== null
      && now - this.lastPlayerLeftAt > EMPTY_ROOM_TTL_MS;
  }

  applyInput(playerId, input, now = Date.now()) {
    const player = this.players.get(playerId);
    if (!player?.connected || !player.alive || this.phase !== "LIVE") return false;
    if (!Number.isSafeInteger(input?.sequence) || input.sequence <= player.lastSequence || !isFiniteVector(input.position)) return false;

    const elapsed = Math.max(0, Math.min(MAX_INPUT_GAP_SECONDS, (now - player.lastInputAt) / 1000));
    player.lastInputAt = now;
    player.lastSequence = input.sequence;
    player.movementCredit = Math.min(MAX_PLAYER_SPEED * MAX_INPUT_GAP_SECONDS, player.movementCredit + elapsed * MAX_PLAYER_SPEED);
    const candidate = input.position;
    const travel = distance(player.position, candidate);
    if (travel > player.movementCredit + 1e-6 || !isWithinArena(candidate) || !isPlausiblePlayerHeight(candidate) || !sweptPositionIsClear(player.position, candidate, PLAYER_RADIUS)) {
      player.movementCredit = 0;
      return false;
    }

    player.movementCredit = Math.max(0, player.movementCredit - travel);
    player.position = { x: candidate.x, y: candidate.y, z: candidate.z };
    player.yaw = finiteNumber(input.yaw, player.yaw, -Math.PI * 4, Math.PI * 4);
    player.pitch = finiteNumber(input.pitch, player.pitch, -1.55, 1.55);
    if (travel > 0.025) player.movingUntil = now + 150;
    this.lastActivityAt = now;
    return true;
  }

  setReady(playerId) {
    const player = this.players.get(playerId);
    if (!player?.connected || this.phase !== "BUY") return false;
    player.ready = true;
    return true;
  }

  purchase(playerId, itemId) {
    const player = this.players.get(playerId);
    if (!player?.connected || this.phase !== "BUY") return { ok: false, message: "当前不在购买阶段" };
    if (itemId === "armor") {
      if (player.armor >= 100) return { ok: false, message: "已拥有复合护甲" };
      if (player.balance < 650) return { ok: false, message: "余额不足" };
      player.balance -= 650;
      player.armor = 100;
      return { ok: true, message: "已购买复合护甲" };
    }
    if (itemId === "helmet") {
      if (player.helmet) return { ok: false, message: "已拥有战术头盔" };
      if (player.balance < 350) return { ok: false, message: "余额不足" };
      player.balance -= 350;
      player.helmet = true;
      return { ok: true, message: "已购买战术头盔" };
    }
    const weapon = WEAPON_CATALOG[itemId];
    if (!weapon) return { ok: false, message: "未知装备" };
    if (player.weaponId === itemId) return { ok: false, message: "已拥有该武器" };
    if (this.round === 1 && weapon.slot === "primary") return { ok: false, message: "手枪局禁止购买主武器" };
    if (player.balance < weapon.price) return { ok: false, message: "余额不足" };
    player.balance -= weapon.price;
    equipWeapon(player, itemId);
    return { ok: true, message: `已购买 ${weapon.displayName}` };
  }

  reload(playerId, now = Date.now()) {
    const player = this.players.get(playerId);
    if (!player?.connected || !player.alive || this.phase !== "LIVE" || player.reloadCompletesAt !== null) return { ok: false, message: "当前无法换弹" };
    const weapon = WEAPON_CATALOG[player.weaponId];
    if (player.magazine >= weapon.magazineSize || player.reserve <= 0) return { ok: false, message: "无需换弹" };
    player.reloadCompletesAt = now + weapon.reloadMs;
    return { ok: true, message: "正在更换弹匣" };
  }

  dropWeapon(playerId) {
    const player = this.players.get(playerId);
    if (!player?.connected || !player.alive || this.phase !== "LIVE" || player.weaponId === "px9") return { ok: false, message: "当前武器无法丢弃" };
    const dropped = this.dropPlayerWeapon(player);
    return dropped ? { ok: true, message: `已丢弃 ${WEAPON_CATALOG[dropped.weaponId].displayName}` } : { ok: false, message: "当前武器无法丢弃" };
  }

  pickupWeapon(playerId, dropId) {
    const player = this.players.get(playerId);
    const dropped = this.drops.get(String(dropId));
    if (!player?.connected || !player.alive || this.phase !== "LIVE" || !dropped) return { ok: false, message: "武器已被拾取" };
    const pickupDistance = distance(player.position, dropped.position);
    if (pickupDistance > 2.3) return { ok: false, message: "距离武器过远" };
    const direction = normalize(subtract(dropped.position, player.position));
    const wallDistance = nearestColliderHit(player.position, direction, pickupDistance);
    if (wallDistance !== null && wallDistance < pickupDistance - 0.2) return { ok: false, message: "武器被障碍物阻挡" };

    this.drops.delete(dropped.id);
    if (player.weaponId !== "px9") this.createDrop(player.weaponId, player.magazine, player.reserve, dropPositionForPlayer(player));
    player.weaponId = dropped.weaponId;
    player.magazine = dropped.magazine;
    player.reserve = dropped.reserve;
    player.reloadCompletesAt = null;
    return { ok: true, message: `已拾取 ${WEAPON_CATALOG[dropped.weaponId].displayName}` };
  }

  fire(playerId, message, now = Date.now()) {
    const player = this.players.get(playerId);
    if (!player?.connected || !player.alive || this.phase !== "LIVE") return { ok: false };
    const weapon = WEAPON_CATALOG[player.weaponId];
    if (!weapon || message.weaponId !== player.weaponId || typeof message.shotId !== "string" || player.processedShots.has(message.shotId)) return { ok: false };
    this.completeReload(player, now);
    if (player.reloadCompletesAt !== null || player.magazine <= 0) return { ok: false };
    const interval = 60_000 / weapon.roundsPerMinute;
    if (now - player.lastShotAt + Number.EPSILON < interval) return { ok: false };
    if (!isFiniteVector(message.origin) || !isFiniteVector(message.direction) || distance(message.origin, player.position) > 0.8) return { ok: false };
    const directionLength = vectorLength(message.direction);
    if (directionLength < 0.9 || directionLength > 1.1) return { ok: false };

    player.processedShots.add(message.shotId);
    if (player.processedShots.size > 256) player.processedShots.clear();
    player.lastShotAt = now;
    player.magazine -= 1;
    const origin = { ...player.position };
    const aim = normalize(message.direction);
    const pellets = weapon.pellets ?? 1;
    const spread = weapon.baseSpread + (now < player.movingUntil ? weapon.movementSpread : 0);
    const damageByTarget = new Map();
    let headshot = false;

    for (let pellet = 0; pellet < pellets; pellet += 1) {
      const direction = applySpread(aim, spread, `${message.shotId}:${pellet}`);
      const hit = nearestCombatantHit(origin, direction, this.players, this.bots, player.id);
      if (!hit) continue;
      const wallDistance = nearestColliderHit(origin, direction, 120);
      if (wallDistance !== null && wallDistance <= hit.along) continue;
      if (hit.team === player.team) continue;
      const damage = weapon.damage * (hit.zone === "head" ? weapon.headMultiplier : 1);
      headshot ||= hit.zone === "head";
      const accumulated = damageByTarget.get(hit.entity) ?? { kind: hit.kind, damage: 0, headshot: false };
      accumulated.damage += damage;
      accumulated.headshot ||= hit.zone === "head";
      damageByTarget.set(hit.entity, accumulated);
    }

    let killed = false;
    let hitTargetId = null;
    for (const [target, hit] of damageByTarget) {
      if (!target.alive) continue;
      hitTargetId ??= target.id;
      if (hit.kind === "player") damagePlayer(target, hit.damage, { headshot: hit.headshot, armorPenetration: weapon.armorPenetration });
      else {
        target.health = Math.max(0, target.health - hit.damage);
        if (target.health === 0) target.alive = false;
      }
      if (target.alive) continue;
      killed = true;
      if (hit.kind === "player") this.dropPlayerWeapon(target);
      else {
        const botWeapon = WEAPON_CATALOG[target.weaponId];
        this.createDrop(target.weaponId, botWeapon.magazineSize, Math.floor(botWeapon.reserveAmmo * 0.5), botDropPosition(target));
      }
      player.balance = Math.min(16_000, player.balance + weapon.killReward);
    }
    this.evaluateElimination();
    return { ok: true, hit: damageByTarget.size > 0, targetId: hitTargetId, killed, headshot };
  }

  voteRematch(playerId, now = Date.now()) {
    const player = this.players.get(playerId);
    if (!player?.connected || this.phase !== "MATCH_END") return { ok: false, message: "比赛尚未结束" };
    this.rematchVotes.add(playerId);
    const required = this.connectedPlayers().length;
    if (required > 0 && this.rematchVotes.size >= required) {
      this.resetMatch(now);
      return { ok: true, reset: true, message: "再战投票通过 · 新比赛开始" };
    }
    return { ok: true, reset: false, message: `再战投票 ${this.rematchVotes.size}/${required}` };
  }

  tick(deltaSeconds, now = Date.now()) {
    this.expireDisconnected(now);
    const connected = this.connectedPlayers();
    if (!connected.length || this.phase === "MATCH_END") return;
    for (const player of this.players.values()) this.completeReload(player, now);
    if (this.phase === "BUY") {
      this.phaseRemaining = Math.max(0, this.phaseRemaining - deltaSeconds);
      if (connected.every((player) => player.ready) || this.phaseRemaining === 0) this.beginLive();
      return;
    }
    if (this.phase === "LIVE") {
      this.phaseRemaining = Math.max(0, this.phaseRemaining - deltaSeconds);
      this.updateBots(deltaSeconds, now);
      if (this.phaseRemaining === 0) this.endRound(this.timeoutWinner());
      return;
    }
    if (this.phase === "ROUND_END") {
      this.phaseRemaining = Math.max(0, this.phaseRemaining - deltaSeconds);
      if (this.phaseRemaining === 0) this.beginNextRound(now);
    }
  }

  snapshot(now = Date.now()) {
    return {
      roomCode: this.code,
      serverTime: now,
      phase: this.phase,
      phaseRemaining: Math.ceil(this.phaseRemaining),
      round: this.round,
      alphaRounds: this.alphaRounds,
      bravoRounds: this.bravoRounds,
      alphaLossTier: this.lossTiers.alpha,
      bravoLossTier: this.lossTiers.bravo,
      rematchVotes: this.rematchVotes.size,
      players: [...this.players.values()].map(publicPlayer),
      bots: this.bots.map((bot) => ({ id: bot.id, team: bot.team, position: { ...bot.position }, health: bot.health, alive: bot.alive, weaponId: bot.weaponId })),
      drops: [...this.drops.values()].map((drop) => ({ ...drop, position: { ...drop.position } })),
    };
  }

  connectedPlayers() {
    return [...this.players.values()].filter((player) => player.connected);
  }

  beginLive() {
    if (this.phase !== "BUY") return;
    this.phase = "LIVE";
    this.phaseRemaining = 120;
    for (const player of this.players.values()) player.ready = false;
  }

  endRound(winnerTeam) {
    if (this.phase !== "LIVE") return;
    if (winnerTeam === "alpha") this.alphaRounds += 1;
    if (winnerTeam === "bravo") this.bravoRounds += 1;
    for (const player of this.players.values()) {
      const won = player.team === winnerTeam;
      const reward = winnerTeam === null ? 1900 : won ? 3250 : [1900, 2400, 2900, 3400][this.lossTiers[player.team]];
      player.balance = Math.min(16_000, player.balance + reward);
    }
    for (const team of TEAMS) {
      if (winnerTeam === null) continue;
      this.lossTiers[team] = team === winnerTeam ? Math.max(0, this.lossTiers[team] - 1) : Math.min(3, this.lossTiers[team] + 1);
    }
    if (this.alphaRounds >= 7 || this.bravoRounds >= 7) {
      this.phase = "MATCH_END";
      this.phaseRemaining = 0;
      this.rematchVotes.clear();
    } else {
      this.phase = "ROUND_END";
      this.phaseRemaining = 6;
    }
  }

  beginNextRound(now = Date.now()) {
    this.round += 1;
    this.phase = "BUY";
    this.phaseRemaining = 20;
    this.rebalanceBots(true);
    this.drops.clear();
    for (const player of this.players.values()) resetPlayerForRound(player, now);
  }

  resetMatch(now = Date.now()) {
    this.phase = "BUY";
    this.phaseRemaining = 20;
    this.round = 1;
    this.alphaRounds = 0;
    this.bravoRounds = 0;
    this.lossTiers = { alpha: 0, bravo: 0 };
    this.rebalanceBots(true);
    this.drops.clear();
    this.rematchVotes.clear();
    for (const player of this.players.values()) {
      player.balance = 800;
      player.armor = 0;
      player.helmet = false;
      player.weaponId = "px9";
      resetPlayerForRound(player, now);
    }
  }

  updateBots(deltaSeconds, now) {
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      const enemies = [
        ...this.connectedPlayers().filter((player) => player.alive && player.team !== bot.team).map((entity) => ({ kind: "player", entity })),
        ...this.bots.filter((candidate) => candidate.alive && candidate.team !== bot.team).map((entity) => ({ kind: "bot", entity })),
      ];
      if (!enemies.length) continue;
      const target = enemies.reduce((nearest, candidate) => distance(candidate.entity.position, bot.position) < distance(nearest.entity.position, bot.position) ? candidate : nearest);
      const targetDistance = distance(bot.position, target.entity.position);
      if (targetDistance > 8) moveBotToward(bot, target.entity.position, deltaSeconds * 1.35);
      if (targetDistance <= 20 && now >= bot.nextShotAt) {
        bot.nextShotAt = now + 850 + bot.index * 90;
        const origin = { x: bot.position.x, y: bot.position.y + 0.72, z: bot.position.z };
        const shotDirection = normalize(subtract(target.entity.position, origin));
        const wallDistance = nearestColliderHit(origin, shotDirection, targetDistance);
        if (wallDistance !== null && wallDistance < targetDistance - 0.5) continue;
        if (deterministicChance(now, bot.index) < Math.max(0.18, 0.58 - targetDistance * 0.015)) {
          const hit = nearestCombatantHit(origin, shotDirection, this.players, this.bots, bot.id);
          if (!hit || hit.team === bot.team) continue;
          const victim = hit.entity;
          const wasAlive = victim.alive;
          if (hit.kind === "player") damagePlayer(victim, Math.max(12, Math.round(WEAPON_CATALOG[bot.weaponId].damage * 0.55)), { headshot: hit.zone === "head", armorPenetration: WEAPON_CATALOG[bot.weaponId].armorPenetration });
          else {
            victim.health = Math.max(0, victim.health - Math.max(12, Math.round(WEAPON_CATALOG[bot.weaponId].damage * 0.55)));
            if (victim.health === 0) victim.alive = false;
          }
          if (wasAlive && !victim.alive) {
            if (hit.kind === "player") this.dropPlayerWeapon(victim);
            else {
              const weapon = WEAPON_CATALOG[victim.weaponId];
              this.createDrop(victim.weaponId, weapon.magazineSize, Math.floor(weapon.reserveAmmo * 0.5), botDropPosition(victim));
            }
          }
        }
      }
    }
    this.evaluateElimination();
  }

  chooseTeam() {
    const counts = Object.fromEntries(TEAMS.map((team) => [team, [...this.players.values()].filter((player) => player.team === team).length]));
    if (counts.alpha !== counts.bravo) return counts.alpha < counts.bravo ? "alpha" : "bravo";
    return "alpha";
  }

  rebalanceBots(reset = false) {
    const humanCounts = Object.fromEntries(TEAMS.map((team) => [team, [...this.players.values()].filter((player) => player.team === team).length]));
    const squadSize = Math.max(2, Math.max(humanCounts.alpha, humanCounts.bravo) + 1);
    const existing = new Map(this.bots.map((bot) => [bot.id, bot]));
    const nextBots = [];
    for (const team of TEAMS) {
      const occupied = new Set([...this.players.values()].filter((player) => player.team === team).map((player) => player.spawnIndex));
      const slots = TEAM_SPAWNS[team].map((_, index) => index).filter((index) => !occupied.has(index)).slice(0, squadSize - humanCounts[team]);
      for (const slot of slots) {
        const id = `bot-${team}-${slot + 1}`;
        const bot = existing.get(id) ?? createBot(team, slot);
        if (reset) resetBotForRound(bot);
        nextBots.push(bot);
      }
    }
    this.bots = nextBots;
  }

  evaluateElimination() {
    if (this.phase !== "LIVE") return;
    const alphaAlive = this.teamStrength("alpha").alive;
    const bravoAlive = this.teamStrength("bravo").alive;
    if (alphaAlive === 0 && bravoAlive === 0) this.endRound(null);
    else if (alphaAlive === 0) this.endRound("bravo");
    else if (bravoAlive === 0) this.endRound("alpha");
  }

  timeoutWinner() {
    const alpha = this.teamStrength("alpha");
    const bravo = this.teamStrength("bravo");
    if (alpha.alive !== bravo.alive) return alpha.alive > bravo.alive ? "alpha" : "bravo";
    if (alpha.health !== bravo.health) return alpha.health > bravo.health ? "alpha" : "bravo";
    return null;
  }

  teamStrength(team) {
    const members = [
      ...this.connectedPlayers().filter((player) => player.team === team && player.alive),
      ...this.bots.filter((bot) => bot.team === team && bot.alive),
    ];
    return { alive: members.length, health: members.reduce((total, member) => total + member.health, 0) };
  }

  dropPlayerWeapon(player) {
    if (player.weaponId === "px9") return null;
    const dropped = this.createDrop(player.weaponId, player.magazine, player.reserve, dropPositionForPlayer(player));
    equipWeapon(player, "px9");
    return dropped;
  }

  createDrop(weaponId, magazine, reserve, position) {
    const weapon = WEAPON_CATALOG[weaponId];
    if (!weapon || weaponId === "px9") return null;
    const id = `drop-${this.nextDropId++}`;
    const dropped = { id, weaponId, magazine: clamp(magazine, 0, weapon.magazineSize), reserve: clamp(reserve, 0, weapon.reserveAmmo), position: { ...position } };
    this.drops.set(id, dropped);
    return dropped;
  }

  completeReload(player, now) {
    if (player.reloadCompletesAt === null || now < player.reloadCompletesAt) return false;
    const weapon = WEAPON_CATALOG[player.weaponId];
    const loaded = Math.min(weapon.magazineSize - player.magazine, player.reserve);
    player.magazine += loaded;
    player.reserve -= loaded;
    player.reloadCompletesAt = null;
    return true;
  }
}

function createBot(team, slot) {
  const spawn = TEAM_SPAWNS[team][slot] ?? TEAM_SPAWNS[team][0];
  return {
    id: `bot-${team}-${slot + 1}`,
    team,
    slot,
    index: (team === "alpha" ? 0 : 4) + slot,
    level: "ground",
    position: { x: spawn.x, y: 1, z: spawn.z },
    health: 100,
    alive: true,
    weaponId: slot === 1 ? "vx7" : "px9",
    nextShotAt: 0,
  };
}

function resetBotForRound(bot) {
  const spawn = TEAM_SPAWNS[bot.team][bot.slot] ?? TEAM_SPAWNS[bot.team][0];
  bot.position = { x: spawn.x, y: 1, z: spawn.z };
  bot.health = 100;
  bot.alive = true;
  bot.nextShotAt = 0;
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    team: player.team,
    position: { ...player.position },
    yaw: player.yaw,
    pitch: player.pitch,
    health: player.health,
    armor: player.armor,
    helmet: player.helmet,
    balance: player.balance,
    weaponId: player.weaponId,
    magazine: player.magazine,
    reserve: player.reserve,
    reloading: player.reloadCompletesAt !== null,
    alive: player.alive,
    ready: player.ready,
    connected: player.connected,
  };
}

function resetPlayerForRound(player, now) {
  if (!player.alive) {
    player.weaponId = "px9";
    player.armor = 0;
    player.helmet = false;
  }
  const spawn = TEAM_SPAWNS[player.team][player.spawnIndex] ?? TEAM_SPAWNS[player.team][0];
  const weapon = WEAPON_CATALOG[player.weaponId];
  player.position = { ...spawn };
  player.yaw = player.team === "alpha" ? 0 : Math.PI;
  player.health = 100;
  player.magazine = weapon.magazineSize;
  player.reserve = weapon.reserveAmmo;
  player.alive = true;
  player.ready = false;
  player.lastInputAt = now;
  player.lastSequence = -1;
  player.movementCredit = 0;
  player.lastShotAt = -Infinity;
  player.reloadCompletesAt = null;
}

function equipWeapon(player, weaponId) {
  const weapon = WEAPON_CATALOG[weaponId];
  player.weaponId = weaponId;
  player.magazine = weapon.magazineSize;
  player.reserve = weapon.reserveAmmo;
  player.reloadCompletesAt = null;
}

function damagePlayer(player, rawDamage, { headshot = false, armorPenetration = 0.5 } = {}) {
  let damage = player.helmet && headshot ? Math.ceil(rawDamage * 0.7) : rawDamage;
  if (player.armor > 0) {
    const absorbed = Math.min(player.armor, Math.ceil(damage * (1 - armorPenetration) * 0.5));
    player.armor -= absorbed;
    damage -= absorbed;
  }
  player.health = Math.max(0, player.health - Math.max(1, Math.round(damage)));
  if (player.health === 0) player.alive = false;
}

function moveBotToward(bot, target, distanceToMove) {
  if (bot.level === "bridge") {
    const bridgeTarget = { x: clamp(target.x, -5, 5), y: bot.position.y, z: clamp(target.z, 15, 19) };
    moveBotCandidate(bot, bridgeTarget, distanceToMove);
    return;
  }
  moveBotCandidate(bot, { x: target.x, y: bot.position.y, z: target.z }, distanceToMove);
}

function moveBotCandidate(bot, target, distanceToMove) {
  const delta = subtract(target, bot.position);
  delta.y = 0;
  const length = vectorLength(delta);
  if (length < 0.001) return;
  const step = Math.min(length, distanceToMove);
  const direct = add(bot.position, scale(delta, step / length));
  if (sweptPositionIsClear(bot.position, direct, 0.42)) {
    bot.position = direct;
    return;
  }
  const candidates = [
    { x: bot.position.x + step, y: bot.position.y, z: bot.position.z },
    { x: bot.position.x - step, y: bot.position.y, z: bot.position.z },
    { x: bot.position.x, y: bot.position.y, z: bot.position.z + step },
    { x: bot.position.x, y: bot.position.y, z: bot.position.z - step },
  ].filter((candidate) => isWithinArena(candidate) && sweptPositionIsClear(bot.position, candidate, 0.42));
  candidates.sort((a, b) => distance(a, target) - distance(b, target));
  if (candidates[0]) bot.position = candidates[0];
}

function nearestCombatantHit(origin, direction, players, bots, excludedId) {
  let result = null;
  const combatants = [
    ...[...players.values()].filter((player) => player.connected).map((entity) => ({ kind: "player", entity })),
    ...bots.map((entity) => ({ kind: "bot", entity })),
  ];
  for (const { kind, entity } of combatants) {
    if (!entity.alive || entity.id === excludedId) continue;
    const headCenter = kind === "player"
      ? { x: entity.position.x, y: entity.position.y, z: entity.position.z }
      : { x: entity.position.x, y: entity.position.y + 1.12, z: entity.position.z };
    const bodyCenter = kind === "player"
      ? { x: entity.position.x, y: entity.position.y - 0.62, z: entity.position.z }
      : { x: entity.position.x, y: entity.position.y + 0.45, z: entity.position.z };
    const headAlong = raySphereDistance(origin, direction, headCenter, 0.3);
    const bodyAlong = raySphereDistance(origin, direction, bodyCenter, 0.7);
    const candidate = headAlong !== null
      ? { kind, entity, team: entity.team, zone: "head", along: headAlong }
      : bodyAlong !== null ? { kind, entity, team: entity.team, zone: "body", along: bodyAlong } : null;
    if (candidate && candidate.along <= 120 && (!result || candidate.along < result.along)) result = candidate;
  }
  return result;
}

function raySphereDistance(origin, direction, center, radius) {
  const toCenter = subtract(center, origin);
  const projected = dot(toCenter, direction);
  const closestSquared = dot(toCenter, toCenter) - projected * projected;
  const radiusSquared = radius * radius;
  if (closestSquared > radiusSquared) return null;
  const offset = Math.sqrt(Math.max(0, radiusSquared - closestSquared));
  const near = projected - offset;
  const far = projected + offset;
  if (far < 0) return null;
  return Math.max(0, near);
}

function applySpread(direction, spread, seedText) {
  const first = seededUnit(seedText);
  const second = seededUnit(`${seedText}:y`);
  return normalize({ x: direction.x + (first * 2 - 1) * spread, y: direction.y + (second * 2 - 1) * spread, z: direction.z + ((first + second) - 1) * spread * 0.25 });
}

function seededUnit(value) {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0) / 0x1_0000_0000;
}

function firstAvailableSpawnIndex(players, team) {
  const used = new Set([...players.values()].filter((player) => player.team === team).map((player) => player.spawnIndex));
  return TEAM_SPAWNS[team].findIndex((_, index) => !used.has(index));
}

function dropPositionForPlayer(player) {
  return { x: player.position.x, y: Math.max(0.24, player.position.y - 1.4), z: player.position.z };
}

function botDropPosition(bot) {
  return { x: bot.position.x, y: Math.max(0.24, bot.position.y - 0.68), z: bot.position.z };
}

function collider(dimensions, position) {
  return {
    min: { x: position[0] - dimensions[0] / 2, y: position[1] - dimensions[1] / 2, z: position[2] - dimensions[2] / 2 },
    max: { x: position[0] + dimensions[0] / 2, y: position[1] + dimensions[1] / 2, z: position[2] + dimensions[2] / 2 },
  };
}

function isWithinArena(position) {
  return Math.abs(position.x) <= 19.5 && position.z >= -24.5 && position.z <= 24.5;
}

function isPlausiblePlayerHeight(position) {
  return position.y >= 1 && position.y <= 2.8;
}

function sweptPositionIsClear(from, to, padding) {
  const travel = distance(from, to);
  const steps = Math.max(1, Math.ceil(travel / 0.18));
  for (let index = 1; index <= steps; index += 1) {
    const amount = index / steps;
    const point = { x: from.x + (to.x - from.x) * amount, y: from.y + (to.y - from.y) * amount, z: from.z + (to.z - from.z) * amount };
    if (isInsideArenaCollider(point, padding)) return false;
  }
  return true;
}

function isInsideArenaCollider(position, padding) {
  return ARENA_COLLIDERS.some(({ min, max }) => position.x >= min.x - padding && position.x <= max.x + padding
    && position.y >= min.y && position.y <= max.y + 0.2
    && position.z >= min.z - padding && position.z <= max.z + padding);
}

function nearestColliderHit(origin, direction, maxDistance) {
  let nearest = null;
  for (const bounds of ARENA_COLLIDERS) {
    const hit = rayBoxDistance(origin, direction, bounds);
    if (hit !== null && hit <= maxDistance && (nearest === null || hit < nearest)) nearest = hit;
  }
  return nearest;
}

function rayBoxDistance(origin, direction, { min, max }) {
  let near = 0;
  let far = Infinity;
  for (const axis of ["x", "y", "z"]) {
    if (Math.abs(direction[axis]) < 1e-8) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) return null;
      continue;
    }
    const first = (min[axis] - origin[axis]) / direction[axis];
    const second = (max[axis] - origin[axis]) / direction[axis];
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
    if (near > far) return null;
  }
  return far >= 0 ? near : null;
}

function sanitizeName(value) {
  const name = String(value ?? "Operator").trim().slice(0, 18).replace(/[^\p{L}\p{N}_\- ]/gu, "");
  return name || "Operator";
}

function finiteNumber(value, fallback, min, max) {
  return Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

function isFiniteVector(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function vectorLength(value) { return Math.hypot(value.x, value.y, value.z); }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
function subtract(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function scale(a, amount) { return { x: a.x * amount, y: a.y * amount, z: a.z * amount }; }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function normalize(value) {
  const length = vectorLength(value);
  return length > 0 ? scale(value, 1 / length) : { x: 0, y: 0, z: 0 };
}
function deterministicChance(now, index) {
  const value = Math.sin(Math.floor(now / 100) * 12.9898 + index * 78.233) * 43758.5453;
  return value - Math.floor(value);
}
