import { ActionSchema, parseActions, type Action, type ChatRequest, type ChatResponse, type ProductLookResponse } from "@/lib/api";
import { limitTitleMentions, lintUtterance, sanitizeUtterance } from "@/lib/persona/lint";
import { cleanProductName, isCategory } from "@/lib/ritual/products";
import { isLanguage } from "@/lib/types";
import { LlmClient, LlmError, extractJson } from "./client";
import { narratePrompt, planPrompt, userBlock, visionPrompt } from "./prompts";

/**
 * The mirror's use of a language model. Three jobs, all optional (the app has built-in rules and
 * works without any model):
 *
 *   plan     what the person said  ->  validated app actions (+ a short answer for plain questions)
 *   narrate  deterministic facts   ->  one or two calm sentences in the mirror's voice
 *   identify a camera frame        ->  the product name and category on a label
 *
 * Every sentence is linted and softened on the way out (src/lib/persona/lint.ts). The model can
 * never skip the linter, add a new action type, or change what the ritual engine decides.
 */

const SAY_LIMIT = 320;

function tidySay(raw: unknown, req: Pick<ChatRequest, "lang" | "title">): string | undefined {
  if (typeof raw !== "string") return undefined;
  let text = raw
    .replace(/[*_`#>~]+/g, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  if (text.length > SAY_LIMIT) {
    const cut = text.slice(0, SAY_LIMIT);
    const end = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"), cut.lastIndexOf("।"));
    text = end > 40 ? cut.slice(0, end + 1) : cut.trimEnd();
  }
  const safe = sanitizeUtterance(text, "");
  if (safe.usedFallback || !safe.text) return undefined;
  const limited = req.title ? limitTitleMentions(safe.text, req.title) : safe.text;
  return lintUtterance(limited).ok ? limited : undefined;
}

function stateBlock(req: ChatRequest): string {
  const s = req.state;
  if (!s) return "<state>{}</state>";
  return `<state>${JSON.stringify(s)}</state>`;
}

function historyBlock(req: ChatRequest): string {
  if (!req.history?.length) return "";
  const lines = req.history.map((h) => `${h.role === "user" ? "person" : "mirror"}: ${h.text.replace(/\s+/g, " ")}`);
  return `<history>\n${lines.join("\n")}\n</history>\n`;
}

function failure(e: unknown): ChatResponse {
  if (e instanceof LlmError && e.kind === "rate") return { ok: false, error: "rate_limited", retryAfterSec: e.retryAfterSec ?? 20 };
  return { ok: false, error: "llm_failed" };
}

export async function planTurn(llm: LlmClient, req: ChatRequest): Promise<ChatResponse> {
  const utterance = (req.utterance ?? "").trim();
  if (!utterance) return { ok: true, actions: [{ type: "none" }], source: "fallback" };
  try {
    const out = await llm.complete({
      json: true,
      temperature: 0.2,
      maxTokens: 400,
      messages: [
        { role: "system", content: planPrompt(req.lang, req.title) },
        { role: "user", content: `${stateBlock(req)}\n${historyBlock(req)}${userBlock(utterance)}` },
      ],
    });
    const parsed = extractJson(out.text);
    if (typeof parsed !== "object" || parsed === null) return { ok: false, error: "llm_failed" };
    const obj = parsed as { actions?: unknown; say?: unknown };

    const actions: Action[] = parseActions(obj.actions).map(normaliseAction);
    const say = tidySay(obj.say, req);
    if (actions.length === 0 && !say) return { ok: true, actions: [{ type: "none" }], source: "llm", model: out.model };
    return { ok: true, actions: actions.length > 0 ? actions : [{ type: "none" }], say, source: "llm", model: out.model };
  } catch (e) {
    return failure(e);
  }
}

/** Clean what a model puts inside an action, so the engine only ever sees tidy values. */
function normaliseAction(a: Action): Action {
  if (a.type === "log_product" || a.type === "track_product") {
    const name = cleanProductName(a.name);
    const category = a.category && isCategory(a.category) ? a.category : undefined;
    return name ? { ...a, name, category } : { type: "none" };
  }
  if (a.type === "set_title") {
    const title = a.title.replace(/[\u0000-\u001f\u007f<>"`\\{}]/g, "").replace(/\s+/g, " ").trim().slice(0, 24);
    return title && lintUtterance(title).ok ? { ...a, title } : { type: "none" };
  }
  if (a.type === "set_language" && !isLanguage(a.language)) return { type: "none" };
  return ActionSchema.safeParse(a).success ? a : { type: "none" };
}

export async function narrateTurn(llm: LlmClient, req: ChatRequest): Promise<ChatResponse> {
  const facts = (req.facts ?? []).map((f) => `- ${f.replace(/\s+/g, " ")}`).join("\n");
  const question = (req.utterance ?? "").trim();
  try {
    const out = await llm.complete({
      json: true,
      temperature: 0.5,
      maxTokens: 220,
      messages: [
        { role: "system", content: narratePrompt(req.lang, req.title) },
        {
          role: "user",
          content: `${stateBlock(req)}\n${historyBlock(req)}<facts>\n${facts || "(none)"}\n</facts>\n${question ? userBlock(question) : ""}`,
        },
      ],
    });
    const parsed = extractJson(out.text);
    const raw = typeof parsed === "object" && parsed !== null ? (parsed as { say?: unknown }).say : out.text;
    const say = tidySay(raw, req);
    if (!say) return { ok: false, error: "llm_failed" };
    return { ok: true, actions: [], say, source: "llm", model: out.model };
  } catch (e) {
    return failure(e);
  }
}

export async function identifyProduct(llm: LlmClient, imageDataUrl: string): Promise<ProductLookResponse> {
  try {
    const out = await llm.complete({
      json: true,
      vision: true,
      temperature: 0,
      maxTokens: 200,
      messages: [
        { role: "system", content: visionPrompt() },
        {
          role: "user",
          content: [
            { type: "text", text: "What product is this?" },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
    });
    const parsed = extractJson(out.text);
    if (typeof parsed !== "object" || parsed === null) return { ok: true, found: false };
    const p = parsed as { found?: unknown; name?: unknown; category?: unknown; confidence?: unknown };
    if (p.found !== true || typeof p.name !== "string") return { ok: true, found: false };
    const name = cleanProductName(p.name, "label");
    if (name.length < 2) return { ok: true, found: false };
    const category = isCategory(p.category) ? p.category : undefined;
    const confidence = p.confidence === "high" || p.confidence === "medium" || p.confidence === "low" ? p.confidence : "low";
    return { ok: true, found: true, name, category, confidence };
  } catch {
    return { ok: false, error: "llm_failed" };
  }
}
