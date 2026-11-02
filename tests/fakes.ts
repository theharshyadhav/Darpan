import { MirrorController } from "@/client/controller";
import { DataStore, type PersistedData, type StorageLike } from "@/client/data";
import type { Api } from "@/client/api";
import type { CameraState, DetectorKind, Ear, EarHandlers, EarState, Eyes, FrameReading, Photo, Platform, Speaker } from "@/client/ports";
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
import type { ScoreMap } from "@/lib/skin/types";
import type { Language } from "@/lib/types";

// the mirror reads the local hour to guess morning or evening: pin it so tests do not depend on the machine
process.env.TZ = "UTC";

/** A virtual clock: nothing happens until the test moves time, and everything happens in order. */
export class FakeClock {
  t: number;
  private sleepers: Array<{ at: number; seq: number; resolve: () => void }> = [];
  private seq = 0;

  /** 2026-10-01 09:00 UTC: morning. */
  constructor(start = Date.UTC(2026, 9, 1, 9, 0, 0)) {
    this.t = start;
  }

  now = (): number => this.t;

  sleep = (ms: number): Promise<void> =>
    new Promise<void>((resolve) => {
      this.sleepers.push({ at: this.t + Math.max(0, ms), seq: (this.seq += 1), resolve });
    });

  /** Let every chain of already-resolved promises run to its next real wait. */
  async flush(): Promise<void> {
    for (let i = 0; i < 4; i += 1) await new Promise<void>((r) => setImmediate(r));
  }

  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    await this.flush();
    for (;;) {
      this.sleepers.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.sleepers[0];
      if (!next || next.at > target) break;
      this.sleepers.shift();
      this.t = Math.max(this.t, next.at);
      next.resolve();
      await this.flush();
    }
    this.t = target;
    await this.flush();
  }

  /** Move time forward in small steps until the condition holds. */
  async until(cond: () => boolean, maxMs = 180_000, step = 50): Promise<void> {
    await this.flush();
    for (let waited = 0; waited <= maxMs; waited += step) {
      if (cond()) return;
      await this.advance(step);
    }
    throw new Error(`condition not met within ${maxMs} virtual ms`);
  }
}

export class MemoryStorage implements StorageLike {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** Speech takes (virtual) time, and a cancel cuts it short. */
export class FakeSpeaker implements Speaker {
  available = true;
  spoken: string[] = [];
  langs: Language[] = [];
  cancels = 0;
  private current: (() => void) | null = null;

  constructor(
    private readonly clock: FakeClock,
    private readonly msPerChar = 10,
  ) {}

  speak(text: string, lang: Language): Promise<void> {
    this.spoken.push(text);
    this.langs.push(lang);
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (this.current === finish) this.current = null;
        resolve();
      };
      this.current = finish;
      void this.clock.sleep(300 + text.length * this.msPerChar).then(finish);
    });
  }

  cancel(): void {
    this.cancels += 1;
    this.current?.();
  }
}

export class FakeEar implements Ear {
  available = true;
  listening = false;
  lang: Language | null = null;
  starts = 0;
  private readonly handlers = new Set<EarHandlers>();

  start(lang: Language): void {
    this.listening = true;
    this.lang = lang;
    this.starts += 1;
  }
  stop(): void {
    this.listening = false;
  }
  subscribe(h: EarHandlers): () => void {
    this.handlers.add(h);
    return () => {
      this.handlers.delete(h);
    };
  }
  /** The person speaks. Only heard while the microphone is open. */
  hear(text: string): boolean {
    if (!this.listening) return false;
    for (const h of this.handlers) h.final(text);
    return true;
  }
  emitState(s: EarState): void {
    for (const h of this.handlers) h.state(s);
  }
}

export function goodReading(over: Partial<FrameReading> = {}): FrameReading {
  return {
    faces: 1,
    box: { x: 100, y: 150, w: 400, h: 480 },
    region: { w: 600, h: 800 },
    framing: { ok: true, hint: "ok", widthRatio: 0.67, rollDeg: 0, yaw: 0 },
    lighting: { score: 0.9, hint: "ok", ok: true },
    ...over,
  };
}

export class FakeEyes implements Eyes {
  state: CameraState = "off";
  detector: DetectorKind = "mediapipe";
  /** Where start() lands: "on" when the person allows the camera. */
  grant: CameraState = "on";
  reading: (call: number) => FrameReading | null = () => goodReading();
  analyseCalls = 0;
  captures = 0;
  labelCaptures = 0;
  photoLighting = 0.85;
  photoSize = { width: 900, height: 1200 };
  private readonly subs = new Set<() => void>();

  private emit(): void {
    for (const s of this.subs) s();
  }

  async start(): Promise<CameraState> {
    this.state = "starting";
    this.emit();
    this.state = this.grant;
    this.emit();
    return this.state;
  }
  stop(): void {
    this.state = "off";
    this.emit();
  }
  async analyse(): Promise<FrameReading | null> {
    this.analyseCalls += 1;
    return this.state === "on" ? this.reading(this.analyseCalls) : null;
  }
  async capturePhoto(): Promise<Photo | null> {
    if (this.state !== "on") return null;
    this.captures += 1;
    return { blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), ...this.photoSize, lighting: this.photoLighting };
  }
  async captureLabel(): Promise<Blob | null> {
    if (this.state !== "on") return null;
    this.labelCaptures += 1;
    return new Blob([new Uint8Array([9, 9])], { type: "image/jpeg" });
  }
  async fromFile(file: File): Promise<Photo | null> {
    return { blob: file, width: 800, height: 1000, lighting: 0.8 };
  }
  subscribe(l: () => void): () => void {
    this.subs.add(l);
    return () => {
      this.subs.delete(l);
    };
  }
}

export const SCORES: ScoreMap = { moisture: 82, oiliness: 74, redness: 68, radiance: 77, texture: 59, pore: 71, acne: 80 };

export function demoStatus(over: Partial<StatusResponse> = {}): StatusResponse {
  return { app: "darpan", version: "1", skin: "demo", look: "demo", llm: "off", vision: false, scanCooldownSec: 20, maxImageBytes: 6_000_000, ...over };
}

export function liveStatus(over: Partial<StatusResponse> = {}): StatusResponse {
  return demoStatus({ skin: "live", look: "live", llm: "live", llmProvider: "groq", vision: true, ...over });
}

export class FakeApi implements Api {
  statusReply: StatusResponse | null = demoStatus();
  chatReply: (req: ChatRequest) => ChatResponse = () => ({ ok: false, error: "llm_off" });
  productReply: ProductLookResponse = { ok: true, found: false };
  scanStartReply: ScanStartResponse = { ok: true, mode: "live", ticket: "tk1", pollMs: 1000 };
  scanPollReplies: ScanPollResponse[] = [{ ok: true, status: "running", pollMs: 1000 }, { ok: true, status: "success", mode: "live", scores: SCORES, ita: 35 }];
  previewStartReply: LookStartResponse = { ok: true, mode: "live", ticket: "pv1", pollMs: 1000 };
  previewPollReplies: LookPollResponse[] = [{ ok: true, status: "success", image: "data:image/jpeg;base64,AAAA" }];

  statusCalls = 0;
  chats: ChatRequest[] = [];
  scanStarts: Array<{ photo: Blob | null; demo: { seed: string; n: number } }> = [];
  scanPolls = 0;
  previews: Array<{ look: LookId; photo: Blob | null }> = [];
  labels = 0;

  async status(): Promise<StatusResponse | null> {
    this.statusCalls += 1;
    return this.statusReply;
  }
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.chats.push(req);
    return this.chatReply(req);
  }
  async lookAtProduct(): Promise<ProductLookResponse> {
    this.labels += 1;
    return this.productReply;
  }
  async scanStart(photo: Blob | null, demo: { seed: string; n: number }): Promise<ScanStartResponse> {
    this.scanStarts.push({ photo, demo });
    return this.scanStartReply;
  }
  async scanPoll(): Promise<ScanPollResponse> {
    this.scanPolls += 1;
    const i = Math.min(this.scanPolls - 1, this.scanPollReplies.length - 1);
    return this.scanPollReplies[i]!;
  }
  async previewStart(look: LookId, photo: Blob | null): Promise<LookStartResponse> {
    this.previews.push({ look, photo });
    return this.previewStartReply;
  }
  async previewPoll(): Promise<LookPollResponse> {
    return this.previewPollReplies[0]!;
  }
}

export interface World {
  ctl: MirrorController;
  clock: FakeClock;
  api: FakeApi;
  eyes: FakeEyes;
  speaker: FakeSpeaker;
  ear: FakeEar;
  store: DataStore;
  storage: MemoryStorage;
  platform: Platform;
  state: () => ReturnType<MirrorController["getState"]>;
  data: () => PersistedData;
  /** Wait for the mirror to finish talking. */
  quiet: () => Promise<void>;
  /** The person says something aloud (the microphone must be open). */
  say: (text: string) => Promise<void>;
  /** Wake the mirror and let the greeting finish. */
  wake: () => Promise<void>;
  /** What the mirror has said since `mark()` was last called. */
  spokenSince: (from: number) => string[];
  mark: () => number;
}

export interface WorldOptions {
  status?: StatusResponse | null;
  storage?: MemoryStorage;
  clock?: FakeClock;
  seed?: (storage: MemoryStorage) => void;
}

export function makeWorld(opts: WorldOptions = {}): World {
  const clock = opts.clock ?? new FakeClock();
  const storage = opts.storage ?? new MemoryStorage();
  opts.seed?.(storage);
  const api = new FakeApi();
  if (opts.status !== undefined) api.statusReply = opts.status;
  const eyes = new FakeEyes();
  const speaker = new FakeSpeaker(clock);
  const ear = new FakeEar();
  const store = new DataStore(storage);
  let r = 0.37;
  const rand = () => {
    r = (r * 9301 + 49297) % 233280;
    return r / 233280;
  };
  const platform: Platform = { api, eyes, speaker, ear, store, now: () => clock.now(), rand, sleep: (ms) => clock.sleep(ms) };
  const ctl = new MirrorController(platform);
  ctl.init();

  const world: World = {
    ctl,
    clock,
    api,
    eyes,
    speaker,
    ear,
    store,
    storage,
    platform,
    state: () => ctl.getState(),
    data: () => ctl.getState().data,
    quiet: async () => {
      await clock.until(() => !ctl.getState().voice.speaking, 60_000, 100);
    },
    say: async (text) => {
      await world.quiet();
      if (!ear.hear(text)) throw new Error(`the microphone was not open when the person said: ${text}`);
      await clock.flush();
    },
    wake: async () => {
      await clock.flush();
      ctl.wake();
      await world.quiet();
    },
    spokenSince: (from) => speaker.spoken.slice(from),
    mark: () => speaker.spoken.length,
  };
  return world;
}
