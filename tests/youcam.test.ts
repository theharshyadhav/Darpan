import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMock, type MockYouCam } from "../scripts/mock-youcam.mjs";
import { buildDeps, type Deps } from "@/server/deps";
import { loadConfig } from "@/server/config";
import { MemoryKV } from "@/server/kv";
import { YouCamClient } from "@/server/youcam/client";
import { UpstreamError, errorFromStatus, kindFromCode } from "@/server/youcam/errors";
import { parseResultUrl, parseSkinHex, parseSkinResult } from "@/server/youcam/parse";
import { pollScan, startScan } from "@/server/services/scan";
import { pollLook, startLook } from "@/server/services/look";
import { signTicket } from "@/server/ticket";
import { CONCERN_KEYS } from "@/lib/concerns";
import { LOOKS, validateEffects } from "@/lib/looks";
import { makeJpeg, makePng } from "./helpers";

describe("parseSkinResult", () => {
  it("reads the documented shape: data.results.output[] with ui_score", () => {
    const r = parseSkinResult({
      results: {
        output: [
          { type: "moisture", ui_score: 71.6, raw_score: 0.2, mask_urls: ["x"] },
          { type: "oiliness", ui_score: 64 },
          { type: "acne", ui_score: 101 },
          { type: "skin_type", ui_score: 5 },
        ],
      },
    });
    expect(r.scores).toEqual({ moisture: 72, oiliness: 64, acne: 100 });
    expect(r.missing).toEqual(["redness", "radiance", "texture", "pore"]);
  });

  it("reads HD names, keyed objects (score_info.json) and nested scores", () => {
    expect(parseSkinResult({ results: { output: [{ type: "hd_pore", ui_score: 55 }] } }).scores).toEqual({ pore: 55 });
    expect(parseSkinResult({ results: { redness: { ui_score: 80, raw_score: 3 }, texture: { ui_score: 61 } } }).scores).toEqual({
      redness: 80,
      texture: 61,
    });
    expect(parseSkinResult({ results: { output: [{ name: "radiance", score: { ui_score: 66 } }] } }).scores).toEqual({ radiance: 66 });
  });

  it("never uses raw_score, and ignores anything it does not understand", () => {
    expect(parseSkinResult({ results: { output: [{ type: "moisture", raw_score: 90 }] } }).scores).toEqual({});
    expect(parseSkinResult({ results: { output: [{ type: "wrinkle", ui_score: 50 }] } }).scores).toEqual({});
    expect(parseSkinResult(null).scores).toEqual({});
    expect(parseSkinResult("junk").scores).toEqual({});
    expect(parseSkinResult({ results: { output: "nope" } }).scores).toEqual({});
  });
});

describe("parseSkinHex", () => {
  it("finds the skin colour in a map, a list, and nested shapes, never eye, lip or hair", () => {
    expect(parseSkinHex({ results: { skin: { hex: "#C68642", name: "Tan" }, eye: { hex: "#112233" } } })).toBe("#c68642");
    expect(parseSkinHex({ results: { output: [{ type: "eye", color: "#112233" }, { type: "skin", color: "#aabbcc" }] } })).toBe("#aabbcc");
    expect(parseSkinHex({ results: { skin_color: { color: { hex: "d2b48c" } }, lip: "#ff0000" } })).toBe("#d2b48c");
    expect(parseSkinHex({ results: { eye: { hex: "#112233" }, lip: { hex: "#ff0000" }, hair: { hex: "#000000" } } })).toBeUndefined();
    expect(parseSkinHex({ results: { skin: { hex: "not-a-colour" } } })).toBeUndefined();
    expect(parseSkinHex(undefined)).toBeUndefined();
  });
});

describe("parseResultUrl", () => {
  it("reads data.results.url and the nearest equivalents", () => {
    expect(parseResultUrl({ results: { url: "https://cdn.example.com/a.jpg" } })).toBe("https://cdn.example.com/a.jpg");
    expect(parseResultUrl({ results: [{ download_url: "https://cdn.example.com/b.jpg" }] })).toBe("https://cdn.example.com/b.jpg");
    expect(parseResultUrl({ results: { output: [{ url: "https://cdn.example.com/c.jpg" }] } })).toBe("https://cdn.example.com/c.jpg");
    expect(parseResultUrl({ results: ["https://cdn.example.com/d.jpg"] })).toBe("https://cdn.example.com/d.jpg");
  });

  it("returns nothing for a non-http value or a missing result", () => {
    expect(parseResultUrl({ results: { url: "javascript:alert(1)" } })).toBeUndefined();
    expect(parseResultUrl({ results: {} })).toBeUndefined();
    expect(parseResultUrl(null)).toBeUndefined();
  });
});

describe("error mapping", () => {
  it("maps YouCam's documented codes to things the mirror can say", () => {
    expect(kindFromCode("error_no_face").kind).toBe("no_face");
    expect(kindFromCode("error_multiple_people").kind).toBe("multi_face");
    expect(kindFromCode("error_large_face_angle").kind).toBe("angle");
    expect(kindFromCode("error_pose").kind).toBe("angle");
    expect(kindFromCode("exceed_max_filesize").kind).toBe("big_image");
    expect(kindFromCode("unknown_internal_error").kind).toBe("unavailable");
    expect(kindFromCode("something_new").kind).toBe("generic");
  });

  it("understands undocumented codes by what they say, and spots billing problems", () => {
    expect(kindFromCode("error_face_too_small").kind).toBe("face_small");
    expect(kindFromCode("error_face_out_of_bounds").kind).toBe("face_bounds");
    expect(kindFromCode("error_image_too_dark").kind).toBe("dark");
    expect(kindFromCode("error_resolution_too_low").kind).toBe("small_image");
    expect(kindFromCode("insufficient_credit")).toEqual({ kind: "unavailable", spendBlocked: true });
    expect(kindFromCode(undefined, "your account has no credit left").spendBlocked).toBe(true);
  });

  it("maps HTTP statuses", () => {
    expect(errorFromStatus(401).spendBlocked).toBe(true);
    expect(errorFromStatus(402).spendBlocked).toBe(true);
    expect(errorFromStatus(413).kind).toBe("big_image");
    expect(errorFromStatus(429)).toMatchObject({ kind: "busy", retryAfterSec: 10 });
    expect(errorFromStatus(429, undefined, undefined, 30).retryAfterSec).toBe(30);
    expect(errorFromStatus(503).kind).toBe("unavailable");
    expect(errorFromStatus(400, "error_no_face").kind).toBe("no_face");
  });
});

// ---------------------------------------------------------------------------------------------
// Against the local YouCam mock
// ---------------------------------------------------------------------------------------------

let mock: MockYouCam;
let origin = "";
const PHOTO = makeJpeg(720, 960, 4000);

beforeAll(async () => {
  mock = createMock({ apiKey: "mock-key" });
  origin = (await mock.listen(0)).origin;
});
afterAll(async () => {
  await mock.close();
});

function depsFor(env: Record<string, string> = {}, now: () => number = Date.now): Deps {
  const cfg = loadConfig({
    YOUCAM_API_KEY: "mock-key",
    YOUCAM_BASE_URL: origin,
    DARPAN_ALLOW_HTTP_UPSTREAM: "1",
    ...env,
  });
  return buildDeps(cfg, { kv: new MemoryKV(now), now });
}

beforeEach(() => {
  mock.reset();
  mock.setOptions({ apiKey: "mock-key", runningPolls: 1, skinVersions: ["v2.1", "v2.0"], toneShape: "map", skinShape: "output", credits: 500 });
});

describe("YouCamClient against the mock", () => {
  it("uploads, creates a task and polls it to success", async () => {
    const y = new YouCamClient(loadConfig({ YOUCAM_API_KEY: "mock-key", YOUCAM_BASE_URL: origin, DARPAN_ALLOW_HTTP_UPSTREAM: "1" }).youcam);
    const fileId = await y.upload(PHOTO, "image/jpeg", "a.jpg");
    expect(fileId.length).toBeGreaterThan(10);
    const id = await y.createTask("skin-analysis", "v2.1", { src_file_id: fileId, dst_actions: ["moisture", "pore"], format: "json" });
    expect((await y.getTask("skin-analysis", "v2.1", id)).status).toBe("running");
    const done = await y.getTask("skin-analysis", "v2.1", id);
    expect(done.status).toBe("success");
    expect(parseSkinResult(done.data, ["moisture", "pore"]).scores.moisture).toBeGreaterThan(0);
  });

  it("reads the credit balance and the paged feature-cost table", async () => {
    const y = new YouCamClient(loadConfig({ YOUCAM_API_KEY: "mock-key", YOUCAM_BASE_URL: origin, DARPAN_ALLOW_HTTP_UPSTREAM: "1" }).youcam);
    expect(await y.credits()).toBe(500);
    const costs = await y.featureCosts();
    expect(costs.map((c) => c.feature)).toEqual(["skin-analysis", "skin-tone-analysis", "makeup-vto"]);
    expect(costs[0]).toMatchObject({ amount: 12 });
  });

  it("treats a rejected key as a spend-blocking error", async () => {
    const y = new YouCamClient(loadConfig({ YOUCAM_API_KEY: "wrong-key", YOUCAM_BASE_URL: origin, DARPAN_ALLOW_HTTP_UPSTREAM: "1" }).youcam);
    await expect(y.upload(PHOTO, "image/jpeg", "a.jpg")).rejects.toMatchObject({ spendBlocked: true, status: 401 });
  });

  it("reports an unreachable service as a network error", async () => {
    const y = new YouCamClient(loadConfig({ YOUCAM_API_KEY: "k", YOUCAM_BASE_URL: "http://127.0.0.1:9", DARPAN_ALLOW_HTTP_UPSTREAM: "1" }).youcam);
    await expect(y.credits()).rejects.toMatchObject({ kind: "network" });
  });

  it("turns a failed task into a typed error", async () => {
    const y = new YouCamClient(loadConfig({ YOUCAM_API_KEY: "mock-key", YOUCAM_BASE_URL: origin, DARPAN_ALLOW_HTTP_UPSTREAM: "1" }).youcam);
    const fileId = await y.upload(PHOTO, "image/jpeg", "a.jpg");
    mock.failNext({ at: "task", feature: "skin-analysis", code: "error_no_face" });
    const id = await y.createTask("skin-analysis", "v2.1", { src_file_id: fileId, dst_actions: ["moisture"], format: "json" });
    const t = await y.getTask("skin-analysis", "v2.1", id);
    expect(t.status).toBe("error");
    expect(YouCamClient.taskError(t)).toMatchObject({ kind: "no_face" });
  });
});

async function finishScan(d: Deps, ticket: string, maxPolls = 8) {
  for (let i = 0; i < maxPolls; i += 1) {
    const r = await pollScan(d, ticket);
    if (!(r.body.ok && r.body.status === "running")) return r;
  }
  throw new Error("scan never finished");
}

describe("scan service (live, against the mock)", () => {
  it("runs a whole scan: upload, skin + tone tasks, polling, seven scores and an ITA", async () => {
    const d = depsFor();
    const start = await startScan(d, { ip: "1.1.1.1", bytes: PHOTO, seed: "s", n: 0 });
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ ok: true, mode: "live" });
    if (!start.body.ok || start.body.mode !== "live") throw new Error("expected a live start");

    const done = await finishScan(d, start.body.ticket);
    expect(done.status).toBe(200);
    if (!done.body.ok || done.body.status !== "success") throw new Error(JSON.stringify(done.body));
    expect(Object.keys(done.body.scores).sort()).toEqual([...CONCERN_KEYS].sort());
    for (const v of Object.values(done.body.scores)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(typeof done.body.ita).toBe("number");
    // the colour itself is never returned
    expect(JSON.stringify(done.body)).not.toMatch(/#c68642/i);

    expect(mock.stats.uploads).toBe(1);
    expect(mock.stats.creates).toEqual({ "skin-analysis": 1, "skin-tone-analysis": 1 });
    // SD only, JSON format, exactly the seven concerns
    expect(mock.stats.lastBody["skin-analysis"]).toMatchObject({ format: "json", dst_actions: [...CONCERN_KEYS] });
  });

  it("keeps the same photo giving the same numbers", async () => {
    const run = async () => {
      const d = depsFor();
      const s = await startScan(d, { ip: "1.1.1.1", bytes: PHOTO, seed: "s", n: 0 });
      if (!s.body.ok || s.body.mode !== "live") throw new Error("not live");
      const r = await finishScan(d, s.body.ticket);
      return r.body.ok && r.body.status === "success" ? r.body.scores : null;
    };
    expect(await run()).toEqual(await run());
  });

  it("can skip the optional skin-tone analysis", async () => {
    const d = depsFor({ YOUCAM_TONE: "0" });
    const s = await startScan(d, { ip: "1.1.1.1", bytes: PHOTO, seed: "s", n: 0 });
    if (!s.body.ok || s.body.mode !== "live") throw new Error("not live");
    const r = await finishScan(d, s.body.ticket);
    expect(r.body.ok && r.body.status === "success" && r.body.ita).toBeFalsy();
    expect(mock.stats.creates["skin-tone-analysis"]).toBeUndefined();
  });

  it("still succeeds when the skin-tone task cannot be created, and gives its units back", async () => {
    const d = depsFor({ DARPAN_IP_DAILY_UNITS: "20", DARPAN_DAILY_UNITS: "100" });
    mock.failNext({ at: "create", feature: "skin-tone-analysis", status: 400, code: "invalid_parameter" });
    const s = await startScan(d, { ip: "9.9.9.9", bytes: PHOTO, seed: "s", n: 0 });
    if (!s.body.ok || s.body.mode !== "live") throw new Error("not live");
    const r = await finishScan(d, s.body.ticket);
    expect(r.body).toMatchObject({ ok: true, status: "success" });
    expect(r.body.ok && r.body.status === "success" && r.body.ita).toBeUndefined();
    // 12 (skin) was spent and 3 (tone) refunded: 8 units still fit in a 20-unit allowance, 9 do not
    expect((await d.budget.reserve("9.9.9.9", 8)).ok).toBe(true);
    expect((await d.budget.reserve("9.9.9.9", 1)).ok).toBe(false);
  });

  it("falls back to the older skin API version when the newer one is unknown", async () => {
    mock.setOptions({ skinVersions: ["v2.0"] });
    const d = depsFor();
    const s = await startScan(d, { ip: "1.1.1.1", bytes: PHOTO, seed: "s", n: 0 });
    if (!s.body.ok || s.body.mode !== "live") throw new Error("not live");
    const r = await finishScan(d, s.body.ticket);
    expect(r.body).toMatchObject({ ok: true, status: "success" });
  });

  it("understands the score_info.json style result as well", async () => {
    mock.setOptions({ skinShape: "map" });
    const d = depsFor();
    const s = await startScan(d, { ip: "1.1.1.1", bytes: PHOTO, seed: "s", n: 0 });
    if (!s.body.ok || s.body.mode !== "live") throw new Error("not live");
    const r = await finishScan(d, s.body.ticket);
    expect(r.body).toMatchObject({ ok: true, status: "success" });
  });

  it("refuses to invent numbers when the result cannot be read", async () => {
    mock.setOptions({ skinShape: "weird" });
    const d = depsFor();
    const s = await startScan(d, { ip: "1.1.1.1", bytes: PHOTO, seed: "s", n: 0 });
    if (!s.body.ok || s.body.mode !== "live") throw new Error("not live");
    const r = await finishScan(d, s.body.ticket);
    expect(r.body).toEqual({ ok: false, error: "generic" });
  });

  it("reports what went wrong with the face, in words the mirror has", async () => {
    const d = depsFor();
    mock.failNext({ at: "task", feature: "skin-analysis", code: "error_large_face_angle" });
    const s = await startScan(d, { ip: "1.1.1.1", bytes: PHOTO, seed: "s", n: 0 });
    if (!s.body.ok || s.body.mode !== "live") throw new Error("not live");
    const r = await finishScan(d, s.body.ticket);
    expect(r.body).toEqual({ ok: false, error: "angle" });
  });

  it("rejects bad photos before spending anything", async () => {
    const d = depsFor();
    expect((await startScan(d, { ip: "1.1.1.1", bytes: makePng(300, 400, 2000), seed: "s", n: 0 })).body).toEqual({ ok: false, error: "small_image" });
    expect((await startScan(d, { ip: "1.1.1.1", bytes: makeJpeg(4000, 5000, 2000), seed: "s", n: 0 })).body).toEqual({ ok: false, error: "big_image" });
    expect((await startScan(d, { ip: "1.1.1.1", bytes: new TextEncoder().encode("hello hello hello hello hello hello"), seed: "s", n: 0 })).body).toEqual({ ok: false, error: "generic" });
    expect((await startScan(d, { ip: "1.1.1.1", bytes: null, seed: "s", n: 0 })).status).toBe(400);
    expect(mock.stats.uploads).toBe(0);
  });

  it("falls back to labelled sample scores with no key, with Demo Mode forced, and when the budget is spent", async () => {
    const noKey = buildDeps(loadConfig({}), { kv: new MemoryKV() });
    const a = await startScan(noKey, { ip: "1.1.1.1", bytes: null, seed: "me", n: 0 });
    expect(a.body).toMatchObject({ ok: true, mode: "demo", reason: "no_key" });

    const forced = depsFor({ DARPAN_DEMO_ONLY: "1" });
    expect((await startScan(forced, { ip: "1.1.1.1", bytes: PHOTO, seed: "me", n: 0 })).body).toMatchObject({ mode: "demo", reason: "forced" });

    const tight = depsFor({ DARPAN_IP_DAILY_UNITS: "10" });
    const c = await startScan(tight, { ip: "1.1.1.1", bytes: PHOTO, seed: "me", n: 0 });
    expect(c.body).toMatchObject({ ok: true, mode: "demo", reason: "budget" });
    expect(mock.stats.uploads).toBe(0);
    // demo numbers come from the seed, so a rescan lands near the first scan
    const again = await startScan(noKey, { ip: "1.1.1.1", bytes: null, seed: "me", n: 1 });
    if (!a.body.ok || a.body.mode !== "demo" || !again.body.ok || again.body.mode !== "demo") throw new Error("expected demo");
    for (const k of CONCERN_KEYS) expect(Math.abs((a.body.scores[k] ?? 0) - (again.body.scores[k] ?? 0))).toBeLessThanOrEqual(8);
  });

  it("switches to demo and stops spending when the key is rejected", async () => {
    const d = depsFor({ YOUCAM_API_KEY: "wrong-key" });
    const first = await startScan(d, { ip: "1.1.1.1", bytes: PHOTO, seed: "me", n: 0 });
    expect(first.body).toMatchObject({ ok: true, mode: "demo", reason: "budget" });
    const callsBefore = mock.stats.requests.length;
    const second = await startScan(d, { ip: "1.1.1.1", bytes: PHOTO, seed: "me", n: 1 });
    expect(second.body).toMatchObject({ mode: "demo", reason: "budget" });
    expect(mock.stats.requests.length).toBe(callsBefore); // the breaker kept us from even trying
  });

  it("times out a scan that never finishes", async () => {
    mock.setOptions({ runningPolls: 1000 });
    let t = 1_800_000_000_000;
    const d = depsFor({}, () => t);
    const s = await startScan(d, { ip: "1.1.1.1", bytes: PHOTO, seed: "s", n: 0 });
    if (!s.body.ok || s.body.mode !== "live") throw new Error("not live");
    expect((await pollScan(d, s.body.ticket)).body).toMatchObject({ ok: true, status: "running" });
    t += 80_000;
    expect((await pollScan(d, s.body.ticket)).body).toEqual({ ok: false, error: "busy" });
  });

  it("will not poll a ticket it did not issue, or one for something else", async () => {
    const d = depsFor();
    expect((await pollScan(d, "garbage")).status).toBe(400);
    const lookTicket = signTicket({ k: "look", a: "x", t: Date.now() }, d.secret);
    expect((await pollScan(d, lookTicket)).status).toBe(400);
    const foreign = signTicket({ k: "skin", a: "x", t: Date.now() }, "another-secret");
    expect((await pollScan(d, foreign)).status).toBe(400);
  });
});

describe("look service (live, against the mock)", () => {
  it("previews a look: sends only our own effects and returns the image as a data URL", async () => {
    const d = depsFor();
    const start = await startLook(d, { ip: "2.2.2.2", lookId: "rani_rose", bytes: PHOTO });
    if (!start.body.ok || start.body.mode !== "live") throw new Error(JSON.stringify(start.body));
    expect((await pollLook(d, start.body.ticket)).body).toMatchObject({ ok: true, status: "running" });
    const done = await pollLook(d, start.body.ticket);
    expect(done.body.ok && done.body.status === "success" && done.body.image.startsWith("data:image/jpeg;base64,")).toBe(true);

    const sent = mock.stats.lastBody["makeup-vto"] as { effects: Array<Record<string, unknown>> };
    expect(sent.effects).toEqual(LOOKS.rani_rose.effects);
    expect(validateEffects(sent.effects)).toEqual([]);
    expect(sent.effects.find((e) => e.category === "skin_smooth")).toMatchObject({ skinSmoothStrength: 0 });
  });

  it("only accepts looks we ship", async () => {
    const d = depsFor();
    expect((await startLook(d, { ip: "2.2.2.2", lookId: "evil", bytes: PHOTO })).body).toEqual({ ok: false, error: "bad_look" });
    expect((await startLook(d, { ip: "2.2.2.2", lookId: "../../x", bytes: PHOTO })).status).toBe(400);
    expect(mock.stats.uploads).toBe(0);
  });

  it("falls back to the recipe (demo) with no key or no budget", async () => {
    const noKey = buildDeps(loadConfig({}), { kv: new MemoryKV() });
    expect((await startLook(noKey, { ip: "2.2.2.2", lookId: "rani_rose", bytes: null })).body).toEqual({ ok: true, mode: "demo", reason: "no_key" });
    const tight = depsFor({ DARPAN_IP_DAILY_UNITS: "5" });
    expect((await startLook(tight, { ip: "2.2.2.2", lookId: "rani_rose", bytes: PHOTO })).body).toEqual({ ok: true, mode: "demo", reason: "budget" });
  });

  it("reports a failed preview in words the mirror has", async () => {
    const d = depsFor();
    mock.failNext({ at: "task", feature: "makeup-vto", code: "error_no_face" });
    const s = await startLook(d, { ip: "2.2.2.2", lookId: "marigold_glow", bytes: PHOTO });
    if (!s.body.ok || s.body.mode !== "live") throw new Error("not live");
    await pollLook(d, s.body.ticket);
    expect((await pollLook(d, s.body.ticket)).body).toEqual({ ok: false, error: "no_face" });
  });

  it("surfaces an API-side rejection of the effects without charging twice", async () => {
    const d = depsFor({ DARPAN_IP_DAILY_UNITS: "9" });
    mock.failNext({ at: "create", feature: "makeup-vto", status: 400, code: "invalid_parameter" });
    const r = await startLook(d, { ip: "2.2.2.2", lookId: "rani_rose", bytes: PHOTO });
    expect(r.body).toEqual({ ok: false, error: "generic" });
    // the units came back: a second preview still fits in the allowance
    expect((await startLook(d, { ip: "2.2.2.2", lookId: "rani_rose", bytes: PHOTO })).body).toMatchObject({ ok: true, mode: "live" });
  });
});

describe("UpstreamError", () => {
  it("is an Error with a kind", () => {
    const e = new UpstreamError("busy", "slow", { status: 429 });
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe("busy");
    expect(e.spendBlocked).toBe(false);
  });
});
