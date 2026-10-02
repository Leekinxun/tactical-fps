import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Node } from "@babylonjs/core/node";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { ViewWeapon } from "../../src/game/render/ViewWeapon";
import { VIEWMODEL_RENDER_GROUP } from "../../src/game/render/viewmodel/primitives";
import type { WeaponId } from "../../src/game/combat/WeaponCatalog";

const engines: NullEngine[] = [];

afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
});

function sceneHarness(): { scene: Scene; camera: FreeCamera } {
  ensureCanvasGlobals();
  const engine = new NullEngine();
  engines.push(engine);
  const scene = new Scene(engine);
  const camera = new FreeCamera("camera", Vector3.Zero(), scene);
  scene.activeCamera = camera;
  return { scene, camera };
}

function ensureCanvasGlobals(): void {
  if (!globalThis.ImageData) {
    globalThis.ImageData = class ImageData {
      data: Uint8ClampedArray;
      width: number;
      height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.data = new Uint8ClampedArray(width * height * 4);
      }
    } as unknown as typeof ImageData;
  }
  if (!globalThis.OffscreenCanvas) {
    globalThis.OffscreenCanvas = class OffscreenCanvas {
      width: number;
      height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext(): OffscreenCanvasRenderingContext2D {
        return {
          fillStyle: "#000000",
          font: "12px Arial",
          globalAlpha: 1,
          lineWidth: 1,
          strokeStyle: "#000000",
          beginPath: () => undefined,
          clearRect: () => undefined,
          createRadialGradient: () => ({ addColorStop: () => undefined }),
          drawImage: () => undefined,
          fillRect: () => undefined,
          fillText: () => undefined,
          getImageData: () => new ImageData(1, 1),
          lineTo: () => undefined,
          moveTo: () => undefined,
          putImageData: () => undefined,
          setLineDash: () => undefined,
          stroke: () => undefined,
          strokeRect: () => undefined,
        } as unknown as OffscreenCanvasRenderingContext2D;
      }
    } as unknown as typeof OffscreenCanvas;
  }
}

function meshesFor(scene: Scene, weaponId: WeaponId): AbstractMesh[] {
  return scene.meshes.filter((mesh) => mesh.name.startsWith(`viewmodel-${weaponId}-`));
}

function rootLocalPoint(root: Node, node: Node, point: Vector3): Vector3 {
  const world = Vector3.TransformCoordinates(point, node.computeWorldMatrix(true));
  const inverse = root.computeWorldMatrix(true).clone().invert();
  return Vector3.TransformCoordinates(world, inverse);
}

function expectVectorClose(actual: Vector3 | undefined, expected: Vector3, tolerance = 0.001): void {
  expect(actual).toBeDefined();
  expect(Vector3.Distance(actual!, expected)).toBeLessThan(tolerance);
}

describe("ViewWeapon first-person 3D model", () => {
  it("creates sprite-free 3D weapon and glove geometry for every weapon class", () => {
    const { scene, camera } = sceneHarness();
    const viewWeapon = new ViewWeapon(scene, camera);
    const weapons: WeaponId[] = ["px9", "arc12", "vx7", "rift6", "br4", "needle50"];

    for (const weaponId of weapons) {
      viewWeapon.setWeapon(weaponId);
      viewWeapon.update(0.016, 100, false);
      const meshes = meshesFor(scene, weaponId);
      expect(meshes.length).toBeGreaterThanOrEqual(weaponId === "px9" || weaponId === "arc12" ? 18 : 22);
      expect(meshes.some((mesh) => mesh.name.includes("glove"))).toBe(true);
      expect(meshes.some((mesh) => mesh.name.includes("muzzle-flash-blade"))).toBe(true);
      expect(meshes.some((mesh) => mesh.name.includes("slide") || mesh.name.includes("receiver") || mesh.name.includes("upper") || mesh.name.includes("action"))).toBe(true);
      for (const mesh of meshes) {
        expect(mesh.renderingGroupId).toBe(VIEWMODEL_RENDER_GROUP);
        expect(mesh.isPickable).toBe(false);
        expect(mesh.checkCollisions).toBe(false);
      }
    }

    expect(scene.textures.some((texture) => texture.name.includes("/weapons/"))).toBe(false);
    expect(scene.meshes.some((mesh) => mesh.name.includes("sprite"))).toBe(false);
  });

  it("anchors muzzle flash, smoke, and light to the active weapon muzzle", () => {
    const { scene, camera } = sceneHarness();
    const viewWeapon = new ViewWeapon(scene, camera);
    viewWeapon.setWeapon("br4");

    const flash = scene.getMeshByName("viewmodel-br4-muzzle-flash-blade-a");
    const smoke = scene.getMeshByName("viewmodel-br4-muzzle-smoke");
    const anchor = scene.getTransformNodeByName("viewmodel-br4-muzzle-anchor");
    const flashRoot = scene.getTransformNodeByName("viewmodel-br4-muzzle-flash");
    const light = scene.getLightByName("viewmodel-br4-muzzle-light");
    expect(flashRoot?.parent).toBe(anchor);
    expect(flash?.parent).toBe(flashRoot);
    expect(smoke?.parent).toBe(anchor);
    expect(light?.parent).toBe(anchor);

    viewWeapon.fire(200);
    viewWeapon.update(0.016, 220, false);
    expect(flash?.isEnabled()).toBe(true);
    expect(smoke?.isEnabled()).toBe(true);
    expect(light?.intensity).toBeGreaterThan(0);

    viewWeapon.update(0.2, 500, false);
    expect(flash?.isEnabled()).toBe(false);
    expect(smoke?.isEnabled()).toBe(false);
    expect(light?.intensity).toBe(0);
  });

  it("keeps support hand fingers, thumb, and sleeve attached to the animated hand root", () => {
    const { scene, camera } = sceneHarness();
    const viewWeapon = new ViewWeapon(scene, camera);
    viewWeapon.setWeapon("br4");
    const handRoot = scene.getTransformNodeByName("viewmodel-br4-support-hand-root");

    expect(scene.getMeshByName("viewmodel-br4-support-glove")?.parent).toBe(handRoot);
    expect(scene.getMeshByName("viewmodel-br4-support-thumb")?.parent).toBe(handRoot);
    expect(scene.getMeshByName("viewmodel-br4-support-finger-0")?.parent).toBe(handRoot);
    expect(scene.getMeshByName("viewmodel-br4-support-sleeve")?.parent).toBe(handRoot);

    viewWeapon.setReloading(true);
    viewWeapon.update(0.3, 620, false);
    expect(handRoot?.position.z).toBeLessThan(0.67);
  });

  it("moves weapon parts during reload, recoil, and weapon switching", () => {
    const { scene, camera } = sceneHarness();
    const viewWeapon = new ViewWeapon(scene, camera);
    viewWeapon.setWeapon("br4");
    const root = scene.getTransformNodeByName("viewmodel-br4-root");
    const magazine = scene.getMeshByName("viewmodel-br4-ribbed-magazine");
    const supportHand = scene.getTransformNodeByName("viewmodel-br4-support-hand-root");
    const receiver = scene.getMeshByName("viewmodel-br4-forged-receiver");

    viewWeapon.update(0.016, 0, false);
    const loweredY = root?.position.y ?? 0;
    const magazineHomeY = magazine?.position.y ?? 0;
    const handHomeZ = supportHand?.position.z ?? 0;
    viewWeapon.update(0.28, 280, false);
    expect(root?.position.y).toBeGreaterThan(loweredY);

    viewWeapon.fire(300);
    viewWeapon.update(0.016, 316, false);
    expect(receiver?.position.z).toBeLessThan(0.23);

    viewWeapon.setReloading(true);
    viewWeapon.update(0.3, 620, false);
    expect(magazine?.position.y).toBeLessThan(magazineHomeY);
    expect(supportHand?.position.z).toBeLessThan(handHomeZ);
  });

  it("keeps the support palm on the magazine surface through contact reload phases", () => {
    const { scene, camera } = sceneHarness();
    const viewWeapon = new ViewWeapon(scene, camera);
    viewWeapon.setWeapon("br4");
    viewWeapon.update(0.2, 200, false);
    viewWeapon.setReloading(true);
    viewWeapon.update(0.32, 520, false);

    const root = scene.getTransformNodeByName("viewmodel-br4-root")!;
    const hand = scene.getTransformNodeByName("viewmodel-br4-support-hand-root")!;
    const magazine = scene.getMeshByName("viewmodel-br4-ribbed-magazine")!;
    const contact = hand.metadata?.gripContact as Vector3;
    const extents = magazine.getBoundingInfo().boundingBox.extendSize;
    const palm = rootLocalPoint(root, hand, contact);
    const magSurface = rootLocalPoint(root, magazine, new Vector3(-extents.x * 0.7, -extents.y * 0.12, -extents.z * 0.16));

    expect(contact).toBeInstanceOf(Vector3);
    expect(Vector3.Distance(palm, magSurface)).toBeLessThan(0.035);
  });

  it("restores reload endpoints and produces the same magazine pose across frame steps", () => {
    const single = sceneHarness();
    const stepped = sceneHarness();
    const singleView = new ViewWeapon(single.scene, single.camera);
    const steppedView = new ViewWeapon(stepped.scene, stepped.camera);
    singleView.setWeapon("br4");
    steppedView.setWeapon("br4");
    singleView.setReloading(true);
    steppedView.setReloading(true);

    singleView.update(0.7, 700, false);
    for (let index = 0; index < 7; index += 1) steppedView.update(0.1, 100 + index * 100, false);

    expectVectorClose(
      stepped.scene.getMeshByName("viewmodel-br4-ribbed-magazine")?.position,
      single.scene.getMeshByName("viewmodel-br4-ribbed-magazine")!.position,
    );

    singleView.update(2, 2700, false);
    const magazine = single.scene.getMeshByName("viewmodel-br4-ribbed-magazine")!;
    const hand = single.scene.getTransformNodeByName("viewmodel-br4-support-hand-root")!;
    const magazineHome = new Vector3(0, -0.25, 0.28);
    const handHome = new Vector3(-0.14, -0.16, 0.67);
    expectVectorClose(magazine.position, magazineHome);
    expectVectorClose(hand.position, handHome);
    expect(magazine.isEnabled()).toBe(true);
  });

  it("animates shotgun shell insertion and delayed pump cycling without changing fire cadence", () => {
    const { scene, camera } = sceneHarness();
    const viewWeapon = new ViewWeapon(scene, camera);
    viewWeapon.setWeapon("rift6");
    viewWeapon.update(0.2, 200, false);
    const pump = scene.getMeshByName("viewmodel-rift6-pump-foreend")!;
    const pumpHomeZ = pump.position.z;

    viewWeapon.fire(220);
    viewWeapon.update(0.016, 236, false);
    expect(pump.position.z).toBeCloseTo(pumpHomeZ);
    viewWeapon.update(0.16, 396, false);
    expect(pump.position.z).toBeLessThan(pumpHomeZ - 0.02);

    viewWeapon.setReloading(true);
    viewWeapon.update(2, 2396, false);
    const shell = scene.getMeshByName("viewmodel-rift6-shell")!;
    expect(shell.isEnabled()).toBe(true);
    expect(shell.position.z).toBeGreaterThan(0.2);
    expect(shell.position.z).toBeLessThan(0.42);
  });

  it("runs a delayed sniper bolt cycle after firing and returns it home", () => {
    const { scene, camera } = sceneHarness();
    const viewWeapon = new ViewWeapon(scene, camera);
    viewWeapon.setWeapon("needle50");
    viewWeapon.update(0.2, 200, false);
    const bolt = scene.getMeshByName("viewmodel-needle50-bolt-handle")!;
    const home = bolt.position.clone();

    viewWeapon.fire(220);
    viewWeapon.update(0.02, 240, false);
    expectVectorClose(bolt.position, home, 0.01);
    viewWeapon.update(0.24, 480, false);
    expect(bolt.position.z).toBeLessThan(home.z - 0.03);
    expect(bolt.rotation.z).toBeGreaterThan(0.1);
    viewWeapon.update(0.5, 980, false);
    expectVectorClose(bolt.position, home, 0.01);
  });

  it("disposes old model meshes when switching weapons and on teardown", () => {
    const { scene, camera } = sceneHarness();
    const viewWeapon = new ViewWeapon(scene, camera);
    viewWeapon.setWeapon("needle50");
    expect(scene.getMeshByName("viewmodel-needle50-long-action")).not.toBeNull();

    viewWeapon.setWeapon("vx7");
    expect(scene.getMeshByName("viewmodel-needle50-long-action")).toBeNull();
    expect(scene.getTransformNodeByName("viewmodel-needle50-support-hand-root")).toBeNull();
    expect(scene.getMeshByName("viewmodel-vx7-monolithic-upper")).not.toBeNull();

    viewWeapon.dispose();
    expect(scene.getMeshByName("viewmodel-vx7-monolithic-upper")).toBeNull();
    expect(scene.getLightByName("viewmodel-fill-light")).toBeNull();
  });
});
