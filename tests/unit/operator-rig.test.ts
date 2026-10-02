import { ensureCanvasGlobals } from "../helpers/canvas";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createOperatorRig } from "../../src/game/characters/OperatorRig";
import { preloadOperatorAssets } from "../../src/game/characters/OperatorAssets";
import { preloadWeaponAssets } from "../../src/game/render/viewmodel/WeaponAssets";

const engines: NullEngine[] = [];

afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
});

function sceneHarness(): Scene {
  ensureCanvasGlobals();
  const engine = new NullEngine();
  engines.push(engine);
  return new Scene(engine);
}


describe("operator rig", () => {
  it("creates a scoped non-colliding visual rig without changing actor hit metadata", () => {
    const scene = sceneHarness();
    const actorRoot = MeshBuilder.CreateCapsule("actor-root", { height: 1.9, radius: 0.38 }, scene);
    actorRoot.position.set(2, 1, -4);
    actorRoot.metadata = { targetIndex: 2, hitZone: "body" };

    const rig = createOperatorRig(scene, actorRoot, "test");
    const head = scene.getTransformNodeByName("test-head");
    const leftBoot = scene.getMeshByName("test-left-boot");
    const hips = scene.getMeshByName("test-hips");
    const leftThigh = scene.getTransformNodeByName("test-left-thigh-pivot");

    actorRoot.computeWorldMatrix(true);
    head?.computeWorldMatrix(true);
    leftBoot?.computeWorldMatrix(true);
    hips?.computeWorldMatrix(true);
    leftThigh?.computeWorldMatrix(true);
    expect(rig.root.parent).toBe(actorRoot);
    expect(actorRoot.metadata).toEqual({ targetIndex: 2, hitZone: "body" });
    expect(head?.getAbsolutePosition().y).toBeCloseTo(actorRoot.position.y + 1.12);
    expect(leftBoot?.getAbsolutePosition().y).toBeCloseTo(actorRoot.position.y - 1.0, 1);
    expect(leftThigh?.getAbsolutePosition().y).toBeGreaterThan((hips?.getAbsolutePosition().y ?? 0) - 0.27);

    const visualMeshes = scene.meshes.filter((mesh) => mesh.name.startsWith("test-"));
    expect(visualMeshes.length).toBeGreaterThan(35);
    for (const mesh of visualMeshes) {
      expect(mesh.isPickable).toBe(false);
      expect(mesh.checkCollisions).toBe(false);
      expect(mesh.metadata).toBeNull();
    }

    rig.dispose();
  });

  it("switches weapons, applies team colors, and exposes an animated muzzle attachment", () => {
    const scene = sceneHarness();
    const parent = new TransformNode("actor-root", scene);
    const rig = createOperatorRig(scene, parent, "operator");

    const pistolSlide = scene.getMeshByName("operator-pistol-slide");
    const rifleReceiver = scene.getMeshByName("operator-rifle-receiver");
    const rifleBarrel = scene.getMeshByName("operator-rifle-barrel");
    expect(pistolSlide?.isEnabled()).toBe(true);
    expect(rifleReceiver?.isEnabled()).toBe(false);
    expect(rig.muzzleLocalPosition.z).toBeCloseTo(0.85);
    expect(rig.muzzleLocalPosition.y).toBeCloseTo(0.82);

    rig.setWeapon("br4");
    expect(pistolSlide?.isEnabled()).toBe(false);
    expect(rifleReceiver?.isEnabled()).toBe(true);
    expect(rig.muzzleLocalPosition.z).toBeCloseTo((rifleBarrel?.position.z ?? 0) + 0.31);
    expect(rig.muzzleAttachment.position.z).toBeCloseTo(rig.muzzleLocalPosition.z);
    expect(rig.muzzleAttachment.rotation.asArray()).toEqual([0, 0, 0]);
    expectMuzzleAtBarrelTip(rig, scene, "vx7", 1.55);
    expectMuzzleAtBarrelTip(rig, scene, "needle50", 1.55);

    rig.setTeam({ marker: "#ff3300", cloth: new Color3(0.2, 0.25, 0.22) });
    const markerMaterial = scene.getMeshByName("operator-chest-team-patch")?.material;
    expect(markerMaterial).toBeInstanceOf(PBRMaterial);
    expect((markerMaterial as PBRMaterial).albedoColor.r).toBeCloseTo(1);

    const chest = scene.getTransformNodeByName("operator-chest");
    const leftThigh = scene.getTransformNodeByName("operator-left-thigh-pivot");
    const leftHand = scene.getTransformNodeByName("operator-left-hand");
    const rightHand = scene.getTransformNodeByName("operator-right-hand");
    const leftGrip = scene.getTransformNodeByName("operator-left-weapon-grip");
    const rightGrip = scene.getTransformNodeByName("operator-right-weapon-grip");
    const initialChestY = chest?.position.y ?? 0;
    const initialChestRotation = chest?.rotation.x ?? 0;
    const initialThighRotation = leftThigh?.rotation.x ?? 0;
    const initialMuzzle = rig.muzzleAttachment.getAbsolutePosition().clone();
    rig.update(0.16, 1, 0.25, true);
    rig.muzzleAttachment.computeWorldMatrix(true);
    leftHand?.computeWorldMatrix(true);
    rightHand?.computeWorldMatrix(true);
    leftGrip?.computeWorldMatrix(true);
    rightGrip?.computeWorldMatrix(true);

    expect(chest?.position.y).not.toBe(initialChestY);
    expect(chest?.rotation.x).not.toBeCloseTo(initialChestRotation);
    expect(leftThigh?.rotation.x).not.toBeCloseTo(initialThighRotation);
    expect(Vector3.Distance(initialMuzzle, rig.muzzleAttachment.getAbsolutePosition())).toBeGreaterThan(0.005);
    expect((leftGrip?.getAbsolutePosition().y ?? 0)).toBeGreaterThan(0.6);
    expect((rightGrip?.getAbsolutePosition().y ?? 0)).toBeGreaterThan(0.5);
    expect(Vector3.Distance(leftHand?.getAbsolutePosition() ?? Vector3.Zero(), leftGrip?.getAbsolutePosition() ?? Vector3.One())).toBeLessThan(0.02);
    expect(Vector3.Distance(rightHand?.getAbsolutePosition() ?? Vector3.Zero(), rightGrip?.getAbsolutePosition() ?? Vector3.One())).toBeLessThan(0.02);

    rig.dispose();
  });

  it("keeps chamfered armor and pouch triangles front-facing in Babylon left-handed winding", () => {
    const scene = sceneHarness();
    const parent = new TransformNode("actor-root", scene);
    const rig = createOperatorRig(scene, parent, "operator");

    assertLeftHandedWinding(scene.getMeshByName("operator-front-plate"));
    assertLeftHandedWinding(scene.getMeshByName("operator-plate-carrier"));
    assertLeftHandedWinding(scene.getMeshByName("operator-mag-pouch-0"));

    rig.dispose();
  });

  it("keeps idle legs planted instead of cycling the walk pose", () => {
    const scene = sceneHarness();
    const parent = new TransformNode("actor-root", scene);
    const rig = createOperatorRig(scene, parent, "operator-idle");
    const joints = legJoints(scene, "operator-idle");
    const idlePose = rotationPose(...joints);

    for (let frame = 0; frame < 120; frame += 1) rig.update(1 / 60, 0, 0, false);

    expectPoseClose(rotationPose(...joints), idlePose, 0.000001);
    rig.dispose();
  });

  it("eases into and out of walking without snapping the leg pose", () => {
    const scene = sceneHarness();
    const parent = new TransformNode("actor-root", scene);
    const rig = createOperatorRig(scene, parent, "operator-motion");
    const joints = legJoints(scene, "operator-motion");
    const idlePose = rotationPose(...joints);

    rig.update(1 / 60, 1, 0, false);
    const firstMovingDelta = maxPoseDelta(rotationPose(...joints), idlePose);
    expect(firstMovingDelta).toBeGreaterThan(0.001);
    expect(firstMovingDelta).toBeLessThan(0.04);

    let fullStrideDelta = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      rig.update(1 / 60, 1, 0, false);
      fullStrideDelta = Math.max(fullStrideDelta, maxPoseDelta(rotationPose(...joints), idlePose));
    }
    expect(fullStrideDelta).toBeGreaterThan(0.1);

    for (let frame = 0; frame < 80; frame += 1) rig.update(1 / 60, 0, 0, false);
    expect(maxPoseDelta(rotationPose(...joints), idlePose)).toBeLessThan(0.01);
    rig.dispose();
  });

  it("applies a short firing kick that recovers with stable frame timing", () => {
    const scene = sceneHarness();
    const parent = new TransformNode("actor-root", scene);
    const rig = createOperatorRig(scene, parent, "operator-recoil");
    const weaponRoot = scene.getTransformNodeByName("operator-recoil-weapon-root");
    const readyZ = weaponRoot?.position.z ?? 0;
    const readyRotationX = weaponRoot?.rotation.x ?? 0;

    rig.update(1 / 60, 0, 0, true);
    const firstKickZ = weaponRoot?.position.z ?? 0;
    const firstKickRotationX = weaponRoot?.rotation.x ?? 0;
    expect(firstKickZ).toBeLessThan(readyZ - 0.01);
    expect(firstKickRotationX).toBeLessThan(readyRotationX - 0.02);

    rig.update(1 / 60, 0, 0, true);
    expect(weaponRoot?.position.z ?? 0).toBeLessThanOrEqual(firstKickZ + 0.005);

    for (let frame = 0; frame < 70; frame += 1) rig.update(1 / 60, 0, 0, false);
    expect(weaponRoot?.position.z).toBeCloseTo(readyZ, 2);
    expect(weaponRoot?.rotation.x).toBeCloseTo(readyRotationX, 2);

    rig.update(0, 1, 0, false);
    expect(Number.isFinite(weaponRoot?.position.z ?? Number.NaN)).toBe(true);
    rig.dispose();
  });

  it("uses cached authored px9 and br4 meshes when weapon assets are preloaded", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const pathname = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const json = await readFile(join(process.cwd(), "public", pathname.replace(/^\//, "")), "utf8");
      return { ok: true, json: async () => JSON.parse(json) } as Response;
    }) as typeof fetch;
    try {
      await preloadWeaponAssets();
    } finally {
      globalThis.fetch = previousFetch;
    }

    const scene = sceneHarness();
    const parent = new TransformNode("actor-root", scene);
    const rig = createOperatorRig(scene, parent, "operator-authored");

    const authoredPistol = scene.getMeshByName("operator-authored-authored-px9-slide-slide");
    const fallbackPistol = scene.getMeshByName("operator-authored-pistol-slide");
    expect(authoredPistol?.isEnabled()).toBe(true);
    expect(fallbackPistol?.isEnabled()).toBe(false);
    expect(rig.meshes).toContain(authoredPistol);
    expect(authoredPistol?.renderingGroupId).toBe(0);
    expect(authoredPistol?.alwaysSelectAsActiveMesh).toBe(false);
    expect(authoredPistol?.receiveShadows).toBe(true);
    expect(authoredPistol?.isPickable).toBe(false);

    rig.setWeapon("br4");
    const authoredRifle = scene.getMeshByName("operator-authored-authored-br4-body-m4a1_body");
    const fallbackRifle = scene.getMeshByName("operator-authored-rifle-receiver");
    const weaponRoot = scene.getTransformNodeByName("operator-authored-weapon-root");
    expect(authoredPistol?.isEnabled()).toBe(false);
    expect(authoredRifle?.isEnabled()).toBe(true);
    expect(fallbackRifle?.isEnabled()).toBe(false);
    rig.muzzleAttachment.computeWorldMatrix(true);
    weaponRoot?.computeWorldMatrix(true);
    const expectedMuzzle = new Vector3(0, 0.07, 0.589).scale(0.85).add(scene.getTransformNodeByName("operator-authored-authored-br4-root")?.position ?? Vector3.Zero());
    expect(rig.muzzleAttachment.position.x).toBeCloseTo(expectedMuzzle.x);
    expect(rig.muzzleAttachment.position.y).toBeCloseTo(expectedMuzzle.y);
    expect(rig.muzzleAttachment.position.z).toBeCloseTo(expectedMuzzle.z);

    rig.dispose();
  });

  it("uses the Blender-authored operator body when the package is preloaded", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const pathname = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
      const json = await readFile(join(process.cwd(), "public", pathname.replace(/^\//, "")), "utf8");
      return { ok: true, json: async () => JSON.parse(json) } as Response;
    }) as typeof fetch;
    try {
      await preloadOperatorAssets();
    } finally {
      globalThis.fetch = previousFetch;
    }

    const manifest = JSON.parse(await readFile(join(process.cwd(), "public/models/operator/manifest.json"), "utf8")) as {
      conversion: { triangleCount: number };
      source: { humanReference?: { author: string; license: string } };
    };
    expect(manifest.conversion.triangleCount).toBeGreaterThan(10000);
    expect(manifest.conversion.triangleCount).toBeLessThan(45000);
    expect(manifest.source.humanReference?.license).toBe("CC0-1.0");

    const scene = sceneHarness();
    const parent = new TransformNode("actor-root", scene);
    const rig = createOperatorRig(scene, parent, "operator-blender");
    const authoredHead = rig.meshes.find((mesh) => mesh.skeleton !== null);
    const fallbackHelmet = scene.getMeshByName("operator-blender-helmet-shell");
    expect(authoredHead).toBeDefined();
    expect(authoredHead?.isEnabled()).toBe(true);
    expect(fallbackHelmet).toBeNull();
    expect(rig.meshes).toContain(authoredHead);
    for (const mesh of rig.meshes.filter((entry) => entry.skeleton !== null)) {
      expect(mesh.isPickable).toBe(false);
      expect(mesh.checkCollisions).toBe(false);
      expect(mesh.metadata).toBeNull();
    }
    rig.dispose();
  });
});

function assertLeftHandedWinding(mesh: AbstractMesh | null): void {
  expect(mesh).not.toBeNull();
  const positions = mesh?.getVerticesData("position");
  const indices = mesh?.getIndices();
  expect(positions?.length).toBeGreaterThan(0);
  expect(indices?.length).toBeGreaterThan(0);
  if (!positions || !indices) return;

  const zs: number[] = [];
  for (let index = 2; index < positions.length; index += 3) zs.push(positions[index]);
  const frontZ = Math.max(...zs);
  const backZ = Math.min(...zs);
  const frontNormals = triangleNormalsNearZ(positions, indices, frontZ);
  const backNormals = triangleNormalsNearZ(positions, indices, backZ);

  expect(frontNormals.length).toBeGreaterThan(0);
  expect(backNormals.length).toBeGreaterThan(0);
  expect(frontNormals.every((normalZ) => normalZ < -0.0001)).toBe(true);
  expect(backNormals.every((normalZ) => normalZ > 0.0001)).toBe(true);
}

function triangleNormalsNearZ(positions: ArrayLike<number>, indices: ArrayLike<number>, z: number): number[] {
  const result: number[] = [];
  for (let index = 0; index < indices.length; index += 3) {
    const a = vertexAt(positions, Number(indices[index]));
    const b = vertexAt(positions, Number(indices[index + 1]));
    const c = vertexAt(positions, Number(indices[index + 2]));
    const averageZ = (a.z + b.z + c.z) / 3;
    if (Math.abs(averageZ - z) > 0.0001) continue;
    result.push(Vector3.Cross(b.subtract(a), c.subtract(a)).z);
  }
  return result;
}

function vertexAt(positions: ArrayLike<number>, index: number): Vector3 {
  return new Vector3(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
}

function legJoints(scene: Scene, name: string): TransformNode[] {
  const joints = [
    scene.getTransformNodeByName(`${name}-left-thigh-pivot`),
    scene.getTransformNodeByName(`${name}-left-shin-pivot`),
    scene.getTransformNodeByName(`${name}-right-thigh-pivot`),
    scene.getTransformNodeByName(`${name}-right-shin-pivot`),
  ].filter((node): node is TransformNode => node !== null);
  expect(joints).toHaveLength(4);
  return joints;
}

function rotationPose(...nodes: TransformNode[]): number[] {
  return nodes.map((node) => node.rotation.x);
}

function expectPoseClose(current: number[], expected: number[], precision: number): void {
  expect(current.length).toBe(expected.length);
  for (const [index, value] of current.entries()) expect(value).toBeCloseTo(expected[index], Math.ceil(-Math.log10(precision)));
}

function maxPoseDelta(current: number[], previous: number[]): number {
  return Math.max(...current.map((value, index) => Math.abs(value - previous[index])));
}

function expectMuzzleAtBarrelTip(
  rig: ReturnType<typeof createOperatorRig>,
  scene: Scene,
  weaponId: "vx7" | "needle50",
  barrelTipZ: number,
): void {
  rig.setWeapon(weaponId);
  const weaponRoot = scene.getTransformNodeByName("operator-weapon-root");
  rig.muzzleAttachment.computeWorldMatrix(true);
  weaponRoot?.computeWorldMatrix(true);
  const expectedZ = (weaponRoot?.getAbsolutePosition().z ?? 0) + barrelTipZ * (weaponRoot?.scaling.z ?? 1);
  expect(rig.muzzleAttachment.getAbsolutePosition().z).toBeCloseTo(expectedZ);
}
