"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { TimerView } from "@/client/state";
import { slotLabel } from "@/lib/persona/copy";
import { progress, type StepStatus } from "@/lib/ritual/engine";
import { CheckIcon } from "../icons";
import { Card, PanelTitle, PrimaryButton, QuietButton, TextButton } from "../kit";
import { useMirrorCtx } from "../mirror-context";
import type { UiKey } from "../ui-text";

const STATUS_KEY: Record<StepStatus, UiKey> = { done: "step_done", current: "step_current", upcoming: "step_upcoming", skipped: "step_skipped" };
const TIMER_KEY = { massage: "timer_massage", settle: "timer_settle", mask: "timer_mask", custom: "timer_custom" } as const;

function useNow(everyMs: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs, active]);
  return now;
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Timers({ timers }: { timers: TimerView[] }) {
  const { ctl, t } = useMirrorCtx();
  const now = useNow(500, timers.length > 0);
  if (timers.length === 0) return null;
  return (
    <div className="mt-4" role="group" aria-label={t("timers")}>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {timers.map((tm) => {
          const left = tm.endsAt - now;
          const pct = Math.max(0, Math.min(100, (left / (tm.totalSec * 1000)) * 100));
          return (
            <li key={tm.id} className="rounded-2xl bg-marigold/20 px-4 py-2.5">
              <div className="flex items-baseline justify-between">
                <span className="font-semibold text-marigold-ink">{t(TIMER_KEY[tm.kind])}</span>
                <span className="font-voice text-xl font-semibold tabular-nums">{mmss(left)}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/70" aria-hidden="true">
                <div className="h-full rounded-full bg-marigold" style={{ width: `${pct}%`, transition: "width 0.5s linear" }} />
              </div>
            </li>
          );
        })}
      </ul>
      <TextButton onClick={() => ctl.stopTimers()}>{t("stop_timers")}</TextButton>
    </div>
  );
}

export function RitualPanel() {
  const { ctl, state, lang, t } = useMirrorCtx();
  const [name, setName] = useState("");
  const ritual = state.data.ritual && state.data.ritual.status === "active" ? state.data.ritual : null;

  const add = (e: FormEvent) => {
    e.preventDefault();
    const v = name.trim();
    if (!v) return;
    setName("");
    ctl.logProduct(v);
  };

  if (!ritual) {
    return (
      <Card>
        <PanelTitle sub={t("ritual_empty")}>{t("tab_ritual")}</PanelTitle>
        <div className="flex flex-wrap gap-2">
          <PrimaryButton onClick={() => ctl.startRitual("am")}>{t("start_am")}</PrimaryButton>
          <QuietButton onClick={() => ctl.startRitual("pm")}>{t("start_pm")}</QuietButton>
        </div>
        <Timers timers={state.timers} />
      </Card>
    );
  }

  const steps = progress(ritual);
  return (
    <Card>
      <PanelTitle>{ritual.period === "am" ? t("ritual_am") : t("ritual_pm")}</PanelTitle>

      <ol className="garland m-0 list-none" aria-label={t("garland")}>
        {steps.map((s) => (
          <li key={s.slot} className="bead" data-status={s.status}>
            <span className="bead-gem">{s.status === "done" ? <CheckIcon width={18} height={18} /> : null}</span>
            <span className="text-[0.82rem] font-semibold leading-tight text-ink">{slotLabel(lang, s.slot)}</span>
            <span className="text-[0.72rem] leading-tight text-ink-soft">
              {s.status === "upcoming" && s.required ? t("step_needed") : t(STATUS_KEY[s.status])}
            </span>
          </li>
        ))}
      </ol>

      <Timers timers={state.timers} />

      <div className="mt-4">
        <h3 className="text-[0.95rem] font-semibold text-ink-soft">{t("applied")}</h3>
        {ritual.applied.length === 0 ? (
          <p className="mt-1 text-ink-faint">{t("nothing_applied")}</p>
        ) : (
          <ul className="m-0 mt-1.5 flex list-none flex-wrap gap-2 p-0">
            {ritual.applied.map((a) => (
              <li key={a.id} className="rounded-full bg-peacock/15 px-3 py-1 text-[0.92rem] font-semibold text-peacock-ink">
                {a.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={add} className="mt-4 flex gap-2">
        <label htmlFor="add-product" className="sr-only">
          {t("add_product")}
        </label>
        <input id="add-product" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t("add_product")} autoComplete="off" className="h-11 min-w-0 flex-1 rounded-full border-2 border-line bg-card px-4 text-base placeholder:text-ink-faint focus-visible:border-amethyst" />
        <PrimaryButton type="submit" disabled={!name.trim()}>
          {t("log_product")}
        </PrimaryButton>
      </form>

      <div className="mt-4 flex flex-wrap gap-2">
        <QuietButton onClick={() => ctl.skipStep()}>{t("skip")}</QuietButton>
        <PrimaryButton onClick={() => ctl.finishRitual()}>{t("finish_ritual")}</PrimaryButton>
      </div>
    </Card>
  );
}
