import { readFile } from "node:fs/promises";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildTacticalHands, preloadTacticalHands } from "../../src/game/render/viewmodel/TacticalHands";
import type { WeightedHand } from "../../src/game/render/viewmodel/HandSkin";
import { createViewMaterials, VIEWMODEL_RENDER_GROUP } from "../../src/game/render/viewmodel/primitives";
import { ensureCanvasGlobals } from "../helpers/canvas";

const engines: NullEngine[] = [];
let authored: { variants: Record<string, { hands: Record<string, WeightedHand> }> };
beforeAll(async () => {
  authored = JSON.parse(await readFile(new URL("../../public/models/weighted-hands/weighted-hands.json", import.meta.url), "utf8"));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => authored })));
  // Keep the actual source schema check rather than bypassing the preloader.
  await preloadTacticalHands();
});
afterEach(() => { for (const engine of engines.splice(0)) engine.dispose(); });
afterAll(() => vi.unstubAllGlobals());
function harness() {
  ensureCanvasGlobals();
  const engine = new NullEngine(); engines.push(engine);
  const scene = new Scene(engine);
  scene.activeCamera = new FreeCamera("camera", Vector3.Zero(), scene);
  const root = new TransformNode("viewmodel-test", scene);
  return { scene, root, materials: createViewMaterials(scene) };
}
function deformed(mesh: Mesh, data: WeightedHand): Vector3[] {
  mesh.skeleton!.prepare(true);
  const transforms = mesh.skeleton!.getTransformMatrices(mesh);
  return Array.from({ length: data.positions.length / 3 }, (_, index) => {
    const result = Vector3.Zero(), position = Vector3.FromArray(data.positions, index * 3);
    for (let influence = 0; influence < 4; influence += 1) {
      const weight = data.matricesWeights[index * 4 + influence];
      if (weight === 0) continue;
      const matrix = Matrix.FromArray(transforms, data.matricesIndices[index * 4 + influence] * 16);
      result.addInPlace(Vector3.TransformCoordinates(position, matrix).scale(weight));
    }
    return result;
  });
}
describe("weighted anatomical tactical hands", () => {
  it("preserves five articulated fingers and normalized skin weights on shared topology", () => {
    for (const variant of Object.values(authored.variants)) for (const hand of Object.values(variant.hands)) {
      expect(hand.bones).toHaveLength(16);
      for (let finger = 1; finger <= 5; finger += 1) for (let joint = 1; joint <= 3; joint += 1) {
        expect(hand.bones.some((bone) => bone.name === `finger-${finger}-${joint}`)).toBe(true);
      }
      expect(hand.matricesWeights).toHaveLength(hand.positions.length / 3 * 4);
      for (let index = 0; index < hand.matricesWeights.length; index += 4) {
        expect(hand.matricesWeights.slice(index, index + 4).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 5);
      }
      expect(hand.matricesIndices.every((index) => Number.isInteger(index) && index >= 0 && index < hand.bones.length)).toBe(true);
      expect(hand.positions.every(Number.isFinite)).toBe(true);
      expect(hand.matricesWeights.some((weight) => weight > 0.1 && weight < 0.9)).toBe(true);
    }
  });

  it("places the palm surface at the gun contact and keeps sleeves joined as the wrist moves", () => {
    const { scene, root, materials } = harness();
    root.rotation.set(0.2, -0.3, 0.1);
    const gripLeft: [number, number, number] = [-0.025, 0.04, 0.33];
    const hands = buildTacticalHands(scene, root, "custom", materials, { style: "rifle", gripLeft });
    hands.supportHand.computeWorldMatrix(true); root.computeWorldMatrix(true);
    const contact = Vector3.TransformCoordinates(hands.gripContact, hands.supportHand.getWorldMatrix());
    expect(contact.equalsWithEpsilon(Vector3.TransformCoordinates(Vector3.FromArray(gripLeft), root.getWorldMatrix()))).toBe(true);
    const sleeve = scene.getMeshByName("custom-support-sleeve")!;
    const before = sleeve.position.clone();
    hands.supportHand.position.y -= 0.2; hands.supportHand.rotation.z = 0.6; hands.update();
    expect(sleeve.position.equalsWithEpsilon(before)).toBe(false);
    expect(hands.meshes.every((mesh) => mesh.renderingGroupId === VIEWMODEL_RENDER_GROUP && !mesh.isPickable && !mesh.checkCollisions)).toBe(true);
  });

  it("continuously opens the actual weighted fingers without topology replacement", () => {
    const { scene, root, materials } = harness();
    const materialCount = scene.materials.length;
    const hands = buildTacticalHands(scene, root, "pose", materials, { style: "rifle" });
    const mesh = scene.getMeshByName("pose-support-glove") as Mesh;
    const data = authored.variants.rifle.hands.support;
    const closed = deformed(mesh, data);
    hands.setGrip(0.99);
    const next = deformed(mesh, data);
    const step = Math.max(...closed.map((p, index) => Vector3.Distance(p, next[index])));
    expect(step).toBeGreaterThan(0.00001);
    expect(step).toBeLessThan(0.003);
    hands.setGrip(0);
    const open = deformed(mesh, data);
    expect(Math.max(...closed.map((p, index) => Vector3.Distance(p, open[index])))).toBeGreaterThan(0.025);
    expect(open.every((point) => point.asArray().every(Number.isFinite))).toBe(true);
    expect(scene.skeletons).toHaveLength(2);
    root.dispose(false, false);
    expect(scene.skeletons).toHaveLength(0);
    expect(scene.materials.length).toBe(materialCount);
    expect(scene.materials.includes(materials.glove)).toBe(true);
  });
});
