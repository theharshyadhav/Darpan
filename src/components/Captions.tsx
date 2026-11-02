"use client";

import { useMirrorCtx } from "./mirror-context";

/**
 * What the mirror says, as it says it. The newest line is large (Eczar, the mirror's own voice);
 * older lines fade back. The region is a polite live region, so a screen reader hears each line once,
 * and a person who cannot hear the voice, or has none installed, loses nothing.
 */
export function Captions() {
  const { state, t } = useMirrorCtx();
  const { captions, voice, thinking } = state;
  const recent = captions.slice(-4);
  const lastMirror = [...recent].reverse().find((c) => c.who === "mirror");

  return (
    <section aria-label={t("captions")} className="min-h-[7.5rem] px-1">
      <div role="log" aria-live="polite" aria-relevant="additions" className="flex flex-col gap-2">
        {recent.map((c) => {
          const isLatest = c.id === lastMirror?.id;
          if (c.who === "you") {
            return (
              <p key={c.id} className="self-end rounded-2xl rounded-br-md bg-ink px-3.5 py-1.5 text-sm text-white">
                <span className="sr-only">{t("you_said")}: </span>
                {c.text}
              </p>
            );
          }
          return (
            <p
              key={c.id}
              className={`caption-line font-voice ${isLatest ? "text-[1.55rem] leading-snug text-ink" : "text-base text-ink-faint"}`}
              style={isLatest ? { animation: "unveil 0.5s ease-out both" } : undefined}
            >
              <span className="sr-only">{t("mirror_said")}: </span>
              {c.text}
            </p>
          );
        })}
      </div>
      {voice.interim && (
        <p className="mt-2 text-sm italic text-ink-soft" aria-hidden="true">
          {t("hearing")}: {voice.interim}
        </p>
      )}
      {thinking && <span className="sr-only">{t("orb_thinking")}</span>}
    </section>
  );
}
