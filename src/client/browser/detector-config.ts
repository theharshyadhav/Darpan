/**
 * Where the face detector comes from, in the order it is tried:
 *   1. the model and runtime served from this site (copied in by `npm install`),
 *   2. the same runtime with the model fetched from Google's model host,
 *   3. the browser's own FaceDetector (Chrome, behind a flag on some platforms),
 *   4. nothing: the person taps "capture now", which also protects the YouCam budget.
 *
 * The runtime (wasm) always comes from this site and is copied out of the installed package, so it
 * cannot drift from the JavaScript that drives it. If a CDN is ever added for the runtime, its
 * version must equal MEDIAPIPE_VERSION; tests/browser.test.ts fails when that stops being true.
 */

export const MEDIAPIPE_VERSION = "1.1.1";

export const LOCAL_WASM_BASE = "/mediapipe/wasm";
export const LOCAL_MODEL_URL = "/mediapipe/blaze_face_short_range.tflite";
export const REMOTE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

/** The only outside host the app may contact from the browser (used by the CSP and checked in tests). */
export const REMOTE_MODEL_HOST = "https://storage.googleapis.com";
