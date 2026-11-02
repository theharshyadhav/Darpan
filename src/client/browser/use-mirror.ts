"use client";

import { useEffect, useSyncExternalStore } from "react";
import { MirrorController } from "../controller";
import type { MirrorState } from "../state";
import { createPlatform, createServerPlatform, type BrowserPlatform } from "./platform";

/**
 * One mirror per page. The controller and its platform are created the first time the browser asks
 * for them and live until the page does: React may mount, unmount and remount components (and does
 * so twice in development), and none of that may close the camera or lose the conversation.
 */

let platform: BrowserPlatform | null = null;
let controller: MirrorController | null = null;

export function getPlatform(): BrowserPlatform | null {
  return platform;
}

export function getMirror(): MirrorController {
  if (!controller) {
    platform = createPlatform();
    controller = new MirrorController(platform);
  }
  return controller;
}

/** The first render, identical on the server and during hydration. */
let serverState: MirrorState | null = null;
function getServerState(): MirrorState {
  if (!serverState) serverState = new MirrorController(createServerPlatform()).getState();
  return serverState;
}

const noopSubscribe = () => () => {};

export function useMirror(): { ctl: MirrorController; state: MirrorState } {
  const live = typeof window !== "undefined";
  const ctl = live ? getMirror() : (null as unknown as MirrorController);
  const state = useSyncExternalStore(live ? ctl.subscribe : noopSubscribe, live ? ctl.getState : getServerState, getServerState);

  useEffect(() => {
    const c = getMirror();
    c.init(); // idempotent: safe under React's double effects
    const onVisible = () => c.setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisible);
    onVisible();
    return () => document.removeEventListener("visibilitychange", onVisible);
    // no dispose here: unmounting a component is not the end of the visit
  }, []);

  return { ctl, state };
}
