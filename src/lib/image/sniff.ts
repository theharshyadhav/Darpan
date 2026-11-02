/**
 * Cheap server-side image checks, so bad uploads are rejected before any YouCam unit is spent:
 * magic bytes (no trusting Content-Type) and pixel dimensions parsed straight from the headers.
 */

export interface ImageInfo {
  type: "jpeg" | "png";
  width: number;
  height: number;
}

function u16(b: Uint8Array, o: number): number {
  return ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0);
}
function u32(b: Uint8Array, o: number): number {
  return (((b[o] ?? 0) << 24) | ((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0)) >>> 0;
}

export function sniffImage(buf: Uint8Array): ImageInfo | null {
  if (buf.length < 24) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A, then IHDR with width/height
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const width = u32(buf, 16);
    const height = u32(buf, 20);
    return width > 0 && height > 0 ? { type: "png", width, height } : null;
  }

  // JPEG: FF D8, then marker segments until a Start-Of-Frame
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) {
        o += 1;
        continue;
      }
      let marker = buf[o + 1] ?? 0;
      while (marker === 0xff && o + 2 < buf.length) {
        o += 1;
        marker = buf[o + 1] ?? 0;
      }
      // standalone markers carry no length
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8) || marker === 0x00) {
        o += 2;
        continue;
      }
      if (marker === 0xd9) return null;
      const len = u16(buf, o + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        const height = u16(buf, o + 5);
        const width = u16(buf, o + 7);
        return width > 0 && height > 0 ? { type: "jpeg", width, height } : null;
      }
      if (len < 2) return null;
      o += 2 + len;
    }
  }
  return null;
}

export interface ImageLimits {
  maxBytes: number;
  /** YouCam skin analysis (SD) needs a short side of at least 480 px. */
  minShortSide: number;
  /** YouCam resizes above 2560 px on the long side; makeup-vto wants under ~1920. */
  maxLongSide: number;
}

export type ImageProblem = "not_an_image" | "too_big_bytes" | "too_small" | "too_large";

export function checkImage(buf: Uint8Array, limits: ImageLimits): { ok: true; info: ImageInfo } | { ok: false; problem: ImageProblem } {
  if (buf.length > limits.maxBytes) return { ok: false, problem: "too_big_bytes" };
  const info = sniffImage(buf);
  if (!info) return { ok: false, problem: "not_an_image" };
  if (Math.min(info.width, info.height) < limits.minShortSide) return { ok: false, problem: "too_small" };
  if (Math.max(info.width, info.height) > limits.maxLongSide) return { ok: false, problem: "too_large" };
  return { ok: true, info };
}
