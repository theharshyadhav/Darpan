import type { Config } from "../config";
import { PROVIDERS, pickModels } from "./providers";

/**
 * A minimal OpenAI-compatible chat client with model failover. Works unchanged with Groq (the
 * free default), xAI Grok, Google Gemini's OpenAI endpoint, OpenRouter, or any compatible server.
 *
 *  - Models are discovered from `/models` (cached) and tried in preference order.
 *  - Rate limits, retired models, timeouts and malformed output move on to the next model.
 *  - A rejected key stops immediately: every other model would fail the same way.
 */

export type LlmErrorKind = "auth" | "rate" | "model" | "timeout" | "server" | "network" | "bad_output";

export class LlmError extends Error {
  constructor(
    public readonly kind: LlmErrorKind,
    message: string,
    public readonly status?: number,
    public readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export interface CompleteOptions {
  messages: ChatMessage[];
  /** Ask for a JSON object (provider JSON mode when available). */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Vision requests pick from the vision-capable model list. */
  vision?: boolean;
}

export interface Completion {
  text: string;
  model: string;
}

const MODELS_TTL_MS = 60 * 60_000;

/** Remove reasoning blocks some models print before their answer. */
export function stripReasoning(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .trim();
}

/** Pull a JSON value out of model text: raw JSON, fenced JSON, or JSON surrounded by chatter. */
export function extractJson(text: string): unknown {
  const t = stripReasoning(text);
  const candidates: string[] = [t];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(t.slice(first, last + 1));
  for (const c of candidates) {
    for (const attempt of [c, c.replace(/,\s*([}\]])/g, "$1")]) {
      try {
        return JSON.parse(attempt);
      } catch {
        /* try the next shape */
      }
    }
  }
  return undefined;
}

export class LlmClient {
  private modelList: { at: number; ids: string[] } | null = null;
  private readonly cooldown = new Map<string, number>();

  constructor(
    private readonly cfg: Config["llm"],
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  get provider(): string {
    return this.cfg.label;
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.cfg.apiKey ?? ""}`, "Content-Type": "application/json" };
  }

  /** Ids the provider currently serves, cached for an hour. Empty when discovery fails. */
  async availableModels(): Promise<string[]> {
    const t = this.now();
    if (this.modelList && t - this.modelList.at < MODELS_TTL_MS) return this.modelList.ids;
    let ids: string[] = [];
    try {
      const res = await this.fetchImpl(`${this.cfg.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(6000),
        cache: "no-store",
      });
      if (res.ok) {
        const body = (await res.json()) as { data?: Array<{ id?: unknown }> };
        ids = (body.data ?? []).map((m) => (typeof m.id === "string" ? m.id.replace(/^models\//, "") : "")).filter(Boolean);
      }
    } catch {
      ids = [];
    }
    // a failed lookup is cached briefly so a flaky network does not add latency to every turn
    this.modelList = { at: ids.length > 0 ? t : t - MODELS_TTL_MS + 60_000, ids };
    return ids;
  }

  /** The models to try, in order, for chat or vision. */
  async candidates(vision: boolean): Promise<string[]> {
    const explicit = vision ? this.cfg.visionModels : this.cfg.chatModels;
    if (explicit.length > 0) return explicit;
    const preset = this.cfg.provider ? PROVIDERS[this.cfg.provider] : undefined;
    if (!preset) return [];
    const live = await this.availableModels();
    const picked = pickModels(live, vision ? preset.vision : preset.chat, 4);
    if (picked.length > 0) return picked;
    return [...(vision ? preset.fallbackVision : preset.fallbackChat)];
  }

  private async callOnce(model: string, opts: CompleteOptions, json: boolean): Promise<string> {
    const body: Record<string, unknown> = {
      model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 500,
      stream: false,
    };
    if (json) body.response_format = { type: "json_object" };

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.vision ? this.cfg.timeoutMs + 8000 : this.cfg.timeoutMs),
        cache: "no-store",
      });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new LlmError(timedOut ? "timeout" : "network", timedOut ? "model timed out" : "could not reach the model");
    }

    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 400);
      const retry = Number(res.headers.get("retry-after"));
      const retryAfterSec = Number.isFinite(retry) && retry > 0 ? retry : undefined;
      if (res.status === 401 || res.status === 403) throw new LlmError("auth", "the LLM key was rejected", res.status);
      if (res.status === 429) throw new LlmError("rate", "rate limited", res.status, retryAfterSec);
      if (res.status === 404 || /model.*(not found|decommission|deprecat|does not exist|unavailable)|not_found/i.test(detail)) {
        throw new LlmError("model", `model ${model} unavailable`, res.status);
      }
      if (res.status === 400 && json && /response_format|json/i.test(detail)) throw new LlmError("bad_output", "JSON mode unsupported", res.status);
      if (res.status >= 500) throw new LlmError("server", `provider error ${res.status}`, res.status);
      throw new LlmError("model", `request rejected (${res.status})`, res.status);
    }

    const data = (await res.json().catch(() => null)) as { choices?: Array<{ message?: { content?: unknown } }> } | null;
    const raw = data?.choices?.[0]?.message?.content;
    let text = "";
    if (typeof raw === "string") text = raw;
    else if (Array.isArray(raw)) text = raw.map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : "")).join("");
    text = stripReasoning(text);
    if (!text) throw new LlmError("bad_output", "empty reply");
    return text;
  }

  /** Try each candidate model until one answers. */
  async complete(opts: CompleteOptions): Promise<Completion> {
    const models = await this.candidates(Boolean(opts.vision));
    if (models.length === 0) throw new LlmError("model", opts.vision ? "no vision model available" : "no chat model available");

    let last: LlmError | null = null;
    for (const model of models) {
      const until = this.cooldown.get(model) ?? 0;
      if (until > this.now()) continue;
      const jsonModes = opts.json && this.cfg.jsonMode ? [true, false] : [false];
      for (const json of jsonModes) {
        try {
          const text = await this.callOnce(model, opts, json);
          // when JSON was requested but the model chatted, the caller still gets the text to repair
          return { text, model };
        } catch (e) {
          const err = e instanceof LlmError ? e : new LlmError("network", "unexpected failure");
          last = err;
          if (err.kind === "auth") throw err;
          if (err.kind === "rate") this.cooldown.set(model, this.now() + (err.retryAfterSec ?? 20) * 1000);
          if (err.kind === "model") this.cooldown.set(model, this.now() + 10 * 60_000);
          // JSON mode refused or empty: try the same model once without it, otherwise move on
          if (err.kind === "bad_output" && json) continue;
          break;
        }
      }
    }
    throw last ?? new LlmError("model", "no model answered");
  }
}
