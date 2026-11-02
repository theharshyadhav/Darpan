"use client";

import { useId, useState } from "react";
import { cleanCustomTitle, MAX_TITLE_LENGTH, TITLE_PRESETS } from "@/lib/persona/titles";
import { LANGUAGES, type Language } from "@/lib/types";
import { useMirrorCtx } from "./mirror-context";
import type { UiKey } from "./ui-text";

const LANG_KEY: Record<Language, UiKey> = { en: "lang_en", hi: "lang_hi", hinglish: "lang_hinglish" };

function segment(on: boolean): string {
  return `min-h-11 rounded-full px-4 text-[0.95rem] font-semibold transition-colors ${on ? "bg-ink text-white" : "border border-line bg-card text-ink hover:bg-pearl-deep"}`;
}

/** English, Hindi or Hinglish. Each name is written in its own script so it can always be found. */
export function LanguagePicker() {
  const { ctl, lang, t } = useMirrorCtx();
  return (
    <div role="group" aria-label={t("choose_language")} className="flex flex-wrap gap-2">
      {LANGUAGES.map((l) => (
        <button key={l} type="button" aria-pressed={lang === l} lang={l === "hi" ? "hi" : "en"} onClick={() => ctl.setLanguage(l)} className={segment(lang === l)}>
          {t(LANG_KEY[l])}
        </button>
      ))}
    </div>
  );
}

/** How the mirror addresses the person: a preset, or a title of their own. */
export function TitlePicker() {
  const { ctl, state, lang, t } = useMirrorCtx();
  const { titleId, customTitle } = state.data.settings;
  const [draft, setDraft] = useState(customTitle);
  const id = useId();
  const commit = () => {
    const v = cleanCustomTitle(draft);
    if (v.length >= 2) ctl.setCustomTitle(v);
  };
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label={t("set_title")} className="flex flex-wrap gap-2">
        {TITLE_PRESETS.map((p) => (
          <button key={p.id} type="button" aria-pressed={titleId === p.id} onClick={() => ctl.setTitleId(p.id)} className={segment(titleId === p.id)}>
            {lang === "hi" ? p.hi : p.en}
          </button>
        ))}
      </div>
      <div>
        <label htmlFor={id} className="text-[0.9rem] font-semibold text-ink-soft">
          {t("custom_title")}
        </label>
        <input
          id={id}
          value={draft}
          maxLength={MAX_TITLE_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          aria-describedby={`${id}-hint`}
          autoComplete="off"
          className={`mt-1 h-11 w-full rounded-full border-2 bg-card px-4 text-base focus-visible:border-amethyst ${titleId === "custom" ? "border-ink" : "border-line"}`}
        />
        <p id={`${id}-hint`} className="mt-1 text-[0.82rem] text-ink-faint">
          {t("custom_title_hint")}
        </p>
      </div>
    </div>
  );
}
