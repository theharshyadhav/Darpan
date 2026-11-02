import type { Period } from "../types";
import { lintUtterance } from "../persona/lint";

export type SlotId =
  | "oil_cleanse"
  | "cleanse"
  | "tone"
  | "exfoliate"
  | "treat"
  | "serum"
  | "eye"
  | "moisturize"
  | "oil"
  | "protect"
  | "extra";

export type TimerKind = "massage" | "settle" | "mask" | "custom";

export const CATEGORIES = [
  "oil_cleanser",
  "cleanser",
  "toner",
  "essence",
  "exfoliant_aha",
  "exfoliant_bha",
  "exfoliant_pha",
  "retinoid",
  "benzoyl",
  "vitamin_c",
  "azelaic",
  "niacinamide",
  "hyaluronic",
  "peptide",
  "serum",
  "eye",
  "moisturizer",
  "oil",
  "sunscreen",
  "mask",
  "spot",
  "lip",
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface CategoryInfo {
  slot: SlotId;
  /** Where it normally sits in a layered ritual (thin to thick, cleanse to protect). */
  layer: number;
  /** How "strong" an active it is, used to notice when a sitting gets crowded. */
  activeWeight: number;
  /** A gentle wait or duration the mirror can time for you. */
  timer?: { seconds: number; kind: TimerKind };
  /** Plain-language name used when the mirror has to say what it heard. */
  plain: string;
}

export const SLOT_LAYER: Record<SlotId, number> = {
  oil_cleanse: 0,
  cleanse: 1,
  tone: 2,
  exfoliate: 3,
  treat: 4,
  serum: 5,
  eye: 6,
  moisturize: 7,
  oil: 8,
  protect: 9,
  extra: -1,
};

export const CATEGORY_INFO: Record<Category, CategoryInfo> = {
  oil_cleanser: { slot: "oil_cleanse", layer: 0, activeWeight: 0, timer: { seconds: 60, kind: "massage" }, plain: "cleansing oil or balm" },
  cleanser: { slot: "cleanse", layer: 1, activeWeight: 0, timer: { seconds: 60, kind: "massage" }, plain: "cleanser" },
  toner: { slot: "tone", layer: 2, activeWeight: 0, plain: "toner" },
  essence: { slot: "tone", layer: 2, activeWeight: 0, plain: "essence" },
  exfoliant_aha: { slot: "exfoliate", layer: 3, activeWeight: 1, timer: { seconds: 60, kind: "settle" }, plain: "AHA exfoliant" },
  exfoliant_bha: { slot: "exfoliate", layer: 3, activeWeight: 1, timer: { seconds: 60, kind: "settle" }, plain: "BHA exfoliant" },
  exfoliant_pha: { slot: "exfoliate", layer: 3, activeWeight: 1, timer: { seconds: 60, kind: "settle" }, plain: "PHA exfoliant" },
  retinoid: { slot: "treat", layer: 4, activeWeight: 1, timer: { seconds: 60, kind: "settle" }, plain: "retinol" },
  benzoyl: { slot: "treat", layer: 4, activeWeight: 1, timer: { seconds: 60, kind: "settle" }, plain: "benzoyl peroxide" },
  vitamin_c: { slot: "treat", layer: 4, activeWeight: 0.5, timer: { seconds: 45, kind: "settle" }, plain: "vitamin C serum" },
  azelaic: { slot: "treat", layer: 4, activeWeight: 0.5, timer: { seconds: 45, kind: "settle" }, plain: "azelaic acid" },
  niacinamide: { slot: "serum", layer: 5, activeWeight: 0, timer: { seconds: 30, kind: "settle" }, plain: "niacinamide serum" },
  hyaluronic: { slot: "serum", layer: 5, activeWeight: 0, timer: { seconds: 20, kind: "settle" }, plain: "hydrating serum" },
  peptide: { slot: "serum", layer: 5, activeWeight: 0, timer: { seconds: 30, kind: "settle" }, plain: "peptide serum" },
  serum: { slot: "serum", layer: 5, activeWeight: 0, timer: { seconds: 30, kind: "settle" }, plain: "serum" },
  eye: { slot: "eye", layer: 6, activeWeight: 0, plain: "eye care" },
  moisturizer: { slot: "moisturize", layer: 7, activeWeight: 0, plain: "moisturizer" },
  oil: { slot: "oil", layer: 8, activeWeight: 0, plain: "face oil" },
  sunscreen: { slot: "protect", layer: 9, activeWeight: 0, timer: { seconds: 120, kind: "settle" }, plain: "sunscreen" },
  mask: { slot: "extra", layer: -1, activeWeight: 0, timer: { seconds: 600, kind: "mask" }, plain: "mask" },
  spot: { slot: "extra", layer: -1, activeWeight: 0, plain: "spot care" },
  lip: { slot: "extra", layer: -1, activeWeight: 0, plain: "lip care" },
};

export function isCategory(v: unknown): v is Category {
  return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
}

export function isExfoliant(c: Category): boolean {
  return c === "exfoliant_aha" || c === "exfoliant_bha" || c === "exfoliant_pha";
}

/**
 * Ordered most-specific to most-general, so "vitamin C serum" is vitamin C (not a plain serum)
 * and "sunscreen moisturizer" is sunscreen. Latin keywords plus common Devanagari spellings that
 * speech recognition produces for Hindi speakers.
 */
const RULES: ReadonlyArray<readonly [Category, RegExp]> = [
  ["sunscreen", /\b(?:sun ?screen|sun ?block|spf|sun cream|uv (?:protection|shield|gel|fluid))\b|सनस्क्रीन|सन ?ब्लॉक/iu],
  ["oil_cleanser", /\b(?:cleansing (?:oil|balm)|oil cleanser|balm cleanser|makeup remover (?:oil|balm))\b/iu],
  ["eye", /\b(?:eye (?:cream|gel|serum|care)|under ?eye)\b|आई क्रीम/iu],
  ["retinoid", /\b(?:retinol|retinal|retinaldehyde|retinoids?|tretinoin|adapalene|differin|retin ?a)\b|रेटिनॉल|रेटिनोल/iu],
  ["benzoyl", /\b(?:benzoyl|bpo)\b|बेंज़ॉयल|बेंजॉयल/iu],
  ["vitamin_c", /\b(?:vitamin c|vit c|vitc|ascorbic|ascorbyl|l-ascorbic)\b|विटामिन सी/iu],
  ["exfoliant_bha", /\b(?:bha|salicylic)\b|सैलिसिलिक/iu],
  ["exfoliant_pha", /\b(?:pha|gluconolactone|lactobionic)\b/iu],
  ["exfoliant_aha", /\b(?:aha|glycolic|lactic|mandelic|peel|exfoliant|exfoliating)\b|ग्लाइकोलिक|एक्सफ़ोलिएंट|एक्सफोलिएंट/iu],
  ["azelaic", /\bazelaic\b/iu],
  ["niacinamide", /\b(?:niacinamide|vitamin b3|nicotinamide)\b|नियासिनामाइड/iu],
  ["hyaluronic", /\b(?:hyaluronic|hyaluronate|ha serum|hydrating serum)\b|हायलूरोनिक|हयालूरोनिक/iu],
  ["peptide", /\b(?:peptides?|copper peptide)\b|पेप्टाइड/iu],
  ["spot", /\b(?:spot treatment|pimple patch|blemish patch)\b/iu],
  ["lip", /\blip (?:balm|mask|care)\b/iu],
  ["mask", /\b(?:face mask|sheet mask|clay mask|mud mask|sleeping mask|mask)\b|मास्क/iu],
  ["toner", /\b(?:toner|tonic|astringent)\b|टोनर/iu],
  ["essence", /\b(?:essence|mist)\b|एसेंस/iu],
  ["cleanser", /\b(?:cleanser|face ?wash|cleansing|micellar|foaming|wash)\b|क्लींज़र|क्लींजर|क्लेंज़र|फेस ?वॉश|फ़ेस ?वॉश/iu],
  ["oil", /\b(?:face oil|facial oil|rosehip|jojoba|squalane|argan)\b|फेस ऑयल/iu],
  ["moisturizer", /\b(?:moisturi[sz]er|moisturi[sz]ing|cream|lotion|gel cream|barrier|emollient)\b|मॉइस्चराइज़र|मॉइस्चराइजर|मॉइश्चराइज़र|क्रीम|लोशन/iu],
  ["serum", /\b(?:serum|ampoule|booster|concentrate)\b|सीरम/iu],
  ["oil", /\boil\b/iu],
];

export interface Classified {
  category: Category;
  /** The phrase the person used, trimmed for display. */
  name: string;
}

const FILLER =
  /^(?:i(?:'m| am)?\s+(?:now\s+)?(?:applying|using|putting on|wearing|doing)|now\s+(?:applying|using)|this is|it is|it's|that is|that's|my|some)\s+/iu;

// "the vitamin C serum" loses its article, but "The Ordinary niacinamide" keeps it: a capital letter
// after the article means a brand. Deliberately case-sensitive (a \p{Ll} class with /i matches capitals).
const ARTICLE = /^(?:[Tt]he|[Aa]n?)\s+(?=[\p{Ll}\d])/u;
const BRAND_ARTICLE = /^the\s+(?=\p{Lu})/u;

function tidy(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f<>"`\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Turn "I'm putting on my vitamin C serum" into a short display name. Text read off a label (the
 * camera) is already a name, so it only gets tidied, never stripped of filler.
 */
export function cleanProductName(raw: string, source: "spoken" | "label" = "spoken"): string {
  let s = tidy(raw);
  if (source === "spoken") {
    for (let i = 0; i < 4; i += 1) {
      const next = s.replace(FILLER, "").replace(ARTICLE, "");
      if (next === s) break;
      s = next;
    }
    s = s.replace(BRAND_ARTICLE, "The ");
  }
  s = s.replace(/[.!?।,;:]+$/u, "").trim();
  return s.slice(0, 60);
}

export function classifyProduct(text: string): Classified | null {
  const name = cleanProductName(text);
  if (!name) return null;
  for (const [category, re] of RULES) {
    if (re.test(name)) return { category, name };
  }
  return null;
}

/** Local-clock guess: before 3pm counts as morning. */
export function periodFromHour(hour: number): Period {
  return hour >= 4 && hour < 15 ? "am" : "pm";
}

/**
 * The name the mirror may say aloud. Product names are the person's own words, so they can contain
 * words the mirror never speaks ("Acne Control Wash"). Those are shown on screen as written, but
 * spoken as the plain category ("cleanser").
 */
export function speakableProductName(name: string, category: Category): string {
  return lintUtterance(name).ok ? name : CATEGORY_INFO[category].plain;
}
