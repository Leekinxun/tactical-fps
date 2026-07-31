import { describe, expect, it } from "vitest";
import { MatchState } from "../../src/game/core/MatchState";

describe("MatchState", () => {
  it("follows BUY to LIVE to ROUND_END to the next BUY phase", () => {
    const match = new MatchState({ buySeconds: 20, liveSeconds: 120, roundEndSeconds: 6, roundsToWin: 7 });
    expect(match.phase).toBe("BUY");
    expect(match.ready()).toMatchObject({ from: "BUY", to: "LIVE", round: 1 });
    expect(match.endRound(true)).toMatchObject({ from: "LIVE", to: "ROUND_END", round: 1 });
    expect(match.playerRounds).toBe(1);
    expect(match.tick(6)).toMatchObject({ from: "ROUND_END", to: "BUY", round: 2 });
    expect(match.round).toBe(2);
  });

  it("ends immediately when either side reaches seven rounds", () => {
    const match = new MatchState({ buySeconds: 1, liveSeconds: 1, roundEndSeconds: 1, roundsToWin: 7 });
    for (let round = 0; round < 7; round += 1) {
      match.ready();
      const transition = match.endRound(true);
      if (round < 6) match.tick(1);
      else expect(transition?.to).toBe("MATCH_END");
    }
    expect(match.playerRounds).toBe(7);
    expect(match.round).toBe(7);
    expect(match.phase).toBe("MATCH_END");
  });

  it("treats LIVE timeout as a player loss", () => {
    const match = new MatchState({ buySeconds: 1, liveSeconds: 2, roundEndSeconds: 1, roundsToWin: 7 });
    match.ready();
    expect(match.tick(2)?.to).toBe("ROUND_END");
    expect(match.botRounds).toBe(1);
    expect(match.lastRoundWon).toBe(false);
  });
});
