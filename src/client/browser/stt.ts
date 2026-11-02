import { languageTag } from "@/lib/persona/titles";
import type { Language } from "@/lib/types";
import type { Ear, EarHandlers, EarState } from "../ports";

/**
 * The mirror's ear in the browser (SpeechRecognition).
 *
 * It listens in short sessions, because browsers end a session after a few seconds of silence, and
 * restarts them with a growing pause so a broken service is never hammered. A refused microphone is
 * reported once as "blocked" and left alone. Chrome sends this audio to Google's speech service;
 * the privacy page says so. The controller closes the ear while the mirror speaks, so it never
 * hears itself.
 */

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onresult: ((e: RecognitionEventLike) => void) | null;
  start(): void;
  abort(): void;
}

interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

export type RecognitionCtor = new () => RecognitionLike;

export const BACKOFF_START_MS = 250;
export const BACKOFF_MAX_MS = 3000;
/** Failures in a row (not silences) before the ear gives up until asked again. */
export const MAX_FAILURES = 5;
const ERROR_COOLDOWN_MS = 15_000;

/** The pause before the next listening session. A heard sentence resets it; silence slowly lengthens it. */
export function nextBackoff(prev: number, heardSomething: boolean): number {
  if (heardSomething) return BACKOFF_START_MS;
  return Math.min(BACKOFF_MAX_MS, Math.max(BACKOFF_START_MS, prev * 2));
}

export function findRecognition(w: unknown = typeof window !== "undefined" ? window : undefined): RecognitionCtor | null {
  const g = w as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor } | undefined;
  return g?.SpeechRecognition ?? g?.webkitSpeechRecognition ?? null;
}

export class BrowserEar implements Ear {
  readonly available: boolean;
  private readonly handlers = new Set<EarHandlers>();
  private rec: RecognitionLike | null = null;
  private wanted = false;
  private lang: Language = "en";
  private state: EarState = "idle";
  private delay = BACKOFF_START_MS;
  private failures = 0;
  private heard = false;
  private failedAt = Number.NEGATIVE_INFINITY;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly Ctor: RecognitionCtor | null = findRecognition(),
    private readonly browserLang: () => string | undefined = () => (typeof navigator !== "undefined" ? navigator.language : undefined),
    private readonly now: () => number = () => Date.now(),
  ) {
    this.available = Ctor !== null;
    if (!this.available) this.state = "unsupported";
  }

  subscribe(h: EarHandlers): () => void {
    this.handlers.add(h);
    return () => {
      this.handlers.delete(h);
    };
  }

  private setState(s: EarState): void {
    if (this.state === s) return;
    this.state = s;
    for (const h of [...this.handlers]) h.state(s);
  }

  /** Begin (or keep) listening. Safe to call repeatedly. */
  start(lang: Language): void {
    if (!this.Ctor || this.state === "blocked") return;
    if (this.state === "error" && this.now() - this.failedAt < ERROR_COOLDOWN_MS) return;
    const changed = lang !== this.lang;
    this.lang = lang;
    this.wanted = true;
    if (this.state === "error") {
      this.failures = 0;
      this.delay = BACKOFF_START_MS;
      this.state = "idle";
    }
    if (this.rec) {
      // a session is running (or ending): a new language needs a fresh one, which onend will start
      if (changed) this.rec.abort();
      return;
    }
    if (this.timer === null) this.launch();
  }

  stop(): void {
    this.wanted = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // an explicit stop forgives an earlier failure: the next start is a fresh try
    if (this.state === "error") {
      this.failures = 0;
      this.delay = BACKOFF_START_MS;
    }
    if (this.rec) {
      try {
        this.rec.abort();
      } catch {
        /* already ended */
      }
    }
    if (this.state === "listening" || this.state === "error") this.setState("idle");
  }

  private launch(): void {
    const Ctor = this.Ctor;
    if (!Ctor || !this.wanted || this.rec) return;
    let rec: RecognitionLike;
    try {
      rec = new Ctor();
    } catch {
      this.fail(true);
      return;
    }
    rec.lang = languageTag(this.lang, this.browserLang());
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    this.heard = false;
    let sawError: string | null = null;

    rec.onstart = () => {
      if (this.rec === rec) this.setState("listening");
    };
    rec.onresult = (e) => {
      if (this.rec !== rec) return;
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i]!;
        const text = (r[0]?.transcript ?? "").trim();
        if (!text) continue;
        if (r.isFinal) {
          this.heard = true;
          this.failures = 0;
          for (const h of [...this.handlers]) h.final(text);
        } else interim += `${interim ? " " : ""}${text}`;
      }
      if (interim) for (const h of [...this.handlers]) h.interim(interim);
    };
    rec.onerror = (e) => {
      sawError = e.error ?? "unknown";
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.rec = null;
      if (this.state === "listening") this.setState("idle");
      if (sawError === "not-allowed" || sawError === "service-not-allowed") {
        this.wanted = false;
        this.setState("blocked");
        return;
      }
      if (sawError === "language-not-supported") {
        this.fail(true);
        return;
      }
      // silence and a quick abort are normal; a real error counts against the ear
      const failed = sawError !== null && sawError !== "no-speech" && sawError !== "aborted";
      if (failed) {
        this.failures += 1;
        if (this.failures >= MAX_FAILURES) {
          this.fail(true);
          return;
        }
      }
      this.delay = nextBackoff(this.delay, this.heard);
      if (this.wanted) this.schedule(this.delay);
    };

    this.rec = rec;
    try {
      rec.start();
    } catch {
      this.rec = null;
      this.failures += 1;
      if (this.failures >= MAX_FAILURES) this.fail(true);
      else if (this.wanted) this.schedule(nextBackoff(this.delay, false));
    }
  }

  private schedule(ms: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.launch();
    }, ms);
  }

  private fail(giveUp = false): void {
    if (giveUp || this.failures >= MAX_FAILURES) {
      this.wanted = false;
      this.failedAt = this.now();
      this.setState("error");
    }
  }
}
