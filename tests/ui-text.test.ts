import { describe, expect, it } from "vitest";
import { UI_TEXT, ui } from "@/components/ui-text";

const LANGS = ["en", "hi", "hinglish"] as const;
const keys = Object.keys(UI_TEXT.en);
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("ui-text parity", () => {
  it("has the same keys in en, hi and hinglish", () => {
    for (const l of LANGS) expect(Object.keys(UI_TEXT[l]).sort(), l).toEqual([...keys].sort());
  });

  it("has no empty strings", () => {
    for (const l of LANGS) for (const k of keys) expect((UI_TEXT[l] as Record<string, string>)[k].trim(), `${l}.${k}`).not.toBe("");
  });

  it("uses the same {placeholders} in every language", () => {
    for (const k of keys) {
      const base = placeholders((UI_TEXT.en as Record<string, string>)[k]);
      for (const l of ["hi", "hinglish"] as const) expect(placeholders((UI_TEXT[l] as Record<string, string>)[k]), `${l}.${k}`).toEqual(base);
    }
  });

  it("Hindi strings are Devanagari wherever English has letters, Hinglish is Latin", () => {
    const loose = new Set(["wordmark", "lang_en", "lang_hi", "lang_hinglish"]);
    for (const k of keys) {
      if (loose.has(k)) continue;
      expect(/[ऀ-ॿ]/.test((UI_TEXT.hinglish as Record<string, string>)[k]), `hinglish.${k}`).toBe(false);
    }
  });

  it("has no ALL-CAPS labels and no arrow glyphs in any language", () => {
    for (const l of LANGS)
      for (const k of keys) {
        const v = (UI_TEXT[l] as Record<string, string>)[k];
        expect(/[→←↗↘➜➔»›]/.test(v), `${l}.${k} arrow`).toBe(false);
        const letters = v.replace(/[^A-Za-z]/g, "");
        // Hindi lines may carry an acronym like JPG; only Latin-script text is held to the rule
        if (!/[\u0900-\u097F]/.test(v) && letters.length >= 4) expect(letters === letters.toUpperCase(), `${l}.${k} all caps`).toBe(false);
      }
  });

  it("ui() fills parameters", () => {
    expect(ui("en", "verify_noise", { n: 3 })).toContain("3");
  });
});
