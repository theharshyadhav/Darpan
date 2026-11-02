import { CONCERNS, concernLabel, type ConcernKey } from "@/lib/concerns";
import type { ScoreMap } from "@/lib/skin/types";
import type { Language } from "@/lib/types";
import { RING_ORDER } from "./RingGauge";

/**
 * The shareable "Royal Decree": a portrait card drawn on a canvas. It carries a title, the day, the
 * strongest concern in words and seven small gems. It never carries a photo, and a card made from
 * sample numbers says so on its face, so it can't be mistaken for a real measurement.
 */

export const DECREE_W = 1080;
export const DECREE_H = 1350;

export interface DecreeInput {
  title: string;
  heading: string;
  strongestLabel: string;
  strongestName: string;
  samples: boolean;
  samplesLabel: string;
  footer: string;
  scores: ScoreMap;
  dateText: string;
  lang: Language;
}

export function decreeFilename(now: number): string {
  return `darpan-decree-${new Date(now).toISOString().slice(0, 10)}.png`;
}

function archPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const s = (px: number, py: number) => [x + (px / 300) * w, y + (py / 400) * h] as const;
  const m = (a: readonly [number, number]) => ctx.moveTo(a[0], a[1]);
  const l = (a: readonly [number, number]) => ctx.lineTo(a[0], a[1]);
  const q = (c: readonly [number, number], e: readonly [number, number]) => ctx.quadraticCurveTo(c[0], c[1], e[0], e[1]);
  ctx.beginPath();
  m(s(6, 400));
  l(s(6, 200));
  q(s(6, 160), s(34, 140));
  q(s(30, 108), s(62, 92));
  q(s(60, 56), s(100, 44));
  q(s(104, 20), s(150, 6));
  q(s(196, 20), s(200, 44));
  q(s(240, 56), s(238, 92));
  q(s(270, 108), s(266, 140));
  q(s(294, 160), s(294, 200));
  l(s(294, 400));
  ctx.closePath();
}

export async function drawDecree(canvas: HTMLCanvasElement, d: DecreeInput): Promise<void> {
  canvas.width = DECREE_W;
  canvas.height = DECREE_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  try {
    await Promise.all([document.fonts.load('48px "Rozha One"'), document.fonts.load('600 48px "Eczar Variable"'), document.fonts.load('600 32px "Figtree Variable"')]);
  } catch {
    /* system fonts are fine */
  }

  const bg = ctx.createLinearGradient(0, 0, DECREE_W, DECREE_H);
  bg.addColorStop(0, "#fde6f0");
  bg.addColorStop(0.5, "#f8f5ff");
  bg.addColorStop(1, "#d6f5f2");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, DECREE_W, DECREE_H);

  // border
  ctx.strokeStyle = "#7a4dff";
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 3;
  ctx.strokeRect(36, 36, DECREE_W - 72, DECREE_H - 72);
  ctx.globalAlpha = 1;

  // arch with a gem crown
  const aw = 420;
  const ah = 560;
  const ax = (DECREE_W - aw) / 2;
  const ay = 150;
  archPath(ctx, ax, ay, aw, ah);
  const g = ctx.createLinearGradient(ax, ay, ax + aw, ay + ah);
  g.addColorStop(0, "#e6397c");
  g.addColorStop(0.5, "#ffb020");
  g.addColorStop(1, "#00a39a");
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.lineWidth = 12;
  ctx.strokeStyle = g;
  ctx.lineJoin = "round";
  ctx.stroke();
  const orb = ctx.createRadialGradient(DECREE_W / 2 - 8, ay - 22, 2, DECREE_W / 2, ay - 14, 36);
  orb.addColorStop(0, "#fff");
  orb.addColorStop(0.3, "#ffd36b");
  orb.addColorStop(1, "#e68a00");
  ctx.fillStyle = orb;
  ctx.beginPath();
  ctx.arc(DECREE_W / 2, ay - 12, 34, 0, Math.PI * 2);
  ctx.fill();

  // text inside the arch
  ctx.textAlign = "center";
  ctx.fillStyle = "#221a52";
  ctx.font = '84px "Rozha One", serif';
  ctx.fillText(d.heading, DECREE_W / 2, ay + 250);
  ctx.font = '600 30px "Figtree Variable", system-ui, sans-serif';
  ctx.fillStyle = "#4a4380";
  ctx.fillText(d.strongestLabel, DECREE_W / 2, ay + 330);
  ctx.font = '600 64px "Eczar Variable", Georgia, serif';
  ctx.fillStyle = "#221a52";
  ctx.fillText(d.strongestName, DECREE_W / 2, ay + 405);
  ctx.font = '400 28px "Figtree Variable", system-ui, sans-serif';
  ctx.fillStyle = "#4a4380";
  ctx.fillText(d.title, DECREE_W / 2, ay + 475);

  // seven gems
  const gemY = 880;
  const gap = 130;
  const x0 = DECREE_W / 2 - (gap * (RING_ORDER.length - 1)) / 2;
  RING_ORDER.forEach((k: ConcernKey, i: number) => {
    const v = d.scores[k];
    if (typeof v !== "number") return;
    const cx = x0 + i * gap;
    ctx.beginPath();
    ctx.arc(cx, gemY, 44, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = "#efe8ff";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, gemY, 44, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * Math.max(0, Math.min(100, v))) / 100);
    ctx.strokeStyle = CONCERNS[k].color;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.fillStyle = "#221a52";
    ctx.font = '700 30px "Eczar Variable", Georgia, serif';
    ctx.fillText(String(Math.round(v)), cx, gemY + 11);
    ctx.font = '600 19px "Figtree Variable", system-ui, sans-serif';
    ctx.fillStyle = "#4a4380";
    ctx.fillText(concernLabel(k, d.lang), cx, gemY + 84);
  });

  if (d.samples) {
    ctx.font = '700 30px "Figtree Variable", system-ui, sans-serif';
    const w = ctx.measureText(d.samplesLabel).width + 56;
    ctx.fillStyle = "#ffb020";
    ctx.beginPath();
    ctx.roundRect((DECREE_W - w) / 2, 1030, w, 58, 29);
    ctx.fill();
    ctx.fillStyle = "#4a2f00";
    ctx.fillText(d.samplesLabel, DECREE_W / 2, 1069);
  }

  ctx.fillStyle = "#4a4380";
  ctx.font = '400 26px "Figtree Variable", system-ui, sans-serif';
  ctx.fillText(d.dateText, DECREE_W / 2, 1180);
  ctx.font = '400 24px "Figtree Variable", system-ui, sans-serif';
  ctx.fillText(d.footer, DECREE_W / 2, 1250);
}
