import { join } from "node:path";
import type { Page } from "@playwright/test";

/**
 * Headless Chromium has no speech services, so these stubs stand in for them, installed before any
 * page script runs. They expose a few hooks for the tests:
 *   window.__hear(text)    the mirror's ear "hears" a final sentence
 *   window.__spoken        every line the mirror spoke, in order
 *   window.__faceFound     toggles the FaceDetector stub between a centred face and no face
 * Sending a photo is never triggered by speech; the tests tap the Allow button.
 */
export async function installStubs(page: Page): Promise<void> {
  await page.addInitScript({ path: join(__dirname, "stubs-init.js") });
  // the face-detector model would come from Google's host: never reach out from a test
  await page.route("https://storage.googleapis.com/**", (r) => r.abort());
}

/** Says something to the mirror through the stubbed ear. */
export async function say(page: Page, text: string): Promise<void> {
  await page.waitForFunction((t) => (window as unknown as { __hear: (t: string) => boolean }).__hear(t), text, { timeout: 15_000 });
}

export async function spoken(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.slice());
}
