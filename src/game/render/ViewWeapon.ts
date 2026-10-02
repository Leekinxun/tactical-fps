import type { Camera } from "@babylonjs/core/Cameras/camera";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { getWeaponConfig, type WeaponId } from "../combat/WeaponCatalog";
import { VIEWMODEL_RENDER_GROUP, markViewLight } from "./viewmodel/primitives";
import { WeaponViewModel } from "./viewmodel/WeaponViewModel";

export class ViewWeapon {
  private readonly scene: Scene;
  private readonly camera: Camera;
  private readonly viewFill: PointLight;
  private model: WeaponViewModel | null = null;
  private currentWeaponId: WeaponId | null = null;
  private kick = 0;
  private switchPose = 1;
  private reloading = false;
  private reloadPose = 0;
  private reloadClock = 0;
  private reloadMs = 1450;
  private flashUntil = 0;
  private smokeUntil = 0;

  constructor(scene: Scene, camera: Camera) {
    this.scene = scene;
    this.camera = camera;
    scene.setRenderingAutoClearDepthStencil(VIEWMODEL_RENDER_GROUP, true, true, true);

    this.viewFill = markViewLight(new PointLight("viewmodel-fill-light", new Vector3(0.18, 0.2, 0.5), scene));
    this.viewFill.parent = camera;
    this.viewFill.diffuse = Color3.FromHexString("#c7d2cf").toLinearSpace();
    this.viewFill.specular = Color3.FromHexString("#fff2dd").toLinearSpace();
    this.viewFill.intensity = 1.2;
    this.viewFill.range = 2.4;

    this.setWeapon("px9");
    this.switchPose = 1;
  }

  setWeapon(id: WeaponId): void {
    if (this.currentWeaponId === id) return;
    this.currentWeaponId = id;
    this.reloadMs = getWeaponConfig(id).reloadMs;
    this.model?.dispose();
    this.model = new WeaponViewModel(this.scene, id);
    this.model.root.parent = this.camera;
    this.viewFill.includedOnlyMeshes = this.model.getAllMeshes();
    this.switchPose = 0;
    this.reloadPose = 0;
    this.reloadClock = 0;
    this.reloading = false;
    this.flashUntil = 0;
    this.smokeUntil = 0;
  }

  fire(now: number): void {
    this.kick = 1;
    this.flashUntil = now + 82;
    this.smokeUntil = now + 270;
    this.model?.setFlash(true, true, 1);
  }

  setReloading(reloading: boolean): void {
    if (this.reloading === reloading) return;
    this.reloading = reloading;
    if (reloading) this.reloadClock = 0;
  }

  update(deltaSeconds: number, now: number, moving: boolean): void {
    const model = this.model;
    if (!model) return;

    this.kick = Math.max(0, this.kick - deltaSeconds * 8.8);
    this.switchPose = Math.min(1, this.switchPose + deltaSeconds * 5.5);
    if (this.reloading) this.reloadPose = 1;
    else this.reloadPose += (0 - this.reloadPose) * Math.min(1, deltaSeconds * 7.5);
    if (this.reloading) this.reloadClock = Math.min(this.reloadMs, this.reloadClock + deltaSeconds * 1000);
    else this.reloadClock = 0;
    const reloadPhase = this.reloadMs > 0 ? Math.min(1, this.reloadClock / this.reloadMs) : 0;

    if (now >= this.flashUntil) {
      model.setFlash(false, now < this.smokeUntil, 0);
    } else {
      model.setFlash(true, true, Math.max(0, (this.flashUntil - now) / 82));
    }

    model.update({
      kick: this.kick,
      reloadPose: this.reloadPose,
      reloadPhase,
      switchPose: this.switchPose,
      moving,
      now,
    });
  }

  dispose(): void {
    this.model?.dispose();
    this.model = null;
    this.viewFill.dispose();
  }
}
