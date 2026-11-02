// Runs after `npm install`. Copies MediaPipe's WASM runtime into public/ so the
// mirror's face-framing check is served from our own origin (no CDN dependency),
// and best-effort downloads the small face-detector model. Every step is optional:
// if anything fails the app falls back to CDN URLs at runtime, or to manual capture.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "mediapipe");
const wasmOut = join(outDir, "wasm");
const wasmSrc = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

function log(msg) {
  console.log(`[darpan:setup] ${msg}`);
}

try {
  mkdirSync(wasmOut, { recursive: true });
  if (existsSync(wasmSrc)) {
    const wanted = [
      "vision_wasm_internal.js",
      "vision_wasm_internal.wasm",
      "vision_wasm_nosimd_internal.js",
      "vision_wasm_nosimd_internal.wasm",
    ];
    let copied = 0;
    for (const name of wanted) {
      const from = join(wasmSrc, name);
      if (existsSync(from)) {
        copyFileSync(from, join(wasmOut, name));
        copied += 1;
      }
    }
    log(`copied ${copied}/${wanted.length} MediaPipe runtime files`);
  } else {
    log("MediaPipe package not found yet; runtime will use the CDN fallback");
  }
} catch (err) {
  log(`skipped MediaPipe runtime copy (${err instanceof Error ? err.message : String(err)})`);
}

try {
  const modelPath = join(outDir, "blaze_face_short_range.tflite");
  if (!existsSync(modelPath)) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15_000);
    const res = await fetch(MODEL_URL, { signal: ctl.signal });
    clearTimeout(timer);
    if (res.ok) {
      writeFileSync(modelPath, Buffer.from(await res.arrayBuffer()));
      log("downloaded face-detector model");
    } else {
      log(`model download returned ${res.status}; runtime will use the CDN fallback`);
    }
  }
} catch (err) {
  log(`model download skipped (${err instanceof Error ? err.message : String(err)}); runtime will use the CDN fallback`);
}
