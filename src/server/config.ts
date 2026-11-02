import { z } from "zod";
import { sanitizeSkinActions, type SdAction } from "@/lib/concerns";
import { PROVIDERS, isProviderId, type ProviderId } from "./llm/providers";

/**
 * All environment configuration, parsed once and never trusted blindly. Bad values fall back to
 * safe defaults and are listed in `warnings` (shown by `npm run doctor`), so a typo in a hosting
 * dashboard degrades the app instead of crashing it. Secrets never leave the server.
 */

export type Strictness = "strict" | "high" | "medium" | "low" | "flexible";

export interface Config {
  youcam: {
    apiKey?: string;
    baseUrl: string;
    skinVersion: string;
    actions: SdAction[];
    strictness: Strictness;
    /** Also run skin-tone analysis (extra units) to widen stated uncertainty on deeper complexions. */
    tone: boolean;
    /** Estimated units per call. `npm run doctor` prints the account's real table. */
    cost: { skin: number; tone: number; look: number };
  };
  limits: {
    dailyUnits: number;
    ipDailyUnits: number;
    minBalance: number;
    scanCooldownSec: number;
    chatPerMinute: number;
    visionPerMinute: number;
    maxImageBytes: number;
  };
  demoOnly: boolean;
  llm: {
    provider: ProviderId | null;
    label: string;
    apiKey?: string;
    baseUrl: string;
    chatModels: string[];
    visionModels: string[];
    jsonMode: boolean;
    timeoutMs: number;
  };
  allowedOrigins: string[];
  kv: { url?: string; token?: string };
  warnings: string[];
}

type Env = Record<string, string | undefined>;

const TRUE = new Set(["1", "true", "yes", "on"]);
const FALSE = new Set(["0", "false", "no", "off"]);

function readBool(env: Env, name: string, dflt: boolean, warn: string[]): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return dflt;
  if (TRUE.has(raw)) return true;
  if (FALSE.has(raw)) return false;
  warn.push(`${name}="${env[name]}" is not a yes/no value; using ${dflt ? "on" : "off"}.`);
  return dflt;
}

function readInt(env: Env, name: string, dflt: number, min: number, max: number, warn: string[]): number {
  const raw = env[name]?.trim();
  if (!raw) return dflt;
  const parsed = z.coerce.number().int().min(min).max(max).safeParse(raw);
  if (parsed.success) return parsed.data;
  warn.push(`${name}="${raw}" must be a whole number from ${min} to ${max}; using ${dflt}.`);
  return dflt;
}

function readList(env: Env, name: string): string[] {
  return (env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function cleanUrl(raw: string | undefined, fallback: string, name: string, warn: string[], allowHttp = false): string {
  const v = raw?.trim();
  if (!v) return fallback;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && !(allowHttp && u.protocol === "http:")) throw new Error("not https");
    return v.replace(/\/+$/, "");
  } catch {
    warn.push(`${name} is not a valid https URL; using the default.`);
    return fallback;
  }
}

const STRICTNESS = new Set<Strictness>(["strict", "high", "medium", "low", "flexible"]);

export function loadConfig(env: Env = process.env): Config {
  const warnings: string[] = [];

  // ---- YouCam
  const apiKey = env.YOUCAM_API_KEY?.trim() || undefined;
  const mockOk = readBool(env, "DARPAN_ALLOW_HTTP_UPSTREAM", false, warnings);
  const strictRaw = (env.YOUCAM_FACE_STRICTNESS ?? "high").trim().toLowerCase() as Strictness;
  const strictness: Strictness = STRICTNESS.has(strictRaw) ? strictRaw : "high";
  if (!STRICTNESS.has(strictRaw)) warnings.push(`YOUCAM_FACE_STRICTNESS="${env.YOUCAM_FACE_STRICTNESS}" is unknown; using "high".`);
  const versionRaw = (env.YOUCAM_SKIN_VERSION ?? "v2.1").trim();
  const skinVersion = /^v\d+\.\d+$/.test(versionRaw) ? versionRaw : "v2.1";
  if (skinVersion !== versionRaw) warnings.push(`YOUCAM_SKIN_VERSION="${versionRaw}" looks wrong; using v2.1.`);
  const actions = sanitizeSkinActions(readList(env, "YOUCAM_SKIN_ACTIONS"));

  // ---- LLM provider: explicit, else whichever key is present
  let provider: ProviderId | null = null;
  const requested = env.LLM_PROVIDER?.trim().toLowerCase();
  if (requested && requested !== "off" && requested !== "none") {
    if (isProviderId(requested)) provider = requested;
    else warnings.push(`LLM_PROVIDER="${requested}" is unknown (use groq, xai, gemini, openrouter or custom).`);
  }
  const keyFor = (id: ProviderId): string | undefined => {
    for (const name of PROVIDERS[id].keyEnv) if (env[name]?.trim()) return env[name]!.trim();
    return env.LLM_API_KEY?.trim() || undefined;
  };
  if (!provider && requested !== "off" && requested !== "none") {
    for (const id of ["groq", "xai", "gemini", "openrouter"] as const) {
      if (env[PROVIDERS[id].keyEnv[0]!]?.trim() || PROVIDERS[id].keyEnv.some((n) => env[n]?.trim())) {
        provider = id;
        break;
      }
    }
    if (!provider && env.LLM_API_KEY?.trim() && env.LLM_BASE_URL?.trim()) provider = "custom";
  }
  const preset = provider ? PROVIDERS[provider] : null;
  const llmKey = provider ? keyFor(provider) : undefined;
  const llmBase = preset
    ? cleanUrl(env.LLM_BASE_URL, preset.baseUrl, "LLM_BASE_URL", warnings, mockOk)
    : "";
  if (provider === "custom" && !llmBase) warnings.push("LLM_PROVIDER=custom needs LLM_BASE_URL.");
  if (provider && !llmKey) warnings.push(`LLM provider "${provider}" is selected but no API key was found; the mirror will use its built-in rules.`);

  const config: Config = {
    youcam: {
      apiKey,
      baseUrl: cleanUrl(env.YOUCAM_BASE_URL, "https://yce-api-01.makeupar.com", "YOUCAM_BASE_URL", warnings, mockOk),
      skinVersion,
      actions,
      strictness,
      tone: readBool(env, "YOUCAM_TONE", true, warnings),
      cost: {
        skin: readInt(env, "YOUCAM_COST_SKIN", 12, 1, 1000, warnings),
        tone: readInt(env, "YOUCAM_COST_TONE", 3, 0, 1000, warnings),
        look: readInt(env, "YOUCAM_COST_LOOK", 8, 1, 1000, warnings),
      },
    },
    limits: {
      dailyUnits: readInt(env, "DARPAN_DAILY_UNITS", 240, 0, 1_000_000, warnings),
      ipDailyUnits: readInt(env, "DARPAN_IP_DAILY_UNITS", 60, 0, 1_000_000, warnings),
      minBalance: readInt(env, "DARPAN_MIN_BALANCE", 0, 0, 1_000_000, warnings),
      scanCooldownSec: readInt(env, "DARPAN_SCAN_COOLDOWN_SEC", 20, 0, 3600, warnings),
      chatPerMinute: readInt(env, "DARPAN_CHAT_PER_MIN", 30, 1, 1000, warnings),
      visionPerMinute: readInt(env, "DARPAN_VISION_PER_MIN", 6, 1, 1000, warnings),
      maxImageBytes: readInt(env, "DARPAN_MAX_IMAGE_BYTES", 6_000_000, 100_000, 9_000_000, warnings),
    },
    demoOnly: readBool(env, "DARPAN_DEMO_ONLY", false, warnings),
    llm: {
      provider: provider && preset ? provider : null,
      label: preset?.label ?? "off",
      apiKey: llmKey,
      baseUrl: llmBase,
      chatModels: readList(env, "LLM_MODEL"),
      visionModels: readList(env, "LLM_VISION_MODEL"),
      jsonMode: readBool(env, "LLM_JSON_MODE", preset?.jsonMode ?? true, warnings),
      timeoutMs: readInt(env, "LLM_TIMEOUT_MS", 12_000, 2_000, 60_000, warnings),
    },
    allowedOrigins: readList(env, "ALLOWED_ORIGINS").flatMap((o) => {
      try {
        return [new URL(o).origin];
      } catch {
        warnings.push(`ALLOWED_ORIGINS entry "${o}" is not a URL and was ignored.`);
        return [];
      }
    }),
    kv: {
      url: cleanUrl(env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL, "", "UPSTASH_REDIS_REST_URL", warnings) || undefined,
      token: (env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN)?.trim() || undefined,
    },
    warnings,
  };
  if (config.kv.url && !config.kv.token) {
    warnings.push("An Upstash URL is set without a token; using in-memory limits only.");
    config.kv.url = undefined;
  }
  return config;
}

let cached: Config | null = null;

/** The process-wide configuration. */
export function getConfig(): Config {
  cached ??= loadConfig();
  return cached;
}

export function resetConfigForTests(next?: Config): void {
  cached = next ?? null;
}

// ------------------------------------------------------------- derived modes

export type Mode = "live" | "demo";

export function skinMode(c: Config): Mode {
  return c.youcam.apiKey && !c.demoOnly ? "live" : "demo";
}

export function llmLive(c: Config): boolean {
  return Boolean(c.llm.provider && c.llm.apiKey && c.llm.baseUrl);
}
