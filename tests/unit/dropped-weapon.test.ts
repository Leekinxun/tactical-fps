import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { afterEach, describe, expect, it } from "vitest";
import { DroppedWeaponSystem } from "../../src/game/world/DroppedWeaponSystem";

const engines: NullEngine[] = [];

afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
});

describe("DroppedWeaponSystem", () => {
  it("preserves bounded ammunition through drop and pickup", () => {
    const engine = new NullEngine();
    engines.push(engine);
    const scene = new Scene(engine);
    const drops = new DroppedWeaponSystem(scene);
    const item = drops.drop("br4", 11, 53, new Vector3(2, 0, 4));
    expect(item).not.toBeNull();
    expect(drops.nearest(new Vector3(2, 0, 4))).toMatchObject({ weaponId: "br4", magazine: 11, reserve: 53 });
    expect(drops.pickup(item!.instanceId)).toEqual({ weaponId: "br4", magazine: 11, reserve: 53 });
    expect(drops.count).toBe(0);
  });

  it("does not drop the default service pistol", () => {
    const engine = new NullEngine();
    engines.push(engine);
    const scene = new Scene(engine);
    const drops = new DroppedWeaponSystem(scene);
    expect(drops.drop("px9", 12, 48, Vector3.Zero())).toBeNull();
    expect(drops.count).toBe(0);
  });

  it("reconciles server-owned dropped weapons by stable id", () => {
    const engine = new NullEngine();
    engines.push(engine);
    const scene = new Scene(engine);
    const drops = new DroppedWeaponSystem(scene);
    drops.syncNetwork([{ id: "drop-1", weaponId: "vx7", magazine: 17, reserve: 64, position: { x: 1, y: 0.3, z: 2 } }]);
    expect(drops.nearest(new Vector3(1, 0.3, 2))).toMatchObject({ instanceId: "drop-1", weaponId: "vx7", magazine: 17, reserve: 64 });
    drops.syncNetwork([]);
    expect(drops.count).toBe(0);
  });
});
