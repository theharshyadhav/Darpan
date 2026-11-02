import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Poll tickets. After a scan or look preview starts, the browser gets an opaque ticket and polls
 * with it. The ticket carries YouCam's task ids and a signature, so the poll route cannot be used
 * as an open lookup for arbitrary task ids on the account, and nothing is stored on the server.
 */

export interface TicketPayload {
  /** What this ticket is for. */
  k: "skin" | "look";
  /** Primary task id (skin analysis, or makeup preview). */
  a: string;
  /** Optional second task id (skin tone). */
  b?: string;
  /** Created at, epoch ms. */
  t: number;
  /** The API version the primary task was created with (skin analysis falls back from v2.1 to v2.0). */
  v?: string;
}

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

export function ticketSecret(apiKey: string | undefined): string {
  return createHash("sha256").update(`darpan-ticket:${apiKey ?? "demo"}`).digest("hex");
}

function mac(secret: string, body: string): Buffer {
  return createHmac("sha256", secret).update(body).digest();
}

export function signTicket(payload: TicketPayload, secret: string): string {
  const body = b64(JSON.stringify(payload));
  return `${body}.${b64(mac(secret, body))}`;
}

export function verifyTicket(
  ticket: string,
  secret: string,
  kind: TicketPayload["k"],
  maxAgeMs = 10 * 60_000,
  now: number = Date.now(),
): TicketPayload | null {
  if (typeof ticket !== "string" || ticket.length > 2000) return null;
  const dot = ticket.indexOf(".");
  if (dot < 1) return null;
  const body = ticket.slice(0, dot);
  const sig = Buffer.from(ticket.slice(dot + 1), "base64url");
  const expect = mac(secret, body);
  if (sig.length !== expect.length || !timingSafeEqual(sig, expect)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<TicketPayload>;
    if (p.k !== kind || typeof p.a !== "string" || typeof p.t !== "number") return null;
    if (p.b !== undefined && typeof p.b !== "string") return null;
    if (p.v !== undefined && !(typeof p.v === "string" && /^v\d+\.\d+$/.test(p.v))) return null;
    if (now - p.t > maxAgeMs || p.t - now > 60_000) return null;
    return { k: p.k, a: p.a, b: p.b, t: p.t, v: p.v };
  } catch {
    return null;
  }
}
