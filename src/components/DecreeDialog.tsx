"use client";

import { useEffect, useRef, useState } from "react";
import { concernLabel } from "@/lib/concerns";
import { titleFor } from "@/lib/persona/titles";
import type { SkinScan } from "@/lib/skin/types";
import { strengthAndFocus } from "@/lib/skin/report";
import { drawDecree, decreeFilename } from "./decree";
import { ShareIcon } from "./icons";
import { PrimaryButton, QuietButton } from "./kit";
import { useMirrorCtx } from "./mirror-context";

/** A shareable card for the latest scan. It is drawn on this device and holds no photo. */
export function DecreeDialog({ scan, onClose }: { scan: SkinScan; onClose: () => void }) {
  const { state, lang, t } = useMirrorCtx();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [saved, setSaved] = useState(false);
  const settings = state.data.settings;
  const strongest = strengthAndFocus(scan.scores).strength;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    void drawDecree(c, {
      title: titleFor(settings),
      heading: t("decree_title"),
      strongestLabel: t("decree_strongest"),
      strongestName: strongest ? concernLabel(strongest, lang) : "",
      samples: scan.source === "demo",
      samplesLabel: t("decree_samples"),
      footer: t("decree_footer"),
      scores: scan.scores,
      dateText: new Date(scan.at).toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "long", year: "numeric" }),
      lang,
    });
  }, [scan, settings, strongest, lang, t]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toBlob = () => new Promise<Blob | null>((resolve) => canvasRef.current?.toBlob((b) => resolve(b), "image/png"));

  const save = async () => {
    const blob = await toBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = decreeFilename(scan.at);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setSaved(true);
  };

  const share = async () => {
    const blob = await toBlob();
    if (!blob) return;
    const file = new File([blob], decreeFilename(scan.at), { type: "image/png" });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: t("decree_title") });
      else await save();
    } catch {
      /* the person closed the share sheet */
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={t("decree_title")} className="fixed inset-0 z-50 grid place-items-center bg-ink/55 p-4 backdrop-blur-sm">
      <div className="flex max-h-[94dvh] w-full max-w-md flex-col gap-4 overflow-auto rounded-[var(--radius-gem)] bg-pearl p-4 shadow-2xl">
        <canvas ref={canvasRef} className="h-auto w-full rounded-xl border border-line" role="img" aria-label={t("decree_title")} />
        <div className="flex flex-wrap gap-2">
          <PrimaryButton onClick={share} icon={<ShareIcon />}>
            {t("decree_share")}
          </PrimaryButton>
          <QuietButton onClick={save}>{saved ? t("decree_saved") : t("decree_save")}</QuietButton>
          <button ref={closeRef} type="button" onClick={onClose} className="min-h-11 rounded-full px-4 text-[0.95rem] font-semibold text-ink-soft">
            {t("decree_close")}
          </button>
        </div>
      </div>
    </div>
  );
}
