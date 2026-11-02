/**
 * The claim linter: the last gate between any text and the mirror's voice.
 *
 * Darpan speaks in cosmetic language only ("looks", "appears"). It never diagnoses,
 * never names a medical condition, never promises results and never calls anything
 * "flawless". Kindness lives in the tone; honesty lives in the data.
 *
 * The same rules run in three places:
 *  1. at runtime, on every utterance, right before text-to-speech (src/lib/voice/tts.ts),
 *  2. on the server, on every model reply before it is returned (src/lib/llm/mirror.ts),
 *  3. in CI (`npm run lint:claims`), against every canned line in every language.
 *
 * Patterns are Unicode-aware (Latin + Devanagari) and avoid look-behind so they also
 * compile on older Safari versions.
 */

export type RuleKind = "medical" | "absolute" | "promise" | "shaming" | "referral";

export interface ClaimRule {
  id: string;
  kind: RuleKind;
  /** Regex source for the alternation of words/phrases (matched whole-word, case-insensitive). */
  source: string;
  /** "replace" swaps the word for something kinder; "drop" removes the whole sentence. */
  action: "drop" | "replace";
  replacement?: string;
}

export const CLAIM_RULES: readonly ClaimRule[] = [
  // ----- medical language: never spoken -----
  {
    id: "medical-terms",
    kind: "medical",
    action: "drop",
    source:
      "diagnos(?:e|es|ed|ing|is|tic)|cure[sd]?|curing|heal(?:s|ed|ing)?|therap(?:y|ies|eutic)|prescri(?:be|bes|bed|ption|ptions)|medicat(?:ion|ions|ed|e)|medical(?:ly)?|clinical(?:ly)?|disease[sd]?|disorders?|syndromes?|infect(?:ion|ions|ed|ious)|lesions?|allerg(?:y|ies|ic)|skin conditions?",
  },
  {
    id: "named-conditions",
    kind: "medical",
    action: "drop",
    source:
      "acne|dermatitis|eczema|psoriasis|rosacea|melasma|vitiligo|hives|urticaria|folliculitis|keratosis|cystic|pustul(?:e|es|ar)|cancer(?:ous)?|precancerous|melanoma|carcinoma|tumou?rs?|malignan(?:t|cy)",
  },
  {
    id: "medical-treat",
    kind: "medical",
    action: "drop",
    source:
      "treat(?:s|ed|ing)? (?:your |the |my |this |that |these )?(?:acne|rosacea|eczema|skin|conditions?|diseases?|infections?|breakouts?)|treatment of",
  },
  // ----- absolute praise: swapped for something honest and warm -----
  { id: "flawlessly", kind: "absolute", action: "replace", replacement: "beautifully", source: "flawlessly|perfectly|impeccably" },
  { id: "flawless", kind: "absolute", action: "replace", replacement: "lovely", source: "flawless|perfect|impeccable" },
  { id: "perfection", kind: "absolute", action: "drop", source: "perfection|blemish-?free|no flaws?|without (?:a )?flaws?|ageless" },
  // ----- promises and guarantees -----
  {
    id: "guarantees",
    kind: "promise",
    action: "drop",
    source:
      "guarantee[sd]?|guaranteeing|miracles?|proven|scientifically proven|always works|never fails|100 ?%|hundred percent|permanent(?:ly)?|instantly",
  },
  {
    id: "will-fix",
    kind: "promise",
    action: "drop",
    source:
      "will (?:definitely |certainly |surely |totally |completely )?(?:fix|clear|cure|erase|remove|eliminate|heal|solve|banish|reverse|get rid of)",
  },
  {
    id: "erase-claims",
    kind: "promise",
    action: "drop",
    source:
      "(?:erase|erases|erased|eliminate|eliminates|eliminated|banish|banishes|reverse|reverses|get rid of|gets rid of) (?:your |the |all |any )?(?:wrinkles?|fine lines|lines|spots?|scars?|marks?|blemish(?:es)?|pores?|dark circles?)|(?:years|decades) younger|younger[- ]looking|anti-?ag(?:e)?ing",
  },
  // ----- shaming: the mirror never shames -----
  {
    id: "shaming",
    kind: "shaming",
    action: "drop",
    source: "ugly|disgusting|gross|terrible|awful|horrible|hideous|worst|damaged skin|bad skin|unhealthy skin|ruined",
  },
  // ----- Hindi (Devanagari) -----
  {
    id: "hi-medical",
    kind: "medical",
    action: "drop",
    source:
      "इलाज|उपचार|बीमारी|रोग|निदान|संक्रमण|कैंसर|दवा|दवाई|एलर्जी|चिकित्सा|चिकित्सकीय|डॉक्टर|त्वचा रोग|एक्ने|मुँहासे|मुंहासे|मुहांसे",
  },
  {
    id: "hi-absolute",
    kind: "promise",
    action: "drop",
    source: "बेदाग|परफेक्ट|परफ़ेक्ट|गारंटी|चमत्कार|चमत्कारी|स्थायी|हमेशा के लिए|सौ प्रतिशत|100 ?%",
  },
  // ----- Hinglish (Roman Hindi) -----
  {
    id: "hinglish-medical",
    kind: "medical",
    action: "drop",
    source: "ilaaj|ilaj|upchar|bimari|beemari|bimaari|rog|nidan|sankraman|dawai|dawa|dava|doctor|physician|hospital|clinic",
  },
  {
    id: "hinglish-absolute",
    kind: "promise",
    action: "drop",
    source: "bedaag|bedag|chamatkar|chamatkari|gaarantee|hamesha ke liye|sau percent",
  },
];

/**
 * The one referral Darpan may ever make. These exact phrases are removed before scanning,
 * so any OTHER mention of a dermatologist, doctor or clinic is flagged.
 */
export const GENERIC_REFERRALS: readonly string[] = [
  "a dermatologist can help if something worries you",
  "कोई बात चिंतित करे तो त्वचा विशेषज्ञ मदद कर सकते हैं",
  "agar kuch chinta kare to dermatologist madad kar sakte hain",
];

const REFERRAL_WORDS = "dermatolog(?:ist|ists|y|ical)|त्वचा विशेषज्ञ|डर्मेटोलॉजिस्ट";

export interface Violation {
  rule: string;
  kind: RuleKind;
  match: string;
}

export interface LintResult {
  ok: boolean;
  violations: Violation[];
}

const WORD_PREFIX = "(^|[^\\p{L}\\p{M}\\p{N}_])";
const WORD_SUFFIX = "(?![\\p{L}\\p{M}\\p{N}_])";

function wordRegex(source: string, flags = "iu"): RegExp {
  return new RegExp(`${WORD_PREFIX}(${source})${WORD_SUFFIX}`, flags);
}

function stripAllowedReferral(text: string): string {
  let out = text;
  for (const phrase of GENERIC_REFERRALS) {
    const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
    out = out.replace(re, " ");
  }
  return out;
}

/** Scan text and report every rule it breaks. Pure and synchronous. */
export function lintUtterance(text: string): LintResult {
  const violations: Violation[] = [];
  const scan = stripAllowedReferral(text);

  for (const rule of CLAIM_RULES) {
    const m = wordRegex(rule.source).exec(scan);
    if (m) violations.push({ rule: rule.id, kind: rule.kind, match: m[2] ?? "" });
  }
  const ref = wordRegex(REFERRAL_WORDS).exec(scan);
  if (ref) violations.push({ rule: "referral-nongeneric", kind: "referral", match: ref[2] ?? "" });

  return { ok: violations.length === 0, violations };
}

function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?।]+[.!?।]*\s*/gu);
  return parts ? parts.map((p) => p.trim()).filter(Boolean) : [];
}

function applyReplacements(text: string): string {
  let out = text;
  for (const rule of CLAIM_RULES) {
    if (rule.action !== "replace" || !rule.replacement) continue;
    const re = wordRegex(rule.source, "giu");
    const replacement = rule.replacement;
    out = out.replace(re, (_whole, pre: string, word: string) => {
      // keep a leading capital when the original word was capitalised
      const cap = word.charAt(0) !== word.charAt(0).toLowerCase();
      const r = cap ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;
      return `${pre}${r}`;
    });
  }
  return out;
}

export interface SanitizeResult {
  text: string;
  changed: boolean;
  /** True when nothing survived and the fallback line was used. */
  usedFallback: boolean;
  violations: Violation[];
}

/**
 * Make text safe to speak. Absolute praise is softened in place; any sentence that breaks a
 * medical, promise or shaming rule is dropped. If nothing is left, the fallback line is used.
 */
export function sanitizeUtterance(text: string, fallback: string): SanitizeResult {
  const first = lintUtterance(text);
  if (first.ok) return { text, changed: false, usedFallback: false, violations: [] };

  const softened = applyReplacements(text);
  const kept = splitSentences(softened).filter((s) => lintUtterance(s).ok);
  const candidate = kept.join(" ").trim();

  if (candidate.length > 0 && lintUtterance(candidate).ok) {
    return { text: candidate, changed: true, usedFallback: false, violations: first.violations };
  }
  return { text: fallback, changed: true, usedFallback: true, violations: first.violations };
}

const WORD_CHAR = /[\p{L}\p{M}\p{N}_]/u;

/**
 * Keep the title to a single mention so the warmth stays believable ("a setting and a rhythm, not
 * a tic"). The first mention is kept exactly as written; later ones are removed together with
 * their commas, and a sentence that loses its opening title gets its capital letter back.
 */
export function limitTitleMentions(text: string, title: string): string {
  const t = title.trim();
  if (!t) return text;
  const re = new RegExp(`(,\\s*)?${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s*,)?`, "giu");

  let out = "";
  let last = 0;
  let seen = 0;
  let capNext = false;
  const append = (chunk: string) => {
    let c = chunk;
    if (capNext) {
      const m = /^(\s*)(\p{L})/u.exec(c);
      if (m) {
        c = `${m[1]}${m[2]!.toUpperCase()}${c.slice(m[0].length)}`;
        capNext = false;
      } else if (c.trim() !== "") {
        capNext = false;
      }
    }
    out += c;
  };

  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    const lead = m[1] ?? "";
    const trail = m[2] ?? "";
    const start = idx + lead.length;
    const end = start + t.length;
    // whole phrase only: "Maharani" inside another word is not a mention
    if ((start > 0 && WORD_CHAR.test(text.charAt(start - 1))) || (end < text.length && WORD_CHAR.test(text.charAt(end)))) {
      continue;
    }
    seen += 1;
    if (seen === 1) continue;
    append(text.slice(last, idx));
    last = idx + m[0].length;
    if (lead === "" && trail !== "" && /(?:^|[.!?।]\s+)$/u.test(out)) capNext = true;
  }
  if (seen < 2) return text;
  append(text.slice(last));

  return out
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?।])/g, "$1")
    .replace(/([.!?।])\s*,/g, "$1")
    .replace(/^\s*,\s*/, "")
    .trim();
}
