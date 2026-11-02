import { describe, expect, it, vi } from "vitest";
import { loadConfig, llmLive, skinMode } from "@/server/config";
import { MemoryKV, UpstashKV } from "@/server/kv";
import { rateLimit } from "@/server/ratelimit";
import { Budget } from "@/server/budget";
import { signTicket, ticketSecret, verifyTicket } from "@/server/ticket";
import { clientIp, originAllowed, readBytes, readJson } from "@/server/http";
import { ImageFetchError, fetchImageAsDataUrl, isPublicIp, sniffImageType } from "@/server/image-fetch";
import { PROVIDERS, pickModels } from "@/server/llm/providers";
import { visitorSeed } from "@/server/seed";
import { T0 } from "./helpers";

describe("config", () => {
  it("defaults to Demo Mode with the LLM off and sensible limits", () => {
    const c = loadConfig({});
    expect(skinMode(c)).toBe("demo");
    expect(llmLive(c)).toBe(false);
    expect(c.youcam.baseUrl).toBe("https://yce-api-01.makeupar.com");
    expect(c.youcam.skinVersion).toBe("v2.1");
    expect(c.youcam.actions).toHaveLength(7);
    expect(c.youcam.tone).toBe(true);
    expect(c.limits.dailyUnits).toBe(240);
    expect(c.warnings).toEqual([]);
  });

  it("goes live with a YouCam key, unless Demo Mode is forced", () => {
    expect(skinMode(loadConfig({ YOUCAM_API_KEY: "k" }))).toBe("live");
    expect(skinMode(loadConfig({ YOUCAM_API_KEY: "k", DARPAN_DEMO_ONLY: "1" }))).toBe("demo");
  });

  it("picks the provider from whichever key is present, preferring Groq", () => {
    expect(loadConfig({ GROQ_API_KEY: "g" }).llm).toMatchObject({ provider: "groq", apiKey: "g", baseUrl: PROVIDERS.groq.baseUrl });
    expect(loadConfig({ XAI_API_KEY: "x" }).llm.provider).toBe("xai");
    expect(loadConfig({ GEMINI_API_KEY: "m" }).llm.provider).toBe("gemini");
    expect(loadConfig({ OPENROUTER_API_KEY: "o" }).llm.provider).toBe("openrouter");
    expect(loadConfig({ GROQ_API_KEY: "g", XAI_API_KEY: "x" }).llm.provider).toBe("groq");
    expect(llmLive(loadConfig({ GROQ_API_KEY: "g" }))).toBe(true);
  });

  it("honours an explicit provider, a custom endpoint, and 'off'", () => {
    const grok = loadConfig({ LLM_PROVIDER: "xai", XAI_API_KEY: "x", GROQ_API_KEY: "g" });
    expect(grok.llm.provider).toBe("xai");
    const custom = loadConfig({ LLM_API_KEY: "k", LLM_BASE_URL: "https://llm.example.com/v1/" });
    expect(custom.llm).toMatchObject({ provider: "custom", baseUrl: "https://llm.example.com/v1" });
    expect(loadConfig({ LLM_PROVIDER: "off", GROQ_API_KEY: "g" }).llm.provider).toBeNull();
  });

  it("explains a provider that has no key, and accepts model overrides", () => {
    const c = loadConfig({ LLM_PROVIDER: "groq", LLM_MODEL: "a, b ,c" });
    expect(llmLive(c)).toBe(false);
    expect(c.warnings.join(" ")).toMatch(/no API key/);
    expect(c.llm.chatModels).toEqual(["a", "b", "c"]);
  });

  it("never crashes on bad values: it warns and uses safe defaults", () => {
    const c = loadConfig({
      DARPAN_DAILY_UNITS: "lots",
      YOUCAM_FACE_STRICTNESS: "extreme",
      YOUCAM_SKIN_VERSION: "latest",
      LLM_PROVIDER: "skynet",
      YOUCAM_BASE_URL: "http://insecure.example.com",
      ALLOWED_ORIGINS: "https://ok.example.com, not a url",
      DARPAN_DEMO_ONLY: "maybe",
    });
    expect(c.limits.dailyUnits).toBe(240);
    expect(c.youcam.strictness).toBe("high");
    expect(c.youcam.skinVersion).toBe("v2.1");
    expect(c.youcam.baseUrl).toBe("https://yce-api-01.makeupar.com");
    expect(c.allowedOrigins).toEqual(["https://ok.example.com"]);
    expect(c.demoOnly).toBe(false);
    expect(c.warnings.length).toBeGreaterThanOrEqual(6);
  });

  it("allows an http upstream only when explicitly told (for the local mock)", () => {
    const c = loadConfig({ YOUCAM_BASE_URL: "http://127.0.0.1:4010", DARPAN_ALLOW_HTTP_UPSTREAM: "1" });
    expect(c.youcam.baseUrl).toBe("http://127.0.0.1:4010");
  });

  it("keeps skin actions SD-only, within the price tier", () => {
    const c = loadConfig({ YOUCAM_SKIN_ACTIONS: "hd_acne, moisture, pore, skin_type, moisture" });
    expect(c.youcam.actions).toEqual(["moisture", "pore"]);
  });

  it("ignores an Upstash URL without a token", () => {
    const c = loadConfig({ UPSTASH_REDIS_REST_URL: "https://x.upstash.io" });
    expect(c.kv.url).toBeUndefined();
    expect(c.warnings.join(" ")).toMatch(/Upstash/);
  });
});

describe("kv and rate limiting", () => {
  it("counts, expires and goes negative for refunds", async () => {
    let t = T0;
    const kv = new MemoryKV(() => t);
    expect(await kv.incr("a", 3, 10)).toBe(3);
    expect(await kv.incr("a", -1, 10)).toBe(2);
    expect(await kv.get("a")).toBe(2);
    t += 11_000;
    expect(await kv.get("a")).toBe(0);
    expect(await kv.incr("a", 1, 10)).toBe(1);
  });

  it("limits per bucket and key, and says when to come back", async () => {
    const kv = new MemoryKV(() => T0);
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await rateLimit(kv, "chat", "1.2.3.4", 3, 60, T0));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
    expect(results[3]!.retryAfterSec).toBeGreaterThan(0);
    expect(results[3]!.retryAfterSec).toBeLessThanOrEqual(60);
    expect((await rateLimit(kv, "chat", "5.6.7.8", 3, 60, T0)).ok).toBe(true);
    expect((await rateLimit(kv, "other", "1.2.3.4", 3, 60, T0)).ok).toBe(true);
    // next window
    expect((await rateLimit(kv, "chat", "1.2.3.4", 3, 60, T0 + 61_000)).ok).toBe(true);
  });

  it("Upstash backend sends commands and falls back to memory when it fails", async () => {
    const calls: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const cmd = JSON.parse(String(init?.body)) as unknown[];
      calls.push(cmd);
      return new Response(JSON.stringify({ result: cmd[0] === "INCRBY" ? 2 : 1 }), { status: 200 });
    }) as unknown as typeof fetch;
    const memory = new MemoryKV();
    const up = new UpstashKV("https://up.example.com", "tok", memory, fetchImpl);
    expect(await up.incr("k", 2, 30)).toBe(2);
    expect(calls).toEqual([["INCRBY", "k", 2], ["EXPIRE", "k", 30]]);

    const broken = new UpstashKV("https://up.example.com", "tok", memory, (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch);
    expect(await broken.incr("z", 1, 30)).toBe(1);
    expect(await broken.incr("z", 1, 30)).toBe(2);
    expect(await broken.get("z")).toBe(2);
  });
});

describe("budget guard", () => {
  const limits = { dailyUnits: 30, ipDailyUnits: 20, minBalance: 0 };

  it("reserves units until the per-visitor cap, then says no", async () => {
    const b = new Budget(new MemoryKV(() => T0), limits, null, () => T0);
    expect(await b.reserve("a", 12)).toEqual({ ok: true });
    expect(await b.reserve("a", 8)).toEqual({ ok: true });
    expect(await b.reserve("a", 1)).toEqual({ ok: false, reason: "visitor" });
  });

  it("enforces the global daily cap across visitors and rolls back a refused reservation", async () => {
    const b = new Budget(new MemoryKV(() => T0), limits, null, () => T0);
    expect(await b.reserve("a", 15)).toEqual({ ok: true });
    expect(await b.reserve("b", 15)).toEqual({ ok: true });
    expect(await b.reserve("c", 1)).toEqual({ ok: false, reason: "daily" });
    await b.refund("a", 15);
    expect(await b.reserve("c", 12)).toEqual({ ok: true });
  });

  it("resets each day", async () => {
    let t = T0;
    const b = new Budget(new MemoryKV(() => t), limits, null, () => t);
    expect((await b.reserve("a", 20)).ok).toBe(true);
    expect((await b.reserve("a", 1)).ok).toBe(false);
    t += 24 * 3600 * 1000;
    expect((await b.reserve("a", 20)).ok).toBe(true);
  });

  it("keeps a minimum balance in the account, using a cached balance lookup", async () => {
    const balance = vi.fn(async () => 40);
    const b = new Budget(new MemoryKV(() => T0), { ...limits, dailyUnits: 999, ipDailyUnits: 999, minBalance: 30 }, balance, () => T0);
    expect((await b.reserve("a", 10)).ok).toBe(true);
    expect(await b.reserve("a", 12)).toEqual({ ok: false, reason: "balance" });
    expect(balance).toHaveBeenCalledTimes(1);
  });

  it("stays open when the balance is unknown", async () => {
    const b = new Budget(new MemoryKV(() => T0), { ...limits, minBalance: 30 }, async () => null, () => T0);
    expect((await b.reserve("a", 5)).ok).toBe(true);
  });

  it("stops spending while the breaker is tripped, then recovers", async () => {
    let t = T0;
    const b = new Budget(new MemoryKV(() => t), limits, null, () => t);
    b.trip(30);
    expect(await b.reserve("a", 1)).toEqual({ ok: false, reason: "breaker" });
    t += 31 * 60_000;
    expect((await b.reserve("a", 1)).ok).toBe(true);
  });

  it("free calls never hit the limits", async () => {
    const b = new Budget(new MemoryKV(() => T0), { dailyUnits: 0, ipDailyUnits: 0, minBalance: 0 }, null, () => T0);
    expect((await b.reserve("a", 0)).ok).toBe(true);
  });
});

describe("tickets", () => {
  const secret = ticketSecret("key");

  it("round-trips and binds to its kind", () => {
    const t = signTicket({ k: "skin", a: "task1", b: "task2", t: T0, v: "v2.1" }, secret);
    expect(verifyTicket(t, secret, "skin", 60_000, T0 + 1000)).toEqual({ k: "skin", a: "task1", b: "task2", t: T0, v: "v2.1" });
    expect(verifyTicket(t, secret, "look", 60_000, T0 + 1000)).toBeNull();
  });

  it("rejects tampering, another secret, expiry and junk", () => {
    const t = signTicket({ k: "skin", a: "task1", t: T0 }, secret);
    const [body, sig] = t.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ k: "skin", a: "someone-elses-task", t: T0 })).toString("base64url");
    expect(verifyTicket(`${forged}.${sig}`, secret, "skin", 60_000, T0)).toBeNull();
    expect(verifyTicket(t, ticketSecret("other"), "skin", 60_000, T0)).toBeNull();
    expect(verifyTicket(t, secret, "skin", 60_000, T0 + 61_000)).toBeNull();
    expect(verifyTicket(t, secret, "skin", 60_000, T0 - 120_000)).toBeNull();
    expect(verifyTicket(`${body}.`, secret, "skin")).toBeNull();
    for (const junk of ["", "x", ".", "a.b", "a".repeat(5000)]) expect(verifyTicket(junk, secret, "skin")).toBeNull();
  });

  it("refuses a malformed version", () => {
    const bad = signTicket({ k: "skin", a: "t", t: T0, v: "latest; drop" }, secret);
    expect(verifyTicket(bad, secret, "skin", 60_000, T0)).toBeNull();
  });
});

describe("http guards", () => {
  const cfg = { allowedOrigins: ["https://partner.example.com"] };
  const req = (headers: Record<string, string>) => new Request("https://darpan.example.com/api/x", { method: "POST", headers });

  it("allows the app's own origin and listed partners only", () => {
    expect(originAllowed(req({ origin: "https://darpan.example.com", host: "darpan.example.com" }), cfg)).toBe(true);
    expect(originAllowed(req({ origin: "https://partner.example.com", host: "darpan.example.com" }), cfg)).toBe(true);
    expect(originAllowed(req({ origin: "https://evil.example.net", host: "darpan.example.com" }), cfg)).toBe(false);
    expect(originAllowed(req({ origin: "null", host: "darpan.example.com" }), cfg)).toBe(false);
    expect(originAllowed(req({ origin: "https://darpan.example.com", "x-forwarded-host": "darpan.example.com", host: "internal:3000" }), cfg)).toBe(true);
  });

  it("treats a missing Origin as same-origin only when the browser says so", () => {
    expect(originAllowed(req({}), cfg)).toBe(true); // curl
    expect(originAllowed(req({ "sec-fetch-site": "same-origin" }), cfg)).toBe(true);
    expect(originAllowed(req({ "sec-fetch-site": "cross-site" }), cfg)).toBe(false);
  });

  it("reads the visitor address from proxy headers", () => {
    expect(clientIp(req({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
    expect(clientIp(req({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
    expect(clientIp(req({}))).toBe("unknown");
  });

  it("enforces a hard body limit even when Content-Length lies", async () => {
    const big = new Request("https://x.test/", { method: "POST", body: new Uint8Array(5000) });
    expect(await readBytes(big, 1000)).toEqual({ ok: false, reason: "too_big" });
    const ok = await readBytes(new Request("https://x.test/", { method: "POST", body: new Uint8Array(900) }), 1000);
    expect(ok.ok && ok.bytes.length).toBe(900);
    expect(await readBytes(new Request("https://x.test/", { method: "POST" }), 1000)).toEqual({ ok: false, reason: "empty" });
    const lying = new Request("https://x.test/", { method: "POST", body: new Uint8Array(5000), headers: { "content-length": "10" } });
    expect(await readBytes(lying, 1000)).toEqual({ ok: false, reason: "too_big" });
  });

  it("parses small JSON bodies and rejects junk", async () => {
    const good = await readJson(new Request("https://x.test/", { method: "POST", body: '{"a":1}' }));
    expect(good).toEqual({ ok: true, value: { a: 1 } });
    expect((await readJson(new Request("https://x.test/", { method: "POST", body: "{nope" }))).ok).toBe(false);
  });

  it("sanitises the demo seed", () => {
    expect(visitorSeed("abc_123-X")).toBe("abc_123-X");
    expect(visitorSeed("../../etc/passwd")).toBe("guest");
    expect(visitorSeed(null)).toBe("guest");
    expect(visitorSeed("x".repeat(80))).toBe("guest");
  });
});

describe("image fetching is SSRF-safe", () => {
  it("classifies addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) expect(isPublicIp(ip), ip).toBe(true);
    for (const ip of [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1",
      "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fc00::1", "fd12::1", "::ffff:10.0.0.1", "2001:db8::1", "not-an-ip",
    ]) expect(isPublicIp(ip), ip).toBe(false);
    expect(isPublicIp("172.32.0.1")).toBe(true);
  });

  it("recognises images by their bytes, not their headers", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBe("image/png");
    expect(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });

  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);
  const okFetch = (async () => new Response(jpeg, { status: 200, headers: { "content-type": "image/jpeg" } })) as unknown as typeof fetch;
  const publicResolve = async () => ["93.184.216.34"];

  it("returns a data URL for a normal image", async () => {
    const r = await fetchImageAsDataUrl("https://cdn.example.com/a.jpg", { fetchImpl: okFetch, resolve: publicResolve });
    expect(r.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(r.bytes).toBe(10);
  });

  it("blocks private targets, odd schemes, credentials and hostnames that resolve privately", async () => {
    const attempt = (url: string, resolve = publicResolve) => fetchImageAsDataUrl(url, { fetchImpl: okFetch, resolve });
    await expect(attempt("http://cdn.example.com/a.jpg")).rejects.toMatchObject({ reason: "blocked" });
    await expect(attempt("file:///etc/passwd")).rejects.toMatchObject({ reason: "blocked" });
    await expect(attempt("https://user:pw@cdn.example.com/a.jpg")).rejects.toMatchObject({ reason: "blocked" });
    await expect(attempt("https://localhost/a.jpg")).rejects.toMatchObject({ reason: "blocked" });
    await expect(attempt("https://169.254.169.254/latest/meta-data")).rejects.toMatchObject({ reason: "blocked" });
    await expect(attempt("https://[::1]/a.jpg")).rejects.toMatchObject({ reason: "blocked" });
    await expect(attempt("https://evil.example.com/a.jpg", async () => ["10.0.0.5"])).rejects.toMatchObject({ reason: "blocked" });
    await expect(attempt("https://evil.example.com/a.jpg", async () => ["93.184.216.34", "127.0.0.1"])).rejects.toMatchObject({ reason: "blocked" });
    await expect(attempt("https://evil.example.com/a.jpg", async () => [])).rejects.toMatchObject({ reason: "blocked" });
    await expect(attempt("not a url")).rejects.toMatchObject({ reason: "bad_url" });
  });

  it("re-checks every redirect hop, and gives up after a few", async () => {
    let n = 0;
    const toPrivate = (async () =>
      new Response(null, { status: 302, headers: { location: n++ === 0 ? "https://cdn.example.com/b.jpg" : "http://127.0.0.1/admin" } })) as unknown as typeof fetch;
    await expect(fetchImageAsDataUrl("https://cdn.example.com/a.jpg", { fetchImpl: toPrivate, resolve: publicResolve })).rejects.toMatchObject({ reason: "blocked" });
    const loop = (async () => new Response(null, { status: 302, headers: { location: "https://cdn.example.com/a.jpg" } })) as unknown as typeof fetch;
    await expect(fetchImageAsDataUrl("https://cdn.example.com/a.jpg", { fetchImpl: loop, resolve: publicResolve })).rejects.toBeInstanceOf(ImageFetchError);
  });

  it("refuses non-images, oversized bodies and failures", async () => {
    const html = (async () => new Response("<html>", { status: 200, headers: { "content-type": "image/jpeg" } })) as unknown as typeof fetch;
    await expect(fetchImageAsDataUrl("https://cdn.example.com/a.jpg", { fetchImpl: html, resolve: publicResolve })).rejects.toMatchObject({ reason: "not_image" });
    const big = (async () => new Response(new Uint8Array(5000), { status: 200 })) as unknown as typeof fetch;
    await expect(fetchImageAsDataUrl("https://cdn.example.com/a.jpg", { fetchImpl: big, resolve: publicResolve, maxBytes: 1000 })).rejects.toMatchObject({ reason: "too_big" });
    const fail = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    await expect(fetchImageAsDataUrl("https://cdn.example.com/a.jpg", { fetchImpl: fail, resolve: publicResolve })).rejects.toMatchObject({ reason: "failed" });
  });

  it("trusts the configured API host (a local mock) without the public-address check", async () => {
    const r = await fetchImageAsDataUrl("http://127.0.0.1:4010/results/x.jpg", { fetchImpl: okFetch, trustedHosts: ["127.0.0.1:4010"] });
    expect(r.type).toBe("image/jpeg");
  });
});

describe("LLM model selection", () => {
  it("picks by preference, skips non-chat models, and caps the list", () => {
    const live = ["whisper-large-v3", "llama-3.1-8b-instant", "llama-3.3-70b-versatile", "playai-tts", "openai/gpt-oss-20b", "meta-llama/llama-guard-4-12b", "openai/gpt-oss-120b"];
    expect(pickModels(live, PROVIDERS.groq.chat)).toEqual(["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "llama-3.1-8b-instant", "openai/gpt-oss-20b"]);
    expect(pickModels(live, PROVIDERS.groq.chat, 2)).toHaveLength(2);
    expect(pickModels(["whisper-large-v3"], PROVIDERS.groq.chat)).toEqual([]);
  });

  it("finds vision models separately", () => {
    const live = ["llama-3.3-70b-versatile", "meta-llama/llama-4-scout-17b-16e-instruct"];
    expect(pickModels(live, PROVIDERS.groq.vision)).toEqual(["meta-llama/llama-4-scout-17b-16e-instruct"]);
  });

  it("ships a preset for every provider the docs mention", () => {
    for (const id of ["groq", "xai", "gemini", "openrouter", "custom"] as const) expect(PROVIDERS[id].id).toBe(id);
    expect(PROVIDERS.groq.baseUrl).toBe("https://api.groq.com/openai/v1");
    expect(PROVIDERS.xai.baseUrl).toBe("https://api.x.ai/v1");
  });
});
