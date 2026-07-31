import { describe, expect, it } from "vitest";
import { getWeaponConfig } from "../../src/game/combat/WeaponCatalog";
import { WeaponStateMachine } from "../../src/game/combat/WeaponStateMachine";

describe("WeaponStateMachine", () => {
  it("enforces fire rate regardless of click frequency", () => {
    const weapon = new WeaponStateMachine(getWeaponConfig("br4"), 123);
    expect(weapon.tryFire(0).fired).toBe(true);
    expect(weapon.tryFire(20)).toMatchObject({ fired: false, reason: "cooldown" });
    expect(weapon.tryFire(113).fired).toBe(true);
    expect(weapon.magazine).toBe(22);
  });

  it("produces deterministic spread for a fixed seed", () => {
    const first = new WeaponStateMachine(getWeaponConfig("vx7"), 42);
    const second = new WeaponStateMachine(getWeaponConfig("vx7"), 42);
    expect(first.tryFire(0, true)).toEqual(second.tryFire(0, true));
    expect(first.tryFire(100, true)).toEqual(second.tryFire(100, true));
  });

  it("moves only available reserve ammunition on reload completion", () => {
    const weapon = new WeaponStateMachine(getWeaponConfig("px9"));
    weapon.magazine = 2;
    weapon.reserve = 4;
    expect(weapon.beginReload(100)).toBe(true);
    expect(weapon.update(1_549)).toBe(false);
    expect(weapon.update(1_550)).toBe(true);
    expect(weapon.magazine).toBe(6);
    expect(weapon.reserve).toBe(0);
  });
});
