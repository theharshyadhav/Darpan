import type { DemoReason } from "@/lib/api";
import type { ScanErrorKind } from "@/lib/persona/copy";
import { minutesUntilRescan } from "@/lib/skin/compare";
import { demoScores } from "@/lib/skin/demo";
import { computeConfidence } from "@/lib/skin/report";
import type { ScoreMap, SkinScan } from "@/lib/skin/types";
import type { ScanSource } from "@/lib/types";
import { StabilityTracker } from "@/lib/vision/frame";
import { randomId, type PersistedData } from "../data";
import type { Host } from "../host";
import type { Photo } from "../ports";
import { HINT_LINE, hintFor, shouldSpeakHint, type HintMemory } from "./hints";

/**
 * One skin scan, from "face me" to numbers. It frames the face with spoken hints, counts down,
 * takes the photo, asks YouCam (or, in Demo Mode, makes clearly labelled sample numbers on this
 * device, sending nothing anywhere), and hands back a `SkinScan`. It never speaks about the
 * result: the controller does that, so every report and verdict is worded in one place.
 */

export type ScanPurpose = "scan" | "verify";
export type SampleReason = DemoReason | "unavailable";

export interface ScanOutcome {
  scan: SkinScan;
  purpose: ScanPurpose;
  /** Present when the numbers are samples, and why. */
  sampleReason?: SampleReason;
}

export interface ScanRequest {
  purpose: ScanPurpose;
  /** A photo chosen from the device instead of the camera. */
  file?: File;
  /** The ritual a verify scan checks on. */
  ritualId?: string;
}

type Measured =
  | { kind: "ok"; scores: ScoreMap; ita?: number; source: ScanSource; sampleReason?: SampleReason }
  | { kind: "error"; error: ScanErrorKind }
  | { kind: "cancelled" };

const FRAME_TICK_MS = 180;
const FRAME_TIMEOUT_MS = 60_000;
const FRAME_TIMEOUT_MANUAL_MS = 120_000;
const COUNT_BEAT_MS = 900;
const HOLD_MS = 1200;
const POLL_TIMEOUT_MS = 90_000;
const LONG_AFTER_MS = 12_000;
const SAMPLE_THINK_MS = 1400;

export function lastLiveScan(d: PersistedData): SkinScan | null {
  for (let i = d.scans.length - 1; i >= 0; i -= 1) if (d.scans[i]!.source === "youcam") return d.scans[i]!;
  return null;
}

export class ScanFlow {
  private token = 0;
  private wantCapture = false;

  constructor(
    private readonly host: Host,
    private readonly done: (outcome: ScanOutcome) => void,
  ) {}

  /** A scan is under way (including the moment the photo is on its way to be measured). */
  get active(): boolean {
    const n = this.host.state().scan.name;
    return n !== "idle" && n !== "error";
  }

  /** The person can still back out: nothing has been sent anywhere yet. */
  get cancellable(): boolean {
    const n = this.host.state().scan.name;
    return n === "preparing" || n === "framing" || n === "countdown";
  }

  /** Drop whatever is happening and clear the scan state. */
  cancel(): void {
    this.token += 1;
    this.wantCapture = false;
    if (this.host.state().scan.name !== "idle") this.host.patch({ scan: { name: "idle" } });
  }

  /** The "capture now" button: take the photo without waiting for the steady hold. */
  captureNow(): void {
    if (this.host.state().scan.name === "framing") this.wantCapture = true;
  }

  async run(req: ScanRequest): Promise<void> {
    const h = this.host;
    if (this.active) {
      h.notice("busy");
      return;
    }
    const token = ++this.token;
    const alive = () => token === this.token;
    h.patch({ scan: { name: "preparing" }, notice: null });

    const status = await h.ensureStatus();
    if (!alive()) return;
    const live = status?.skin === "live";

    if (live) {
      const data = h.state().data;
      // a photo leaves this device only after an explicit tap, never on a spoken "yes"
      if (!data.settings.consentScan) {
        h.patch({ scan: { name: "idle" } });
        h.ask({ kind: "consent_scan", resume: { what: req.purpose } });
        h.line("consent_scan_needed", {});
        return;
      }
      if (req.purpose === "scan") {
        const last = lastLiveScan(data);
        const wait = minutesUntilRescan(last ? last.at : null, h.platform.now());
        if (wait > 0) {
          h.patch({ scan: { name: "idle" } });
          h.line("scan_cooldown", { minutes: wait });
          return;
        }
      }
    }

    // ---- the photo
    const eyes = h.platform.eyes;
    let photo: Photo | null = null;
    if (req.file) {
      photo = await eyes.fromFile(req.file);
      if (!alive()) return;
      if (!photo) {
        h.notice("photo_unreadable");
        this.fail("generic", req.purpose);
        return;
      }
    } else {
      const cam = eyes.state === "on" ? "on" : await h.ensureCamera();
      if (!alive()) return;
      if (cam === "on") {
        const got = await this.frame(token);
        if (got === "cancelled") return;
        if (got === "timeout") return this.fail("no_face", req.purpose);
        if (got === "failed") return this.fail("generic", req.purpose);
        photo = got;
      } else if (live) {
        h.patch({ scan: { name: "error", kind: "camera", retryable: true } });
        h.line("camera_denied", {});
        return;
      }
      // Demo Mode without a camera: sample numbers need no photo at all
    }

    // ---- the numbers
    h.patch({ scan: { name: "analyzing", startedAt: h.platform.now(), long: false } });
    const measured = live && photo ? await this.measureLive(token, photo) : await this.measureSample(token, status ? "no_key" : "unavailable");
    if (!alive() || measured.kind === "cancelled") return;
    if (measured.kind === "error") return this.fail(measured.error, req.purpose);

    const now = h.platform.now();
    const lighting = photo?.lighting ?? 0.75;
    const scan: SkinScan = {
      id: randomId("s", now, h.platform.rand),
      at: now,
      source: measured.source,
      scores: measured.scores,
      lighting,
      confidence: computeConfidence({
        lighting,
        ita: measured.ita,
        shortSide: photo ? Math.min(photo.width, photo.height) : undefined,
        source: measured.source,
      }),
      kind: req.purpose === "verify" ? "after" : h.state().data.scans.length === 0 ? "baseline" : "checkin",
      ...(req.ritualId ? { ritualId: req.ritualId } : {}),
    };
    h.patch({ scan: { name: "idle" } });
    this.done({ scan, purpose: req.purpose, sampleReason: measured.sampleReason });
  }

  private fail(kind: ScanErrorKind, purpose: ScanPurpose): void {
    const h = this.host;
    h.patch({ scan: { name: "error", kind, retryable: true } });
    h.line("scan_error", { kind });
    h.ask({ kind: "retry", what: purpose });
  }

  // ------------------------------------------------------------------ framing

  private async frame(token: number): Promise<Photo | "cancelled" | "timeout" | "failed"> {
    const h = this.host;
    const eyes = h.platform.eyes;
    const alive = () => token === this.token;
    const tracker = new StabilityTracker(HOLD_MS);
    const mem: HintMemory = { key: null, spokenAt: -1e9 };
    const began = h.platform.now();
    const limit = eyes.detector === "none" ? FRAME_TIMEOUT_MANUAL_MS : FRAME_TIMEOUT_MS;
    this.wantCapture = false;

    h.patch({ scan: { name: "framing", hint: "no_face", steadyMs: 0, manual: eyes.detector === "none" } });
    h.line("scan_start", {});

    for (;;) {
      if (!alive()) return "cancelled";
      if (h.platform.now() - began > limit) return "timeout";

      const reading = await eyes.analyse();
      if (!alive()) return "cancelled";
      const { hint, ok } = hintFor(reading);
      const now = h.platform.now();
      const steady = tracker.update(ok, reading?.box, reading?.region ?? { w: 1, h: 1 }, now);
      h.patch({ scan: { name: "framing", hint, steadyMs: steady, manual: reading !== null && reading.framing === null } });

      if (shouldSpeakHint(mem, hint, now, h.speaking())) {
        mem.key = hint;
        mem.spokenAt = now;
        if (hint !== "manual") h.line(HINT_LINE[hint], {});
      }

      const manual = this.wantCapture;
      // wait for the hint to finish so the countdown never cuts a sentence short
      if (manual || (ok && tracker.isReady(steady) && !h.speaking())) {
        this.wantCapture = false;
        if (!manual) {
          for (const n of [3, 2, 1] as const) {
            if (!alive()) return "cancelled";
            h.patch({ scan: { name: "countdown", n } });
            h.line("countdown", { n }, { interrupt: true });
            await h.platform.sleep(COUNT_BEAT_MS);
          }
          if (!alive()) return "cancelled";
          // still in the frame? otherwise the photo (and a scan) would be wasted
          const again = hintFor(await eyes.analyse());
          if (!alive()) return "cancelled";
          if (!again.ok) {
            tracker.reset();
            continue;
          }
        }
        h.patch({ scan: { name: "capturing" } });
        const photo = await eyes.capturePhoto();
        if (!alive()) return "cancelled";
        if (!photo) return "failed";
        h.line("captured", {});
        return photo;
      }
      await h.platform.sleep(FRAME_TICK_MS);
    }
  }

  // ------------------------------------------------------------------ numbers

  private sampleNow(reason: SampleReason): Measured {
    const d = this.host.state().data;
    const n = d.scans.filter((s) => s.source === "demo").length;
    return { kind: "ok", scores: demoScores(d.demoSeed, n), source: "demo", sampleReason: reason };
  }

  /** Sample numbers made on this device. A short pause keeps the rhythm of a real reading. */
  private async measureSample(token: number, reason: SampleReason): Promise<Measured> {
    await this.host.platform.sleep(SAMPLE_THINK_MS);
    return token === this.token ? this.sampleNow(reason) : { kind: "cancelled" };
  }

  private failed(error: ScanErrorKind): Measured {
    // YouCam being down is not the person's problem: show clearly labelled samples instead
    return error === "unavailable" ? this.sampleNow("unavailable") : { kind: "error", error };
  }

  private async measureLive(token: number, photo: Photo): Promise<Measured> {
    const h = this.host;
    const api = h.platform.api;
    const alive = () => token === this.token;
    const data = h.state().data;
    const n = data.scans.filter((s) => s.source === "demo").length;

    const start = await api.scanStart(photo.blob, { seed: data.demoSeed, n });
    if (!alive()) return { kind: "cancelled" };
    if (!start.ok) return this.failed(start.error);
    if (start.mode === "demo") return { kind: "ok", scores: start.scores, source: "demo", sampleReason: start.reason };

    const began = h.platform.now();
    let delay = start.pollMs;
    let told = false;
    for (;;) {
      await h.platform.sleep(delay);
      if (!alive()) return { kind: "cancelled" };
      const r = await api.scanPoll(start.ticket);
      if (!alive()) return { kind: "cancelled" };
      if (!r.ok) return this.failed(r.error);
      if (r.status === "success") return { kind: "ok", scores: r.scores, ita: r.ita, source: "youcam" };
      delay = r.pollMs;
      const waited = h.platform.now() - began;
      if (!told && waited > LONG_AFTER_MS) {
        told = true;
        h.patch({ scan: { name: "analyzing", startedAt: began, long: true } });
        h.line("analyzing_long", {});
      }
      if (waited > POLL_TIMEOUT_MS) return { kind: "error", error: "busy" };
    }
  }
}
