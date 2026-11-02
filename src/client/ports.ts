import type { Language, Pace } from "@/lib/types";
import type { FaceBox, FramingResult, LightingAssessment } from "@/lib/vision/frame";
import type { Api } from "./api";
import type { DataStore } from "./data";

/**
 * Everything the controller needs from the outside world, as small interfaces. The browser supplies
 * real ones (camera, speech, storage); tests supply fakes, so whole conversations, scans and rituals
 * are tested without a browser.
 */

export type CameraState = "off" | "starting" | "on" | "denied" | "unavailable";
export type DetectorKind = "mediapipe" | "native" | "none" | "loading";

export interface FrameReading {
  /** Face box in capture-region pixels, present when exactly one face is found. */
  box?: FaceBox;
  faces: number;
  region: { w: number; h: number };
  /** Null when no face detector could be loaded: the mirror then relies on lighting and a manual capture. */
  framing: FramingResult | null;
  lighting: LightingAssessment;
}

export interface Photo {
  blob: Blob;
  width: number;
  height: number;
  /** Light quality 0-1 measured when the photo was taken, when known. */
  lighting?: number;
}

export interface Eyes {
  readonly state: CameraState;
  readonly detector: DetectorKind;
  /** Ask for the camera. Resolves with the resulting state; never throws. */
  start(): Promise<CameraState>;
  stop(): void;
  /** Look at the live frame now. Null when there is no live frame. */
  analyse(): Promise<FrameReading | null>;
  /** The 3:4 mirror crop, sized for YouCam (face wide enough, long side capped). */
  capturePhoto(): Promise<Photo | null>;
  /** A smaller, uncropped frame for reading a product label. */
  captureLabel(): Promise<Blob | null>;
  /** A photo chosen from the device instead of the camera. */
  fromFile(file: File): Promise<Photo | null>;
  subscribe(listener: () => void): () => void;
}

export interface Speaker {
  readonly available: boolean;
  /** Resolves when the sentence has been spoken, or was cancelled. Never rejects. */
  speak(text: string, lang: Language, opts: { voiceUri: string; pace: Pace }): Promise<void>;
  cancel(): void;
}

export type EarState = "idle" | "listening" | "blocked" | "unsupported" | "error";

export interface EarHandlers {
  interim(text: string): void;
  final(text: string): void;
  state(state: EarState): void;
}

export interface Ear {
  readonly available: boolean;
  /** Begin (or keep) listening. Safe to call repeatedly. */
  start(lang: Language): void;
  stop(): void;
  subscribe(handlers: EarHandlers): () => void;
}

export interface Platform {
  api: Api;
  eyes: Eyes;
  speaker: Speaker;
  ear: Ear;
  store: DataStore;
  now(): number;
  rand(): number;
  sleep(ms: number): Promise<void>;
  /** A soft chime for finished timers. Optional. */
  chime?(): void;
  /** Reads the browser's own language, used only to choose a speech voice. */
  browserLanguage?(): string;
}
