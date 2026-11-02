import type { Period } from "../types";
import {
  CATEGORY_INFO,
  SLOT_LAYER,
  isExfoliant,
  type Category,
  type SlotId,
  type TimerKind,
} from "./products";

/**
 * The ritual rules engine: a small, deterministic state machine. The language model may talk,
 * but it can never override what this engine says about order, clashes or timing.
 *
 * Everything returned here is language-neutral (codes + params); src/lib/persona/copy.ts turns
 * codes into calm sentences in English, Hindi or Hinglish. All guidance is cosmetic and
 * conservative: "many people keep these to different times", never a medical instruction.
 */

export interface TemplateStep {
  slot: SlotId;
  required: boolean;
}

export const TEMPLATE: Record<Period, readonly TemplateStep[]> = {
  am: [
    { slot: "cleanse", required: true },
    { slot: "tone", required: false },
    { slot: "treat", required: false },
    { slot: "serum", required: false },
    { slot: "eye", required: false },
    { slot: "moisturize", required: true },
    { slot: "protect", required: true },
  ],
  pm: [
    { slot: "oil_cleanse", required: false },
    { slot: "cleanse", required: true },
    { slot: "tone", required: false },
    { slot: "exfoliate", required: false },
    { slot: "treat", required: false },
    { slot: "serum", required: false },
    { slot: "eye", required: false },
    { slot: "moisturize", required: true },
    { slot: "oil", required: false },
  ],
};

export interface AppliedProduct {
  id: string;
  name: string;
  category: Category;
  slot: SlotId;
  at: number;
}

export interface RitualState {
  id: string;
  period: Period;
  startedAt: number;
  status: "active" | "complete";
  applied: AppliedProduct[];
  skipped: SlotId[];
  /** Note codes already spoken this ritual, so the mirror never repeats itself. */
  warned: string[];
}

export type NoteCode =
  | "order_late"
  | "clash_retinoid_exfoliant"
  | "clash_retinoid_benzoyl"
  | "clash_retinoid_vitc"
  | "clash_double_exfoliant"
  | "clash_vitc_exfoliant"
  | "clash_benzoyl_vitc"
  | "overload"
  | "period_retinoid_am"
  | "period_spf_pm"
  | "period_exfoliant_am"
  | "spf_missing";

export interface Note {
  code: NoteCode;
  severity: "info" | "heads_up";
  /** For order_late: the slot applied late, and the later slot already on the skin. */
  slot?: SlotId;
  after?: SlotId;
}

export interface TimerSuggestion {
  seconds: number;
  kind: TimerKind;
}

export interface ApplyResult {
  state: RitualState;
  notes: Note[];
  /** The slot this product satisfied. */
  slot: SlotId;
  /** What the mirror would suggest next, or null when the ritual is naturally complete. */
  next: SlotId | null;
  timer: TimerSuggestion | null;
  /** True when the same product was already logged in this ritual, so nothing changed. */
  duplicate: boolean;
}

export function createRitual(period: Period, now: number, id: string = `r-${now}`): RitualState {
  return { id, period, startedAt: now, status: "active", applied: [], skipped: [], warned: [] };
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function doneSlots(state: RitualState): Set<SlotId> {
  return new Set(state.applied.map((a) => a.slot));
}

function maxAppliedLayer(applied: readonly AppliedProduct[]): { layer: number; slot: SlotId | null } {
  let layer = -1;
  let slot: SlotId | null = null;
  for (const a of applied) {
    if (a.slot === "extra") continue;
    const l = SLOT_LAYER[a.slot];
    if (l > layer) {
      layer = l;
      slot = a.slot;
    }
  }
  return { layer, slot };
}

/** The next template step the mirror would suggest, or null when everything is done or skipped. */
export function nextSlot(state: RitualState): SlotId | null {
  const done = doneSlots(state);
  const { layer } = maxAppliedLayer(state.applied);
  for (const step of TEMPLATE[state.period]) {
    if (done.has(step.slot) || state.skipped.includes(step.slot)) continue;
    if (SLOT_LAYER[step.slot] <= layer) continue; // already past this layer
    return step.slot;
  }
  return null;
}

function clashCodes(next: Category, previous: readonly Category[]): NoteCode[] {
  const out = new Set<NoteCode>();
  for (const p of previous) {
    const pair = (a: (c: Category) => boolean, b: (c: Category) => boolean) =>
      (a(next) && b(p)) || (b(next) && a(p));
    const is = (c: Category) => (x: Category) => x === c;
    if (pair(is("retinoid"), isExfoliant)) out.add("clash_retinoid_exfoliant");
    if (pair(is("retinoid"), is("benzoyl"))) out.add("clash_retinoid_benzoyl");
    if (pair(is("retinoid"), is("vitamin_c"))) out.add("clash_retinoid_vitc");
    if (isExfoliant(next) && isExfoliant(p)) out.add("clash_double_exfoliant");
    if (pair(is("vitamin_c"), isExfoliant)) out.add("clash_vitc_exfoliant");
    if (pair(is("benzoyl"), is("vitamin_c"))) out.add("clash_benzoyl_vitc");
  }
  return [...out];
}

/** Log a product on the skin and report everything the mirror should gently mention. */
export function applyProduct(
  state: RitualState,
  product: { name: string; category: Category },
  now: number,
): ApplyResult {
  const info = CATEGORY_INFO[product.category];
  const already = state.applied.find(
    (a) => a.category === product.category && norm(a.name) === norm(product.name),
  );
  if (already) {
    return { state, notes: [], slot: already.slot, next: nextSlot(state), timer: null, duplicate: true };
  }

  const previousCategories = state.applied.map((a) => a.category);
  const notes: Note[] = [];
  const warned = new Set(state.warned);
  const emit = (note: Note, key: string = note.code) => {
    if (warned.has(key)) return;
    warned.add(key);
    notes.push(note);
  };

  // ordering: only when a clearly later layer is already on the skin
  if (info.slot !== "extra" && info.slot !== "eye") {
    const { layer, slot: lateSlot } = maxAppliedLayer(state.applied);
    if (lateSlot && layer - SLOT_LAYER[info.slot] >= 2) {
      emit({ code: "order_late", severity: "info", slot: info.slot, after: lateSlot }, `order_late:${info.slot}`);
    }
  }

  // clashes with what is already on the skin this sitting
  for (const code of clashCodes(product.category, previousCategories)) {
    emit({ code, severity: "heads_up" });
  }

  // time-of-day guidance
  if (product.category === "retinoid" && state.period === "am") emit({ code: "period_retinoid_am", severity: "info" });
  if (product.category === "sunscreen" && state.period === "pm") emit({ code: "period_spf_pm", severity: "info" });
  if (isExfoliant(product.category) && state.period === "am") emit({ code: "period_exfoliant_am", severity: "info" });

  // a crowded sitting (only when no sharper clash was just mentioned)
  const weight =
    state.applied.reduce((sum, a) => sum + CATEGORY_INFO[a.category].activeWeight, 0) + info.activeWeight;
  if (weight >= 2.5 && !notes.some((n) => n.code.startsWith("clash_"))) {
    emit({ code: "overload", severity: "heads_up" });
  }

  const entry: AppliedProduct = {
    id: `p-${now}-${state.applied.length}`,
    name: product.name,
    category: product.category,
    slot: info.slot,
    at: now,
  };
  const nextState: RitualState = {
    ...state,
    applied: [...state.applied, entry],
    warned: [...warned],
  };

  return {
    state: nextState,
    notes,
    slot: info.slot,
    next: nextSlot(nextState),
    timer: info.timer ?? null,
    duplicate: false,
  };
}

/** Skip a step (the one currently suggested, unless a slot is given). */
export function skipSlot(state: RitualState, slot?: SlotId): { state: RitualState; skipped: SlotId | null } {
  const target = slot ?? nextSlot(state);
  if (!target || state.skipped.includes(target)) return { state, skipped: null };
  return { state: { ...state, skipped: [...state.skipped, target] }, skipped: target };
}

/** Close the ritual. In the morning, a missing sunscreen is worth one kind reminder. */
export function finishRitual(state: RitualState): { state: RitualState; notes: Note[] } {
  const notes: Note[] = [];
  const done = doneSlots(state);
  if (state.period === "am" && !done.has("protect") && !state.skipped.includes("protect")) {
    notes.push({ code: "spf_missing", severity: "info" });
  }
  return { state: { ...state, status: "complete" }, notes };
}

export type StepStatus = "done" | "current" | "upcoming" | "skipped";

export interface ProgressStep {
  slot: SlotId;
  required: boolean;
  status: StepStatus;
  products: string[];
}

/** One row per template step, for the timeline UI. */
export function progress(state: RitualState): ProgressStep[] {
  const next = state.status === "active" ? nextSlot(state) : null;
  return TEMPLATE[state.period].map((step) => {
    const products = state.applied.filter((a) => a.slot === step.slot).map((a) => a.name);
    let status: StepStatus = "upcoming";
    if (products.length > 0) status = "done";
    else if (state.skipped.includes(step.slot)) status = "skipped";
    else if (step.slot === next) status = "current";
    return { slot: step.slot, required: step.required, status, products };
  });
}

export interface RitualSummary {
  period: Period;
  status: RitualState["status"];
  applied: { name: string; category: Category }[];
  next: SlotId | null;
  skipped: SlotId[];
}

export function summarize(state: RitualState): RitualSummary {
  return {
    period: state.period,
    status: state.status,
    applied: state.applied.map((a) => ({ name: a.name, category: a.category })),
    next: state.status === "active" ? nextSlot(state) : null,
    skipped: state.skipped,
  };
}
