import { describe, expect, it } from "vitest";
import { LOOKS, LOOK_IDS, isLookId, recipeSteps, validateEffects, type VtoEffect } from "@/lib/looks";
import { checkImage, sniffImage } from "@/lib/image/sniff";
import { TITLE_PRESETS, cleanCustomTitle, languageTag, shouldUseTitle, titleFor } from "@/lib/persona/titles";
import { CONCERN_KEYS, SD_ACTIONS, concernLabel, isConcernKey, sanitizeSkinActions } from "@/lib/concerns";
import { DEFAULT_SETTINGS, LANGUAGES, isLanguage } from "@/lib/types";
import { duration, line, slotLabel } from "@/lib/persona/copy";
import type { SlotId } from "@/lib/ritual/products";
import { makeJpeg, makePng } from "./helpers";

describe("looks", () => {
  it("has the five looks, each valid against the YouCam makeup-vto rules", () => {
    expect(LOOK_IDS).toHaveLength(5);
    for (const id of LOOK_IDS) {
      expect(validateEffects(LOOKS[id].effects), id).toEqual([]);
      expect(LOOKS[id].id).toBe(id);
    }
  });

  it("never turns on skin smoothing: previews show makeup, not airbrushing", () => {
    for (const id of LOOK_IDS) {
      const smooth = LOOKS[id].effects.find((e) => e.category === "skin_smooth");
      expect(smooth).toMatchObject({ skinSmoothStrength: 0, skinSmoothColorIntensity: 0 });
    }
  });

  it("gives every look swatches, a mood and a recipe in every language", () => {
    for (const id of LOOK_IDS) {
      const look = LOOKS[id];
      expect(look.swatches.length).toBeGreaterThanOrEqual(3);
      for (const hex of look.swatches) expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
      for (const lang of LANGUAGES) {
        expect(look.name[lang].length).toBeGreaterThan(1);
        expect(look.mood[lang].length).toBeGreaterThan(1);
        const steps = recipeSteps(look, lang);
        expect(steps).toHaveLength(look.steps.length);
        for (const s of steps) {
          expect(s).not.toMatch(/\s{2,}|undefined|\$\{/);
          expect(s.length).toBeGreaterThan(20);
        }
      }
    }
  });

  it("accepts only known look ids", () => {
    expect(isLookId("rani_rose")).toBe(true);
    expect(isLookId("evil_look")).toBe(false);
    expect(isLookId(42)).toBe(false);
  });

  describe("validateEffects catches mistakes before they cost a YouCam call", () => {
    const smooth: VtoEffect = { category: "skin_smooth", skinSmoothStrength: 0, skinSmoothColorIntensity: 0 };

    it("palette count must match the pattern", () => {
      const bad: VtoEffect = {
        category: "blush",
        pattern: { name: "2colors1" },
        palettes: [{ color: "#ff0000", texture: "matte", colorIntensity: 50 }],
      };
      expect(validateEffects([smooth, bad]).join()).toMatch(/needs 2 palettes/);
    });

    it("satin blush needs glowStrength; gloss lips need gloss and transparency", () => {
      const satin: VtoEffect = {
        category: "blush",
        pattern: { name: "1color1" },
        palettes: [{ color: "#ff0000", texture: "satin", colorIntensity: 50 }],
      };
      expect(validateEffects([smooth, satin]).join()).toMatch(/glowStrength/);
      const lips: VtoEffect = {
        category: "lip_color",
        palettes: [{ color: "#ff0000", texture: "gloss", colorIntensity: 50 }],
      };
      const problems = validateEffects([smooth, lips]).join();
      expect(problems).toMatch(/needs gloss/);
      expect(problems).toMatch(/transparencyIntensity/);
    });

    it("rejects bad colours, bad intensities and a missing smoothing override", () => {
      const e: VtoEffect = { category: "eye_shadow", pattern: { name: "1color1" }, palettes: [{ color: "red", texture: "matte", colorIntensity: 150 }] };
      const p = validateEffects([smooth, e]).join();
      expect(p).toMatch(/bad colour/);
      expect(p).toMatch(/out of range/);
      expect(validateEffects([e]).join()).toMatch(/skin_smooth/);
    });

    it("only uses pattern labels that YouCam's reference documents", () => {
      const guess: VtoEffect = { category: "eyelashes", pattern: { name: "Wispies1" }, palettes: [{ color: "#141414", colorIntensity: 60 }] };
      expect(validateEffects([smooth, guess]).join()).toMatch(/not a documented label/);
    });

    it("rejects smoothing that is not zero", () => {
      expect(validateEffects([{ category: "skin_smooth", skinSmoothStrength: 50, skinSmoothColorIntensity: 0 }]).join()).toMatch(/must stay at 0/);
    });
  });
});

describe("image sniffing", () => {
  const png = makePng;
  const jpeg = makeJpeg;

  it("reads PNG and JPEG dimensions from the header", () => {
    expect(sniffImage(png(800, 1000))).toEqual({ type: "png", width: 800, height: 1000 });
    expect(sniffImage(jpeg(720, 960))).toEqual({ type: "jpeg", width: 720, height: 960 });
  });

  it("does not trust anything that is not an image", () => {
    expect(sniffImage(new TextEncoder().encode("GIF89a this is not what it says it is, honestly"))).toBeNull();
    expect(sniffImage(new Uint8Array(10))).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8, ...new Array(40).fill(0x41)]))).toBeNull();
  });

  const limits = { maxBytes: 1000, minShortSide: 480, maxLongSide: 2560 };
  const padded = (b: Uint8Array, n: number) => {
    const out = new Uint8Array(n);
    out.set(b);
    return out;
  };

  it("checks size and bounds before any unit is spent", () => {
    expect(checkImage(png(800, 1000), limits)).toMatchObject({ ok: true });
    expect(checkImage(png(300, 400), limits)).toEqual({ ok: false, problem: "too_small" });
    expect(checkImage(png(3000, 4000), limits)).toEqual({ ok: false, problem: "too_large" });
    expect(checkImage(padded(png(800, 1000), 2000), limits)).toEqual({ ok: false, problem: "too_big_bytes" });
    expect(checkImage(new Uint8Array(100), limits)).toEqual({ ok: false, problem: "not_an_image" });
  });
});

describe("titles and language tags", () => {
  it("speaks presets in the active language", () => {
    expect(titleFor({ titleId: "highness", customTitle: "", language: "en" })).toBe("Your Highness");
    expect(titleFor({ titleId: "highness", customTitle: "", language: "hi" })).toBe("हुज़ूर");
    expect(titleFor({ titleId: "maharani", customTitle: "", language: "hinglish" })).toBe("Maharani");
  });

  it("uses a clean custom title, and falls back when it is unsafe or empty", () => {
    expect(titleFor({ titleId: "custom", customTitle: "  Queen   B ", language: "en" })).toBe("Queen B");
    expect(titleFor({ titleId: "custom", customTitle: "", language: "en" })).toBe("Your Highness");
    expect(titleFor({ titleId: "custom", customTitle: "Miracle Cure", language: "en" })).toBe("Your Highness");
    expect(titleFor({ titleId: "nonsense", customTitle: "", language: "en" })).toBe("Your Highness");
  });

  it("strips markup and caps custom titles", () => {
    expect(cleanCustomTitle('<script>"x"</script>')).not.toMatch(/[<>"]/);
    expect(cleanCustomTitle("x".repeat(100)).length).toBe(24);
    expect(cleanCustomTitle("a\u0000b\nc")).toBe("a b c");
  });

  it("uses the title at greetings and wins, otherwise about every third turn", () => {
    expect(shouldUseTitle(1, "greeting")).toBe(true);
    expect(shouldUseTitle(2, "win")).toBe(true);
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => shouldUseTitle(i))).toEqual([true, false, false, true, false, false, true]);
  });

  it("picks the right voice language", () => {
    expect(languageTag("hi")).toBe("hi-IN");
    expect(languageTag("hinglish")).toBe("en-IN");
    expect(languageTag("en", "en-GB")).toBe("en-GB");
    expect(languageTag("en", "fr-FR")).toBe("en-US");
    expect(languageTag("en")).toBe("en-US");
  });

  it("presets have an English and a Hindi form", () => {
    for (const p of TITLE_PRESETS) {
      expect(p.en.length).toBeGreaterThan(2);
      expect(p.hi).toMatch(/[ऀ-ॿ]/);
    }
  });
});

describe("concerns", () => {
  it("labels every concern in every language, positively", () => {
    for (const k of CONCERN_KEYS) {
      expect(isConcernKey(k)).toBe(true);
      for (const lang of LANGUAGES) expect(concernLabel(k, lang).length).toBeGreaterThan(2);
    }
    expect(isConcernKey("wrinkle")).toBe(false);
  });

  it("keeps the measured set inside the 5-to-7 concern price tier, all SD", () => {
    expect(CONCERN_KEYS.length).toBe(7);
    for (const k of CONCERN_KEYS) expect((SD_ACTIONS as readonly string[]).includes(k)).toBe(true);
  });

  describe("sanitizeSkinActions", () => {
    it("defaults to the seven concerns", () => {
      expect(sanitizeSkinActions(undefined)).toEqual([...CONCERN_KEYS]);
      expect(sanitizeSkinActions([])).toEqual([...CONCERN_KEYS]);
    });

    it("drops HD actions, typos, duplicates and skin_type, and caps at seven", () => {
      expect(sanitizeSkinActions(["hd_acne", "moisture", " moisture ", "oops", "skin_type", "pore"])).toEqual(["moisture", "pore"]);
      expect(sanitizeSkinActions([...SD_ACTIONS]).length).toBe(7);
      expect(sanitizeSkinActions(["hd_acne", "nope"])).toEqual([...CONCERN_KEYS]);
    });
  });
});

describe("settings and copy basics", () => {
  it("defaults are private by default", () => {
    expect(DEFAULT_SETTINGS.consentLook).toBe(false);
    expect(DEFAULT_SETTINGS.consentScan).toBe(false);
    expect(DEFAULT_SETTINGS.welcomed).toBe(false);
    expect(isLanguage("hinglish")).toBe(true);
    expect(isLanguage("fr")).toBe(false);
  });

  it("formats durations per language", () => {
    expect(duration(30, "en")).toBe("30 seconds");
    expect(duration(1, "en")).toBe("1 second");
    expect(duration(120, "en")).toBe("2 minutes");
    expect(duration(600, "hi")).toMatch(/10/);
    expect(duration(45, "hinglish")).toBe("45 second");
  });

  it("names every slot in every language", () => {
    const slots: SlotId[] = ["oil_cleanse", "cleanse", "tone", "exfoliate", "treat", "serum", "eye", "moisturize", "oil", "protect", "extra"];
    for (const lang of LANGUAGES) for (const s of slots) expect(slotLabel(lang, s).length).toBeGreaterThan(1);
  });

  it("countdown lines are one short word or phrase each", () => {
    for (const lang of LANGUAGES) {
      for (const n of [3, 2, 1] as const) expect(line(lang, "countdown", { n }).length).toBeLessThan(40);
    }
  });
});
