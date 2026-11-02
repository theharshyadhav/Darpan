import type { Action } from "@/lib/api";
import type { LookId } from "@/lib/looks";
import { lintUtterance } from "@/lib/persona/lint";
import { cleanCustomTitle } from "@/lib/persona/titles";
import { classifyProduct, periodFromHour, type Category } from "@/lib/ritual/products";
import type { Period } from "@/lib/types";

/**
 * The mirror's built-in ears. Common requests in English, Hindi (Devanagari) and Hinglish are
 * understood right here, instantly and for free, so the app works with no language model at all and
 * never spends a model call on "scan my skin". Anything these rules are not sure about returns null,
 * and the app asks the language model (when there is one) to plan instead.
 *
 * The parser only ever produces `Intent`s: the same validated actions the model may produce, plus a
 * few conversational ones (yes, no, hush ...). Nothing here touches the network or the DOM.
 */

export type Intent =
  | Action
  | { type: "yes" }
  | { type: "no" }
  | { type: "hush" }
  | { type: "greet" }
  | { type: "thanks" }
  | { type: "settings" }
  | { type: "category"; category: Category };

export type PendingKind = "yes_no" | "ask_category" | null;

export interface ParseContext {
  /** A ritual is in progress, so a bare product name means "I am applying this". */
  ritualActive: boolean;
  /** What the mirror just asked, so a bare "serum" is understood as an answer. */
  pending?: PendingKind;
  /** Local clock, for "start my ritual" with no time of day. */
  now?: Date;
}

// ----------------------------------------------------------------- tokenising

/**
 * Lower-case, ASCII digits, no punctuation, and no Devanagari nukta dots (so "ज़रूर" and "जरूर",
 * "फ़ेस" and "फेस" meet in the middle).
 */
export function normalise(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/़/g, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x966))
    .replace(/[‘’´`]/g, "'")
    .replace(/[^\p{L}\p{N}\p{M}'\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(raw: string): string[] {
  const n = normalise(raw);
  return n ? n.split(" ") : [];
}

const NAME_CALLS = new Set(["darpan", "dharpan", "mirror", "दर्पण", "aaina", "aina", "आईना"]);
const GREETING_LEAD = new Set(["hey", "hi", "hello", "ok", "okay", "o", "oh", "ae", "arre", "are", "namaste", "नमस्ते", "listen"]);
const POLITE = new Set(["please", "kindly", "plz", "pls", "zara", "jara", "ji", "jee", "na"]);
const TITLE_WORDS = new Set(["highness", "majesty", "excellency", "maharani", "rajkumari", "हुजूर", "महारानी", "राजकुमारी", "जहाँपनाह", "जहांपनाह", "महामहिम"]);

/** Drop "Hey Darpan,", a trailing "please" or "Your Highness" so the command itself is what is left. */
function stripAddressing(toks: readonly string[]): string[] {
  let out = [...toks];
  // "Hey Darpan, ..." and "Darpan, ..."
  const at = out.findIndex((t, i) => i < 3 && NAME_CALLS.has(t));
  if (at >= 0 && at < out.length - 1 && out.slice(0, at).every((t) => GREETING_LEAD.has(t))) out = out.slice(at + 1);
  while (out.length > 1 && POLITE.has(out[0]!)) out.shift();
  // "... please", "... ji", "... Darpan", "... Your Highness"
  while (out.length > 1) {
    const last = out[out.length - 1]!;
    if (TITLE_WORDS.has(last)) {
      out.pop();
      if (out.length > 1 && out[out.length - 1] === "your") out.pop();
    } else if (POLITE.has(last) || NAME_CALLS.has(last)) out.pop();
    else break;
  }
  return out;
}

/** A phrase is space-separated tokens; a token ending in `*` matches any word starting that way. */
function matchAt(toks: readonly string[], i: number, phrase: readonly string[]): boolean {
  for (let k = 0; k < phrase.length; k += 1) {
    const want = phrase[k]!;
    const have = toks[i + k];
    if (have === undefined) return false;
    if (want.endsWith("*")) {
      if (!have.startsWith(want.slice(0, -1))) return false;
    } else if (have !== want) return false;
  }
  return true;
}

function hasPhrase(toks: readonly string[], phrase: string): boolean {
  const p = phrase.split(" ");
  for (let i = 0; i + p.length <= toks.length; i += 1) if (matchAt(toks, i, p)) return true;
  return false;
}

const has = (toks: readonly string[], ...phrases: readonly string[]): boolean => phrases.some((p) => hasPhrase(toks, p));

// --------------------------------------------------------------------- yes/no

const YES_WORDS = new Set(["yes", "yeah", "yep", "yup", "sure", "ok", "okay", "alright", "absolutely", "definitely", "correct", "affirmative", "haan", "han", "haa", "bilkul", "zaroor", "jaroor", "sahi", "theek", "thik", "हाँ", "हां", "हा", "जी", "बिलकुल", "जरूर", "सही", "ठीक", "ji", "jee"]);
const NO_WORDS = new Set(["no", "nope", "nah", "nahi", "nahin", "naa", "never", "cancel", "mat", "नहीं", "नही", "ना", "मत"]);
const REPLY_FILLER = new Set(["please", "ji", "jee", "thanks", "thank", "you", "na", "so", "very", "much", "thik", "hai", "है"]);
const YES_PHRASES = ["go ahead", "do it", "of course", "please do", "why not", "sounds good", "that is right", "that's right", "that is correct", "that's correct", "theek hai", "ठीक है", "kar do", "कर दो", "haan ji", "हाँ जी", "chalo", "चलो", "yes please"];
const NO_PHRASES = ["not now", "not yet", "no thanks", "no thank you", "never mind", "nevermind", "nahi chahiye", "रहने दो", "नहीं चाहिए", "baad mein", "बाद में", "rehne do", "mat karo", "मत करो", "nahi karo", "no no", "leave it"];

function yesNo(toks: readonly string[]): "yes" | "no" | null {
  if (toks.length === 0 || toks.length > 5) return null;
  if (has(toks, ...NO_PHRASES)) return "no";
  if (has(toks, ...YES_PHRASES)) return "yes";
  const only = (words: Set<string>) => toks.every((t) => words.has(t) || REPLY_FILLER.has(t)) && toks.some((t) => words.has(t));
  if (only(NO_WORDS)) return "no";
  if (only(YES_WORDS)) return "yes";
  return null;
}

// -------------------------------------------------------------------- numbers

const ONES: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NUM_HI: Record<string, number> = {
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, chheh: 6, che: 6, chah: 6, saat: 7, aath: 8, nau: 9, das: 10, gyarah: 11, barah: 12, pandrah: 15, solah: 16, bees: 20, pachees: 25, tees: 30, chalis: 40, paintalis: 45, paitalis: 45, pachas: 50, saath: 60,
  एक: 1, दो: 2, तीन: 3, चार: 4, पाँच: 5, पांच: 5, छह: 6, छः: 6, छे: 6, सात: 7, आठ: 8, नौ: 9, दस: 10, ग्यारह: 11, बारह: 12, पंद्रह: 15, पन्द्रह: 15, सोलह: 16, बीस: 20, पच्चीस: 25, तीस: 30, चालीस: 40, पैंतालीस: 45, पचास: 50, साठ: 60,
};
const HALF = new Set(["half", "aadha", "adha", "aadhi", "आधा", "आधी"]);
const ONE_AND_HALF = new Set(["dedh", "डेढ"]);
const TWO_AND_HALF = new Set(["dhai", "ढाई"]);
const SECONDS = new Set(["second", "seconds", "sec", "secs", "sekand", "सेकंड", "सेकण्ड", "सेकेंड", "सेकन्ड"]);
const MINUTES = new Set(["minute", "minutes", "min", "mins", "minat", "मिनट", "मिनिट"]);

function unitSeconds(tok: string | undefined): number | null {
  if (!tok) return null;
  if (SECONDS.has(tok)) return 1;
  if (MINUTES.has(tok)) return 60;
  return null;
}

function readNumber(toks: readonly string[], i: number): { n: number; used: number } | null {
  const t = toks[i];
  if (t === undefined) return null;
  if (/^\d{1,4}$/.test(t)) return { n: Number(t), used: 1 };
  if (t in TENS) {
    const u = ONES[toks[i + 1] ?? ""];
    if (u !== undefined && u >= 1 && u <= 9) return { n: TENS[t]! + u, used: 2 };
    return { n: TENS[t]!, used: 1 };
  }
  if (t in ONES) return { n: ONES[t]!, used: 1 };
  if (t in NUM_HI) return { n: NUM_HI[t]!, used: 1 };
  if ((t === "a" || t === "an") && unitSeconds(toks[i + 1]) !== null) return { n: 1, used: 1 };
  return null;
}

/** "two minutes", "90 seconds", "a minute", "half a minute", "dedh minute", "दो मिनट" -> seconds. */
export function parseDuration(toks: readonly string[]): number | null {
  for (let j = 0; j < toks.length; j += 1) {
    const t = toks[j]!;
    if (HALF.has(t)) {
      const k = toks[j + 1] === "a" || toks[j + 1] === "an" ? j + 2 : j + 1;
      const u = unitSeconds(toks[k]);
      if (u !== null) return Math.round(u / 2);
    }
    if (ONE_AND_HALF.has(t)) {
      const u = unitSeconds(toks[j + 1]);
      if (u !== null) return Math.round(u * 1.5);
    }
    if (TWO_AND_HALF.has(t)) {
      const u = unitSeconds(toks[j + 1]);
      if (u !== null) return Math.round(u * 2.5);
    }
    const num = readNumber(toks, j);
    if (!num) continue;
    let k = j + num.used;
    let extra = 0;
    if (toks[k] === "and" && (toks[k + 1] === "a" || toks[k + 1] === "an") && HALF.has(toks[k + 2] ?? "")) {
      extra = 0.5;
      k += 3;
    }
    const u = unitSeconds(toks[k]);
    if (u !== null && (num.n > 0 || extra > 0)) return Math.round((num.n + extra) * u);
  }
  return null;
}

const clampSeconds = (s: number): number => Math.max(5, Math.min(1800, s));

// ---------------------------------------------------------------- vocabularies

const MORNING = ["morning", "am", "subah", "सुबह", "savere", "सवेरे", "sunrise", "breakfast"];
const EVENING = ["evening", "night", "pm", "raat", "रात", "shaam", "sham", "शाम", "bedtime", "tonight", "sleep", "sone", "सोने"];

export function periodFromWords(toks: readonly string[], now: Date = new Date()): Period {
  if (has(toks, ...MORNING)) return "am";
  if (has(toks, ...EVENING)) return "pm";
  return periodFromHour(now.getHours());
}

const RITUAL_NOUN = ["ritual", "ritual*", "routine", "routine*", "regimen", "skincare", "dincharya", "दिनचर्या", "रूटीन", "रुटीन", "रिचुअल"];
const START_VERB = ["start", "begin", "starting", "beginning", "commence", "let's", "lets", "let us", "shuru", "shuru*", "शुरू", "शुरु", "chalu", "चालू", "time for", "ready for"];
const FINISH_VERB = ["finish", "finishing", "end", "complete", "close", "khatam", "खत्म", "poori", "पूरी"];

const BOTTLE_NOUN = ["bottle", "bottle*", "product", "label", "jar", "tube", "packet", "packaging", "dabba", "shishi", "बोतल", "डिब्बा", "शीशी", "प्रोडक्ट"];
const READ_VERB = ["scan", "read", "identify", "recognise", "recognize", "pehchano", "padho", "padh", "पढ़ो", "पहचानो", "पढ़"];
const GLANCE_VERB = ["look", "see", "check", "what", "which", "dekho", "dekh", "देखो", "देख", "kya", "क्या", "batao", "बताओ"];
const DEMONSTRATIVE = ["this", "that", "these", "yeh", "ye", "yah", "यह", "ये", "इसे", "ise"];
const SKIN_NOUN = ["skin", "face", "complexion", "twacha", "tvacha", "त्वचा", "स्किन", "चेहरा", "chehra", "chehre", "चेहरे"];

const LOOK_NAMES: ReadonlyArray<readonly [LookId, readonly string[], readonly string[]]> = [
  // [id, names that are unmistakable, single words that count only next to a look/makeup word]
  ["rani_rose", ["rani rose", "रानी गुलाब", "rose lip", "rose lipstick", "rose look"], ["rani", "रानी", "rosy", "gulabi", "गुलाबी", "pink"]],
  ["marigold_glow", ["marigold glow", "golden look"], ["marigold", "genda", "गेंदा", "golden", "yellow", "orange"]],
  ["midnight_kohl", ["midnight kohl", "smoky eyes", "smokey eyes", "dramatic eyes"], ["midnight", "kohl", "kajal", "काजल", "smoky", "smokey"]],
  ["peacock_pop", ["peacock pop", "colour pop", "color pop"], ["peacock", "mor", "मोर", "teal", "turquoise", "bold"]],
  ["barely_there", ["barely there", "natural look", "no makeup look"], ["barely", "natural", "nude", "minimal", "subtle", "everyday"]],
];
const LOOK_WORD = ["look", "looks", "makeup", "make-up", "lipstick", "blush", "preview", "vto", "लुक", "मेकअप", "लिपस्टिक", "try on", "try*"];
const LOOK_SHOW = ["show", "see", "wear", "dikhao", "दिखाओ", "dikha*", "दिखा*", "lagao", "लगाओ"];

function lookFrom(toks: readonly string[]): { id?: LookId; asked: boolean } {
  const withLookWord = has(toks, ...LOOK_WORD) || has(toks, ...LOOK_SHOW);
  for (const [id, strong, weak] of LOOK_NAMES) {
    if (has(toks, ...strong)) return { id, asked: true };
    if (withLookWord && has(toks, ...weak)) return { id, asked: true };
  }
  const general = has(toks, "makeup", "make-up", "lipstick", "blush", "look", "looks", "preview", "vto", "मेकअप", "लुक", "लिपस्टिक", "try on");
  return { asked: general && !has(toks, "again", "dobara", "फिर") };
}

// ------------------------------------------------------------ product naming

const NAME_STOP = new Set([
  "i", "im", "i'm", "am", "now", "applying", "apply", "applied", "using", "use", "putting", "put", "on", "my", "the", "a", "an", "some", "wearing", "doing", "just", "then", "next", "please", "kindly", "and", "also", "first", "so", "okay", "ok", "well", "taking", "massaging", "patting", "dabbing", "rubbing", "with", "i've", "ive", "got", "after", "that", "it's", "its", "this", "is", "was", "have", "had", "it", "over", "up", "going", "to", "gonna", "will", "can", "let", "me", "lets", "let's",
  "main", "mai", "mein", "me", "ab", "abhi", "apna", "apni", "apne", "mera", "meri", "mere", "laga", "lagao", "lagana", "lagaya", "lagayi", "lagai", "lagaiye", "lagane", "lagata", "lagati", "rahi", "raha", "rahe", "hoon", "hun", "hu", "hai", "hain", "ho", "kar", "karti", "karta", "karna", "karo", "istemal", "ka", "ki", "ke", "ko", "se", "par", "pe", "ek", "thoda", "thodi", "bas", "phir", "fir", "lagaa", "lagaye", "lagayein", "lagaun", "lagaungi", "lagaunga", "kiya", "kiye", "ye", "yeh", "wo", "woh",
  "मैं", "में", "अब", "अभी", "अपना", "अपनी", "मेरा", "मेरी", "लगा", "लगाओ", "लगाना", "लगाया", "लगाई", "लगाइए", "लगाता", "लगाती", "रही", "रहा", "रहे", "हूँ", "हूं", "हैं", "है", "कर", "करती", "करता", "करना", "इस्तेमाल", "का", "की", "के", "को", "से", "पर", "एक", "थोड़ा", "थोड़ी", "फिर", "यह", "ये", "वो", "बस", "लगाऊं", "लगाऊँगी", "लगाऊँगा",
]);

/** What a person calls the product, with the "I am applying my ..." scaffolding taken off. */
export function productNameFrom(raw: string): string {
  const words = raw
    .replace(/[?!.,;:।"“”]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const kept = words.filter((w, i) => {
    // a capitalised article before a capitalised word is a brand ("The Ordinary"), not filler
    if (w === "The" && /^\p{Lu}/u.test(words[i + 1] ?? "")) return true;
    return !NAME_STOP.has(normalise(w));
  });
  let name = kept.join(" ").replace(/\s+/g, " ").trim();
  if (!name) return "";
  // speech recognition hands back lower case; show the name the way a label would start
  name = name.charAt(0).toUpperCase() + name.slice(1);
  return name.slice(0, 60);
}

const APPLY_VERBS = ["applying", "apply", "applied", "using", "use", "putting", "put", "wearing", "massaging", "patting", "dabbing", "laga", "laga*", "lagana", "lagaya", "istemal", "इस्तेमाल", "लगा", "लगा*"];

const QUESTION_LEAD = new Set(["can", "could", "should", "would", "is", "are", "does", "do", "what", "why", "how", "when", "which", "who", "kya", "kaun", "kab", "kyun", "kyu", "kaise", "क्या", "क्यों", "कैसे", "कब", "कौन", "tell", "explain", "batao", "बताओ"]);

function questionLike(raw: string, toks: readonly string[]): boolean {
  return raw.includes("?") || raw.includes("？") || QUESTION_LEAD.has(toks[0] ?? "");
}

// ------------------------------------------------------------------- the rules

const MAX_INTENTS = 3;
const intent = <T extends Intent>(i: T): Intent[] => [i];

/** "I just started using retinol" -> "retinol". Text before the verb is thrown away. */
const TRACK_PATTERNS: readonly RegExp[] = [
  /\b(?:i\s+(?:have\s+|just\s+|recently\s+|also\s+)*(?:started|began|begun|bought|got)(?:\s+(?:using|to use))?|started using|start tracking|keep track of|track|tracking)\s+(.{2,70})$/i,
  /(?:naya|nayi|नया|नई)\s+(.{2,70}?)\s+(?:shuru|शुरू|start)\s*(?:kiya|किया|kar|कर|ki|की)?(?:\s|$)/i,
  /(?:maine|मैंने|main ne)\s+(.{2,70}?)\s+(?:shuru|शुरू)\s+(?:kiya|किया)(?:\s|$)/i,
];

function trackedProduct(raw: string): { name: string; category?: Category } | null {
  const clean = raw.trim().replace(/[.!?।]+$/u, "");
  for (const re of TRACK_PATTERNS) {
    const m = re.exec(clean);
    if (!m?.[1]) continue;
    const name = productNameFrom(m[1].replace(/\b(?:new|a new|naya|nayi)\b/gi, " ").replace(/(?:नया|नई)/g, " "));
    if (name.length < 2) continue;
    const hit = classifyProduct(name);
    return { name, category: hit?.category };
  }
  return null;
}

/** "call me Maharani" -> "Maharani". Only a short title that passes the claim linter is returned. */
function titleFrom(raw: string): string | null {
  const clean = raw.trim().replace(/[.!?।]+$/u, "");
  const patterns = [
    /\b(?:call me|address me as|refer to me as|name me|you can call me|please call me)\s+(.{1,40})$/i,
    /(?:mujhe|mujhko|मुझे|मुझको)\s+(.{1,40}?)\s+(?:kaho|kehna|bolo|bulao|bulaao|bulana|कहो|कहना|बोलो|बुलाओ|कहिए|कहिये)(?:\s|$)/i,
  ];
  for (const re of patterns) {
    const m = re.exec(clean);
    if (!m?.[1]) continue;
    const t = cleanCustomTitle(m[1].replace(/^(?:as|by|the)\s+/i, ""));
    if (t.length >= 2 && lintUtterance(t).ok && !/\b(?:scan|ritual|routine|timer)\b/i.test(t)) {
      return t.charAt(0).toUpperCase() + t.slice(1);
    }
  }
  return null;
}

function parseOne(raw: string, toks: readonly string[], ctx: ParseContext): Intent[] | null {
  if (toks.length === 0) return null;
  const now = ctx.now ?? new Date();

  // 0. answers to a question the mirror just asked
  if (ctx.pending === "ask_category") {
    const hit = classifyProduct(toks.join(" "));
    if (hit) return intent({ type: "category", category: hit.category });
  }
  const yn = yesNo(toks);
  if (yn) return intent({ type: yn });

  // 1. erase everything (always confirmed by the app before anything is deleted)
  if (
    (has(toks, "forget", "delete", "erase", "wipe", "remove", "clear", "bhool", "bhula*", "mita*", "मिटा", "मिटा*", "भूल", "भुला*", "हटा*") &&
      has(toks, "me", "everything", "data", "history", "mujhe", "meri", "mera", "मुझे", "मेरा", "मेरी", "sab", "सब")) ||
    has(toks, "forget me", "forget everything", "clear my data", "delete my data", "erase my data", "delete everything", "mujhe bhool jao", "मुझे भूल जाओ")
  ) {
    return intent({ type: "forget_me" });
  }

  // 2. timers
  if (has(toks, "timer", "टाइमर", "countdown", "stopwatch", "ginti", "गिनती", "alarm")) {
    if (has(toks, "stop", "cancel", "off", "clear", "band", "रोको", "बंद", "ruko", "hata*", "हटा*", "dismiss")) return intent({ type: "stop_timer" });
    const seconds = parseDuration(toks);
    return intent({ type: "start_timer", seconds: clampSeconds(seconds ?? 60) });
  }
  if (!ctx.pending && toks.length <= 6 && has(toks, "for", "ke liye", "के लिए", "ka", "का")) {
    const seconds = parseDuration(toks);
    if (seconds !== null) return intent({ type: "start_timer", seconds: clampSeconds(seconds) });
  }

  // 3. language and how to be addressed
  if (toks.length <= 2 && has(toks, "hinglish")) return intent({ type: "set_language", language: "hinglish" });
  if (has(toks, "hinglish") && has(toks, "speak", "talk", "baat", "bolo", "mein", "me", "switch", "change", "please", "karo", "chalega")) return intent({ type: "set_language", language: "hinglish" });
  if (has(toks, "hindi", "हिंदी", "हिन्दी") && (toks.length <= 2 || has(toks, "speak", "talk", "baat", "bolo", "bol", "mein", "me", "में", "बोलो", "बात", "switch", "change", "please", "chalega", "kijiye", "karo", "in"))) {
    return intent({ type: "set_language", language: "hi" });
  }
  if (has(toks, "english", "angrezi", "अंग्रेजी", "अंग्रेज़ी") && (toks.length <= 2 || has(toks, "speak", "talk", "baat", "bolo", "bol", "mein", "me", "में", "बोलो", "बात", "switch", "change", "please", "in"))) {
    return intent({ type: "set_language", language: "en" });
  }
  const title = titleFrom(raw);
  if (title) return intent({ type: "set_title", title });

  // 4. identify a bottle held up to the camera
  const skinTalk = has(toks, ...SKIN_NOUN);
  const nounPresent = has(toks, ...BOTTLE_NOUN);
  if (
    !skinTalk &&
    ((nounPresent && has(toks, ...READ_VERB)) ||
      (nounPresent && has(toks, ...DEMONSTRATIVE) && has(toks, ...GLANCE_VERB)) ||
      (toks.length <= 5 && has(toks, ...DEMONSTRATIVE) && has(toks, "what", "kya", "क्या", "which")) ||
      (toks.length <= 4 && has(toks, ...DEMONSTRATIVE) && has(toks, "read", "scan", "look", "check", "dekho", "देखो", "padho", "पढ़ो")))
  ) {
    return intent({ type: "look_at_product" });
  }

  // 5. skin measuring and reports
  const again = has(toks, "again", "once more", "second time", "re scan", "rescan", "re-scan", "dobara", "dubara", "दोबारा", "दुबारा", "phir se", "fir se", "फिर से");
  if (
    has(toks, "verify", "second look", "doosri nazar", "दूसरी नजर", "compare", "tulna", "तुलना", "did it work", "did it help", "any change", "has it changed", "kuch badla", "कुछ बदला") ||
    (again && (skinTalk || has(toks, "scan", "check", "look", "स्कैन", "dekho", "देखो")))
  ) {
    if (!questionLike(raw, toks) || has(toks, "did it work", "did it help", "any change", "has it changed")) return intent({ type: "verify" });
  }
  const measureVerb = has(toks, "scan", "analyse", "analyze", "analysis", "measure", "check", "examine", "inspect", "assess", "jaanch*", "jaach*", "जाँच", "जांच", "जाँचो", "जांचो", "स्कैन", "dekho", "dekh", "देखो", "देख");
  if (measureVerb && (skinTalk || has(toks, "me", "mujhe", "मुझे")) && !has(toks, "ledger", "bahi", "बही", "report", "result", "score")) {
    return intent({ type: "start_scan" });
  }
  if (toks.length <= 4 && has(toks, "scan", "स्कैन") && !nounPresent) return intent({ type: "start_scan" });
  if (
    (has(toks, "report", "results", "result", "scores", "score", "findings", "रिपोर्ट", "नतीजा", "नतीजे", "natija", "nateeja") &&
      has(toks, "show", "my", "see", "dikhao", "dikha*", "दिखाओ", "दिखा*", "what", "meri", "मेरी", "mera", "मेरा", "open")) ||
    has(toks, "what did you find", "how is my skin", "how does my skin look", "skin report", "meri skin kaisi hai", "त्वचा कैसी है")
  ) {
    return intent({ type: "show_report" });
  }

  // 6. makeup looks
  if (!has(toks, "ritual", "routine") && !has(toks, ...APPLY_VERBS.filter((v) => v !== "lagao"))) {
    const look = lookFrom(toks);
    if (look.asked) return intent({ type: "try_look", look: look.id });
  }

  // 7. the ledger and tracking something new
  if (has(toks, "ledger", "bahi", "बही", "royal ledger", "is it working", "are they working", "kaam kar raha", "काम कर रहा", "how are my products", "progress", "my progress", "meri progress")) {
    return intent({ type: "show_ledger" });
  }
  if (!questionLike(raw, toks) && !has(toks, "ritual", "routine")) {
    const tracked = trackedProduct(raw);
    if (tracked) return intent({ type: "track_product", name: tracked.name, category: tracked.category });
  }

  // 8. the ritual: start, finish, skip
  const ritualNoun = has(toks, ...RITUAL_NOUN);
  if (ritualNoun && has(toks, ...FINISH_VERB)) return intent({ type: "finish_ritual" });
  if (ritualNoun && has(toks, ...START_VERB)) return intent({ type: "start_ritual", period: periodFromWords(toks, now) });
  if (ritualNoun && toks.length <= 5 && has(toks, ...MORNING, ...EVENING) && !has(toks, "done", "finished", "complete", "over")) {
    return intent({ type: "start_ritual", period: periodFromWords(toks, now) });
  }
  if (!ctx.ritualActive && toks.length <= 4 && has(toks, ...START_VERB) && !skinTalk && !has(toks, "timer", "scan", "look", "makeup", "टाइमर")) {
    return intent({ type: "start_ritual", period: periodFromWords(toks, now) });
  }
  if (
    toks.length <= 7 &&
    !has(toks, "not", "nahi", "नहीं") &&
    has(toks, "i'm done", "im done", "i am done", "i'm finished", "im finished", "finished", "all done", "that's all", "thats all", "that is all", "done", "ho gaya", "hogaya", "ho gayi", "khatam", "हो गया", "हो गई", "खत्म", "poora ho gaya", "पूरा हो गया")
  ) {
    return intent({ type: "finish_ritual" });
  }
  if (toks.length <= 5 && has(toks, "skip", "skip it", "skip this", "next one", "next step", "pass", "chhodo", "chhod do", "chhod", "agla", "agle", "aage", "छोड़ो", "छोड़", "आगे", "अगला", "अगले") && !has(toks, "timer", "टाइमर")) {
    return intent({ type: "skip_step" });
  }
  if (toks.length <= 2 && has(toks, "next")) return intent({ type: "skip_step" });

  // 9. be quiet, say it again, open settings
  if (toks.length <= 3 && has(toks, "stop", "quiet", "shh", "shhh", "hush", "enough", "silence", "chup", "chup*", "ruko", "ruk", "bas", "बस", "चुप", "रुको", "रुक")) return intent({ type: "hush" });
  if (has(toks, "be quiet", "stop talking", "stop speaking", "shut up", "chup raho", "चुप रहो", "bolna band", "बोलना बंद")) return intent({ type: "hush" });
  if (has(toks, "repeat", "say that again", "say again", "what did you say", "pardon", "come again", "dobara bolo", "phir se bolo", "fir se bolo", "फिर से बोलो", "दोबारा बोलो", "दोहराओ", "dohrao", "kya kaha", "क्या कहा", "sorry what")) {
    return intent({ type: "repeat" });
  }
  if (toks.length <= 5 && has(toks, "settings", "setting", "preferences", "privacy", "सेटिंग", "सेटिंग्स", "प्राइवेसी")) return intent({ type: "settings" });

  // 10. a product the person is applying right now
  if (!questionLike(raw, toks)) {
    const applying = has(toks, ...APPLY_VERBS);
    if (applying || (ctx.ritualActive && toks.length <= 9)) {
      const name = productNameFrom(raw);
      const hit = name ? classifyProduct(name) : null;
      if (hit) return intent({ type: "log_product", name, category: hit.category });
      if (applying && name.length >= 2) return intent({ type: "log_product", name });
    }
  }

  // 11. small talk
  if (toks.length <= 4 && has(toks, "thanks", "thank", "thankyou", "shukriya", "shukriyaa", "dhanyavad", "dhanyawad", "शुक्रिया", "धन्यवाद")) return intent({ type: "thanks" });
  if (toks.length <= 4 && has(toks, "hello", "hi", "hey", "namaste", "namaskar", "good morning", "good evening", "good afternoon", "good night", "नमस्ते", "नमस्कार", "suprabhat", "सुप्रभात", "pranam", "प्रणाम")) return intent({ type: "greet" });

  return null;
}

const CONJUNCTION = /\s+(?:and then|and also|and|then|also|aur phir|aur|phir|fir|और फिर|और|फिर)\s+/i;

function parseWhole(text: string, ctx: ParseContext): Intent[] | null {
  const all = tokenize(text);
  const stripped = stripAddressing(all);
  return parseOne(text, stripped, ctx) ?? (stripped.length === all.length ? null : parseOne(text, all, ctx));
}

/**
 * Understand one spoken or typed message. Returns null when the rules are not sure, so the caller
 * can ask a language model (or politely say it did not catch that).
 */
export function parseIntents(raw: string, ctx: ParseContext): Intent[] | null {
  const text = raw.trim().slice(0, 400);
  if (!text) return null;
  const whole = parseWhole(text, ctx);
  if (!CONJUNCTION.test(text)) return whole;

  // "start my morning ritual and set a timer": split only when every clause is understood on its own
  const parts = text.split(CONJUNCTION).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > MAX_INTENTS) return whole;
  const merged: Intent[] = [];
  let ritualActive = ctx.ritualActive;
  for (const part of parts) {
    const r = parseWhole(part, { ...ctx, ritualActive, pending: null });
    if (!r) return whole;
    merged.push(...r);
    if (r.some((i) => i.type === "start_ritual")) ritualActive = true;
  }
  // "retinol and vitamin C" is one list of products, not a list of commands
  if (merged.every((i) => i.type === "log_product")) return whole;
  return merged.slice(0, MAX_INTENTS);
}

/** "try again", "once more": the caller decides what to retry. */
export function isRetry(raw: string): boolean {
  const toks = stripAddressing(tokenize(raw));
  return toks.length > 0 && toks.length <= 3 && has(toks, "try again", "retry", "once more", "again", "dobara", "दोबारा", "phir se", "फिर से", "fir se", "one more time");
}
