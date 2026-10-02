import "@babylonjs/core/Collisions/collisionCoordinator";
import "@babylonjs/core/Shaders/pbr.vertex";
import "@babylonjs/core/Shaders/pbr.fragment";
import "@babylonjs/core/Shaders/default.vertex";
import "@babylonjs/core/Shaders/default.fragment";
import "@babylonjs/core/Shaders/shadowMap.vertex";
import "@babylonjs/core/Shaders/shadowMap.fragment";
import "@babylonjs/core/Shaders/postprocess.vertex";
import "@babylonjs/core/Shaders/rgbdDecode.fragment";
import "@babylonjs/core/Shaders/depthBoxBlur.fragment";
import "@babylonjs/core/ShadersWGSL/pbr.vertex";
import "@babylonjs/core/ShadersWGSL/pbr.fragment";
import "@babylonjs/core/ShadersWGSL/default.vertex";
import "@babylonjs/core/ShadersWGSL/default.fragment";
import "@babylonjs/core/ShadersWGSL/shadowMap.vertex";
import "@babylonjs/core/ShadersWGSL/shadowMap.fragment";
import "@babylonjs/core/ShadersWGSL/postprocess.vertex";
import "@babylonjs/core/ShadersWGSL/rgbdDecode.fragment";
import "@babylonjs/core/ShadersWGSL/depthBoxBlur.fragment";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3, Vector4 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { ARENA_BOUNDS, ARENA_BOXES, BOT_SPAWNS } from "../../shared/game-data.mjs";
import type { WeaponId } from "../../shared/game-data.mjs";
import { buildIndustrialDistrict } from "./IndustrialDistrict";
import { createOperatorRig, type OperatorRig } from "../characters/OperatorRig";

export interface TargetActor {
  root: Mesh;
  alive: boolean;
  health: number;
  origin: Vector3;
  phase: number;
  rig?: OperatorRig;
}

const arenaActorContext = new WeakMap<Scene, { shadow: ShadowGenerator }>();
const targetMotion = new WeakMap<TargetActor, { position: Vector3; speed: number }>();

export function createArena(scene: Scene): TargetActor[] {
  configureAtmosphere(scene);
  addSky(scene);
  const shadow = configureLighting(scene);
  const placeholder = new PBRMaterial("arena-collision-placeholder", scene);
  arenaActorContext.set(scene, { shadow });

  const ground = MeshBuilder.CreateGround("ground", {
    width: ARENA_BOUNDS.maxX - ARENA_BOUNDS.minX,
    height: ARENA_BOUNDS.maxZ - ARENA_BOUNDS.minZ,
    subdivisions: 2,
  }, scene);
  ground.material = placeholder;
  ground.checkCollisions = true;
  ground.receiveShadows = true;

  for (const item of ARENA_BOXES) {
    const mesh = createCollisionBox(scene, item.name, [...item.dimensions], [...item.position], placeholder);
    mesh.receiveShadows = true;
    shadow.addShadowCaster(mesh);
  }

  buildIndustrialDistrict(scene, shadow);

  return BOT_SPAWNS.map((position, index) => target(
    scene,
    index,
    new Vector3(position.x, position.y, position.z),
    shadow,
  ));
}

export function createNetworkTargetActor(scene: Scene, index: number): TargetActor {
  const context = arenaActorContext.get(scene);
  if (!context) throw new Error("Arena must be created before network bots");
  const actor = target(scene, index, new Vector3(0, 1, 0), context.shadow);
  actor.root.setEnabled(false);
  return actor;
}

export function setTargetWeapon(actor: TargetActor, weaponId: WeaponId): void {
  actor.rig?.setWeapon(weaponId);
}

export function updateTargetVisual(actor: TargetActor, deltaSeconds: number): void {
  if (!actor.rig || !actor.alive) return;
  const motion = targetMotion.get(actor);
  if (!motion) return;
  const distance = Vector3.Distance(actor.root.position, motion.position);
  const speed = deltaSeconds > 0 && distance < 4 ? Math.min(4, distance / deltaSeconds) : 0;
  motion.speed += (speed - motion.speed) * Math.min(1, deltaSeconds * 9);
  motion.position.copyFrom(actor.root.position);
  actor.rig.update(deltaSeconds, motion.speed / 2.4);
}

export function targetMuzzlePosition(actor: TargetActor): Vector3 | undefined {
  if (!actor.rig) return undefined;
  actor.rig.muzzle.computeWorldMatrix(true);
  return actor.rig.muzzle.getAbsolutePosition().clone();
}

function addSky(scene: Scene): void {
  const sky = MeshBuilder.CreateSphere("daylight-skydome", { diameter: 500, segments: 32 }, scene);
  const material = new StandardMaterial("daylight-sky", scene);
  material.emissiveTexture = new Texture("/textures/industrial-sky.png", scene);
  material.diffuseColor = Color3.Black();
  material.emissiveColor = Color3.Black();
  material.disableLighting = true;
  material.disableDepthWrite = true;
  material.backFaceCulling = false;
  material.fogEnabled = false;
  sky.material = material;
  sky.isPickable = false;
  sky.checkCollisions = false;
}

function configureAtmosphere(scene: Scene): void {
  scene.clearColor = new Color4(0.43, 0.56, 0.67, 1);
  scene.ambientColor = new Color3(0.16, 0.18, 0.19);
  scene.gravity = new Vector3(0, -0.32, 0);
  scene.collisionsEnabled = true;
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogStart = 145;
  scene.fogEnd = 265;
  scene.fogColor = new Color3(0.47, 0.57, 0.64);
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.exposure = 1.12;
  scene.imageProcessingConfiguration.contrast = 1.16;
  scene.imageProcessingConfiguration.vignetteEnabled = true;
  scene.imageProcessingConfiguration.vignetteWeight = 0.12;
  scene.imageProcessingConfiguration.vignetteStretch = 0.2;
  scene.imageProcessingConfiguration.vignetteColor = new Color4(0.008, 0.01, 0.01, 1);
}

function configureLighting(scene: Scene): ShadowGenerator {
  const ambient = new HemisphericLight("warehouse-ambient", new Vector3(0.15, 1, 0.08), scene);
  ambient.intensity = 0.42;
  ambient.diffuse = new Color3(0.82, 0.88, 0.94);
  ambient.specular = new Color3(0.4, 0.44, 0.47);
  ambient.groundColor = new Color3(0.3, 0.31, 0.3);

  const bounce = new HemisphericLight("courtyard-sky-bounce", new Vector3(-0.7, 0.65, -0.35), scene);
  bounce.intensity = 0.055;
  bounce.diffuse = new Color3(0.68, 0.78, 0.9);
  bounce.groundColor = new Color3(0.35, 0.38, 0.4);
  bounce.specular = new Color3(0.08, 0.09, 0.1);

  const oppositeBounce = new HemisphericLight("opposite-wall-bounce", new Vector3(0.7, 0.65, 0.35), scene);
  oppositeBounce.intensity = 0.055;
  oppositeBounce.diffuse = new Color3(0.79, 0.84, 0.89);
  oppositeBounce.groundColor = new Color3(0.38, 0.38, 0.36);
  oppositeBounce.specular = new Color3(0.08, 0.08, 0.07);

  const sun = new DirectionalLight("service-door-daylight", new Vector3(0.5, -0.62, 0.62), scene);
  sun.position = new Vector3(46, 64, -42);
  sun.intensity = 2.65;
  sun.diffuse = new Color3(1, 0.94, 0.82);

  const shadow = new ShadowGenerator(2048, sun);
  shadow.usePercentageCloserFiltering = true;
  shadow.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  shadow.bias = 0.0008;
  shadow.normalBias = 0.025;
  return shadow;
}

function target(scene: Scene, index: number, position: Vector3, shadow: ShadowGenerator): TargetActor {
  const hitMaterial = new PBRMaterial(`target-hit-proxy-${index}`, scene);
  const root = MeshBuilder.CreateCapsule(`target-${index}`, { height: 1.9, radius: 0.38, tessellation: 10 }, scene);
  root.position.copyFrom(position);
  root.material = hitMaterial;
  root.visibility = 0;
  root.metadata = { targetIndex: index, hitZone: "body" };
  root.checkCollisions = false;
  const head = MeshBuilder.CreateSphere(`target-head-${index}`, { diameter: 0.54, segments: 12 }, scene);
  head.parent = root;
  head.position.y = 1.08;
  head.visibility = 0;
  head.material = hitMaterial;
  head.metadata = { targetIndex: index, hitZone: "head" };
  const rig = createOperatorRig(scene, root, `target-${index}`);
  rig.setTeam(false);
  for (const mesh of rig.meshes) shadow.addShadowCaster(mesh);
  const actor = { root, rig, alive: true, health: 100, origin: position.clone(), phase: index * 1.7 };
  targetMotion.set(actor, { position: position.clone(), speed: 0 });
  return actor;
}

function createCollisionBox(
  scene: Scene,
  name: string,
  dimensions: [number, number, number],
  position: [number, number, number],
  material: PBRMaterial,
): Mesh {
  const [w, h, d] = dimensions;
  const uv = (x: number, y: number) => new Vector4(0, 0, x / 3, y / 3);
  const mesh = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d,
    faceUV: [uv(w, h), uv(w, h), uv(d, h), uv(d, h), uv(w, d), uv(w, d)],
  }, scene);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.material = material;
  mesh.checkCollisions = true;
  return mesh;
}
