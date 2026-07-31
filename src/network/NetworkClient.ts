import type { ClientMessage, RoomSnapshot, ServerMessage, TeamId } from "../shared/protocol";
import { encodeMessage, parseServerMessage, PROTOCOL_VERSION } from "../shared/protocol";
import type { WeaponId } from "../game/combat/WeaponCatalog";

export interface MultiplayerConnectOptions {
  action: "create" | "join";
  name: string;
  roomCode?: string;
  serverUrl?: string;
}

export interface MultiplayerWelcome {
  playerId: string;
  roomCode: string;
  resumed: boolean;
  team: TeamId;
}

type NetworkEventKind = Extract<ServerMessage, { type: "event" }>["kind"];

export class NetworkClient {
  playerId: string | null = null;
  roomCode: string | null = null;
  resumeToken: string | null = null;
  snapshot: RoomSnapshot | null = null;
  onSnapshot: (snapshot: RoomSnapshot) => void = () => undefined;
  onEvent: (message: string, kind: NetworkEventKind) => void = () => undefined;
  onStatus: (status: "connecting" | "connected" | "reconnecting" | "offline") => void = () => undefined;
  private socket: WebSocket | null = null;
  private options: MultiplayerConnectOptions | null = null;
  private manualClose = false;
  private reconnectTimer: number | null = null;

  connect(options: MultiplayerConnectOptions): Promise<MultiplayerWelcome> {
    this.options = { ...options, roomCode: options.roomCode?.toUpperCase() };
    this.manualClose = false;
    return this.open(false);
  }

  disconnect(): void {
    this.manualClose = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.onStatus("offline");
  }

  sendInput(sequence: number, position: { x: number; y: number; z: number }, yaw: number, pitch: number): void {
    this.send({ type: "input", sequence, position, yaw, pitch });
  }

  sendFire(shotId: string, origin: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number }, weaponId: WeaponId): void {
    this.send({ type: "fire", shotId, origin, direction, weaponId });
  }

  sendReload(): void {
    this.send({ type: "reload" });
  }

  sendDrop(): void {
    this.send({ type: "drop" });
  }

  sendPickup(dropId: string): void {
    this.send({ type: "pickup", dropId });
  }

  sendReady(): void {
    this.send({ type: "ready" });
  }

  sendRematch(): void {
    this.send({ type: "rematch" });
  }

  sendBuy(itemId: WeaponId | "armor" | "helmet"): void {
    this.send({ type: "buy", itemId });
  }

  private open(reconnecting: boolean): Promise<MultiplayerWelcome> {
    if (!this.options) return Promise.reject(new Error("缺少多人连接参数"));
    this.onStatus(reconnecting ? "reconnecting" : "connecting");
    const url = this.options.serverUrl ?? defaultServerUrl();
    const socket = new WebSocket(url);
    this.socket = socket;

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        if (!reconnecting) this.manualClose = true;
        socket.close();
        reject(new Error("连接房间服务器超时"));
      }, 6_000);

      socket.addEventListener("open", () => {
        const action = reconnecting && this.roomCode ? "join" : this.options!.action;
        socket.send(encodeMessage({
          type: "hello",
          protocolVersion: PROTOCOL_VERSION,
          action,
          name: this.options!.name,
          roomCode: reconnecting ? this.roomCode ?? undefined : this.options!.roomCode,
          resumeToken: reconnecting ? this.resumeToken ?? undefined : undefined,
        }));
      });
      socket.addEventListener("message", (event) => {
        const message = parseServerMessage(String(event.data));
        if (!message) return;
        if (message.type === "welcome") {
          window.clearTimeout(timeout);
          this.playerId = message.playerId;
          this.roomCode = message.roomCode;
          this.resumeToken = message.resumeToken;
          this.onStatus("connected");
          resolve({ playerId: message.playerId, roomCode: message.roomCode, resumed: message.resumed, team: message.team });
        } else if (message.type === "snapshot") {
          this.snapshot = message.snapshot;
          this.onSnapshot(message.snapshot);
        } else if (message.type === "event") this.onEvent(message.message, message.kind);
        else if (message.type === "error") {
          window.clearTimeout(timeout);
          if (reconnecting && message.code === "RESUME_EXPIRED") this.resumeToken = null;
          if (!reconnecting) this.manualClose = true;
          socket.close();
          reject(new Error(message.message));
        }
      });
      socket.addEventListener("error", () => {
        window.clearTimeout(timeout);
        if (!reconnecting) {
          this.manualClose = true;
          reject(new Error("无法连接局域网房间服务器"));
        }
      });
      socket.addEventListener("close", () => {
        window.clearTimeout(timeout);
        if (!this.manualClose) this.scheduleReconnect();
      });
    });
  }

  private scheduleReconnect(): void {
    if (!this.options || this.reconnectTimer !== null) return;
    this.onStatus("reconnecting");
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.open(true).catch(() => this.scheduleReconnect());
    }, 1_000);
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(encodeMessage(message));
  }
}

function defaultServerUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  if (import.meta.env.DEV) return `${protocol}//${window.location.hostname || "127.0.0.1"}:8787`;
  return `${protocol}//${window.location.host}/multiplayer`;
}
