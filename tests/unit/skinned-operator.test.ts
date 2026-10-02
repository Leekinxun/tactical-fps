import { readFile } from "node:fs/promises";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSkinnedOperator, preloadSkinnedOperator, type SkinnedOperatorAsset, solveLimb } from "../../src/game/characters/SkinnedOperator";
import { preloadWeaponAssets } from "../../src/game/render/viewmodel/WeaponAssets";
import { ensureCanvasGlobals } from "../helpers/canvas";
import type { WeaponId } from "../../src/game/combat/WeaponCatalog";

const engines: NullEngine[] = [];
let source: SkinnedOperatorAsset;
beforeAll(async () => {
  ensureCanvasGlobals();
  vi.stubGlobal("fetch", async (url: string) => ({ ok: true, json: async () => JSON.parse(await readFile(new URL(`../../public${url}`, import.meta.url), "utf8")) }));
  source = JSON.parse(await readFile(new URL("../../public/models/skinned-operator/operator.json", import.meta.url), "utf8"));
  await Promise.all([preloadSkinnedOperator(), preloadWeaponAssets()]);
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => { for (const engine of engines.splice(0)) engine.dispose(); });
function fixture() {
  const engine = new NullEngine(); engines.push(engine);
  const scene = new Scene(engine);
  const parent = new TransformNode("actor", scene); parent.position.y = 1;
  const rig = createSkinnedOperator(scene, parent, "operator")!;
  return { scene, parent, rig };
}

const WEAPONS: WeaponId[] = ["px9", "arc12", "vx7", "rift6", "br4", "needle50"];

function bone(scene: Scene, key: string) {
  const found = scene.skeletons[0].bones.find((candidate) => candidate.name.endsWith(`:${key}`));
  if (!found) throw new Error(`Missing bone ${key}`);
  return found;
}

function restHead(key: string): Vector3 {
  const found = source.bones.find((candidate) => candidate.name === key);
  if (!found) throw new Error(`Missing rest bone ${key}`);
  return Vector3.FromArray(found.head);
}

function restLength(from: string, to: string): number {
  return Vector3.Distance(restHead(from), restHead(to));
}

function segmentLength(scene: Scene, from: string, to: string): number {
  return Vector3.Distance(bone(scene, from).getAbsolutePosition(), bone(scene, to).getAbsolutePosition());
}

function localFootOffset(parent: TransformNode, foot: TransformNode, homeX: number): Vector3 {
  parent.computeWorldMatrix(true);
  foot.computeWorldMatrix(true);
  const local = Vector3.TransformCoordinates(foot.getAbsolutePosition(), parent.computeWorldMatrix(true).clone().invert());
  return new Vector3(local.x - homeX, local.y, local.z - 0.01);
}

describe("weighted operator", () => {
  it("ships normalized multi-bone skinning rather than disconnected limb meshes", () => {
    let blended = 0;
    for (const part of source.parts) {
      expect(part.boneWeights.length).toBe(part.positions.length / 3 * 4);
      expect(part.boneIndices.length).toBe(part.boneWeights.length);
      for (let offset = 0; offset < part.boneWeights.length; offset += 4) {
        const weights = part.boneWeights.slice(offset, offset + 4);
        expect(weights.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 4);
        expect(weights.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
        if (weights.filter((value) => value > 0.02).length > 1) blended++;
      }
    }
    expect(blended).toBeGreaterThan(100);
    const { rig, scene } = fixture();
    expect(scene.skeletons).toHaveLength(1);
    expect(rig.meshes.some((mesh) => mesh.skeleton?.bones.length === source.bones.length)).toBe(true);
    expect(rig.meshes.every((mesh) => !mesh.isPickable && !mesh.checkCollisions)).toBe(true);
  });
  it("locks a stance foot to the floor while the actor advances", () => {
    const { rig, parent, scene } = fixture();
    const foot = scene.getTransformNodeByName("operator-foot-contact-R")!;
    foot.computeWorldMatrix(true);
    const start = foot.getAbsolutePosition().clone();
    for (let i = 0; i < 8; i++) {
      parent.position.z += 2.4 / 60;
      rig.update(1 / 60, 1);
      foot.computeWorldMatrix(true);
      expect(Vector3.Distance(foot.getAbsolutePosition(), start)).toBeLessThan(0.012);
    }
  });
  it("reanchors feet when the remote avatar applies its gameplay scale", () => {
    const { rig, scene } = fixture();
    rig.root.scaling.setAll(0.8);
    rig.root.position.y = -0.2;
    rig.update(0, 0);
    for (const side of ["L", "R"]) {
      const foot = scene.getTransformNodeByName(`operator-foot-contact-${side}`)!;
      foot.computeWorldMatrix(true);
      const sourceFoot = source.bones.find((bone) => bone.name === `foot.${side}`)!;
      expect(foot.getAbsolutePosition().y).toBeCloseTo(1 - 0.2 + sourceFoot.head[1] * 0.8, 5);
    }
  });
  it("lowers the torso during crouch while preserving ankle floor contact", () => {
    const { rig, scene } = fixture();
    const skeleton = scene.skeletons[0];
    const head = skeleton.bones.find((bone) => bone.name.endsWith(":head"))!;
    const foot = scene.getTransformNodeByName("operator-foot-contact-L")!;
    foot.computeWorldMatrix(true);
    const floor = foot.getAbsolutePosition().y;
    const standing = head.getAbsolutePosition().y;
    for (let i = 0; i < 60; i++) rig.update(1 / 60, 0, 0, false, true);
    foot.computeWorldMatrix(true);
    expect(foot.getAbsolutePosition().y).toBeCloseTo(floor, 4);
    expect(head.getAbsolutePosition().y).toBeLessThan(standing - 0.4);
    expect([...skeleton.getTransformMatrices(rig.meshes.find((mesh) => mesh.skeleton)!)].every(Number.isFinite)).toBe(true);
    rig.dispose();
    expect(scene.skeletons).toHaveLength(0);
    expect(scene.meshes).toHaveLength(0);
  });
  it("preserves arm segment lengths while aiming every weapon from standing and crouch", () => {
    const failures: string[] = [];
    const tolerance = 0.026;
    const segments = [
      ["upper_arm.L", "forearm.L"],
      ["forearm.L", "hand.L"],
      ["upper_arm.R", "forearm.R"],
      ["forearm.R", "hand.R"],
    ] as const;

    for (const weaponId of WEAPONS) {
      for (const crouching of [false, true]) {
        for (const aimPitch of [-0.8, 0.8]) {
          const { rig, scene } = fixture();
          rig.setWeapon(weaponId);
          for (let frame = 0; frame < 30; frame += 1) rig.update(1 / 60, 0, aimPitch, false, crouching);
          for (const [from, to] of segments) {
            const rest = restLength(from, to);
            const actual = segmentLength(scene, from, to);
            const stretch = actual - rest;
            if (stretch > tolerance) {
              failures.push(`${weaponId} ${crouching ? "crouch" : "stand"} pitch=${aimPitch} ${from}->${to} rest=${rest.toFixed(4)} actual=${actual.toFixed(4)} stretch=${stretch.toFixed(4)}`);
            }
          }
        }
      }
    }

    expect(failures, failures.join("\n")).toHaveLength(0);
  });
  it("settles both feet back onto the floor after stopping from a forward step", () => {
    const { rig, parent, scene } = fixture();
    const left = scene.getTransformNodeByName("operator-foot-contact-L")!;
    const right = scene.getTransformNodeByName("operator-foot-contact-R")!;
    rig.update(0, 0);
    left.computeWorldMatrix(true);
    right.computeWorldMatrix(true);
    const floor = Math.min(left.getAbsolutePosition().y, right.getAbsolutePosition().y);

    for (let frame = 0; frame < 42; frame += 1) {
      parent.position.z += 3.1 / 60;
      rig.update(1 / 60, 1);
    }
    for (let frame = 0; frame < 80; frame += 1) rig.update(1 / 60, 0);

    left.computeWorldMatrix(true);
    right.computeWorldMatrix(true);
    const leftHeight = left.getAbsolutePosition().y - floor;
    const rightHeight = right.getAbsolutePosition().y - floor;
    const leftOffset = localFootOffset(parent, left, 0.17);
    const rightOffset = localFootOffset(parent, right, -0.17);
    const failures = [
      leftHeight > 0.018 ? `left foot height=${leftHeight.toFixed(4)}` : "",
      rightHeight > 0.018 ? `right foot height=${rightHeight.toFixed(4)}` : "",
      Math.abs(leftOffset.z) > 0.34 ? `left foot localZ=${leftOffset.z.toFixed(4)}` : "",
      Math.abs(rightOffset.z) > 0.34 ? `right foot localZ=${rightOffset.z.toFixed(4)}` : "",
      Math.abs(leftOffset.x) > 0.24 ? `left foot localX=${leftOffset.x.toFixed(4)}` : "",
      Math.abs(rightOffset.x) > 0.24 ? `right foot localX=${rightOffset.x.toFixed(4)}` : "",
    ].filter(Boolean);

    expect(failures, failures.join("\n")).toHaveLength(0);
  });
  it("solves a bent limb with both segment lengths preserved", () => {
    const start = new Vector3(0, 1, 0), end = new Vector3(0, 0.2, 0.2);
    const knee = solveLimb(start, end, 0.5, 0.5, Vector3.Forward());
    expect(Vector3.Distance(start, knee)).toBeCloseTo(0.5, 5);
    expect(Vector3.Distance(knee, end)).toBeCloseTo(0.5, 5);
    expect(knee.z).toBeGreaterThan(end.z);
  });
});
