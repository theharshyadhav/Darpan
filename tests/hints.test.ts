import { describe, expect, it } from "vitest";
import { HINT_LINE, MIN_LIGHT, hintFor, shouldSpeakHint } from "@/client/flows/hints";
import type { FrameReading } from "@/client/ports";
import { line } from "@/lib/persona/copy";
import type { FramingHint } from "@/lib/vision/frame";

const lit = (score: number, hint: "ok" | "dim" | "bright" | "uneven" = "ok") => ({ score, hint, ok: hint === "ok" && score >= 0.62 });
const framing = (hint: FramingHint) => ({ ok: hint === "ok", hint, widthRatio: 0.7, rollDeg: 0, yaw: 0 });
const reading = (over: Partial<FrameReading>): FrameReading => ({ faces: 1, region: { w: 600, h: 800 }, framing: framing("ok"), lighting: lit(0.9), ...over });

describe("hintFor", () => {
  it("asks for a face when there is no frame", () => {
    expect(hintFor(null)).toEqual({ hint: "no_face", ok: false });
  });
  it("passes framing hints through", () => {
    for (const h of ["no_face", "multi_face", "closer", "back", "shift_left", "shift_right", "lower", "higher", "level", "forward"] as const) {
      expect(hintFor(reading({ framing: framing(h) }))).toEqual({ hint: h, ok: false });
    }
  });
  it("is happy when framed and lit", () => {
    expect(hintFor(reading({}))).toEqual({ hint: "hold", ok: true });
  });
  it("asks for better light only once the face is framed", () => {
    expect(hintFor(reading({ lighting: lit(0.3, "dim") }))).toEqual({ hint: "dim", ok: false });
    expect(hintFor(reading({ lighting: lit(0.4, "uneven") }))).toEqual({ hint: "uneven", ok: false });
    expect(hintFor(reading({ lighting: lit(0.4, "bright") }))).toEqual({ hint: "bright", ok: false });
    expect(hintFor(reading({ framing: framing("closer"), lighting: lit(0.2, "dim") })).hint).toBe("closer");
  });
  it("treats a middling score with an ok hint as dim", () => {
    expect(hintFor(reading({ lighting: lit(MIN_LIGHT - 0.05) }))).toEqual({ hint: "dim", ok: false });
    expect(hintFor(reading({ lighting: lit(MIN_LIGHT) })).ok).toBe(true);
  });
  it("falls back to manual capture when no detector is available", () => {
    expect(hintFor(reading({ framing: null }))).toEqual({ hint: "manual", ok: false });
    expect(hintFor(reading({ framing: null, lighting: lit(0.3, "dim") }))).toEqual({ hint: "dim", ok: false });
  });
});

describe("shouldSpeakHint", () => {
  it("waits for a pause, a new message and a quiet mirror", () => {
    const mem = { key: "closer" as const, spokenAt: 10_000 };
    expect(shouldSpeakHint(mem, "back", 11_000, false)).toBe(false);
    expect(shouldSpeakHint(mem, "back", 13_000, false)).toBe(true);
    expect(shouldSpeakHint(mem, "back", 13_000, true)).toBe(false);
  });
  it("repeats an unchanged hint only after a long while", () => {
    const mem = { key: "closer" as const, spokenAt: 10_000 };
    expect(shouldSpeakHint(mem, "closer", 15_000, false)).toBe(false);
    expect(shouldSpeakHint(mem, "closer", 19_500, false)).toBe(true);
  });
  it("says hold still once", () => {
    const mem = { key: "hold" as const, spokenAt: 10_000 };
    expect(shouldSpeakHint(mem, "hold", 60_000, false)).toBe(false);
  });
  it("never speaks the manual-capture state", () => {
    expect(shouldSpeakHint({ key: null, spokenAt: 0 }, "manual", 99_999, false)).toBe(false);
  });
});

describe("HINT_LINE", () => {
  it("has a calm sentence for every hint in every language", () => {
    for (const id of Object.values(HINT_LINE)) {
      for (const lang of ["en", "hi", "hinglish"] as const) expect(line(lang, id, {}).length).toBeGreaterThan(5);
    }
  });
});
