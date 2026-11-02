import { describe, expect, it } from "vitest";
import {
  applyProduct,
  createRitual,
  finishRitual,
  nextSlot,
  progress,
  skipSlot,
  summarize,
  type RitualState,
} from "@/lib/ritual/engine";
import {
  CATEGORIES,
  CATEGORY_INFO,
  classifyProduct,
  cleanProductName,
  periodFromHour,
  speakableProductName,
  type Category,
} from "@/lib/ritual/products";
import { T0, MIN } from "./helpers";

function run(state: RitualState, items: [string, Category][], start = T0) {
  let s = state;
  const allNotes: string[] = [];
  items.forEach(([name, category], i) => {
    const r = applyProduct(s, { name, category }, start + i * MIN);
    s = r.state;
    allNotes.push(...r.notes.map((n) => n.code));
  });
  return { state: s, notes: allNotes };
}

describe("classifyProduct", () => {
  const cases: [string, Category][] = [
    ["vitamin C serum", "vitamin_c"],
    ["I'm putting on my vitamin C serum", "vitamin_c"],
    ["retinol", "retinoid"],
    ["Differin gel", "retinoid"],
    ["sunscreen SPF 50", "sunscreen"],
    ["sunscreen moisturizer", "sunscreen"],
    ["foaming cleanser", "cleanser"],
    ["face wash", "cleanser"],
    ["cleansing oil", "oil_cleanser"],
    ["cleansing balm", "oil_cleanser"],
    ["glycolic acid", "exfoliant_aha"],
    ["salicylic acid", "exfoliant_bha"],
    ["PHA exfoliant", "exfoliant_pha"],
    ["benzoyl peroxide gel", "benzoyl"],
    ["niacinamide 10%", "niacinamide"],
    ["hyaluronic acid serum", "hyaluronic"],
    ["hydrating serum", "hyaluronic"],
    ["peptide serum", "peptide"],
    ["azelaic acid", "azelaic"],
    ["some random serum", "serum"],
    ["eye cream", "eye"],
    ["rosehip oil", "oil"],
    ["night cream", "moisturizer"],
    ["barrier moisturizer", "moisturizer"],
    ["rose toner", "toner"],
    ["essence", "essence"],
    ["clay mask", "mask"],
    ["pimple patch", "spot"],
    ["lip balm", "lip"],
    ["lip mask", "lip"],
    ["विटामिन सी सीरम", "vitamin_c"],
    ["सनस्क्रीन", "sunscreen"],
    ["मॉइस्चराइज़र", "moisturizer"],
    ["फेस वॉश", "cleanser"],
    ["रेटिनॉल", "retinoid"],
  ];

  it.each(cases)("%s -> %s", (text, expected) => {
    expect(classifyProduct(text)?.category).toBe(expected);
  });

  it("returns null for things that are not skincare", () => {
    expect(classifyProduct("")).toBeNull();
    expect(classifyProduct("   ")).toBeNull();
    expect(classifyProduct("what a lovely day")).toBeNull();
  });

  it("cleans filler and markup out of names", () => {
    expect(cleanProductName("I'm applying my retinol.")).toBe("retinol");
    expect(cleanProductName("now using the vitamin C serum!")).toBe("vitamin C serum");
    expect(cleanProductName("The vitamin C serum")).toBe("vitamin C serum");
    expect(cleanProductName("a retinol")).toBe("retinol");
    // brands keep their article
    expect(cleanProductName("The Ordinary niacinamide")).toBe("The Ordinary niacinamide");
    expect(cleanProductName("I'm using the Derma Co retinol")).toBe("The Derma Co retinol");
    // label text is only tidied
    expect(cleanProductName("my favourite serum", "label")).toBe("my favourite serum");
    expect(cleanProductName("  <b>The   Ordinary</b> ", "label")).toBe("The Ordinary");
    expect(cleanProductName('<b>retinol</b> "x"')).not.toMatch(/[<>"]/);
    expect(cleanProductName("a".repeat(200)).length).toBeLessThanOrEqual(60);
  });

  it("assigns a slot, layer and plain name to every category", () => {
    for (const c of CATEGORIES) {
      const info = CATEGORY_INFO[c];
      expect(info.plain.length).toBeGreaterThan(2);
      expect(typeof info.layer).toBe("number");
    }
  });
});

describe("speakableProductName", () => {
  it("says the person's product name, unless it contains words the mirror never speaks", () => {
    expect(speakableProductName("The Ordinary niacinamide", "niacinamide")).toBe("The Ordinary niacinamide");
    expect(speakableProductName("Clean & Clear Acne Control Wash", "cleanser")).toBe("cleanser");
    expect(speakableProductName("Miracle Heal Serum", "serum")).toBe("serum");
  });
});

describe("periodFromHour", () => {
  it("treats 4:00 to 14:59 as morning", () => {
    expect([0, 3, 15, 18, 23].map(periodFromHour)).toEqual(["pm", "pm", "pm", "pm", "pm"]);
    expect([4, 9, 14].map(periodFromHour)).toEqual(["am", "am", "am"]);
  });
});

describe("ritual engine", () => {
  it("walks a morning ritual in order and suggests the next step", () => {
    let s = createRitual("am", T0);
    expect(nextSlot(s)).toBe("cleanse");
    const r1 = applyProduct(s, { name: "cleanser", category: "cleanser" }, T0);
    expect(r1.slot).toBe("cleanse");
    expect(r1.next).toBe("tone");
    expect(r1.timer).toEqual({ seconds: 60, kind: "massage" });
    s = r1.state;

    s = applyProduct(s, { name: "vitamin C", category: "vitamin_c" }, T0 + MIN).state;
    expect(nextSlot(s)).toBe("serum");
    s = applyProduct(s, { name: "moisturizer", category: "moisturizer" }, T0 + 2 * MIN).state;
    expect(nextSlot(s)).toBe("protect");
    const done = applyProduct(s, { name: "SPF", category: "sunscreen" }, T0 + 3 * MIN);
    expect(done.next).toBeNull();
    const fin = finishRitual(done.state);
    expect(fin.state.status).toBe("complete");
    expect(fin.notes).toEqual([]);
  });

  it("does not repeat the same product twice", () => {
    const s0 = createRitual("pm", T0);
    const a = applyProduct(s0, { name: "Retinol", category: "retinoid" }, T0);
    const b = applyProduct(a.state, { name: "retinol ", category: "retinoid" }, T0 + MIN);
    expect(b.duplicate).toBe(true);
    expect(b.state).toBe(a.state);
    expect(b.notes).toEqual([]);
  });

  describe("ordering", () => {
    it("mentions a late layer, once, when it is clearly out of order", () => {
      const r = run(createRitual("pm", T0), [
        ["moisturizer", "moisturizer"],
        ["niacinamide", "niacinamide"],
      ]);
      expect(r.notes).toContain("order_late");
    });

    it("does not nag about small shuffles", () => {
      const r = run(createRitual("pm", T0), [
        ["toner", "toner"],
        ["cleanser", "cleanser"],
      ]);
      expect(r.notes).not.toContain("order_late");
    });

    it("never nags about eye care or extras", () => {
      const r = run(createRitual("pm", T0), [
        ["moisturizer", "moisturizer"],
        ["eye cream", "eye"],
        ["clay mask", "mask"],
      ]);
      expect(r.notes).not.toContain("order_late");
    });

    it("moves on past layers that are already behind", () => {
      let s = createRitual("am", T0);
      s = applyProduct(s, { name: "moisturizer", category: "moisturizer" }, T0).state;
      expect(nextSlot(s)).toBe("protect");
    });
  });

  describe("clashes", () => {
    it("flags retinoid with an exfoliant, in either order", () => {
      const a = run(createRitual("pm", T0), [
        ["glycolic", "exfoliant_aha"],
        ["retinol", "retinoid"],
      ]);
      const b = run(createRitual("pm", T0), [
        ["retinol", "retinoid"],
        ["glycolic", "exfoliant_aha"],
      ]);
      expect(a.notes).toContain("clash_retinoid_exfoliant");
      expect(b.notes).toContain("clash_retinoid_exfoliant");
    });

    it("flags retinoid with benzoyl peroxide and with vitamin C", () => {
      expect(
        run(createRitual("pm", T0), [["bp", "benzoyl"], ["retinol", "retinoid"]]).notes,
      ).toContain("clash_retinoid_benzoyl");
      expect(
        run(createRitual("pm", T0), [["vit c", "vitamin_c"], ["retinol", "retinoid"]]).notes,
      ).toContain("clash_retinoid_vitc");
    });

    it("flags two exfoliants, vitamin C with an exfoliant, and benzoyl with vitamin C", () => {
      expect(run(createRitual("pm", T0), [["aha", "exfoliant_aha"], ["bha", "exfoliant_bha"]]).notes).toContain(
        "clash_double_exfoliant",
      );
      expect(run(createRitual("pm", T0), [["vit c", "vitamin_c"], ["aha", "exfoliant_aha"]]).notes).toContain(
        "clash_vitc_exfoliant",
      );
      expect(run(createRitual("pm", T0), [["bp", "benzoyl"], ["vit c", "vitamin_c"]]).notes).toContain(
        "clash_benzoyl_vitc",
      );
    });

    it("says each warning once per ritual", () => {
      const r = run(createRitual("pm", T0), [
        ["retinol", "retinoid"],
        ["aha", "exfoliant_aha"],
        ["bha", "exfoliant_bha"],
      ]);
      expect(r.notes.filter((c) => c === "clash_retinoid_exfoliant")).toHaveLength(1);
      expect(r.notes).toContain("clash_double_exfoliant");
    });

    it("is calm about gentle combinations", () => {
      const r = run(createRitual("pm", T0), [
        ["cleanser", "cleanser"],
        ["hyaluronic", "hyaluronic"],
        ["niacinamide", "niacinamide"],
        ["moisturizer", "moisturizer"],
      ]);
      expect(r.notes).toEqual([]);
    });
  });

  describe("time of day", () => {
    it("mentions retinoids and exfoliants in the morning, sunscreen at night", () => {
      expect(run(createRitual("am", T0), [["retinol", "retinoid"]]).notes).toContain("period_retinoid_am");
      expect(run(createRitual("am", T0), [["aha", "exfoliant_aha"]]).notes).toContain("period_exfoliant_am");
      expect(run(createRitual("pm", T0), [["spf", "sunscreen"]]).notes).toContain("period_spf_pm");
    });

    it("is quiet when the timing is fine", () => {
      expect(run(createRitual("pm", T0), [["retinol", "retinoid"]]).notes).toEqual([]);
      expect(run(createRitual("am", T0), [["spf", "sunscreen"]]).notes).toEqual([]);
    });
  });

  describe("overload", () => {
    it("notices a crowded sitting without a sharper clash", () => {
      const r = run(createRitual("pm", T0), [
        ["bha", "exfoliant_bha"],
        ["bp", "benzoyl"],
        ["azelaic", "azelaic"],
      ]);
      expect(r.notes).toContain("overload");
    });

    it("stays quiet when a clash was just mentioned instead", () => {
      const r = run(createRitual("pm", T0), [
        ["aha", "exfoliant_aha"],
        ["retinol", "retinoid"],
        ["azelaic", "azelaic"],
      ]);
      expect(r.notes).toContain("clash_retinoid_exfoliant");
    });
  });

  describe("skipping and finishing", () => {
    it("skips the suggested step and moves on", () => {
      let s = createRitual("am", T0);
      s = applyProduct(s, { name: "cleanser", category: "cleanser" }, T0).state;
      expect(nextSlot(s)).toBe("tone");
      const k = skipSlot(s);
      expect(k.skipped).toBe("tone");
      expect(nextSlot(k.state)).toBe("treat");
      expect(skipSlot(k.state, "tone").skipped).toBeNull();
    });

    it("reminds about sunscreen once, kindly, when a morning ritual ends without it", () => {
      let s = createRitual("am", T0);
      s = applyProduct(s, { name: "cleanser", category: "cleanser" }, T0).state;
      s = applyProduct(s, { name: "moisturizer", category: "moisturizer" }, T0 + MIN).state;
      expect(finishRitual(s).notes.map((n) => n.code)).toEqual(["spf_missing"]);
    });

    it("respects a deliberate skip of sunscreen and never nags at night", () => {
      const s = createRitual("am", T0);
      const skipped = skipSlot(s, "protect").state;
      expect(finishRitual(skipped).notes).toEqual([]);
      expect(finishRitual(createRitual("pm", T0)).notes).toEqual([]);
    });
  });

  describe("progress and summary", () => {
    it("reports a status per template step", () => {
      let s = createRitual("am", T0);
      s = applyProduct(s, { name: "cleanser", category: "cleanser" }, T0).state;
      s = skipSlot(s, "tone").state;
      const p = progress(s);
      expect(p.find((x) => x.slot === "cleanse")).toMatchObject({ status: "done", products: ["cleanser"] });
      expect(p.find((x) => x.slot === "tone")?.status).toBe("skipped");
      expect(p.find((x) => x.slot === "treat")?.status).toBe("current");
      expect(p.find((x) => x.slot === "protect")?.status).toBe("upcoming");
    });

    it("summarises for the language model without internals", () => {
      let s = createRitual("pm", T0);
      s = applyProduct(s, { name: "Retinol", category: "retinoid" }, T0).state;
      const sum = summarize(s);
      expect(sum).toMatchObject({ period: "pm", status: "active", applied: [{ name: "Retinol", category: "retinoid" }] });
      expect(Object.keys(sum).sort()).toEqual(["applied", "next", "period", "skipped", "status"]);
    });
  });
});
