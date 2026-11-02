import { expect, test, type Page } from "@playwright/test";
import { installStubs, spoken } from "./stubs";

/**
 * The live path, against the local mock YouCam server (npm run mock:youcam). This proves Darpan's own
 * wiring: consent gating, upload, task polling, result mapping, labelling. It does NOT prove YouCam
 * itself: the mock's numbers are made up and every result says so.
 */

test.beforeEach(async ({ page }) => {
  await installStubs(page);
});

async function wake(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Wake the mirror" }).click();
  await expect(page.getByRole("heading", { name: "What would you like?" })).toBeVisible();
}

test("a photo is sent only after the Allow tap, never after a spoken yes", async ({ page }) => {
  const scanCalls: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/skin/scan") scanCalls.push(r.method());
  });
  await wake(page);
  await page.getByRole("button", { name: "Scan my skin" }).first().click();
  await expect(page.getByText("Send your photo to YouCam?")).toBeVisible();

  // a spoken "yes" is heard, and still nothing is sent
  await page.evaluate(() => (window as unknown as { __hear: (t: string) => boolean }).__hear("yes"));
  await page.waitForTimeout(1200);
  expect(scanCalls).toEqual([]);
  await expect(page.getByText("Send your photo to YouCam?")).toBeVisible();

  await page.getByRole("button", { name: "Allow", exact: true }).click();
  const capture = page.getByRole("button", { name: "Capture now" });
  await capture.waitFor({ timeout: 15_000 }).catch(() => {});
  if (await capture.isVisible().catch(() => false)) await capture.click();
  await expect(page.getByRole("figure")).toHaveCount(7, { timeout: 40_000 });
  expect(scanCalls.filter((m) => m === "POST")).toEqual(["POST"]);
});

test("a live scan from the mock is not labelled as the person's own sample numbers", async ({ page }) => {
  await wake(page);
  await page.getByRole("button", { name: "Scan my skin" }).first().click();
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  const capture = page.getByRole("button", { name: "Capture now" });
  await capture.waitFor({ timeout: 15_000 }).catch(() => {});
  if (await capture.isVisible().catch(() => false)) await capture.click();
  await expect(page.getByRole("figure")).toHaveCount(7, { timeout: 40_000 });
  await expect(page.getByText("These are sample numbers made on this device. Nothing was sent anywhere.")).toBeHidden();
  const lines = (await spoken(page)).join(" ");
  expect(lines).not.toContain("I am in demo mode");
});

test("/api/status reports the live skin service without revealing any key", async ({ request }) => {
  const r = await request.get("/api/status");
  expect(r.ok()).toBe(true);
  const body = await r.text();
  expect(body).toContain("live");
  expect(body).not.toContain("mock-key");
});
