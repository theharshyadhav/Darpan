import type { Config } from "../config";
import { UpstreamError, errorFromStatus, kindFromCode } from "./errors";

/**
 * A small, honest client for the YouCam AI REST API (https://yce-api-01.makeupar.com), following the
 * flow in YouCam's own reference implementation: upload a file (JSON metadata, then PUT to the signed
 * URL), create a task with the returned `file_id`, then poll the task until `task_status` is
 * `success` or `error`. Nothing here is cached or stored.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export type Feature = "skin-analysis" | "skin-tone-analysis" | "makeup-vto";

export interface TaskState {
  status: "running" | "success" | "error";
  /** The task's `data` payload as returned. */
  data: Obj;
  errorCode?: string;
  errorMessage?: string;
}

export interface FeatureCost {
  feature: string;
  description?: string;
  amount?: number;
  unit?: string;
}

const REQUEST_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 40_000;

export class YouCamClient {
  constructor(
    private readonly cfg: Config["youcam"],
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.cfg.apiKey ?? ""}`, "Content-Type": "application/json" };
  }

  private async send(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Obj> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new UpstreamError(timedOut ? "busy" : "network", timedOut ? "YouCam timed out" : "could not reach YouCam");
    }

    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    const obj = isObj(parsed) ? parsed : {};

    if (!res.ok) {
      const code = [obj.error_code, obj.code, obj.error].find((v): v is string => typeof v === "string");
      const message = [obj.error_message, obj.message, obj.detail, obj.error].find((v): v is string => typeof v === "string");
      const retry = Number(res.headers.get("retry-after"));
      throw errorFromStatus(res.status, code, message, Number.isFinite(retry) && retry > 0 ? retry : undefined);
    }
    return obj;
  }

  /** Upload one image and return its `file_id`. */
  async upload(bytes: Uint8Array, contentType: "image/jpeg" | "image/png", fileName: string): Promise<string> {
    const meta = await this.send("POST", "/s2s/v2.0/file", {
      files: [{ content_type: contentType, file_name: fileName, file_size: bytes.byteLength }],
    });
    const data = isObj(meta.data) ? meta.data : {};
    const file = Array.isArray(data.files) && isObj(data.files[0]) ? data.files[0] : undefined;
    const put = file && Array.isArray(file.requests) && isObj(file.requests[0]) ? file.requests[0] : undefined;
    const fileId = file && typeof file.file_id === "string" ? file.file_id : undefined;
    const putUrl = put && typeof put.url === "string" ? put.url : undefined;
    if (!fileId || !putUrl) throw new UpstreamError("unavailable", "upload response was not understood");
    if (!/^https?:\/\//i.test(putUrl)) throw new UpstreamError("unavailable", "upload URL was not http(s)");

    const headers: Record<string, string> = { "Content-Type": contentType };
    if (isObj(put?.headers)) {
      for (const [k, v] of Object.entries(put.headers)) if (typeof v === "string") headers[k] = v;
    }
    let res: Response;
    try {
      res = await this.fetchImpl(putUrl, {
        method: "PUT",
        headers,
        body: bytes as BodyInit,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      throw new UpstreamError("network", "upload failed");
    }
    if (!res.ok) throw errorFromStatus(res.status, undefined, "upload rejected");
    return fileId;
  }

  async createTask(feature: Feature, version: string, body: Obj): Promise<string> {
    const out = await this.send("POST", `/s2s/${version}/task/${feature}`, body);
    const data = isObj(out.data) ? out.data : {};
    const id = data.task_id;
    if (typeof id !== "string" || !id) throw new UpstreamError("unavailable", "task id missing from response");
    return id;
  }

  async getTask(feature: Feature, version: string, taskId: string): Promise<TaskState> {
    const out = await this.send("GET", `/s2s/${version}/task/${feature}/${encodeURIComponent(taskId)}`);
    const data = isObj(out.data) ? out.data : {};
    const raw = String(data.task_status ?? "").toLowerCase();
    if (raw === "success") return { status: "success", data };
    if (raw === "error" || raw === "failed" || raw === "failure") {
      const code = [data.error, data.error_code, isObj(data.error) ? data.error.code : undefined].find(
        (v): v is string => typeof v === "string",
      );
      const message = [data.error_message, isObj(data.error) ? data.error.message : undefined].find(
        (v): v is string => typeof v === "string",
      );
      return { status: "error", data, errorCode: code, errorMessage: message };
    }
    return { status: "running", data };
  }

  /** Convert a failed task into a typed error. */
  static taskError(t: TaskState): UpstreamError {
    const { kind, spendBlocked } = kindFromCode(t.errorCode, t.errorMessage);
    return new UpstreamError(kind, t.errorMessage ?? t.errorCode ?? "task failed", { code: t.errorCode, spendBlocked });
  }

  /** Spendable API units left on the account (sum of batches whose type starts with "Api"), or null. */
  async credits(): Promise<number | null> {
    const out = await this.send("GET", "/s2s/v1.0/client/credit");
    const batches = Array.isArray(out.results) ? out.results : [];
    let total = 0;
    let any = false;
    for (const b of batches) {
      if (!isObj(b)) continue;
      if (String(b.type ?? "").startsWith("Api")) {
        total += Number(b.amount) || 0;
        any = true;
      }
    }
    return any ? total : null;
  }

  /** The per-call unit cost table for this account (every SKU, paged). */
  async featureCosts(): Promise<FeatureCost[]> {
    const costs: FeatureCost[] = [];
    let token: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const qs = new URLSearchParams({ page_size: "20" });
      if (token) qs.set("starting_token", token);
      const out = await this.send("GET", `/s2s/v2.0/credit/feature-cost?${qs.toString()}`);
      const result = isObj(out.result) ? out.result : {};
      const skus = Array.isArray(result.skus) ? result.skus : [];
      for (const s of skus) {
        if (!isObj(s)) continue;
        const url = typeof s.run_task_url === "string" ? s.run_task_url : "";
        const feature = url.includes("/task/") ? url.replace(/\/+$/, "").split("/task/").pop()! : "(other)";
        costs.push({
          feature,
          description: typeof s.description === "string" ? s.description : undefined,
          amount: typeof s.amount === "number" ? s.amount : undefined,
          unit: typeof s.unit === "string" ? s.unit : undefined,
        });
      }
      token = typeof result.next_token === "string" && result.next_token ? result.next_token : undefined;
      if (!token) break;
    }
    return costs;
  }
}
