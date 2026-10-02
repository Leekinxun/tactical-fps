import { Ray } from "@babylonjs/core/Culling/ray";
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
  onShot?: (botIndex: number, weaponId: WeaponId) => void;
}

export class BotController {
  readonly index: number;
  readonly actor: TargetActor;
  weaponId: WeaponId = "px9";
  private readonly scene: Scene;
  private readonly navigation: NavigationService;
  private readonly mind = new BotStateMachine();
  private readonly onFire: BotControllerOptions["onFire"];
  private readonly onShot: NonNullable<BotControllerOptions["onShot"]>;
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
  private objectiveGoal: Vector3 | null = null;
  private objectiveMode: "guard" | "advance" | "retake" | "hold" | null = null;
  private lastVisibleAt = -1_000;
  private nextCombatMoveAt = 0;
  private combatMove = Vector3.Zero();

  constructor(options: BotControllerOptions) {
    this.index = options.index;
    this.actor = options.actor;
    this.scene = options.scene;
    this.navigation = options.navigation;
    this.onFire = options.onFire;
    this.onShot = options.onShot ?? (() => undefined);
    const origin = options.actor.origin;
    const lane = options.index % 2 === 0 ? 1 : -1;
    this.patrolPoints = [
      origin.clone(),
      origin.add(new Vector3(lane * 2.4, 0, 3.2)),
      origin.add(new Vector3(-lane * 1.6, 0, -2.4)),
    ];
    this.lastProgressPosition = origin.clone();
  }

  update(deltaSeconds: number, nowMs: number, playerPosition: Vector3, playerAlive = true): void {
    if (!this.actor.alive) {
      this.mind.kill();
      return;
    }

    if (nowMs >= this.nextThinkAt) {
      this.nextThinkAt = nowMs + 100;
      const visible = playerAlive && this.canSeePlayer(playerPosition);
      if (visible) this.lastVisibleAt = nowMs;
      const decision = this.mind.update(nowMs, {
        visiblePosition: visible ? toKnown(playerPosition) : undefined,
        heardPosition: this.heardPosition ? toKnown(this.heardPosition) : undefined,
      });
      this.heardPosition = null;
      this.state = decision.state;
      if (decision.canFire && nowMs >= this.nextShotAt) {
        const weapon = getWeaponConfig(this.weaponId);
        const cadence = Math.max(150, 60_000 / weapon.roundsPerMinute);
        const burstSpacing = weapon.weaponClass === "sniper" || weapon.weaponClass === "shotgun" ? 1.15 : weapon.weaponClass === "pistol" ? 1.35 : 0.82;
        this.nextShotAt = nowMs + cadence * burstSpacing + this.index * 20;
        const distance = Vector3.Distance(this.actor.root.position, playerPosition);
        const hitChance = this.hitChance(distance, nowMs);
        this.onShot(this.index, this.weaponId);
        if (seededChance(nowMs, this.index) < hitChance) this.onFire(Math.max(10, Math.round(weapon.damage * 0.5)), this.index);
      }
    }

    this.updateStuckState(deltaSeconds, nowMs);
    if (this.state === "engage") {
      this.updateCombatMovement(playerPosition, deltaSeconds, nowMs);
    } else if (this.objectiveGoal && (this.objectiveMode === "retake" || this.objectiveMode === "advance" || this.state === "patrol")) {
      this.navigateToward(this.objectiveGoal, deltaSeconds, nowMs, this.objectiveMode === "retake" ? 3.2 : 2.8);
    } else if (this.state === "patrol") this.navigateToward(this.patrolPoints[this.patrolIndex], deltaSeconds, nowMs, 1.8);
    else if ((this.state === "investigate" || this.state === "search") && this.mind.lastKnownPosition) {
      this.navigateToward(fromKnown(this.mind.lastKnownPosition), deltaSeconds, nowMs, 2.3);
    }
    if (this.actor.root.rotation) {
      const yaw = Math.atan2(this.facing.x, this.facing.z);
      const difference = Math.atan2(Math.sin(yaw - this.actor.root.rotation.y), Math.cos(yaw - this.actor.root.rotation.y));
      this.actor.root.rotation.y += difference * Math.min(1, deltaSeconds * 8);
    }
  }

  setObjective(goal: Vector3 | null, mode: "guard" | "advance" | "retake" | "hold" | null): void {
    this.objectiveGoal = goal?.clone() ?? null;
    this.objectiveMode = mode;
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
    this.objectiveGoal = null;
    this.objectiveMode = null;
    this.lastVisibleAt = -1_000;
    this.nextCombatMoveAt = 0;
    this.combatMove = Vector3.Zero();
  }

  private canSeePlayer(playerPosition: Vector3): boolean {
    const eye = this.actor.root.position.add(new Vector3(0, 1.05, 0));
    const direction = playerPosition.subtract(eye);
    const distance = direction.length();
    if (distance > 42 || distance < 0.01) return false;
    direction.normalize();
    const planar = new Vector3(direction.x, 0, direction.z);
    if (planar.lengthSquared() > 0.01) {
      const awarenessDot = distance < 9 || this.state === "alert" || this.state === "engage" ? -0.65 : -0.12;
      if (Vector3.Dot(this.facing, planar.normalize()) < awarenessDot) return false;
    }
    const blocker = this.scene.pickWithRay?.(new Ray(eye, direction, distance), (mesh) => mesh.checkCollisions);
    return !blocker?.hit || blocker.distance >= distance - 0.5;
  }

  private hitChance(distance: number, nowMs: number): number {
    const weapon = getWeaponConfig(this.weaponId);
    const closeBonus = distance < 9 ? 0.2 : 0;
    const freshTargetBonus = nowMs - this.lastVisibleAt <= 160 ? 0.08 : 0;
    const classAccuracy = weapon.weaponClass === "sniper" ? 0.78
      : weapon.weaponClass === "rifle" ? 0.62
        : weapon.weaponClass === "smg" ? 0.54
          : weapon.weaponClass === "shotgun" ? distance < 11 ? 0.68 : 0.24
            : 0.5;
    return clamp(classAccuracy + closeBonus + freshTargetBonus - distance * 0.012, 0.22, 0.86);
  }

  private updateCombatMovement(playerPosition: Vector3, deltaSeconds: number, nowMs: number): void {
    const toPlayer = playerPosition.subtract(this.actor.root.position);
    toPlayer.y = 0;
    const distance = toPlayer.length();
    if (distance < 0.01) return;
    const forward = toPlayer.normalize();
    this.facing = forward;

    if (nowMs >= this.nextCombatMoveAt) {
      const side = new Vector3(-forward.z, 0, forward.x);
      const sideSign = seededChance(nowMs + 137, this.index) > 0.5 ? 1 : -1;
      const retreat = distance < 5.5 ? -0.55 : distance > 18 && this.objectiveMode !== "guard" && this.objectiveMode !== "hold" ? 0.35 : 0;
      this.combatMove = side.scale(sideSign).add(forward.scale(retreat)).normalize();
      this.nextCombatMoveAt = nowMs + 520 + seededChance(nowMs + 311, this.index) * 520;
    }

    const speed = this.objectiveMode === "hold" || this.objectiveMode === "guard" ? 0.75 : 1.15;
    const step = Math.min(speed * deltaSeconds, 0.09);
    if (this.combatMove.lengthSquared() > 0.01 && this.canStep(this.combatMove, step)) this.actor.root.position.addInPlace(this.combatMove.scale(step));
  }

  private navigateToward(target: Vector3, deltaSeconds: number, nowMs: number, speed: number): void {
    if (!this.pathGoal || Vector3.DistanceSquared(this.pathGoal, target) > 2.25 || !this.path.length || nowMs >= this.nextPathAt && this.stuckSeconds >= 1) {
      this.path = this.navigation.findPath(this.actor.root.position, target);
      if (!this.path.length || planarDistanceSquared(this.path[this.path.length - 1], target) > 0.3) this.path.push(target.clone());
      this.pathIndex = 0;
      this.pathGoal = target.clone();
      this.nextPathAt = nowMs + 650 + this.index * 80;
    }
    while (this.pathIndex < this.path.length - 1 && planarDistanceSquared(this.actor.root.position, this.path[this.pathIndex]) < 0.45) this.pathIndex += 1;
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
    const step = Math.min(distance, speed * deltaSeconds);
    if (this.canStep(direction, step)) this.actor.root.position.addInPlace(direction.scale(step));
  }

  private canStep(direction: Vector3, distance: number): boolean {
    const side = new Vector3(-direction.z, 0, direction.x);
    for (const lateral of [-0.28, 0, 0.28]) {
      for (const height of [-0.3, 0.35]) {
        const origin = this.actor.root.position.add(side.scale(lateral)).add(new Vector3(0, height, 0));
        const blocker = this.scene.pickWithRay?.(new Ray(origin, direction, distance + 0.12), (mesh) => mesh.checkCollisions);
        if (blocker?.hit && blocker.distance <= distance + 0.12) return false;
      }
    }
    return true;
  }

  private updateStuckState(deltaSeconds: number, nowMs: number): void {
    if (this.pathGoal && planarDistanceSquared(this.actor.root.position, this.pathGoal) < 0.16) {
      this.lastProgressPosition.copyFrom(this.actor.root.position);
      this.stuckSeconds = 0;
      return;
    }
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

function planarDistanceSquared(a: Vector3, b: Vector3): number {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
