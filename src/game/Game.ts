import "@babylonjs/core/Culling/ray";
import "@babylonjs/core/Engines/Extensions/engine.alpha";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { createRenderer, type RendererBackend } from "./render/RendererFactory";
import { PlayerController } from "./player/PlayerController";
import { createArena, type TargetActor } from "./world/createArena";
import { ViewWeapon } from "./render/ViewWeapon";
import { getWeaponConfig, WEAPON_CATALOG, type WeaponId } from "./combat/WeaponCatalog";
import { WeaponStateMachine } from "./combat/WeaponStateMachine";
import { BotController } from "./ai/BotController";
import { MatchState, type MatchTransition } from "./core/MatchState";
import { ECONOMY_CONFIG, EconomySystem } from "./economy/EconomySystem";
import { NavigationService, type NavigationMode } from "./ai/navigation/NavigationService";
import { BotBuyPlanner, BotEconomy } from "./economy/BotEconomy";
import { DroppedWeaponSystem } from "./world/DroppedWeaponSystem";
import { NetworkClient, type MultiplayerConnectOptions, type MultiplayerWelcome } from "../network/NetworkClient";
import { RemotePlayerSystem } from "./network/RemotePlayerSystem";
import type { RoomSnapshot } from "../shared/protocol";

export interface BuyItemSnapshot {
  id: WeaponId | "armor" | "helmet";
  name: string;
  category: string;
  price: number;
  locked: boolean;
  owned: boolean;
}

function toNetworkVector(vector: Vector3): { x: number; y: number; z: number } {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function instanceSeed(instanceId: number | string): number {
  if (typeof instanceId === "number") return instanceId;
  let hash = 0;
  for (const character of instanceId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}

export interface GameSnapshot {
  health: number;
  armor: number;
  helmet: boolean;
  ammo: number;
  reserve: number;
  targetsAlive: number;
  movementLabel: string;
  round: number;
  phase: "BUY" | "LIVE" | "ROUND_END" | "MATCH_END";
  phaseRemaining: number;
  playerRounds: number;
  botRounds: number;
  balance: number;
  lossTier: number;
  botBalance: number;
  weaponName: string;
  navigationMode: NavigationMode;
  nearbyWeaponName: string | null;
  droppedWeaponCount: number;
  multiplayer: boolean;
  roomCode: string | null;
  playerCount: number;
  connectionStatus: "offline" | "connecting" | "connected" | "reconnecting";
  reloading: boolean;
  rematchVotes: number;
  buyItems: BuyItemSnapshot[];
  ledger: string[];
  hit?: boolean;
  message?: string;
}

interface GameCallbacks {
  onProgress(progress: number, label: string): void;
  onReady(backend: RendererBackend): void;
  onSnapshot(snapshot: GameSnapshot): void;
  onPause(message: string): void;
  onError(message: string): void;
}

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: GameCallbacks;
  private scene: Scene | null = null;
  private player: PlayerController | null = null;
  private targets: TargetActor[] = [];
  private bots: BotController[] = [];
  private readonly navigation = new NavigationService();
  private drops: DroppedWeaponSystem | null = null;
  private remotePlayers: RemotePlayerSystem | null = null;
  private viewWeapon: ViewWeapon | null = null;
  private backend: RendererBackend = "WebGL2";
  private running = false;
  private matchStarted = false;
  private match = new MatchState();
  private economy = new EconomySystem();
  private readonly botBuyPlanner = new BotBuyPlanner();
  private botEconomy = new BotEconomy();
  private currentWeaponId: WeaponId = "px9";
  private weapon = new WeaponStateMachine(getWeaponConfig("px9"), 0xb4eac1);
  private health = 100;
  private armor = 0;
  private helmet = false;
  private playerDiedThisRound = false;
  private purchaseSequence = 0;
  private killSequence = 0;
  private lastFrameAt = performance.now();
  private lastSnapshotAt = 0;
  private network: NetworkClient | null = null;
  private networkSnapshot: RoomSnapshot | null = null;
  private networkPhase: RoomSnapshot["phase"] | null = null;
  private connectionStatus: GameSnapshot["connectionStatus"] = "offline";
  private inputSequence = 0;
  private nextNetworkInputAt = 0;
  private promptedNetworkRound = 0;
  private networkReloadRequested = false;

  constructor(canvas: HTMLCanvasElement, callbacks: GameCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
  }

  async initialize(): Promise<void> {
    this.callbacks.onProgress(0.12, "检测 WebGPU 与 WebGL2…");
    const renderer = await createRenderer(this.canvas);
    this.backend = renderer.backend;
    this.callbacks.onProgress(0.38, renderer.fallbackReason ? "已启用兼容渲染后端" : "高性能渲染后端就绪");

    const scene = new Scene(renderer.engine);
    this.scene = scene;
    this.callbacks.onProgress(0.56, "构建 K-7 训练区域…");
    this.targets = createArena(scene);
    this.callbacks.onProgress(0.68, "生成 Recast 导航网格…");
    await this.navigation.initialize(scene);
    this.player = new PlayerController(scene, this.canvas, this.loadSensitivity());
    this.viewWeapon = new ViewWeapon(scene, this.player.camera);
    this.drops = new DroppedWeaponSystem(scene);
    this.remotePlayers = new RemotePlayerSystem(scene);
    this.bots = this.targets.map((actor, index) => new BotController({
      actor,
      index,
      scene,
      navigation: this.navigation,
      onFire: (damage, botIndex) => this.receiveBotFire(damage, botIndex),
    }));
    this.planBotBuy();
    scene.activeCamera = this.player.camera;
    this.callbacks.onProgress(0.82, "校准武器、Bot 与比赛规则…");
    this.bindInput();
    this.bindLifecycle();

    renderer.engine.runRenderLoop(() => {
      const now = performance.now();
      const deltaSeconds = Math.min((now - this.lastFrameAt) / 1000, 0.05);
      this.lastFrameAt = now;
      this.update(deltaSeconds, now);
      scene.render();
    });
    window.addEventListener("resize", () => renderer.engine.resize());
    this.callbacks.onProgress(1, "演训系统就绪");
    this.emitSnapshot("区域加载完成");
    this.callbacks.onReady(this.backend);
  }

  async start(): Promise<void> {
    if (!this.scene || !this.player) return;
    if (!this.matchStarted) {
      this.matchStarted = true;
      this.running = false;
      this.player.setEnabled(false);
      this.emitSnapshot("第 1 回合 · 手枪购买阶段");
      return;
    }
    const phase = this.networkSnapshot?.phase ?? this.match.phase;
    if (phase !== "LIVE") return;
    if (this.networkSnapshot && this.network?.playerId && !this.networkSnapshot.players.some((player) => player.id === this.network!.playerId && player.alive)) {
      this.emitSnapshot("你已阵亡 · 等待回合结束");
      return;
    }
    try {
      await this.resumeAudio();
      await this.canvas.requestPointerLock();
      this.running = true;
      this.player.setEnabled(true);
      this.lastFrameAt = performance.now();
      this.emitSnapshot("交战开始");
    } catch (error) {
      this.callbacks.onError(error instanceof Error ? error.message : "无法锁定鼠标");
    }
  }

  async connectMultiplayer(options: MultiplayerConnectOptions): Promise<MultiplayerWelcome> {
    this.network?.disconnect();
    this.drops?.clear();
    const network = new NetworkClient();
    this.network = network;
    network.onStatus = (status) => {
      this.connectionStatus = status;
      if (status === "reconnecting") {
        this.running = false;
        this.promptedNetworkRound = 0;
        this.player?.setEnabled(false);
        if (document.pointerLockElement === this.canvas) document.exitPointerLock();
        if (this.matchStarted) this.callbacks.onPause("连接中断 · 正在恢复战术状态");
      }
      this.emitSnapshot(status === "reconnecting" ? "连接中断，正在重连…" : undefined);
    };
    network.onEvent = (message, kind) => this.emitSnapshot(message, undefined, kind === "hit");
    network.onSnapshot = (snapshot) => this.applyNetworkSnapshot(snapshot);
    const welcome = await network.connect(options);
    this.matchStarted = true;
    this.running = false;
    this.connectionStatus = "connected";
    this.emitSnapshot(welcome.resumed ? `已恢复房间 ${welcome.roomCode} 的战术状态` : `已加入房间 ${welcome.roomCode}`);
    return welcome;
  }

  startSolo(): void {
    this.network?.disconnect();
    this.network = null;
    this.networkSnapshot = null;
    this.networkPhase = null;
    this.connectionStatus = "offline";
    this.promptedNetworkRound = 0;
    this.networkReloadRequested = false;
    this.remotePlayers?.clear();
    this.drops?.clear();
    this.matchStarted = true;
    this.running = false;
    this.emitSnapshot("第 1 回合 · 手枪购买阶段");
  }

  async readyRound(): Promise<void> {
    if (this.network) {
      this.network.sendReady();
      this.emitSnapshot("已准备，等待队友…");
      return;
    }
    const transition = this.match.ready();
    if (!transition) return;
    this.handleTransition(transition);
    await this.start();
  }

  purchase(itemId: WeaponId | "armor" | "helmet"): void {
    if (this.network) {
      this.network.sendBuy(itemId);
      return;
    }
    const eventId = `round-${this.match.round}-purchase-${++this.purchaseSequence}`;
    const result = this.economy.purchase(eventId, itemId, this.match.round, this.match.phase === "BUY");
    if (!result.ok) {
      const messages = {
        duplicate: "购买请求已处理",
        "not-buy-phase": "当前不在购买阶段",
        "pistol-round": "手枪局禁止购买主武器",
        "insufficient-funds": "余额不足",
        "already-owned": "已拥有该装备",
      } as const;
      this.emitSnapshot(messages[result.reason ?? "not-buy-phase"]);
      return;
    }

    if (itemId === "armor") this.armor = 100;
    else if (itemId === "helmet") this.helmet = true;
    else {
      this.currentWeaponId = itemId;
      this.weapon = new WeaponStateMachine(getWeaponConfig(itemId), 0xb4eac1 + this.match.round);
    }
    this.emitSnapshot(`已购买 ${this.itemName(itemId)}`);
  }

  restartMatch(): void {
    if (this.network) {
      this.network.sendRematch();
      this.emitSnapshot("已投票再战，等待其他玩家…");
      return;
    }
    this.match = new MatchState();
    this.economy = new EconomySystem();
    this.botEconomy.reset();
    this.currentWeaponId = "px9";
    this.weapon = new WeaponStateMachine(getWeaponConfig("px9"), 0xb4eac1);
    this.health = 100;
    this.armor = 0;
    this.helmet = false;
    this.playerDiedThisRound = false;
    this.purchaseSequence = 0;
    this.killSequence = 0;
    this.running = false;
    this.drops?.clear();
    this.resetActors();
    this.planBotBuy();
    this.emitSnapshot("新比赛 · 第 1 回合手枪局");
  }

  private update(deltaSeconds: number, now: number): void {
    if (!this.scene || !this.player) return;
    const motion = this.player.update(deltaSeconds, this.scene);
    this.viewWeapon?.update(deltaSeconds, now, motion.moving);
    this.remotePlayers?.update(deltaSeconds);
    if (!this.matchStarted) return;

    if (this.network) {
      if (this.running && this.networkSnapshot?.phase === "LIVE" && now >= this.nextNetworkInputAt) {
        this.nextNetworkInputAt = now + 50;
        this.network.sendInput(++this.inputSequence, toNetworkVector(this.player.camera.position), this.player.camera.rotation.y, this.player.camera.rotation.x);
      }
      if (now - this.lastSnapshotAt >= 125) {
        this.lastSnapshotAt = now;
        this.emitSnapshot(undefined, motion.label);
      }
      return;
    }

    const phaseCanTick = this.match.phase !== "LIVE" || this.running;
    if (phaseCanTick) {
      const transition = this.match.tick(deltaSeconds);
      if (transition) this.handleTransition(transition);
    }

    if (this.running && this.match.phase === "LIVE") {
      for (const bot of this.bots) bot.update(deltaSeconds, now, this.player.camera.position);
    }
    if (now - this.lastSnapshotAt >= 125) {
      this.lastSnapshotAt = now;
      this.emitSnapshot(undefined, motion.label);
    }
  }

  private bindInput(): void {
    this.canvas.addEventListener("mousedown", (event) => {
      if (event.button === 0 && this.canAct()) this.fire();
    });
    window.addEventListener("keydown", (event) => {
      if (event.code === "KeyR" && this.canAct()) void this.reload();
      if (event.code === "KeyE" && this.canAct()) this.pickupNearestWeapon();
      if (event.code === "KeyG" && this.canAct()) this.dropCurrentWeapon();
    });
  }

  private bindLifecycle(): void {
    document.addEventListener("pointerlockchange", () => {
      if (document.pointerLockElement !== this.canvas && this.running) this.pause("演训已暂停");
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.running) {
        document.exitPointerLock();
        this.pause("页面失焦，演训已暂停");
      }
    });
    window.addEventListener("blur", () => {
      if (this.running) this.pause("窗口失焦，演训已暂停");
    });
  }

  private fire(): void {
    if (!this.scene || !this.player) return;
    const localNetworkPlayer = this.networkSnapshot?.players.find((player) => player.id === this.network?.playerId);
    if (this.networkReloadRequested || localNetworkPlayer?.reloading) {
      this.emitSnapshot("正在更换弹匣");
      return;
    }
    const now = performance.now();
    const shot = this.weapon.tryFire(now);
    if (!shot.fired) {
      if (shot.reason === "empty") this.emitSnapshot("弹匣已空");
      return;
    }
    this.viewWeapon?.fire(now);
    if (this.network) {
      const direction = this.player.camera.getForwardRay(1).direction.normalize();
      this.network.sendFire(`${this.network.playerId}-${this.match.round}-${now.toFixed(2)}`, toNetworkVector(this.player.camera.position), toNetworkVector(direction), this.currentWeaponId);
      this.emitSnapshot();
      return;
    }
    for (const bot of this.bots) bot.hear(this.player.camera.position);
    const ray = this.player.camera.getForwardRay(120);
    const pick = this.scene.pickWithRay(ray, (mesh) => Boolean(mesh.metadata?.targetIndex !== undefined));
    if (pick?.hit && pick.pickedMesh) {
      const index = pick.pickedMesh.metadata.targetIndex as number;
      const target = this.targets[index];
      if (target?.alive) {
        const config = this.weapon.config;
        const headshot = pick.pickedMesh.metadata.hitZone === "head";
        target.health -= headshot ? config.damage * config.headMultiplier : config.damage;
        target.root.material!.alpha = 0.55;
        window.setTimeout(() => {
          if (target.alive && target.root.material) target.root.material.alpha = 1;
        }, 80);
        if (target.health <= 0) {
          target.alive = false;
          const botWeapon = this.bots[index]?.weaponId ?? "px9";
          const botConfig = getWeaponConfig(botWeapon);
          this.drops?.drop(botWeapon, botConfig.magazineSize, Math.floor(botConfig.reserveAmmo * 0.5), target.root.position.add(new Vector3(0, -0.84, 0)));
          target.root.setEnabled(false);
          this.economy.awardKill(`round-${this.match.round}-kill-${++this.killSequence}`, this.currentWeaponId);
          const remaining = this.targets.filter((actor) => actor.alive).length;
          this.emitSnapshot(headshot ? "精准击破 · 目标清除" : "目标清除", undefined, true);
          if (remaining === 0) this.finishRound(true);
          return;
        }
        this.emitSnapshot(headshot ? "头部命中" : "命中确认", undefined, true);
        return;
      }
    }
    this.emitSnapshot();
  }

  private receiveBotFire(damage: number, botIndex: number): void {
    if (!this.running || this.match.phase !== "LIVE" || this.health <= 0) return;
    let healthDamage = damage;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, Math.ceil(damage * 0.45));
      this.armor -= absorbed;
      healthDamage -= Math.floor(absorbed * 0.7);
    }
    this.health = Math.max(0, this.health - healthDamage);
    this.emitSnapshot(`受到 B-${botIndex + 1} 火力命中`);
    if (this.health <= 0) {
      this.playerDiedThisRound = true;
      const killerWeapon = this.bots[botIndex]?.weaponId ?? "px9";
      this.botEconomy.awardKill(`round-${this.match.round}-bot-kill`, killerWeapon);
      this.dropCurrentWeapon();
      this.finishRound(false);
    }
  }

  private async reload(): Promise<void> {
    if (this.network) {
      const local = this.networkSnapshot?.players.find((player) => player.id === this.network?.playerId);
      if (this.networkReloadRequested || local?.reloading) return;
      this.networkReloadRequested = true;
      this.network.sendReload();
      this.emitSnapshot("更换弹匣…");
      return;
    }
    if (!this.weapon.beginReload(performance.now())) return;
    this.emitSnapshot("更换弹匣…");
    await new Promise((resolve) => window.setTimeout(resolve, this.weapon.config.reloadMs));
    if (!this.running || this.match.phase !== "LIVE") {
      this.weapon.cancelReload();
      return;
    }
    this.weapon.update(performance.now());
    this.emitSnapshot("武器就绪");
  }

  private finishRound(playerWon: boolean): void {
    const transition = this.match.endRound(playerWon);
    if (transition) this.handleTransition(transition);
  }

  private handleTransition(transition: MatchTransition): void {
    if (transition.to === "LIVE") {
      this.economy.lockRefunds();
      this.running = false;
      this.player?.setEnabled(false);
      this.emitSnapshot("购买阶段结束 · 准备交战");
      this.callbacks.onPause("购买阶段结束 · 点击进入交战");
      return;
    }

    if (transition.to === "ROUND_END" || transition.to === "MATCH_END") {
      this.running = false;
      this.player?.setEnabled(false);
      this.weapon.cancelReload();
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
      const won = this.match.lastRoundWon === true;
      this.economy.settleRound(`round-${this.match.round}-settlement`, won);
      this.botEconomy.settleRound(`round-${this.match.round}-bot-settlement`, !won);
      if (transition.to === "MATCH_END") {
        this.emitSnapshot(won ? "比赛胜利 · 战术演训完成" : "比赛失败 · 演训终止");
      } else {
        this.emitSnapshot(won ? "回合胜利 · 经济已结算" : "回合失败 · 获得连败补偿");
      }
      return;
    }

    if (transition.to === "BUY") {
      this.prepareNextRound();
      this.planBotBuy();
      this.emitSnapshot(this.match.round === 1 ? "手枪购买阶段" : `第 ${this.match.round} 回合购买阶段`);
    }
  }

  private prepareNextRound(): void {
    this.drops?.clear();
    if (this.playerDiedThisRound) {
      this.economy.resetEquipmentAfterDeath();
      this.currentWeaponId = "px9";
      this.armor = 0;
      this.helmet = false;
    }
    this.health = 100;
    this.playerDiedThisRound = false;
    this.weapon = new WeaponStateMachine(getWeaponConfig(this.currentWeaponId), 0xb4eac1 + this.match.round);
    this.resetActors();
  }

  private resetActors(): void {
    for (const target of this.targets) {
      target.alive = true;
      target.health = 100;
      target.root.position.copyFrom(target.origin);
      target.root.setEnabled(true);
      if (target.root.material) target.root.material.alpha = 1;
    }
    for (const bot of this.bots) bot.reset();
    if (this.player) this.player.camera.position.copyFrom(new Vector3(0, 1.72, -14));
  }

  private pickupNearestWeapon(): void {
    if (!this.player || !this.drops) return;
    const nearby = this.drops.nearest(this.player.camera.position);
    if (!nearby) {
      this.emitSnapshot("附近没有可拾取武器");
      return;
    }
    if (this.network) {
      this.network.sendPickup(String(nearby.instanceId));
      return;
    }
    const replaced = this.currentWeaponId;
    const pickup = this.drops.pickup(nearby.instanceId);
    if (!pickup) return;
    if (replaced !== "px9") this.drops.drop(replaced, this.weapon.magazine, this.weapon.reserve, this.player.camera.position.add(new Vector3(0, -1.55, 0)));
    this.economy.equipPickedUpWeapon(pickup.weaponId, replaced);
    this.currentWeaponId = pickup.weaponId;
    this.weapon = new WeaponStateMachine(getWeaponConfig(pickup.weaponId), 0xb4eac1 + instanceSeed(nearby.instanceId));
    this.weapon.magazine = pickup.magazine;
    this.weapon.reserve = pickup.reserve;
    this.emitSnapshot(`已拾取 ${getWeaponConfig(pickup.weaponId).displayName}`);
  }

  private dropCurrentWeapon(): void {
    if (this.network) {
      if (this.currentWeaponId === "px9") {
        this.emitSnapshot("基础手枪不可丢弃");
        return;
      }
      this.network.sendDrop();
      return;
    }
    if (!this.player || !this.drops || this.currentWeaponId === "px9") return;
    const droppedId = this.currentWeaponId;
    this.drops.drop(droppedId, this.weapon.magazine, this.weapon.reserve, this.player.camera.position.add(new Vector3(0, -1.55, 0)));
    this.economy.dropWeapon(droppedId);
    this.currentWeaponId = "px9";
    this.weapon = new WeaponStateMachine(getWeaponConfig("px9"), 0xb4eac1 + this.match.round);
    this.emitSnapshot(`已丢弃 ${getWeaponConfig(droppedId).displayName}`);
  }

  private planBotBuy(): void {
    if (!this.bots.length) return;
    const plan = this.botBuyPlanner.plan(this.match.round, this.bots.length, this.botEconomy.balance);
    if (this.botEconomy.spend(`round-${this.match.round}-bot-buy`, plan.spent)) {
      plan.loadouts.forEach((weaponId, index) => this.bots[index]?.setWeapon(weaponId));
    }
  }

  private pause(message: string): void {
    this.running = false;
    this.player?.setEnabled(false);
    this.callbacks.onPause(message);
  }

  private emitSnapshot(message?: string, movementLabel = "标准移动", hit = false): void {
    if (this.networkSnapshot && this.network?.playerId) {
      const local = this.networkSnapshot.players.find((player) => player.id === this.network!.playerId);
      const nearby = this.player && this.drops ? this.drops.nearest(this.player.camera.position) : null;
      const weaponId = local?.weaponId ?? this.currentWeaponId;
      this.callbacks.onSnapshot({
        health: local?.health ?? this.health,
        armor: local?.armor ?? this.armor,
        helmet: false,
        reloading: this.networkReloadRequested || (local?.reloading ?? false),
        rematchVotes: this.networkSnapshot.rematchVotes,
        ammo: this.weapon.magazine,
        reserve: this.weapon.reserve,
        targetsAlive: this.networkSnapshot.bots.filter((bot) => bot.alive).length,
        movementLabel,
        round: this.networkSnapshot.round,
        phase: this.networkSnapshot.phase,
        phaseRemaining: this.networkSnapshot.phaseRemaining,
        playerRounds: this.networkSnapshot.playerRounds,
        botRounds: this.networkSnapshot.botRounds,
        balance: local?.balance ?? 0,
        lossTier: 0,
        botBalance: 0,
        weaponName: getWeaponConfig(weaponId).displayName,
        navigationMode: this.navigation.mode,
        nearbyWeaponName: nearby ? getWeaponConfig(nearby.weaponId).displayName : null,
        droppedWeaponCount: this.drops?.count ?? 0,
        multiplayer: true,
        roomCode: this.network.roomCode,
        playerCount: this.networkSnapshot.players.filter((player) => player.connected).length,
        connectionStatus: this.connectionStatus,
        buyItems: this.networkBuyItems(this.networkSnapshot.round, local?.balance ?? 0, weaponId),
        ledger: [],
        message,
        hit,
      });
      return;
    }
    const nearby = this.player && this.drops ? this.drops.nearest(this.player.camera.position) : null;
    this.callbacks.onSnapshot({
      health: this.health,
      armor: this.armor,
      helmet: this.helmet,
      reloading: this.weapon.isReloading,
      rematchVotes: 0,
      ammo: this.weapon.magazine,
      reserve: this.weapon.reserve,
      targetsAlive: this.targets.filter((target) => target.alive).length,
      movementLabel,
      round: this.match.round,
      phase: this.match.phase,
      phaseRemaining: Math.ceil(this.match.remainingSeconds),
      playerRounds: this.match.playerRounds,
      botRounds: this.match.botRounds,
      balance: this.economy.balance,
      lossTier: this.economy.lossTier,
      botBalance: this.botEconomy.balance,
      weaponName: this.weapon.config.displayName,
      navigationMode: this.navigation.mode,
      nearbyWeaponName: nearby ? getWeaponConfig(nearby.weaponId).displayName : null,
      droppedWeaponCount: this.drops?.count ?? 0,
      multiplayer: false,
      roomCode: null,
      playerCount: 1,
      connectionStatus: this.connectionStatus,
      buyItems: this.buyItems(),
      ledger: this.economy.ledger.slice(-4).map((entry) => `${entry.amount >= 0 ? "+" : ""}$${entry.amount} · ${entry.label}`),
      message,
      hit,
    });
  }

  private applyNetworkSnapshot(snapshot: RoomSnapshot): void {
    if (!this.player || !this.network?.playerId) return;
    const previousPhase = this.networkPhase;
    const wasAlive = this.health > 0;
    this.networkSnapshot = snapshot;
    this.networkPhase = snapshot.phase;
    const local = snapshot.players.find((player) => player.id === this.network!.playerId);
    if (local) {
      this.health = local.health;
      this.armor = local.armor;
      this.helmet = local.helmet;
      this.networkReloadRequested = local.reloading;
      if (local.weaponId !== this.currentWeaponId) {
        this.currentWeaponId = local.weaponId;
        this.weapon = new WeaponStateMachine(getWeaponConfig(local.weaponId), 0xb4eac1 + snapshot.round);
      }
      this.weapon.magazine = local.magazine;
      this.weapon.reserve = local.reserve;
      const authoritative = new Vector3(local.position.x, local.position.y, local.position.z);
      if (Vector3.DistanceSquared(authoritative, this.player.camera.position) > 6.25) this.player.camera.position.copyFrom(authoritative);
    }
    snapshot.bots.forEach((bot, index) => {
      const target = this.targets[index];
      if (!target) return;
      target.alive = bot.alive;
      target.health = bot.health;
      target.root.position.set(bot.position.x, bot.position.y, bot.position.z);
      target.root.setEnabled(bot.alive);
    });
    this.drops?.syncNetwork(snapshot.drops);
    this.remotePlayers?.apply(snapshot.players, this.network.playerId);
    if (snapshot.phase === "BUY") this.promptedNetworkRound = 0;
    if (snapshot.phase === "LIVE" && local?.alive && !this.running && this.promptedNetworkRound !== snapshot.round) {
      this.promptedNetworkRound = snapshot.round;
      this.running = false;
      this.player.setEnabled(false);
      this.callbacks.onPause(previousPhase === "BUY" ? "队伍已准备 · 点击进入交战" : "已加入进行中的回合 · 点击进入交战");
    }
    if (snapshot.phase !== "LIVE") {
      this.running = false;
      this.player.setEnabled(false);
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    }
    if (local && !local.alive && wasAlive) {
      this.running = false;
      this.player.setEnabled(false);
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
      this.callbacks.onPause("你已阵亡 · 等待回合结束");
    }
    this.emitSnapshot();
  }

  private canAct(): boolean {
    if (!this.running) return false;
    if (this.networkSnapshot && this.network?.playerId) {
      return this.networkSnapshot.phase === "LIVE" && this.networkSnapshot.players.some((player) => player.id === this.network!.playerId && player.alive);
    }
    return this.match.phase === "LIVE" && this.health > 0;
  }

  private networkBuyItems(round: number, balance: number, ownedWeapon: WeaponId): BuyItemSnapshot[] {
    return [
      ...(Object.keys(WEAPON_CATALOG) as WeaponId[]).filter((id) => id !== "px9").map((id) => {
        const config = getWeaponConfig(id);
        return { id, name: config.displayName, category: config.weaponClass.toUpperCase(), price: config.price, locked: round === 1 && config.slot === "primary", owned: id === ownedWeapon };
      }),
      { id: "armor" as const, name: "复合护甲", category: "GEAR", price: ECONOMY_CONFIG.armorPrice, locked: false, owned: (this.networkSnapshot?.players.find((player) => player.id === this.network?.playerId)?.armor ?? 0) >= 100 },
      { id: "helmet" as const, name: "战术头盔", category: "GEAR", price: ECONOMY_CONFIG.helmetPrice, locked: false, owned: this.networkSnapshot?.players.find((player) => player.id === this.network?.playerId)?.helmet ?? false },
    ];
  }

  private buyItems(): BuyItemSnapshot[] {
    const weaponItems = (Object.keys(WEAPON_CATALOG) as WeaponId[])
      .filter((id) => id !== "px9")
      .map((id) => {
        const config = getWeaponConfig(id);
        return {
          id,
          name: config.displayName,
          category: config.weaponClass.toUpperCase(),
          price: config.price,
          locked: this.match.round === 1 && config.slot === "primary",
          owned: this.economy.inventory.has(id),
        } satisfies BuyItemSnapshot;
      });
    return [
      ...weaponItems,
      { id: "armor", name: "复合护甲", category: "GEAR", price: ECONOMY_CONFIG.armorPrice, locked: false, owned: this.economy.inventory.has("armor") },
      { id: "helmet", name: "战术头盔", category: "GEAR", price: ECONOMY_CONFIG.helmetPrice, locked: false, owned: this.economy.inventory.has("helmet") },
    ];
  }

  private itemName(itemId: WeaponId | "armor" | "helmet"): string {
    if (itemId === "armor") return "复合护甲";
    if (itemId === "helmet") return "战术头盔";
    return getWeaponConfig(itemId).displayName;
  }

  private loadSensitivity(): number {
    const stored = Number(window.localStorage.getItem("breachline:sensitivity"));
    return Number.isFinite(stored) && stored >= 0.0005 && stored <= 0.01 ? stored : 0.0018;
  }

  private async resumeAudio(): Promise<void> {
    const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    if (context.state === "suspended") await context.resume();
    void context.close();
  }
}
