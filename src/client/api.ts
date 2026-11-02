import type {
  ChatRequest,
  ChatResponse,
  LookPollResponse,
  LookStartResponse,
  ProductLookResponse,
  ScanPollResponse,
  ScanStartResponse,
  StatusResponse,
} from "@/lib/api";
import type { LookId } from "@/lib/looks";
import type { ScanErrorKind } from "@/lib/persona/copy";

/**
 * The browser's side of the server contract (src/lib/api.ts). Every call has a timeout, never
 * throws, and folds whatever went wrong (offline, a proxy's HTML error page, a rate limit) into a
 * typed answer the mirror knows how to say out loud.
 */

export interface Api {
  status(): Promise<StatusResponse | null>;
  chat(req: ChatRequest): Promise<ChatResponse>;
  lookAtProduct(frame: Blob): Promise<ProductLookResponse>;
  scanStart(photo: Blob | null, demo: { seed: string; n: number }): Promise<ScanStartResponse>;
  scanPoll(ticket: string): Promise<ScanPollResponse>;
  previewStart(look: LookId, photo: Blob | null): Promise<LookStartResponse>;
  previewPoll(ticket: string): Promise<LookPollResponse>;
}

const KNOWN_SCAN_ERRORS: readonly ScanErrorKind[] = [
  "no_face", "face_small", "face_bounds", "multi_face", "dark", "small_image", "big_image", "angle", "busy", "unavailable", "network", "generic",
];

/** Anything the server says that the mirror has no sentence for becomes a calm, generic one. */
export function toScanError(raw: unknown, status?: number): ScanErrorKind {
  if (typeof raw === "string") {
    if ((KNOWN_SCAN_ERRORS as readonly string[]).includes(raw)) return raw as ScanErrorKind;
    if (raw === "rate_limited") return "busy";
  }
  if (status === 429) return "busy";
  if (status === 413) return "big_image";
  return "generic";
}

interface Reply {
  status: number;
  body: Record<string, unknown> | null;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function call(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number): Promise<Reply | "offline" | "timeout"> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: ctl.signal, cache: "no-store", credentials: "same-origin" });
    let body: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = await res.json();
      body = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch (e) {
    return e instanceof Error && e.name === "AbortError" ? "timeout" : "offline";
  } finally {
    clearTimeout(timer);
  }
}

export function browserApi(fetchImpl: FetchLike = (u, i) => fetch(u, i), base = ""): Api {
  const scanFailure = (r: Reply | "offline" | "timeout"): { ok: false; error: ScanErrorKind } =>
    r === "offline" ? { ok: false, error: "network" } : r === "timeout" ? { ok: false, error: "busy" } : { ok: false, error: toScanError(r.body?.error, r.status) };

  return {
    async status() {
      const r = await call(fetchImpl, `${base}/api/status`, { method: "GET" }, 8000);
      if (typeof r === "string" || r.status !== 200 || r.body?.app !== "darpan") return null;
      return r.body as unknown as StatusResponse;
    },

    async chat(req) {
      const r = await call(
        fetchImpl,
        `${base}/api/mirror/chat`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) },
        24_000,
      );
      if (typeof r === "string") return { ok: false, error: "llm_failed" };
      const b = r.body;
      if (b?.ok === true && Array.isArray(b.actions)) return b as unknown as ChatResponse;
      const error = b?.error;
      if (error === "llm_off" || error === "bad_request" || error === "forbidden") return { ok: false, error };
      if (r.status === 429 || error === "rate_limited") return { ok: false, error: "rate_limited", retryAfterSec: Number(b?.retryAfterSec) || 20 };
      return { ok: false, error: "llm_failed" };
    },

    async lookAtProduct(frame) {
      const r = await call(
        fetchImpl,
        `${base}/api/mirror/look`,
        { method: "POST", headers: { "Content-Type": frame.type || "image/jpeg", "x-darpan-consent": "look" }, body: frame },
        32_000,
      );
      if (typeof r === "string") return { ok: false, error: "llm_failed" };
      const b = r.body;
      if (b?.ok === true && b.found === true && typeof b.name === "string") return b as unknown as ProductLookResponse;
      if (b?.ok === true && b.found === false) return { ok: true, found: false };
      const error = b?.error;
      if (error === "vision_off" || error === "consent" || error === "bad_image" || error === "forbidden") return { ok: false, error };
      if (r.status === 429 || error === "rate_limited") return { ok: false, error: "rate_limited" };
      return { ok: false, error: "llm_failed" };
    },

    async scanStart(photo, demo) {
      const qs = new URLSearchParams({ seed: demo.seed, n: String(Math.max(0, Math.min(999, Math.round(demo.n)))) });
      const r = await call(
        fetchImpl,
        `${base}/api/skin/scan?${qs.toString()}`,
        photo ? { method: "POST", headers: { "Content-Type": photo.type || "image/jpeg" }, body: photo } : { method: "POST" },
        50_000,
      );
      if (typeof r === "string") return scanFailure(r);
      const b = r.body;
      if (b?.ok === true && b.mode === "demo" && typeof b.scores === "object" && b.scores !== null) return b as unknown as ScanStartResponse;
      if (b?.ok === true && b.mode === "live" && typeof b.ticket === "string") {
        return { ok: true, mode: "live", ticket: b.ticket, pollMs: clampPoll(b.pollMs) };
      }
      return { ...scanFailure(r), ...(typeof b?.retryAfterSec === "number" ? { retryAfterSec: b.retryAfterSec } : {}) };
    },

    async scanPoll(ticket) {
      const r = await call(fetchImpl, `${base}/api/skin/scan?ticket=${encodeURIComponent(ticket)}`, { method: "GET" }, 20_000);
      if (typeof r === "string") return r === "timeout" ? { ok: true, status: "running", pollMs: 2000 } : scanFailure(r);
      const b = r.body;
      if (b?.ok === true && b.status === "running") return { ok: true, status: "running", pollMs: clampPoll(b.pollMs) };
      if (b?.ok === true && b.status === "success" && typeof b.scores === "object" && b.scores !== null) return b as unknown as ScanPollResponse;
      return scanFailure(r);
    },

    async previewStart(look, photo) {
      const r = await call(
        fetchImpl,
        `${base}/api/look/preview?look=${encodeURIComponent(look)}`,
        photo ? { method: "POST", headers: { "Content-Type": photo.type || "image/jpeg" }, body: photo } : { method: "POST" },
        50_000,
      );
      if (typeof r === "string") return scanFailure(r);
      const b = r.body;
      if (b?.ok === true && b.mode === "demo") return { ok: true, mode: "demo", reason: (b.reason as "no_key" | "budget" | "forced") ?? "no_key" };
      if (b?.ok === true && b.mode === "live" && typeof b.ticket === "string") return { ok: true, mode: "live", ticket: b.ticket, pollMs: clampPoll(b.pollMs) };
      if (b?.error === "bad_look") return { ok: false, error: "bad_look" };
      return { ...scanFailure(r), ...(typeof b?.retryAfterSec === "number" ? { retryAfterSec: b.retryAfterSec } : {}) };
    },

    async previewPoll(ticket) {
      const r = await call(fetchImpl, `${base}/api/look/preview?ticket=${encodeURIComponent(ticket)}`, { method: "GET" }, 20_000);
      if (typeof r === "string") return r === "timeout" ? { ok: true, status: "running", pollMs: 2000 } : scanFailure(r);
      const b = r.body;
      if (b?.ok === true && b.status === "running") return { ok: true, status: "running", pollMs: clampPoll(b.pollMs) };
      if (b?.ok === true && b.status === "success" && typeof b.image === "string" && b.image.startsWith("data:image/")) {
        return { ok: true, status: "success", image: b.image };
      }
      return scanFailure(r);
    },
  };
}

function clampPoll(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(700, Math.min(5000, Math.round(n))) : 1500;
}
