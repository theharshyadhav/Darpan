import { describe, expect, it, vi } from "vitest";
import {
  DataStore,
  MAX_SCANS,
  RITUAL_STALE_MS,
  STORAGE_KEY,
  addScan,
  defaultData,
  lastScan,
  parseData,
  recordRitual,
  scanBefore,
  setRitual,
  startTracking,
  stopTracking,
  withSettings,
  type StorageLike,
} from "@/client/data";
import { applyProduct, createRitual } from "@/lib/ritual/engine";
import type { SkinScan } from "@/lib/skin/types";
import { DAY, T0, allScores, scan } from "./helpers";

const mk = (at: number, extra: Partial<Omit<SkinScan, "at" | "scores">> = {}): SkinScan => scan(at, allScores(70), extra);

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const seeded = () => {
  let n = 0;
  return () => ((n += 0.137) % 1);
};

describe("defaultData", () => {
  it("starts empty with a stable-looking demo seed", () => {
    const d = defaultData(seeded());
    expect(d.scans).toEqual([]);
    expect(d.ritual).toBeNull();
    expect(d.settings.welcomed).toBe(false);
    expect(d.settings.consentScan).toBe(false);
    expect(d.demoSeed).toMatch(/^[a-z0-9]{8}$/);
  });
});

describe("parseData", () => {
  it("round-trips a full save", () => {
    let d = defaultData(seeded());
    d = withSettings(d, { welcomed: true, language: "hi", titleId: "maharani", consentScan: true });
    d = addScan(d, mk(T0));
    const t = startTracking(d, { name: "Retinol", category: "retinoid" }, T0, seeded());
    d = t.data;
    const r = applyProduct(createRitual("pm", T0), { name: "Cleanser", category: "cleanser" }, T0 + 1000);
    d = setRitual(d, r.state);
    const back = parseData(JSON.parse(JSON.stringify(d)), T0 + 60_000, seeded());
    expect(back.settings).toEqual(d.settings);
    expect(back.scans).toEqual(d.scans);
    expect(back.tracked).toEqual(d.tracked);
    expect(back.ritual).toEqual(d.ritual);
  });

  it("falls back to defaults for junk", () => {
    for (const junk of [null, undefined, 5, "text", [], { v: 99, scans: [1] }]) {
      const d = parseData(junk, T0, seeded());
      expect(d.scans).toEqual([]);
      expect(d.settings.language).toBe("en");
    }
  });

  it("keeps good parts and drops bad ones", () => {
    const good = mk(T0);
    const d = parseData(
      {
        v: 1,
        settings: { language: "klingon", titleId: "majesty", welcomed: "yes", consentScan: true },
        scans: [good, { ...good, id: "bad", scores: { moisture: 900 } }, "nonsense", { ...good, id: "bad2", at: -5 }],
        tracked: [{ id: "t1", name: "Retinol", category: "retinoid", startedAt: T0 }, { id: "t2", name: "", category: "retinoid", startedAt: T0 }, { id: "t3", name: "X", category: "weird", startedAt: T0 }],
      },
      T0,
      seeded(),
    );
    expect(d.settings.language).toBe("en");
    expect(d.settings.titleId).toBe("majesty");
    expect(d.settings.welcomed).toBe(false);
    expect(d.settings.consentScan).toBe(true);
    expect(d.scans.map((s) => s.id)).toEqual([good.id]);
    expect(d.tracked.map((t) => t.id)).toEqual(["t1"]);
  });

  it("never keeps a skin colour or other unknown scan fields", () => {
    const s = { ...mk(T0), skinHex: "#aa8866", ita: 12 } as unknown as SkinScan;
    const d = parseData({ v: 1, scans: [s] }, T0, seeded());
    expect(Object.keys(d.scans[0]!)).not.toContain("skinHex");
    expect(Object.keys(d.scans[0]!)).not.toContain("ita");
  });

  it("refuses a save written by a newer version", () => {
    const d = parseData({ v: 2, settings: { welcomed: true }, scans: [mk(T0)] }, T0, seeded());
    expect(d.settings.welcomed).toBe(false);
    expect(d.scans).toEqual([]);
  });

  it("drops a ritual that has been open for hours", () => {
    const r = createRitual("am", T0);
    const fresh = parseData({ v: 1, ritual: r }, T0 + 60_000, seeded());
    const stale = parseData({ v: 1, ritual: r }, T0 + RITUAL_STALE_MS + 1, seeded());
    expect(fresh.ritual?.id).toBe(r.id);
    expect(stale.ritual).toBeNull();
  });

  it("sorts scans by time and caps their number", () => {
    const many = Array.from({ length: MAX_SCANS + 20 }, (_, i) => mk(T0 + i * 1000, { id: `s${i}` }));
    const shuffled = [...many].reverse();
    const d = parseData({ v: 1, scans: shuffled }, T0, seeded());
    expect(d.scans).toHaveLength(MAX_SCANS);
    expect(d.scans[0]!.at).toBeLessThan(d.scans[d.scans.length - 1]!.at);
    expect(d.scans[d.scans.length - 1]!.id).toBe(`s${MAX_SCANS + 19}`);
  });

  it("replaces an invalid demo seed", () => {
    const d = parseData({ v: 1, demoSeed: "../../etc" }, T0, seeded());
    expect(d.demoSeed).toMatch(/^[a-z0-9]{8}$/);
  });
});

describe("pure updates", () => {
  it("adds scans in time order and finds the last and the one before a moment", () => {
    let d = defaultData(seeded());
    d = addScan(d, mk(T0 + 2 * DAY, { id: "late" }));
    d = addScan(d, mk(T0, { id: "early" }));
    expect(d.scans.map((s) => s.id)).toEqual(["early", "late"]);
    expect(lastScan(d)?.id).toBe("late");
    expect(scanBefore(d, T0 + DAY)?.id).toBe("early");
    expect(scanBefore(d, T0 - 1)).toBeNull();
  });

  it("tracks a product once, keeping its first start date", () => {
    let d = defaultData(seeded());
    const a = startTracking(d, { name: "Retinol ", category: "retinoid" }, T0, seeded());
    d = a.data;
    const b = startTracking(d, { name: "retinol", category: "retinoid" }, T0 + DAY, seeded());
    expect(b.existed).toBe(true);
    expect(b.data.tracked).toHaveLength(1);
    expect(b.product.startedAt).toBe(T0);
    expect(stopTracking(b.data, b.product.id).tracked).toHaveLength(0);
  });

  it("files a finished ritual into the history", () => {
    let d = defaultData(seeded());
    const r = applyProduct(createRitual("am", T0), { name: "Cleanser", category: "cleanser" }, T0 + 1000).state;
    d = setRitual(d, r);
    d = recordRitual(d, r, T0 + 600_000);
    expect(d.ritual).toBeNull();
    expect(d.history).toHaveLength(1);
    expect(d.history[0]).toMatchObject({ id: r.id, period: "am", finishedAt: T0 + 600_000, products: [{ name: "Cleanser", category: "cleanser" }] });
    // filing the same ritual twice does not duplicate it
    d = recordRitual(d, r, T0 + 700_000);
    expect(d.history).toHaveLength(1);
  });
});

describe("DataStore", () => {
  it("saves and loads through storage", () => {
    const st = memoryStorage();
    const store = new DataStore(st);
    expect(store.persistent).toBe(true);
    const d = withSettings(defaultData(seeded()), { welcomed: true });
    expect(store.save(d)).toBe(true);
    expect(st.map.has(STORAGE_KEY)).toBe(true);
    expect(new DataStore(st).load(T0).settings.welcomed).toBe(true);
  });

  it("works from memory when storage is blocked", () => {
    const blocked: StorageLike = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    const store = new DataStore(blocked);
    expect(store.persistent).toBe(false);
    expect(store.save(withSettings(defaultData(seeded()), { welcomed: true }))).toBe(false);
    expect(store.load(T0).settings.welcomed).toBe(true);
    expect(() => store.erase()).not.toThrow();
    expect(store.load(T0).settings.welcomed).toBe(false);
  });

  it("works with no storage at all", () => {
    const store = new DataStore(null);
    expect(store.persistent).toBe(false);
    expect(store.load(T0).scans).toEqual([]);
  });

  it("falls back to memory when a write fails mid-session", () => {
    const st = memoryStorage();
    const store = new DataStore(st);
    const spy = vi.spyOn(st, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(store.save(defaultData(seeded()))).toBe(false);
    expect(store.persistent).toBe(false);
    spy.mockRestore();
  });

  it("survives corrupt JSON and erases on request", () => {
    const st = memoryStorage();
    st.setItem(STORAGE_KEY, "{not json");
    const store = new DataStore(st);
    expect(store.load(T0).scans).toEqual([]);
    store.save(withSettings(defaultData(seeded()), { welcomed: true }));
    store.erase();
    expect(st.map.has(STORAGE_KEY)).toBe(false);
    expect(store.load(T0).settings.welcomed).toBe(false);
  });
});
