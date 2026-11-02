import type { ConcernKey } from "@/lib/concerns";
import type { LookId } from "@/lib/looks";
import type { Category } from "@/lib/ritual/products";
import type { PendingKind } from "./state";

/**
 * What the mirror has just asked, so a bare "yes", "not now" or "serum" is understood as an answer.
 * Every question expires: a stray "yes" a minute later does not trigger an old offer.
 */

export type Resume = { what: "scan" } | { what: "verify" } | { what: "look"; look: LookId };

export type Pending =
  | { kind: "forget" }
  | { kind: "focus"; focus: ConcernKey }
  | { kind: "verify_offer" }
  | { kind: "verify_anyway" }
  | { kind: "scan_offer" }
  | { kind: "confirm_product"; name: string; category?: Category }
  | { kind: "look_coach"; look: LookId }
  /** Consent is only ever given by a tap or a setting, never by a spoken "yes": a stray word must not send a photo anywhere. */
  | { kind: "consent_scan"; resume: Resume }
  | { kind: "consent_look" }
  | { kind: "retry"; what: "scan" | "verify" | "look"; look?: LookId }
  | { kind: "category"; name: string; then: "log" | "track" };

export type PendingEntry = Pending & { expiresAt: number };

export const PENDING_TTL_MS = 45_000;
/** A consent card stays up much longer: reading it properly is the point. */
export const CONSENT_TTL_MS = 300_000;

export function ttlFor(p: Pending): number {
  return p.kind === "consent_scan" || p.kind === "consent_look" ? CONSENT_TTL_MS : PENDING_TTL_MS;
}

export function entry(p: Pending, now: number): PendingEntry {
  return { ...p, expiresAt: now + ttlFor(p) };
}

export function live(p: PendingEntry | null, now: number): PendingEntry | null {
  return p && p.expiresAt > now ? p : null;
}

export function pendingKind(p: PendingEntry | null): PendingKind | null {
  return p ? p.kind : null;
}

/** The question without its expiry, to ask it again. */
export function plain(e: PendingEntry): Pending {
  const { expiresAt, ...rest } = e;
  void expiresAt;
  return rest as Pending;
}
