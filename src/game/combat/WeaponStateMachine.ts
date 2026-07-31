import type { WeaponConfig } from "./WeaponCatalog";

export interface ShotResult {
  fired: boolean;
  reason?: "cooldown" | "empty" | "reloading";
  magazine: number;
  spreadX: number;
  spreadY: number;
}

export class WeaponStateMachine {
  readonly config: WeaponConfig;
  magazine: number;
  reserve: number;
  private lastShotAt = Number.NEGATIVE_INFINITY;
  private reloadCompletesAt: number | null = null;
  private seed: number;

  constructor(config: WeaponConfig, seed = 0x6d2b79f5) {
    this.config = config;
    this.magazine = config.magazineSize;
    this.reserve = config.reserveAmmo;
    this.seed = seed >>> 0;
  }

  get isReloading(): boolean {
    return this.reloadCompletesAt !== null;
  }

  tryFire(nowMs: number, moving = false, crouching = false): ShotResult {
    if (this.isReloading) return this.failed("reloading");
    const interval = 60_000 / this.config.roundsPerMinute;
    if (nowMs - this.lastShotAt + Number.EPSILON < interval) return this.failed("cooldown");
    if (this.magazine <= 0) return this.failed("empty");

    this.lastShotAt = nowMs;
    this.magazine -= 1;
    const spread = Math.max(0, this.config.baseSpread + (moving ? this.config.movementSpread : 0) - (crouching ? 0.002 : 0));
    return {
      fired: true,
      magazine: this.magazine,
      spreadX: (this.random() * 2 - 1) * spread,
      spreadY: (this.random() * 2 - 1) * spread,
    };
  }

  beginReload(nowMs: number): boolean {
    if (this.isReloading || this.magazine >= this.config.magazineSize || this.reserve <= 0) return false;
    this.reloadCompletesAt = nowMs + this.config.reloadMs;
    return true;
  }

  update(nowMs: number): boolean {
    if (this.reloadCompletesAt === null || nowMs < this.reloadCompletesAt) return false;
    const needed = this.config.magazineSize - this.magazine;
    const loaded = Math.min(needed, this.reserve);
    this.magazine += loaded;
    this.reserve -= loaded;
    this.reloadCompletesAt = null;
    return true;
  }

  cancelReload(): void {
    this.reloadCompletesAt = null;
  }

  refillReserve(): void {
    this.reserve = this.config.reserveAmmo;
  }

  private failed(reason: NonNullable<ShotResult["reason"]>): ShotResult {
    return { fired: false, reason, magazine: this.magazine, spreadX: 0, spreadY: 0 };
  }

  private random(): number {
    let value = this.seed;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.seed = value >>> 0;
    return this.seed / 0x1_0000_0000;
  }
}
