"use client";

import Link from "next/link";
import { ArchFrame, Orb } from "./Arch";
import { LanguagePicker, TitlePicker } from "./Pickers";
import { useMirrorCtx } from "./mirror-context";

/**
 * The first screen of every visit. Speech and the microphone need a tap before a browser allows them,
 * so the tap is the whole point of this page: choose how to be addressed, tap "Wake the mirror", and
 * the greeting is the very first thing that happens inside that tap.
 */
export function Welcome() {
  const { ctl, state, t } = useMirrorCtx();
  const booting = state.phase === "booting";
  const resting = state.phase === "asleep";
  const status = state.status;
  const demo = !status || status.skin === "demo";

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-5xl flex-col items-center gap-8 px-5 pb-10 pt-8 lg:flex-row lg:justify-center lg:gap-16">
      <div className="relative w-[min(56vw,15rem)] shrink-0 pt-7 lg:w-[19rem]">
        <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2">
          <Orb state={resting ? "resting" : "idle"} label={t("orb_idle")} />
        </div>
        <div className="arch unveil-arch" style={{ ["--arch-w" as string]: "100%" }}>
          <div className="arch-clip" />
          <ArchFrame />
        </div>
      </div>

      <div className="unveil w-full max-w-lg" style={{ animationDelay: "0.35s" }}>
        <p className="font-display text-[2.6rem] leading-none">{t("wordmark")}</p>
        <h1 className="mt-3 font-voice text-[1.75rem] font-semibold leading-tight">{resting ? t("mirror_resting") : t("welcome_heading")}</h1>
        {!resting && <p className="mt-3 max-w-prose text-[1.02rem] text-ink-soft">{t("welcome_sub")}</p>}

        <div className="mt-6 flex flex-col gap-5 rounded-[var(--radius-gem)] border border-line bg-card/85 p-5 shadow-[var(--shadow-gem)]">
          <div>
            <h2 className="mb-2 font-voice text-lg font-semibold">{t("choose_title")}</h2>
            <TitlePicker />
          </div>
          <div>
            <h2 className="mb-2 font-voice text-lg font-semibold">{t("choose_language")}</h2>
            <LanguagePicker />
          </div>
        </div>

        <button
          type="button"
          disabled={booting}
          onClick={() => ctl.wake()}
          className="mt-6 inline-flex min-h-14 w-full items-center justify-center rounded-full bg-gradient-to-r from-rani-ink to-amethyst-ink px-8 font-voice text-xl font-semibold text-white shadow-lg transition-transform active:scale-[0.99] disabled:opacity-60 sm:w-auto"
        >
          {resting ? t("wake_again") : t("wake")}
        </button>
        <p className="mt-3 text-[0.92rem] text-ink-soft">{t("wake_hint")}</p>

        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.9rem]">
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 font-semibold ${demo ? "bg-marigold/20 text-marigold-ink" : "bg-peacock/15 text-peacock-ink"}`}>
            <span aria-hidden="true" className={`size-2 rounded-full ${demo ? "bg-marigold" : "bg-peacock"}`} />
            {!status ? t("mode_checking") : demo ? t("mode_demo") : t("mode_live")}
          </span>
          <span className="text-ink-soft">{!status ? "" : demo ? t("mode_demo_hint") : t("mode_live_hint")}</span>
          <Link href="/privacy" className="font-semibold text-amethyst-ink underline underline-offset-4">
            {t("privacy")}
          </Link>
        </div>
      </div>
    </main>
  );
}
