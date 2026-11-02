import type { Language, Settings } from "../types";
import { lintUtterance } from "./lint";

export interface TitlePreset {
  id: string;
  en: string;
  hi: string;
}

export const TITLE_PRESETS: readonly TitlePreset[] = [
  { id: "highness", en: "Your Highness", hi: "हुज़ूर" },
  { id: "excellency", en: "Your Excellency", hi: "महामहिम" },
  { id: "majesty", en: "Your Majesty", hi: "जहाँपनाह" },
  { id: "maharani", en: "Maharani", hi: "महारानी" },
  { id: "rajkumari", en: "Rajkumari", hi: "राजकुमारी" },
];

export const MAX_TITLE_LENGTH = 24;

/** Strip control characters and markup from a custom title, then cap its length. */
export function cleanCustomTitle(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>"`\\{}]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
}

/** The title the mirror speaks, in the active language. Falls back to a preset if a custom one is unsafe. */
export function titleFor(s: Pick<Settings, "titleId" | "customTitle" | "language">): string {
  if (s.titleId === "custom") {
    const t = cleanCustomTitle(s.customTitle);
    if (t.length > 0 && lintUtterance(t).ok) return t;
  }
  const preset = TITLE_PRESETS.find((p) => p.id === s.titleId) ?? TITLE_PRESETS[0]!;
  return s.language === "hi" ? preset.hi : preset.en;
}

export type TurnKind = "greeting" | "win" | "normal";

/**
 * "Your Highness" is a setting and a rhythm, not a tic: always at greetings and wins,
 * otherwise about every third mirror turn.
 */
export function shouldUseTitle(turnIndex: number, kind: TurnKind = "normal"): boolean {
  if (kind === "greeting" || kind === "win") return true;
  return turnIndex % 3 === 0;
}

export function addressee(title: string | undefined): string {
  return title ? `, ${title}` : "";
}

/**
 * BCP-47 tag for speech recognition and synthesis. Hinglish (Hindi in Roman letters) is spoken and
 * recognised with an Indian-English voice, which reads Roman Hindi far better than a US voice does.
 */
export function languageTag(lang: Language, browserLang?: string): string {
  if (lang === "hi") return "hi-IN";
  if (lang === "hinglish") return "en-IN";
  return browserLang && /^en\b/i.test(browserLang) ? browserLang : "en-US";
}
