import type { ScoreMap, SkinScan, Confidence } from "@/lib/skin/types";
import type { ScanSource } from "@/lib/types";

export const HIGH: Confidence = { level: "high", score: 0.95, reasons: [] };
export const MEDIUM: Confidence = { level: "medium", score: 0.7, reasons: ["uneven_light"] };
export const LOW: Confidence = { level: "low", score: 0.4, reasons: ["dim_light"] };

export const MIN = 60_000;
export const DAY = 86_400_000;

/** A fixed, readable "today" for deterministic tests: 2026-10-01 09:00 UTC. */
export const T0 = Date.UTC(2026, 9, 1, 9, 0, 0);

let counter = 0;

export function scan(
  at: number,
  scores: ScoreMap,
  extra: Partial<Omit<SkinScan, "at" | "scores">> = {},
): SkinScan {
  counter += 1;
  return {
    id: `s${counter}`,
    at,
    source: "youcam" as ScanSource,
    scores,
    lighting: 0.8,
    confidence: HIGH,
    kind: "checkin",
    ...extra,
  };
}

export function allScores(v: number): ScoreMap {
  return { moisture: v, oiliness: v, redness: v, radiance: v, texture: v, pore: v, acne: v };
}

/** A header-only PNG: enough for magic-byte and dimension checks. */
export function makePng(w: number, h: number, padTo = 33): Uint8Array {
  const b = new Uint8Array(Math.max(33, padTo));
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}

/** A header-only JPEG with a real SOF segment: enough for magic-byte and dimension checks. */
export function makeJpeg(w: number, h: number, padTo = 0): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const core = [0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9, 0, 0, 0, 0];
  const out = new Uint8Array(Math.max(core.length, padTo));
  out.set(core);
  // vary the padding with the size so different photos hash differently
  for (let i = core.length; i < out.length; i += 1) out[i] = (i * 31 + w + h) & 255;
  return out;
}
