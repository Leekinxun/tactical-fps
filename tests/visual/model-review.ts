import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { preloadTacticalHands } from "../../src/game/render/viewmodel/TacticalHands";
import { preloadWeaponAssets } from "../../src/game/render/viewmodel/WeaponAssets";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { createDaylightEnvironment } from "../../src/game/render/DaylightEnvironment";
import { createRenderer } from "../../src/game/render/RendererFactory";
import { createArena } from "../../src/game/world/createArena";
import { ViewWeapon } from "../../src/game/render/ViewWeapon";
import { createOperatorRig } from "../../src/game/characters/OperatorRig";
import { preloadOperatorAssets } from "../../src/game/characters/OperatorAssets";
import { getWeaponConfig, type WeaponId } from "../../src/game/combat/WeaponCatalog";

const canvas = document.querySelector<HTMLCanvasElement>("#preview")!;
const { engine, backend } = await createRenderer(canvas);
await Promise.all([preloadWeaponAssets(), preloadOperatorAssets(), preloadTacticalHands()]);
const scene = new Scene(engine);
scene.environmentTexture = createDaylightEnvironment(scene);
scene.environmentIntensity = 0.42;
createArena(scene);
const camera = new FreeCamera("review-camera", new Vector3(-8, 1.72, -61), scene);
camera.minZ = 0.04;
camera.fov = 1.12;
scene.activeCamera = camera;
let view: ViewWeapon | null = null;
const parent = new TransformNode("review-actor", scene);
parent.position.set(0, 1, -56);
parent.rotation.y = Math.PI;
let rig = createOperatorRig(scene, parent, "review-operator");
const shadow = scene.getLightByName("service-door-daylight")?.getShadowGenerator() as ShadowGenerator | null;
for (const mesh of rig.meshes) shadow?.addShadowCaster(mesh);
rig.setTeam(false);
const weaponSelect = document.querySelector<HTMLSelectElement>("#weapon")!;
const subject = document.querySelector<HTMLSelectElement>("#subject")!;
let frozen = true;
let moving = false;
let walkingElapsed = 0;
let crouching = false;
let aimPitch = 0;
let timestamp = performance.now();
let poseRevision = 0;
async function pose(action: "idle" | "shot" | "reload" | "walk", phase = 0) {
  const revision = ++poseRevision;
  document.querySelector("#status")!.textContent = "正在准备材质…";
  const weaponId = weaponSelect.value as WeaponId;
  crouching = false;
  view?.dispose();
  view = null;
  const operator = subject.value === "operator";
  parent.setEnabled(operator);
  parent.position.set(0, 1, -56);
  const angle = document.querySelector<HTMLSelectElement>("#angle")!.value;
  parent.rotation.y = angle === "quarter" ? Math.PI - 0.65 : angle === "back" ? 0 : Math.PI;
  for (const mesh of rig.meshes) shadow?.removeShadowCaster(mesh);
  rig.dispose();
  rig = createOperatorRig(scene, parent, "review-operator");
  rig.setTeam(false);
  for (const mesh of rig.meshes) shadow?.addShadowCaster(mesh);

  camera.position.set(operator ? 0 : -8, operator ? 1.58 : 1.72, operator ? -60 : -61);
  camera.rotation.set(operator ? -0.09 : 0, 0, 0);
  rig.setWeapon(weaponId);
  frozen = action !== "walk";
  walkingElapsed = 0;
  parent.position.x = 0;
  moving = action === "walk";
  timestamp = performance.now();
  if (!operator) {
    view = new ViewWeapon(scene, camera);
    view.setWeapon(weaponId);
    view.update(0.5, timestamp, false);
    if (action === "shot") { view.fire(timestamp); timestamp += 16; view.update(0.016, timestamp, false); }
    if (action === "reload") { view.setReloading(true); view.update(getWeaponConfig(weaponId).reloadMs * phase / 1000, timestamp, false); }
  } else rig.update(0, 0, aimPitch, action === "shot");
  await scene.whenReadyAsync();
  if (revision !== poseRevision) return;
  document.querySelector("#status")!.textContent = `${backend} · ${weaponId} · ${action}${action === "reload" ? ` ${Math.round(phase * 100)}%` : ""}`;
}
document.querySelector("#angle")!.addEventListener("change", () => pose("idle"));
weaponSelect.addEventListener("change", () => pose("idle"));
subject.addEventListener("change", () => pose("idle"));
document.querySelector("#idle")!.addEventListener("click", () => pose("idle"));
document.querySelector("#shot")!.addEventListener("click", () => pose("shot"));
document.querySelector("#crouch")!.addEventListener("click", () => { crouching = !crouching; frozen = false; moving = false; });
document.querySelector("#walk")!.addEventListener("click", () => pose("walk"));
document.querySelector("#stop")!.addEventListener("click", () => { moving = false; frozen = false; });
document.querySelector<HTMLInputElement>("#pitch")!.addEventListener("input", (event) => {
  aimPitch = Number((event.target as HTMLInputElement).value) / 100;
  rig.update(0, moving ? 0.8 : 0, aimPitch, false, crouching);
});
document.querySelector<HTMLInputElement>("#reload")!.addEventListener("input", (event) => pose("reload", Number((event.target as HTMLInputElement).value) / 100));
await pose("idle");
engine.runRenderLoop(() => {
  if (!frozen) {
    const now = performance.now();
    const dt = Math.min((now - timestamp) / 1000, 0.05);
    timestamp = now;
    view?.update(dt, now, moving);
    walkingElapsed += dt;
    if (moving && subject.value === "operator") {
      parent.position.x = Math.sin(walkingElapsed * 1.2) * 1.4;
      parent.position.z = -56 + Math.sin(walkingElapsed * 0.6) * 0.6;
    }
    rig.update(dt, moving ? 0.8 : 0, aimPitch, false, crouching);
  }
  scene.render();
});
window.addEventListener("resize", () => engine.resize());
