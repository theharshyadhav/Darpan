"use client";

import type { Panel } from "@/client/state";
import { BookIcon, FaceIcon, HomeIcon, PaletteIcon, DropIcon } from "./icons";
import { useMirrorCtx } from "./mirror-context";

const TABS = [
  { id: "home", key: "tab_home", Icon: HomeIcon },
  { id: "report", key: "tab_report", Icon: FaceIcon },
  { id: "ritual", key: "tab_ritual", Icon: DropIcon },
  { id: "looks", key: "tab_looks", Icon: PaletteIcon },
  { id: "ledger", key: "tab_ledger", Icon: BookIcon },
] as const;

/** Scan and verify belong to the skin tab: they are things you do while looking at your skin. */
function tabFor(panel: Panel): (typeof TABS)[number]["id"] {
  return panel === "scan" || panel === "verify" ? "report" : panel;
}

export function Tabs() {
  const { ctl, state, t } = useMirrorCtx();
  const current = tabFor(state.panel);
  return (
    <nav aria-label={t("panels")} className="chrome-hide">
      <ul className="grid grid-cols-5 gap-1 rounded-full border border-line bg-card/80 p-1 backdrop-blur">
        {TABS.map(({ id, key, Icon }) => {
          const on = current === id;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => ctl.openPanel(id)}
                aria-current={on ? "page" : undefined}
                className={`flex min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-full px-1 text-[0.78rem] font-semibold leading-none transition-colors sm:flex-row sm:gap-2 sm:text-sm ${on ? "bg-ink text-white" : "text-ink-soft hover:bg-pearl-deep"}`}
              >
                <Icon width={18} height={18} />
                <span>{t(key)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
