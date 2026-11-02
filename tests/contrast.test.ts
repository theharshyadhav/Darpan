import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

function tokens(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2].toLowerCase();
  return out;
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const T = tokens();
// Colours that are only ever used as fills, borders or gems, never as the colour of text.
const TEXT_TOKENS = ["ink", "ink-soft", "ink-faint", "rani-ink", "peacock-ink", "marigold-ink", "amethyst-ink", "sapphire-ink"];

describe("contrast (WCAG AA, 4.5:1 for text)", () => {
  it("reads the palette from globals.css", () => {
    expect(T.pearl).toBe("#f8f5ff");
    expect(T.ink).toBe("#221a52");
  });

  for (const name of TEXT_TOKENS) {
    for (const bg of ["pearl", "card", "pearl-deep"]) {
      it(`${name} on ${bg} is at least 4.5:1`, () => {
        expect(T[name], `token ${name}`).toBeTruthy();
        expect(ratio(T[name], T[bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("white text on the filled rani and amethyst buttons is at least 4.5:1", () => {
    expect(ratio("#ffffff", T["rani-ink"])).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#ffffff", T["amethyst-ink"])).toBeGreaterThanOrEqual(4.5);
  });

  it("no component uses a bright gem colour (without -ink) as text colour", () => {
    const hits = execSync(`grep -rnE "text-(rani|peacock|marigold|amethyst|sapphire)([^-a-z]|$)" src/components src/app || true`, {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
    });
    expect(hits.trim()).toBe("");
  });
});
