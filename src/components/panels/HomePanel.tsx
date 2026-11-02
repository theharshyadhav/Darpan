"use client";

import { periodFromHour } from "@/lib/ritual/products";
import type { ReactNode } from "react";
import { BookIcon, BottleIcon, DropIcon, FaceIcon, PaletteIcon, ScaleIcon } from "../icons";
import { Card, PanelTitle } from "../kit";
import { useMirrorCtx } from "../mirror-context";

function Chip({ onClick, icon, tone, children }: { onClick: () => void; icon: ReactNode; tone: string; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="group flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-card px-4 py-2.5 text-left text-[0.97rem] font-semibold text-ink shadow-sm transition-colors hover:bg-pearl-deep active:scale-[0.99]">
      <span className={`grid size-9 shrink-0 place-items-center rounded-full ${tone}`}>{icon}</span>
      <span className="leading-snug">{children}</span>
    </button>
  );
}

export function HomePanel() {
  const { ctl, state, t } = useMirrorCtx();
  const period = periodFromHour(new Date().getHours());
  const hasScan = state.data.scans.length > 0;
  return (
    <Card>
      <PanelTitle sub={t("home_hint")}>{t("home_heading")}</PanelTitle>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Chip onClick={() => ctl.startScan()} tone="bg-rani/15 text-rani-ink" icon={<FaceIcon />}>
          {t("chip_scan")}
        </Chip>
        <Chip onClick={() => ctl.startRitual(period)} tone="bg-peacock/15 text-peacock-ink" icon={<DropIcon />}>
          {period === "am" ? t("chip_ritual_am") : t("chip_ritual_pm")}
        </Chip>
        <Chip onClick={() => ctl.tryLook()} tone="bg-amethyst/15 text-amethyst-ink" icon={<PaletteIcon />}>
          {t("chip_looks")}
        </Chip>
        <Chip onClick={() => ctl.showLedger()} tone="bg-marigold/25 text-marigold-ink" icon={<BookIcon />}>
          {t("chip_ledger")}
        </Chip>
        <Chip onClick={() => ctl.lookAtProduct()} tone="bg-sapphire/15 text-sapphire-ink" icon={<BottleIcon />}>
          {t("chip_bottle")}
        </Chip>
        {hasScan ? (
          <Chip onClick={() => ctl.verify()} tone="bg-ink/10 text-ink" icon={<ScaleIcon />}>
            {t("chip_verify")}
          </Chip>
        ) : null}
      </div>
    </Card>
  );
}
