import type { KV } from "./kv";

export interface LimitResult {
  ok: boolean;
  /** Seconds until the window resets, when blocked. */
  retryAfterSec: number;
}

/**
 * Fixed-window limiter: `limit` requests per `windowSec` per (bucket, key). Cheap, predictable, and
 * good enough to stop a script from draining a free tier; it is not meant to be a fairness scheduler.
 */
export async function rateLimit(
  kv: KV,
  bucket: string,
  key: string,
  limit: number,
  windowSec: number,
  now: number = Date.now(),
): Promise<LimitResult> {
  const window = Math.floor(now / (windowSec * 1000));
  const n = await kv.incr(`rl:${bucket}:${key}:${window}`, 1, windowSec + 5);
  if (n <= limit) return { ok: true, retryAfterSec: 0 };
  const resetsAt = (window + 1) * windowSec * 1000;
  return { ok: false, retryAfterSec: Math.max(1, Math.ceil((resetsAt - now) / 1000)) };
}
