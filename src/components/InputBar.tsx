"use client";

import { useState, type FormEvent } from "react";
import { MicIcon, MicOffIcon, MoonIcon, SendIcon } from "./icons";
import { useMirrorCtx } from "./mirror-context";

/** Typing, the microphone and rest: the voice-free way to do everything, and the controls for the ear. */
export function InputBar() {
  const { ctl, state, t } = useMirrorCtx();
  const [text, setText] = useState("");
  const { voice } = state;
  const listening = voice.listening && voice.ear !== "blocked" && voice.ear !== "unsupported";
  const earNote = voice.ear === "unsupported" ? t("mic_unsupported") : voice.ear === "blocked" ? t("mic_blocked") : voice.ear === "error" ? t("mic_error") : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    setText("");
    void ctl.hear(v, "typed");
  };

  return (
    <div className="flex flex-col gap-2">
      {earNote && (
        <p role="status" className="rounded-xl bg-marigold/20 px-3 py-2 text-sm text-marigold-ink">
          {earNote}
        </p>
      )}
      <form onSubmit={submit} className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => ctl.toggleListening()}
          aria-pressed={listening}
          aria-label={listening ? t("mic_on") : t("mic_off")}
          title={listening ? t("mic_on") : t("mic_off")}
          disabled={voice.ear === "unsupported"}
          className={`grid size-12 shrink-0 place-items-center rounded-full border-2 transition-colors disabled:opacity-45 ${listening ? "border-rani-ink bg-rani-ink text-white" : "border-ink bg-card text-ink"}`}
        >
          {listening ? <MicIcon /> : <MicOffIcon />}
        </button>
        <label className="sr-only" htmlFor="say">
          {t("type_placeholder")}
        </label>
        <input
          id="say"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("type_placeholder")}
          maxLength={400}
          autoComplete="off"
          enterKeyHint="send"
          className="h-12 min-w-0 flex-1 rounded-full border-2 border-line bg-card px-4 text-base text-ink placeholder:text-ink-faint focus-visible:border-amethyst"
        />
        <button type="submit" aria-label={t("send")} title={t("send")} disabled={!text.trim()} className="grid size-12 shrink-0 place-items-center rounded-full bg-ink text-white disabled:opacity-40">
          <SendIcon />
        </button>
        <button type="button" onClick={() => ctl.rest()} aria-label={t("rest")} title={t("rest")} className="grid size-12 shrink-0 place-items-center rounded-full border-2 border-line bg-card text-ink-soft">
          <MoonIcon />
        </button>
      </form>
    </div>
  );
}
