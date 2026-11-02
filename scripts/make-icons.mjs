// Renders src/app/icon.svg into the PNG icons the web manifest needs. Run once after changing the icon:
//   node scripts/make-icons.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "src", "app", "icon.svg"), "utf8");
const out = join(root, "public", "icons");
mkdirSync(out, { recursive: true });

const sandboxChromium = "/opt/pw-browsers/chromium";
const browser = await chromium.launch(existsSync(sandboxChromium) ? { executablePath: sandboxChromium } : {});
try {
  for (const [size, name, flat] of [[180, "apple-touch-icon.png", true], [192, "icon-192.png", false], [512, "icon-512.png", false], [512, "icon-maskable-512.png", true]]) {
    // Apple and maskable icons are full-bleed squares: the OS applies its own rounding or mask.
    const art = flat ? svg.replace('rx="112"', 'rx="0"') : svg;
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0;background:transparent">${art.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    writeFileSync(join(out, name), png);
    await page.close();
  }
  console.log("icons written to public/icons");
} finally {
  await browser.close();
}
