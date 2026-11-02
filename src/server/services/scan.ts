import type { ScanPollResponse, ScanStartResponse, DemoReason } from "@/lib/api";
import type { ConcernKey } from "@/lib/concerns";
import { CONCERN_KEYS } from "@/lib/concerns";
import { checkImage, type ImageProblem } from "@/lib/image/sniff";
import type { ScanErrorKind } from "@/lib/persona/copy";
import { demoScores } from "@/lib/skin/demo";
import { itaFromHex } from "@/lib/skin/tone";
import type { Deps } from "../deps";
import { UpstreamError } from "../youcam/errors";
import { YouCamClient } from "../youcam/client";
import { parseSkinHex, parseSkinResult } from "../youcam/parse";
import { signTicket, verifyTicket } from "../ticket";

/**
 * Skin scans: start one (upload + create tasks) and poll it. Every failure ends in either a
 * labelled demo result (no key, budget reached, key rejected) or an error kind the mirror can say.
 */

export type Reply<T> = { status: number; body: T };

const POLL_MS = 1500;
/** Give up on a scan that has not finished after this long. */
const SCAN_DEADLINE_MS = 75_000;
/** The optional skin-tone result is waited for only until this long after the scan started. */
const TONE_GRACE_MS = 20_000;
const MIN_UNDERSTOOD = 4;

export interface StartScanInput {
  ip: string;
  /** The photo, or null when the browser chose not to send one (Demo Mode). */
  bytes: Uint8Array | null;
  seed: string;
  n: number;
}

const IMAGE_PROBLEM_KIND: Record<ImageProblem, ScanErrorKind> = {
  not_an_image: "generic",
  too_big_bytes: "big_image",
  too_small: "small_image",
  too_large: "big_image",
};

function demo(d: Deps, input: StartScanInput, reason: DemoReason): Reply<ScanStartResponse> {
  void d;
  return { status: 200, body: { ok: true, mode: "demo", reason, scores: demoScores(input.seed, input.n) } };
}

function unitsFor(d: Deps): number {
  const c = d.cfg.youcam;
  return c.cost.skin + (c.tone ? c.cost.tone : 0);
}

export async function startScan(d: Deps, input: StartScanInput): Promise<Reply<ScanStartResponse>> {
  const cfg = d.cfg;
  if (cfg.demoOnly) return demo(d, input, "forced");
  if (!d.youcam) return demo(d, input, "no_key");
  if (!input.bytes) return { status: 400, body: { ok: false, error: "generic" } };

  const checked = checkImage(input.bytes, { maxBytes: cfg.limits.maxImageBytes, minShortSide: 480, maxLongSide: 2560 });
  if (!checked.ok) return { status: 422, body: { ok: false, error: IMAGE_PROBLEM_KIND[checked.problem] } };

  const units = unitsFor(d);
  const decision = await d.budget.reserve(input.ip, units);
  if (!decision.ok) return demo(d, input, "budget");

  try {
    const contentType = checked.info.type === "png" ? "image/png" : "image/jpeg";
    const fileId = await d.youcam.upload(input.bytes, contentType, `darpan.${checked.info.type === "png" ? "png" : "jpg"}`);

    const versions = [cfg.youcam.skinVersion, ...(cfg.youcam.skinVersion === "v2.0" ? [] : ["v2.0"])];
    let skinId: string | null = null;
    let usedVersion = versions[0]!;
    let lastError: unknown = null;
    for (const v of versions) {
      try {
        skinId = await d.youcam.createTask("skin-analysis", v, {
          src_file_id: fileId,
          dst_actions: cfg.youcam.actions,
          format: "json",
        });
        usedVersion = v;
        break;
      } catch (e) {
        lastError = e;
        // only an unknown-version style failure is worth retrying on an older version
        if (!(e instanceof UpstreamError) || (e.status !== 404 && e.status !== 400)) throw e;
      }
    }
    if (!skinId) throw lastError instanceof Error ? lastError : new UpstreamError("unavailable", "could not start the scan");

    // The skin-tone read is optional: it only widens the stated uncertainty. Never let it break a scan.
    let toneId: string | undefined;
    if (cfg.youcam.tone) {
      try {
        toneId = await d.youcam.createTask("skin-tone-analysis", "v2.0", {
          src_file_id: fileId,
          face_angle_strictness_level: cfg.youcam.strictness,
        });
      } catch {
        toneId = undefined;
        await d.budget.refund(input.ip, cfg.youcam.cost.tone);
      }
    }

    const ticket = signTicket({ k: "skin", a: skinId, b: toneId, t: d.now(), v: usedVersion }, d.secret);
    return { status: 200, body: { ok: true, mode: "live", ticket, pollMs: POLL_MS } };
  } catch (e) {
    await d.budget.refund(input.ip, units);
    if (e instanceof UpstreamError) {
      if (e.spendBlocked) {
        d.budget.trip(30);
        console.warn(`[darpan] YouCam refused the request (${e.status ?? "?"} ${e.code ?? e.message}); showing demo scores for 30 minutes.`);
        return demo(d, input, "budget");
      }
      return { status: e.kind === "busy" ? 429 : 502, body: { ok: false, error: e.kind, retryAfterSec: e.retryAfterSec } };
    }
    console.error("[darpan] scan start failed:", e instanceof Error ? e.message : e);
    return { status: 500, body: { ok: false, error: "generic" } };
  }
}

export async function pollScan(d: Deps, ticketStr: string): Promise<Reply<ScanPollResponse>> {
  const ticket = verifyTicket(ticketStr, d.secret, "skin", 10 * 60_000, d.now());
  if (!ticket || !d.youcam) return { status: 400, body: { ok: false, error: "generic" } };

  const age = d.now() - ticket.t;
  const version = ticket.v ?? d.cfg.youcam.skinVersion;
  const running: Reply<ScanPollResponse> = { status: 200, body: { ok: true, status: "running", pollMs: POLL_MS } };

  let skin;
  try {
    skin = await d.youcam.getTask("skin-analysis", version, ticket.a);
  } catch (e) {
    if (e instanceof UpstreamError && e.spendBlocked) {
      d.budget.trip(30);
      return { status: 502, body: { ok: false, error: "unavailable" } };
    }
    // a blip while polling is not a failed scan: keep waiting until the deadline
    return age > SCAN_DEADLINE_MS ? { status: 504, body: { ok: false, error: "busy" } } : running;
  }

  if (skin.status === "error") {
    const err = YouCamClient.taskError(skin);
    if (err.spendBlocked) d.budget.trip(30);
    return { status: 200, body: { ok: false, error: err.kind } };
  }
  if (skin.status === "running") {
    return age > SCAN_DEADLINE_MS ? { status: 504, body: { ok: false, error: "busy" } } : running;
  }

  const wanted = d.cfg.youcam.actions.filter((a): a is ConcernKey => (CONCERN_KEYS as readonly string[]).includes(a));
  const parsed = parseSkinResult(skin.data, wanted.length > 0 ? wanted : CONCERN_KEYS);
  if (Object.keys(parsed.scores).length < Math.min(MIN_UNDERSTOOD, Math.max(1, wanted.length))) {
    // Better an honest "could not read that" than invented numbers.
    console.warn(`[darpan] skin result had too few readable scores (found ${Object.keys(parsed.scores).join(",") || "none"}).`);
    return { status: 502, body: { ok: false, error: "generic" } };
  }

  let ita: number | undefined;
  if (ticket.b) {
    try {
      const tone = await d.youcam.getTask("skin-tone-analysis", "v2.0", ticket.b);
      // the skin result is in; give the tone read a short grace period, then move on without it
      if (tone.status === "running" && age < TONE_GRACE_MS) return running;
      if (tone.status === "success") {
        const hex = parseSkinHex(tone.data);
        if (hex) ita = itaFromHex(hex);
      }
    } catch {
      ita = undefined;
    }
  }

  return { status: 200, body: { ok: true, status: "success", mode: "live", scores: parsed.scores, ...(ita !== undefined ? { ita: Math.round(ita * 10) / 10 } : {}) } };
}
