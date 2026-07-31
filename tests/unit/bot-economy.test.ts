import { describe, expect, it } from "vitest";
import { BotBuyPlanner, BotEconomy } from "../../src/game/economy/BotEconomy";

describe("Bot shared economy", () => {
  it("keeps pistol-round loadouts free of primary weapons", () => {
    const plan = new BotBuyPlanner().plan(1, 4, 800);
    expect(plan.loadouts.every((weapon) => weapon === "px9" || weapon === "arc12")).toBe(true);
    expect(plan.spent).toBeLessThanOrEqual(800);
  });

  it("allocates mixed weapons without exceeding the shared wallet", () => {
    const plan = new BotBuyPlanner().plan(3, 4, 4_500);
    expect(new Set(plan.loadouts).size).toBeGreaterThan(1);
    expect(plan.spent).toBeLessThanOrEqual(4_500);
    expect(plan.balanceAfter).toBe(4_500 - plan.spent);
  });

  it("awards a team event only once regardless of bot count", () => {
    const economy = new BotEconomy();
    expect(economy.awardKill("player-death", "vx7")).toBe(true);
    expect(economy.awardKill("player-death", "vx7")).toBe(false);
    expect(economy.balance).toBe(1_400);
  });
});
