import { CONCERN_KEYS } from "../concerns";
import type { ScoreMap } from "./types";

/**
 * Demo Mode scores. When there is no YouCam key (or the budget guard trips) Darpan keeps working
 * with deterministic sample numbers. They are always labelled as samples, in the UI and out loud,
 * and they are never stored in the Royal Ledger's verdicts.
 */

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stable "profile" per seed, with a small deterministic wobble per scan number `n`, so a second
 * demo scan lands near the first one (like a real rescan would) rather than somewhere unrelated.
 */
export function demoScores(seed: string, n: number): ScoreMap {
  const base = mulberry32(xmur3(`profile:${seed}`)());
  const wobble = mulberry32(xmur3(`scan:${seed}:${n}`)());
  const out: ScoreMap = {};
  for (const key of CONCERN_KEYS) {
    const profile = 52 + base() * 34; // 52-86
    const drift = n > 0 ? (wobble() - 0.35) * 6 : 0;
    const noise = (wobble() - 0.5) * 4;
    out[key] = Math.max(35, Math.min(95, Math.round(profile + drift + noise)));
  }
  return out;
}

export function demoSeedFromBytes(bytes: Uint8Array): string {
  // FNV-1a over a bounded sample of the image: cheap, deterministic, and not reversible to a face.
  let h = 2166136261;
  const step = Math.max(1, Math.floor(bytes.length / 4096));
  for (let i = 0; i < bytes.length; i += step) {
    h ^= bytes[i]!;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
