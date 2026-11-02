import type { ConcernKey } from "../concerns";
import type { ScanSource } from "../types";

/** 0-100, higher is better, for each measured concern. */
export type ScoreMap = Partial<Record<ConcernKey, number>>;

export type ConfidenceReason =
  | "dim_light"
  | "uneven_light"
  | "glare"
  | "deeper_tone"
  | "low_resolution"
  | "demo";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface Confidence {
  level: ConfidenceLevel;
  /** 0-1. Informational only; the level is what the mirror speaks about. */
  score: number;
  reasons: ConfidenceReason[];
}

export type ScanKind = "baseline" | "after" | "checkin";

export interface SkinScan {
  id: string;
  /** epoch ms */
  at: number;
  source: ScanSource;
  scores: ScoreMap;
  /** Light quality measured in the browser when the photo was taken, 0-1. */
  lighting: number;
  /** Skin colour as read by YouCam's tone analysis, when available. */
  skinHex?: string;
  /** Individual Typology Angle derived from skinHex, when available. */
  ita?: number;
  confidence: Confidence;
  kind: ScanKind;
  ritualId?: string;
}
