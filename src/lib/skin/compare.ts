import { CONCERN_KEYS, type ConcernKey } from "../concerns";
import type { SkinScan } from "./types";

export type DeltaClass = "better" | "slightly_better" | "same" | "slightly_lower" | "lower";

export interface ConcernDelta {
  key: ConcernKey;
  before: number;
  after: number;
  delta: number;
  cls: DeltaClass;
}

export type Caveat = "same_sitting" | "low_confidence" | "lighting_changed" | "demo";

export interface Comparison {
  deltas: ConcernDelta[];
  /** The smallest change, in points, that the mirror will call a change at all. */
  noise: number;
  minutesBetween: number;
  /** Fewer than 20 minutes apart: products have barely had time to do anything. */
  tooSoon: boolean;
  headline: "better" | "same" | "mixed" | "lower";
  caveats: Caveat[];
}

export const MIN_MINUTES_BETWEEN_SCANS = 10;
export const SAME_SITTING_MINUTES = 20;
const BASE_NOISE = 3;

function penalty(level: SkinScan["confidence"]["level"]): number {
  return level === "low" ? 0.5 : level === "medium" ? 0.25 : 0;
}

function classify(delta: number, noise: number): DeltaClass {
  const mag = Math.abs(delta);
  if (mag < noise) return "same";
  if (mag < noise * 2) return delta > 0 ? "slightly_better" : "slightly_lower";
  return delta > 0 ? "better" : "lower";
}

/**
 * Honest before/after. A score has to move further than the noise floor to count, the floor
 * widens when either scan had weak light or low confidence, and the result always states how
 * sure it is. "About the same" is a perfectly good answer.
 */
export function compareScans(before: SkinScan, after: SkinScan): Comparison {
  const minutesBetween = Math.max(0, Math.round((after.at - before.at) / 60000));
  const lightingDiff = Math.abs(after.lighting - before.lighting);

  let mult = 1 + penalty(before.confidence.level) + penalty(after.confidence.level);
  const lightingChanged = lightingDiff > 0.2;
  if (lightingChanged) mult += 0.5;
  const noise = Math.round(BASE_NOISE * mult * 10) / 10;

  const deltas: ConcernDelta[] = [];
  for (const key of CONCERN_KEYS) {
    const b = before.scores[key];
    const a = after.scores[key];
    if (typeof b !== "number" || typeof a !== "number") continue;
    const delta = a - b;
    deltas.push({ key, before: b, after: a, delta, cls: classify(delta, noise) });
  }

  const ups = deltas.filter((d) => d.cls === "better" || d.cls === "slightly_better").length;
  const downs = deltas.filter((d) => d.cls === "lower" || d.cls === "slightly_lower").length;
  const headline: Comparison["headline"] =
    ups > 0 && downs > 0 ? "mixed" : ups > 0 ? "better" : downs > 0 ? "lower" : "same";

  const caveats: Caveat[] = [];
  const tooSoon = minutesBetween < SAME_SITTING_MINUTES;
  if (tooSoon) caveats.push("same_sitting");
  if (before.confidence.level !== "high" || after.confidence.level !== "high") caveats.push("low_confidence");
  if (lightingChanged) caveats.push("lighting_changed");
  if (before.source === "demo" || after.source === "demo") caveats.push("demo");

  return { deltas, noise, minutesBetween, tooSoon, headline, caveats };
}

/** Minutes until a re-scan is allowed without a reason (a budget guard, said kindly). */
export function minutesUntilRescan(lastScanAt: number | null, now: number): number {
  if (lastScanAt === null) return 0;
  const elapsed = (now - lastScanAt) / 60000;
  return Math.max(0, Math.ceil(MIN_MINUTES_BETWEEN_SCANS - elapsed));
}
