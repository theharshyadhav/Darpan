"use client";

import { concernLabel } from "@/lib/concerns";
import type { Caveat, DeltaClass } from "@/lib/skin/compare";
import { Card, PanelTitle, PrimaryButton, QuietButton } from "../kit";
import { useMirrorCtx } from "../mirror-context";
import type { UiKey } from "../ui-text";

const HEAD_KEY = { better: "verify_head_better", same: "verify_head_same", mixed: "verify_head_mixed", lower: "verify_head_lower" } as const;
const CAVEAT_KEY: Record<Caveat, UiKey> = { same_sitting: "cav_same_sitting", low_confidence: "cav_low_confidence", lighting_changed: "cav_lighting_changed", demo: "cav_demo" };
const DELTA_KEY: Record<DeltaClass, UiKey> = { better: "d_better", slightly_better: "d_slightly_better", same: "d_same", slightly_lower: "d_slightly_lower", lower: "d_lower" };
const DELTA_TONE: Record<DeltaClass, string> = {
  better: "bg-peacock/20 text-peacock-ink",
  slightly_better: "bg-peacock/12 text-peacock-ink",
  same: "bg-pearl-deep text-ink-soft",
  slightly_lower: "bg-amethyst/12 text-amethyst-ink",
  lower: "bg-amethyst/20 text-amethyst-ink",
};

export function VerifyPanel() {
  const { ctl, state, lang, t } = useMirrorCtx();
  const v = state.verify;

  if (!v) {
    return (
      <Card>
        <PanelTitle sub={t("verify_empty")}>{t("verify_title")}</PanelTitle>
        <div className="flex flex-wrap gap-2">
          <PrimaryButton onClick={() => ctl.verify()}>{t("verify_open")}</PrimaryButton>
          <QuietButton onClick={() => ctl.openPanel("report")}>{t("back_to_report")}</QuietButton>
        </div>
      </Card>
    );
  }

  const { comparison: c } = v;
  const sample = c.caveats.includes("demo");
  return (
    <Card>
      <PanelTitle sub={t("minutes_apart", { n: c.minutesBetween })}>{t("verify_title")}</PanelTitle>
      <p className="font-voice text-xl font-semibold">{t(HEAD_KEY[c.headline])}</p>

      {sample && (
        <p role="note" className="mt-3 rounded-2xl border-2 border-marigold bg-marigold/20 p-3 text-[0.93rem] font-semibold text-marigold-ink">
          {t("sample_label")}. {t("cav_demo")}
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-left text-[0.95rem]">
          <thead>
            <tr className="text-ink-soft">
              <th scope="col" className="py-2 pr-2 font-semibold">
                <span className="sr-only">{t("tab_report")}</span>
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">
                {t("before")}
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">
                {t("after")}
              </th>
              <th scope="col" className="py-2 pl-2 font-semibold">
                <span className="sr-only">{t("verify_change_col")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {c.deltas.map((d) => (
              <tr key={d.key} className="border-t border-line">
                <th scope="row" className="py-2.5 pr-2 font-semibold">
                  {concernLabel(d.key, lang)}
                </th>
                <td className="px-2 text-right font-voice text-lg tabular-nums">{Math.round(d.before)}</td>
                <td className="px-2 text-right font-voice text-lg font-semibold tabular-nums">{Math.round(d.after)}</td>
                <td className="py-2 pl-2">
                  <span className={`inline-block rounded-full px-2.5 py-1 text-[0.82rem] font-semibold ${DELTA_TONE[d.cls]}`}>{t(DELTA_KEY[d.cls])}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[0.88rem] text-ink-soft">{t("verify_noise", { n: c.noise })}</p>
      {c.caveats.filter((x) => x !== "demo").length > 0 && (
        <ul className="m-0 mt-2 list-disc space-y-1 pl-5 text-[0.92rem] text-ink-soft">
          {c.caveats
            .filter((x) => x !== "demo")
            .map((x) => (
              <li key={x}>{t(CAVEAT_KEY[x])}</li>
            ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <QuietButton onClick={() => ctl.openPanel("report")}>{t("back_to_report")}</QuietButton>
      </div>
    </Card>
  );
}
