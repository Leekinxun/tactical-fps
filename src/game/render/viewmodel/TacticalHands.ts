import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Material } from "@babylonjs/core/Materials/material";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { markViewMesh, type ViewMaterials } from "./primitives";
import { buildHandSkin, type HandGeometry, type WeightedHand } from "./HandSkin";

export type TacticalHandsStyle = "pistol" | "rifle";
export interface TacticalHandsOptions {
  style: TacticalHandsStyle;
  /** Gun surface contact, not the wrist position. */
  gripLeft?: [number, number, number];
  gripRight?: [number, number, number];
}
export interface TacticalHands {
  meshes: AbstractMesh[];
  supportHand: TransformNode;
  triggerHand: TransformNode;
  /** Palm contact center in supportHand local space. */
  gripContact: Vector3;
  setGrip: (amount: number) => void;
  update: () => void;
}
interface Variant {
  hands: { trigger: WeightedHand; support: WeightedHand };
  defaults: { gripRight: [number, number, number]; gripLeft: [number, number, number] };
  sleeveEnd: { trigger: [number, number, number]; support: [number, number, number] };
}
interface HandsAsset { schemaVersion: number; variants: Record<TacticalHandsStyle, Variant>; sleeve: HandGeometry }
let asset: HandsAsset | undefined;
let loading: Promise<void> | undefined;

export function preloadTacticalHands(): Promise<void> {
  if (asset) return Promise.resolve();
  return loading ??= fetch("/models/weighted-hands/weighted-hands.json")
    .then(async (response) => {
      if (!response.ok) throw new Error(`战术手套模型加载失败: ${response.status}`);
      const loaded = await response.json() as HandsAsset;
      if (loaded.schemaVersion !== 2) throw new Error("战术手套蒙皮格式不受支持");
      asset = loaded;
    }).catch((error: unknown) => { loading = undefined; throw error; });
}

export function buildTacticalHands(scene: Scene, root: TransformNode, name: string, materials: ViewMaterials, options: TacticalHandsOptions): TacticalHands {
  const variant = asset?.variants[options.style];
  const triggerHand = new TransformNode(`${name}-trigger-hand-root`, scene);
  const supportHand = new TransformNode(`${name}-support-hand-root`, scene);
  triggerHand.parent = root;
  supportHand.parent = root;
  triggerHand.position.copyFromFloats(...(options.gripRight ?? variant?.defaults.gripRight ?? [0.035, -0.06, -0.045]));
  supportHand.position.copyFromFloats(...(options.gripLeft ?? variant?.defaults.gripLeft ?? [-0.03, 0.02, 0.29]));
  if (!variant || !asset) return { meshes: [], supportHand, triggerHand, gripContact: Vector3.Zero(), setGrip: () => undefined, update: () => undefined };
  tuneMaterials(materials);
  const meshes: AbstractMesh[] = [];
  const protection = materials.glove.clone(`${name}-stitched-fabric`)!;
  protection.albedoColor = materials.glove.albedoColor.scale(0.7);
  root.onDisposeObservable.addOnce(() => protection.dispose(false, false));
  const bindings: { wrist: Vector3; wristDirection: Vector3; wristAcross: Vector3; hand: TransformNode; sleeve: Mesh; cuff: Mesh; end: Vector3; previousWrist?: Vector3; previousDirection?: Vector3; previousAcross?: Vector3 }[] = [];
  let setGrip: (amount: number) => void = () => undefined;
  for (const kind of ["trigger", "support"] as const) {
    const hand = kind === "trigger" ? triggerHand : supportHand;
    const skin = buildHandSkin(scene, hand, `${name}-${kind}`, variant.hands[kind], materials.glove, protection);
    meshes.push(...skin.meshes);
    if (kind === "support") setGrip = skin.setGrip;
    const sleeve = new Mesh(`${name}-${kind}-sleeve`, scene);
    const data = new VertexData();
    Object.assign(data, asset.sleeve);
    data.applyToMesh(sleeve, true);
    sleeve.parent = root;
    sleeve.material = materials.sleeve;
    sleeve.rotationQuaternion = Quaternion.Identity();
    sleeve.metadata = { tacticalHandPart: "sleeve", materialRole: "sleeve" };
    markViewMesh(sleeve);
    // A soft wrist seal closes the sleeve opening without a flat end cap.
    const cuff = MeshBuilder.CreateTorus(`${name}-${kind}-cuff`, { diameter: 0.053, thickness: 0.008, tessellation: 28 }, scene);
    cuff.parent = root;
    cuff.material = materials.rubber;
    cuff.rotationQuaternion = Quaternion.Identity();
    cuff.metadata = { tacticalHandPart: "cuff", materialRole: "rubber" };
    markViewMesh(cuff);
    meshes.push(sleeve, cuff);
    bindings.push({ hand, sleeve, cuff, wrist: Vector3.FromArray(variant.hands[kind].wrist), wristDirection: Vector3.FromArray(variant.hands[kind].wristDirection), wristAcross: Vector3.FromArray(variant.hands[kind].wristAcross), end: Vector3.FromArray(variant.sleeveEnd[kind]) });
  }
  const update = () => {
    root.computeWorldMatrix(true);
    const inverse = root.getWorldMatrix().clone().invert();
    for (const binding of bindings) {
      binding.hand.computeWorldMatrix(true);
      const world = Vector3.TransformCoordinates(binding.wrist, binding.hand.getWorldMatrix());
      const wrist = Vector3.TransformCoordinates(world, inverse);
      const localMatrix = binding.hand.getWorldMatrix().multiply(inverse);
      const direction = Vector3.TransformNormal(binding.wristDirection, localMatrix).normalize();
      const across = Vector3.TransformNormal(binding.wristAcross, localMatrix).normalize();
      if (binding.previousWrist?.equalsWithEpsilon(wrist, 0.00002) && binding.previousDirection?.equalsWithEpsilon(direction, 0.00002) && binding.previousAcross?.equalsWithEpsilon(across, 0.00002)) continue;
      binding.previousWrist = wrist.clone();
      binding.previousDirection = direction.clone();
      binding.previousAcross = across.clone();
      const span = wrist.subtract(binding.end);
      const center = Vector3.Center(wrist, binding.end);
      binding.sleeve.position.copyFrom(center);
      const positions: number[] = [], normals: number[] = [];
      const template = asset!.sleeve;
      // A curved forearm meets the wrist along its anatomical axis, so sleeve
      // openings do not slice through a rotated hand during magazine handling.
      for (let index = 0; index < template.positions.length; index += 3) {
        const t = template.positions[index + 1] + 0.5, t2 = t * t, t3 = t2 * t;
        const point = binding.end.scale(2 * t3 - 3 * t2 + 1)
          .add(span.scale(0.7 * (t3 - 2 * t2 + t)))
          .add(wrist.scale(-2 * t3 + 3 * t2))
          .add(direction.scale(0.14 * (t3 - t2)));
        const tangent = span.scale(0.7 * (3 * t2 - 4 * t + 1) - 6 * t2 + 6 * t)
          .add(direction.scale(0.14 * (3 * t2 - 2 * t))).normalize();
        const xAxis = across.subtract(tangent.scale(Vector3.Dot(across, tangent))).normalize();
        const zAxis = Vector3.Cross(xAxis, tangent).normalize();
        point.addInPlace(xAxis.scale(template.positions[index])).addInPlace(zAxis.scale(template.positions[index + 2]));
        positions.push(point.x - center.x, point.y - center.y, point.z - center.z);
      }
      VertexData.ComputeNormals(positions, template.indices, normals);
      binding.sleeve.updateVerticesData(VertexBuffer.PositionKind, positions, true);
      binding.sleeve.updateVerticesData(VertexBuffer.NormalKind, normals);
      binding.cuff.position.copyFrom(wrist);
      Quaternion.FromUnitVectorsToRef(Vector3.Up(), direction, binding.cuff.rotationQuaternion!);
      binding.cuff.scaling.z = 0.88;
    }
  };
  update();
  return { meshes, supportHand, triggerHand, gripContact: Vector3.FromArray(variant.hands.support.contact), setGrip, update };
}

function tuneMaterials(materials: ViewMaterials): void {
  if (materials.glove.metadata?.weightedHandsTuned) return;
  materials.glove.albedoColor = Color3.FromHexString("#656d58").toLinearSpace();
  materials.glove.emissiveColor = materials.glove.albedoColor.scale(0.012);
  materials.glove.roughness = 0.88;
  materials.glove.sideOrientation = Material.ClockWiseSideOrientation;
  materials.glove.backFaceCulling = true;
  materials.sleeve.albedoColor = Color3.FromHexString("#505c48").toLinearSpace();
  materials.sleeve.roughness = 0.91;
  materials.sleeve.backFaceCulling = false;
  materials.rubber.albedoColor = Color3.FromHexString("#363c31").toLinearSpace();
  materials.rubber.roughness = 0.87;
  materials.rubber.sideOrientation = Material.ClockWiseSideOrientation;
  materials.glove.metadata = { ...materials.glove.metadata, weightedHandsTuned: true };
}
