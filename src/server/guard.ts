import { clientIp, json, originAllowed, rateLimited } from "./http";
import { rateLimit } from "./ratelimit";
import type { Deps } from "./deps";

/**
 * The gate every route passes first: same-origin only, then a per-visitor rate limit.
 * Returns the visitor's address on success, or the Response to send straight back.
 */
export async function guard(
  req: Request,
  d: Deps,
  bucket: string,
  limit: number,
  windowSec = 60,
): Promise<{ ok: true; ip: string } | { ok: false; response: Response }> {
  if (!originAllowed(req, d.cfg)) return { ok: false, response: json({ ok: false, error: "forbidden" }, 403) };
  const ip = clientIp(req);
  const r = await rateLimit(d.kv, bucket, ip, limit, windowSec, d.now());
  if (!r.ok) return { ok: false, response: rateLimited(r.retryAfterSec) };
  return { ok: true, ip };
}
