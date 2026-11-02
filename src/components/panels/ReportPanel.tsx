"use client";

import { useState } from "react";
import { lastScan } from "@/client/data";
import type { ReportView } from "@/client/state";
import { concernLabel } from "@/lib/concerns";
import { strengthAndFocus } from "@/lib/skin/report";
import type { ConfidenceReason } from "@/lib/skin/types";
import { DecreeDialog } from "../DecreeDialog";
import { FaceIcon, ListIcon, RingsIcon, ScaleIcon, SparkIcon } from "../icons";
import { Card, PanelTitle, PrimaryButton, QuietButton, TextButton } from "../kit";
import { useMirrorCtx } from "../mirror-context";
import { Rings, ScoreList } from "../RingGauge";
import type { UiKey } from "../ui-text";

const REASON_KEY: Record<ConfidenceReason, UiKey> = {
  dim_light: "reason_dim_light",
  uneven_light: "reason_uneven_light",
  glare: "reason_glare",
  deeper_tone: "reason_deeper_tone",
  low_resolution: "reason_low_resolution",
  demo: "reason_demo",
};

const SAMPLE_KEY = { no_key: "sample_no_key", budget: "sample_budget", unavailable: "sample_unavailable", forced: "sample_forced" } as const;

export function ReportPanel() {
  const { ctl, state, lang, t } = useMirrorCtx();
  const [asList, setAsList] = useState(false);
  const [decree, setDecree] = useState(false);

  const last = lastScan(state.data);
  const view: ReportView | null =
    state.report ??
    (last
      ? { scan: last, ...strengthAndFocus(last.scores), ...(last.source === "demo" ? { sampleReason: "no_key" as const } : {}) }
      : null);

  if (!view) {
    return (
      <Card>
        <PanelTitle sub={t("report_empty")}>{t("report_title")}</PanelTitle>
        <PrimaryButton onClick={() => ctl.startScan()} icon={<FaceIcon />}>
          {t("chip_scan")}
        </PrimaryButton>
      </Card>
    );
  }

  const { scan } = view;
  const sample = scan.source === "demo";
  const reasons = scan.confidence.reasons.filter((r) => r !== "demo");
  const confKey: UiKey = scan.confidence.level === "high" ? "conf_high" : scan.confidence.level === "medium" ? "conf_medium" : "conf_low";

  return (
    <Card>
      <PanelTitle>{t("report_title")}</PanelTitle>

      {sample && (
        <div role="note" className="mb-4 rounded-2xl border-2 border-marigold bg-marigold/20 p-3.5">
          <p className="font-semibold text-marigold-ink">{t("sample_label")}</p>
          <p className="mt-0.5 text-[0.93rem] text-ink">{t(SAMPLE_KEY[view.sampleReason ?? "no_key"])}</p>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2 text-[0.92rem]">
        {view.strength && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-peacock/15 px-3 py-1.5 font-semibold text-peacock-ink">
            <SparkIcon width={16} height={16} />
            {t("strongest")}: {concernLabel(view.strength, lang)}
          </span>
        )}
        {view.focus && !view.allHigh && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amethyst/12 px-3 py-1.5 font-semibold text-amethyst-ink">
            {t("gentlest")}: {concernLabel(view.focus, lang)}
          </span>
        )}
      </div>

      {asList ? <ScoreList scores={scan.scores} /> : <Rings scores={scan.scores} />}

      <p className="mt-4 text-[0.9rem] text-ink-soft">
        {t(confKey)}
        {reasons.length > 0 && !sample ? ` (${reasons.map((r) => t(REASON_KEY[r])).join(", ")})` : ""}.
      </p>
      <p className="mt-1 text-[0.85rem] text-ink-faint">{t("report_scans_note")}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        <PrimaryButton onClick={() => ctl.startScan()} icon={<FaceIcon />}>
          {t("scan_again")}
        </PrimaryButton>
        <QuietButton onClick={() => ctl.verify()} icon={<ScaleIcon />}>
          {t("verify_open")}
        </QuietButton>
        <TextButton onClick={() => setAsList((v) => !v)} icon={asList ? <RingsIcon width={18} height={18} /> : <ListIcon width={18} height={18} />}>
          {asList ? t("as_rings") : t("as_list")}
        </TextButton>
        <TextButton onClick={() => setDecree(true)}>{t("decree_make")}</TextButton>
      </div>

      {decree && <DecreeDialog scan={scan} onClose={() => setDecree(false)} />}
    </Card>
  );
}
