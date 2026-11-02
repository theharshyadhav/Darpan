"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { getPlatform } from "@/client/browser/use-mirror";
import { scoreVoice, type VoiceLike } from "@/client/browser/voices";
import { languageTag } from "@/lib/persona/titles";
import type { Pace } from "@/lib/types";
import { CloseIcon } from "./icons";
import { LanguagePicker, TitlePicker } from "./Pickers";
import { useMirrorCtx } from "./mirror-context";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line py-4 first:border-t-0">
      <h3 className="mb-3 font-voice text-xl font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Switch({ checked, onChange, label, sub }: { checked: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <div>
        <p className="font-semibold">{label}</p>
        {sub && <p className="text-[0.88rem] text-ink-soft">{sub}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-8 w-14 shrink-0 rounded-full border-2 transition-colors ${checked ? "border-peacock-ink bg-peacock-ink" : "border-ink-faint bg-pearl-deep"}`}
      >
        <span className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-all ${checked ? "left-[1.6rem]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

const PACES: Pace[] = ["calm", "steady", "brisk"];

/** Everything the person can change or switch off, in one place, with the privacy choices spelled out. */
export function SettingsSheet() {
  const { ctl, state, lang, t } = useMirrorCtx();
  const open = state.sheet === "settings";
  const closeRef = useRef<HTMLButtonElement>(null);
  const [voices, setVoices] = useState<VoiceLike[]>([]);
  const settings = state.data.settings;

  useEffect(() => {
    const sp = getPlatform()?.speaker;
    if (!sp) return;
    const read = () => setVoices(sp.voices());
    read();
    return sp.onVoicesChanged(read);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") ctl.openSettings(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, ctl]);

  if (!open) return null;

  const tag = languageTag(lang, typeof navigator !== "undefined" ? navigator.language : undefined);
  const matching = voices.filter((v) => scoreVoice(v, tag) > 0);
  const speaker = getPlatform()?.speaker;
  const noVoice = !!speaker && speaker.available && matching.length === 0;
  const status = state.status;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/45 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && ctl.openSettings(false)}>
      <div role="dialog" aria-modal="true" aria-label={t("settings_title")} className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-pearl p-5 shadow-2xl">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-3xl">{t("settings_title")}</h2>
          <button ref={closeRef} type="button" onClick={() => ctl.openSettings(false)} aria-label={t("close")} className="grid size-11 place-items-center rounded-full border-2 border-line bg-card">
            <CloseIcon />
          </button>
        </div>

        {!state.persistent && <p role="note" className="mb-2 rounded-xl bg-marigold/20 p-3 text-[0.92rem] text-marigold-ink">{t("storage_off")}</p>}

        <Section title={t("set_title")}>
          <TitlePicker />
        </Section>

        <Section title={t("set_language")}>
          <LanguagePicker />
        </Section>

        <Section title={t("set_voice")}>
          <label className="sr-only" htmlFor="voice-select">
            {t("set_voice")}
          </label>
          <select id="voice-select" value={settings.voiceUri} onChange={(e) => ctl.setVoice(e.target.value)} className="h-11 w-full rounded-full border-2 border-line bg-card px-4 text-base">
            <option value="">{t("voice_auto")}</option>
            {matching.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
          {noVoice && <p className="mt-2 text-[0.88rem] text-marigold-ink">{t("voice_none")}</p>}

          <p className="mb-1.5 mt-4 font-semibold">{t("set_pace")}</p>
          <div role="group" aria-label={t("set_pace")} className="flex gap-2">
            {PACES.map((p) => (
              <button key={p} type="button" aria-pressed={settings.pace === p} onClick={() => ctl.setPace(p)} className={`min-h-11 flex-1 rounded-full px-3 text-[0.95rem] font-semibold ${settings.pace === p ? "bg-ink text-white" : "border border-line bg-card"}`}>
                {t(p === "calm" ? "pace_calm" : p === "steady" ? "pace_steady" : "pace_brisk")}
              </button>
            ))}
          </div>
          <div className="mt-3">
            <Switch checked={settings.handsFree} onChange={() => ctl.toggleListening()} label={t("set_handsfree")} sub={t("set_handsfree_sub")} />
          </div>
        </Section>

        <Section title={t("privacy")}>
          <Switch checked={settings.consentScan} onChange={(v) => (v ? ctl.grantConsent("scan") : ctl.revokeConsent("scan"))} label={t("set_consent_scan")} sub={t("set_consent_scan_sub")} />
          <Switch checked={settings.consentLook} onChange={(v) => (v ? ctl.grantConsent("look") : ctl.revokeConsent("look"))} label={t("set_consent_look")} sub={t("set_consent_look_sub")} />
          <a href="/privacy" target="_blank" rel="noopener" className="mt-2 inline-flex min-h-11 items-center font-semibold text-amethyst-ink underline underline-offset-4">
            {t("privacy")}
          </a>
        </Section>

        <Section title={t("set_kiosk")}>
          <Switch checked={settings.kiosk} onChange={(v) => ctl.setKiosk(v)} label={t("set_kiosk")} sub={t("set_kiosk_sub")} />
        </Section>

        <Section title={t("status_title")}>
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-y-1.5 text-[0.95rem]">
            <dt className="text-ink-soft">{t("status_skin")}</dt>
            <dd className="m-0 font-semibold">{status?.skin === "live" ? t("s_live") : t("s_samples")}</dd>
            <dt className="text-ink-soft">{t("status_looks")}</dt>
            <dd className="m-0 font-semibold">{status?.look === "live" ? t("s_live") : t("s_off")}</dd>
            <dt className="text-ink-soft">{t("status_brain")}</dt>
            <dd className="m-0 font-semibold">{status?.llm === "live" ? (status.llmProvider ?? t("s_on")) : t("s_builtin")}</dd>
            <dt className="text-ink-soft">{t("status_vision")}</dt>
            <dd className="m-0 font-semibold">{status?.vision ? t("s_on") : t("s_off")}</dd>
          </dl>
        </Section>

        <Section title={t("forget_me")}>
          <p className="mb-3 text-[0.92rem] text-ink-soft">{t("forget_sub")}</p>
          <button
            type="button"
            onClick={() => {
              ctl.openSettings(false);
              ctl.askForget();
            }}
            className="min-h-11 rounded-full border-2 border-rani-ink px-5 font-semibold text-rani-ink"
          >
            {t("forget_me")}
          </button>
        </Section>
      </div>
    </div>
  );
}
