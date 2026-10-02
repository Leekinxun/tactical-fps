import { ensureCanvasGlobals } from "../helpers/canvas";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { RemotePlayerSystem } from "../../src/game/network/RemotePlayerSystem";
import type { NetworkPlayerState, TeamId } from "../../src/shared/protocol";

const engines: NullEngine[] = [];

afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
});

function player(id: string, team: TeamId, x: number, weaponId: NetworkPlayerState["weaponId"] = "br4"): NetworkPlayerState {
  return {
    id,
    name: id,
    team,
    position: { x, y: 1.72, z: 4 },
    yaw: 0,
    pitch: 0,
    health: 100,
    armor: 100,
    helmet: true,
    hasDefuseKit: false,
    balance: 800,
    weaponId,
    primaryWeaponId: weaponId === "px9" ? null : weaponId,
    secondaryWeaponId: "px9",
    activeSlot: weaponId === "px9" ? "secondary" : "primary",
    magazine: 24,
    reserve: 96,
    reloading: false,
    alive: true,
    ready: true,
    connected: true,
  };
}

function sceneHarness(): Scene {
  ensureCanvasGlobals();
  const engine = new NullEngine();
  engines.push(engine);
  return new Scene(engine);
}

describe("RemotePlayerSystem muzzle feedback", () => {
  it("shows a short remote muzzle flash with smoke and light", () => {
    const scene = sceneHarness();
    const remotes = new RemotePlayerSystem(scene);
    remotes.apply([player("local", "alpha", 0), player("enemy", "bravo", 2)], "local", "alpha");

    expect(remotes.triggerMuzzleFlash("enemy")).toBe(true);
    const flash = scene.getMeshByName("remote-player-enemy-muzzle-flash");
    const smoke = scene.getMeshByName("remote-player-enemy-muzzle-smoke");
    const light = scene.getLightByName("remote-player-enemy-muzzle-light");
    expect(flash?.isEnabled()).toBe(true);
    expect(smoke?.isEnabled()).toBe(true);
    expect(light?.intensity).toBeGreaterThan(0);

    remotes.update(0.24);
    expect(flash?.isEnabled()).toBe(false);
    expect(smoke?.isEnabled()).toBe(false);
    expect(light?.intensity).toBe(0);
  });

  it("disposes remote muzzle lights when avatars leave or clear", () => {
    const scene = sceneHarness();
    const remotes = new RemotePlayerSystem(scene);
    remotes.apply([player("local", "alpha", 0), player("enemy", "bravo", 2)], "local", "alpha");
    remotes.triggerMuzzleFlash("enemy");

    remotes.apply([player("local", "alpha", 0)], "local", "alpha");
    expect(scene.getMeshByName("remote-player-enemy-muzzle-flash")).toBeNull();
    expect(scene.getLightByName("remote-player-enemy-muzzle-light")).toBeNull();

    remotes.apply([player("local", "alpha", 0), player("teammate", "alpha", -2, "px9")], "local", "alpha");
    remotes.triggerMuzzleFlash("teammate");
    remotes.clear();
    expect(scene.getMeshByName("remote-player-teammate-muzzle-flash")).toBeNull();
    expect(scene.getLightByName("remote-player-teammate-muzzle-light")).toBeNull();
  });

  it("uses the authoritative shot weapon when the latest avatar snapshot is stale", () => {
    const scene = sceneHarness();
    const remotes = new RemotePlayerSystem(scene);
    remotes.apply([player("local", "alpha", 0), player("enemy", "bravo", 2, "px9")], "local", "alpha");

    remotes.triggerMuzzleFlash("enemy", "needle50");

    expect(scene.getLightByName("remote-player-enemy-muzzle-light")?.intensity).toBe(2.6);
  });
});
