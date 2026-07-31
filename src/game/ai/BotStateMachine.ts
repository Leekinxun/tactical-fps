export type BotState = "patrol" | "investigate" | "alert" | "engage" | "search" | "dead";

export interface KnownPosition {
  x: number;
  y: number;
  z: number;
}

export interface BotObservation {
  visiblePosition?: KnownPosition;
  heardPosition?: KnownPosition;
}

export interface BotDecision {
  state: BotState;
  target: KnownPosition | null;
  canFire: boolean;
}

export interface BotMindConfig {
  reactionMs: number;
  memoryMs: number;
}

export class BotStateMachine {
  state: BotState = "patrol";
  lastKnownPosition: KnownPosition | null = null;
  private firstSeenAt = 0;
  private lastPerceptionAt = 0;
  private readonly config: BotMindConfig;

  constructor(config: BotMindConfig = { reactionMs: 350, memoryMs: 2_000 }) {
    this.config = config;
  }

  update(nowMs: number, observation: BotObservation): BotDecision {
    if (this.state === "dead") return { state: "dead", target: null, canFire: false };

    if (observation.visiblePosition) {
      this.lastKnownPosition = { ...observation.visiblePosition };
      this.lastPerceptionAt = nowMs;
      if (this.state !== "alert" && this.state !== "engage") {
        this.state = "alert";
        this.firstSeenAt = nowMs;
      }
      if (nowMs - this.firstSeenAt >= this.config.reactionMs) this.state = "engage";
    } else if (observation.heardPosition) {
      this.lastKnownPosition = { ...observation.heardPosition };
      this.lastPerceptionAt = nowMs;
      if (this.state !== "engage") this.state = "investigate";
    } else if (this.state === "engage" || this.state === "alert") {
      this.state = "search";
    } else if ((this.state === "search" || this.state === "investigate") && nowMs - this.lastPerceptionAt > this.config.memoryMs) {
      this.state = "patrol";
      this.lastKnownPosition = null;
    }

    return {
      state: this.state,
      target: this.lastKnownPosition ? { ...this.lastKnownPosition } : null,
      canFire: this.state === "engage" && Boolean(observation.visiblePosition),
    };
  }

  kill(): void {
    this.state = "dead";
    this.lastKnownPosition = null;
  }

  reset(): void {
    this.state = "patrol";
    this.lastKnownPosition = null;
    this.firstSeenAt = 0;
    this.lastPerceptionAt = 0;
  }
}
