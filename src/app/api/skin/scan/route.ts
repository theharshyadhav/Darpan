import { visitorSeed } from "@/server/seed";
import { getDeps } from "@/server/deps";
import { json, queryNumber, rateLimited, readBytes } from "@/server/http";
import { guard } from "@/server/guard";
import { rateLimit } from "@/server/ratelimit";
import { pollScan, startScan } from "@/server/services/scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Start a scan. Body: the photo (image/jpeg or image/png), or empty in Demo Mode. */
export async function POST(req: Request): Promise<Response> {
  const d = getDeps();
  const g = await guard(req, d, "scan", 12);
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const seed = visitorSeed(url.searchParams.get("seed"));
  const n = Math.round(queryNumber(url, "n", 0, 999) ?? 0);

  const hasBody = Number(req.headers.get("content-length") ?? "0") > 0 || req.body !== null;
  const body = hasBody ? await readBytes(req, d.cfg.limits.maxImageBytes) : ({ ok: false, reason: "empty" } as const);
  if (!body.ok && body.reason === "too_big") return json({ ok: false, error: "big_image" }, 413);

  // a real scan costs units: one at a time per visitor, spaced by the cooldown
  if (body.ok && d.youcam && !d.cfg.demoOnly && d.cfg.limits.scanCooldownSec > 0) {
    const cool = await rateLimit(d.kv, "scan-cooldown", g.ip, 1, d.cfg.limits.scanCooldownSec, d.now());
    if (!cool.ok) return rateLimited(cool.retryAfterSec, { error: "busy" });
  }

  const reply = await startScan(d, { ip: g.ip, bytes: body.ok ? body.bytes : null, seed, n });
  return json(reply.body, reply.status);
}

/** Poll a scan with the ticket from POST. */
export async function GET(req: Request): Promise<Response> {
  const d = getDeps();
  const g = await guard(req, d, "scan-poll", 90);
  if (!g.ok) return g.response;
  const ticket = new URL(req.url).searchParams.get("ticket");
  if (!ticket) return json({ ok: false, error: "generic" }, 400);
  const reply = await pollScan(d, ticket);
  return json(reply.body, reply.status);
}
