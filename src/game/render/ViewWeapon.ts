import type { Camera } from "@babylonjs/core/Cameras/camera";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

export class ViewWeapon {
  private readonly root: TransformNode;
  private readonly muzzle: ReturnType<typeof MeshBuilder.CreateSphere>;
  private readonly muzzleLight: PointLight;
  private kick = 0;
  private flashUntil = 0;

  constructor(scene: Scene, camera: Camera) {
    this.root = new TransformNode("view-weapon", scene);
    this.root.parent = camera;
    this.root.position = new Vector3(0.38, -0.31, 0.72);
    this.root.rotation = new Vector3(-0.03, -0.05, 0.015);

    const metal = new StandardMaterial("view-weapon-metal", scene);
    metal.diffuseColor = new Color3(0.075, 0.095, 0.085);
    metal.specularColor = new Color3(0.3, 0.33, 0.28);
    const accent = new StandardMaterial("view-weapon-accent", scene);
    accent.diffuseColor = Color3.FromHexString("#b88b31");
    accent.specularColor = new Color3(0.14, 0.11, 0.05);

    const body = MeshBuilder.CreateBox("br4-body", { width: 0.25, height: 0.18, depth: 0.72 }, scene);
    body.parent = this.root;
    body.material = metal;
    body.position.z = 0.18;
    const receiver = MeshBuilder.CreateBox("br4-receiver", { width: 0.18, height: 0.12, depth: 0.38 }, scene);
    receiver.parent = this.root;
    receiver.material = accent;
    receiver.position.set(0, 0.1, 0.22);
    const barrel = MeshBuilder.CreateCylinder("br4-barrel", { height: 0.66, diameter: 0.055 }, scene);
    barrel.parent = this.root;
    barrel.material = metal;
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.03, 0.82);
    const sight = MeshBuilder.CreateBox("br4-sight", { width: 0.08, height: 0.08, depth: 0.12 }, scene);
    sight.parent = this.root;
    sight.material = metal;
    sight.position.set(0, 0.18, 0.2);
    const grip = MeshBuilder.CreateBox("br4-grip", { width: 0.11, height: 0.3, depth: 0.15 }, scene);
    grip.parent = this.root;
    grip.material = metal;
    grip.position.set(0, -0.2, 0.05);
    grip.rotation.x = -0.22;

    const flashMaterial = new StandardMaterial("muzzle-flash-material", scene);
    flashMaterial.diffuseColor = Color3.FromHexString("#ffd467");
    flashMaterial.emissiveColor = Color3.FromHexString("#ff8a31");
    this.muzzle = MeshBuilder.CreateSphere("muzzle-flash", { diameter: 0.11, segments: 5 }, scene);
    this.muzzle.parent = this.root;
    this.muzzle.material = flashMaterial;
    this.muzzle.position.set(0, 0.03, 1.16);
    this.muzzle.setEnabled(false);
    this.muzzleLight = new PointLight("muzzle-light", new Vector3(0, 0.03, 1.12), scene);
    this.muzzleLight.parent = this.root;
    this.muzzleLight.diffuse = Color3.FromHexString("#ff9f43");
    this.muzzleLight.intensity = 0;
    this.muzzleLight.range = 4;
  }

  fire(now: number): void {
    this.kick = 1;
    this.flashUntil = now + 45;
    this.muzzle.setEnabled(true);
    this.muzzleLight.intensity = 2.4;
  }

  update(deltaSeconds: number, now: number, moving: boolean): void {
    this.kick = Math.max(0, this.kick - deltaSeconds * 9);
    const sway = moving ? Math.sin(now * 0.009) * 0.009 : 0;
    this.root.position.y = -0.31 + sway - this.kick * 0.025;
    this.root.position.z = 0.72 - this.kick * 0.08;
    this.root.rotation.x = -0.03 - this.kick * 0.06;
    if (now >= this.flashUntil) {
      this.muzzle.setEnabled(false);
      this.muzzleLight.intensity = 0;
    }
  }
}
