import { describe, expect, it } from "vitest";
import { headlineFor, joinLabels, ledgerRows } from "@/client/ledger-view";
import { lintUtterance } from "@/lib/persona/lint";
import type { TrackedProduct } from "@/lib/ledger/verdict";
import { DAY, T0, allScores, scan } from "./helpers";

const retinol: TrackedProduct = { id: "t1", name: "Retinol", category: "retinoid", startedAt: T0 };
const cleanser: TrackedProduct = { id: "t2", name: "Gentle cleanser", category: "cleanser", startedAt: T0 };

describe("joinLabels", () => {
  it("joins in each language", () => {
    expect(joinLabels(["moisture"], "en")).toBe("hydration");
    expect(joinLabels(["texture", "radiance"], "en")).toBe("smoothness and radiance");
    expect(joinLabels(["texture", "radiance", "acne"], "en")).toBe("smoothness, radiance and clarity");
    expect(joinLabels(["texture", "radiance"], "hinglish")).toBe("smoothness aur radiance");
    expect(joinLabels(["texture", "radiance"], "hi")).toContain("और");
    expect(joinLabels([], "en")).toBe("");
  });
});

describe("ledgerRows", () => {
  it("says too early on day one, with the days still to wait", () => {
    const rows = ledgerRows([retinol], [scan(T0 - DAY, allScores(60))], T0 + DAY, "en");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.verdict.verdict).toBe("too_early");
    expect(rows[0]!.days).toBe(1);
    expect(rows[0]!.headline).toMatch(/too early/i);
    expect(rows[0]!.headline).toMatch(/13 more days/);
  });

  it("asks for scans, not days, when it has no starting measurement", () => {
    const rows = ledgerRows([retinol], [], T0 + 30 * DAY, "en");
    expect(rows[0]!.headline).toMatch(/more scans on different days/);
  });

  it("reports gains and the confounding caveat", () => {
    const serum: TrackedProduct = { id: "t3", name: "Niacinamide", category: "niacinamide", startedAt: T0 + 2 * DAY };
    const scans = [
      scan(T0 - DAY, { ...allScores(60), texture: 60, pore: 60, oiliness: 60 }),
      scan(T0 + 15 * DAY, { ...allScores(60), texture: 72, pore: 72, oiliness: 60 }),
      scan(T0 + 17 * DAY, { ...allScores(60), texture: 74, pore: 74, oiliness: 60 }),
      scan(T0 + 19 * DAY, { ...allScores(60), texture: 75, pore: 75, oiliness: 60 }),
    ];
    const rows = ledgerRows([retinol, serum], scans, T0 + 20 * DAY, "en");
    const row = rows.find((r) => r.product.id === "t1")!;
    expect(row.verdict.verdict).toBe("improving");
    expect(row.headline).toMatch(/gentle gains in/);
    expect(row.caveat).toMatch(/more than one thing/);
  });

  it("does not expect numbers from daily-care products", () => {
    const rows = ledgerRows([cleanser], [], T0 + 30 * DAY, "en");
    expect(rows[0]!.headline).toMatch(/daily care/);
    expect(rows[0]!.caveat).toBeUndefined();
  });

  it("lists the newest product first", () => {
    const later: TrackedProduct = { ...cleanser, id: "t9", startedAt: T0 + 5 * DAY };
    expect(ledgerRows([retinol, later], [], T0 + 6 * DAY, "en").map((r) => r.product.id)).toEqual(["t9", "t1"]);
  });

  it("speaks a safe name when a product's own name would trip the linter", () => {
    const odd: TrackedProduct = { id: "t4", name: "Acne Cure Miracle Gel", category: "benzoyl", startedAt: T0 };
    const row = ledgerRows([odd], [], T0 + DAY, "en")[0]!;
    expect(lintUtterance(row.headline).ok).toBe(true);
    expect(row.headline).toContain("benzoyl peroxide");
    expect(row.headline).not.toContain("Miracle");
  });
});

describe("headlineFor", () => {
  it("passes the claim linter in every language and every verdict", () => {
    const langs = ["en", "hi", "hinglish"] as const;
    const base = ledgerRows([retinol], [], T0 + DAY, "en")[0]!.verdict;
    const kinds = [
      { ...base, verdict: "too_early" as const, reason: "too_soon" as const, needMoreDays: 5 },
      { ...base, verdict: "too_early" as const, reason: "few_scans" as const },
      { ...base, verdict: "improving" as const, improved: ["texture" as const, "radiance" as const] },
      { ...base, verdict: "declining" as const, declined: ["moisture" as const] },
      { ...base, verdict: "steady" as const },
      { ...base, verdict: "mixed" as const },
      { ...base, verdict: "no_visible" as const },
    ];
    for (const lang of langs) for (const v of kinds) expect(lintUtterance(headlineFor(v, retinol, lang)).ok).toBe(true);
  });
});
