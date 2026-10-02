import { Game, type BuyItemSnapshot, type GameSnapshot } from "../game/Game";
import type { WeaponId } from "../game/combat/WeaponCatalog";
import { ECONOMY_CONFIG } from "../game/economy/EconomySystem";
import { ARENA_BOUNDS, ARENA_BOXES, BOMB_SITES, COMPETITIVE_RULES, MAP_ZONES } from "../shared/game-data.mjs";

export class App {
  private game: Game | null = null;
  private readonly host: HTMLDivElement;
  private rendererBackend = "WEBGL2";
  private multiplayer = false;
  private matchEntered = false;
  private latestSnapshot: GameSnapshot | null = null;
  private buyRenderKey = "";
  private previewItemId: BuyItemSnapshot["id"] | null = null;

  constructor(host: HTMLDivElement) {
    this.host = host;
  }

  async mount(): Promise<void> {
    this.host.innerHTML = `
      <main class="game-frame">
        <canvas id="game-canvas" aria-label="BREACHLINE 三维战术演训区域"></canvas>
        <div class="grain" aria-hidden="true"></div>
        <section class="loading-screen" id="loading-screen" aria-live="polite">
          <div class="loading-mark"><span>B</span></div>
          <p class="kicker">TACTICAL TRAINING ENVIRONMENT</p>
          <h1>正在构建战术空间</h1>
          <div class="load-track"><i id="load-progress"></i></div>
          <p id="load-status">检测渲染后端…</p>
        </section>
        <section class="briefing" id="briefing" hidden>
          <header class="brand"><span class="brand-glyph">B//</span><b>BREACHLINE</b><small>TACTICAL PROTOCOL</small></header>
          <div class="briefing-copy">
            <p class="kicker">SOLO MATCH · SECTOR K-7</p>
            <h1>进入缺口。<br/><em>掌控炸弹点。</em></h1>
            <p class="lede">竞技拆弹：攻方安放 C4，守方阻止安放或在爆炸前拆除。第 13 回合交换攻守，先取得 13 胜。</p>
            <div class="mission-facts">
              <span><b>A / B</b> 炸弹点</span><span><b>13</b> 获胜回合</span><span><b>$800</b> 初始资金</span>
            </div>
          </div>
          <aside class="start-card">
            <span class="status-line"><i></i>比赛系统就绪</span>
            <h2>战术简报</h2>
            <dl><div><dt>移动</dt><dd>W A S D</dd></div><div><dt>跳跃 / 蹲下</dt><dd>空格 / C</dd></div><div><dt>射击 / 换弹</dt><dd>左键 / R</dd></div><div><dt>安放 / 拆除 / 拾取</dt><dd>按住 E / E</dd></div><div><dt>主副武器 / 丢武器</dt><dd>1 / 2 / G</dd></div><div><dt>丢弃 C4</dt><dd>Shift + G</dd></div></dl>
            <button id="start-button" class="start-button"><span>选择比赛模式</span><b>ENTER</b></button>
            <p id="backend-label">渲染后端：检测中</p>
          </aside>
          <footer><span>BUILD 0.2 // LOCAL SIMULATION</span><span>原创单人战术 FPS</span></footer>
        </section>
        <section class="hud" id="hud" hidden aria-label="游戏状态">
          <div class="radar" aria-label="K-7 区域小地图">
            <div class="radar-heading"><b>SECTOR K-7</b><span>N ↑</span></div>
            <div class="radar-map" style="aspect-ratio:${ARENA_BOUNDS.groundWidth}/${ARENA_BOUNDS.groundDepth}">${this.radarMap()}<span class="radar-bomb" id="radar-bomb" hidden aria-label="C4 位置"></span><span class="radar-player" id="radar-player" aria-label="你的位置"></span></div>
            <div class="radar-footer"><span id="radar-zone">南入口</span><b id="hud-money">$800</b></div>
          </div>
          <div class="hud-top">
            <div class="score-strip">
              <div class="score-team score-team--ally"><b id="score-left-label">BREACH</b><div><strong id="player-score">0</strong><small><em id="allies-alive">1</em> 存活</small></div></div>
              <div class="score-clock"><small>第 <b id="round-value">01</b> 回合</small><strong id="phase-timer">00:20</strong><i id="phase-label">购买阶段</i></div>
              <div class="score-team score-team--enemy"><b id="score-right-label">HOSTILE</b><div><small><em id="enemies-alive">4</em> 存活</small><strong id="bot-score">0</strong></div></div>
            </div>
            <div class="hud-network"><span id="network-pill" hidden>ROOM ----- · 1/4</span><div class="backend-chip" id="hud-backend">WEBGL2</div></div>
          </div>
          <button class="match-exit-button" data-exit-match type="button">退出对局</button>
          <div class="objective"><b id="objective-label">购买装备并准备</b><i id="target-count">4 个目标存活</i></div>
          <div class="crosshair" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></div>
          <div class="hit-marker" id="hit-marker" aria-hidden="true">×</div>
          <div class="combat-log" id="combat-log" aria-live="polite"></div>
          <div class="pickup-prompt" id="pickup-prompt" hidden><b>E</b><span id="pickup-label">拾取武器</span><i class="interaction-progress"><span id="interaction-progress"></span></i></div>
          <div class="hud-bottom">
            <div class="vitals"><span><small>＋ 生命</small><b id="health-value">100</b></span><i></i><span><small>◇ 护甲</small><b id="armor-value">0</b></span></div>
            <div class="hud-center"><div class="movement-state" id="movement-state">购买阶段</div><div class="equipment-state" id="equipment-state">2 副武器</div></div>
            <div class="ammo"><span><small id="weapon-label">PX-9 SERVICE</small><b id="ammo-value">12</b></span><i>/</i><strong id="reserve-value">48</strong></div>
          </div>
        </section>
        <section class="lobby-panel" id="lobby-panel" hidden>
          <p class="kicker">LAN COMPETITIVE DEFUSAL</p><h2>建立竞技拆弹房间</h2><p>同一局域网内最多 10 名玩家自动平衡到 ALPHA 与 BRAVO；服务器补齐 Bot，组成 5 对 5 的攻守队伍。</p>
          <label>呼号<input id="player-name" maxlength="18" value="Operator" autocomplete="nickname" /></label>
          <div class="lobby-actions"><button id="create-room-button"><small>新建</small><b>创建房间</b></button><button id="solo-button"><small>离线</small><b>单人训练</b></button></div>
          <div class="join-room"><input id="room-code-input" maxlength="5" placeholder="房间码" aria-label="五位房间码"/><button id="join-room-button">加入房间</button></div>
          <p id="lobby-status" class="lobby-status">服务器地址自动使用当前设备的局域网 IP 与 8787 端口。</p>
          <button id="lobby-back" class="text-button">返回简报</button>
        </section>
        <section class="buy-panel" id="buy-panel" hidden aria-label="购买装备">
          <header>
            <div><p class="kicker">BREACHLINE / 装备采购 · <span id="buy-round">PISTOL ROUND</span></p><h2>购买装备</h2></div>
            <div class="wallet"><small>可用资金</small><b id="balance-value">$800</b><span id="loss-tier">失败奖励 $1,900</span><span id="bot-budget">敌方共享预算 $300</span></div>
            <button class="buy-exit-button" data-exit-match type="button">退出对局</button>
          </header>
          <div class="buy-layout">
            <div class="buy-grid" id="buy-grid"></div>
            <aside class="economy-card">
              <div class="buy-preview" id="buy-preview" aria-live="polite"><small>装备预览</small><div class="preview-art" id="preview-art"></div><span id="preview-category">副武器</span><h3 id="preview-name">ARC-12</h3><div class="preview-meta"><b id="preview-price">$500</b><i id="preview-state">可购买</i></div></div>
              <h3 class="ledger-heading">交易记录</h3><div id="ledger-list" class="ledger-list"><p>本局尚无交易</p></div>
              <button id="ready-button" class="ready-button"><span>准备完成</span><b>开始交战 →</b></button>
              <p id="buy-rules-note">手枪局仅开放副武器和防护装备。购买阶段结束后装备锁定。</p>
            </aside>
          </div>
        </section>
        <section class="pause-panel" id="pause-panel" hidden>
          <p class="kicker">SIMULATION HOLD</p><h2 id="pause-title">演训已暂停</h2><p>点击继续并重新锁定鼠标。</p>
          <button id="resume-button" class="start-button"><span>继续交战</span><b>CLICK</b></button>
          <button class="panel-exit-button" data-exit-match type="button">退出对局 · 返回模式选择</button>
        </section>
        <section class="result-panel" id="result-panel" hidden>
          <p class="kicker">MATCH COMPLETE</p><h2 id="result-title">比赛胜利</h2><div class="final-score"><b id="final-player-score">13</b><span>最终比分</span><b id="final-bot-score">0</b></div>
          <p id="result-copy">已赢得竞技拆弹比赛。</p><button id="restart-button" class="start-button"><span>开始新比赛</span><b>RESTART</b></button>
          <button class="panel-exit-button" data-exit-match type="button">退出对局 · 返回模式选择</button>
        </section>
        <section class="fatal-panel" id="fatal-panel" hidden><p class="kicker">STARTUP FAILURE</p><h2>无法建立三维演训</h2><p id="fatal-message"></p></section>
      </main>`;

    const canvas = this.required<HTMLCanvasElement>("#game-canvas");
    this.game = new Game(canvas, {
      onProgress: (progress, label) => this.updateLoading(progress, label),
      onReady: (backend) => this.showBriefing(backend),
      onSnapshot: (snapshot) => this.renderSnapshot(snapshot),
      onPause: (message) => this.showPause(message),
      onError: (message) => this.showFatal(message),
    });

    this.required<HTMLButtonElement>("#start-button").addEventListener("click", () => this.showLobby());
    this.required<HTMLButtonElement>("#create-room-button").addEventListener("click", () => void this.connectMultiplayer("create"));
    this.required<HTMLButtonElement>("#join-room-button").addEventListener("click", () => void this.connectMultiplayer("join"));
    this.required<HTMLButtonElement>("#solo-button").addEventListener("click", () => this.startSolo());
    this.required<HTMLButtonElement>("#lobby-back").addEventListener("click", () => this.hideLobby());
    this.required<HTMLButtonElement>("#resume-button").addEventListener("click", () => void this.resume());
    this.required<HTMLButtonElement>("#ready-button").addEventListener("click", () => void this.readyRound());
    this.required<HTMLButtonElement>("#restart-button").addEventListener("click", () => this.restartMatch());
    this.host.querySelectorAll<HTMLButtonElement>("[data-exit-match]").forEach((button) => button.addEventListener("click", () => this.exitMatch()));
    const buyGrid = this.required<HTMLElement>("#buy-grid");
    buyGrid.addEventListener("click", (event) => this.handlePurchase(event));
    buyGrid.addEventListener("pointerover", (event) => this.previewBuyItem(event));
    buyGrid.addEventListener("focusin", (event) => this.previewBuyItem(event));

    try {
      await this.game.initialize();
    } catch (error) {
      this.showFatal(error instanceof Error ? error.message : "未知启动错误");
    }
  }

  private showLobby(): void {
    this.required<HTMLElement>("#briefing").hidden = true;
    this.required<HTMLElement>("#lobby-panel").hidden = false;
    this.required<HTMLInputElement>("#player-name").focus();
  }

  private hideLobby(): void {
    this.required<HTMLElement>("#lobby-panel").hidden = true;
    this.required<HTMLElement>("#briefing").hidden = false;
  }

  private startSolo(): void {
    if (!this.game) return;
    this.multiplayer = false;
    this.matchEntered = true;
    this.required<HTMLElement>("#briefing").hidden = true;
    this.required<HTMLElement>("#lobby-panel").hidden = true;
    this.required<HTMLElement>("#hud").hidden = false;
    this.game.startSolo();
  }

  private exitMatch(): void {
    if (!this.game || !this.matchEntered) return;
    this.matchEntered = false;
    this.multiplayer = false;
    this.game.leaveMatch();
    for (const selector of ["#hud", "#buy-panel", "#pause-panel", "#result-panel", "#briefing"]) {
      this.required<HTMLElement>(selector).hidden = true;
    }
    this.required<HTMLElement>("#lobby-panel").hidden = false;
    this.required<HTMLElement>("#lobby-status").textContent = "已退出对局。请选择新训练或加入房间。";
    this.required<HTMLInputElement>("#player-name").focus();
  }

  private async connectMultiplayer(action: "create" | "join"): Promise<void> {
    if (!this.game) return;
    const name = this.required<HTMLInputElement>("#player-name").value.trim() || "Operator";
    const roomCode = this.required<HTMLInputElement>("#room-code-input").value.trim().toUpperCase();
    const status = this.required<HTMLElement>("#lobby-status");
    if (action === "join" && roomCode.length !== 5) {
      status.textContent = "请输入五位房间码。";
      return;
    }
    status.textContent = action === "create" ? "正在创建局域网房间…" : `正在加入 ${roomCode}…`;
    try {
      const welcome = await this.game.connectMultiplayer({ action, name, roomCode: roomCode || undefined });
      this.multiplayer = true;
      this.matchEntered = true;
      this.required<HTMLElement>("#lobby-panel").hidden = true;
      this.required<HTMLElement>("#hud").hidden = false;
      status.textContent = `已连接房间 ${welcome.roomCode} · ${welcome.team.toUpperCase()}`;
      if (this.latestSnapshot?.multiplayer) this.renderSnapshot(this.latestSnapshot);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "连接房间失败";
    }
  }

  private async resume(): Promise<void> {
    if (!this.game) return;
    this.required<HTMLElement>("#pause-panel").hidden = true;
    this.required<HTMLElement>("#hud").hidden = false;
    await this.game.start();
  }

  private async readyRound(): Promise<void> {
    if (!this.game) return;
    this.required<HTMLElement>("#buy-panel").hidden = true;
    await this.game.readyRound();
    this.required<HTMLElement>("#pause-panel").hidden = true;
    this.required<HTMLElement>("#hud").hidden = false;
  }

  private restartMatch(): void {
    if (this.multiplayer) {
      this.game?.restartMatch();
      return;
    }
    this.required<HTMLElement>("#result-panel").hidden = true;
    this.required<HTMLElement>("#hud").hidden = false;
    this.game?.restartMatch();
  }

  private handlePurchase(event: Event): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-buy]");
    if (!button || button.disabled) return;
    this.game?.purchase(button.dataset.buy as WeaponId | "armor" | "helmet" | "defuse-kit");
  }

  private updateLoading(progress: number, label: string): void {
    this.required<HTMLElement>("#load-progress").style.width = `${Math.round(progress * 100)}%`;
    this.required<HTMLElement>("#load-status").textContent = label;
  }

  private showBriefing(backend: string): void {
    this.rendererBackend = backend.toUpperCase();
    this.required<HTMLElement>("#loading-screen").hidden = true;
    this.required<HTMLElement>("#briefing").hidden = false;
    this.required<HTMLElement>("#backend-label").textContent = `渲染后端：${backend}`;
    this.required<HTMLElement>("#hud-backend").textContent = backend;
  }

  private renderSnapshot(snapshot: GameSnapshot): void {
    this.latestSnapshot = snapshot;
    if (!this.matchEntered) return;
    this.required<HTMLElement>("#health-value").textContent = String(snapshot.health);
    this.required<HTMLElement>("#armor-value").textContent = snapshot.helmet ? `${snapshot.armor}+H` : String(snapshot.armor);
    this.required<HTMLElement>("#ammo-value").textContent = String(snapshot.ammo);
    this.required<HTMLElement>("#reserve-value").textContent = String(snapshot.reserve);
    this.required<HTMLElement>("#weapon-label").textContent = snapshot.weaponName.toUpperCase();
    this.required<HTMLElement>("#movement-state").textContent = snapshot.reloading ? "更换弹匣" : snapshot.phase === "LIVE" ? snapshot.movementLabel : this.phaseText(snapshot.phase);
    this.required<HTMLElement>("#hud-money").textContent = `$${snapshot.balance.toLocaleString("en-US")}`;
    const radarPlayer = this.required<HTMLElement>("#radar-player");
    radarPlayer.style.left = `${this.radarX(snapshot.playerX)}%`;
    radarPlayer.style.top = `${this.radarZ(snapshot.playerZ)}%`;
    radarPlayer.style.transform = `translate(-50%, -50%) rotate(${snapshot.playerYaw}rad)`;
    const radarBomb = this.required<HTMLElement>("#radar-bomb");
    radarBomb.hidden = !this.bombVisibleOnRadar(snapshot);
    radarBomb.style.left = radarBomb.hidden ? "" : `${this.radarX(snapshot.bomb.position.x)}%`;
    radarBomb.style.top = radarBomb.hidden ? "" : `${this.radarZ(snapshot.bomb.position.z)}%`;
    radarBomb.dataset.planted = String(snapshot.bomb.status === "planted" || snapshot.bomb.status === "defusing");
    this.required<HTMLElement>("#radar-zone").textContent = this.radarZone(snapshot.playerX, snapshot.playerZ);
    const bombLive = snapshot.bomb.status === "planted" || snapshot.bomb.status === "defusing";
    this.required<HTMLElement>("#target-count").textContent = bombLive
      ? `${snapshot.bomb.site ?? "?"} 区 C4 · ${Math.ceil(snapshot.bomb.remainingSeconds)} 秒引爆`
      : `${snapshot.enemiesAlive} 敌方 / ${snapshot.alliesAlive} 友方存活${snapshot.hasBomb ? " · 你携带 C4" : ""}`;
    this.required<HTMLElement>("#allies-alive").textContent = String(snapshot.alliesAlive);
    this.required<HTMLElement>("#enemies-alive").textContent = String(snapshot.enemiesAlive);
    this.required<HTMLElement>("#round-value").textContent = String(snapshot.round).padStart(2, "0");
    this.required<HTMLElement>("#phase-label").textContent = bombLive && snapshot.phase === "LIVE" ? "C4 爆炸倒计时" : this.phaseText(snapshot.phase);
    this.required<HTMLElement>("#phase-timer").textContent = this.formatTime(bombLive && snapshot.phase === "LIVE" ? snapshot.bomb.remainingSeconds : snapshot.phaseRemaining);
    this.required<HTMLElement>("#phase-timer").classList.toggle("bomb-ticking", bombLive && snapshot.phase === "LIVE");
    this.required<HTMLElement>("#player-score").textContent = String(snapshot.multiplayer ? snapshot.alphaRounds : snapshot.playerRounds);
    this.required<HTMLElement>("#bot-score").textContent = String(snapshot.multiplayer ? snapshot.bravoRounds : snapshot.botRounds);
    this.required<HTMLElement>("#score-left-label").textContent = snapshot.multiplayer ? `ALPHA · ${snapshot.attacking === (snapshot.localTeam === "alpha") ? "攻" : "守"}` : snapshot.attacking ? "你 · 攻方" : "你 · 守方";
    this.required<HTMLElement>("#score-right-label").textContent = snapshot.multiplayer ? `BRAVO · ${snapshot.attacking === (snapshot.localTeam === "bravo") ? "攻" : "守"}` : snapshot.attacking ? "BOT · 守方" : "BOT · 攻方";
    const objective = this.required<HTMLElement>(".objective");
    objective.dataset.phase = snapshot.phase;
    this.required<HTMLElement>("#objective-label").textContent = snapshot.phase === "BUY"
      ? `${snapshot.attacking ? "攻方" : "守方"} · 购买装备并准备`
      : snapshot.phase === "LIVE"
        ? bombLive ? snapshot.attacking ? "保护 C4 · 阻止拆除" : "拆除 C4 · 阻止爆炸"
          : snapshot.attacking ? snapshot.bomb.status === "dropped" ? "夺回 C4 · 前往 A/B 安放" : "前往 A/B 安放 C4"
            : "守住 A/B · 拦截携包敌人"
        : snapshot.phase === "ROUND_END" ? this.roundReason(snapshot.lastRoundReason) : "比赛已结束";
    this.required<HTMLElement>("#equipment-state").textContent = `${snapshot.hasBomb ? "▣ C4 · " : ""}${snapshot.hasDefuseKit ? "⌑ 拆弹工具 · " : ""}${snapshot.primaryWeaponName ? `1 ${snapshot.primaryWeaponName}` : "1 无主武器"}  /  2 ${snapshot.secondaryWeaponName}`;
    this.required<HTMLElement>("#balance-value").textContent = `$${snapshot.balance.toLocaleString("en-US")}`;
    this.required<HTMLElement>("#loss-tier").textContent = `失败奖励 $${ECONOMY_CONFIG.lossRewards[snapshot.lossTier].toLocaleString("en-US")}`;
    this.required<HTMLElement>("#buy-round").textContent = snapshot.round === 1 || snapshot.round === COMPETITIVE_RULES.halfRounds + 1 ? "PISTOL ROUND" : `ROUND ${snapshot.round}`;
    this.required<HTMLElement>("#buy-rules-note").textContent = snapshot.round === 1 || snapshot.round === COMPETITIVE_RULES.halfRounds + 1
      ? "手枪局仅开放副武器和防护装备。购买阶段结束后装备锁定。"
      : "本回合可购买主副武器与防护装备；守方可购买拆弹工具组。准备后装备锁定。";
    this.required<HTMLElement>("#bot-budget").textContent = snapshot.multiplayer
      ? `ALPHA ${snapshot.alphaPlayers}P+${snapshot.alphaBots}B · BRAVO ${snapshot.bravoPlayers}P+${snapshot.bravoBots}B`
      : `敌方共享预算 $${snapshot.botBalance.toLocaleString("en-US")}`;
    this.required<HTMLElement>("#hud-backend").textContent = `${this.rendererBackend} · ${snapshot.navigationMode}`;
    const pickupPrompt = this.required<HTMLElement>("#pickup-prompt");
    pickupPrompt.hidden = snapshot.phase !== "LIVE" || !snapshot.interactionLabel && !snapshot.nearbyWeaponName;
    this.required<HTMLElement>("#pickup-label").textContent = snapshot.interactionLabel ?? (snapshot.nearbyWeaponName ? `拾取 ${snapshot.nearbyWeaponName}` : "拾取武器");
    this.required<HTMLElement>("#interaction-progress").style.width = `${Math.round(snapshot.interactionProgress * 100)}%`;
    pickupPrompt.classList.toggle("interacting", snapshot.interactionProgress > 0);
    const networkPill = this.required<HTMLElement>("#network-pill");
    networkPill.hidden = !snapshot.multiplayer;
    networkPill.textContent = snapshot.multiplayer ? `ROOM ${snapshot.roomCode ?? "-----"} · ${snapshot.localTeam?.toUpperCase()} · ${snapshot.playerCount}/${COMPETITIVE_RULES.maxPlayers} · ${snapshot.connectionStatus.toUpperCase()}` : "";

    const buyPanel = this.required<HTMLElement>("#buy-panel");
    buyPanel.hidden = !this.matchEntered || snapshot.phase !== "BUY";
    if (!buyPanel.hidden) {
      this.required<HTMLElement>("#pause-panel").hidden = true;
      this.renderBuyItems(snapshot.buyItems, snapshot.balance, snapshot.ledger);
    } else this.buyRenderKey = "";

    const resultPanel = this.required<HTMLElement>("#result-panel");
    resultPanel.hidden = snapshot.phase !== "MATCH_END";
    if (snapshot.phase === "MATCH_END") {
      const won = snapshot.playerRounds > snapshot.botRounds;
      this.required<HTMLElement>("#result-title").textContent = won ? "比赛胜利" : "比赛失败";
      this.required<HTMLElement>("#result-copy").textContent = won
        ? snapshot.multiplayer ? `${snapshot.localTeam?.toUpperCase()} 赢得竞技拆弹比赛。` : "你赢得了竞技拆弹比赛。"
        : snapshot.multiplayer ? "敌方队伍赢得比赛。" : "Bot 队伍赢得比赛，重新调整攻守策略。";
      if (snapshot.multiplayer) this.required<HTMLElement>("#result-copy").textContent += ` 再战投票 ${snapshot.rematchVotes}/${snapshot.playerCount}。`;
      this.required<HTMLElement>("#final-player-score").textContent = String(snapshot.playerRounds);
      this.required<HTMLElement>("#final-bot-score").textContent = String(snapshot.botRounds);
      this.required<HTMLButtonElement>("#restart-button").querySelector("span")!.textContent = snapshot.multiplayer ? "投票再战" : "开始新比赛";
    }

    if (snapshot.hit) {
      const marker = this.required<HTMLElement>("#hit-marker");
      marker.classList.remove("show");
      requestAnimationFrame(() => marker.classList.add("show"));
    }
    if (snapshot.message) {
      const log = this.required<HTMLElement>("#combat-log");
      log.textContent = snapshot.message;
      log.classList.add("show");
      window.setTimeout(() => log.classList.remove("show"), 1_600);
    }
  }

  private radarMap(): string {
    const width = ARENA_BOUNDS.maxX - ARENA_BOUNDS.minX;
    const depth = ARENA_BOUNDS.maxZ - ARENA_BOUNDS.minZ;
    const boxes = ARENA_BOXES.map((box) => {
      const [boxWidth, , boxDepth] = box.dimensions;
      const [x, , z] = box.position;
      const kind = box.name.endsWith("-wall") ? "radar-wall" : box.name.startsWith("cover-") ? "radar-cover" : "radar-structure";
      return `<rect class="${kind}" x="${x - ARENA_BOUNDS.minX - boxWidth / 2}" y="${ARENA_BOUNDS.maxZ - z - boxDepth / 2}" width="${boxWidth}" height="${boxDepth}"/>`;
    }).join("");
    const sites = (["A", "B"] as const).map((id) => {
      const site = BOMB_SITES[id];
      return `<g class="radar-site"><circle cx="${site.x - ARENA_BOUNDS.minX}" cy="${ARENA_BOUNDS.maxZ - site.z}" r="${site.radius}"/><text x="${site.x - ARENA_BOUNDS.minX}" y="${ARENA_BOUNDS.maxZ - site.z + 1.4}">${id}</text></g>`;
    }).join("");
    return `<svg viewBox="0 0 ${width} ${depth}" aria-hidden="true" focusable="false"><rect class="radar-floor" x="0" y="0" width="${width}" height="${depth}"/>${boxes}${sites}</svg>`;
  }

  private radarX(x: number): number {
    return Math.max(0, Math.min(100, (x - ARENA_BOUNDS.minX) / (ARENA_BOUNDS.maxX - ARENA_BOUNDS.minX) * 100));
  }

  private radarZ(z: number): number {
    return Math.max(0, Math.min(100, (ARENA_BOUNDS.maxZ - z) / (ARENA_BOUNDS.maxZ - ARENA_BOUNDS.minZ) * 100));
  }

  private radarZone(x: number, z: number): string {
    for (const id of ["A", "B"] as const) if (Math.hypot(x - BOMB_SITES[id].x, z - BOMB_SITES[id].z) <= BOMB_SITES[id].radius) return `${id} 炸弹点`;
    return MAP_ZONES.find((zone) => Math.abs(x - zone.x) <= zone.width / 2 && Math.abs(z - zone.z) <= zone.depth / 2)?.label ?? "工业园区";
  }

  private bombVisibleOnRadar(snapshot: Pick<GameSnapshot, "attacking" | "bomb">): boolean {
    const status = snapshot.bomb.status;
    return status === "planted" || status === "defusing" || snapshot.attacking && (status === "dropped" || status === "planting");
  }

  private previewBuyItem(event: Event): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-buy]");
    if (!button) return;
    this.showBuyPreview(button.dataset.buy as BuyItemSnapshot["id"]);
  }

  private showBuyPreview(id: BuyItemSnapshot["id"]): void {
    const item = this.latestSnapshot?.buyItems.find((candidate) => candidate.id === id);
    if (!item || !this.latestSnapshot) return;
    this.previewItemId = id;
    this.required<HTMLElement>("#preview-art").innerHTML = this.buyPreviewArt(id);
    this.required<HTMLElement>("#preview-category").textContent = item.category;
    this.required<HTMLElement>("#preview-name").textContent = item.name;
    this.required<HTMLElement>("#preview-price").textContent = `$${item.price.toLocaleString("en-US")}`;
    this.required<HTMLElement>("#preview-state").textContent = item.locked ? item.id === "defuse-kit" ? "仅守方可购买" : "手枪局锁定" : item.owned ? "已拥有" : item.price > this.latestSnapshot.balance ? "余额不足" : "可购买";
    this.required<HTMLElement>("#buy-grid").querySelectorAll("button[data-buy]").forEach((button) => button.classList.toggle("previewed", (button as HTMLButtonElement).dataset.buy === id));
  }

  private renderBuyItems(items: BuyItemSnapshot[], balance: number, ledger: string[]): void {
    const renderKey = JSON.stringify([items, balance, ledger]);
    if (renderKey === this.buyRenderKey) return;
    this.buyRenderKey = renderKey;
    const groups = [
      { title: "副武器", categories: ["PISTOL"] },
      { title: "近距火力", categories: ["SMG", "SHOTGUN"] },
      { title: "主武器", categories: ["RIFLE", "SNIPER"] },
      { title: "防护装备", categories: ["GEAR"] },
    ];
    this.required<HTMLElement>("#buy-grid").innerHTML = groups.map((group, index) => `<section class="buy-category"><h3><span>0${index + 1}</span>${group.title}</h3><div class="buy-category-items">${items.filter((item) => group.categories.includes(item.category)).map((item) => {
      const disabled = item.locked || item.owned || item.price > balance;
      const state = item.locked ? item.id === "defuse-kit" ? "仅守方可购买" : "手枪局锁定" : item.owned ? "已拥有" : item.price > balance ? "余额不足" : "购买";
      return `<button data-buy="${item.id}" ${disabled ? "disabled" : ""}>${this.buyItemArt(item.id)}<small>${item.category}</small><strong>${item.name}</strong><span>$${item.price.toLocaleString("en-US")}</span><i>${state}</i></button>`;
    }).join("")}</div></section>`).join("");
    this.required<HTMLElement>("#ledger-list").innerHTML = ledger.length ? ledger.map((entry) => `<p>${entry}</p>`).join("") : "<p>本局尚无交易</p>";
    this.showBuyPreview(this.previewItemId && items.some((item) => item.id === this.previewItemId) ? this.previewItemId : items[0].id);
  }

  private buyItemArt(id: BuyItemSnapshot["id"]): string {
    const shapes: Record<BuyItemSnapshot["id"], string> = {
      px9: '<path d="M54 27h123v21H88l-13 32H48l15-36h-9z"/><rect x="157" y="25" width="16" height="3"/>',
      arc12: '<path d="M54 27h123v21H88l-13 32H48l15-36h-9z"/><rect x="157" y="25" width="16" height="3"/>',
      vx7: '<path d="M30 37h57l10-10h67v9h40v7h-40v15h-57l-12 20H75l8-20H48l-18 12z"/><rect x="112" y="57" width="17" height="26"/>',
      rift6: '<path d="M17 43h50l20-11h45v8h92v6h-92v8H83L45 70H17l18-20H17z"/><rect x="127" y="50" width="53" height="7"/>',
      br4: '<path d="M15 34h36l22 8 16-12h71v7h58v7h-58v14h-37l-11 25H93l6-25H71L43 69H17l17-22H15z"/><rect x="93" y="25" width="51" height="5"/>',
      needle50: '<path d="M14 42h60l19-9h45v8h89v7h-89v12H91L51 70H20l17-20H14z"/><rect x="93" y="21" width="57" height="8"/><rect x="109" y="29" width="6" height="7"/>',
      armor: '<path d="M120 10 178 31v21c0 27-23 44-58 57-35-13-58-30-58-57V31z" transform="translate(0 -13) scale(1 .91)"/><path d="M120 20 157 35v17c0 16-15 28-37 38-22-10-37-22-37-38V35z" fill="#222629"/>',
      helmet: '<path d="M63 49c0-31 25-45 57-45s57 14 57 45v8h-17l-10 23H94L84 57H63z"/><rect x="72" y="52" width="96" height="9"/>',
      "defuse-kit": '<rect x="77" y="14" width="86" height="61" rx="7"/><rect x="88" y="24" width="64" height="20" rx="3" fill="#222629"/><path d="M103 6h34v9h-34zM104 47h12v20h-12zM123 47h12v20h-12z"/>',
    };
    return `<span class="buy-item-art" aria-hidden="true"><svg viewBox="0 0 240 90" focusable="false" fill="currentColor">${shapes[id]}</svg></span>`;
  }

  private buyPreviewArt(id: BuyItemSnapshot["id"]): string {
    const weaponImage: Partial<Record<BuyItemSnapshot["id"], string>> = {
      px9: "pistol",
      arc12: "pistol",
      vx7: "smg",
      rift6: "shotgun",
      br4: "rifle",
      needle50: "sniper",
    };
    const imageName = weaponImage[id];
    return imageName
      ? `<img src="/weapons/${imageName}-view.png" alt="" aria-hidden="true" />`
      : this.buyItemArt(id);
  }

  private showPause(message: string): void {
    if (!this.matchEntered) return;
    this.required<HTMLElement>("#hud").hidden = true;
    this.required<HTMLElement>("#pause-title").textContent = message;
    this.required<HTMLElement>("#pause-panel").hidden = false;
  }

  private showFatal(message: string): void {
    this.required<HTMLElement>("#loading-screen").hidden = true;
    this.required<HTMLElement>("#briefing").hidden = true;
    this.required<HTMLElement>("#fatal-panel").hidden = false;
    this.required<HTMLElement>("#fatal-message").textContent = message;
  }

  private phaseText(phase: GameSnapshot["phase"]): string {
    return phase === "BUY" ? "购买阶段" : phase === "LIVE" ? "交战中" : phase === "ROUND_END" ? "回合结算" : "比赛结束";
  }

  private formatTime(seconds: number): string {
    const whole = Math.max(0, Math.ceil(seconds));
    return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
  }

  private roundReason(reason: string | null): string {
    const labels: Record<string, string> = {
      plant: "C4 安放",
      defuse: "C4 已拆除",
      bomb_defused: "C4 已拆除",
      explosion: "C4 爆炸",
      bomb_exploded: "C4 爆炸",
      time: "回合时间耗尽",
      time_expired: "回合时间耗尽",
      elimination: "队伍歼灭",
      attackers_eliminated: "攻方全员被歼灭",
      defenders_eliminated: "守方全员被歼灭",
    };
    return reason ? labels[reason] ?? "回合经济结算" : "回合经济结算";
  }

  private required<T extends Element>(selector: string): T {
    const element = this.host.querySelector<T>(selector);
    if (!element) throw new Error(`Missing UI element: ${selector}`);
    return element;
  }
}
