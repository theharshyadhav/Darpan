import type { ButtonHTMLAttributes, ReactNode } from "react";

/** The few shared pieces: a card, and three kinds of button. Sentence-case labels, no arrows. */

export function Card({ children, className = "", as: Tag = "section", ...rest }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" } & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={`rounded-[var(--radius-gem)] border border-line bg-card/90 p-5 shadow-[var(--shadow-gem)] ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

type B = ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode };

export function PrimaryButton({ icon, children, className = "", ...p }: B) {
  return (
    <button type="button" className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-rani-ink px-5 text-[0.95rem] font-semibold text-white shadow-sm transition-transform active:scale-[0.98] disabled:opacity-50 ${className}`} {...p}>
      {icon}
      {children}
    </button>
  );
}

export function QuietButton({ icon, children, className = "", ...p }: B) {
  return (
    <button type="button" className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full border-2 border-ink bg-card px-5 text-[0.95rem] font-semibold text-ink transition-transform active:scale-[0.98] disabled:opacity-50 ${className}`} {...p}>
      {icon}
      {children}
    </button>
  );
}

export function TextButton({ icon, children, className = "", ...p }: B) {
  return (
    <button type="button" className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-3 text-[0.92rem] font-semibold text-amethyst-ink underline decoration-amethyst/40 underline-offset-4 disabled:opacity-50 ${className}`} {...p}>
      {icon}
      {children}
    </button>
  );
}

export function PanelTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="font-voice text-[1.6rem] font-semibold leading-tight">{children}</h2>
      {sub && <p className="mt-1 text-[0.95rem] text-ink-soft">{sub}</p>}
    </div>
  );
}
