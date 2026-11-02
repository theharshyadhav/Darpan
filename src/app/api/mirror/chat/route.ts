import { ChatRequestSchema, type ChatResponse } from "@/lib/api";
import { getDeps } from "@/server/deps";
import { json, readJson } from "@/server/http";
import { guard } from "@/server/guard";
import { narrateTurn, planTurn } from "@/server/llm/mirror";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request): Promise<Response> {
  const d = getDeps();
  const g = await guard(req, d, "chat", d.cfg.limits.chatPerMinute);
  if (!g.ok) return g.response;

  if (!d.llm) return json({ ok: false, error: "llm_off" } satisfies ChatResponse, 200);

  const body = await readJson(req);
  const parsed = body.ok ? ChatRequestSchema.safeParse(body.value) : null;
  if (!parsed?.success) return json({ ok: false, error: "bad_request" } satisfies ChatResponse, 400);

  const result = parsed.data.mode === "plan" ? await planTurn(d.llm, parsed.data) : await narrateTurn(d.llm, parsed.data);
  return json(result, result.ok ? 200 : result.error === "rate_limited" ? 429 : 200);
}
