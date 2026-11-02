import type { StatusResponse } from "@/lib/api";
import { llmLive, skinMode } from "@/server/config";
import { getDeps } from "@/server/deps";
import { json } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What this deployment can do right now. Never includes keys, balances or any account detail. */
export function GET(): Response {
  const { cfg, llm } = getDeps();
  const mode = skinMode(cfg);
  const live = llmLive(cfg);
  const body: StatusResponse = {
    app: "darpan",
    version: "1.0.0",
    skin: mode,
    look: mode,
    llm: live ? "live" : "off",
    llmProvider: live ? cfg.llm.label : undefined,
    // a vision model may or may not exist; the look route reports it when asked
    vision: Boolean(live && llm),
    scanCooldownSec: cfg.limits.scanCooldownSec,
    maxImageBytes: cfg.limits.maxImageBytes,
  };
  return json(body);
}
