/**
 * Pure maths for the mirror's eyes: how bright and even is the light, is the face well framed,
 * and has the person held still long enough to capture. Everything here is deterministic and
 * testable without a camera. The browser glue lives in src/lib/vision/camera.ts.
 */

// ---------------------------------------------------------------- lighting

export interface LumaStats {
  /** Mean luma 0-255 over the sampled region. */
  mean: number;
  /** Mean luma of the left and right halves (0-255). */
  left: number;
  right: number;
  /** Fraction of sampled pixels that are nearly white / nearly black. */
  clippedHigh: number;
  clippedLow: number;
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Sample RGBA pixels on a grid and return luma statistics (Rec. 709 weights). */
export function lumaStats(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  region?: Region,
  step = 3,
): LumaStats {
  const r: Region = region ?? {
    x: Math.round(width * 0.2),
    y: Math.round(height * 0.12),
    w: Math.round(width * 0.6),
    h: Math.round(height * 0.7),
  };
  let sum = 0;
  let sumL = 0;
  let sumR = 0;
  let nL = 0;
  let nR = 0;
  let n = 0;
  let hi = 0;
  let lo = 0;
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(width, r.x + r.w);
  const y1 = Math.min(height, r.y + r.h);
  const mid = (x0 + x1) / 2;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * width + x) * 4;
      const l = 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
      sum += l;
      n += 1;
      if (x < mid) {
        sumL += l;
        nL += 1;
      } else {
        sumR += l;
        nR += 1;
      }
      if (l >= 248) hi += 1;
      if (l <= 10) lo += 1;
    }
  }
  if (n === 0) return { mean: 0, left: 0, right: 0, clippedHigh: 0, clippedLow: 0 };
  return {
    mean: sum / n,
    left: nL ? sumL / nL : 0,
    right: nR ? sumR / nR : 0,
    clippedHigh: hi / n,
    clippedLow: lo / n,
  };
}

export type LightHint = "ok" | "dim" | "bright" | "uneven";

export interface LightingAssessment {
  /** 0-1. */
  score: number;
  hint: LightHint;
  ok: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function assessLighting(s: LumaStats): LightingAssessment {
  const even = 1 - Math.abs(s.left - s.right) / Math.max(s.left, s.right, 1);

  let brightness: number;
  if (s.mean < 70) brightness = clamp(s.mean / 70, 0, 1) * 0.6;
  else if (s.mean < 95) brightness = 0.6 + ((s.mean - 70) / 25) * 0.4;
  else if (s.mean <= 190) brightness = 1;
  else if (s.mean <= 225) brightness = 1 - ((s.mean - 190) / 35) * 0.5;
  else brightness = 0.3;

  const evenScore = clamp((even - 0.55) / 0.35, 0, 1);
  const clipPenalty = clamp((s.clippedHigh - 0.04) * 4, 0, 0.35);
  const score = clamp(brightness * (0.6 + 0.4 * evenScore) * (1 - clipPenalty), 0, 1);

  let hint: LightHint = "ok";
  if (s.mean < 80) hint = "dim";
  else if (s.mean > 210 || s.clippedHigh > 0.1) hint = "bright";
  else if (even < 0.72) hint = "uneven";

  return { score: Math.round(score * 100) / 100, hint, ok: hint === "ok" && score >= 0.62 };
}

// ----------------------------------------------------------------- framing

export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Pt {
  x: number;
  y: number;
}

export interface FaceKeypoints {
  rightEye?: Pt;
  leftEye?: Pt;
  nose?: Pt;
  rightEar?: Pt;
  leftEar?: Pt;
}

export type FramingHint =
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
  | "ok";

export interface FramingInput {
  faces: number;
  /** Face box in capture-region pixels (the 3:4 crop the person sees in the mirror). */
  box?: FaceBox;
  keypoints?: FaceKeypoints;
  region: { w: number; h: number };
  /** Smallest acceptable face width as a fraction of region width. YouCam requires over 60%. */
  minWidthRatio?: number;
}

export interface FramingResult {
  ok: boolean;
  hint: FramingHint;
  widthRatio: number;
  rollDeg: number;
  yaw: number;
}

export const DEFAULT_MIN_WIDTH_RATIO = 0.58;
const MAX_WIDTH_RATIO = 0.92;
const CENTER_TOLERANCE_X = 0.09;
const TARGET_CENTER_Y = 0.46;
const CENTER_TOLERANCE_Y = 0.1;
const MAX_ROLL_DEG = 8;
const MAX_YAW = 0.2;

export function evaluateFraming(i: FramingInput): FramingResult {
  const empty = { widthRatio: 0, rollDeg: 0, yaw: 0 };
  if (i.faces === 0 || !i.box) return { ok: false, hint: "no_face", ...empty };
  if (i.faces > 1) return { ok: false, hint: "multi_face", ...empty };

  const { box, region } = i;
  const widthRatio = box.w / region.w;
  const cx = (box.x + box.w / 2) / region.w;
  const cy = (box.y + box.h / 2) / region.h;
  const minRatio = i.minWidthRatio ?? DEFAULT_MIN_WIDTH_RATIO;

  // pose, from keypoints when we have them
  let rollDeg = 0;
  let yaw = 0;
  const k = i.keypoints;
  if (k?.rightEye && k.leftEye) {
    rollDeg = (Math.atan2(k.leftEye.y - k.rightEye.y, k.leftEye.x - k.rightEye.x) * 180) / Math.PI;
    if (k.nose) {
      const midEyes = (k.rightEye.x + k.leftEye.x) / 2;
      const eyeDist = Math.abs(k.leftEye.x - k.rightEye.x) || 1;
      yaw = (k.nose.x - midEyes) / eyeDist;
      if (k.rightEar && k.leftEar) {
        const midEars = (k.rightEar.x + k.leftEar.x) / 2;
        const earDist = Math.abs(k.leftEar.x - k.rightEar.x) || 1;
        yaw = (k.nose.x - midEars) / earDist;
      }
    }
  }
  const result = (hint: FramingHint): FramingResult => ({
    ok: hint === "ok",
    hint,
    widthRatio: Math.round(widthRatio * 100) / 100,
    rollDeg: Math.round(rollDeg * 10) / 10,
    yaw: Math.round(yaw * 100) / 100,
  });

  if (widthRatio < minRatio) return result("closer");
  if (widthRatio > MAX_WIDTH_RATIO) return result("back");
  // Raw (un-mirrored) camera coordinates: a face on the image's right means the person is to
  // their own left of the camera, so they should move to their right.
  if (cx > 0.5 + CENTER_TOLERANCE_X) return result("shift_right");
  if (cx < 0.5 - CENTER_TOLERANCE_X) return result("shift_left");
  if (cy < TARGET_CENTER_Y - CENTER_TOLERANCE_Y) return result("lower");
  if (cy > TARGET_CENTER_Y + CENTER_TOLERANCE_Y) return result("higher");
  if (Math.abs(rollDeg) > MAX_ROLL_DEG) return result("level");
  if (Math.abs(yaw) > MAX_YAW) return result("forward");
  return result("ok");
}

// --------------------------------------------------------------- stability

/**
 * Tracks how long the person has been well framed AND still. Auto-capture fires once the
 * face has been OK and steady for `holdMs`. Any wobble or a bad frame resets the clock.
 */
export class StabilityTracker {
  private since: number | null = null;
  private last: { cx: number; cy: number; w: number } | null = null;

  constructor(
    private readonly holdMs = 1200,
    private readonly maxMove = 0.025,
  ) {}

  reset(): void {
    this.since = null;
    this.last = null;
  }

  /** Feed one analysed frame. Returns how long (ms) the person has been steady, 0 if not. */
  update(ok: boolean, box: FaceBox | undefined, region: { w: number; h: number }, now: number): number {
    if (!ok || !box) {
      this.reset();
      return 0;
    }
    const cur = { cx: (box.x + box.w / 2) / region.w, cy: (box.y + box.h / 2) / region.h, w: box.w / region.w };
    if (this.last) {
      const move = Math.hypot(cur.cx - this.last.cx, cur.cy - this.last.cy) + Math.abs(cur.w - this.last.w) * 0.5;
      if (move > this.maxMove) this.since = now;
    }
    this.last = cur;
    if (this.since === null) this.since = now;
    return now - this.since;
  }

  isReady(steadyMs: number): boolean {
    return steadyMs >= this.holdMs;
  }
}

// ------------------------------------------------------------------ capture

/** The largest centred rectangle with the given width/height ratio inside a source frame. */
export function captureRegion(
  srcW: number,
  srcH: number,
  ratio = 3 / 4,
): { sx: number; sy: number; sw: number; sh: number } {
  let sw = srcW;
  let sh = Math.round(sw / ratio);
  if (sh > srcH) {
    sh = srcH;
    sw = Math.round(sh * ratio);
  }
  return { sx: Math.round((srcW - sw) / 2), sy: Math.round((srcH - sh) / 2), sw, sh };
}

/** Output size for the uploaded photo: long side capped, short side lifted to YouCam's minimum. */
export function targetSize(
  sw: number,
  sh: number,
  maxLong = 1600,
  minShort = 640,
): { w: number; h: number; upscaled: boolean } {
  let scale = 1;
  const long = Math.max(sw, sh);
  const short = Math.min(sw, sh);
  if (long > maxLong) scale = maxLong / long;
  let upscaled = false;
  if (short * scale < minShort) {
    scale = minShort / short;
    upscaled = true;
  }
  return { w: Math.round(sw * scale), h: Math.round(sh * scale), upscaled };
}
