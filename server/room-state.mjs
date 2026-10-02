import { randomUUID } from "node:crypto";
import { ARENA_BOUNDS, ARENA_BOXES, BOMB_SITES, COMPETITIVE_RULES, MAP_NAV_POINTS, TEAM_SPAWNS, WEAPON_CATALOG } from "../src/shared/game-data.mjs";

export const RECONNECT_GRACE_MS = 15_000;
export const EMPTY_ROOM_TTL_MS = 60_000;

const MAX_PLAYER_SPEED = 7;
const MAX_INPUT_GAP_SECONDS = 0.25;
const PLAYER_RADIUS = 0.35;
const BOT_RADIUS = 0.42;
const INTERACTION_MOVE_TOLERANCE = 0.03;
const MOVEMENT_SPREAD_WINDOW_MS = 150;
const MOVEMENT_SPREAD_DISTANCE = 0.025;
const MAX_SHOT_DISTANCE = Math.hypot(ARENA_BOUNDS.maxX - ARENA_BOUNDS.minX, ARENA_BOUNDS.maxZ - ARENA_BOUNDS.minZ);
const BOT_VIEW_DISTANCE = 36;
const BOT_MEMORY_MS = 2_400;
const BOT_REACTION_MS = 360;
const TEAMS = ["alpha", "bravo"];
const ARENA_COLLIDERS = ARENA_BOXES.map((item) => collider(item.dimensions, item.position));
const NAV_POINT_BY_ID = new Map(MAP_NAV_POINTS.map((point) => [point.id, point]));

export class RoomState {
  constructor(code, now = Date.now()) {
    this.code = code;
    this.createdAt = now;
    this.lastActivityAt = now;
    this.lastPlayerLeftAt = null;
    this.players = new Map();
    this.phase = "BUY";
    this.phaseRemaining = COMPETITIVE_RULES.buySeconds;
    this.round = 1;
    this.attackingTeam = "alpha";
    this.defendingTeam = "bravo";
    this.bomb = emptyBomb();
    this.bombInteraction = null;
    this.bombPlantedAt = null;
    this.lastRoundReason = null;
    this.alphaRounds = 0;
    this.bravoRounds = 0;
    this.lossTiers = { alpha: 0, bravo: 0 };
    this.bots = [];
    this.drops = new Map();
    this.nextDropId = 1;
    this.rematchVotes = new Set();
  }

  addPlayer(name, now = Date.now()) {
    if (this.players.size >= COMPETITIVE_RULES.maxPlayers) return null;
    const id = randomUUID();
    const team = this.chooseTeam();
    const spawnIndex = firstAvailableSpawnIndex(this.players, team);
    const spawn = this.spawnForTeam(team, spawnIndex);
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
      hasDefuseKit: false,
      balance: 800,
      weaponId: "px9",
      primaryWeaponId: null,
      secondaryWeaponId: "px9",
      activeSlot: "secondary",
      primaryAmmo: null,
      secondaryAmmo: { magazine: weapon.magazineSize, reserve: weapon.reserveAmmo },
      magazine: weapon.magazineSize,
      reserve: weapon.reserveAmmo,
      alive: this.phase !== "LIVE",
      ready: false,
      connected: true,
      disconnectedAt: null,
      lastInputAt: now,
      lastSequence: -1,
      movementCredit: 0,
      movementWindowStartedAt: now,
      movementWindowDistance: 0,
      movingUntil: 0,
      lastShotAt: -Infinity,
      reloadCompletesAt: null,
      processedShots: new Set(),
    };
    this.players.set(id, player);
    if (this.phase !== "LIVE") {
      this.rebalanceBots();
      this.assignBombCarrier();
    }
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
    player.movementWindowStartedAt = now;
    player.movementWindowDistance = 0;
    player.movingUntil = 0;
    this.lastPlayerLeftAt = null;
    this.lastActivityAt = now;
    return player;
  }

  markDisconnected(playerId, now = Date.now()) {
    this.processBomb(now);
    const player = this.players.get(playerId);
    if (!player || !player.connected) return false;
    player.connected = false;
    player.disconnectedAt = now;
    player.ready = false;
    this.cancelBombInteraction(playerId);
    if (this.bomb.carrierId === playerId) this.dropBomb(player.position);
    this.rematchVotes.delete(playerId);
    if (![...this.players.values()].some((candidate) => candidate.connected)) this.lastPlayerLeftAt = now;
    return true;
  }

  removePlayer(playerId, now = Date.now()) {
    this.processBomb(now);
    const player = this.players.get(playerId);
    if (!player) return false;
    if (this.phase === "LIVE") this.dropPlayerWeapon(player);
    this.cancelBombInteraction(playerId);
    if (this.bomb.carrierId === playerId) this.dropBomb(player.position);
    this.rematchVotes.delete(playerId);
    this.players.delete(playerId);
    if (this.phase !== "LIVE") {
      this.rebalanceBots();
      this.assignBombCarrier();
    }
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
    this.processBomb(now);
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
    if (now < player.movementWindowStartedAt || now - player.movementWindowStartedAt > MOVEMENT_SPREAD_WINDOW_MS) {
      player.movementWindowStartedAt = now;
      player.movementWindowDistance = 0;
    }
    player.movementWindowDistance += travel;
    player.position = { x: candidate.x, y: candidate.y, z: candidate.z };
    if (this.bomb.carrierId === playerId) this.bomb.position = bombPosition(player.position);
    if (this.bombInteraction?.actorId === playerId && (travel > 0.025 || !this.interactionIsValid())) this.cancelBombInteraction(playerId);
    player.yaw = finiteNumber(input.yaw, player.yaw, -Math.PI * 4, Math.PI * 4);
    player.pitch = finiteNumber(input.pitch, player.pitch, -1.55, 1.55);
    if (travel > 0.0001 && player.movementWindowDistance > MOVEMENT_SPREAD_DISTANCE) player.movingUntil = now + MOVEMENT_SPREAD_WINDOW_MS;
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
    if (itemId === "defuse-kit") {
      if (player.team !== this.defendingTeam) return { ok: false, message: "仅防守方可购买拆弹钳" };
      if (player.hasDefuseKit) return { ok: false, message: "已拥有拆弹钳" };
      if (player.balance < 400) return { ok: false, message: "余额不足" };
      player.balance -= 400;
      player.hasDefuseKit = true;
      return { ok: true, message: "已购买拆弹钳" };
    }
    const weapon = WEAPON_CATALOG[itemId];
    if (!weapon) return { ok: false, message: "未知装备" };
    if (player[weapon.slot === "primary" ? "primaryWeaponId" : "secondaryWeaponId"] === itemId) return { ok: false, message: "已拥有该武器" };
    if ((this.round === 1 || this.round === COMPETITIVE_RULES.halfRounds + 1) && weapon.slot === "primary") return { ok: false, message: "手枪局禁止购买主武器" };
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
    this.cancelBombInteraction(playerId);
    player.reloadCompletesAt = now + weapon.reloadMs;
    return { ok: true, message: "正在更换弹匣" };
  }

  switchWeapon(playerId, slot) {
    const player = this.players.get(playerId);
    if (!player?.connected || !player.alive || !["BUY", "LIVE"].includes(this.phase) || !["primary", "secondary"].includes(slot)) return { ok: false, message: "当前无法切换武器" };
    saveActiveWeapon(player);
    const weaponId = slot === "primary" ? player.primaryWeaponId : player.secondaryWeaponId;
    if (!weaponId) return { ok: false, message: "该栏位没有武器" };
    this.cancelBombInteraction(playerId);
    activateWeaponSlot(player, slot);
    return { ok: true, message: `已切换至 ${WEAPON_CATALOG[weaponId].displayName}` };
  }

  dropWeapon(playerId) {
    const player = this.players.get(playerId);
    if (!player?.connected || !player.alive || this.phase !== "LIVE") return { ok: false, message: "当前武器无法丢弃" };
    if (player.weaponId === "px9") return { ok: false, message: "当前武器无法丢弃" };
    this.cancelBombInteraction(playerId);
    const dropped = this.dropPlayerWeapon(player);
    return dropped ? { ok: true, message: `已丢弃 ${WEAPON_CATALOG[dropped.weaponId].displayName}` } : { ok: false, message: "当前武器无法丢弃" };
  }

  dropCarriedBomb(playerId) {
    const player = this.players.get(playerId);
    if (!player?.connected || !player.alive || this.phase !== "LIVE" || player.team !== this.attackingTeam || this.bomb.carrierId !== playerId) return { ok: false, message: "当前没有可丢弃的 C4" };
    this.dropBomb(player.position);
    return { ok: true, message: "已丢弃 C4" };
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

    this.cancelBombInteraction(playerId);
    this.drops.delete(dropped.id);
    saveActiveWeapon(player);
    const slot = WEAPON_CATALOG[dropped.weaponId].slot;
    const existingId = slot === "primary" ? player.primaryWeaponId : player.secondaryWeaponId;
    const existingAmmo = slot === "primary" ? player.primaryAmmo : player.secondaryAmmo;
    if (existingId && existingId !== "px9") this.createDrop(existingId, existingAmmo.magazine, existingAmmo.reserve, dropPositionForPlayer(player));
    if (slot === "primary") {
      player.primaryWeaponId = dropped.weaponId;
      player.primaryAmmo = { magazine: dropped.magazine, reserve: dropped.reserve };
    } else {
      player.secondaryWeaponId = dropped.weaponId;
      player.secondaryAmmo = { magazine: dropped.magazine, reserve: dropped.reserve };
    }
    activateWeaponSlot(player, slot);
    return { ok: true, message: `已拾取 ${WEAPON_CATALOG[dropped.weaponId].displayName}` };
  }

  fire(playerId, message, now = Date.now()) {
    this.processBomb(now);
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
    this.cancelBombInteraction(playerId);
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
      const wallDistance = nearestColliderHit(origin, direction, MAX_SHOT_DISTANCE);
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
      this.cancelBombInteraction(target.id);
      if (hit.kind === "player") this.dropPlayerWeapon(target);
      else {
        if (this.bomb.carrierId === target.id) this.dropBomb(target.position);
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
      this.processBomb(now);
      if (this.phase !== "LIVE") return;
      this.updateBots(deltaSeconds, now);
      this.processBomb(now);
      if (this.phase === "LIVE" && this.phaseRemaining === 0 && !this.isBombPlanted()) this.endRound(this.defendingTeam, "time_expired");
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
      attackingTeam: this.attackingTeam,
      defendingTeam: this.defendingTeam,
      bomb: { ...this.bomb, position: { ...this.bomb.position } },
      lastRoundReason: this.lastRoundReason,
      alphaRounds: this.alphaRounds,
      bravoRounds: this.bravoRounds,
      alphaLossTier: this.lossTiers.alpha,
      bravoLossTier: this.lossTiers.bravo,
      rematchVotes: this.rematchVotes.size,
      players: [...this.players.values()].map(publicPlayer),
      bots: this.bots.map(publicBot),
      drops: [...this.drops.values()].map((drop) => ({ ...drop, position: { ...drop.position } })),
    };
  }

  connectedPlayers() {
    return [...this.players.values()].filter((player) => player.connected);
  }

  beginLive() {
    if (this.phase !== "BUY") return;
    this.phase = "LIVE";
    this.phaseRemaining = COMPETITIVE_RULES.roundSeconds;
    this.assignBombCarrier();
    for (const player of this.players.values()) player.ready = false;
  }

  endRound(winnerTeam, reason = "elimination") {
    if (this.phase !== "LIVE") return;
    this.bombInteraction = null;
    this.lastRoundReason = reason;
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
    if (this.alphaRounds >= COMPETITIVE_RULES.roundsToWin || this.bravoRounds >= COMPETITIVE_RULES.roundsToWin) {
      this.phase = "MATCH_END";
      this.phaseRemaining = 0;
      this.rematchVotes.clear();
    } else {
      this.phase = "ROUND_END";
      this.phaseRemaining = COMPETITIVE_RULES.roundEndSeconds;
    }
  }

  beginNextRound(now = Date.now()) {
    this.round += 1;
    if (this.round === COMPETITIVE_RULES.halfRounds + 1) {
      this.attackingTeam = "bravo";
      this.defendingTeam = "alpha";
      this.lossTiers = { alpha: 0, bravo: 0 };
      for (const player of this.players.values()) resetPlayerEconomy(player);
    }
    this.phase = "BUY";
    this.phaseRemaining = COMPETITIVE_RULES.buySeconds;
    this.rebalanceBots(true);
    this.drops.clear();
    this.bomb = emptyBomb();
    this.bombInteraction = null;
    this.bombPlantedAt = null;
    this.lastRoundReason = null;
    for (const player of this.players.values()) resetPlayerForRound(player, this.spawnForTeam(player.team, player.spawnIndex), now);
    this.assignBombCarrier();
  }

  resetMatch(now = Date.now()) {
    this.phase = "BUY";
    this.phaseRemaining = COMPETITIVE_RULES.buySeconds;
    this.round = 1;
    this.attackingTeam = "alpha";
    this.defendingTeam = "bravo";
    this.bomb = emptyBomb();
    this.bombInteraction = null;
    this.bombPlantedAt = null;
    this.lastRoundReason = null;
    this.alphaRounds = 0;
    this.bravoRounds = 0;
    this.lossTiers = { alpha: 0, bravo: 0 };
    this.rebalanceBots(true);
    this.drops.clear();
    this.rematchVotes.clear();
    for (const player of this.players.values()) {
      resetPlayerEconomy(player);
      resetPlayerForRound(player, this.spawnForTeam(player.team, player.spawnIndex), now);
    }
    this.assignBombCarrier();
  }

  spawnForTeam(team, slot) {
    const spawnSide = team === this.attackingTeam ? "alpha" : "bravo";
    return TEAM_SPAWNS[spawnSide][slot] ?? TEAM_SPAWNS[spawnSide][0];
  }

  siteAt(position) {
    return Object.entries(BOMB_SITES).find(([, site]) => planarDistance(position, site) <= site.radius)?.[0] ?? null;
  }

  isBombPlanted() {
    return this.bomb.status === "planted" || this.bomb.status === "defusing";
  }

  assignBombCarrier() {
    if (this.phase !== "BUY" && this.phase !== "LIVE") return;
    const candidates = [
      ...this.connectedPlayers().filter((player) => player.team === this.attackingTeam && player.alive),
      ...this.bots.filter((bot) => bot.team === this.attackingTeam && bot.alive),
    ];
    const carrier = candidates[0];
    if (!carrier) {
      this.bomb = { ...emptyBomb(), position: bombPosition(this.spawnForTeam(this.attackingTeam, 0)) };
      return;
    }
    this.bomb = { ...emptyBomb(), status: "carried", carrierId: carrier.id, position: bombPosition(carrier.position) };
  }

  dropBomb(position) {
    if (!this.bomb.carrierId) return;
    this.bombInteraction = null;
    this.bomb = { ...this.bomb, status: "dropped", carrierId: null, planterId: null, site: null, progress: 0, position: bombPosition(position) };
  }

  pickupBomb(actorId) {
    const actor = this.findCombatant(actorId);
    if (!actor?.alive || actor.team !== this.attackingTeam || this.bomb.status !== "dropped" || planarDistance(actor.position, this.bomb.position) > 2) return false;
    const pickupDistance = distance(actor.position, this.bomb.position);
    const direction = normalize(subtract(this.bomb.position, actor.position));
    const wallDistance = nearestColliderHit(actor.position, direction, pickupDistance);
    if (wallDistance !== null && wallDistance < pickupDistance - 0.2) return false;
    this.bomb = { ...this.bomb, status: "carried", carrierId: actorId, position: bombPosition(actor.position) };
    return true;
  }

  interact(playerId, active, now = Date.now()) {
    this.processBomb(now);
    const player = this.players.get(playerId);
    if (!player?.connected || !player.alive || this.phase !== "LIVE") return { ok: false, message: "当前无法交互" };
    if (!active) {
      this.cancelBombInteraction(playerId);
      return { ok: true, message: "已停止交互" };
    }
    if (player.team === this.attackingTeam) {
      if (this.pickupBomb(playerId)) return { ok: true, message: "已拾取 C4" };
      if (this.bomb.carrierId === playerId && this.siteAt(player.position)) {
        if (this.beginBombInteraction(playerId, "plant", now)) return { ok: true, message: "正在安放 C4" };
      }
      return { ok: false, message: "需要携带 C4 并进入爆破点" };
    }
    if (this.isBombPlanted() && planarDistance(player.position, this.bomb.position) <= 2.5) {
      if (this.beginBombInteraction(playerId, "defuse", now)) return { ok: true, message: "正在拆除 C4" };
    }
    return { ok: false, message: "需要靠近已安放的 C4" };
  }

  beginBombInteraction(actorId, kind, now) {
    if (this.bombInteraction) return false;
    const actor = this.findCombatant(actorId);
    if (!actor?.alive || ("connected" in actor && !actor.connected) || this.phase !== "LIVE") return false;
    if (kind === "plant") {
      const site = this.siteAt(actor.position);
      if (actor.team !== this.attackingTeam || this.bomb.carrierId !== actorId || !site) return false;
      this.cancelReloadForInteraction(actor, now);
      this.bombInteraction = { actorId, kind, startedAt: now, site, startedPosition: { ...actor.position } };
      this.bomb.status = "planting";
      this.bomb.site = site;
      this.bomb.planterId = actorId;
      this.bomb.progress = 0;
      return true;
    }
    if (kind === "defuse" && actor.team === this.defendingTeam && this.isBombPlanted() && planarDistance(actor.position, this.bomb.position) <= 2.5) {
      this.cancelReloadForInteraction(actor, now);
      this.bombInteraction = { actorId, kind, startedAt: now, site: this.bomb.site, startedPosition: { ...actor.position } };
      this.bomb.status = "defusing";
      this.bomb.defuserId = actorId;
      this.bomb.progress = 0;
      return true;
    }
    return false;
  }

  cancelReloadForInteraction(actor, now) {
    if (!("reloadCompletesAt" in actor)) return;
    this.completeReload(actor, now);
    actor.reloadCompletesAt = null;
  }

  cancelBombInteraction(actorId) {
    if (this.bombInteraction?.actorId !== actorId) return false;
    if (this.bombInteraction.kind === "plant") {
      this.bomb.status = "carried";
      this.bomb.site = null;
      this.bomb.planterId = null;
    } else {
      this.bomb.status = "planted";
      this.bomb.defuserId = null;
    }
    this.bomb.progress = 0;
    this.bombInteraction = null;
    return true;
  }

  interactionIsValid() {
    const interaction = this.bombInteraction;
    if (!interaction) return false;
    const actor = this.findCombatant(interaction.actorId);
    if (!actor?.alive || ("connected" in actor && !actor.connected)) return false;
    if (distance(actor.position, interaction.startedPosition) > INTERACTION_MOVE_TOLERANCE) return false;
    if (interaction.kind === "plant") return actor.team === this.attackingTeam && this.bomb.carrierId === actor.id && this.siteAt(actor.position) === interaction.site;
    return actor.team === this.defendingTeam && this.isBombPlanted() && planarDistance(actor.position, this.bomb.position) <= 2.5;
  }

  processBomb(now) {
    if (this.phase !== "LIVE") return;
    const carrier = this.bomb.carrierId ? this.findCombatant(this.bomb.carrierId) : null;
    if (carrier?.alive) this.bomb.position = bombPosition(carrier.position);
    else if (this.bomb.carrierId) this.dropBomb(this.bomb.position);
    if (this.isBombPlanted() && this.bombPlantedAt !== null) {
      const remaining = Math.max(0, COMPETITIVE_RULES.bombSeconds - (now - this.bombPlantedAt) / 1000);
      this.bomb.remainingSeconds = remaining;
      this.phaseRemaining = remaining;
      const interaction = this.bombInteraction;
      const defuser = interaction?.kind === "defuse" ? this.findCombatant(interaction.actorId) : null;
      const defuseDuration = defuser?.hasDefuseKit ? COMPETITIVE_RULES.kitDefuseSeconds : COMPETITIVE_RULES.defuseSeconds;
      const defuseFinishAt = interaction?.kind === "defuse" ? interaction.startedAt + defuseDuration * 1000 : Infinity;
      const defuseCompletesInTime = defuseFinishAt <= this.bombPlantedAt + COMPETITIVE_RULES.bombSeconds * 1000 && now >= defuseFinishAt && this.interactionIsValid();
      if (remaining === 0 && !defuseCompletesInTime) {
        this.bomb.status = "exploded";
        this.bomb.defuserId = null;
        this.bomb.progress = 0;
        this.endRound(this.attackingTeam, "bomb_exploded");
        return;
      }
    }
    if (!this.bombInteraction) return;
    if (!this.interactionIsValid()) {
      this.cancelBombInteraction(this.bombInteraction.actorId);
      return;
    }
    const { actorId, kind, startedAt, site } = this.bombInteraction;
    const actor = this.findCombatant(actorId);
    const duration = kind === "plant" ? COMPETITIVE_RULES.plantSeconds : actor.hasDefuseKit ? COMPETITIVE_RULES.kitDefuseSeconds : COMPETITIVE_RULES.defuseSeconds;
    this.bomb.progress = clamp((now - startedAt) / (duration * 1000), 0, 1);
    if (this.bomb.progress < 1) return;
    this.bombInteraction = null;
    if (kind === "plant") {
      this.bomb = { ...this.bomb, status: "planted", carrierId: null, site, position: bombPosition(actor.position), progress: 0, remainingSeconds: COMPETITIVE_RULES.bombSeconds };
      this.bombPlantedAt = now;
      this.phaseRemaining = COMPETITIVE_RULES.bombSeconds;
    } else {
      this.bomb.status = "defused";
      this.bomb.progress = 1;
      this.bomb.remainingSeconds = 0;
      this.endRound(this.defendingTeam, "bomb_defused");
    }
  }

  findCombatant(id) {
    return this.players.get(id) ?? this.bots.find((bot) => bot.id === id) ?? null;
  }

  botObjective(bot) {
    if (bot.team === this.defendingTeam && this.isBombPlanted()) return this.bomb.position;
    if (bot.team !== this.attackingTeam) return null;
    if (this.bomb.status === "dropped") return this.bomb.position;
    if (this.bomb.carrierId === bot.id) return bot.slot % 2 === 0 ? BOMB_SITES.A : BOMB_SITES.B;
    return null;
  }

  botWaypoint(bot, destination) {
    return nextNavigationWaypoint(bot.position, destination);
  }

  updateBots(deltaSeconds, now) {
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      const objective = this.botObjective(bot);
      const enemies = [
        ...[...this.players.values()].filter((player) => player.alive && player.team !== bot.team).map((entity) => ({ kind: "player", entity })),
        ...this.bots.filter((candidate) => candidate.alive && candidate.team !== bot.team).map((entity) => ({ kind: "bot", entity })),
      ];
      const target = this.chooseBotTarget(bot, enemies, now);
      const targetPosition = target?.position ?? null;
      const targetDistance = targetPosition ? distance(bot.position, targetPosition) : Infinity;
      const destination = objective ?? (targetPosition && (!target.visible || targetDistance > 8) ? targetPosition : target?.visible ? botCombatStep(bot, targetPosition, now) : null);
      if (destination && this.bombInteraction?.actorId !== bot.id) moveBotToward(bot, this.botWaypoint(bot, destination), deltaSeconds * 2.8);
      if (this.bomb.status === "dropped" && bot.team === this.attackingTeam && planarDistance(bot.position, this.bomb.position) <= 1.8) this.pickupBomb(bot.id);
      if (this.bomb.carrierId === bot.id && this.siteAt(bot.position) && !this.bombInteraction) this.beginBombInteraction(bot.id, "plant", now);
      if (bot.team === this.defendingTeam && this.isBombPlanted() && planarDistance(bot.position, this.bomb.position) <= 2.5 && !this.bombInteraction) this.beginBombInteraction(bot.id, "defuse", now);
      if (!target?.visible || targetDistance > BOT_VIEW_DISTANCE || now < target.visibleSince + BOT_REACTION_MS) continue;
      if (now >= bot.nextShotAt) {
        bot.nextShotAt = now + botShotInterval(bot);
        const origin = { x: bot.position.x, y: bot.position.y + 0.72, z: bot.position.z };
        const shotTarget = combatantAimPoint(target.kind, target.entity);
        const shotDirection = normalize(subtract(shotTarget, origin));
        const wallDistance = nearestColliderHit(origin, shotDirection, targetDistance);
        if (wallDistance !== null && wallDistance < targetDistance - 0.5) continue;
        bot.lastShotAt = now;
        bot.lastShotTarget = { ...shotTarget };
        if (deterministicChance(now, bot.index) < botHitChance(targetDistance)) {
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
            this.cancelBombInteraction(victim.id);
            if (hit.kind === "player") this.dropPlayerWeapon(victim);
            else {
              if (this.bomb.carrierId === victim.id) this.dropBomb(victim.position);
              const weapon = WEAPON_CATALOG[victim.weaponId];
              this.createDrop(victim.weaponId, weapon.magazineSize, Math.floor(weapon.reserveAmmo * 0.5), botDropPosition(victim));
            }
          }
        }
      }
    }
    this.evaluateElimination();
  }

  chooseBotTarget(bot, enemies, now) {
    const seen = [];
    const aliveEnemyIds = new Set(enemies.map((candidate) => candidate.entity.id));
    for (const key of [...bot.enemyMemory.keys()]) {
      const memory = bot.enemyMemory.get(key);
      if (!aliveEnemyIds.has(key) || now - memory.seenAt > BOT_MEMORY_MS) bot.enemyMemory.delete(key);
    }

    for (const candidate of enemies) {
      const visible = botCanSeeCombatant(bot, candidate.kind, candidate.entity);
      if (!visible) continue;
      const previous = bot.enemyMemory.get(candidate.entity.id);
      const position = combatantAimPoint(candidate.kind, candidate.entity);
      const memory = {
        kind: candidate.kind,
        entity: candidate.entity,
        position,
        seenAt: now,
        visibleSince: previous && now - previous.seenAt <= BOT_MEMORY_MS ? previous.visibleSince : now,
      };
      bot.enemyMemory.set(candidate.entity.id, memory);
      seen.push({ ...memory, visible: true });
    }

    if (seen.length) return seen.reduce((nearest, candidate) => distance(candidate.position, bot.position) < distance(nearest.position, bot.position) ? candidate : nearest);

    const remembered = [...bot.enemyMemory.values()]
      .filter((memory) => now - memory.seenAt <= BOT_MEMORY_MS)
      .map((memory) => ({ ...memory, visible: false }));
    if (!remembered.length) return null;
    return remembered.reduce((nearest, candidate) => distance(candidate.position, bot.position) < distance(nearest.position, bot.position) ? candidate : nearest);
  }

  chooseTeam() {
    const counts = Object.fromEntries(TEAMS.map((team) => [team, [...this.players.values()].filter((player) => player.team === team).length]));
    if (counts.alpha !== counts.bravo) return counts.alpha < counts.bravo ? "alpha" : "bravo";
    return "alpha";
  }

  rebalanceBots(reset = false) {
    const humanCounts = Object.fromEntries(TEAMS.map((team) => [team, [...this.players.values()].filter((player) => player.team === team).length]));
    const squadSize = COMPETITIVE_RULES.teamSize;
    const existing = new Map(this.bots.map((bot) => [bot.id, bot]));
    const nextBots = [];
    for (const team of TEAMS) {
      const occupied = new Set([...this.players.values()].filter((player) => player.team === team).map((player) => player.spawnIndex));
      const slots = TEAM_SPAWNS[team].map((_, index) => index).filter((index) => !occupied.has(index)).slice(0, squadSize - humanCounts[team]);
      for (const slot of slots) {
        const id = `bot-${team}-${slot + 1}`;
        const bot = existing.get(id) ?? createBot(team, slot, this.spawnForTeam(team, slot));
        if (reset) resetBotForRound(bot, this.spawnForTeam(team, slot), this.round === 1 || this.round === COMPETITIVE_RULES.halfRounds + 1);
        nextBots.push(bot);
      }
    }
    this.bots = nextBots;
  }

  evaluateElimination() {
    if (this.phase !== "LIVE") return;
    const attackersAlive = this.teamStrength(this.attackingTeam).alive;
    const defendersAlive = this.teamStrength(this.defendingTeam).alive;
    if (attackersAlive === 0 && !this.isBombPlanted()) this.endRound(this.defendingTeam, "attackers_eliminated");
    else if (defendersAlive === 0) this.endRound(this.attackingTeam, "defenders_eliminated");
  }

  teamStrength(team) {
    const members = [
      ...[...this.players.values()].filter((player) => player.team === team && player.alive),
      ...this.bots.filter((bot) => bot.team === team && bot.alive),
    ];
    return { alive: members.length, health: members.reduce((total, member) => total + member.health, 0) };
  }

  dropPlayerWeapon(player) {
    if (!player.alive && this.bomb.carrierId === player.id) this.dropBomb(player.position);
    saveActiveWeapon(player);
    const slot = !player.alive && player.primaryWeaponId ? "primary" : player.activeSlot;
    const weaponId = slot === "primary" ? player.primaryWeaponId : player.secondaryWeaponId;
    if (!weaponId || weaponId === "px9") return null;
    const ammo = slot === "primary" ? player.primaryAmmo : player.secondaryAmmo;
    const dropped = this.createDrop(weaponId, ammo.magazine, ammo.reserve, dropPositionForPlayer(player));
    if (slot === "primary") {
      player.primaryWeaponId = null;
      player.primaryAmmo = null;
      activateWeaponSlot(player, "secondary");
    } else {
      player.secondaryWeaponId = "px9";
      player.secondaryAmmo = defaultAmmo("px9");
      activateWeaponSlot(player, "secondary");
    }
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

function createBot(team, slot, spawn) {
  return {
    id: `bot-${team}-${slot + 1}`,
    team,
    slot,
    index: (team === "alpha" ? 0 : COMPETITIVE_RULES.teamSize) + slot,
    position: { x: spawn.x, y: 1, z: spawn.z },
    health: 100,
    alive: true,
    weaponId: "px9",
    nextShotAt: 0,
    lastShotAt: -Infinity,
    lastShotTarget: null,
    enemyMemory: new Map(),
  };
}

function resetBotForRound(bot, spawn, pistolRound) {
  bot.position = { x: spawn.x, y: 1, z: spawn.z };
  bot.health = 100;
  bot.alive = true;
  bot.nextShotAt = 0;
  bot.lastShotAt = -Infinity;
  bot.lastShotTarget = null;
  bot.enemyMemory.clear();
  bot.weaponId = pistolRound ? "px9" : bot.slot % 2 === 0 ? "br4" : "vx7";
}

function publicBot(bot) {
  const shotTarget = bot.lastShotTarget ? { ...bot.lastShotTarget } : null;
  return {
    id: bot.id,
    team: bot.team,
    position: { ...bot.position },
    health: bot.health,
    alive: bot.alive,
    weaponId: bot.weaponId,
    ...(Number.isFinite(bot.lastShotAt) ? { lastShotAt: bot.lastShotAt, lastShotTarget: shotTarget } : {}),
  };
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
    hasDefuseKit: player.hasDefuseKit,
    balance: player.balance,
    weaponId: player.weaponId,
    primaryWeaponId: player.primaryWeaponId,
    secondaryWeaponId: player.secondaryWeaponId,
    activeSlot: player.activeSlot,
    magazine: player.magazine,
    reserve: player.reserve,
    reloading: player.reloadCompletesAt !== null,
    alive: player.alive,
    ready: player.ready,
    connected: player.connected,
  };
}

function resetPlayerForRound(player, spawn, now) {
  if (!player.alive) {
    player.primaryWeaponId = null;
    player.primaryAmmo = null;
    player.secondaryWeaponId = "px9";
    player.secondaryAmmo = defaultAmmo("px9");
    player.activeSlot = "secondary";
    player.armor = 0;
    player.helmet = false;
    player.hasDefuseKit = false;
  } else saveActiveWeapon(player);
  if (!player.primaryWeaponId) player.activeSlot = "secondary";
  activateWeaponSlot(player, player.activeSlot);
  if (player.primaryAmmo) {
    const weapon = WEAPON_CATALOG[player.primaryWeaponId];
    player.primaryAmmo = { magazine: weapon.magazineSize, reserve: weapon.reserveAmmo };
  }
  const secondary = WEAPON_CATALOG[player.secondaryWeaponId];
  player.secondaryAmmo = { magazine: secondary.magazineSize, reserve: secondary.reserveAmmo };
  activateWeaponSlot(player, player.activeSlot);
  player.position = { ...spawn };
  player.yaw = spawn.z < 0 ? 0 : Math.PI;
  player.health = 100;
  player.alive = true;
  player.ready = false;
  player.lastInputAt = now;
  player.lastSequence = -1;
  player.movementCredit = 0;
  player.movementWindowStartedAt = now;
  player.movementWindowDistance = 0;
  player.movingUntil = 0;
  player.lastShotAt = -Infinity;
  player.reloadCompletesAt = null;
}

function equipWeapon(player, weaponId) {
  saveActiveWeapon(player);
  const weapon = WEAPON_CATALOG[weaponId];
  if (weapon.slot === "primary") {
    player.primaryWeaponId = weaponId;
    player.primaryAmmo = defaultAmmo(weaponId);
  } else {
    player.secondaryWeaponId = weaponId;
    player.secondaryAmmo = defaultAmmo(weaponId);
  }
  activateWeaponSlot(player, weapon.slot);
}

function saveActiveWeapon(player) {
  const weapon = WEAPON_CATALOG[player.weaponId];
  if (!weapon) return;
  player.activeSlot = weapon.slot;
  const ammo = { magazine: player.magazine, reserve: player.reserve };
  if (weapon.slot === "primary") {
    player.primaryWeaponId = player.weaponId;
    player.primaryAmmo = ammo;
  } else {
    player.secondaryWeaponId = player.weaponId;
    player.secondaryAmmo = ammo;
  }
}

function activateWeaponSlot(player, slot) {
  const weaponId = slot === "primary" ? player.primaryWeaponId : player.secondaryWeaponId;
  const ammo = slot === "primary" ? player.primaryAmmo : player.secondaryAmmo;
  if (!weaponId || !ammo) return false;
  player.activeSlot = slot;
  player.weaponId = weaponId;
  player.magazine = ammo.magazine;
  player.reserve = ammo.reserve;
  player.reloadCompletesAt = null;
  return true;
}

function defaultAmmo(weaponId) {
  const weapon = WEAPON_CATALOG[weaponId];
  return { magazine: weapon.magazineSize, reserve: weapon.reserveAmmo };
}

function resetPlayerEconomy(player) {
  player.balance = 800;
  player.armor = 0;
  player.helmet = false;
  player.hasDefuseKit = false;
  player.primaryWeaponId = null;
  player.primaryAmmo = null;
  player.secondaryWeaponId = "px9";
  player.secondaryAmmo = defaultAmmo("px9");
  player.activeSlot = "secondary";
  activateWeaponSlot(player, "secondary");
}

function emptyBomb() {
  return { status: "dropped", carrierId: null, planterId: null, defuserId: null, site: null, position: bombPosition(TEAM_SPAWNS.alpha[0]), progress: 0, remainingSeconds: 0 };
}

function bombPosition(position) {
  return { x: position.x, y: 0.32, z: position.z };
}

function planarDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
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
  moveBotCandidate(bot, { x: target.x, y: bot.position.y, z: target.z }, distanceToMove);
}

function nextNavigationWaypoint(position, destination) {
  const flatDestination = { x: destination.x, y: position.y, z: destination.z };
  if (sweptPositionIsClear(position, flatDestination, BOT_RADIUS)) return flatDestination;

  // Work backwards from every node that can see the destination. Each edge
  // points to the next safe waypoint, so a bot can reroute after every tick.
  const distanceToGoal = new Map();
  const nextHop = new Map();
  const unsettled = new Set();
  for (const point of MAP_NAV_POINTS) {
    const node = { x: point.x, y: position.y, z: point.z };
    if (!sweptPositionIsClear(node, flatDestination, BOT_RADIUS)) continue;
    distanceToGoal.set(point.id, planarDistance(node, flatDestination));
    unsettled.add(point.id);
  }
  while (unsettled.size) {
    let currentId = null;
    for (const id of unsettled) {
      if (currentId === null || distanceToGoal.get(id) < distanceToGoal.get(currentId)) currentId = id;
    }
    unsettled.delete(currentId);
    const current = NAV_POINT_BY_ID.get(currentId);
    for (const point of MAP_NAV_POINTS) {
      if (!point.neighbors.includes(currentId)) continue;
      if (!sweptPositionIsClear({ x: point.x, y: position.y, z: point.z }, { x: current.x, y: position.y, z: current.z }, BOT_RADIUS)) continue;
      const candidateDistance = distanceToGoal.get(currentId) + planarDistance(point, current);
      if (candidateDistance >= (distanceToGoal.get(point.id) ?? Infinity)) continue;
      distanceToGoal.set(point.id, candidateDistance);
      nextHop.set(point.id, currentId);
      unsettled.add(point.id);
    }
  }

  let start = null;
  let bestCost = Infinity;
  for (const point of MAP_NAV_POINTS) {
    if (!distanceToGoal.has(point.id)) continue;
    const node = { x: point.x, y: position.y, z: point.z };
    if (!sweptPositionIsClear(position, node, BOT_RADIUS)) continue;
    const cost = planarDistance(position, node) + distanceToGoal.get(point.id);
    if (cost < bestCost) {
      bestCost = cost;
      start = point;
    }
  }
  if (!start) return flatDestination;
  if (planarDistance(position, start) > 0.5) return { x: start.x, y: position.y, z: start.z };
  const next = NAV_POINT_BY_ID.get(nextHop.get(start.id));
  return next ? { x: next.x, y: position.y, z: next.z } : flatDestination;
}

function moveBotCandidate(bot, target, distanceToMove) {
  const delta = subtract(target, bot.position);
  delta.y = 0;
  const length = vectorLength(delta);
  if (length < 0.001) return;
  const step = Math.min(length, distanceToMove);
  const direct = add(bot.position, scale(delta, step / length));
  if (isWithinArena(direct) && sweptPositionIsClear(bot.position, direct, BOT_RADIUS)) {
    bot.position = direct;
    return;
  }
  const candidates = [
    { x: bot.position.x + step, y: bot.position.y, z: bot.position.z },
    { x: bot.position.x - step, y: bot.position.y, z: bot.position.z },
    { x: bot.position.x, y: bot.position.y, z: bot.position.z + step },
    { x: bot.position.x, y: bot.position.y, z: bot.position.z - step },
  ].filter((candidate) => isWithinArena(candidate) && sweptPositionIsClear(bot.position, candidate, BOT_RADIUS));
  candidates.sort((a, b) => distance(a, target) - distance(b, target));
  if (candidates[0]) bot.position = candidates[0];
}

function botCanSeeCombatant(bot, kind, entity) {
  const target = combatantAimPoint(kind, entity);
  const distanceToTarget = distance(bot.position, target);
  if (distanceToTarget > BOT_VIEW_DISTANCE) return false;
  const origin = { x: bot.position.x, y: bot.position.y + 0.72, z: bot.position.z };
  const direction = normalize(subtract(target, origin));
  const wallDistance = nearestColliderHit(origin, direction, distanceToTarget);
  return wallDistance === null || wallDistance >= distanceToTarget - 0.35;
}

function botShotInterval(bot) {
  const weapon = WEAPON_CATALOG[bot.weaponId] ?? WEAPON_CATALOG.px9;
  return Math.max(160, 60_000 / weapon.roundsPerMinute) + bot.index * 18;
}

function botHitChance(targetDistance) {
  const longRangePenalty = Math.max(0, targetDistance - 22) * 0.01;
  return Math.max(0.14, 0.6 - targetDistance * 0.012 - longRangePenalty);
}

function botCombatStep(bot, target, now) {
  const range = planarDistance(bot.position, target);
  if (range > 12 || range < 3.2) return null;
  const lateral = normalize({ x: target.z - bot.position.z, y: 0, z: bot.position.x - target.x });
  const side = Math.floor(now / 900 + bot.index) % 2 === 0 ? 1 : -1;
  return {
    x: bot.position.x + lateral.x * side * 0.9,
    y: bot.position.y,
    z: bot.position.z + lateral.z * side * 0.9,
  };
}

function combatantAimPoint(kind, entity) {
  if (kind === "player") return { x: entity.position.x, y: entity.position.y - 0.22, z: entity.position.z };
  return { x: entity.position.x, y: entity.position.y + 0.62, z: entity.position.z };
}

function nearestCombatantHit(origin, direction, players, bots, excludedId) {
  let result = null;
  const combatants = [
    ...[...players.values()].map((entity) => ({ kind: "player", entity })),
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
    if (candidate && candidate.along <= MAX_SHOT_DISTANCE && (!result || candidate.along < result.along)) result = candidate;
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
  return position.x >= ARENA_BOUNDS.minX + ARENA_BOUNDS.playerPadding
    && position.x <= ARENA_BOUNDS.maxX - ARENA_BOUNDS.playerPadding
    && position.z >= ARENA_BOUNDS.minZ + ARENA_BOUNDS.playerPadding
    && position.z <= ARENA_BOUNDS.maxZ - ARENA_BOUNDS.playerPadding;
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
