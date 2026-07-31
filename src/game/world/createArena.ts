import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ARENA_BOXES, BOT_SPAWNS } from "../../shared/game-data.mjs";

export interface TargetActor {
  root: Mesh;
  alive: boolean;
  health: number;
  origin: Vector3;
  phase: number;
}

export function createArena(scene: Scene): TargetActor[] {
  scene.clearColor = new Color4(0.022, 0.04, 0.038, 1);
  scene.ambientColor = new Color3(0.12, 0.15, 0.14);
  scene.gravity = new Vector3(0, -0.32, 0);
  scene.collisionsEnabled = true;

  const sky = new HemisphericLight("cold-fill", new Vector3(0.2, 1, 0.1), scene);
  sky.intensity = 0.48;
  sky.diffuse = new Color3(0.48, 0.58, 0.53);
  const sun = new DirectionalLight("hard-key", new Vector3(-0.55, -1, 0.35), scene);
  sun.intensity = 1.3;
  sun.diffuse = new Color3(0.96, 0.78, 0.55);

  const concrete = material(scene, "concrete", "#53605a");
  const dark = material(scene, "dark", "#182421");
  const rust = material(scene, "rust", "#9f5937");
  const warning = material(scene, "warning", "#d0a236");

  const ground = MeshBuilder.CreateGround("ground", { width: 42, height: 52 }, scene);
  ground.material = concrete;
  ground.checkCollisions = true;
  ground.receiveShadows = true;

  const arenaMaterials = { dark, rust, warning };
  for (const item of ARENA_BOXES) box(scene, item.name, [...item.dimensions], [...item.position], arenaMaterials[item.material]);

  return BOT_SPAWNS.map((position, index) => target(scene, index, new Vector3(position.x, position.y, position.z), index % 2 === 0 ? "#ed7048" : "#d2a23d"));
}

function target(scene: Scene, index: number, position: Vector3, color: string): TargetActor {
  const root = MeshBuilder.CreateCapsule(`target-${index}`, { height: 2, radius: 0.42 }, scene);
  root.position.copyFrom(position);
  root.material = material(scene, `target-material-${index}`, color);
  root.metadata = { targetIndex: index, hitZone: "body" };
  root.checkCollisions = false;
  const head = MeshBuilder.CreateSphere(`target-head-${index}`, { diameter: 0.58 }, scene);
  head.parent = root;
  head.position.y = 1.12;
  head.material = root.material;
  head.metadata = { targetIndex: index, hitZone: "head" };
  return { root, alive: true, health: 100, origin: position.clone(), phase: index * 1.7 };
}

function box(scene: Scene, name: string, dimensions: [number, number, number], position: [number, number, number], mat: StandardMaterial): Mesh {
  const mesh = MeshBuilder.CreateBox(name, { width: dimensions[0], height: dimensions[1], depth: dimensions[2] }, scene);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.material = mat;
  mesh.checkCollisions = true;
  return mesh;
}

function material(scene: Scene, name: string, hex: string): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = Color3.FromHexString(hex);
  mat.specularColor = new Color3(0.04, 0.05, 0.04);
  return mat;
}
