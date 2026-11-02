/**
 * Every sentence the mirror can say without asking a language model, in English, Hindi and
 * Hinglish. Lines are short (one or two calm sentences), cosmetic in tone, never medical, never
 * absolute, and every one is linted in CI (tests/claims.test.ts).
 *
 * Hindi lines refer to the mirror in the third person ("दर्पण") or use imperatives, so they stay
 * grammatically neutral whatever the listener's or the voice's gender.
 */
import type { Language, Period } from "../types";
import { addressee } from "./titles";
import type { NoteCode } from "../ritual/engine";
import type { SlotId, TimerKind } from "../ritual/products";

export type ScanErrorKind =
  | "no_face"
  | "face_small"
  | "face_bounds"
  | "multi_face"
  | "dark"
  | "small_image"
  | "big_image"
  | "angle"
  | "busy"
  | "unavailable"
  | "network"
  | "generic";

type T = { title?: string };

export interface LineParams {
  welcome: T;
  welcome_back: T;
  ready: T;
  greet: T;
  thanks: T;
  ack_no: T;
  language_changed: T;
  title_set: { title: string };
  scan_start: T;
  report_none: T;
  verify_no_baseline: T;
  timer_stopped: T;
  ask_category: T;
  mic_blocked: T;
  mic_unsupported: T;
  didnt_catch: T;
  brain_offline: T;
  camera_denied: T;
  hint_no_face: T;
  hint_multi_face: T;
  hint_closer: T;
  hint_back: T;
  hint_shift_left: T;
  hint_shift_right: T;
  hint_lower: T;
  hint_higher: T;
  hint_more_light: T;
  hint_even_light: T;
  hint_glare: T;
  hint_hold_still: T;
  hint_level: T;
  hint_face_forward: T;
  countdown: { n: 1 | 2 | 3 };
  captured: T;
  analyzing_long: T;
  scan_cooldown: { minutes: number };
  scan_budget: T;
  scan_demo_notice: T;
  scan_error: { kind: ScanErrorKind };
  report_strength: T & { label: string };
  report_ask_focus: T;
  report_focus: { label: string };
  report_uncertainty: T;
  report_decline: T;
  report_all_high: T;
  ritual_start: T & { period: Period };
  ask_potion: T;
  look_failed: T;
  look_found_confirm: { name: string };
  product_noted: { name: string };
  next_step: { slot: SlotId };
  note: { code: NoteCode; slot?: SlotId; after?: SlotId };
  timer_start: { seconds: number; kind: TimerKind };
  timer_done: { kind: TimerKind };
  ritual_complete: T;
  ritual_complete_plain: T;
  ritual_skipped: { slot: SlotId };
  ritual_none_active: T;
  verify_too_soon: { minutes: number };
  verify_ready: T;
  verify_better: { label: string };
  verify_same: T;
  verify_softer: { label: string };
  verify_caveat: T;
  look_intro: T;
  look_rendering: T;
  look_ready: T & { name: string };
  look_demo: T;
  look_unavailable: T;
  look_steps_intro: { name: string };
  look_hold: T;
  look_done: T;
  ledger_empty: T;
  ledger_too_early: { product: string; days: number };
  ledger_need_scans: { product: string };
  ledger_improving: { product: string; labels: string };
  ledger_steady: { product: string };
  ledger_declining: { product: string; labels: string };
  ledger_mixed: { product: string };
  ledger_confounded: { product: string };
  ledger_no_visible: { product: string };
  track_ask: { product: string };
  track_started: { product: string };
  forget_confirm: T;
  forgotten: T;
  consent_look_needed: T;
  consent_scan_needed: T;
  error_generic: T;
  error_network: T;
  referral: T;
}

export type LineId = keyof LineParams;
type Table = { [K in LineId]: (p: LineParams[K]) => string };

const addr = (p: T) => addressee(p.title);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "60" seconds -> "60 seconds"; 120 -> "2 minutes", per language. */
export function duration(seconds: number, lang: Language): string {
  const useMinutes = seconds >= 120;
  const n = useMinutes ? Math.round(seconds / 60) : Math.round(seconds);
  if (lang === "hi") return useMinutes ? `${n} मिनट` : `${n} सेकंड`;
  if (lang === "hinglish") return useMinutes ? `${n} minute` : `${n} second`;
  return useMinutes ? `${n} ${plural(n, "minute", "minutes")}` : `${n} ${plural(n, "second", "seconds")}`;
}

// ---------------------------------------------------------------- slot names

/** Short names for the ritual timeline. */
export const SLOT_LABEL: Record<Language, Record<SlotId, string>> = {
  en: {
    oil_cleanse: "Oil cleanse",
    cleanse: "Cleanse",
    tone: "Tone",
    exfoliate: "Exfoliate",
    treat: "Active",
    serum: "Serum",
    eye: "Eyes",
    moisturize: "Moisturize",
    oil: "Face oil",
    protect: "Sunscreen",
    extra: "Extra",
  },
  hi: {
    oil_cleanse: "ऑयल क्लींज़",
    cleanse: "क्लींज़",
    tone: "टोन",
    exfoliate: "एक्सफ़ोलिएट",
    treat: "सक्रिय",
    serum: "सीरम",
    eye: "आँखें",
    moisturize: "मॉइस्चराइज़",
    oil: "फ़ेस ऑयल",
    protect: "सनस्क्रीन",
    extra: "अतिरिक्त",
  },
  hinglish: {
    oil_cleanse: "Oil cleanse",
    cleanse: "Cleanse",
    tone: "Tone",
    exfoliate: "Exfoliate",
    treat: "Active",
    serum: "Serum",
    eye: "Aankhein",
    moisturize: "Moisturize",
    oil: "Face oil",
    protect: "Sunscreen",
    extra: "Extra",
  },
};

/** Phrases used inside spoken sentences ("Next, a gentle cleanser."). */
const SLOT_PHRASE: Record<Language, Record<SlotId, string>> = {
  en: {
    oil_cleanse: "a cleansing oil or balm",
    cleanse: "a gentle cleanser",
    tone: "a toner or essence",
    exfoliate: "an exfoliating step",
    treat: "an active serum",
    serum: "a hydrating serum",
    eye: "eye care",
    moisturize: "your moisturizer",
    oil: "a face oil",
    protect: "sunscreen",
    extra: "an extra step",
  },
  hi: {
    oil_cleanse: "क्लींज़िंग ऑयल या बाम",
    cleanse: "हल्का क्लींज़र",
    tone: "टोनर या एसेंस",
    exfoliate: "एक्सफ़ोलिएशन",
    treat: "सक्रिय सीरम",
    serum: "हाइड्रेटिंग सीरम",
    eye: "आँखों की देखभाल",
    moisturize: "मॉइस्चराइज़र",
    oil: "फ़ेस ऑयल",
    protect: "सनस्क्रीन",
    extra: "एक अतिरिक्त कदम",
  },
  hinglish: {
    oil_cleanse: "cleansing oil ya balm",
    cleanse: "halka cleanser",
    tone: "toner ya essence",
    exfoliate: "exfoliation",
    treat: "active serum",
    serum: "hydrating serum",
    eye: "aankhon ki dekhbhaal",
    moisturize: "moisturizer",
    oil: "face oil",
    protect: "sunscreen",
    extra: "ek extra kadam",
  },
};

export function slotLabel(lang: Language, slot: SlotId): string {
  return SLOT_LABEL[lang][slot];
}
export function slotPhrase(lang: Language, slot: SlotId): string {
  return SLOT_PHRASE[lang][slot];
}

// ------------------------------------------------------------------- English

const en: Table = {
  welcome: (p) => `Welcome${addr(p)}. The mirror is yours.`,
  welcome_back: (p) => `Welcome back${addr(p)}. Shall we begin?`,
  ready: () => "I am listening whenever you wish to speak.",
  greet: (p) => `Namaste${addr(p)}. How may the mirror help you?`,
  thanks: (p) => `It is my pleasure${addr(p)}.`,
  ack_no: () => "Of course. Just say the word whenever you wish.",
  language_changed: () => "English it is.",
  title_set: ({ title }) => `Very well. I shall call you ${title}.`,
  scan_start: () => "Let us take a careful look. Face me, and I will tell you when to hold still.",
  report_none: () => "I have no measurement to show yet. Shall I take one now?",
  verify_no_baseline: () => "I need a first measurement to compare with. Shall I take one now?",
  timer_stopped: () => "Timer stopped.",
  ask_category: () => "I did not recognise that one. Is it a cleanser, a serum, a moisturizer, or sunscreen?",
  mic_blocked: () => "I cannot hear you yet. Allow the microphone in your browser, or type to me instead.",
  mic_unsupported: () => "This browser cannot hear me, but you can type to me or use the buttons.",
  didnt_catch: (p) =>
    `Forgive me${addr(p)}, I did not quite catch that. You can say scan my skin, start my ritual, or tell me what you are applying.`,
  brain_offline: () => "My thinking is a little slow just now, so I will keep to the basics.",
  camera_denied: () => "I cannot see through the camera yet. Allow it in your browser, or upload a photo instead.",
  hint_no_face: () => "I cannot find your face yet. Step into the light and look at me.",
  hint_multi_face: () => "I see more than one face. Let us have just you in the mirror.",
  hint_closer: () => "Come a little closer.",
  hint_back: () => "A little farther back, please.",
  hint_shift_left: () => "Move a little to your left.",
  hint_shift_right: () => "Move a little to your right.",
  hint_lower: () => "Settle a little lower in the frame.",
  hint_higher: () => "Rise a little higher in the frame.",
  hint_more_light: () => "It is rather dim. Face a window or a bright lamp.",
  hint_even_light: () => "The light falls on one side. Turn a little towards it.",
  hint_glare: () => "The light is very strong. Soften it, or step back from it.",
  hint_hold_still: () => "Lovely. Hold still.",
  hint_level: () => "Level your head, as if balancing a crown.",
  hint_face_forward: () => "Face me directly.",
  countdown: ({ n }) => (n === 3 ? "Three" : n === 2 ? "Two" : "One"),
  captured: () => "Captured. One moment while I look closely.",
  analyzing_long: () => "Still looking carefully. Good things take a moment.",
  scan_cooldown: ({ minutes }) =>
    `I measured you ${plural(minutes, "a minute", `${minutes} minutes`)} ago. Give the products a little time, and I will look again.`,
  scan_budget: () =>
    "I have used up my measuring for now, so I will show sample numbers. They are not a measurement of you.",
  scan_demo_notice: () => "I am in demo mode, so these numbers are samples, not a measurement of you.",
  scan_error: ({ kind }) => {
    const m: Record<ScanErrorKind, string> = {
      no_face: "I could not find a face. Look straight at me and add a little light.",
      face_small: "Your face looks a little small. Come closer and try again.",
      face_bounds: "Your face is leaving the frame. Come to the middle and try again.",
      multi_face: "I see more than one face. Let us have just you in the mirror, then try again.",
      dark: "It is too dim. Move closer to a window and try again.",
      small_image: "That photo is too small. Try a larger one, or a better camera.",
      big_image: "That photo is too large. Try a smaller one.",
      angle: "Your face is turned a little. Look straight at me and try again.",
      busy: "The measuring service is busy. Try again in a moment.",
      unavailable: "The measuring service is not available right now, so I will show sample numbers instead.",
      network: "I cannot reach the network just now. Please try again.",
      generic: "Something slipped. Shall we try that again?",
    };
    return m[kind];
  },
  report_strength: (p) => `Your standout today is ${p.label.toLowerCase()}${addr(p)}.`,
  report_ask_focus: () => "May I share one small thought?",
  report_focus: ({ label }) => `A little extra care would show most in ${label.toLowerCase()}.`,
  report_uncertainty: () => "Light and complexion can both nudge these numbers, so I will hold them lightly.",
  report_decline: () => "Then I shall keep it to myself. Whenever you wish to hear it, just ask.",
  report_all_high: () => "Everything looks wonderfully balanced. The only task is to keep going as you are.",
  ritual_start: (p) =>
    p.period === "am"
      ? `Good morning${addr(p)}. Let us begin your morning ritual. Which potion first?`
      : `Good evening${addr(p)}. Let us begin your evening ritual. Which potion first?`,
  ask_potion: () => "Which potion are you applying?",
  look_failed: () => "I could not read that label. Tell me its name and I will remember.",
  look_found_confirm: ({ name }) => `That looks like ${name}. Is that right?`,
  product_noted: ({ name }) => `${name}, lovely.`,
  next_step: ({ slot }) => `Next, ${SLOT_PHRASE.en[slot]}.`,
  note: ({ code, slot, after }) => {
    const late = slot && after ? `${capitalize(SLOT_PHRASE.en[slot])} usually comes before ${SLOT_PHRASE.en[after]}, though you know your skin best.` : "";
    const m: Record<NoteCode, string> = {
      order_late: late,
      clash_retinoid_exfoliant: "Retinol and exfoliating acids together can feel like a lot. Many people keep them to different evenings.",
      clash_retinoid_benzoyl: "Those two can feel harsh together, so many people use them at different times of day.",
      clash_retinoid_vitc: "Those two prefer different times of day: vitamin C in the morning, retinol in the evening.",
      clash_double_exfoliant: "Two exfoliants in one sitting can be a lot. One is usually plenty.",
      clash_vitc_exfoliant: "Vitamin C right after an exfoliating acid may sting. Perhaps give it a little time.",
      clash_benzoyl_vitc: "Benzoyl peroxide and vitamin C are happier apart. Try them at different times.",
      overload: "That is a lot of actives for one sitting. Listen to how your skin feels.",
      period_retinoid_am: "Retinol is usually kept for the evening, and sunscreen matters most if you use it by day.",
      period_spf_pm: "Sunscreen is for daytime, so you may skip it tonight.",
      period_exfoliant_am: "Exfoliating acids are usually kinder in the evening, and sunscreen matters the next day.",
      spf_missing: "Sunscreen is still waiting, and it is the finishing touch for the morning.",
    };
    return m[code];
  },
  timer_start: ({ seconds, kind }) => {
    const d = duration(seconds, "en");
    if (kind === "massage") return `Massage for ${d}. I will keep time.`;
    if (kind === "settle") return `Let that settle for ${d}.`;
    if (kind === "mask") return `Rest for ${d}. I will call you.`;
    return `${capitalize(d)}, starting now.`;
  },
  timer_done: ({ kind }) =>
    kind === "massage"
      ? "Time. Rinse gently."
      : kind === "mask"
        ? "Time. Remove your mask gently."
        : kind === "settle"
          ? "Time. Shall we continue?"
          : "Time is up.",
  ritual_complete: (p) => `Your ritual is complete${addr(p)}. Shall I take a second look in a little while?`,
  ritual_complete_plain: (p) => `Your ritual is complete${addr(p)}.`,
  ritual_skipped: ({ slot }) => `Skipping ${SLOT_PHRASE.en[slot]}.`,
  ritual_none_active: () => "There is no ritual in progress. Say start my morning ritual, or start my evening ritual.",
  verify_too_soon: ({ minutes }) =>
    `Products need a little time. In about ${minutes} minutes a second look will say more. Shall I measure anyway?`,
  verify_ready: () => "Shall I take a second look?",
  verify_better: ({ label }) => `I can see a touch of improvement in ${label.toLowerCase()}.`,
  verify_same: () => "Everything looks about the same, which is honest news.",
  verify_softer: ({ label }) => `I see a touch less in ${label.toLowerCase()}, which is often just light and angle.`,
  verify_caveat: () =>
    "Within one sitting, changes mostly reflect light and angle, so treat them as a hint, not a result.",
  look_intro: () => "Choose a look and I will show it on your own face first.",
  look_rendering: () => "Painting it on for you. One moment.",
  look_ready: (p) => `${p.name} on you${addr(p)}. Shall I coach you to recreate it?`,
  look_demo: () => "Look previews need the YouCam key, so here is the recipe instead.",
  look_unavailable: () => "The look preview is not available just now, so here is the recipe instead.",
  look_steps_intro: ({ name }) => `Here is how to recreate ${name}, one step at a time. Say next whenever you are ready for the following step.`,
  look_hold: () => "Hold the bottle up, with the label facing me.",
  look_done: () => "And that completes the look.",
  ledger_empty: () => "Your ledger is empty. Tell me when you start something new, and I will keep track.",
  ledger_too_early: ({ product, days }) =>
    `It is too early to say about ${product}. Give it about ${days} more ${plural(days, "day", "days")}.`,
  ledger_need_scans: ({ product }) => `For ${product}, I need a few more scans on different days before I can say anything.`,
  ledger_improving: ({ product, labels }) => `I can see gentle gains in ${labels} with ${product}.`,
  ledger_steady: ({ product }) => `Nothing has shifted much with ${product} yet, and that is honest news too.`,
  ledger_declining: ({ product, labels }) =>
    `With ${product}, ${labels} reads lower than before. It may be worth a pause, and a look at your routine.`,
  ledger_mixed: ({ product }) => `${product} shows a mixed picture so far, so I will keep watching.`,
  ledger_confounded: () => "You started more than one thing around the same time, so I cannot tell which one helped.",
  ledger_no_visible: ({ product }) =>
    `${product} is about daily care rather than visible change, so I will not expect numbers to move.`,
  track_ask: ({ product }) => `Is ${product} new to your shelf? I can keep a ledger of whether it is working.`,
  track_started: ({ product }) => `Noted. I will watch ${product} with you, and say so plainly if it is too early to tell.`,
  forget_confirm: () => "Shall I forget everything about you, including your scans and ledger? Say yes to confirm.",
  forgotten: () => "All forgotten. The mirror is clean.",
  consent_look_needed: () => "I need your permission to look at the bottle. You can allow it in the privacy settings.",
  consent_scan_needed: () =>
    "I need your permission to send a photo for a skin scan. You can allow it in the privacy settings.",
  error_generic: () => "Something slipped. Shall we try that again?",
  error_network: () => "I cannot reach the network just now.",
  referral: () => "A dermatologist can help if something worries you.",
};

// --------------------------------------------------------------------- Hindi

const hi: Table = {
  welcome: (p) => `स्वागत है${addr(p)}। यह दर्पण आपका है।`,
  welcome_back: (p) => `फिर से स्वागत है${addr(p)}। शुरू करें?`,
  ready: () => "आप जब भी बोलना चाहें, दर्पण सुन रहा है।",
  greet: (p) => `नमस्ते${addr(p)}। दर्पण आपकी क्या सहायता करे?`,
  thanks: (p) => `आपका स्वागत है${addr(p)}।`,
  ack_no: () => "ठीक है। जब चाहें, बस कह दीजिए।",
  language_changed: () => "ठीक है, अब हिंदी में बात करेंगे।",
  title_set: ({ title }) => `ठीक है, अब से आपको ${title} कहा जाएगा।`,
  scan_start: () => "आइए ध्यान से देखें। सामने देखिए, ठहरने का समय दर्पण बता देगा।",
  report_none: () => "अभी दिखाने के लिए कोई माप नहीं है। अभी एक ले लें?",
  verify_no_baseline: () => "तुलना के लिए पहले एक माप चाहिए। अभी ले लें?",
  timer_stopped: () => "गिनती रोक दी।",
  ask_category: () => "यह उत्पाद पहचान नहीं आया। क्या यह क्लींज़र, सीरम, मॉइस्चराइज़र या सनस्क्रीन है?",
  mic_blocked: () => "दर्पण अभी आपकी आवाज़ नहीं सुन पा रहा। ब्राउज़र में माइक्रोफ़ोन की अनुमति दीजिए, या टाइप कर दीजिए।",
  mic_unsupported: () => "इस ब्राउज़र में आवाज़ पहचान उपलब्ध नहीं है। आप टाइप कर सकते हैं या बटन दबा सकते हैं।",
  didnt_catch: (p) =>
    `क्षमा कीजिए${addr(p)}, बात ठीक से समझ नहीं आई। आप कह सकते हैं: मेरी त्वचा स्कैन करो, रूटीन शुरू करो, या बताइए कि आप क्या लगा रहे हैं।`,
  brain_offline: () => "दर्पण की सोच अभी थोड़ी धीमी है, इसलिए सीधे-सादे नियमों से काम चलेगा।",
  camera_denied: () => "कैमरा अभी बंद है। ब्राउज़र में अनुमति दीजिए, या कोई फ़ोटो अपलोड कर दीजिए।",
  hint_no_face: () => "आपका चेहरा अभी दिख नहीं रहा। रोशनी में आइए और सामने देखिए।",
  hint_multi_face: () => "एक से ज़्यादा चेहरे दिख रहे हैं। बस आप ही रहिए।",
  hint_closer: () => "ज़रा और पास आइए।",
  hint_back: () => "थोड़ा पीछे हो जाइए।",
  hint_shift_left: () => "थोड़ा अपनी बाईं ओर आइए।",
  hint_shift_right: () => "थोड़ा अपनी दाईं ओर आइए।",
  hint_lower: () => "थोड़ा नीचे आइए।",
  hint_higher: () => "थोड़ा ऊपर उठिए।",
  hint_more_light: () => "रोशनी कम है। खिड़की या तेज़ लैंप की ओर मुँह कीजिए।",
  hint_even_light: () => "रोशनी एक तरफ़ से आ रही है। रोशनी की ओर थोड़ा घूमिए।",
  hint_glare: () => "चमक बहुत तेज़ है। रोशनी थोड़ी नरम कीजिए।",
  hint_hold_still: () => "बहुत अच्छे। ठहरिए।",
  hint_level: () => "सिर सीधा कीजिए, जैसे ताज संभाल रहे हों।",
  hint_face_forward: () => "सीधे सामने देखिए।",
  countdown: ({ n }) => (n === 3 ? "तीन" : n === 2 ? "दो" : "एक"),
  captured: () => "तस्वीर ले ली। ज़रा ध्यान से देखने दीजिए।",
  analyzing_long: () => "अभी ध्यान से देख रहे हैं। अच्छी चीज़ों में थोड़ा समय लगता है।",
  scan_cooldown: ({ minutes }) =>
    `${minutes} मिनट पहले ही आपकी त्वचा देखी थी। उत्पादों को थोड़ा समय दीजिए, फिर दोबारा देखेंगे।`,
  scan_budget: () => "अभी मापन की सीमा पूरी हो गई है, इसलिए नमूना अंक दिखा रहे हैं। ये आपकी असली माप नहीं हैं।",
  scan_demo_notice: () => "डेमो मोड है, इसलिए ये अंक सिर्फ़ नमूना हैं, आपकी असली माप नहीं।",
  scan_error: ({ kind }) => {
    const m: Record<ScanErrorKind, string> = {
      no_face: "चेहरा नहीं मिला। सीधे सामने देखिए और रोशनी बढ़ाइए।",
      face_small: "चेहरा थोड़ा छोटा दिख रहा है। और पास आइए और फिर कोशिश कीजिए।",
      face_bounds: "चेहरा फ़्रेम से बाहर जा रहा है। बीच में आइए और फिर कोशिश कीजिए।",
      multi_face: "एक से ज़्यादा चेहरे दिख रहे हैं। आईने में सिर्फ़ आप रहिए और फिर कोशिश कीजिए।",
      dark: "रोशनी कम है। किसी खिड़की के पास जाइए और फिर कोशिश कीजिए।",
      small_image: "तस्वीर बहुत छोटी है। थोड़ी बड़ी तस्वीर या बेहतर कैमरा आज़माइए।",
      big_image: "तस्वीर बहुत बड़ी है। थोड़ी छोटी तस्वीर आज़माइए।",
      angle: "चेहरा थोड़ा तिरछा है। सीधे सामने देखिए और फिर कोशिश कीजिए।",
      busy: "सेवा अभी व्यस्त है। थोड़ी देर बाद फिर कोशिश कीजिए।",
      unavailable: "मापन की सेवा अभी उपलब्ध नहीं है, इसलिए नमूना अंक दिखाए जाएँगे।",
      network: "अभी नेटवर्क नहीं मिल रहा। कृपया फिर कोशिश कीजिए।",
      generic: "कुछ गड़बड़ हो गई। एक बार फिर कोशिश करें?",
    };
    return m[kind];
  },
  report_strength: (p) => `आज आपकी सबसे अच्छी बात है: ${p.label}${addr(p)}।`,
  report_ask_focus: () => "क्या एक छोटी-सी बात कहने की इजाज़त है?",
  report_focus: ({ label }) => `${label} वह जगह है जहाँ थोड़ी अतिरिक्त देखभाल सबसे ज़्यादा दिखेगी।`,
  report_uncertainty: () => "रोशनी और रंगत, दोनों अंकों को थोड़ा हिला सकते हैं, इसलिए इन्हें हल्के हाथ से लीजिए।",
  report_decline: () => "ठीक है, यह बात अपने तक रखते हैं। जब चाहें, पूछ लीजिए।",
  report_all_high: () => "सब कुछ बहुत संतुलित दिख रहा है। बस इसी तरह जारी रखिए।",
  ritual_start: (p) =>
    p.period === "am"
      ? `सुप्रभात${addr(p)}। आइए सुबह की दिनचर्या शुरू करें। पहले कौन-सा उत्पाद?`
      : `शुभ संध्या${addr(p)}। आइए रात की दिनचर्या शुरू करें। पहले कौन-सा उत्पाद?`,
  ask_potion: () => "कौन-सा उत्पाद लगा रहे हैं?",
  look_failed: () => "लेबल पढ़ नहीं पाए। नाम बता दीजिए, याद रख लेंगे।",
  look_found_confirm: ({ name }) => `यह ${name} जैसा दिखता है। क्या यही है?`,
  product_noted: ({ name }) => `${name}, बहुत अच्छा।`,
  next_step: ({ slot }) => `अगला कदम: ${SLOT_PHRASE.hi[slot]}।`,
  note: ({ code, slot, after }) => {
    const late =
      slot && after
        ? `${SLOT_PHRASE.hi[slot]} आमतौर पर ${SLOT_PHRASE.hi[after]} से पहले आता है, फिर भी अपनी त्वचा को आप ही बेहतर जानते हैं।`
        : "";
    const m: Record<NoteCode, string> = {
      order_late: late,
      clash_retinoid_exfoliant:
        "रेटिनॉल और एक्सफ़ोलिएटिंग एसिड साथ में थोड़े ज़्यादा लग सकते हैं। कई लोग इन्हें अलग-अलग शामों में रखते हैं।",
      clash_retinoid_benzoyl: "ये दोनों साथ में कठोर लग सकते हैं, इसलिए कई लोग इन्हें दिन के अलग-अलग समय पर लगाते हैं।",
      clash_retinoid_vitc: "ये दोनों अलग-अलग समय पसंद करते हैं: सुबह विटामिन सी, शाम को रेटिनॉल।",
      clash_double_exfoliant: "एक बार में दो एक्सफ़ोलिएंट ज़्यादा हो सकते हैं। आमतौर पर एक ही काफ़ी है।",
      clash_vitc_exfoliant: "एक्सफ़ोलिएटिंग एसिड के तुरंत बाद विटामिन सी चुभ सकता है। थोड़ा समय दे दीजिए।",
      clash_benzoyl_vitc: "बेंज़ॉयल पेरोक्साइड और विटामिन सी अलग-अलग ही अच्छे रहते हैं। इन्हें अलग समय पर आज़माइए।",
      overload: "एक बैठक के लिए यह काफ़ी सारे सक्रिय उत्पाद हैं। ध्यान दीजिए कि त्वचा को कैसा लग रहा है।",
      period_retinoid_am: "रेटिनॉल आमतौर पर शाम के लिए रखा जाता है, और दिन में लगाएँ तो सनस्क्रीन ज़रूरी है।",
      period_spf_pm: "सनस्क्रीन दिन के लिए है, आज रात इसे छोड़ सकते हैं।",
      period_exfoliant_am: "एक्सफ़ोलिएटिंग एसिड शाम को ज़्यादा नरम रहते हैं, और अगले दिन सनस्क्रीन ज़रूरी है।",
      spf_missing: "सनस्क्रीन अभी बाकी है, वही सुबह का आख़िरी निखार है।",
    };
    return m[code];
  },
  timer_start: ({ seconds, kind }) => {
    const d = duration(seconds, "hi");
    if (kind === "massage") return `${d} हल्के हाथ से मालिश कीजिए। समय हम गिनेंगे।`;
    if (kind === "settle") return `${d} रुकिए ताकि यह अच्छे से बैठ जाए।`;
    if (kind === "mask") return `${d} आराम कीजिए। समय होने पर बता देंगे।`;
    return `${d} की गिनती शुरू।`;
  },
  timer_done: ({ kind }) =>
    kind === "massage"
      ? "समय हो गया। हल्के से धो लीजिए।"
      : kind === "mask"
        ? "समय हो गया। मास्क को हल्के से हटा लीजिए।"
        : kind === "settle"
          ? "समय हो गया। आगे बढ़ें?"
          : "समय पूरा।",
  ritual_complete: (p) => `आपकी दिनचर्या पूरी हुई${addr(p)}। थोड़ी देर बाद एक बार फिर देख लें?`,
  ritual_complete_plain: (p) => `आपकी दिनचर्या पूरी हुई${addr(p)}।`,
  ritual_skipped: ({ slot }) => `${SLOT_PHRASE.hi[slot]} छोड़ देते हैं।`,
  ritual_none_active: () => "अभी कोई दिनचर्या चल नहीं रही। कहिए: सुबह की दिनचर्या शुरू करो, या रात की दिनचर्या शुरू करो।",
  verify_too_soon: ({ minutes }) =>
    `उत्पादों को थोड़ा समय चाहिए। लगभग ${minutes} मिनट बाद दूसरी नज़र ज़्यादा बताएगी। फिर भी अभी देखें?`,
  verify_ready: () => "दूसरी नज़र डालें?",
  verify_better: ({ label }) => `${label} में हल्का सुधार दिखता है।`,
  verify_same: () => "सब कुछ लगभग पहले जैसा है, और यह ईमानदार ख़बर है।",
  verify_softer: ({ label }) => `${label} में हल्की कमी दिखती है, जो अक्सर रोशनी और कोण की वजह से होती है।`,
  verify_caveat: () =>
    "एक ही बैठक में बदलाव ज़्यादातर रोशनी और कोण का असर होते हैं, इसलिए इसे संकेत समझिए, नतीजा नहीं।",
  look_intro: () => "कोई लुक चुनिए, पहले आपके अपने चेहरे पर दिखाएँगे।",
  look_rendering: () => "आपके चेहरे पर लगा रहे हैं। ज़रा रुकिए।",
  look_ready: (p) => `${p.name} आप पर${addr(p)}। इसे असली उत्पादों से दोहराने में मदद करें?`,
  look_demo: () => "लुक का पूर्वावलोकन YouCam कुंजी माँगता है, इसलिए अभी विधि दिखा रहे हैं।",
  look_unavailable: () => "लुक का पूर्वावलोकन अभी उपलब्ध नहीं है, इसलिए विधि दिखा रहे हैं।",
  look_steps_intro: ({ name }) => `${name} को दोहराने का तरीका, एक-एक कदम। अगले कदम के लिए "अगला" कहिए।`,
  look_hold: () => "बोतल को ऐसे उठाइए कि लेबल दर्पण की ओर रहे।",
  look_done: () => "और बस, लुक पूरा हुआ।",
  ledger_empty: () => "बही अभी खाली है। कुछ नया शुरू करें तो बता दीजिए, हम हिसाब रखेंगे।",
  ledger_too_early: ({ product, days }) => `${product} के बारे में कहना अभी जल्दी है। लगभग ${days} दिन और दीजिए।`,
  ledger_need_scans: ({ product }) => `${product} के बारे में कुछ कहने से पहले अलग-अलग दिनों के कुछ और स्कैन चाहिए।`,
  ledger_improving: ({ product, labels }) => `${product} के साथ ${labels} में हल्का सुधार दिख रहा है।`,
  ledger_steady: ({ product }) => `${product} के साथ अभी कोई ख़ास बदलाव नहीं दिखता, और यह भी जानकारी है।`,
  ledger_declining: ({ product, labels }) =>
    `${product} के साथ ${labels} में कमी दिख रही है। शायद थोड़ा ठहरकर अपनी दिनचर्या देखना ठीक रहे।`,
  ledger_mixed: ({ product }) => `${product} के साथ अभी मिला-जुला असर दिखता है, इसलिए नज़र रखते हैं।`,
  ledger_confounded: () => "आपने लगभग एक ही समय पर कई चीज़ें शुरू कीं, इसलिए कहना कठिन है कि किसने असर किया।",
  ledger_no_visible: ({ product }) => `${product} रोज़ की देखभाल का हिस्सा है, दिखने वाले बदलाव का नहीं, इसलिए अंकों से उम्मीद नहीं रखेंगे।`,
  track_ask: ({ product }) => `क्या ${product} आपकी शेल्फ़ में नया है? हम बही में रख सकते हैं कि यह काम कर रहा है या नहीं।`,
  track_started: ({ product }) => `ठीक है। ${product} पर नज़र रखेंगे, और जल्दबाज़ी हो तो साफ़ कह देंगे।`,
  forget_confirm: () => "क्या सब कुछ भुला दूँ, स्कैन और बही समेत? पक्का करने के लिए हाँ कहिए।",
  forgotten: () => "सब भुला दिया। दर्पण साफ़ है।",
  consent_look_needed: () => "बोतल देखने के लिए आपकी अनुमति चाहिए। इसे गोपनीयता सेटिंग में चालू कर सकते हैं।",
  consent_scan_needed: () =>
    "त्वचा स्कैन के लिए फ़ोटो भेजने की आपकी अनुमति चाहिए। इसे गोपनीयता सेटिंग में चालू कर सकते हैं।",
  error_generic: () => "कुछ गड़बड़ हो गई। फिर कोशिश करें?",
  error_network: () => "अभी नेटवर्क नहीं मिल रहा।",
  referral: () => "कोई बात चिंतित करे तो त्वचा विशेषज्ञ मदद कर सकते हैं।",
};

// ------------------------------------------------------------------ Hinglish

const hinglish: Table = {
  welcome: (p) => `Swagat hai${addr(p)}. Yeh darpan aapka hai.`,
  welcome_back: (p) => `Phir se swagat hai${addr(p)}. Shuru karein?`,
  ready: () => "Aap jab bhi bolna chahein, darpan sun raha hai.",
  greet: (p) => `Namaste${addr(p)}. Darpan aapki kya madad kare?`,
  thanks: (p) => `Aapka swagat hai${addr(p)}.`,
  ack_no: () => "Theek hai. Jab chahein, bas keh dijiye.",
  language_changed: () => "Theek hai, ab Hinglish mein baat karenge.",
  title_set: ({ title }) => `Theek hai, ab se aapko ${title} kaha jayega.`,
  scan_start: () => "Aaiye dhyaan se dekhein. Saamne dekhiye, rukne ka time Darpan bata dega.",
  report_none: () => "Abhi dikhane ke liye koi measurement nahi hai. Abhi ek le lein?",
  verify_no_baseline: () => "Tulna ke liye pehle ek measurement chahiye. Abhi le lein?",
  timer_stopped: () => "Ginti rok di.",
  ask_category: () => "Yeh product pehchaan nahi aaya. Kya yeh cleanser, serum, moisturizer ya sunscreen hai?",
  mic_blocked: () =>
    "Darpan abhi aapki awaaz nahi sun pa raha. Browser mein microphone ki permission dijiye, ya type kar dijiye.",
  mic_unsupported: () =>
    "Is browser mein awaaz pehchaan available nahi hai. Aap type kar sakte hain ya buttons use kar sakte hain.",
  didnt_catch: (p) =>
    `Maaf kijiye${addr(p)}, baat theek se samajh nahi aayi. Aap keh sakte hain: meri skin scan karo, routine shuru karo, ya bataiye kya laga rahe hain.`,
  brain_offline: () => "Darpan ki soch abhi thodi dheemi hai, isliye seedhe-saade niyamon se kaam chalega.",
  camera_denied: () => "Camera abhi band hai. Browser mein permission dijiye, ya koi photo upload kar dijiye.",
  hint_no_face: () => "Aapka chehra abhi dikh nahi raha. Roshni mein aaiye aur saamne dekhiye.",
  hint_multi_face: () => "Ek se zyada chehre dikh rahe hain. Bas aap hi rahiye.",
  hint_closer: () => "Zara aur paas aaiye.",
  hint_back: () => "Thoda peeche ho jaaiye.",
  hint_shift_left: () => "Thoda apni left taraf aaiye.",
  hint_shift_right: () => "Thoda apni right taraf aaiye.",
  hint_lower: () => "Thoda neeche aaiye.",
  hint_higher: () => "Thoda upar uthiye.",
  hint_more_light: () => "Roshni kam hai. Khidki ya tez lamp ki taraf muh kijiye.",
  hint_even_light: () => "Roshni ek taraf se aa rahi hai. Roshni ki taraf thoda ghoomiye.",
  hint_glare: () => "Chamak bahut tez hai. Roshni thodi naram kijiye.",
  hint_hold_still: () => "Bahut accha. Ek second ruk jaaiye.",
  hint_level: () => "Sir seedha kijiye, jaise taaj sambhal rahe hon.",
  hint_face_forward: () => "Seedha saamne dekhiye.",
  countdown: ({ n }) => (n === 3 ? "Teen" : n === 2 ? "Do" : "Ek"),
  captured: () => "Photo le li. Zara dhyaan se dekhne dijiye.",
  analyzing_long: () => "Abhi dhyaan se dekh rahe hain. Achhi cheezon mein thoda time lagta hai.",
  scan_cooldown: ({ minutes }) =>
    `${minutes} minute pehle hi aapki skin dekhi thi. Products ko thoda time dijiye, phir dobara dekhenge.`,
  scan_budget: () =>
    "Abhi measuring ki limit poori ho gayi hai, isliye sample numbers dikha rahe hain. Yeh aapki asli measurement nahi hain.",
  scan_demo_notice: () => "Demo mode hai, isliye yeh numbers sirf sample hain, aapki asli measurement nahi.",
  scan_error: ({ kind }) => {
    const m: Record<ScanErrorKind, string> = {
      no_face: "Chehra nahi mila. Seedha saamne dekhiye aur roshni badhaiye.",
      face_small: "Chehra thoda chhota dikh raha hai. Aur paas aaiye aur phir koshish kijiye.",
      face_bounds: "Chehra frame se bahar ja raha hai. Beech mein aaiye aur phir koshish kijiye.",
      multi_face: "Ek se zyada chehre dikh rahe hain. Aaine mein sirf aap rahiye aur phir koshish kijiye.",
      dark: "Roshni kam hai. Kisi khidki ke paas jaaiye aur phir koshish kijiye.",
      small_image: "Photo bahut chhoti hai. Thodi badi photo ya behtar camera try kijiye.",
      big_image: "Photo bahut badi hai. Thodi chhoti photo try kijiye.",
      angle: "Chehra thoda tirchha hai. Seedha saamne dekhiye aur phir koshish kijiye.",
      busy: "Service abhi busy hai. Thodi der baad phir koshish kijiye.",
      unavailable: "Measuring service abhi available nahi hai, isliye sample numbers dikhaye jaayenge.",
      network: "Abhi network nahi mil raha. Phir se koshish kijiye.",
      generic: "Kuch gadbad ho gayi. Ek baar phir koshish karein?",
    };
    return m[kind];
  },
  report_strength: (p) => `Aaj aapki sabse achhi baat hai: ${p.label}${addr(p)}.`,
  report_ask_focus: () => "Kya ek chhoti si baat kehne ki ijaazat hai?",
  report_focus: ({ label }) => `${label} woh jagah hai jahan thodi extra dekhbhaal sabse zyada dikhegi.`,
  report_uncertainty: () => "Roshni aur rangat, dono numbers ko thoda hila sakte hain, isliye inhe halke haath se lijiye.",
  report_decline: () => "Theek hai, yeh baat apne tak rakhte hain. Jab chahein, pooch lijiye.",
  report_all_high: () => "Sab kuch bahut santulit dikh raha hai. Bas isi tarah jaari rakhiye.",
  ritual_start: (p) =>
    p.period === "am"
      ? `Suprabhat${addr(p)}. Chaliye subah ki routine shuru karein. Pehle kaun sa potion?`
      : `Shubh sandhya${addr(p)}. Chaliye raat ki routine shuru karein. Pehle kaun sa potion?`,
  ask_potion: () => "Kaun sa potion laga rahe hain?",
  look_failed: () => "Label padh nahi paaye. Naam bata dijiye, yaad rakh lenge.",
  look_found_confirm: ({ name }) => `Yeh ${name} jaisa lagta hai. Kya yahi hai?`,
  product_noted: ({ name }) => `${name}, bahut accha.`,
  next_step: ({ slot }) => `Agla kadam: ${SLOT_PHRASE.hinglish[slot]}.`,
  note: ({ code, slot, after }) => {
    const late =
      slot && after
        ? `${capitalize(SLOT_PHRASE.hinglish[slot])} aam taur par ${SLOT_PHRASE.hinglish[after]} se pehle aata hai, phir bhi apni skin ko aap hi behtar jaante hain.`
        : "";
    const m: Record<NoteCode, string> = {
      order_late: late,
      clash_retinoid_exfoliant:
        "Retinol aur exfoliating acids saath mein thode zyada lag sakte hain. Kai log inhe alag-alag shaamon mein rakhte hain.",
      clash_retinoid_benzoyl: "Yeh dono saath mein kathor lag sakte hain, isliye kai log inhe din ke alag-alag samay par lagate hain.",
      clash_retinoid_vitc: "Yeh dono alag-alag samay pasand karte hain: subah vitamin C, shaam ko retinol.",
      clash_double_exfoliant: "Ek baar mein do exfoliants zyada ho sakte hain. Aam taur par ek hi kaafi hai.",
      clash_vitc_exfoliant: "Exfoliating acid ke turant baad vitamin C chubh sakta hai. Thoda time de dijiye.",
      clash_benzoyl_vitc: "Benzoyl peroxide aur vitamin C alag-alag hi achhe rehte hain. Inhe alag samay par try kijiye.",
      overload: "Ek baithak ke liye yeh kaafi saare active products hain. Dhyaan dijiye ki skin ko kaisa lag raha hai.",
      period_retinoid_am: "Retinol aam taur par shaam ke liye rakha jata hai, aur din mein lagayein to sunscreen zaroori hai.",
      period_spf_pm: "Sunscreen din ke liye hai, aaj raat ise chhod sakte hain.",
      period_exfoliant_am: "Exfoliating acids shaam ko zyada naram rehte hain, aur agle din sunscreen zaroori hai.",
      spf_missing: "Sunscreen abhi baaki hai, wahi subah ka aakhri nikhaar hai.",
    };
    return m[code];
  },
  timer_start: ({ seconds, kind }) => {
    const d = duration(seconds, "hinglish");
    if (kind === "massage") return `${d} halke haath se massage kijiye. Time hum ginenge.`;
    if (kind === "settle") return `${d} rukiye taaki yeh achhe se baith jaye.`;
    if (kind === "mask") return `${d} aaraam kijiye. Time hone par bata denge.`;
    return `${d} ki ginti shuru.`;
  },
  timer_done: ({ kind }) =>
    kind === "massage"
      ? "Time ho gaya. Halke se dho lijiye."
      : kind === "mask"
        ? "Time ho gaya. Mask ko halke se utaar lijiye."
        : kind === "settle"
          ? "Time ho gaya. Aage badhein?"
          : "Time poora.",
  ritual_complete: (p) => `Aapki routine poori hui${addr(p)}. Thodi der baad ek baar phir dekh lein?`,
  ritual_complete_plain: (p) => `Aapki routine poori hui${addr(p)}.`,
  ritual_skipped: ({ slot }) => `${capitalize(SLOT_PHRASE.hinglish[slot])} chhod dete hain.`,
  ritual_none_active: () => "Abhi koi routine chal nahi rahi. Kahiye: subah ki routine shuru karo, ya raat ki routine shuru karo.",
  verify_too_soon: ({ minutes }) =>
    `Products ko thoda time chahiye. Lagbhag ${minutes} minute baad doosri nazar zyada batayegi. Phir bhi abhi dekhein?`,
  verify_ready: () => "Doosri nazar daalein?",
  verify_better: ({ label }) => `${label} mein halka sudhaar dikhta hai.`,
  verify_same: () => "Sab kuch lagbhag pehle jaisa hai, aur yeh imaandaar khabar hai.",
  verify_softer: ({ label }) => `${label} mein halki kami dikhti hai, jo aksar roshni aur angle ki wajah se hoti hai.`,
  verify_caveat: () =>
    "Ek hi baithak mein badlaav zyadatar roshni aur angle ka asar hote hain, isliye ise sanket samjhiye, nateeja nahi.",
  look_intro: () => "Koi look chuniye, pehle aapke apne chehre par dikhayenge.",
  look_rendering: () => "Aapke chehre par laga rahe hain. Zara rukiye.",
  look_ready: (p) => `${p.name} aap par${addr(p)}. Ise asli products se dohrane mein madad karein?`,
  look_demo: () => "Look preview ke liye YouCam key chahiye, isliye abhi recipe dikha rahe hain.",
  look_unavailable: () => "Look preview abhi available nahi hai, isliye recipe dikha rahe hain.",
  look_steps_intro: ({ name }) => `${name} ko dohrane ka tareeka, ek-ek kadam. Agle kadam ke liye "next" bolein.`,
  look_hold: () => "Bottle ko aise uthaiye ki label darpan ki taraf rahe.",
  look_done: () => "Aur bas, look poora hua.",
  ledger_empty: () => "Bahi abhi khaali hai. Kuch naya shuru karein to bata dijiye, hum hisaab rakhenge.",
  ledger_too_early: ({ product, days }) => `${product} ke baare mein kehna abhi jaldi hai. Lagbhag ${days} din aur dijiye.`,
  ledger_need_scans: ({ product }) => `${product} ke baare mein kuch kehne se pehle alag-alag dinon ke kuch aur scans chahiye.`,
  ledger_improving: ({ product, labels }) => `${product} ke saath ${labels} mein halka sudhaar dikh raha hai.`,
  ledger_steady: ({ product }) => `${product} ke saath abhi koi khaas badlaav nahi dikhta, aur yeh bhi jaankari hai.`,
  ledger_declining: ({ product, labels }) =>
    `${product} ke saath ${labels} mein kami dikh rahi hai. Shayad thoda ruk kar apni routine dekhna theek rahe.`,
  ledger_mixed: ({ product }) => `${product} ke saath abhi mila-jula asar dikhta hai, isliye nazar rakhte hain.`,
  ledger_confounded: () => "Aapne lagbhag ek hi samay par kai cheezein shuru kin, isliye kehna kathin hai ki kisne asar kiya.",
  ledger_no_visible: ({ product }) =>
    `${product} roz ki dekhbhaal ka hissa hai, dikhne wale badlaav ka nahi, isliye numbers se ummeed nahi rakhenge.`,
  track_ask: ({ product }) => `Kya ${product} aapki shelf mein naya hai? Hum bahi mein rakh sakte hain ki yeh kaam kar raha hai ya nahi.`,
  track_started: ({ product }) => `Theek hai. ${product} par nazar rakhenge, aur jaldbaazi ho to saaf keh denge.`,
  forget_confirm: () => "Kya sab kuch bhula doon, scans aur bahi samet? Pakka karne ke liye haan kahiye.",
  forgotten: () => "Sab bhula diya. Darpan saaf hai.",
  consent_look_needed: () => "Bottle dekhne ke liye aapki permission chahiye. Ise privacy settings mein on kar sakte hain.",
  consent_scan_needed: () =>
    "Skin scan ke liye photo bhejne ki aapki permission chahiye. Ise privacy settings mein on kar sakte hain.",
  error_generic: () => "Kuch gadbad ho gayi. Phir koshish karein?",
  error_network: () => "Abhi network nahi mil raha.",
  referral: () => "Agar kuch chinta kare to dermatologist madad kar sakte hain.",
};

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

const TABLES: Record<Language, Table> = { en, hi, hinglish };

/** Render one canned line. */
export function line<K extends LineId>(lang: Language, id: K, params: LineParams[K]): string {
  const fn = TABLES[lang][id] as (p: LineParams[K]) => string;
  return fn(params);
}

/** Every line in every language with representative parameters. Used by the CI claim linter. */
export function allSampleLines(): string[] {
  const out: string[] = [];
  const slots: SlotId[] = ["oil_cleanse", "cleanse", "tone", "exfoliate", "treat", "serum", "eye", "moisturize", "oil", "protect", "extra"];
  const kinds: TimerKind[] = ["massage", "settle", "mask", "custom"];
  const errors: ScanErrorKind[] = ["no_face", "face_small", "face_bounds", "multi_face", "dark", "small_image", "big_image", "angle", "busy", "unavailable", "network", "generic"];
  const notes: NoteCode[] = [
    "order_late",
    "clash_retinoid_exfoliant",
    "clash_retinoid_benzoyl",
    "clash_retinoid_vitc",
    "clash_double_exfoliant",
    "clash_vitc_exfoliant",
    "clash_benzoyl_vitc",
    "overload",
    "period_retinoid_am",
    "period_spf_pm",
    "period_exfoliant_am",
    "spf_missing",
  ];
  for (const lang of ["en", "hi", "hinglish"] as const) {
    const t = TABLES[lang];
    const title = lang === "hi" ? "हुज़ूर" : "Your Highness";
    const base = { title };
    for (const id of Object.keys(t) as LineId[]) {
      switch (id) {
        case "countdown":
          for (const n of [1, 2, 3] as const) out.push(line(lang, "countdown", { n }));
          break;
        case "scan_cooldown":
          out.push(line(lang, "scan_cooldown", { minutes: 1 }), line(lang, "scan_cooldown", { minutes: 7 }));
          break;
        case "scan_error":
          for (const kind of errors) out.push(line(lang, "scan_error", { kind }));
          break;
        case "report_strength":
          out.push(line(lang, "report_strength", { ...base, label: "Hydration" }));
          break;
        case "report_focus":
          out.push(line(lang, "report_focus", { label: "Smoothness" }));
          break;
        case "ritual_start":
          out.push(line(lang, "ritual_start", { ...base, period: "am" }), line(lang, "ritual_start", { ...base, period: "pm" }));
          break;
        case "look_found_confirm":
          out.push(line(lang, "look_found_confirm", { name: "Vitamin C serum" }));
          break;
        case "product_noted":
          out.push(line(lang, "product_noted", { name: "Vitamin C serum" }));
          break;
        case "next_step":
          for (const slot of slots) out.push(line(lang, "next_step", { slot }));
          break;
        case "note":
          for (const code of notes) out.push(line(lang, "note", { code, slot: "serum", after: "moisturize" }));
          break;
        case "timer_start":
          for (const kind of kinds) out.push(line(lang, "timer_start", { seconds: 60, kind }), line(lang, "timer_start", { seconds: 600, kind }));
          break;
        case "timer_done":
          for (const kind of kinds) out.push(line(lang, "timer_done", { kind }));
          break;
        case "ritual_skipped":
          for (const slot of slots) out.push(line(lang, "ritual_skipped", { slot }));
          break;
        case "verify_too_soon":
          out.push(line(lang, "verify_too_soon", { minutes: 12 }));
          break;
        case "verify_better":
          out.push(line(lang, "verify_better", { label: "Hydration" }));
          break;
        case "verify_softer":
          out.push(line(lang, "verify_softer", { label: "Hydration" }));
          break;
        case "look_ready":
          out.push(line(lang, "look_ready", { ...base, name: "Rani Rose" }));
          break;
        case "look_steps_intro":
          out.push(line(lang, "look_steps_intro", { name: "Rani Rose" }));
          break;
        case "ledger_too_early":
          out.push(line(lang, "ledger_too_early", { product: "Retinol", days: 1 }), line(lang, "ledger_too_early", { product: "Retinol", days: 9 }));
          break;
        case "ledger_improving":
          out.push(line(lang, "ledger_improving", { product: "Retinol", labels: "smoothness and radiance" }));
          break;
        case "ledger_declining":
          out.push(line(lang, "ledger_declining", { product: "Retinol", labels: "hydration" }));
          break;
        case "ledger_need_scans":
        case "ledger_steady":
        case "ledger_mixed":
        case "ledger_confounded":
        case "ledger_no_visible":
        case "track_ask":
        case "track_started":
          out.push((t[id] as (p: { product: string }) => string)({ product: "Retinol" }));
          break;
        default:
          out.push((t[id] as (p: T) => string)(base));
      }
    }
  }
  return out;
}
