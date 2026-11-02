import { describe, expect, it } from "vitest";
import { evaluateAll, evaluateProduct, DAY_MS, MIN_DAYS, type TrackedProduct } from "@/lib/ledger/verdict";
import type { SkinScan } from "@/lib/skin/types";
import { LOW, T0, DAY, scan } from "./helpers";

const retinol: TrackedProduct = { id: "p1", name: "Retinol", category: "retinoid", startedAt: T0 };

/** Scans for a retinoid's focus concerns (texture, radiance, pore) at given day offsets. */
function series(days: number[], values: { texture: number; radiance: number; pore: number }, extra: Partial<SkinScan> = {}) {
  return days.map((d) => scan(T0 + d * DAY, { ...values, moisture: 70, oiliness: 70, redness: 70, acne: 70 }, extra));
}

describe("Royal Ledger verdicts", () => {
  it("never judges without a starting measurement", () => {
    const scans = series([15, 18], { texture: 80, radiance: 80, pore: 80 });
    const v = evaluateProduct(retinol, scans, [retinol], T0 + 20 * DAY);
    expect(v).toMatchObject({ verdict: "too_early", reason: "no_baseline" });
  });

  it("says too early before two weeks, and counts the days left", () => {
    const scans = series([-1], { texture: 60, radiance: 60, pore: 60 });
    const v = evaluateProduct(retinol, scans, [retinol], T0 + 5 * DAY);
    expect(v).toMatchObject({ verdict: "too_early", reason: "too_soon", needMoreDays: MIN_DAYS - 5 });
  });

  it("needs two later days with scans, not two scans on one day", () => {
    const base = series([-1], { texture: 60, radiance: 60, pore: 60 });
    const sameDay = [...series([15, 15], { texture: 75, radiance: 75, pore: 75 })];
    expect(evaluateProduct(retinol, [...base, ...sameDay], [retinol], T0 + 20 * DAY)).toMatchObject({
      verdict: "too_early",
      reason: "few_scans",
      needMoreScans: 1,
    });
    const oneDay = series([16], { texture: 75, radiance: 75, pore: 75 });
    expect(evaluateProduct(retinol, [...base, ...oneDay], [retinol], T0 + 20 * DAY).reason).toBe("few_scans");
  });

  it("calls a clear, repeated rise 'improving' and names what improved", () => {
    const scans = [
      ...series([-2, 1], { texture: 60, radiance: 58, pore: 62 }),
      ...series([15, 18, 21], { texture: 72, radiance: 71, pore: 63 }),
    ];
    const v = evaluateProduct(retinol, scans, [retinol], T0 + 22 * DAY);
    expect(v.verdict).toBe("improving");
    expect(v.improved).toEqual(expect.arrayContaining(["texture", "radiance"]));
    expect(v.improved).not.toContain("pore");
    expect(v.trends.find((t) => t.key === "texture")?.delta).toBeGreaterThan(8);
  });

  it("says 'steady' when nothing moved beyond the noise", () => {
    const scans = [
      ...series([-2, 1], { texture: 60, radiance: 60, pore: 60 }),
      ...series([15, 18], { texture: 61, radiance: 59, pore: 61 }),
    ];
    expect(evaluateProduct(retinol, scans, [retinol], T0 + 20 * DAY).verdict).toBe("steady");
  });

  it("reports a decline plainly", () => {
    const scans = [
      ...series([-2, 1], { texture: 70, radiance: 70, pore: 70 }),
      ...series([15, 18, 21], { texture: 58, radiance: 59, pore: 70 }),
    ];
    const v = evaluateProduct(retinol, scans, [retinol], T0 + 22 * DAY);
    expect(v.verdict).toBe("declining");
    expect(v.declined).toEqual(expect.arrayContaining(["texture", "radiance"]));
  });

  it("says 'mixed' when some concerns rise and others fall", () => {
    const base = series([-2, 1], { texture: 60, radiance: 70, pore: 65 });
    const after = series([15, 18, 21], { texture: 72, radiance: 58, pore: 65 });
    expect(evaluateProduct(retinol, [...base, ...after], [retinol], T0 + 22 * DAY).verdict).toBe("mixed");
  });

  it("does not mistake a noisy baseline for an effect", () => {
    // baseline wobbles 50..70; the later average (64) is within that wobble
    const base = [
      scan(T0 - 3 * DAY, { texture: 50, radiance: 50, pore: 50 }),
      scan(T0 - 1 * DAY, { texture: 70, radiance: 70, pore: 70 }),
    ];
    const after = series([15, 18], { texture: 64, radiance: 64, pore: 64 });
    expect(evaluateProduct(retinol, [...base, ...after], [retinol], T0 + 20 * DAY).verdict).toBe("steady");
  });

  it("ignores demo scans and low-confidence scans entirely", () => {
    const base = series([-1], { texture: 60, radiance: 60, pore: 60 });
    const demoAfter = series([15, 18], { texture: 90, radiance: 90, pore: 90 }, { source: "demo" });
    const lowAfter = series([15, 18], { texture: 90, radiance: 90, pore: 90 }, { confidence: LOW });
    expect(evaluateProduct(retinol, [...base, ...demoAfter], [retinol], T0 + 20 * DAY).reason).toBe("few_scans");
    expect(evaluateProduct(retinol, [...base, ...lowAfter], [retinol], T0 + 20 * DAY).reason).toBe("few_scans");
    const demoBase = series([-1], { texture: 60, radiance: 60, pore: 60 }, { source: "demo" });
    expect(evaluateProduct(retinol, demoBase, [retinol], T0 + 20 * DAY).reason).toBe("no_baseline");
  });

  it("does not use scans from before the three-week window as a baseline", () => {
    const old = series([-40], { texture: 60, radiance: 60, pore: 60 });
    expect(evaluateProduct(retinol, old, [retinol], T0 + 20 * DAY).reason).toBe("no_baseline");
  });

  it("keeps products without a visible target out of the numbers", () => {
    const cleanser: TrackedProduct = { id: "c", name: "Cleanser", category: "cleanser", startedAt: T0 };
    const spf: TrackedProduct = { id: "s", name: "SPF", category: "sunscreen", startedAt: T0 };
    expect(evaluateProduct(cleanser, [], [cleanser], T0 + 30 * DAY).verdict).toBe("no_visible");
    expect(evaluateProduct(spf, [], [spf], T0 + 30 * DAY).verdict).toBe("no_visible");
  });

  it("admits when two products with the same goals started together", () => {
    const aha: TrackedProduct = { id: "p2", name: "Glycolic", category: "exfoliant_aha", startedAt: T0 + 3 * DAY };
    const scans = [
      ...series([-2, 1], { texture: 60, radiance: 60, pore: 60 }),
      ...series([15, 18, 21], { texture: 75, radiance: 75, pore: 75 }),
    ];
    const v = evaluateProduct(retinol, scans, [retinol, aha], T0 + 22 * DAY);
    expect(v.confounded).toBe(true);
    const far: TrackedProduct = { ...aha, startedAt: T0 + 40 * DAY };
    expect(evaluateProduct(retinol, scans, [retinol, far], T0 + 22 * DAY).confounded).toBe(false);
    const unrelated: TrackedProduct = { id: "p3", name: "Cleanser", category: "cleanser", startedAt: T0 };
    expect(evaluateProduct(retinol, scans, [retinol, unrelated], T0 + 22 * DAY).confounded).toBe(false);
  });

  it("evaluates a whole shelf at once", () => {
    const vit: TrackedProduct = { id: "v", name: "Vitamin C", category: "vitamin_c", startedAt: T0 };
    const out = evaluateAll([retinol, vit], [], T0 + DAY);
    expect(out.map((v) => v.productId)).toEqual(["p1", "v"]);
    expect(out.every((v) => v.verdict === "too_early")).toBe(true);
  });

  it("DAY_MS matches the helper's day", () => {
    expect(DAY_MS).toBe(DAY);
  });
});
