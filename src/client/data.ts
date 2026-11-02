import { z } from "zod";
import { CONCERN_KEYS } from "@/lib/concerns";
import type { TrackedProduct } from "@/lib/ledger/verdict";
import type { RitualState } from "@/lib/ritual/engine";
import { CATEGORIES, type Category } from "@/lib/ritual/products";
import type { Confidence, SkinScan } from "@/lib/skin/types";
import { DEFAULT_SETTINGS, LANGUAGES, PACES, type Settings } from "@/lib/types";

/**
 * Everything the mirror remembers, and it all stays on this device (localStorage). Photos are
 * never kept: a scan is stored as its scores and how sure the mirror was, nothing more.
 *
 * Reading is forgiving. A half-corrupt or older save never wipes everything: each part is checked
 * on its own, bad entries are dropped, and good ones survive. Writing is strict.
 */

export const DATA_VERSION = 1;
export const MAX_SCANS = 150;
export const MAX_TRACKED = 24;
export const MAX_HISTORY = 90;
/** A ritual left open for longer than this is treated as abandoned. */
export const RITUAL_STALE_MS = 6 * 3_600_000;

export interface RitualRecord {
  id: string;
  period: "am" | "pm";
  startedAt: number;
  finishedAt: number;
  products: { name: string; category: Category }[];
}

export interface PersistedData {
  v: typeof DATA_VERSION;
  settings: Settings;
  scans: SkinScan[];
  tracked: TrackedProduct[];
  history: RitualRecord[];
  ritual: RitualState | null;
  /** Random per-device value so a Demo Mode rescan lands near the first demo scan. Never a person's data. */
  demoSeed: string;
  lastVisitAt: number | null;
}

// ------------------------------------------------------------------ schemas

const Score = z.number().min(0).max(100);
const ScoresSchema = z.object(Object.fromEntries(CONCERN_KEYS.map((k) => [k, Score.optional()])) as Record<(typeof CONCERN_KEYS)[number], z.ZodOptional<typeof Score>>);

const ConfidenceSchema: z.ZodType<Confidence> = z.object({
  level: z.enum(["high", "medium", "low"]),
  score: z.number().min(0).max(1),
  reasons: z.array(z.enum(["dim_light", "uneven_light", "glare", "deeper_tone", "low_resolution", "demo"])).max(6),
});

const ScanSchema = z.object({
  id: z.string().min(1).max(64),
  at: z.number().int().positive(),
  source: z.enum(["youcam", "demo"]),
  scores: ScoresSchema,
  lighting: z.number().min(0).max(1),
  confidence: ConfidenceSchema,
  kind: z.enum(["baseline", "after", "checkin"]),
  ritualId: z.string().max(64).optional(),
});

const CategorySchema = z.enum(CATEGORIES);

const TrackedSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(80),
  category: CategorySchema,
  startedAt: z.number().int().positive(),
});

const AppliedSchema = z.object({
  id: z.string().max(80),
  name: z.string().trim().min(1).max(80),
  category: CategorySchema,
  slot: z.enum(["oil_cleanse", "cleanse", "tone", "exfoliate", "treat", "serum", "eye", "moisturize", "oil", "protect", "extra"]),
  at: z.number().int().positive(),
});

const RitualSchema = z.object({
  id: z.string().min(1).max(64),
  period: z.enum(["am", "pm"]),
  startedAt: z.number().int().positive(),
  status: z.enum(["active", "complete"]),
  applied: z.array(AppliedSchema).max(30),
  skipped: z.array(AppliedSchema.shape.slot).max(12),
  warned: z.array(z.string().max(60)).max(40),
});

const RecordSchema = z.object({
  id: z.string().min(1).max(64),
  period: z.enum(["am", "pm"]),
  startedAt: z.number().int().positive(),
  finishedAt: z.number().int().positive(),
  products: z.array(z.object({ name: z.string().max(80), category: CategorySchema })).max(30),
});

const SETTINGS_FIELDS = {
  titleId: z.string().max(24),
  customTitle: z.string().max(24),
  language: z.enum(LANGUAGES),
  pace: z.enum(PACES),
  consentLook: z.boolean(),
  consentScan: z.boolean(),
  handsFree: z.boolean(),
  kiosk: z.boolean(),
  voiceUri: z.string().max(240),
  welcomed: z.boolean(),
} satisfies Record<keyof Settings, z.ZodType>;

// ------------------------------------------------------------------ builders

export function randomId(prefix: string, now: number, rand: () => number = Math.random): string {
  return `${prefix}-${now.toString(36)}-${Math.floor(rand() * 36 ** 4).toString(36).padStart(4, "0")}`;
}

export function defaultData(rand: () => number = Math.random): PersistedData {
  const seed = Array.from({ length: 8 }, () => "abcdefghjkmnpqrstuvwxyz23456789"[Math.floor(rand() * 31)]).join("");
  return {
    v: DATA_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    scans: [],
    tracked: [],
    history: [],
    ritual: null,
    demoSeed: seed,
    lastVisitAt: null,
  };
}

/** Parse whatever was saved, keeping every part that is still good. Never throws. */
export function parseData(raw: unknown, now: number, rand: () => number = Math.random): PersistedData {
  const base = defaultData(rand);
  if (typeof raw !== "object" || raw === null) return base;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.v === "number" && obj.v > DATA_VERSION) return base; // saved by a newer build: do not guess

  const settings: Settings = { ...DEFAULT_SETTINGS };
  if (typeof obj.settings === "object" && obj.settings !== null) {
    const s = obj.settings as Record<string, unknown>;
    for (const key of Object.keys(SETTINGS_FIELDS) as (keyof Settings)[]) {
      const r = SETTINGS_FIELDS[key].safeParse(s[key]);
      if (r.success) (settings as unknown as Record<string, unknown>)[key] = r.data;
    }
  }

  const keep = <T,>(schema: z.ZodType<T>, list: unknown): T[] => {
    if (!Array.isArray(list)) return [];
    const out: T[] = [];
    for (const item of list) {
      const r = schema.safeParse(item);
      if (r.success) out.push(r.data);
    }
    return out;
  };

  // oldest first, then keep the newest few: a shuffled save must not lose the wrong entries
  const scans = keep(ScanSchema, obj.scans).sort((a, b) => a.at - b.at).slice(-MAX_SCANS) as SkinScan[];
  const tracked = keep(TrackedSchema, obj.tracked).slice(-MAX_TRACKED) as TrackedProduct[];
  const history = keep(RecordSchema, obj.history).sort((a, b) => a.startedAt - b.startedAt).slice(-MAX_HISTORY) as RitualRecord[];

  let ritual: RitualState | null = null;
  const parsedRitual = RitualSchema.safeParse(obj.ritual);
  if (parsedRitual.success && parsedRitual.data.status === "active" && now - parsedRitual.data.startedAt < RITUAL_STALE_MS) {
    ritual = parsedRitual.data as RitualState;
  }

  const demoSeed = typeof obj.demoSeed === "string" && /^[A-Za-z0-9_-]{4,40}$/.test(obj.demoSeed) ? obj.demoSeed : base.demoSeed;
  const lastVisitAt = typeof obj.lastVisitAt === "number" && Number.isFinite(obj.lastVisitAt) ? obj.lastVisitAt : null;

  return { v: DATA_VERSION, settings, scans, tracked, history, ritual, demoSeed, lastVisitAt };
}

// ------------------------------------------------------------------ updates (pure)

export function withSettings(d: PersistedData, patch: Partial<Settings>): PersistedData {
  return { ...d, settings: { ...d.settings, ...patch } };
}

export function addScan(d: PersistedData, scan: SkinScan): PersistedData {
  const scans = [...d.scans, scan].sort((a, b) => a.at - b.at).slice(-MAX_SCANS);
  return { ...d, scans };
}

export function lastScan(d: PersistedData): SkinScan | null {
  return d.scans.length > 0 ? d.scans[d.scans.length - 1]! : null;
}

/** The scan to compare a new one against: the latest taken at or before `at` (before a ritual started, say). */
export function scanBefore(d: PersistedData, at: number): SkinScan | null {
  for (let i = d.scans.length - 1; i >= 0; i -= 1) if (d.scans[i]!.at <= at) return d.scans[i]!;
  return null;
}

const sameProduct = (a: { name: string; category: Category }, b: { name: string; category: Category }) =>
  a.category === b.category && a.name.trim().toLowerCase() === b.name.trim().toLowerCase();

/** Start watching a product. Tracking one already on the shelf keeps its original start date. */
export function startTracking(d: PersistedData, p: { name: string; category: Category }, now: number, rand: () => number = Math.random): { data: PersistedData; product: TrackedProduct; existed: boolean } {
  const existing = d.tracked.find((t) => sameProduct(t, p));
  if (existing) return { data: d, product: existing, existed: true };
  const product: TrackedProduct = { id: randomId("t", now, rand), name: p.name.trim().slice(0, 80), category: p.category, startedAt: now };
  return { data: { ...d, tracked: [...d.tracked, product].slice(-MAX_TRACKED) }, product, existed: false };
}

export function stopTracking(d: PersistedData, id: string): PersistedData {
  return { ...d, tracked: d.tracked.filter((t) => t.id !== id) };
}

export function setRitual(d: PersistedData, ritual: RitualState | null): PersistedData {
  return { ...d, ritual };
}

/** File a finished ritual into the history and clear the active one. */
export function recordRitual(d: PersistedData, ritual: RitualState, now: number): PersistedData {
  const record: RitualRecord = {
    id: ritual.id,
    period: ritual.period,
    startedAt: ritual.startedAt,
    finishedAt: now,
    products: ritual.applied.map((a) => ({ name: a.name, category: a.category })),
  };
  const history = [...d.history.filter((h) => h.id !== record.id), record].slice(-MAX_HISTORY);
  return { ...d, history, ritual: null };
}

export function touch(d: PersistedData, now: number): PersistedData {
  return { ...d, lastVisitAt: now };
}

// --------------------------------------------------------------------- storage

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const STORAGE_KEY = "darpan:v1";

export class DataStore {
  /** False when the browser refuses storage (private windows, blocked cookies): nothing will be remembered. */
  persistent: boolean;
  private memory: string | null = null;

  constructor(
    private readonly storage: StorageLike | null,
    private readonly key: string = STORAGE_KEY,
  ) {
    this.persistent = storage !== null && this.probe();
  }

  private probe(): boolean {
    try {
      const k = `${this.key}:probe`;
      this.storage!.setItem(k, "1");
      this.storage!.removeItem(k);
      return true;
    } catch {
      return false;
    }
  }

  load(now: number, rand: () => number = Math.random): PersistedData {
    let raw: string | null = null;
    try {
      raw = this.persistent ? this.storage!.getItem(this.key) : this.memory;
    } catch {
      raw = this.memory;
    }
    if (!raw) return defaultData(rand);
    try {
      return parseData(JSON.parse(raw), now, rand);
    } catch {
      return defaultData(rand);
    }
  }

  save(d: PersistedData): boolean {
    const text = JSON.stringify(d);
    this.memory = text;
    if (!this.persistent) return false;
    try {
      this.storage!.setItem(this.key, text);
      return true;
    } catch {
      // quota or a blocked write: keep working from memory
      this.persistent = false;
      return false;
    }
  }

  /** "Forget me": remove everything, including the settings. */
  erase(): void {
    this.memory = null;
    try {
      this.storage?.removeItem(this.key);
    } catch {
      /* nothing more to do */
    }
  }
}

/** The browser's localStorage, or null when even touching it throws. */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
