import { preloadTacticalHands } from "./render/viewmodel/TacticalHands";
import { preloadWeaponAssets } from "./render/viewmodel/WeaponAssets";
import { preloadOperatorAssets } from "./characters/OperatorAssets";
import { Ray } from "@babylonjs/core/Culling/ray";
import "@babylonjs/core/Engines/Extensions/engine.alpha";
import "@babylonjs/core/Shaders/pass.fragment";
import "@babylonjs/core/ShadersWGSL/pass.fragment";
import "@babylonjs/core/Shaders/ssao2.fragment";
import "@babylonjs/core/Shaders/ssaoCombine.fragment";
import "@babylonjs/core/Shaders/fxaa.vertex";
import "@babylonjs/core/Shaders/fxaa.fragment";
import "@babylonjs/core/ShadersWGSL/ssao2.fragment";
import "@babylonjs/core/ShadersWGSL/ssaoCombine.fragment";
import "@babylonjs/core/ShadersWGSL/fxaa.vertex";
import "@babylonjs/core/ShadersWGSL/fxaa.fragment";
import { Scene } from "@babylonjs/core/scene";
import { createDaylightEnvironment } from "./render/DaylightEnvironment";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline";
import { FxaaPostProcess } from "@babylonjs/core/PostProcesses/fxaaPostProcess";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { createRenderer, type RendererBackend } from "./render/RendererFactory";
import { PlayerController } from "./player/PlayerController";
import { createArena, createNetworkTargetActor, setTargetWeapon, updateTargetVisual, targetMuzzlePosition, type TargetActor } from "./world/createArena";
import { ViewWeapon } from "./render/ViewWeapon";
import { BotMuzzleSystem } from "./render/BotMuzzleSystem";
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
import { ARENA_BOUNDS, BOMB_SITES, BOT_SPAWNS, COMPETITIVE_RULES, TEAM_SPAWNS } from "../shared/game-data.mjs";
import type { BombState, RoomSnapshot, SiteId, TeamId, WeaponSlot } from "../shared/protocol";

export interface BuyItemSnapshot {
  id: WeaponId | "armor" | "helmet" | "defuse-kit";
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

function freshBomb(attacking: boolean): BombState {
  const spawn = attacking ? TEAM_SPAWNS.alpha[0] : TEAM_SPAWNS.alpha[2];
  return { status: "carried", carrierId: attacking ? "solo-player" : "bot-1", planterId: null, defuserId: null, site: null, position: { x: spawn.x, y: 0, z: spawn.z }, progress: 0, remainingSeconds: COMPETITIVE_RULES.bombSeconds };
}

function distanceOnGround(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export interface GameSnapshot {
  playerX: number;
  playerZ: number;
  playerYaw: number;
  health: number;
  armor: number;
  helmet: boolean;
  hasDefuseKit: boolean;
  hasBomb: boolean;
  attacking: boolean;
  bomb: BombState;
  interactionLabel: string | null;
  interactionProgress: number;
  lastRoundReason: string | null;
  ammo: number;
  reserve: number;
  targetsAlive: number;
  movementLabel: string;
  round: number;
  phase: "BUY" | "LIVE" | "ROUND_END" | "MATCH_END";
  phaseRemaining: number;
  playerRounds: number;
  botRounds: number;
  alphaRounds: number;
  bravoRounds: number;
  localTeam: TeamId | null;
  alliesAlive: number;
  enemiesAlive: number;
  alphaPlayers: number;
  bravoPlayers: number;
  alphaBots: number;
  bravoBots: number;
  balance: number;
  lossTier: number;
  botBalance: number;
  weaponName: string;
  primaryWeaponName: string | null;
  secondaryWeaponName: string;
  activeSlot: WeaponSlot;
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
  private networkTargets: TargetActor[] = [];
  private bots: BotController[] = [];
  private readonly navigation = new NavigationService();
  private drops: DroppedWeaponSystem | null = null;
  private remotePlayers: RemotePlayerSystem | null = null;
  private viewWeapon: ViewWeapon | null = null;
  private backend: RendererBackend = "WebGL2";
  private running = false;
  private pauseOnPointerUnlock = false;
  private matchStarted = false;
  private match = new MatchState();
  private economy = new EconomySystem();
  private readonly botBuyPlanner = new BotBuyPlanner();
  private botEconomy = new BotEconomy();
  private currentWeaponId: WeaponId = "px9";
  private weapon = new WeaponStateMachine(getWeaponConfig("px9"), 0xb4eac1);
  private primaryWeaponId: WeaponId | null = null;
  private secondaryWeaponId: WeaponId = "px9";
  private activeSlot: WeaponSlot = "secondary";
  private primaryWeapon: WeaponStateMachine | null = null;
  private secondaryWeapon = this.weapon;
  private soloBomb: BombState = freshBomb(true);
  private bombMarker: Mesh | null = null;
  private interactionHeld = false;
  private mouseHeld = false;
  private latestMotion = { moving: false, crouching: false };
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
  private pendingNetworkWeaponSlot: WeaponSlot | null = null;
  private readonly networkBotShotMarkers = new Map<string, number>();
  private botMuzzle: BotMuzzleSystem | null = null;

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
    scene.environmentTexture = createDaylightEnvironment(scene);
    scene.environmentIntensity = 0.42;
    await Promise.all([preloadWeaponAssets(), preloadOperatorAssets(), preloadTacticalHands()]);
    this.callbacks.onProgress(0.56, "构建 K-7 训练区域…");
    this.targets = createArena(scene);
    this.botMuzzle = new BotMuzzleSystem(scene);
    this.callbacks.onProgress(0.68, "生成 Recast 导航网格…");
    await this.navigation.initialize(scene);
    this.player = new PlayerController(scene, this.canvas, this.loadSensitivity());
    this.viewWeapon = new ViewWeapon(scene, this.player.camera);
    this.viewWeapon.setWeapon(this.currentWeaponId);
    this.drops = new DroppedWeaponSystem(scene);
    this.bombMarker = this.createBombMarker(scene);
    this.remotePlayers = new RemotePlayerSystem(scene);
    this.bots = this.targets.map((actor, index) => new BotController({
      actor,
      index,
      scene,
      navigation: this.navigation,
      onFire: (damage, botIndex) => this.receiveBotFire(damage, botIndex),
      onShot: (botIndex, weaponId) => {
        const bot = this.bots[botIndex];
        if (bot && this.player) {
          bot.actor.rig?.update(0, 0, 0, true);
          this.botMuzzle?.flash(botIndex, bot.actor.root.position, this.player.camera.position, weaponId, targetMuzzlePosition(bot.actor));
        }
      },
    }));
    this.planBotBuy();
    scene.activeCamera = this.player.camera;
    if (SSAO2RenderingPipeline.IsSupported) {
      const occlusion = new SSAO2RenderingPipeline("industrial-contact-shading", scene, { ssaoRatio: 0.5, blurRatio: 1 }, [this.player.camera]);
      occlusion.radius = 0.65;
      occlusion.totalStrength = 0.8;
      occlusion.samples = 8;
      occlusion.bilateralSamples = 8;
      occlusion.maxZ = 75;
    }
    new FxaaPostProcess("scene-edge-antialiasing", 1, this.player.camera);
    this.callbacks.onProgress(0.82, "校准武器、Bot 与比赛规则…");
    this.bindInput();
    this.bindLifecycle();

    this.callbacks.onProgress(0.92, "预热场景材质与阴影…");
    await scene.whenReadyAsync();

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
    if (!this.network && this.health <= 0) {
      this.running = true;
      this.player.setEnabled(false);
      this.emitSnapshot("你已阵亡 · 等待 C4 结算");
      return;
    }
    try {
      await this.resumeAudio();
      const pointerLockDisabled = new URLSearchParams(window.location.search).get("pointerlock") === "off";
      let pointerLockUnavailable = false;
      this.pauseOnPointerUnlock = false;
      if (!pointerLockDisabled) {
        try {
          await this.canvas.requestPointerLock();
          this.pauseOnPointerUnlock = document.pointerLockElement === this.canvas;
        } catch {
          pointerLockUnavailable = true;
        }
      }
      this.running = true;
      this.player.setEnabled(true);
      this.lastFrameAt = performance.now();
      this.emitSnapshot(pointerLockUnavailable ? "鼠标锁定不可用 · 按住鼠标拖动视角" : "交战开始");
    } catch (error) {
      this.callbacks.onError(error instanceof Error ? error.message : "无法锁定鼠标");
    }
  }

  async connectMultiplayer(options: MultiplayerConnectOptions): Promise<MultiplayerWelcome> {
    this.network?.disconnect();
    this.drops?.clear();
    this.botMuzzle?.clear();
    this.networkBotShotMarkers.clear();
    this.pendingNetworkWeaponSlot = null;
    const network = new NetworkClient();
    this.network = network;
    network.onStatus = (status) => {
      this.connectionStatus = status;
      if (status === "reconnecting") {
        this.running = false;
        this.mouseHeld = false;
        this.pendingNetworkWeaponSlot = null;
        this.releaseInteraction();
        this.promptedNetworkRound = 0;
        this.player?.setEnabled(false);
        if (document.pointerLockElement === this.canvas) document.exitPointerLock();
        if (this.matchStarted) this.callbacks.onPause("连接中断 · 正在恢复战术状态");
      }
      this.emitSnapshot(status === "reconnecting" ? "连接中断，正在重连…" : undefined);
    };
    network.onEvent = (message, kind) => this.emitSnapshot(message, undefined, kind === "hit");
    network.onShot = (shooterId, weaponId) => {
      if (shooterId !== network.playerId) this.remotePlayers?.triggerMuzzleFlash(shooterId, weaponId);
    };
    network.onSnapshot = (snapshot) => this.applyNetworkSnapshot(snapshot);
    const welcome = await network.connect(options);
    this.matchStarted = true;
    this.running = false;
    this.connectionStatus = "connected";
    this.emitSnapshot(welcome.resumed ? `已恢复房间 ${welcome.roomCode} 的战术状态` : `已加入房间 ${welcome.roomCode} · ${welcome.team.toUpperCase()}`);
    return welcome;
  }

  startSolo(): void {
    this.releaseInteraction();
    this.network?.disconnect();
    this.network = null;
    this.networkSnapshot = null;
    this.networkPhase = null;
    this.connectionStatus = "offline";
    this.promptedNetworkRound = 0;
    this.networkReloadRequested = false;
    this.pendingNetworkWeaponSlot = null;
    this.remotePlayers?.clear();
    this.botMuzzle?.clear();
    this.networkBotShotMarkers.clear();
    this.drops?.clear();
    for (const actor of this.networkTargets) actor.root.setEnabled(false);
    this.resetActors();
    this.soloBomb = freshBomb(this.match.playerAttacking);
    this.syncBombMarker();
    this.matchStarted = true;
    this.running = false;
    this.emitSnapshot("第 1 回合 · 手枪购买阶段");
  }

  leaveMatch(): void {
    this.matchStarted = false;
    this.running = false;
    this.pauseOnPointerUnlock = false;
    this.mouseHeld = false;
    this.releaseInteraction();
    this.player?.setEnabled(false);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();

    const network = this.network;
    this.network = null;
    this.networkSnapshot = null;
    this.networkPhase = null;
    if (network) {
      network.onSnapshot = () => undefined;
      network.onEvent = () => undefined;
      network.onShot = () => undefined;
      network.onStatus = () => undefined;
      network.sendLeave();
      network.disconnect();
    }
    this.connectionStatus = "offline";
    this.promptedNetworkRound = 0;
    this.networkReloadRequested = false;
    this.pendingNetworkWeaponSlot = null;
    this.remotePlayers?.clear();
    this.botMuzzle?.clear();
    this.networkBotShotMarkers.clear();
    for (const actor of this.networkTargets) actor.root.setEnabled(false);
    this.restartMatch();
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

  purchase(itemId: WeaponId | "armor" | "helmet" | "defuse-kit"): void {
    if (this.network) {
      this.network.sendBuy(itemId);
      return;
    }
    if (itemId === "defuse-kit" && this.match.playerAttacking) {
      this.emitSnapshot("拆弹工具仅守方可购买");
      return;
    }
    const replacedId = itemId === "armor" || itemId === "helmet" || itemId === "defuse-kit"
      ? null : getWeaponConfig(itemId).slot === "primary" ? this.primaryWeaponId : this.secondaryWeaponId;
    const eventId = `round-${this.match.round}-purchase-${++this.purchaseSequence}`;
    const result = this.economy.purchase(eventId, itemId, this.match.round, this.match.phase === "BUY", this.armor);
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
    else if (itemId !== "defuse-kit") {
      if (replacedId && replacedId !== "px9" && replacedId !== itemId) this.economy.dropWeapon(replacedId);
      this.equipSoloWeapon(itemId, 0xb4eac1 + this.match.round);
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
    this.primaryWeaponId = null;
    this.secondaryWeaponId = "px9";
    this.activeSlot = "secondary";
    this.primaryWeapon = null;
    this.secondaryWeapon = this.weapon;
    this.soloBomb = freshBomb(true);
    this.syncBombMarker();
    this.health = 100;
    this.armor = 0;
    this.helmet = false;
    this.playerDiedThisRound = false;
    this.purchaseSequence = 0;
    this.killSequence = 0;
    this.running = false;
    this.releaseInteraction();
    this.drops?.clear();
    this.resetActors();
    this.planBotBuy();
    this.emitSnapshot("新比赛 · 第 1 回合手枪局");
  }

  private update(deltaSeconds: number, now: number): void {
    if (!this.scene || !this.player) return;
    const motion = this.player.update(deltaSeconds, this.scene);
    this.latestMotion = motion;
    this.viewWeapon?.setWeapon(this.currentWeaponId);
    this.viewWeapon?.setReloading(this.networkReloadRequested || this.weapon.isReloading);
    this.viewWeapon?.update(deltaSeconds, now, motion.moving);
    this.remotePlayers?.update(deltaSeconds);
    this.botMuzzle?.update(deltaSeconds);
    for (const actor of this.targets) updateTargetVisual(actor, deltaSeconds);
    for (const actor of this.networkTargets) updateTargetVisual(actor, deltaSeconds);
    if (!this.matchStarted) return;

    if (this.mouseHeld && this.canAct() && (this.weapon.config.weaponClass === "smg" || this.weapon.config.weaponClass === "rifle")) this.fire();

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
      this.configureBotObjectives();
      for (const bot of this.bots) {
        if (this.match.phase !== "LIVE") break;
        if ((this.soloBomb.status === "planting" && this.soloBomb.planterId === `bot-${bot.index}`)
          || (this.soloBomb.status === "defusing" && this.soloBomb.defuserId === `bot-${bot.index}`)) continue;
        bot.update(deltaSeconds, now, this.player.camera.position, this.health > 0);
      }
      if (this.match.phase === "LIVE") this.updateSoloBomb(deltaSeconds);
    }
    if (now - this.lastSnapshotAt >= 125) {
      this.lastSnapshotAt = now;
      this.emitSnapshot(undefined, motion.label);
    }
  }

  private bindInput(): void {
    this.canvas.addEventListener("pointerdown", (event) => {
      if (event.button === 0 && this.canAct()) {
        this.mouseHeld = true;
        this.fire();
      }
    });
    window.addEventListener("pointerup", (event) => { if (event.button === 0) this.mouseHeld = false; });
    window.addEventListener("pointercancel", () => { this.mouseHeld = false; });
    window.addEventListener("keydown", (event) => {
      if (event.code === "Escape" && this.running) {
        event.preventDefault();
        this.pauseOnPointerUnlock = false;
        if (document.pointerLockElement === this.canvas) document.exitPointerLock();
        this.pause("演训已暂停");
      }
      if (event.code === "KeyR" && this.canAct()) void this.reload();
      if (event.code === "KeyE" && this.canAct() && !event.repeat) this.beginInteraction();
      if (event.code === "KeyG" && this.canAct()) {
        if (event.shiftKey) this.dropBomb();
        else this.dropCurrentWeapon();
      }
      if (event.code === "Digit1" && this.canAct()) this.switchWeapon("primary");
      if (event.code === "Digit2" && this.canAct()) this.switchWeapon("secondary");
    });
    window.addEventListener("keyup", (event) => { if (event.code === "KeyE") this.releaseInteraction(); });
  }

  private bindLifecycle(): void {
    document.addEventListener("pointerlockchange", () => {
      if (document.pointerLockElement === this.canvas) {
        this.pauseOnPointerUnlock = true;
      } else if (this.pauseOnPointerUnlock && this.running) {
        this.pauseOnPointerUnlock = false;
        this.pause("演训已暂停");
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.running) {
        document.exitPointerLock();
        this.pause("页面失焦，演训已暂停");
      }
    });
    window.addEventListener("blur", () => {
      this.mouseHeld = false;
      this.releaseInteraction();
      if (this.running) this.pause("窗口失焦，演训已暂停");
    });
  }

  private fire(): void {
    if (!this.scene || !this.player) return;
    const bomb = this.networkSnapshot?.bomb ?? this.soloBomb;
    const localId = this.network?.playerId ?? "solo-player";
    if (this.interactionHeld && (bomb.status === "planting" && bomb.planterId === localId || bomb.status === "defusing" && bomb.defuserId === localId)) return;
    const localNetworkPlayer = this.networkSnapshot?.players.find((player) => player.id === this.network?.playerId);
    if (this.networkReloadRequested || localNetworkPlayer?.reloading) {
      this.emitSnapshot("正在更换弹匣");
      return;
    }
    if (this.network && this.pendingNetworkWeaponSlot != null) {
      this.emitSnapshot("正在切换武器");
      return;
    }
    const now = performance.now();
    const shot = this.weapon.tryFire(now, this.latestMotion.moving, this.latestMotion.crouching);
    if (!shot.fired) {
      if (shot.reason === "empty") this.emitSnapshot("弹匣已空");
      return;
    }
    this.viewWeapon?.fire(now);
    const forward = this.player.camera.getForwardRay(1).direction.normalize();
    const right = this.player.camera.getDirection(Vector3.Right());
    const up = this.player.camera.getDirection(Vector3.Up());
    const direction = forward.add(right.scale(shot.spreadX)).add(up.scale(shot.spreadY)).normalize();
    if (this.network) {
      this.network.sendFire(`${this.network.playerId}-${this.match.round}-${now.toFixed(2)}`, toNetworkVector(this.player.camera.position), toNetworkVector(direction), this.currentWeaponId);
      this.emitSnapshot();
      return;
    }
    for (const bot of this.bots) bot.hear(this.player.camera.position);
    let hit = false;
    let headshot = false;
    const pellets = this.weapon.config.pellets ?? 1;
    for (let pellet = 0; pellet < pellets; pellet += 1) {
      const angle = pellet * 2.399963;
      const radius = pellets === 1 ? 0 : this.weapon.config.baseSpread * Math.sqrt((pellet + 0.5) / pellets);
      const pelletDirection = direction.add(right.scale(Math.cos(angle) * radius)).add(up.scale(Math.sin(angle) * radius)).normalize();
      const shotRange = Math.hypot(ARENA_BOUNDS.maxX - ARENA_BOUNDS.minX, ARENA_BOUNDS.maxZ - ARENA_BOUNDS.minZ) + 5;
      const pick = this.scene.pickWithRay(new Ray(this.player.camera.position, pelletDirection, shotRange), (mesh) => mesh.checkCollisions || mesh.metadata?.targetIndex !== undefined);
      if (!pick?.hit || !pick.pickedMesh || pick.pickedMesh.metadata?.targetIndex === undefined) continue;
      const index = pick.pickedMesh.metadata.targetIndex as number;
      const target = this.targets[index];
      if (!target?.alive) continue;
      const pelletHeadshot = pick.pickedMesh.metadata.hitZone === "head";
      target.health -= pelletHeadshot ? this.weapon.config.damage * this.weapon.config.headMultiplier : this.weapon.config.damage;
      hit = true;
      headshot ||= pelletHeadshot;
      if (target.health <= 0) this.killSoloBot(index);
    }
    this.emitSnapshot(hit ? headshot ? "头部命中" : "命中确认" : undefined, undefined, hit);
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
      this.releaseInteraction();
      this.player?.setEnabled(false);
      if (this.match.playerAttacking && this.soloBomb.carrierId === "solo-player") this.dropSoloBomb(this.player!.camera.position);
      if (this.match.playerAttacking && (this.soloBomb.status === "planted" || this.soloBomb.status === "defusing")) {
        this.emitSnapshot("你已阵亡 · 炸弹仍在倒计时");
      } else this.finishRound(false, "elimination");
    }
  }

  private async reload(): Promise<void> {
    if (this.interactionHeld) return;
    if (this.network) {
      const local = this.networkSnapshot?.players.find((player) => player.id === this.network?.playerId);
      if (this.networkReloadRequested || local?.reloading) return;
      this.networkReloadRequested = true;
      this.network.sendReload();
      this.emitSnapshot("更换弹匣…");
      return;
    }
    const reloadingWeapon = this.weapon;
    if (!reloadingWeapon.beginReload(performance.now())) return;
    this.emitSnapshot("更换弹匣…");
    await new Promise((resolve) => window.setTimeout(resolve, reloadingWeapon.config.reloadMs));
    if (!this.running || this.match.phase !== "LIVE") {
      reloadingWeapon.cancelReload();
      return;
    }
    if (!reloadingWeapon.isReloading) return;
    reloadingWeapon.update(performance.now());
    this.emitSnapshot("武器就绪");
  }

  private finishRound(playerWon: boolean, reason = "elimination"): void {
    const transition = this.match.endRound(playerWon, reason);
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
      this.mouseHeld = false;
      this.releaseInteraction();
      this.player?.setEnabled(false);
      this.weapon.cancelReload();
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
      const won = this.match.lastRoundWon === true;
      this.economy.settleRound(`round-${this.match.round}-settlement`, won, this.match.playerAttacking && this.soloBomb.planterId === "solo-player");
      this.botEconomy.settleRound(`round-${this.match.round}-bot-settlement`, !won);
      if (transition.to === "MATCH_END") {
        this.emitSnapshot(won ? "比赛胜利 · 战术演训完成" : "比赛失败 · 演训终止");
      } else {
        this.emitSnapshot(won ? "回合胜利 · 经济已结算" : "回合失败 · 获得连败补偿");
      }
      return;
    }

    if (transition.to === "BUY") {
      if (this.match.round === COMPETITIVE_RULES.halfRounds + 1) {
        this.economy.resetForHalf();
        this.botEconomy.reset();
        this.primaryWeaponId = null;
        this.secondaryWeaponId = "px9";
        this.activeSlot = "secondary";
        this.armor = 0;
        this.helmet = false;
      }
      this.prepareNextRound();
      this.planBotBuy();
      this.emitSnapshot(this.match.round === 1 || this.match.round === COMPETITIVE_RULES.halfRounds + 1 ? "手枪购买阶段" : `第 ${this.match.round} 回合购买阶段`);
    }
  }

  private prepareNextRound(): void {
    this.drops?.clear();
    if (this.playerDiedThisRound) {
      this.economy.resetEquipmentAfterDeath();
      this.currentWeaponId = "px9";
      this.primaryWeaponId = null;
      this.secondaryWeaponId = "px9";
      this.activeSlot = "secondary";
      this.primaryWeapon = null;
      this.armor = 0;
      this.helmet = false;
    }
    this.health = 100;
    this.playerDiedThisRound = false;
    this.secondaryWeapon = new WeaponStateMachine(getWeaponConfig(this.secondaryWeaponId), 0xb4eac1 + this.match.round);
    this.primaryWeapon = this.primaryWeaponId ? new WeaponStateMachine(getWeaponConfig(this.primaryWeaponId), 0xb4eac1 + this.match.round + 1) : null;
    this.weapon = this.activeSlot === "primary" && this.primaryWeapon ? this.primaryWeapon : this.secondaryWeapon;
    this.currentWeaponId = this.weapon.config.id;
    this.soloBomb = freshBomb(this.match.playerAttacking);
    this.syncBombMarker();
    this.resetActors();
  }

  private resetActors(): void {
    for (const [index, target] of this.targets.entries()) {
      const spawn = this.match.playerAttacking ? BOT_SPAWNS[index] : TEAM_SPAWNS.alpha[index + 1];
      if (spawn) target.origin.set(spawn.x, this.match.playerAttacking ? spawn.y : 1, spawn.z);
      target.alive = true;
      target.health = 100;
      target.root.position.copyFrom(target.origin);
      target.root.setEnabled(true);
      target.rig?.setTeam(false);
      if (target.root.material) target.root.material.alpha = 1;
    }
    for (const bot of this.bots) bot.reset();
    if (this.player) {
      const spawn = this.match.playerAttacking ? TEAM_SPAWNS.alpha[0] : TEAM_SPAWNS.bravo[0];
      this.player.camera.position.set(spawn.x, spawn.y, spawn.z);
      this.player.camera.rotation.y = this.match.playerAttacking ? 0 : Math.PI;
      if (import.meta.env.DEV && typeof window !== "undefined") {
        const review = new URLSearchParams(window.location?.search).get("review");
        if (review === "a-yard" || review === "b-yard") {
          this.player.camera.position.set(review === "a-yard" ? BOMB_SITES.A.x - 8 : BOMB_SITES.B.x + 9, 1.72, review === "a-yard" ? BOMB_SITES.A.z - 22 : BOMB_SITES.B.z - 18);
          this.player.camera.rotation.y = review === "a-yard" ? 0.25 : -0.25;
        }
      }
    }
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
    const pickup = this.drops.pickup(nearby.instanceId);
    if (!pickup) return;
    const slot = getWeaponConfig(pickup.weaponId).slot;
    const replaced = slot === "primary" ? this.primaryWeaponId : this.secondaryWeaponId;
    const replacedState = slot === "primary" ? this.primaryWeapon : this.secondaryWeapon;
    if (replaced && replaced !== "px9" && replacedState) this.drops.drop(replaced, replacedState.magazine, replacedState.reserve, this.player.camera.position.add(new Vector3(0, -1.55, 0)));
    this.economy.equipPickedUpWeapon(pickup.weaponId, replaced ?? undefined);
    this.equipSoloWeapon(pickup.weaponId, 0xb4eac1 + instanceSeed(nearby.instanceId));
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
      this.releaseInteraction();
      this.network.sendDrop("weapon");
      return;
    }
    if (!this.player || !this.drops) return;
    if (this.currentWeaponId === "px9") return;
    this.releaseInteraction();
    const droppedId = this.currentWeaponId;
    this.drops.drop(droppedId, this.weapon.magazine, this.weapon.reserve, this.player.camera.position.add(new Vector3(0, -1.55, 0)));
    this.economy.dropWeapon(droppedId);
    if (this.activeSlot === "primary") {
      this.primaryWeaponId = null;
      this.primaryWeapon = null;
      this.switchWeapon("secondary");
    } else {
      this.secondaryWeaponId = "px9";
      this.secondaryWeapon = new WeaponStateMachine(getWeaponConfig("px9"), 0xb4eac1 + this.match.round);
      this.weapon = this.secondaryWeapon;
      this.currentWeaponId = "px9";
    }
    this.emitSnapshot(`已丢弃 ${getWeaponConfig(droppedId).displayName}`);
  }

  private dropBomb(): void {
    if (!this.player) return;
    if (this.network) {
      if (this.networkSnapshot?.bomb.carrierId === this.network.playerId) {
        this.releaseInteraction();
        this.network.sendDrop("bomb");
      }
      else this.emitSnapshot("你没有携带 C4");
      return;
    }
    if (this.soloBomb.carrierId !== "solo-player") {
      this.emitSnapshot("你没有携带 C4");
      return;
    }
    this.releaseInteraction();
    this.dropSoloBomb(this.player.camera.position);
  }

  private equipSoloWeapon(weaponId: WeaponId, seed: number): void {
    const config = getWeaponConfig(weaponId);
    const newWeapon = new WeaponStateMachine(config, seed);
    if (config.slot === "primary") {
      this.primaryWeaponId = weaponId;
      this.primaryWeapon = newWeapon;
    } else {
      this.secondaryWeaponId = weaponId;
      this.secondaryWeapon = newWeapon;
    }
    this.activeSlot = config.slot;
    this.currentWeaponId = weaponId;
    this.weapon = newWeapon;
  }

  private switchWeapon(slot: WeaponSlot): void {
    this.releaseInteraction();
    if (this.network) {
      const local = this.networkSnapshot?.players.find((player) => player.id === this.network?.playerId);
      if (local?.activeSlot === slot) return;
      const nextWeaponId = slot === "primary" ? local?.primaryWeaponId : local?.secondaryWeaponId;
      if (local && !nextWeaponId) {
        this.emitSnapshot("该栏位没有武器");
        return;
      }
      this.pendingNetworkWeaponSlot = slot;
      this.network.sendSwitchWeapon(slot);
      return;
    }
    const next = slot === "primary" ? this.primaryWeapon : this.secondaryWeapon;
    if (!next || this.activeSlot === slot) return;
    this.weapon.cancelReload();
    this.activeSlot = slot;
    this.weapon = next;
    this.currentWeaponId = next.config.id;
    this.emitSnapshot(`已切换至 ${next.config.displayName}`);
  }

  private killSoloBot(index: number): void {
    const target = this.targets[index];
    if (!target?.alive) return;
    target.alive = false;
    const botWeapon = this.bots[index]?.weaponId ?? "px9";
    const botConfig = getWeaponConfig(botWeapon);
    this.drops?.drop(botWeapon, botConfig.magazineSize, Math.floor(botConfig.reserveAmmo * 0.5), target.root.position.add(new Vector3(0, -0.84, 0)));
    target.root.setEnabled(false);
    if (!this.match.playerAttacking && this.soloBomb.carrierId === `bot-${index}`) this.dropSoloBomb(target.root.position);
    this.economy.awardKill(`round-${this.match.round}-kill-${++this.killSequence}`, this.currentWeaponId);
    const remaining = this.targets.filter((actor) => actor.alive).length;
    this.emitSnapshot("目标清除", undefined, true);
    if (remaining === 0 && (this.match.playerAttacking || this.soloBomb.status !== "planted" && this.soloBomb.status !== "defusing")) this.finishRound(true, "elimination");
  }

  private beginInteraction(): void {
    if (!this.player) return;
    const bomb = this.networkSnapshot?.bomb ?? this.soloBomb;
    const attacking = this.networkSnapshot
      ? this.networkSnapshot.attackingTeam === this.networkSnapshot.players.find((player) => player.id === this.network?.playerId)?.team
      : this.match.playerAttacking;
    const position = this.player.camera.position;
    const nearSite = this.siteAt(position);
    const localId = this.network ? this.network.playerId : "solo-player";
    const bombNearby = distanceOnGround(position, bomb.position) <= 2.3;
    const objectiveAction = attacking
      ? (bomb.status === "dropped" && bombNearby) || (bomb.carrierId === localId && nearSite !== null)
      : (bomb.status === "planted" || bomb.status === "defusing") && bombNearby;
    if (!objectiveAction) {
      this.pickupNearestWeapon();
      return;
    }
    if (attacking ? bomb.carrierId === localId && nearSite !== null : bomb.status === "planted" || bomb.status === "defusing") {
      this.weapon.cancelReload();
      this.networkReloadRequested = false;
      this.viewWeapon?.setReloading(false);
    }
    if (this.network) {
      this.interactionHeld = true;
      this.network.sendInteract(true);
      return;
    }
    if (attacking && bomb.status === "dropped") {
      bomb.status = "carried";
      bomb.carrierId = "solo-player";
      bomb.site = null;
      bomb.progress = 0;
      this.syncBombMarker();
      this.emitSnapshot("已拾取 C4 炸弹");
      return;
    }
    this.interactionHeld = true;
    if (attacking && nearSite) {
      bomb.status = "planting";
      bomb.planterId = "solo-player";
      bomb.site = nearSite;
      bomb.progress = 0;
    } else if (!attacking) {
      bomb.status = "defusing";
      bomb.defuserId = "solo-player";
      bomb.progress = 0;
    }
    this.emitSnapshot();
  }

  private releaseInteraction(): void {
    if (!this.interactionHeld) return;
    this.interactionHeld = false;
    this.network?.sendInteract(false);
    if (this.network) return;
    if (this.soloBomb.status === "planting" && this.soloBomb.planterId === "solo-player") {
      this.soloBomb.status = "carried";
      this.soloBomb.planterId = null;
      this.soloBomb.site = null;
      this.soloBomb.progress = 0;
    } else if (this.soloBomb.status === "defusing" && this.soloBomb.defuserId === "solo-player") {
      this.soloBomb.status = "planted";
      this.soloBomb.defuserId = null;
      this.soloBomb.progress = 0;
    }
  }

  private siteAt(position: { x: number; z: number }): SiteId | null {
    for (const site of ["A", "B"] as const) if (distanceOnGround(position, BOMB_SITES[site]) <= BOMB_SITES[site].radius) return site;
    return null;
  }

  private dropSoloBomb(position: { x: number; z: number }): void {
    this.soloBomb.status = "dropped";
    this.soloBomb.carrierId = null;
    this.soloBomb.planterId = null;
    this.soloBomb.site = null;
    this.soloBomb.progress = 0;
    this.soloBomb.position = { x: position.x, y: 0.15, z: position.z };
    this.syncBombMarker();
    this.emitSnapshot("C4 炸弹已掉落");
  }

  private configureBotObjectives(): void {
    const bomb = this.soloBomb;
    if (this.match.playerAttacking) {
      const retake = bomb.status === "planted" || bomb.status === "defusing";
      for (const bot of this.bots) {
        const site = bot.index % 2 === 0 ? BOMB_SITES.A : BOMB_SITES.B;
        const goal = retake ? bomb.position : { x: site.x + (bot.index > 1 ? 1.8 : -1.8), y: 1, z: site.z + (bot.index > 1 ? 1.8 : -1.8) };
        bot.setObjective(new Vector3(goal.x, 1, goal.z), retake ? "retake" : "guard");
      }
      return;
    }
    const targetSite = bomb.site ? BOMB_SITES[bomb.site] : BOMB_SITES.B;
    const replacement = bomb.status === "dropped"
      ? this.bots.filter((bot) => bot.actor.alive).sort((a, b) => distanceOnGround(a.actor.root.position, bomb.position) - distanceOnGround(b.actor.root.position, bomb.position))[0]
      : null;
    for (const bot of this.bots) {
      const isCarrier = bomb.carrierId === `bot-${bot.index}`;
      const isRecovering = replacement === bot;
      const goal = isRecovering ? bomb.position : isCarrier ? targetSite : { x: targetSite.x + (bot.index % 2 ? 2.3 : -2.3), y: 1, z: targetSite.z + (bot.index < 2 ? -2.3 : 2.3) };
      bot.setObjective(new Vector3(goal.x, 1, goal.z), bomb.status === "planted" ? "hold" : "advance");
    }
  }

  private updateSoloBomb(deltaSeconds: number): void {
    if (!this.player || this.match.phase !== "LIVE") return;
    const bomb = this.soloBomb;
    let plantedThisFrame = false;
    if (bomb.status === "carried") {
      if (bomb.carrierId === "solo-player") {
        bomb.position = { x: this.player.camera.position.x, y: 0.15, z: this.player.camera.position.z };
      } else if (bomb.carrierId?.startsWith("bot-")) {
        const carrier = this.bots[Number(bomb.carrierId.slice(4))];
        if (!carrier?.actor.alive) this.dropSoloBomb(carrier?.actor.root.position ?? bomb.position);
        else {
          bomb.position = { x: carrier.actor.root.position.x, y: 0.15, z: carrier.actor.root.position.z };
          if (this.siteAt(carrier.actor.root.position)) {
            bomb.status = "planting";
            bomb.planterId = bomb.carrierId;
            bomb.site = this.siteAt(carrier.actor.root.position);
            bomb.progress = 0;
          }
        }
      }
    } else if (bomb.status === "dropped" && !this.match.playerAttacking) {
      const nearest = this.bots.filter((bot) => bot.actor.alive).sort((a, b) => distanceOnGround(a.actor.root.position, bomb.position) - distanceOnGround(b.actor.root.position, bomb.position))[0];
      if (nearest && distanceOnGround(nearest.actor.root.position, bomb.position) < 1.8) {
        bomb.status = "carried";
        bomb.carrierId = `bot-${nearest.index}`;
        this.emitSnapshot("敌方重新拾取 C4");
      }
    } else if (bomb.status === "planting") {
      const playerPlanting = bomb.planterId === "solo-player";
      const planter = playerPlanting ? this.player.camera.position : this.bots[Number(bomb.planterId?.slice(4))]?.actor.root.position;
      if (!planter || !this.siteAt(planter) || playerPlanting && (!this.interactionHeld || this.health <= 0 || this.latestMotion.moving)) {
        if (playerPlanting) this.releaseInteraction();
        else {
          bomb.status = "carried";
          bomb.planterId = null;
          bomb.progress = 0;
          bomb.site = null;
        }
      } else {
        bomb.position = { x: planter.x, y: 0.15, z: planter.z };
        bomb.progress = Math.min(1, bomb.progress + deltaSeconds / COMPETITIVE_RULES.plantSeconds);
        if (bomb.progress >= 1) {
          bomb.status = "planted";
          bomb.carrierId = null;
          bomb.position = { x: planter.x, y: 0.15, z: planter.z };
          bomb.remainingSeconds = COMPETITIVE_RULES.bombSeconds;
          bomb.progress = 0;
          this.interactionHeld = false;
          this.match.setBombPlanted(true);
          plantedThisFrame = true;
          if (playerPlanting) this.economy.awardObjective(`round-${this.match.round}-plant`, "C4 安放奖励");
          this.emitSnapshot(`C4 已安放在 ${bomb.site} 区 · ${COMPETITIVE_RULES.bombSeconds} 秒引爆`);
        }
      }
    }
    if (!plantedThisFrame && (bomb.status === "planted" || bomb.status === "defusing")) {
      bomb.remainingSeconds = Math.max(0, bomb.remainingSeconds - deltaSeconds);
      if (bomb.remainingSeconds <= 0) {
        bomb.status = "exploded";
        bomb.progress = 1;
        this.finishRound(this.match.playerAttacking, "explosion");
        this.syncBombMarker();
        return;
      }
      this.updateSoloDefuse(deltaSeconds);
    }
    this.syncBombMarker();
  }

  private updateSoloDefuse(deltaSeconds: number): void {
    const bomb = this.soloBomb;
    if (!this.match.playerAttacking) {
      if (bomb.status !== "defusing" || bomb.defuserId !== "solo-player") return;
      if (!this.interactionHeld || this.health <= 0 || this.latestMotion.moving || !this.player || distanceOnGround(this.player.camera.position, bomb.position) > 2.3) {
        this.releaseInteraction();
        return;
      }
      const seconds = this.economy.inventory.has("defuse-kit") ? COMPETITIVE_RULES.kitDefuseSeconds : COMPETITIVE_RULES.defuseSeconds;
      bomb.progress = Math.min(1, bomb.progress + deltaSeconds / seconds);
    } else {
      const nearest = this.bots.filter((bot) => bot.actor.alive).sort((a, b) => distanceOnGround(a.actor.root.position, bomb.position) - distanceOnGround(b.actor.root.position, bomb.position))[0];
      if (!nearest || distanceOnGround(nearest.actor.root.position, bomb.position) > 2.3) {
        if (bomb.status === "defusing") {
          bomb.status = "planted";
          bomb.defuserId = null;
          bomb.progress = 0;
        }
        return;
      }
      if (bomb.status !== "defusing" || bomb.defuserId !== `bot-${nearest.index}`) {
        bomb.status = "defusing";
        bomb.defuserId = `bot-${nearest.index}`;
        bomb.progress = 0;
        this.emitSnapshot("敌方正在拆除 C4");
      }
      bomb.progress = Math.min(1, bomb.progress + deltaSeconds / COMPETITIVE_RULES.defuseSeconds);
    }
    if (bomb.progress >= 1) {
      bomb.status = "defused";
      this.interactionHeld = false;
      if (!this.match.playerAttacking) this.economy.awardObjective(`round-${this.match.round}-defuse`, "C4 拆除奖励");
      this.finishRound(!this.match.playerAttacking, "defuse");
    }
  }

  private createBombMarker(scene: Scene): Mesh {
    const body = MeshBuilder.CreateBox("objective-c4", { width: 0.62, height: 0.25, depth: 0.4 }, scene);
    const material = new PBRMaterial("objective-c4-body", scene);
    material.albedoColor = Color3.FromHexString("#343832");
    material.roughness = 0.72;
    material.metallic = 0.38;
    body.material = material;
    body.isPickable = false;
    const screen = MeshBuilder.CreateBox("objective-c4-screen", { width: 0.28, height: 0.018, depth: 0.14 }, scene);
    screen.parent = body;
    screen.position.y = 0.14;
    const screenMaterial = new PBRMaterial("objective-c4-screen-material", scene);
    screenMaterial.albedoColor = Color3.FromHexString("#b7452d");
    screenMaterial.emissiveColor = Color3.FromHexString("#b7452d").scale(0.9);
    screen.material = screenMaterial;
    screen.isPickable = false;
    body.setEnabled(false);
    return body;
  }

  private syncBombMarker(): void {
    const bomb = this.networkSnapshot?.bomb ?? this.soloBomb;
    if (!this.bombMarker) return;
    this.bombMarker.position.set(bomb.position.x, 0.18, bomb.position.z);
    this.bombMarker.setEnabled(["dropped", "planted", "defusing"].includes(bomb.status));
  }

  private planBotBuy(): void {
    if (!this.bots.length) return;
    const plan = this.botBuyPlanner.plan(this.match.round, this.bots.length, this.botEconomy.balance);
    if (this.botEconomy.spend(`round-${this.match.round}-bot-buy`, plan.spent)) {
      plan.loadouts.forEach((weaponId, index) => {
        this.bots[index]?.setWeapon(weaponId);
        if (this.targets[index]) setTargetWeapon(this.targets[index], weaponId);
      });
    }
  }

  private pause(message: string): void {
    this.running = false;
    this.mouseHeld = false;
    this.releaseInteraction();
    this.player?.setEnabled(false);
    this.callbacks.onPause(message);
  }

  private interactionPrompt(bomb: BombState, attacking: boolean, localId: string | null): { label: string | null; progress: number } {
    if (!this.player || !localId) return { label: null, progress: 0 };
    const position = this.player.camera.position;
    if (attacking) {
      if (bomb.status === "dropped" && distanceOnGround(position, bomb.position) <= 2.3) return { label: "拾取 C4 炸弹", progress: 0 };
      if (bomb.carrierId === localId && this.siteAt(position)) return { label: `按住 E 在 ${this.siteAt(position)} 区安放 C4`, progress: bomb.planterId === localId ? bomb.progress : 0 };
    } else if ((bomb.status === "planted" || bomb.status === "defusing") && distanceOnGround(position, bomb.position) <= 2.3) {
      return { label: "按住 E 拆除 C4", progress: bomb.defuserId === localId ? bomb.progress : 0 };
    }
    return { label: null, progress: 0 };
  }

  private emitSnapshot(message?: string, movementLabel = "标准移动", hit = false): void {
    if (this.networkSnapshot && this.network?.playerId) {
      const local = this.networkSnapshot.players.find((player) => player.id === this.network!.playerId);
      const nearby = this.player && this.drops ? this.drops.nearest(this.player.camera.position) : null;
      const weaponId = local?.weaponId ?? this.currentWeaponId;
      const localTeam = local?.team ?? "alpha";
      const attacking = localTeam === this.networkSnapshot.attackingTeam;
      const bomb = this.networkSnapshot.bomb;
      const interaction = this.interactionPrompt(bomb, attacking, local?.id ?? null);
      const enemyTeam: TeamId = localTeam === "alpha" ? "bravo" : "alpha";
      const aliveForTeam = (team: TeamId) => this.networkSnapshot!.players.filter((player) => player.team === team && player.connected && player.alive).length
        + this.networkSnapshot!.bots.filter((bot) => bot.team === team && bot.alive).length;
      const alphaPlayers = this.networkSnapshot.players.filter((player) => player.team === "alpha" && player.connected).length;
      const bravoPlayers = this.networkSnapshot.players.filter((player) => player.team === "bravo" && player.connected).length;
      const alphaBots = this.networkSnapshot.bots.filter((bot) => bot.team === "alpha").length;
      const bravoBots = this.networkSnapshot.bots.filter((bot) => bot.team === "bravo").length;
      this.callbacks.onSnapshot({
        playerX: this.player?.camera.position.x ?? 0,
        playerZ: this.player?.camera.position.z ?? TEAM_SPAWNS.alpha[0].z,
        playerYaw: this.player?.camera.rotation.y ?? 0,
        health: local?.health ?? this.health,
        armor: local?.armor ?? this.armor,
        helmet: local?.helmet ?? false,
        hasDefuseKit: local?.hasDefuseKit ?? false,
        hasBomb: bomb.carrierId === local?.id,
        attacking,
        bomb,
        interactionLabel: interaction.label,
        interactionProgress: interaction.progress,
        lastRoundReason: this.networkSnapshot.lastRoundReason,
        reloading: this.networkReloadRequested || (local?.reloading ?? false),
        rematchVotes: this.networkSnapshot.rematchVotes,
        ammo: this.weapon.magazine,
        reserve: this.weapon.reserve,
        targetsAlive: aliveForTeam(enemyTeam),
        movementLabel,
        round: this.networkSnapshot.round,
        phase: this.networkSnapshot.phase,
        phaseRemaining: this.networkSnapshot.phaseRemaining,
        playerRounds: localTeam === "alpha" ? this.networkSnapshot.alphaRounds : this.networkSnapshot.bravoRounds,
        botRounds: localTeam === "alpha" ? this.networkSnapshot.bravoRounds : this.networkSnapshot.alphaRounds,
        alphaRounds: this.networkSnapshot.alphaRounds,
        bravoRounds: this.networkSnapshot.bravoRounds,
        localTeam,
        alliesAlive: aliveForTeam(localTeam),
        enemiesAlive: aliveForTeam(enemyTeam),
        alphaPlayers,
        bravoPlayers,
        alphaBots,
        bravoBots,
        balance: local?.balance ?? 0,
        lossTier: localTeam === "alpha" ? this.networkSnapshot.alphaLossTier : this.networkSnapshot.bravoLossTier,
        botBalance: 0,
        weaponName: getWeaponConfig(weaponId).displayName,
        primaryWeaponName: local?.primaryWeaponId ? getWeaponConfig(local.primaryWeaponId).displayName : null,
        secondaryWeaponName: getWeaponConfig(local?.secondaryWeaponId ?? "px9").displayName,
        activeSlot: local?.activeSlot ?? "secondary",
        navigationMode: this.navigation.mode,
        nearbyWeaponName: nearby ? getWeaponConfig(nearby.weaponId).displayName : null,
        droppedWeaponCount: this.drops?.count ?? 0,
        multiplayer: true,
        roomCode: this.network.roomCode,
        playerCount: this.networkSnapshot.players.filter((player) => player.connected).length,
        connectionStatus: this.connectionStatus,
        buyItems: this.networkBuyItems(this.networkSnapshot.round, local),
        ledger: [],
        message,
        hit,
      });
      return;
    }
    const nearby = this.player && this.drops ? this.drops.nearest(this.player.camera.position) : null;
    const interaction = this.interactionPrompt(this.soloBomb, this.match.playerAttacking, "solo-player");
    this.callbacks.onSnapshot({
      playerX: this.player?.camera.position.x ?? 0,
      playerZ: this.player?.camera.position.z ?? TEAM_SPAWNS.alpha[0].z,
      playerYaw: this.player?.camera.rotation.y ?? 0,
      health: this.health,
      armor: this.armor,
      helmet: this.helmet,
      hasDefuseKit: this.economy.inventory.has("defuse-kit"),
      hasBomb: this.soloBomb.carrierId === "solo-player",
      attacking: this.match.playerAttacking,
      bomb: this.soloBomb,
      interactionLabel: interaction.label,
      interactionProgress: interaction.progress,
      lastRoundReason: this.match.lastRoundReason,
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
      alphaRounds: this.match.playerRounds,
      bravoRounds: this.match.botRounds,
      localTeam: null,
      alliesAlive: this.health > 0 ? 1 : 0,
      enemiesAlive: this.targets.filter((target) => target.alive).length,
      alphaPlayers: 1,
      bravoPlayers: 0,
      alphaBots: 0,
      bravoBots: this.targets.length,
      balance: this.economy.balance,
      lossTier: this.economy.lossTier,
      botBalance: this.botEconomy.balance,
      weaponName: this.weapon.config.displayName,
      primaryWeaponName: this.primaryWeaponId ? getWeaponConfig(this.primaryWeaponId).displayName : null,
      secondaryWeaponName: getWeaponConfig(this.secondaryWeaponId).displayName,
      activeSlot: this.activeSlot,
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
    if (!this.scene || !this.player || !this.network?.playerId) return;
    const previousPhase = this.networkPhase;
    const joiningSnapshot = this.networkSnapshot === null;
    const previousRound = this.networkSnapshot?.round;
    const wasAlive = this.health > 0;
    this.networkSnapshot = snapshot;
    this.networkPhase = snapshot.phase;
    this.syncBombMarker();
    const local = snapshot.players.find((player) => player.id === this.network!.playerId);
    if (local) {
      this.health = local.health;
      this.armor = local.armor;
      this.helmet = local.helmet;
      this.networkReloadRequested = local.reloading;
      if (this.network && this.pendingNetworkWeaponSlot != null) {
        const pendingWeaponId = this.pendingNetworkWeaponSlot === "primary" ? local.primaryWeaponId : local.secondaryWeaponId;
        if (local.activeSlot === this.pendingNetworkWeaponSlot || !pendingWeaponId || !local.alive || !["BUY", "LIVE"].includes(snapshot.phase)) {
          this.pendingNetworkWeaponSlot = null;
        }
      }
      this.primaryWeaponId = local.primaryWeaponId;
      this.secondaryWeaponId = local.secondaryWeaponId;
      this.activeSlot = local.activeSlot;
      if (local.weaponId !== this.currentWeaponId) {
        this.currentWeaponId = local.weaponId;
        this.weapon = new WeaponStateMachine(getWeaponConfig(local.weaponId), 0xb4eac1 + snapshot.round);
      }
      this.weapon.magazine = local.magazine;
      this.weapon.reserve = local.reserve;
      const authoritative = new Vector3(local.position.x, local.position.y, local.position.z);
      if (previousRound !== snapshot.round || Vector3.DistanceSquared(authoritative, this.player.camera.position) > 6.25) {
        this.player.camera.position.copyFrom(authoritative);
        this.player.camera.rotation.y = local.yaw;
      }
    }
    this.ensureNetworkTargetActors(snapshot.bots.length);
    const networkActors = [...this.targets, ...this.networkTargets];
    snapshot.bots.forEach((bot, index) => {
      const target = networkActors[index];
      if (!target) return;
      const previousPosition = target.root.position.clone();
      target.alive = bot.alive;
      target.health = bot.health;
      target.root.position.set(bot.position.x, bot.position.y, bot.position.z);
      setTargetWeapon(target, bot.weaponId);
      const aimFacing = typeof bot.lastShotAt === "number" && snapshot.serverTime - bot.lastShotAt < 500 && Boolean(bot.lastShotTarget);
      const facing = aimFacing && bot.lastShotTarget
        ? new Vector3(bot.lastShotTarget.x - bot.position.x, 0, bot.lastShotTarget.z - bot.position.z)
        : target.root.position.subtract(previousPosition);
      if (target.root.rotation && facing.lengthSquared() > 0.0025 && (aimFacing || facing.lengthSquared() < 25)) {
        target.root.rotation.y = Math.atan2(facing.x, facing.z);
      }
      target.rig?.setTeam(bot.team === local?.team);
      target.root.setEnabled(bot.alive);
      this.syncNetworkBotShot(bot, target, local, index);
    });
    for (let index = snapshot.bots.length; index < networkActors.length; index += 1) networkActors[index]?.root.setEnabled(false);
    this.drops?.syncNetwork(snapshot.drops);
    if (local) this.remotePlayers?.apply(snapshot.players, this.network.playerId, local.team);
    if (snapshot.phase === "BUY") this.promptedNetworkRound = 0;
    if (snapshot.phase === "LIVE" && local?.alive && !this.running && this.promptedNetworkRound !== snapshot.round) {
      this.promptedNetworkRound = snapshot.round;
      this.running = false;
      this.player.setEnabled(false);
      this.callbacks.onPause(previousPhase === "BUY" ? "队伍已准备 · 点击进入交战" : "已加入进行中的回合 · 点击进入交战");
    }
    if (snapshot.phase !== "LIVE") {
      this.running = false;
      this.mouseHeld = false;
      this.releaseInteraction();
      this.player.setEnabled(false);
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    }
    if (local && !local.alive && wasAlive) {
      this.running = false;
      this.mouseHeld = false;
      this.releaseInteraction();
      this.player.setEnabled(false);
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
      this.callbacks.onPause(joiningSnapshot ? "本回合进行中 · 下一回合入场" : "你已阵亡 · 等待回合结束");
    }
    this.emitSnapshot();
  }

  private ensureNetworkTargetActors(count: number): void {
    const needed = Math.min(count, COMPETITIVE_RULES.maxPlayers - 1);
    while (this.targets.length + this.networkTargets.length < needed) {
      this.networkTargets.push(this.makeNetworkTargetActor(this.targets.length + this.networkTargets.length));
    }
  }

  private makeNetworkTargetActor(index: number): TargetActor {
    return createNetworkTargetActor(this.scene!, index);
  }

  private syncNetworkBotShot(bot: RoomSnapshot["bots"][number], actor: TargetActor, local: RoomSnapshot["players"][number] | undefined, index: number): void {
    if (!bot.alive || !this.scene) return;
    const shotMarker = typeof bot.lastShotAt === "number" ? bot.lastShotAt : null;
    if (shotMarker === null || !Number.isFinite(shotMarker)) return;
    const previous = this.networkBotShotMarkers.get(bot.id);
    if (previous !== undefined && shotMarker <= previous) return;
    this.networkBotShotMarkers.set(bot.id, shotMarker);
    if (this.networkSnapshot && this.networkSnapshot.serverTime - shotMarker > 300) return;
    const target = bot.lastShotTarget
      ? new Vector3(bot.lastShotTarget.x, bot.lastShotTarget.y, bot.lastShotTarget.z)
      : this.networkShotFallbackTarget(bot, local);
    actor.rig?.update(0, 0, 0, true);
    this.botMuzzle?.flash(index, actor.root.position, target, bot.weaponId, targetMuzzlePosition(actor));
  }

  private networkShotFallbackTarget(bot: RoomSnapshot["bots"][number], local: RoomSnapshot["players"][number] | undefined): Vector3 {
    if (local && bot.team !== local.team && this.player) return this.player.camera.position.clone();
    const enemy = this.networkSnapshot?.players.find((player) => player.alive && player.team !== bot.team);
    if (enemy) return new Vector3(enemy.position.x, enemy.position.y + 0.72, enemy.position.z);
    const enemyBot = this.networkSnapshot?.bots.find((candidate) => candidate.alive && candidate.team !== bot.team);
    if (enemyBot) return new Vector3(enemyBot.position.x, enemyBot.position.y + 0.72, enemyBot.position.z);
    return new Vector3(bot.position.x, bot.position.y + 0.72, bot.position.z + 8);
  }

  private canAct(): boolean {
    if (!this.running) return false;
    if (this.networkSnapshot && this.network?.playerId) {
      return this.networkSnapshot.phase === "LIVE" && this.networkSnapshot.players.some((player) => player.id === this.network!.playerId && player.alive);
    }
    return this.match.phase === "LIVE" && this.health > 0;
  }

  private networkBuyItems(round: number, local: RoomSnapshot["players"][number] | undefined): BuyItemSnapshot[] {
    return [
      ...(Object.keys(WEAPON_CATALOG) as WeaponId[]).filter((id) => id !== "px9").map((id) => {
        const config = getWeaponConfig(id);
        return { id, name: config.displayName, category: config.weaponClass.toUpperCase(), price: config.price, locked: (round === 1 || round === COMPETITIVE_RULES.halfRounds + 1) && config.slot === "primary", owned: id === local?.primaryWeaponId || id === local?.secondaryWeaponId };
      }),
      { id: "armor" as const, name: "复合护甲", category: "GEAR", price: ECONOMY_CONFIG.armorPrice, locked: false, owned: (local?.armor ?? 0) >= 100 },
      { id: "helmet" as const, name: "战术头盔", category: "GEAR", price: ECONOMY_CONFIG.helmetPrice, locked: false, owned: local?.helmet ?? false },
      { id: "defuse-kit" as const, name: "拆弹工具组", category: "GEAR", price: ECONOMY_CONFIG.defuseKitPrice, locked: local?.team === this.networkSnapshot?.attackingTeam, owned: local?.hasDefuseKit ?? false },
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
          locked: (this.match.round === 1 || this.match.round === COMPETITIVE_RULES.halfRounds + 1) && config.slot === "primary",
          owned: this.economy.inventory.has(id),
        } satisfies BuyItemSnapshot;
      });
    return [
      ...weaponItems,
      { id: "armor", name: "复合护甲", category: "GEAR", price: ECONOMY_CONFIG.armorPrice, locked: false, owned: this.armor >= 100 },
      { id: "helmet", name: "战术头盔", category: "GEAR", price: ECONOMY_CONFIG.helmetPrice, locked: false, owned: this.economy.inventory.has("helmet") },
      { id: "defuse-kit", name: "拆弹工具组", category: "GEAR", price: ECONOMY_CONFIG.defuseKitPrice, locked: this.match.playerAttacking, owned: this.economy.inventory.has("defuse-kit") },
    ];
  }

  private itemName(itemId: WeaponId | "armor" | "helmet" | "defuse-kit"): string {
    if (itemId === "armor") return "复合护甲";
    if (itemId === "helmet") return "战术头盔";
    if (itemId === "defuse-kit") return "拆弹工具组";
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
