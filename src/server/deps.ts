import { getConfig, skinMode, type Config } from "./config";
import { Budget } from "./budget";
import { createKV, type KV } from "./kv";
import { ticketSecret } from "./ticket";
import { YouCamClient } from "./youcam/client";
import { LlmClient } from "./llm/client";

/**
 * Everything a route needs, built once per server instance. Tests build their own with
 * `buildDeps` (fake fetch, fake clock) and install it with `setDepsForTests`.
 */

export interface Deps {
  cfg: Config;
  kv: KV;
  budget: Budget;
  /** Null when there is no YouCam key (or Demo Mode is forced). */
  youcam: YouCamClient | null;
  llm: LlmClient | null;
  secret: string;
  now: () => number;
  fetchImpl: typeof fetch;
}

export interface BuildOptions {
  fetchImpl?: typeof fetch;
  kv?: KV;
  now?: () => number;
}

export function buildDeps(cfg: Config, opts: BuildOptions = {}): Deps {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const kv = opts.kv ?? createKV(cfg.kv);
  const youcam = skinMode(cfg) === "live" ? new YouCamClient(cfg.youcam, fetchImpl) : null;
  const llm = cfg.llm.provider && cfg.llm.apiKey && cfg.llm.baseUrl ? new LlmClient(cfg.llm, fetchImpl, now) : null;
  const budget = new Budget(kv, cfg.limits, cfg.limits.minBalance > 0 && youcam ? () => youcam.credits() : null, now);
  return { cfg, kv, budget, youcam, llm, secret: ticketSecret(cfg.youcam.apiKey), now, fetchImpl };
}

let singleton: Deps | null = null;

export function getDeps(): Deps {
  singleton ??= buildDeps(getConfig());
  return singleton;
}

export function setDepsForTests(d: Deps | null): void {
  singleton = d;
}
