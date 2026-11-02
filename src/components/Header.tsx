"use client";

import { GearIcon } from "./icons";
import { useMirrorCtx } from "./mirror-context";

/** The wordmark, whether this mirror is in Demo Mode or live, and Settings. */
export function Header() {
  const { ctl, state, t } = useMirrorCtx();
  const { status } = state;
  const demo = !status || status.skin === "demo";
  const label = !status ? t("mode_checking") : demo ? t("mode_demo") : t("mode_live");
  const hint = !status ? "" : demo ? t("mode_demo_hint") : t("mode_live_hint");

  return (
    <header className="chrome-hide flex items-center justify-between gap-3 px-1 py-3">
      <div className="flex items-baseline gap-3">
        <span className="font-display text-[1.9rem] leading-none text-ink">{t("wordmark")}</span>
        <span className="hidden text-sm text-ink-soft sm:inline">{t("tagline")}</span>
      </div>
      <div className="flex items-center gap-2">
        <span
          title={hint}
          className={`inline-flex min-h-8 items-center gap-2 rounded-full border px-3 text-sm font-semibold ${demo ? "border-marigold-ink/50 bg-marigold/20 text-marigold-ink" : "border-peacock-ink/50 bg-peacock/15 text-peacock-ink"}`}
        >
          <span aria-hidden="true" className={`size-2 rounded-full ${demo ? "bg-marigold" : "bg-peacock"}`} />
          {label}
        </span>
        <button type="button" onClick={() => ctl.openSettings(true)} aria-label={t("settings")} title={t("settings")} className="grid size-11 place-items-center rounded-full border-2 border-line bg-card text-ink">
          <GearIcon />
        </button>
      </div>
    </header>
  );
}
