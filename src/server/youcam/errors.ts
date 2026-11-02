import type { ScanErrorKind } from "@/lib/persona/copy";

/**
 * Everything that can go wrong talking to YouCam, folded into the small set of kinds the mirror
 * knows how to say out loud (see `scan_error` in src/lib/persona/copy.ts).
 */

export interface UpstreamErrorInit {
  status?: number;
  code?: string;
  retryAfterSec?: number;
  /** The key is rejected or the account cannot pay: stop spending for a while. */
  spendBlocked?: boolean;
}

export class UpstreamError extends Error {
  readonly kind: ScanErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly retryAfterSec?: number;
  readonly spendBlocked: boolean;

  constructor(kind: ScanErrorKind, message: string, init: UpstreamErrorInit = {}) {
    super(message);
    this.name = "UpstreamError";
    this.kind = kind;
    this.status = init.status;
    this.code = init.code;
    this.retryAfterSec = init.retryAfterSec;
    this.spendBlocked = init.spendBlocked ?? false;
  }
}

/** Codes from https://docs.perfectcorp.com/develop/error_codes.md */
const DOCUMENTED: Record<string, ScanErrorKind> = {
  error_no_face: "no_face",
  error_face_parsing: "no_face",
  error_multiple_people: "multi_face",
  error_large_face_angle: "angle",
  error_pose: "angle",
  exceed_max_filesize: "big_image",
  error_decode_image: "generic",
  error_download_image: "generic",
  error_unsupport_ratio: "generic",
  error_nsfw_content_detected: "generic",
  invalid_parameter: "generic",
  error_inference: "unavailable",
  error_upload: "unavailable",
  unknown_internal_error: "unavailable",
};

/** Undocumented codes are matched by what they seem to say, most specific first. */
const FUZZY: ReadonlyArray<readonly [RegExp, ScanErrorKind]> = [
  [/multi|more_than_one|multiple/i, "multi_face"],
  [/no_face|face_not_found|not_detect|no_person/i, "no_face"],
  [/small|too_far|face_size|face_width|face_ratio/i, "face_small"],
  [/bound|edge|border|crop|out_of_frame|partial/i, "face_bounds"],
  [/angle|pose|yaw|pitch|roll|frontal/i, "angle"],
  [/dark|bright|expos|illumin|lighting/i, "dark"],
  [/resolution|short_side|min_size|too_small/i, "small_image"],
  [/filesize|file_size|too_large|too_big|max_size/i, "big_image"],
];

const CREDIT = /credit|insufficient|quota|balance|billing|payment|out_of_unit/i;

export function kindFromCode(code: string | undefined, message?: string): { kind: ScanErrorKind; spendBlocked: boolean } {
  const c = (code ?? "").trim();
  const text = `${c} ${message ?? ""}`;
  if (c && DOCUMENTED[c]) return { kind: DOCUMENTED[c]!, spendBlocked: false };
  if (CREDIT.test(text)) return { kind: "unavailable", spendBlocked: true };
  for (const [re, kind] of FUZZY) if (re.test(c)) return { kind, spendBlocked: false };
  return { kind: "generic", spendBlocked: false };
}

export function errorFromStatus(status: number, code?: string, message?: string, retryAfterSec?: number): UpstreamError {
  const init = { status, code, retryAfterSec };
  if (status === 401 || status === 403) return new UpstreamError("unavailable", message ?? "key rejected", { ...init, spendBlocked: true });
  if (status === 402) return new UpstreamError("unavailable", message ?? "payment required", { ...init, spendBlocked: true });
  if (status === 413) return new UpstreamError("big_image", message ?? "payload too large", init);
  if (status === 429) return new UpstreamError("busy", message ?? "rate limited", { ...init, retryAfterSec: retryAfterSec ?? 10 });
  if (status === 408 || status === 504) return new UpstreamError("busy", message ?? "timed out", init);
  if (status >= 500) return new UpstreamError("unavailable", message ?? "upstream error", init);
  const mapped = kindFromCode(code, message);
  return new UpstreamError(mapped.kind, message ?? `HTTP ${status}`, { ...init, spendBlocked: mapped.spendBlocked });
}
