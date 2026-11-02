import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Fetch a result image (the makeup preview) on the server and hand it to the browser as a data
 * URL. That keeps the page's Content-Security-Policy tight (no third-party image hosts to allow)
 * and lets the server refuse anything that is not really a small image from a public address.
 */

export function isPublicIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a === 169 && b === 254) return false; // link-local, cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false;
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    if (a >= 224) return false; // multicast, reserved, broadcast
    return true;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return false;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPublicIp(mapped[1]!);
    if (/^f[cd]/.test(x)) return false; // unique local
    if (/^fe[89ab]/.test(x)) return false; // link-local
    if (x.startsWith("ff")) return false; // multicast
    if (x.startsWith("2001:db8")) return false; // documentation
    return true;
  }
  return false;
}

export type ImageType = "image/jpeg" | "image/png" | "image/webp";

export function sniffImageType(b: Uint8Array): ImageType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return "image/webp";
  }
  return null;
}

export interface FetchImageOptions {
  maxBytes?: number;
  /** Hosts trusted without the public-address check (the YouCam API host, or a local mock in tests). */
  trustedHosts?: readonly string[];
  fetchImpl?: typeof fetch;
  resolve?: (host: string) => Promise<string[]>;
  timeoutMs?: number;
}

export class ImageFetchError extends Error {
  constructor(public readonly reason: "bad_url" | "blocked" | "too_big" | "not_image" | "failed") {
    super(reason);
    this.name = "ImageFetchError";
  }
}

async function defaultResolve(host: string): Promise<string[]> {
  const all = await lookup(host, { all: true });
  return all.map((a) => a.address);
}

export async function fetchImageAsDataUrl(rawUrl: string, opts: FetchImageOptions = {}): Promise<{ dataUrl: string; bytes: number; type: ImageType }> {
  const maxBytes = opts.maxBytes ?? 4_000_000;
  const doFetch = opts.fetchImpl ?? fetch;
  const resolve = opts.resolve ?? defaultResolve;
  const trusted = new Set((opts.trustedHosts ?? []).map((h) => h.toLowerCase()));

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ImageFetchError("bad_url");
  }

  for (let hop = 0; hop < 3; hop += 1) {
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const isTrusted = trusted.has(url.host.toLowerCase()) || trusted.has(host);
    if (url.username || url.password) throw new ImageFetchError("blocked");
    if (url.protocol !== "https:" && !(isTrusted && url.protocol === "http:")) throw new ImageFetchError("blocked");
    if (!isTrusted) {
      if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
        throw new ImageFetchError("blocked");
      }
      const addresses = isIP(host) ? [host] : await resolve(host).catch(() => []);
      if (addresses.length === 0 || !addresses.every(isPublicIp)) throw new ImageFetchError("blocked");
    }

    let res: Response;
    try {
      res = await doFetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
        headers: { Accept: "image/*" },
        cache: "no-store",
      });
    } catch {
      throw new ImageFetchError("failed");
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new ImageFetchError("failed");
      try {
        url = new URL(loc, url);
      } catch {
        throw new ImageFetchError("bad_url");
      }
      continue;
    }
    if (!res.ok || !res.body) throw new ImageFetchError("failed");

    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) throw new ImageFetchError("too_big");

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ImageFetchError("too_big");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      bytes.set(c, o);
      o += c.byteLength;
    }
    // never trust Content-Type: read the magic bytes
    const type = sniffImageType(bytes);
    if (!type) throw new ImageFetchError("not_image");
    return { dataUrl: `data:${type};base64,${Buffer.from(bytes).toString("base64")}`, bytes: total, type };
  }
  throw new ImageFetchError("failed");
}
