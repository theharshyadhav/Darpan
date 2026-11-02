import { concernLabel, type ConcernKey } from "@/lib/concerns";
import { DAY_MS, evaluateAll, type LedgerVerdict, type TrackedProduct } from "@/lib/ledger/verdict";
import { line } from "@/lib/persona/copy";
import { speakableProductName } from "@/lib/ritual/products";
import type { SkinScan } from "@/lib/skin/types";
import type { Language } from "@/lib/types";

/**
 * The Royal Ledger as the screen and the mirror's voice both need it: one row per tracked product,
 * with the verdict and the sentence to say. "Too early to say" is the normal first answer.
 */

export interface LedgerRow {
  product: TrackedProduct;
  verdict: LedgerVerdict;
  /** Whole days since the person started it. */
  days: number;
  /** The sentence the mirror says about this product. */
  headline: string;
  /** Said after the headline when two overlapping products were started together. */
  caveat?: string;
}

const AND: Record<Language, string> = { en: "and", hi: "और", hinglish: "aur" };

/** "hydration", "hydration and radiance", "hydration, radiance and clarity". */
export function joinLabels(keys: readonly ConcernKey[], lang: Language): string {
  const names = keys.map((k) => concernLabel(k, lang).toLowerCase());
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${AND[lang]} ${names[names.length - 1]}`;
}

export function headlineFor(v: LedgerVerdict, product: TrackedProduct, lang: Language): string {
  const name = speakableProductName(product.name, product.category);
  switch (v.verdict) {
    case "too_early":
      return v.reason === "too_soon" && v.needMoreDays > 0
        ? line(lang, "ledger_too_early", { product: name, days: v.needMoreDays })
        : line(lang, "ledger_need_scans", { product: name });
    case "improving":
      return line(lang, "ledger_improving", { product: name, labels: joinLabels(v.improved, lang) });
    case "declining":
      return line(lang, "ledger_declining", { product: name, labels: joinLabels(v.declined, lang) });
    case "steady":
      return line(lang, "ledger_steady", { product: name });
    case "mixed":
      return line(lang, "ledger_mixed", { product: name });
    case "no_visible":
      return line(lang, "ledger_no_visible", { product: name });
  }
}

export function ledgerRows(tracked: readonly TrackedProduct[], scans: readonly SkinScan[], now: number, lang: Language): LedgerRow[] {
  const verdicts = evaluateAll(tracked, scans, now);
  return tracked
    .map((product, i): LedgerRow => {
      const verdict = verdicts[i]!;
      const decided = verdict.verdict !== "too_early" && verdict.verdict !== "no_visible";
      return {
        product,
        verdict,
        days: Math.max(0, Math.floor((now - product.startedAt) / DAY_MS)),
        headline: headlineFor(verdict, product, lang),
        caveat: verdict.confounded && decided ? line(lang, "ledger_confounded", { product: speakableProductName(product.name, product.category) }) : undefined,
      };
    })
    .sort((a, b) => b.product.startedAt - a.product.startedAt);
}
