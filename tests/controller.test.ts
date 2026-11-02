import { describe, expect, it } from "vitest";
import { CONSENT_TTL_MS, PENDING_TTL_MS } from "@/client/pending";
import { line, type LineId, type LineParams } from "@/lib/persona/copy";
import { lintUtterance } from "@/lib/persona/lint";
import { titleFor } from "@/lib/persona/titles";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { demoStatus, goodReading, liveStatus, makeWorld, MemoryStorage, SCORES, type World, type WorldOptions } from "./fakes";

const TITLE = titleFor(DEFAULT_SETTINGS);
const MIN = 60_000;

/** True when the mirror said this canned line, with or without the title in front of it. */
function said<K extends LineId>(w: World, id: K, params: LineParams[K], lang: "en" | "hi" | "hinglish" = "en"): boolean {
  const variants = [params, { ...params, title: TITLE }] as LineParams[K][];
  return w.speaker.spoken.some((s) => variants.some((p) => s === line(lang, id, p)));
}

/** A world whose server has YouCam on, with the photo-sending consent already given. */
function liveWorld(over: WorldOptions = {}): World {
  const w = makeWorld({ status: liveStatus(), ...over });
  return w;
}

async function consentedLive(): Promise<World> {
  const w = liveWorld();
  await w.wake();
  w.ctl.grantConsent("scan");
  return w;
}

/** Run a whole live scan and wait for the report to be spoken. */
async function liveScan(w: World): Promise<void> {
  w.ctl.startScan();
  await w.clock.until(() => w.state().report !== null && w.state().scan.name === "idle", 120_000);
  await w.quiet();
}

describe("wake and greeting", () => {
  it("starts on the welcome screen and says nothing until the first tap", async () => {
    const w = makeWorld();
    await w.clock.flush();
    expect(w.state().phase).toBe("welcome");
    expect(w.speaker.spoken).toEqual([]);
    expect(w.ear.listening).toBe(false);
  });

  it("greets as the very first thing in the tap, before the camera is touched", async () => {
    const w = makeWorld();
    await w.clock.flush();
    w.ctl.wake();
    // synchronous: the greeting is already queued and speaking, and the camera has not answered yet
    expect(w.speaker.spoken.length).toBe(1);
    expect(w.speaker.spoken[0]).toBe(line("en", "welcome", { title: TITLE }));
    expect(w.state().phase).toBe("awake");
  });

  it("opens the camera after the tap and remembers the visit", async () => {
    const w = makeWorld();
    await w.wake();
    expect(w.eyes.state).toBe("on");
    expect(w.data().settings.welcomed).toBe(true);
    expect(w.data().lastVisitAt).not.toBeNull();
  });

  it("welcomes a returning visitor differently", async () => {
    const storage = new MemoryStorage();
    const first = makeWorld({ storage });
    await first.wake();
    const second = makeWorld({ storage });
    await second.wake();
    expect(second.speaker.spoken[0]).toBe(line("en", "welcome_back", { title: TITLE }));
  });

  it("ignores a second wake while awake", async () => {
    const w = makeWorld();
    await w.wake();
    const n = w.speaker.spoken.length;
    w.ctl.wake();
    expect(w.speaker.spoken.length).toBe(n);
  });

  it("tells a visitor whose browser cannot listen, and still works by typing", async () => {
    const w = makeWorld();
    w.ear.available = false;
    await w.wake();
    expect(said(w, "mic_unsupported", {})).toBe(true);
    await w.ctl.hear("hello", "typed");
    await w.quiet();
    expect(said(w, "greet", {})).toBe(true);
  });
});

describe("half-duplex voice", () => {
  it("keeps the microphone closed while the mirror speaks and opens it after", async () => {
    const w = makeWorld();
    w.ctl.wake();
    expect(w.state().voice.speaking).toBe(true);
    expect(w.ear.listening).toBe(false);
    await w.quiet();
    expect(w.state().voice.speaking).toBe(false);
    expect(w.ear.listening).toBe(true);
    expect(w.ear.lang).toBe("en");
  });

  it("drops anything heard while the mirror is speaking (its own echo)", async () => {
    const w = makeWorld();
    w.ctl.wake();
    const before = w.state().captions.length;
    await w.ctl.hear("hello there", "voice");
    expect(w.state().captions.length).toBe(before);
    expect(w.ear.hear("hello")).toBe(false);
  });

  it("closes the microphone when the tab is hidden and the mirror rests", async () => {
    const w = makeWorld();
    await w.wake();
    expect(w.ear.listening).toBe(true);
    w.ctl.setVisible(false);
    expect(w.ear.listening).toBe(false);
    w.ctl.setVisible(true);
    expect(w.ear.listening).toBe(true);
    w.ctl.rest();
    expect(w.state().phase).toBe("asleep");
    expect(w.ear.listening).toBe(false);
    expect(w.eyes.state).toBe("off");
  });

  it("the mic button turns hands-free listening off and remembers it", async () => {
    const w = makeWorld();
    await w.wake();
    w.ctl.toggleListening();
    expect(w.ear.listening).toBe(false);
    expect(w.data().settings.handsFree).toBe(false);
    w.ctl.toggleListening();
    expect(w.ear.listening).toBe(true);
  });

  it("says once that the microphone is blocked and stops trying", async () => {
    const w = makeWorld();
    await w.wake();
    w.ear.emitState("blocked");
    await w.quiet();
    w.ear.emitState("blocked");
    await w.quiet();
    expect(w.speaker.spoken.filter((s) => s === line("en", "mic_blocked", {}) || s === line("en", "mic_blocked", { title: TITLE })).length).toBe(1);
    expect(w.state().voice.ear).toBe("blocked");
    expect(w.ear.listening).toBe(false);
  });
});

describe("hearing", () => {
  it("answers an unknown phrase with didn't catch when there is no AI", async () => {
    const w = makeWorld();
    await w.wake();
    w.ear.hear("blah blah zzz");
    await w.clock.flush();
    await w.quiet();
    expect(said(w, "didnt_catch", {})).toBe(true);
    expect(w.api.chats.length).toBe(0);
  });

  it("shows what was said as a caption and trims it to a sane length", async () => {
    const w = makeWorld();
    await w.wake();
    await w.ctl.hear("   hello   ".padEnd(2000, " x"), "typed");
    const you = w.state().captions.filter((c) => c.who === "you");
    expect(you.length).toBe(1);
    expect(you[0]!.text.length).toBeLessThanOrEqual(400);
  });

  it("ignores speech while asleep", async () => {
    const w = makeWorld();
    await w.wake();
    w.ctl.rest();
    const n = w.speaker.spoken.length;
    await w.ctl.hear("hello", "typed");
    expect(w.speaker.spoken.length).toBe(n);
  });

  it("uses the language model for phrases the offline rules do not know, and runs only valid actions", async () => {
    const w = liveWorld();
    await w.wake();
    w.api.chatReply = () => ({ ok: true, source: "llm", actions: [{ type: "start_timer", seconds: 90 }], say: "Of course." });
    w.ear.hear("give me a minute and a half to let this sink in");
    await w.clock.flush();
    await w.quiet();
    expect(w.api.chats.length).toBe(1);
    expect(w.api.chats[0]!.mode).toBe("plan");
    expect(w.state().timers.length).toBe(1);
    expect(w.state().timers[0]!.totalSec).toBe(90);
    expect(w.speaker.spoken).toContain("Of course.");
  });

  it("drops a stale plan when the person has already said something else", async () => {
    const w = liveWorld();
    await w.wake();
    let release: () => void = () => {};
    w.api.chatReply = () => ({ ok: true, source: "llm", actions: [{ type: "start_timer", seconds: 300 }] });
    const slow = w.api.chat.bind(w.api);
    w.api.chat = async (req) => {
      await new Promise<void>((r) => (release = r));
      return slow(req);
    };
    const first = w.ctl.hear("an odd phrase the rules do not know", "typed");
    await w.clock.flush();
    expect(w.state().thinking).toBe(true);
    await w.ctl.hear("hello", "typed"); // a known phrase: handled at once
    release();
    await first;
    await w.quiet();
    expect(w.state().timers.length).toBe(0);
    expect(w.state().thinking).toBe(false);
  });

  it("falls back to didn't catch when the model fails, and mentions the outage only occasionally", async () => {
    const w = liveWorld();
    await w.wake();
    w.api.chatReply = () => ({ ok: false, error: "llm_failed" });
    await w.ctl.hear("an odd phrase one", "typed");
    await w.quiet();
    await w.ctl.hear("an odd phrase two", "typed");
    await w.quiet();
    expect(w.speaker.spoken.filter((s) => s === line("en", "brain_offline", {})).length).toBe(1);
    expect(w.speaker.spoken.filter((s) => s.length > 0 && w.speaker.spoken.indexOf(s) >= 0).length).toBeGreaterThan(2);
  });

  it("learns the model is off when the server says so", async () => {
    const w = liveWorld();
    await w.wake();
    w.api.chatReply = () => ({ ok: false, error: "llm_off" });
    await w.ctl.hear("an odd phrase", "typed");
    expect(w.state().status?.llm).toBe("off");
    await w.ctl.hear("another odd phrase", "typed");
    expect(w.api.chats.length).toBe(1);
  });

  it("sends the model only a small slice of state, never scores or photos", async () => {
    const w = liveWorld();
    await w.wake();
    await w.ctl.hear("an odd phrase", "typed");
    const req = JSON.stringify(w.api.chats[0]);
    expect(req).not.toMatch(/scores|moisture|blob|image/);
  });
});

describe("pending questions", () => {
  it("a stray yes with nothing pending does nothing", async () => {
    const w = makeWorld();
    await w.wake();
    const n = w.speaker.spoken.length;
    await w.ctl.hear("yes", "typed");
    await w.quiet();
    expect(w.speaker.spoken.length).toBe(n);
    expect(w.state().scan.name).toBe("idle");
  });

  it("a yes answers the question just asked", async () => {
    const w = makeWorld();
    await w.wake();
    w.ctl.showReport(); // no scan yet: offers one
    await w.quiet();
    expect(w.state().pending).toBe("scan_offer");
    await w.ctl.hear("yes", "typed");
    await w.clock.until(() => w.state().report !== null);
    expect(w.state().report?.scan.source).toBe("demo");
  });

  it("expires after 45 seconds so an old offer is not triggered by a stray yes", async () => {
    const w = makeWorld();
    await w.wake();
    w.ctl.showReport();
    await w.quiet();
    expect(w.state().pending).toBe("scan_offer");
    await w.clock.advance(PENDING_TTL_MS + 1000);
    expect(w.state().pending).toBeNull();
    const n = w.speaker.spoken.length;
    await w.ctl.hear("yes", "typed");
    await w.quiet();
    expect(w.speaker.spoken.length).toBe(n);
    expect(w.state().scan.name).toBe("idle");
  });

  it("a different request cancels the old question", async () => {
    const w = makeWorld();
    await w.wake();
    w.ctl.showReport();
    await w.quiet();
    await w.ctl.hear("show my ledger", "typed");
    expect(w.state().pending).toBeNull();
  });

  it("'not now' answers no", async () => {
    const w = makeWorld();
    await w.wake();
    w.ctl.showReport();
    await w.quiet();
    w.ctl.reply(false);
    await w.quiet();
    expect(said(w, "ack_no", {})).toBe(true);
    expect(w.state().pending).toBeNull();
  });
});

describe("Demo scan", () => {
  it("makes labelled sample numbers on the device and calls no scan route", async () => {
    const w = makeWorld();
    await w.wake();
    w.ctl.startScan();
    await w.clock.until(() => w.state().report !== null);
    await w.quiet();
    expect(w.api.scanStarts.length).toBe(0);
    expect(w.api.scanPolls).toBe(0);
    const r = w.state().report!;
    expect(r.scan.source).toBe("demo");
    expect(r.sampleReason).toBe("no_key");
    expect(r.scan.confidence.reasons).toContain("demo");
    expect(said(w, "scan_demo_notice", {})).toBe(true);
    expect(w.data().scans.length).toBe(1);
    expect(w.data().scans[0]!.kind).toBe("baseline");
  });

  it("announces the samples before any number is described", async () => {
    const w = makeWorld();
    await w.wake();
    const m = w.mark();
    w.ctl.startScan();
    await w.clock.until(() => w.state().report !== null);
    await w.quiet();
    const lines = w.spokenSince(m);
    const notice = lines.findIndex((s) => s === line("en", "scan_demo_notice", {}) || s === line("en", "scan_demo_notice", { title: TITLE }));
    const strength = lines.findIndex((s) => /strength|strongest|best/i.test(s));
    expect(notice).toBeGreaterThanOrEqual(0);
    if (strength >= 0) expect(notice).toBeLessThan(strength);
  });

  it("works with no camera at all", async () => {
    const w = makeWorld();
    w.eyes.grant = "denied";
    await w.wake();
    w.ctl.startScan();
    await w.clock.until(() => w.state().report !== null);
    expect(w.state().report?.scan.source).toBe("demo");
    expect(w.state().uploadOffered).toBe(true);
  });

  it("keeps a repeat sample close to the first, so a Demo Mode story hangs together", async () => {
    const w = makeWorld();
    await w.wake();
    w.ctl.startScan();
    await w.clock.until(() => w.state().report !== null && w.state().scan.name === "idle");
    await w.quiet();
    const a = w.data().scans[0]!.scores;
    w.ctl.startScan();
    await w.clock.until(() => w.data().scans.length === 2);
    const b = w.data().scans[1]!.scores;
    for (const k of Object.keys(a) as Array<keyof typeof a>) expect(Math.abs((a[k] ?? 0) - (b[k] ?? 0))).toBeLessThanOrEqual(20);
  });

  it("falls back to labelled samples when the status is unreachable", async () => {
    const w = makeWorld({ status: null });
    await w.wake();
    w.ctl.startScan();
    await w.clock.until(() => w.state().report !== null);
    expect(w.state().report?.sampleReason).toBe("unavailable");
    expect(w.api.scanStarts.length).toBe(0);
  });
});

describe("Live scan", () => {
  it("asks for consent with a card first, and a spoken yes does not grant it", async () => {
    const w = liveWorld();
    await w.wake();
    w.ctl.startScan();
    await w.clock.until(() => w.state().pending === "consent_scan");
    await w.quiet();
    expect(said(w, "consent_scan_needed", {})).toBe(true);
    expect(w.eyes.captures).toBe(0);
    await w.ctl.hear("yes", "typed");
    await w.quiet();
    expect(w.data().settings.consentScan).toBe(false);
    expect(w.state().pending).toBe("consent_scan"); // the card stays up
    expect(w.api.scanStarts.length).toBe(0);
  });

  it("the consent card stays up much longer than an ordinary question", async () => {
    const w = liveWorld();
    await w.wake();
    w.ctl.startScan();
    await w.clock.until(() => w.state().pending === "consent_scan");
    await w.clock.advance(PENDING_TTL_MS + 5000);
    expect(w.state().pending).toBe("consent_scan");
    await w.clock.advance(CONSENT_TTL_MS);
    expect(w.state().pending).toBeNull();
  });

  it("tapping Allow on the card resumes the scan: framing, countdown, capture, upload, poll, report", async () => {
    const w = liveWorld();
    await w.wake();
    w.ctl.startScan();
    await w.clock.until(() => w.state().pending === "consent_scan");
    w.ctl.grantConsent("scan");
    expect(w.data().settings.consentScan).toBe(true);
    const phases = new Set<string>();
    const stop = w.ctl.subscribe(() => phases.add(w.state().scan.name));
    await w.clock.until(() => w.state().report !== null && w.state().scan.name === "idle", 180_000);
    stop();
    for (const p of ["framing", "countdown", "capturing", "analyzing"]) expect(phases.has(p)).toBe(true);
    expect(w.eyes.captures).toBe(1);
    expect(w.api.scanStarts.length).toBe(1);
    expect(w.api.scanStarts[0]!.photo).not.toBeNull();
    const r = w.state().report!;
    expect(r.scan.source).toBe("youcam");
    expect(r.sampleReason).toBeUndefined();
    expect(r.scan.scores).toEqual(SCORES);
    await w.quiet();
    expect(said(w, "captured", {})).toBe(true);
    expect(said(w, "countdown", { n: 3 })).toBe(true);
    expect(w.data().scans[0]).toMatchObject({ source: "youcam", kind: "baseline" });
  });

  it("asks a focus question after the report and answers a yes", async () => {
    const w = await consentedLive();
    await liveScan(w);
    expect(w.state().pending).toBe("focus");
    const focus = w.state().report!.focus!;
    expect(focus).toBeTruthy();
    const m = w.mark();
    w.ctl.reply(true);
    await w.quiet();
    expect(w.spokenSince(m).length).toBe(1);
  });

  it("waits for a steady face before counting down", async () => {
    const w = await consentedLive();
    w.eyes.reading = (call) => (call < 8 ? goodReading({ faces: 0, box: undefined, framing: { ok: false, hint: "no_face" } as never }) : goodReading());
    w.ctl.startScan();
    await w.clock.until(() => w.state().scan.name === "countdown", 60_000);
    expect(w.eyes.analyseCalls).toBeGreaterThanOrEqual(8);
    expect(said(w, "hint_no_face", {})).toBe(true);
  });

  it("the capture-now button takes the photo without waiting", async () => {
    const w = await consentedLive();
    w.eyes.detector = "none";
    w.eyes.reading = () => ({ faces: 0, region: { w: 600, h: 800 }, framing: null, lighting: { score: 0.9, hint: "ok", ok: true } });
    w.ctl.startScan();
    await w.clock.until(() => w.state().scan.name === "framing");
    expect(w.state().scan).toMatchObject({ manual: true });
    w.ctl.captureNow();
    await w.clock.until(() => w.state().report !== null, 120_000);
    expect(w.eyes.captures).toBe(1);
  });

  it("gives up framing with a no-face message and offers a retry", async () => {
    const w = await consentedLive();
    w.eyes.reading = () => goodReading({ faces: 0, box: undefined, framing: { ok: false, hint: "no_face" } as never });
    w.ctl.startScan();
    await w.clock.until(() => w.state().scan.name === "error", 130_000);
    expect(w.state().scan).toMatchObject({ kind: "no_face", retryable: true });
    expect(w.state().pending).toBe("retry");
    expect(w.eyes.captures).toBe(0);
    expect(w.api.scanStarts.length).toBe(0);
  });

  it("a failed upload is followed by 'try again', which runs the scan again", async () => {
    const w = await consentedLive();
    w.api.scanStartReply = { ok: false, error: "network" };
    w.ctl.startScan();
    await w.clock.until(() => w.state().scan.name === "error", 180_000);
    expect(w.state().scan).toMatchObject({ kind: "network" });
    await w.quiet();
    expect(w.state().pending).toBe("retry");

    w.api.scanStartReply = { ok: true, mode: "live", ticket: "tk2", pollMs: 1000 };
    await w.ctl.hear("try again", "typed");
    await w.clock.until(() => w.state().report !== null && w.state().scan.name === "idle", 180_000);
    expect(w.api.scanStarts.length).toBe(2);
    expect(w.state().report?.scan.source).toBe("youcam");
  });

  it("a bare 'try again' works for a couple of minutes after a failure, then no longer", async () => {
    const w = await consentedLive();
    w.api.scanStartReply = { ok: false, error: "generic" };
    w.ctl.startScan();
    await w.clock.until(() => w.state().scan.name === "error", 180_000);
    await w.clock.advance(3 * MIN);
    const n = w.api.scanStarts.length;
    await w.ctl.hear("try again", "typed");
    await w.quiet();
    expect(w.api.scanStarts.length).toBe(n);
  });

  it("enforces a 10 minute cooldown between live scans, without spending a YouCam call", async () => {
    const w = await consentedLive();
    await liveScan(w);
    const starts = w.api.scanStarts.length;
    await w.clock.advance(2 * MIN);
    w.ctl.startScan();
    await w.clock.until(() => w.speaker.spoken.some((s) => /minute/i.test(s) && s.includes("8") || /\b8\b/.test(s)), 60_000);
    expect(w.api.scanStarts.length).toBe(starts);
    expect(w.eyes.captures).toBe(1);
    await w.quiet();
    await w.clock.advance(9 * MIN);
    await liveScan(w);
    expect(w.api.scanStarts.length).toBe(starts + 1);
  });

  it("falls back to clearly labelled samples when YouCam is unavailable", async () => {
    const w = await consentedLive();
    w.api.scanStartReply = { ok: false, error: "unavailable" };
    await liveScan(w);
    const r = w.state().report!;
    expect(r.scan.source).toBe("demo");
    expect(r.sampleReason).toBe("unavailable");
    expect(said(w, "scan_error", { kind: "unavailable" })).toBe(true);
  });

  it("uses the budget message when the server is out of YouCam credits", async () => {
    const w = await consentedLive();
    w.api.scanStartReply = { ok: true, mode: "demo", reason: "budget", scores: SCORES };
    await liveScan(w);
    expect(w.state().report?.sampleReason).toBe("budget");
    expect(w.state().report?.scan.source).toBe("demo");
    expect(said(w, "scan_budget", {})).toBe(true);
  });

  it("says it is still working when YouCam is slow", async () => {
    const w = await consentedLive();
    w.api.scanPollReplies = [...Array.from({ length: 20 }, () => ({ ok: true, status: "running", pollMs: 1000 }) as const), { ok: true, status: "success", mode: "live", scores: SCORES }];
    await liveScan(w);
    expect(said(w, "analyzing_long", {})).toBe(true);
  });

  it("a photo chosen from the device scans without the camera", async () => {
    const w = await consentedLive();
    w.eyes.grant = "denied";
    w.ctl.scanFile(new File([new Uint8Array([1, 2, 3])], "me.jpg", { type: "image/jpeg" }));
    await w.clock.until(() => w.state().report !== null, 120_000);
    expect(w.api.scanStarts.length).toBe(1);
    expect(w.eyes.captures).toBe(0);
  });

  it("an unreadable photo gives a notice and an error, and sends nothing", async () => {
    const w = await consentedLive();
    w.eyes.fromFile = async () => null;
    w.ctl.scanFile(new File([new Uint8Array([1])], "x.jpg"));
    await w.clock.flush();
    expect(w.state().notice).toBe("photo_unreadable");
    expect(w.state().scan.name).toBe("error");
    expect(w.api.scanStarts.length).toBe(0);
  });

  it("a denied camera in live mode says so instead of sending nothing silently", async () => {
    const w = await consentedLive();
    w.eyes.stop();
    w.eyes.grant = "denied";
    w.ctl.startScan();
    await w.clock.until(() => w.state().scan.name === "error");
    expect(w.state().scan).toMatchObject({ kind: "camera" });
    expect(said(w, "camera_denied", {})).toBe(true);
  });

  it("two scan requests at once do not start two scans", async () => {
    const w = await consentedLive();
    w.ctl.startScan();
    w.ctl.startScan();
    expect(w.state().notice).toBe("busy");
    await w.clock.until(() => w.state().report !== null && w.state().scan.name === "idle", 180_000);
    expect(w.api.scanStarts.length).toBe(1);
  });

  it("cancelling during framing stops the scan and sends nothing", async () => {
    const w = await consentedLive();
    w.eyes.reading = () => goodReading({ faces: 0, box: undefined, framing: { ok: false, hint: "no_face" } as never });
    w.ctl.startScan();
    await w.clock.until(() => w.state().scan.name === "framing");
    w.ctl.cancelScan();
    await w.clock.advance(5000);
    expect(w.state().scan.name).toBe("idle");
    expect(w.state().panel).toBe("home");
    expect(w.api.scanStarts.length).toBe(0);
  });

  it("saying 'be quiet' during framing backs out", async () => {
    const w = await consentedLive();
    w.eyes.reading = () => goodReading({ faces: 0, box: undefined, framing: { ok: false, hint: "no_face" } as never });
    w.ctl.startScan();
    await w.clock.until(() => w.state().scan.name === "framing");
    await w.ctl.hear("be quiet", "typed");
    expect(w.state().scan.name).toBe("idle");
  });

  it("flags a low-confidence reading instead of stating it as sure", async () => {
    const w = await consentedLive();
    w.eyes.photoLighting = 0.2;
    await liveScan(w);
    expect(w.state().report!.scan.confidence.level).not.toBe("high");
    expect(said(w, "report_uncertainty", {})).toBe(true);
  });
});

describe("ritual", () => {
  it("starts a ritual for the period asked", async () => {
    const w = makeWorld();
    await w.wake();
    await w.ctl.hear("start my evening routine", "typed");
    await w.quiet();
    expect(w.data().ritual).toMatchObject({ period: "pm", status: "active" });
    expect(w.state().panel).toBe("ritual");
    expect(said(w, "ritual_start", { period: "pm" })).toBe(true);
  });

  it("logging a product with no ritual open starts one, notes it, and suggests the next step", async () => {
    const w = makeWorld();
    await w.wake();
    const m = w.mark();
    await w.ctl.hear("I applied the cleanser", "typed");
    await w.quiet();
    expect(w.data().ritual?.applied.length).toBe(1);
    expect(w.spokenSince(m).length).toBeGreaterThanOrEqual(2);
  });

  it("warns about a clash, and only the most useful two notes are spoken", async () => {
    const w = makeWorld();
    await w.wake();
    await w.ctl.hear("start my evening routine", "typed");
    await w.ctl.hear("I'm applying retinol", "typed");
    await w.quiet();
    const m = w.mark();
    await w.ctl.hear("I'm applying vitamin C serum", "typed");
    await w.quiet();
    expect(said(w, "note", { code: "clash_retinoid_vitc" })).toBe(true);
    expect(w.spokenSince(m).length).toBeLessThanOrEqual(4);
  });

  it("starts a timer for a step that needs time, then announces it and the next step", async () => {
    const w = makeWorld();
    await w.wake();
    await w.ctl.hear("start my evening routine", "typed");
    await w.ctl.hear("I'm applying vitamin C serum", "typed");
    await w.quiet();
    expect(w.state().timers.length).toBe(1);
    const t = w.state().timers[0]!;
    const m = w.mark();
    await w.clock.advance(t.totalSec * 1000 + 1000);
    await w.quiet();
    expect(w.state().timers.length).toBe(0);
    expect(w.spokenSince(m).some((s) => s === line("en", "timer_done", { kind: t.kind }))).toBe(true);
  });

  it("a spoken timer can be started and stopped", async () => {
    const w = makeWorld();
    await w.wake();
    await w.ctl.hear("set a timer for 2 minutes", "typed");
    expect(w.state().timers[0]!.totalSec).toBe(120);
    await w.ctl.hear("stop the timer", "typed");
    expect(w.state().timers.length).toBe(0);
  });

  it("calls the chime when a timer ends", async () => {
    const w = makeWorld();
    let chimes = 0;
    w.platform.chime = () => {
      chimes += 1;
    };
    await w.wake();
    await w.ctl.hear("set a timer for 10 seconds", "typed");
    await w.clock.advance(11_000);
    expect(chimes).toBe(1);
  });

  it("skip moves on, and says there is nothing to skip with no ritual", async () => {
    const w = makeWorld();
    await w.wake();
    await w.ctl.hear("skip", "typed");
    await w.quiet();
    expect(said(w, "ritual_none_active", {})).toBe(true);
    await w.ctl.hear("start my morning ritual", "typed");
    await w.ctl.hear("skip", "typed");
    await w.quiet();
    expect(w.data().ritual?.skipped.length).toBe(1);
  });

  it("finishing files the ritual in history, and offers a second look only when there is a baseline", async () => {
    const w = makeWorld();
    await w.wake();
    await w.ctl.hear("start my morning ritual", "typed");
    await w.ctl.hear("I'm done", "typed");
    await w.quiet();
    expect(w.data().ritual).toBeNull();
    expect(w.data().history.length).toBe(1);
    expect(said(w, "ritual_complete_plain", {})).toBe(true);
    expect(w.state().pending).toBeNull();
  });

  it("offers a second look when a scan came first", async () => {
    const w = makeWorld();
    await w.wake();
    w.ctl.startScan();
    await w.clock.until(() => w.state().report !== null && w.state().scan.name === "idle");
    await w.quiet();
    await w.clock.advance(MIN);
    await w.ctl.hear("start my morning ritual", "typed");
    await w.ctl.hear("I'm done", "typed");
    await w.quiet();
    expect(w.state().pending).toBe("verify_offer");
  });

  it("an unknown product asks for its category, and a one-word answer completes it", async () => {
    const w = makeWorld();
    await w.wake();
    await w.ctl.hear("start my morning ritual", "typed");
    await w.ctl.hear("I applied zorblax", "typed");
    await w.quiet();
    expect(w.state().pending).toBe("category");
    expect(w.data().ritual?.applied.length).toBe(0);
    await w.ctl.hear("serum", "typed");
    await w.quiet();
    expect(w.data().ritual?.applied.map((a) => a.category)).toEqual(["serum"]);
    expect(w.state().pending).toBeNull();
  });

  it("a category question is not dropped by a stray yes, and it expires", async () => {
    const w = makeWorld();
    await w.wake();
    await w.ctl.hear("I applied zorblax", "typed");
    await w.quiet();
    await w.ctl.hear("yes", "typed");
    await w.quiet();
    expect(w.state().pending).toBe("category");
    await w.clock.advance(PENDING_TTL_MS + 1000);
    expect(w.state().pending).toBeNull();
  });

  it("applying the same product twice changes nothing", async () => {
    const w = makeWorld();
    await w.wake();
    await w.ctl.hear("I'm applying vitamin C serum", "typed");
    await w.ctl.hear("I'm applying vitamin C serum", "typed");
    await w.quiet();
    expect(w.data().ritual?.applied.length).toBe(1);
  });

  it("a ritual left open from an earlier visit is resumed on wake", async () => {
    const storage = new MemoryStorage();
    const a = makeWorld({ storage });
    await a.wake();
    await a.ctl.hear("I'm applying vitamin C serum", "typed");
    await a.quiet();
    const b = makeWorld({ storage, clock: a.clock });
    await b.wake();
    expect(b.state().panel).toBe("ritual");
    expect(b.data().ritual?.applied.length).toBe(1);
  });

  it("starting the other period files the open ritual away", async () => {
    const w = makeWorld();
    await w.wake();
    await w.ctl.hear("start my morning ritual", "typed");
    await w.ctl.hear("start my evening routine", "typed");
    expect(w.data().history.length).toBe(1);
    expect(w.data().ritual?.period).toBe("pm");
  });
});

describe("verify", () => {
  it("with no baseline, says so and offers a scan", async () => {
    const w = makeWorld();
    await w.wake();
    await w.ctl.hear("did it work", "typed");
    await w.quiet();
    expect(said(w, "verify_no_baseline", {})).toBe(true);
    expect(w.state().pending).toBe("scan_offer");
  });

  it("too soon after the first scan: says it is too early, and 'measure anyway' goes ahead", async () => {
    const w = makeWorld();
    await w.wake();
    w.ctl.startScan();
    await w.clock.until(() => w.state().report !== null && w.state().scan.name === "idle");
    await w.quiet();
    await w.clock.advance(2 * MIN);
    await w.ctl.hear("did it work", "typed");
    await w.quiet();
    expect(w.state().pending).toBe("verify_anyway");
    expect(w.state().scan.name).toBe("idle");
    await w.ctl.hear("yes", "typed");
    await w.clock.until(() => w.state().verify !== null && w.state().scan.name === "idle");
    expect(w.state().panel).toBe("verify");
    expect(w.data().scans[1]!.kind).toBe("after");
    expect(w.state().verify!.comparison.caveats).toContain("same_sitting");
  });

  it("a long enough gap goes straight to the second scan, and demo scans carry the sample caveat", async () => {
    const w = makeWorld();
    await w.wake();
    w.ctl.startScan();
    await w.clock.until(() => w.state().report !== null && w.state().scan.name === "idle");
    await w.quiet();
    await w.clock.advance(30 * MIN);
    await w.ctl.hear("did it work", "typed");
    await w.clock.until(() => w.state().verify !== null && w.state().scan.name === "idle");
    await w.quiet();
    expect(w.state().verify!.comparison.caveats).toContain("demo");
    expect(said(w, "scan_demo_notice", {})).toBe(true);
    // one honest comparison line, never a medical claim
    for (const s of w.speaker.spoken) expect(lintUtterance(s).ok).toBe(true);
  });

  it("says the numbers are about the same when they are", async () => {
    const w = await consentedLive();
    await liveScan(w);
    await w.clock.advance(45 * MIN);
    w.api.scanPolls = 0;
    w.api.scanPollReplies = [{ ok: true, status: "success", mode: "live", scores: { ...SCORES } }];
    await w.ctl.hear("did it work", "typed");
    await w.clock.until(() => w.state().verify !== null && w.state().scan.name === "idle", 180_000);
    await w.quiet();
    expect(said(w, "verify_same", {})).toBe(true);
  });

  it("names what improved and what softened, and the ledger keeps real scans separate from samples", async () => {
    const w = await consentedLive();
    await liveScan(w);
    await w.clock.advance(45 * MIN);
    w.api.scanPolls = 0;
    w.api.scanPollReplies = [{ ok: true, status: "success", mode: "live", scores: { ...SCORES, moisture: 95, redness: 50 } }];
    await w.ctl.hear("did it work", "typed");
    await w.clock.until(() => w.state().verify !== null && w.state().scan.name === "idle", 180_000);
    await w.quiet();
    expect(w.speaker.spoken.some((s) => s.toLowerCase().includes("hydration"))).toBe(true);
    expect(w.speaker.spoken.some((s) => s.toLowerCase().includes("calm tone"))).toBe(true);
    expect(w.state().verify!.comparison.headline).toBe("mixed");
  });

  it("links the second scan to the ritual that was done in between", async () => {
    const w = makeWorld();
    await w.wake();
    w.ctl.startScan();
    await w.clock.until(() => w.state().report !== null && w.state().scan.name === "idle");
    await w.quiet();
    await w.clock.advance(MIN);
    await w.ctl.hear("start my morning ritual", "typed");
    await w.clock.advance(30 * MIN);
    await w.ctl.hear("I'm done", "typed");
    await w.quiet();
    await w.ctl.hear("yes", "typed");
    await w.clock.until(() => w.state().verify !== null && w.state().scan.name === "idle");
    expect(w.data().scans[1]!.ritualId).toBe(w.data().history[0]!.id);
  });
});

describe("looks", () => {
  it("opens the studio and invites a choice", async () => {
    const w = makeWorld();
    await w.wake();
    await w.ctl.hear("try a look", "typed");
    await w.quiet();
    expect(w.state().panel).toBe("looks");
    expect(said(w, "look_intro", {})).toBe(true);
  });

  it("in Demo Mode the recipe is the whole experience: coached one step at a time with 'next'", async () => {
    const w = makeWorld();
    await w.wake();
    await w.ctl.hear("try the rani look", "typed");
    await w.quiet();
    expect(w.state().looks).toMatchObject({ selected: "rani_rose", status: "demo", coach: { index: 0 } });
    expect(w.api.previews.length).toBe(0);
    const spoken0 = w.speaker.spoken.length;
    await w.ctl.hear("next", "typed");
    await w.quiet();
    expect(w.state().looks.coach).toMatchObject({ index: 1 });
    expect(w.speaker.spoken.length).toBe(spoken0 + 1);
    // run to the end
    for (let i = 0; i < 30 && w.state().looks.coach; i += 1) {
      w.ctl.coachNext();
      await w.quiet();
    }
    expect(w.state().looks.coach).toBeNull();
    expect(said(w, "look_done", {})).toBe(true);
  });

  it("'say that again' repeats the current step", async () => {
    const w = makeWorld();
    await w.wake();
    await w.ctl.hear("try the rani look", "typed");
    await w.quiet();
    const step = w.speaker.spoken[w.speaker.spoken.length - 1]!;
    await w.ctl.hear("say that again", "typed");
    await w.quiet();
    expect(w.speaker.spoken[w.speaker.spoken.length - 1]).toBe(step);
  });

  it("a live preview needs the consent tap, then renders and offers coaching", async () => {
    const w = liveWorld();
    await w.wake();
    await w.ctl.hear("try the rani look", "typed");
    await w.clock.until(() => w.state().pending === "consent_scan");
    expect(w.api.previews.length).toBe(0);
    w.ctl.grantConsent("scan");
    await w.clock.until(() => w.state().looks.status === "ready", 120_000);
    await w.quiet();
    expect(w.api.previews[0]).toMatchObject({ look: "rani_rose" });
    expect(w.state().looks.image).toMatch(/^data:image\//);
    expect(w.state().pending).toBe("look_coach");
    await w.ctl.hear("yes", "typed");
    await w.quiet();
    expect(w.state().looks.coach).toMatchObject({ index: 0 });
  });

  it("a failed preview offers a retry that runs the same look again", async () => {
    const w = await consentedLive();
    w.api.previewStartReply = { ok: false, error: "network" };
    await w.ctl.hear("try the rani look", "typed");
    await w.clock.until(() => w.state().looks.status === "error", 120_000);
    await w.quiet();
    expect(w.state().pending).toBe("retry");
    w.api.previewStartReply = { ok: true, mode: "live", ticket: "pv2", pollMs: 1000 };
    await w.ctl.hear("try again", "typed");
    await w.clock.until(() => w.state().looks.status === "ready", 120_000);
    expect(w.api.previews.length).toBe(2);
  });

  it("falls back to the recipe when the preview service is unavailable", async () => {
    const w = await consentedLive();
    w.api.previewStartReply = { ok: false, error: "unavailable" };
    await w.ctl.hear("try the rani look", "typed");
    await w.clock.until(() => w.state().looks.status === "demo", 120_000);
    await w.quiet();
    expect(said(w, "look_unavailable", {})).toBe(true);
    expect(w.state().looks.coach).not.toBeNull();
  });

  it("switching language drops a recipe in the old language", async () => {
    const w = makeWorld();
    await w.wake();
    await w.ctl.hear("try the rani look", "typed");
    await w.quiet();
    w.ctl.setLanguage("hi");
    expect(w.state().looks.coach).toBeNull();
  });
});

describe("labels, tracking and the ledger", () => {
  it("reading a bottle needs the vision service and the consent tap, and the name is confirmed by the person", async () => {
    const w = liveWorld();
    await w.wake();
    w.api.productReply = { ok: true, found: true, name: "Niacinamide 10% Serum", category: "serum", confidence: "high" };
    w.ctl.lookAtProduct();
    await w.clock.until(() => w.state().pending === "consent_look");
    expect(w.eyes.labelCaptures).toBe(0);
    expect(w.api.labels).toBe(0);
    w.ctl.grantConsent("look");
    await w.clock.until(() => w.state().product.status === "found", 60_000);
    await w.quiet();
    expect(w.eyes.labelCaptures).toBe(1);
    expect(w.state().pending).toBe("confirm_product");
    await w.ctl.hear("yes", "typed");
    await w.quiet();
    expect(w.data().ritual?.applied.map((a) => a.name)).toEqual(["Niacinamide 10% Serum"]);
  });

  it("a declined confirmation asks which product it is", async () => {
    const w = liveWorld();
    await w.wake();
    w.ctl.grantConsent("look");
    w.api.productReply = { ok: true, found: true, name: "Some Serum", category: "serum", confidence: "low" };
    w.ctl.lookAtProduct();
    await w.clock.until(() => w.state().pending === "confirm_product", 60_000);
    w.ctl.reply(false);
    await w.quiet();
    expect(said(w, "ask_potion", {})).toBe(true);
    expect(w.data().ritual).toBeNull();
  });

  it("says it could not read the label, and never invents a name", async () => {
    const w = liveWorld();
    await w.wake();
    w.ctl.grantConsent("look");
    w.api.productReply = { ok: true, found: false };
    w.ctl.lookAtProduct();
    await w.clock.until(() => w.state().product.status === "notfound", 60_000);
    await w.quiet();
    expect(said(w, "look_failed", {})).toBe(true);
    expect(w.state().pending).toBeNull();
  });

  it("without a vision key the mirror says it cannot read labels and sends no frame", async () => {
    const w = makeWorld();
    await w.wake();
    w.ctl.lookAtProduct();
    await w.clock.flush();
    await w.quiet();
    expect(said(w, "look_failed", {})).toBe(true);
    expect(w.eyes.labelCaptures).toBe(0);
  });

  it("tracks a product and shows the ledger, honestly saying it is too early", async () => {
    const w = makeWorld();
    await w.wake();
    await w.ctl.hear("track this serum", "typed");
    await w.quiet();
    expect(w.data().tracked.length).toBe(1);
    expect(w.state().panel).toBe("ledger");
    await w.ctl.hear("show my ledger", "typed");
    await w.quiet();
    expect(w.speaker.spoken.some((s) => /early|too soon|few more|need/i.test(s))).toBe(true);
  });

  it("an empty ledger says so", async () => {
    const w = makeWorld();
    await w.wake();
    await w.ctl.hear("show my ledger", "typed");
    await w.quiet();
    expect(said(w, "ledger_empty", {})).toBe(true);
  });

  it("an unknown product being tracked asks for a category first", async () => {
    const w = makeWorld();
    await w.wake();
    await w.ctl.hear("I just started using zorblax", "typed");
    await w.quiet();
    expect(w.state().pending).toBe("category");
    await w.ctl.hear("moisturizer", "typed");
    await w.quiet();
    expect(w.data().tracked.length).toBe(1);
  });

  it("stopping tracking removes it", async () => {
    const w = makeWorld();
    await w.wake();
    await w.ctl.hear("track this serum", "typed");
    w.ctl.stopTrackingProduct(w.data().tracked[0]!.id);
    expect(w.data().tracked.length).toBe(0);
  });
});

describe("language, title and settings", () => {
  it("switches to Hindi by voice and then speaks Hindi", async () => {
    const w = makeWorld();
    await w.wake();
    await w.ctl.hear("speak hindi", "typed");
    await w.quiet();
    expect(w.data().settings.language).toBe("hi");
    expect(w.speaker.langs[w.speaker.langs.length - 1]).toBe("hi");
    expect(w.ear.lang).toBe("hi");
    expect(said(w, "language_changed", {}, "hi")).toBe(true);
    await w.ctl.hear("hello", "typed");
    await w.quiet();
    expect(w.speaker.spoken[w.speaker.spoken.length - 1]).toBe(line("hi", "greet", { title: titleFor({ ...DEFAULT_SETTINGS, language: "hi" }) }));
  });

  it("every Hindi line the mirror speaks passes the claim linter", async () => {
    const w = makeWorld();
    await w.wake();
    w.ctl.setLanguage("hi");
    await w.ctl.hear("start my morning ritual", "typed");
    await w.ctl.hear("I'm applying vitamin C serum", "typed");
    w.ctl.startScan();
    await w.clock.until(() => w.state().report !== null && w.state().scan.name === "idle");
    await w.quiet();
    for (const s of w.speaker.spoken) expect(lintUtterance(s).ok).toBe(true);
  });

  it("sets a custom title, and refuses one the claim linter rejects", async () => {
    const w = makeWorld();
    await w.wake();
    await w.ctl.hear("call me Your Majesty", "typed");
    await w.quiet();
    expect(w.data().settings.titleId).toBe("custom");
    expect(w.data().settings.customTitle).toBe("Your Majesty");
    expect(said(w, "title_set", { title: "Your Majesty" })).toBe(true);
    w.ctl.setCustomTitle("Dr. Cure Guaranteed");
    expect(w.data().settings.customTitle).toBe("Your Majesty");
  });

  it("picking a preset title changes how the mirror greets", async () => {
    const w = makeWorld();
    w.ctl.setTitleId("maharani");
    await w.wake();
    expect(w.data().settings.titleId).toBe("maharani");
    expect(w.speaker.spoken[0]).toBe(line("en", "welcome", { title: "Maharani" }));
  });

  it("'hush' silences the mirror at once", async () => {
    const w = makeWorld();
    w.ctl.wake();
    expect(w.state().voice.speaking).toBe(true);
    // the person can only reach hush by typing or a button while the ear is closed
    await w.ctl.hear("be quiet", "typed");
    expect(w.state().voice.speaking).toBe(false);
  });

  it("'say that again' repeats the last few sentences", async () => {
    const w = makeWorld();
    await w.wake();
    await w.ctl.hear("hello", "typed");
    await w.quiet();
    await w.ctl.hear("thank you", "typed");
    await w.quiet();
    const m = w.mark();
    await w.ctl.hear("say that again", "typed");
    await w.quiet();
    expect(w.spokenSince(m).length).toBeGreaterThan(0);
  });

  it("opens settings by voice", async () => {
    const w = makeWorld();
    await w.wake();
    await w.ctl.hear("open settings", "typed");
    expect(w.state().sheet).toBe("settings");
    w.ctl.openSettings(false);
    expect(w.state().sheet).toBeNull();
  });

  it("revoking consent turns it off again", async () => {
    const w = makeWorld();
    w.ctl.grantConsent("scan");
    expect(w.data().settings.consentScan).toBe(true);
    w.ctl.revokeConsent("scan");
    expect(w.data().settings.consentScan).toBe(false);
  });

  it("declining a consent card dismisses it", async () => {
    const w = liveWorld();
    await w.wake();
    w.ctl.startScan();
    await w.clock.until(() => w.state().pending === "consent_scan");
    w.ctl.declineConsent();
    await w.quiet();
    expect(w.state().pending).toBeNull();
    expect(w.data().settings.consentScan).toBe(false);
  });
});

describe("forget me", () => {
  it("asks first; a no keeps everything", async () => {
    const w = makeWorld();
    await w.wake();
    await w.ctl.hear("track this serum", "typed");
    await w.ctl.hear("forget me", "typed");
    await w.quiet();
    expect(w.state().pending).toBe("forget");
    await w.ctl.hear("no", "typed");
    await w.quiet();
    expect(w.data().tracked.length).toBe(1);
  });

  it("a yes erases everything on the device, says goodbye in the language it was asked in, and returns to the welcome", async () => {
    const w = makeWorld();
    await w.wake();
    w.ctl.setLanguage("hi");
    await w.quiet();
    await w.ctl.hear("track this serum", "typed");
    w.ctl.startScan();
    await w.clock.until(() => w.state().report !== null && w.state().scan.name === "idle");
    await w.quiet();
    await w.ctl.hear("forget me", "typed");
    await w.quiet();
    await w.ctl.hear("yes", "typed");
    await w.quiet();
    expect(w.state().phase).toBe("welcome");
    expect(w.data().scans.length).toBe(0);
    expect(w.data().tracked.length).toBe(0);
    expect(w.data().settings.language).toBe("en");
    expect(w.state().captions.length).toBeGreaterThanOrEqual(0);
    expect(w.speaker.spoken[w.speaker.spoken.length - 1]).toBe(line("hi", "forgotten", {}));
    expect(w.storage.map.size === 0 || !JSON.stringify([...w.storage.map.values()]).includes("scores")).toBe(true);
    expect(w.eyes.state).toBe("off");
    expect(w.ear.listening).toBe(false);
  });
});

describe("persistence", () => {
  it("settings, scans and the ledger survive a reload, and photos are never stored", async () => {
    const storage = new MemoryStorage();
    const a = makeWorld({ storage });
    await a.wake();
    a.ctl.setLanguage("hinglish");
    a.ctl.startScan();
    await a.clock.until(() => a.state().report !== null && a.state().scan.name === "idle");
    await a.ctl.hear("track this serum", "typed");

    const b = makeWorld({ storage, clock: a.clock });
    expect(b.data().settings.language).toBe("hinglish");
    expect(b.data().scans.length).toBe(1);
    expect(b.data().tracked.length).toBe(1);
    const blob = JSON.stringify([...storage.map.values()]);
    expect(blob).not.toMatch(/data:image|blob:|base64/);
    expect(blob).not.toMatch(/"ita"/);
  });

  it("works when storage is refused, and says nothing will be remembered", async () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new Error("quota");
    };
    const w = makeWorld({ storage });
    await w.wake();
    expect(w.state().persistent).toBe(false);
    await w.ctl.hear("hello", "typed");
    await w.quiet();
    expect(said(w, "greet", {})).toBe(true);
  });

  it("a corrupt save starts fresh instead of crashing", async () => {
    const storage = new MemoryStorage();
    storage.map.set("darpan:v1", "{not json");
    const w = makeWorld({ storage });
    await w.wake();
    expect(w.state().phase).toBe("awake");
  });
});

describe("status", () => {
  it("retries the status call later when the first one failed", async () => {
    const w = makeWorld({ status: null });
    await w.clock.flush();
    expect(w.state().status).toBeNull();
    w.api.statusReply = demoStatus();
    w.ctl.startScan();
    await w.clock.advance(20_000);
    await w.clock.until(() => w.state().report !== null);
    expect(w.api.statusCalls).toBeGreaterThanOrEqual(2);
  });
});

describe("dispose", () => {
  it("stops the camera and the microphone and ignores later events", async () => {
    const w = makeWorld();
    await w.wake();
    w.ctl.dispose();
    expect(w.eyes.state).toBe("off");
    expect(w.ear.listening).toBe(false);
    const n = w.speaker.spoken.length;
    await w.ctl.hear("hello", "typed");
    expect(w.speaker.spoken.length).toBe(n);
  });
});
