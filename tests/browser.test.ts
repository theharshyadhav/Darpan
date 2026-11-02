import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_MODEL_URL, MEDIAPIPE_VERSION, REMOTE_MODEL_HOST, REMOTE_MODEL_URL } from "@/client/browser/detector-config";
import { BACKOFF_MAX_MS, BACKOFF_START_MS, BrowserEar, MAX_FAILURES, nextBackoff, type RecognitionCtor } from "@/client/browser/stt";
import { BrowserSpeaker, type SynthLike, type UtteranceCtor } from "@/client/browser/tts";
import { chunkSentences, hasVoiceFor, MAX_CHUNK, pickVoice, rateFor, scoreVoice, watchdogMs, type VoiceLike } from "@/client/browser/voices";

const v = (name: string, lang: string, local = true): VoiceLike => ({ name, lang, voiceURI: `uri:${name}`, localService: local });

describe("chunkSentences", () => {
  it("keeps a short sentence whole and joins short neighbours", () => {
    expect(chunkSentences("Welcome, Your Highness.")).toEqual(["Welcome, Your Highness."]);
    expect(chunkSentences("Yes. Of course. Right away.")).toEqual(["Yes. Of course. Right away."]);
  });

  it("never exceeds the limit, and loses no words", () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ") + ".";
    const parts = chunkSentences(long);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(MAX_CHUNK);
    expect(parts.join(" ").split(" ")).toEqual(long.split(" "));
  });

  it("cuts at sentence ends first, including the Hindi danda", () => {
    const a = "a".repeat(100);
    const b = "b".repeat(100);
    expect(chunkSentences(`${a}. ${b}.`)).toEqual([`${a}.`, `${b}.`]);
    expect(chunkSentences(`${a}। ${b}।`)).toEqual([`${a}।`, `${b}।`]);
  });

  it("prefers a comma over a hard cut", () => {
    const text = `${"x".repeat(120)}, ${"y".repeat(100)}`;
    const parts = chunkSentences(text);
    expect(parts[0]!.endsWith(",")).toBe(true);
  });

  it("copes with empty and unbroken input", () => {
    expect(chunkSentences("   ")).toEqual([]);
    const blob = "z".repeat(500);
    const parts = chunkSentences(blob);
    expect(parts.join("")).toBe(blob);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(MAX_CHUNK);
  });
});

describe("voice choice", () => {
  const voices = [v("Alex", "en-US"), v("Rishi", "en-IN"), v("Daniel", "en-GB"), v("Google हिन्दी", "hi-IN", false), v("Anna", "de-DE")];

  it("prefers an exact language match", () => {
    expect(pickVoice(voices, "en-IN", "")?.name).toBe("Rishi");
    expect(pickVoice(voices, "hi-IN", "")?.name).toBe("Google हिन्दी");
  });

  it("for Indian English without an Indian voice, prefers a British one over a US one", () => {
    const without = voices.filter((x) => x.lang !== "en-IN");
    expect(pickVoice(without, "en-IN", "")?.name).toBe("Daniel");
  });

  it("returns nothing when no voice speaks the language, rather than reading Hindi in an English voice", () => {
    expect(pickVoice([v("Alex", "en-US")], "hi-IN", "")).toBeNull();
    expect(scoreVoice(v("Anna", "de-DE"), "en-US")).toBe(0);
  });

  it("honours the person's own choice when it still exists, and ignores it when it does not", () => {
    expect(pickVoice(voices, "en-US", "uri:Daniel")?.name).toBe("Daniel");
    expect(pickVoice(voices, "en-US", "uri:Gone")?.name).toBe("Alex");
  });

  it("knows whether a language can be spoken at all", () => {
    expect(hasVoiceFor(voices, "hi")).toBe(true);
    expect(hasVoiceFor([v("Alex", "en-US")], "hi")).toBe(false);
    expect(hasVoiceFor([v("Alex", "en-US")], "hinglish")).toBe(true);
  });

  it("maps pace to rate and scales the watchdog with length and rate", () => {
    expect(rateFor("calm")).toBeLessThan(rateFor("steady"));
    expect(rateFor("brisk")).toBeGreaterThan(rateFor("steady"));
    expect(watchdogMs("a".repeat(150), 1)).toBeGreaterThan(watchdogMs("a", 1));
    expect(watchdogMs("hello", 0.5)).toBeGreaterThan(watchdogMs("hello", 1.2));
  });
});

// ---------------------------------------------------------------- fake speech synthesis

interface FakeU {
  text: string;
  lang: string;
  rate: number;
  voice?: unknown;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

function fakeSynth(voices: VoiceLike[] = [v("Rishi", "en-IN")]) {
  const spoken: FakeU[] = [];
  const synth = {
    speaking: false,
    paused: false,
    voices,
    speak: (u: FakeU) => {
      spoken.push(u);
    },
    cancel: vi.fn(() => {
      synth.speaking = false;
    }),
    resume: vi.fn(),
    getVoices: () => voices as unknown as SpeechSynthesisVoice[],
  };
  class U {
    text: string;
    lang = "";
    rate = 1;
    pitch = 1;
    volume = 1;
    voice: unknown = null;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  return { synth: synth as unknown as SynthLike, raw: synth, spoken, U: U as unknown as UtteranceCtor };
}

describe("BrowserSpeaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const opts = { voiceUri: "", pace: "steady" as const };

  it("hands the first piece to the browser synchronously, inside the gesture", () => {
    const f = fakeSynth();
    const sp = new BrowserSpeaker(f.synth, f.U, () => "en-US");
    void sp.speak("Welcome, Your Highness.", "en", opts);
    expect(f.spoken.length).toBe(1); // no await happened before speak()
  });

  it("sets language, voice and rate, and resolves when the browser says it ended", async () => {
    const f = fakeSynth();
    const sp = new BrowserSpeaker(f.synth, f.U, () => "en-US");
    let done = false;
    const p = sp.speak("Hello there.", "hinglish", { voiceUri: "", pace: "calm" }).then(() => {
      done = true;
    });
    const u = f.spoken[0]!;
    expect(u.lang).toBe("en-IN");
    expect((u.voice as VoiceLike).name).toBe("Rishi");
    expect(u.rate).toBeLessThan(1);
    await Promise.resolve();
    expect(done).toBe(false);
    u.onend?.();
    await p;
    expect(done).toBe(true);
  });

  it("speaks a long sentence as several pieces, one after another", async () => {
    const f = fakeSynth();
    const sp = new BrowserSpeaker(f.synth, f.U, () => "en-US");
    const long = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ") + ".";
    const p = sp.speak(long, "en", opts);
    expect(f.spoken.length).toBe(1);
    f.spoken[0]!.onend?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.spoken.length).toBe(2);
    while (f.spoken.length < chunkSentences(long).length) {
      f.spoken[f.spoken.length - 1]!.onend?.();
      await vi.advanceTimersByTimeAsync(0);
    }
    f.spoken[f.spoken.length - 1]!.onend?.();
    await p;
  });

  it("moves on when the browser never says it finished (the watchdog)", async () => {
    const f = fakeSynth();
    const sp = new BrowserSpeaker(f.synth, f.U, () => "en-US");
    let done = false;
    const p = sp.speak("Hello there.", "en", opts).then(() => {
      done = true;
    });
    f.spoken[0]!.onstart?.();
    await vi.advanceTimersByTimeAsync(watchdogMs("Hello there.", 1) + 50);
    await p;
    expect(done).toBe(true);
    expect(f.raw.cancel).toHaveBeenCalled();
  });

  it("retries once when the browser silently drops a piece, then gives up", async () => {
    const f = fakeSynth();
    const sp = new BrowserSpeaker(f.synth, f.U, () => "en-US");
    const p = sp.speak("Hello there.", "en", opts);
    await vi.advanceTimersByTimeAsync(2300);
    expect(f.spoken.length).toBe(2); // spoken again
    await vi.advanceTimersByTimeAsync(2300);
    await p; // dropped twice: skipped, never stuck
  });

  it("a cancel resolves the pending speech at once", async () => {
    const f = fakeSynth();
    const sp = new BrowserSpeaker(f.synth, f.U, () => "en-US");
    const p = sp.speak("Hello there.", "en", opts);
    sp.cancel();
    await p;
    expect(f.raw.cancel).toHaveBeenCalled();
    // the cancelled piece's late error event is harmless
    f.spoken[0]!.onerror?.({ error: "canceled" });
  });

  it("an error other than a cancel skips that piece and carries on", async () => {
    const f = fakeSynth();
    const sp = new BrowserSpeaker(f.synth, f.U, () => "en-US");
    const long = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ") + ".";
    const p = sp.speak(long, "en", opts);
    f.spoken[0]!.onerror?.({ error: "synthesis-failed" });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.spoken.length).toBe(2);
    sp.cancel();
    await p;
  });

  it("is unavailable and resolves immediately without speechSynthesis", async () => {
    const sp = new BrowserSpeaker(null, null);
    expect(sp.available).toBe(false);
    await sp.speak("hi", "en", opts);
    expect(sp.canSpeak("en")).toBe(false);
  });

  it("resumes a paused synth before speaking", () => {
    const f = fakeSynth();
    f.raw.paused = true;
    const sp = new BrowserSpeaker(f.synth, f.U, () => "en-US");
    void sp.speak("Hello.", "en", opts);
    expect(f.raw.resume).toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------------ fake recognition

class FakeRec {
  static all: FakeRec[] = [];
  lang = "";
  continuous = true;
  interimResults = false;
  maxAlternatives = 0;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  onresult: ((e: { resultIndex: number; results: unknown }) => void) | null = null;
  started = 0;
  aborted = 0;
  constructor() {
    FakeRec.all.push(this);
  }
  start() {
    this.started += 1;
    this.onstart?.();
  }
  abort() {
    this.aborted += 1;
    this.onend?.();
  }
  say(text: string, isFinal = true) {
    const r = Object.assign([{ transcript: text }], { isFinal });
    this.onresult?.({ resultIndex: 0, results: [r] });
  }
}

function ear(now = () => 0) {
  FakeRec.all = [];
  const e = new BrowserEar(FakeRec as unknown as RecognitionCtor, () => "en-US", now);
  const states: string[] = [];
  const finals: string[] = [];
  const interims: string[] = [];
  e.subscribe({ state: (s) => states.push(s), final: (t) => finals.push(t), interim: (t) => interims.push(t) });
  const last = () => FakeRec.all[FakeRec.all.length - 1]!;
  return { e, states, finals, interims, last };
}

describe("nextBackoff", () => {
  it("resets after a heard sentence and grows, capped, through silence", () => {
    expect(nextBackoff(2000, true)).toBe(BACKOFF_START_MS);
    let d = BACKOFF_START_MS;
    const seen: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      d = nextBackoff(d, false);
      seen.push(d);
    }
    expect(seen[0]).toBe(500);
    expect(Math.max(...seen)).toBe(BACKOFF_MAX_MS);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });
});

describe("BrowserEar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports unsupported and does nothing without SpeechRecognition", () => {
    const e = new BrowserEar(null);
    expect(e.available).toBe(false);
    e.start("en");
    e.stop();
  });

  it("starts one session, with the right language, and keeps start() idempotent", () => {
    const { e, states, last } = ear();
    e.start("hi");
    e.start("hi");
    e.start("hi");
    expect(FakeRec.all.length).toBe(1);
    expect(last().lang).toBe("hi-IN");
    expect(last().continuous).toBe(false);
    expect(last().interimResults).toBe(true);
    expect(states).toEqual(["listening"]);
  });

  it("delivers interim text and then the final sentence", () => {
    const { e, finals, interims, last } = ear();
    e.start("en");
    last().say("start my", false);
    last().say("start my morning ritual", true);
    expect(interims).toEqual(["start my"]);
    expect(finals).toEqual(["start my morning ritual"]);
  });

  it("restarts after a session ends, with a pause", () => {
    const { e, last } = ear();
    e.start("en");
    last().onend?.();
    expect(FakeRec.all.length).toBe(1);
    vi.advanceTimersByTime(BACKOFF_START_MS * 2 + 1);
    expect(FakeRec.all.length).toBe(2);
    expect(last().started).toBe(1);
  });

  it("does not restart after an explicit stop, and does not emit state twice", () => {
    const { e, states } = ear();
    e.start("en");
    e.stop();
    e.stop();
    vi.advanceTimersByTime(10_000);
    expect(FakeRec.all.length).toBe(1);
    expect(states).toEqual(["listening", "idle"]);
  });

  it("a stop followed straight away by a start does not double-start", () => {
    const { e } = ear();
    e.start("en");
    e.stop();
    e.start("en");
    vi.advanceTimersByTime(5000);
    const live = FakeRec.all.filter((r) => r.started > 0 && r.aborted === 0);
    expect(live.length).toBeLessThanOrEqual(1);
  });

  it("a permission refusal is reported once as blocked and never retried", () => {
    const { e, states, last } = ear();
    e.start("en");
    last().onerror?.({ error: "not-allowed" });
    last().onend?.();
    expect(states).toContain("blocked");
    vi.advanceTimersByTime(60_000);
    e.start("en");
    expect(FakeRec.all.length).toBe(1);
  });

  it("silence is not a failure: it keeps listening however long it is quiet", () => {
    const { e, states, last } = ear();
    e.start("en");
    for (let i = 0; i < MAX_FAILURES + 3; i += 1) {
      last().onerror?.({ error: "no-speech" });
      last().onend?.();
      vi.advanceTimersByTime(BACKOFF_MAX_MS + 1);
    }
    expect(states).not.toContain("error");
    expect(FakeRec.all.length).toBeGreaterThan(MAX_FAILURES);
  });

  it("repeated real errors end in an error state, retried only after a cooldown", () => {
    let t = 0;
    const { e, states, last } = ear(() => t);
    e.start("en");
    for (let i = 0; i < MAX_FAILURES; i += 1) {
      last().onerror?.({ error: "network" });
      last().onend?.();
      vi.advanceTimersByTime(BACKOFF_MAX_MS + 1);
    }
    expect(states).toContain("error");
    const n = FakeRec.all.length;
    t += 1000;
    e.start("en");
    expect(FakeRec.all.length).toBe(n); // too soon
    t += 20_000;
    e.start("en");
    expect(FakeRec.all.length).toBe(n + 1);
  });

  it("a changed language restarts the session", () => {
    const { e, last } = ear();
    e.start("en");
    e.start("hi");
    vi.advanceTimersByTime(BACKOFF_MAX_MS + 1);
    expect(last().lang).toBe("hi-IN");
  });

  it("a thrown start() does not crash", () => {
    FakeRec.all = [];
    class Bad extends FakeRec {
      start() {
        throw new Error("InvalidStateError");
      }
    }
    const e = new BrowserEar(Bad as unknown as RecognitionCtor, () => "en-US", () => 0);
    expect(() => e.start("en")).not.toThrow();
  });
});

describe("face detector configuration", () => {
  it("the runtime version in code equals the installed package, and the package is pinned exactly", () => {
    const pkg = JSON.parse(readFileSync("node_modules/@mediapipe/tasks-vision/package.json", "utf8")) as { version: string };
    const root = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
    expect(MEDIAPIPE_VERSION).toBe(pkg.version);
    expect(root.dependencies["@mediapipe/tasks-vision"]).toBe(pkg.version);
  });

  it("the only outside host is the model host the CSP allows", () => {
    expect(REMOTE_MODEL_URL.startsWith(`${REMOTE_MODEL_HOST}/`)).toBe(true);
    expect(LOCAL_MODEL_URL.startsWith("/")).toBe(true);
  });
});
