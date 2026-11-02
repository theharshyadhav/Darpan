import { describe, expect, it } from "vitest";
import {
  DEFAULT_MIN_WIDTH_RATIO,
  StabilityTracker,
  assessLighting,
  captureRegion,
  evaluateFraming,
  lumaStats,
  targetSize,
  type FaceBox,
} from "@/lib/vision/frame";

function image(w: number, h: number, fill: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b] = fill(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

describe("lighting", () => {
  const W = 100;
  const H = 100;

  it("reads a well-lit even frame as ok", () => {
    const s = lumaStats(image(W, H, () => [150, 140, 135]), W, H);
    const a = assessLighting(s);
    expect(a.hint).toBe("ok");
    expect(a.ok).toBe(true);
    expect(a.score).toBeGreaterThan(0.8);
  });

  it("asks for more light in a dim frame", () => {
    const a = assessLighting(lumaStats(image(W, H, () => [30, 28, 26]), W, H));
    expect(a.hint).toBe("dim");
    expect(a.ok).toBe(false);
    expect(a.score).toBeLessThan(0.4);
  });

  it("notices glare and blown-out light", () => {
    const a = assessLighting(lumaStats(image(W, H, () => [252, 252, 250]), W, H));
    expect(a.hint).toBe("bright");
    expect(a.ok).toBe(false);
  });

  it("notices light from one side only", () => {
    const s = lumaStats(image(W, H, (x) => (x < 50 ? [200, 195, 190] : [95, 92, 90])), W, H);
    expect(s.left).toBeGreaterThan(s.right);
    const a = assessLighting(s);
    expect(a.hint).toBe("uneven");
    expect(a.ok).toBe(false);
  });

  it("handles an empty region without dividing by zero", () => {
    const s = lumaStats(new Uint8ClampedArray(0), 0, 0, { x: 0, y: 0, w: 0, h: 0 });
    expect(s.mean).toBe(0);
    expect(assessLighting(s).hint).toBe("dim");
  });
});

describe("framing", () => {
  const region = { w: 600, h: 800 };
  const centred = (widthRatio: number, cx = 0.5, cy = 0.46): FaceBox => {
    const w = region.w * widthRatio;
    const h = w * 1.25;
    return { x: region.w * cx - w / 2, y: region.h * cy - h / 2, w, h };
  };

  it("needs exactly one face", () => {
    expect(evaluateFraming({ faces: 0, region }).hint).toBe("no_face");
    expect(evaluateFraming({ faces: 2, box: centred(0.7), region }).hint).toBe("multi_face");
  });

  it("holds the face above 60% of the frame width", () => {
    expect(DEFAULT_MIN_WIDTH_RATIO).toBeGreaterThanOrEqual(0.55);
    expect(evaluateFraming({ faces: 1, box: centred(0.4), region }).hint).toBe("closer");
    expect(evaluateFraming({ faces: 1, box: centred(0.7), region })).toMatchObject({ ok: true, hint: "ok" });
    expect(evaluateFraming({ faces: 1, box: centred(0.97), region }).hint).toBe("back");
  });

  it("honours an adapted minimum width", () => {
    expect(evaluateFraming({ faces: 1, box: centred(0.64), region, minWidthRatio: 0.7 }).hint).toBe("closer");
    expect(evaluateFraming({ faces: 1, box: centred(0.64), region, minWidthRatio: 0.6 }).hint).toBe("ok");
  });

  it("guides left and right in raw camera coordinates", () => {
    expect(evaluateFraming({ faces: 1, box: centred(0.7, 0.72), region }).hint).toBe("shift_right");
    expect(evaluateFraming({ faces: 1, box: centred(0.7, 0.28), region }).hint).toBe("shift_left");
  });

  it("guides up and down", () => {
    expect(evaluateFraming({ faces: 1, box: centred(0.65, 0.5, 0.3), region }).hint).toBe("lower");
    expect(evaluateFraming({ faces: 1, box: centred(0.65, 0.5, 0.64), region }).hint).toBe("higher");
  });

  it("asks to level the head and face the mirror", () => {
    const box = centred(0.7);
    const tilted = evaluateFraming({
      faces: 1,
      box,
      region,
      keypoints: { rightEye: { x: 240, y: 330 }, leftEye: { x: 360, y: 372 }, nose: { x: 300, y: 400 } },
    });
    expect(tilted.hint).toBe("level");
    expect(Math.abs(tilted.rollDeg)).toBeGreaterThan(8);

    const turned = evaluateFraming({
      faces: 1,
      box,
      region,
      keypoints: { rightEye: { x: 240, y: 350 }, leftEye: { x: 360, y: 350 }, nose: { x: 345, y: 400 } },
    });
    expect(turned.hint).toBe("forward");

    const straight = evaluateFraming({
      faces: 1,
      box,
      region,
      keypoints: { rightEye: { x: 240, y: 350 }, leftEye: { x: 360, y: 350 }, nose: { x: 302, y: 400 } },
    });
    expect(straight).toMatchObject({ ok: true, hint: "ok" });
  });
});

describe("StabilityTracker", () => {
  const region = { w: 600, h: 800 };
  const box: FaceBox = { x: 120, y: 190, w: 360, h: 450 };

  it("fires only after the face has been steady long enough", () => {
    const t = new StabilityTracker(1200);
    let steady = 0;
    for (let ms = 0; ms <= 1000; ms += 200) steady = t.update(true, box, region, ms);
    expect(t.isReady(steady)).toBe(false);
    steady = t.update(true, box, region, 1400);
    expect(steady).toBeGreaterThanOrEqual(1200);
    expect(t.isReady(steady)).toBe(true);
  });

  it("restarts the clock when the person moves", () => {
    const t = new StabilityTracker(1000);
    t.update(true, box, region, 0);
    t.update(true, box, region, 600);
    const moved = t.update(true, { ...box, x: box.x + 60 }, region, 900);
    expect(moved).toBe(0);
    expect(t.update(true, { ...box, x: box.x + 60 }, region, 1200)).toBe(300);
  });

  it("resets on any bad frame", () => {
    const t = new StabilityTracker(1000);
    t.update(true, box, region, 0);
    expect(t.update(false, box, region, 500)).toBe(0);
    expect(t.update(true, box, region, 600)).toBe(0);
    expect(t.update(true, box, region, 1700)).toBe(1100);
  });
});

describe("capture geometry", () => {
  it("crops the largest centred 3:4 region from landscape and portrait frames", () => {
    expect(captureRegion(1280, 720)).toEqual({ sx: 370, sy: 0, sw: 540, sh: 720 });
    expect(captureRegion(720, 1280)).toEqual({ sx: 0, sy: 160, sw: 720, sh: 960 });
    const r = captureRegion(640, 480);
    expect(r.sw / r.sh).toBeCloseTo(0.75, 2);
    expect(r.sx + r.sw).toBeLessThanOrEqual(640);
    expect(r.sy + r.sh).toBeLessThanOrEqual(480);
  });

  it("scales the upload into YouCam's limits", () => {
    expect(targetSize(540, 720)).toEqual({ w: 640, h: 853, upscaled: true });
    const big = targetSize(3000, 4000);
    expect(Math.max(big.w, big.h)).toBe(1600);
    expect(big.upscaled).toBe(false);
    const ok = targetSize(900, 1200);
    expect(ok).toEqual({ w: 900, h: 1200, upscaled: false });
  });
});
