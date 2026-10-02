import { getWeaponConfig, type WeaponId } from "../combat/WeaponCatalog";
import { COMPETITIVE_RULES } from "../../shared/game-data.mjs";

export const ECONOMY_CONFIG = {
  startingMoney: 800,
  moneyCap: 16_000,
  winReward: 3_250,
  lossRewards: [1_400, 1_900, 2_400, 2_900, 3_400] as const,
  armorPrice: 650,
  helmetPrice: 350,
  defuseKitPrice: 400,
  plantBonus: 800,
  objectiveReward: 300,
};

export type LedgerReason = "kill" | "objective" | "round-win" | "round-loss" | "purchase" | "refund";

export interface LedgerEntry {
  eventId: string;
  amount: number;
  balance: number;
  reason: LedgerReason;
  label: string;
}

export interface PurchaseResult {
  ok: boolean;
  reason?: "duplicate" | "not-buy-phase" | "pistol-round" | "insufficient-funds" | "already-owned";
  balance: number;
}

interface PurchaseReceipt {
  itemId: string;
  price: number;
  refundable: boolean;
}

export class EconomySystem {
  balance = ECONOMY_CONFIG.startingMoney;
  lossTier = 0;
  readonly ledger: LedgerEntry[] = [];
  readonly inventory = new Set<string>(["px9", "knife"]);
  private readonly processedEvents = new Set<string>();
  private readonly receipts = new Map<string, PurchaseReceipt>();

  awardKill(eventId: string, weaponId: WeaponId): boolean {
    return this.credit(eventId, getWeaponConfig(weaponId).killReward, "kill", `${weaponId} 击杀奖励`);
  }

  awardObjective(eventId: string, label: string): boolean {
    return this.credit(eventId, ECONOMY_CONFIG.objectiveReward, "objective", label);
  }

  settleRound(eventId: string, won: boolean, planted = false): boolean {
    if (this.processedEvents.has(eventId)) return false;
    const amount = won ? ECONOMY_CONFIG.winReward : ECONOMY_CONFIG.lossRewards[this.lossTier] + (planted ? ECONOMY_CONFIG.plantBonus : 0);
    const credited = this.credit(eventId, amount, won ? "round-win" : "round-loss", won ? "回合胜利" : "失败补偿");
    if (credited) this.lossTier = won ? Math.max(0, this.lossTier - 1) : Math.min(ECONOMY_CONFIG.lossRewards.length - 1, this.lossTier + 1);
    return credited;
  }

  purchase(eventId: string, itemId: WeaponId | "armor" | "helmet" | "defuse-kit", round: number, inBuyPhase: boolean, currentArmor = 100): PurchaseResult {
    if (this.processedEvents.has(eventId)) return { ok: false, reason: "duplicate", balance: this.balance };
    if (!inBuyPhase) return { ok: false, reason: "not-buy-phase", balance: this.balance };
    if (this.inventory.has(itemId) && !(itemId === "armor" && currentArmor < 100)) return { ok: false, reason: "already-owned", balance: this.balance };
    const config = itemId === "armor" ? { price: ECONOMY_CONFIG.armorPrice, primary: false }
      : itemId === "helmet" ? { price: ECONOMY_CONFIG.helmetPrice, primary: false }
        : itemId === "defuse-kit" ? { price: ECONOMY_CONFIG.defuseKitPrice, primary: false }
          : { price: getWeaponConfig(itemId).price, primary: getWeaponConfig(itemId).slot === "primary" };
    if ((round === 1 || round === COMPETITIVE_RULES.halfRounds + 1) && config.primary) return { ok: false, reason: "pistol-round", balance: this.balance };
    if (this.balance < config.price) return { ok: false, reason: "insufficient-funds", balance: this.balance };

    this.processedEvents.add(eventId);
    this.balance -= config.price;
    this.inventory.add(itemId);
    this.receipts.set(eventId, { itemId, price: config.price, refundable: true });
    this.record(eventId, -config.price, "purchase", `购买 ${itemId}`);
    return { ok: true, balance: this.balance };
  }

  refund(eventId: string, purchaseEventId: string, inBuyPhase: boolean): PurchaseResult {
    if (this.processedEvents.has(eventId)) return { ok: false, reason: "duplicate", balance: this.balance };
    const receipt = this.receipts.get(purchaseEventId);
    if (!inBuyPhase || !receipt?.refundable) return { ok: false, reason: "not-buy-phase", balance: this.balance };
    this.processedEvents.add(eventId);
    receipt.refundable = false;
    this.inventory.delete(receipt.itemId);
    this.balance = Math.min(ECONOMY_CONFIG.moneyCap, this.balance + receipt.price);
    this.record(eventId, receipt.price, "refund", `退款 ${receipt.itemId}`);
    return { ok: true, balance: this.balance };
  }

  lockRefunds(): void {
    for (const receipt of this.receipts.values()) receipt.refundable = false;
  }

  resetEquipmentAfterDeath(): void {
    for (const itemId of [...this.inventory]) {
      if (itemId !== "px9" && itemId !== "knife") this.inventory.delete(itemId);
    }
    this.receipts.clear();
  }

  resetForHalf(): void {
    this.balance = ECONOMY_CONFIG.startingMoney;
    this.lossTier = 0;
    this.inventory.clear();
    this.inventory.add("px9");
    this.inventory.add("knife");
    this.receipts.clear();
  }

  equipPickedUpWeapon(weaponId: WeaponId, replacedWeaponId?: WeaponId): void {
    if (replacedWeaponId && replacedWeaponId !== "px9") this.inventory.delete(replacedWeaponId);
    this.inventory.add(weaponId);
  }

  dropWeapon(weaponId: WeaponId): void {
    if (weaponId !== "px9") this.inventory.delete(weaponId);
  }

  private credit(eventId: string, amount: number, reason: LedgerReason, label: string): boolean {
    if (this.processedEvents.has(eventId)) return false;
    this.processedEvents.add(eventId);
    const before = this.balance;
    this.balance = Math.min(ECONOMY_CONFIG.moneyCap, this.balance + amount);
    this.record(eventId, this.balance - before, reason, label);
    return true;
  }

  private record(eventId: string, amount: number, reason: LedgerReason, label: string): void {
    this.ledger.push({ eventId, amount, balance: this.balance, reason, label });
  }
}
