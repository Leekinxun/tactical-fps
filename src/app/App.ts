import { Game, type BuyItemSnapshot, type GameSnapshot } from "../game/Game";
import type { WeaponId } from "../game/combat/WeaponCatalog";

export class App {
  private game: Game | null = null;
  private readonly host: HTMLDivElement;
  private rendererBackend = "WEBGL2";
  private multiplayer = false;

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
            <h1>进入缺口。<br/><em>赢下七个回合。</em></h1>
            <p class="lede">对抗四名具备视线、听觉和反应延迟的战术 Bot。通过击杀与回合奖金升级装备，先取得七胜。</p>
            <div class="mission-facts">
              <span><b>04</b> 战术 Bot</span><span><b>07</b> 获胜回合</span><span><b>$800</b> 初始资金</span>
            </div>
          </div>
          <aside class="start-card">
            <span class="status-line"><i></i>比赛系统就绪</span>
            <h2>战术简报</h2>
            <dl><div><dt>移动</dt><dd>W A S D</dd></div><div><dt>跳跃 / 蹲下</dt><dd>空格 / C</dd></div><div><dt>射击 / 换弹</dt><dd>左键 / R</dd></div><div><dt>拾取 / 丢弃</dt><dd>E / G</dd></div></dl>
            <button id="start-button" class="start-button"><span>选择比赛模式</span><b>ENTER</b></button>
            <p id="backend-label">渲染后端：检测中</p>
          </aside>
          <footer><span>BUILD 0.2 // LOCAL SIMULATION</span><span>原创单人战术 FPS</span></footer>
        </section>
        <section class="hud" id="hud" hidden aria-label="游戏状态">
          <div class="hud-top">
            <div class="round-chip"><small>回合</small><b id="round-value">01</b></div>
            <div class="score-strip"><strong id="player-score">0</strong><span><b id="score-left-label">BREACH</b> <i id="phase-label">BUY</i> <b id="score-right-label">HOSTILE</b></span><strong id="bot-score">0</strong><small id="phase-timer">00:20</small></div>
            <div class="hud-network"><span id="network-pill" hidden>ROOM ----- · 1/4</span><div class="backend-chip" id="hud-backend">WEBGL2</div></div>
          </div>
          <div class="objective"><span>目标</span><b id="objective-label">购买装备并准备</b><i id="target-count">4 个目标存活</i></div>
          <div class="crosshair" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></div>
          <div class="hit-marker" id="hit-marker" aria-hidden="true">×</div>
          <div class="combat-log" id="combat-log" aria-live="polite"></div>
          <div class="pickup-prompt" id="pickup-prompt" hidden><b>E</b><span id="pickup-label">拾取武器</span></div>
          <div class="hud-bottom">
            <div class="vitals"><span><small>生命</small><b id="health-value">100</b></span><i></i><span><small>护甲</small><b id="armor-value">0</b></span></div>
            <div class="movement-state" id="movement-state">购买阶段</div>
            <div class="ammo"><span><small id="weapon-label">PX-9 SERVICE</small><b id="ammo-value">12</b></span><i>/</i><strong id="reserve-value">48</strong></div>
          </div>
        </section>
        <section class="lobby-panel" id="lobby-panel" hidden>
          <p class="kicker">LAN MIXED-SQUAD PROTOCOL</p><h2>建立混编对抗房间</h2><p>同一局域网内最多 4 名玩家自动平衡到 ALPHA 与 BRAVO；服务器为两队补充 Bot，组成规模相同的混编小队。</p>
          <label>呼号<input id="player-name" maxlength="18" value="Operator" autocomplete="nickname" /></label>
          <div class="lobby-actions"><button id="create-room-button"><small>新建</small><b>创建房间</b></button><button id="solo-button"><small>离线</small><b>单人训练</b></button></div>
          <div class="join-room"><input id="room-code-input" maxlength="5" placeholder="房间码" aria-label="五位房间码"/><button id="join-room-button">加入房间</button></div>
          <p id="lobby-status" class="lobby-status">服务器地址自动使用当前设备的局域网 IP 与 8787 端口。</p>
          <button id="lobby-back" class="text-button">返回简报</button>
        </section>
        <section class="buy-panel" id="buy-panel" hidden aria-label="购买装备">
          <header>
            <div><p class="kicker">BUY PHASE · <span id="buy-round">PISTOL ROUND</span></p><h2>选择本回合装备</h2></div>
            <div class="wallet"><small>可用资金</small><b id="balance-value">$800</b><span id="loss-tier">失败奖励 $1,900</span><span id="bot-budget">敌方共享预算 $300</span></div>
          </header>
          <div class="buy-layout">
            <div class="buy-grid" id="buy-grid"></div>
            <aside class="economy-card">
              <h3>经济记录</h3><div id="ledger-list" class="ledger-list"><p>本局尚无交易</p></div>
              <button id="ready-button" class="ready-button"><span>准备完成</span><b>开始交战 →</b></button>
              <p>购买阶段结束后装备锁定。手枪局仅允许手枪与护甲。</p>
            </aside>
          </div>
        </section>
        <section class="pause-panel" id="pause-panel" hidden>
          <p class="kicker">SIMULATION HOLD</p><h2 id="pause-title">演训已暂停</h2><p>点击继续并重新锁定鼠标。</p>
          <button id="resume-button" class="start-button"><span>继续交战</span><b>CLICK</b></button>
        </section>
        <section class="result-panel" id="result-panel" hidden>
          <p class="kicker">MATCH COMPLETE</p><h2 id="result-title">比赛胜利</h2><div class="final-score"><b id="final-player-score">7</b><span>最终比分</span><b id="final-bot-score">0</b></div>
          <p id="result-copy">K-7 区域已完成清剿。</p><button id="restart-button" class="start-button"><span>开始新比赛</span><b>RESTART</b></button>
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
    this.required<HTMLElement>("#buy-grid").addEventListener("click", (event) => this.handlePurchase(event));

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
    this.required<HTMLElement>("#briefing").hidden = true;
    this.required<HTMLElement>("#lobby-panel").hidden = true;
    this.required<HTMLElement>("#hud").hidden = false;
    this.game.startSolo();
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
      this.required<HTMLElement>("#lobby-panel").hidden = true;
      this.required<HTMLElement>("#hud").hidden = false;
      status.textContent = `已连接房间 ${welcome.roomCode} · ${welcome.team.toUpperCase()}`;
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
    this.game?.purchase(button.dataset.buy as WeaponId | "armor" | "helmet");
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
    this.required<HTMLElement>("#health-value").textContent = String(snapshot.health);
    this.required<HTMLElement>("#armor-value").textContent = snapshot.helmet ? `${snapshot.armor}+H` : String(snapshot.armor);
    this.required<HTMLElement>("#ammo-value").textContent = String(snapshot.ammo);
    this.required<HTMLElement>("#reserve-value").textContent = String(snapshot.reserve);
    this.required<HTMLElement>("#weapon-label").textContent = snapshot.weaponName.toUpperCase();
    this.required<HTMLElement>("#movement-state").textContent = snapshot.reloading ? "更换弹匣" : snapshot.phase === "LIVE" ? snapshot.movementLabel : this.phaseText(snapshot.phase);
    this.required<HTMLElement>("#target-count").textContent = snapshot.multiplayer
      ? `${snapshot.enemiesAlive} 敌方 / ${snapshot.alliesAlive} 友方存活`
      : `${snapshot.targetsAlive} 个 Bot 存活`;
    this.required<HTMLElement>("#round-value").textContent = String(snapshot.round).padStart(2, "0");
    this.required<HTMLElement>("#phase-label").textContent = snapshot.phase;
    this.required<HTMLElement>("#phase-timer").textContent = this.formatTime(snapshot.phaseRemaining);
    this.required<HTMLElement>("#player-score").textContent = String(snapshot.multiplayer ? snapshot.alphaRounds : snapshot.playerRounds);
    this.required<HTMLElement>("#bot-score").textContent = String(snapshot.multiplayer ? snapshot.bravoRounds : snapshot.botRounds);
    this.required<HTMLElement>("#score-left-label").textContent = snapshot.multiplayer ? "ALPHA" : "BREACH";
    this.required<HTMLElement>("#score-right-label").textContent = snapshot.multiplayer ? "BRAVO" : "HOSTILE";
    this.required<HTMLElement>("#objective-label").textContent = snapshot.phase === "BUY"
      ? snapshot.multiplayer ? `你属于 ${snapshot.localTeam?.toUpperCase()} · 购买装备并准备` : "购买装备并准备"
      : snapshot.phase === "LIVE" ? snapshot.multiplayer ? "歼灭敌方混编小队" : "清除全部战术 Bot"
      : snapshot.phase === "ROUND_END" ? "回合经济结算" : "比赛已结束";
    this.required<HTMLElement>("#balance-value").textContent = `$${snapshot.balance.toLocaleString("en-US")}`;
    this.required<HTMLElement>("#loss-tier").textContent = `失败奖励 $${[1_900, 2_400, 2_900, 3_400][snapshot.lossTier].toLocaleString("en-US")}`;
    this.required<HTMLElement>("#buy-round").textContent = snapshot.round === 1 ? "PISTOL ROUND" : `ROUND ${snapshot.round}`;
    this.required<HTMLElement>("#bot-budget").textContent = snapshot.multiplayer
      ? `ALPHA ${snapshot.alphaPlayers}P+${snapshot.alphaBots}B · BRAVO ${snapshot.bravoPlayers}P+${snapshot.bravoBots}B`
      : `敌方共享预算 $${snapshot.botBalance.toLocaleString("en-US")}`;
    this.required<HTMLElement>("#hud-backend").textContent = `${this.rendererBackend} · ${snapshot.navigationMode}`;
    const pickupPrompt = this.required<HTMLElement>("#pickup-prompt");
    pickupPrompt.hidden = !snapshot.nearbyWeaponName || snapshot.phase !== "LIVE";
    this.required<HTMLElement>("#pickup-label").textContent = snapshot.nearbyWeaponName ? `拾取 ${snapshot.nearbyWeaponName}` : "拾取武器";
    const networkPill = this.required<HTMLElement>("#network-pill");
    networkPill.hidden = !snapshot.multiplayer;
    networkPill.textContent = snapshot.multiplayer ? `ROOM ${snapshot.roomCode ?? "-----"} · ${snapshot.localTeam?.toUpperCase()} · ${snapshot.playerCount}/4 · ${snapshot.connectionStatus.toUpperCase()}` : "";

    const buyPanel = this.required<HTMLElement>("#buy-panel");
    buyPanel.hidden = snapshot.phase !== "BUY";
    if (snapshot.phase === "BUY") {
      this.required<HTMLElement>("#pause-panel").hidden = true;
      this.renderBuyItems(snapshot.buyItems, snapshot.balance, snapshot.ledger);
    }

    const resultPanel = this.required<HTMLElement>("#result-panel");
    resultPanel.hidden = snapshot.phase !== "MATCH_END";
    if (snapshot.phase === "MATCH_END") {
      const won = snapshot.playerRounds > snapshot.botRounds;
      this.required<HTMLElement>("#result-title").textContent = won ? "比赛胜利" : "比赛失败";
      this.required<HTMLElement>("#result-copy").textContent = won
        ? snapshot.multiplayer ? `${snapshot.localTeam?.toUpperCase()} 赢得混编小队对抗。` : "K-7 区域已完成清剿。"
        : snapshot.multiplayer ? "敌方混编小队赢得比赛。" : "敌方控制了训练区域，重新调整经济与节奏。";
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

  private renderBuyItems(items: BuyItemSnapshot[], balance: number, ledger: string[]): void {
    this.required<HTMLElement>("#buy-grid").innerHTML = items.map((item) => {
      const disabled = item.locked || item.owned || item.price > balance;
      const state = item.locked ? "手枪局锁定" : item.owned ? "已拥有" : item.price > balance ? "余额不足" : "购买";
      return `<button data-buy="${item.id}" ${disabled ? "disabled" : ""}><small>${item.category}</small><strong>${item.name}</strong><span>$${item.price.toLocaleString("en-US")}</span><i>${state}</i></button>`;
    }).join("");
    this.required<HTMLElement>("#ledger-list").innerHTML = ledger.length ? ledger.map((entry) => `<p>${entry}</p>`).join("") : "<p>本局尚无交易</p>";
  }

  private showPause(message: string): void {
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
    return phase === "BUY" ? "购买阶段" : phase === "ROUND_END" ? "回合结算" : phase === "MATCH_END" ? "比赛结束" : "标准移动";
  }

  private formatTime(seconds: number): string {
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }

  private required<T extends Element>(selector: string): T {
    const element = this.host.querySelector<T>(selector);
    if (!element) throw new Error(`Missing UI element: ${selector}`);
    return element;
  }
}
