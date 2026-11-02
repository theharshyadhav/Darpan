import type { Config } from "./config";

/** Small HTTP helpers shared by every route handler. */

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...NO_STORE, ...extra },
  });
}

export function rateLimited(retryAfterSec: number, body: Record<string, unknown> = {}): Response {
  return json({ ok: false, error: "rate_limited", retryAfterSec, ...body }, 429, { "Retry-After": String(retryAfterSec) });
}

/** The visitor's address as the platform reports it. Only meaningful behind a trusted proxy. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  const first = fwd?.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip")?.trim() || req.headers.get("cf-connecting-ip")?.trim() || "unknown";
}

/**
 * Only the app's own pages may call the API from a browser. A cross-site page cannot spend this
 * server's YouCam units on a visitor's behalf. Non-browser clients (curl) carry no Origin and are
 * stopped by the rate limits and the budget guard instead.
 */
export function originAllowed(req: Request, cfg: Pick<Config, "allowedOrigins">): boolean {
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if (!origin) return !site || site === "same-origin" || site === "none";
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  if (cfg.allowedOrigins.includes(o.origin)) return true;
  const hosts = [req.headers.get("host"), req.headers.get("x-forwarded-host")].filter(Boolean);
  return hosts.includes(o.host);
}

export type BodyResult = { ok: true; bytes: Uint8Array } | { ok: false; reason: "too_big" | "empty" };

/** Read a request body with a hard size limit, without trusting Content-Length. */
export async function readBytes(req: Request, maxBytes: number): Promise<BodyResult> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: "too_big" };
  if (!req.body) return { ok: false, reason: "empty" };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: "too_big" };
    }
    chunks.push(value);
  }
  if (total === 0) return { ok: false, reason: "empty" };
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return { ok: true, bytes: out };
}

export async function readJson(req: Request, maxBytes = 24_000): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const body = await readBytes(req, maxBytes);
  if (!body.ok) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(body.bytes)) };
  } catch {
    return { ok: false };
  }
}

export function queryNumber(url: URL, name: string, min: number, max: number): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
}
