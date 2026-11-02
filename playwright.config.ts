import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end smoke tests against the production build (run `npm run build` first; `npm run e2e` does).
 *
 * Two servers, one build:
 *   demo  port 3100  no keys at all: Demo Mode, built-in rules
 *   live  port 3101  pointed at the local mock YouCam server (npm run mock:youcam, port 4010)
 *
 * The fake camera and microphone flags give the page a test-pattern video; speech recognition, speech
 * synthesis and FaceDetector are stubbed in e2e/stubs.ts because headless Chromium has no speech
 * services. Live YouCam, Groq and xAI are never contacted from here.
 */
const sandboxChromium = "/opt/pw-browsers/chromium";
const executablePath = process.env.PW_CHROMIUM || (existsSync(sandboxChromium) ? sandboxChromium : undefined);

const cleanEnv = { NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" };

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  outputDir: "./test-results",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    permissions: ["camera", "microphone"],
    launchOptions: {
      executablePath,
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
    },
  },
  projects: [
    { name: "demo", testMatch: /demo\.spec\.ts/, use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:3100", viewport: { width: 1280, height: 860 } } },
    { name: "demo-phone", testMatch: /phone\.spec\.ts/, use: { ...devices["Pixel 7"], baseURL: "http://127.0.0.1:3100" } },
    { name: "live", testMatch: /live\.spec\.ts/, use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:3101", viewport: { width: 1280, height: 860 } } },
  ],
  webServer: [
    {
      command: "npx next start -p 3100 -H 127.0.0.1",
      url: "http://127.0.0.1:3100/privacy",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { ...cleanEnv },
    },
    {
      command: "node scripts/mock-youcam.mjs 4010",
      port: 4010,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 2000 },
    },
    {
      command: "npx next start -p 3101 -H 127.0.0.1",
      url: "http://127.0.0.1:3101/privacy",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        ...cleanEnv,
        YOUCAM_API_KEY: "mock-key",
        YOUCAM_BASE_URL: "http://127.0.0.1:4010",
        DARPAN_ALLOW_HTTP_UPSTREAM: "1",
        DARPAN_SCAN_COOLDOWN_SEC: "0",
        LLM_PROVIDER: "off",
      },
    },
  ],
});
