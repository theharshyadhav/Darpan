import type { Language, Pace } from "@/lib/types";

/**
 * Pure helpers for the mirror's voice: how to cut a sentence so long ones are never dropped by the
 * browser, which installed voice reads a language best, and how long to wait before assuming the
 * browser forgot to tell us it finished. No DOM here, so all of it is tested without a browser.
 */

export interface VoiceLike {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
}

/** Chrome silently stops long utterances after about 15 seconds, so each piece stays short. */
export const MAX_CHUNK = 170;

const STOPS = /([.!?…।॥]+["')\]]*)\s+/;

/** Split text into pieces of at most `max` characters, preferring sentence ends, then commas, then spaces. */
export function chunkSentences(text: string, max = MAX_CHUNK): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences: string[] = [];
  const parts = clean.split(STOPS);
  for (let i = 0; i < parts.length; i += 2) {
    const s = `${parts[i] ?? ""}${parts[i + 1] ?? ""}`.trim();
    if (s) sentences.push(s);
  }

  const out: string[] = [];
  for (const s of sentences) {
    if (s.length <= max) {
      const last = out[out.length - 1];
      // join short neighbours so there is no choppy pause between "Yes." and "Of course."
      if (last && last.length + 1 + s.length <= max) out[out.length - 1] = `${last} ${s}`;
      else out.push(s);
      continue;
    }
    out.push(...splitLong(s, max));
  }
  return out;
}

function splitLong(s: string, max: number): string[] {
  const out: string[] = [];
  let rest = s;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "), window.lastIndexOf(": "), window.lastIndexOf(" — "));
    if (cut < max * 0.4) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = max;
    else cut += 1;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

const norm = (t: string) => t.toLowerCase().replace(/_/g, "-");
const primary = (t: string) => norm(t).split("-")[0]!;

const QUALITY = /natural|neural|premium|enhanced|online|google|siri|samantha|lekha|kalpana|heera/i;

/** A rough "how good is this voice for that language" score. Zero means it does not speak the language. */
export function scoreVoice(v: VoiceLike, tag: string): number {
  const want = norm(tag);
  const have = norm(v.lang);
  let score = 0;
  if (have === want) score = 100;
  else if (primary(have) === primary(want)) {
    // for Indian English, near neighbours read Roman Hindi better than a US voice does
    const near = want === "en-in" ? ["en-gb", "en-au"] : [];
    score = near.includes(have) ? 70 : 55;
  } else return 0;
  if (QUALITY.test(v.name)) score += 12;
  if (v.localService) score += 3;
  return score;
}

/** The voice to use: the person's own choice if it still exists, otherwise the best match, otherwise none. */
export function pickVoice<T extends VoiceLike>(voices: readonly T[], tag: string, preferredUri: string): T | null {
  if (preferredUri) {
    const chosen = voices.find((v) => v.voiceURI === preferredUri);
    if (chosen) return chosen;
  }
  let best: T | null = null;
  let bestScore = 0;
  for (const v of voices) {
    const s = scoreVoice(v, tag);
    if (s > bestScore) {
      best = v;
      bestScore = s;
    }
  }
  return best;
}

export function rateFor(pace: Pace): number {
  return pace === "calm" ? 0.92 : pace === "brisk" ? 1.12 : 1;
}

/** How long one piece may take before the mirror stops waiting for a browser that never said "done". */
export function watchdogMs(text: string, rate: number): number {
  return Math.round(3000 + (Array.from(text).length * 110) / Math.max(0.5, rate));
}

/** True when at least one installed voice speaks the language. */
export function hasVoiceFor(voices: readonly VoiceLike[], lang: Language, browserLang?: string): boolean {
  const tag = lang === "hi" ? "hi-IN" : lang === "hinglish" ? "en-IN" : browserLang && /^en\b/i.test(browserLang) ? browserLang : "en-US";
  return voices.some((v) => scoreVoice(v, tag) > 0);
}
