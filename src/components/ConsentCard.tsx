"use client";

import { CameraIcon } from "./icons";
import { useMirrorCtx } from "./mirror-context";

/**
 * Asked in plain words before a photo or a bottle frame leaves the device. Consent is only ever a tap
 * here or a switch in Settings, never a spoken "yes", so a stray word can't send a picture anywhere.
 */
export function ConsentCard() {
  const { ctl, state, t } = useMirrorCtx();
  const p = state.pending;
  if (p !== "consent_scan" && p !== "consent_look") return null;
  const scan = p === "consent_scan";
  return (
    <section role="alertdialog" aria-labelledby="consent-title" aria-describedby="consent-body" className="rounded-[var(--radius-gem)] border-2 border-marigold bg-card p-5 shadow-[var(--shadow-gem)]">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-marigold/25 text-marigold-ink">
          <CameraIcon />
        </span>
        <div>
          <h2 id="consent-title" className="font-voice text-xl font-semibold leading-snug">
            {scan ? t("consent_scan_title") : t("consent_look_title")}
          </h2>
          <p id="consent-body" className="mt-1 text-[0.95rem] text-ink-soft">
            {scan ? t("consent_scan_body") : t("consent_look_body")}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => ctl.grantConsent(scan ? "scan" : "look")} className="min-h-11 rounded-full bg-ink px-6 text-sm font-semibold text-white">
          {t("allow")}
        </button>
        <button type="button" onClick={() => ctl.declineConsent()} className="min-h-11 rounded-full border-2 border-ink px-5 text-sm font-semibold text-ink">
          {t("not_now")}
        </button>
        <a href="/privacy" target="_blank" rel="noopener" className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-amethyst-ink underline underline-offset-4">
          {t("privacy")}
        </a>
      </div>
    </section>
  );
}
