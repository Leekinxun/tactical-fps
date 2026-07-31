import { Ray } from "@babylonjs/core/Culling/ray";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { TargetActor } from "../world/createArena";
import { BotStateMachine, type BotState } from "./BotStateMachine";
import type { NavigationService } from "./navigation/NavigationService";
import { getWeaponConfig, type WeaponId } from "../combat/WeaponCatalog";

export interface BotControllerOptions {
  index: number;
  actor: TargetActor;
  scene: Scene;
  navigation: NavigationService;
  onFire: (damage: number, botIndex: number) => void;
}

export class BotController {
  readonly index: number;
  readonly actor: TargetActor;
  weaponId: WeaponId = "px9";
  private readonly scene: Scene;
  private readonly navigation: NavigationService;
  private readonly mind = new BotStateMachine();
  private readonly onFire: BotControllerOptions["onFire"];
  private readonly patrolPoints: Vector3[];
  private patrolIndex = 0;
  private heardPosition: Vector3 | null = null;
  private nextThinkAt = 0;
  private nextShotAt = 0;
  private facing = Vector3.Forward();
  private state: BotState = "patrol";
  private path: Vector3[] = [];
  private pathIndex = 0;
  private pathGoal: Vector3 | null = null;
  private nextPathAt = 0;
  private lastProgressPosition: Vector3;
  private stuckSeconds = 0;

  constructor(options: BotControllerOptions) {
    this.index = options.index;
    this.actor = options.actor;
    this.scene = options.scene;
    this.navigation = options.navigation;
    this.onFire = options.onFire;
    const origin = options.actor.origin;
    const lane = options.index % 2 === 0 ? 1 : -1;
    this.patrolPoints = [
      origin.clone(),
      origin.add(new Vector3(lane * 2.4, 0, 3.2)),
      origin.add(new Vector3(-lane * 1.6, 0, -2.4)),
    ];
    this.lastProgressPosition = origin.clone();
  }

  update(deltaSeconds: number, nowMs: number, playerPosition: Vector3): void {
    if (!this.actor.alive) {
      this.mind.kill();
      return;
    }

    if (nowMs >= this.nextThinkAt) {
      this.nextThinkAt = nowMs + 100;
      const visible = this.canSeePlayer(playerPosition);
      const decision = this.mind.update(nowMs, {
        visiblePosition: visible ? toKnown(playerPosition) : undefined,
        heardPosition: this.heardPosition ? toKnown(this.heardPosition) : undefined,
      });
      this.heardPosition = null;
      this.state = decision.state;
      this.tintForState(this.state);
      if (decision.canFire && nowMs >= this.nextShotAt) {
        const weapon = getWeaponConfig(this.weaponId);
        this.nextShotAt = nowMs + Math.max(260, (60_000 / weapon.roundsPerMinute) * 1.6) + this.index * 25;
        const distance = Vector3.Distance(this.actor.root.position, playerPosition);
        const hitChance = Math.max(0.18, 0.64 - distance * 0.018);
        if (seededChance(nowMs, this.index) < hitChance) this.onFire(Math.max(12, Math.round(weapon.damage * 0.55)), this.index);
      }
    }

    this.updateStuckState(deltaSeconds, nowMs);
    if (this.state === "patrol") this.navigateToward(this.patrolPoints[this.patrolIndex], deltaSeconds, nowMs, 1.25);
    else if ((this.state === "investigate" || this.state === "search") && this.mind.lastKnownPosition) {
      this.navigateToward(fromKnown(this.mind.lastKnownPosition), deltaSeconds, nowMs, 1.55);
    } else if (this.state === "engage") {
      const direction = playerPosition.subtract(this.actor.root.position);
      direction.y = 0;
      if (direction.lengthSquared() > 0.01) this.facing = direction.normalize();
    }
  }

  hear(position: Vector3): void {
    if (this.actor.alive && Vector3.DistanceSquared(this.actor.root.position, position) <= 26 * 26) this.heardPosition = position.clone();
  }

  setWeapon(weaponId: WeaponId): void {
    this.weaponId = weaponId;
  }

  reset(): void {
    this.mind.reset();
    this.state = "patrol";
    this.patrolIndex = 0;
    this.nextThinkAt = 0;
    this.nextShotAt = 0;
    this.heardPosition = null;
    this.facing = Vector3.Forward();
    this.path = [];
    this.pathIndex = 0;
    this.pathGoal = null;
    this.nextPathAt = 0;
    this.lastProgressPosition.copyFrom(this.actor.origin);
    this.stuckSeconds = 0;
    this.tintForState("patrol");
  }

  private canSeePlayer(playerPosition: Vector3): boolean {
    const eye = this.actor.root.position.add(new Vector3(0, 1.1, 0));
    const direction = playerPosition.subtract(eye);
    const distance = direction.length();
    if (distance > 32 || distance < 0.01) return false;
    direction.normalize();
    if (Vector3.Dot(this.facing, new Vector3(direction.x, 0, direction.z).normalize()) < -0.25) return false;
    const blocker = this.scene.pickWithRay(new Ray(eye, direction, distance), (mesh) => mesh.checkCollisions);
    return !blocker?.hit || blocker.distance >= distance - 0.5;
  }

  private navigateToward(target: Vector3, deltaSeconds: number, nowMs: number, speed: number): void {
    if (nowMs >= this.nextPathAt || !this.pathGoal || Vector3.DistanceSquared(this.pathGoal, target) > 2.25) {
      this.path = this.navigation.findPath(this.actor.root.position, target);
      this.pathIndex = 0;
      this.pathGoal = target.clone();
      this.nextPathAt = nowMs + 650 + this.index * 80;
    }
    while (this.pathIndex < this.path.length - 1 && Vector3.DistanceSquared(this.actor.root.position, this.path[this.pathIndex]) < 0.45) this.pathIndex += 1;
    const waypoint = this.path[this.pathIndex] ?? target;
    const direction = waypoint.subtract(this.actor.root.position);
    direction.y = 0;
    const distance = direction.length();
    if (distance < 0.35) {
      if (this.state === "patrol") this.patrolIndex = (this.patrolIndex + 1) % this.patrolPoints.length;
      return;
    }
    direction.normalize();
    this.facing = direction;
    this.actor.root.position.addInPlace(direction.scale(Math.min(distance, speed * deltaSeconds)));
  }

  private updateStuckState(deltaSeconds: number, nowMs: number): void {
    const moved = Vector3.DistanceSquared(this.actor.root.position, this.lastProgressPosition);
    if (moved > 0.02) {
      this.lastProgressPosition.copyFrom(this.actor.root.position);
      this.stuckSeconds = 0;
      return;
    }
    if (this.state !== "patrol" && this.state !== "investigate" && this.state !== "search") return;
    this.stuckSeconds += deltaSeconds;
    if (this.stuckSeconds < 2) return;
    const recovery = this.navigation.recoveryPoint(this.actor.root.position, this.index);
    this.path = this.navigation.findPath(this.actor.root.position, recovery);
    this.pathIndex = 0;
    this.pathGoal = recovery;
    this.nextPathAt = nowMs + 900;
    this.stuckSeconds = 0;
  }

  private tintForState(state: BotState): void {
    const material = this.actor.root.material;
    if (!(material instanceof StandardMaterial)) return;
    material.emissiveColor = state === "engage" ? Color3.FromHexString("#5b160e") : state === "alert" ? Color3.FromHexString("#44330b") : Color3.Black();
  }
}

function toKnown(position: Vector3) {
  return { x: position.x, y: position.y, z: position.z };
}

function fromKnown(position: { x: number; y: number; z: number }): Vector3 {
  return new Vector3(position.x, position.y, position.z);
}

function seededChance(nowMs: number, index: number): number {
  const value = Math.sin(Math.floor(nowMs / 50) * 12.9898 + index * 78.233) * 43_758.5453;
  return value - Math.floor(value);
}
