import { describe, expect, it } from "vitest";
import { ECONOMY_CONFIG, EconomySystem } from "../../src/game/economy/EconomySystem";

describe("EconomySystem", () => {
  it("rejects primary weapons during pistol round without charging", () => {
    const economy = new EconomySystem();
    const result = economy.purchase("buy-br4", "br4", 1, true);
    expect(result).toMatchObject({ ok: false, reason: "pistol-round", balance: 800 });
    expect(economy.inventory.has("br4")).toBe(false);
  });

  it("settles idempotent rewards and saturating loss tiers", () => {
    const economy = new EconomySystem();
    expect(economy.settleRound("round-1", false)).toBe(true);
    expect(economy.balance).toBe(2_700);
    expect(economy.lossTier).toBe(1);
    expect(economy.settleRound("round-1", false)).toBe(false);
    economy.settleRound("round-2", false);
    economy.settleRound("round-3", false);
    economy.settleRound("round-4", false);
    expect(economy.lossTier).toBe(3);
    economy.settleRound("round-5", true);
    expect(economy.lossTier).toBe(2);
    expect(economy.balance).toBeLessThanOrEqual(ECONOMY_CONFIG.moneyCap);
  });

  it("supports an atomic full refund during the same buy phase", () => {
    const economy = new EconomySystem();
    expect(economy.purchase("armor-purchase", "armor", 1, true).ok).toBe(true);
    expect(economy.balance).toBe(150);
    expect(economy.refund("armor-refund", "armor-purchase", true).ok).toBe(true);
    expect(economy.balance).toBe(800);
    expect(economy.inventory.has("armor")).toBe(false);
  });

  it("uses the configured weapon kill reward once", () => {
    const economy = new EconomySystem();
    expect(economy.awardKill("kill-1", "rift6")).toBe(true);
    expect(economy.balance).toBe(1_700);
    expect(economy.awardKill("kill-1", "rift6")).toBe(false);
    expect(economy.balance).toBe(1_700);
  });

  it("removes non-default equipment after death without changing money", () => {
    const economy = new EconomySystem();
    economy.purchase("armor", "armor", 1, true);
    economy.resetEquipmentAfterDeath();
    expect([...economy.inventory]).toEqual(["px9", "knife"]);
    expect(economy.balance).toBe(150);
  });

  it("tracks picked-up weapons without creating refundable value", () => {
    const economy = new EconomySystem();
    economy.equipPickedUpWeapon("br4");
    expect(economy.inventory.has("br4")).toBe(true);
    expect(economy.refund("refund-picked", "missing-receipt", true).ok).toBe(false);
    expect(economy.balance).toBe(800);
    economy.dropWeapon("br4");
    expect(economy.inventory.has("br4")).toBe(false);
  });
});
