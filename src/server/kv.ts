/**
 * A tiny counter store behind two interchangeable backends: process memory (always works, per
 * server instance) and Upstash Redis over REST (shared across serverless instances, optional).
 * If Upstash is unreachable the counters quietly fall back to memory, so a Redis blip never takes
 * the mirror down; the limits then apply per instance instead of globally.
 */

export interface KV {
  /** Add `by` (may be negative) to a counter that expires after `ttlSec`, and return the new value. */
  incr(key: string, by: number, ttlSec: number): Promise<number>;
  get(key: string): Promise<number>;
}

interface Slot {
  v: number;
  exp: number;
}

export class MemoryKV implements KV {
  private readonly m = new Map<string, Slot>();

  constructor(private readonly now: () => number = Date.now) {}

  private prune(): void {
    if (this.m.size < 5000) return;
    const t = this.now();
    for (const [k, s] of this.m) if (s.exp <= t) this.m.delete(k);
    // still huge (an attack with many distinct keys): drop the oldest quarter
    if (this.m.size >= 5000) {
      let n = Math.floor(this.m.size / 4);
      for (const k of this.m.keys()) {
        this.m.delete(k);
        if (--n <= 0) break;
      }
    }
  }

  async incr(key: string, by: number, ttlSec: number): Promise<number> {
    const t = this.now();
    const cur = this.m.get(key);
    if (!cur || cur.exp <= t) {
      this.prune();
      const slot = { v: by, exp: t + ttlSec * 1000 };
      this.m.set(key, slot);
      return slot.v;
    }
    cur.v += by;
    return cur.v;
  }

  async get(key: string): Promise<number> {
    const cur = this.m.get(key);
    return cur && cur.exp > this.now() ? cur.v : 0;
  }
}

export class UpstashKV implements KV {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fallback: KV,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async cmd(command: (string | number)[]): Promise<unknown> {
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`upstash ${res.status}`);
    const body = (await res.json()) as { result?: unknown; error?: string };
    if (body.error) throw new Error(body.error);
    return body.result;
  }

  async incr(key: string, by: number, ttlSec: number): Promise<number> {
    try {
      const v = Number(await this.cmd(["INCRBY", key, by]));
      if (!Number.isFinite(v)) throw new Error("bad counter");
      // set the expiry only when the counter has just been created
      if (v === by) await this.cmd(["EXPIRE", key, ttlSec]);
      return v;
    } catch {
      return this.fallback.incr(key, by, ttlSec);
    }
  }

  async get(key: string): Promise<number> {
    try {
      const v = await this.cmd(["GET", key]);
      return v === null || v === undefined ? 0 : Number(v) || 0;
    } catch {
      return this.fallback.get(key);
    }
  }
}

export function createKV(cfg: { url?: string; token?: string }): KV {
  const memory = new MemoryKV();
  return cfg.url && cfg.token ? new UpstashKV(cfg.url, cfg.token, memory) : memory;
}
