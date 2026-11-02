"use client";

import { useMirrorCtx } from "./mirror-context";

const CATEGORY_WORDS = ["cleanser", "toner", "serum", "moisturizer", "sunscreen", "retinol", "vitamin c", "exfoliant", "eye cream", "oil"];

/**
 * The answer buttons for whatever the mirror just asked. Voice, typing and these buttons all land on
 * the same controller methods, so every question can be answered any of the three ways.
 */
export function AskBar() {
  const { ctl, state, t } = useMirrorCtx();
  const p = state.pending;
  if (!p || p === "consent_scan" || p === "consent_look") return null;

  if (p === "category") {
    return (
      <div role="group" aria-label={t("question")} className="flex flex-wrap gap-2">
        {CATEGORY_WORDS.map((w) => (
          <button key={w} type="button" onClick={() => void ctl.hear(w, "typed")} className="min-h-11 rounded-full border-2 border-amethyst-ink bg-card px-4 text-sm font-semibold text-amethyst-ink">
            {w}
          </button>
        ))}
        <button type="button" onClick={() => ctl.reply(false)} className="min-h-11 rounded-full px-4 text-sm font-semibold text-ink-soft underline decoration-line underline-offset-4">
          {t("not_now")}
        </button>
      </div>
    );
  }

  return (
    <div role="group" aria-label={t("question")} className="flex flex-wrap gap-2">
      <button type="button" onClick={() => ctl.reply(true)} className="min-h-11 rounded-full bg-rani-ink px-6 text-sm font-semibold text-white shadow">
        {p === "retry" ? t("try_again") : p === "forget" ? t("forget_yes") : t("yes")}
      </button>
      <button type="button" onClick={() => ctl.reply(false)} className="min-h-11 rounded-full border-2 border-ink px-5 text-sm font-semibold text-ink">
        {t("not_now")}
      </button>
    </div>
  );
}
