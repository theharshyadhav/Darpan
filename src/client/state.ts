import type { DemoReason, StatusResponse } from "@/lib/api";
import type { ConcernKey } from "@/lib/concerns";
import type { LookId } from "@/lib/looks";
import type { ScanErrorKind } from "@/lib/persona/copy";
import type { Category, TimerKind } from "@/lib/ritual/products";
import type { Comparison } from "@/lib/skin/compare";
import type { SkinScan } from "@/lib/skin/types";
import type { PersistedData } from "./data";
import type { CameraState, DetectorKind, EarState } from "./ports";

/** What the screen needs to draw. Plain, immutable data: components never reach into the controller. */

export type Panel = "home" | "scan" | "report" | "ritual" | "verify" | "looks" | "ledger";
export type Phase = "booting" | "welcome" | "asleep" | "awake";

export type HintKey =
  | "no_face"
  | "multi_face"
  | "closer"
  | "back"
  | "shift_left"
  | "shift_right"
  | "lower"
  | "higher"
  | "level"
  | "forward"
  | "dim"
  | "bright"
  | "uneven"
  | "hold"
  | "manual";

export type ScanPhase =
  | { name: "idle" }
  | { name: "preparing" }
  | { name: "framing"; hint: HintKey; steadyMs: number; manual: boolean }
  | { name: "countdown"; n: 1 | 2 | 3 }
  | { name: "capturing" }
  | { name: "analyzing"; startedAt: number; long: boolean }
  | { name: "error"; kind: ScanErrorKind | "camera"; retryable: boolean };

export interface Caption {
  id: number;
  who: "mirror" | "you";
  text: string;
  at: number;
}

export interface ReportView {
  scan: SkinScan;
  strength: ConcernKey | null;
  focus: ConcernKey | null;
  allHigh: boolean;
  /** Why these are sample numbers, when they are. */
  sampleReason?: DemoReason | "unavailable";
}

export interface VerifyView {
  before: SkinScan;
  after: SkinScan;
  comparison: Comparison;
}

export interface LooksView {
  selected: LookId | null;
  status: "idle" | "rendering" | "ready" | "demo" | "error";
  /** The previewed photo as a data URL, when YouCam rendered one. */
  image?: string;
  error?: ScanErrorKind;
  /** Step being coached, or null. */
  coach: { index: number } | null;
}

export interface ProductView {
  status: "idle" | "holding" | "reading" | "found" | "notfound";
  name?: string;
  category?: Category;
}

export interface TimerView {
  id: string;
  kind: TimerKind;
  startedAt: number;
  endsAt: number;
  totalSec: number;
}

export type PendingKind =
  | "forget"
  | "focus"
  | "verify_offer"
  | "verify_anyway"
  | "scan_offer"
  | "confirm_product"
  | "look_coach"
  | "consent_scan"
  | "consent_look"
  | "retry"
  | "category";

export interface VoiceView {
  speaking: boolean;
  ear: EarState;
  /** The person wants the mirror to listen (the mic button is on). */
  listening: boolean;
  /** What the mirror is hearing right now, before the sentence is final. */
  interim: string;
  ttsAvailable: boolean;
}

/** Short, plain-language notices for the screen only (never spoken). The words live in ui-text.ts. */
export type NoticeKey = "busy" | "photo_unreadable";

export interface MirrorState {
  phase: Phase;
  data: PersistedData;
  /** False when the browser refuses storage: nothing will be remembered after this visit. */
  persistent: boolean;
  status: StatusResponse | null;
  panel: Panel;
  sheet: "settings" | null;
  voice: VoiceView;
  camera: { state: CameraState; detector: DetectorKind };
  captions: Caption[];
  /** Waiting on the language model or a network call. */
  thinking: boolean;
  scan: ScanPhase;
  report: ReportView | null;
  verify: VerifyView | null;
  looks: LooksView;
  product: ProductView;
  timers: TimerView[];
  pending: PendingKind | null;
  /** True when the client should offer a photo upload (no camera, or the person prefers it). */
  uploadOffered: boolean;
  notice: NoticeKey | null;
}

export const MAX_CAPTIONS = 8;
