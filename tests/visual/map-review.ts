import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { createRenderer } from "../../src/game/render/RendererFactory";
import { createDaylightEnvironment } from "../../src/game/render/DaylightEnvironment";
import { createArena } from "../../src/game/world/createArena";
import { preloadWeaponAssets } from "../../src/game/render/viewmodel/WeaponAssets";
import { preloadOperatorAssets } from "../../src/game/characters/OperatorAssets";
import { ARENA_BOUNDS, BOMB_SITES, TEAM_SPAWNS } from "../../src/shared/game-data.mjs";
const canvas = document.querySelector<HTMLCanvasElement>("#map")!;
const { engine, backend } = await createRenderer(canvas);
await Promise.all([preloadWeaponAssets(), preloadOperatorAssets()]);
const scene = new Scene(engine);
scene.environmentTexture = createDaylightEnvironment(scene);
scene.environmentIntensity = 0.42;
createArena(scene);
const camera = new FreeCamera("map-review", new Vector3(0, 1.72, -61), scene);
camera.fov = 1.12;
camera.minZ = 0.04;
camera.maxZ = 550;
scene.activeCamera = camera;
const a = BOMB_SITES.A, b = BOMB_SITES.B;
const views: Record<string, { at: number[]; look: number[] }> = {
  t: { at: [TEAM_SPAWNS.alpha[0].x, 1.72, TEAM_SPAWNS.alpha[0].z], look: [-24, 2, -33] },
  "a-long": { at: [-48, 1.72, -26], look: [-40, 1.9, 22] },
  a: { at: [a.x + 9, 1.72, a.z - 5], look: [a.x - 5, 2.4, a.z + 4] },
  mid: { at: [-10, 1.72, -13], look: [2, 2.2, 20] },
  b: { at: [b.x + 9, 1.72, b.z - 14], look: [b.x - 3, 2.2, b.z + 9] },
  ct: { at: [TEAM_SPAWNS.bravo[0].x, 1.72, TEAM_SPAWNS.bravo[0].z], look: [-22, 2, 38] },
  overview: { at: [0, 90, -6], look: [0, 0, 0] },
};
function setView(): void {
  const id = document.querySelector<HTMLSelectElement>("#view")!.value;
  const view = views[id];
  const overhead = id === "overview";
  scene.fogEnabled = !overhead;
  camera.mode = overhead ? Camera.ORTHOGRAPHIC_CAMERA : Camera.PERSPECTIVE_CAMERA;
  if (overhead) {
    const ratio = engine.getRenderWidth() / engine.getRenderHeight();
    camera.orthoTop = ARENA_BOUNDS.groundDepth * 0.55;
    camera.orthoBottom = -camera.orthoTop;
    camera.orthoRight = camera.orthoTop * ratio;
    camera.orthoLeft = -camera.orthoRight;
  }
  camera.position.copyFrom(Vector3.FromArray(view.at));
  camera.setTarget(Vector3.FromArray(view.look));
  document.querySelector("#status")!.textContent = `${backend} · ${ARENA_BOUNDS.groundWidth} × ${ARENA_BOUNDS.groundDepth} m`;
}
document.querySelector("#view")!.addEventListener("change", setView);
setView();
await scene.whenReadyAsync();
engine.runRenderLoop(() => scene.render());
window.addEventListener("resize", () => { engine.resize(); setView(); });
