import { describe, expect, it } from "vitest";
import { allSampleLines, line } from "@/lib/persona/copy";
import { GENERIC_REFERRALS, limitTitleMentions, lintUtterance, sanitizeUtterance } from "@/lib/persona/lint";
import { LANGUAGES } from "@/lib/types";
import { LOOKS, LOOK_IDS, recipeSteps } from "@/lib/looks";
import { CONCERNS, CONCERN_KEYS } from "@/lib/concerns";
import { TITLE_PRESETS } from "@/lib/persona/titles";

/**
 * `npm run lint:claims` runs this file. Every sentence the mirror can say without a language
 * model must pass the same linter that guards model output at runtime.
 */

describe("claim linter: what must be flagged", () => {
  const bad: [string, string][] = [
    ["This serum will cure your skin.", "medical-terms"],
    ["That sounds like an infection.", "medical-terms"],
    ["I can diagnose that for you.", "medical-terms"],
    ["It is a skin condition.", "medical-terms"],
    ["You may have rosacea.", "named-conditions"],
    ["Your acne is clearing.", "named-conditions"],
    ["Looks like eczema to me.", "named-conditions"],
    ["This will treat your breakouts.", "medical-treat"],
    ["Your skin is flawless.", "flawless"],
    ["It blends perfectly.", "flawlessly"],
    ["Absolute perfection.", "perfection"],
    ["Blemish-free by Friday.", "perfection"],
    ["Guaranteed glow in a week.", "guarantees"],
    ["A miracle serum.", "guarantees"],
    ["Results are 100% certain.", "guarantees"],
    ["Instantly smoother skin.", "guarantees"],
    ["This will fix your pores.", "will-fix"],
    ["It will definitely clear your skin.", "will-fix"],
    ["It erases wrinkles.", "erase-claims"],
    ["You will look ten years younger.", "erase-claims"],
    ["Your skin looks ugly today.", "shaming"],
    ["That is disgusting.", "shaming"],
    ["You have damaged skin.", "shaming"],
    ["Ask a dermatologist about that mole.", "referral-nongeneric"],
    ["You should see a doctor.", "hinglish-medical"],
    ["इसका इलाज करना होगा", "hi-medical"],
    ["आपकी बीमारी ठीक हो जाएगी", "hi-medical"],
    ["बेदाग त्वचा मिलेगी", "hi-absolute"],
    ["सौ प्रतिशत असर", "hi-absolute"],
    ["Iska ilaaj hai yeh serum.", "hinglish-medical"],
    ["Yeh chamatkar karega.", "hinglish-absolute"],
    ["Bedaag twacha milegi.", "hinglish-absolute"],
  ];

  it.each(bad)("flags %s", (text, rule) => {
    const r = lintUtterance(text);
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.rule)).toContain(rule);
  });
});

describe("claim linter: what must pass", () => {
  const good = [
    "Your hydration looks lovely today, Your Highness.",
    "Skin appears a little drier than yesterday, which light and angle can cause.",
    "A dermatologist can help if something worries you.",
    "Let's let that settle for a minute.",
    "Treat yourself to a slow breath before the moisturizer.",
    "Your skin barrier looks healthy.",
    "Make sure the product is secure in the lid.",
    "A frog on the lily pad.", // "rog" must not match inside a word
    "Accuracy matters more than speed.",
    "यह हल्का सुधार दिखता है।",
    "Halka sa sudhaar dikhta hai.",
    "That sounds kind of tricky; take your time.",
  ];

  it.each(good)("passes %s", (text) => {
    const r = lintUtterance(text);
    expect(r.violations).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("allows only the exact generic dermatologist referral", () => {
    for (const phrase of GENERIC_REFERRALS) expect(lintUtterance(phrase).ok).toBe(true);
    expect(lintUtterance("A dermatologist can help if something worries you. Also see a dermatologist for that mark.").ok).toBe(
      false,
    );
  });

  it("matches whole words only", () => {
    expect(lintUtterance("Securely tucked in.").ok).toBe(true);
    expect(lintUtterance("The procure step is done.").ok).toBe(true);
    expect(lintUtterance("Cure.").ok).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(lintUtterance("GUARANTEED").ok).toBe(false);
    expect(lintUtterance("Flawless").ok).toBe(false);
  });
});

describe("sanitizeUtterance", () => {
  const fallback = "Let's keep it simple.";

  it("leaves clean text alone", () => {
    const r = sanitizeUtterance("Your glow looks lovely.", fallback);
    expect(r).toMatchObject({ text: "Your glow looks lovely.", changed: false, usedFallback: false });
  });

  it("softens absolute praise in place", () => {
    const r = sanitizeUtterance("Your skin looks flawless today.", fallback);
    expect(r.text).toBe("Your skin looks lovely today.");
    expect(r.changed).toBe(true);
    expect(lintUtterance(r.text).ok).toBe(true);
  });

  it("keeps capitalisation when softening", () => {
    expect(sanitizeUtterance("Flawless work.", fallback).text).toBe("Lovely work.");
    expect(sanitizeUtterance("It blends perfectly.", fallback).text).toBe("It blends beautifully.");
  });

  it("drops only the offending sentence", () => {
    const r = sanitizeUtterance("The serum is on. It will cure your acne. Moisturizer next.", fallback);
    expect(r.text).toBe("The serum is on. Moisturizer next.");
    expect(r.usedFallback).toBe(false);
  });

  it("falls back when nothing survives", () => {
    const r = sanitizeUtterance("This cures acne.", fallback);
    expect(r).toMatchObject({ text: fallback, usedFallback: true });
  });

  it("handles Devanagari sentence breaks", () => {
    const r = sanitizeUtterance("सीरम लग गया। यह इलाज करेगा। अब मॉइस्चराइज़र।", fallback);
    expect(r.text).toBe("सीरम लग गया। अब मॉइस्चराइज़र।");
  });

  it("always returns lint-clean text, whatever it is given", () => {
    const nasty = [
      "Perfect! Guaranteed! A miracle cure for acne, instantly and permanently.",
      "You should see a dermatologist and take medication.",
      "यह चमत्कार है, इलाज की गारंटी।",
      "Yeh chamatkari ilaaj hai.",
      "",
      "   ",
      "...",
    ];
    for (const text of nasty) {
      const r = sanitizeUtterance(text, fallback);
      expect(lintUtterance(r.text).ok, `"${text}" -> "${r.text}"`).toBe(true);
    }
  });
});

describe("limitTitleMentions", () => {
  const T = "Your Highness";

  it("keeps a single mention untouched", () => {
    const s = "Welcome back, Your Highness. The light is lovely.";
    expect(limitTitleMentions(s, T)).toBe(s);
  });

  it("removes later mentions with their commas", () => {
    expect(limitTitleMentions("Lovely, Your Highness. Now the serum, Your Highness.", T)).toBe("Lovely, Your Highness. Now the serum.");
    expect(limitTitleMentions("Your Highness, the light is lovely. Shall we begin, Your Highness?", T)).toBe(
      "Your Highness, the light is lovely. Shall we begin?",
    );
  });

  it("repairs a sentence that loses its opening title", () => {
    expect(limitTitleMentions("Welcome, Your Highness. Your Highness, shall we begin?", T)).toBe(
      "Welcome, Your Highness. Shall we begin?",
    );
  });

  it("is a no-op for an empty title and ignores partial-word matches", () => {
    expect(limitTitleMentions("hello", "")).toBe("hello");
    expect(limitTitleMentions("Maharanis and Maharani", "Maharani")).toBe("Maharanis and Maharani");
  });

  it("works for Devanagari titles", () => {
    expect(limitTitleMentions("नमस्ते, हुज़ूर। चलिए, हुज़ूर, शुरू करें।", "हुज़ूर")).toBe("नमस्ते, हुज़ूर। चलिए शुरू करें।");
  });
});

describe("every canned line the mirror can speak", () => {
  const lines = allSampleLines();

  it("covers every language with the same number of lines", () => {
    expect(lines.length).toBeGreaterThan(150);
    expect(lines.length % LANGUAGES.length).toBe(0);
  });

  it("is free of medical, absolute, promise and shaming language", () => {
    const failures = lines
      .map((l) => ({ l, r: lintUtterance(l) }))
      .filter((x) => !x.r.ok)
      .map((x) => `${x.l}  <- ${x.r.violations.map((v) => `${v.rule}:${v.match}`).join(", ")}`);
    expect(failures).toEqual([]);
  });

  it("is short and calm: at most three sentences and 320 characters", () => {
    const long = lines.filter((l) => l.length > 320 || (l.match(/[.!?।]+(?:\s|$)/gu) ?? []).length > 3);
    expect(long).toEqual([]);
  });

  it("never leaves a placeholder or an empty line behind", () => {
    for (const l of lines) {
      expect(l.trim().length).toBeGreaterThan(0);
      expect(l).not.toMatch(/undefined|NaN|\[object|\$\{/);
      expect(l).not.toMatch(/\s{2,}/);
    }
  });

  it("keeps scripts apart: Hindi is Devanagari, English and Hinglish are not", () => {
    const n = lines.length / LANGUAGES.length;
    const perLang = { en: lines.slice(0, 0), hi: lines.slice(0, 0), hinglish: lines.slice(0, 0) } as Record<string, string[]>;
    // allSampleLines emits one language after another in the order en, hi, hinglish
    perLang.en = lines.slice(0, n);
    perLang.hi = lines.slice(n, 2 * n);
    perLang.hinglish = lines.slice(2 * n);
    const dev = /[ऀ-ॿ]/;
    expect(perLang.en!.filter((l) => dev.test(l.replace(/हुज़ूर/g, "")))).toEqual([]);
    expect(perLang.hinglish!.filter((l) => dev.test(l))).toEqual([]);
    expect(perLang.hi!.filter((l) => !dev.test(l))).toEqual([]);
  });

  it("greets by title when one is given", () => {
    for (const lang of LANGUAGES) {
      expect(line(lang, "welcome", { title: "Maharani" })).toContain("Maharani");
      expect(line(lang, "welcome", {})).not.toContain("undefined");
    }
  });

  it("states uncertainty and a decline option when reporting", () => {
    for (const lang of LANGUAGES) {
      expect(line(lang, "report_uncertainty", {}).length).toBeGreaterThan(20);
      expect(line(lang, "report_decline", {}).length).toBeGreaterThan(10);
    }
  });
});

describe("other spoken or displayed text is lint-clean too", () => {
  it("look names, moods and recipes", () => {
    for (const id of LOOK_IDS) {
      const look = LOOKS[id];
      for (const lang of LANGUAGES) {
        const texts = [look.name[lang], look.mood[lang], ...recipeSteps(look, lang)];
        for (const t of texts) {
          expect(t.length).toBeGreaterThan(0);
          expect(lintUtterance(t).violations, `${id}/${lang}: ${t}`).toEqual([]);
        }
      }
    }
  });

  it("concern labels never name a condition (even though the YouCam metric is called acne)", () => {
    for (const key of CONCERN_KEYS) {
      for (const lang of LANGUAGES) {
        const label = CONCERNS[key].label[lang];
        expect(lintUtterance(label).violations, `${key}/${lang}: ${label}`).toEqual([]);
      }
    }
  });

  it("title presets", () => {
    for (const p of TITLE_PRESETS) {
      expect(lintUtterance(p.en).ok).toBe(true);
      expect(lintUtterance(p.hi).ok).toBe(true);
    }
  });
});
