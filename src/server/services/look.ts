import type { DemoReason, LookPollResponse, LookStartResponse } from "@/lib/api";
import { checkImage, type ImageProblem } from "@/lib/image/sniff";
import { LOOKS, isLookId } from "@/lib/looks";
import type { ScanErrorKind } from "@/lib/persona/copy";
import type { Deps } from "../deps";
import { ImageFetchError, fetchImageAsDataUrl } from "../image-fetch";
import { YouCamClient } from "../youcam/client";
import { UpstreamError } from "../youcam/errors";
import { parseResultUrl } from "../youcam/parse";
import { signTicket, verifyTicket } from "../ticket";
import type { Reply } from "./scan";

/**
 * Look Studio previews. The browser sends only a look id and a photo; the makeup recipe itself
 * (YouCam `effects`) lives in src/lib/looks.ts and is never accepted from the client, so a visitor
 * cannot spend units on arbitrary requests.
 */

const POLL_MS = 1500;
const DEADLINE_MS = 75_000;

const IMAGE_PROBLEM_KIND: Record<ImageProblem, ScanErrorKind> = {
  not_an_image: "generic",
  too_big_bytes: "big_image",
  too_small: "small_image",
  too_large: "big_image",
};

function demo(reason: DemoReason): Reply<LookStartResponse> {
  return { status: 200, body: { ok: true, mode: "demo", reason } };
}

export interface StartLookInput {
  ip: string;
  lookId: string;
  bytes: Uint8Array | null;
}

export async function startLook(d: Deps, input: StartLookInput): Promise<Reply<LookStartResponse>> {
  if (!isLookId(input.lookId)) return { status: 400, body: { ok: false, error: "bad_look" } };
  if (d.cfg.demoOnly) return demo("forced");
  if (!d.youcam) return demo("no_key");
  if (!input.bytes) return { status: 400, body: { ok: false, error: "generic" } };

  const checked = checkImage(input.bytes, { maxBytes: d.cfg.limits.maxImageBytes, minShortSide: 480, maxLongSide: 2560 });
  if (!checked.ok) return { status: 422, body: { ok: false, error: IMAGE_PROBLEM_KIND[checked.problem] } };

  const units = d.cfg.youcam.cost.look;
  const decision = await d.budget.reserve(input.ip, units);
  if (!decision.ok) return demo("budget");

  try {
    const type = checked.info.type === "png" ? "image/png" : "image/jpeg";
    const fileId = await d.youcam.upload(input.bytes, type, `darpan.${checked.info.type === "png" ? "png" : "jpg"}`);
    const taskId = await d.youcam.createTask("makeup-vto", "v2.0", {
      src_file_id: fileId,
      effects: LOOKS[input.lookId].effects,
    });
    const ticket = signTicket({ k: "look", a: taskId, t: d.now() }, d.secret);
    return { status: 200, body: { ok: true, mode: "live", ticket, pollMs: POLL_MS } };
  } catch (e) {
    await d.budget.refund(input.ip, units);
    if (e instanceof UpstreamError) {
      if (e.spendBlocked) {
        d.budget.trip(30);
        return demo("budget");
      }
      return { status: e.kind === "busy" ? 429 : 502, body: { ok: false, error: e.kind, retryAfterSec: e.retryAfterSec } };
    }
    console.error("[darpan] look start failed:", e instanceof Error ? e.message : e);
    return { status: 500, body: { ok: false, error: "generic" } };
  }
}

export async function pollLook(d: Deps, ticketStr: string): Promise<Reply<LookPollResponse>> {
  const ticket = verifyTicket(ticketStr, d.secret, "look", 10 * 60_000, d.now());
  if (!ticket || !d.youcam) return { status: 400, body: { ok: false, error: "generic" } };

  const age = d.now() - ticket.t;
  const running: Reply<LookPollResponse> = { status: 200, body: { ok: true, status: "running", pollMs: POLL_MS } };

  let task;
  try {
    task = await d.youcam.getTask("makeup-vto", "v2.0", ticket.a);
  } catch (e) {
    if (e instanceof UpstreamError && e.spendBlocked) {
      d.budget.trip(30);
      return { status: 502, body: { ok: false, error: "unavailable" } };
    }
    return age > DEADLINE_MS ? { status: 504, body: { ok: false, error: "busy" } } : running;
  }

  if (task.status === "error") {
    const err = YouCamClient.taskError(task);
    if (err.spendBlocked) d.budget.trip(30);
    return { status: 200, body: { ok: false, error: err.kind } };
  }
  if (task.status === "running") return age > DEADLINE_MS ? { status: 504, body: { ok: false, error: "busy" } } : running;

  const url = parseResultUrl(task.data);
  if (!url) {
    console.warn("[darpan] look result had no readable image URL.");
    return { status: 502, body: { ok: false, error: "generic" } };
  }
  try {
    const base = new URL(d.cfg.youcam.baseUrl);
    const trustedHosts = base.protocol === "http:" ? [base.host] : [];
    const img = await fetchImageAsDataUrl(url, { trustedHosts, fetchImpl: d.fetchImpl });
    return { status: 200, body: { ok: true, status: "success", image: img.dataUrl } };
  } catch (e) {
    console.warn("[darpan] could not fetch the look image:", e instanceof ImageFetchError ? e.reason : "unknown");
    return { status: 502, body: { ok: false, error: "unavailable" } };
  }
}
