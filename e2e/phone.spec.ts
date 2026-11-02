import { expect, test } from "@playwright/test";
import { installStubs } from "./stubs";

test("phone: wake lands on the mirror, nothing scrolls sideways, tabs are reachable", async ({ page }) => {
  await installStubs(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Wake the mirror" }).click();
  await expect(page.getByRole("heading", { name: "What would you like?" })).toBeVisible();
  expect(await page.evaluate(() => scrollY)).toBeLessThan(5);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  for (const name of ["Skin", "Ritual", "Looks", "Ledger", "Home"]) {
    await page.getByRole("navigation").getByRole("button", { name }).click();
  }
});
