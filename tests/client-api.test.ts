import { describe, expect, it, vi } from "vitest";
import { browserApi, toScanError } from "@/client/api";

function reply(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const make = (fn: (url: string, init?: RequestInit) => Response | Promise<Response>) => browserApi((u, i) => Promise.resolve(fn(u, i)));
const photo = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });

describe("toScanError", () => {
  it("keeps known kinds and folds the rest into something sayable", () => {
    expect(toScanError("no_face")).toBe("no_face");
    expect(toScanError("rate_limited")).toBe("busy");
    expect(toScanError("forbidden")).toBe("generic");
    expect(toScanError(undefined, 429)).toBe("busy");
    expect(toScanError(undefined, 413)).toBe("big_image");
    expect(toScanError(42)).toBe("generic");
  });
});

describe("status", () => {
  it("returns the server's report, or null for anything that is not Darpan", async () => {
    expect(await make(() => reply({ app: "darpan", skin: "demo", look: "demo", llm: "off", vision: false, scanCooldownSec: 20, maxImageBytes: 6e6, version: "1" })).status()).toMatchObject({ skin: "demo" });
    expect(await make(() => reply({ hello: "world" })).status()).toBeNull();
    expect(await make(() => reply("<html>502</html>", 502)).status()).toBeNull();
    expect(await make(() => Promise.reject(new Error("offline")) as unknown as Response).status()).toBeNull();
  });
});

describe("chat", () => {
  const req = { mode: "plan", lang: "en", utterance: "hi" } as const;
  it("passes a good plan through", async () => {
    const out = await make(() => reply({ ok: true, actions: [{ type: "start_scan" }], source: "llm" })).chat(req);
    expect(out).toMatchObject({ ok: true, actions: [{ type: "start_scan" }] });
  });
  it("maps every failure to something the app can act on", async () => {
    expect(await make(() => reply({ ok: false, error: "llm_off" })).chat(req)).toEqual({ ok: false, error: "llm_off" });
    expect(await make(() => reply({ ok: false, error: "rate_limited", retryAfterSec: 9 }, 429)).chat(req)).toEqual({ ok: false, error: "rate_limited", retryAfterSec: 9 });
    expect(await make(() => reply("oops", 500)).chat(req)).toEqual({ ok: false, error: "llm_failed" });
    expect(await make(() => Promise.reject(new TypeError("offline")) as unknown as Response).chat(req)).toEqual({ ok: false, error: "llm_failed" });
  });
  it("sends JSON to the right place", async () => {
    const seen = vi.fn((_u: string, _i?: RequestInit) => reply({ ok: true, actions: [], source: "llm" }));
    await make(seen).chat(req);
    expect(seen.mock.calls[0]![0]).toBe("/api/mirror/chat");
    expect(seen.mock.calls[0]![1]?.method).toBe("POST");
    expect(JSON.parse(String(seen.mock.calls[0]![1]?.body))).toEqual(req);
  });
});

describe("lookAtProduct", () => {
  it("states consent in a header and reads the answer", async () => {
    const seen = vi.fn((_u: string, _i?: RequestInit) => reply({ ok: true, found: true, name: "CeraVe Cleanser", category: "cleanser", confidence: "high" }));
    const out = await make(seen).lookAtProduct(photo);
    expect(out).toMatchObject({ ok: true, found: true, name: "CeraVe Cleanser" });
    expect((seen.mock.calls[0]![1]?.headers as Record<string, string>)["x-darpan-consent"]).toBe("look");
  });
  it("handles not found and refusals", async () => {
    expect(await make(() => reply({ ok: true, found: false })).lookAtProduct(photo)).toEqual({ ok: true, found: false });
    expect(await make(() => reply({ ok: false, error: "consent" }, 403)).lookAtProduct(photo)).toEqual({ ok: false, error: "consent" });
    expect(await make(() => reply({ ok: false, error: "vision_off" })).lookAtProduct(photo)).toEqual({ ok: false, error: "vision_off" });
    expect(await make(() => reply({}, 429)).lookAtProduct(photo)).toEqual({ ok: false, error: "rate_limited" });
  });
});

describe("scan", () => {
  it("starts a live scan with the photo and the demo seed in the URL", async () => {
    const seen = vi.fn((_u: string, _i?: RequestInit) => reply({ ok: true, mode: "live", ticket: "t.k", pollMs: 1500 }));
    const out = await make(seen).scanStart(photo, { seed: "abc", n: 2 });
    expect(out).toEqual({ ok: true, mode: "live", ticket: "t.k", pollMs: 1500 });
    expect(seen.mock.calls[0]![0]).toBe("/api/skin/scan?seed=abc&n=2");
    expect(seen.mock.calls[0]![1]?.body).toBe(photo);
  });
  it("sends nothing at all in Demo Mode and accepts sample scores", async () => {
    const seen = vi.fn((_u: string, _i?: RequestInit) => reply({ ok: true, mode: "demo", reason: "no_key", scores: { moisture: 70 } }));
    const out = await make(seen).scanStart(null, { seed: "abc", n: 0 });
    expect(out).toMatchObject({ ok: true, mode: "demo", reason: "no_key", scores: { moisture: 70 } });
    expect(seen.mock.calls[0]![1]?.body).toBeUndefined();
  });
  it("turns rate limits and errors into sayable kinds", async () => {
    expect(await make(() => reply({ ok: false, error: "rate_limited", retryAfterSec: 8 }, 429)).scanStart(photo, { seed: "a", n: 0 })).toEqual({ ok: false, error: "busy", retryAfterSec: 8 });
    expect(await make(() => reply({ ok: false, error: "no_face" }, 502)).scanStart(photo, { seed: "a", n: 0 })).toEqual({ ok: false, error: "no_face" });
    expect(await make(() => reply("<html>", 502)).scanStart(photo, { seed: "a", n: 0 })).toEqual({ ok: false, error: "generic" });
    expect(await make(() => Promise.reject(new TypeError("offline")) as unknown as Response).scanStart(photo, { seed: "a", n: 0 })).toEqual({ ok: false, error: "network" });
  });
  it("polls, and keeps waiting through a slow poll", async () => {
    expect(await make(() => reply({ ok: true, status: "running", pollMs: 1500 })).scanPoll("a b")).toEqual({ ok: true, status: "running", pollMs: 1500 });
    expect(await make(() => reply({ ok: true, status: "success", mode: "live", scores: { moisture: 70 } })).scanPoll("t")).toMatchObject({ ok: true, status: "success" });
    expect(await make(() => reply({ ok: false, error: "angle" })).scanPoll("t")).toEqual({ ok: false, error: "angle" });
  });
  it("encodes the ticket", async () => {
    const seen = vi.fn((_u: string, _i?: RequestInit) => reply({ ok: true, status: "running", pollMs: 99999 }));
    const out = await make(seen).scanPoll("a+b/c=d");
    expect(seen.mock.calls[0]![0]).toBe("/api/skin/scan?ticket=a%2Bb%2Fc%3Dd");
    expect(out).toEqual({ ok: true, status: "running", pollMs: 5000 });
  });
});

describe("look preview", () => {
  it("starts, polls and reads the image", async () => {
    expect(await make(() => reply({ ok: true, mode: "live", ticket: "t", pollMs: 1500 })).previewStart("rani_rose", photo)).toEqual({ ok: true, mode: "live", ticket: "t", pollMs: 1500 });
    expect(await make(() => reply({ ok: true, mode: "demo", reason: "no_key" })).previewStart("rani_rose", null)).toEqual({ ok: true, mode: "demo", reason: "no_key" });
    expect(await make(() => reply({ ok: false, error: "bad_look" }, 400)).previewStart("rani_rose", photo)).toEqual({ ok: false, error: "bad_look" });
    expect(await make(() => reply({ ok: true, status: "success", image: "data:image/jpeg;base64,AAAA" })).previewPoll("t")).toEqual({ ok: true, status: "success", image: "data:image/jpeg;base64,AAAA" });
  });
  it("never accepts a non-image result as an image", async () => {
    const out = await make(() => reply({ ok: true, status: "success", image: "https://evil.example/x.jpg" })).previewPoll("t");
    expect(out.ok).toBe(false);
  });
});
