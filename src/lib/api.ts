import { z } from "zod";
import { LANGUAGES } from "./types";
import { CATEGORIES } from "./ritual/products";
import { LOOK_IDS } from "./looks";
import type { ScoreMap } from "./skin/types";
import type { ScanErrorKind } from "./persona/copy";

/**
 * The contract between the browser and the route handlers. Both sides import from here, so a
 * change in one place is a type error in the other.
 */

// ------------------------------------------------------------------ actions

/**
 * What a spoken sentence can ask the app to do. The language model (or the offline rails) only ever
 * produces these; the deterministic engine executes them. A model cannot invent a new action.
 */
export const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start_ritual"), period: z.enum(["am", "pm"]).optional() }),
  z.object({ type: z.literal("log_product"), name: z.string().trim().min(1).max(80), category: z.enum(CATEGORIES).optional() }),
  z.object({ type: z.literal("skip_step") }),
  z.object({ type: z.literal("finish_ritual") }),
  z.object({ type: z.literal("start_scan") }),
  z.object({ type: z.literal("verify") }),
  z.object({ type: z.literal("show_report") }),
  z.object({ type: z.literal("try_look"), look: z.enum(LOOK_IDS).optional() }),
  z.object({ type: z.literal("show_ledger") }),
  z.object({ type: z.literal("track_product"), name: z.string().trim().min(1).max(80), category: z.enum(CATEGORIES).optional() }),
  z.object({ type: z.literal("set_language"), language: z.enum(LANGUAGES) }),
  z.object({ type: z.literal("set_title"), title: z.string().trim().min(1).max(24) }),
  z.object({ type: z.literal("start_timer"), seconds: z.number().int().min(5).max(1800) }),
  z.object({ type: z.literal("stop_timer") }),
  z.object({ type: z.literal("look_at_product") }),
  z.object({ type: z.literal("repeat") }),
  z.object({ type: z.literal("forget_me") }),
  z.object({ type: z.literal("none") }),
]);
export type Action = z.infer<typeof ActionSchema>;
export type ActionType = Action["type"];

export const MAX_ACTIONS = 4;

/** Keep every valid action, drop anything else, never throw. */
export function parseActions(raw: unknown): Action[] {
  if (!Array.isArray(raw)) return [];
  const out: Action[] = [];
  for (const item of raw) {
    const r = ActionSchema.safeParse(item);
    if (r.success) out.push(r.data);
    if (out.length >= MAX_ACTIONS) break;
  }
  return out;
}

// --------------------------------------------------------------------- chat

export const ChatRequestSchema = z.object({
  mode: z.enum(["plan", "narrate"]),
  lang: z.enum(LANGUAGES),
  /** The title to address the person by, only when the mirror should use it this turn. */
  title: z.string().max(24).optional(),
  utterance: z.string().max(400).optional(),
  /** Deterministic facts the reply may use (narrate mode). */
  facts: z.array(z.string().max(300)).max(12).optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "mirror"]), text: z.string().max(300) }))
    .max(6)
    .optional(),
  state: z
    .object({
      period: z.enum(["am", "pm"]).optional(),
      ritual: z
        .object({
          status: z.enum(["active", "complete"]),
          applied: z.array(z.object({ name: z.string().max(60), category: z.enum(CATEGORIES) })).max(20),
          next: z.string().max(20).nullable().optional(),
          skipped: z.array(z.string().max(20)).max(12).optional(),
        })
        .nullable()
        .optional(),
      hasScan: z.boolean().optional(),
      scanSource: z.enum(["youcam", "demo"]).optional(),
      tracked: z.array(z.string().max(60)).max(12).optional(),
    })
    .optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export type ChatResponse =
  | { ok: true; actions: Action[]; say?: string; source: "llm" | "fallback"; model?: string }
  | { ok: false; error: "llm_off" | "llm_failed" | "bad_request" | "rate_limited" | "forbidden"; retryAfterSec?: number };

// ------------------------------------------------------------------ product

export type ProductLookResponse =
  | { ok: true; found: true; name: string; category?: (typeof CATEGORIES)[number]; confidence: "high" | "medium" | "low" }
  | { ok: true; found: false }
  | { ok: false; error: "vision_off" | "llm_failed" | "bad_image" | "rate_limited" | "forbidden" | "consent" };

// --------------------------------------------------------------------- scan

export type DemoReason = "no_key" | "budget" | "forced";

export interface ScanResult {
  scores: ScoreMap;
  /**
   * Individual Typology Angle derived from YouCam's skin-colour read. It is used for one thing only:
   * to widen the mirror's stated uncertainty. The colour itself is never returned or stored.
   */
  ita?: number;
}

export type ScanStartResponse =
  | ({ ok: true; mode: "demo"; reason: DemoReason } & ScanResult)
  | { ok: true; mode: "live"; ticket: string; pollMs: number }
  | { ok: false; error: ScanErrorKind; retryAfterSec?: number };

export type ScanPollResponse =
  | { ok: true; status: "running"; pollMs: number }
  | ({ ok: true; status: "success"; mode: "live" } & ScanResult)
  | { ok: false; error: ScanErrorKind };

// --------------------------------------------------------------------- look

export type LookStartResponse =
  | { ok: true; mode: "demo"; reason: DemoReason }
  | { ok: true; mode: "live"; ticket: string; pollMs: number }
  | { ok: false; error: ScanErrorKind | "bad_look"; retryAfterSec?: number };

export type LookPollResponse =
  | { ok: true; status: "running"; pollMs: number }
  | { ok: true; status: "success"; image: string }
  | { ok: false; error: ScanErrorKind };

// ------------------------------------------------------------------- status

export interface StatusResponse {
  app: "darpan";
  version: string;
  skin: "live" | "demo";
  look: "live" | "demo";
  llm: "live" | "off";
  llmProvider?: string;
  vision: boolean;
  /** Seconds between scans the server will accept from one visitor. */
  scanCooldownSec: number;
  /** Largest photo the scan route accepts, in bytes. */
  maxImageBytes: number;
}
