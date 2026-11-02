import { browserApi } from "../api";
import { browserStorage, DataStore } from "../data";
import type { Ear, Eyes, Platform, Speaker } from "../ports";
import { BrowserEyes } from "./eyes";
import { BrowserSpeaker } from "./tts";
import { BrowserEar } from "./stt";

/**
 * The real Platform: this browser's camera, voice, ear, storage and network. Nothing here runs on
 * the server; `createServerPlatform` is an inert stand-in used only to compute the first render.
 */

export interface BrowserPlatform extends Platform {
  eyes: BrowserEyes;
  speaker: BrowserSpeaker;
  ear: BrowserEar;
}

/** A soft two-note chime, made with the Web Audio API so no sound file has to be shipped. */
function makeChime(): { chime: () => void; unlock: () => void } {
  let ctx: AudioContext | null = null;
  const get = (): AudioContext | null => {
    if (ctx) return ctx;
    const Ctor = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      ctx = null;
    }
    return ctx;
  };
  return {
    // a browser only lets audio start after a gesture, so the context is made on the first tap or key
    unlock: () => {
      const c = get();
      if (c && c.state === "suspended") void c.resume().catch(() => {});
    },
    chime: () => {
      const c = get();
      if (!c) return;
      if (c.state === "suspended") void c.resume().catch(() => {});
      const t0 = c.currentTime + 0.02;
      [660, 880].forEach((hz, i) => {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = "sine";
        osc.frequency.value = hz;
        const at = t0 + i * 0.18;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.12, at + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.9);
        osc.connect(gain).connect(c.destination);
        osc.start(at);
        osc.stop(at + 1);
      });
    },
  };
}

export function createPlatform(): BrowserPlatform {
  const audio = makeChime();
  if (typeof document !== "undefined") {
    const once = () => {
      audio.unlock();
      document.removeEventListener("pointerdown", once);
      document.removeEventListener("keydown", once);
    };
    document.addEventListener("pointerdown", once, { passive: true });
    document.addEventListener("keydown", once);
  }
  return {
    api: browserApi(),
    eyes: new BrowserEyes(),
    speaker: new BrowserSpeaker(),
    ear: new BrowserEar(),
    store: new DataStore(browserStorage()),
    now: () => Date.now(),
    rand: () => Math.random(),
    sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    chime: audio.chime,
    browserLanguage: () => (typeof navigator !== "undefined" ? navigator.language : "en"),
  };
}

/** Does nothing, answers nothing. Only used to compute the very first render on the server. */
export function createServerPlatform(): Platform {
  const eyes: Eyes = {
    state: "off",
    detector: "none",
    start: async () => "off",
    stop: () => {},
    analyse: async () => null,
    capturePhoto: async () => null,
    captureLabel: async () => null,
    fromFile: async () => null,
    subscribe: () => () => {},
  };
  const speaker: Speaker = { available: false, speak: async () => {}, cancel: () => {} };
  const ear: Ear = { available: false, start: () => {}, stop: () => {}, subscribe: () => () => {} };
  return {
    api: {
      status: async () => null,
      chat: async () => ({ ok: false, error: "llm_off" }),
      lookAtProduct: async () => ({ ok: true, found: false }),
      scanStart: async () => ({ ok: false, error: "unavailable" }),
      scanPoll: async () => ({ ok: false, error: "unavailable" }),
      previewStart: async () => ({ ok: false, error: "unavailable" }),
      previewPoll: async () => ({ ok: false, error: "unavailable" }),
    },
    eyes,
    speaker,
    ear,
    store: new DataStore(null),
    now: () => 0,
    rand: () => 0,
    sleep: () => new Promise<void>(() => {}),
  };
}
