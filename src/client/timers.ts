import { randomId } from "./data";
import type { TimerKind } from "@/lib/ritual/products";
import type { TimerView } from "./state";

/**
 * Timers the mirror keeps for you ("massage for a minute", "let that settle"). Each one is an
 * absolute end time, so a throttled background tab still finishes on time. Nothing here ticks the
 * screen: the UI draws its own countdown from `endsAt`, and this only reports when one is done.
 */

export const MAX_TIMERS = 4;
const TICK_MS = 250;

export interface TimerHooks {
  /** The list changed (started, stopped or finished). */
  onChange(timers: TimerView[]): void;
  /** A timer ran out. */
  onDone(timer: TimerView): void;
}

export class TimerBank {
  private timers: TimerView[] = [];
  private running = false;
  private disposed = false;

  constructor(
    private readonly now: () => number,
    private readonly sleep: (ms: number) => Promise<void>,
    private readonly rand: () => number,
    private readonly hooks: TimerHooks,
  ) {}

  list(): TimerView[] {
    return this.timers;
  }

  start(kind: TimerKind, seconds: number): TimerView {
    const startedAt = this.now();
    const timer: TimerView = { id: randomId("tm", startedAt, this.rand), kind, startedAt, endsAt: startedAt + seconds * 1000, totalSec: seconds };
    this.timers = [...this.timers, timer].slice(-MAX_TIMERS);
    this.hooks.onChange(this.timers);
    void this.loop();
    return timer;
  }

  /** Stop everything. Returns how many were stopped. */
  stopAll(): number {
    const n = this.timers.length;
    if (n === 0) return 0;
    this.timers = [];
    this.hooks.onChange(this.timers);
    return n;
  }

  dispose(): void {
    this.disposed = true;
    this.timers = [];
  }

  private async loop(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.timers.length > 0 && !this.disposed) {
        await this.sleep(TICK_MS);
        if (this.disposed) return;
        const t = this.now();
        const due = this.timers.filter((x) => x.endsAt <= t);
        if (due.length === 0) continue;
        this.timers = this.timers.filter((x) => x.endsAt > t);
        this.hooks.onChange(this.timers);
        for (const d of due) this.hooks.onDone(d);
      }
    } finally {
      this.running = false;
    }
  }
}
