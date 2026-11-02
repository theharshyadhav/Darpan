import { CONCERN_KEYS, type ConcernKey } from "../concerns";
import type { ScanSource } from "../types";
import type { Confidence, ConfidenceReason, ScoreMap } from "./types";

export interface RankedConcern {
  key: ConcernKey;
  score: number;
}

/** Concerns with a score, highest first. Ties keep the canonical concern order. */
export function rankConcerns(scores: ScoreMap): RankedConcern[] {
  const out: RankedConcern[] = [];
  for (const key of CONCERN_KEYS) {
    const v = scores[key];
    if (typeof v === "number" && Number.isFinite(v)) out.push({ key, score: v });
  }
  return out.sort((a, b) => b.score - a.score);
}

export interface StrengthFocus {
  strength: ConcernKey | null;
  /** The gentlest place to put extra care. Null when there is only one measured concern. */
  focus: ConcernKey | null;
  /** True when even the lowest score is high, so the mirror says "wonderfully balanced". */
  allHigh: boolean;
}

export function strengthAndFocus(scores: ScoreMap): StrengthFocus {
  const ranked = rankConcerns(scores);
  if (ranked.length === 0) return { strength: null, focus: null, allHigh: false };
  const top = ranked[0]!;
  const bottom = ranked[ranked.length - 1]!;
  return {
    strength: top.key,
    focus: ranked.length > 1 ? bottom.key : null,
    allHigh: ranked.length > 1 && bottom.score >= 80,
  };
}

export type ScoreBand = "glowing" | "good" | "fair" | "care";

/** Bands follow YouCam's own star thresholds (85 / 70 / 55), with gentler names. */
export function scoreBand(score: number): ScoreBand {
  if (score >= 85) return "glowing";
  if (score >= 70) return "good";
  if (score >= 55) return "fair";
  return "care";
}

export const BAND_LABEL: Record<"en" | "hi" | "hinglish", Record<ScoreBand, string>> = {
  en: { glowing: "Glowing", good: "Good", fair: "Fair", care: "Needs care" },
  hi: { glowing: "चमकदार", good: "अच्छा", fair: "ठीक-ठाक", care: "देखभाल चाहिए" },
  hinglish: { glowing: "Glowing", good: "Good", fair: "Fair", care: "Needs care" },
};

export interface ConfidenceInput {
  /** 0-1 lighting quality measured in the browser. */
  lighting: number;
  /** Individual Typology Angle, when YouCam's tone read succeeded. */
  ita?: number;
  /** Shorter side of the photo that was analysed, in pixels. */
  shortSide?: number;
  source: ScanSource;
}

/**
 * How firmly the mirror may speak about a scan. Light and complexion both nudge numbers, so
 * both lower the stated confidence, out loud (see `report_uncertainty`). Demo scans are never
 * more than "low" because they are samples, not measurements.
 */
export function computeConfidence(i: ConfidenceInput): Confidence {
  const reasons: ConfidenceReason[] = [];
  if (i.source === "demo") return { level: "low", score: 0.3, reasons: ["demo"] };

  let score = 1;
  if (i.lighting < 0.45) {
    score -= 0.28;
    reasons.push("dim_light");
  } else if (i.lighting < 0.65) {
    score -= 0.13;
    reasons.push("uneven_light");
  }
  if (typeof i.ita === "number") {
    if (i.ita < -30) {
      // Deliberate: imaging models are known to be less precise on the deepest complexions, so the
      // mirror never claims "high" confidence there. It widens the before/after noise floor instead.
      score -= 0.22;
      reasons.push("deeper_tone");
    } else if (i.ita < 10) {
      score -= 0.12;
      reasons.push("deeper_tone");
    }
  }
  if (typeof i.shortSide === "number" && i.shortSide < 640) {
    score -= 0.1;
    reasons.push("low_resolution");
  }
  score = Math.max(0, Math.min(1, score));
  const level = score >= 0.8 ? "high" : score >= 0.6 ? "medium" : "low";
  return { level, score: Math.round(score * 100) / 100, reasons };
}

/** Clamp and round a raw score into the 0-100 range; returns null when unusable. */
export function cleanScore(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, Math.round(v)));
}
