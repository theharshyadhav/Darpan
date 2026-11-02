import { getDeps } from "@/server/deps";
import { json, rateLimited, readBytes } from "@/server/http";
import { guard } from "@/server/guard";
import { rateLimit } from "@/server/ratelimit";
import { pollLook, startLook } from "@/server/services/look";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Start a makeup preview. Query: look=<id>. Body: the photo (image/jpeg or image/png). */
export async function POST(req: Request): Promise<Response> {
  const d = getDeps();
  const g = await guard(req, d, "look", 12);
  if (!g.ok) return g.response;

  const lookId = new URL(req.url).searchParams.get("look") ?? "";
  const body = await readBytes(req, d.cfg.limits.maxImageBytes);
  if (!body.ok && body.reason === "too_big") return json({ ok: false, error: "big_image" }, 413);

  if (body.ok && d.youcam && !d.cfg.demoOnly && d.cfg.limits.scanCooldownSec > 0) {
    const cool = await rateLimit(d.kv, "look-cooldown", g.ip, 1, Math.max(5, Math.round(d.cfg.limits.scanCooldownSec / 2)), d.now());
    if (!cool.ok) return rateLimited(cool.retryAfterSec, { error: "busy" });
  }

  const reply = await startLook(d, { ip: g.ip, lookId, bytes: body.ok ? body.bytes : null });
  return json(reply.body, reply.status);
}

export async function GET(req: Request): Promise<Response> {
  const d = getDeps();
  const g = await guard(req, d, "look-poll", 90);
  if (!g.ok) return g.response;
  const ticket = new URL(req.url).searchParams.get("ticket");
  if (!ticket) return json({ ok: false, error: "generic" }, 400);
  const reply = await pollLook(d, ticket);
  return json(reply.body, reply.status);
}
