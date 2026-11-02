import type { Language } from "./types";

/**
 * Look Studio: a small, curated set of looks. Each look holds the YouCam makeup-vto `effects`
 * payload (applied to the person's own photo) AND a plain-language recipe to recreate it with
 * real products. Effects live server-side only in practice: the browser sends a look id, never
 * a free-form payload, so a visitor cannot spend units on arbitrary requests.
 *
 * Skin smoothing is switched OFF in every look: a preview should show makeup, not airbrushing.
 * Palette counts match each pattern's colour count, and texture-specific fields follow
 * YouCam's makeup-vto reference (satin blush needs glowStrength; gloss/sheer lips need gloss
 * and transparencyIntensity).
 */

export const LOOK_IDS = ["rani_rose", "marigold_glow", "midnight_kohl", "peacock_pop", "barely_there"] as const;
export type LookId = (typeof LOOK_IDS)[number];

export type Finish = "matte" | "satin" | "gloss" | "sheer";
export type StepKind = "blush" | "lips" | "eyes" | "brows" | "lashes";
type L3 = Record<Language, string>;

export interface LookStep {
  kind: StepKind;
  color: L3;
  finish?: Finish;
}

export type VtoEffect = Record<string, unknown>;

export interface LookDef {
  id: LookId;
  name: L3;
  mood: L3;
  /** Hex colours for the swatch chips in the UI. */
  swatches: string[];
  effects: VtoEffect[];
  steps: LookStep[];
}

const SMOOTH_OFF: VtoEffect = { category: "skin_smooth", skinSmoothStrength: 0, skinSmoothColorIntensity: 0 };
const BROWS_TINT = (color: string): VtoEffect => ({
  category: "eyebrows",
  pattern: { type: "color" },
  palettes: [{ color, texture: "matte", colorIntensity: 35 }],
});
const LASHES = (intensity = 60): VtoEffect => ({
  category: "eyelashes",
  pattern: { name: "Upper1" },
  palettes: [{ color: "#141414", colorIntensity: intensity }],
});
const LIPS_FULL = (palette: Record<string, unknown>): VtoEffect => ({
  category: "lip_color",
  shape: { name: "original" },
  morphology: { fullness: 0, wrinkless: 0 },
  style: { type: "full" },
  palettes: [palette],
});

export const LOOKS: Record<LookId, LookDef> = {
  rani_rose: {
    id: "rani_rose",
    name: { en: "Rani Rose", hi: "रानी गुलाब", hinglish: "Rani Rose" },
    mood: { en: "Soft, rosy, daytime", hi: "कोमल, गुलाबी, दिन के लिए", hinglish: "Komal, gulabi, din ke liye" },
    swatches: ["#e8909a", "#c2386b", "#e3c3a8", "#d9707f"],
    effects: [
      SMOOTH_OFF,
      {
        category: "blush",
        pattern: { name: "2colors1" },
        palettes: [
          { color: "#e8909a", texture: "matte", colorIntensity: 55 },
          { color: "#d9707f", texture: "matte", colorIntensity: 60 },
        ],
      },
      LIPS_FULL({ color: "#c2386b", texture: "matte", colorIntensity: 70 }),
      { category: "eye_shadow", pattern: { name: "1color1" }, palettes: [{ color: "#e3c3a8", texture: "matte", colorIntensity: 45 }] },
      BROWS_TINT("#4a3426"),
    ],
    steps: [
      { kind: "blush", color: { en: "soft rose", hi: "हल्का गुलाबी", hinglish: "halka gulabi" }, finish: "matte" },
      { kind: "lips", color: { en: "rose-berry", hi: "गुलाबी-बेरी", hinglish: "rose-berry" }, finish: "matte" },
      { kind: "eyes", color: { en: "champagne", hi: "शैंपेन", hinglish: "champagne" } },
      { kind: "brows", color: { en: "soft brown", hi: "हल्के भूरे", hinglish: "halke brown" } },
    ],
  },
  marigold_glow: {
    id: "marigold_glow",
    name: { en: "Marigold Glow", hi: "गेंदा दमक", hinglish: "Marigold Glow" },
    mood: { en: "Warm, peachy, golden hour", hi: "गुनगुना, आड़ू जैसा, सुनहरी शाम", hinglish: "Garam, peachy, sunehri shaam" },
    swatches: ["#ff9f7a", "#ff6f61", "#d4a24c", "#ffb020"],
    effects: [
      SMOOTH_OFF,
      {
        category: "blush",
        pattern: { name: "1color1" },
        palettes: [{ color: "#ff9f7a", texture: "satin", glowStrength: 45, colorIntensity: 55 }],
      },
      LIPS_FULL({ color: "#ff6f61", texture: "gloss", colorIntensity: 65, gloss: 55, transparencyIntensity: 40 }),
      { category: "eye_shadow", pattern: { name: "1color1" }, palettes: [{ color: "#d4a24c", texture: "matte", colorIntensity: 50 }] },
      LASHES(),
    ],
    steps: [
      { kind: "blush", color: { en: "warm peach", hi: "गुनगुना आड़ू", hinglish: "garam peach" }, finish: "satin" },
      { kind: "lips", color: { en: "coral", hi: "मूँगा", hinglish: "coral" }, finish: "gloss" },
      { kind: "eyes", color: { en: "gold", hi: "सुनहरा", hinglish: "sunehra" } },
      { kind: "lashes", color: { en: "black", hi: "काला", hinglish: "kaala" } },
    ],
  },
  midnight_kohl: {
    id: "midnight_kohl",
    name: { en: "Midnight Kohl", hi: "आधी रात का काजल", hinglish: "Midnight Kohl" },
    mood: { en: "Smoky, plum, evening", hi: "धुँआ-धुँआ, बैंगनी, शाम के लिए", hinglish: "Smoky, plum, shaam ke liye" },
    swatches: ["#4b2c5e", "#7b4a8a", "#b57fb0", "#7a1f4a"],
    effects: [
      SMOOTH_OFF,
      {
        category: "eye_shadow",
        pattern: { name: "2colors1" },
        palettes: [
          { color: "#4b2c5e", texture: "matte", colorIntensity: 70 },
          { color: "#8e5c9c", texture: "matte", colorIntensity: 62 },
        ],
      },
      LIPS_FULL({ color: "#7a1f4a", texture: "satin", colorIntensity: 75 }),
      { category: "blush", pattern: { name: "1color1" }, palettes: [{ color: "#b9607a", texture: "matte", colorIntensity: 40 }] },
      LASHES(65),
    ],
    steps: [
      { kind: "eyes", color: { en: "deep plum and orchid", hi: "गहरा बैंगनी और ऑर्किड", hinglish: "deep plum aur orchid" } },
      { kind: "lips", color: { en: "deep berry", hi: "गहरी बेरी", hinglish: "deep berry" }, finish: "satin" },
      { kind: "blush", color: { en: "muted mauve", hi: "फीका जामुनी", hinglish: "muted mauve" }, finish: "matte" },
      { kind: "lashes", color: { en: "black", hi: "काला", hinglish: "kaala" } },
    ],
  },
  peacock_pop: {
    id: "peacock_pop",
    name: { en: "Peacock Pop", hi: "मोर पंख", hinglish: "Peacock Pop" },
    mood: { en: "Bright teal, playful", hi: "चटक हरा-नीला, चंचल", hinglish: "Chatak teal, chulbula" },
    swatches: ["#00a99d", "#c98b7a", "#f2a39a", "#2f6bff"],
    effects: [
      SMOOTH_OFF,
      { category: "eye_shadow", pattern: { name: "1color1" }, palettes: [{ color: "#00a99d", texture: "matte", colorIntensity: 55 }] },
      LIPS_FULL({ color: "#c98b7a", texture: "matte", colorIntensity: 55 }),
      { category: "blush", pattern: { name: "1color1" }, palettes: [{ color: "#f2a39a", texture: "matte", colorIntensity: 40 }] },
      BROWS_TINT("#4a3426"),
    ],
    steps: [
      { kind: "eyes", color: { en: "peacock teal", hi: "मोरपंखी", hinglish: "peacock teal" } },
      { kind: "lips", color: { en: "soft nude", hi: "हल्का न्यूड", hinglish: "soft nude" }, finish: "matte" },
      { kind: "blush", color: { en: "peach", hi: "आड़ू", hinglish: "peach" }, finish: "matte" },
      { kind: "brows", color: { en: "soft brown", hi: "हल्के भूरे", hinglish: "halke brown" } },
    ],
  },
  barely_there: {
    id: "barely_there",
    name: { en: "Barely There", hi: "हल्का-सा", hinglish: "Barely There" },
    mood: { en: "Fresh, tinted, effortless", hi: "ताज़ा, हल्का रंग, सहज", hinglish: "Taaza, halka rang, sehaj" },
    swatches: ["#d9837f", "#f2a39a", "#4a3426"],
    effects: [
      SMOOTH_OFF,
      LIPS_FULL({ color: "#d9837f", texture: "sheer", colorIntensity: 50, gloss: 20, transparencyIntensity: 60 }),
      { category: "blush", pattern: { name: "1color1" }, palettes: [{ color: "#f2a39a", texture: "matte", colorIntensity: 35 }] },
      BROWS_TINT("#4a3426"),
    ],
    steps: [
      { kind: "lips", color: { en: "rosy tint", hi: "गुलाबी रंगत", hinglish: "rosy tint" }, finish: "sheer" },
      { kind: "blush", color: { en: "soft pink", hi: "हल्का गुलाबी", hinglish: "halka gulabi" }, finish: "matte" },
      { kind: "brows", color: { en: "soft brown", hi: "हल्के भूरे", hinglish: "halke brown" } },
    ],
  },
};

export function isLookId(v: unknown): v is LookId {
  return typeof v === "string" && (LOOK_IDS as readonly string[]).includes(v);
}

const FINISH_WORD: Record<Language, Record<Finish, string>> = {
  en: { matte: "matte", satin: "satin", gloss: "glossy", sheer: "sheer" },
  hi: { matte: "मैट", satin: "साटन", gloss: "ग्लॉसी", sheer: "पारदर्शी" },
  hinglish: { matte: "matte", satin: "satin", gloss: "glossy", sheer: "sheer" },
};

const TEMPLATE: Record<Language, Record<StepKind, (color: string, finish: string) => string>> = {
  en: {
    blush: (c, f) => `Blush: tap on a ${c} ${f} blush at the apples of your cheeks, and blend up towards your temples.`,
    lips: (c, f) => `Lips: apply a ${c} ${f} lip colour, starting at the centre and working outwards.`,
    eyes: (c) => `Eyes: sweep ${c} shadow across the lid, and blend the edges softly.`,
    brows: (c) => `Brows: brush them through, then fill any gaps with a ${c} powder or pencil.`,
    lashes: (c) => `Lashes: curl them, then one coat of ${c} mascara.`,
  },
  hi: {
    blush: (c, f) => `ब्लश: ${c} ${f} ब्लश गालों के उभार पर थपथपाइए और कनपटी की ओर मिलाइए।`,
    lips: (c, f) => `होंठ: ${c} ${f} लिप कलर बीच से शुरू करके किनारों की ओर लगाइए।`,
    eyes: (c) => `आँखें: पलक पर ${c} शैडो फैलाइए और किनारों को हल्के से मिला दीजिए।`,
    brows: (c) => `भौंहें: ब्रश से सँवारिए, फिर ख़ाली जगहों में ${c} पाउडर या पेंसिल भर दीजिए।`,
    lashes: (c) => `पलकें: कर्ल कीजिए, फिर ${c} मस्कारा का एक कोट लगाइए।`,
  },
  hinglish: {
    blush: (c, f) => `Blush: ${c} ${f} blush gaalon ke ubhaar par thapthapaiye aur kanpati ki taraf blend kijiye.`,
    lips: (c, f) => `Lips: ${c} ${f} lip colour beech se shuru karke kinaron ki taraf lagaiye.`,
    eyes: (c) => `Eyes: palak par ${c} shadow phailaiye aur kinaron ko halke se blend kijiye.`,
    brows: (c) => `Brows: brush se sanwariye, phir khaali jagahon mein ${c} powder ya pencil bhar dijiye.`,
    lashes: (c) => `Lashes: curl kijiye, phir ${c} mascara ka ek coat lagaiye.`,
  },
};

/** The recipe for recreating a look with real products, one calm step per line. */
export function recipeSteps(look: LookDef, lang: Language): string[] {
  return look.steps.map((s) =>
    TEMPLATE[lang][s.kind](s.color[lang], s.finish ? FINISH_WORD[lang][s.finish] : "").replace(/\s{2,}/g, " "),
  );
}

// ------------------------------------------------------------- validation

const PATTERN_COLOR_COUNT = /^(\d)colors?\d+$/;

/**
 * Pattern labels come from YouCam's catalogs (blush.json, eyeshadow.json, eyelashes.json). Only
 * labels that YouCam's own reference shows are used here; anything else is an unverified guess
 * that could fail a paid call. Extend this list only after checking the catalog.
 */
export const DOCUMENTED_PATTERNS: Record<string, readonly string[]> = {
  blush: ["1color1", "2colors1"],
  eye_shadow: ["1color1", "2colors1"],
  eyelashes: ["Upper1"],
};

/**
 * Check a look's effects against the YouCam makeup-vto reference rules. Returns a list of
 * problems (empty when valid). Used by tests so a typo can never ship as a failed paid call.
 */
export function validateEffects(effects: readonly VtoEffect[]): string[] {
  const problems: string[] = [];
  for (const e of effects) {
    const cat = e.category;
    const palettes = (e.palettes as Record<string, unknown>[] | undefined) ?? [];
    if (typeof cat !== "string") {
      problems.push("effect without category");
      continue;
    }
    const pattern = (e.pattern as { name?: string } | undefined)?.name;
    if (pattern) {
      const known = DOCUMENTED_PATTERNS[cat];
      if (known && !known.includes(pattern)) problems.push(`${cat}: pattern ${pattern} is not a documented label`);
      const m = PATTERN_COLOR_COUNT.exec(pattern);
      if (m && Number(m[1]) !== palettes.length) {
        problems.push(`${cat}: pattern ${pattern} needs ${m[1]} palettes, got ${palettes.length}`);
      }
    }
    for (const p of palettes) {
      if (typeof p.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(p.color)) problems.push(`${cat}: bad colour ${String(p.color)}`);
      if (typeof p.colorIntensity !== "number" || p.colorIntensity < 0 || p.colorIntensity > 100) {
        problems.push(`${cat}: colorIntensity out of range`);
      }
      if (cat === "blush" && p.texture === "satin" && typeof p.glowStrength !== "number") problems.push("blush: satin needs glowStrength");
      if (cat === "lip_color") {
        const t = p.texture;
        if (["gloss", "holographic", "metallic", "sheer", "shimmer"].includes(String(t)) && typeof p.gloss !== "number") {
          problems.push(`lip_color: ${String(t)} needs gloss`);
        }
        if (["gloss", "sheer", "shimmer"].includes(String(t)) && typeof p.transparencyIntensity !== "number") {
          problems.push(`lip_color: ${String(t)} needs transparencyIntensity`);
        }
      }
    }
    if (cat === "skin_smooth" && (e.skinSmoothStrength !== 0 || e.skinSmoothColorIntensity !== 0)) {
      problems.push("skin_smooth must stay at 0: previews show makeup, not airbrushing");
    }
  }
  if (!effects.some((e) => e.category === "skin_smooth")) problems.push("missing explicit skin_smooth 0 (YouCam defaults to 50)");
  return problems;
}
