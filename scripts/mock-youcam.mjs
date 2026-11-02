#!/usr/bin/env node
/**
 * A local stand-in for the YouCam AI REST API, built from YouCam's own published reference
 * (https://docs.perfectcorp.com and the official YouCam-API/skills repository). It exists so the
 * whole scan and look flow can be developed, demoed and tested without spending a single unit:
 *
 *   npm run mock:youcam                       # listens on http://127.0.0.1:4010
 *   YOUCAM_API_KEY=mock-key \
 *   YOUCAM_BASE_URL=http://127.0.0.1:4010 \
 *   DARPAN_ALLOW_HTTP_UPSTREAM=1 npm run dev  # point the app at it
 *
 * It models: upload (metadata, then PUT), task creation with the real request fields, status polling
 * (running, then success), the documented result shapes, error codes, the credit endpoint and the
 * paged feature-cost endpoint. It is NOT YouCam: scores are made up (but stable per photo), and it
 * says so in every result it renders.
 */
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const SD_ACTIONS = [
  "wrinkle", "droopy_upper_eyelid", "droopy_lower_eyelid", "firmness", "acne", "moisture", "eye_bag",
  "dark_circle_v2", "age_spot", "radiance", "redness", "oiliness", "pore", "texture", "tear_trough", "skin_type",
];

// smallest valid-looking JPEG and PNG headers; enough for magic-byte checks
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=", "base64");

function stableScore(seed, key) {
  const h = createHash("sha256").update(`${seed}:${key}`).digest();
  return 48 + (h[0] % 44); // 48..91
}

export function createMock(options = {}) {
  const opts = {
    apiKey: "mock-key",
    credits: 500,
    /** How many polls report "running" before success. */
    runningPolls: 1,
    skinVersions: ["v2.1", "v2.0"],
    /** Which result shape the tone endpoint uses: "map" or "list". */
    toneShape: "map",
    /** Which result shape skin analysis uses: "output" (documented), "map" (score_info.json style) or "weird". */
    skinShape: "output",
    ...options,
  };

  const files = new Map(); // file_id -> { size, contentType, bytes }
  const tasks = new Map(); // task_id -> { feature, version, polls, body, seed, fault }
  const faults = []; // queued one-shot faults
  const stats = { uploads: 0, creates: {}, polls: 0, requests: [], lastBody: {} };
  let origin = "";

  function fault(match) {
    const i = faults.findIndex((f) => (!f.feature || f.feature === match.feature) && f.at === match.at);
    return i >= 0 ? faults.splice(i, 1)[0] : null;
  }

  function send(res, status, body, headers = {}) {
    const text = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, { "Content-Type": typeof body === "object" && !Buffer.isBuffer(body) ? "application/json" : "application/octet-stream", ...headers });
    res.end(text);
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    stats.requests.push({ method: req.method, path: url.pathname, bytes: raw.length });

    // signed-upload and result downloads need no auth, like pre-signed URLs
    if (req.method === "PUT" && url.pathname.startsWith("/upload/")) {
      const f = files.get(decodeURIComponent(url.pathname.slice("/upload/".length)));
      if (!f) return send(res, 404, { error: "unknown upload" });
      f.bytes = raw;
      return send(res, 200, "");
    }
    if (req.method === "GET" && url.pathname.startsWith("/results/")) {
      return send(res, 200, JPEG, { "Content-Type": "image/jpeg" });
    }

    if (req.headers.authorization !== `Bearer ${opts.apiKey}`) {
      return send(res, 401, { status: 401, error: "invalid_api_key", error_message: "Invalid API key" });
    }

    let body = {};
    try {
      body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
    } catch {
      return send(res, 400, { status: 400, error: "invalid_parameter", error_message: "bad json" });
    }

    // ---- credit
    if (req.method === "GET" && url.pathname === "/s2s/v1.0/client/credit") {
      return send(res, 200, { status: 200, results: [{ type: "ApiUnit", amount: opts.credits }, { type: "GiftPoint", amount: 7 }] });
    }
    if (req.method === "GET" && url.pathname === "/s2s/v2.0/credit/feature-cost") {
      const token = url.searchParams.get("starting_token");
      const skus = token
        ? [{ description: "Makeup VTO", amount: 8, unit: "unit", proc_unit: "image", run_task_url: `${origin}/s2s/v2.0/task/makeup-vto` }]
        : [
            { description: "Skin analysis, SD 5-7 concerns", amount: 12, unit: "unit", proc_unit: "image", run_task_url: `${origin}/s2s/v2.1/task/skin-analysis` },
            { description: "Skin tone", amount: 3, unit: "unit", proc_unit: "image", run_task_url: `${origin}/s2s/v2.0/task/skin-tone-analysis` },
          ];
      return send(res, 200, { status: 200, result: { skus, next_token: token ? null : "page2" } });
    }

    // ---- upload metadata
    if (req.method === "POST" && url.pathname === "/s2s/v2.0/file") {
      const f = fault({ at: "upload" });
      if (f) return send(res, f.status ?? 500, { status: f.status ?? 500, error: f.code ?? "unknown_internal_error" });
      const meta = body.files?.[0];
      if (!meta || !["image/jpeg", "image/png", "video/mp4"].includes(meta.content_type)) {
        return send(res, 400, { status: 400, error: "invalid_parameter", error_message: "unsupported content_type" });
      }
      if (meta.file_size > 10 * 1024 * 1024) return send(res, 413, { status: 413, error: "exceed_max_filesize" });
      const id = randomBytes(24).toString("base64");
      files.set(id, { size: meta.file_size, contentType: meta.content_type, bytes: null });
      stats.uploads += 1;
      return send(res, 200, {
        status: 200,
        data: {
          files: [{
            content_type: meta.content_type,
            file_name: meta.file_name,
            file_id: id,
            requests: [{ method: "PUT", url: `${origin}/upload/${encodeURIComponent(id)}`, headers: { "Content-Type": meta.content_type } }],
          }],
        },
      });
    }

    // ---- tasks
    const m = /^\/s2s\/(v\d+\.\d+)\/task\/([a-z-]+)(?:\/(.+))?$/.exec(url.pathname);
    if (m) {
      const [, version, feature, taskId] = m;
      const known = {
        "skin-analysis": opts.skinVersions,
        "skin-tone-analysis": ["v2.0"],
        "makeup-vto": ["v2.0"],
      };
      if (!known[feature] || !known[feature].includes(version)) {
        return send(res, 404, { status: 404, error: "not_found", error_message: `unknown ${feature} ${version}` });
      }

      if (req.method === "POST" && !taskId) {
        const f = fault({ at: "create", feature });
        if (f) return send(res, f.status ?? 400, { status: f.status ?? 400, error: f.code ?? "invalid_parameter", error_message: f.message });
        const file = files.get(body.src_file_id);
        if (!file || !file.bytes) return send(res, 400, { status: 400, error: "invalid_parameter", error_message: "src_file_id not found or not uploaded" });
        if (feature === "skin-analysis") {
          const actions = body.dst_actions;
          const hd = Array.isArray(actions) && actions.some((a) => String(a).startsWith("hd_"));
          const sd = Array.isArray(actions) && actions.some((a) => !String(a).startsWith("hd_"));
          if (!Array.isArray(actions) || actions.length === 0 || (hd && sd) || actions.some((a) => !SD_ACTIONS.includes(a) && !String(a).startsWith("hd_"))) {
            return send(res, 400, { status: 400, error: "invalid_parameter", error_message: "dst_actions invalid or mixes HD and SD" });
          }
        }
        if (feature === "makeup-vto") {
          if (!Array.isArray(body.effects) || body.effects.length === 0 || body.effects.some((e) => typeof e?.category !== "string")) {
            return send(res, 400, { status: 400, error: "invalid_parameter", error_message: "effects must be a non-empty array with categories" });
          }
        }
        const id = randomBytes(18).toString("base64url");
        const seed = createHash("sha256").update(file.bytes).digest("hex").slice(0, 12);
        tasks.set(id, { feature, version, polls: 0, body, seed, fault: fault({ at: "task", feature }) });
        stats.creates[feature] = (stats.creates[feature] ?? 0) + 1;
        stats.lastBody[feature] = body;
        return send(res, 200, { status: 200, data: { task_id: id } });
      }

      if (req.method === "GET" && taskId) {
        const t = tasks.get(decodeURIComponent(taskId));
        if (!t || t.feature !== feature) return send(res, 404, { status: 404, error: "not_found" });
        stats.polls += 1;
        t.polls += 1;
        if (t.fault) return send(res, 200, { status: 200, data: { task_id: taskId, task_status: "error", error: t.fault.code ?? "error_no_face", error_message: t.fault.message ?? "mock failure" } });
        if (t.polls <= opts.runningPolls) return send(res, 200, { status: 200, data: { task_id: taskId, task_status: "running" } });

        if (feature === "skin-analysis") {
          const actions = t.body.dst_actions ?? [];
          if (opts.skinShape === "weird") {
            return send(res, 200, { status: 200, data: { task_id: taskId, task_status: "success", results: { summary: "ok", n: actions.length } } });
          }
          if (opts.skinShape === "map") {
            const results = Object.fromEntries(actions.map((a) => [a, { raw_score: 1, ui_score: stableScore(t.seed, a), output_mask_name: `${a}_output.png` }]));
            return send(res, 200, { status: 200, data: { task_id: taskId, task_status: "success", results } });
          }
          const output = actions.map((a) => ({
            type: a,
            ui_score: stableScore(t.seed, a),
            raw_score: 1.23,
            mask_urls: [`${origin}/results/mask-${a}.png`],
          }));
          return send(res, 200, { status: 200, data: { task_id: taskId, task_status: "success", results: { output } } });
        }
        if (feature === "skin-tone-analysis") {
          const results = opts.toneShape === "list"
            ? { output: [{ type: "skin", color: "#c68642", name: "Tan" }, { type: "eye", color: "#3b2f2f" }] }
            : { skin: { hex: "#c68642", name: "Tan" }, eye: { hex: "#3b2f2f" }, lip: { hex: "#a8545a" }, eyebrow: { hex: "#2d2018" }, hair: { hex: "#1b1410" } };
          return send(res, 200, { status: 200, data: { task_id: taskId, task_status: "success", results } });
        }
        return send(res, 200, { status: 200, data: { task_id: taskId, task_status: "success", results: { url: `${origin}/results/${taskId}.jpg` } } });
      }
    }

    return send(res, 404, { status: 404, error: "not_found", error_message: `${req.method} ${url.pathname}` });
  });

  return {
    server,
    stats,
    /** Queue a one-shot failure: { at: "upload"|"create"|"task", feature?, status?, code?, message? }. */
    failNext(f) {
      faults.push(f);
    },
    setOptions(next) {
      Object.assign(opts, next);
    },
    /** Forget uploads, tasks, queued faults and counters (options are kept). */
    reset() {
      files.clear();
      tasks.clear();
      faults.length = 0;
      stats.uploads = 0;
      stats.polls = 0;
      stats.creates = {};
      stats.lastBody = {};
      stats.requests.length = 0;
    },
    listen(port = 0, host = "127.0.0.1") {
      return new Promise((resolve) => {
        server.listen(port, host, () => {
          const addr = server.address();
          origin = `http://${host}:${addr.port}`;
          resolve({ origin, port: addr.port });
        });
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

// CLI: node scripts/mock-youcam.mjs [port]
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.argv[2] ?? process.env.PORT ?? 4010);
  const mock = createMock({ apiKey: process.env.MOCK_YOUCAM_KEY ?? "mock-key" });
  const { origin } = await mock.listen(port);
  console.log(`Mock YouCam API listening on ${origin}`);
  console.log("Point Darpan at it:");
  console.log(`  YOUCAM_API_KEY=${process.env.MOCK_YOUCAM_KEY ?? "mock-key"} YOUCAM_BASE_URL=${origin} DARPAN_ALLOW_HTTP_UPSTREAM=1 npm run dev`);
  console.log("This is a stand-in: every number is made up. Never present it as a real measurement.");
}
