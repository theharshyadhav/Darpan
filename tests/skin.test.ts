import { describe, expect, it } from "vitest";
import { compareScans, minutesUntilRescan, MIN_MINUTES_BETWEEN_SCANS } from "@/lib/skin/compare";
import { cleanScore, computeConfidence, rankConcerns, scoreBand, strengthAndFocus } from "@/lib/skin/report";
import { itaFromHex, parseHex, rgbToLab } from "@/lib/skin/tone";
import { demoScores, demoSeedFromBytes } from "@/lib/skin/demo";
import { CONCERN_KEYS } from "@/lib/concerns";
import { T0, MIN, HIGH, LOW, MEDIUM, scan, allScores } from "./helpers";

describe("compareScans: honest before and after", () => {
  const before = scan(T0, { ...allScores(70) });

  it("says 'same' when nothing moved past the noise floor", () => {
    const after = scan(T0 + 30 * MIN, { ...allScores(71), moisture: 72 });
    const c = compareScans(before, after);
    expect(c.headline).toBe("same");
    expect(c.deltas.every((d) => d.cls === "same")).toBe(true);
    expect(c.noise).toBe(3);
  });

  it("calls a clear rise 'better' and a small one 'slightly better'", () => {
    const after = scan(T0 + 30 * MIN, { ...allScores(70), moisture: 80, radiance: 74 });
    const c = compareScans(before, after);
    expect(c.deltas.find((d) => d.key === "moisture")?.cls).toBe("better");
    expect(c.deltas.find((d) => d.key === "radiance")?.cls).toBe("slightly_better");
    expect(c.headline).toBe("better");
  });

  it("reports a drop plainly, and 'mixed' when some go up and some down", () => {
    const down = compareScans(before, scan(T0 + 30 * MIN, { ...allScores(70), redness: 58 }));
    expect(down.headline).toBe("lower");
    expect(down.deltas.find((d) => d.key === "redness")?.cls).toBe("lower");
    const mixed = compareScans(before, scan(T0 + 30 * MIN, { ...allScores(70), redness: 58, moisture: 82 }));
    expect(mixed.headline).toBe("mixed");
  });

  it("widens the noise floor for weaker scans and changed light", () => {
    const weak = scan(T0 + 30 * MIN, allScores(70), { confidence: LOW, lighting: 0.4 });
    const c = compareScans(before, weak);
    expect(c.noise).toBeGreaterThan(3);
    expect(c.caveats).toContain("low_confidence");
    expect(c.caveats).toContain("lighting_changed");

    const medium = compareScans(scan(T0, allScores(70), { confidence: MEDIUM }), scan(T0 + 30 * MIN, allScores(70), { confidence: MEDIUM }));
    expect(medium.noise).toBeGreaterThan(3);
    expect(medium.noise).toBeLessThan(c.noise);
  });

  it("a change that clears the base floor can vanish once the floor widens", () => {
    const small = { ...allScores(70), moisture: 74 };
    expect(compareScans(before, scan(T0 + 30 * MIN, small)).deltas.find((d) => d.key === "moisture")?.cls).toBe("slightly_better");
    const weak = compareScans(before, scan(T0 + 30 * MIN, small, { confidence: LOW, lighting: 0.3 }));
    expect(weak.deltas.find((d) => d.key === "moisture")?.cls).toBe("same");
  });

  it("flags scans taken too close together and demo scans", () => {
    const close = compareScans(before, scan(T0 + 5 * MIN, allScores(70)));
    expect(close.tooSoon).toBe(true);
    expect(close.caveats).toContain("same_sitting");
    const far = compareScans(before, scan(T0 + 25 * MIN, allScores(70)));
    expect(far.tooSoon).toBe(false);
    expect(far.caveats).not.toContain("same_sitting");
    const demo = compareScans(scan(T0, allScores(70), { source: "demo" }), scan(T0 + 30 * MIN, allScores(70)));
    expect(demo.caveats).toContain("demo");
  });

  it("only compares concerns measured in both scans", () => {
    const partial = scan(T0 + 30 * MIN, { moisture: 80 });
    expect(compareScans(before, partial).deltas.map((d) => d.key)).toEqual(["moisture"]);
  });

  it("never reports a negative gap in time", () => {
    expect(compareScans(scan(T0 + 10 * MIN, allScores(70)), scan(T0, allScores(70))).minutesBetween).toBe(0);
  });

  it("minutesUntilRescan counts down kindly", () => {
    expect(minutesUntilRescan(null, T0)).toBe(0);
    expect(minutesUntilRescan(T0, T0)).toBe(MIN_MINUTES_BETWEEN_SCANS);
    expect(minutesUntilRescan(T0, T0 + 4 * MIN)).toBe(MIN_MINUTES_BETWEEN_SCANS - 4);
    expect(minutesUntilRescan(T0, T0 + 30 * MIN)).toBe(0);
  });
});

describe("report helpers", () => {
  it("ranks concerns high to low and keeps canonical order for ties", () => {
    const ranked = rankConcerns({ moisture: 60, oiliness: 80, redness: 80, radiance: 55 });
    expect(ranked.map((r) => r.key)).toEqual(["oiliness", "redness", "moisture", "radiance"]);
    expect(rankConcerns({})).toEqual([]);
    expect(rankConcerns({ moisture: Number.NaN })).toEqual([]);
  });

  it("finds a strength and a gentle focus", () => {
    const r = strengthAndFocus({ moisture: 90, texture: 50, pore: 70 });
    expect(r).toEqual({ strength: "moisture", focus: "texture", allHigh: false });
    expect(strengthAndFocus(allScores(88)).allHigh).toBe(true);
    expect(strengthAndFocus({ moisture: 90 })).toEqual({ strength: "moisture", focus: null, allHigh: false });
    expect(strengthAndFocus({})).toEqual({ strength: null, focus: null, allHigh: false });
  });

  it("bands scores at YouCam's own thresholds", () => {
    expect([100, 85, 84, 70, 69, 55, 54, 0].map(scoreBand)).toEqual([
      "glowing",
      "glowing",
      "good",
      "good",
      "fair",
      "fair",
      "care",
      "care",
    ]);
  });

  it("cleans raw scores", () => {
    expect(cleanScore(71.6)).toBe(72);
    expect(cleanScore(-4)).toBe(0);
    expect(cleanScore(140)).toBe(100);
    expect(cleanScore("70")).toBeNull();
    expect(cleanScore(Number.NaN)).toBeNull();
    expect(cleanScore(undefined)).toBeNull();
  });
});

describe("computeConfidence", () => {
  it("is high with good light on a typical photo", () => {
    const c = computeConfidence({ lighting: 0.9, ita: 45, shortSide: 960, source: "youcam" });
    expect(c.level).toBe("high");
    expect(c.reasons).toEqual([]);
  });

  it("drops with dim or uneven light, and says why", () => {
    const dim = computeConfidence({ lighting: 0.3, source: "youcam" });
    expect(dim.reasons).toContain("dim_light");
    expect(dim.level).not.toBe("high");
    const uneven = computeConfidence({ lighting: 0.55, source: "youcam" });
    expect(uneven.reasons).toContain("uneven_light");
  });

  it("states extra uncertainty for deeper complexions and never labels the person", () => {
    const deep = computeConfidence({ lighting: 0.9, ita: -45, source: "youcam" });
    expect(deep.reasons).toContain("deeper_tone");
    expect(deep.level).not.toBe("high");
    const mid = computeConfidence({ lighting: 0.9, ita: 5, source: "youcam" });
    expect(mid.reasons).toContain("deeper_tone");
    expect(computeConfidence({ lighting: 0.9, ita: 30, source: "youcam" }).reasons).not.toContain("deeper_tone");
  });

  it("lowers confidence for small photos", () => {
    expect(computeConfidence({ lighting: 0.9, shortSide: 500, source: "youcam" }).reasons).toContain("low_resolution");
  });

  it("treats demo scans as samples, always low", () => {
    expect(computeConfidence({ lighting: 1, source: "demo" })).toMatchObject({ level: "low", reasons: ["demo"] });
  });

  it("stays within 0..1 even when everything is wrong", () => {
    const c = computeConfidence({ lighting: 0, ita: -80, shortSide: 100, source: "youcam" });
    expect(c.score).toBeGreaterThanOrEqual(0);
    expect(c.score).toBeLessThanOrEqual(1);
    expect(c.level).toBe("low");
  });

  it("agrees with HIGH helper for the happy path", () => {
    expect(HIGH.level).toBe("high");
  });
});

describe("tone helpers", () => {
  it("parses hex with or without a hash and rejects junk", () => {
    expect(parseHex("#ff8000")).toEqual({ r: 255, g: 128, b: 0 });
    expect(parseHex("FF8000")).toEqual({ r: 255, g: 128, b: 0 });
    expect(parseHex("#fff")).toBeNull();
    expect(parseHex("hello")).toBeNull();
  });

  it("converts known colours to Lab", () => {
    const white = rgbToLab({ r: 255, g: 255, b: 255 });
    expect(white.L).toBeCloseTo(100, 0);
    expect(Math.abs(white.a)).toBeLessThan(0.6);
    expect(Math.abs(white.b)).toBeLessThan(0.6);
    expect(rgbToLab({ r: 0, g: 0, b: 0 }).L).toBeCloseTo(0, 0);
  });

  it("derives ITA that rises with lighter skin and rejects invalid input", () => {
    const light = itaFromHex("#f1c9a5");
    const medium = itaFromHex("#c68642");
    const deep = itaFromHex("#4a2c1a");
    expect(light).toBeDefined();
    expect(medium).toBeDefined();
    expect(deep).toBeDefined();
    expect(light!).toBeGreaterThan(medium!);
    expect(medium!).toBeGreaterThan(deep!);
    expect(light!).toBeGreaterThan(28);
    expect(deep!).toBeLessThan(-30);
    expect(itaFromHex("nope")).toBeUndefined();
  });
});

describe("demo scores", () => {
  it("is deterministic and covers every concern within a believable range", () => {
    const a = demoScores("seed", 0);
    const b = demoScores("seed", 0);
    expect(a).toEqual(b);
    for (const k of CONCERN_KEYS) {
      expect(a[k]).toBeGreaterThanOrEqual(35);
      expect(a[k]).toBeLessThanOrEqual(95);
    }
  });

  it("lands near the first scan on a rescan, like a real rescan would", () => {
    const first = demoScores("seed", 0);
    const second = demoScores("seed", 1);
    for (const k of CONCERN_KEYS) expect(Math.abs((first[k] ?? 0) - (second[k] ?? 0))).toBeLessThanOrEqual(8);
  });

  it("differs between people", () => {
    expect(demoScores("a", 0)).not.toEqual(demoScores("b", 0));
  });

  it("hashes image bytes stably", () => {
    const x = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const y = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 9]);
    expect(demoSeedFromBytes(x)).toBe(demoSeedFromBytes(new Uint8Array(x)));
    expect(demoSeedFromBytes(x)).not.toBe(demoSeedFromBytes(y));
  });
});
