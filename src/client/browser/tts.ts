import { languageTag } from "@/lib/persona/titles";
import type { Language, Pace } from "@/lib/types";
import type { Speaker } from "../ports";
import { chunkSentences, hasVoiceFor, pickVoice, rateFor, watchdogMs, type VoiceLike } from "./voices";

/**
 * The mirror's voice in the browser (speechSynthesis).
 *
 * Three things here exist because browsers are quirky:
 *  - the first piece is handed to the browser synchronously, inside the tap that woke the mirror,
 *    because some browsers only allow speech started inside a user gesture;
 *  - long sentences are cut into short pieces, because Chrome silently stops long ones;
 *  - a watchdog moves on if the browser never says it finished (a known failure in Chrome and
 *    Safari), and a start guard retries once if the browser dropped a piece without a sound.
 */

export interface SynthLike {
  speaking: boolean;
  paused: boolean;
  speak(u: SpeechSynthesisUtterance): void;
  cancel(): void;
  resume(): void;
  getVoices(): SpeechSynthesisVoice[];
}

export type UtteranceCtor = new (text: string) => SpeechSynthesisUtterance;

const START_GUARD_MS = 2200;

function defaultSynth(): SynthLike | null {
  if (typeof window === "undefined") return null;
  return window.speechSynthesis ?? null;
}

function defaultUtterance(): UtteranceCtor | null {
  return typeof SpeechSynthesisUtterance !== "undefined" ? SpeechSynthesisUtterance : null;
}

function defaultBrowserLang(): string | undefined {
  return typeof navigator !== "undefined" ? navigator.language : undefined;
}

export class BrowserSpeaker implements Speaker {
  readonly available: boolean;
  private current: { finish: () => void } | null = null;

  constructor(
    private readonly synth: SynthLike | null = defaultSynth(),
    private readonly Utterance: UtteranceCtor | null = defaultUtterance(),
    private readonly browserLang: () => string | undefined = defaultBrowserLang,
  ) {
    this.available = this.synth !== null && this.Utterance !== null;
  }

  speak(text: string, lang: Language, opts: { voiceUri: string; pace: Pace }): Promise<void> {
    const synth = this.synth;
    const Utterance = this.Utterance;
    if (!synth || !Utterance) return Promise.resolve();
    const pieces = chunkSentences(text);
    if (pieces.length === 0) return Promise.resolve();

    const tag = languageTag(lang, this.browserLang());
    const rate = rateFor(opts.pace);

    return new Promise<void>((resolve) => {
      let finished = false;
      let index = 0;
      const timers = new Set<ReturnType<typeof setTimeout>>();
      const clearTimers = () => {
        for (const t of timers) clearTimeout(t);
        timers.clear();
      };
      const later = (fn: () => void, ms: number) => {
        const t = setTimeout(() => {
          timers.delete(t);
          fn();
        }, ms);
        timers.add(t);
      };
      const handle = {
        finish: () => {
          if (finished) return;
          finished = true;
          clearTimers();
          if (this.current === handle) this.current = null;
          resolve();
        },
      };
      this.current = handle;

      const nextPiece = () => {
        if (finished) return;
        if (index >= pieces.length) return handle.finish();
        const piece = pieces[index]!;
        index += 1;
        speakPiece(piece, false);
      };

      const speakPiece = (piece: string, isRetry: boolean) => {
        let settled = false;
        let started = false;
        const settle = (advance: boolean) => {
          if (settled) return;
          settled = true;
          clearTimers();
          if (finished) return;
          if (advance) nextPiece();
          else handle.finish();
        };

        let u: SpeechSynthesisUtterance;
        try {
          u = new Utterance(piece);
        } catch {
          return settle(true);
        }
        u.lang = tag;
        u.rate = rate;
        u.pitch = 1;
        u.volume = 1;
        const voice = pickVoice(synth.getVoices() as unknown as VoiceLike[], tag, opts.voiceUri) as unknown as SpeechSynthesisVoice | null;
        if (voice) u.voice = voice;
        u.onstart = () => {
          started = true;
        };
        u.onend = () => settle(true);
        u.onerror = (e) => {
          const why = (e as SpeechSynthesisErrorEvent).error;
          // a cancel is the queue telling us to stop; anything else, skip the piece and carry on
          settle(why !== "canceled" && why !== "interrupted");
        };

        try {
          if (synth.paused) synth.resume();
          synth.speak(u);
        } catch {
          return settle(true);
        }

        // some browsers drop a piece without a sound or an event: try once more, then move on
        later(() => {
          if (settled || started || synth.speaking) return;
          if (isRetry) return settle(true);
          settled = true;
          clearTimers();
          try {
            synth.cancel();
          } catch {
            /* nothing more to do */
          }
          if (!finished) speakPiece(piece, true);
        }, START_GUARD_MS);
        later(() => {
          if (settled) return;
          // the browser never said it was done: stop that piece and go on
          settled = true;
          clearTimers();
          try {
            synth.cancel();
          } catch {
            /* nothing more to do */
          }
          nextPiece();
        }, watchdogMs(piece, rate));
      };

      nextPiece(); // synchronous on purpose: this is still inside the person's tap
    });
  }

  cancel(): void {
    try {
      this.synth?.cancel();
    } catch {
      /* nothing more to do */
    }
    this.current?.finish();
  }

  /** The voices installed on this device, for the settings picker. */
  voices(): VoiceLike[] {
    try {
      return (this.synth?.getVoices() ?? []).map((v) => ({ name: v.name, lang: v.lang, voiceURI: v.voiceURI, localService: v.localService }));
    } catch {
      return [];
    }
  }

  /** False when no installed voice speaks the language (the captions still carry the words). */
  canSpeak(lang: Language): boolean {
    return this.available && hasVoiceFor(this.voices(), lang, this.browserLang());
  }

  /** Voices load late in some browsers: be told when the list changes. */
  onVoicesChanged(fn: () => void): () => void {
    const s = this.synth as unknown as EventTarget | null;
    if (!s || typeof s.addEventListener !== "function") return () => {};
    s.addEventListener("voiceschanged", fn);
    return () => s.removeEventListener("voiceschanged", fn);
  }
}
