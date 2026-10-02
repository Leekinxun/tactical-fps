import { ensureCanvasGlobals } from "../helpers/canvas";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { afterEach, describe, expect, it } from "vitest";
import { createArena, setTargetWeapon } from "../../src/game/world/createArena";

const engines: NullEngine[] = [];

afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
});

function sceneHarness(): Scene {
  const engine = new NullEngine();
  engines.push(engine);
  return new Scene(engine);
}


describe("target weapon visuals", () => {
  it("switches target actors between pistol and long-gun silhouettes without affecting collision or hits", () => {
    ensureCanvasGlobals();
    const scene = sceneHarness();
    const [actor] = createArena(scene);

    const pistolSlide = scene.getMeshByName("target-0-pistol-slide");
    const pistolBarrel = scene.getMeshByName("target-0-pistol-barrel");
    const longReceiver = scene.getMeshByName("target-0-rifle-receiver");
    const longBarrel = scene.getMeshByName("target-0-rifle-barrel");
    const leftHand = scene.getMeshByName("target-0-left-glove");
    const rightHand = scene.getMeshByName("target-0-right-glove");

    expect(actor.rig?.weaponId).toBe("px9");
    expect(pistolSlide?.isEnabled()).toBe(true);
    expect(pistolBarrel?.position.z).toBeGreaterThan(pistolSlide?.position.z ?? 0);
    expect(longReceiver?.isEnabled()).toBe(false);
    expect(leftHand).not.toBeNull();
    expect(rightHand).not.toBeNull();

    setTargetWeapon(actor, "br4");
    expect(actor.rig?.weaponId).toBe("br4");
    expect(pistolSlide?.isEnabled()).toBe(false);
    expect(longReceiver?.isEnabled()).toBe(true);
    expect(longBarrel?.position.z).toBeGreaterThan(longReceiver?.position.z ?? 0);

    setTargetWeapon(actor, "arc12");
    expect(actor.rig?.weaponId).toBe("arc12");
    expect(pistolSlide?.isEnabled()).toBe(true);
    expect(longReceiver?.isEnabled()).toBe(false);

    for (const mesh of actor.rig!.meshes) {
      expect(mesh.isPickable).toBe(false);
      expect(mesh.checkCollisions).toBe(false);
      expect(mesh.metadata).toBeNull();
    }
    expect(actor.root.metadata).toMatchObject({ targetIndex: 0, hitZone: "body" });
    expect(scene.getMeshByName("target-head-0")?.metadata).toMatchObject({ targetIndex: 0, hitZone: "head" });
    actor.root.position.set(0, 1, 0);
    actor.root.computeWorldMatrix(true);
    const hit = scene.pickWithRay(new Ray(new Vector3(0, 1.4, -4), Vector3.Forward(), 8), (mesh) => mesh === actor.root);
    expect(hit?.pickedMesh).toBe(actor.root);
  });
});
