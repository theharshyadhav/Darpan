import type { FaceDetector as MediaPipeFaceDetector } from "@mediapipe/tasks-vision";
import { assessLighting, captureRegion, evaluateFraming, lumaStats, targetSize, type FaceBox, type FaceKeypoints } from "@/lib/vision/frame";
import type { CameraState, DetectorKind, Eyes, FrameReading, Photo } from "../ports";
import { LOCAL_MODEL_URL, LOCAL_WASM_BASE, REMOTE_MODEL_URL } from "./detector-config";

/**
 * The mirror's eyes in the browser: the camera, the face detector, and the photo capture.
 *
 * The camera frame is read from a hidden <video>; the visible mirror is a second <video> showing
 * the same stream (see `stream`). Nothing is ever recorded: frames are drawn to a canvas, measured
 * for light and face position, and thrown away. A photo is made only when a scan, a look preview or
 * a label reading asks for one, and it lives in memory until it has been sent.
 */

interface NativeFace {
  boundingBox: { x: number; y: number; width: number; height: number };
  landmarks?: Array<{ type: string; locations: Array<{ x: number; y: number }> }>;
}
interface NativeDetector {
  detect(source: CanvasImageSource): Promise<NativeFace[]>;
}
type NativeDetectorCtor = new (opts?: { fastMode?: boolean; maxDetectedFaces?: number }) => NativeDetector;

interface Found {
  boxes: FaceBox[];
  /** Keypoints of the first face, in source-frame pixels. */
  keypoints?: FaceKeypoints;
}

const SAMPLE_W = 180;
const SAMPLE_H = 240;
const MAX_UPLOAD_SIDE = 1600;
const MIN_SHORT_SIDE = 640;
const LABEL_SIDE = 1024;
const DETECTOR_WAIT_MS = 7000;
const MAX_FILE_BYTES = 20_000_000;

export class BrowserEyes implements Eyes {
  state: CameraState = "off";
  detector: DetectorKind = "loading";
  /** The live camera stream, for the visible mirror to show. */
  stream: MediaStream | null = null;

  private readonly subs = new Set<() => void>();
  private video: HTMLVideoElement | null = null;
  private starting: Promise<CameraState> | null = null;
  private mp: MediaPipeFaceDetector | null = null;
  private native: NativeDetector | null = null;
  private detectorLoad: Promise<void> | null = null;
  private lastTs = 0;
  private sample: HTMLCanvasElement | null = null;

  subscribe(listener: () => void): () => void {
    this.subs.add(listener);
    return () => {
      this.subs.delete(listener);
    };
  }

  private emit(): void {
    for (const s of [...this.subs]) s();
  }

  private set(state: CameraState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit();
  }

  // ------------------------------------------------------------------- camera

  start(): Promise<CameraState> {
    if (this.state === "on" && this.stream?.active) return Promise.resolve("on");
    if (this.starting) return this.starting;
    this.starting = this.open().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async open(): Promise<CameraState> {
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!md || typeof md.getUserMedia !== "function") {
      this.set("unavailable");
      return this.state;
    }
    this.set("starting");
    let stream: MediaStream;
    try {
      stream = await md.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
    } catch (e) {
      const name = e instanceof DOMException || e instanceof Error ? e.name : "";
      if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
        this.set("denied");
        return this.state;
      }
      try {
        // a camera that cannot meet the preferred size still works with the plainest request
        stream = await md.getUserMedia({ video: true, audio: false });
      } catch (e2) {
        const n2 = e2 instanceof DOMException || e2 instanceof Error ? e2.name : "";
        this.set(n2 === "NotAllowedError" || n2 === "SecurityError" ? "denied" : "unavailable");
        return this.state;
      }
    }

    this.stream = stream;
    for (const t of stream.getVideoTracks()) {
      t.addEventListener("ended", () => {
        if (this.stream === stream) this.release();
      });
    }
    const video = this.ensureVideo();
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      /* autoplay is allowed for a muted video; if not, the first frames still arrive */
    }
    this.set("on");
    void this.loadDetector();
    return this.state;
  }

  private ensureVideo(): HTMLVideoElement {
    if (this.video) return this.video;
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    v.setAttribute("aria-hidden", "true");
    v.tabIndex = -1;
    // not display:none: some browsers stop decoding hidden video
    v.style.cssText = "position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;left:0;top:0";
    document.body.appendChild(v);
    this.video = v;
    return v;
  }

  stop(): void {
    this.release();
  }

  private release(): void {
    const s = this.stream;
    this.stream = null;
    if (s) for (const t of s.getTracks()) t.stop();
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
    this.set("off");
    this.emit(); // the visible mirror drops its stream even if the state did not change
  }

  private ready(): HTMLVideoElement | null {
    const v = this.video;
    if (this.state !== "on" || !v || v.readyState < 2 || v.videoWidth === 0 || v.videoHeight === 0) return null;
    return v;
  }

  // ----------------------------------------------------------------- detector

  private loadDetector(): Promise<void> {
    if (!this.detectorLoad) this.detectorLoad = this.pickDetector();
    return this.detectorLoad;
  }

  private async pickDetector(): Promise<void> {
    this.detector = "loading";
    this.emit();
    const mp = await this.tryMediaPipe(LOCAL_MODEL_URL).catch(() => null) ?? (await this.tryMediaPipe(REMOTE_MODEL_URL).catch(() => null));
    if (mp) {
      this.mp = mp;
      this.detector = "mediapipe";
      this.emit();
      return;
    }
    const Native = (globalThis as unknown as { FaceDetector?: NativeDetectorCtor }).FaceDetector;
    if (Native) {
      try {
        this.native = new Native({ fastMode: true, maxDetectedFaces: 3 });
        this.detector = "native";
        this.emit();
        return;
      } catch {
        /* fall through to manual capture */
      }
    }
    this.detector = "none";
    this.emit();
  }

  private async tryMediaPipe(modelUrl: string): Promise<MediaPipeFaceDetector | null> {
    const { FilesetResolver, FaceDetector } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(LOCAL_WASM_BASE);
    for (const delegate of ["GPU", "CPU"] as const) {
      try {
        return await FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: modelUrl, delegate },
          runningMode: "VIDEO",
          minDetectionConfidence: 0.55,
        });
      } catch {
        /* try the next delegate */
      }
    }
    return null;
  }

  private async detect(video: HTMLVideoElement): Promise<Found | null> {
    if (this.mp) {
      const ts = Math.max(performance.now(), this.lastTs + 1);
      this.lastTs = ts;
      const res = this.mp.detectForVideo(video, ts);
      const boxes: FaceBox[] = [];
      let keypoints: FaceKeypoints | undefined;
      for (const d of res.detections) {
        const b = d.boundingBox;
        if (!b) continue;
        boxes.push({ x: b.originX, y: b.originY, w: b.width, h: b.height });
        if (!keypoints && d.keypoints && d.keypoints.length >= 6) {
          const px = (i: number) => ({ x: d.keypoints[i]!.x * video.videoWidth, y: d.keypoints[i]!.y * video.videoHeight });
          // BlazeFace order: right eye, left eye, nose tip, mouth, right ear, left ear
          keypoints = { rightEye: px(0), leftEye: px(1), nose: px(2), rightEar: px(4), leftEar: px(5) };
        }
      }
      return { boxes, keypoints };
    }
    if (this.native) {
      const faces = await this.native.detect(video);
      const boxes = faces.map((f) => ({ x: f.boundingBox.x, y: f.boundingBox.y, w: f.boundingBox.width, h: f.boundingBox.height }));
      let keypoints: FaceKeypoints | undefined;
      const eyes = faces[0]?.landmarks?.filter((l) => l.type === "eye").flatMap((l) => l.locations) ?? [];
      if (eyes.length === 2) {
        const [a, b] = eyes[0]!.x <= eyes[1]!.x ? [eyes[0]!, eyes[1]!] : [eyes[1]!, eyes[0]!];
        keypoints = { rightEye: a, leftEye: b }; // image-left is the subject's right eye in a raw frame
      }
      return { boxes, keypoints };
    }
    return null;
  }

  // ----------------------------------------------------------------- analysis

  private sampleCanvas(): HTMLCanvasElement {
    if (!this.sample) {
      const c = document.createElement("canvas");
      c.width = SAMPLE_W;
      c.height = SAMPLE_H;
      this.sample = c;
    }
    return this.sample;
  }

  /** Light quality of the 3:4 crop, measured on the face when there is one. */
  private measureLight(video: HTMLVideoElement, r: { sx: number; sy: number; sw: number; sh: number }, face?: FaceBox) {
    const c = this.sampleCanvas();
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return assessLighting({ mean: 120, left: 120, right: 120, clippedHigh: 0, clippedLow: 0 });
    ctx.drawImage(video, r.sx, r.sy, r.sw, r.sh, 0, 0, SAMPLE_W, SAMPLE_H);
    const data = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
    const k = SAMPLE_W / r.sw;
    const region = face
      ? { x: Math.round(face.x * k), y: Math.round(face.y * k), w: Math.round(face.w * k), h: Math.round(face.h * k) }
      : undefined;
    return assessLighting(lumaStats(data, SAMPLE_W, SAMPLE_H, region, 2));
  }

  async analyse(): Promise<FrameReading | null> {
    if (this.state !== "on") return null;
    if (this.detector === "loading") {
      // a first scan right after waking: give the detector a moment instead of falling to manual
      await Promise.race([this.loadDetector(), new Promise<void>((r) => setTimeout(r, DETECTOR_WAIT_MS))]);
    }
    const video = this.ready();
    if (!video) return null;
    const r = captureRegion(video.videoWidth, video.videoHeight);
    const region = { w: r.sw, h: r.sh };

    let found: Found | null = null;
    try {
      found = await this.detect(video);
    } catch {
      found = null;
    }
    if (!found) {
      return { faces: 0, region, framing: null, lighting: this.measureLight(video, r) };
    }

    // only faces inside the crop the person sees count
    const inCrop = found.boxes
      .map((b) => ({ x: b.x - r.sx, y: b.y - r.sy, w: b.w, h: b.h }))
      .filter((b) => b.x + b.w / 2 > 0 && b.x + b.w / 2 < r.sw && b.y + b.h / 2 > 0 && b.y + b.h / 2 < r.sh);
    const box = inCrop.length === 1 ? inCrop[0] : undefined;
    const kp = found.keypoints && inCrop.length === 1 ? shiftKeypoints(found.keypoints, r.sx, r.sy) : undefined;
    const framing = evaluateFraming({ faces: inCrop.length, box, keypoints: kp, region });
    return { faces: inCrop.length, box, region, framing, lighting: this.measureLight(video, r, box) };
  }

  // ------------------------------------------------------------------ capture

  async capturePhoto(): Promise<Photo | null> {
    const video = this.ready();
    if (!video) return null;
    const r = captureRegion(video.videoWidth, video.videoHeight);
    const size = targetSize(r.sw, r.sh, MAX_UPLOAD_SIDE, MIN_SHORT_SIDE);
    const lighting = this.measureLight(video, r).score;
    const canvas = document.createElement("canvas");
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(video, r.sx, r.sy, r.sw, r.sh, 0, 0, size.w, size.h);
    const blob = await toJpeg(canvas, 0.92);
    return blob ? { blob, width: size.w, height: size.h, lighting } : null;
  }

  async captureLabel(): Promise<Blob | null> {
    const video = this.ready();
    if (!video) return null;
    const scale = Math.min(1, LABEL_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return toJpeg(canvas, 0.85);
  }

  async fromFile(file: File): Promise<Photo | null> {
    if (!/^image\//i.test(file.type) || file.size === 0 || file.size > MAX_FILE_BYTES) return null;
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      return null;
    }
    try {
      const size = targetSize(bitmap.width, bitmap.height, MAX_UPLOAD_SIDE, MIN_SHORT_SIDE);
      const canvas = document.createElement("canvas");
      canvas.width = size.w;
      canvas.height = size.h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, size.w, size.h);
      const sample = this.sampleCanvas();
      const sctx = sample.getContext("2d", { willReadFrequently: true });
      let lighting = 0.7;
      if (sctx) {
        sctx.drawImage(canvas, 0, 0, SAMPLE_W, SAMPLE_H);
        lighting = assessLighting(lumaStats(sctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data, SAMPLE_W, SAMPLE_H, undefined, 2)).score;
      }
      const blob = await toJpeg(canvas, 0.92);
      return blob ? { blob, width: size.w, height: size.h, lighting } : null;
    } finally {
      bitmap.close();
    }
  }
}

function shiftKeypoints(k: FaceKeypoints, dx: number, dy: number): FaceKeypoints {
  const s = (p: { x: number; y: number } | undefined) => (p ? { x: p.x - dx, y: p.y - dy } : undefined);
  return { rightEye: s(k.rightEye), leftEye: s(k.leftEye), nose: s(k.nose), rightEar: s(k.rightEar), leftEar: s(k.leftEar) };
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
    } catch {
      resolve(null);
    }
  });
}
