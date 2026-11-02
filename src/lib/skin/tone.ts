/**
 * Skin colour helpers. YouCam's tone analysis returns a skin colour as a hex value; from it we
 * derive the Individual Typology Angle (ITA), a standard colorimetric measure used in cosmetic
 * science. Darpan never names or classifies a person's complexion out loud. ITA is used for one
 * thing only: to widen the mirror's stated uncertainty, because imaging models are known to be
 * less precise on deeper complexions and in dim light, and honesty means saying so.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** sRGB (D65) to CIE L*a*b*. */
export function rgbToLab({ r, g, b }: Rgb): { L: number; a: number; b: number } {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** Individual Typology Angle in degrees: atan((L* - 50) / b*). Higher is lighter. */
export function itaFromHex(hex: string): number | undefined {
  const rgb = parseHex(hex);
  if (!rgb) return undefined;
  const { L, b } = rgbToLab(rgb);
  if (!Number.isFinite(L) || !Number.isFinite(b) || Math.abs(b) < 1e-6) return undefined;
  return (Math.atan2(L - 50, b) * 180) / Math.PI;
}
