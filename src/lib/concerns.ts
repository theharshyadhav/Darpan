import type { Language } from "./types";

/**
 * The seven YouCam *SD* skin concerns Darpan measures. Seven keeps one scan inside
 * the "5 to 7 concerns" price tier. Every `ui_score` is 0-100 and HIGHER IS BETTER
 * (fewer visible pores, better hydration, ...), so every gauge reads "more is better".
 */
export const CONCERN_KEYS = ["moisture", "oiliness", "redness", "radiance", "texture", "pore", "acne"] as const;
export type ConcernKey = (typeof CONCERN_KEYS)[number];

/** Every SD action YouCam accepts. SD and HD actions can never be mixed in one request. */
export const SD_ACTIONS = [
  "wrinkle",
  "droopy_upper_eyelid",
  "droopy_lower_eyelid",
  "firmness",
  "acne",
  "moisture",
  "eye_bag",
  "dark_circle_v2",
  "age_spot",
  "radiance",
  "redness",
  "oiliness",
  "pore",
  "texture",
  "tear_trough",
  "skin_type",
] as const;
export type SdAction = (typeof SD_ACTIONS)[number];

export interface ConcernMeta {
  key: ConcernKey;
  /** Playful gem name for the jewel gauge. */
  gem: string;
  /** Vibrant fill colour, used for strokes and chips. */
  color: string;
  /** Deeper shade with AA contrast on light backgrounds, used for text. */
  ink: string;
  /** Cosmetic, positive-direction label (higher score = more of this). */
  label: Record<Language, string>;
}

export const CONCERNS: Record<ConcernKey, ConcernMeta> = {
  moisture: {
    key: "moisture",
    gem: "Sapphire",
    color: "#2f6bff",
    ink: "#1d49c2",
    label: { en: "Hydration", hi: "नमी", hinglish: "Hydration" },
  },
  oiliness: {
    key: "oiliness",
    gem: "Citrine",
    color: "#ffb020",
    ink: "#8a5a00",
    label: { en: "Oil balance", hi: "तेल संतुलन", hinglish: "Oil balance" },
  },
  redness: {
    key: "redness",
    gem: "Rose quartz",
    color: "#ff4f9a",
    ink: "#b3125f",
    label: { en: "Calm tone", hi: "शांत रंगत", hinglish: "Calm tone" },
  },
  radiance: {
    key: "radiance",
    gem: "Amethyst",
    color: "#7a4dff",
    ink: "#5732c7",
    label: { en: "Radiance", hi: "दमक", hinglish: "Radiance" },
  },
  texture: {
    key: "texture",
    gem: "Emerald",
    color: "#10bf8a",
    ink: "#07775a",
    label: { en: "Smoothness", hi: "कोमलता", hinglish: "Smoothness" },
  },
  pore: {
    key: "pore",
    gem: "Turquoise",
    color: "#00b3a4",
    ink: "#007a70",
    label: { en: "Fine pores", hi: "महीन रोमछिद्र", hinglish: "Fine pores" },
  },
  acne: {
    key: "acne",
    gem: "Coral",
    color: "#ff6f4c",
    ink: "#b8381a",
    label: { en: "Clarity", hi: "निखार", hinglish: "Clarity" },
  },
};

export function isConcernKey(v: unknown): v is ConcernKey {
  return typeof v === "string" && (CONCERN_KEYS as readonly string[]).includes(v);
}

export function concernLabel(key: ConcernKey, lang: Language): string {
  return CONCERNS[key].label[lang];
}

/** Validate a configured action list: SD only, known names, no duplicates, max 7 (price tier). */
export function sanitizeSkinActions(input: readonly string[] | undefined): SdAction[] {
  const fallback = [...CONCERN_KEYS] as SdAction[];
  if (!input || input.length === 0) return fallback;
  const seen = new Set<string>();
  const out: SdAction[] = [];
  for (const raw of input) {
    const name = raw.trim();
    if (!(SD_ACTIONS as readonly string[]).includes(name)) continue; // drops HD and typos
    if (name === "skin_type") continue; // a label, not a score
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name as SdAction);
    if (out.length === 7) break;
  }
  return out.length > 0 ? out : fallback;
}
