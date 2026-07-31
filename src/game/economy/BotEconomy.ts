import { ECONOMY_CONFIG } from "./EconomySystem";
import { getWeaponConfig, type WeaponId } from "../combat/WeaponCatalog";

export interface BotBuyPlan {
  loadouts: WeaponId[];
  spent: number;
  balanceAfter: number;
}

export class BotBuyPlanner {
  plan(round: number, botCount: number, balance: number): BotBuyPlan {
    const loadouts: WeaponId[] = Array.from({ length: botCount }, () => "px9" as WeaponId);
    let remaining = balance;
    const priorities: WeaponId[] = round === 1 ? ["arc12"] : ["br4", "vx7", "rift6", "arc12"];

    for (const weaponId of priorities) {
      const price = getWeaponConfig(weaponId).price;
      for (let index = 0; index < botCount && remaining >= price; index += 1) {
        if (loadouts[index] !== "px9") continue;
        loadouts[index] = weaponId;
        remaining -= price;
      }
    }
    return { loadouts, spent: balance - remaining, balanceAfter: remaining };
  }
}

export class BotEconomy {
  balance = ECONOMY_CONFIG.startingMoney;
  lossTier = 0;
  private readonly processedEvents = new Set<string>();

  spend(eventId: string, amount: number): boolean {
    if (this.processedEvents.has(eventId) || amount < 0 || amount > this.balance) return false;
    this.processedEvents.add(eventId);
    this.balance -= amount;
    return true;
  }

  awardKill(eventId: string, weaponId: WeaponId): boolean {
    return this.credit(eventId, getWeaponConfig(weaponId).killReward);
  }

  settleRound(eventId: string, won: boolean, multiplier = 1): boolean {
    if (this.processedEvents.has(eventId)) return false;
    const base = won ? ECONOMY_CONFIG.winReward : ECONOMY_CONFIG.lossRewards[this.lossTier];
    const credited = this.credit(eventId, Math.round(base * multiplier));
    if (credited) this.lossTier = won ? Math.max(0, this.lossTier - 1) : Math.min(ECONOMY_CONFIG.lossRewards.length - 1, this.lossTier + 1);
    return credited;
  }

  reset(): void {
    this.balance = ECONOMY_CONFIG.startingMoney;
    this.lossTier = 0;
    this.processedEvents.clear();
  }

  private credit(eventId: string, amount: number): boolean {
    if (this.processedEvents.has(eventId)) return false;
    this.processedEvents.add(eventId);
    this.balance = Math.min(ECONOMY_CONFIG.moneyCap, this.balance + amount);
    return true;
  }
}
