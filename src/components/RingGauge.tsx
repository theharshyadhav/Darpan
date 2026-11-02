"use client";

import { useEffect, useState } from "react";
import { CONCERNS, type ConcernKey } from "@/lib/concerns";
import { BAND_LABEL, scoreBand } from "@/lib/skin/report";
import type { ScoreMap } from "@/lib/skin/types";
import type { Language } from "@/lib/types";
import { useMirrorCtx } from "./mirror-context";

/**
 * The seven concerns as jewel rings. Higher is better on every ring, so a full ring is never "bad".
 *
 * The order is not the API's: it is the order in which neighbouring gem colours stay apart for
 * people with red-green colour blindness (checked with the dataviz palette validator: worst
 * neighbouring pair is 13 on the CVD scale, far above the floor). Colour is never the only carrier
 * of meaning: every ring prints its name, its number and a band word. The ring strokes are the
 * concerns' own gem colours; all text is ink, which passes AA.
 */
export const RING_ORDER: readonly ConcernKey[] = ["texture", "moisture", "redness", "radiance", "oiliness", "pore", "acne"];

const R = 36;
const C = 2 * Math.PI * R;

export function Ring({ concern, score, lang }: { concern: ConcernKey; score: number; lang: Language }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(score));
    return () => cancelAnimationFrame(id);
  }, [score]);
  const meta = CONCERNS[concern];
  const band = BAND_LABEL[lang][scoreBand(score)];
  const label = meta.label[lang];
  return (
    <figure className="m-0 flex w-[5.6rem] flex-col sm:w-[6.4rem] items-center text-center" aria-label={`${label}: ${Math.round(score)}, ${band}`}>
      <svg viewBox="0 0 88 88" width="88" height="88" role="presentation" aria-hidden="true">
        <circle className="ring-track" cx="44" cy="44" r={R} fill="#fff" strokeWidth="9" />
        <circle
          className="ring-arc"
          cx="44"
          cy="44"
          r={R}
          fill="none"
          stroke={meta.color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - Math.max(0, Math.min(100, shown)) / 100)}
          transform="rotate(-90 44 44)"
        />
        <text x="44" y="51" textAnchor="middle" fontSize="24" fontWeight="700" fill="#221a52" style={{ fontFamily: "var(--font-voice)" }}>
          {Math.round(score)}
        </text>
      </svg>
      <figcaption className="-mt-0.5 text-[0.95rem] font-semibold leading-tight text-ink">{label}</figcaption>
      <span className="text-[0.82rem] leading-tight text-ink-soft">{band}</span>
    </figure>
  );
}

export function Rings({ scores }: { scores: ScoreMap }) {
  const { lang } = useMirrorCtx();
  return (
    <div className="flex flex-wrap justify-center gap-x-2 gap-y-5 sm:gap-x-3">
      {RING_ORDER.map((k) => {
        const v = scores[k];
        return typeof v === "number" ? <Ring key={k} concern={k} score={v} lang={lang} /> : null;
      })}
    </div>
  );
}

/** The same numbers as a plain list, for anyone who would rather read than look. */
export function ScoreList({ scores }: { scores: ScoreMap }) {
  const { lang, t } = useMirrorCtx();
  return (
    <ul className="m-0 divide-y divide-line p-0">
      {RING_ORDER.map((k) => {
        const v = scores[k];
        if (typeof v !== "number") return null;
        const meta = CONCERNS[k];
        return (
          <li key={k} className="flex items-center gap-3 py-2.5">
            <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ background: meta.color }} />
            <span className="flex-1 font-semibold">{meta.label[lang]}</span>
            <span className="text-sm text-ink-soft">{BAND_LABEL[lang][scoreBand(v)]}</span>
            <span className="w-24 text-right font-voice text-lg font-semibold">
              {Math.round(v)} <span className="sr-only">{t("out_of_100")}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
