"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useMirror } from "@/client/browser/use-mirror";
import type { MirrorController } from "@/client/controller";
import type { MirrorState } from "@/client/state";
import type { Language } from "@/lib/types";
import { ui, type UiKey } from "./ui-text";

interface Ctx {
  ctl: MirrorController;
  state: MirrorState;
  lang: Language;
  t: (key: UiKey, params?: Record<string, string | number>) => string;
}

const MirrorCtx = createContext<Ctx | null>(null);

const HTML_LANG: Record<Language, string> = { en: "en", hi: "hi", hinglish: "en-IN" };

/** One mirror for the whole screen, and the labels in the person's language. */
export function MirrorProvider({ children }: { children: ReactNode }) {
  const { ctl, state } = useMirror();
  const lang = state.data.settings.language;
  const t = useCallback((key: UiKey, params?: Record<string, string | number>) => ui(lang, key, params), [lang]);

  useEffect(() => {
    document.documentElement.lang = HTML_LANG[lang];
  }, [lang]);

  const value = useMemo(() => ({ ctl, state, lang, t }), [ctl, state, lang, t]);
  return <MirrorCtx.Provider value={value}>{children}</MirrorCtx.Provider>;
}

export function useMirrorCtx(): Ctx {
  const v = useContext(MirrorCtx);
  if (!v) throw new Error("useMirrorCtx must be used inside <MirrorProvider>");
  return v;
}
