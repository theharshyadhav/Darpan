/**
 * Free-tier-friendly LLM providers, all spoken to through the same OpenAI-compatible
 * `/chat/completions` shape. Darpan defaults to Groq because it has a genuinely free tier and no
 * card on file; xAI Grok, Google Gemini and OpenRouter are one environment variable away.
 *
 * Model ids drift quickly, so the app asks the provider's `/models` endpoint what is live and picks
 * by preference pattern. The static lists below are only a last resort if discovery fails.
 */

export type ProviderId = "groq" | "xai" | "gemini" | "openrouter" | "custom";

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  baseUrl: string;
  /** Environment variables that may hold this provider's key, in priority order. */
  keyEnv: readonly string[];
  /** Patterns matched against the provider's model ids, best first. */
  chat: readonly RegExp[];
  vision: readonly RegExp[];
  fallbackChat: readonly string[];
  fallbackVision: readonly string[];
  /** Whether `response_format: {type: "json_object"}` is generally accepted. */
  jsonMode: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  groq: {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    keyEnv: ["GROQ_API_KEY"],
    chat: [/llama-3\.3-70b/i, /gpt-oss-120b/i, /llama-4-maverick/i, /qwen.*(32b|3)/i, /llama-3\.1-8b/i, /gpt-oss-20b/i],
    vision: [/llama-4-scout/i, /llama-4-maverick/i, /vision/i, /\bvl\b/i],
    fallbackChat: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    fallbackVision: ["meta-llama/llama-4-scout-17b-16e-instruct"],
    jsonMode: true,
  },
  xai: {
    id: "xai",
    label: "xAI Grok",
    baseUrl: "https://api.x.ai/v1",
    keyEnv: ["XAI_API_KEY", "GROK_API_KEY"],
    chat: [/grok-4.*fast/i, /grok-3-mini/i, /grok-4/i, /grok-3/i, /grok/i],
    vision: [/grok-4/i, /vision/i, /grok-2-vision/i],
    fallbackChat: ["grok-4-fast", "grok-3-mini"],
    fallbackVision: ["grok-4-fast"],
    jsonMode: true,
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    chat: [/gemini-2\.5-flash(?!-lite|-image)/i, /gemini-.*flash(?!-lite|-image)/i, /gemini-.*flash-lite/i, /gemini/i],
    vision: [/gemini-2\.5-flash(?!-lite|-image)/i, /gemini-.*flash/i, /gemini/i],
    fallbackChat: ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
    fallbackVision: ["gemini-2.5-flash"],
    jsonMode: true,
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnv: ["OPENROUTER_API_KEY"],
    chat: [/llama-3\.3-70b-instruct:free/i, /:free$/i],
    vision: [/vision.*:free/i, /(gemma|qwen).*vl.*:free/i, /:free$/i],
    fallbackChat: ["meta-llama/llama-3.3-70b-instruct:free"],
    fallbackVision: [],
    jsonMode: false,
  },
  custom: {
    id: "custom",
    label: "Custom OpenAI-compatible",
    baseUrl: "",
    keyEnv: ["LLM_API_KEY"],
    chat: [/./],
    vision: [/vision|vl|4o|gemini|grok|llava|pixtral/i],
    fallbackChat: [],
    fallbackVision: [],
    jsonMode: true,
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function isProviderId(v: unknown): v is ProviderId {
  return typeof v === "string" && (PROVIDER_IDS as string[]).includes(v);
}

/** Ids that are never a chat model, whatever the provider calls them. */
const NOT_CHAT = /whisper|tts|speech|transcri|guard|safeguard|embed|moderation|rerank|audio|image-gen|imagen|veo|dall-?e|orpheus|playai|vision-preview-ocr/i;

/**
 * Choose up to `limit` model ids from a provider's live model list, honouring the preference
 * order. Anything unmatched comes after the matched ones, so an unknown-but-live model beats none.
 */
export function pickModels(available: readonly string[], prefs: readonly RegExp[], limit = 4): string[] {
  const usable = [...new Set(available.filter((id) => id && !NOT_CHAT.test(id)))].sort();
  const picked: string[] = [];
  for (const re of prefs) {
    for (const id of usable) {
      if (re.test(id) && !picked.includes(id)) picked.push(id);
      if (picked.length >= limit) return picked;
    }
  }
  return picked;
}
