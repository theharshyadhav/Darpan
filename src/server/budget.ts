import { createHash } from "node:crypto";
import type { KV } from "./kv";

/**
 * The unit budget guard. YouCam charges per call from a finite allowance, and a public demo URL
 * will be tried by strangers, so every paid call first reserves units here:
 *
 *  - a global daily cap (all visitors),
 *  - a per-visitor daily cap,
 *  - an optional minimum balance to always leave in the account,
 *  - a breaker that stops spending for a while after YouCam says it is out of credit or the key is bad.
 *
 * When any of them says no, the app does not fail: it drops into clearly labelled Demo Mode.
 */

export type BudgetDenied = "daily" | "visitor" | "balance" | "breaker";
export type BudgetDecision = { ok: true } | { ok: false; reason: BudgetDenied };

export interface BudgetLimits {
  dailyUnits: number;
  ipDailyUnits: number;
  minBalance: number;
}

const DAY_TTL = 26 * 3600;

function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function visitorId(ip: string): string {
  return createHash("sha256").update(`darpan-visitor:${ip}`).digest("hex").slice(0, 16);
}

export class Budget {
  private breakerUntil = 0;
  private balance: { at: number; value: number | null } | null = null;

  constructor(
    private readonly kv: KV,
    private readonly limits: BudgetLimits,
    /** Returns the spendable balance, or null when unknown. Only called when minBalance > 0. */
    private readonly balanceFn: (() => Promise<number | null>) | null = null,
    private readonly now: () => number = Date.now,
  ) {}

  /** Stop spending for a while (after "no credit", an invalid key, ...). */
  trip(minutes: number): void {
    this.breakerUntil = Math.max(this.breakerUntil, this.now() + minutes * 60_000);
  }

  get open(): boolean {
    return this.now() >= this.breakerUntil;
  }

  private async spendable(): Promise<number | null> {
    if (!this.balanceFn) return null;
    const t = this.now();
    if (this.balance && t - this.balance.at < 5 * 60_000) return this.balance.value;
    let value: number | null = null;
    try {
      value = await this.balanceFn();
    } catch {
      value = null;
    }
    this.balance = { at: t, value };
    return value;
  }

  /** Reserve `units` for one paid call. Call `refund` if the call fails before YouCam spends them. */
  async reserve(ip: string, units: number): Promise<BudgetDecision> {
    if (!this.open) return { ok: false, reason: "breaker" };
    if (units <= 0) return { ok: true };

    if (this.limits.minBalance > 0) {
      const bal = await this.spendable();
      if (bal !== null && bal - units < this.limits.minBalance) return { ok: false, reason: "balance" };
    }

    const t = this.now();
    const gKey = `budget:day:${dayKey(t)}`;
    const vKey = `budget:visitor:${dayKey(t)}:${visitorId(ip)}`;

    const g = await this.kv.incr(gKey, units, DAY_TTL);
    if (g > this.limits.dailyUnits) {
      await this.kv.incr(gKey, -units, DAY_TTL);
      return { ok: false, reason: "daily" };
    }
    const v = await this.kv.incr(vKey, units, DAY_TTL);
    if (v > this.limits.ipDailyUnits) {
      await this.kv.incr(vKey, -units, DAY_TTL);
      await this.kv.incr(gKey, -units, DAY_TTL);
      return { ok: false, reason: "visitor" };
    }
    return { ok: true };
  }

  async refund(ip: string, units: number): Promise<void> {
    if (units <= 0) return;
    const t = this.now();
    await this.kv.incr(`budget:day:${dayKey(t)}`, -units, DAY_TTL);
    await this.kv.incr(`budget:visitor:${dayKey(t)}:${visitorId(ip)}`, -units, DAY_TTL);
  }
}
