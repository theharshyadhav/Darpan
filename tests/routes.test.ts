import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMock, type MockYouCam } from "../scripts/mock-youcam.mjs";
import { buildDeps, setDepsForTests, type Deps } from "@/server/deps";
import { loadConfig } from "@/server/config";
import { MemoryKV } from "@/server/kv";
import { GET as statusGET } from "@/app/api/status/route";
import { POST as chatPOST } from "@/app/api/mirror/chat/route";
import { POST as productPOST } from "@/app/api/mirror/look/route";
import { GET as scanGET, POST as scanPOST } from "@/app/api/skin/scan/route";
import { GET as previewGET, POST as previewPOST } from "@/app/api/look/preview/route";
import { CONCERN_KEYS } from "@/lib/concerns";
import { makeJpeg } from "./helpers";

const HOST = "darpan.test";
const PHOTO = makeJpeg(720, 960, 3000);

let mock: MockYouCam;
let origin = "";

beforeAll(async () => {
  mock = createMock({ apiKey: "mock-key" });
  origin = (await mock.listen(0)).origin;
});
afterAll(async () => {
  await mock.close();
});

/** Routes the app's outgoing calls: YouCam to the mock, the LLM to a scripted fake. */
function installDeps(env: Record<string, string> = {}, llm?: (url: string, body: Record<string, unknown> | undefined) => Response) {
  const cfg = loadConfig({
    YOUCAM_API_KEY: "mock-key",
    YOUCAM_BASE_URL: origin,
    DARPAN_ALLOW_HTTP_UPSTREAM: "1",
    GROQ_API_KEY: "g",
    DARPAN_SCAN_COOLDOWN_SEC: "0",
    ...env,
  });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://api.groq.com")) {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      if (url.endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "llama-3.3-70b-versatile" }, { id: "meta-llama/llama-4-scout-17b-16e-instruct" }] }), { status: 200 });
      return llm ? llm(url, body) : new Response(JSON.stringify({ choices: [{ message: { content: '{"actions":[{"type":"start_scan"}]}' } }] }), { status: 200 });
    }
    return fetch(input, init);
  }) as typeof fetch;
  const d: Deps = buildDeps(cfg, { fetchImpl, kv: new MemoryKV() });
  setDepsForTests(d);
  return d;
}

beforeEach(() => {
  mock.reset();
  mock.setOptions({ apiKey: "mock-key", runningPolls: 1, skinVersions: ["v2.1", "v2.0"], toneShape: "map", skinShape: "output" });
});
afterEach(() => setDepsForTests(null));

function post(path: string, body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request(`https://${HOST}${path}`, {
    method: "POST",
    body,
    headers: { host: HOST, origin: `https://${HOST}`, "x-forwarded-for": "7.7.7.7", ...headers },
  });
}
function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://${HOST}${path}`, { headers: { host: HOST, "x-forwarded-for": "7.7.7.7", ...headers } });
}
const asJson = async (r: Response) => (await r.json()) as Record<string, unknown>;

describe("GET /api/status", () => {
  it("reports what this deployment can do, with no secrets", async () => {
    installDeps();
    const body = await asJson(statusGET());
    expect(body).toMatchObject({ app: "darpan", skin: "live", look: "live", llm: "live", llmProvider: "Groq" });
    expect(JSON.stringify(body)).not.toMatch(/mock-key|"g"|api[_-]?key/i);
  });

  it("says Demo Mode when nothing is configured", async () => {
    setDepsForTests(buildDeps(loadConfig({}), { kv: new MemoryKV() }));
    expect(await asJson(statusGET())).toMatchObject({ skin: "demo", look: "demo", llm: "off" });
  });
});

describe("POST /api/mirror/chat", () => {
  const chat = (body: unknown, headers: Record<string, string> = {}) => post("/api/mirror/chat", JSON.stringify(body), headers);

  it("plans actions from speech", async () => {
    installDeps();
    const res = await chatPOST(chat({ mode: "plan", lang: "en", utterance: "scan my skin" }));
    expect(res.status).toBe(200);
    expect(await asJson(res)).toMatchObject({ ok: true, actions: [{ type: "start_scan" }], source: "llm" });
  });

  it("refuses other websites", async () => {
    installDeps();
    const res = await chatPOST(chat({ mode: "plan", lang: "en", utterance: "hi" }, { origin: "https://evil.example.net" }));
    expect(res.status).toBe(403);
  });

  it("rejects malformed requests without calling the model", async () => {
    installDeps();
    for (const bad of [{ mode: "plan" }, { mode: "plan", lang: "fr", utterance: "x" }, { mode: "plan", lang: "en", utterance: "x".repeat(500) }, "nope"]) {
      const res = await chatPOST(chat(bad));
      expect(res.status).toBe(400);
    }
  });

  it("says the model is off when there is no key, so the app uses its built-in rules", async () => {
    installDeps({ GROQ_API_KEY: "", LLM_PROVIDER: "off" });
    expect(await asJson(await chatPOST(chat({ mode: "plan", lang: "en", utterance: "hi" })))).toEqual({ ok: false, error: "llm_off" });
  });

  it("rate-limits a visitor, with Retry-After", async () => {
    installDeps({ DARPAN_CHAT_PER_MIN: "3" });
    const statuses: number[] = [];
    let last: Response | null = null;
    for (let i = 0; i < 5; i += 1) {
      last = await chatPOST(chat({ mode: "plan", lang: "en", utterance: "hello" }));
      statuses.push(last.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("narrates facts and never returns unsafe words", async () => {
    installDeps({}, () => new Response(JSON.stringify({ choices: [{ message: { content: '{"say":"This cures acne."}' } }] }), { status: 200 }));
    const res = await chatPOST(chat({ mode: "narrate", lang: "en", facts: ["Retinol is on."] }));
    expect(await asJson(res)).toEqual({ ok: false, error: "llm_failed" });
  });
});

describe("POST /api/mirror/look (product reading)", () => {
  const frame = (headers: Record<string, string> = {}) => post("/api/mirror/look", PHOTO.slice(), { "content-type": "image/jpeg", ...headers });

  it("needs the person's consent, stated by the browser", async () => {
    installDeps();
    const res = await productPOST(frame());
    expect(res.status).toBe(403);
    expect(await asJson(res)).toEqual({ ok: false, error: "consent" });
  });

  it("reads a label with consent", async () => {
    installDeps({}, () => new Response(JSON.stringify({ choices: [{ message: { content: '{"found":true,"name":"CeraVe Foaming Cleanser","category":"cleanser","confidence":"high"}' } }] }), { status: 200 }));
    const res = await productPOST(frame({ "x-darpan-consent": "look" }));
    expect(await asJson(res)).toMatchObject({ ok: true, found: true, name: "CeraVe Foaming Cleanser", category: "cleanser" });
  });

  it("rejects things that are not photos", async () => {
    installDeps();
    const res = await productPOST(post("/api/mirror/look", new TextEncoder().encode("not an image at all, just text text text"), { "x-darpan-consent": "look" }));
    expect(res.status).toBe(400);
  });

  it("is limited to a handful of frames a minute", async () => {
    installDeps({ DARPAN_VISION_PER_MIN: "2" });
    const codes: number[] = [];
    for (let i = 0; i < 3; i += 1) codes.push((await productPOST(frame({ "x-darpan-consent": "look" }))).status);
    expect(codes).toEqual([200, 200, 429]);
  });
});

describe("/api/skin/scan", () => {
  it("runs a scan from photo to scores over the HTTP routes", async () => {
    installDeps();
    const start = await scanPOST(post("/api/skin/scan?seed=abc&n=0", PHOTO.slice(), { "content-type": "image/jpeg" }));
    expect(start.status).toBe(200);
    const started = (await asJson(start)) as { ok: boolean; mode: string; ticket: string };
    expect(started).toMatchObject({ ok: true, mode: "live" });

    let done: Record<string, unknown> = {};
    for (let i = 0; i < 6; i += 1) {
      done = await asJson(await scanGET(get(`/api/skin/scan?ticket=${encodeURIComponent(started.ticket)}`)));
      if (done.status === "success") break;
    }
    expect(done).toMatchObject({ ok: true, status: "success", mode: "live" });
    expect(Object.keys(done.scores as object).sort()).toEqual([...CONCERN_KEYS].sort());
  });

  it("answers an empty POST with labelled sample scores when the server has no YouCam key", async () => {
    setDepsForTests(buildDeps(loadConfig({}), { kv: new MemoryKV() }));
    const res = await scanPOST(post("/api/skin/scan?seed=abc&n=1", null));
    expect(await asJson(res)).toMatchObject({ ok: true, mode: "demo", reason: "no_key" });
  });

  it("sanitises the demo seed and count", async () => {
    setDepsForTests(buildDeps(loadConfig({}), { kv: new MemoryKV() }));
    const a = await asJson(await scanPOST(post("/api/skin/scan?seed=../../x&n=-5", null)));
    const b = await asJson(await scanPOST(post("/api/skin/scan?seed=guest&n=0", null)));
    expect(a.scores).toEqual(b.scores);
  });

  it("blocks cross-site calls and bad tickets", async () => {
    installDeps();
    expect((await scanPOST(post("/api/skin/scan", PHOTO.slice(), { origin: "https://evil.example.net" }))).status).toBe(403);
    expect((await scanGET(get("/api/skin/scan"))).status).toBe(400);
    expect((await scanGET(get("/api/skin/scan?ticket=forged.ticket"))).status).toBe(400);
  });

  it("spaces real scans apart per visitor", async () => {
    installDeps({ DARPAN_SCAN_COOLDOWN_SEC: "30" });
    const first = await scanPOST(post("/api/skin/scan", PHOTO.slice()));
    expect(first.status).toBe(200);
    const second = await scanPOST(post("/api/skin/scan", PHOTO.slice()));
    expect(second.status).toBe(429);
    expect(Number(second.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(mock.stats.uploads).toBe(1);
  });

  it("refuses oversized photos before reading them", async () => {
    installDeps({ DARPAN_MAX_IMAGE_BYTES: "100000" });
    const res = await scanPOST(post("/api/skin/scan", new Uint8Array(150_000)));
    expect(res.status).toBe(413);
    expect(mock.stats.uploads).toBe(0);
  });

  it("never caches", async () => {
    installDeps();
    const res = await scanPOST(post("/api/skin/scan?seed=a&n=0", PHOTO.slice()));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("/api/look/preview", () => {
  it("runs a makeup preview from photo to image", async () => {
    installDeps();
    const start = await previewPOST(post("/api/look/preview?look=midnight_kohl", PHOTO.slice(), { "content-type": "image/jpeg" }));
    const started = (await asJson(start)) as { ok: boolean; mode: string; ticket: string };
    expect(started).toMatchObject({ ok: true, mode: "live" });
    let done: Record<string, unknown> = {};
    for (let i = 0; i < 6; i += 1) {
      done = await asJson(await previewGET(get(`/api/look/preview?ticket=${encodeURIComponent(started.ticket)}`)));
      if (done.status === "success") break;
    }
    expect(done).toMatchObject({ ok: true, status: "success" });
    expect(String(done.image)).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("only knows the looks we ship", async () => {
    installDeps();
    const res = await previewPOST(post("/api/look/preview?look=hacked", PHOTO.slice()));
    expect(res.status).toBe(400);
    expect(mock.stats.uploads).toBe(0);
  });

  it("shows the recipe only (demo) when there is no YouCam key", async () => {
    setDepsForTests(buildDeps(loadConfig({}), { kv: new MemoryKV() }));
    const res = await previewPOST(post("/api/look/preview?look=rani_rose", null));
    expect(await asJson(res)).toEqual({ ok: true, mode: "demo", reason: "no_key" });
  });
});
