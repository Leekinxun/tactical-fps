import { describe, expect, it } from "vitest";
import { BotStateMachine } from "../../src/game/ai/BotStateMachine";

const firstPosition = { x: 4, y: 1.7, z: -2 };

describe("BotStateMachine", () => {
  it("respects reaction delay before allowing fire", () => {
    const bot = new BotStateMachine({ reactionMs: 350, memoryMs: 2_000 });
    expect(bot.update(100, { visiblePosition: firstPosition })).toMatchObject({ state: "alert", canFire: false });
    expect(bot.update(449, { visiblePosition: firstPosition })).toMatchObject({ state: "alert", canFire: false });
    expect(bot.update(450, { visiblePosition: firstPosition })).toMatchObject({ state: "engage", canFire: true });
  });

  it("searches the last known position without reading hidden live coordinates", () => {
    const bot = new BotStateMachine({ reactionMs: 0, memoryMs: 2_000 });
    bot.update(0, { visiblePosition: firstPosition });
    const hidden = bot.update(500, {});
    expect(hidden.state).toBe("search");
    expect(hidden.target).toEqual(firstPosition);
    expect(hidden.canFire).toBe(false);
  });

  it("forgets a target after the configured memory window", () => {
    const bot = new BotStateMachine({ reactionMs: 0, memoryMs: 2_000 });
    bot.update(100, { heardPosition: firstPosition });
    expect(bot.update(2_101, {})).toMatchObject({ state: "patrol", target: null });
  });
});
