/**
 * `npm run doctor` — checks your keys and limits before you demo, and prints what each call costs.
 *
 * It reads `.env.local` (then `.env`), uses the same code paths as the app, and never prints a
 * secret. Safe to run any time: it makes only free, read-only calls (credit balance, price list,
 * model list) plus one 8-token model reply.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, skinMode, llmLive } from "../src/server/config";
import { YouCamClient } from "../src/server/youcam/client";
import { UpstreamError } from "../src/server/youcam/errors";
import { LlmClient, LlmError } from "../src/server/llm/client";

// ---- tiny .env reader (no dependency, works on every supported Node version)
function loadEnvFiles(): string[] {
  const loaded: string[] = [];
  for (const name of [".env.local", ".env"]) {
    const file = resolve(process.cwd(), name);
    if (!existsSync(file)) continue;
    loaded.push(name);
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || line.trim().startsWith("#")) continue;
      let value = m[2]!;
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      else value = value.replace(/\s+#.*$/, "");
      if (process.env[m[1]!] === undefined) process.env[m[1]!] = value;
    }
  }
  return loaded;
}

const tty = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code: number) => (s: string) => (tty ? `\u001b[${code}m${s}\u001b[0m` : s);
const green = paint(32);
const red = paint(31);
const amber = paint(33);
const dim = paint(2);
const bold = paint(1);

let failures = 0;
let cautions = 0;
const ok = (s: string) => console.log(`  ${green("✓")} ${s}`);
const warn = (s: string) => {
  cautions += 1;
  console.log(`  ${amber("!")} ${s}`);
};
const fail = (s: string) => {
  failures += 1;
  console.log(`  ${red("✗")} ${s}`);
};
const info = (s: string) => console.log(`    ${dim(s)}`);
const heading = (s: string) => console.log(`\n${bold(s)}`);

function describe(e: unknown): string {
  if (e instanceof UpstreamError) return `${e.kind}${e.status ? ` (HTTP ${e.status})` : ""}${e.code ? `, code ${e.code}` : ""}`;
  if (e instanceof LlmError) return `${e.kind}${e.status ? ` (HTTP ${e.status})` : ""}`;
  return e instanceof Error ? e.message : String(e);
}

async function main(): Promise<void> {
  const files = loadEnvFiles();
  const cfg = loadConfig(process.env);
  console.log(bold("Darpan doctor"));
  console.log(dim(files.length ? `Read ${files.join(" and ")}` : "No .env.local found; using the shell environment only."));

  heading("Configuration");
  if (cfg.warnings.length === 0) ok("Every setting parsed cleanly.");
  for (const w of cfg.warnings) warn(w);
  if (cfg.demoOnly) warn("DARPAN_DEMO_ONLY is on: the app will always use labelled sample scores.");

  // ---- YouCam
  heading("YouCam AI (skin analysis, skin tone, makeup try-on)");
  const costs = { skin: cfg.youcam.cost.skin, tone: cfg.youcam.tone ? cfg.youcam.cost.tone : 0, look: cfg.youcam.cost.look };
  if (skinMode(cfg) === "demo") {
    warn(cfg.youcam.apiKey ? "Demo Mode is forced, so YouCam will not be called." : "No YOUCAM_API_KEY. The app runs in Demo Mode with clearly labelled sample scores.");
  } else {
    const yc = new YouCamClient(cfg.youcam);
    ok(`Key present, endpoint ${cfg.youcam.baseUrl}`);
    try {
      const credits = await yc.credits();
      if (credits === null) warn("Credit balance was not in the response. Check the YouCam console.");
      else {
        ok(`Credit balance: ${credits} units`);
        const scans = Math.floor(credits / Math.max(1, costs.skin + costs.tone));
        info(`That is about ${scans} full scans, or ${Math.floor(credits / costs.look)} makeup previews.`);
        if (cfg.limits.minBalance > 0 && credits < cfg.limits.minBalance) warn(`Balance is below DARPAN_MIN_BALANCE (${cfg.limits.minBalance}); the app will stay in Demo Mode.`);
      }
    } catch (e) {
      const rejected = e instanceof UpstreamError && (e.status === 401 || e.status === 403);
      fail(`Could not read the credit balance: ${describe(e)}.${rejected ? " The key was rejected; check YOUCAM_API_KEY." : ""}`);
    }
    try {
      const table = await yc.featureCosts();
      const wanted = table.filter((c) => /skin-analysis|skin-tone-analysis|makeup-vto/.test(c.feature));
      if (wanted.length === 0) warn("The price list did not include skin analysis or try-on.");
      else {
        ok("Per-call prices for this account:");
        for (const c of wanted) info(`${c.feature.padEnd(20)} ${String(c.amount ?? "?").padStart(4)} ${c.unit ?? "units"}  ${c.description ?? ""}`);
        info("If these differ from YOUCAM_COST_SKIN / YOUCAM_COST_TONE / YOUCAM_COST_LOOK, set those so the budget guard counts correctly.");
      }
    } catch (e) {
      warn(`Could not read the price list: ${describe(e)}. Budget math will use the defaults.`);
    }
    info(`Skin analysis uses ${cfg.youcam.actions.length} concerns (${cfg.youcam.actions.join(", ")}), API ${cfg.youcam.skinVersion}, strictness "${cfg.youcam.strictness}".`);
  }
  const perScan = costs.skin + costs.tone;
  console.log(
    `    ${dim(`Budget guard: ${cfg.limits.dailyUnits} units/day overall, ${cfg.limits.ipDailyUnits} per visitor → ${Math.floor(cfg.limits.dailyUnits / Math.max(1, perScan))} scans/day, ${Math.floor(cfg.limits.ipDailyUnits / Math.max(1, perScan))} per visitor (${perScan} units per scan, ${costs.look} per try-on).`)}`,
  );

  // ---- LLM
  heading(`Voice brain (${cfg.llm.label})`);
  if (!llmLive(cfg)) {
    warn(
      cfg.llm.provider
        ? `Provider "${cfg.llm.provider}" is selected but has no key.`
        : "No LLM key. The mirror still works using its built-in understanding of common requests; add GROQ_API_KEY (free) for open conversation.",
    );
  } else {
    const llm = new LlmClient(cfg.llm);
    ok(`Provider ${cfg.llm.label} at ${cfg.llm.baseUrl}`);
    try {
      const live = await llm.availableModels();
      if (live.length === 0) warn("Model discovery returned nothing; the app will use its built-in fallback model names.");
      else ok(`${live.length} models available.`);
      info(`Chat models it will try:   ${(await llm.candidates(false)).join(", ") || "(none)"}`);
      info(`Vision models it will try: ${(await llm.candidates(true)).join(", ") || "(none)"}`);
    } catch (e) {
      warn(`Model discovery failed: ${describe(e)}`);
    }
    try {
      const reply = await llm.complete({ messages: [{ role: "user", content: "Reply with the single word: ready" }], maxTokens: 8, temperature: 0 });
      ok(`Test reply from ${reply.model}: "${reply.text.slice(0, 40).replace(/\s+/g, " ")}"`);
    } catch (e) {
      fail(`The model did not answer: ${describe(e)}${e instanceof LlmError && e.kind === "auth" ? " — check the key." : ""}`);
    }
  }

  // ---- Hosting
  heading("Hosting");
  if (cfg.kv.url) ok("Shared limits store (Upstash) is configured, so limits hold across serverless instances.");
  else warn("No Upstash/KV store. Limits are kept in memory per server instance — fine for a demo, softer on serverless hosting.");
  if (cfg.allowedOrigins.length > 0) ok(`Extra allowed origins: ${cfg.allowedOrigins.join(", ")}`);
  else info("Only same-origin requests are accepted (set ALLOWED_ORIGINS if you serve the page from another domain).");

  console.log("");
  if (failures > 0) {
    console.log(red(`${failures} problem${failures === 1 ? "" : "s"} to fix before demoing.`));
    process.exitCode = 1;
  } else if (cautions > 0) {
    console.log(amber(`Ready, with ${cautions} note${cautions === 1 ? "" : "s"} above.`));
  } else {
    console.log(green("All clear. Darpan is ready."));
  }
}

main().catch((e) => {
  console.error(red(`Doctor crashed: ${describe(e)}`));
  process.exitCode = 1;
});
