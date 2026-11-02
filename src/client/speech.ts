import { sanitizeUtterance } from "@/lib/persona/lint";
import type { Language, Pace } from "@/lib/types";
import type { Speaker } from "./ports";

/**
 * The mirror's voice, one calm sentence at a time.
 *
 * Sentences queue up and are spoken in order; each is shown as a caption the moment it starts. A
 * cancel (the person said "stop", spoke over the mirror, or the screen changed) drops everything
 * that is waiting. Text goes through the claim linter right here, so what appears on screen is
 * exactly what is spoken, and nothing the mirror must not say ever reaches the speaker.
 *
 * When the browser cannot speak at all, the same queue paces captions at reading speed, so the
 * rhythm of the conversation is the same with or without a voice.
 */

export interface SpeechConfig {
  lang(): Language;
  voiceUri(): string;
  pace(): Pace;
}

export interface SpeechHooks {
  /** A sentence has started (show its caption). */
  onStart(text: string): void;
  /** The mirror started or stopped talking (the ear listens only when it is quiet). */
  onSpeaking(speaking: boolean): void;
}

export interface SayOptions {
  /** Drop whatever is queued and say this now (countdowns, "stop"). */
  interrupt?: boolean;
  /** Speak in this language instead of the current one (a goodbye said after the settings are reset). */
  lang?: Language;
}

const PACE_FACTOR: Record<Pace, number> = { calm: 1.15, steady: 1, brisk: 0.8 };

/** How long a caption stays before the next one when nothing is spoken aloud. */
export function readingMs(text: string, pace: Pace): number {
  const base = 900 + Array.from(text).length * 42;
  return Math.round(Math.max(1200, Math.min(7500, base)) * PACE_FACTOR[pace]);
}

export class SpeechQueue {
  private queue: Array<{ text: string; lang: Language }> = [];
  private pumping = false;
  private gen = 0;
  private active = false;
  private waiters: Array<() => void> = [];

  constructor(
    private readonly speaker: Speaker,
    private readonly sleep: (ms: number) => Promise<void>,
    private readonly cfg: SpeechConfig,
    private readonly hooks: SpeechHooks,
  ) {}

  get speaking(): boolean {
    return this.active;
  }

  /** Sentences still waiting, not counting the one being spoken. */
  get waiting(): number {
    return this.queue.length;
  }

  say(raw: string, opts: SayOptions = {}): void {
    const clean = sanitizeUtterance(raw.replace(/\s+/g, " ").trim(), "");
    if (!clean.text) return;
    // an interrupt replaces the queue without a gap, so the ear never sees a flicker of silence
    if (opts.interrupt) this.abort(true);
    this.queue.push({ text: clean.text, lang: opts.lang ?? this.cfg.lang() });
    if (!this.pumping) void this.pump();
  }

  /** Stop talking and forget everything that was waiting. */
  cancel(): void {
    this.abort(false);
  }

  private abort(keepActive: boolean): void {
    this.gen += 1;
    this.queue = [];
    this.pumping = false;
    this.speaker.cancel();
    if (!keepActive) this.setActive(false);
  }

  /** Resolves once nothing is being spoken and nothing is waiting. */
  idle(): Promise<void> {
    if (!this.active && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private setActive(on: boolean): void {
    if (this.active === on) {
      if (!on) this.wake();
      return;
    }
    this.active = on;
    this.hooks.onSpeaking(on);
    if (!on) this.wake();
  }

  private wake(): void {
    if (this.active || this.queue.length > 0) return;
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) w();
  }

  private async pump(): Promise<void> {
    this.pumping = true;
    const gen = this.gen;
    try {
      while (this.queue.length > 0) {
        if (gen !== this.gen) return;
        const item = this.queue.shift()!;
        this.setActive(true);
        this.hooks.onStart(item.text);
        await this.speakOne(item.text, item.lang);
        if (gen !== this.gen) return;
      }
    } finally {
      // a cancel has already reset the flag and handed the queue to a newer pump
      if (gen === this.gen) {
        this.pumping = false;
        this.setActive(false);
      }
    }
  }

  private async speakOne(text: string, lang: Language): Promise<void> {
    const pace = this.cfg.pace();
    try {
      if (this.speaker.available) await this.speaker.speak(text, lang, { voiceUri: this.cfg.voiceUri(), pace });
      else await this.sleep(readingMs(text, pace));
    } catch {
      // the speaker contract is "never rejects"; if one does, the sentence is simply skipped
    }
  }
}
