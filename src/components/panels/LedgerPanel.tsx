"use client";

import { useState, type FormEvent } from "react";
import { ledgerRows } from "@/client/ledger-view";
import { concernLabel } from "@/lib/concerns";
import type { VerdictKind } from "@/lib/ledger/verdict";
import { Card, PanelTitle, PrimaryButton, TextButton } from "../kit";
import { useMirrorCtx } from "../mirror-context";
import type { UiKey } from "../ui-text";

const VERDICT_KEY: Record<VerdictKind, UiKey> = {
  too_early: "v_too_early",
  improving: "v_improving",
  steady: "v_steady",
  declining: "v_declining",
  mixed: "v_mixed",
  no_visible: "v_no_visible",
};
const VERDICT_TONE: Record<VerdictKind, string> = {
  too_early: "bg-marigold/25 text-marigold-ink",
  improving: "bg-peacock/20 text-peacock-ink",
  steady: "bg-sapphire/15 text-sapphire-ink",
  declining: "bg-amethyst/18 text-amethyst-ink",
  mixed: "bg-amethyst/12 text-amethyst-ink",
  no_visible: "bg-pearl-deep text-ink-soft",
};

export function LedgerPanel() {
  const { ctl, state, lang, t } = useMirrorCtx();
  const [name, setName] = useState("");
  // taken when the ledger is opened, so "day 12" is right whenever the person looks
  const [now] = useState(() => Date.now());
  const { data } = state;
  const rows = ledgerRows(data.tracked, data.scans, now, lang);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const v = name.trim();
    if (!v) return;
    setName("");
    ctl.trackProduct(v);
  };

  return (
    <Card>
      <PanelTitle sub={t("ledger_sub")}>{t("ledger_title")}</PanelTitle>

      {rows.length === 0 ? (
        <p className="text-ink-soft">{t("ledger_empty")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {rows.map((r) => (
            <li key={r.product.id} className="rounded-2xl border border-line bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-voice text-lg font-semibold leading-tight">{r.product.name}</p>
                  <p className="text-[0.85rem] text-ink-soft">{t("day_n", { n: r.days + 1 })}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-[0.85rem] font-semibold ${VERDICT_TONE[r.verdict.verdict]}`}>{t(VERDICT_KEY[r.verdict.verdict])}</span>
              </div>
              <p className="mt-2 text-[0.97rem]">{r.headline}</p>
              {r.caveat && <p className="mt-1 text-[0.9rem] text-ink-soft">{r.caveat}</p>}
              {(r.verdict.improved.length > 0 || r.verdict.declined.length > 0) && (
                <p className="mt-2 flex flex-wrap gap-1.5 text-[0.85rem] font-semibold">
                  {r.verdict.improved.map((k) => (
                    <span key={k} className="rounded-full bg-peacock/15 px-2.5 py-0.5 text-peacock-ink">
                      {concernLabel(k, lang)}: {t("d_better")}
                    </span>
                  ))}
                  {r.verdict.declined.map((k) => (
                    <span key={k} className="rounded-full bg-amethyst/15 px-2.5 py-0.5 text-amethyst-ink">
                      {concernLabel(k, lang)}: {t("d_lower")}
                    </span>
                  ))}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[0.82rem] text-ink-faint">{t("based_on", { b: r.verdict.baselineCount, a: r.verdict.afterCount })}</span>
                <TextButton onClick={() => ctl.stopTrackingProduct(r.product.id)}>{t("stop_tracking")}</TextButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="mt-4 flex gap-2">
        <label htmlFor="track-product" className="sr-only">
          {t("track_placeholder")}
        </label>
        <input id="track-product" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t("track_placeholder")} autoComplete="off" className="h-11 min-w-0 flex-1 rounded-full border-2 border-line bg-card px-4 text-base placeholder:text-ink-faint focus-visible:border-amethyst" />
        <PrimaryButton type="submit" disabled={!name.trim()}>
          {t("track")}
        </PrimaryButton>
      </form>

      <p className="mt-4 text-[0.85rem] text-ink-faint">
        {t("ledger_sample_note")} {t("referral")}
      </p>
    </Card>
  );
}
