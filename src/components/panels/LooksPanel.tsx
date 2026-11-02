"use client";

import { LOOKS, LOOK_IDS, recipeSteps, type LookId } from "@/lib/looks";
import { PaletteIcon } from "../icons";
import { Card, PanelTitle, PrimaryButton, QuietButton, TextButton } from "../kit";
import { useMirrorCtx } from "../mirror-context";

export function LooksPanel() {
  const { ctl, state, lang, t } = useMirrorCtx();
  const { looks } = state;
  const selected = looks.selected;
  const steps = selected ? recipeSteps(LOOKS[selected], lang) : [];
  const busy = looks.status === "rendering";

  return (
    <Card>
      <PanelTitle sub={t("look_pick")}>{t("looks_title")}</PanelTitle>

      <ul className="m-0 grid list-none gap-2.5 p-0 sm:grid-cols-2">
        {LOOK_IDS.map((id: LookId) => {
          const look = LOOKS[id];
          const on = selected === id;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => ctl.tryLook(id)}
                disabled={busy}
                aria-pressed={on}
                className={`flex w-full flex-col gap-2 rounded-2xl border-2 p-3.5 text-left transition-colors disabled:opacity-60 ${on ? "border-rani-ink bg-rani/8" : "border-line bg-card hover:bg-pearl-deep"}`}
              >
                <span className="flex gap-1.5" aria-hidden="true">
                  {look.swatches.slice(0, 4).map((c) => (
                    <span key={c} className="size-6 rounded-full border border-white shadow-sm" style={{ background: c }} />
                  ))}
                </span>
                <span className="font-voice text-lg font-semibold leading-tight">{look.name[lang]}</span>
                <span className="text-[0.88rem] text-ink-soft">{look.mood[lang]}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {selected && (
        <div className="mt-4 rounded-2xl bg-pearl-deep/70 p-4" aria-live="polite">
          {busy && <p className="font-semibold">{t("rendering")}</p>}
          {looks.status === "ready" && <p className="text-[0.93rem] text-ink-soft">{t("preview_live")}</p>}
          {looks.status === "demo" && <p className="text-[0.93rem] text-ink-soft">{t("recipe_only")}</p>}
          {looks.status === "error" && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-rani-ink">{t("look_error")}</p>
              <TextButton onClick={() => ctl.retry()}>{t("look_retry")}</TextButton>
            </div>
          )}

          {steps.length > 0 && (
            <>
              <h3 className="mt-3 text-[0.95rem] font-semibold text-ink-soft">{t("recipe")}</h3>
              <ol className="m-0 mt-1.5 list-none space-y-1.5 p-0">
                {steps.map((s, i) => {
                  const current = looks.coach?.index === i;
                  return (
                    <li key={i} aria-current={current ? "step" : undefined} className={`flex gap-3 rounded-xl px-3 py-2 text-[0.97rem] ${current ? "bg-marigold/30 font-semibold" : "bg-card/70"}`}>
                      <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-[0.78rem] font-bold text-white">
                        {i + 1}
                      </span>
                      <span>{s}</span>
                    </li>
                  );
                })}
              </ol>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {looks.coach ? (
                  <>
                    <PrimaryButton onClick={() => ctl.coachNext()}>{t("next_step")}</PrimaryButton>
                    <QuietButton onClick={() => void ctl.hear("say that again", "typed")}>{t("say_again")}</QuietButton>
                    <span className="text-[0.9rem] text-ink-soft">{t("step_of", { n: looks.coach.index + 1, total: steps.length })}</span>
                  </>
                ) : (
                  <PrimaryButton onClick={() => ctl.coachLook(selected)} icon={<PaletteIcon />}>
                    {t("coach_start")}
                  </PrimaryButton>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
