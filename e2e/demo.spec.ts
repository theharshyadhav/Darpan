import { expect, test, type Page } from "@playwright/test";
import { installStubs, say, spoken } from "./stubs";

/** Demo Mode: the server has no keys at all. Nothing may leave the device. */

async function wake(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Wake the mirror" }).click();
  await expect(page.getByRole("heading", { name: "What would you like?" })).toBeVisible();
}

/** Runs one scan from the current screen and waits until its result is on screen. `n` is which scan this is. */
async function scan(page: Page, n = 1) {
  await page.getByRole("button", { name: /^Scan (my skin|again)$/ }).first().click();
  const capture = page.getByRole("button", { name: "Capture now" });
  await capture.waitFor({ timeout: 15_000 }).catch(() => {});
  if (await capture.isVisible().catch(() => false)) await capture.click();
  await expect
    .poll(async () => (await spoken(page)).filter((l) => l.startsWith("I am in demo mode")).length, { timeout: 30_000 })
    .toBe(n);
  await expect(page.getByRole("heading", { name: "Your skin today" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Did it work?" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await installStubs(page);
});

test("wake and greeting: the mirror greets by title, in Demo Mode, and sends nothing", async ({ page }) => {
  const outbound: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.hostname !== "127.0.0.1" && u.protocol.startsWith("http")) outbound.push(r.url());
    if (u.pathname.startsWith("/api/skin") || u.pathname.startsWith("/api/mirror/look")) outbound.push(r.url());
  });
  await page.goto("/");
  await expect(page.getByText("Demo Mode")).toBeVisible();
  await expect(page.getByText("Sample numbers made on this device. Nothing is sent anywhere.")).toBeVisible();
  await page.getByRole("button", { name: "Wake the mirror" }).click();
  await expect(page.getByText("Welcome, Your Highness. The mirror is yours.")).toBeVisible();
  await expect.poll(async () => (await spoken(page)).join(" ")).toContain("Welcome, Your Highness");
  expect(outbound).toEqual([]);
});

test("scan and report: seven rings, labelled as sample numbers", async ({ page }) => {
  await wake(page);
  await scan(page);
  await expect(page.getByText("These are sample numbers made on this device. Nothing was sent anywhere.")).toBeVisible();
  // seven concerns, each with a printed number (colour never carries the meaning alone)
  await expect(page.getByRole("figure")).toHaveCount(7);
  await page.getByRole("button", { name: "Show as a list" }).click();
  await expect(page.getByRole("button", { name: "Show as rings" })).toBeVisible();
  await expect(page.getByText("out of 100").first()).toBeVisible();
});

test("ritual: say what you applied, the garland and the applied list update", async ({ page }) => {
  await wake(page);
  await page.getByRole("button", { name: /Start my (morning|evening) ritual/ }).first().click();
  await expect(page.getByRole("heading", { name: /(Morning|Evening) ritual/ })).toBeVisible();
  await say(page, "I applied cleanser");
  await expect(page.getByText("Nothing logged yet")).toBeHidden({ timeout: 10_000 });
  await expect(page.getByText(/cleanser/i).first()).toBeVisible();
});

test("verify: two scans, an honest comparison that says sample numbers are not real", async ({ page }) => {
  await wake(page);
  await scan(page, 1);
  await scan(page, 2);
  await page.getByRole("button", { name: "Did it work?" }).first().click();
  // two scans minutes apart: the mirror says so and asks before measuring again
  await expect.poll(async () => (await spoken(page)).join(" ")).toContain("Shall I measure anyway?");
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  const capture2 = page.getByRole("button", { name: "Capture now" });
  await capture2.waitFor({ timeout: 15_000 }).catch(() => {});
  if (await capture2.isVisible().catch(() => false)) await capture2.click();
  await expect(page.getByRole("heading", { name: "Before and after" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("The scans were taken close together, so changes say little.")).toBeVisible();
  await expect(page.getByText("This includes sample numbers, so it isn't a real comparison.")).toBeVisible();
});

test("looks: choosing a look shows its recipe; no preview is promised without YouCam", async ({ page }) => {
  await wake(page);
  await page.getByRole("button", { name: "Try a look" }).first().click();
  await expect(page.getByRole("heading", { name: "Look Studio" })).toBeVisible();
  await page.getByRole("button", { name: /Rani|Peacock|Marigold|Amethyst|Sapphire|Classic|Bridal|Everyday|Soft|Bold|Glow|Dusk/i }).first().click();
  await expect(page.getByText(/Recipe/).first()).toBeVisible();
  await expect(page.getByText("Recipe only. Previews need a YouCam key and your permission to send a photo.")).toBeVisible();
});

test("ledger: track a product, then stop tracking it", async ({ page }) => {
  await wake(page);
  await page.getByRole("button", { name: "Open the Royal Ledger" }).first().click();
  await expect(page.getByRole("heading", { name: "Royal Ledger" })).toBeVisible();
  await page.getByPlaceholder("Product to track").fill("Rose serum");
  await page.getByRole("button", { name: "Track", exact: true }).click();
  await expect(page.getByText("Rose serum", { exact: true })).toBeVisible();
  await expect(page.getByText("Too early to say")).toBeVisible();
  await page.getByRole("button", { name: /Stop tracking/ }).first().click();
  await expect(page.getByText("Rose serum", { exact: true })).toBeHidden();
});

test("Hindi session: the interface and the spoken greeting switch to Hindi", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "हिन्दी" }).click();
  await page.getByRole("button", { name: /आईना|जगाएँ/ }).first().click();
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await expect(page.locator("main")).toContainText(/[ऀ-ॿ]/);
  await expect.poll(async () => (await spoken(page)).join(" ")).toMatch(/[ऀ-ॿ]/);
  const voiceLang = await page.evaluate(() => document.documentElement.lang);
  expect(voiceLang).toBe("hi");
});

test("forget me: erases everything on the device", async ({ page }) => {
  await wake(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Forget me" }).click();
  await page.getByRole("button", { name: "Erase everything" }).click();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => /darpan/i.test(k)).length)).toBe(0);
});

test("the mirror still answers with no AI key (built-in rules)", async ({ page }) => {
  await wake(page);
  await say(page, "open the ledger");
  await expect(page.getByRole("heading", { name: "Royal Ledger" })).toBeVisible();
});
