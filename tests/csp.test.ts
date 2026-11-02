import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url).pathname;
const PORT = 3187;
const base = `http://127.0.0.1:${PORT}`;
let proc: ChildProcess | undefined;
const built = existsSync(`${root}.next/BUILD_ID`);

async function waitUp(): Promise<void> {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${base}/privacy`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("next start did not come up");
}

// Needs `npm run build` first; `npm run check` builds before it tests.
describe.skipIf(!built)("built app serves its security headers", () => {
  beforeAll(async () => {
    proc = spawn("npx", ["next", "start", "-p", String(PORT), "-H", "127.0.0.1"], { cwd: root, env: { ...process.env, NODE_ENV: "production" }, stdio: "ignore" });
    await waitUp();
  }, 60_000);
  afterAll(() => {
    proc?.kill("SIGTERM");
  });

  it("sends a CSP with no unsafe-eval and no framing", async () => {
    const r = await fetch(`${base}/`);
    const csp = r.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toMatch(/script-src[^;]*'wasm-unsafe-eval'/);
  });

  it("sends the other hardening headers, on pages and on API routes", async () => {
    for (const path of ["/", "/privacy", "/api/status"]) {
      const r = await fetch(`${base}${path}`);
      expect(r.headers.get("x-content-type-options"), path).toBe("nosniff");
      expect(r.headers.get("x-frame-options"), path).toBe("DENY");
      expect(r.headers.get("referrer-policy"), path).toBe("no-referrer");
      expect(r.headers.get("permissions-policy"), path).toContain("camera=(self)");
      expect(r.headers.get("content-security-policy"), path).toBeTruthy();
      expect(r.headers.get("x-powered-by"), path).toBeNull();
    }
  });
});
