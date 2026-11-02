"use client";

import { useEffect } from "react";
import { ArchDefs } from "./Arch";
import { AskBar } from "./AskBar";
import { Captions } from "./Captions";
import { ConsentCard } from "./ConsentCard";
import { Header } from "./Header";
import { InputBar } from "./InputBar";
import { MirrorProvider, useMirrorCtx } from "./mirror-context";
import { HomePanel } from "./panels/HomePanel";
import { LedgerPanel } from "./panels/LedgerPanel";
import { LooksPanel } from "./panels/LooksPanel";
import { ReportPanel } from "./panels/ReportPanel";
import { RitualPanel } from "./panels/RitualPanel";
import { VerifyPanel } from "./panels/VerifyPanel";
import { SettingsSheet } from "./SettingsSheet";
import { Stage } from "./Stage";
import { Tabs } from "./Tabs";
import { Welcome } from "./Welcome";
import type { UiKey } from "./ui-text";

export function App() {
  return (
    <MirrorProvider>
      <ArchDefs />
      <Shell />
    </MirrorProvider>
  );
}

function PanelSwitch() {
  const { state } = useMirrorCtx();
  switch (state.panel) {
    case "home":
      return <HomePanel />;
    case "scan":
    case "report":
      return <ReportPanel />;
    case "ritual":
      return <RitualPanel />;
    case "verify":
      return <VerifyPanel />;
    case "looks":
      return <LooksPanel />;
    case "ledger":
      return <LedgerPanel />;
  }
}

const NOTICE_KEY: Record<string, UiKey> = { busy: "notice_busy", photo_unreadable: "notice_photo_unreadable" };

function Shell() {
  const { ctl, state, t } = useMirrorCtx();
  const awake = state.phase === "awake";
  // the Wake button sits low on a phone: start the awake screen at the mirror, not wherever the tap scrolled to
  useEffect(() => {
    if (awake) window.scrollTo(0, 0);
  }, [awake]);
  // a scan is something you do facing the mirror: bring the arch back into view when one begins
  const scanning = state.scan.name !== "idle";
  useEffect(() => {
    if (scanning) window.scrollTo(0, 0);
  }, [scanning]);
  if (!awake) return <Welcome />;
  const kiosk = state.data.settings.kiosk;

  return (
    <div data-kiosk={kiosk ? "true" : "false"} className="mx-auto min-h-dvh max-w-6xl px-4 pb-6">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-white">
        {t("skip_to_main")}
      </a>
      <Header />

      <main id="main" className={`grid gap-5 ${kiosk ? "justify-items-center" : "lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-10"}`}>
        <div className={`unveil flex w-full flex-col gap-4 ${kiosk ? "max-w-3xl items-center text-center" : "lg:sticky lg:top-4 lg:self-start"}`}>
          <Stage />
          <Captions />
        </div>

        <div className={`flex min-w-0 flex-col gap-4 ${kiosk ? "w-full max-w-xl" : ""}`}>
          <Tabs />
          <ConsentCard />
          <AskBar />
          <div className="chrome-hide flex flex-col gap-4">
            <PanelSwitch />
          </div>
          <div className="chrome-hide sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-10 -mx-1 rounded-[1.6rem] border border-line bg-pearl/90 p-2 shadow-[0_-10px_30px_-18px_rgb(34_26_82_/_0.4)] backdrop-blur">
            <InputBar />
          </div>
        </div>
      </main>

      {kiosk && (
        <button type="button" onClick={() => ctl.setKiosk(false)} className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 z-30 min-h-11 -translate-x-1/2 rounded-full border border-line bg-card/90 px-4 text-sm font-semibold text-ink-soft">
          {t("exit_kiosk")}
        </button>
      )}

      {state.notice && (
        <p role="status" className="fixed inset-x-0 top-4 z-50 mx-auto w-fit max-w-[90vw] rounded-full bg-ink px-5 py-2.5 text-[0.95rem] font-semibold text-white shadow-lg">
          {t(NOTICE_KEY[state.notice] ?? "notice_busy")}
        </p>
      )}

      <SettingsSheet />
    </div>
  );
}
