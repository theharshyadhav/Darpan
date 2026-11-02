import type { ConcernKey } from "../concerns";
import type { Category } from "../ritual/products";
import type { SkinScan } from "../skin/types";

/**
 * The Royal Ledger's "is it working?" logic. "Too early to say" is a first-class answer, and the
 * default one: a verdict needs a starting measurement, at least two weeks, and at least two
 * later measurements on different days. Changes must beat the scan-to-scan noise, and the
 * ledger admits when two new products started together so it cannot tell which one helped.
 * Demo scans and low-confidence scans never count.
 */

export interface TrackedProduct {
  id: string;
  name: string;
  category: Category;
  startedAt: number;
}

export const DAY_MS = 86_400_000;
export const MIN_DAYS = 14;
export const MIN_AFTER_DAYS_WITH_SCANS = 2;
const BASELINE_WINDOW_BEFORE_DAYS = 21;
const BASELINE_WINDOW_AFTER_DAYS = 7;
const CONFOUND_WINDOW_DAYS = 10;
const MIN_REAL_CHANGE = 3;
const MIN_Z = 1.5;
const DEFAULT_SIGMA = 4;
const MIN_SIGMA = 2.5;

/** What a person would reasonably look for, cosmetically, with each kind of product. */
export const PRODUCT_FOCUS: Record<Category, ConcernKey[]> = {
  oil_cleanser: [],
  cleanser: [],
  toner: ["moisture"],
  essence: ["moisture"],
  exfoliant_aha: ["texture", "radiance"],
  exfoliant_bha: ["pore", "acne", "oiliness"],
  exfoliant_pha: ["texture"],
  retinoid: ["texture", "radiance", "pore"],
  benzoyl: ["acne", "oiliness"],
  vitamin_c: ["radiance"],
  azelaic: ["redness", "acne"],
  niacinamide: ["oiliness", "pore"],
  hyaluronic: ["moisture"],
  peptide: ["texture"],
  serum: ["moisture", "radiance", "texture"],
  eye: [],
  moisturizer: ["moisture"],
  oil: ["moisture"],
  sunscreen: [],
  mask: [],
  spot: ["acne"],
  lip: [],
};

export type VerdictKind = "too_early" | "improving" | "steady" | "declining" | "mixed" | "no_visible";
export type TooEarlyReason = "no_baseline" | "too_soon" | "few_scans";

export interface ConcernTrend {
  key: ConcernKey;
  baseline: number;
  after: number;
  delta: number;
  z: number;
  status: "improved" | "declined" | "steady";
}

export interface LedgerVerdict {
  productId: string;
  verdict: VerdictKind;
  reason?: TooEarlyReason;
  needMoreDays: number;
  needMoreScans: number;
  trends: ConcernTrend[];
  improved: ConcernKey[];
  declined: ConcernKey[];
  /** Another product with overlapping goals started within ten days of this one. */
  confounded: boolean;
  baselineCount: number;
  afterCount: number;
}

function mean(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function variance(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
}

function overlaps(a: readonly ConcernKey[], b: readonly ConcernKey[]): boolean {
  return a.some((k) => b.includes(k));
}

export function evaluateProduct(
  product: TrackedProduct,
  scans: readonly SkinScan[],
  allProducts: readonly TrackedProduct[],
  now: number,
): LedgerVerdict {
  const focus = PRODUCT_FOCUS[product.category];
  const empty: LedgerVerdict = {
    productId: product.id,
    verdict: "too_early",
    needMoreDays: 0,
    needMoreScans: 0,
    trends: [],
    improved: [],
    declined: [],
    confounded: false,
    baselineCount: 0,
    afterCount: 0,
  };
  if (focus.length === 0) return { ...empty, verdict: "no_visible" };

  const usable = scans
    .filter((s) => s.source === "youcam" && s.confidence.level !== "low")
    .sort((a, b) => a.at - b.at);

  const baselineScans = usable.filter(
    (s) =>
      s.at >= product.startedAt - BASELINE_WINDOW_BEFORE_DAYS * DAY_MS &&
      s.at <= product.startedAt + BASELINE_WINDOW_AFTER_DAYS * DAY_MS &&
      s.at < product.startedAt + MIN_DAYS * DAY_MS,
  );
  const afterScans = usable.filter((s) => s.at >= product.startedAt + MIN_DAYS * DAY_MS);
  const daysSince = (now - product.startedAt) / DAY_MS;
  const confounded = allProducts.some(
    (o) =>
      o.id !== product.id &&
      Math.abs(o.startedAt - product.startedAt) <= CONFOUND_WINDOW_DAYS * DAY_MS &&
      overlaps(PRODUCT_FOCUS[o.category], focus),
  );
  const common = { ...empty, confounded, baselineCount: baselineScans.length, afterCount: afterScans.length };

  if (baselineScans.length === 0) {
    return { ...common, reason: "no_baseline", needMoreScans: 1 };
  }
  if (daysSince < MIN_DAYS) {
    return { ...common, reason: "too_soon", needMoreDays: Math.ceil(MIN_DAYS - daysSince), needMoreScans: MIN_AFTER_DAYS_WITH_SCANS };
  }
  const afterDays = new Set(afterScans.map((s) => Math.floor(s.at / DAY_MS))).size;
  if (afterDays < MIN_AFTER_DAYS_WITH_SCANS) {
    return { ...common, reason: "few_scans", needMoreScans: MIN_AFTER_DAYS_WITH_SCANS - afterDays };
  }

  const recentAfter = afterScans.slice(-4);
  const trends: ConcernTrend[] = [];
  for (const key of focus) {
    const b = baselineScans.map((s) => s.scores[key]).filter((v): v is number => typeof v === "number");
    const a = recentAfter.map((s) => s.scores[key]).filter((v): v is number => typeof v === "number");
    if (b.length === 0 || a.length === 0) continue;

    let sigma = DEFAULT_SIGMA;
    if (b.length >= 2 && a.length >= 2) {
      const pooled = ((b.length - 1) * variance(b) + (a.length - 1) * variance(a)) / (b.length + a.length - 2);
      sigma = Math.sqrt(pooled);
    } else if (b.length >= 2) {
      sigma = Math.sqrt(variance(b));
    } else if (a.length >= 2) {
      sigma = Math.sqrt(variance(a));
    }
    sigma = Math.max(MIN_SIGMA, sigma);

    const delta = mean(a) - mean(b);
    const se = sigma * Math.sqrt(1 / b.length + 1 / a.length);
    const z = delta / se;
    const status: ConcernTrend["status"] =
      delta >= MIN_REAL_CHANGE && z >= MIN_Z ? "improved" : delta <= -MIN_REAL_CHANGE && z <= -MIN_Z ? "declined" : "steady";
    trends.push({
      key,
      baseline: Math.round(mean(b) * 10) / 10,
      after: Math.round(mean(a) * 10) / 10,
      delta: Math.round(delta * 10) / 10,
      z: Math.round(z * 100) / 100,
      status,
    });
  }

  const improved = trends.filter((t) => t.status === "improved").map((t) => t.key);
  const declined = trends.filter((t) => t.status === "declined").map((t) => t.key);
  const verdict: VerdictKind =
    improved.length > 0 && declined.length > 0
      ? "mixed"
      : improved.length > 0
        ? "improving"
        : declined.length > 0
          ? "declining"
          : "steady";

  return { ...common, verdict, trends, improved, declined };
}

export function evaluateAll(
  products: readonly TrackedProduct[],
  scans: readonly SkinScan[],
  now: number,
): LedgerVerdict[] {
  return products.map((p) => evaluateProduct(p, scans, products, now));
}
