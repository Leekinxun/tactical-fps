import { Ray } from "@babylonjs/core/Culling/ray";
import type { Scene } from "@babylonjs/core/scene";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TEAM_SPAWNS } from "../../shared/game-data.mjs";

export interface PlayerMotionSnapshot {
  crouching: boolean;
  sprinting: boolean;
  moving: boolean;
  label: string;
}

export class PlayerController {
  readonly camera: UniversalCamera;
  private readonly keys = new Set<string>();
  private verticalVelocity = 0;
  private grounded = false;
  private enabled = false;

  constructor(scene: Scene, canvas: HTMLCanvasElement, sensitivity = 0.0018) {
    const spawn = TEAM_SPAWNS.alpha[0];
    this.camera = new UniversalCamera("player-camera", new Vector3(spawn.x, spawn.y, spawn.z), scene);
    this.camera.minZ = 0.05;
    this.camera.fov = 1.12;
    this.camera.inertia = 0.08;
    this.camera.angularSensibility = 1 / sensitivity;
    this.camera.checkCollisions = true;
    this.camera.applyGravity = false;
    this.camera.ellipsoid = new Vector3(0.42, 0.86, 0.42);
    this.camera.ellipsoidOffset = new Vector3(0, -0.86, 0);
    this.camera.keysUp = [];
    this.camera.keysDown = [];
    this.camera.keysLeft = [];
    this.camera.keysRight = [];
    this.camera.attachControl(canvas, true);

    window.addEventListener("keydown", (event) => {
      this.keys.add(event.code);
      if (event.code === "Space") event.preventDefault();
    });
    window.addEventListener("keyup", (event) => this.keys.delete(event.code));
    window.addEventListener("blur", () => this.keys.clear());
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.keys.clear();
  }

  update(deltaSeconds: number, scene: Scene): PlayerMotionSnapshot {
    const crouching = this.keys.has("KeyC") || this.keys.has("ControlLeft");
    const sprinting = this.keys.has("ShiftLeft") && !crouching;
    const targetHeight = crouching ? 1.16 : 1.72;
    const currentFootHeight = this.camera.position.y - this.camera.ellipsoid.y * 2;
    this.camera.ellipsoid.y += (targetHeight / 2 - this.camera.ellipsoid.y) * Math.min(1, deltaSeconds * 12);
    this.camera.ellipsoidOffset.y = -this.camera.ellipsoid.y;
    this.camera.position.y = currentFootHeight + this.camera.ellipsoid.y * 2;

    if (!this.enabled) {
      return { crouching, sprinting, moving: false, label: "已暂停" };
    }

    const forward = this.camera.getDirection(Vector3.Forward());
    forward.y = 0;
    forward.normalize();
    const right = this.camera.getDirection(Vector3.Right());
    right.y = 0;
    right.normalize();
    const movement = Vector3.Zero();
    if (this.keys.has("KeyW")) movement.addInPlace(forward);
    if (this.keys.has("KeyS")) movement.subtractInPlace(forward);
    if (this.keys.has("KeyD")) movement.addInPlace(right);
    if (this.keys.has("KeyA")) movement.subtractInPlace(right);
    const moving = movement.lengthSquared() > 0;
    const speed = crouching ? 2.25 : sprinting ? 6.1 : 4.2;
    if (moving) movement.normalize().scaleInPlace(speed * deltaSeconds);

    const groundDistance = this.camera.ellipsoid.y * 2 + 0.16;
    const downRay = new Ray(this.camera.position, Vector3.Down(), groundDistance);
    const groundHit = scene.pickWithRay(downRay, (mesh) => mesh.checkCollisions);
    this.grounded = Boolean(groundHit?.hit && groundHit.distance <= groundDistance);
    if (this.grounded && this.verticalVelocity < 0) this.verticalVelocity = 0;
    if (this.grounded && this.keys.has("Space") && !crouching) {
      this.verticalVelocity = 5.3;
      this.grounded = false;
      this.keys.delete("Space");
    }
    this.verticalVelocity -= 15.5 * deltaSeconds;
    movement.y = this.verticalVelocity * deltaSeconds;
    this.camera.cameraDirection.addInPlace(movement);

    return {
      crouching,
      sprinting,
      moving,
      label: crouching ? "低姿移动" : sprinting ? "快速推进" : moving ? "标准移动" : "保持位置",
    };
  }
}
