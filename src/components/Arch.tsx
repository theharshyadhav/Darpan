import type { ReactNode } from "react";

/** A cusped palace arch, drawn once in a 300 by 400 box and reused as the clip and the frame. */
export const ARCH_D =
  "M6 400V200Q6 160 34 140Q30 108 62 92Q60 56 100 44Q104 20 150 6Q196 20 200 44Q240 56 238 92Q270 108 266 140Q294 160 294 200V400Z";

/** Mounted once on the page: the camera and photos are clipped to this shape. */
export function ArchDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
      <defs>
        <clipPath id="darpan-arch" clipPathUnits="objectBoundingBox">
          <path d={ARCH_D} transform="scale(0.0033333 0.0025)" />
        </clipPath>
      </defs>
    </svg>
  );
}

/** The gilded outline over the arch: rani, marigold and peacock, like inlay. */
export function ArchFrame() {
  return (
    <svg className="arch-frame" viewBox="0 0 300 400" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="arch-gild" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e6397c" />
          <stop offset="0.5" stopColor="#ffb020" />
          <stop offset="1" stopColor="#00a39a" />
        </linearGradient>
      </defs>
      <path d={ARCH_D} fill="none" stroke="url(#arch-gild)" strokeWidth="5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <path d={ARCH_D} fill="none" stroke="#fff" strokeOpacity="0.9" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" transform="translate(0 0)" />
    </svg>
  );
}

export type OrbState = "idle" | "listening" | "speaking" | "thinking" | "resting";

/** The gem at the crown of the arch: it shows, without words, what the mirror is doing. */
export function Orb({ state, label, children }: { state: OrbState; label: string; children?: ReactNode }) {
  return (
    <div className="orb" data-state={state} role="img" aria-label={label}>
      {children}
    </div>
  );
}
