import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { BotMuzzleSystem } from "../../src/game/render/BotMuzzleSystem";

const engines: NullEngine[] = [];

afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
});

function sceneHarness(): Scene {
  const engine = new NullEngine();
  engines.push(engine);
  return new Scene(engine);
}

describe("BotMuzzleSystem", () => {
  it("plays short bot muzzle feedback without becoming pickable or collidable", () => {
    const scene = sceneHarness();
    const muzzle = new BotMuzzleSystem(scene);

    expect(muzzle.flash(2, new Vector3(0, 1, 0), new Vector3(0, 1.7, 8), "br4")).toBe(true);

    const flash = scene.getMeshByName("bot-2-muzzle-flash");
    const smoke = scene.getMeshByName("bot-2-muzzle-smoke");
    const tracer = scene.getMeshByName("bot-2-muzzle-tracer");
    const impact = scene.getMeshByName("bot-2-impact-spark");
    const light = scene.getLightByName("bot-2-muzzle-light");

    expect(flash?.isEnabled()).toBe(true);
    expect(smoke?.isEnabled()).toBe(true);
    expect(tracer?.isEnabled()).toBe(true);
    expect(impact?.isEnabled()).toBe(false);
    expect(light?.intensity).toBeGreaterThan(0);
    expect(light?.isEnabled()).toBe(true);
    for (const mesh of [flash, smoke, tracer, impact]) {
      expect(mesh?.isPickable).toBe(false);
      expect(mesh?.checkCollisions).toBe(false);
    }

    muzzle.update(0.08);
    expect(flash?.isEnabled()).toBe(false);
    expect(tracer?.isEnabled()).toBe(false);
    expect(smoke?.isEnabled()).toBe(true);
    expect(light?.intensity).toBe(0);
    expect(light?.isEnabled()).toBe(false);

    muzzle.update(0.2);
    expect(smoke?.isEnabled()).toBe(false);
    expect(impact?.isEnabled()).toBe(false);
  });

  it("reuses one pooled visual set per bot index", () => {
    const scene = sceneHarness();
    const muzzle = new BotMuzzleSystem(scene);
    const actor = new Vector3(1, 1, 1);

    muzzle.flash(4, actor, new Vector3(2, 1.6, 6), "px9");
    const firstFlash = scene.getMeshByName("bot-4-muzzle-flash");
    const firstSmoke = scene.getMeshByName("bot-4-muzzle-smoke");
    const firstLight = scene.getLightByName("bot-4-muzzle-light");

    muzzle.update(0.3);
    muzzle.flash(4, actor, new Vector3(-2, 1.6, 5), "px9");

    expect(scene.getMeshByName("bot-4-muzzle-flash")).toBe(firstFlash);
    expect(scene.getMeshByName("bot-4-muzzle-smoke")).toBe(firstSmoke);
    expect(scene.getLightByName("bot-4-muzzle-light")).toBe(firstLight);
    expect(scene.meshes.filter((mesh) => mesh.name === "bot-4-muzzle-flash")).toHaveLength(1);
  });

  it("shows an impact spark only when a shot reaches solid cover", () => {
    const scene = sceneHarness();
    const wall = MeshBuilder.CreateBox("shot-blocker", { width: 3, height: 3, depth: 0.2 }, scene);
    wall.position.set(0, 1.5, 3);
    wall.checkCollisions = true;
    wall.computeWorldMatrix(true);
    const muzzle = new BotMuzzleSystem(scene);

    muzzle.flash(3, new Vector3(0, 1, 0), new Vector3(0, 1.72, 8), "br4");

    expect(scene.getMeshByName("bot-3-impact-spark")?.isEnabled()).toBe(true);
  });

  it("clears all pooled meshes, lights, and materials", () => {
    const scene = sceneHarness();
    const muzzle = new BotMuzzleSystem(scene);

    muzzle.flash(0, new Vector3(0, 1, 0), new Vector3(0, 1, 8), "br4");
    muzzle.flash(1, new Vector3(2, 1, 0), new Vector3(2, 1, 8), "needle50");
    muzzle.clear();

    expect(scene.getMeshByName("bot-0-muzzle-flash")).toBeNull();
    expect(scene.getMeshByName("bot-1-muzzle-tracer")).toBeNull();
    expect(scene.getLightByName("bot-0-muzzle-light")).toBeNull();
    expect(scene.getMaterialByName("bot-1-muzzle-flash-material")).toBeNull();
  });

  it("rejects zero-length shots", () => {
    const scene = sceneHarness();
    const muzzle = new BotMuzzleSystem(scene);

    expect(muzzle.flash(0, new Vector3(1, 1, 1), new Vector3(1, 1, 1), "br4")).toBe(false);
    expect(scene.getMeshByName("bot-0-muzzle-flash")).toBeNull();
  });
});
