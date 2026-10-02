import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BotController } from "../../src/game/ai/BotController";
import type { NavigationService } from "../../src/game/ai/navigation/NavigationService";
import type { WeaponId } from "../../src/game/combat/WeaponCatalog";

function createBot(
  scene: ConstructorParameters<typeof BotController>[0]["scene"],
  onFire: (damage: number, botIndex: number) => void = () => undefined,
  onShot?: (botIndex: number, weaponId: WeaponId) => void,
) {
  const origin = new Vector3(0, 1, 0);
  const actor = { root: { position: origin.clone() }, origin, alive: true, health: 100, phase: 0 };
  const navigation = {
    findPath: (_start: Vector3, end: Vector3) => [end.clone()],
    recoveryPoint: () => origin.clone(),
  };
  return {
    actor,
    bot: new BotController({
      index: 0,
      actor: actor as unknown as ConstructorParameters<typeof BotController>[0]["actor"],
      scene,
      navigation: navigation as unknown as NavigationService,
      onFire,
      onShot,
    }),
  };
}

describe("BotController combat", () => {
  it("fires after its reaction delay when the player is visible", () => {
    const shots: Array<{ damage: number; botIndex: number }> = [];
    const scene = {
      pickWithRay: (_ray: unknown, predicate: (mesh: { checkCollisions: boolean }) => boolean) => {
        expect(predicate({ checkCollisions: true })).toBe(true);
        return null;
      },
    };
    const { bot } = createBot(scene as unknown as ConstructorParameters<typeof BotController>[0]["scene"], (damage, botIndex) => { shots.push({ damage, botIndex }); });
    const player = new Vector3(0, 1.72, 8);

    bot.update(0.05, 0, player);
    bot.update(0.05, 300, player);
    expect(shots).toHaveLength(0);

    bot.update(0.05, 400, player);
    expect(shots).toEqual([{ damage: 16, botIndex: 0 }]);
  });

  it("emits onShot for a real trigger pull even when the shot misses", () => {
    const hits: number[] = [];
    const triggerPulls: Array<{ botIndex: number; weaponId: WeaponId }> = [];
    const scene = { pickWithRay: () => null };
    const { bot } = createBot(
      scene as unknown as ConstructorParameters<typeof BotController>[0]["scene"],
      (damage) => { hits.push(damage); },
      (botIndex, weaponId) => { triggerPulls.push({ botIndex, weaponId }); },
    );
    const player = new Vector3(0, 1.72, 30);

    bot.update(0.05, 0, player);
    bot.update(0.05, 400, player);

    expect(triggerPulls).toEqual([{ botIndex: 0, weaponId: "px9" }]);
    expect(hits).toHaveLength(0);
  });

  it("does not fire through solid cover", () => {
    const shots: number[] = [];
    const scene = {
      pickWithRay: () => ({ hit: true, distance: 2 }),
    };
    const { bot } = createBot(scene as unknown as ConstructorParameters<typeof BotController>[0]["scene"], (damage) => { shots.push(damage); });
    const player = new Vector3(0, 1.72, 8);

    for (let now = 0; now <= 1_200; now += 100) bot.update(0.05, now, player);

    expect(shots).toHaveLength(0);
  });

  it("tracks and strafes a close side contact while engaging", () => {
    const scene = { pickWithRay: () => null };
    const { actor, bot } = createBot(scene as unknown as ConstructorParameters<typeof BotController>[0]["scene"]);
    const player = new Vector3(7, 1.72, 0);

    bot.update(0.05, 0, player);
    bot.update(0.05, 400, player);

    expect(actor.root.position.z).not.toBe(0);
  });
});
