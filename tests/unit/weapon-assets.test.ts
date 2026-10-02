import { readFile } from "node:fs/promises";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { ViewWeapon } from "../../src/game/render/ViewWeapon";
import { preloadWeaponAssets, type WeaponAsset, type WeaponAssetId, buildAuthoredWeapon } from "../../src/game/render/viewmodel/WeaponAssets";
import { ensureCanvasGlobals } from "../helpers/canvas";

const loaded = new Map<WeaponAssetId, WeaponAsset>();
afterAll(() => vi.unstubAllGlobals());

describe("authored weapon assets", () => {
  beforeAll(async () => {
    ensureCanvasGlobals();
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      const json = JSON.parse(await readFile(new URL(`../../public${path}`, import.meta.url), "utf8")) as WeaponAsset;
      for (const texture of Object.values(json.textures)) {
        if (texture) await readFile(new URL(`../../public${path.slice(0, path.lastIndexOf("/") + 1)}${texture}`, import.meta.url));
      }
      const id = path.includes("service-pistol") ? "pistol"
        : path.includes("m4a1") ? "rifle"
          : path.includes("px9") ? "modernPistol"
            : path.includes("vx7") ? "smg"
              : path.includes("rift6") ? "shotgun" : "sniper";
      loaded.set(id as WeaponAssetId, json);
      return { ok: true, json: async () => json };
    }));
    await preloadWeaponAssets();
  });

  it("loads packaged geometry, switches without retaining old assets, and animates the actual magazine", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const camera = new FreeCamera("camera", Vector3.Zero(), scene);
    const view = new ViewWeapon(scene, camera);
    try {
      expect(scene.meshes.filter((mesh) => mesh.metadata?.authoredAsset === "modernPistol").length).toBeGreaterThan(5);
      view.setWeapon("br4");
      expect(scene.meshes.some((mesh) => mesh.metadata?.authoredAsset === "modernPistol")).toBe(false);
      const magazine = scene.meshes.find((mesh) => mesh.metadata?.weaponPart === "magazine")!;
      expect(magazine).toBeDefined();
      expect(magazine.metadata.authoredAsset).toBe("rifle");
      view.update(0.5, 100, false);
      const home = magazine.position.clone();
      view.setReloading(true);
      view.update(0.35, 450, false);
      expect(magazine.position.y).toBeLessThan(home.y);
      view.setReloading(false);
      view.update(1, 1450, false);
      expect(magazine.position.equalsWithEpsilon(home)).toBe(true);
      const anchor = scene.getTransformNodeByName("viewmodel-br4-muzzle-anchor")!;
      const rifle = loaded.get("rifle")!;
      expect(anchor.position.z).toBeGreaterThan(rifle.bounds.max[2]);
      for (const mesh of scene.meshes) {
        expect(mesh.isPickable).toBe(false);
        expect(mesh.checkCollisions).toBe(false);
      }
      view.dispose();
      expect(scene.meshes).toHaveLength(0);
      expect(scene.materials.filter((material) => material.name.includes("viewmodel"))).toHaveLength(0);
    } finally { scene.dispose(); engine.dispose(); }
  });

  it("binds moving attachments and keeps all weapon muzzle anchors at the barrel tips", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const camera = new FreeCamera("camera", Vector3.Zero(), scene);
    const view = new ViewWeapon(scene, camera);
    const choices = { px9: "modernPistol", arc12: "pistol", br4: "rifle", vx7: "smg", rift6: "shotgun", needle50: "sniper" } as const;
    try {
      for (const [weaponId, assetId] of Object.entries(choices)) {
        view.setWeapon(weaponId as keyof typeof choices);
        view.update(1, 100, false);
        const asset = loaded.get(assetId)!;
        const anchor = scene.getTransformNodeByName(`viewmodel-${weaponId}-muzzle-anchor`)!;
        expect(Math.abs(anchor.position.z - asset.bounds.max[2])).toBeLessThan(0.04);
        expect(scene.meshes.filter((mesh) => mesh.metadata?.authoredAsset === assetId).length).toBeGreaterThan(0);
      }
      view.dispose();
      const parent = new TransformNode("attachment-check", scene);
      const meshes = buildAuthoredWeapon(scene, parent, "modernPistol", "test-pistol")!;
      const barrel = meshes.get("barrel")!;
      const slide = meshes.get("slide")!;
      const before = barrel.computeWorldMatrix(true).getTranslation().z;
      slide.position.z -= 0.035;
      slide.computeWorldMatrix(true);
      expect(barrel.computeWorldMatrix(true).getTranslation().z).toBeCloseTo(before - 0.035);
    } finally { scene.dispose(); engine.dispose(); }
  });

  it("ships complete triangle geometry and textures for every authored package", async () => {
    for (const asset of loaded.values()) {
      for (const part of asset.parts) {
        expect(part.positions.length).toBe(part.normals.length);
        expect(part.uvs.length).toBe(part.positions.length / 3 * 2);
        expect(part.indices.length % 3).toBe(0);
        expect(Math.max(...part.indices)).toBeLessThan(part.positions.length / 3);
        expect(part.positions.every(Number.isFinite)).toBe(true);
      }
      expect(asset.parts.reduce((count, part) => count + part.indices.length / 3, 0)).toBeGreaterThan(2500);
    }
    expect([...loaded.keys()].sort()).toEqual(["modernPistol", "pistol", "rifle", "shotgun", "smg", "sniper"]);
  });
});
