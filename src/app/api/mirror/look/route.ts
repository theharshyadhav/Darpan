import type { ProductLookResponse } from "@/lib/api";
import { checkImage } from "@/lib/image/sniff";
import { getDeps } from "@/server/deps";
import { json, readBytes } from "@/server/http";
import { guard } from "@/server/guard";
import { identifyProduct } from "@/server/llm/mirror";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 40;

/** Frames for product reading are small (a few hundred KB). */
const MAX_FRAME_BYTES = 900_000;

export async function POST(req: Request): Promise<Response> {
  const d = getDeps();
  const g = await guard(req, d, "vision", d.cfg.limits.visionPerMinute);
  if (!g.ok) return g.response;

  // The person must have agreed to share camera frames with the model, and the browser says so.
  if (req.headers.get("x-darpan-consent") !== "look") {
    return json({ ok: false, error: "consent" } satisfies ProductLookResponse, 403);
  }
  if (!d.llm) return json({ ok: false, error: "vision_off" } satisfies ProductLookResponse);

  const body = await readBytes(req, MAX_FRAME_BYTES);
  if (!body.ok) return json({ ok: false, error: "bad_image" } satisfies ProductLookResponse, 400);
  const checked = checkImage(body.bytes, { maxBytes: MAX_FRAME_BYTES, minShortSide: 200, maxLongSide: 2000 });
  if (!checked.ok) return json({ ok: false, error: "bad_image" } satisfies ProductLookResponse, 400);

  const mime = checked.info.type === "png" ? "image/png" : "image/jpeg";
  const dataUrl = `data:${mime};base64,${Buffer.from(body.bytes).toString("base64")}`;
  const result = await identifyProduct(d.llm, dataUrl);
  return json(result);
}
