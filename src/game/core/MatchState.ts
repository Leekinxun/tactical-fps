export type MatchPhase = "BUY" | "LIVE" | "ROUND_END" | "MATCH_END";

export interface MatchTransition {
  from: MatchPhase;
  to: MatchPhase;
  round: number;
}

export interface MatchConfig {
  buySeconds: number;
  liveSeconds: number;
  roundEndSeconds: number;
  roundsToWin: number;
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  buySeconds: 20,
  liveSeconds: 120,
  roundEndSeconds: 6,
  roundsToWin: 7,
};

export class MatchState {
  phase: MatchPhase = "BUY";
  round = 1;
  playerRounds = 0;
  botRounds = 0;
  remainingSeconds: number;
  lastRoundWon: boolean | null = null;
  readonly results: boolean[] = [];
  private readonly config: MatchConfig;

  constructor(config: MatchConfig = DEFAULT_MATCH_CONFIG) {
    this.config = config;
    this.remainingSeconds = config.buySeconds;
  }

  tick(deltaSeconds: number): MatchTransition | null {
    if (this.phase === "MATCH_END") return null;
    this.remainingSeconds = Math.max(0, this.remainingSeconds - Math.max(0, deltaSeconds));
    if (this.remainingSeconds > 0) return null;

    if (this.phase === "BUY") return this.transitionTo("LIVE", this.config.liveSeconds);
    if (this.phase === "LIVE") return this.endRound(false);
    if (this.phase === "ROUND_END") {
      this.round += 1;
      return this.transitionTo("BUY", this.config.buySeconds);
    }
    return null;
  }

  ready(): MatchTransition | null {
    if (this.phase !== "BUY") return null;
    return this.transitionTo("LIVE", this.config.liveSeconds);
  }

  endRound(playerWon: boolean): MatchTransition | null {
    if (this.phase !== "LIVE") return null;
    this.lastRoundWon = playerWon;
    this.results.push(playerWon);
    if (playerWon) this.playerRounds += 1;
    else this.botRounds += 1;

    if (this.playerRounds >= this.config.roundsToWin || this.botRounds >= this.config.roundsToWin) {
      return this.transitionTo("MATCH_END", 0);
    }
    return this.transitionTo("ROUND_END", this.config.roundEndSeconds);
  }

  restart(): void {
    this.phase = "BUY";
    this.round = 1;
    this.playerRounds = 0;
    this.botRounds = 0;
    this.remainingSeconds = this.config.buySeconds;
    this.lastRoundWon = null;
    this.results.length = 0;
  }

  private transitionTo(to: MatchPhase, remainingSeconds: number): MatchTransition {
    const transition = { from: this.phase, to, round: this.round };
    this.phase = to;
    this.remainingSeconds = remainingSeconds;
    return transition;
  }
}
