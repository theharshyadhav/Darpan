import { CONCERN_KEYS, type ConcernKey } from "@/lib/concerns";
import { cleanScore } from "@/lib/skin/report";
import type { ScoreMap } from "@/lib/skin/types";

/**
 * Tolerant readers for YouCam's task results. The documented shape for skin analysis is
 * `data.results.output[] = { type, ui_score, raw_score, mask_urls }`, but the same API also ships a
 * zipped `score_info.json` keyed by concern name, and the docs for other versions differ. These
 * readers accept all of those shapes, and the callers refuse to show anything if too little was
 * understood (better an honest "could not read that" than a made-up number).
 *
 * `ui_score` is the only score used: higher is better. `raw_score` is never read.
 */

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const concernSet = new Set<string>(CONCERN_KEYS);

function normaliseKey(k: unknown): string {
  return String(k ?? "")
    .trim()
    .toLowerCase()
    .replace(/^hd_/, "");
}

function uiScoreOf(v: unknown): number | null {
  if (typeof v === "number") return cleanScore(v);
  if (!isObj(v)) return null;
  const direct = cleanScore(v.ui_score);
  if (direct !== null) return direct;
  if (isObj(v.score)) return cleanScore(v.score.ui_score);
  return null;
}

export interface SkinParse {
  scores: ScoreMap;
  /** Concerns that were asked for but not understood in the response. */
  missing: ConcernKey[];
}

export function parseSkinResult(data: unknown, wanted: readonly ConcernKey[] = CONCERN_KEYS): SkinParse {
  const scores: ScoreMap = {};
  const root = isObj(data) ? data : {};
  const results = root.results ?? root;
  const resultsObj = isObj(results) ? results : {};

  const take = (rawKey: unknown, v: unknown) => {
    const key = normaliseKey(rawKey);
    if (!concernSet.has(key)) return;
    const score = uiScoreOf(v);
    if (score !== null && scores[key as ConcernKey] === undefined) scores[key as ConcernKey] = score;
  };

  const lists: unknown[] = [resultsObj.output, results, root.output, resultsObj.score_info, root.score_info];
  for (const list of lists) {
    if (Array.isArray(list)) {
      for (const item of list) {
        if (isObj(item)) take(item.type ?? item.name ?? item.concern ?? item.key ?? item.action, item);
      }
    } else if (isObj(list)) {
      for (const [k, v] of Object.entries(list)) take(k, v);
    }
  }
  return { scores, missing: wanted.filter((k) => scores[k] === undefined) };
}

const HEX = /^#?([0-9a-f]{6})$/i;

function hexIn(v: unknown, depth = 0): string | undefined {
  if (typeof v === "string") {
    const m = HEX.exec(v.trim());
    return m ? `#${m[1]!.toLowerCase()}` : undefined;
  }
  if (depth > 3) return undefined;
  if (Array.isArray(v)) {
    for (const x of v) {
      const h = hexIn(x, depth + 1);
      if (h) return h;
    }
  } else if (isObj(v)) {
    // prefer obviously named fields, then anything
    for (const k of ["hex", "color", "colour", "value", "rgb_hex"]) {
      const h = hexIn(v[k], depth + 1);
      if (h) return h;
    }
    for (const x of Object.values(v)) {
      const h = hexIn(x, depth + 1);
      if (h) return h;
    }
  }
  return undefined;
}

const SKIN_NAME = /^skin(?:[_\s-]?(?:color|colour|tone))?$/i;

/** Find the skin colour (not eye, brow, lip or hair) in a skin-tone-analysis result. */
export function parseSkinHex(data: unknown): string | undefined {
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number): string | undefined => {
    if (depth > 5 || v === null || typeof v !== "object" || seen.has(v)) return undefined;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const item of v) {
        if (isObj(item)) {
          const label = item.type ?? item.name ?? item.region ?? item.part ?? item.label ?? item.category;
          if (typeof label === "string" && SKIN_NAME.test(label.trim())) {
            const h = hexIn(item);
            if (h) return h;
          }
        }
        const nested = walk(item, depth + 1);
        if (nested) return nested;
      }
      return undefined;
    }
    for (const [k, val] of Object.entries(v as Obj)) {
      if (SKIN_NAME.test(k)) {
        const h = hexIn(val);
        if (h) return h;
      }
    }
    for (const val of Object.values(v as Obj)) {
      const nested = walk(val, depth + 1);
      if (nested) return nested;
    }
    return undefined;
  };
  return walk(data, 0);
}

const URL_KEYS = ["url", "download_url", "image_url", "result_url", "output_url"];

/** The result image URL of a makeup try-on: `data.results.url`, or the nearest equivalent. */
export function parseResultUrl(data: unknown): string | undefined {
  const root = isObj(data) ? data : {};
  const results = root.results ?? root.result ?? root.output;
  const fromObj = (o: Obj): string | undefined => {
    for (const k of URL_KEYS) {
      const v = o[k];
      if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
    }
    return undefined;
  };
  if (isObj(results)) {
    const direct = fromObj(results);
    if (direct) return direct;
    for (const v of Object.values(results)) {
      if (Array.isArray(v)) {
        for (const x of v) if (isObj(x)) {
          const u = fromObj(x);
          if (u) return u;
        }
      }
    }
  }
  if (Array.isArray(results)) {
    for (const x of results) {
      if (typeof x === "string" && /^https?:\/\//i.test(x)) return x;
      if (isObj(x)) {
        const u = fromObj(x);
        if (u) return u;
      }
    }
  }
  return undefined;
}
