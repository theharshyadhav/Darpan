import type { LineId } from "@/lib/persona/copy";
import type { LightHint } from "@/lib/vision/frame";
import type { FrameReading } from "../ports";
import type { HintKey } from "../state";

/**
 * Turning what the camera sees into one calm instruction at a time. Pure, so the whole framing
 * conversation is tested without a camera.
 */

/** Below this the mirror asks for more light before capturing (the person can still capture manually). */
export const MIN_LIGHT = 0.45;

const LIGHT_KEY: Record<Exclude<LightHint, "ok">, HintKey> = { dim: "dim", bright: "bright", uneven: "uneven" };

export interface HintResult {
  hint: HintKey;
  /** The frame is good enough to start counting steady time. */
  ok: boolean;
}

export function hintFor(r: FrameReading | null): HintResult {
  if (!r) return { hint: "no_face", ok: false };
  if (r.framing === null) {
    // No face detector could be loaded: only the light can be judged, and capture is manual.
    return { hint: r.lighting.hint === "ok" ? "manual" : LIGHT_KEY[r.lighting.hint], ok: false };
  }
  if (!r.framing.ok) {
    const h = r.framing.hint;
    return { hint: h === "ok" ? "hold" : h, ok: false };
  }
  if (r.lighting.score < MIN_LIGHT) return { hint: r.lighting.hint === "ok" ? "dim" : LIGHT_KEY[r.lighting.hint], ok: false };
  return { hint: "hold", ok: true };
}

export const HINT_LINE: Record<Exclude<HintKey, "manual">, LineId> = {
  no_face: "hint_no_face",
  multi_face: "hint_multi_face",
  closer: "hint_closer",
  back: "hint_back",
  shift_left: "hint_shift_left",
  shift_right: "hint_shift_right",
  lower: "hint_lower",
  higher: "hint_higher",
  level: "hint_level",
  forward: "hint_face_forward",
  dim: "hint_more_light",
  bright: "hint_glare",
  uneven: "hint_even_light",
  hold: "hint_hold_still",
};

export interface HintMemory {
  key: HintKey | null;
  spokenAt: number;
}

const MIN_GAP_MS = 2800;
const REPEAT_MS = 9000;

/**
 * Speak a hint only when it is new, only after a pause since the last one, never over the mirror's
 * own voice, and repeat an unchanged one only after a long while. "Hold still" is said once.
 */
export function shouldSpeakHint(mem: HintMemory, key: HintKey, now: number, speaking: boolean): boolean {
  if (key === "manual" || speaking) return false;
  const since = now - mem.spokenAt;
  if (key !== mem.key) return since >= MIN_GAP_MS;
  return key !== "hold" && since >= REPEAT_MS;
}
